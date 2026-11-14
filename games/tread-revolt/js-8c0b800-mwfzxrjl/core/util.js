// 共通の小さな数学関数(three.js 非依存)

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

// 角度を -π..π に収める
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

// 現在値を目標へ、最大 step だけ近づける
export function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  return Math.max(target, v - step);
}

export function approachAngle(a, target, step) {
  const d = wrapAngle(target - a);
  if (Math.abs(d) <= step) return target;
  return a + Math.sign(d) * step;
}

// 前方ベクトル(three.js の rotation.y と同じ向き:yaw=0 で +Z、左は +X)
export const fwdX = (yaw) => Math.sin(yaw);
export const fwdZ = (yaw) => Math.cos(yaw);

// 点 (px,pz) から見た (tx,tz) の方位(yaw と同じ定義)
export const yawTo = (px, pz, tx, tz) => Math.atan2(tx - px, tz - pz);

export const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;
export const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));

// 指数的な平滑化(フレームレートに依存しない)
export const damp = (v, target, rate, dt) => lerp(v, target, 1 - Math.exp(-rate * dt));

// 0..1 のなめらかな補間
export const smooth01 = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

export function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
