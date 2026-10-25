// デバイスブリッジ (vrgame2/ffb-bridge/bridge.py) との通信。TURBO KART VR の ffb.js から流用して手直し
// - ブラウザの Gamepad API は同時に 4 台までしか扱えず、VR の最中はヘッドセットに枠を取られて
//   ハンコンやペダルが見えなくなることがある。ブリッジは PC のすべてのジョイスティックを読んで送ってくれる
// - FFB (力の出力) は、このゲームでは被弾や障害物に当たったときの短い振動と、任意の「中央へ戻すばね」だけ
// - 安全の仕組みはブリッジ側にある (最大出力の頭打ち・急変の抑制・0.25 秒指示が無ければ力を 0 にする)。
//   ゲーム側も、振動が終わったら止める指示を送り、ページを離れるときにも止める
// - ブリッジが無い環境 (Quest 単体・スマートフォン) では接続しにいかない。PC でも、一度もつながったことが無く
//   ハンコンの割り当ても無ければ、ハンコン設定を開くまで接続しない

const URL_DEFAULT = 'ws://127.0.0.1:18765'; // 8765 は Pimax のクライアントなどと衝突するので避ける
const SEEN_KEY = 'skyrunner.wheel.bridgeSeen'; // 一度でもつながった PC では、後からブリッジを起動しても自動でつなぐ
const RETRY_MS = 3000;
const SEND_MS = 16; // FFB の指示は 60Hz 程度に間引く

// スマートフォン・タブレット・単体の VR ヘッドセット (ブリッジを動かせない) か
export function isStandaloneDevice() {
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|OculusBrowser|Quest|Pico|Wolvic|Mobile/i.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1; // iPadOS はデスクトップの UA を名乗る
}

export class DeviceBridge {
  // autoConnect: 起動時からつなぎにいくか (ハンコンを割り当て済みのとき)。
  // まだ一度もつながったことが無く、割り当ても無い PC では、ハンコン設定を開くまで接続しない (失敗のログを出さない)
  constructor({ url = URL_DEFAULT, autoConnect = false } = {}) {
    this.url = url;
    this.ws = null;
    this.status = { connected: false, devices: [], selected: null, error: null };
    this.pads = [];
    this.latch = new Map();
    this.listeners = new Set();
    this.retry = null;
    this.keepTrying = false; // ハンコン設定を開いている間は、つながるまで試し続ける
    this.lastSend = 0;
    this.sentForce = false;
    this.disabled = typeof WebSocket === 'undefined' || isStandaloneDevice();
    try { this.seen = localStorage.getItem(SEEN_KEY) === '1'; } catch (_) { this.seen = false; }
    if (!this.disabled && (this.seen || autoConnect)) this.connect();
    const stop = () => this.stop();
    addEventListener('pagehide', stop);
    addEventListener('beforeunload', stop);
  }

  onStatus(fn) {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) {
      try { fn(this.status); } catch (_) { /* 表示の不具合でゲームを止めない */ }
    }
  }

  // ハンコン設定を開いている間などは、つながるまで試し続ける
  setKeepTrying(on) {
    this.keepTrying = on;
    if (on) this.connect();
  }

  connect() {
    if (this.disabled || this.ws) return;
    clearTimeout(this.retry);
    this.retry = null;
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this.status.error = String(e?.message || e);
      this.emit();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.status.connected = true;
      this.status.error = null;
      if (!this.seen) {
        this.seen = true;
        try { localStorage.setItem(SEEN_KEY, '1'); } catch (_) { /* 保存できない環境 */ }
      }
      this.send({ t: 'hello', app: 'sky-runner', v: 1, input: true });
      this.emit();
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (_) { return; } // 不正なメッセージは無視
      if (m.t === 'input') {
        this.pads = Array.isArray(m.pads) ? m.pads : [];
        // 次に読まれるまでに一度でも押されたボタンを覚えておく (短い押下を取りこぼさない)
        for (const p of this.pads) {
          const key = `${p.index}:${p.id}`;
          const l = this.latch.get(key) || [];
          (p.buttons || []).forEach((v, i) => { if (v > 0.5) l[i] = 1; });
          this.latch.set(key, l);
        }
      } else if (m.t === 'status') {
        this.status.devices = m.devices || [];
        this.status.selected = m.selected || null;
        this.status.error = m.error || null;
        this.emit();
      }
    };
    ws.onclose = () => {
      this.ws = null;
      this.pads = [];
      this.latch.clear();
      this.sentForce = false;
      const was = this.status.connected;
      this.status.connected = false;
      if (!was) this.status.error = 'ブリッジに接続できません (ffb-bridge を起動してください)';
      this.emit();
      // 一度つながったことのある PC か、設定を開いている間だけ、つながるまで試し続ける
      // (ブリッジの無い PC で、接続の失敗を何度もくり返さないように)
      if (this.seen || this.keepTrying) this.retry = setTimeout(() => this.connect(), RETRY_MS);
    };
    ws.onerror = () => { /* onclose で処理する */ };
  }

  get connected() {
    return !!this.ws && this.ws.readyState === 1;
  }

  send(msg) {
    if (!this.connected) return;
    try { this.ws.send(JSON.stringify(msg)); } catch (_) { /* 切断直後など */ }
  }

  // ブリッジ経由の入力デバイス (接続が切れていれば空)
  inputPads() {
    if (!this.connected) return [];
    const pads = this.pads.map((p) => {
      const l = this.latch.get(`${p.index}:${p.id}`);
      const buttons = p.buttons || [];
      return { ...p, axes: p.axes || [], buttons: l ? buttons.map((v, i) => Math.max(v, l[i] || 0)) : buttons };
    });
    this.latch.clear();
    return pads;
  }

  // FFB の指示 (r: 振動の強さ 0..1、hz: 振動の周波数、s: 中央へ戻すばね 0..1)。毎フレーム呼んでよい
  force({ r = 0, hz = 0, s = 0 } = {}) {
    if (!this.connected || !this.status.selected) return;
    const zero = r <= 0 && s <= 0;
    if (zero) {
      if (this.sentForce) this.stop();
      return;
    }
    const now = performance.now();
    if (now - this.lastSend < SEND_MS) return;
    this.lastSend = now;
    this.sentForce = true;
    this.send({ t: 'ffb', c: 0, d: 0, s: round(s), r: round(r), hz: Math.round(hz) });
  }

  stop() {
    this.sentForce = false;
    this.send({ t: 'stop' });
  }

  // 設定画面のテスト (ブリッジ側で 1 秒だけ出す。強さはブリッジの --max でも頭打ちになる)
  test(effect, gain) {
    this.send({ t: 'test', effect, gain: Math.max(0, Math.min(1, gain)) });
  }
}

const round = (v) => Math.round((v || 0) * 1000) / 1000;
