// TURBO KART (vrgame2/games/turbo-kart/src/net/online.js) から写した、ゲームに依らない通信の部品。
// 直すときは、TURBO KART のほうも同じように直すか確かめる
// オンライン対戦: サーバー（server/api.php）でルームに集まり、WebRTC でプレイヤー同士が直接つながる
//   SignalClient … ルームの作成・参加・ポーリング・メッセージ送信（HTTP）
//   Mesh         … 全員と WebRTC のデータチャネルでつながる（最大 10 人）
//   (TURBO KART の OnlineSession にあたるものは、SKY RUNNER 用に session.js で書いている)

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

