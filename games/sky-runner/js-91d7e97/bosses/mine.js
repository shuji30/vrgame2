// ボス: 浮遊鉱山 (FLOATING MINE)。前方の高い所に止まる、鉱石の塊。
// 3 つの出撃口から採掘ドローンを送り出し、本体から弾幕 (輪・らせん・十字・乱れ撃ち) を縦横に撃つ。
// 出撃口は硬いが、撃つと壊れて点が入り、しばらく止まる (5 秒で直る)。
// 本体は出撃口が 3 つそろっている間は弾を跳ね返す。出撃口を 1 つでも壊すと鉱脈が明るく光り、本体に弾が効く (体力を 0 にすれば撃破)
import * as THREE from 'three';
import { bossModel } from '../enemies.js';
import { sfx } from '../audio.js';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;
const _a = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();

const GEO = {
  rock: new THREE.DodecahedronGeometry(1, 0),
  vein: new THREE.OctahedronGeometry(1, 0),
  band: new THREE.TorusGeometry(1, 0.05, 4, 24),
  hatch: new THREE.BoxGeometry(1, 1, 0.5),
  drone: new THREE.OctahedronGeometry(1, 0).scale(1, 0.6, 1.4),
};

function mat(color, emissive, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, flatShading: true, roughness: 0.6, metalness: 0.2, ...extra });
  m.userData.base = m.emissive.clone();
  return m;
}

// 出撃口の位置 (本体から見たずれ)。横スクロールは縦に並べる
// 本体の当たり (半径 10) より前に出して、機関砲で撃てるようにする
const hatchOffset = (i, side) => (side ? new THREE.Vector3(0, -5 + i * 5, 13) : new THREE.Vector3(-9 + i * 9, -2.5, 13));

export function spawnMine(c, def) {
  const side = c.sideMode;
  const hp = def.hp || 360;
  // 撃破ボーナスは、壊した出撃口の数で増える (8000 + 1 つ 500、最大 12000)。倒すまで去らない (180 秒の保険はある)
  const grp = { type: 'mine', t: 0, escape: def.escape || Infinity, total: 1, kills: 0, leaving: false, bonus: 8000 };
  c.bossGroup = grp;
  // 本体: Blender のモデル (FloatingMine) か、読み込む前は図形で。mats[1] は鉱脈 (出撃口が開くと光らせる)
  const made = bossModel('mine', ['MineRock', 'MineVein', 'MineBand']) || (() => {
    const rockM = mat(0x4a3a4a, 0x000000, { roughness: 0.9 });
    const veinM = mat(0xff9af0, 0x803070, { roughness: 0.2 });
    const bandM = mat(0xffd36a, 0x5a4010, { metalness: 0.6 });
    const g = new THREE.Group();
    const rock = new THREE.Mesh(GEO.rock, rockM);
    rock.scale.set(16, 8, 10);
    g.add(rock);
    for (let i = 0; i < 7; i++) {
      const v = new THREE.Mesh(GEO.vein, veinM);
      const a = (i / 7) * Math.PI * 2;
      v.position.set(Math.cos(a) * 13, Math.sin(a * 2) * 3, Math.sin(a) * 7);
      v.scale.set(1.6, 4, 1.6);
      v.rotation.set(rand(-0.6, 0.6), 0, rand(-0.6, 0.6));
      g.add(v);
    }
    for (const y of [-2, 2]) {
      const b = new THREE.Mesh(GEO.band, bandM);
      b.rotation.x = Math.PI / 2;
      b.scale.set(17, 11, 1);
      b.position.y = y;
      g.add(b);
    }
    return { mesh: g, mats: [rockM, veinM, bandM] };
  })();
  const g = made.mesh;
  const k = side ? 0.6 : 1;
  g.scale.setScalar(k);
  const body = {
    kind: 'mine', mesh: g, mats: made.mats, r: 10 * k, hp, maxHp: hp, score: 0, t: 0, flash: 0, fireT: 4,
    k, x: c.lastPlayer?.x ?? 0, y: side ? 15 : 19, z: SPAWN_Z, hatches: [null, null, null], down: [0, 0, 0], launchT: 2.5, bossGroup: grp,
  };
  grp.ratio = () => Math.max(0, body.hp / body.maxHp);
  g.position.set(body.x, body.y, SPAWN_Z);
  c.addEnemy(body, 10 * k);
  for (let i = 0; i < 3; i++) makeHatch(c, body, i);
  c.bossDefeated = false;
}

function makeHatch(c, body, i) {
  // 出撃口: Blender のモデル (MineHatch。mats[0] は光るすき間) か箱で
  const hm = bossModel('hatch', ['HatchGlow', 'HatchFrame']);
  const m = hm ? null : mat(0x30202a, 0xff7020);
  const mesh = hm ? hm.mesh : new THREE.Mesh(GEO.hatch, m);
  if (hm) mesh.scale.setScalar(body.k);
  else mesh.scale.set(3.6, 3, 1).multiplyScalar(body.k);
  const h = { kind: 'hatch', mesh, mats: hm ? hm.mats : [m], r: 2.4 * body.k, hp: 20 + c.level * 2, score: 500, t: 0, flash: 0, fireT: Infinity, body, slot: i, noItem: true };
  mesh.position.copy(body.mesh.position).add(hatchOffset(i, c.sideMode).multiplyScalar(body.k));
  c.addEnemy(h, 0);
  h.shadow.visible = false;
  body.hatches[i] = h;
}

export const MINE_KINDS = {
  mine: {
    big: true,
    // 出撃口が 3 つそろっている間は、本体は弾を跳ね返す
    shielded: (e) => e.hatches.every((h) => h && !h.dead),
    update(c, e, dt, scroll, ctx, p) {
      const grp = e.bossGroup;
      const hz = c.holdZ(-58);
      e.z = Math.min(hz, e.z + (scroll * 0.4 + 26) * dt);
      if (grp.leaving) { e.y += 14 * dt; e.z -= 20 * dt; } // 時間切れ: 上へ去っていく
      e.x += ((ctx.player.x ?? 0) - e.x) * Math.min(1, dt * 0.15);
      p.set(e.x + Math.sin(e.t * 0.3) * 6, e.y + Math.sin(e.t * 0.7) * 0.8, e.z);
      e.mesh.rotation.y = Math.sin(e.t * 0.2) * 0.15;
      // 弾が効く間は、鉱脈が明るく点滅する
      const open = !MINE_KINDS.mine.shielded(e);
      e.mats[1].userData.base.setHex(open ? 0xff40d0 : 0x803070).multiplyScalar(open ? 0.7 + 0.3 * Math.sin(e.t * 10) : 1);
      if (p.y > 70) {
        e.dead = true;
        for (const h of e.hatches) if (h && !h.dead) h.dead = true;
        return;
      }
      // 出撃口: 壊れていたら 5 秒で直す。直っている口から、順にドローンを送り出す
      for (let i = 0; i < 3; i++) {
        const h = e.hatches[i];
        if (h && h.dead) {
          e.hatches[i] = null;
          e.down[i] = 5;
          if (h.hp <= 0) grp.bonus = Math.min(12000, grp.bonus + 500); // 撃って壊した口
        }
        if (!e.hatches[i] && !grp.leaving && (e.down[i] -= dt) <= 0) makeHatch(c, e, i);
      }
      if (e.barrage) updateBarrage(c, e, dt, ctx, p);
      e.launchT -= dt;
      if (e.launchT <= 0 && !grp.leaving && e.z >= hz - 1) {
        const open = e.hatches.filter((h) => h && !h.dead);
        e.launchT = (1.4 * 3) / Math.max(1, open.length) / (1 + (c.level - 1) * 0.08); // 出撃口を壊すほど、ドローンが減る
        if (open.length) launchDrone(c, open[Math.floor(Math.random() * open.length)], ctx);
      }
    },
    fire(c, e, ctx, p) {
      // 弾幕を 1 つ選んで始める (撃ち終わるまで次は選ばない)。ときどき下から砲弾も
      e.fireT = rand(1.2, 1.8);
      if (e.bossGroup.leaving || e.barrage) return;
      const kinds = ['ring', 'spiral', 'cross', 'scatter'].filter((k) => k !== e.lastBarrage);
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      e.lastBarrage = kind;
      e.barrage = { kind, t: 0, n: 0, spin: Math.random() < 0.5 ? 1 : -1 };
      if (Math.random() < 0.4) {
        const from = _a.copy(p).add(new THREE.Vector3(0, -7 * e.k, 4));
        for (const s of [-0.18, 0, 0.18]) c.fireBullet(from.clone(), ctx.player, s, 'shell');
      }
    },
    onDeath(c, e) {
      // 鉱石の塊のあちこちが爆発して砕ける
      for (let i = 0; i < 6; i++) c.explode(_a.copy(e.mesh.position).add(new THREE.Vector3(rand(-12, 12), rand(-5, 5), rand(-4, 6)).multiplyScalar(e.k)), true);
      for (const h of e.hatches) if (h && !h.dead) { h.dead = true; c.explode(h.mesh.position); }
    },
  },

  hatch: {
    big: true, sideAbs: true, // 本体にくっついて毎フレーム位置を決め直す
    update(c, e, dt, scroll, ctx, p) {
      const b = e.body;
      if (b.dead) { e.dead = true; return; }
      p.copy(b.mesh.position).add(hatchOffset(e.slot, ctx.side).multiplyScalar(b.k));
      // 開いた出撃口は明るく光る (ドローンを出した直後ほど明るい)
      e.mats[0].userData.base.setHex(0xff7020).multiplyScalar(0.6 + 0.4 * Math.max(0, Math.sin(e.t * 4)));
    },
  },

  // 採掘ドローン: 出撃口から飛び出し、しばらくプレイヤーへ向かって曲がり、そのあとはまっすぐ飛ぶ (体当たり)
  drone: {
    kamikaze: true,
    sideAbs: true,
    update(c, e, dt, scroll, ctx, p) {
      if (e.t < 0.8) { // 追うのは最初の 0.8 秒だけ (そのあとは横へよければ外れる)
        const want = _a.subVectors(ctx.player, p).normalize().multiplyScalar(e.speed);
        e.vel.lerp(want, Math.min(1, dt * 2.2));
      }
      p.addScaledVector(e.vel, dt);
      e.mesh.lookAt(_a.copy(p).add(e.vel));
      if (e.t > 6 || p.y < -2) e.dead = true;
    },
  },
};

// 弾幕: 本体の前から、プレイヤーへ向かう向きを中心に、上下左右へ散らして撃つ
// a: 左右のずれ、b: 上下のずれ (ラジアンくらい)
function shoot(c, e, ctx, p, a, b) {
  const from = _w.copy(p).add(_a.set(0, -2 * e.k, 9 * e.k));
  const base = _a.subVectors(ctx.player, from).normalize();
  _u.crossVectors(base, THREE.Object3D.DEFAULT_UP).normalize(); // 左右
  _v.crossVectors(_u, base).normalize(); // 上下
  const dir = base.addScaledVector(_u, a).addScaledVector(_v, b).normalize();
  c.fireBullet(from.clone(), from.clone().addScaledVector(dir, 100), 0, 'orb', null, true);
}

function updateBarrage(c, e, dt, ctx, p) {
  const B = e.barrage, lv = 1 + (c.level - 1) * 0.06;
  B.t += dt;
  // 撃つ時刻ごとに 1 回ずつ (n: 撃った回数)
  const due = (every) => B.t >= B.n * every / lv && ++B.n;
  if (B.kind === 'ring') {
    // 輪: 大きい輪と小さい輪をかわるがわる 4 回。輪の真ん中は空いている (動かなければ当たらないが、動くと当たる)
    if (B.n < 4 && due(0.55)) {
      const R = B.n % 2 ? 0.14 : 0.26, m = 16, off = B.n * 0.2;
      for (let i = 0; i < m; i++) { const th = (i / m) * Math.PI * 2 + off; shoot(c, e, ctx, p, Math.cos(th) * R, Math.sin(th) * R); }
      sfx.enemyShot();
    }
    if (B.n >= 4) e.barrage = null;
  } else if (B.kind === 'spiral') {
    // らせん: 3 本の腕が回りながら広がったり縮んだりする (2.6 秒)
    if (due(0.09)) {
      const th = B.t * 3.2 * B.spin, R = 0.12 + 0.18 * Math.abs(Math.sin(B.t * 1.6));
      for (let k = 0; k < 3; k++) { const a = th + (k / 3) * Math.PI * 2; shoot(c, e, ctx, p, Math.cos(a) * R, Math.sin(a) * R); }
      if (B.n % 3 === 0) sfx.enemyShot();
    }
    if (B.t > 2.6) e.barrage = null;
  } else if (B.kind === 'cross') {
    // 十字: 横一列 → 縦一列 → 斜め (×) を、すき間の位置を変えながら
    if (B.n < 6 && due(0.4)) {
      const m = 11, gap = Math.floor(rand(2, m - 2)); // 1 か所だけすき間をあける
      const ang = [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4, 0, Math.PI / 2][B.n - 1];
      for (let i = 0; i < m; i++) {
        if (i === gap) continue;
        const t = (i / (m - 1) - 0.5) * 0.8;
        shoot(c, e, ctx, p, Math.cos(ang) * t, Math.sin(ang) * t);
      }
      sfx.enemyShot();
    }
    if (B.n >= 6) e.barrage = null;
  } else {
    // 乱れ撃ち: 上下左右にばらばらに 2 秒
    if (due(0.06)) {
      shoot(c, e, ctx, p, rand(-0.45, 0.45), rand(-0.35, 0.35));
      if (B.n % 4 === 0) sfx.enemyShot();
    }
    if (B.t > 2) e.barrage = null;
  }
}

function launchDrone(c, hatch, ctx) {
  // 採掘ドローン: Blender のモデル (MiningDrone) か図形で
  const dm = bossModel('drone', ['DroneBody']);
  const m = dm ? null : mat(0xbff8ff, 0x3080c0);
  const mesh = dm ? dm.mesh : new THREE.Mesh(GEO.drone, m);
  if (!dm) mesh.scale.setScalar(1.3);
  const p = hatch.mesh.position.clone();
  const out = new THREE.Vector3(rand(-1, 1), rand(-0.6, 0.2), 1).normalize().multiplyScalar(14);
  const d = { kind: 'drone', mesh, mats: dm ? dm.mats : [m], r: 1.6, hp: 1, score: 100, t: 0, flash: 0, fireT: Infinity, vel: out, speed: 40 + c.level * 2, dmg: 15 };
  mesh.position.copy(p);
  c.addEnemy(d, 0.8);
}
