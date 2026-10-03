import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReportParser, PIDForce, hasPID } from '../src/input/webhid.js';

const U = (page, id) => ((page << 16) | id) >>> 0;
const item = (o) => ({
  isAbsolute: true, isArray: false, isConstant: false, isRange: false, usages: [], usageMinimum: 0, usageMaximum: 0,
  reportSize: 8, reportCount: 1, logicalMinimum: 0, logicalMaximum: 255, ...o,
});

// ハンコンを模した記述子: X(16bit) / Y(16bit) / ボタン 1-12 / ハット(4bit) + 余り 4bit
function fakeWheel() {
  return {
    productName: 'Fake Wheel',
    collections: [{
      usagePage: 1, usage: 4, children: [],
      inputReports: [{
        reportId: 1,
        items: [
          item({ usages: [U(1, 0x30)], reportSize: 16, logicalMinimum: 0, logicalMaximum: -1 }), // 0..65535（Chrome は -1 と返す）
          item({ usages: [U(1, 0x31)], reportSize: 16, logicalMinimum: -32768, logicalMaximum: 32767 }),
          item({ isRange: true, usageMinimum: U(9, 1), usageMaximum: U(9, 12), reportSize: 1, reportCount: 12, logicalMaximum: 1 }),
          item({ usages: [U(1, 0x39)], reportSize: 4, logicalMinimum: 0, logicalMaximum: 7 }),
          item({ isConstant: true, reportSize: 4 }),
        ],
      }],
      outputReports: [], featureReports: [],
    }],
  };
}

function report(x, y, buttons, hat) {
  const b = new Uint8Array(6);
  const dv = new DataView(b.buffer);
  dv.setUint16(0, x, true);
  dv.setInt16(2, y, true);
  let bits = 0;
  buttons.forEach((i) => { bits |= 1 << i; });
  bits |= (hat & 0xf) << 12;
  dv.setUint16(4, bits, true);
  return { reportId: 1, data: dv };
}

test('WebHID: 軸・ボタン・ハットを解析する', () => {
  const p = new ReportParser(fakeWheel());
  assert.equal(p.axes.length, 2);
  assert.equal(p.buttons.length, 12 + 4);
  p.handle(report(65535, 0, [0, 11], 2));
  let s = p.snapshot();
  assert.ok(Math.abs(s.axes[0] - 1) < 1e-6, `x ${s.axes[0]}`);
  assert.ok(Math.abs(s.axes[1]) < 1e-3, `y ${s.axes[1]}`);
  assert.equal(s.buttons[0], 1);
  assert.equal(s.buttons[11], 1);
  assert.equal(s.buttons[12 + 1], 1, 'ハット右（E）');
  p.handle(report(0, -32768, [], 8)); // ハット 8 = 中立
  s = p.snapshot();
  assert.ok(Math.abs(s.axes[0] + 1) < 1e-6);
  assert.ok(Math.abs(s.axes[1] + 1) < 1e-6);
  assert.equal(s.buttons.filter(Boolean).length, 0);
});

test('WebHID: 読む前に押して離したボタンも 1 回は押下として返す', () => {
  const p = new ReportParser(fakeWheel());
  p.handle(report(32768, 0, [4], 8));
  p.handle(report(32768, 0, [], 8));
  assert.equal(p.snapshot().buttons[4], 1);
  assert.equal(p.snapshot().buttons[4], 0);
});

// FFB（HID PID）: 定数力・エフェクト操作・デバイス制御などのレポートを持つ機器
function fakePID(sent) {
  const pid = (id) => U(0x0f, id);
  const outputReports = [
    { reportId: 0x01, items: [ // Set Effect
      item({ usages: [pid(0x22)], logicalMinimum: 1, logicalMaximum: 40 }),
      item({ isArray: true, usages: [pid(0x26), pid(0x31), pid(0x41)], logicalMinimum: 1, logicalMaximum: 3 }),
      item({ usages: [pid(0x50)], reportSize: 16, logicalMaximum: 32767 }),
      item({ usages: [pid(0x52)], logicalMaximum: 255 }),
      item({ usages: [U(1, 0x30)], reportSize: 1, logicalMaximum: 1 }),
      item({ isConstant: true, reportSize: 7 }),
      item({ usages: [U(0x0a, 1)], logicalMaximum: 255 }),
    ] },
    { reportId: 0x05, items: [ // Set Constant Force
      item({ usages: [pid(0x22)], logicalMinimum: 1, logicalMaximum: 40 }),
      item({ usages: [pid(0x70)], reportSize: 16, logicalMinimum: -10000, logicalMaximum: 10000 }),
    ] },
    { reportId: 0x0a, items: [ // Effect Operation
      item({ usages: [pid(0x22)], logicalMinimum: 1, logicalMaximum: 40 }),
      item({ isArray: true, usages: [pid(0x79), pid(0x7a), pid(0x7b)], logicalMinimum: 1, logicalMaximum: 3 }),
      item({ usages: [pid(0x7c)], logicalMaximum: 255 }),
    ] },
    { reportId: 0x0c, items: [ // Device Control
      item({ isArray: true, usages: [pid(0x97), pid(0x98), pid(0x99), pid(0x9a)], logicalMinimum: 1, logicalMaximum: 4 }),
    ] },
  ];
  return {
    productName: 'Fake DD',
    collections: [{ usagePage: 1, usage: 4, inputReports: [], outputReports: [], featureReports: [], children: [
      { usagePage: 0x0f, usage: 0x21, children: [], inputReports: [], outputReports, featureReports: [] },
    ] }],
    sendReport: async (id, data) => { sent.push([id, [...data]]); },
    sendFeatureReport: async () => {},
    receiveFeatureReport: async () => new DataView(new ArrayBuffer(4)),
  };
}

test('WebHID FFB: PID 対応を検出し、定数力とエフェクト開始のレポートを組み立てる', async () => {
  const sent = [];
  const dev = fakePID(sent);
  assert.ok(hasPID(dev));
  const f = new PIDForce(dev);
  assert.ok(f.ok, 'Set Effect / Constant / Operation を発見');
  assert.ok(await f.start());
  // Device Control: Reset（値 4）→ Enable Actuators（値 1）の順
  assert.deepEqual(sent.filter(([id]) => id === 0x0c).map(([, d]) => d), [[4], [1]]);
  // Set Effect: ブロック 1、種類 Constant（値 1）、持続 1000ms、ゲイン 255、X 軸有効、方向 90°（64）
  assert.deepEqual(sent.find(([id]) => id === 0x01)[1], [1, 1, 1000 & 255, 1000 >> 8, 255, 1, 64]);
  sent.length = 0;
  await f.apply({ constant: -0.5, damper: 0, rumble: 0 });
  const cf = sent.find(([id]) => id === 0x05)[1];
  const mag = new DataView(Uint8Array.from(cf).buffer).getInt16(1, true);
  assert.equal(cf[0], 1);
  assert.equal(mag, -5000);
  // 0.3 秒ごとにエフェクトを開始し直す（Op Effect Start = 値 1、ループ 1）
  assert.deepEqual(sent.find(([id]) => id === 0x0a)[1], [1, 1, 1]);
  sent.length = 0;
  await f.stop();
  const zero = sent.find(([id]) => id === 0x05)[1];
  assert.equal(new DataView(Uint8Array.from(zero).buffer).getInt16(1, true), 0);
  // 全停止は送らず、エフェクトを停止（Op Effect Stop = 値 3）
  assert.ok(!sent.some(([id]) => id === 0x0c), '全停止を送らない');
  assert.deepEqual(sent.find(([id]) => id === 0x0a)[1], [1, 3, 1], 'Op Effect Stop');
});
