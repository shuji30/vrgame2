// 入力変換層(three.js 非依存):各デバイスの値 → 共通アクション
// 共通アクション:左履帯・右履帯(-1..1)、砲塔旋回(-1..1、速度制御)、砲身上下、主砲、副武装、逆立ち曲射、変速
// 戦車専用にしない:歩行メカも同じ左右の値で動く(脚の車輪を履帯と同じに扱う)
import { mapPedal, mapSteer } from './inputmap.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function emptyActions() {
  return {
    left: 0, right: 0, turret: 0, turretYaw: null, pitchStep: 0, pitchRate: 0,
    // 砲塔を車体の正面へゆっくり戻す(ハンコン:ハンドルを中央にしてしばらくたったとき)。速度制御のまま、止めている間だけ効く
    turretCenter: false,
    fire: false, fireStrength: 1, sub: false, subPress: false, subSelect: false,
    lob: false, lobAmount: 0, lobAnalog: false, gear: null,
    quickTurn: false, quickDir: 1, weaponSwap: false,
    view: false, hatch: false, pause: false, recenter: false,
    // メニュー操作
    up: false, down: false, ok: false, back: false, leftUi: false, rightUi: false,
  };
}

// 簡易操作モード:前後と旋回 → 左右の履帯(左右ペダルの踏み分けが難しい人向け)
export function arcadeToTracks(throttle, turn) {
  // turn>0 で左旋回(右の履帯を速く)
  let l = throttle - turn, r = throttle + turn;
  const m = Math.max(1, Math.abs(l), Math.abs(r));
  l /= m; r /= m;
  return { left: l, right: r };
}

// ---------------------------------------------------------------- ハンコン
// 割り当てに使う操作の一覧(機器の id と軸・ボタン番号で保存する)
export const WHEEL_ACTIONS = [
  { key: 'steer', label: 'ハンドル(砲塔旋回)', kind: 'axis' },
  { key: 'clutch', label: 'クラッチ(左履帯)', kind: 'axis', pedal: true },
  { key: 'throttle', label: 'アクセル(右履帯)', kind: 'axis', pedal: true },
  { key: 'brake', label: 'ブレーキ(主砲・停車射撃)', kind: 'axis', pedal: true },
  { key: 'paddleL', label: '左パドル(左履帯を逆転)', kind: 'button' },
  { key: 'paddleR', label: '右パドル(右履帯を逆転)', kind: 'button' },
  { key: 'thumbR', label: '右親指ボタン(主砲・走行中)', kind: 'button' },
  { key: 'thumbL', label: '左親指ボタン(副武装)', kind: 'button' },
  { key: 'subSelect', label: '副武装の切り替え', kind: 'button', optional: true },
  { key: 'view', label: '視点の切り替え', kind: 'button', optional: true },
  { key: 'pause', label: 'ポーズ・メニュー', kind: 'button', optional: true },
  { key: 'recenter', label: '視点のリセット(VR)', kind: 'button', optional: true },
  { key: 'gear1', label: 'Hシフター 1速', kind: 'button', optional: true },
  { key: 'gear2', label: 'Hシフター 2速', kind: 'button', optional: true },
  { key: 'gear3', label: 'Hシフター 3速', kind: 'button', optional: true },
  { key: 'gearR', label: 'Hシフター R', kind: 'button', optional: true },
  { key: 'seqUp', label: 'シーケンシャル 押す(砲身を下げる)', kind: 'button', optional: true },
  { key: 'seqDown', label: 'シーケンシャル 引く(砲身を上げる)', kind: 'button', optional: true },
  { key: 'handbrake', label: 'ハンドブレーキ(逆立ち曲射)', kind: 'axis', pedal: true, optional: true },
  { key: 'lobButton', label: '曲射ボタン(ハンドブレーキがないとき)', kind: 'button', optional: true },
  { key: 'menuUp', label: 'メニュー 上(十字キー)', kind: 'button', optional: true },
  { key: 'menuDown', label: 'メニュー 下(十字キー)', kind: 'button', optional: true },
  { key: 'menuOk', label: 'メニュー 決定', kind: 'button', optional: true },
  { key: 'menuBack', label: 'メニュー 戻る', kind: 'button', optional: true },
];

export function defaultWheelConfig() {
  return {
    pedals: 3, // 3 か 2(2ペダル:ブレーキが左履帯)
    swap: false, // 左右の入れ替え(パドルも連動)
    bindings: {},
    steer: { center: 0, min: -1, max: 1, invert: false, wheelDeg: 900, lockDeg: 180, deadzone: 0.04, gamma: 1.3 },
    pedalCal: {}, // key → { rest, full, deadzone, gamma }
    brakeFire: 0.55, // ブレーキを踏み込んで撃つ閾値
  };
}

function readBinding(pads, b) {
  if (!b) return null;
  const pad = pads.find((p) => p.id === b.pad && (b.index == null || p.index === b.index)) || pads.find((p) => p.id === b.pad);
  if (!pad) return null;
  return b.kind === 'axis' ? pad.axes[b.control] ?? null : (pad.buttons[b.control] ?? 0) > 0.5;
}

// ブリッジから届いた pads → 生の値
export function readWheel(pads, cfg) {
  const out = {};
  for (const a of WHEEL_ACTIONS) {
    const b = cfg.bindings[a.key];
    const v = readBinding(pads, b);
    if (v == null) { out[a.key] = a.kind === 'axis' ? (a.key === 'steer' ? 0 : 0) : false; continue; }
    if (a.key === 'steer') {
      // beyond: 効く角度を超えて回したか(1 を超えると超えている)。FFB のソフトロックに使う
      const m = mapSteer(v, cfg.steer);
      out.steer = m.value;
      out.steerBeyond = m.beyond;
      out.steerSign = Math.sign(m.value) || 0;
    }
    else if (a.pedal) out[a.key] = mapPedal(v, cfg.pedalCal[a.key] || { rest: b.rest ?? -1, full: b.full ?? 1 });
    else out[a.key] = v;
  }
  out.hasShifter = !!(cfg.bindings.gear1 || cfg.bindings.gear3 || cfg.bindings.gearR);
  out.hasHandbrake = !!cfg.bindings.handbrake;
  return out;
}

// 生の値 → 共通アクション。state は前回の値(ボタンの押した瞬間とブレーキの踏み込みの検出に使う)
export function wheelToActions(w, cfg, state, act = emptyActions()) {
  const three = cfg.pedals !== 2;
  // 左右の履帯:ペダルで前進、パドルを押している間だけ逆転(トグルにしない)
  let leftPedal = three ? w.clutch : w.brake;
  let rightPedal = w.throttle;
  let revL = w.paddleL, revR = w.paddleR;
  if (cfg.swap) { [leftPedal, rightPedal] = [rightPedal, leftPedal]; [revL, revR] = [revR, revL]; }
  act.left = clamp(leftPedal * (revL ? -1 : 1), -1, 1);
  act.right = clamp(rightPedal * (revR ? -1 : 1), -1, 1);
  // ハンドル:角度 → 砲塔の旋回速度(右に切ると右へ回る。ゲーム内の砲塔角は左が +)
  act.turret = -w.steer;
  // 主砲:3ペダルはブレーキの踏み込みが閾値を超えた瞬間(強く踏むほど反動を強く)、または右親指
  const edge = (k) => w[k] && !state[k];
  let fire = edge('thumbR');
  let strength = 1;
  if (three) {
    const over = w.brake > cfg.brakeFire;
    if (over && !state.brakeOver) { fire = true; state.brakePeak = w.brake; state.brakeT = 0; }
    state.brakeOver = w.brake > cfg.brakeFire * 0.7 ? (state.brakeOver || over) : false;
    strength = clamp(0.5 + (w.brake - cfg.brakeFire) / (1 - cfg.brakeFire) * 0.5 + 0.2, 0.4, 1);
  }
  act.fire = fire;
  act.fireStrength = strength;
  act.sub = !!w.thumbL;
  act.subPress = edge('thumbL');
  act.subSelect = edge('subSelect');
  act.view = edge('view');
  act.pause = edge('pause');
  act.recenter = edge('recenter');
  // 変速:Hシフター(なければ常に2速)
  if (w.hasShifter) act.gear = w.gear1 ? 1 : w.gear3 ? 3 : w.gearR ? 'R' : 2;
  else act.gear = 2;
  // 砲身の上下:シーケンシャル 押す=1段下げ、引く=1段上げ
  act.pitchStep = (edge('seqDown') ? 1 : 0) - (edge('seqUp') ? 1 : 0);
  // 逆立ち曲射:ハンドブレーキの引いた量で距離。なければボタン(距離は自動)
  if (w.hasHandbrake) {
    act.lob = w.handbrake > 0.08;
    act.lobAmount = clamp((w.handbrake - 0.08) / 0.92, 0, 1);
    act.lobAnalog = true;
  } else {
    act.lob = !!w.lobButton;
    act.lobAnalog = false;
  }
  // 歩行メカ:急旋回はハンドブレーキ、武器の持ち替えはHシフター(1速/3速の切り替えで)。R は戦車と同じく後退
  act.quickTurn = w.hasHandbrake ? w.handbrake > 0.6 && !(state.hb > 0.6) : edge('lobButton');
  act.quickDir = w.steer < 0 ? -1 : 1;
  act.weaponSwap = w.hasShifter && state.gear != null && act.gear !== state.gear && (act.gear === 1 || act.gear === 3);
  // メニュー
  act.up = edge('menuUp');
  act.down = edge('menuDown');
  act.ok = edge('menuOk') || edge('thumbR');
  act.back = edge('menuBack');
  // 状態を覚える
  for (const k of ['thumbR', 'thumbL', 'subSelect', 'view', 'pause', 'recenter', 'seqUp', 'seqDown', 'lobButton', 'menuUp', 'menuDown', 'menuOk', 'menuBack']) state[k] = w[k];
  state.hb = w.handbrake;
  state.gear = act.gear;
  return act;
}
