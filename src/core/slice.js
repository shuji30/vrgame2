// 切断判定の幾何計算（ベクトルは {x, y, z} のプレーンオブジェクト。THREE.Vector3 もそのまま渡せる）
import { MIN_CUT_SPEED, DIR_TOLERANCE } from './config.js';

export const Dir = Object.freeze({
  UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3,
  UP_LEFT: 4, UP_RIGHT: 5, DOWN_LEFT: 6, DOWN_RIGHT: 7,
  ANY: 8,
});

const S = Math.SQRT1_2;
// 切る方向（スイングの進行方向）
export const DIR_VEC = [
  { x: 0, y: 1 }, { x: 0, y: -1 }, { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -S, y: S }, { x: S, y: S }, { x: -S, y: -S }, { x: S, y: -S },
  null,
];

// 下向き矢印を基準としたノーツの z 回転角
export function dirAngle(dir) {
  const v = DIR_VEC[dir];
  if (!v) return 0;
  return Math.atan2(v.y, v.x) + Math.PI / 2;
}

export function mirrorDir(dir) {
  switch (dir) {
    case Dir.LEFT: return Dir.RIGHT;
    case Dir.RIGHT: return Dir.LEFT;
    case Dir.UP_LEFT: return Dir.UP_RIGHT;
    case Dir.UP_RIGHT: return Dir.UP_LEFT;
    case Dir.DOWN_LEFT: return Dir.DOWN_RIGHT;
    case Dir.DOWN_RIGHT: return Dir.DOWN_LEFT;
    default: return dir;
  }
}

export function lerp3(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

// ワールド座標 p を、中心 c・z 回転 angle のノーツのローカル座標へ
export function toLocal(p, c, angle) {
  const dx = p.x - c.x, dy = p.y - c.y;
  const cs = Math.cos(-angle), sn = Math.sin(-angle);
  return { x: dx * cs - dy * sn, y: dx * sn + dy * cs, z: p.z - c.z };
}

export function rotate2(v, angle) {
  const cs = Math.cos(angle), sn = Math.sin(angle);
  return { x: v.x * cs - v.y * sn, y: v.x * sn + v.y * cs };
}

// 原点中心・半径 h の AABB と線分 p0→p1 の交差。最初に入る t∈[0,1] か -1
export function segmentAABB(p0, p1, h) {
  let tmin = 0, tmax = 1;
  for (const a of ['x', 'y', 'z']) {
    const d = p1[a] - p0[a];
    if (Math.abs(d) < 1e-9) {
      if (p0[a] < -h[a] || p0[a] > h[a]) return -1;
    } else {
      let t1 = (-h[a] - p0[a]) / d;
      let t2 = (h[a] - p0[a]) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

// 前フレーム→今フレームで刀身が箱を掃いたか。ノーツ自体の移動も相対座標で考慮する
// 戻り値: { t: 時間方向の割合, f: 刀身上の位置(0=付け根,1=先端), local: 接触点(ノーツローカル) } または null
export function sweepTest(prevHilt, prevTip, hilt, tip, prevC, curC, angle, half, samples = 10) {
  // NaN は比較が常に false になり「当たり」と誤判定されるので弾く
  for (const p of [prevHilt, prevTip, hilt, tip]) {
    if (!Number.isFinite(p.x + p.y + p.z)) return null;
  }
  let best = null;
  for (let i = 0; i <= samples; i++) {
    const f = i / samples;
    const a = toLocal(lerp3(prevHilt, prevTip, f), prevC, angle);
    const b = toLocal(lerp3(hilt, tip, f), curC, angle);
    const t = segmentAABB(a, b, half);
    if (t >= 0 && (!best || t < best.t)) best = { t, f, local: lerp3(a, b, t) };
  }
  if (best) return best;
  // 刀身がすでに箱の中にある（静止して刺さっている）ケース
  const h0 = toLocal(hilt, curC, angle);
  const t0 = toLocal(tip, curC, angle);
  const t = segmentAABB(h0, t0, half);
  if (t >= 0) return { t: 1, f: t, local: lerp3(h0, t0, t) };
  return null;
}

// 切断の良し悪しを判定。type: 'none'（遅すぎて無効） | 'bad' | 'good'
export function evaluateCut({ dir, color, saberColor, anyColor = false, vel }) {
  const speed = Math.hypot(vel.x, vel.y);
  if (speed < MIN_CUT_SPEED) return { type: 'none', speed };
  if (!anyColor && color !== saberColor) return { type: 'bad', reason: 'color', speed };
  const req = DIR_VEC[dir];
  const dirDot = req ? (vel.x * req.x + vel.y * req.y) / speed : 1;
  if (dirDot < DIR_TOLERANCE) return { type: 'bad', reason: 'direction', speed, dirDot };
  return { type: 'good', speed, dirDot };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// 1 ノーツの得点（最大 115 = 振り 70 + 角度 30 + 精度 15）
export function cutScore({ speed, dirDot, offset }) {
  const swing = Math.round(70 * clamp01((speed - MIN_CUT_SPEED) / 3.2));
  const angle = Math.round(30 * clamp01((dirDot - DIR_TOLERANCE) / (0.94 - DIR_TOLERANCE)));
  const acc = Math.round(15 * clamp01(1 - offset / 0.2));
  return { swing, angle, acc, total: swing + angle + acc };
}
