// node games/turbo-kart/tools/check.mjs [id]  … 閉じ方・最小半径・区間の間隔を表示
import { close, trace } from './turtle.mjs';
import { DESIGNS } from './designs.mjs';
import { buildTrack } from '../src/core/track.js';
for (const [id, d] of Object.entries(DESIGNS)) {
  if (process.argv[2] && process.argv[2] !== id) continue;
  const { cmds, lengths } = close(d.cmds, d.turn);
  const r = trace(cmds);
  const pts = r.pts.slice(0, -1).map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
  const t = buildTrack({ points: pts, halfWidth: d.halfWidth, runoff: 4 });
  let maxK = 0, at = 0;
  for (let i = 0; i < t.N; i++) if (Math.abs(t.curv[i]) > maxK) { maxK = Math.abs(t.curv[i]); at = i; }
  const wall = d.halfWidth + 4;
  const close2 = [];
  for (let i = 0; i < t.N; i += 3) for (let j = i + 120; j < t.N; j += 3) {
    if (t.N - j + i < 120) continue;
    const dd = Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]);
    if (dd < wall * 2 + 4) close2.push([i, j, dd.toFixed(1)]);
  }
  const turn = cmds.reduce((a, c) => a + (c[0] === 'R' ? c[2] : c[0] === 'L' ? -c[2] : 0), 0);
  console.log(`${id}: len=${t.length} adj=${lengths.map((v) => v.toFixed(0))} gap=${Math.hypot(...r.end).toFixed(2)} turn=${turn.toFixed(0)} minR=${(1 / maxK).toFixed(1)}@${at} close=${close2.length ? JSON.stringify(close2.slice(0, 6)) : 'none'}`);
}
