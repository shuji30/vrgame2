import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DriftScore } from '../src/core/driftscore.js';

// heading 0（+X 向き）で、前へ vF、横へ vL の速さで動いている車
const car = (vF, vL, surface = 'tarmac') => ({ vx: vF, vz: vL, heading: 0, surface });
const run = (d, k, sec, events = []) => {
  for (let t = 0; t < sec; t += 1 / 60) d.update(k, 1 / 60, events);
};

test('ドリフト得点: まっすぐ走っても点は入らない', () => {
  const d = new DriftScore();
  run(d, car(30, 0), 3);
  assert.equal(d.total, 0);
  assert.equal(d.running, 0);
});

test('ドリフト得点: 横滑りすると点がたまり、止まって 1 秒で確定する', () => {
  const d = new DriftScore();
  run(d, car(20, 10), 2); // 約 27°・80km/h
  assert.ok(d.active && d.running > 300, `たまった点 ${d.running}`);
  run(d, car(25, 0), 0.5);
  assert.equal(d.total, 0, 'まだ確定しない');
  run(d, car(25, 0), 0.6);
  assert.ok(d.total > 300 && d.running === 0, `確定 ${d.total}`);
  assert.equal(d.last.fail, false);
});

test('ドリフト得点: 続けてドリフトするとコンボの倍率が上がる', () => {
  const d = new DriftScore();
  run(d, car(20, 10), 1);
  run(d, car(25, 0), 1.1); // 1 回目が確定
  const first = d.total;
  run(d, car(20, -10), 1); // すぐ反対向きにドリフト
  assert.equal(d.mult, 2);
  run(d, car(25, 0), 1.1);
  assert.ok(d.total - first > first * 1.5, `2 回目は倍率 2 倍: ${d.total - first} / ${first}`);
});

test('ドリフト得点: ドリフト中に壁に当たると、その回の点は消える', () => {
  const d = new DriftScore();
  run(d, car(20, 10), 1.5);
  assert.ok(d.running > 0);
  d.update(car(20, 10), 1 / 60, [{ type: 'wall', strength: 5 }]);
  assert.equal(d.running, 0);
  assert.equal(d.last.fail, true);
  run(d, car(25, 0), 2);
  assert.equal(d.total, 0);
});

test('ドリフト得点: 芝やダートの上では点が入らない', () => {
  const d = new DriftScore();
  run(d, car(20, 10, 'grass'), 2);
  assert.equal(d.running, 0);
});
