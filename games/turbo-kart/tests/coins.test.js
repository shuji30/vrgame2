import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack } from '../src/core/track.js';
import { TRACKS } from '../src/core/tracks.js';
import { Race, NPC_NAMES } from '../src/core/race.js';
import { coinLayout, COIN_MAX, COIN_BONUS } from '../src/core/coins.js';
import { createKart, stepKart, forwardSpeed } from '../src/core/physics.js';

for (const def of TRACKS) {
  test(`コイン配置 ${def.id}: 道幅の内側にあり、毎回同じ`, () => {
    const track = buildTrack(def);
    const a = coinLayout(track), b = coinLayout(track);
    assert.ok(a.length >= 20, `${a.length} 枚`);
    assert.deepEqual(a, b);
    for (const c of a) assert.ok(Math.abs(c.lateral) < track.halfWidth - 1);
  });
}

test('コイン: パーティーモードの NPC が拾い、上限は 10 枚、取ったコインは復活する', () => {
  const track = buildTrack(TRACKS[0]);
  const race = new Race(track, NPC_NAMES.slice(0, 6).map((name) => ({ name, type: 'npc' })), { laps: 2, seed: 2, coins: true });
  let picked = 0;
  const respawned = new Set();
  while (race.state !== 'finished' && race.time < 200) {
    race.step(1 / 60);
    for (const e of race.karts) {
      picked += e.events.filter((x) => x.type === 'coin').length;
      assert.ok(e.coins <= COIN_MAX);
      assert.ok(Math.abs((e.kart.topBonus || 0) - e.coins * COIN_BONUS) < 1e-9);
    }
    for (const [i, c] of race.coins.entries()) if (c.respawnAt > -Infinity && c.respawnAt < race.time) respawned.add(i);
  }
  assert.ok(picked > 10, `拾った枚数 ${picked}`);
  assert.ok(respawned.size > 0);
});

test('コイン: 本格モード（coins なし）ではコインが無い', () => {
  const race = new Race(buildTrack(TRACKS[0]), [{ name: 'A', type: 'npc' }], {});
  assert.equal(race.coins.length, 0);
});

test('コインの最高速ボーナス: 10 枚で最高速が約 6% 伸び、加速の立ち上がりは同じ', () => {
  const run = (bonus) => {
    const k = createKart(0, 0, 0);
    k.topBonus = bonus;
    let v1 = 0;
    for (let i = 0; i < 60 * 60; i++) {
      stepKart(k, { throttle: 1 }, 1 / 60);
      if (i === 60) v1 = forwardSpeed(k);
    }
    return { v1, top: forwardSpeed(k) };
  };
  const a = run(0), b = run(COIN_MAX * COIN_BONUS);
  assert.ok(Math.abs(a.v1 - b.v1) < 0.3, `1 秒後 ${a.v1} / ${b.v1}`);
  assert.ok(b.top > a.top * 1.03 && b.top < a.top * 1.08, `${a.top} → ${b.top}`);
});
