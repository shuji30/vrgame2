// FFB ブリッジ（ffb-bridge/bridge.py）との通信。ブラウザ単体では FFB を出せないため、
// PC 上のブリッジが SDL2 経由で DirectInput の FFB（Fanatec / Thrustmaster / CAMMUS / Logitech など）を駆動する
import { FFB_DEFAULTS } from './core/ffbmodel.js';

// 8765 は Pimax のクライアントなどと衝突するので避ける
const URL_DEFAULT = 'ws://127.0.0.1:18765';
const STORE = 'turbokart:ffb';
// ハンコンごとに覚えておく設定（ハンコンを替えると自動で切り替わる）
export const PROFILE_KEYS = ['gain', 'align', 'road', 'impact', 'damper', 'softLock', 'invert', 'invertHid', 'maxForce'];
const PROFILE_DEFAULTS = { ...FFB_DEFAULTS, invertHid: false, maxForce: 0.6 };

export class FFBBridge {
  constructor() {
    // output: 'bridge'（既定。どのハンコンでも同じ出方）| 'auto'（WebHID の FFB 対応機器があればそれ、なければブリッジ）| 'webhid'
    // maxForce: WebHID で出すときの上限（ブリッジは --max で制限）
    this.settings = { ...FFB_DEFAULTS, enabled: true, url: URL_DEFAULT, device: null, output: 'bridge', maxForce: 0.6 };
    this.hid = null;
    try {
      Object.assign(this.settings, JSON.parse(localStorage.getItem(STORE) || '{}'));
      if (this.settings.url === 'ws://127.0.0.1:8765') this.settings.url = URL_DEFAULT;
      // 以前の既定（自動）のままの人はブリッジへ（1 回だけ。あとで自分で選び直したものはそのまま）
      if (!this.settings.outputV2) {
        if (this.settings.output === 'auto') this.settings.output = 'bridge';
        this.settings.outputV2 = true;
      }
    } catch {
      // 既定値のまま
    }
    this.ws = null;
    this.status = { connected: false, devices: [], selected: null, error: null };
    this.listeners = new Set();
    this.profileListeners = new Set();
    this.settings.profiles ||= {};
    this.lastSend = 0;
    this.retry = null;
    // 入力の中継にも使うので、FFB を切っていても接続は保つ
    this.connect();
  }

  save() {
    // いまのハンコンの設定として覚える
    const name = this.settings.wheel;
    if (name) this.settings.profiles[name] = pick(this.settings, PROFILE_KEYS);
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
    this.syncProfile();
    for (const fn of this.listeners) fn(this.status);
  }

  // 設定がハンコンの切り替えで入れ替わったときに呼ばれる（画面の表示を合わせ直す）
  onProfile(fn) {
    this.profileListeners.add(fn);
    return () => this.profileListeners.delete(fn);
  }

  // FFB を出しているハンコンの名前（出力先がなければ null）
  activeWheel() {
    const w = this.webTarget();
    if (w) return w.device.productName || null;
    if (this.settings.output !== 'webhid' && this.status.connected && this.status.selected) return this.status.selected;
    return null;
  }

  // 出力先のハンコンが変わったら、前のハンコンの設定を保存して、新しいハンコンの設定に切り替える。
  // はじめてのハンコンは、最初の 1 台ならいまの設定をそのまま引き継ぎ、2 台目以降は安全のため既定値から始める
  syncProfile() {
    const name = this.activeWheel();
    if (!name || name === this.settings.wheel) return;
    const profiles = this.settings.profiles;
    const prev = this.settings.wheel;
    if (prev) profiles[prev] = pick(this.settings, PROFILE_KEYS);
    const first = !prev && !Object.keys(profiles).length;
    const known = !!profiles[name];
    if (known) Object.assign(this.settings, PROFILE_DEFAULTS, pick(profiles[name], PROFILE_KEYS));
    else if (!first) Object.assign(this.settings, PROFILE_DEFAULTS);
    this.settings.wheel = name;
    this.save();
    for (const fn of this.profileListeners) fn(name, { isNew: !known });
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
      this.send({ t: 'hello', app: 'turbo-kart', v: 1, input: true });
      if (this.settings.device) this.send({ t: 'select', device: this.settings.device });
      this.emit();
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.t === 'input') {
          this.pads = m.pads || [];
          this.padsAt = performance.now();
          // 次に読まれるまでに一度でも押されたボタンを覚えておく（短い押下を取りこぼさない）
          this.latch ||= new Map();
          for (const p of this.pads) {
            const key = `${p.index}:${p.id}`;
            const l = this.latch.get(key) || [];
            p.buttons.forEach((v, i) => { if (v > 0.5) l[i] = 1; });
            this.latch.set(key, l);
          }
        } else if (m.t === 'status') {
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
      this.pads = [];
      const was = this.status.connected;
      this.status.connected = false;
      if (was) this.emit();
      // ブリッジを後から起動しても繋がるよう再接続を続ける
      this.retry = setTimeout(() => this.connect(), 3000);
    };
    ws.onerror = () => {
      this.status.error = 'ブリッジに接続できません（ffb-bridge を起動してください）';
    };
  }

  // ブリッジ経由の入力デバイス（接続が切れていれば空）
  inputPads() {
    if (!this.ws || this.ws.readyState !== 1) return [];
    const pads = (this.pads || []).map((p) => {
      const l = this.latch?.get(`${p.index}:${p.id}`);
      if (!l) return p;
      return { ...p, buttons: p.buttons.map((v, i) => Math.max(v, l[i] || 0)) };
    });
    this.latch?.clear();
    return pads;
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
    if (!on) this.stop();
  }

  selectDevice(name) {
    this.settings.device = name;
    this.save();
    this.send({ t: 'select', device: name });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  // 力の向きの反転の設定名: WebHID は invertHid、ブリッジは invert
  invertKey() {
    if (!this.webTarget()) return 'invert';
    // WebHID 側を初めて使うときはブリッジ側の設定を引き継ぐ（多くの機種で向きは同じ）
    if (this.settings.invertHid === undefined) this.settings.invertHid = !!this.settings.invert;
    return 'invertHid';
  }

  // WebHID 側の FFB 出力先（なければ null）
  webTarget() {
    if (!this.hid || this.settings.output === 'bridge') return null;
    return this.hid.pidDevice(this.settings.hidDevice)?.pid || null;
  }

  get outputName() {
    const w = this.webTarget();
    if (w) return `WebHID: ${w.device.productName}`;
    if (this.settings.output !== 'webhid' && this.status.connected && this.status.selected) return `ブリッジ: ${this.status.selected}`;
    return null;
  }

  // 毎フレーム呼ぶ（送信は 60Hz に間引く）
  update(out, force = false) {
    if (!this.settings.enabled && !force) return;
    // 力の向きの反転はここで一括（レース・テスト・リセットのどれにも効く）
    // 反転の設定は出力先ごと（WebHID とブリッジでは力の向きの伝わり方が違う）
    if (this.settings[this.invertKey()]) out = { ...out, constant: -out.constant };
    this.lastOut = out;
    this.syncProfile();
    const web = this.webTarget();
    if (web) {
      const mx = Math.max(0, Math.min(1, this.settings.maxForce ?? 0.6));
      if (!web.ready) web.start();
      web.apply({ constant: out.constant * mx, damper: out.damper * mx, spring: (out.spring || 0) * mx, rumble: out.rumble * mx, rumbleHz: out.rumbleHz });
      return;
    }
    if (this.settings.output === 'webhid') return;
    const now = performance.now();
    if (now - this.lastSend < 15) return;
    this.lastSend = now;
    this.send({ t: 'ffb', c: round(out.constant), d: round(out.damper), s: round(out.spring), r: round(out.rumble), hz: Math.round(out.rumbleHz || 0) });
  }

  stop() {
    this.send({ t: 'stop' });
    this.webTarget()?.stop();
  }

  // FFB リセット: 出力先をつなぎ直し、エフェクトを作り直して、短い確認パルスを出す
  async reset() {
    this.stop();
    this.lastOut = null;
    // 出力先が無いとき（ブリッジ未接続で、WebHID の FFB 窓口も未許可）は、機器の選択画面を出して
    // FFB 用の窓口（HID PID）を許可してもらう（ボタンを押した操作の中なので選択画面を出せる）
    if (!this.webTarget() && !this.status.connected && this.hid?.supported && this.settings.output !== 'bridge') {
      try { await this.hid.request(); } catch { /* 選択されなかった */ }
    }
    const web = this.webTarget();
    if (web) {
      await web.reset();
    } else {
      if (!this.ws) this.connect();
      // ブリッジ側でハンコンを開き直す（SDL の FFB エフェクトを作り直す）
      this.send({ t: 'select', device: this.settings.device || this.status.selected || null });
    }
    this.resetAt = performance.now();
    // 0.3 秒だけ弱く右に押して、効いているかを確かめる
    const g = Math.max(0.15, this.settings.gain * 0.5);
    const end = performance.now() + 300;
    clearInterval(this.pulseTimer);
    this.pulseTimer = setInterval(() => {
      if (performance.now() > end) {
        clearInterval(this.pulseTimer);
        this.stop();
        return;
      }
      this.update({ constant: g, damper: 0, spring: 0, rumble: 0, rumbleHz: 0 }, true);
    }, 16);
  }

  // 画面表示用の状態（出力先・送っている力・エラー）
  describe() {
    const web = this.webTarget();
    const target = this.outputName;
    const err = web?.error || (!web && this.status.connected ? this.status.error : null);
    let state;
    if (!this.settings.enabled) state = 'オフ';
    else if (!target) state = this.status.connected ? 'ブリッジ接続中（FFB 機器なし）' : '出力先なし';
    else state = target;
    const c = this.lastOut ? this.lastOut.constant : 0;
    return { state, ok: !!target && this.settings.enabled, force: c, error: err };
  }

  // 1 秒間だけテストの力を出す（WebHID でもブリッジでも同じ経路。反転も効く）
  test(effect) {
    if (!this.settings.enabled) return;
    const g = this.settings.gain;
    const out = { constant: 0, damper: 0, spring: 0, rumble: 0, rumbleHz: 0 };
    if (effect === 'left') out.constant = -0.5 * g;
    else if (effect === 'right') out.constant = 0.5 * g;
    else if (effect === 'rumble') { out.rumble = 0.6 * g; out.rumbleHz = 25; }
    else if (effect === 'center') { out.spring = 0.8 * g; out.damper = 0.3 * g; }
    const end = performance.now() + 1000;
    clearInterval(this.testTimer);
    this.testTimer = setInterval(() => {
      if (performance.now() > end) {
        clearInterval(this.testTimer);
        this.stop();
        return;
      }
      this.lastSend = 0;
      this.update(out);
    }, 16);
  }
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const round = (v) => Math.round((v || 0) * 1000) / 1000;
