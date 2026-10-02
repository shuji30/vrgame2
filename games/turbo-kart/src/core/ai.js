// NPC ドライバー: 少し先の目標点へハンドルを切り、先のカーブの曲率から目標速度を決める。
// 前にカートがいれば横へずらして抜きにかかる。各 NPC は腕前と好みのライン取りが少しずつ違う
import { locate, pointAt, maxCurvatureAhead, wrapAngle, wrapS } from './track.js';
import { forwardSpeed, KART } from './physics.js';
import { surfaceParams, bankSlope } from './surface.js';

const MAX_LAT = 13; // 想定する最大横加速度 (m/s²)

export function createDriver(rng, level = 'normal') {
  const base = { easy: 0.8, normal: 0.9, hard: 0.98 }[level] ?? 0.9;
  return {
    skill: base + rng() * 0.06,
    linePref: (rng() - 0.5) * 0.6,
    phase: rng() * Math.PI * 2,
    sway: 0.15 + rng() * 0.25,
    avoid: 0,
    stuck: 0,
    reverseTimer: 0,
  };
}

// others: 他のカート（{ kart, loc } の配列）。pace: ラバーバンド補正 (≈1)
export function driveAI(driver, kart, loc, track, others, pace = 1, dt = 1 / 60) {
  const v = forwardSpeed(kart);
  const sp = Math.abs(v);
  const hw = track.halfWidth;

  // 引っかかったら少し下がって向きを直す
  if (driver.reverseTimer > 0) {
    driver.reverseTimer -= dt;
    const target = pointAt(track, loc.s + 6, 0);
    const err = wrapAngle(Math.atan2(target.z - kart.z, target.x - kart.x) - kart.heading);
    return { steer: -Math.sign(err), throttle: 0, brake: 1, handbrake: 0 };
  }
  if (sp < 1.5) driver.stuck += dt;
  else driver.stuck = Math.max(0, driver.stuck - 2 * dt);
  if (driver.stuck > 2) {
    driver.stuck = 0;
    driver.reverseTimer = 1.2;
  }

  // ライン取り: カーブの内側寄り＋個性＋ゆらぎ
  const kAhead = maxCurvatureAhead(track, loc.s + 10, 30);
  let offset = -Math.sign(kAhead) * Math.min(0.55, Math.abs(kAhead) * 25) * hw;
  offset += driver.linePref * hw + Math.sin(loc.s * 0.01 + driver.phase) * driver.sway * hw;

  // 追い越し: 前方近くのカートを避ける
  let block = 0;
  let follow = Infinity; // 真後ろについたとき、前のカートの速度
  for (const o of others) {
    let ds = wrapS(track, o.loc.s - loc.s);
    if (ds > track.length / 2) ds -= track.length;
    const dl = Math.abs(o.loc.lateral - loc.lateral);
    if (ds > 0 && ds < 14 && dl < 2.4) {
      block = o.loc.lateral > loc.lateral ? -1 : 1;
      if (Math.abs(o.loc.lateral) > hw * 0.6) block = -Math.sign(o.loc.lateral);
    }
    if (ds > 0 && ds < 4 + sp * 0.25 && dl < 2.1) follow = Math.min(follow, forwardSpeed(o.kart));
  }
  driver.avoid += ((block * 2.6) - driver.avoid) * Math.min(1, 3 * dt);
  offset = Math.max(-hw + 1.2, Math.min(hw - 1.2, offset + driver.avoid));

  const look = 5 + sp * 0.55;
  const target = pointAt(track, loc.s + look, offset);
  const err = wrapAngle(Math.atan2(target.z - kart.z, target.x - kart.x) - kart.heading);
  const steer = Math.max(-1, Math.min(1, err * 2.4));

  // 先のカーブに合わせた目標速度
  const reach = 18 + sp * 1.1;
  const kBrake = Math.abs(maxCurvatureAhead(track, loc.s, reach));
  const top = KART.gearTop[KART.gearTop.length - 1];
  // 先の路面（ダートは滑る）とバンク（速く曲がれる）を考慮した横加速度
  let lat = Infinity;
  for (let d = 0; d <= reach; d += 6) {
    const p = surfaceParams(track, loc.s + d);
    const bank = Math.abs(Math.sin(Math.atan(bankSlope(track, loc.s + d))));
    lat = Math.min(lat, MAX_LAT * (p.maxLat / KART.maxLat) + 9.8 * bank * 0.8);
  }
  let vTarget = kBrake > 1e-4 ? Math.sqrt(lat / kBrake) : top;
  vTarget = Math.min(vTarget, top) * driver.skill * pace;
  if (kart.surface === 'grass') vTarget = Math.min(vTarget, 12);
  // 抜けないうちは前のカートに合わせて少し控える
  if (follow < Infinity) vTarget = Math.min(vTarget, follow - 0.3);

  let throttle = v < vTarget ? 1 : 0.15;
  let brake = v > vTarget + 1.5 ? Math.min(1, (v - vTarget) / 4) : 0;
  if (Math.abs(err) > 0.9) { throttle = 0.4; }
  return { steer, throttle, brake, handbrake: 0 };
}
