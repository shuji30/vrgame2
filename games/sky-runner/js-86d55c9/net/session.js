// 協力プレイのセッション: ルーム (4 文字のコード) に集まり、WebRTC で全員とつながる。
// サーバーとつなぎ方は TURBO KART と同じ (mesh.js)。計画は docs/coop-plan.md
//   ロビー … 名前・プレイヤーの種類・準備ができたか を知らせ合う
//   出撃   … ホストが面と難しさを決めて、全員に「この時刻に出撃」を配る
//   プレイ中… 自分の位置を 1 秒に 15 回配る (state)。出来事 (敵の出現・撃破など) は ctl で順番どおりに
import { SignalClient, Mesh } from './mesh.js';

export const COOP_MAX = 4;
export const GAME_TAG = 'sky-runner'; // TURBO KART と同じサーバーなので、ちがうゲームのルームには入らない
export const DEFAULT_SERVER = 'https://2026082302062910047985.onamaeweb.jp/vrgame2/server/api.php';

export class CoopSession {
  constructor(base) {
    this.signal = new SignalClient(base);
    this.mesh = new Mesh(this.signal, (id, m) => this.onPeerMessage(id, m), () => this.emit());
    this.players = [];       // サーバーから届く [{ id, name, joined }]
    this.host = null;
    this.settings = {};
    this.state = 'idle';     // idle / lobby / playing
    this.info = new Map();   // id → { kind: プレイヤーの種類, ready: 出撃を押して待っている }
    this.me = { kind: 'ship', ready: false };
    this.remote = new Map(); // id → 最新の位置 (recv: 受け取った時刻)
    this.handlers = new Map(); // 出来事の種類 → 受け取る関数 (main.js などが on() で登録する)
    this.listeners = new Set();
    this.offset = 0;         // ホストの時計 - 自分の時計 (ms)
    this.bestRtt = Infinity;
    this.error = null;
  }

  get self() { return this.signal.peer; }
  get isHost() { return !!this.self && this.self === this.host; }
  get room() { return this.signal.room; }
  get active() { return this.state !== 'idle'; }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); }
  // 出来事を受け取る関数を登録する (例: on('start', (msg, from) => ...))
  on(type, fn) { this.handlers.set(type, fn); }

  // ホスト基準の時刻 (ms)
  hostNow() { return performance.now() + (this.isHost ? 0 : this.offset); }
  // ホスト基準の時刻を、自分の時計に直す
  toLocal(hostMs) { return hostMs - (this.isHost ? 0 : this.offset); }

  async loadIce() {
    try { this.mesh.setIce((await this.signal.health()).ice); } catch { /* STUN だけでつなぐ */ }
  }

  async create(name) {
    await this.loadIce();
    await this.signal.create(name);
    this.host = this.self;
    await this.signal.update({ settings: { game: GAME_TAG } });
    this.settings = { game: GAME_TAG };
    this.begin();
  }

  async join(room, name) {
    await this.loadIce();
    const r = await this.signal.join(room, name);
    this.host = r.host;
    // ちがうゲームのルームや、満員のルームには入らない
    const p = await this.signal.poll();
    if (p.settings?.game !== GAME_TAG) { await this.signal.leave(); throw new Error('SKY RUNNER のルームではありません'); }
    if (p.players.length > COOP_MAX) { await this.signal.leave(); throw new Error(`満員です (${COOP_MAX} 人まで)`); }
    this.begin();
  }

  begin() {
    this.state = 'lobby';
    this.error = null;
    clearTimeout(this.timer);
    const loop = async () => {
      if (this.state === 'idle') return;
      try { await this.pollOnce(); } catch (e) { this.error = e.message; this.emit(); }
      this.timer = setTimeout(loop, this.state === 'playing' ? 1500 : 400); // ロビーでは素早く、プレイ中はゆっくり (在室の確認だけ)
    };
    loop();
    // つながらない相手とは、サーバーの中継で 0.12 秒ごとにまとめてやり取りする
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
    // 時計合わせ (ホストとの往復時間から、ホストの時計とのずれを見積もる)
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (!this.isHost && this.mesh.isOpen(this.host)) this.mesh.send(this.host, { t: 'ping', c: performance.now() }, true);
    }, 1000);
    this.emit();
  }

  async pollOnce() {
    const r = await this.signal.poll();
    const was = new Set(this.players.map((p) => p.id));
    this.players = r.players;
    this.host = r.host;
    if (r.settings && Object.keys(r.settings).length) this.settings = r.settings;
    this.mesh.sync(r.players.map((p) => p.id));
    for (const m of r.msgs) await this.mesh.handleSignal(m.from, m.data);
    // いなくなった人の情報は消す
    for (const id of was) if (!r.players.some((p) => p.id === id)) { this.info.delete(id); this.remote.delete(id); }
    this.sendInfo(false);
    this.error = null;
    this.emit();
  }

  // 自分の情報 (プレイヤーの種類・準備) を知らせる。force でなければ、まだ知らせていない相手にだけ
  sendInfo(force = true) {
    this.infoSent ||= new Set();
    for (const p of this.players) {
      if (p.id === this.self || !this.mesh.isOpen(p.id)) continue;
      if (!force && this.infoSent.has(p.id)) continue;
      this.mesh.send(p.id, { t: 'info', ...this.me }, true);
      this.infoSent.add(p.id);
    }
  }

  setMe(patch) {
    Object.assign(this.me, patch);
    if (this.active) this.sendInfo(true);
    this.emit();
  }

  allConnected() {
    return this.players.every((p) => p.id === this.self || this.mesh.isOpen(p.id));
  }

  // ホスト: 全員に出撃を知らせる (少し先の時刻にそろえて出撃する)
  async start(opts) {
    if (!this.isHost) return;
    const msg = { t: 'start', at: this.hostNow() + 1500, ...opts };
    this.mesh.broadcast(msg, true);
    this.signal.update({ state: 'racing' }).catch(() => {}); // 出撃したあとは、ほかの人が入ってこないように
    this.state = 'playing';
    this.remote.clear();
    this.handlers.get('start')?.(msg, this.self);
    this.emit();
  }

  // ホスト: ロビーに戻る (もう一度遊ぶ・ほかの人を入れる)
  backToLobby() {
    this.state = 'lobby';
    this.remote.clear();
    if (this.isHost) {
      this.signal.update({ state: 'lobby' }).catch(() => {});
      this.mesh.broadcast({ t: 'lobby' }, true);
    }
    this.emit();
  }

  onPeerMessage(id, m) {
    switch (m.t) {
      case 'ping':
        if (this.isHost) this.mesh.send(id, { t: 'pong', c: m.c, h: performance.now() }, true);
        return;
      case 'pong': {
        const rtt = performance.now() - m.c;
        if (rtt < this.bestRtt * 1.5 || this.bestRtt === Infinity) { // 往復が短いときの測定ほど正確
          this.bestRtt = Math.min(this.bestRtt, rtt);
          const est = m.h - (m.c + rtt / 2);
          this.offset = this.offset === 0 ? est : this.offset * 0.8 + est * 0.2;
        }
        this.rtt = rtt;
        return;
      }
      case 'info':
        this.info.set(id, { kind: String(m.kind || 'ship'), ready: !!m.ready });
        this.emit();
        return;
      case 's': // 位置
        m.recv = performance.now();
        this.remote.set(id, m);
        return;
      case 'start':
        if (id !== this.host) return;
        this.state = 'playing';
        this.remote.clear();
        break;
      case 'lobby':
        if (id !== this.host) return;
        this.state = 'lobby';
        this.remote.clear();
        this.emit();
        break;
      default:
        break;
    }
    this.handlers.get(m.t)?.(m, id);
  }

  // 自分の位置を配る (最新だけ届けばよい)
  sendState(st) { this.mesh.broadcast({ t: 's', ...st }); }
  // 出来事を配る (順番どおり・確実に)
  broadcast(msg) { this.mesh.broadcast(msg, true); }
  sendTo(id, msg) { this.mesh.send(id, msg, true); }

  async leave() {
    this.state = 'idle';
    clearTimeout(this.timer);
    clearTimeout(this.relayTimer);
    clearInterval(this.pingTimer);
    this.mesh.close();
    await this.signal.leave();
    this.players = [];
    this.info.clear();
    this.remote.clear();
    this.infoSent?.clear();
    this.emit();
  }
}
