// SimHub 連携(任意):戦車の揺れと砲撃の衝撃を、ffb-bridge 経由でモーションシートやバスシェイカーへ送る
// ブリッジが Forza の Data Out(Dash 形式)の UDP に詰める(vrgame2 の TURBO KART と同じ項目)
// 向きは Forza に合わせる:車から見て X = 右、Y = 上、Z = 前。角速度は X = ピッチ、Y = ヨー、Z = ロール
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const CAR = { car: 905001, idle: 700, max: 3200, power: 600e3, cls: 6, pi: 700, drive: 2, cyl: 12 };

export class TankTelemetry {
  constructor() {
    this.prev = null;
    this.dist = 0;
    this.kick = 0; // 主砲の反動(前後)
    this.jolt = 0; // 被弾(左右)
    this.joltY = 0;
  }

  recoil(strength = 1) { this.kick = -18 * strength; }
  hit(side, strength = 1) { this.jolt = 14 * side * strength; this.joltY = 6 * strength; }

  compute(e, dt, time, on = true) {
    const h = Math.max(dt, 1e-3);
    const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
    const vF = e.vx * s + e.vz * c;
    const vR = -(e.vx * c - e.vz * s); // 右が正(左は +X)
    const p = this.prev;
    const vy = p ? (e.y - p.y) / h : 0;
    const aF = p ? clamp((vF - p.vF) / h, -30, 30) : 0;
    const aR = (e.w || 0) * vF * -1; // 旋回の遠心力
    const aY = p ? clamp((vy - p.vy) / h, -30, 30) : 0;
    const pitchRate = p ? (e.pitch - p.pitch) / h : 0;
    const rollRate = p ? -(e.roll - p.roll) / h : 0;
    this.prev = { y: e.y, vy, vF, pitch: e.pitch, roll: e.roll };
    if (on) this.dist += Math.abs(vF) * dt;
    this.kick *= Math.exp(-dt * 12);
    this.jolt *= Math.exp(-dt * 10);
    this.joltY *= Math.exp(-dt * 10);
    const rough = (e.surf?.rough ?? 0.3) * clamp(Math.abs(vF) / 8, 0, 1) + (e.onDebris ? 0.5 : 0);
    const shake = Math.sin(time * 60) * rough * 0.15;
    const susp = [0.5 + shake + e.pitch, 0.5 - shake + e.pitch, 0.5 + shake - e.pitch, 0.5 - shake - e.pitch].map((v, i) => clamp(v + (i % 2 ? -e.roll : e.roll), 0, 1));
    const speed = Math.hypot(e.vx, e.vz);
    const load = clamp((Math.abs(e.tl) + Math.abs(e.tr)) / (2 * e.spec.speed), 0, 1);
    const rpm = CAR.idle + load * (CAR.max - CAR.idle);
    const wheel = (v) => v / 0.4;
    return {
      on: on ? 1 : 0, rpmMax: CAR.max, rpmIdle: CAR.idle, rpm,
      accel: [aR + this.jolt, aY + this.joltY, aF + this.kick],
      vel: [vR, vy, vF],
      angVel: [pitchRate, -(e.w || 0), rollRate],
      yaw: wrap(Math.PI - e.yaw), pitch: e.pitch, roll: -e.roll,
      susp, slipRatio: [0, 0, 0, 0],
      wheelSpeed: [wheel(e.tl), wheel(e.tr), wheel(e.tl), wheel(e.tr)],
      rumbleStrip: [0, 0, 0, 0], surfaceRumble: [rough, rough, rough, rough],
      slipAngle: [0, 0, 0, 0], combinedSlip: [0, 0, 0, 0], suspMeters: susp.map((v) => (v - 0.5) * 0.2),
      car: CAR.car, carClass: CAR.cls, pi: CAR.pi, drivetrain: CAR.drive, cylinders: CAR.cyl,
      pos: [e.x, e.y, e.z], speed, power: load * CAR.power, torque: load * 4000,
      boost: 0, dist: this.dist, bestLap: 0, lastLap: 0, curLap: 0, raceTime: time, lap: 0, position: 0,
      throttle: Math.round(load * 255), brake: 0, clutch: 0, handbrake: Math.round(clamp(e.wheelie, 0, 1) * 255),
      gear: e.gear === 'R' ? 0 : e.gear, steer: Math.round(clamp((e.tl - e.tr) / (2 * e.spec.speed), -1, 1) * 127),
    };
  }
}
