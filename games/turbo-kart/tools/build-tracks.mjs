// 設計（designs.mjs）からゲーム用のコース定義を生成する: node games/turbo-kart/tools/build-tracks.mjs
import { writeFileSync } from 'node:fs';
import { close, trace } from './turtle.mjs';
import { DESIGNS } from './designs.mjs';
import { buildTrack } from '../src/core/track.js';
import { roadHeight } from '../src/core/surface.js';

const out = [];
for (const [id, d] of Object.entries(DESIGNS)) {
  const { cmds } = close(d.cmds, d.turn);
  const r = trace(cmds);
  const points = r.pts.slice(0, -1).map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
  // 弧長は Catmull-Rom 化で少し変わるので、実際のコースの長さに合わせて目印を伸縮する
  const probe = buildTrack({ points, halfWidth: d.halfWidth, runoff: 4 });
  const k = probe.length / r.s;
  const at = (name) => {
    if (typeof name === 'number') return name;
    if (!(name in r.marks)) throw new Error(`${id}: 目印 ${name} がない`);
    return Math.round(r.marks[name] * k);
  };
  const def = {
    id, name: d.name, sub: d.sub,
    startS: 60,
    halfWidth: d.halfWidth,
    runoff: 4,
    points,
    elevation: d.elevation.map(([m, h]) => [at(m), h]).sort((a, b) => a[0] - b[0]),
    banks: d.banks.map(([a, b, deg, turn]) => ({ from: at(a), to: at(b), deg, turn })),
    sections: d.sections.map(([a, b, type]) => ({ from: at(a), to: at(b), type })),
    boostPads: [],
    ...(d.forest ? { forest: true } : {}),
  };
  // 立体交差の検査: 平面上で重なる区間どうしの高さの差
  const t = buildTrack(def);
  let minDz = Infinity, overlaps = 0;
  for (let i = 0; i < t.N; i += 2) for (let j = i + 150; j < t.N; j += 2) {
    if (t.N - j + i < 150) continue;
    if (Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]) < d.halfWidth * 2 + 1) {
      overlaps++;
      minDz = Math.min(minDz, Math.abs(roadHeight(t, i, 0) - roadHeight(t, j, 0)));
    }
  }
  console.log(`${id}: ${t.length}m overlaps=${overlaps} ${overlaps ? `高さの差(最小)=${minDz.toFixed(1)}m` : ''}`);
  if (overlaps && minDz < 6.5) throw new Error(`${id}: 立体交差の高さが足りない`);
  out.push(def);
}
const js = `// tools/build-tracks.mjs が designs.mjs から生成（手で編集しない）
export const GENERATED_TRACKS = ${JSON.stringify(out)};
`;
writeFileSync(new URL('../src/core/tracks-gen.js', import.meta.url), js);
console.log('wrote src/core/tracks-gen.js');
