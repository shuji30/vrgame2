import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack } from '../src/core/track.js';
import { TRACKS } from '../src/core/tracks.js';
import { Race, NPC_NAMES } from '../src/core/race.js';
import { VEHICLES, VEHICLE_ORDER, createKart, stepKart, forwardSpeed } from '../src/core/physics.js';

const track = buildTrack(TRACKS[0]);

for (const v of VEHICLE_ORDER) {
  test(`車種 ${v}: NPC 6 台が 2 周を完走し、壁を突き抜けない`, () => {
    const race = new Race(track, NPC_NAMES.slice(0, 6).map((name) => ({ name, type: 'npc' })), { laps: 2, seed: 4, vehicle: v });
    const limit = track.halfWidth + track.runoff;
    let walls = 0;
    while (race.state !== 'finished' && race.time < 300) {
      race.step(1 / 60);
      for (const e of race.karts) {
        assert.ok(Math.abs(e.loc.lateral) <= limit + 0.01);
        walls += e.events.filter((x) => x.type === 'wall').length;
      }
    }
    assert.equal(race.state, 'finished');
    assert.ok(walls < 30, `壁 ${walls}`);
  });
}

test('最高速: フォーミュラ > GT3 > カート', () => {
  const top = (spec) => {
    const k = createKart(0, 0, 0, spec);
    for (let i = 0; i < 60 * 60; i++) stepKart(k, { throttle: 1 }, 1 / 60);
    return forwardSpeed(k);
  };
  const t = Object.fromEntries(VEHICLE_ORDER.map((v) => [v, top(VEHICLES[v])]));
  assert.ok(t.formula > t.gt3 && t.gt3 > t.kart, JSON.stringify(t));
});

test('ダウンフォース: フォーミュラは速いほど大きな横 G で曲がれる', () => {
  const maxAy = (v0) => {
    let best = 0;
    for (let st = 0.05; st <= 0.6; st += 0.05) {
      const k = createKart(0, 0, 0, VEHICLES.formula);
      k.vx = v0;
      k.gear = 6;
      for (let i = 0; i < 300; i++) stepKart(k, { throttle: forwardSpeed(k) < v0 ? 0.8 : 0, steer: st, assist: false }, 1 / 120);
      if (Math.abs(forwardSpeed(k) - v0) < v0 * 0.15) best = Math.max(best, Math.abs(k.lateralAccel));
    }
    return best;
  };
  const slow = maxAy(20), fast = maxAy(55);
  assert.ok(fast > slow * 1.3, `20m/s: ${slow.toFixed(1)}  55m/s: ${fast.toFixed(1)}`);
});

test('ハンコン: 高速の直進中にハンドルを急に切っても、スピン防止ありなら回り切らない', () => {
  for (const id of VEHICLE_ORDER) {
    const P = VEHICLES[id];
    const k = createKart(0, 0, 0, P);
    k.vx = P.gearTop.at(-1) * 0.9;
    k.gear = P.gearTop.length - 1;
    let maxSlip = 0;
    for (let t = 0; t < 4; t += 1 / 120) {
      const steer = t > 0.5 && t < 0.75 ? 0.4 : 0;
      stepKart(k, { steer, throttle: 0.6, assist: false, stability: true }, 1 / 120, { manual: true });
      const vel = Math.atan2(k.vz, k.vx);
      maxSlip = Math.max(maxSlip, Math.abs(Math.atan2(Math.sin(vel - k.heading), Math.cos(vel - k.heading))));
    }
    assert.ok(maxSlip < 0.6, `${id}: 横滑り ${(maxSlip * 57.3).toFixed(0)}°`);
  }
});
