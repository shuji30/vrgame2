// 弾道:自動仰角、曲射、命中精度(停車射撃)
import { clamp, DEG, lerp } from './util.js';

export const G = 9.8;
export const LOB_G = 29.4; // 曲射弾は重く、山なりに落ちる
export const LOB_ANGLE = 55 * DEG;
export const LOB_MIN = 25;
export const LOB_MAX = 170;
export const GUN_MIN = -9 * DEG;
export const GUN_MAX = 22 * DEG;

// 水平距離 dx、高さの差 dy に初速 v で届く仰角(低い弾道)。届かなければ 45°
export function solvePitch(dx, dy, v, g = G) {
  dx = Math.max(dx, 0.1);
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
  if (disc < 0) return Math.PI / 4;
  return Math.atan((v2 - Math.sqrt(disc)) / (g * dx));
}

// 曲射:距離 → 初速(角度は固定)
export function lobSpeed(range) {
  return Math.sqrt((range * LOB_G) / Math.sin(2 * LOB_ANGLE));
}

// 引いた量(0..1)→ 距離
export const lobRange = (amount) => lerp(LOB_MIN, LOB_MAX, clamp(amount, 0, 1));
export const lobAmountFor = (range) => clamp((range - LOB_MIN) / (LOB_MAX - LOB_MIN), 0, 1);

// 着弾までの時間(平地)
export function lobFlightTime(range) {
  const v = lobSpeed(range);
  return (2 * v * Math.sin(LOB_ANGLE)) / LOB_G;
}

// ばらつき(度)。停車中はほぼまっすぐ、走行中・旋回中はばらつく
export function spreadDeg(speed, maxSpeed, yawRate, air = false) {
  const moving = clamp(Math.abs(speed) / Math.max(maxSpeed, 1), 0, 1);
  const turning = clamp(Math.abs(yawRate) / 1.2, 0, 1);
  if (moving < 0.06 && turning < 0.08) return air ? 0.6 : 0.12; // 停車射撃
  return 0.6 + 2.6 * Math.max(moving, turning * 0.8) + (air ? 0.6 : 0);
}

export const isStill = (speed, yawRate) => Math.abs(speed) < 0.6 && Math.abs(yawRate) < 0.1;

// 正規乱数っぽいばらつき
export function gaussPair(rnd) {
  const u = Math.max(rnd(), 1e-6), v = rnd();
  const r = Math.sqrt(-2 * Math.log(u));
  return [r * Math.cos(6.2832 * v), r * Math.sin(6.2832 * v)];
}

// 移動している目標への見越し射撃(水平のみ)
export function leadTarget(sx, sz, tx, tz, tvx, tvz, speed) {
  const d = Math.hypot(tx - sx, tz - sz);
  const t = d / Math.max(speed, 1);
  return { x: tx + tvx * t, z: tz + tvz * t, t };
}
