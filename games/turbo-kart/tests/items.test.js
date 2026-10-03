import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack } from '../src/core/track.js';
import { TRACKS } from '../src/core/tracks.js';
import { Race, NPC_NAMES } from '../src/core/race.js';
import { rollItem, boxLayout, ITEMS } from '../src/core/items.js';
import { mulberry32 } from '../src/core/rng.js';

const track = buildTrack(TRACKS[0]);

test('アイテムの抽選: 先頭はスター・カミナリが出ず、最後尾はバナナが出ない。すべて定義済みのアイテム', () => {
  const rng = mulberry32(3);
  for (let i = 0; i < 2000; i++) {
    const top = rollItem(0, rng), last = rollItem(1, rng), mid = rollItem(0.5, rng);
    assert.ok(!['star', 'lightning'].includes(top), top);
    assert.ok(last !== 'banana', last);
    for (const k of [top, last, mid]) assert.ok(ITEMS[k], k);
  }
});

test('アイテムボックス: 道幅の内側に並ぶ', () => {
  const b = boxLayout(track);
  assert.equal(b.length, 15);
  for (const x of b) assert.ok(Math.abs(x.lateral) < track.halfWidth);
});

test('アイテムあり: NPC 8 台が箱を取り、アイテムを使い、当たってスピンしても完走する', () => {
  const race = new Race(track, NPC_NAMES.slice(0, 8).map((name) => ({ name, type: 'npc' })), { laps: 3, seed: 9, coins: true, items: true });
  const count = { itemBox: 0, useItem: 0, hit: 0 };
  while (race.state !== 'finished' && race.time < 400) {
    race.step(1 / 60);
    for (const e of race.karts) for (const ev of e.events) if (ev.type in count) count[ev.type]++;
  }
  assert.equal(race.state, 'finished');
  assert.ok(count.itemBox > 20, JSON.stringify(count));
  assert.ok(count.useItem > 15, JSON.stringify(count));
  assert.ok(count.hit > 0, JSON.stringify(count));
});

function twoKarts() {
  const race = new Race(track, [{ name: 'A', type: 'npc' }, { name: 'B', type: 'player' }], { items: true, seed: 1 });
  race.time = 1;
  race.state = 'racing';
  return race;
}

test('後ろに置いたバナナを踏むとスピンし、速度が落ちる。バリアは 1 回防ぐ。スター中は効かない', () => {
  for (const guard of ['none', 'shield', 'star']) {
    const race = twoKarts();
    const [a, b] = race.karts;
    a.item = 'banana';
    race.items.use(a, true);
    assert.equal(race.items.objects.length, 1);
    const o = race.items.objects[0];
    // B をバナナの位置へ
    Object.assign(b.loc, { s: o.s, lateral: o.lateral });
    b.kart.vx = 20; b.kart.vz = 0;
    if (guard === 'shield') b.shield = true;
    if (guard === 'star') b.star = 5;
    race.items.stepObjects(1 / 60);
    assert.equal(race.items.objects.length, 0, guard);
    if (guard === 'none') {
      assert.ok(b.spin > 0);
      assert.ok(Math.hypot(b.kart.vx, b.kart.vz) < 8);
    } else {
      assert.equal(b.spin, 0, guard);
      if (guard === 'shield') assert.equal(b.shield, false);
    }
  }
});

test('スピン中は操作が効かない（アクセルもハンドルも 0）', () => {
  const race = twoKarts();
  const b = race.karts[1];
  b.spin = 0.5;
  const out = race.items.overrideInput(b, { steer: 1, throttle: 1, brake: 0, handbrake: 0 });
  assert.equal(out.throttle, 0);
  assert.equal(out.steer, 0);
});

test('キノコ ×3 は 3 回使える。カミナリは自分以外を小さくする', () => {
  const race = twoKarts();
  const [a, b] = race.karts;
  a.item = 'mushroom3';
  a.itemCount = 3;
  for (let i = 0; i < 3; i++) assert.ok(race.items.use(a));
  assert.equal(a.item, null);
  assert.ok(a.kart.boost > 0);
  a.item = 'lightning';
  race.items.use(a);
  assert.ok(b.shrink > 0);
  assert.equal(a.shrink, 0);
});

test('オンライン: ホストが配る状態で、参加者にアイテム・投げ物・被弾が伝わる。参加者の使用はホストで処理される', () => {
  const host = new Race(track, [{ name: 'H', type: 'player', netId: 'h' }, { name: 'G', type: 'remote', netId: 'g' }], { items: 'host', seed: 2 });
  const guest = new Race(track, [{ name: 'H', type: 'remote', netId: 'h' }, { name: 'G', type: 'player', netId: 'g' }], { items: 'client', seed: 2 });
  for (const r of [host, guest]) { r.time = 1; r.state = 'racing'; }
  const byNet = (r) => new Map(r.karts.map((e) => [e.netId, e]));
  const sync = () => guest.items.applySnapshot(host.items.snapshot((e) => e.netId), byNet(guest), guest.karts[1]);
  const gOnHost = host.karts[1], me = guest.karts[1];
  // ホストで参加者にアイテムが入る → 参加者に伝わる
  gOnHost.item = 'bounce';
  gOnHost.itemCount = 1;
  sync();
  assert.equal(me.item, 'bounce');
  // 参加者が使う → ホストへ知らせ、ホストで投げ物が出る → 参加者にも見える
  const uses = [];
  guest.items.onUse = (back) => uses.push(back);
  assert.ok(guest.items.use(me, false));
  assert.deepEqual(uses, [false]);
  for (const b of uses) host.items.use(gOnHost, b);
  assert.equal(host.items.objects.length, 1);
  sync();
  assert.equal(guest.items.objects.length, 1);
  assert.equal(me.item, null, '使用直後は届いた状態で復活しない');
  // ホストで参加者が被弾 → 参加者の画面で減速とスピン、次のステップで hit の出来事
  me.kart.vx = 30;
  host.items.spinOut(gOnHost);
  sync();
  assert.ok(me.spin > 0);
  assert.ok(Math.abs(me.kart.vx) < 15);
  guest.step(1 / 60, new Map());
  assert.ok(me.events.some((e) => e.type === 'hit'));
});
