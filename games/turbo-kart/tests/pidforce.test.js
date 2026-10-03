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
