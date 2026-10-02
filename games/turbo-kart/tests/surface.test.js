import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack } from '../src/core/track.js';
import { TRACKS } from '../src/core/tracks.js';
import { roadHeight, surfaceType, surfaceParams, bankSlope, rideState } from '../src/core/surface.js';
import { Race, NPC_NAMES } from '../src/core/race.js';
import { forwardSpeed } from '../src/core/physics.js';

const track = buildTrack(TRACKS[0]);
const wall = track.halfWidth + track.runoff;

test('路面の高さは周回の継ぎ目でも連続', () => {
  for (const lat of [-wall, 0, wall]) {
    const a = roadHeight(track, track.length - 0.01, lat);
    const b = roadHeight(track, 0.01, lat);
    assert.ok(Math.abs(a - b) < 0.02, `lat ${lat}: ${a} vs ${b}`);
  }
  // 1m ごとの変化が急すぎない（段差がない）
  for (let s = 0; s < track.length; s += 0.5) {
    for (const lat of [-6, 0, 6]) {
      const d = Math.abs(roadHeight(track, s + 0.5, lat) - roadHeight(track, s, lat));
      assert.ok(d < 0.2, `s ${s} lat ${lat} 段差 ${d}`);
    }
  }
});

test('バンクは外側が高く、内側の壁際は地面に潜らない', () => {
  const s = 314; // T1 の中央（右カーブ）
  assert.ok(bankSlope(track, s) < -0.4, '右カーブは左（外側）が高い');
  const inner = roadHeight(track, s, wall), outer = roadHeight(track, s, -wall);
  assert.ok(outer - inner > 8, `高低差 ${outer - inner}`);
  assert.ok(inner > -0.5, `内側 ${inner}`);
  assert.equal(bankSlope(track, 120), 0, 'ストレートは平ら');
});

test('路面の種類: ダートは滑りやすく、荒れたターマックも区別される', () => {
  assert.equal(surfaceType(track, 720), 'dirt');
  assert.equal(surfaceType(track, 1000), 'rough');
  assert.equal(surfaceType(track, 150), 'tarmac');
  assert.ok(surfaceParams(track, 720).grip < surfaceParams(track, 150).grip / 1.5);
});

test('姿勢: 上り坂ではピッチが正、バンクではロールが付く', () => {
  const up = rideState(track, { s: 540, lateral: 0 }, track.heading[540], track.heading[540]);
  assert.ok(up.pitch > 0.01, `pitch ${up.pitch}`);
  const bank = rideState(track, { s: 314, lateral: 0 }, track.heading[314], track.heading[314]);
  assert.ok(bank.roll < -0.3, `roll ${bank.roll}`);
});

test('NPC はダートで減速し、バンクでは高速のまま曲がる', () => {
  const race = new Race(track, NPC_NAMES.slice(0, 4).map((name) => ({ name, type: 'npc' })), { laps: 2, seed: 5 });
  const speeds = { dirt: [], bank: [] };
  while (race.state !== 'finished' && race.time < 200) {
    race.step(1 / 60);
    for (const e of race.karts) {
      const v = forwardSpeed(e.kart);
      if (e.kart.surface === 'dirt') speeds.dirt.push(v);
      if (e.loc.s > 260 && e.loc.s < 370) speeds.bank.push(v);
    }
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(avg(speeds.bank) > 24, `bank ${avg(speeds.bank)}`);
  assert.ok(avg(speeds.dirt) < avg(speeds.bank) - 6, `dirt ${avg(speeds.dirt)}`);
  assert.equal(race.state, 'finished');
});
