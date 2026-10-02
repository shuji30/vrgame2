// 路面: 区間ごとの種類（ターマック / 荒れたターマック / ダート）と高さ（うねり・片勾配・凸凹）
// 周期はすべて周長の整数分の 1 にして、1 周で途切れないようにする
const TAU = Math.PI * 2;
const RAMP = 8; // 区間の境目をなめらかに切り替える距離 (m)

export const SURFACES = {
  tarmac: { grip: 7, maxLat: 15, rolling: 0, bump: 0.004 },
  rough: { grip: 6.5, maxLat: 14, rolling: 0.1, bump: 0.045 },
  dirt: { grip: 3.2, maxLat: 9, rolling: 0.5, bump: 0.03 },
};

function smooth(x) {
  const k = Math.max(0, Math.min(1, x));
  return k * k * (3 - 2 * k);
}

// s における各種類の重み { rough, dirt }（tarmac は残り）
export function surfaceWeights(track, s) {
  const L = track.length;
  const w = { rough: 0, dirt: 0 };
  for (const sec of track.def.sections || []) {
    let d = ((s - sec.from) % L + L) % L; // 区間の始まりからの距離
    const len = ((sec.to - sec.from) % L + L) % L;
    if (d > len + RAMP && d < L - RAMP) continue;
    if (d > L - RAMP) d -= L;
    const k = smooth((d + RAMP) / RAMP) * smooth((len + RAMP - d) / RAMP);
    w[sec.type] = Math.max(w[sec.type], k);
  }
  return w;
}

export function surfaceType(track, s) {
  const w = surfaceWeights(track, s);
  if (w.dirt > 0.5) return 'dirt';
  if (w.rough > 0.5) return 'rough';
  return 'tarmac';
}

export function surfaceParams(track, s) {
  const w = surfaceWeights(track, s);
  const t = 1 - Math.min(1, w.rough + w.dirt);
  const mix = (k) => SURFACES.tarmac[k] * t + SURFACES.rough[k] * w.rough + SURFACES.dirt[k] * w.dirt;
  return { grip: mix('grip'), maxLat: mix('maxLat'), rolling: mix('rolling'), type: surfaceType(track, s) };
}

// 高さのキーをなめらかにつなぐ（キーでは傾きが 0 になる余弦補間。周回で閉じる）
export function elevationAt(track, s) {
  const keys = track.def.elevation;
  if (!keys || !keys.length) return 0;
  const L = track.length;
  const x = ((s % L) + L) % L;
  let i = keys.length - 1;
  for (let k = 0; k < keys.length; k++) if (keys[k][0] <= x) i = k;
  const a = keys[i];
  const b = keys[(i + 1) % keys.length];
  const span = ((b[0] - a[0]) % L + L) % L || L;
  const u = (((x - a[0]) % L) + L) % L / span;
  return a[1] + (b[1] - a[1]) * (1 - Math.cos(Math.PI * u)) / 2;
}

// 横方向の傾き（右が高いと正）。バンクは外側が高い。区間の両端 50m で徐々に立ち上げる
export function bankSlope(track, s) {
  const L = track.length;
  let slope = 0;
  for (const b of track.def.banks || []) {
    const len = ((b.to - b.from) % L + L) % L;
    const d = ((s - b.from) % L + L) % L;
    if (d > len) continue;
    const k = smooth(Math.min(d, len - d) / 50);
    const t = Math.tan((b.deg * Math.PI) / 180) * k;
    slope += b.turn === 'R' ? -t : t; // 右カーブは左（外側）が高い
  }
  return slope;
}

export function roadHeight(track, s, lateral) {
  const L = track.length;
  const u = s / L;
  const w = surfaceWeights(track, s);
  // バンクはカーブ内側の壁の位置を支点に外側を持ち上げる（内側が地面に潜らない）
  const bank = bankSlope(track, s);
  const pivot = track.halfWidth + track.runoff;
  let h = elevationAt(track, s) + lateral * bank + Math.abs(bank) * pivot;
  // 路面のうねり（アンジュレーション。約 57m と 13m 周期）
  h += 0.15 * Math.sin(TAU * 23 * u) + 0.06 * Math.sin(TAU * 97 * u + 1.3);
  // 舗装の継ぎ目程度の微細な凹凸
  h += SURFACES.tarmac.bump * Math.sin(TAU * 691 * u);
  // 荒れたターマック: 約 3m 周期の波打ちと、左右でずれた凹凸（片輪だけ跳ねる）
  if (w.rough > 0) {
    h += w.rough * (SURFACES.rough.bump * Math.sin(TAU * 461 * u) + 0.025 * Math.sin(lateral * 2.3 + TAU * 233 * u));
  }
  // ダート: 不規則なわだちと小石の凹凸
  if (w.dirt > 0) {
    const a = Math.sin(TAU * 311 * u + Math.sin(TAU * 41 * u) * 2);
    const b = Math.sin(lateral * 3.1 + TAU * 587 * u);
    const rut = Math.cos(lateral * 1.3) * 0.02;
    h += w.dirt * (SURFACES.dirt.bump * a + 0.015 * b - rut);
  }
  return h;
}

// カートの 4 輪の高さから車体の姿勢を求める
// loc: { s, lateral }。kartHeading とコースの向きの差から各輪の (s, lateral) を近似する
export function rideState(track, loc, kartHeading, trackHeading, { half = 0.62, tw = 0.63 } = {}) {
  const rel = kartHeading - trackHeading;
  const c = Math.cos(rel), sn = Math.sin(rel);
  const wheel = (fx, fz) => roadHeight(track, loc.s + fx * c - fz * sn, loc.lateral + fx * sn + fz * c);
  const fl = wheel(half, -tw), fr = wheel(half, tw), rl = wheel(-half, -tw), rr = wheel(-half, tw);
  const front = (fl + fr) / 2, rear = (rl + rr) / 2;
  return {
    y: (fl + fr + rl + rr) / 4,
    pitch: Math.atan2(front - rear, half * 2), // 正 = 前が高い（上り）
    roll: Math.atan2(fr - fl + (rr - rl), tw * 4), // 正 = 右が高い
    fl, fr, rl, rr,
  };
}
