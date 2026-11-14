// FFB の力の合成(ゲーム側で行う。ブリッジは受け取った力をそのまま出す)
// 出力は ffb-bridge の形式 { c: -1..1, d: 0..1, s: 0..1, r: 0..1, hz: 0..200 }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const FFB_DEFAULTS = { gain: 0.8, spring: 0.45, recoil: 0.9, impact: 0.9, road: 0.5, turretWeight: 1, click: 0.7, softLock: 0.8 };

export class FfbModel {
  constructor(settings = {}) {
    this.set = { ...FFB_DEFAULTS, ...settings };
    this.pulses = []; // { c, dur, t, shape }
    this.rumbles = []; // { r, hz, dur, t }
  }

  // 主砲の反動:強く踏むほど強く(威力は変えない)
  recoil(strength = 1) {
    const a = clamp(0.45 + strength * 0.55, 0, 1) * this.set.recoil;
    this.pulses.push({ c: a, dur: 0.16, t: 0, shape: 'kick' });
    this.rumbles.push({ r: 0.5 * a, hz: 22, dur: 0.18, t: 0 });
  }

  // 被弾:被弾の向き(-1 左〜1 右)に押し、短く震わせる
  hit(side, strength = 1) {
    const a = clamp(strength, 0.2, 1) * this.set.impact;
    this.pulses.push({ c: clamp(side, -1, 1) * 0.8 * a, dur: 0.25, t: 0, shape: 'decay' });
    this.rumbles.push({ r: 0.7 * a, hz: 35, dur: 0.3, t: 0 });
  }

  bump(strength) {
    this.pulses.push({ c: (Math.random() < 0.5 ? -1 : 1) * 0.5 * strength, dur: 0.12, t: 0, shape: 'decay' });
  }

  // 砲身上下の1段ごとのクリック
  click() {
    this.rumbles.push({ r: 0.6 * this.set.click, hz: 70, dur: 0.035, t: 0 });
  }

  // 毎フレーム。s = { dt, speed01, rough, roadHz, turretWeight, turretLimit, steerBeyond, steerSign, active }
  update(s) {
    const set = this.set;
    let c = 0, r = 0, hz = 0;
    for (const p of this.pulses) {
      p.t += s.dt;
      const k = clamp(1 - p.t / p.dur, 0, 1);
      if (p.shape === 'kick') c += (p.t < p.dur * 0.35 ? 1 : -0.5) * p.c * k;
      else c += p.c * k * k;
    }
    this.pulses = this.pulses.filter((p) => p.t < p.dur);
    for (const q of this.rumbles) {
      q.t += s.dt;
      const k = clamp(1 - q.t / q.dur, 0, 1);
      if (q.r * k > r) { r = q.r * k; hz = q.hz; }
    }
    this.rumbles = this.rumbles.filter((q) => q.t < q.dur);
    // 路面の振動
    const road = clamp(s.rough * s.speed01 * set.road, 0, 0.6);
    if (road > r) { r = road; hz = s.roadHz; }
    // 砲塔の旋回限界:押し返す
    c += -clamp(s.turretLimit || 0, -1, 1) * 0.7;
    const g = set.gain;
    // ソフトロック:効く角度(beyond = 1)を超えて回したら中央へ押し返す。数度超えたところで強く効く。
    // 向きは旋回限界(上の turretLimit)とそろえる。ハンドルを右(steer +)に切ると砲塔は右(turret −)へ回るので、
    // 砲塔の向きに直した -steerSign を turretLimit と同じく引く。ゲインを下げても壁として感じられるよう gain は掛けない
    let lock = 0;
    const beyond = s.steerBeyond || 0;
    if (beyond > 1 && s.steerSign) {
      const turretSide = -Math.sign(s.steerSign);
      lock = -turretSide * clamp((beyond - 1) * 8, 0, 1) * clamp(set.softLock ?? 0, 0, 1);
    }
    return {
      c: clamp(c * g + lock, -1, 1),
      d: clamp((0.05 + (s.turretWeight || 0.2) * set.turretWeight) * g, 0, 1),
      s: clamp(set.spring * g, 0, 1), // センタースプリング
      r: clamp(r * g, 0, 1),
      hz: clamp(hz, 0, 200),
    };
  }
}
