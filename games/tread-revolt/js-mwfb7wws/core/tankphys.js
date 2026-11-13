// 履帯の物理:左右の履帯の速度から車体の移動と回転を計算する(車輪の物理は使わない)
// 戦車・歩行メカ(脚の車輪)・AI の車両で共用する
import { approach, clamp, damp, wrapAngle } from './util.js';
import { GEARS } from './vehicles.js';

// 物理の状態を ent に足す
export function initMotion(ent, spec, x, z, yaw) {
  Object.assign(ent, {
    x, z, y: 0, yaw, v: 0, w: 0, tl: 0, tr: 0, vx: 0, vz: 0,
    gear: 2, wheelie: 0, crouch: 0, quickT: 0, quickDir: 1,
    pitch: 0, roll: 0, trackDmg: [0, 0], bump: 0, surf: null, onDebris: false, air: null,
    spec,
  });
}

// cmd: { left, right, gear, wheelie(0..1 立てる量、0 で下ろす), crouch(bool), quickTurn(bool) }
// env: { terrain, obstacles, debris: [{x,z,r}], comfortTurn (0.5..1) }
export function stepMotion(e, cmd, env, dt) {
  const spec = e.spec;
  const gear = GEARS[e.gear] || GEARS[2];
  const dir = e.gear === 'R' ? -1 : 1;
  let left = clamp(cmd.left || 0, -1, 1);
  let right = clamp(cmd.right || 0, -1, 1);

  // 逆立ち・しゃがみ・空中・急旋回中は走れない
  const wantWheelie = clamp(cmd.wheelie || 0, 0, 1);
  e.wheelie = approach(e.wheelie, wantWheelie, (wantWheelie > e.wheelie ? 1.6 : 2.2) * dt);
  e.crouch = approach(e.crouch, cmd.crouch ? 1 : 0, 3 * dt);
  const locked = e.wheelie > 0.03 || e.crouch > 0.4 || e.air || e.quickT > 0 || e.frozen;
  if (locked) left = right = 0;

  // 履帯の損傷:その側は効かない
  if (e.trackDmg[0] > 0) left = 0;
  if (e.trackDmg[1] > 0) right = 0;

  // 路面と残骸
  const surf = env.terrain.surface(e.x, e.z);
  e.surf = surf;
  let surfK = surf.speed;
  e.onDebris = false;
  if (env.debris) {
    for (const d of env.debris) {
      if ((e.x - d.x) ** 2 + (e.z - d.z) ** 2 < d.r * d.r) { surfK *= 0.5; e.onDebris = true; break; }
    }
  }

  const vmax = spec.speed * gear.sp * surfK;
  const acc = spec.accel * gear.ac;
  const brake = spec.accel * 1.8 * gear.brake;
  const tgtL = left * vmax * dir;
  const tgtR = right * vmax * dir;
  const stepTrack = (cur, tgt, broken) => {
    if (broken) return approach(cur, 0, brake * 1.5 * dt);
    const slowing = Math.abs(tgt) < Math.abs(cur) || Math.sign(tgt) !== Math.sign(cur);
    return approach(cur, tgt, (slowing ? brake : acc) * dt);
  };
  e.tl = stepTrack(e.tl, tgtL, e.trackDmg[0] > 0);
  e.tr = stepTrack(e.tr, tgtR, e.trackDmg[1] > 0);

  // 履帯 → 車体。超信地旋回(左右逆回転)で旋回の上限に届くように係数を決める
  const turnMax = spec.turnMax * gear.turn * (env.comfortTurn ?? 1);
  const k = (turnMax * spec.track) / (2 * spec.speed);
  e.v = (e.tl + e.tr) / 2;
  let w = ((e.tr - e.tl) / spec.track) * k * (2 / Math.max(gear.sp, 0.55)) * 0.5;
  w = clamp(w, -turnMax, turnMax);

  // 急旋回(歩行メカ):片足を軸に半回転
  if (cmd.quickTurn && e.quickT <= 0 && !e.air && spec.body === 'mech') {
    e.quickT = 0.55;
    e.quickDir = cmd.quickDir || 1;
  }
  if (e.quickT > 0) {
    w = (Math.PI / 0.55) * e.quickDir;
    e.quickT -= dt;
  }
  e.w = w;

  const px = e.x, pz = e.z;
  e.yaw = wrapAngle(e.yaw + w * dt);
  if (!e.air) {
    e.x += Math.sin(e.yaw) * e.v * dt;
    e.z += Math.cos(e.yaw) * e.v * dt;
  }

  // 遮蔽物
  e.bump = 0;
  const pos = { x: e.x, z: e.z };
  const hit = env.obstacles.pushOut(pos, spec.radius);
  if (hit) {
    const into = -(Math.sin(e.yaw) * hit.x + Math.cos(e.yaw) * hit.z) * Math.sign(e.v || 1);
    if (into > 0.3) {
      e.bump = Math.min(1, Math.abs(e.v) / 8);
      e.tl *= 0.85;
      e.tr *= 0.85;
    }
    e.x = pos.x;
    e.z = pos.z;
  }
  // 水には入れない(水陸両用は別)
  if (!spec.swim && env.terrain.isWater(e.x, e.z, -spec.radius * 0.35)) {
    e.x = px;
    e.z = pz;
    e.tl *= 0.5;
    e.tr *= 0.5;
    e.bump = Math.max(e.bump, 0.3);
  }
  // 場外
  const t = env.terrain;
  const r = spec.radius;
  if (Math.abs(e.x) > t.hw - r) { e.x = Math.sign(e.x) * (t.hw - r); e.bump = Math.max(e.bump, 0.2); }
  if (Math.abs(e.z) > t.hd - r) { e.z = Math.sign(e.z) * (t.hd - r); e.bump = Math.max(e.bump, 0.2); }

  e.vx = (e.x - px) / Math.max(dt, 1e-4);
  e.vz = (e.z - pz) / Math.max(dt, 1e-4);

  // 高さと傾き(見た目用。カメラには直接伝えない)
  let gy = t.height(e.x, e.z);
  if (spec.swim && t.isWater(e.x, e.z)) gy = Math.max(gy, -1.2);
  if (!e.air) e.y = gy;
  const sl = t.slope(e.x, e.z, e.yaw, spec.radius, spec.radius * 0.7);
  e.pitch = damp(e.pitch, sl.pitch, 8, dt); // 機首上げが正
  e.roll = damp(e.roll, sl.roll, 8, dt);
  return e;
}

// 車両どうしを押し離す
export function separate(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const rr = a.spec.radius + b.spec.radius;
  const d2 = dx * dx + dz * dz;
  if (d2 >= rr * rr || d2 < 1e-8) return false;
  const d = Math.sqrt(d2);
  const push = (rr - d) / 2;
  const nx = dx / d, nz = dz / d;
  const am = a.static ? 0 : b.static ? 1 : 0.5;
  a.x -= nx * push * 2 * am;
  a.z -= nz * push * 2 * am;
  b.x += nx * push * 2 * (1 - am);
  b.z += nz * push * 2 * (1 - am);
  return true;
}
