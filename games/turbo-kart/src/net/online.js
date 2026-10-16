// オンライン対戦: サーバー（server/api.php）でルームに集まり、WebRTC でプレイヤー同士が直接つながる
//   SignalClient … ルームの作成・参加・ポーリング・メッセージ送信（HTTP）
//   Mesh         … 全員と WebRTC のデータチャネルでつながる（最大 10 人）
//   OnlineSession… ロビー・時計合わせ・スタートの同期・走行データのやり取り

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
// つながらない相手をつなぎ直すまでの時間（回数ごとに少しずつ延ばす）
const RETRY_MS = 9000;
// この回数つなぎ直してもつながらない相手とは、サーバー経由の中継でやり取りする（直接つながらない回線どうし）
const RELAY_AFTER = 2;
// 確認用: URL に ?relay=1 を付けると、直接つながずに最初から中継でやり取りする
const FORCE_RELAY = typeof location !== 'undefined' && new URLSearchParams(location.search).get('relay') === '1';

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
    this.peers = new Map(); // id → { pc, state, ctl, open, born, tries, relay }
    // 中継で送るもの（OnlineSession がまとめてサーバーへ送る）。走行データは相手ごとに最新だけ
    this.relayOut = [];
    this.relayLatest = new Map();
    // サーバーから TURN（中継サーバー）が届いたら足す
    this.ice = STUN;
  }

  setIce(extra) {
    if (Array.isArray(extra) && extra.length) this.ice = [...STUN, ...extra];
  }

  // つなぎ直した回数（0 = 1 回目の接続中）
  tries(id) {
    return this.peers.get(id)?.tries || 0;
  }

  get self() {
    return this.signal.peer;
  }

  sync(ids) {
    for (const id of ids) if (id !== this.self && !this.peers.has(id)) this.connect(id);
    for (const id of [...this.peers.keys()]) if (!ids.includes(id)) this.drop(id);
    // つながらないまま時間がたった・失敗した相手は、offer を出す側がつなぎ直す
    // （offer の取りこぼしや、通り道の選び方の失敗からも戻れる）
    const now = performance.now();
    for (const [id, p] of this.peers) {
      if (p.open || p.relay || this.self > id) continue;
      if (p.tries >= RELAY_AFTER || FORCE_RELAY) {
        // 直接はあきらめて中継に切り替える（相手にも知らせる）
        this.startRelay(id);
        this.signal.send(id, { t: 'relay-on' }).catch(() => {});
        continue;
      }
      const failed = ['failed', 'closed', 'disconnected'].includes(p.pc.connectionState);
      if (failed || now - p.born > RETRY_MS * (1 + Math.min(p.tries, 3) * 0.5)) this.reconnect(id);
    }
  }

  startRelay(id) {
    const p = this.peers.get(id);
    if (!p || p.relay) return;
    p.relay = true;
    this.onChange?.();
  }

  // 中継中の相手がいるか
  get relaying() {
    for (const p of this.peers.values()) if (p.relay && !p.open) return true;
    return false;
  }

  // 中継で送るものを取り出す（走行データは最新だけ）
  takeRelay() {
    const out = this.relayOut.splice(0);
    for (const m of this.relayLatest.values()) out.push(m);
    this.relayLatest.clear();
    return out;
  }

  reconnect(id) {
    const tries = (this.peers.get(id)?.tries || 0) + 1;
    this.drop(id);
    this.connect(id, tries);
  }

  connect(id, tries = 0) {
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const p = { pc, state: null, ctl: null, open: false, pending: [], born: performance.now(), tries, relay: false };
    this.peers.set(id, p);
    pc.onicecandidate = (e) => { if (e.candidate) this.signal.send(id, { t: 'ice', c: e.candidate.toJSON() }).catch(() => {}); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { p.open = false; this.onChange?.(); }
    };
    pc.ondatachannel = (e) => this.bind(id, p, e.channel);
    if (this.self < id && !FORCE_RELAY) {
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
    if (data.t === 'r') return this.onMessage(from, data.m); // 中継で届いたゲームのデータ
    if (!this.peers.has(from)) this.connect(from);
    if (data.t === 'relay-on') return this.startRelay(from);
    // 相手がつなぎ直してきた（新しい offer）: こちらも作り直してから受ける
    if (data.t === 'offer') {
      const old = this.peers.get(from);
      if (old.pc.remoteDescription || old.pc.signalingState !== 'stable') {
        const tries = old.tries + 1;
        const relay = old.relay;
        this.drop(from);
        this.connect(from, tries);
        this.peers.get(from).relay = relay;
      }
    }
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

  // 直接つながっているか、中継でやり取りできる
  isOpen(id) {
    const p = this.peers.get(id);
    return !!(p?.open || p?.relay);
  }

  // 中継中（直接はつながっていない）
  isRelayed(id) {
    const p = this.peers.get(id);
    return !!(p && !p.open && p.relay);
  }

  // reliable: 順序保証・再送あり（ctl）。false: 最新だけ届けばよい走行データ（state）
  send(id, msg, reliable = false) {
    const p = this.peers.get(id);
    if (p && !p.open && p.relay) {
      const m = { to: id, data: { t: 'r', m: msg } };
      if (reliable) this.relayOut.push(m);
      else this.relayLatest.set(`${id}:${msg.t}`, m);
      return;
    }
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
    this.char = null; // 自分のキャラクター
    this.chars = new Map(); // id → 他の参加者のキャラクター
    this.helloSent = new Set();
    this.itemState = null; // ホストから届いたアイテムの状態（最新）
    this.itemUses = []; // ホスト: 参加者からのアイテム使用 [{ from, back }]
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

  // サーバーの TURN（中継サーバー）の設定を受け取る（無ければ STUN だけで直接つなぐ）
  async loadIce() {
    try {
      const h = await this.signal.health();
      this.mesh.setIce(h.ice);
      this.relay = Array.isArray(h.ice) && h.ice.length > 0;
    } catch { /* 取れなければ STUN だけ */ }
  }

  async create(name) {
    await this.loadIce();
    await this.signal.create(name);
    this.host = this.self;
    this.begin();
  }

  async join(room, name) {
    await this.loadIce();
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
      // ロビーでは素早く、レース中はゆっくり（在室確認と途中接続のため）。
      // 人数が多いときはサーバーへの問い合わせが増えすぎないよう間隔を広げる（10 人で 0.7 秒）
      const crowd = Math.max(1, this.players.length / 5);
      this.timer = setTimeout(loop, (this.state === 'racing' ? 1500 : 350) * crowd);
    };
    loop();
    // 中継: 中継中の相手がいる間は、送るものと届いたものを 0.12 秒ごとにまとめてやり取りする
    clearTimeout(this.relayTimer);
    const relayLoop = async () => {
      if (this.state === 'idle') return;
      if (this.mesh.relaying) {
        try {
          const r = await this.signal.call('relay', { msgs: this.mesh.takeRelay() });
          for (const m of r.msgs) await this.mesh.handleSignal(m.from, m.data);
        } catch { /* 次の回に */ }
      }
      this.relayTimer = setTimeout(relayLoop, 120);
    };
    relayLoop();
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
    // つながった相手に、自分のキャラクターを 1 回だけ知らせる
    for (const p of r.players) {
      if (p.id === this.self || this.helloSent.has(p.id) || !this.mesh.isOpen(p.id)) continue;
      this.mesh.send(p.id, { t: 'hello', char: this.char }, true);
      this.helloSent.add(p.id);
    }
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
    const grid = this.players.map((p) => ({ id: p.id, name: p.name, char: p.id === this.self ? this.char : this.chars.get(p.id) }));
    const msg = { t: 'start', at, grid, settings: this.settings, seed: (Math.random() * 1e9) | 0, ...extra };
    this.mesh.broadcast(msg, true);
    await this.signal.update({ state: 'racing' }).catch(() => {});
    this.handleStart(msg);
  }

  handleStart(msg) {
    this.state = 'racing';
    this.remote.clear();
    this.itemState = null;
    this.itemUses.length = 0;
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
      case 'items': // ホストが配るアイテムの状態
        if (id === this.host) this.itemState = m;
        break;
      case 'use': // 参加者がアイテムを使った
        if (this.isHost) this.itemUses.push({ from: id, back: !!m.back });
        break;
      case 'hello':
        if (typeof m.char === 'string') this.chars.set(id, m.char.slice(0, 16));
        break;
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

  sendItems(snap) {
    this.mesh.broadcast({ t: 'items', ...snap });
  }

  sendUse(back) {
    if (this.host && this.host !== this.self) this.mesh.send(this.host, { t: 'use', back }, true);
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
