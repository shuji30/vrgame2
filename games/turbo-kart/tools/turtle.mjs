// コース設計ツール: 「直進 / 半径 r で deg 度曲がる」の並びから制御点を作り、ループを自動で閉じる
//   ['S', 長さ, 'adj']      … 'adj' を付けた直線 2 本の長さを調整して始点に戻す
//   ['R' | 'L', 半径, 角度, 'auto'] … 'auto' を付けたカーブの角度を調整して向きを揃える（合計 ±360°）
//   ['mark', 名前]           … その位置の弧長を記録（高低差・バンク・路面区間の指定に使う）
export function trace(cmds, step = 10) {
  let x = 0, z = 0, h = 0, s = 0;
  const pts = [[0, 0]];
  const marks = {};
  for (const c of cmds) {
    if (c[0] === 'mark') { marks[c[1]] = s; continue; }
    if (c[0] === 'S') {
      const n = Math.max(1, Math.round(c[1] / step));
      for (let i = 0; i < n; i++) { x += (Math.cos(h) * c[1]) / n; z += (Math.sin(h) * c[1]) / n; pts.push([x, z]); }
      s += c[1];
    } else {
      const r = c[1], ang = (c[2] * Math.PI) / 180, dir = c[0] === 'R' ? 1 : -1;
      const len = r * ang;
      const n = Math.max(2, Math.round(len / Math.min(step, r * 0.3)));
      for (let i = 0; i < n; i++) {
        const dh = (dir * ang) / n;
        x += Math.cos(h + dh / 2) * (len / n);
        z += Math.sin(h + dh / 2) * (len / n);
        h += dh;
        pts.push([x, z]);
      }
      s += len;
    }
  }
  return { pts, end: [x, z], h, s, marks };
}

// targetTurn: 曲がる角度の合計（普通のコースは ±360、8 の字は 0）
export function close(cmds, targetTurn = null) {
  cmds = cmds.map((c) => [...c]);
  // 1) 向きを揃える
  const turn = cmds.reduce((a, c) => a + (c[0] === 'R' ? c[2] : c[0] === 'L' ? -c[2] : 0), 0);
  const target = targetTurn ?? (turn > 0 ? 360 : -360);
  const auto = cmds.find((c) => c[3] === 'auto');
  if (auto) auto[2] += (auto[0] === 'R' ? 1 : -1) * (target - turn);
  // 2) 位置を揃える: 'adj' の直線 2 本の長さを連立方程式で求める
  const adj = cmds.map((c, i) => (c[0] === 'S' && c[2] === 'adj' ? i : -1)).filter((i) => i >= 0);
  if (adj.length !== 2) throw new Error('adj の直線は 2 本必要');
  const dirOf = (idx) => trace(cmds.slice(0, idx)).h;
  const base = cmds.map((c, i) => (adj.includes(i) ? ['S', 0.0001] : c));
  const e = trace(base).end;
  const d1 = dirOf(adj[0]), d2 = dirOf(adj[1]);
  const a = Math.cos(d1), b = Math.cos(d2), c = Math.sin(d1), d = Math.sin(d2);
  const det = a * d - b * c;
  const l1 = (-e[0] * d + e[1] * b) / det, l2 = (-a * e[1] + c * e[0]) / det;
  cmds[adj[0]][1] = l1;
  cmds[adj[1]][1] = l2;
  return { cmds, lengths: [l1, l2] };
}
