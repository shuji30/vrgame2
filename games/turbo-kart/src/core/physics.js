// カートの運動（アーケード寄りだが、横滑り・ギア・ドリフト・サイドブレーキを持つ）
// 入力: { steer: -1..1（右が正）, throttle: 0..1, brake: 0..1, handbrake: 0..1, shiftUp, shiftDown }
export const KART = {
  radius: 0.95,
  wheelbase: 1.6,
  // 各ギアの上限速度 (m/s)。6 速で約 106 km/h
  gearTop: [0, 8.5, 13, 17.5, 22, 26, 29.5],
  baseAccel: 7.5,
  brakeDecel: 16,
  handbrakeDecel: 2.5,
  drag: 0.0012,
  rolling: 0.25,
  reverseAccel: 3.5,
  reverseTop: 6,
  maxSteerLow: 0.55,
  maxSteerHigh: 0.15,
  grip: 7,
  driftGrip: 2.2,
  grassGrip: 4,
  shiftTime: 0.15,
  boostAccel: 5,
  // タイヤが出せる横加速度の上限 (m/s²)。旋回の速さをこれで制限する
  maxLat: 15,
  driftLatMul: 1.6,
};

export const MAX_GEAR = KART.gearTop.length - 1;

export function createKart(x, z, heading) {
  return {
    x, z, heading,
    vx: 0, vz: 0,
    yawRate: 0,
    steerAngle: 0,
    gear: 1, // -1 = R
    shiftTimer: 0,
    rpm: 0,
    reversing: false,
    reverseHold: 0,
    driftTime: 0,
    boost: 0,
    surface: 'tarmac', // tarmac | rough | dirt | curb | grass
    // 路面と地形から毎ステップ与えられる値（race.js が設定）
    gripBase: KART.grip,
    maxLatBase: KART.maxLat,
    rollingExtra: 0,
    slopeAccel: 0, // 坂による前後方向の加速度
    bankAccel: 0, // 傾きによる横方向の加速度（右が正）
    latBonus: 0, // バンクで増える横グリップ
    // FFB と演出用
    slip: 0,
    lateralAccel: 0,
  };
}

export function forwardSpeed(k) {
  return k.vx * Math.cos(k.heading) + k.vz * Math.sin(k.heading);
}

function engineFactor(rpm) {
  if (rpm < 0.25) return 0.75 + rpm;
  if (rpm <= 1) return 1;
  return Math.max(0, 1 - (rpm - 1) * 60);
}

export function shift(k, dir) {
  if (dir > 0) {
    if (k.gear === -1) k.gear = 1;
    else if (k.gear < MAX_GEAR) k.gear++;
    else return false;
  } else {
    if (k.gear > 1) k.gear--;
    else if (k.gear === 1 && Math.abs(forwardSpeed(k)) < 1) k.gear = -1;
    else return false;
  }
  k.shiftTimer = KART.shiftTime;
  return true;
}

// manual: true ならパドルでのみ変速。false なら自動変速
export function stepKart(k, input, dt, { manual = false } = {}) {
  const P = KART;
  const c = Math.cos(k.heading), s = Math.sin(k.heading);
  let vF = k.vx * c + k.vz * s;
  let vL = k.vx * -s + k.vz * c;
  const throttle = clamp01(input.throttle);
  const brake = clamp01(input.brake);
  const hb = clamp01(input.handbrake);
  k.handbrakeInput = hb;
  const grass = k.surface === 'grass';

  // 変速
  if (k.shiftTimer > 0) k.shiftTimer -= dt;
  if (manual) {
    if (input.hGear !== undefined) {
      // H シフター: 入っている段がそのままギア（0 = ニュートラル）
      if (k.gear !== input.hGear) {
        k.gear = input.hGear;
        k.shiftTimer = KART.shiftTime;
      }
    } else {
      if (input.shiftUp) shift(k, 1);
      if (input.shiftDown) shift(k, -1);
    }
  } else if (input.shiftUp || input.shiftDown) {
    // AT でもパドルを使えば手動で変速し、しばらく自動変速を止める（ティプトロニック風）
    if (input.shiftUp) shift(k, 1);
    // 回転が上限を超えてしまうシフトダウンは受け付けない（実車の AT と同じ保護）
    if (input.shiftDown && k.gear > 1 && vF / P.gearTop[k.gear - 1] < 0.98) shift(k, -1);
    k.manualHold = 4;
  } else if (k.manualHold > 0) {
    k.manualHold -= dt;
    // 回転が上がり切ったら保持中でもシフトアップ（レブリミットで止まらないように）
    if (k.gear > 0 && k.gear < MAX_GEAR && vF / P.gearTop[k.gear] > 1.0 && k.shiftTimer <= 0) shift(k, 1);
  } else if (k.gear > 0 && k.shiftTimer <= 0) {
    const r = vF / P.gearTop[k.gear];
    if (r > 0.95 && k.gear < MAX_GEAR && throttle > 0.1) shift(k, 1);
    else if (r < 0.5 && k.gear > 1) shift(k, -1);
  }
  const top = k.gear > 0 ? P.gearTop[k.gear] * (k.boost > 0 ? 1.15 : 1) : P.reverseTop;
  k.rpm = k.gear > 0 ? Math.max(0, vF) / P.gearTop[k.gear] : k.gear === 0 ? throttle * 0.9 : Math.abs(vF) / P.reverseTop;

  // 自動変速時は停止中にブレーキを踏み続けると後退
  if (!manual) {
    if (!k.reversing && vF < 0.3 && brake > 0.5 && throttle < 0.1) {
      k.reverseHold += dt;
      if (k.reverseHold > 0.6) k.reversing = true;
    } else if (!k.reversing) {
      k.reverseHold = 0;
    }
    if (k.reversing && (throttle > 0.1 || brake < 0.05)) {
      k.reversing = false;
      k.reverseHold = 0;
    }
  } else {
    k.reversing = false;
  }

  // 前後方向: 駆動 (drive) と、動きを止める向きにだけ働く抵抗 (resist) を分ける
  let drive = 0;
  const engineOn = k.shiftTimer <= 0;
  if (k.reversing) {
    if (vF > -P.reverseTop) drive -= brake * P.reverseAccel;
  } else if (k.gear > 0) {
    if (engineOn) {
      const gearAccel = P.baseAccel * Math.pow(P.gearTop[1] / P.gearTop[k.gear], 0.6);
      drive += throttle * gearAccel * engineFactor(Math.max(0, vF) / top);
      if (k.boost > 0 && vF < top) drive += P.boostAccel;
    }
  } else if (k.gear === -1 && engineOn && vF > -P.reverseTop) {
    drive -= throttle * P.reverseAccel;
  }
  drive += k.slopeAccel || 0;
  let resist = hb * P.handbrakeDecel + P.drag * vF * vF + P.rolling + (k.rollingExtra || 0);
  if (!k.reversing) resist += brake * P.brakeDecel;
  if (grass) resist += 1.0 + 0.012 * vF * vF;
  vF += drive * dt;
  if (Math.abs(vF) <= resist * dt) vF = 0;
  else vF -= Math.sign(vF) * resist * dt;

  // 操舵
  const sp = Math.abs(vF);
  const steerMax = P.maxSteerLow + (P.maxSteerHigh - P.maxSteerLow) * Math.min(1, sp / 28);
  k.steerAngle = Math.max(-1, Math.min(1, input.steer || 0)) * steerMax;
  let yawTarget = (vF * Math.tan(k.steerAngle)) / P.wheelbase;
  const drift = hb > 0.3 && sp > 5;
  if (drift) yawTarget *= 1.35;
  const maxLat = (grass ? Math.min(P.maxLat, 10) : k.maxLatBase ?? P.maxLat) + (k.latBonus || 0);
  const yawLimit = (maxLat * (drift ? P.driftLatMul : 1)) / Math.max(sp, 1);
  yawTarget = Math.max(-yawLimit, Math.min(yawLimit, yawTarget));
  k.yawRate += (yawTarget - k.yawRate) * Math.min(1, dt * 10);
  const dh = k.yawRate * dt;
  k.heading += dh;

  // 向きが変わっても速度ベクトルは慣性で残る → 新しい向きで分解し直す（これが横滑り）
  const wx = vF * c - vL * s, wz = vF * s + vL * c;
  const c2 = Math.cos(k.heading), s2 = Math.sin(k.heading);
  vF = wx * c2 + wz * s2;
  vL = wx * -s2 + wz * c2;
  const baseGrip = grass ? P.grassGrip : k.gripBase ?? P.grip;
  // 坂やバンクの重力の横成分
  vL += (k.bankAccel || 0) * dt;
  let grip = hb > 0.3 ? Math.min(P.driftGrip, baseGrip) : baseGrip;
  // 滑り角が大きくなるほどタイヤが粘り、スピンしにくくする（ドリフトを維持できる）
  const slipNow = Math.atan2(Math.abs(vL), Math.max(1, Math.abs(vF)));
  grip += Math.max(0, slipNow - 0.4) * 25;
  const vLnew = vL * Math.exp(-grip * dt);
  k.lateralAccel = (vL - vLnew) / Math.max(dt, 1e-4);
  // ドリフト中、アクセルを踏んでいれば横滑りの勢いの一部を前進に変える（速度を保ったまま曲がれる）
  if (vF > 0 && throttle > 0.2) vF += Math.abs(vL - vLnew) * (hb > 0.3 ? 0.3 : 0.12) * throttle;
  vL = vLnew;
  k.vx = vF * c2 - vL * s2;
  k.vz = vF * s2 + vL * c2;
  k.slip = Math.atan2(Math.abs(vL), Math.max(1, Math.abs(vF)));

  // ドリフトを溜めて離すとミニターボ
  const drifting = sp > 8 && (hb > 0.3 || k.slip > 0.16);
  let miniTurbo = 0;
  if (drifting) {
    k.driftTime += dt;
  } else {
    if (k.driftTime > 0.8) {
      miniTurbo = Math.min(1.5, k.driftTime * 0.6);
      k.boost = Math.max(k.boost, miniTurbo);
    }
    k.driftTime = 0;
  }
  if (k.boost > 0) k.boost = Math.max(0, k.boost - dt);

  k.x += k.vx * dt;
  k.z += k.vz * dt;
  return { miniTurbo };
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v || 0));
}
