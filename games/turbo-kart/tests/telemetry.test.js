import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack } from '../src/core/track.js';
import { TRACKS } from '../src/core/tracks.js';
import { Race, NPC_NAMES } from '../src/core/race.js';
import { VEHICLE_ORDER, forwardSpeed } from '../src/core/physics.js';
import { Telemetry } from '../src/core/telemetry.js';

const track = buildTrack(TRACKS[0]);

// 数値と配列の中身がすべて有限か
const finite = (o) => Object.values(o).every((v) => (Array.isArray(v) ? v.every(Number.isFinite) : Number.isFinite(v)));

for (const v of VEHICLE_ORDER) {
  test(`テレメトリ ${v}: 1 周のあいだ値が壊れず、範囲に収まる`, () => {
    const race = new Race(track, NPC_NAMES.slice(0, 3).map((name) => ({ name, type: 'npc' })), { laps: 1, seed: 2, vehicle: v });
    const e = race.karts[0];
    const tel = new Telemetry();
    let maxSpeed = 0, maxLat = 0, gears = new Set(), lapSeen = false;
    while (race.state !== 'finished' && race.time < 200) {
      race.step(1 / 60);
      const d = tel.compute(e, race, 1 / 60, race.state === 'racing' && !e.finished);
      assert.ok(finite(d), JSON.stringify(d));
      for (const s of d.susp) assert.ok(s >= 0 && s <= 1);
      assert.ok(d.rpm >= d.rpmIdle && d.rpm <= d.rpmMax * 1.06);
      assert.ok(d.throttle >= 0 && d.throttle <= 255 && d.brake >= 0 && d.brake <= 255);
      assert.ok(d.steer >= -127 && d.steer <= 127);
      assert.ok(Math.abs(d.yaw) <= Math.PI + 1e-9);
      // 前向きの速さは物理と同じ
      assert.ok(Math.abs(d.vel[2] - forwardSpeed(e.kart)) < 1e-9);
      maxSpeed = Math.max(maxSpeed, d.speed);
      maxLat = Math.max(maxLat, Math.abs(d.accel[0]));
      gears.add(d.gear);
      if (d.curLap > 0) lapSeen = true;
    }
    assert.ok(maxSpeed > 15, `最高速 ${maxSpeed}`);
    assert.ok(maxLat > 5, `横 G ${maxLat}`);
    assert.ok(gears.size >= 3, `ギア ${[...gears]}`);
    assert.ok(lapSeen);
  });
}

test('テレメトリ: レースが変わったら走行距離を 0 から数え直す', () => {
  const race = new Race(track, [{ name: 'A', type: 'npc' }], { laps: 1, seed: 1 });
  const tel = new Telemetry();
  for (let i = 0; i < 600; i++) {
    race.step(1 / 60);
    tel.compute(race.karts[0], race, 1 / 60, race.state === 'racing');
  }
  assert.ok(tel.dist > 10);
  tel.reset();
  assert.equal(tel.compute(race.karts[0], race, 1 / 60, false).dist, 0);
});
