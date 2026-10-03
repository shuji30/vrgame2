import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIDForce } from '../src/input/webhid.js';

// USB HID PID の記述だけを持つ偽物のハンコン（送ったレポートを記録する。送信は少し時間がかかる）
const PID = (id) => ((0x0f << 16) | id) >>> 0;
const item = (usages, size, count, min, max, extra = {}) => ({ usages, reportSize: size, reportCount: count, logicalMinimum: min, logicalMaximum: max, isArray: false, isConstant: false, isRange: false, ...extra });
const arr = (usages, size = 8) => item(usages, size, 1, 1, usages.length, { isArray: true });
function fakeWheel() {
  const outputReports = [
    { reportId: 1, items: [item([PID(0x22)], 8, 1, 1, 40), arr([PID(0x26), PID(0x41), PID(0x31)]), item([PID(0x50)], 16, 1, 0, 32767), item([PID(0x56)], 1, 1, 0, 1), item([], 7, 1, 0, 0, { isConstant: true }), item([0x000a0001], 16, 1, 0, 36000)] },
    { reportId: 5, items: [item([PID(0x22)], 8, 1, 1, 40), item([PID(0x70)], 16, 1, -10000, 10000)] },
    { reportId: 10, items: [item([PID(0x22)], 8, 1, 1, 40), arr([PID(0x79), PID(0x7b)]), item([PID(0x7c)], 8, 1, 0, 255)] },
    { reportId: 12, items: [arr([PID(0x97), PID(0x99), PID(0x9a)])] },
  ];
  const sent = [];
  return {
    sent,
    collections: [{ usagePage: 0x0f, usage: 0x21, outputReports, featureReports: [], children: [] }],
    sendReport: async (id, data) => { await new Promise((r) => setTimeout(r, 2)); sent.push({ id, data: [...data] }); },
  };
}

test('WebHID FFB: 毎フレーム start を呼んでも初期化は 1 回だけ。方向を有効にして、力の値を送る', async () => {
  const dev = fakeWheel();
  const p = new PIDForce(dev);
  assert.ok(p.ok);
  // 60 フレーム分、待たずに呼ぶ（ゲームと同じ）
  const all = [];
  for (let i = 0; i < 60; i++) all.push(p.start());
  await Promise.all(all);
  assert.equal(p.ready, true);
  // アクチュエーター有効（制御レポートの 1 番目の選択肢 = 値 1）は 1 回だけ
  const enable = dev.sent.filter((s) => s.id === 12 && s.data[0] === 1);
  assert.equal(enable.length, 1, `有効化 ${enable.length} 回`);
  // エフェクト設定: 方向有効のビットが立っている（4 バイト目の最下位ビット）
  const set = dev.sent.find((s) => s.id === 1);
  assert.equal(set.data[4] & 1, 1);
  // 力を出す
  await p.apply({ constant: 0.5, damper: 0, rumble: 0, rumbleHz: 0 });
  const c = dev.sent.filter((s) => s.id === 5).at(-1);
  const mag = (c.data[1] | (c.data[2] << 8)) << 16 >> 16;
  assert.equal(mag, 5000);
  // 開始の操作も送っている
  assert.ok(dev.sent.some((s) => s.id === 10));
});

// CAMMUS DDWB 2021 の実際の記述（Chrome が返したもの）: 種類は逆順で範囲 12〜0、操作は 3〜0、制御はオン/オフのビット、1 ビット項目は 0〜0
function cammus() {
  const v = (u, size, min, max, count = 1) => item([u], size, count, min, max);
  const a = (us, min, max) => item(us, 8, 1, min, max, { isArray: true });
  const outputReports = [
    { reportId: 1, items: [v(PID(0x22), 8, 1, 40), a([0x28, 0x43, 0x42, 0x41, 0x40, 0x34, 0x33, 0x32, 0x31, 0x30, 0x27, 0x26].map(PID), 12, 0),
      v(PID(0x50), 16, 0, 32767), v(PID(0x54), 16, 0, 32767), v(PID(0x51), 16, 0, 32767), v(PID(0x52), 8, 0, 255), v(PID(0x53), 8, 1, 8),
      v(0x10030, 1, 0, 0), v(0x10031, 1, 0, 0), v(PID(0x56), 1, 0, 0), item([], 5, 1, 0, 0, { isConstant: true }),
      v(0xa0001, 8, 0, 255), v(0xa0002, 8, 0, 255), v(0xa0001, 16, 0, 32765), v(0xa0002, 16, 0, 32765)] },
    { reportId: 5, items: [v(PID(0x22), 8, 1, 40), v(PID(0x70), 16, -32767, 32767)] },
    { reportId: 10, items: [v(PID(0x22), 8, 1, 40), a([0x7a, 0x79, 0x7b].map(PID), 3, 0), v(PID(0x7c), 8, 0, 255), item([], 112, 1, 0, 0, { isConstant: true })] },
    { reportId: 12, items: [v(PID(0x97), 1, 0, 0), v(PID(0x98), 1, 0, 0), v(PID(0x99), 1, 0, 0), v(PID(0x9a), 1, 0, 0), v(PID(0x9b), 1, 0, 0), v(PID(0x9c), 1, 0, 0, 3), item([], 128, 1, 0, 0, { isConstant: true })] },
  ];
  const sent = [];
  return { sent, collections: [{ usagePage: 1, usage: 5, outputReports, featureReports: [], children: [] }], sendReport: async (id, data) => { sent.push({ id, data: [...data] }); } };
}

test('WebHID FFB: CAMMUS DDWB の記述でも、有効化・種類（一定の力 = 1）・軸と方向の有効・開始（= 1）を正しく送る', async () => {
  const dev = cammus();
  const p = new PIDForce(dev);
  assert.ok(p.ok);
  await p.start();
  await p.apply({ constant: 0.5, damper: 0, rumble: 0, rumbleHz: 0 });
  // 最初はリセット（ビット 3）、次に有効化（ビット 0）
  const ctl = dev.sent.filter((s) => s.id === 12).map((s) => s.data[0]);
  assert.deepEqual(ctl.slice(0, 2), [8, 1], `制御 ${ctl}`);
  const set = dev.sent.find((s) => s.id === 1);
  assert.equal(set.data[1], 1, `種類 ${set.data[1]}`);
  assert.equal(set.data[10] & 0b101, 0b101, `X 軸と方向の有効 ${set.data[10]}`);
  const op = dev.sent.find((s) => s.id === 10);
  assert.equal(op.data[1], 1, `開始 ${op.data[1]}`);
});
