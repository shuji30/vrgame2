// カートの運動（アーケード寄りだが、横滑り・ギア・ドリフト・サイドブレーキを持つ）
// 入力: { steer: -1..1（右が正）, throttle: 0..1, brake: 0..1, handbrake: 0..1, shiftUp, shiftDown }
export const KART = {
  radius: 0.95,
  wheelbase: 1.6,
  // 各ギアの上限速度 (m/s)。6 速で約 148 km/h
  gearTop: [0, 12, 18, 24, 30, 36, 41],
  baseAccel: 11,
  brakeDecel: 20,
  handbrakeDecel: 2.5,
  drag: 0.0009,
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
  // タイヤが出せる横加速度の上限の目安 (m/s²)（AI と表示用。物理は下のタイヤモデルで決まる）
  maxLat: 28.4,
  // ---- 2 輪モデル（前後輪のスリップ角 → タイヤ横力 → ヨーの運動方程式）----
  mass: 170, // カート + ドライバー (kg)
  Iz: 52, // ヨー慣性モーメント (kg·m²)
  dynWheelbase: 1.25, // 運動計算用のホイールベース (m)
  cgFront: 0.6, // 重心から前輪まで (m)
  cgHeight: 0.18, // 重心高 (m)。前後の荷重移動に使う（カートは低い）
  mu: 2.9, // 舗装の摩擦係数（アーケード寄りの高グリップ）
  muGrass: 1.1,
  tireB: 14, // タイヤの立ち上がりの鋭さ（大きいほどピークが小さな滑り角で来る）
  rearGrip: 1.3, // 後輪のグリップを高くしてアンダーステア寄りに（ブレーキ中も後輪が先に限界にならない）
  tireC: 1.45,
  tireE: 0.2,
  steerLock: 0.42, // ハンコンでのフルロック時の前輪の切れ角 (rad)
  steerHigh: 0.1, // キーボード等の補助ありで高速時に絞る切れ角 (rad)
  assistSpeed: 35, // この速度で steerHigh まで絞る (m/s)
  wheelHigh: 0.55, // ハンコンで assistSpeed のときの切れ角の倍率（車速感応）
  downforce: 0, // ダウンフォース係数 (N/(m/s)²)
  aeroFront: 0.45,
  modelRadius: 0.95,
  length: 2,
};

// 車両の諸元。物理はすべて同じ 2 輪モデルで、値だけが違う
export const VEHICLES = {
  kart: { ...KART, id: 'kart', name: 'カート' },
  // GT3: 重くて安定。中程度のダウンフォース。約 270km/h
  gt3: {
    ...KART, id: 'gt3', name: 'GT3',
    radius: 1.35, length: 4.6, wheelbase: 2.7, dynWheelbase: 2.7, cgFront: 1.3, cgHeight: 0.42,
    mass: 1300, Iz: 1900,
    gearTop: [0, 22, 33, 44, 55, 66, 76], baseAccel: 9, brakeDecel: 15, drag: 0.00055, rolling: 0.15,
    reverseAccel: 3, reverseTop: 7, handbrakeDecel: 2,
    mu: 1.9, maxLat: 18.6, tireB: 12, rearGrip: 1.3,
    downforce: 1.3, aeroFront: 0.42,
    steerLock: 0.32, steerHigh: 0.05, assistSpeed: 60, wheelHigh: 0.8, shiftTime: 0.1, boostAccel: 6,
  },
  // フォーミュラ: 軽量・強烈なダウンフォース。約 320km/h
  formula: {
    ...KART, id: 'formula', name: 'フォーミュラ',
    radius: 1.35, length: 5.2, wheelbase: 3.2, dynWheelbase: 3.2, cgFront: 1.8, cgHeight: 0.28,
    mass: 800, Iz: 1100,
    gearTop: [0, 25, 38, 51, 64, 77, 90], baseAccel: 13, brakeDecel: 22, drag: 0.0006, rolling: 0.12,
    reverseAccel: 3, reverseTop: 7, handbrakeDecel: 2,
    mu: 2.15, maxLat: 21, tireB: 13, rearGrip: 1.3,
    downforce: 3.0, aeroFront: 0.44,
    steerLock: 0.3, steerHigh: 0.04, assistSpeed: 70, wheelHigh: 0.8, shiftTime: 0.06, boostAccel: 7,
  },
};
export const VEHICLE_ORDER = ['kart', 'gt3', 'formula'];

// 操舵の上限（前輪の切れ角 rad）。補助ありは高速で大きく絞る。
// ハンコンも高速では少しだけ絞る（車速感応ステアリング。数度の手ぶれで限界を超えないように）
export function steerLimit(speed, assist = true, spec = KART) {
  const lock = spec.steerLock;
  const r = Math.min(1, Math.abs(speed) / spec.assistSpeed);
  return assist ? lock + (spec.steerHigh - lock) * r : lock * (1 - (1 - (spec.wheelHigh ?? 1)) * r);
}

// タイヤの横力（Pacejka のマジックフォーミュラ）。alpha: スリップ角、D: 最大の力
export function tireForce(alpha, D, B = KART.tireB, C = KART.tireC, E = KART.tireE) {
  const x = B * alpha;
  return D * Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
}

export const MAX_GEAR = KART.gearTop.length - 1;
// スピン防止（ハンコン用）が効き始める後輪の滑り角 (rad)
const STAB_SLIP = 0.16;
// 後輪のコーナリングスティフネスの倍率（前輪より硬くして直進安定性を持たせる）
const REAR_B = 1.1;
// 後輪のブレーキ配分（荷重に比例した配分に対する倍率。1 未満で前寄り）
const BRAKE_REAR = 0.5;
// 前後の荷重移動の上限（静止時の軸荷重に対する比）
const LOAD_TRANSFER_MAX = 0.25;
// 摩擦係数の荷重感度（荷重が 10% 増えると摩擦係数が MU_LOAD × 10% 下がる）
const MU_LOAD = 0.2;
const maxGear = (k) => (k.spec || KART).gearTop.length - 1;

// spec: 車両の諸元（VEHICLES のいずれか。省略時はカート）
export function createKart(x, z, heading, spec = KART) {
  return {
    spec,
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
    gripBase: spec.grip,
    maxLatBase: spec.maxLat,
    rollingExtra: 0,
    slopeAccel: 0, // 坂による前後方向の加速度
    bankAccel: 0, // 傾きによる横方向の加速度（右が正）
    latBonus: 0, // （旧モデルの名残。未使用）
    mu: spec.mu, // 路面の摩擦係数（race.js が設定）
    tireB: spec.tireB,
    yawRate: 0,
    frontForce: 0, // 前輪の横力 (N)。FFB のセルフアライニングトルクに使う
    frontSlip: 0,
    rearSlip: 0,
    FzF: 0,
    longAccel: 0,
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
    else if (k.gear < maxGear(k)) k.gear++;
    else return false;
  } else {
    if (k.gear > 1) k.gear--;
    else if (k.gear === 1 && Math.abs(forwardSpeed(k)) < 1) k.gear = -1;
    else return false;
  }
  k.shiftTimer = (k.spec || KART).shiftTime;
  return true;
}

// manual: true ならパドルでのみ変速。false なら自動変速
export function stepKart(k, input, dt, { manual = false } = {}) {
  const P = k.spec || KART;
  const MAXG = P.gearTop.length - 1;
  const c = Math.cos(k.heading), s = Math.sin(k.heading);
  let vF = k.vx * c + k.vz * s;
  let vL = k.vx * -s + k.vz * c;
  const vF0 = vF;
  const throttle = clamp01(input.throttle);
  const brake = clamp01(input.brake);
  const hb = clamp01(input.handbrake);
  k.handbrakeInput = hb;
  const grass = k.surface === 'grass';

  // 変速
  if (k.shiftTimer > 0) k.shiftTimer -= dt;
  if (manual) {
    // H シフター: 位置が変わったときだけその段に入れる（0 = ニュートラル）。
    // シフターに触れていなければパドルでも変速できる
    if (input.hGear !== undefined && input.hGear !== k.lastHGear) {
      // 最初はシフターが入っている段から（N のままなら 1 速のまま）
      const first = k.lastHGear === undefined;
      if ((!first || input.hGear !== 0) && k.gear !== input.hGear) {
        k.gear = input.hGear;
        k.shiftTimer = P.shiftTime;
      }
      k.lastHGear = input.hGear;
    }
    if (input.shiftUp) shift(k, 1);
    if (input.shiftDown) shift(k, -1);
  } else if (input.shiftUp || input.shiftDown) {
    // AT でもパドルを使えば手動で変速し、しばらく自動変速を止める（ティプトロニック風）
    if (input.shiftUp) shift(k, 1);
    // 回転が上限を超えてしまうシフトダウンは受け付けない（実車の AT と同じ保護）
    if (input.shiftDown && k.gear > 1 && vF / P.gearTop[k.gear - 1] < 0.98) shift(k, -1);
    k.manualHold = 4;
  } else if (k.manualHold > 0) {
    k.manualHold -= dt;
    // 回転が上がり切ったら保持中でもシフトアップ（レブリミットで止まらないように）
    if (k.gear > 0 && k.gear < MAXG && vF / P.gearTop[k.gear] > 1.0 && k.shiftTimer <= 0) shift(k, 1);
  } else if (k.gear > 0 && k.shiftTimer <= 0) {
    const r = vF / P.gearTop[k.gear];
    if (r > 0.95 && k.gear < MAXG && throttle > 0.1) shift(k, 1);
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
  // 補助あり（キーボード等）のサイドブレーキはドリフト用。ブレーキとしての減速は弱める
  const hbDecel = input.assist !== false ? P.handbrakeDecel * 0.3 : P.handbrakeDecel;
  let resist = hb * hbDecel + P.drag * vF * vF + P.rolling + (k.rollingExtra || 0);
  if (!k.reversing) resist += brake * P.brakeDecel;
  if (grass) resist += 1.0 + 0.012 * vF * vF;
  vF += drive * dt;
  if (Math.abs(vF) <= resist * dt) vF = 0;
  else vF -= Math.sign(vF) * resist * dt;

  // ---- 操舵と横方向: 2 輪モデル ----
  // キーボード・ゲームパッド・AI は補助あり（高速で切れ角を絞る・スピンしにくくする）。ハンコンは補助なし
  const assist = input.assist !== false;
  const sp0 = Math.abs(vF);
  const steerMax = steerLimit(sp0, assist, P);
  const d = Math.max(-1, Math.min(1, input.steer || 0)) * steerMax;
  k.steerAngle = d;
  const mu = grass ? P.muGrass : k.mu ?? P.mu;
  const B = grass ? 6 : k.tireB ?? P.tireB;
  const m = P.mass, L = P.dynWheelbase, a = P.cgFront, b = L - a;
  // 加減速による前後の荷重移動（ブレーキで前輪、加速で後輪に荷重が乗る）。
  // 実際の速度変化（前のステップ。タイヤの横力による減速も含む）をならして使う
  const aLong = k.longAccel || 0;
  // バンクでは遠心力の分だけタイヤが路面に押しつけられ、グリップが増える（race.js が loadScale を設定）
  // ダウンフォースは速度の 2 乗に比例して前後に分かれてかかる
  const down = (P.downforce || 0) * vF * vF;
  const W = m * 9.8 * (k.loadScale ?? 1);
  // 荷重移動は静止時の ±25% までに抑える（急ブレーキで後輪が抜けすぎないように）
  const FzF0 = (W * b) / L, FzR0 = (W * a) / L;
  const dMax = LOAD_TRANSFER_MAX * Math.min(FzF0, FzR0);
  const dFz = Math.max(-dMax, Math.min(dMax, (m * aLong * P.cgHeight) / L));
  const FzFn = FzF0 + down * (P.aeroFront ?? 0.45), FzRn = FzR0 + down * (1 - (P.aeroFront ?? 0.45));
  const FzF = FzFn - dFz;
  const FzR = FzRn + dFz;
  // タイヤの荷重感度: コーナリングスティフネスは荷重に比例せず、およそ平方根でしか変わらない。
  // （比例させると、ブレーキで後輪の荷重が抜けたときに後輪の横の踏ん張りが極端に減り、少しの舵でスピンする）
  const BF = B * Math.sqrt(FzFn / Math.max(1, FzF));
  const BR = B * REAR_B * Math.sqrt(FzRn / Math.max(1, FzR));
  // 後輪の摩擦円: 駆動力やサイドブレーキで縦に使うほど横に使える力が減る（→ テールが流れる）
  // 補助ありのサイドブレーキはロックを弱め、滑らせながら立て直せるようにする
  const hbLock = assist ? 0.76 : 0.9;
  // 摩擦係数の荷重感度: 荷重が増えたタイヤほど摩擦係数は少し下がる（荷重移動の影響がなだらかになる）
  const muF = mu * (1 - MU_LOAD * (FzF / FzFn - 1));
  const muR = mu * P.rearGrip * (1 - MU_LOAD * (FzR / FzRn - 1));
  // フットブレーキの前後配分（摩擦円）: ブレーキに使った分だけ横に使える力が減る。
  // 実車と同じく前寄りの配分にして、強く踏むと先に前輪が限界になる（まっすぐ止まる・アンダーステア側）
  const Fb = k.reversing || vF <= 0.5 ? 0 : brake * P.brakeDecel * m;
  const FxRb = ((Fb * FzR) / Math.max(1, FzF + FzR)) * BRAKE_REAR, FxFb = Fb - FxRb;
  const capF = Math.sqrt(Math.max(0, (muF * FzF) ** 2 - FxFb ** 2));
  const FxR = Math.min(muR * FzR * 0.95, (hb > 0.3 ? muR * FzR * Math.min(1, hb) * hbLock : Math.min(mu * FzR * 0.9, Math.abs(drive) * m * 0.5)) + FxRb);
  const capR = Math.sqrt(Math.max(0, (muR * FzR) ** 2 - FxR ** 2));
  const n = 4, h = dt / n;
  let FyF = 0, FyR = 0, af = 0, ar = 0, ay = 0;
  for (let i = 0; i < n; i++) {
    if (vF < 2) {
      // 低速・後退は幾何学的に（スリップ角の計算が不安定になるため）
      const rT = (vF * Math.tan(d)) / L;
      k.yawRate += (rT - k.yawRate) * Math.min(1, h * 25);
      vL *= Math.exp(-15 * h);
      FyF = FyR = af = ar = ay = 0;
    } else {
      af = Math.atan2(vL + a * k.yawRate, vF) - d;
      ar = Math.atan2(vL - b * k.yawRate, vF);
      FyF = Math.max(-capF, Math.min(capF, -tireForce(af, muF * FzF, BF, P.tireC, P.tireE)));
      FyR = Math.max(-capR, Math.min(capR, -tireForce(ar, muR * FzR, BR, P.tireC, P.tireE)));
      ay = (FyF * Math.cos(d) + FyR) / m;
      vL += (ay - vF * k.yawRate + (k.bankAccel || 0)) * h;
      k.yawRate += ((a * FyF * Math.cos(d) - b * FyR) / P.Iz) * h;
      vF += (vL * k.yawRate - (FyF * Math.sin(d)) / m) * h;
      // 補助: 後輪が大きく滑ったら、タイヤで出せる範囲の旋回に戻す（スピン防止）
      // サイドブレーキ中は滑り角を約 0.3rad で保つ「ドリフト補助」（テールを流したまま曲がれる）
      if (assist && Math.abs(ar) > (hb > 0.3 ? 0.28 : 0.12)) {
        const rMax = (mu * 9.8) / vF;
        const rT = Math.max(-rMax, Math.min(rMax, (vF * Math.tan(d)) / L));
        k.yawRate += (rT - k.yawRate) * Math.min(1, h * (hb > 0.3 ? 25 : 8));
        // 横滑りの速さも、後輪の滑り角が上限に収まる値へ寄せる
        const lim = hb > 0.3 ? 0.3 : 0.15;
        const vLmax = vF * Math.tan(lim * Math.sign(ar)) + b * k.yawRate;
        if (Math.abs(vL - b * k.yawRate) > Math.abs(vLmax - b * k.yawRate)) vL += (vLmax - vL) * Math.min(1, h * 20);
      } else if (!assist && input.stability && Math.abs(ar) > STAB_SLIP) {
        // ハンコン用のスピン防止: 小さな滑り（カウンターで止められる範囲）には手を出さず、
        // 後輪が大きく流れたときだけヨーを抑えて、回り切らない（180° 回転しない）ようにする
        const over = Math.min(1, (Math.abs(ar) - STAB_SLIP) / 0.15);
        const rMax = (mu * 9.8) / vF;
        const rT = Math.max(-rMax, Math.min(rMax, (vF * Math.tan(d)) / L));
        k.yawRate += (rT - k.yawRate) * Math.min(1, h * 12 * over);
        const lim = hb > 0.3 ? 0.5 : 0.35;
        const vLmax = vF * Math.tan(lim * Math.sign(ar)) + b * k.yawRate;
        if (Math.abs(vL - b * k.yawRate) > Math.abs(vLmax - b * k.yawRate)) vL += (vLmax - vL) * Math.min(1, h * 10);
      }
    }
    k.heading += k.yawRate * h;
  }
  const axNow = (vF - vF0) / Math.max(dt, 1e-4);
  k.longAccel = (k.longAccel || 0) + (axNow - (k.longAccel || 0)) * Math.min(1, dt * 15);
  k.frontForce = FyF;
  k.frontSlip = af;
  k.rearSlip = ar;
  k.FzF = FzF;
  k.mu = mu;
  k.lateralAccel = ay;
  const c2 = Math.cos(k.heading), s2 = Math.sin(k.heading);
  k.vx = vF * c2 - vL * s2;
  k.vz = vF * s2 + vL * c2;
  k.slip = Math.atan2(Math.abs(vL), Math.max(1, Math.abs(vF)));
  const sp = Math.abs(vF);

  // ドリフトを溜めて離すとミニターボ
  const drifting = sp > 8 && (hb > 0.3 || Math.abs(k.rearSlip) > 0.12);
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
