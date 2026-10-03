import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack, locate, pointAt } from '../src/core/track.js';
import { TRACKS } from '../src/core/tracks.js';
import { roadHeight } from '../src/core/surface.js';
import { Race, NPC_NAMES } from '../src/core/race.js';

for (const def of TRACKS) {
  test(`コース ${def.id}: 閉じていて、急すぎる段差やカーブがない`, () => {
    const t = buildTrack(def);
    assert.ok(t.length > 1000, `全長 ${t.length}`);
    let maxK = 0;
    for (let i = 0; i < t.N; i++) maxK = Math.max(maxK, Math.abs(t.curv[i]));
    assert.ok(1 / maxK > 7, `最小半径 ${(1 / maxK).toFixed(1)}m`);
    for (let s = 0; s < t.length; s += 1) {
      const d = Math.abs(roadHeight(t, s + 1, 0) - roadHeight(t, s, 0));
      assert.ok(d < 0.25, `s=${s} の勾配 ${d}`);
    }
    // スタートラインの前後はまっすぐ（グリッドがカーブにかからない）
    for (let s = (def.startS || 0) - 50; s < (def.startS || 0) + 10; s += 5) {
      const k = Math.abs(t.curv[Math.floor(((s % t.length) + t.length) % t.length)]);
      assert.ok(k < 1 / 150, `グリッド付近 s=${s} が曲がっている`);
    }
  });

  test(`コース ${def.id}: NPC 4 台が 1 周を完走する`, () => {
    const t = buildTrack(def);
    const race = new Race(t, NPC_NAMES.slice(0, 4).map((name) => ({ name, type: 'npc' })), { laps: 1, seed: 2 });
    let walls = 0;
    while (race.state !== 'finished' && race.time < 200) {
      race.step(1 / 60);
      for (const e of race.karts) walls += e.events.filter((x) => x.type === 'wall').length;
    }
    assert.equal(race.state, 'finished');
    assert.ok(walls < 10, `壁 ${walls}`);
  });
}

test('立体交差: 上の道と下の道は十分に離れ、車同士は衝突しない', () => {
  const t = buildTrack(TRACKS.find((d) => d.id === 'eight-hills'));
  let best = { d: Infinity };
  for (let i = 0; i < t.N; i += 2) for (let j = i + 150; j < t.N; j += 2) {
    if (t.N - j + i < 150) continue;
    const d = Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]);
    if (d < best.d) best = { d, i, j };
  }
  assert.ok(best.d < 3, '交差点がある');
  assert.ok(Math.abs(roadHeight(t, best.i, 0) - roadHeight(t, best.j, 0)) > 6.5);
  // 交差点の真上と真下に 1 台ずつ置いても押し合わない
  const race = new Race(t, [{ name: 'A', type: 'npc' }, { name: 'B', type: 'npc' }], { laps: 1 });
  const [a, b] = race.karts;
  for (const [e, i] of [[a, best.i], [b, best.j]]) {
    const p = pointAt(t, i, 0);
    e.kart.x = p.x; e.kart.z = p.z; e.kart.heading = p.heading;
    e.loc = locate(t, p.x, p.z, i);
    race.applyTerrain(e);
  }
  const before = [a.kart.x, b.kart.x];
  race.collideKarts();
  assert.deepEqual([a.kart.x, b.kart.x], before);
});
