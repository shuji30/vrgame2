// オンライン(ルームコード):ホスト・クライアント方式。ホストのプレイヤーが判定の権限を持つ
//   - つなぎ方:WebRTC のデータチャネル(接続の仲介だけ PeerJS の公開サーバー)。同じ PC のタブ同士は BroadcastChannel
//   - 同期:自分の車両は各自が動かして 15Hz で送る。弾の発射はイベントで送り、命中と撃破はホストが決める
//   - 敵・ミッション・対戦の点はホストが動かし、15Hz の状態で配る。クライアントは補間して見せる
//   - FFB はネットワークに流さない(各自のイベントからローカルで作る)
//   - ホストが落ちたら試合を終えてメニューへ戻る
import { addBossWreck } from '../core/boss.js';
import { getIceServers, hasTurn, testRelay } from './ice.js';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PREFIX = 'treadrevolt-v1-';
const TICK = 1 / 15;
// クライアントへ転送するイベント(爆発などは各自の弾から作るので送らない)
const FORWARD = new Set(['fire', 'hit', 'kill', 'objective', 'mission', 'gate', 'rise', 'radio', 'wake', 'partDown', 'bonus', 'trackBreak', 'repair', 'capture', 'flag', 'flagDrop', 'flagReturn', 'danger', 'boss', 'stomp', 'drill', 'quake', 'drop', 'elevator', 'land', 'smoke', 'punch']);

function loadPeerJs() {
  if (window.Peer) return Promise.resolve();
  return new Promise((ok, ng) => {
    const s = document.createElement('script');
    s.src = new URL('../../vendor/peerjs.min.js', import.meta.url).href;
    s.onload = ok;
    s.onerror = () => ng(new Error('PeerJS を読み込めませんでした'));
    document.head.appendChild(s);
  });
}

// ------------------------------------------------------------ つなぎ方
class PeerLink {
  constructor(onMsg, onState) {
    this.onMsg = onMsg;
    this.onState = onState;
    this.conns = new Map();
    this.peer = null;
  }

  // 直接つながらないときは Cloudflare の TURN で中継する(取れなければ直接だけ)
  async peerOptions() {
    const { iceServers, relay } = await getIceServers();
    this.relay = relay;
    return iceServers ? { debug: 0, config: { iceServers } } : { debug: 0 };
  }

  async host(code) {
    await loadPeerJs();
    const opts = await this.peerOptions();
    return new Promise((ok, ng) => {
      const peer = new window.Peer(PREFIX + code, opts);
      this.peer = peer;
      peer.on('open', () => ok());
      peer.on('error', (e) => { if (!this.ready) ng(e); else this.onState('error', e); });
      peer.on('connection', (conn) => {
        conn.on('open', () => { this.conns.set(conn.peer, conn); });
        conn.on('data', (d) => this.onMsg(conn.peer, d));
        conn.on('close', () => { this.conns.delete(conn.peer); this.onState('leave', conn.peer); });
        conn.on('error', () => {});
      });
      peer.on('call', (call) => call.close()); // 通話(ボイスチャット)は使わない
      this.ready = true;
    });
  }

  async join(code) {
    await loadPeerJs();
    const opts = await this.peerOptions();
    return new Promise((ok, ng) => {
      const peer = new window.Peer(undefined, opts);
      this.peer = peer;
      const timer = setTimeout(() => ng(new Error('ルームが見つかりません(時間切れ)')), 15000);
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { serialization: 'json', reliable: true });
        conn.on('open', () => { clearTimeout(timer); this.conns.set('host', conn); ok(); });
        conn.on('data', (d) => this.onMsg('host', d));
        conn.on('close', () => this.onState('hostLost'));
        conn.on('error', () => {});
      });
      peer.on('error', (e) => { clearTimeout(timer); if (e.type === 'peer-unavailable') ng(new Error('そのルームコードは見つかりません')); else ng(e); });
      peer.on('call', (call) => call.close()); // 通話(ボイスチャット)は使わない
    });
  }

  get myPeerId() { return this.peer?.id; }

  send(to, msg) {
    if (to == null) { for (const c of this.conns.values()) if (c.open) c.send(msg); return; }
    const c = this.conns.get(to);
    if (c?.open) c.send(msg);
  }

  close() {
    for (const c of this.conns.values()) c.close();
    this.peer?.destroy();
  }
}

// 同じ PC のタブ同士(1台でマルチプレイを確かめる)
class LocalLink {
  constructor(onMsg, onState) {
    this.onMsg = onMsg;
    this.onState = onState;
    this.id = Math.random().toString(36).slice(2, 8);
    this.isHost = false;
  }

  open(code) {
    this.ch = new BroadcastChannel(PREFIX + code);
    this.ch.onmessage = (e) => {
      const { from, to, msg } = e.data;
      if (from === this.id) return;
      if (to && to !== (this.isHost ? 'host' : this.id)) return;
      if (!this.isHost && from !== 'host') return;
      this.onMsg(this.isHost ? from : 'host', msg);
    };
  }

  async host(code) { this.isHost = true; this.open(code); }
  async join(code) { this.open(code); }
  get myPeerId() { return this.isHost ? 'host' : this.id; }
  send(to, msg) { this.ch.postMessage({ from: this.isHost ? 'host' : this.id, to, msg }); }
  close() { this.send(null, { t: 'bye' }); this.ch?.close(); }
}

// ------------------------------------------------------------ オンラインの進行
export class Online {
  constructor(ctx) {
    this.ctx = ctx; // { app, game, settings, begin, quit, show, esc, campaignStage, arenaStage, STAGE_INFO, ARENA_LIST, VEHICLES }
    this.state = 'idle'; // idle | lobby | game
    this.link = null;
    this.isHost = false;
    this.players = []; // { id, peer, name, vehicle, team, ready, bot }
    this.cfg = { mode: 'coop', stageIndex: 0, arena: 'plains', rule: 'dm', bots: true };
    this.code = '';
    this.myId = null;
    this.local = false;
  }

  // ------------------------------------------------------------ 画面
  render(el) {
    this.el = el;
    const { esc, settings, STAGE_INFO, ARENA_LIST, VEHICLES } = this.ctx;
    if (this.state === 'idle') {
      el.innerHTML = `<h2>オンライン(ルームコード)</h2>
        <p class="note">ホストがルームを作り、4文字のコードを仲間に伝える。仲間はコードを入れて参加する。協力ミッションは2〜4人、対戦は1vs1〜4vs4(空いた席はボット)。<br>
        つなぎ方は WebRTC(接続の仲介だけ PeerJS の公開サーバーを使う)。${hasTurn() ? '直接つながらない回線では TURN(Metered の Open Relay)で中継する。' : '回線によってはつながらないことがある。'}<br>
        「同じPCで試す」をオンにすると、同じブラウザのタブ同士でつながる(1台で確かめる用)。</p>
        <label class="field"><span>名前</span><input type="text" id="on-name" value="${esc(settings.name)}" maxlength="12"><span></span></label>
        <label class="field"><span>同じPCで試す(タブ同士)</span><input type="checkbox" id="on-local" ${this.local ? 'checked' : ''}><span></span></label>
        <div class="row"><button class="primary" id="on-host">ルームを作る</button></div>
        <div class="row"><input type="text" id="on-code" placeholder="コード(例 AB3K)" maxlength="4" style="text-transform:uppercase;width:140px"><button id="on-join">参加する</button></div>
        ${hasTurn() ? '<div class="row"><button id="on-turntest">中継(TURN)を試す</button></div>' : ''}
        <p class="status" id="on-status"></p>
        <div class="row"><button data-go="title">◀ 戻る</button></div>`;
      el.querySelector('#on-host').onclick = () => this.hostRoom();
      el.querySelector('#on-join').onclick = () => this.joinRoom(el.querySelector('#on-code').value);
      el.querySelector('#on-name').oninput = (e) => { settings.name = e.target.value || 'PLAYER'; };
      el.querySelector('#on-local').onchange = (e) => { this.local = e.target.checked; };
      el.querySelector('#on-turntest')?.addEventListener('click', async () => {
        this.status('中継サーバーを試しています…');
        const r = await testRelay();
        this.status(r.ok ? `中継サーバーにつながりました(${r.via})。直接つながらない回線でも対戦できます` : `中継サーバーにつながりませんでした${r.why ? `(${r.why})` : ''}`);
      });
      return;
    }
    // ロビー(格納庫)
    const me = this.players.find((p) => p.id === this.myId);
    const c = this.cfg;
    const teamName = (t) => (c.mode === 'versus' ? (t === 0 ? '<span style="color:#ff8a2a">暖色</span>' : '<span style="color:#5ac8ff">寒色</span>') : '');
    el.innerHTML = `<h2>格納庫 ― ルーム <b style="font-size:28px;color:var(--accent2);letter-spacing:0.2em">${this.code}</b>${this.local ? '(同じPC)' : ''}</h2>
      <table class="keys">${this.players.map((p) => `<tr><th>${esc(p.name)}${p.id === this.myId ? '(あなた)' : ''}${p.peer === 'host' || p.id === 'h' ? ' ★ホスト' : ''}</th><td>${VEHICLES[p.vehicle]?.name || ''}</td><td>${teamName(p.team)}</td><td>${p.ready ? '<span style="color:var(--ok)">準備OK</span>' : ''}</td></tr>`).join('')}</table>
      <h2>自分の車両</h2>
      <div class="grid">${Object.keys(VEHICLES).map((k) => `<button data-v="${k}" class="${me?.vehicle === k ? 'on' : ''}">${VEHICLES[k].name}</button>`).join('')}</div>
      ${c.mode === 'versus' ? `<div class="row"><button id="lb-team">チームを替える</button></div>` : ''}
      <h2>ゲーム ${this.isHost ? '' : '(ホストが決める)'}</h2>
      <div class="grid">
        <button data-mode="coop" class="${c.mode === 'coop' ? 'on' : ''}" ${this.isHost ? '' : 'disabled'}>協力ミッション</button>
        <button data-mode="versus" class="${c.mode === 'versus' ? 'on' : ''}" ${this.isHost ? '' : 'disabled'}>対戦</button>
      </div>
      ${c.mode === 'coop' ? `<label class="field"><span>ステージ</span><select id="lb-stage" ${this.isHost ? '' : 'disabled'}>${STAGE_INFO.map((s) => `<option value="${s.index}" ${s.index === c.stageIndex ? 'selected' : ''}>${s.id} ${s.name}</option>`).join('')}</select><span></span></label>`
        : `<label class="field"><span>ルール</span><select id="lb-rule" ${this.isHost ? '' : 'disabled'}>${[['dm', 'デスマッチ'], ['dom', '拠点制圧'], ['ctf', '旗取り']].map(([k, n]) => `<option value="${k}" ${c.rule === k ? 'selected' : ''}>${n}</option>`).join('')}</select><span></span></label>
           <label class="field"><span>戦場</span><select id="lb-arena" ${this.isHost ? '' : 'disabled'}>${ARENA_LIST.map((a) => `<option value="${a.id}" ${c.arena === a.id ? 'selected' : ''}>${a.name}</option>`).join('')}</select><span></span></label>
           <label class="field"><span>空いた席をボットで埋める</span><input type="checkbox" id="lb-bots" ${c.bots ? 'checked' : ''} ${this.isHost ? '' : 'disabled'}><span></span></label>`}
      <div class="row">
        <button id="lb-ready">${me?.ready ? '準備OKを取り消す' : '準備OK'}</button>
        ${this.isHost ? '<button class="primary" id="lb-start">出撃 ▶</button>' : ''}
        <button id="lb-leave">ルームを出る</button>
      </div>
      <p class="status" id="on-status"></p>`;
    el.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => this.pick({ vehicle: b.dataset.v })));
    el.querySelector('#lb-team')?.addEventListener('click', () => this.pick({ team: me.team ? 0 : 1 }));
    el.querySelector('#lb-ready').onclick = () => this.pick({ ready: !me?.ready });
    el.querySelector('#lb-leave').onclick = () => this.leave(true);
    if (this.isHost) {
      el.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { c.mode = b.dataset.mode; this.assignTeams(); this.broadcastLobby(); }));
      el.querySelector('#lb-stage')?.addEventListener('change', (e) => { c.stageIndex = Number(e.target.value); this.broadcastLobby(); });
      el.querySelector('#lb-rule')?.addEventListener('change', (e) => { c.rule = e.target.value; this.broadcastLobby(); });
      el.querySelector('#lb-arena')?.addEventListener('change', (e) => { c.arena = e.target.value; this.broadcastLobby(); });
      el.querySelector('#lb-bots')?.addEventListener('change', (e) => { c.bots = e.target.checked; this.broadcastLobby(); });
      el.querySelector('#lb-start').onclick = () => this.startGame();
    }
  }

  status(t) {
    const s = this.el?.querySelector('#on-status');
    if (s) s.textContent = t;
  }

  rerender() {
    if (this.el && !this.el.closest('.screen')?.hidden) this.render(this.el);
  }

  makeLink() {
    const onMsg = (from, m) => this.onMessage(from, m);
    const onState = (kind, who) => this.onLinkState(kind, who);
    return this.local ? new LocalLink(onMsg, onState) : new PeerLink(onMsg, onState);
  }

  // ------------------------------------------------------------ ルーム
  async hostRoom() {
    this.status('ルームを作っています…');
    for (let tries = 0; tries < 3; tries++) {
      this.code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
      this.link = this.makeLink();
      try {
        await this.link.host(this.code);
        break;
      } catch (e) {
        this.link.close();
        this.link = null;
        if (tries === 2) { this.status(`ルームを作れませんでした: ${e.message || e.type}`); return; }
      }
    }
    this.isHost = true;
    this.myId = 'h';
    this.players = [{ id: 'h', peer: 'host', name: this.ctx.settings.name, vehicle: this.ctx.settings.vehicle, team: 0, ready: true }];
    this.state = 'lobby';
    this.ctx.app.net = this.hooks();
    this.render(this.el);
  }

  async joinRoom(code) {
    code = String(code || '').trim().toUpperCase();
    if (code.length !== 4) { this.status('4文字のコードを入れてください'); return; }
    this.status('ルームに入っています…');
    this.link = this.makeLink();
    try {
      await this.link.join(code);
    } catch (e) {
      this.status(`参加できませんでした: ${e.message || e.type}`);
      this.link.close();
      this.link = null;
      return;
    }
    this.code = code;
    this.isHost = false;
    this.state = 'lobby';
    this.link.send('host', { t: 'hello', name: this.ctx.settings.name, vehicle: this.ctx.settings.vehicle });
    this.ctx.app.net = this.hooks();
    this.status('ホストの返事を待っています…');
  }

  leave(toTitle = false) {
    if (this.link) {
      if (!this.isHost) this.link.send('host', { t: 'bye' });
      else this.link.send(null, { t: 'closed' });
      this.link.close();
    }
    this.link = null;
    this.state = 'idle';
    this.players = [];
    this.ctx.app.net = null;
    if (toTitle) this.ctx.show('title', false);
  }

  assignTeams() {
    if (this.cfg.mode !== 'versus') { for (const p of this.players) p.team = 0; return; }
    this.players.forEach((p, i) => { if (p.team == null || p.team > 1) p.team = i % 2; });
  }

  pick(change) {
    if (this.isHost) {
      Object.assign(this.players.find((p) => p.id === this.myId), change);
      this.broadcastLobby();
    } else {
      this.link.send('host', { t: 'pick', ...change });
    }
  }

  broadcastLobby() {
    this.link.send(null, { t: 'lobby', players: this.players, cfg: this.cfg, code: this.code });
    this.rerender();
  }

  // ------------------------------------------------------------ 開始
  startGame() {
    const c = this.cfg;
    const humans = this.players.filter((p) => !p.bot);
    let list = humans.map((p) => ({ id: p.id, name: p.name, vehicle: p.vehicle, team: c.mode === 'versus' ? p.team : 0, human: true }));
    if (c.mode === 'versus' && c.bots) {
      const n0 = list.filter((p) => p.team === 0).length, n1 = list.filter((p) => p.team === 1).length;
      const size = Math.max(n0, n1, 2);
      const kinds = ['medium', 'light', 'heavy', 'mech'];
      for (let i = n0; i < size; i++) list.push({ id: `b0${i}`, name: `ボット${i}`, vehicle: kinds[i % 4], team: 0, human: false });
      for (let i = n1; i < size; i++) list.push({ id: `b1${i}`, name: `ボット${i + size}`, vehicle: kinds[(i + 1) % 4], team: 1, human: false });
    }
    const seed = Math.floor(Math.random() * 1e9);
    this.link.send(null, { t: 'start', cfg: c, list, seed });
    this.launch(c, list, seed);
  }

  launch(c, list, seed) {
    const { campaignStage, arenaStage } = this.ctx;
    const players = list.map((p) => ({
      id: p.id, name: p.name, vehicle: p.vehicle, team: p.team,
      ctrl: p.id === this.myId ? 'local' : p.human ? 'remote' : this.isHost ? 'bot' : 'remote',
    }));
    const stage = c.mode === 'versus' ? arenaStage(c.arena) : campaignStage(c.stageIndex);
    this.state = 'game';
    this.tick = 0;
    this.ctx.begin({
      mode: c.mode === 'versus' ? 'versus' : 'coop', stage, stageIndex: c.stageIndex, players, versus: c.mode === 'versus' ? { rule: c.rule } : null,
      authority: this.isHost, localId: this.myId, seed, idPrefix: this.isHost ? 'h' : `${this.myId}_`, online: true,
    });
  }

  // ------------------------------------------------------------ 受信
  onMessage(from, m) {
    if (!m || !m.t) return;
    const game = this.ctx.game;
    const sim = game.sim;
    if (this.isHost) {
      const p = this.players.find((q) => q.peer === from);
      switch (m.t) {
        case 'hello': {
          if (this.state !== 'lobby') { this.link.send(from, { t: 'busy' }); return; }
          if (this.players.length >= 8) { this.link.send(from, { t: 'full' }); return; }
          const used = new Set(this.players.map((q) => q.id));
          let n = 1;
          while (used.has(`c${n}`)) n++;
          this.players.push({ id: `c${n}`, peer: from, name: String(m.name || 'PLAYER').slice(0, 12), vehicle: m.vehicle || 'medium', team: null, ready: false });
          this.assignTeams();
          this.link.send(from, { t: 'welcome', id: `c${n}` });
          this.broadcastLobby();
          break;
        }
        case 'pick':
          if (p) { if (m.vehicle) p.vehicle = m.vehicle; if (m.team != null) p.team = m.team; if (m.ready != null) p.ready = m.ready; this.broadcastLobby(); }
          break;
        case 'bye':
          this.dropPeer(from);
          break;
        case 'st': {
          const e = p && sim?.byId.get(p.id);
          if (e) applyState(e, m.s);
          break;
        }
        case 'shot':
          if (sim && p) {
            sim.spawnShot({ ...m.s, remote: true, team: sim.byId.get(p.id)?.team ?? 0, owner: p.id });
            this.link.send(null, { t: 'shot', s: { ...m.s, owner: p.id } });
          }
          break;
        case 'fire':
          if (sim && p) {
            const ev = { ...m.ev, id: p.id, _net: true };
            sim.events.push(ev);
            this.link.send(null, { t: 'ev', ev });
          }
          break;
        case 'elevator':
          if (sim && p) {
            sim.elevUses = Math.max(0, sim.elevUses - 1);
            const e = sim.byId.get(p.id);
            if (e) sim.wakeAround(e);
          }
          break;
        default: break;
      }
      return;
    }
    // クライアント
    switch (m.t) {
      case 'welcome': this.myId = m.id; this.status(''); break;
      case 'lobby': this.players = m.players; this.cfg = m.cfg; this.code = m.code; if (this.state === 'lobby') this.rerender(); break;
      case 'busy': this.status('試合中なので入れません'); this.leave(); break;
      case 'full': this.status('満員です'); this.leave(); break;
      case 'closed': this.hostGone(); break;
      case 'start': this.launch(m.cfg, m.list, m.seed); break;
      case 'snap': if (sim) applySnap(sim, m, this.myId); break;
      case 'shot':
        if (sim && m.s.owner !== this.myId) sim.spawnShot({ ...m.s, remote: true, id: `n${m.s.id}` });
        break;
      case 'ev':
        if (sim && !((m.ev.t === 'fire' || m.ev.t === 'punch') && m.ev.id === this.myId)) applyEvent(sim, m.ev, this.myId, game);
        break;
      default: break;
    }
  }

  onLinkState(kind, who) {
    if (kind === 'hostLost') this.hostGone();
    if (kind === 'leave' && this.isHost) this.dropPeer(who);
  }

  dropPeer(peer) {
    const i = this.players.findIndex((q) => q.peer === peer);
    if (i < 0) return;
    const p = this.players[i];
    this.players.splice(i, 1);
    const sim = this.ctx.game.sim;
    const e = sim?.byId.get(p.id);
    if (e) { e.alive = false; e.hidden = true; e.respawnT = 0; sim.radio('sys', `${p.name} が切断しました`); }
    if (this.state === 'lobby') this.broadcastLobby();
  }

  hostGone() {
    if (this.state === 'idle') return;
    const wasGame = this.state === 'game';
    this.leave();
    if (wasGame) this.ctx.quit();
    setTimeout(() => alert('ホストとの接続が切れました。メニューに戻ります。'), 50);
  }

  // ------------------------------------------------------------ ゲームとのつなぎ
  hooks() {
    const self = this;
    return {
      onEvent(ev, game) {
        if (ev._net || self.state !== 'game') return;
        const sim = game.sim;
        if (self.isHost) {
          if (ev.t === 'shot') { if (!ev.s.remote) self.link.send(null, { t: 'shot', s: packShot(ev.s) }); return; }
          if (FORWARD.has(ev.t)) self.link.send(null, { t: 'ev', ev });
        } else {
          // クライアント:自分の弾・発射・エレベーターだけホストへ
          if (ev.t === 'shot' && !ev.s.remote && ev.s.owner === self.myId) self.link.send('host', { t: 'shot', s: packShot(ev.s) });
          if ((ev.t === 'fire' || ev.t === 'punch') && ev.id === self.myId) self.link.send('host', { t: 'fire', ev });
          if (ev.t === 'elevator' && ev.id === self.myId) self.link.send('host', { t: 'elevator' });
        }
        void sim;
      },
      frame(game, dt) {
        if (self.state !== 'game' || !game.sim) return;
        self.tick += dt;
        if (self.tick < TICK) return;
        self.tick = 0;
        const sim = game.sim;
        if (self.isHost) self.link.send(null, makeSnap(sim));
        else {
          const me = sim.byId.get(self.myId);
          if (me) self.link.send('host', { t: 'st', s: packState(me) });
        }
      },
      onEnd() {
        // 試合が終わったら格納庫へ戻れるようにする
        self.state = 'lobby';
        for (const p of self.players) p.ready = p.id === 'h';
      },
      leave() { self.leave(); },
    };
  }
}

// ------------------------------------------------------------ 状態の詰め方
const r2 = (v) => Math.round(v * 100) / 100;

function packState(e) {
  return {
    x: r2(e.x), y: r2(e.y), z: r2(e.z), yaw: r2(e.yaw), tu: r2(e.turret), gp: r2(e.gunPitch), tl: r2(e.tl), tr: r2(e.tr),
    v: r2(e.v), w: r2(e.w), wh: r2(e.wheelie), cr: r2(e.crouch), air: e.air ? 1 : 0, ah: r2(e.airH || 0), h: e.hatch ? 1 : 0, g: e.gear, vx: r2(e.vx), vz: r2(e.vz), d: r2(e.drop || 0),
  };
}

function applyState(e, s) {
  e.net = { x: s.x, y: s.y, z: s.z, yaw: s.yaw, turret: s.tu, vx: s.vx, vz: s.vz };
  e.gunPitch = s.gp; e.tl = s.tl; e.tr = s.tr; e.v = s.v; e.w = s.w; e.wheelie = s.wh; e.crouch = s.cr;
  e.air = s.air ? (e.air || { t: 0 }) : null; e.airH = s.ah; e.hatch = !!s.h; e.gear = s.g; e.drop = s.d;
}

function packShot(s) {
  return { id: s.id, kind: s.kind, x: r2(s.x), y: r2(s.y), z: r2(s.z), vx: r2(s.vx), vy: r2(s.vy), vz: r2(s.vz), g: s.g, life: s.life, dmg: s.dmg, splash: s.splash, lob: s.lob, prox: s.prox, big: s.big, team: s.team, owner: s.owner, homing: s.homing, turn: s.turn, speed: s.speed, delay: s.delay, hp: s.hp };
}

function makeSnap(sim) {
  const m = sim.mission;
  const units = [];
  const players = [];
  for (const e of sim.ents) {
    if (e.isPlayer || e.ctrl === 'bot') {
      players.push({ id: e.id, s: e.ctrl === 'remote' ? null : packState(e), hp: Math.round(e.hp), al: e.alive ? 1 : 0, rs: r2(e.respawnT || 0), k: e.kills, de: e.deaths, sc: e.score, td: e.trackDmg.map(r2) });
    } else {
      const u = [e.id, r2(e.x), r2(e.y), r2(e.z), r2(e.yaw), r2(e.turret || 0), Math.round(e.hp), e.alive ? 1 : 0, e.hidden ? 1 : 0, r2(e.rise ?? 1), r2(e.popped || 0), e.ai?.state || '', r2(e.tl || 0), r2(e.tr || 0)];
      if (e.type === 'boss') u.push({ lo: r2(e.lower), su: r2(e.sub), ph: e.phase, v: r2(e.v || 0), st: !!e.stunned, p: e.parts.map((p) => [Math.round(p.hp), p.alive ? 1 : 0]) });
      units.push(u);
    }
  }
  return {
    t: 'snap', units, players, eu: sim.elevUses, ex: sim.exit?.open ? 1 : 0,
    m: { state: m.state, timeLeft: r2(m.timeLeft), timeLimit: m.timeLimit, score: m.score, lives: m.lives, objectives: m.objectives, objectivesLeft: m.objectivesLeft, teamScore: m.teamScore.map(r2), winner: m.winner, timeBonus: m.timeBonus, noDeathBonus: m.noDeathBonus, bonus: m.bonus, kills: m.kills, deaths: m.deaths, failReason: m.failReason },
    pts: sim.points?.map((p) => [p.owner, r2(p.prog)]), fl: sim.flags?.map((f) => [r2(f.x), r2(f.z), f.carrier, f.home ? 1 : 0]),
  };
}

function applySnap(sim, m, myId) {
  Object.assign(sim.mission, m.m);
  sim.elevUses = m.eu;
  if (sim.exit) sim.exit.open = !!m.ex;
  for (const u of m.units) {
    const e = sim.byId.get(u[0]);
    if (!e) continue;
    e.net = { x: u[1], y: u[2], z: u[3], yaw: u[4], turret: u[5] };
    if (!e.seen) { e.x = u[1]; e.y = u[2]; e.z = u[3]; e.yaw = u[4]; e.seen = true; }
    e.hp = u[6];
    if (e.alive && !u[7]) puppetKill(sim, e);
    e.alive = !!u[7];
    e.hidden = !!u[8]; e.rise = u[9]; e.popped = u[10];
    if (e.ai) e.ai.state = u[11];
    e.tl = u[12]; e.tr = u[13];
    if (e.type === 'boss' && u[14]) {
      const b = u[14];
      e.lower = b.lo; e.sub = b.su; e.phase = b.ph; e.v = b.v; e.stunned = b.st;
      b.p.forEach(([hp, al], i) => { if (e.parts[i]) { e.parts[i].hp = hp; e.parts[i].alive = !!al; } });
    }
  }
  for (const p of m.players) {
    const e = sim.byId.get(p.id);
    if (!e) continue;
    e.kills = p.k; e.deaths = p.de; e.score = p.sc;
    if (p.id === myId) {
      // 自分:体力と生死はホストが決める
      e.hp = p.hp;
      if (e.alive && !p.al) { puppetKill(sim, e); e.respawnT = p.rs; }
      if (!e.alive) e.respawnT = p.rs;
      continue;
    }
    if (p.s) applyState(e, p.s);
    e.hp = p.hp;
    e.trackDmg = p.td;
    if (e.alive && !p.al) puppetKill(sim, e);
    if (!e.alive && p.al) { e.alive = true; e.x = e.net?.x ?? e.x; e.z = e.net?.z ?? e.z; }
  }
  if (m.pts && sim.points) m.pts.forEach(([o, pr], i) => { sim.points[i].owner = o; sim.points[i].prog = pr; });
  if (m.fl && sim.flags) m.fl.forEach(([x, z, c, h], i) => Object.assign(sim.flags[i], { x, z, carrier: c, home: !!h }));
}

// クライアント側の撃破(点や残機はホストが数えるので、見た目だけ)
function puppetKill(sim, e) {
  e.alive = false;
  if (e.type === 'boss') addBossWreck(sim, e);
  if ((e.spec?.body === 'tank' || e.spec?.body === 'mech') && !e.air && e.type !== 'truck') {
    sim.debris.push({ x: e.x, z: e.z, r: e.radius + 1.6, yaw: e.yaw, kind: e.kind || e.type });
    if (sim.debris.length > 40) sim.debris.shift();
  }
}

function applyEvent(sim, ev, myId, game) {
  ev = { ...ev, _net: true };
  switch (ev.t) {
    case 'trackBreak': { const e = sim.byId.get(ev.id); if (e) e.trackDmg[ev.side] = 6; break; }
    case 'hit': { const e = sim.byId.get(ev.id); if (e) e.hp = ev.hp * e.maxHp; break; }
    case 'kill': { const e = sim.byId.get(ev.id); if (e && e.alive) puppetKill(sim, e); break; }
    case 'gate': { const g = sim.obstacles.list.find((o) => o.id === ev.id); if (g) { g.alive = false; g.opening = true; } break; }
    case 'drop': if (ev.id === myId) { const me = sim.byId.get(myId); sim.spawnPlayer(me); return; } break;
    case 'mission': sim.mission.state = ev.state; if (ev.winner != null) sim.mission.winner = ev.winner; if (ev.reason) sim.mission.failReason = ev.reason; break;
    case 'smoke': sim.smokes.push({ x: ev.x, z: ev.z, r: 11, t: 13 }); break;
    case 'elevator': case 'land': if (ev.id === myId) return; break;
    default: break;
  }
  sim.events.push(ev);
  void game;
}
