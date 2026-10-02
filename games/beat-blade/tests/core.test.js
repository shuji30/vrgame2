import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dir, DIR_VEC, dirAngle, segmentAABB, sweepTest, evaluateCut, cutScore, rotate2 } from '../src/core/slice.js';
import { ScoreKeeper, maxScoreFor, rankFor } from '../src/core/scoring.js';
import { notePose, wallBox, headInWall } from '../src/core/judge.js';
import { HIT_Z, NOTE_HALF } from '../src/core/config.js';

test('dirAngle は下向き矢印を各方向へ回す', () => {
  for (let d = 0; d < 8; d++) {
    const r = rotate2({ x: 0, y: -1 }, dirAngle(d));
    assert.ok(Math.abs(r.x - DIR_VEC[d].x) < 1e-9 && Math.abs(r.y - DIR_VEC[d].y) < 1e-9, `dir ${d}`);
  }
});

test('segmentAABB: 貫通・外れ・内部', () => {
  const h = { x: 0.2, y: 0.2, z: 0.2 };
  assert.ok(Math.abs(segmentAABB({ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, h) - 0.4) < 1e-9);
  assert.equal(segmentAABB({ x: -1, y: 0.5, z: 0 }, { x: 1, y: 0.5, z: 0 }, h), -1);
  assert.equal(segmentAABB({ x: 0, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }, h), 0);
  assert.equal(segmentAABB({ x: -1, y: 0, z: 0 }, { x: -0.5, y: 0, z: 0 }, h), -1);
});

test('sweepTest: 振り下ろしでノーツを通過すると当たる', () => {
  const c = { x: 0, y: 1, z: -1 };
  const hit = sweepTest(
    { x: 0, y: 1.4, z: -0.5 }, { x: 0, y: 1.4, z: -1.5 },
    { x: 0, y: 0.6, z: -0.5 }, { x: 0, y: 0.6, z: -1.5 },
    c, c, 0, NOTE_HALF,
  );
  assert.ok(hit);
  assert.ok(hit.local.y > 0.2, '上面から入る');
});

test('sweepTest: 横を素通りすると当たらない', () => {
  const c = { x: 0, y: 1, z: -1 };
  const hit = sweepTest(
    { x: 0.6, y: 1.4, z: -0.5 }, { x: 0.6, y: 1.4, z: -1.5 },
    { x: 0.6, y: 0.6, z: -0.5 }, { x: 0.6, y: 0.6, z: -1.5 },
    c, c, 0, NOTE_HALF,
  );
  assert.equal(hit, null);
});

test('sweepTest: 高速で迫るノーツも相対運動で捕捉する', () => {
  // 刀は静止、ノーツが 1 フレームで 0.6m 進み刀身の範囲を通り抜ける
  const hilt = { x: 0, y: 1, z: -0.5 }, tip = { x: 0, y: 1, z: -0.6 };
  const hit = sweepTest(hilt, tip, hilt, tip, { x: 0, y: 1, z: -1.2 }, { x: 0, y: 1, z: 0.2 }, 0, NOTE_HALF);
  assert.ok(hit);
});

test('evaluateCut: 方向・色・速度', () => {
  const base = { dir: Dir.DOWN, color: 0, saberColor: 0 };
  assert.equal(evaluateCut({ ...base, vel: { x: 0, y: -4 } }).type, 'good');
  assert.equal(evaluateCut({ ...base, vel: { x: 0, y: 4 } }).type, 'bad');
  assert.equal(evaluateCut({ ...base, vel: { x: 0, y: -0.2 } }).type, 'none');
  assert.equal(evaluateCut({ ...base, saberColor: 1, vel: { x: 0, y: -4 } }).reason, 'color');
  assert.equal(evaluateCut({ ...base, saberColor: 1, anyColor: true, vel: { x: 0, y: -4 } }).type, 'good');
  assert.equal(evaluateCut({ ...base, dir: Dir.ANY, vel: { x: 3, y: 3 } }).type, 'good');
  // 斜め 45° は許容
  assert.equal(evaluateCut({ ...base, vel: { x: 3, y: -3 } }).type, 'good');
});

test('cutScore: 理想的な切断で 115 点', () => {
  assert.equal(cutScore({ speed: 6, dirDot: 1, offset: 0 }).total, 115);
  assert.ok(cutScore({ speed: 1.2, dirDot: 0.5, offset: 0.18 }).total < 40);
});

test('ScoreKeeper: 倍率は 2/4/8 ノーツで上がりミスで半減', () => {
  const s = new ScoreKeeper(100);
  s.good(100); assert.equal(s.mult, 1);
  s.good(100); assert.equal(s.mult, 2);
  for (let i = 0; i < 4; i++) s.good(100);
  assert.equal(s.mult, 4);
  for (let i = 0; i < 8; i++) s.good(100);
  assert.equal(s.mult, 8);
  s.miss();
  assert.equal(s.mult, 4);
  assert.equal(s.combo, 0);
  assert.equal(s.maxCombo, 14);
});

test('ScoreKeeper: エネルギー 0 で失敗、NoFail なら継続', () => {
  const s = new ScoreKeeper(10);
  for (let i = 0; i < 4; i++) s.miss();
  assert.equal(s.failed, true);
  const n = new ScoreKeeper(10, { noFail: true });
  for (let i = 0; i < 10; i++) n.miss();
  assert.equal(n.failed, false);
});

test('maxScoreFor とランク', () => {
  assert.equal(maxScoreFor(1), 115);
  assert.equal(maxScoreFor(2), 230);
  assert.equal(maxScoreFor(3), 230 + 230);
  assert.equal(rankFor(0.95), 'SS');
  assert.equal(rankFor(0.7), 'A');
  assert.equal(rankFor(0.01), 'E');
});

test('notePose: ビート時刻に HIT_Z へ到達', () => {
  const n = { time: 5, lane: 0, row: 0, angle: 0 };
  const p = notePose(n, 5, 12);
  assert.equal(p.z, HIT_Z);
  assert.ok(notePose(n, 4, 12).z < HIT_Z);
});

test('壁と頭の衝突', () => {
  const w = { time: 2, duration: 1, x0: -1, x1: -0.1, y0: 0, y1: 2.4 };
  const box = wallBox(w, 2.5, 10);
  assert.ok(headInWall({ x: -0.05, y: 1.6, z: 0 }, box, 0.11));
  assert.ok(!headInWall({ x: 0.3, y: 1.6, z: 0 }, box, 0.11));
});

test('sweepTest: NaN の刀は当たりにしない', () => {
  const c = { x: 0, y: 1, z: -1 };
  const nan = { x: NaN, y: NaN, z: -1 };
  assert.equal(sweepTest(nan, nan, nan, nan, c, c, 0, NOTE_HALF), null);
});

test('segmentDistance: 交差・平行・離れた線分', async () => {
  const { segmentDistance } = await import('../src/core/slice.js');
  const x = segmentDistance({ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 0.1 }, { x: 0, y: 1, z: 0.1 });
  assert.ok(Math.abs(x.dist - 0.1) < 1e-9);
  const p = segmentDistance({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0.5, z: 0 }, { x: 1, y: 0.5, z: 0 });
  assert.ok(Math.abs(p.dist - 0.5) < 1e-9);
  const far = segmentDistance({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 4, y: 0, z: 0 });
  assert.ok(Math.abs(far.dist - 2) < 1e-9);
});

test('ScoreKeeper: エネルギーは半分から始まり、斬るたびに回復して満タンで止まる', () => {
  const s = new ScoreKeeper(100);
  assert.equal(s.energy, 0.5);
  s.good(100);
  assert.ok(s.energy > 0.5);
  for (let i = 0; i < 60; i++) s.good(100);
  assert.equal(s.energy, 1);
});
