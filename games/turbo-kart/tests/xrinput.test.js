import { test } from 'node:test';
import assert from 'node:assert/strict';

// ブラウザの API を最低限まねる
globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
globalThis.window ??= { addEventListener: () => {} };
const { InputManager } = await import('../src/input/devices.js');

const pad = (buttons, axes) => ({ mapping: 'xr-standard', buttons: buttons.map((v) => ({ value: v, pressed: v > 0.5 })), axes });

test('VR コントローラー: 左スティックでハンドル、右トリガーでアクセル、左トリガーでブレーキ、A でアイテム', () => {
  const input = new InputManager();
  let sources = [];
  input.getXRSources = () => sources;
  sources = [
    { handedness: 'left', gamepad: pad([0.6, 0, 0, 0, 0, 0], [0, 0, -0.5, 0]) },
    { handedness: 'right', gamepad: pad([1, 0, 0, 0, 1, 0], [0, 0, 0, 0]) },
  ];
  const a = input.poll(1 / 60);
  assert.ok(a.steer < -0.4, `steer ${a.steer}`);
  assert.equal(a.throttle, 1);
  assert.equal(a.brake, 0.6);
  assert.equal(a.item, true);
  assert.equal(a.source, 'gamepad');
  // 押しっぱなしでは 2 回目は出ない（押した瞬間だけ）
  const b = input.poll(1 / 60);
  assert.equal(b.item, false);
});
