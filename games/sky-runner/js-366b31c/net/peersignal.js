// ルームの仲介を、レンタルサーバー (server/api.php) の代わりに PeerJS の公開サーバー (無料) とホストのブラウザで行う。
// SKY RUNNER (vrgame4/src/net/peersignal.js) と TURBO KART (vrgame2/games/turbo-kart/src/net/peersignal.js) で同じもの。
// 直すときは両方を同じように直す。
//
// しくみ
//   - ホストは PeerJS の ID「<ゲーム>-<ルームコード>」で待ち受け、ルームの管理役 (在室・設定・状態・メッセージの受け渡し) になる
//   - 参加者はホストへ PeerJS のデータ接続でつながり、ほかの人への接続の合図 (offer / answer / ICE) や中継のデータをホスト経由で送る
//   - プレイヤー同士の本番の通信は、これまでどおり Mesh (mesh.js / online.js) の WebRTC で直接つなぐ
//   - SignalClient (api.php を呼んでいたもの) と同じ呼び方 (create / join / poll / send / update / call('relay') / health / leave) にしてある
// 直接つながらない回線のために、中継サーバー (TURN) は Metered の Open Relay (日本、無料枠 毎月 20GB) を使う。
// 決まりごと
//   - ホストが抜けるとルームはなくなる (api.php のようにホストを引き継がない)
//   - 満員 (MAX_PLAYERS) と、プレイ中 (state が lobby 以外) のルームには入れない

const MAX_PLAYERS = 10;

// Metered の Open Relay の認証情報 (TREAD REVOLT と同じもの。ページに書く前提のもので、知られても無料枠を使われるだけ)
export const TURN_SERVERS = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'turn:jp.relay.metered.ca:80', username: 'd36cfbe295658a712eba91c5', credential: '9rx5miLsiVzc4awl' },
  { urls: 'turn:jp.relay.metered.ca:80?transport=tcp', username: 'd36cfbe295658a712eba91c5', credential: '9rx5miLsiVzc4awl' },
  { urls: 'turn:jp.relay.metered.ca:443', username: 'd36cfbe295658a712eba91c5', credential: '9rx5miLsiVzc4awl' },
  { urls: 'turns:jp.relay.metered.ca:443?transport=tcp', username: 'd36cfbe295658a712eba91c5', credential: '9rx5miLsiVzc4awl' },
];
// 確認用: URL に ?turn=off を付けると中継サーバーを使わない
const TURN_OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('turn') === 'off';
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, ...(TURN_OFF ? [] : TURN_SERVERS)];

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const cleanName = (n) => String(n || 'PLAYER').replace(/[\u0000-\u001f]/g, '').slice(0, 16) || 'PLAYER';

let peerJs = null;
function loadPeerJs() {
  if (typeof window !== 'undefined' && window.Peer) return Promise.resolve();
  peerJs ||= new Promise((ok, ng) => {
    const s = document.createElement('script');
    s.src = new URL('./peerjs.min.js', import.meta.url).href;
    s.onload = ok;
    s.onerror = () => { peerJs = null; ng(new Error('PeerJS を読み込めませんでした')); };
    document.head.appendChild(s);
  });
  return peerJs;
}

// PeerJS のエラーを日本語に
function why(e) {
  const t = e?.type || '';
  if (t === 'peer-unavailable') return 'ルームが見つかりません';
  if (t === 'unavailable-id') return 'そのコードはもう使われています';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return '仲介サーバー (PeerJS) につながりません';
  if (t === 'browser-incompatible') return 'このブラウザは対応していません';
  return e?.message || String(e);
}

export class PeerSignalClient {
  // tag: ゲームごとの名前 (ほかのゲームのルームと混ざらないよう、PeerJS の ID の頭に付ける)
  constructor(tag) {
    this.prefix = `vrgame2-${tag}-`;
    this.room = null;
    this.peer = null; // 自分の ID (Mesh がプレイヤーの ID として使う)
    this.token = null;
    this.p = null; // PeerJS の Peer
    this.isHostSide = false;
    this.inbox = []; // 自分宛てのメッセージ [{ from, data }]
    this.snap = { host: null, players: [], state: 'lobby', settings: {} };
    this.lost = null; // ホストとの接続が切れた理由
    // ホストだけ
    this.conns = new Map(); // id → DataConnection
    this.members = new Map(); // id → { id, name, joined }
  }

  async health() {
    return { ok: true, ice: TURN_OFF ? [] : TURN_SERVERS, time: Date.now() / 1000 };
  }

  peerOpts() {
    const o = { debug: 0, config: { iceServers: ICE } };
    // 確認用: ?peerHost=localhost&peerPort=9000 で、手元に立てた PeerJS のサーバーを使う
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    if (q?.get('peerHost')) Object.assign(o, { host: q.get('peerHost'), port: Number(q.get('peerPort') || 9000), path: q.get('peerPath') || '/', secure: q.get('peerSecure') === '1' });
    return o;
  }

  // ------------------------------------------------------------ ホスト
  async create(name) {
    await loadPeerJs();
    let lastErr = null;
    for (let i = 0; i < 4; i++) {
      const code = newCode();
      try {
        await this.openPeer(this.prefix + code);
        this.room = code;
        this.peer = this.prefix + code;
        this.isHostSide = true;
        this.members.set(this.peer, { id: this.peer, name: cleanName(name), joined: Date.now() / 1000 });
        this.snap = { host: this.peer, players: [], state: 'lobby', settings: {} };
        this.p.on('connection', (c) => this.onClient(c));
        this.refresh();
        return { ok: true, room: code, peer: this.peer, token: null, host: this.peer };
      } catch (e) {
        lastErr = e;
        this.p?.destroy();
        this.p = null;
        if (e?.type !== 'unavailable-id') break;
      }
    }
    throw new Error(`ルームを作れませんでした: ${why(lastErr)}`);
  }

  openPeer(id) {
    return new Promise((ok, ng) => {
      const p = new window.Peer(id, this.peerOpts());
      this.p = p;
      const timer = setTimeout(() => ng(new Error('仲介サーバー (PeerJS) につながりません (時間切れ)')), 15000);
      p.on('open', () => { clearTimeout(timer); ok(); });
      p.on('error', (e) => { clearTimeout(timer); ng(e); });
      // 仲介サーバーとの接続が切れても、つながった相手とはそのまま続けられる。新しい人のためにつなぎ直す
      p.on('disconnected', () => { if (!p.destroyed) setTimeout(() => { try { p.reconnect(); } catch { /* 閉じた */ } }, 1500); });
    });
  }

  onClient(c) {
    c.on('data', (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'join') {
        if (this.members.size >= MAX_PLAYERS) { c.send({ t: 'reject', error: 'room is full' }); return; }
        if (this.snap.state !== 'lobby') { c.send({ t: 'reject', error: 'race in progress' }); return; }
        this.conns.set(c.peer, c);
        this.members.set(c.peer, { id: c.peer, name: cleanName(m.name), joined: Date.now() / 1000 });
        // ルームの様子 (設定を含む) を先に送ってから迎え入れる (参加した直後に設定を確かめるゲームがあるため)
        this.refresh();
        c.send({ t: 'welcome', room: this.room, peer: c.peer, host: this.peer });
        return;
      }
      if (!this.members.has(c.peer)) return;
      if (m.t === 'send') this.deliver(c.peer, String(m.to), m.data);
      else if (m.t === 'relay') for (const x of m.msgs || []) this.deliver(c.peer, String(x.to), x.data);
      else if (m.t === 'leave') this.dropClient(c.peer);
    });
    c.on('close', () => this.dropClient(c.peer));
    c.on('error', () => this.dropClient(c.peer));
  }

  dropClient(id) {
    if (!this.members.has(id) && !this.conns.has(id)) return;
    this.members.delete(id);
    const c = this.conns.get(id);
    this.conns.delete(id);
    try { c?.close(); } catch { /* 閉じ済み */ }
    this.refresh();
  }

  // ホスト: メッセージを宛先へ渡す (自分宛てなら受信箱へ)
  deliver(from, to, data) {
    if (to === this.peer) { this.inbox.push({ from, data }); return; }
    const c = this.conns.get(to);
    if (c?.open) c.send({ t: 'msg', from, data });
  }

  // ホスト: ルームの様子を作り直して全員に配る
  refresh() {
    const players = [...this.members.values()].sort((a, b) => a.joined - b.joined);
    this.snap = { host: this.peer, players, state: this.snap.state, settings: this.snap.settings };
    for (const c of this.conns.values()) if (c.open) c.send({ t: 'room', ...this.snap });
  }

  // ------------------------------------------------------------ 参加者
  async join(room, name) {
    await loadPeerJs();
    const code = String(room || '').trim().toUpperCase();
    if (!/^[A-Z2-9]{4}$/.test(code)) throw new Error('bad room code');
    const myId = `${this.prefix}${code}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      await this.openPeer(myId);
    } catch (e) {
      this.p?.destroy();
      throw new Error(why(e));
    }
    return new Promise((ok, ng) => {
      const fail = (msg) => { clearTimeout(timer); this.p?.destroy(); this.p = null; ng(new Error(msg)); };
      const timer = setTimeout(() => fail('ルームに入れませんでした (時間切れ)'), 15000);
      this.p.on('error', (e) => { if (!this.room) fail(why(e)); });
      const c = this.p.connect(this.prefix + code, { reliable: true, serialization: 'json' });
      this.hostConn = c;
      c.on('open', () => c.send({ t: 'join', name: cleanName(name) }));
      c.on('data', (m) => {
        if (!m || typeof m !== 'object') return;
        if (m.t === 'reject') return fail(m.error === 'room is full' ? `満員です (${MAX_PLAYERS} 人まで)` : m.error === 'race in progress' ? 'プレイ中なので入れません' : m.error);
        if (m.t === 'welcome') {
          clearTimeout(timer);
          this.room = code;
          this.peer = myId;
          this.snap.host = m.host;
          ok({ ok: true, room: code, peer: myId, token: null, host: m.host });
          return;
        }
        if (m.t === 'room') { this.snap = { host: m.host, players: m.players || [], state: m.state || 'lobby', settings: m.settings || {} }; return; }
        if (m.t === 'msg') this.inbox.push({ from: m.from, data: m.data });
      });
      c.on('close', () => { if (this.room) this.lost = 'ホストとの接続が切れました (ルームがなくなりました)'; });
      c.on('error', () => { if (this.room) this.lost = 'ホストとの接続が切れました'; });
    });
  }

  // ------------------------------------------------------------ 共通 (api.php と同じ形で返す)
  async poll() {
    if (this.lost) throw new Error(this.lost);
    if (!this.room) throw new Error('room not found');
    return { ok: true, host: this.snap.host, players: this.snap.players.map((p) => ({ ...p })), state: this.snap.state, settings: { ...this.snap.settings }, msgs: this.inbox.splice(0), time: Date.now() / 1000 };
  }

  async send(to, data) {
    if (this.isHostSide) this.deliver(this.peer, String(to), data);
    else if (this.hostConn?.open) this.hostConn.send({ t: 'send', to, data });
    else throw new Error(this.lost || 'ホストとつながっていません');
    return { ok: true };
  }

  // ホストだけ: 設定 (settings) と状態 (lobby / racing など) を変える
  async update(obj = {}) {
    if (!this.isHostSide) throw new Error('host only');
    if (obj.settings && typeof obj.settings === 'object') this.snap.settings = obj.settings;
    if (typeof obj.state === 'string') this.snap.state = obj.state;
    this.refresh();
    return { ok: true };
  }

  // api.php の「中継」(relay) と同じ: 送るものを宛先へ渡し、自分宛てを受け取る
  async call(a, body = {}) {
    if (a === 'relay') {
      if (this.lost) throw new Error(this.lost);
      const msgs = body.msgs || [];
      if (this.isHostSide) for (const m of msgs) this.deliver(this.peer, String(m.to), m.data);
      else if (msgs.length && this.hostConn?.open) this.hostConn.send({ t: 'relay', msgs });
      return { ok: true, msgs: this.inbox.splice(0) };
    }
    if (a === 'poll') return this.poll();
    if (a === 'update') return this.update(body);
    if (a === 'send') return this.send(body.to, body.data);
    throw new Error(`unknown action: ${a}`);
  }

  async leave() {
    if (!this.room) { this.p?.destroy(); this.p = null; return; }
    try { if (!this.isHostSide && this.hostConn?.open) this.hostConn.send({ t: 'leave' }); } catch { /* 切断済み */ }
    // 送り切るまで少し待ってから閉じる
    await new Promise((r) => setTimeout(r, 120));
    for (const c of this.conns.values()) { try { c.close(); } catch { /* 閉じ済み */ } }
    this.conns.clear();
    this.members.clear();
    this.p?.destroy();
    this.p = null;
    this.room = this.peer = this.token = null;
    this.isHostSide = false;
    this.inbox = [];
    this.lost = null;
    this.snap = { host: null, players: [], state: 'lobby', settings: {} };
  }
}
