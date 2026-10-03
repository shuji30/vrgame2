// オンライン対戦: サーバー（server/api.php）でルームに集まり、WebRTC でプレイヤー同士が直接つながる
//   SignalClient … ルームの作成・参加・ポーリング・メッセージ送信（HTTP）
//   Mesh         … 全員と WebRTC のデータチャネルでつながる（最大 5 人）
//   OnlineSession… ロビー・時計合わせ・スタートの同期・走行データのやり取り

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

export class SignalClient {
  constructor(base) {
    this.base = base;
    this.room = null;
    this.peer = null;
    this.token = null;
  }

  async call(a, body = {}, keepalive = false) {
    const res = await fetch(this.base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a, room: this.room, peer: this.peer, token: this.token, ...body }),
      keepalive, // タブを閉じる途中でも送り切る
    });
    const j = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (!j.ok) throw new Error(j.error || 'error');
    return j;
  }

  async health() {
    const res = await fetch(`${this.base}?a=health`);
    return res.json();
  }

  async create(name) {
    const r = await this.call('create', { name, room: null, peer: null, token: null });
    Object.assign(this, { room: r.room, peer: r.peer, token: r.token });
    return r;
  }

  async join(room, name) {
    const r = await this.call('join', { room: room.toUpperCase(), name, peer: null, token: null });
    Object.assign(this, { room: r.room, peer: r.peer, token: r.token });
    return r;
  }

  poll() { return this.call('poll'); }
  send(to, data) { return this.call('send', { to, data }); }
  update(obj) { return this.call('update', obj); }

  async leave() {
    if (!this.room) return;
    try { await this.call('leave', {}, true); } catch { /* 切断済み */ }
    this.room = this.peer = this.token = null;
  }
}

// 全員と 1 対 1 でつなぐ。ID の小さい方から offer を出す
export class Mesh {
  constructor(signal, onMessage, onChange) {
    this.signal = signal;
    this.onMessage = onMessage;
    this.onChange = onChange;
    this.peers = new Map(); // id → { pc, state, ctl, open }
  }

  get self() {
    return this.signal.peer;
  }

  sync(ids) {
    for (const id of ids) if (id !== this.self && !this.peers.has(id)) this.connect(id);
    for (const id of [...this.peers.keys()]) if (!ids.includes(id)) this.drop(id);
  }

  connect(id) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const p = { pc, state: null, ctl: null, open: false, pending: [] };
    this.peers.set(id, p);
    pc.onicecandidate = (e) => { if (e.candidate) this.signal.send(id, { t: 'ice', c: e.candidate.toJSON() }).catch(() => {}); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { p.open = false; this.onChange?.(); }
    };
    pc.ondatachannel = (e) => this.bind(id, p, e.channel);
    if (this.self < id) {
      this.bind(id, p, pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }));
      this.bind(id, p, pc.createDataChannel('ctl', { ordered: true }));
      pc.createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => this.signal.send(id, { t: 'offer', sdp: pc.localDescription.sdp }))
        .catch(() => {});
    }
  }

  bind(id, p, ch) {
    p[ch.label] = ch;
    ch.onopen = () => {
      p.open = !!(p.ctl && p.ctl.readyState === 'open');
      this.onChange?.();
    };
    ch.onclose = () => { p.open = false; this.onChange?.(); };
    ch.onmessage = (e) => {
      try { this.onMessage(id, JSON.parse(e.data)); } catch { /* 不正なデータは捨てる */ }
    };
  }

  async handleSignal(from, data) {
    if (!data) return;
    if (!this.peers.has(from)) this.connect(from);
    const p = this.peers.get(from);
    const pc = p.pc;
    // 相手の接続情報より先に届いた ICE 候補は取っておく
    const flush = async () => {
      for (const c of p.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    };
    try {
      if (data.t === 'offer') {
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await this.signal.send(from, { t: 'answer', sdp: pc.localDescription.sdp });
        await flush();
      } else if (data.t === 'answer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        await flush();
      } else if (data.t === 'ice') {
        if (pc.remoteDescription) await pc.addIceCandidate(data.c);
        else p.pending.push(data.c);
      }
    } catch {
      // 順序の入れ替わりなどは無視（ICE は再送される）
    }
  }

  drop(id) {
    const p = this.peers.get(id);
    if (!p) return;
    try { p.pc.close(); } catch { /* 閉じ済み */ }
    this.peers.delete(id);
    this.onChange?.();
  }

  isOpen(id) {
    return !!this.peers.get(id)?.open;
  }

  // reliable: 順序保証・再送あり（ctl）。false: 最新だけ届けばよい走行データ（state）
  send(id, msg, reliable = false) {
    const p = this.peers.get(id);
    const ch = reliable ? p?.ctl : p?.state || p?.ctl;
    if (ch && ch.readyState === 'open') ch.send(JSON.stringify(msg));
  }

  broadcast(msg, reliable = false) {
    for (const id of this.peers.keys()) this.send(id, msg, reliable);
  }

  close() {
    for (const id of [...this.peers.keys()]) this.drop(id);
  }
}

export class OnlineSession {
  constructor(base) {
    this.signal = new SignalClient(base);
    this.mesh = new Mesh(this.signal, (id, m) => this.onPeerMessage(id, m), () => this.emit());
    this.players = [];
    this.host = null;
    this.settings = {};
    this.state = 'idle';
    this.listeners = new Set();
    this.offset = 0; // ホストの時計 - 自分の時計 (ms)
    this.bestRtt = Infinity;
    this.remote = new Map(); // id → 最新の走行データ
    this.npcState = null;
    this.onStart = null;
    this.error = null;
  }

  get self() { return this.signal.peer; }
  get isHost() { return this.self && this.self === this.host; }
  get room() { return this.signal.room; }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  // ホスト基準の時刻 (ms)
  hostNow() {
    return performance.now() + (this.isHost ? 0 : this.offset);
  }

  allConnected() {
    return this.players.every((p) => p.id === this.self || this.mesh.isOpen(p.id));
  }

  async create(name) {
    await this.signal.create(name);
    this.host = this.self;
    this.begin();
  }

  async join(room, name) {
    const r = await this.signal.join(room, name);
    this.host = r.host;
    this.begin();
  }

  begin() {
    this.state = 'lobby';
    this.error = null;
    clearTimeout(this.timer);
    const loop = async () => {
      if (this.state === 'idle') return;
      try {
        await this.pollOnce();
      } catch (e) {
        this.error = e.message;
        this.emit();
      }
      // ロビーでは素早く、レース中はゆっくり（在室確認と途中接続のため）
      this.timer = setTimeout(loop, this.state === 'racing' ? 1500 : 350);
    };
    loop();
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (!this.isHost && this.mesh.isOpen(this.host)) this.mesh.send(this.host, { t: 'ping', c: performance.now() }, true);
    }, 1000);
    this.emit();
  }

  async pollOnce() {
    const r = await this.signal.poll();
    this.players = r.players;
    this.host = r.host;
    if (r.settings && Object.keys(r.settings).length) this.settings = r.settings;
    this.mesh.sync(r.players.map((p) => p.id));
    for (const m of r.msgs) await this.mesh.handleSignal(m.from, m.data);
    this.error = null;
    this.emit();
  }

  async setSettings(settings) {
    this.settings = settings;
    if (this.isHost) {
      await this.signal.update({ settings });
      this.mesh.broadcast({ t: 'settings', settings }, true);
    }
    this.emit();
  }

  // ホスト: 全員に 5 秒後のスタートを知らせる
  async startRace(extra = {}) {
    if (!this.isHost) return;
    const at = this.hostNow() + 5000;
    const grid = this.players.map((p) => ({ id: p.id, name: p.name }));
    const msg = { t: 'start', at, grid, settings: this.settings, seed: (Math.random() * 1e9) | 0, ...extra };
    this.mesh.broadcast(msg, true);
    await this.signal.update({ state: 'racing' }).catch(() => {});
    this.handleStart(msg);
  }

  handleStart(msg) {
    this.state = 'racing';
    this.remote.clear();
    this.onStart?.(msg);
    this.emit();
  }

  async backToLobby() {
    this.state = 'lobby';
    if (this.isHost) await this.signal.update({ state: 'lobby' }).catch(() => {});
    this.emit();
  }

  onPeerMessage(id, m) {
    switch (m.t) {
      case 'ping':
        if (this.isHost) this.mesh.send(id, { t: 'pong', c: m.c, h: performance.now() }, true);
        break;
      case 'pong': {
        const now = performance.now();
        const rtt = now - m.c;
        // 往復時間が短いときの測定ほど正確なので、それを採用する
        if (rtt < this.bestRtt * 1.5 || this.bestRtt === Infinity) {
          this.bestRtt = Math.min(this.bestRtt, rtt);
          const est = m.h - (m.c + rtt / 2);
          this.offset = this.offset === 0 ? est : this.offset * 0.8 + est * 0.2;
        }
        this.rtt = rtt;
        break;
      }
      case 'settings':
        this.settings = m.settings;
        this.emit();
        break;
      case 'start':
        if (id === this.host) this.handleStart(m);
        break;
      case 's': // 走行データ
        m.recv = performance.now();
        this.remote.set(id, m);
        break;
      case 'npc': // ホストが走らせている NPC の走行データ
        if (id === this.host) { m.recv = performance.now(); this.npcState = m; }
        break;
      case 'lobby':
        if (id === this.host) this.backToLobby();
        break;
      default:
        break;
    }
  }

  sendState(st) {
    this.mesh.broadcast({ t: 's', ...st });
  }

  sendNpcs(list) {
    this.mesh.broadcast({ t: 'npc', list });
  }

  async leave() {
    this.state = 'idle';
    clearTimeout(this.timer);
    clearInterval(this.pingTimer);
    this.mesh.close();
    await this.signal.leave();
    this.players = [];
    this.emit();
  }
}
