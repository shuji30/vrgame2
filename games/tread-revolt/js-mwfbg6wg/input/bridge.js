// ffb-bridge(vrgame2)との通信。ゲーム本体はハンコンを直接扱わず、必ずここを経由する
// ws://127.0.0.1:18765 に JSON。接続後 {"t":"hello","input":true} で入力が届き始める
// FFB は 0.25 秒指示がないと 0 になるので、60Hz 程度で送り続ける
const URL_DEFAULT = 'ws://127.0.0.1:18765';

export class FfbBridge {
  constructor(url = URL_DEFAULT) {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.status = { devices: [], selected: null, error: null };
    this.pads = [];
    this.inputAt = 0;
    this.inputCount = 0;
    this.lastSend = 0;
    this.enabled = true;
    this.listeners = new Set();
    this.retryT = null;
    this.denied = false;
  }

  start() {
    if (this.ws || !this.enabled) return;
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.denied = false;
      this.send({ t: 'hello', app: 'tread-revolt', v: 1, input: true });
      this.emit();
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'input') {
        this.pads = m.pads || [];
        this.inputAt = performance.now();
        this.inputCount++;
      } else if (m.t === 'status') {
        this.status = { ...this.status, ...m };
        this.emit();
      }
    };
    ws.onclose = (ev) => {
      const was = this.connected;
      this.ws = null;
      this.connected = false;
      this.pads = [];
      if (!was && ev.code === 1006) this.denied = true; // 起動していないか、Origin が許可されていない
      this.emit();
      this.scheduleRetry();
    };
    ws.onerror = () => {};
  }

  scheduleRetry() {
    clearTimeout(this.retryT);
    if (!this.enabled) return;
    this.retryT = setTimeout(() => this.start(), 3000);
  }

  stop() {
    this.enabled = false;
    clearTimeout(this.retryT);
    this.ws?.close();
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  // FFB を送る(60Hz に間引く)
  ffb(f) {
    const now = performance.now();
    if (now - this.lastSend < 15) return;
    this.lastSend = now;
    this.send({ t: 'ffb', c: +f.c.toFixed(3), d: +f.d.toFixed(3), s: +f.s.toFixed(3), r: +f.r.toFixed(3), hz: Math.round(f.hz) });
  }

  stopForces() {
    this.send({ t: 'stop' });
  }

  // ブリッジ内蔵のテスト(左右に回す)
  test(effect, gain = 0.5) {
    this.send({ t: 'test', effect, gain });
  }

  rescan() {
    this.send({ t: 'scan', input: true });
  }

  select(device) {
    this.send({ t: 'select', device });
  }

  // 入力が最近届いているか
  get live() {
    return this.connected && performance.now() - this.inputAt < 1500;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }
}
