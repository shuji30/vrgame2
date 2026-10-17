// ボス: 浮遊鉱山 (FLOATING MINE)。前方の高い所に止まる、壊せない鉱石の塊。
// 3 つの出撃口から採掘ドローンを送り出し、下から砲弾を撃つ。出撃口は撃つと壊れて点が入り、しばらく止まる (8 秒で直る)。
// escape 秒耐えると去り、撃破扱い (ボーナスあり)。体力ゲージの代わりに、去るまでの残り時間を出す
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;
const _a = new THREE.Vector3();

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
  const escape = def.escape || 35;
  // 耐えきったときのボーナスは、壊した出撃口の数で増える (3000 + 1 つ 1000、最大 12000)
  const grp = { type: 'mine', t: 0, escape, total: 1, kills: 0, leaving: false, bonus: 3000, endure: true };
  grp.ratio = () => Math.max(0, 1 - grp.t / grp.escape); // 去るまでの残り時間
  c.bossGroup = grp;
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
  const k = side ? 0.6 : 1;
  g.scale.setScalar(k);
  const body = {
    kind: 'mine', mesh: g, mats: [rockM, veinM, bandM], r: 10 * k, hp: Infinity, score: 0, t: 0, flash: 0, fireT: 4, noLock: true, noAssist: true,
    k, x: c.lastPlayer?.x ?? 0, y: side ? 15 : 19, z: SPAWN_Z, hatches: [null, null, null], down: [0, 0, 0], launchT: 2.5, bossGroup: grp,
  };
  g.position.set(body.x, body.y, SPAWN_Z);
  c.addEnemy(body, 10 * k);
  for (let i = 0; i < 3; i++) makeHatch(c, body, i);
  c.bossDefeated = false;
}

function makeHatch(c, body, i) {
  const m = mat(0x30202a, 0xff7020);
  const mesh = new THREE.Mesh(GEO.hatch, m);
  mesh.scale.set(3.6, 3, 1).multiplyScalar(body.k);
  const h = { kind: 'hatch', mesh, mats: [m], r: 2.4 * body.k, hp: 5 + Math.floor(c.level / 2), score: 500, t: 0, flash: 0, fireT: Infinity, body, slot: i, noItem: true };
  mesh.position.copy(body.mesh.position).add(hatchOffset(i, c.sideMode).multiplyScalar(body.k));
  c.addEnemy(h, 0);
  h.shadow.visible = false;
  body.hatches[i] = h;
}

export const MINE_KINDS = {
  mine: {
    shielded: () => true, // 本体は壊せない (弾を跳ね返す。光って効いているように見せない)
    update(c, e, dt, scroll, ctx, p) {
      const grp = e.bossGroup;
      const hz = c.holdZ(-58);
      e.z = Math.min(hz, e.z + (scroll * 0.4 + 26) * dt);
      if (grp.leaving) { e.y += 14 * dt; e.z -= 20 * dt; } // 時間切れ: 上へ去っていく
      e.x += ((ctx.player.x ?? 0) - e.x) * Math.min(1, dt * 0.15);
      p.set(e.x + Math.sin(e.t * 0.3) * 6, e.y + Math.sin(e.t * 0.7) * 0.8, e.z);
      e.mesh.rotation.y = Math.sin(e.t * 0.2) * 0.15;
      if (p.y > 70) {
        e.dead = true;
        for (const h of e.hatches) if (h && !h.dead) h.dead = true;
        return;
      }
      // 出撃口: 壊れていたら 8 秒で直す。直っている口から、順にドローンを送り出す
      for (let i = 0; i < 3; i++) {
        const h = e.hatches[i];
        if (h && h.dead) {
          e.hatches[i] = null;
          e.down[i] = 6;
          if (h.hp <= 0) grp.bonus = Math.min(12000, grp.bonus + 1000); // 撃って壊した口
        }
        if (!e.hatches[i] && !grp.leaving && (e.down[i] -= dt) <= 0) makeHatch(c, e, i);
      }
      e.launchT -= dt;
      if (e.launchT <= 0 && !grp.leaving && e.z >= hz - 1) {
        const open = e.hatches.filter((h) => h && !h.dead);
        e.launchT = (1.4 * 3) / Math.max(1, open.length) / (1 + (c.level - 1) * 0.08); // 出撃口を壊すほど、ドローンが減る
        if (open.length) launchDrone(c, open[Math.floor(Math.random() * open.length)], ctx);
      }
    },
    fire(c, e, ctx, p) {
      // 下から、ゆっくりした砲弾を 3 発
      e.fireT = rand(2.6, 3.4);
      if (e.bossGroup.leaving) return;
      const from = _a.copy(p).add(new THREE.Vector3(0, -7 * e.k, 4));
      for (const s of [-0.18, 0, 0.18]) c.fireBullet(from.clone(), ctx.player, s, 'shell');
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

function launchDrone(c, hatch, ctx) {
  const m = mat(0xbff8ff, 0x3080c0);
  const mesh = new THREE.Mesh(GEO.drone, m);
  mesh.scale.setScalar(1.3);
  const p = hatch.mesh.position.clone();
  const out = new THREE.Vector3(rand(-1, 1), rand(-0.6, 0.2), 1).normalize().multiplyScalar(14);
  const d = { kind: 'drone', mesh, mats: [m], r: 1.6, hp: 1, score: 100, t: 0, flash: 0, fireT: Infinity, vel: out, speed: 40 + c.level * 2, dmg: 15 };
  mesh.position.copy(p);
  c.addEnemy(d, 0.8);
}
