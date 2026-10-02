// FFB ブリッジ（ffb-bridge/bridge.py）との通信。ブラウザ単体では FFB を出せないため、
// PC 上のブリッジが SDL2 経由で DirectInput の FFB（Fanatec / Thrustmaster / CAMMUS / Logitech など）を駆動する
import { FFB_DEFAULTS } from './core/ffbmodel.js';

const URL_DEFAULT = 'ws://127.0.0.1:8765';
const STORE = 'turbokart:ffb';

export class FFBBridge {
  constructor() {
    this.settings = { ...FFB_DEFAULTS, enabled: true, url: URL_DEFAULT, device: null };
    try {
      Object.assign(this.settings, JSON.parse(localStorage.getItem(STORE) || '{}'));
    } catch {
      // 既定値のまま
    }
    this.ws = null;
    this.status = { connected: false, devices: [], selected: null, error: null };
    this.listeners = new Set();
    this.lastSend = 0;
    this.retry = null;
    if (this.settings.enabled) this.connect();
  }

  save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(this.settings));
    } catch {
      // 保存できない環境
    }
  }

  onStatus(fn) {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.status);
  }

  connect() {
    clearTimeout(this.retry);
    if (this.ws) return;
    let ws;
    try {
      ws = new WebSocket(this.settings.url);
    } catch (e) {
      this.status.error = String(e);
      this.emit();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.status.connected = true;
      this.status.error = null;
      this.send({ t: 'hello', app: 'turbo-kart', v: 1 });
      if (this.settings.device) this.send({ t: 'select', device: this.settings.device });
      this.emit();
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.t === 'status') {
          this.status.devices = m.devices || [];
          this.status.selected = m.selected || null;
          this.status.error = m.error || null;
          this.emit();
        }
      } catch {
        // 不正なメッセージは無視
      }
    };
    ws.onclose = () => {
      this.ws = null;
      const was = this.status.connected;
      this.status.connected = false;
      if (was) this.emit();
      // ブリッジを後から起動しても繋がるよう再接続を続ける
      if (this.settings.enabled) this.retry = setTimeout(() => this.connect(), 3000);
    };
    ws.onerror = () => {
      this.status.error = 'ブリッジに接続できません（ffb-bridge を起動してください）';
    };
  }

  disconnect() {
    clearTimeout(this.retry);
    this.stop();
    this.ws?.close();
    this.ws = null;
  }

  setEnabled(on) {
    this.settings.enabled = on;
    this.save();
    if (on) this.connect();
    else this.disconnect();
  }

  selectDevice(name) {
    this.settings.device = name;
    this.save();
    this.send({ t: 'select', device: name });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  // 毎フレーム呼ぶ（送信は 60Hz に間引く）
  update(out) {
    if (!this.settings.enabled) return;
    const now = performance.now();
    if (now - this.lastSend < 15) return;
    this.lastSend = now;
    this.send({ t: 'ffb', c: round(out.constant), d: round(out.damper), s: round(out.spring), r: round(out.rumble), hz: Math.round(out.rumbleHz || 0) });
  }

  stop() {
    this.send({ t: 'stop' });
  }

  test(effect) {
    this.send({ t: 'test', effect, gain: this.settings.gain });
  }
}

const round = (v) => Math.round((v || 0) * 1000) / 1000;
