// フォースフィードバックの計算（物理状態 → ハンドルにかける力）。three.js 非依存
// 出力: { constant: -1..1（正 = 右へ回す力）, spring: 0..1, damper: 0..1, rumble: 0..1, rumbleHz }
import { KART } from './physics.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const softLimit = (v) => {
  const a = Math.abs(v);
  return a <= 0.8 ? v : Math.sign(v) * (0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
};
// コーナーでの重さの上乗せ（手ごたえが 0.5 のとき 1 + 0.5 × これ 倍）
const CORNER_LOAD = 0.7;

export const FFB_DEFAULTS = {
  gain: 0.5, // 全体の強さ
  align: 0.6, // セルフアライニングトルク（強すぎると直線で左右に振られる）
  damper: 0.35,
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

    // セルフアライニングトルク: 前輪の横力 × トレール。コーナーで横 G に比例して重くなり、
    // 前輪の滑りが限界を超えるとニューマチックトレールが縮んで軽くなる（アンダーステアの手応え）。
    // 後輪が流れると前輪は進行方向を向こうとし、ハンドルがカウンター側へ切れる
    let force;
    if (speed > 2 && kart.FzF > 0) {
      const spec = kart.spec || KART;
      const peak = Math.tan(Math.PI / (2 * spec.tireC)) / (kart.tireB || spec.tireB); // 横力が最大になる滑り角
      // 本格モードは限界の少し手前からハンドルが軽くなり始める（グリップが抜ける前に知らせる）
      const fade = spec.real ? 1.25 : 1.7;
      const pneumatic = 0.045 * Math.max(0, 1 - Math.abs(kart.frontSlip) / (peak * fade));
      const mech = 0.012; // キャスターによる機械的トレール
      // 手ごたえは実際の横 G に比例させる（基準は実車並みの摩擦係数 1.8 の限界）。
      // 摩擦係数で割ると、グリップの高い車ほど普通のコーナーで軽くなってしまうため
      const maxTorque = Math.min(kart.mu || KART.mu, 1.8) * kart.FzF * (0.045 + mech) * 0.7;
      // ffbScale: 車種ごとの重さ。GT3・フォーミュラはロック角が大きく切れ角も小さいので、
      // 横 G 基準のままだとハンドルを回した量に対して軽すぎる
      force = (-kart.frontForce * (pneumatic + mech)) / maxTorque * s.align * (spec.ffbScale ?? 1);
      // 横 G が大きくなるほど重さの増え方を強くする（コーナーでググっと重くなる）。
      // 直線付近の小さい力はほとんど変えないので、直線でハンドルが左右に振られることはない
      force *= 1 + CORNER_LOAD * Math.min(1, Math.abs(force));
    } else {
      // 停止・低速はタイヤが路面をこする重さ
      force = -wheel.value * 0.25 * s.align;
    }

    // 路面の凹凸: 左右の前輪の高さの差が変わるとハンドルが取られる（バンプステア）
    let jolt = 0;
    if (ride && prevRide && rideDt > 0) {
      const diff = (ride.fr - ride.fl) - (prevRide.fr - prevRide.fl);
      force += clamp((diff / rideDt) * 0.25, -0.4, 0.4) * s.road;
      // 前輪の上下の速さ → 突き上げ
      const vz = ((ride.fl + ride.fr) - (prevRide.fl + prevRide.fr)) / 2 / rideDt;
      // 舗装の細かい継ぎ目程度は拾わない（直線でハンドルがゴリゴリ震えないように）
      jolt = clamp((Math.abs(vz - (this.prevVz || 0)) - 0.12) * 0.25, 0, 1);
      this.prevVz = vz;
    }

    // ハンドルを回す速さに応じた抵抗（ゲーム側のダンパー）。手ごたえが強くなっても中央付近で行き過ぎて
    // 左右に振られないようにする（機器のダンパーは機種によって弱い・効かないことがある）
    if (dt > 0 && this.prevWheel !== undefined) {
      const wv = (wheel.value - this.prevWheel) / dt;
      force -= clamp(wv * 0.06, -0.35, 0.35) * (s.damper / 0.25) * Math.min(1, speed / 10);
    }
    this.prevWheel = wheel.value;

    // 衝突
    for (const e of events) {
      if (e.type === 'wall' && e.strength > 0.5) this.impulse += clamp(e.strength / 8, 0, 1) * -e.side;
      // アイテムが当たってスピン: ハンドルが取られる衝撃（スピン中の力は弱めるので一度だけ）
      if (e.type === 'hit') this.impulse += 0.7 * (Math.random() < 0.5 ? -1 : 1);
      if (e.type === 'bump' && e.strength > 1) {
        // ぶつかった向き（相手がいる側）からハンドルを取られる。n は自分から相手への向き
        const side = (e.nx ?? 0) * -sn + (e.nz ?? 0) * c; // 正 = 相手が右側
        this.impulse += clamp(e.strength / 6, 0, 0.8) * 0.6 * -Math.sign(side || 0);
      }
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

    // 力の向きの反転は出力の直前（ffb.js）でまとめて行う
    // 上限の手前はゆるやかに頭打ちにする（張り付かず、グリップが抜けて軽くなる変化が伝わる）
    const constant = softLimit(force) * s.gain;
    // ハンコン本体のばね: 走り出すと中心へ戻る重さが加わる（車種ごと。機器側で処理するので遅れで振動しない）
    const spec = kart.spec || KART;
    const spring = clamp((spec.ffbSpring ?? 0) * Math.min(1, speed / 20) * s.align / 0.6, 0, 1) * s.gain;
    return {
      constant,
      spring,
      damper: clamp(s.damper * (0.3 + Math.min(1, speed / 15) * 0.7), 0, 1) * s.gain,
      rumble: rumble * s.gain,
      rumbleHz: hz,
    };
  }
}
