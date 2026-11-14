// 入力の統合:キーボード/マウス、ゲームパッド、ハンコン(ffb-bridge)、VR コントローラーを共通アクションにまとめる
// デバイスごとの差はこのファイルと core/tankmap.js だけに閉じ込める
import { emptyActions, arcadeToTracks, readWheel, wheelToActions, defaultWheelConfig } from '../core/tankmap.js';

const STORE = 'treadrevolt:wheel';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// ハンコンやペダルはパッドとして読まない(ペダルを離すと軸が -1 になり、倒しっぱなしと取り違える)。vrgame4 と同じ
const SIM_DEVICE = /wheel|pedal|fanatec|thrustmaster|logitech g(2|9)|driving force|moza|simagic|simucube|cammus|heusinkveld|asetek|vrs|t300|t150|t248|t818|tmx|csl|clubsport|podium|shifter|handbrake|sim /i;
const dz = (v, d = 0.15) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));

export class InputManager {
  constructor(bridge) {
    this.bridge = bridge;
    this.keys = new Set();
    this.pressed = new Set(); // このフレームで押されたキー
    this.mouse = { dx: 0, down: [false, false, false], clicked: [false, false, false], locked: false };
    this.settings = { scheme: 'tracks', manualPitch: false, mouseTurret: true, invertMouse: false, mouseSens: 1 };
    this.wheelCfg = loadWheel();
    this.wheelState = {};
    this.padPrev = [];
    this.padArm = {}; // ゲームパッドごとの、使ってよい軸とボタン
    this.xr = null; // VR からの共通アクション(game が毎フレーム入れる)
    this.active = 'keyboard';
    this.gearKb = 2;
    this.lobT = 0;
    this.enabled = true;
    addEventListener('keydown', (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'SELECT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.active = 'keyboard';
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code) && this.enabled) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => { if (this.mouse.locked) this.mouse.dx += e.movementX; });
    addEventListener('mousedown', (e) => { if (this.mouse.locked) { this.mouse.down[e.button] = true; this.mouse.clicked[e.button] = true; this.active = 'keyboard'; } });
    addEventListener('mouseup', (e) => { this.mouse.down[e.button] = false; });
    addEventListener('contextmenu', (e) => { if (this.mouse.locked) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => { this.mouse.locked = !!document.pointerLockElement; });
  }

  saveWheel() {
    try { localStorage.setItem(STORE, JSON.stringify(this.wheelCfg)); } catch { /* 保存できない */ }
  }

  // 入力の状態(ポーズ画面に出して、勝手に動く原因を確かめる)
  describe() {
    const f = (v) => (Math.abs(v) < 0.005 ? '0' : v.toFixed(2));
    const lines = [`使っている入力: ${this.active}`];
    const all = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    if (!all.length) lines.push('ゲームパッド: なし');
    for (const g of all) {
      const used = g.mapping === 'standard' && !SIM_DEVICE.test(g.id);
      const arm = this.padArm[`${g.index}:${g.id}`];
      const axes = g.axes.map((v, n) => `${f(v)}${arm && !arm.axes[n] ? '(無視)' : ''}`).join(' ');
      const btns = g.buttons.map((b, n) => (b.pressed ? `${n}${arm && !arm.buttons[n] ? '(無視)' : ''}` : null)).filter((x) => x != null).join(' ');
      lines.push(`ゲームパッド${g.index}: ${g.id}${used ? '' : '(使わない)'} / 軸 ${axes || 'なし'} / 押しているボタン ${btns || 'なし'}`);
    }
    if (this.touch) {
      const s = this.touch.state;
      lines.push(`タッチ: 左 ${f(s.l)} 右 ${f(s.r)} なぞり ${f(s.swipe)} 押している ${Object.keys(this.touch.held).filter((k) => this.touch.held[k]).join(' ') || 'なし'}`);
    }
    if (this.keys.size) lines.push(`押しているキー: ${[...this.keys].join(' ')}`);
    return lines.join('\n');
  }

  get wheelBound() {
    const b = this.wheelCfg.bindings;
    return !!(b.clutch || b.throttle || b.brake);
  }

  // 毎フレーム1回呼ぶ
  poll(dt) {
    const a = emptyActions();
    const k = (c) => this.keys.has(c);
    const p = (c) => this.pressed.has(c);
    const S = this.settings;

    // ---------------- キーボード+マウス
    let kl = 0, kr = 0, kt = 0;
    if (S.scheme === 'easy') {
      const thr = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
      const turn = (k('KeyA') ? 1 : 0) - (k('KeyD') ? 1 : 0);
      const t = arcadeToTracks(thr, turn * 0.8);
      kl = t.left; kr = t.right;
      kt = (k('ArrowLeft') || k('KeyQ') ? 1 : 0) - (k('ArrowRight') || k('KeyE') ? 1 : 0);
    } else {
      // 左手 W/S = 左の履帯、右手 ↑/↓ か I/K = 右の履帯
      kl = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
      kr = (k('ArrowUp') || k('KeyI') ? 1 : 0) - (k('ArrowDown') || k('KeyK') ? 1 : 0);
      kt = (k('ArrowLeft') || k('KeyJ') || k('KeyQ') ? 1 : 0) - (k('ArrowRight') || k('KeyL') || k('KeyE') ? 1 : 0);
    }
    if (this.mouse.locked && S.mouseTurret) {
      kt += clamp(-this.mouse.dx * 0.06 * S.mouseSens, -1, 1);
    }
    this.mouse.dx = 0;
    a.left = kl; a.right = kr; a.turret = clamp(kt, -1, 1);
    a.fire = p('Space') || this.mouse.clicked[0];
    a.sub = k('KeyF') || k('ShiftLeft') || this.mouse.down[2];
    a.subPress = p('KeyF') || p('ShiftLeft') || this.mouse.clicked[2];
    a.subSelect = p('Tab');
    if (p('Digit1')) this.gearKb = 1;
    if (p('Digit2')) this.gearKb = 2;
    if (p('Digit3')) this.gearKb = 3;
    if (p('Digit4')) this.gearKb = 'R';
    a.gear = this.gearKb;
    a.lob = k('KeyR');
    a.pitchStep = (p('BracketLeft') || p('PageUp') ? 1 : 0) - (p('BracketRight') || p('PageDown') ? 1 : 0);
    a.view = p('KeyV');
    a.hatch = p('KeyH');
    a.crouch = k('KeyC');
    a.quickTurn = p('KeyX');
    a.quickDir = a.turret < 0 ? -1 : 1;
    a.weaponSwap = p('KeyG');
    a.pause = p('Escape') || p('KeyP');
    a.recenter = p('KeyZ');
    a.up = p('ArrowUp') || p('KeyW');
    a.down = p('ArrowDown') || p('KeyS');
    a.leftUi = p('ArrowLeft') || p('KeyA');
    a.rightUi = p('ArrowRight') || p('KeyD');
    a.ok = p('Enter') || p('Space');
    a.back = p('Escape') || p('Backspace');
    this.mouse.clicked = [false, false, false];

    // ---------------- ゲームパッド(標準配置)
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((g) => g && g.mapping === 'standard' && !SIM_DEVICE.test(g.id)) : [];
    pads.forEach((g, i) => {
      const prev = this.padPrev[i] || [];
      // 止まっているときに軸が中央(0)にない機器や、押しっぱなしに見えるボタンを、倒しっぱなし・押しっぱなしと取り違えない。
      // 軸は一度中央に戻るのを見てから、ボタンは一度離れるのを見てから使う(スマホが内蔵の機器をゲームパッドとして見せることがある)
      const key = `${g.index}:${g.id}`;
      const arm = (this.padArm[key] ||= { axes: [], buttons: [] });
      g.axes.forEach((v, n) => { if (Math.abs(v) < 0.2) arm.axes[n] = true; });
      g.buttons.forEach((b, n) => { if (!b.pressed && (b.value ?? 0) < 0.2) arm.buttons[n] = true; });
      const btn = (n) => !!arm.buttons[n] && (g.buttons[n]?.value ?? 0) > 0.5;
      const edge = (n) => btn(n) && !prev[n];
      const ax = g.axes.map((v, n) => (arm.axes[n] ? dz(v) : 0));
      const any = ax.some((v) => v !== 0) || g.buttons.some((b, n) => btn(n));
      if (any) this.active = 'gamepad';
      if (S.scheme === 'easy') {
        const t = arcadeToTracks(-ax[1], -ax[0] * 0.8);
        merge(a, 'left', t.left); merge(a, 'right', t.right);
        merge(a, 'turret', -ax[2]);
      } else {
        // 左スティック前後 = 左履帯、右スティック前後 = 右履帯、砲塔は LB/RB か右スティック左右
        merge(a, 'left', -ax[1]);
        merge(a, 'right', -ax[3]);
        const tt = (btn(4) ? 1 : 0) - (btn(5) ? 1 : 0) + (Math.abs(ax[2]) > 0.5 ? -ax[2] : 0);
        merge(a, 'turret', clamp(tt, -1, 1));
      }
      if (edge(7)) a.fire = true; // RT
      if (btn(6)) a.sub = true; // LT
      if (edge(6)) a.subPress = true;
      if (btn(0)) a.lob = true; // A(押している間、逆立ち)
      if (edge(1)) a.subSelect = true; // B
      if (edge(2)) a.view = true; // X
      if (edge(3)) a.weaponSwap = true; // Y
      if (edge(12)) a.pitchStep += 1;
      if (edge(13)) a.pitchStep -= 1;
      if (edge(14)) this.gearKb = this.gearKb === 'R' ? 'R' : this.gearKb === 1 ? 'R' : this.gearKb - 1;
      if (edge(15)) this.gearKb = this.gearKb === 'R' ? 1 : Math.min(3, this.gearKb + 1);
      a.gear = this.gearKb;
      if (btn(10)) a.crouch = true;
      if (edge(11)) { a.quickTurn = true; a.quickDir = a.turret < 0 ? -1 : 1; }
      if (edge(9)) a.pause = true;
      if (edge(8)) a.recenter = true; // BACK / SELECT
      // メニュー
      if (edge(12) || (ax[1] < -0.6 && !(prev.ay < -0.6))) a.up = true;
      if (edge(13) || (ax[1] > 0.6 && !(prev.ay > 0.6))) a.down = true;
      if (edge(14) || (ax[0] < -0.6 && !(prev.ax < -0.6))) a.leftUi = true;
      if (edge(15) || (ax[0] > 0.6 && !(prev.ax > 0.6))) a.rightUi = true;
      if (edge(0)) a.ok = true;
      if (edge(1)) a.back = true;
      const st = g.buttons.map((b) => b.value > 0.5);
      st.ax = ax[0]; st.ay = ax[1];
      this.padPrev[i] = st;
    });

    // ---------------- ハンコン(ffb-bridge 経由)
    this.wheel = null;
    if (this.bridge?.live && this.wheelBound) {
      const w = readWheel(this.bridge.pads, this.wheelCfg);
      this.wheel = w;
      const wa = wheelToActions(w, this.wheelCfg, this.wheelState);
      const moving = Math.abs(wa.left) > 0.05 || Math.abs(wa.right) > 0.05 || Math.abs(w.steer) > 0.08 || wa.fire;
      if (moving) this.active = 'wheel';
      merge(a, 'left', wa.left); merge(a, 'right', wa.right); merge(a, 'turret', wa.turret);
      for (const key of ['fire', 'sub', 'subPress', 'subSelect', 'view', 'pause', 'recenter', 'quickTurn', 'weaponSwap', 'crouch', 'up', 'down', 'ok', 'back']) a[key] = a[key] || wa[key];
      if (wa.fire) a.fireStrength = wa.fireStrength;
      a.pitchStep += wa.pitchStep;
      if (w.hasShifter) a.gear = wa.gear;
      if (wa.lob) { a.lob = true; a.lobAmount = wa.lobAmount; a.lobAnalog = wa.lobAnalog; }
      if (wa.quickTurn) a.quickDir = wa.quickDir;
    } else if (this.active === 'wheel' && this.wheelBound) {
      // ハンコンを使っていて通信が途切れたら、履帯を 0 にして止める
      a.left = 0; a.right = 0;
    }

    // ---------------- タッチ(スマホ・タブレット)
    if (this.touch?.visible) {
      const t = this.touch.poll();
      if (t.activity) this.active = 'touch';
      merge(a, 'left', t.left); merge(a, 'right', t.right); merge(a, 'turret', t.turret);
      for (const key of ['fire', 'sub', 'subPress', 'lob', 'view', 'pause']) a[key] = a[key] || t[key];
      if (t.gear !== this.touchGear) { this.touchGear = t.gear; this.gearKb = t.gear; a.gear = t.gear; }
    }

    // ---------------- VR
    if (this.xr) {
      const x = this.xr;
      if (x.activity) this.active = 'xr';
      merge(a, 'left', x.left); merge(a, 'right', x.right); merge(a, 'turret', x.turret);
      // 頭の向きで砲塔を回すのは VR コントローラーのときだけ(ハンコンのときはハンドルで回す)
      if (x.turretYaw != null && !this.wheel) a.turretYaw = x.turretYaw;
      for (const key of ['fire', 'sub', 'subPress', 'subSelect', 'view', 'pause', 'recenter', 'quickTurn', 'weaponSwap', 'crouch', 'up', 'down', 'ok', 'back', 'leftUi', 'rightUi']) a[key] = a[key] || !!x[key];
      if (x.lob) { a.lob = true; a.lobAmount = x.lobAmount; a.lobAnalog = x.lobAnalog; }
      a.pitchStep += x.pitchStep || 0;
      a.pitchRate += x.pitchRate || 0;
    }

    a.manualPitch = S.manualPitch;
    this.pressed.clear();
    return a;
  }
}

function merge(a, key, v) {
  if (Math.abs(v) > Math.abs(a[key])) a[key] = v;
}

function loadWheel() {
  const d = defaultWheelConfig();
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s) return { ...d, ...s, steer: { ...d.steer, ...s.steer }, pedalCal: { ...s.pedalCal }, bindings: { ...s.bindings } };
  } catch { /* 既定値 */ }
  return d;
}
