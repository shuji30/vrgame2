// 入力層: VR コントローラー / コントロールパッド / キーボード・マウスを
// 共通の操作 (移動・速度・射撃・視点・ポーズなど) に変換する

const DZ = 0.18;
const dz = (v) => (Math.abs(v) < DZ ? 0 : (v - Math.sign(v) * DZ) / (1 - DZ));
const clamp1 = (v) => Math.max(-1, Math.min(1, v));

// Gamepad API の standard マッピング (Xbox 系)
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
// WebXR の xr-standard マッピング
const XR = { TRIGGER: 0, SQUEEZE: 1, TOUCHPAD: 2, STICK: 3, BTN_1: 4, BTN_2: 5 };

const pressed = (gp, i) => !!gp.buttons[i]?.pressed;
const value = (gp, i) => gp.buttons[i]?.value ?? 0;

// スティック (axes[2,3]) を優先し、倒していなければタッチパッド (axes[0,1]) を読む。
// Index / Quest はスティック、Vive ワンドはタッチパッドのみ。
function readXRStick(gp) {
  const a = gp.axes;
  let x = 0, y = 0;
  if (a.length >= 4) { x = a[2]; y = a[3]; }
  if (Math.abs(x) < DZ && Math.abs(y) < DZ && a.length >= 2) { x = a[0]; y = a[1]; }
  return { x: dz(x), y: dz(y) };
}

export const HINTS = {
  xr: '左スティック: 移動   右スティック前後: アクセル/ブレーキ   B/Y: 視点   X: ポーズ',
  pad: '左スティック/十字: 移動   RT/LT: アクセル/ブレーキ   Y: 視点   START: ポーズ',
  kb: 'WASD/矢印: 移動   E/Shift: アクセル   Q/Z: ブレーキ   V: 視点   Esc: ポーズ',
  mouse: 'マウス: 移動   E/Shift: アクセル   Q/Z: ブレーキ   V: 視点   Esc: ポーズ',
};

export class Input {
  constructor(dom) {
    this.controllers = []; // XR コントローラー (userData.src に XRInputSource)
    this.keys = new Set();
    this.keyEdges = new Set();
    this.clicked = false;
    this.mouse = { x: 0, y: 0, down: false, active: false };
    this.prevButtons = new Map();
    this.lastSource = 'kb';
    this.debug = { pads: [], xr: [] };
    this.state = this.blank();

    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.keyEdges.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });
    dom.addEventListener('mousemove', (e) => {
      this.mouse.x = (e.clientX / innerWidth) * 2 - 1;
      this.mouse.y = -((e.clientY / innerHeight) * 2 - 1);
      this.mouse.active = true;
      this.lastSource = 'mouse';
    });
    dom.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.mouse.down = true;
      this.clicked = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.down = false; });
  }

  blank() {
    return {
      move: { x: 0, y: 0 }, // -1..1 (y は上が +)
      abs: null,            // マウスの絶対位置 {x, y} (-1..1)。マウス操作中のみ
      throttle: 0,          // -1 (ブレーキ) .. +1 (アクセル)
      fire: false,          // パッド / キーボード / マウスの射撃
      handFire: [],         // [{controller, fire}] VR コントローラーごとの射撃
      view: false, pause: false, confirm: false, back: false, debug: false, // 押した瞬間だけ true
      source: this.lastSource,
    };
  }

  // ボタン配列の前フレームとの差分から「押した瞬間」を判定する関数を返す
  edges(key, buttons) {
    const prev = this.prevButtons.get(key) || [];
    this.prevButtons.set(key, buttons);
    return (i) => buttons[i] && !prev[i];
  }

  update() {
    const s = this.blank();

    // ---- キーボード
    const k = (...c) => c.some((x) => this.keys.has(x));
    const e = (...c) => c.some((x) => this.keyEdges.has(x));
    const kx = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
    const ky = (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0);
    if (kx || ky) {
      s.move.x += kx;
      s.move.y += ky;
      this.mouse.active = false;
      this.lastSource = 'kb';
    }
    s.throttle += (k('KeyE', 'ShiftLeft', 'ShiftRight') ? 1 : 0) - (k('KeyQ', 'KeyZ') ? 1 : 0);
    if (k('Space')) s.fire = true;
    if (e('KeyV')) s.view = true;
    if (e('Escape', 'KeyP')) s.pause = true;
    if (e('Enter', 'Space')) s.confirm = true;
    if (e('Backspace')) s.back = true;
    if (e('KeyI')) s.debug = true;
    this.keyEdges.clear();

    // ---- マウス
    if (this.mouse.active) s.abs = { x: this.mouse.x, y: this.mouse.y };
    if (this.mouse.down) s.fire = true;
    if (this.clicked) s.confirm = true;
    this.clicked = false;

    // ---- コントロールパッド (Gamepad API)。WebXR のコントローラーはここには出てこない
    this.debug.pads = [];
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const btn = gp.buttons.map((b) => b.pressed);
      const ed = this.edges('pad' + gp.index, btn);
      let x = dz(gp.axes[0] ?? 0), y = dz(gp.axes[1] ?? 0);
      if (pressed(gp, PAD.LEFT)) x = -1;
      if (pressed(gp, PAD.RIGHT)) x = 1;
      if (pressed(gp, PAD.UP)) y = -1;
      if (pressed(gp, PAD.DOWN)) y = 1;
      const th = value(gp, PAD.RT) - value(gp, PAD.LT);
      if (x || y) {
        s.move.x += x;
        s.move.y -= y;
        this.mouse.active = false;
        s.abs = null;
      }
      if (Math.abs(th) > 0.05) s.throttle += th;
      if (pressed(gp, PAD.A) || pressed(gp, PAD.RB)) s.fire = true;
      if (ed(PAD.Y)) s.view = true;
      if (ed(PAD.START)) s.pause = true;
      if (ed(PAD.A) || ed(PAD.START)) s.confirm = true;
      if (ed(PAD.B)) s.back = true;
      if (ed(PAD.BACK)) s.debug = true;
      if (x || y || Math.abs(th) > 0.05 || btn.some(Boolean)) this.lastSource = 'pad';
      this.debug.pads.push({
        id: gp.id, mapping: gp.mapping || '(none)',
        axes: [...gp.axes], buttons: gp.buttons.map((b) => b.value),
      });
    }

    // ---- VR コントローラー: 左手 = 移動、右手 = アクセル/ブレーキ、トリガー = 射撃
    this.debug.xr = [];
    for (const c of this.controllers) {
      const src = c.userData.src;
      const gp = src?.gamepad;
      if (!gp) continue;
      const hand = src.handedness;
      const btn = gp.buttons.map((b) => b.pressed);
      const ed = this.edges('xr' + hand, btn);
      const st = readXRStick(gp);
      if (hand === 'right') {
        s.throttle += -st.y;
      } else {
        s.move.x += st.x;
        s.move.y += -st.y;
      }
      const trig = pressed(gp, XR.TRIGGER);
      s.handFire.push({ controller: c, fire: trig });
      if (ed(XR.TRIGGER)) s.confirm = true;
      if (ed(XR.BTN_2)) s.view = true;                         // B / Y
      if (hand === 'left' && ed(XR.SQUEEZE)) s.view = true;     // Vive ワンド用 (左グリップ)
      if (hand === 'right' && ed(XR.SQUEEZE)) s.debug = true;   // 右グリップ
      if (hand === 'left' && ed(XR.BTN_1)) s.pause = true;      // X
      if (hand === 'right' && ed(XR.BTN_1)) s.back = true;      // A
      if (trig || st.x || st.y) this.lastSource = 'xr';
      this.debug.xr.push({
        hand, profiles: (src.profiles || []).join(', '),
        axes: [...gp.axes], buttons: gp.buttons.map((b) => b.value),
      });
    }

    s.move.x = clamp1(s.move.x);
    s.move.y = clamp1(s.move.y);
    s.throttle = clamp1(s.throttle);
    s.source = this.lastSource;
    this.state = s;
  }

  // 振動 (対応していない機器では何もしない)
  rumble(strength, ms) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      try {
        gp?.vibrationActuator?.playEffect?.('dual-rumble', {
          duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6,
        })?.catch?.(() => {});
      } catch (_) { /* 非対応 */ }
    }
    for (const c of this.controllers) {
      try { c.userData.src?.gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms); } catch (_) { /* 非対応 */ }
    }
  }
}
