// SimHub などへ送るテレメトリ（車の動き・エンジン・タイヤ・ラップ）。
// ブリッジ（ffb-bridge/bridge.py）が Forza の Data Out（Dash 形式）の UDP パケットに詰めて送る。
// 値の向きは Forza に合わせる: 車から見て X = 右、Y = 上、Z = 前。角速度は X = ピッチ、Y = ヨー、Z = ロール
import { forwardSpeed } from './physics.js';

// 車種ごとのエンジンの見せ方（回転数・出力）。物理には使わない表示用の値
//   car: SimHub が車を区別するための番号（Forza の CarOrdinal。実在の車と重ならない大きな値）
const CARS = {
  kart: { car: 900001, idle: 2000, max: 15000, power: 22e3, cls: 2, pi: 500, drive: 1, cyl: 1, wheelR: 0.14 },
  gt3: { car: 900002, idle: 1000, max: 9000, power: 410e3, cls: 6, pi: 900, drive: 1, cyl: 6, wheelR: 0.34 },
  drift: { car: 900003, idle: 900, max: 8000, power: 300e3, cls: 5, pi: 800, drive: 1, cyl: 6, wheelR: 0.33 },
  formula: { car: 900004, idle: 4000, max: 13000, power: 600e3, cls: 7, pi: 999, drive: 1, cyl: 6, wheelR: 0.33 },
};
// 路面ごとの振動の強さ（Forza の SurfaceRumble 相当）
const RUMBLE = { tarmac: 0, curb: 0.6, rough: 0.5, dirt: 0.8, grass: 1 };
// サスペンションの見かけのストローク (m)。路面の凹凸と荷重移動から伸び縮みを作る
const STROKE = 0.15;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Telemetry {
  constructor() {
    this.reset();
  }

  // レースが変わったら呼ぶ（前回の値を引き継がない）
  reset() {
    this.prev = null;
    this.dist = 0;
    this.ayV = 0; // 上下の加速度（ならした値）
  }

  // e: レースの参加者（race.karts の 1 つ）、race: Race、dt: 前回からの秒数、on: レース中か
  compute(e, race, dt, on = true) {
    const k = e.kart;
    const P = k.spec || {};
    const car = CARS[P.id] || CARS.kart;
    const r = e.ride || { y: 0, pitch: 0, roll: 0, fl: 0, fr: 0, rl: 0, rr: 0 };
    const c = Math.cos(k.heading), s = Math.sin(k.heading);
    const vF = forwardSpeed(k);
    const vL = k.vx * -s + k.vz * c; // 右が正
    const p = this.prev;
    const h = Math.max(dt, 1e-3);
    // 上下: 高さの変化から速度、速度の変化から加速度（揺れすぎないようにならす）
    const vy = p ? (r.y - p.y) / h : 0;
    const ayNow = p ? clamp((vy - p.vy) / h, -40, 40) : 0;
    this.ayV += (ayNow - this.ayV) * Math.min(1, h * 8);
    // ピッチ・ロールの角速度。ロールは Forza に合わせて右が下がる向きを正にする
    const pitchRate = p ? (r.pitch - p.pitch) / h : 0;
    const rollRate = p ? -(r.roll - p.roll) / h : 0;
    this.prev = { y: r.y, vy, pitch: r.pitch, roll: r.roll };
    if (on) this.dist += Math.abs(vF) * dt;

    // サスペンション: 路面の細かい凹凸（坂・バンクを除いた分）+ 加減速と旋回の荷重移動
    const kart = !P.id || P.id === 'kart';
    const half = kart ? 0.62 : P.wheelbase / 2, tw = kart ? 0.63 : 0.85;
    const base = (sf, ss) => (r.y0 ?? r.y) + sf * half * Math.tan(r.pitch0 ?? r.pitch) + ss * tw * Math.tan(r.roll0 ?? r.roll);
    const lon = (k.longAccel || 0) / 9.8, lat = (k.lateralAccel || 0) / 9.8;
    const susp = [[r.fl, 1, -1], [r.fr, 1, 1], [r.rl, -1, -1], [r.rr, -1, 1]].map(([w, sf, ss]) => {
      const bump = w - base(sf, ss);
      // ブレーキで前が沈み、右へ曲がると左が沈む
      const load = -sf * lon * 0.05 - ss * lat * 0.04;
      return clamp(0.5 + bump / STROKE + load, 0, 1);
    });

    // タイヤ: 滑り角をピーク（ほぼグリップの限界）で 1 になるように正規化する
    const B = k.tireB || P.tireB || 14;
    const peak = 1.86 / B;
    const af = Math.abs(k.frontSlip || 0) / peak, ar = Math.abs(k.rearSlip || 0) / peak;
    // 後輪の空転（アクセルで流しているとき）とロック（サイドブレーキ）を縦の滑りとして見せる
    const inp = e.input || {};
    const spin = (inp.throttle || 0) > 0.2 && ar > 1 ? Math.min(2, ar - 1 + 0.5) : 0;
    const lock = (k.handbrakeInput || 0) > 0.3 && Math.abs(vF) > 2 ? -1 : 0;
    const srR = spin || lock;
    const wheelW = vF / car.wheelR;
    const wheelRear = lock ? 0 : wheelW * (1 + Math.max(0, srR) * 0.3);

    const rumble = RUMBLE[k.surface] ?? 0;
    const curb = k.surface === 'curb' ? 1 : 0;
    const rpmN = clamp(k.rpm || 0, 0, 1.05);
    const rpm = car.idle + rpmN * (car.max - car.idle);
    const throttle = clamp(inp.throttle || 0, 0, 1);
    const power = throttle * car.power * Math.min(1, rpmN + 0.2);
    const torque = power / Math.max(1, (rpm * Math.PI * 2) / 60);
    const lapTime = e.started && !e.finished ? Math.max(0, race.time - (e.lapStart || 0)) : 0;
    const byte = (v) => Math.round(clamp(v || 0, 0, 1) * 255);

    return {
      on: on ? 1 : 0,
      rpmMax: car.max, rpmIdle: car.idle, rpm,
      accel: [k.lateralAccel || 0, this.ayV, k.longAccel || 0],
      vel: [vL, vy, vF],
      angVel: [pitchRate, k.yawRate || 0, rollRate],
      // 向き: ヨーは北（コースの -Z）を 0、右回りを正。ピッチは前が上がる向き、ロールは右が下がる向きが正
      yaw: wrap(k.heading + Math.PI / 2), pitch: r.pitch, roll: -r.roll,
      susp,
      slipRatio: [0, 0, srR, srR],
      wheelSpeed: [wheelW, wheelW, wheelRear, wheelRear],
      rumbleStrip: [curb, curb, curb, curb],
      surfaceRumble: [rumble, rumble, rumble, rumble],
      slipAngle: [af, af, ar, ar],
      combinedSlip: [af, af, Math.hypot(ar, srR), Math.hypot(ar, srR)],
      suspMeters: susp.map((v) => (v - 0.5) * STROKE),
      car: car.car, carClass: car.cls, pi: car.pi, drivetrain: car.drive, cylinders: car.cyl,
      pos: [k.x, r.y, k.z],
      speed: Math.hypot(k.vx, k.vz),
      power, torque,
      boost: k.boost > 0 ? 15 : 0,
      dist: this.dist,
      bestLap: e.bestLap || 0, lastLap: e.lastLap || 0, curLap: lapTime,
      raceTime: Math.max(0, race.time || 0),
      lap: Math.max(0, (e.lap || 1) - 1),
      position: e.position || 0,
      throttle: byte(throttle), brake: byte(inp.brake), clutch: k.shiftTimer > 0 ? 255 : 0, handbrake: byte(inp.handbrake),
      // ギア: Forza は 0 = R、1 からが前進。ニュートラル（H シフターの N）は 0 にする
      gear: k.gear > 0 ? k.gear : 0,
      steer: Math.round(clamp(inp.steer || 0, -1, 1) * 127),
    };
  }
}
