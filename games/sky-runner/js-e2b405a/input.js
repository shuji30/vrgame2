// 入力層: VR コントローラー / コントロールパッド / キーボード・マウス / タッチ / ハンコン (src/wheel/) を
// 共通の操作 (移動・速度・射撃・視点・ポーズなど) に変換する

const DZ = 0.18;
const dz = (v) => (Math.abs(v) < DZ ? 0 : (v - Math.sign(v) * DZ) / (1 - DZ));
const clamp1 = (v) => Math.max(-1, Math.min(1, v));

// Gamepad API の standard マッピング (Xbox 系)
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LSTICK: 10, RSTICK: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
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
  xr: 'トリガー: 機関砲   右グリップ/A: ミサイル (見た敵をロック)   左スティック: 移動   B/Y: 視点',
  pad: 'A/RB: 機関砲   X/LB: ミサイル   左スティック: 移動   Y: 視点   START: ポーズ',
  kb: 'Space: 機関砲   F: ミサイル   WASD: 移動   V: 視点   Esc: ポーズ',
  mouse: '左クリック: 機関砲   右クリック/F: ミサイル   マウス: 移動   V: 視点',
  touch: '左: スティックで移動   右下: 射撃 (長押し)・ミサイル',
  wheel: 'ハンドル: 左右   クラッチ (2 ペダルはパドル): 高さ   ボタン: 機関砲・ミサイル・視点・ポーズ',
};

// ハンコン・ペダル・シフターなどのシム機器 (名前で見分ける)。割り当てたときだけハンコンとして読み、普通のパッドとしては読まない
// (ペダルは離した状態で軸が -1 などになり、スティックを倒しっぱなしと取り違えて左右や上下が効かなくなるため)
const SIM_DEVICE = /wheel|pedal|fanatec|thrustmaster|logitech g(2|9)|driving force|moza|simagic|simucube|cammus|heusinkveld|asetek|vrs|t300|t150|t248|t818|tmx|csl|clubsport|podium|shifter|handbrake|sim /i;

export class Input {
  constructor(dom) {
    this.controllers = []; // XR コントローラー (userData.src に XRInputSource)
    this.keys = new Set();
    this.keyEdges = new Set();
    this.clicked = false;
    this.mouse = { x: 0, y: 0, down: false, active: false };
    this.prevButtons = new Map();
    this.prevDir = new Map();
    this.padRest = new Map(); // パッドごとの、最初に見えたときの軸の値 (止まっていても端にある軸を見分ける)
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
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('mousedown', (e) => {
      if (e.button === 2) this.rightClicked = true;
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
      altitude: null,       // 高さの絶対値 0 (地面) .. 1 (最高高度)。ハンコンのクラッチを使っているときのみ
      lift: 0,              // 上下の入力のうち、上下反転の設定を効かせないもの (ハンコンのパドル。+ が上)
      throttle: 0,          // -1 (ブレーキ) .. +1 (アクセル)。今はゲームでは使っていない (加速・減速はなくした)
      fire: false,          // パッド / キーボード / マウスの射撃
      missile: false,       // ミサイル (押した瞬間だけ true)
      handFire: [],         // [{controller, fire}] VR コントローラーごとの射撃
      view: false, pause: false, confirm: false, back: false, debug: false, recenter: false, // 押した瞬間だけ true
      leftRight: 0,         // パッドの左右を倒した瞬間 (-1 / +1)。タイトル画面の選択用
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
    if (e('KeyF')) s.missile = true;
    if (e('KeyC')) s.recenter = true;
    this.keyEdges.clear();

    // ---- マウス
    if (this.mouse.active) s.abs = { x: this.mouse.x, y: this.mouse.y };
    if (this.mouse.down) s.fire = true;
    if (this.clicked) s.confirm = true;
    if (this.rightClicked) s.missile = true;
    this.clicked = false;
    this.rightClicked = false;

    // ---- コントロールパッド (Gamepad API)。WebXR のコントローラーはここには出てこない
    this.debug.pads = [];
    const wheel = this.wheel;
    // ハンコンの割り当ての学習中は、パッドとハンコンをゲームの操作として読まない (ボタンを押して出撃しないように)
    const pads = wheel?.busy ? [] : navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      // 割り当て済みのハンコンは、下のハンコンの処理で読む (ハンドルの軸が左右の移動に二重に入らないように)
      if (wheel?.hasBindings() && wheel.claims(gp.id)) {
        this.debug.pads.push({ id: gp.id, mapping: '(ハンコンとして読む)', axes: [...gp.axes], buttons: gp.buttons.map((b) => b.value) });
        continue;
      }
      const std = gp.mapping === 'standard';
      // 割り当てていないハンコン・ペダルは読まない (標準の並びでないシム機器)
      if (!std && SIM_DEVICE.test(gp.id)) {
        this.debug.pads.push({ id: gp.id, mapping: '(ハンコン・ペダル: ハンコン設定で割り当てると使える)', axes: [...gp.axes], buttons: gp.buttons.map((b) => b.value) });
        continue;
      }
      // 標準の並びでない機器は、止まっていても端 (±1 近く) にある軸をスティックとして読まない
      const key = gp.index + ':' + gp.id;
      if (!this.padRest.has(key)) this.padRest.set(key, [...gp.axes]);
      const rest = this.padRest.get(key);
      const axis = (i) => (std || Math.abs(rest[i] ?? 0) < 0.5 ? dz(gp.axes[i] ?? 0) : 0);
      const btn = gp.buttons.map((b) => b.pressed);
      const ed = this.edges('pad' + gp.index, btn);
      let x = axis(0), y = axis(1);
      if (std) { // 十字キーのボタン番号は、標準の並びのときだけ当てにする
        if (pressed(gp, PAD.LEFT)) x = -1;
        if (pressed(gp, PAD.RIGHT)) x = 1;
        if (pressed(gp, PAD.UP)) y = -1;
        if (pressed(gp, PAD.DOWN)) y = 1;
      }
      const th = value(gp, PAD.RT) - value(gp, PAD.LT);
      if (x || y) {
        s.move.x += x;
        s.move.y -= y;
        this.mouse.active = false;
        s.abs = null;
      }
      if (Math.abs(th) > 0.05) s.throttle += th;
      if (pressed(gp, PAD.A) || pressed(gp, PAD.RB)) s.fire = true;
      if (ed(PAD.X) || ed(PAD.LB)) s.missile = true;
      if (ed(PAD.Y)) s.view = true;
      if (ed(PAD.START)) s.pause = true;
      if (ed(PAD.A) || ed(PAD.START)) s.confirm = true;
      if (ed(PAD.B)) s.back = true;
      if (ed(PAD.BACK)) s.debug = true;
      if (ed(PAD.RSTICK)) s.recenter = true;
      // 左右を倒した瞬間 (十字キーかスティック)
      const dir = x < -0.5 ? -1 : x > 0.5 ? 1 : 0;
      const prevDir = this.prevDir.get(gp.index) || 0;
      if (dir && dir !== prevDir) s.leftRight = dir;
      this.prevDir.set(gp.index, dir);
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
      // 左利きの設定では、左右の手の役割を入れかえる (移動は右手、アクセルとミサイルは左手)
      const hand = this.leftHanded ? ({ left: 'right', right: 'left' }[src.handedness] || src.handedness) : src.handedness;
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
      if (hand === 'right' && ed(XR.SQUEEZE)) s.missile = true; // 右グリップ: ミサイル
      if (hand === 'left' && ed(XR.STICK)) s.debug = true;      // 左スティック押し込み: 入力の確認表示
      if (hand === 'left' && ed(XR.BTN_1)) s.pause = true;      // X
      if (hand === 'right' && ed(XR.BTN_1)) { s.back = true; s.missile = true; } // A (ポーズ中はタイトルへ、プレイ中はミサイル)
      if (hand === 'right' && ed(XR.STICK)) s.recenter = true;  // 右スティック押し込み: 位置を合わせ直す
      if (trig || st.x || st.y) this.lastSource = 'xr';
      this.debug.xr.push({
        hand, profiles: (src.profiles || []).join(', '),
        axes: [...gp.axes], buttons: gp.buttons.map((b) => b.value),
      });
    }

    // ---- タッチ (スマートフォン)
    const t = this.touch;
    if (t && !t.root.hidden) {
      if (t.move.x || t.move.y) {
        s.move.x += t.move.x;
        s.move.y += t.move.y;
        this.mouse.active = false;
        s.abs = null;
      }
      if (t.fire) s.fire = true;
      if (t.takeEdge('missile')) s.missile = true;
      if (t.takeEdge('view')) s.view = true;
      if (t.takeEdge('pause')) s.pause = true;
      if (t.move.x || t.move.y || t.fire) this.lastSource = 'touch';
    }

    // ---- ハンコン (ハンドル + ペダル。ブラウザが直接読むか、デバイスブリッジ経由)
    const w = wheel?.read();
    if (w) {
      const ed = this.edges('wheel', w.held);
      s.move.x += w.steer;
      s.throttle += w.throttle - w.brake;
      // 2 ペダルの機種: パドルの右 = 上昇・左 = 下降 (押している間)
      s.lift = (w.held.up ? 1 : 0) - (w.held.down ? 1 : 0);
      // 3 ペダルの機種: クラッチの踏み込み量 = 高さ。ほかの入力で上下を操作している間は、そちらを優先する
      if (w.clutch != null && !s.move.y && !s.lift && !(this.mouse.active && !w.touched)) s.altitude = w.clutch;
      if (w.held.fire) s.fire = true;
      if (ed('fire')) s.confirm = true;
      if (ed('missile')) s.missile = true;
      if (ed('view')) s.view = true;
      if (ed('pause')) s.pause = true;
      if (ed('back')) s.back = true;
      if (ed('recenter')) s.recenter = true;
      if (w.touched) {
        this.mouse.active = false;
        s.abs = null;
        this.lastSource = 'wheel';
      }
    }
    wheel?.updateForce();

    s.move.x = clamp1(s.move.x);
    s.move.y = clamp1(s.move.y);
    s.lift = clamp1(s.lift);
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
    this.wheel?.rumble(strength, ms); // ハンコン (デバイスブリッジ経由の FFB)
  }
}
