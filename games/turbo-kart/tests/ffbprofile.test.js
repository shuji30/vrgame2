import { test } from 'node:test';
import assert from 'node:assert/strict';

// ブラウザの API を最低限まねる（ブリッジへは接続しない）
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
globalThis.WebSocket = class { constructor() { throw new Error('offline'); } };
const { FFBBridge } = await import('../src/ffb.js');

const plug = (b, name) => {
  b.status.connected = true;
  b.status.selected = name;
  b.emit();
};

test('FFB 設定はハンコンごとに保存され、つなぎ替えると切り替わる', () => {
  store.clear();
  const b = new FFBBridge();
  b.settings.gain = 0.3; // まだハンコンがない状態で調整した値
  plug(b, 'CAMMUS DDWB');
  assert.equal(b.settings.wheel, 'CAMMUS DDWB');
  assert.equal(b.settings.gain, 0.3, '最初の 1 台はいまの設定を引き継ぐ');
  b.settings.invert = true;
  b.settings.align = 0.4;
  b.save();

  let changed = null;
  b.onProfile((name, info) => { changed = { name, ...info }; });
  plug(b, 'Thrustmaster T500');
  assert.deepEqual(changed, { name: 'Thrustmaster T500', isNew: true });
  assert.equal(b.settings.gain, 0.5, '2 台目のはじめてのハンコンは既定値から');
  assert.equal(b.settings.invert, false);
  b.settings.gain = 0.9;
  b.save();

  plug(b, 'CAMMUS DDWB');
  assert.equal(b.settings.gain, 0.3);
  assert.equal(b.settings.invert, true);
  assert.equal(b.settings.align, 0.4);

  // 読み込み直しても、最後のハンコンの設定とそれぞれの保存内容が残る
  const b2 = new FFBBridge();
  assert.equal(b2.settings.wheel, 'CAMMUS DDWB');
  assert.equal(b2.settings.gain, 0.3);
  plug(b2, 'Thrustmaster T500');
  assert.equal(b2.settings.gain, 0.9);
});

test('出力先がなくなっても設定はそのまま', () => {
  store.clear();
  const b = new FFBBridge();
  plug(b, 'CAMMUS DDWB');
  b.settings.gain = 0.7;
  b.save();
  b.status.connected = false;
  b.emit();
  assert.equal(b.settings.gain, 0.7);
  assert.equal(b.settings.wheel, 'CAMMUS DDWB');
});
