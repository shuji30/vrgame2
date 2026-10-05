import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack, locate, pointAt } from '../src/core/track.js';
import { TRACKS } from '../src/core/tracks.js';
import { createKart, stepKart, forwardSpeed, KART, MAX_GEAR } from '../src/core/physics.js';
import { Race, NPC_NAMES } from '../src/core/race.js';
import { mapSteer, mapPedal, detectChange } from '../src/core/inputmap.js';
import { FFBModel } from '../src/core/ffbmodel.js';

const track = buildTrack(TRACKS[0]);
const run = (k, input, sec, opts) => { for (let i = 0; i < sec * 60; i++) stepKart(k, input, 1 / 60, opts); };

test('コース: 閉じていて、locate と pointAt が往復する', () => {
  assert.ok(track.length > 1000);
  for (const s of [0, 123.4, 700, track.length - 0.5]) {
    for (const lat of [-5, 0, 3]) {
      const p = pointAt(track, s, lat);
      const l = locate(track, p.x, p.z);
      const ds = Math.abs(((l.s - s + track.length / 2) % track.length + track.length) % track.length - track.length / 2);
      assert.ok(ds < 0.6, `s ${s} → ${l.s}`);
      assert.ok(Math.abs(l.lateral - lat) < 0.3, `lat ${lat} → ${l.lateral}`);
    }
  }
});

test('物理: 加速して自動変速し、最高速付近で頭打ち', () => {
  const k = createKart(0, 0, 0);
  run(k, { throttle: 1 }, 30);
  assert.equal(k.gear, MAX_GEAR);
  const v = forwardSpeed(k);
  assert.ok(v > KART.gearTop[MAX_GEAR] * 0.85 && v < KART.gearTop[MAX_GEAR] * 1.02, `top ${v}`);
  assert.ok(Math.abs(k.z) < 1e-6, 'まっすぐ進む');
});

test('物理: ブレーキで止まり、踏み続けると後退する（AT）', () => {
  const k = createKart(0, 0, 0);
  run(k, { throttle: 1 }, 4);
  run(k, { brake: 1 }, 1.5);
  assert.ok(Math.abs(forwardSpeed(k)) < 0.5, `停止 ${forwardSpeed(k)}`);
  run(k, { brake: 1 }, 2);
  assert.ok(forwardSpeed(k) < -1, '後退');
  run(k, { throttle: 1 }, 3);
  assert.ok(forwardSpeed(k) > 1, 'アクセルで前進に戻る');
});

test('物理: MT はパドルでのみ変速し、R にも入る', () => {
  const k = createKart(0, 0, 0);
  run(k, { throttle: 1 }, 5, { manual: true });
  assert.equal(k.gear, 1, '勝手に変速しない');
  assert.ok(forwardSpeed(k) <= KART.gearTop[1] + 0.3, '1 速のレブリミット');
  stepKart(k, { throttle: 1, shiftUp: true }, 1 / 60, { manual: true });
  assert.equal(k.gear, 2);
  run(k, { brake: 1 }, 3, { manual: true });
  stepKart(k, { shiftDown: true }, 1 / 60, { manual: true });
  stepKart(k, { shiftDown: true }, 1 / 60, { manual: true });
  assert.equal(k.gear, -1);
  run(k, { throttle: 1 }, 2, { manual: true });
  assert.ok(forwardSpeed(k) < -1);
});

test('物理: ハンドルを切ると右へ曲がり、サイドブレーキで横滑り→離すとミニターボ', () => {
  const k = createKart(0, 0, 0);
  run(k, { throttle: 1 }, 4);
  const h0 = k.heading;
  run(k, { throttle: 1, steer: 0.5 }, 0.5);
  assert.ok(k.heading > h0, '右 = heading 増加');
  let turbo = 0;
  for (let i = 0; i < 90; i++) stepKart(k, { throttle: 1, steer: 0.8, handbrake: 1 }, 1 / 60);
  assert.ok(Math.abs(k.rearSlip) > 0.2, `後輪の滑り角 ${k.rearSlip}`);
  for (let i = 0; i < 30; i++) turbo += stepKart(k, { throttle: 1 }, 1 / 60).miniTurbo;
  assert.ok(turbo > 0 && k.boost > 0);
});

test('レース: NPC 11 台が 3 周を完走し、壁を突き抜けない', () => {
  const race = new Race(track, NPC_NAMES.slice(0, 11).map((name) => ({ name, type: 'npc' })), { laps: 3, seed: 3 });
  const limit = track.halfWidth + track.runoff;
  while (race.state !== 'finished' && race.time < 400) {
    race.step(1 / 60);
    for (const e of race.karts) assert.ok(Math.abs(e.loc.lateral) <= limit, `${e.name} lateral ${e.loc.lateral}`);
  }
  assert.equal(race.state, 'finished');
  for (const e of race.karts) {
    assert.ok(e.finished, `${e.name} 完走`);
    assert.equal(e.lapTimes.length, 3);
    // NPC は記録に合わせて速くしてある（Thunder Ring 約 35 秒）。あり得ない速さ・遅さでないことだけ確かめる
    for (const t of e.lapTimes) assert.ok(t > 25 && t < 90, `${e.name} lap ${t}`);
  }
  const pos = race.standings().map((e) => e.position);
  assert.deepEqual(pos, Array.from({ length: 11 }, (_, i) => i + 1));
});

test('レース: プレイヤーがゴールしたら終了し、順位が付く', () => {
  const entries = [{ name: 'YOU', type: 'player' }, ...NPC_NAMES.slice(0, 3).map((name) => ({ name, type: 'npc' }))];
  const race = new Race(track, entries, { laps: 1, seed: 1 });
  // プレイヤーにも AI を使わせて走らせる
  const ghost = new Race(track, [{ name: 'g', type: 'npc' }], { laps: 1, seed: 9 });
  void ghost;
  const { createDriver, driveAI } = awaitAI;
  const d = createDriver(() => 0.5, 'hard');
  while (race.state !== 'finished' && race.time < 200) {
    const p = race.player;
    const input = driveAI(d, p.kart, p.loc, track, race.karts.filter((o) => o !== p));
    race.step(1 / 60, new Map([[0, input]]));
  }
  assert.equal(race.state, 'finished');
  assert.ok(race.player.finished);
  assert.ok(race.player.position >= 1 && race.player.position <= 4);
});

const awaitAI = await import('../src/core/ai.js');

test('入力: ハンドルの正規化（中心・ロック角・反転）', () => {
  const cal = { min: -1, center: 0, max: 1, wheelDeg: 900, lockDeg: 450 };
  assert.equal(mapSteer(0, cal).value, 0);
  assert.ok(Math.abs(mapSteer(0.5, cal).value - 1) < 1e-9, '450/900 でフルロック');
  assert.ok(Math.abs(mapSteer(0.25, cal).value - 0.5) < 1e-9);
  assert.ok(mapSteer(0.8, cal).beyond > 1);
  assert.ok(Math.abs(mapSteer(0.25, { ...cal, invert: true }).value + 0.5) < 1e-9);
  // 中心がずれていても左右それぞれの幅で割る
  const off = { min: -0.8, center: 0.1, max: 1, wheelDeg: 900, lockDeg: 900 };
  assert.ok(Math.abs(mapSteer(-0.8, off).value + 1) < 1e-9);
  assert.ok(Math.abs(mapSteer(1, off).value - 1) < 1e-9);
});

test('入力: ペダルは向きに関係なく 0..1（逆向きの軸も可）', () => {
  assert.equal(mapPedal(-1, { rest: -1, full: 1, deadzone: 0 }), 0);
  assert.equal(mapPedal(1, { rest: -1, full: 1, deadzone: 0 }), 1);
  assert.equal(mapPedal(1, { rest: 1, full: -1, deadzone: 0 }), 0);
  assert.ok(Math.abs(mapPedal(0, { rest: 1, full: -1, deadzone: 0 }) - 0.5) < 1e-9);
  assert.equal(mapPedal(-0.95, { rest: -1, full: 1, deadzone: 0.05 }), 0);
});

test('入力: 学習モードで動いた軸・押したボタンを特定', () => {
  const base = [{ id: 'wheel', index: 0, axes: [0, -1, -1], buttons: [0, 0] }, { id: 'hb', index: 1, axes: [-1], buttons: [0] }];
  const snap1 = [{ id: 'wheel', index: 0, axes: [0.05, -1, -1], buttons: [0, 0] }, { id: 'hb', index: 1, axes: [0.9], buttons: [0] }];
  assert.deepEqual(pick(detectChange(base, snap1)), { kind: 'axis', id: 'hb', control: 0 });
  const snap2 = [{ id: 'wheel', index: 0, axes: [0, -1, -1], buttons: [0, 1] }, { id: 'hb', index: 1, axes: [-1], buttons: [0] }];
  assert.deepEqual(pick(detectChange(base, snap2)), { kind: 'button', id: 'wheel', control: 1 });
  assert.equal(detectChange(base, base), null);
});
const pick = (r) => r && { kind: r.kind, id: r.id, control: r.control };

test('FFB: 速度が出るとセンターへ戻す力、ロック超えで押し戻し、衝突で衝撃', () => {
  const k = createKart(0, 0, 0);
  const m = new FFBModel();
  const still = m.compute(k, { value: 0.5, beyond: 0.5 }, [], {}, 1 / 60);
  assert.ok(Math.abs(still.constant) < 0.15, `停止中はタイヤがこする程度の軽い手応え ${still.constant}`);
  run(k, { throttle: 1 }, 4);
  // ハンドルの速さで抵抗（ダンパー）が出るので、測るたびに新しい計算器を使う
  const straight = new FFBModel().compute(k, { value: 0, beyond: 0 }, [], {}, 1 / 60);
  assert.ok(Math.abs(straight.constant) < 0.05, '直進中はほぼ無負荷');
  // 実際に右へ曲がっている状態（前輪の横力）から、左へ戻す力が出る
  run(k, { throttle: 0.6, steer: 0.08, assist: false }, 1.5);
  const moving = new FFBModel().compute(k, { value: 0.5, beyond: 0.5 }, [], {}, 1 / 60);
  assert.ok(moving.constant < -0.1, `右に切ると左へ戻す ${moving.constant}`);
  const lock = new FFBModel().compute(k, { value: 1, beyond: 1.3 }, [], {}, 1 / 60);
  assert.ok(lock.constant < moving.constant);
  const hit = new FFBModel().compute(k, { value: 0, beyond: 0 }, [{ type: 'wall', strength: 6, side: 1 }], { gain: 0.6 }, 1 / 60);
  assert.ok(hit.constant < -0.2, '右の壁に当たると左へ');
  for (const v of [still, moving, lock, hit]) assert.ok(Math.abs(v.constant) <= 1);
});

test('物理: H シフターは入っている段がギアになり、ニュートラルでは駆動しない', () => {
  const k = createKart(0, 0, 0);
  run(k, { throttle: 1, hGear: 1 }, 0.1, { manual: true });
  run(k, { throttle: 1, hGear: 0 }, 2, { manual: true });
  assert.equal(k.gear, 0, 'シフターを N に戻すとニュートラル');
  assert.ok(Math.abs(forwardSpeed(k)) < 0.5, 'N では加速しない');
  run(k, { throttle: 1, hGear: 1 }, 2, { manual: true });
  assert.equal(k.gear, 1);
  assert.ok(forwardSpeed(k) > 5);
  run(k, { throttle: 1, hGear: 3 }, 1, { manual: true });
  assert.equal(k.gear, 3);
});

test('物理: AT でもパドルで変速でき、しばらく手動のまま保持される', () => {
  const k = createKart(0, 0, 0);
  run(k, { throttle: 1 }, 3);
  const g = k.gear;
  stepKart(k, { throttle: 0.2, shiftDown: true }, 1 / 60);
  assert.equal(k.gear, g, '回転が上限を超えるシフトダウンは拒否');
  while (forwardSpeed(k) > KART.gearTop[g - 1] * 0.8) stepKart(k, { brake: 1 }, 1 / 60);
  stepKart(k, { throttle: 0.2, shiftDown: true }, 1 / 60);
  assert.equal(k.gear, g - 1, 'AT 中のシフトダウン');
  run(k, { throttle: 0.2 }, 1);
  assert.equal(k.gear, g - 1, '保持中は自動でシフトアップしない');
  run(k, { throttle: 1 }, 8);
  assert.ok(k.gear >= g, '保持が切れると AT に戻る');
});

test('物理: H シフターを割り当てていても、触れていなければパドルで変速できる', () => {
  const k = createKart(0, 0, 0);
  run(k, { throttle: 1, hGear: 0 }, 0.5, { manual: true });
  assert.equal(k.gear, 1, 'シフターが N のままでも最初の状態を壊さない');
  stepKart(k, { throttle: 1, hGear: 0, shiftUp: true }, 1 / 60, { manual: true });
  run(k, { throttle: 1, hGear: 0 }, 0.5, { manual: true });
  assert.equal(k.gear, 2, 'パドルの変速が保たれる');
  run(k, { throttle: 1, hGear: 4 }, 0.2, { manual: true });
  assert.equal(k.gear, 4, 'シフターを動かすとその段へ');
});

test('FFB: 「力の向きを反転」はレース・テスト・リセットのどの経路でも出力直前に効く', async () => {
  globalThis.localStorage ||= { getItem: () => null, setItem: () => {} };
  globalThis.WebSocket ||= class { constructor() { throw new Error('no ws in test'); } };
  const { FFBBridge } = await import('../src/ffb.js');
  const b = new FFBBridge();
  const sent = [];
  b.send = (m) => sent.push(m);
  b.settings.invert = false;
  b.update({ constant: 0.4, damper: 0, spring: 0, rumble: 0, rumbleHz: 0 });
  b.settings.invert = true;
  b.lastSend = 0;
  b.update({ constant: 0.4, damper: 0, spring: 0, rumble: 0, rumbleHz: 0 });
  assert.deepEqual(sent.filter((m) => m.t === 'ffb').map((m) => m.c), [0.4, -0.4]);
  clearTimeout(b.retry);
});

test('FFB: 普通のコーナー（横 1G 前後）でもしっかり重い。ハンドルを速く回すと抵抗が出る', () => {
  const k = createKart(0, 0, 0);
  run(k, { throttle: 0.6 }, 3);
  run(k, { throttle: 0.6, steer: 0.06, assist: false }, 1.5);
  const g = Math.abs(k.lateralAccel) / 9.8;
  const f = new FFBModel().compute(k, { value: 0.3, beyond: 0.3 }, [], { gain: 1, align: 1 }, 1 / 60);
  assert.ok(Math.abs(f.constant) > 0.3, `横 ${g.toFixed(2)}G で ${f.constant.toFixed(2)}`);
  const m = new FFBModel();
  m.compute(k, { value: 0, beyond: 0 }, [], { gain: 1 }, 1 / 60);
  const fast = m.compute(k, { value: 0.1, beyond: 0.1 }, [], { gain: 1 }, 1 / 60);
  const slow = new FFBModel().compute(k, { value: 0.1, beyond: 0.1 }, [], { gain: 1 }, 1 / 60);
  assert.ok(fast.constant < slow.constant, '右へ速く回すと左向きの抵抗');
});

test('FFB: GT3・フォーミュラは同じ横 G でもカートより重い（ロック角が大きく軽く感じるぶん）', async () => {
  const { VEHICLES } = await import('../src/core/physics.js');
  const perG = (spec) => {
    const k = createKart(0, 0, 0, spec);
    k.vx = 25;
    for (let i = 0; i < 300; i++) stepKart(k, { throttle: forwardSpeed(k) < 25 ? 0.6 : 0, steer: 0.1, assist: false }, 1 / 60);
    const f = new FFBModel().compute(k, { value: 0.1, beyond: 0 }, [], { gain: 1, align: 1, damper: 0 }, 1 / 60);
    return Math.abs(f.constant) / (Math.abs(k.yawRate * forwardSpeed(k)) / 9.8);
  };
  const kart = perG(VEHICLES.kart);
  assert.ok(perG(VEHICLES.gt3) > kart * 1.2, 'GT3');
  assert.ok(perG(VEHICLES.formula) > kart * 1.05, 'フォーミュラ');
});

test('壁: 急なカーブの内側では壁が手前（袋小路にならない）。壁ぎわで 3 秒動けなければコース中央に戻す', async () => {
  const { wallAt } = await import('../src/core/track.js');
  for (const def of TRACKS) {
    const t = buildTrack(def);
    for (let i = 0; i < t.N; i++) {
      const k = Math.abs(t.curv[i]);
      if (k < 1e-4) continue;
      const side = t.curv[i] > 0 ? 1 : -1; // 内側
      assert.ok(wallAt(t, i * t.ds, side) <= Math.max(t.halfWidth + 2, 0.8 / k) + 1e-9, `${def.id} s=${i * t.ds}`);
    }
  }
  const t = buildTrack(TRACKS[0]);
  const race = new Race(t, [{ name: 'P', type: 'player' }], {});
  race.time = 1;
  race.state = 'racing';
  const e = race.karts[0];
  // 壁ぎわで止まったまま
  const p = pointAt(t, 600, t.halfWidth + t.runoff - 1);
  Object.assign(e.kart, { x: p.x, z: p.z, vx: 0, vz: 0 });
  let rescued = false;
  for (let i = 0; i < 60 * 4; i++) {
    race.step(1 / 60, new Map([[0, { steer: 0, throttle: 0, brake: 0, handbrake: 0 }]]));
    if (e.events.some((x) => x.type === 'rescue')) rescued = true;
  }
  assert.ok(rescued, '自動復帰しない');
  assert.ok(Math.abs(e.loc.lateral) < 1, `中央に戻っていない ${e.loc.lateral}`);
});

test('オンライン対戦のタイミング表: 参加者だけを順位順に、直前のラップとベストラップ、全体の最速ラップ', async () => {
  const { timingRows } = await import('../src/core/timing.js');
  const race = { karts: [
    { name: 'NPC', type: 'npc', position: 1, bestLap: 40.1, lastLap: 40.5, color: 0 },
    { name: 'B', type: 'remote', human: true, position: 3, bestLap: 42, lastLap: 43, color: 0 },
    { name: 'A', type: 'player', human: true, position: 2, bestLap: 41, lastLap: 41, color: 0 },
    { name: 'NPC2', type: 'remote', position: 4, bestLap: null, color: 0 },
  ] };
  const t = timingRows(race);
  assert.deepEqual(t.rows.map((r) => [r.name, r.last, r.best, r.me]), [['A', 41, 41, true], ['B', 43, 42, false]]);
  assert.deepEqual(t.fastest, { time: 40.1, name: 'NPC' });
});
