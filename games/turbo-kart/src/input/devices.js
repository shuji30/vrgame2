// 入力: キーボード + Gamepad API（ハンコン・ペダル・サイドブレーキは別々の USB デバイスでもよい）
// 割り当て（binding）はキャリブレーション画面で作り、localStorage に保存する
import { mapSteer, mapPedal } from '../core/inputmap.js';

const STORE = 'turbokart:input';

export const ACTIONS = [
  { key: 'steer', label: 'ハンドル', kind: 'steer' },
  { key: 'throttle', label: 'アクセル', kind: 'pedal' },
  { key: 'brake', label: 'ブレーキ', kind: 'pedal' },
  { key: 'handbrake', label: 'サイドブレーキ', kind: 'pedal' },
  { key: 'shiftUp', label: 'シフトアップ（右パドル）', kind: 'button' },
  { key: 'shiftDown', label: 'シフトダウン（左パドル）', kind: 'button' },
  { key: 'pause', label: 'ポーズ', kind: 'button' },
  { key: 'recenter', label: '視点リセンター（VR）', kind: 'button' },
  { key: 'confirm', label: '決定 / リスタート', kind: 'button' },
  { key: 'camera', label: 'カメラ切替（PC）', kind: 'button' },
  { key: 'ffbReset', label: 'FFB リセット', kind: 'button' },
  { key: 'item', label: 'アイテムを使う（パーティー）', kind: 'button' },
  { key: 'itemBack', label: 'アイテムを後ろへ投げる（パーティー）', kind: 'button' },
  { key: 'gear1', label: 'H シフター 1 速', kind: 'button', group: 'shifter' },
  { key: 'gear2', label: 'H シフター 2 速', kind: 'button', group: 'shifter' },
  { key: 'gear3', label: 'H シフター 3 速', kind: 'button', group: 'shifter' },
  { key: 'gear4', label: 'H シフター 4 速', kind: 'button', group: 'shifter' },
  { key: 'gear5', label: 'H シフター 5 速', kind: 'button', group: 'shifter' },
  { key: 'gear6', label: 'H シフター 6 速', kind: 'button', group: 'shifter' },
  { key: 'gearR', label: 'H シフター R（後退）', kind: 'button', group: 'shifter' },
];
const GEARS = [['gear1', 1], ['gear2', 2], ['gear3', 3], ['gear4', 4], ['gear5', 5], ['gear6', 6], ['gearR', -1]];

// VR ヘッドセットなどが出す疑似ゲームパッド（頭の動きで軸が動くので割り当て候補から外す）
const IGNORE = /pimax|vive|valve index|oculus|meta quest|htc|windows mixed reality|hmd/i;

// FFB ブリッジ（SDL2）経由のデバイス。ブラウザの Gamepad API は 4 台までしか扱えないため
let bridgePads = () => [];
export function setBridgePads(fn) {
  bridgePads = fn;
}
// WebHID（ブラウザが直接読む）デバイス
let hidPads = () => [];
export function setHidPads(fn) {
  hidPads = fn;
}

export function defaultConfig() {
  return {
    bindings: {}, // action → { kind: 'axis'|'button', pad, padIndex, control, cal }
    steer: { wheelDeg: 900, lockDeg: 270, deadzone: 0, gamma: 1 },
    transmission: 'auto',
    stability: true, // ハンコンのスピン防止
  };
}

export function loadConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (c && c.bindings) return { ...defaultConfig(), ...c, steer: { ...defaultConfig().steer, ...c.steer } };
  } catch {
    // 壊れていたら初期値
  }
  return defaultConfig();
}

export function saveConfig(cfg) {
  try {
    localStorage.setItem(STORE, JSON.stringify(cfg));
  } catch {
    // 保存できない環境
  }
}

// 接続中のパッドを軽量なスナップショットにする（ブラウザ + ブリッジ）
export function snapshotPads() {
  const out = [];
  const hid = hidPads() || [];
  for (const p of hid) out.push({ ...p, mapping: '', hid: true });
  const hidNames = hid.map((p) => p.id.slice(5).replace(/ \[[^\]]*\]$/, '').toLowerCase());
  const extra = (bridgePads() || []).filter((p) => !hidNames.some((n) => n && p.id.toLowerCase().startsWith(n)));
  for (const p of extra) {
    out.push({ id: `SDL: ${p.id}`, index: 1000 + p.index, mapping: '', axes: p.axes, buttons: p.buttons, bridge: true });
  }
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp || !gp.connected) continue;
    if (IGNORE.test(gp.id) || (gp.buttons.length === 0 && gp.axes.length >= 10)) continue;
    // ブリッジ側にも同じ機器があればそちらを使う
    if (extra.some((p) => gp.id.startsWith(p.id))) continue;
    if (hidNames.some((n) => n && gp.id.toLowerCase().startsWith(n))) continue;
    out.push({
      id: gp.id,
      index: gp.index,
      mapping: gp.mapping,
      axes: Array.from(gp.axes),
      buttons: gp.buttons.map((b) => b.value || (b.pressed ? 1 : 0)),
    });
  }
  return out;
}

export function findPad(pads, binding) {
  if (!binding) return null;
  const same = pads.filter((p) => p.id === binding.pad);
  if (!same.length) return null;
  // 同じ名前が複数あるときは、番号が一致し、かつその軸/ボタンを持つものを選ぶ
  const has = (p) => (binding.kind === 'button' ? p.buttons.length : p.axes.length) > binding.control;
  return same.find((p) => p.index === binding.padIndex && has(p)) || same.find(has) || same[0];
}

export class InputManager {
  constructor() {
    this.config = loadConfig();
    this.keys = new Set();
    this.kbSteer = 0;
    this.prev = {};
    this.source = 'keyboard';
    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  save() {
    saveConfig(this.config);
  }

  hasWheel() {
    return !!this.config.bindings.steer;
  }

  readBinding(pads, b) {
    const pad = findPad(pads, b);
    if (!pad) return null;
    if (b.kind === 'button') return pad.buttons[b.control] ?? 0;
    return pad.axes[b.control] ?? 0;
  }

  // 毎フレーム呼ぶ。edge 系（shiftUp など）は押した瞬間だけ true
  // VR のコントローラー（XRInputSource の配列を返す関数。main.js が設定）
  xrSources() {
    return this.getXRSources?.() || [];
  }

  poll(dt) {
    const pads = snapshotPads();
    const B = this.config.bindings;
    const k = this.keys;
    const out = { steer: 0, throttle: 0, brake: 0, handbrake: 0, wheel: { value: 0, beyond: 0 }, source: 'keyboard' };
    const held = {};

    // キーボード（ハンドルはなめらかに）
    const left = k.has('ArrowLeft') || k.has('KeyA');
    const right = k.has('ArrowRight') || k.has('KeyD');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    const rate = target === 0 ? 6 : 3.5;
    this.kbSteer += Math.max(-rate * dt, Math.min(rate * dt, target - this.kbSteer));
    let steer = this.kbSteer;
    let throttle = k.has('ArrowUp') || k.has('KeyW') ? 1 : 0;
    let brake = k.has('ArrowDown') || k.has('KeyS') ? 1 : 0;
    let handbrake = k.has('Space') ? 1 : 0;
    held.shiftUp = k.has('KeyE');
    held.shiftDown = k.has('KeyQ');
    held.pause = k.has('Escape') || k.has('KeyP');
    held.recenter = k.has('KeyR');
    held.confirm = k.has('Enter');
    held.camera = k.has('KeyC');
    held.debug = k.has('KeyI');
    held.ffbReset = k.has('KeyF');
    held.item = k.has('ShiftLeft') || k.has('ShiftRight');
    held.itemBack = k.has('KeyX');

    // VR コントローラー（Quest など。xr-standard 配列）: 左スティック = ハンドル、右トリガー = アクセル、
    // 左トリガー = ブレーキ、グリップ = サイドブレーキ、A = アイテム、B = 後ろへ、X = カメラ、Y = ポーズ、スティック押し込み = リセンター
    for (const src of this.xrSources()) {
      const gp = src.gamepad;
      if (!gp || gp.mapping !== 'xr-standard') continue;
      const b = (i) => gp.buttons[i]?.value ?? 0;
      const pressed = (i) => !!gp.buttons[i]?.pressed;
      if (src.handedness === 'left') {
        const ax = gp.axes[2] ?? 0;
        if (Math.abs(ax) > 0.08 && !B.steer) { steer = Math.sign(ax) * (Math.abs(ax) - 0.08) / 0.92; out.source = 'gamepad'; }
        brake = Math.max(brake, b(0));
        handbrake = Math.max(handbrake, b(1));
        held.camera ||= pressed(4);
        held.pause ||= pressed(5);
        held.recenter ||= pressed(3);
      } else if (src.handedness === 'right') {
        throttle = Math.max(throttle, b(0));
        handbrake = Math.max(handbrake, b(1));
        held.item ||= pressed(4);
        held.confirm ||= pressed(4);
        held.itemBack ||= pressed(5);
        held.recenter ||= pressed(3);
      }
    }

    // 標準配列のゲームパッド（割り当てが無いときの既定）
    const std = pads.find((p) => p.mapping === 'standard');
    if (std && !B.steer) {
      const ax = std.axes[0] ?? 0;
      if (Math.abs(ax) > 0.12) { steer = ax; out.source = 'gamepad'; }
      throttle = Math.max(throttle, std.buttons[7] ?? 0);
      brake = Math.max(brake, std.buttons[6] ?? 0);
      handbrake = Math.max(handbrake, std.buttons[1] ?? 0);
      held.shiftUp ||= (std.buttons[5] ?? 0) > 0.5;
      held.shiftDown ||= (std.buttons[4] ?? 0) > 0.5;
      held.pause ||= (std.buttons[9] ?? 0) > 0.5;
      held.recenter ||= (std.buttons[3] ?? 0) > 0.5;
      held.confirm ||= (std.buttons[0] ?? 0) > 0.5;
      held.camera ||= (std.buttons[8] ?? 0) > 0.5;
      held.item ||= (std.buttons[0] ?? 0) > 0.5;
      held.itemBack ||= (std.buttons[2] ?? 0) > 0.5;
    }

    // ハンコンなど割り当て済みのデバイス
    if (B.steer) {
      const raw = this.readBinding(pads, B.steer);
      if (raw != null) {
        // lockDeg: 本格モードでは車種ごとの実車のロック角を使う
        const m = mapSteer(raw, { ...B.steer.cal, ...this.config.steer, ...(this.lockDeg ? { lockDeg: this.lockDeg } : {}) });
        steer = m.value;
        out.wheel = m;
        out.source = 'wheel';
      }
    }
    const pedal = (name) => {
      const b = B[name];
      if (!b) return null;
      const raw = this.readBinding(pads, b);
      if (raw == null) return null;
      return b.kind === 'button' ? (raw > 0.5 ? 1 : 0) : mapPedal(raw, b.cal || {});
    };
    const th = pedal('throttle');
    if (th != null) throttle = Math.max(k.has('ArrowUp') ? 1 : 0, th);
    const br = pedal('brake');
    if (br != null) brake = Math.max(k.has('ArrowDown') ? 1 : 0, br);
    const hb = pedal('handbrake');
    if (hb != null) handbrake = Math.max(handbrake, hb);
    for (const a of ['shiftUp', 'shiftDown', 'pause', 'recenter', 'confirm', 'camera', 'ffbReset', 'item', 'itemBack']) {
      const b = B[a];
      if (!b) continue;
      const v = this.readBinding(pads, b);
      if (v == null) continue;
      held[a] ||= b.kind === 'button' ? v > 0.5 : Math.abs(v - (b.cal?.rest ?? 0)) > 0.5;
    }

    // H シフター（どの段にも入っていなければニュートラル）
    if (GEARS.some(([a]) => B[a])) {
      out.hGear = 0;
      for (const [a, g] of GEARS) {
        const b = B[a];
        if (b && (this.readBinding(pads, b) ?? 0) > 0.5) out.hGear = g;
      }
    }

    out.steer = Math.max(-1, Math.min(1, steer));
    if (out.source !== 'wheel') out.wheel = { value: out.steer, beyond: Math.abs(out.steer) };
    out.throttle = throttle;
    out.brake = brake;
    out.handbrake = handbrake;
    for (const a of Object.keys(held)) {
      out[a] = held[a] && !this.prev[a];
      out[a + 'Held'] = held[a];
    }
    this.prev = held;
    this.pads = pads;
    return out;
  }
}
