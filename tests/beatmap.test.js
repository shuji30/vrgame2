// 譜面の妥当性とオートプレイでの完走を、全曲 × 全難易度で検証する
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SONGS } from '../src/core/songs.js';
import { generateBeatmap, DIFF_ORDER, DIFFICULTIES } from '../src/core/beatmap.js';
import { simulate } from '../src/core/simulate.js';
import { Dir } from '../src/core/slice.js';

const DOWNS = [Dir.DOWN, Dir.DOWN_LEFT, Dir.DOWN_RIGHT];
const UPS = [Dir.UP, Dir.UP_LEFT, Dir.UP_RIGHT];

for (const song of SONGS) {
  for (const dk of DIFF_ORDER) {
    test(`譜面の制約: ${song.id} / ${dk}`, () => {
      const map = generateBeatmap(song, dk);
      const diff = DIFFICULTIES[dk];
      assert.ok(map.notes.length > 20, `ノーツ数 ${map.notes.length}`);
      for (let i = 1; i < map.notes.length; i++) assert.ok(map.notes[i].time >= map.notes[i - 1].time);
      for (const c of [0, 1]) {
        const ns = map.notes.filter((n) => n.color === c);
        for (const n of ns) {
          assert.ok(c === 0 ? n.lane <= 1 : n.lane >= 2, '手ごとのレーン');
          if (n.dir !== Dir.ANY) assert.ok((n.swing === 'down' ? DOWNS : UPS).includes(n.dir), 'パリティと矢印が一致');
        }
        for (let i = 1; i < ns.length; i++) {
          const gap = ns[i].beat - ns[i - 1].beat;
          assert.ok(gap >= diff.sameHandGap - 1e-6, `同じ手の間隔 ${gap}`);
          if (gap <= 4) assert.notEqual(ns[i].swing, ns[i - 1].swing, '振りは交互');
        }
      }
      // 壁の中にノーツを置かない
      for (const w of map.walls) {
        for (const n of map.notes) {
          if (n.beat >= w.beat && n.beat <= w.beat + w.beats) assert.ok(!w.lanes.includes(n.lane), '壁とノーツの重なり');
        }
      }
    });

    test(`オートプレイで全ノーツを正しく切れる: ${song.id} / ${dk}`, () => {
      const map = generateBeatmap(song, dk);
      const { counts, problems, session } = simulate(map);
      assert.deepEqual(
        { ...counts, total: map.notes.length },
        { good: map.notes.length, bad: 0, miss: 0, bomb: 0, wall: 0, total: map.notes.length },
        JSON.stringify(problems.slice(0, 3)),
      );
      assert.ok(session.score.accuracy > 0.85, `精度 ${session.score.accuracy}`);
      assert.equal(session.score.failed, false);
    });
  }
}

test('譜面生成は決定的', () => {
  const a = generateBeatmap(SONGS[1], 'expert');
  const b = generateBeatmap(SONGS[1], 'expert');
  assert.deepEqual(a.notes, b.notes);
});

test('上位難易度ほどノーツが多い', () => {
  for (const song of SONGS) {
    const counts = DIFF_ORDER.map((d) => generateBeatmap(song, d).notes.length);
    for (let i = 1; i < counts.length; i++) assert.ok(counts[i] > counts[i - 1], `${song.id}: ${counts}`);
  }
});

test('Hard / Expert には爆弾と壁がある', () => {
  for (const song of SONGS) {
    const ex = generateBeatmap(song, 'expert');
    assert.ok(ex.bombs.length > 0, `${song.id} bombs`);
    assert.ok(ex.walls.length > 0, `${song.id} walls`);
  }
});
