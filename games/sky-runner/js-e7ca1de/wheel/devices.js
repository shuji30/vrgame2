// ハンコン (ハンドル + ペダル) の入力。TURBO KART VR (vrgame2/games/turbo-kart/src/input/devices.js) から流用して手直し
// - 割り当て (binding) はハンコン設定の画面で学習して作り、localStorage に保存する
// - デバイスは Gamepad API (ブラウザが直接読む) と、デバイスブリッジ経由 (VR の最中も読める) の両方から探す
// - ハンドルとペダルは別々の USB デバイスでもよい (割り当てごとにデバイスの名前と番号を覚える)
import { mapSteer, mapPedal } from './inputmap.js';
import { DeviceBridge } from './bridge.js';

const STORE = 'skyrunner.wheel';

// 割り当てる操作。kind: steer = ハンドル (軸)、pedal = ペダル (軸。ボタンでもよい)、button = ボタン (軸でもよい)
export const ACTIONS = [
  { key: 'steer', label: 'ハンドル (左右)', kind: 'steer' },
  { key: 'throttle', label: 'アクセル (加速)', kind: 'pedal' },
  { key: 'brake', label: 'ブレーキ (減速)', kind: 'pedal' },
  { key: 'clutch', label: 'クラッチ (高さ)', kind: 'pedal', optional: true, note: '踏み込んだ量がそのまま高さ。離すと地面、踏み切ると最高高度' },
  { key: 'up', label: '上昇 (右パドル)', kind: 'button', optional: true, note: '2 ペダルの機種用。押している間だけ上がる' },
  { key: 'down', label: '下降 (左パドル)', kind: 'button', optional: true, note: '2 ペダルの機種用。押している間だけ下がる' },
  { key: 'fire', label: '機関砲', kind: 'button' },
  { key: 'missile', label: 'ミサイル', kind: 'button' },
  { key: 'view', label: '視点の切り替え', kind: 'button', optional: true },
  { key: 'pause', label: 'ポーズ', kind: 'button' },
  { key: 'back', label: 'タイトルへ (ポーズ中)', kind: 'button', optional: true },
  { key: 'recenter', label: '位置合わせ (VR)', kind: 'button', optional: true },
];
export const BUTTON_ACTIONS = ACTIONS.filter((a) => a.kind === 'button').map((a) => a.key);

// VR ヘッドセットなどが出す疑似ゲームパッド (頭の動きで軸が動くので割り当ての候補から外す)
const IGNORE = /pimax|vive|valve index|oculus|meta quest|htc|windows mixed reality|hmd/i;

export function defaultConfig() {
  return {
    bindings: {}, // action → { kind: 'axis'|'button', pad, padIndex, control, cal }
    // wheelDeg: ドライバーで設定しているハンドルの回転角 (左端〜右端)。lockDeg: 端まで切ったことにする角度 (90° = 左右 45° ずつ)
    steer: { wheelDeg: 900, lockDeg: 90, deadzone: 0.04, gamma: 1, invert: false },
    // FFB: 被弾や障害物に当たったときの短い振動、中央へ戻すばね (真ん中から離すほど強く戻る)、回す重さ (ダンパー。0 = 出さない)。
    // v: 設定の版 (2 からばねとダンパーをはじめから効かせる)
    ffb: { enabled: true, rumble: 0.5, spring: 0.35, damper: 0.15, v: 2 },
  };
}

export function loadConfig() {
  const d = defaultConfig();
  try {
    const c = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (c && c.bindings) {
      // 前の版はばねの初期値が 0 (効かない) だったので、0 のままならはじめの値にする
      const ffb = c.ffb?.v >= 2 ? c.ffb : { ...c.ffb, spring: c.ffb?.spring || d.ffb.spring, v: d.ffb.v };
      return { ...d, ...c, steer: { ...d.steer, ...c.steer }, ffb: { ...d.ffb, ...ffb } };
    }
  } catch (_) {
    // 壊れていたら初期値
  }
  return d;
}

export function saveConfig(cfg) {
  try {
    localStorage.setItem(STORE, JSON.stringify(cfg));
  } catch (_) {
    // 保存できない環境
  }
}

const BRIDGE_PREFIX = 'SDL: ';
// 名前の比較用 (ブリッジは「機器名」、ブラウザは「機器名 (Vendor: … Product: …)」のように返す)
const baseName = (id) => String(id).replace(/^SDL: /, '').replace(/\s*\(.*?Vendor.*?\)\s*$/i, '').trim().toLowerCase();
// 同じ機器か (名前が同じか、片方がもう片方の頭と一致する。ブリッジとブラウザで名前の長さが違うことがある)
function sameDevice(a, b) {
  const na = baseName(a), nb = baseName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // 短すぎる名前 (「usb」など) の前方一致は、別の機器と取り違えるので使わない
  return Math.min(na.length, nb.length) >= 6 && (na.startsWith(nb) || nb.startsWith(na));
}

// 接続中のデバイスを軽量なスナップショットにする (ブリッジ経由のものを先に並べる。学習ではそちらが選ばれやすい)
export function snapshotPads(bridge) {
  const out = [];
  for (const p of bridge?.inputPads() || []) {
    out.push({ id: BRIDGE_PREFIX + p.id, index: 1000 + p.index, mapping: '', axes: p.axes, buttons: p.buttons, bridge: true });
  }
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp || !gp.connected) continue;
    if (IGNORE.test(gp.id) || (gp.buttons.length === 0 && gp.axes.length >= 10)) continue;
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
  const has = (p) => (binding.kind === 'button' ? p.buttons.length : p.axes.length) > binding.control;
  const same = pads.filter((p) => p.id === binding.pad);
  // 同じ名前が複数あるときは、番号が一致し、かつその軸/ボタンを持つものを選ぶ
  if (same.length) return same.find((p) => p.index === binding.padIndex && has(p)) || same.find(has) || same[0];
  // 割り当てたときと読み方が違う (ブリッジ経由 ⇔ ブラウザ直接) ときは、同じ機器名のものを同じ番号とみなして読む。
  // VR の最中はブラウザからハンコンが見えないことがあるため (多くの機種で軸・ボタンの番号は同じ)
  return pads.find((p) => sameDevice(p.id, binding.pad) && has(p)) || null;
}

// ハンコンの入力をまとめる。input.js が毎フレーム read() を呼ぶ
export class WheelInput {
  constructor() {
    this.config = loadConfig();
    this.bridge = new DeviceBridge({ autoConnect: Object.keys(this.config.bindings).length > 0 });
    this.busy = false; // 割り当ての学習中 (ゲームの操作として読まない)
    this.panelOpen = false; // ハンコン設定を開いている間も、ハンコンをゲームの操作として読まない (ボタンの確認で出撃しないように)
    this.prevSig = '';
    this.rumbleUntil = 0;
    this.rumbleMag = 0;
    this.last = null;
  }

  save() {
    saveConfig(this.config);
  }

  hasBindings() {
    return Object.keys(this.config.bindings).length > 0;
  }

  // 3 ペダルか (クラッチが割り当て済みなら、クラッチで高さを決める)
  hasClutch() {
    return !!this.config.bindings.clutch;
  }

  readBinding(pads, b) {
    const pad = findPad(pads, b);
    if (!pad) return null;
    return (b.kind === 'button' ? pad.buttons[b.control] : pad.axes[b.control]) ?? 0;
  }

  // ペダルの踏み込み量 0..1 (割り当てが無い・デバイスが見えないときは null)
  pedal(pads, name) {
    const b = this.config.bindings[name];
    if (!b) return null;
    const raw = this.readBinding(pads, b);
    if (raw == null) return null;
    return b.kind === 'button' ? (raw > 0.5 ? 1 : 0) : mapPedal(raw, b.cal || {});
  }

  // ボタンを押しているか (軸に割り当てたときは、離した位置から半分以上動いたら押したとみなす)
  button(pads, name) {
    const b = this.config.bindings[name];
    if (!b) return false;
    const v = this.readBinding(pads, b);
    if (v == null) return false;
    return b.kind === 'button' ? v > 0.5 : Math.abs(v - (b.cal?.rest ?? 0)) > 0.5;
  }

  // このブラウザのゲームパッドが、割り当て済みのハンコン (または、そのブリッジ経由の同じ機器) か。
  // そうなら input.js の普通のパッドとしては読まない (ハンドルの軸が左右の移動に二重に入らないように)
  claims(gpId) {
    return Object.values(this.config.bindings).some((b) => b.pad === gpId || sameDevice(b.pad, gpId));
  }

  // 毎フレーム呼ぶ。ハンコンが使えないときは null
  read() {
    if (this.busy || this.panelOpen || !this.hasBindings()) { this.last = null; this.prevSig = ''; return null; }
    const pads = snapshotPads(this.bridge);
    this.pads = pads;
    const B = this.config.bindings;
    let steer = null;
    if (B.steer) {
      const raw = this.readBinding(pads, B.steer);
      if (raw != null) steer = mapSteer(raw, { ...B.steer.cal, ...this.config.steer }).value;
    }
    const throttle = this.pedal(pads, 'throttle');
    const brake = this.pedal(pads, 'brake');
    const clutch = this.pedal(pads, 'clutch');
    if (steer == null && throttle == null && brake == null && clutch == null && !BUTTON_ACTIONS.some((a) => findPad(pads, B[a]))) {
      this.last = null;
      return null; // 割り当てたデバイスが 1 つも見えない
    }
    const held = {};
    for (const a of BUTTON_ACTIONS) held[a] = this.button(pads, a);
    // 操作したか (マウスの絶対位置の操作から、ハンコンに切り替えるため)
    const sig = [steer, throttle, brake, clutch].map((v) => Math.round((v ?? 0) * 20)).join(',') + BUTTON_ACTIONS.map((a) => (held[a] ? 1 : 0)).join('');
    const touched = this.prevSig !== '' && sig !== this.prevSig;
    this.prevSig = sig;
    this.last = { steer: steer ?? 0, throttle: throttle ?? 0, brake: brake ?? 0, clutch, held, touched };
    return this.last;
  }

  // 毎フレーム呼ぶ: FFB (振動とばね) をブリッジへ送る
  updateForce() {
    const f = this.config.ffb;
    if (!f.enabled || !this.bridge.connected) return;
    const now = performance.now();
    const r = now < this.rumbleUntil ? this.rumbleMag * f.rumble : 0;
    // ばねは割り当て済みのハンドルが見えているときだけ
    const wheelOn = this.last && this.config.bindings.steer;
    this.bridge.force({ r, hz: 30, s: wheelOn ? f.spring : 0, d: wheelOn ? f.damper : 0 });
  }

  // 短い振動 (被弾・障害物など)。strength 0..1、ms ミリ秒 (長くても 0.5 秒まで)
  rumble(strength, ms) {
    if (!this.config.ffb.enabled || !this.bridge.connected) return;
    const now = performance.now();
    if (now >= this.rumbleUntil) this.rumbleMag = 0;
    this.rumbleMag = Math.max(this.rumbleMag, Math.max(0, Math.min(1, strength)));
    this.rumbleUntil = Math.max(this.rumbleUntil, now + Math.min(500, ms));
  }
}
