// フォースフィードバックの計算（物理状態 → ハンドルにかける力）。three.js 非依存
// 出力: { constant: -1..1（正 = 右へ回す力）, spring: 0..1, damper: 0..1, rumble: 0..1, rumbleHz }
import { KART } from './physics.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const FFB_DEFAULTS = {
  gain: 0.6, // 全体の強さ（ダイレクトドライブは低めから）
  align: 1.0, // セルフアライニングトルク
  damper: 0.25,
  road: 0.5, // 縁石・芝の振動
  impact: 0.8, // 衝突
  softLock: 1.0, // ロック角を超えたときの壁
  invert: false,
};

export class FFBModel {
  constructor() {
    this.impulse = 0; // 衝突の残響（-1..1）
    this.phase = 0;
  }

  // kart: physics の状態、wheel: 現在のハンドル位置（-1..1、ロック角基準）と beyond（ロック角比）
  // ride / prevRide: 直近 2 ステップの 4 輪の高さ（surface.rideState）、rideDt: その間隔
  compute(kart, wheel, events, settings, dt, ride = null, prevRide = null, rideDt = dt) {
    const s = { ...FFB_DEFAULTS, ...settings };
    const c = Math.cos(kart.heading), sn = Math.sin(kart.heading);
    const vF = kart.vx * c + kart.vz * sn;
    const vL = kart.vx * -sn + kart.vz * c;
    const speed = Math.abs(vF);

    // 前輪は進行方向へ戻ろうとする。横滑り中は滑る向きへ引っぱられる（カウンターの手応え）
    const steerMax = KART.maxSteerLow + (KART.maxSteerHigh - KART.maxSteerLow) * Math.min(1, speed / 28);
    const neutral = clamp(Math.atan2(vL, Math.max(2, speed)) / steerMax, -1, 1);
    const stiffness = Math.min(1, speed / 12) * 0.7;
    // 前輪が限界を超えると手応えが軽くなる（アンダーステア）
    const frontLoad = 1 - clamp((Math.abs(kart.lateralAccel) - 9) / 10, 0, 0.6);
    // ダートは手応えが軽い
    const surfaceAlign = kart.surface === 'dirt' ? 0.55 : kart.surface === 'grass' ? 0.6 : 1;
    let force = -(wheel.value - neutral) * stiffness * frontLoad * s.align * surfaceAlign;

    // 路面の凹凸: 左右の前輪の高さの差が変わるとハンドルが取られる（バンプステア）
    let jolt = 0;
    if (ride && prevRide && rideDt > 0) {
      const diff = (ride.fr - ride.fl) - (prevRide.fr - prevRide.fl);
      force += clamp((diff / rideDt) * 0.5, -0.6, 0.6) * s.road;
      // 前輪の上下の速さ → 突き上げ
      const vz = ((ride.fl + ride.fr) - (prevRide.fl + prevRide.fr)) / 2 / rideDt;
      jolt = clamp(Math.abs(vz - (this.prevVz || 0)) * 0.25, 0, 1);
      this.prevVz = vz;
    }

    // 衝突
    for (const e of events) {
      if (e.type === 'wall' && e.strength > 0.5) this.impulse += clamp(e.strength / 8, 0, 1) * -e.side;
      if (e.type === 'bump' && e.strength > 1) this.impulse += clamp(e.strength / 6, 0, 0.8) * (Math.random() < 0.5 ? -1 : 1);
    }
    this.impulse = clamp(this.impulse, -1, 1);
    force += this.impulse * s.impact;
    this.impulse *= Math.exp(-dt * 12);

    // ロック角を超えたら押し戻す
    if (wheel.beyond > 1) force += -Math.sign(wheel.value) * clamp((wheel.beyond - 1) * 6, 0, 1) * s.softLock;

    // 路面の振動
    let rumble = 0, hz = 0;
    if (kart.surface === 'curb' && speed > 3) { rumble = 0.45; hz = 18 + speed; }
    else if (kart.surface === 'grass' && speed > 2) { rumble = 0.3; hz = 9 + speed * 0.5; }
    else if (kart.surface === 'dirt' && speed > 2) { rumble = 0.32; hz = 14 + speed * 0.4; }
    else if (kart.surface === 'rough' && speed > 2) { rumble = 0.22; hz = 8 + speed * 0.3; }
    rumble = Math.max(rumble, jolt);
    if (!hz && rumble > 0) hz = 20;
    rumble *= s.road * Math.min(1, speed / 10);

    let constant = clamp(force, -1, 1) * s.gain;
    if (s.invert) constant = -constant;
    return {
      constant,
      spring: 0,
      damper: clamp(s.damper * (0.3 + Math.min(1, speed / 15) * 0.7), 0, 1) * s.gain,
      rumble: rumble * s.gain,
      rumbleHz: hz,
    };
  }
}
