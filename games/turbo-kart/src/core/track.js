// コース: 制御点を通る閉じた Catmull-Rom 曲線を 1m 間隔で標本化する（three.js 非依存）
// 座標は地面の (x, z)。向き h は前方 = (cos h, sin h)、右 = (-sin h, cos h)。h が増えると右へ曲がる
const DS = 1;

export function buildTrack(def) {
  const pts = def.points;
  const n = pts.length;
  // 密な折れ線
  const dense = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let k = 0; k < 40; k++) {
      const t = k / 40, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  // 弧長で等間隔に取り直す
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[cum.length - 1];
  const N = Math.floor(total / DS);
  const length = N * DS;
  const x = new Float64Array(N), z = new Float64Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    const s = (i * DS * total) / length;
    while (cum[j + 1] < s) j++;
    const a = dense[j], b = dense[(j + 1) % dense.length];
    const u = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    x[i] = a[0] + (b[0] - a[0]) * u;
    z[i] = a[1] + (b[1] - a[1]) * u;
  }
  const tx = new Float64Array(N), tz = new Float64Array(N), heading = new Float64Array(N), curv = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    const dx = x[b] - x[a], dz = z[b] - z[a];
    const l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l;
    tz[i] = dz / l;
    heading[i] = Math.atan2(tz[i], tx[i]);
  }
  for (let i = 0; i < N; i++) {
    const a = (i - 2 + N) % N, b = (i + 2) % N;
    curv[i] = wrapAngle(heading[b] - heading[a]) / (4 * DS);
  }
  return {
    def, N, ds: DS, length,
    x, z, tx, tz, heading, curv,
    halfWidth: def.halfWidth,
    runoff: def.runoff,
  };
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function wrapS(track, s) {
  const L = track.length;
  return ((s % L) + L) % L;
}

// 位置 (px, pz) に最も近いコース上の点。hint（前回の添字）があれば近傍だけ探す
export function locate(track, px, pz, hint = -1) {
  const { N, x, z, tx, tz } = track;
  let best = -1, bestD = Infinity;
  if (hint < 0) {
    for (let i = 0; i < N; i++) {
      const d = (x[i] - px) ** 2 + (z[i] - pz) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
  } else {
    for (let k = -40; k <= 40; k++) {
      const i = (hint + k + N) % N;
      const d = (x[i] - px) ** 2 + (z[i] - pz) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  const dx = px - x[best], dz = pz - z[best];
  const along = dx * tx[best] + dz * tz[best];
  // 右 = (-tz, tx)
  const lateral = dx * -tz[best] + dz * tx[best];
  return { i: best, s: wrapS(track, best * track.ds + along), lateral };
}

// 弧長 s、横ずれ lateral（右が正）の位置と向き
export function pointAt(track, s, lateral = 0) {
  const { N, ds, x, z, heading } = track;
  const sw = wrapS(track, s);
  const i = Math.floor(sw / ds) % N;
  const k = (i + 1) % N;
  const u = sw / ds - Math.floor(sw / ds);
  const px = x[i] + (x[k] - x[i]) * u;
  const pz = z[i] + (z[k] - z[i]) * u;
  const h = heading[i] + wrapAngle(heading[k] - heading[i]) * u;
  return { x: px - Math.sin(h) * lateral, z: pz + Math.cos(h) * lateral, heading: h };
}

export function curvatureAt(track, s) {
  return track.curv[Math.floor(wrapS(track, s) / track.ds) % track.N];
}

// s から dist 先までで最大の |曲率|（符号付きで返す）
export function maxCurvatureAhead(track, s, dist) {
  let best = 0;
  for (let d = 0; d <= dist; d += 2) {
    const k = curvatureAt(track, s + d);
    if (Math.abs(k) > Math.abs(best)) best = k;
  }
  return best;
}
