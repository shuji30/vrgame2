import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack } from '../src/core/track.js';
import { TRACKS } from '../src/core/tracks.js';
import { Race, NPC_NAMES } from '../src/core/race.js';
import { VEHICLES } from '../src/core/physics.js';
import { createDriver, driveAI } from '../src/core/ai.js';
import { mulberry32 } from '../src/core/rng.js';
import { createArcadeTimer, stepArcadeTimer, idealSpeeds, CHECKPOINTS_PER_LAP, TIMER_SLACK } from '../src/core/arcadetimer.js';

const track = buildTrack(TRACKS[0]);

test('残り時間: チェックポイントを通ると延長、ゴールでは延長しない', () => {
  const t = createArcadeTimer(track, VEHICLES.kart, { laps: 2, progress0: -20 });
  const start = t.left;
  assert.ok(start > 5 && start < 60, `最初の持ち時間 ${start}`);
  // 1 つ目のチェックポイントの手前
  assert.deepEqual(stepArcadeTimer(t, t.per - 1, 1), []);
  assert.ok(Math.abs(t.left - (start - 1)) < 1e-9);
  // 通過
  const ev = stepArcadeTimer(t, t.per + 1, 0.5);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, 'checkpoint');
  assert.ok(ev[0].extend > 3);
  assert.equal(t.next, 2);
  // 最後（= ゴール）のチェックポイントは延長しない
  const before = t.left;
  stepArcadeTimer(t, 2 * CHECKPOINTS_PER_LAP * t.per + 5, 0);
  assert.equal(t.next, t.last);
  assert.ok(t.left > before); // 途中のチェックポイントの分だけは足される
  const n = t.next;
  stepArcadeTimer(t, 99 * t.per, 0);
  assert.equal(t.next, n);
});

test('残り時間: 0 になるとタイムオーバー。カウントダウン中とゴール後は減らない', () => {
  const t = createArcadeTimer(track, VEHICLES.kart, { laps: 3 });
  const left = t.left;
  stepArcadeTimer(t, 0, 5, { racing: false });
  stepArcadeTimer(t, 0, 5, { finished: true });
  assert.equal(t.left, left);
  const ev = stepArcadeTimer(t, 0, left + 1);
  assert.deepEqual(ev.map((e) => e.type), ['timeOver']);
  assert.equal(t.left, 0);
  assert.ok(t.over);
  assert.deepEqual(stepArcadeTimer(t, 1e6, 1), []);
});

test('目安の速さ: 最高速を超えず、カーブでは遅い。強さが上がるほど持ち時間が短い', () => {
  const { v } = idealSpeeds(track, VEHICLES.gt3);
  const top = VEHICLES.gt3.gearTop.at(-1);
  assert.ok(Math.max(...v) <= top + 1e-9);
  assert.ok(Math.min(...v) < top * 0.6);
  const e = createArcadeTimer(track, VEHICLES.gt3, { level: 'easy' });
  const h = createArcadeTimer(track, VEHICLES.gt3, { level: 'hard' });
  assert.ok(TIMER_SLACK.easy > TIMER_SLACK.normal && TIMER_SLACK.normal > TIMER_SLACK.hard);
  assert.ok(e.extends[0] > h.extends[0]);
});

// レース全体: AI に運転させたプレイヤーが時間内に完走できる（全コース・カート / GT3）
for (const def of TRACKS) {
  for (const vehicle of ['kart', 'gt3']) {
    test(`アーケード ${def.id} ${vehicle}: ふつうの腕で時間内に完走できる`, () => {
      const tr = buildTrack(def);
      const entries = [...Array.from({ length: 10 }, (_, i) => ({ name: NPC_NAMES[i], type: 'npc' })), { name: 'P', type: 'player' }];
      const race = new Race(tr, entries, { laps: 2, level: 'normal', seed: 3, vehicle, timer: true });
      const p = race.player;
      const d = createDriver(mulberry32(5), 'normal');
      const dt = 1 / 60;
      let checkpoints = 0;
      while (race.state !== 'finished' && race.time < 400) {
        race.step(dt, new Map([[p.index, driveAI(d, p.kart, p.loc, tr, race.karts.filter((o) => o !== p), 1, dt)]]));
        checkpoints += p.events.filter((e) => e.type === 'checkpoint').length;
      }
      assert.ok(p.finished, `タイムオーバー（${p.lap} 周目）`);
      assert.ok(!p.timeOver);
      assert.equal(checkpoints, 2 * CHECKPOINTS_PER_LAP - 1);
    });
  }
}

test('アーケード: タイムオーバーでレースが終わり、車は止まる', () => {
  const entries = [{ name: NPC_NAMES[0], type: 'npc' }, { name: 'P', type: 'player' }];
  const race = new Race(track, entries, { laps: 3, seed: 1, timer: true });
  const p = race.player;
  const dt = 1 / 60;
  let over = false;
  while (race.time < 120 && !over) {
    race.step(dt, new Map([[p.index, { steer: 0, throttle: 0, brake: 0, handbrake: 0 }]]));
    over = p.events.some((e) => e.type === 'timeOver');
  }
  assert.ok(over);
  assert.ok(p.timeOver && !p.finished);
  assert.equal(race.state, 'finished');
  assert.equal(p.timeLeft, 0);
  // タイマーの無いレースには残り時間が無い
  const plain = new Race(track, entries, { laps: 3, seed: 1 });
  assert.equal(plain.timer, null);
  assert.equal(plain.player.timeLeft, undefined);
});
