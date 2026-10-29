// 協力プレイのロビーの画面 (タイトルの「協力プレイ」) と、プレイ中のやり取りをまとめる。main.js からはこれだけを使う。
// 第 1 回 (docs/coop-plan.md): ルームに集まって同時に出撃し、仲間の機体が見える。敵はまだ各自別々
import * as THREE from 'three';
import { CoopSession, COOP_MAX, DEFAULT_SERVER } from './session.js';
import { RemotePlayers } from './remote.js';

const STORE = 'skyrunner.coop';
const SEND_HZ = 15;
const KIND_NAME = { ship: '宇宙船', human: 'ロボット', girl: '女の子' };
const SLOT_X = [0, 10, -10, 20]; // 出撃するときの横の位置 (ルームに入った順。重ならないように)

// hooks: { start(msg): ホストが出撃した (自分がホストのときは呼ばない), lobby(): ホストがロビーに戻った, changed(): 入った・抜けた }
export function setupCoop({ scene, avatar, hooks }) {
  const $ = (id) => document.getElementById(id);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (_) { /* 既定値 */ }
  $('coopName').value = saved.name || '';
  const server = new URLSearchParams(location.search).get('coopServer') || saved.server || DEFAULT_SERVER;
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ name: $('coopName').value.trim(), server })); } catch (_) { /* 保存できない */ } };

  let session = null;
  const handlers = new Map(); // 出来事の種類 → 受け取る関数 (main.js が on() で登録する。ルームに入るたびに付け直す)
  const remotes = new RemotePlayers(scene, avatar);
  let kind = 'ship';
  let sendT = 0;
  const _p = new THREE.Vector3(), _q = new THREE.Quaternion();

  const status = (text) => { $('coopStatus').textContent = text; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  function render() {
    const inRoom = !!session?.active;
    document.querySelector('[data-coop=entry]').hidden = inRoom;
    document.querySelector('[data-coop=lobby]').hidden = !inRoom;
    if (!inRoom) return;
    $('coopRoom').textContent = session.room || '----';
    $('coopPlayers').innerHTML = session.players.map((p) => {
      const me = p.id === session.self;
      const info = me ? session.me : session.info.get(p.id);
      const open = me || session.mesh.isOpen(p.id);
      const conn = !open ? `<span class="wait">接続中…${session.mesh.tries(p.id) ? ` (${session.mesh.tries(p.id)} 回目)` : ''}</span>`
        : info?.ready ? '<span class="ok">● 準備 OK</span>' : '<span class="ok">● 接続</span>';
      return `<li><span>${p.id === session.host ? '👑 ' : ''}${esc(p.name || '???')}${me ? ' (あなた)' : ''} <small>${KIND_NAME[info?.kind] || ''}</small></span>${conn}</li>`;
    }).join('');
    $('coopHint').textContent = session.isHost
      ? '仲間がそろったら「出撃」を押すと、全員が同じ面で出撃します。'
      : session.state === 'playing' ? 'ホストが出撃しました。「出撃」を押すと参加します。'
        : '「出撃」を押して待つと、ホストが出撃したときに一緒に始まります。面と難しさはホストに合わせます。';
    if (session.error) status(`通信のエラー: ${session.error}`);
  }

  async function enter(join) {
    const name = $('coopName').value.trim();
    if (!name) { status('名前を入れてください'); $('coopName').focus(); return; }
    save();
    $('coopCreate').disabled = $('coopJoin').disabled = true;
    status(join ? '参加しています…' : 'ルームを作っています…');
    session = new CoopSession(server);
    session.setMe({ kind, ready: false });
    session.onChange(render);
    session.on('start', (msg, from) => { if (from !== session.self) hooks.start?.(msg); });
    session.on('lobby', () => hooks.lobby?.());
    for (const [t, fn] of handlers) session.on(t, fn);
    try {
      if (join) {
        const code = $('coopCode').value.trim().toUpperCase();
        if (!/^[A-Z2-9]{4}$/.test(code)) throw new Error('コードは 4 文字です');
        await session.join(code, name);
      } else await session.create(name);
      status('');
      hooks.changed?.();
    } catch (e) {
      status(`入れませんでした: ${e.message === 'room not found' ? 'ルームが見つかりません' : e.message === 'race in progress' ? 'もう出撃しています' : e.message}`);
      session = null;
    }
    $('coopCreate').disabled = $('coopJoin').disabled = false;
    render();
  }

  async function leave() {
    const s = session;
    session = null;
    remotes.clear();
    render();
    hooks.changed?.();
    await s?.leave().catch(() => {});
  }

  $('coopCreate').addEventListener('click', () => enter(false));
  $('coopJoin').addEventListener('click', () => enter(true));
  $('coopCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(true); });
  $('coopLeave').addEventListener('click', leave);
  addEventListener('pagehide', () => { session?.leave(); }); // タブを閉じたらルームから抜ける

  return {
    get active() { return !!session?.active; },
    get isHost() { return !!session?.isHost; },
    get playing() { return session?.state === 'playing'; },
    get session() { return session; },
    // 出撃するときの横の位置 (m)
    get startX() {
      if (!session?.active) return 0;
      const i = session.players.findIndex((p) => p.id === session.self);
      return SLOT_X[Math.max(0, i)] ?? 0;
    },
    // 自分のプレイヤーの種類が変わった
    setKind(k) { kind = k; session?.setMe({ kind: k }); },
    // 出撃を押して待っている (ゲストのとき)
    setReady(on) { session?.setMe({ ready: on }); },
    // 出来事を受け取る (fn(msg, from))
    on(type, fn) { handlers.set(type, fn); session?.on(type, fn); },
    // 全員へ (順番どおり・確実に)
    send(msg) { if (session?.state === 'playing') session.broadcast(msg); },
    // 全員へ (最新だけ届けばよい。敵の位置など)
    sendFast(msg) { if (session?.state === 'playing') session.mesh.broadcast(msg); },
    // ホストへ / 1 人へ
    sendHost(msg) { if (session?.host && !session.isHost) session.sendTo(session.host, msg); },
    sendTo(id, msg) { if (session) session.sendTo(id, msg); },
    get self() { return session?.self; },
    // チームの点数 (自分 + 仲間の最新)
    teamScore(own) {
      let sum = own;
      if (session?.state === 'playing') for (const s of session.remote.values()) sum += s.sc || 0;
      return sum;
    },
    // 一人ずつの点数 (終わったときに出す)
    scores(own, ownKills) {
      if (!session) return [];
      return session.players.map((p) => {
        const me = p.id === session.self;
        const s = session.remote.get(p.id);
        return { name: p.name || '???', me, score: me ? own : s?.sc || 0, kills: me ? ownKills : s?.kl || 0, out: me ? false : !!s?.out };
      });
    },
    // 仲間の状態 (残機が尽きたかなど)
    others() {
      if (!session) return [];
      return session.players.filter((p) => p.id !== session.self).map((p) => ({ id: p.id, name: p.name, ...session.remote.get(p.id) }));
    },
    // ホスト: 全員に出撃を知らせる
    hostStart(opts) { session?.start(opts); },
    // ホスト: ロビーに戻る (全員タイトルへ)
    hostLobby() { if (session?.isHost && session.state === 'playing') session.backToLobby(); },
    // 毎フレーム: 自分の位置を配り、仲間の機体を描く。show: 自分の機体が見えている (やられて消えていない)
    // selfZ: 自分の機体の前後の位置 (仲間を横に並べて描く)
    // extra: 位置といっしょに配るもの (点数・倒した数・残機が尽きたか)
    frame(dt, { inGame, show, selfZ, extra }) {
      if (!session?.active) return;
      remotes.update(dt, inGame ? session : null, selfZ);
      if (!inGame || session.state !== 'playing') return;
      if ((sendT -= dt) > 0) return;
      sendT = 1 / SEND_HZ;
      const m = avatar.models[kind];
      if (!m) return;
      m.obj.getWorldPosition(_p);
      m.obj.getWorldQuaternion(_q);
      const r = (v) => Math.round(v * 1000) / 1000;
      session.sendState({ k: kind, h: show ? 0 : 1, x: r(_p.x), y: r(_p.y), z: r(_p.z), qx: r(_q.x), qy: r(_q.y), qz: r(_q.z), qw: r(_q.w), ...extra });
    },
    // 開発用: 状態を読む (main.js の __coop)
    debug() {
      if (!session) return null;
      return {
        room: session.room, state: session.state, host: session.isHost, players: session.players.length,
        open: session.players.filter((p) => p.id !== session.self && session.mesh.isOpen(p.id)).length,
        relayed: session.players.filter((p) => session.mesh.isRelayed(p.id)).length,
        remotes: [...remotes.peers.values()].map((r) => ({ kind: r.kind, visible: r.group.visible, model: !!r.model, x: +r.group.position.x.toFixed(2), y: +r.group.position.y.toFixed(2), z: +r.group.position.z.toFixed(2) })),
      };
    },
    COOP_MAX,
  };
}
