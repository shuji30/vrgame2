// パーティーモードのアイテム（描画に依存しない）。位置はコース座標（弧長 s・横位置 lateral）で扱う
//   アイテムボックス: 取るとルーレット（ITEM_ROULETTE 秒）のあと、順位に応じたアイテムが手に入る
//   当たったときのスピンは「操作を一時的に効かなくして減速する」だけで、物理（操作感）は変えない
import { pointAt, wrapS } from './track.js';
import { COIN_BONUS } from './coins.js';

export const ITEMS = {
  banana: { name: 'バナナピール', emoji: '🍌' },
  bounce: { name: 'バウンドボール', emoji: '🟢' },
  homing: { name: '追尾ボール', emoji: '🎯' },
  mushroom: { name: 'ダッシュキノコ', emoji: '🍄' },
  mushroom3: { name: 'ダッシュキノコ ×3', emoji: '🍄' },
  star: { name: 'スーパースター', emoji: '⭐' },
  lightning: { name: 'カミナリ', emoji: '⚡' },
  shield: { name: 'バリア', emoji: '🛡️' },
  ink: { name: 'スミ雲', emoji: '💨' },
};

export const ITEM_ROULETTE = 1.0;
const BOX_RESPAWN = 1.2; // 集団の後ろの車も取れるよう短め
const SPIN_TIME = 1.1;
const STAR_TIME = 8;
const SHRINK_TIME = 5;
const INK_TIME = 4;
const HIT_R = 1.3; // アイテムと車の当たり判定の半径 (m)

// 順位（0 = 先頭 … 1 = 最後尾）ごとの出やすさ。下位ほど強いアイテム
const TABLE = [
  [0.25, { banana: 35, bounce: 25, shield: 25, mushroom: 10, homing: 5 }],
  [0.6, { bounce: 20, homing: 25, mushroom: 20, banana: 15, ink: 15, shield: 5 }],
  [0.85, { homing: 25, mushroom3: 25, star: 20, ink: 15, bounce: 15 }],
  [1.01, { star: 30, lightning: 20, mushroom3: 30, homing: 20 }],
];

export function rollItem(rank, rng) {
  const w = TABLE.find(([r]) => rank < r)[1];
  let t = rng() * Object.values(w).reduce((a, b) => a + b, 0);
  for (const [k, v] of Object.entries(w)) {
    t -= v;
    if (t <= 0) return k;
  }
  return 'mushroom';
}

// アイテムボックスの配置: コースの 3 か所に、道幅いっぱいに 5 個ずつ
export function boxLayout(track) {
  const s0 = track.def.startS || 0;
  const out = [];
  for (const f of [0.2, 0.5, 0.78]) {
    const s = wrapS(track, s0 + track.length * f);
    for (let i = 0; i < 5; i++) {
      const lateral = (i - 2) * track.halfWidth * 0.36;
      const p = pointAt(track, s, lateral);
      out.push({ s, lateral, x: p.x, z: p.z });
    }
  }
  return out;
}

// 2 点のコース上の距離（弧長は周回で折り返す）
function trackDist(track, s1, l1, s2, l2) {
  let ds = Math.abs(s1 - s2);
  ds = Math.min(ds, track.length - ds);
  return Math.hypot(ds, l1 - l2);
}
// a から見て b が前方に何 m か（-L/2..L/2）
function ahead(track, a, b) {
  let d = wrapS(track, b - a);
  if (d > track.length / 2) d -= track.length;
  return d;
}

export class ItemSystem {
  // mode: 'local'（オフライン）| 'host'（オンラインのホスト: 抽選・当たり判定・NPC を受け持ち、状態を配る）
  //       | 'client'（オンラインの参加者: ホストから届いた状態を写し、自分の使用はホストへ知らせる）
  constructor(race, mode = 'local') {
    this.race = race;
    this.mode = mode;
    this.onUse = null; // client: (back) => ホストへ使用を知らせる
    this.lightnings = 0;
    this.ltSeen = 0;
    this.pending = [];
    this.deferring = false;
    this.track = race.track;
    this.boxes = boxLayout(race.track).map((b) => ({ ...b, respawnAt: -Infinity }));
    this.objects = []; // { id, kind, s, lateral, vs, vl, owner, ttl, grace, bounces, target }
    this.nextId = 1;
    for (const e of race.karts) Object.assign(e, { item: null, itemCount: 0, roulette: 0, spin: 0, star: 0, shrink: 0, ink: 0, shield: false, aiItemT: 0 });
  }

  // カートの進行方向と速さをコース座標で（前 = vs、右 = vl）
  kartTrackVel(e) {
    const k = e.kart;
    const h = this.track.heading[e.loc.i];
    const c = Math.cos(h), s = Math.sin(h);
    return { vs: k.vx * c + k.vz * s, vl: -k.vx * s + k.vz * c };
  }

  // アイテムを使う。back = true なら後ろへ（バナナ・ボール）
  use(e, back = false) {
    if (!e.item || e.roulette > 0 || e.spin > 0 || e.finished) return false;
    const kind = e.item;
    if (this.mode === 'client') {
      // 参加者: 実際の処理はホストが行う。キノコの加速だけは自分の画面ですぐに効かせる
      if (e.type !== 'player') return false;
      if (kind === 'mushroom' || kind === 'mushroom3') e.kart.boost = Math.max(e.kart.boost || 0, 1.3);
      this.onUse?.(back);
      e.events.push({ type: 'useItem', kind });
      e.useLock = 0.4; // ホストの返事が来るまで、届いた状態で同じアイテムが復活しないように
      if (kind === 'mushroom3' && --e.itemCount > 0) return true;
      e.item = null;
      e.itemCount = 0;
      return true;
    }
    const k = e.kart;
    const v = this.kartTrackVel(e);
    const spawn = (o) => this.objects.push({ id: this.nextId++, owner: e.index, ttl: 10, grace: 0.4, bounces: 0, ...o });
    switch (kind) {
      case 'banana':
        if (back) spawn({ kind, s: wrapS(this.track, e.loc.s - 2.6), lateral: e.loc.lateral, vs: 0, vl: 0, ttl: 90 });
        else spawn({ kind, s: wrapS(this.track, e.loc.s + 2.6), lateral: e.loc.lateral, vs: Math.max(0, v.vs) + 12, vl: v.vl, ttl: 90, fly: 0.8 });
        break;
      case 'bounce':
        spawn({ kind, s: wrapS(this.track, e.loc.s + (back ? -2.6 : 2.6)), lateral: e.loc.lateral, vs: back ? -28 : Math.max(0, v.vs) + 28, vl: v.vl * 0.5, ttl: 8 });
        break;
      case 'homing': {
        const target = this.race.karts.find((o) => o.position === e.position - 1);
        spawn({ kind, s: wrapS(this.track, e.loc.s + 2.6), lateral: e.loc.lateral, vs: Math.max(45, v.vs + 15), vl: 0, ttl: 12, target: target ? target.index : null });
        break;
      }
      case 'mushroom':
      case 'mushroom3':
        k.boost = Math.max(k.boost || 0, 1.3);
        e.events.push({ type: 'itemBoost' });
        break;
      case 'star':
        e.star = STAR_TIME;
        break;
      case 'lightning':
        for (const o of this.race.karts) {
          if (o === e || o.star > 0 || o.finished) continue;
          if (o.shield) { o.shield = false; continue; }
          o.shrink = SHRINK_TIME;
          this.spinOut(o, 0.6, 0.6);
          o.item = null;
          o.roulette = 0;
        }
        this.race.events.push({ type: 'lightning', by: e.index });
        this.lightnings++;
        break;
      case 'shield':
        e.shield = true;
        break;
      case 'ink':
        for (const o of this.race.karts) if (o.position < e.position && !o.finished) { o.ink = INK_TIME; o.events.push({ type: 'ink' }); }
        break;
      default:
        break;
    }
    e.events.push({ type: 'useItem', kind });
    if (kind === 'mushroom3' && (e.itemCount = (e.itemCount || 3) - 1) > 0) return true;
    e.item = null;
    e.itemCount = 0;
    return true;
  }

  // 当たってスピンする。keep: 残る速さの割合
  spinOut(e, time = SPIN_TIME, keep = 0.35) {
    if (e.star > 0) return false;
    if (e.shield) {
      e.shield = false;
      e.events.push({ type: 'shieldBreak' });
      return false;
    }
    e.hits = (e.hits || 0) + 1;
    if (e.type === 'remote') {
      // 他のプレイヤー: 減速は本人の画面で行う（状態の配信で hits が伝わる）。ここでは見た目のスピンだけ
      e.spin = Math.max(e.spin, time);
      e.spinMax = Math.max(e.spin, e.spinMax || 0);
      return true;
    }
    this.applyHit(e, time, keep);
    return true;
  }

  // スピンの減速と、コインを落とす処理（自分の車・NPC）
  applyHit(e, time, keep) {
    const k = e.kart;
    e.spin = Math.max(e.spin, time);
    e.spinMax = Math.max(e.spin, e.spinMax || 0);
    k.vx *= keep;
    k.vz *= keep;
    k.yawRate = 0;
    k.boost = 0;
    if (e.coins) {
      e.coins = Math.max(0, e.coins - 3);
      k.topBonus = e.coins * COIN_BONUS;
    }
    this.emit(e, { type: 'hit' });
    return true;
  }

  // 出来事を記録する。状態の配信を写している間（レースの 1 ステップの外）は次のステップまで取っておく
  emit(e, ev) {
    if (this.deferring) this.pending.push([e, ev]);
    else if (e) e.events.push(ev);
    else this.race.events.push(ev);
  }

  // 操作の上書き（スピン中は操作が効かない）
  overrideInput(e, input) {
    if (e.spin > 0) return { ...input, throttle: 0, brake: 0.3, steer: 0, handbrake: 0 };
    return input;
  }

  step(dt) {
    const race = this.race;
    const t = this.track;
    const time = race.time;
    const n = race.karts.length;
    const client = this.mode === 'client';
    // 状態の配信で起きた出来事をこのステップの出来事として出す
    for (const [e, ev] of this.pending.splice(0)) (e ? e.events : race.events).push(ev);
    for (const e of race.karts) {
      const k = e.kart;
      e.useLock = Math.max(0, (e.useLock || 0) - dt);
      // 効果の時間
      e.spin = Math.max(0, e.spin - dt);
      if (e.spin === 0) e.spinMax = 0;
      e.ink = Math.max(0, e.ink - dt);
      if (e.star > 0) {
        e.star = Math.max(0, e.star - dt);
        k.boost = Math.max(k.boost || 0, 0.15); // スター中は最高速が上がり続ける
      }
      e.shrink = Math.max(0, e.shrink - dt);
      k.topMul = e.shrink > 0 ? 0.85 : 1;
      // アイテムボタンを割り当てていないハンコンのプレイヤーは、NPC と同じ判断で自動で使う
      if (e.autoItem && e.type === 'player' && e.item && !e.finished && !(e.useLock > 0)) this.aiUse(e, dt);
      if (client) continue; // 抽選・箱・NPC の判断はホストが行う
      // ルーレット
      if (e.roulette > 0) {
        e.roulette -= dt;
        if (e.roulette <= 0) {
          e.roulette = 0;
          e.item = rollItem(n > 1 ? (e.position - 1) / (n - 1) : 0, race.rng);
          e.itemCount = e.item === 'mushroom3' ? 3 : 1;
          e.aiItemT = 0.5 + race.rng() * 2.5;
          e.events.push({ type: 'itemGot', kind: e.item });
        }
      }
      // アイテムボックス
      if (!e.item && !e.roulette && (e.type !== 'remote' || this.mode === 'host') && !e.finished) {
        for (const b of this.boxes) {
          if (b.respawnAt > time) continue;
          if (trackDist(t, e.loc.s, e.loc.lateral, b.s, b.lateral) > 1.7) continue;
          b.respawnAt = time + BOX_RESPAWN;
          e.roulette = ITEM_ROULETTE;
          e.events.push({ type: 'itemBox' });
          break;
        }
      } else {
        // 持っていても箱は壊れる（ルーレットは回らない）
        for (const b of this.boxes) {
          if (b.respawnAt <= time && trackDist(t, e.loc.s, e.loc.lateral, b.s, b.lateral) < 1.7) b.respawnAt = time + BOX_RESPAWN;
        }
      }
      if (e.type === 'npc' && e.item && !e.finished) this.aiUse(e, dt);
    }
    this.stepObjects(dt);
    if (client) return;
    // スター中の車に触れた車はスピン
    for (const a of race.karts) {
      if (!(a.star > 0)) continue;
      for (const b of race.karts) {
        if (a === b || b.star > 0) continue;
        if (b.spin <= 0 && Math.hypot(a.kart.x - b.kart.x, a.kart.z - b.kart.z) < (race.spec.width ?? 1.4) + 0.3) this.spinOut(b);
      }
    }
  }

  stepObjects(dt) {
    const t = this.track;
    const race = this.race;
    const wall = t.halfWidth + t.runoff - 0.5;
    for (const o of this.objects) {
      o.ttl -= dt;
      o.grace -= dt;
      if (o.fly > 0) {
        // 前へ投げたバナナは放物線で飛んで着地する
        o.fly -= dt;
        o.s = wrapS(t, o.s + o.vs * dt);
        o.lateral += o.vl * dt;
        if (o.fly <= 0) o.vs = o.vl = 0;
      } else if (o.kind === 'bounce') {
        o.s = wrapS(t, o.s + o.vs * dt);
        o.lateral += o.vl * dt;
        if (Math.abs(o.lateral) > wall) {
          o.lateral = Math.sign(o.lateral) * wall;
          o.vl = -o.vl;
          if (++o.bounces > 6) o.ttl = 0;
        }
      } else if (o.kind === 'homing') {
        o.s = wrapS(t, o.s + o.vs * dt);
        const tg = o.target != null ? race.karts[o.target] : null;
        // 近づいたら相手の横位置へ寄っていく
        const d = tg ? ahead(t, o.s, tg.loc.s) : Infinity;
        const goal = tg && d < 60 && d > -5 ? tg.loc.lateral : 0;
        o.lateral += Math.max(-12 * dt, Math.min(12 * dt, goal - o.lateral));
      }
      o.lateral = Math.max(-wall, Math.min(wall, o.lateral));
      const p = pointAt(t, o.s, o.lateral);
      o.x = p.x;
      o.z = p.z;
      if (o.ttl <= 0 || o.fly > 0 || this.mode === 'client') continue;
      // 車に当たる
      for (const e of race.karts) {
        if (e.finished && e.type !== 'remote') continue;
        if (e.index === o.owner && o.grace > 0) continue;
        if (trackDist(t, e.loc.s, e.loc.lateral, o.s, o.lateral) > HIT_R) continue;
        o.ttl = 0;
        this.spinOut(e);
        race.events.push({ type: 'itemHit', kind: o.kind, victim: e.index, x: o.x, z: o.z });
        break;
      }
    }
    // ボールはバナナを壊す
    for (const a of this.objects) {
      if (a.ttl <= 0 || a.kind === 'banana') continue;
      for (const b of this.objects) {
        if (b === a || b.ttl <= 0) continue;
        if (trackDist(t, a.s, a.lateral, b.s, b.lateral) < 1.0) { a.ttl = 0; b.ttl = 0; }
      }
    }
    this.objects = this.objects.filter((o) => o.ttl > 0);
  }

  // ---- オンライン（ホスト → 参加者への状態の配信）----
  // netIdOf(e): カートのネットワーク ID
  snapshot(netIdOf) {
    const r1 = (x) => Math.round(x * 10) / 10;
    return {
      k: this.race.karts.map((e) => [netIdOf(e), e.item || '', e.itemCount || 0, e.roulette > 0 ? 1 : 0, r1(e.spin), r1(e.star), r1(e.shrink), r1(e.ink), e.shield ? 1 : 0, e.hits || 0]),
      o: this.objects.map((o) => [o.id, o.kind, Math.round(o.s * 10) / 10, Math.round(o.lateral * 100) / 100, r1(o.vs), r1(o.vl), Math.round((o.fly || 0) * 100) / 100, o.target ?? -1, r1(o.ttl)]),
      b: this.boxes.map((b) => r1(Math.max(0, b.respawnAt - this.race.time))),
      lt: this.lightnings,
    };
  }

  // 参加者: ホストから届いた状態を写す。byNet: netId → カート、me: 自分のカート
  applySnapshot(snap, byNet, me) {
    const race = this.race;
    this.deferring = true;
    for (const [id, item, count, roul, spin, star, shrink, ink, shield, hits] of snap.k || []) {
      const e = byNet.get(id);
      if (!e) continue;
      const mine = e === me;
      if (!(mine && e.useLock > 0)) {
        if (mine && !e.item && item) this.emit(e, { type: 'itemGot', kind: item });
        e.item = item || null;
        e.itemCount = count;
      }
      e.roulette = roul ? Math.max(e.roulette, 0.3) : 0;
      e.star = star;
      e.shrink = shrink;
      e.shield = !!shield;
      if (mine && ink > e.ink + 0.5) this.emit(e, { type: 'ink' });
      e.ink = ink;
      // 新しく当たった: 自分なら減速（スピン時間が短いのはカミナリ）、他の車は見た目のスピン
      if (e.hitsSeen === undefined) e.hitsSeen = hits;
      if (hits > e.hitsSeen) {
        if (mine) this.applyHit(e, spin, spin < 0.8 ? 0.6 : 0.35);
        else { e.spin = spin; e.spinMax = spin; }
      }
      e.hitsSeen = hits;
      if (!mine) e.spin = spin;
    }
    // コース上の投げ物（間は自分の画面で動かして補う）
    const prev = new Map(this.objects.map((o) => [o.id, o]));
    this.objects = (snap.o || []).map(([id, kind, s, lateral, vs, vl, fly, target, ttl]) => {
      const o = prev.get(id) || { id, owner: -1, grace: 0, bounces: 0 };
      return Object.assign(o, { kind, s, lateral, vs, vl, fly, target: target >= 0 ? target : null, ttl });
    });
    (snap.b || []).forEach((left, i) => { if (this.boxes[i]) this.boxes[i].respawnAt = left > 0 ? race.time + left : -Infinity; });
    if ((snap.lt || 0) > this.ltSeen) {
      this.emit(null, { type: 'lightning' });
      this.ltSeen = snap.lt;
    }
    this.deferring = false;
  }

  // NPC のアイテムの使い方
  aiUse(e, dt) {
    e.aiItemT -= dt;
    if (e.aiItemT > 0) return;
    const race = this.race;
    const t = this.track;
    const others = race.karts.filter((o) => o !== e);
    const nearAhead = others.some((o) => { const d = ahead(t, e.loc.s, o.loc.s); return d > 3 && d < 45 && Math.abs(o.loc.lateral - e.loc.lateral) < 2.5; });
    const nearBehind = others.some((o) => { const d = ahead(t, e.loc.s, o.loc.s); return d < -2 && d > -25; });
    let use = false, back = false;
    switch (e.item) {
      case 'banana': use = nearBehind || e.aiItemT < -6; back = true; break;
      case 'bounce': use = nearAhead || nearBehind || e.aiItemT < -8; back = !nearAhead && nearBehind; break;
      case 'homing': use = e.position > 1; break;
      case 'mushroom': case 'mushroom3': use = Math.abs(t.curv[e.loc.i]) < 0.01; break;
      default: use = true;
    }
    if (use) {
      this.use(e, back);
      e.aiItemT = 0.6 + race.rng() * 1.5;
    } else if (e.aiItemT < -12) {
      e.aiItemT = 0;
    }
  }
}
