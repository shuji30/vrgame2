// 全譜面の統計とオートプレイ結果を表示する: node scripts/analyze.mjs
import { SONGS } from '../src/core/songs.js';
import { generateBeatmap, DIFF_ORDER } from '../src/core/beatmap.js';
import { simulate } from '../src/core/simulate.js';

for (const song of SONGS) {
  for (const dk of DIFF_ORDER) {
    const map = generateBeatmap(song, dk);
    const r = simulate(map);
    const a = r.avg;
    console.log(
      `${song.id.padEnd(14)} ${dk.padEnd(7)} notes=${String(map.notes.length).padStart(3)} ` +
      `nps=${(map.notes.length / map.duration).toFixed(2)} bombs=${map.bombs.length} walls=${map.walls.length} ` +
      `| good=${r.counts.good} bad=${r.counts.bad} miss=${r.counts.miss} bomb=${r.counts.bomb} wall=${r.counts.wall} ` +
      `acc=${(r.session.score.finalAccuracy * 100).toFixed(1)}% avg(swing/angle/acc)=${a.swing.toFixed(1)}/${a.angle.toFixed(1)}/${a.acc.toFixed(1)}`,
    );
  }
}
