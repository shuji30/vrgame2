// ボス: 氷晶の冠 (ICICLE CROWN)。7 面。前方の少し高い所に浮かぶ金の輪の冠に、つららが 8 本ぶら下がっている。中心の結晶が核 (いつでも撃てる)。
// 3.5 秒ごとに、ぶら下がったつららから最大 3 本が降ってくる。落ちる場所には先に地面に赤い輪の印が出る (約 1.3 秒前)。
// 刺さったつららは地面と一緒に流れてくる (よけるか、撃って壊す)。ぶら下がったつららは撃って壊せて、壊すほど雨が減る。
// 全部壊すと、冠は中心から 1 本ずつ速く降らせる。
// 体力が半分を切ると、雨の 2 回に 1 回は「氷の柵」(ICE FENCE): プレイヤーの左右 15 m に 5 m おきにつららを落とし、
// 1 か所だけ 10 m 以上あけて青い輪の印を出す (そこを抜けるか、高さ 9 m 以上を飛び越える)
import * as THREE from 'three';
import { bossModel } from '../enemies.js';
import { sfx } from '../audio.js';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;
const _a = new THREE.Vector3();

const GEO = {
  ring: new THREE.TorusGeometry(9, 0.6, 6, 32),
  gem: new THREE.OctahedronGeometry(3, 0),
  icicle: new THREE.ConeGeometry(0.9, 5, 6).rotateX(Math.PI), // 下を向いたつらら
  marker: new THREE.RingGeometry(1.6, 2.4, 24).rotateX(-Math.PI / 2),
  gap: new THREE.RingGeometry(3.2, 4.2, 32).rotateX(-Math.PI / 2), // 柵の抜け道の印 (青)
};

function mat(color, emissive, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, flatShading: true, roughness: 0.2, metalness: 0.3, ...extra });
  m.userData.base = m.emissive.clone();
  return m;
}

// つらら 1 本 (長さ 5、下向き): Blender のモデル (CrownIcicle) か図形で
function icicle(opacity) {
  const made = bossModel('icicle');
  if (made) return made;
  const m = mat(0xe8fbff, 0x3a7a9a, { transparent: true, opacity });
  return { mesh: new THREE.Mesh(GEO.icicle, m), mats: [m] };
}

export function spawnCrown(c, def) {
  const side = c.sideMode;
  const k = side ? 0.6 : 1;
  const hp = def.hp || 300;
  // 冠: Blender のモデル (CrystalCrown) か、読み込む前は図形で
  const made = bossModel('crown') || (() => {
    const ringM = mat(0xffd36a, 0x5a4010, { metalness: 0.7 });
    const gemM = mat(0xcff4ff, 0x3a9ad0);
    const grp = new THREE.Group();
    const ring = new THREE.Mesh(GEO.ring, ringM);
    ring.rotation.x = Math.PI / 2; // 水平な輪
    grp.add(ring, new THREE.Mesh(GEO.gem, gemM));
    return { mesh: grp, mats: [ringM, gemM] };
  })();
  const g = made.mesh;
  g.scale.setScalar(k);
  const grp = { type: 'crown', t: 0, escape: Infinity, total: 1, kills: 0, leaving: false, bonus: 10000 };
  const body = {
    kind: 'crown', mesh: g, mats: made.mats, r: 3.6 * k, hp, maxHp: hp, score: 0, t: 0, flash: 0, fireT: 3, noAssist: false,
    k, x: c.lastPlayer?.x ?? 0, z: SPAWN_Z, a: 0, icicles: [], rainT: 3, bossGroup: grp,
  };
  grp.ratio = () => Math.max(0, body.hp / body.maxHp);
  c.bossGroup = grp;
  g.position.set(body.x, 17 * k, SPAWN_Z);
  c.addEnemy(body, 6 * k);
  for (let i = 0; i < 8; i++) {
    const im = icicle(0.9);
    const mesh = im.mesh;
    mesh.scale.setScalar(k);
    const ice = { kind: 'crownIce', mesh, mats: im.mats, r: 1.6 * k, hp: 3, score: 300, t: 0, flash: 0, fireT: Infinity, body, slot: (i / 8) * Math.PI * 2, noItem: true };
    mesh.position.copy(g.position);
    c.addEnemy(ice, 0);
    ice.shadow.visible = false;
    body.icicles.push(ice);
  }
  c.bossDefeated = false;
}

// つららを 1 本降らせる: 地面に印を出し、0.4 秒後に落とす (0.9 秒で地面へ)
// off: プレイヤーからの横のずれ (なければ、4 割は真上、ほかは 3〜8 m ずらす)。wait: 落ちるまでの待ち
function dropIcicle(c, from, ctx, scroll, off = Math.random() < 0.4 ? 0 : rand(3, 8) * (Math.random() < 0.5 ? -1 : 1), wait = 0.4) {
  const lead = Math.max(20, scroll * (wait + 0.9) + 18); // 地面に刺さってから、少し先でプレイヤーの所へ流れてくる (待ち + 落ちる 0.9 秒の分)
  const marker = new THREE.Mesh(GEO.marker, new THREE.MeshBasicMaterial({ color: 0xff3a30, transparent: true, opacity: 0.8, depthWrite: false }));
  marker.position.set(ctx.side ? 0 : ctx.player.x + off, 0.08, -lead);
  c.scene.add(marker);
  const im = icicle(0.95);
  const mesh = im.mesh;
  mesh.scale.setScalar(1.2);
  mesh.position.copy(from);
  const e = { kind: 'icefall', mesh, mats: im.mats, r: 1.8, hp: 2, score: 100, t: 0, flash: 0, fireT: Infinity, marker, from: from.clone(), wait, fall: 0, landed: false, dmg: 15, noItem: true };
  c.addEnemy(e, 1);
  return e;
}

// 氷の柵: 5 m おきに 6 本ほど。抜け道 (10〜12 m) の真ん中に青い輪。落ちる前のつららを壊せるよう、待ちは 0.6 秒
// (待ち 0.6 + 落ちる 0.9 = 1.5 秒)
function dropFence(c, e, ctx, scroll, sources) {
  const gap = rand(-9, 9); // 抜け道の真ん中 (プレイヤーからの横のずれ)
  let first = null;
  let i = 0;
  for (let off = -15; off <= 15; off += 5) {
    if (Math.abs(off - gap) < 5.5) continue; // 抜け道は柱と柱の間で 10 m 以上
    const from = sources.length ? sources[i++ % sources.length].mesh.position : e.mesh.position;
    first = first || dropIcicle(c, from, ctx, scroll, off, 0.6);
  }
  sfx.lock(); // 柵の予告の音
  if (first && !ctx.side) {
    const mk = new THREE.Mesh(GEO.gap, new THREE.MeshBasicMaterial({ color: 0x40b0ff, transparent: true, opacity: 0.8, depthWrite: false }));
    mk.position.set(ctx.player.x + gap, 0.09, first.marker.position.z);
    c.scene.add(mk);
    first.gapMarker = mk;
  }
}

export const CROWN_KINDS = {
  crown: {
    big: true,
    update(c, e, dt, scroll, ctx, p) {
      const hz = c.holdZ(-55);
      e.z = Math.min(hz, e.z + (scroll * 0.4 + 28) * dt);
      e.x += ((ctx.player.x ?? 0) - e.x) * Math.min(1, dt * 0.25);
      p.set(e.x + Math.sin(e.t * 0.45) * (ctx.side ? 0 : 9), 17 * e.k + Math.sin(e.t * 0.8), e.z);
      e.a += dt * 0.4;
      e.mesh.rotation.y = e.a;
      // つららの雨
      if (e.z >= hz - 1) e.rainT -= dt;
      if (e.rainT <= 0) {
        const live = e.icicles.filter((x) => !x.dead);
        e.rains = (e.rains || 0) + 1;
        if (e.hp < e.maxHp * 0.5 && e.rains % 2 === 0 && !ctx.side) {
          dropFence(c, e, ctx, scroll, live); // 体力が半分を切ったら、2 回に 1 回は氷の柵
          e.rainT = 4.2 / (1 + (c.level - 1) * 0.05); // 柵のあとは少し長く休む
        } else if (live.length) {
          for (const ice of live.sort(() => Math.random() - 0.5).slice(0, 3)) dropIcicle(c, ice.mesh.position, ctx, scroll);
          e.rainT = 3.5 / (1 + (c.level - 1) * 0.05);
        } else {
          dropIcicle(c, p, ctx, scroll); // つららがなくなったら、中心から 1 本ずつ速く
          e.rainT = 1.1;
        }
      }
    },
    fire(c, e, ctx, p) {
      e.fireT = rand(2.2, 3);
      for (let s = -2; s <= 2; s++) c.fireBullet(p.clone(), ctx.player, s * 0.13);
    },
    onDeath(c, e) {
      for (const x of e.icicles) if (!x.dead) { x.dead = true; c.explode(x.mesh.position, false); }
    },
  },

  // 冠にぶら下がったつらら (撃って壊せる。壊すほど雨が減る)
  crownIce: {
    sideAbs: true,
    update(c, e, dt, scroll, ctx, p) {
      const b = e.body;
      if (b.dead) { e.dead = true; return; }
      const a = b.a + e.slot, R = 9 * b.k;
      const bp = b.mesh.position;
      if (ctx.side) p.set(bp.x, bp.y - 3 * b.k, bp.z + Math.cos(a) * R);
      else p.set(bp.x + Math.cos(a) * R, bp.y - 3 * b.k, bp.z + Math.sin(a) * R);
    },
  },

  // 降ってくるつらら: 印 → 落ちる → 地面に刺さって流れてくる
  icefall: {
    kamikaze: true,
    sideAbs: true,
    shielded: (e) => e.landed, // 柱になったら壊れない
    update(c, e, dt, scroll, ctx, p) {
      const mk = e.marker;
      mk.position.z += scroll * dt; // 印は地面と一緒に流れる
      if (e.gapMarker) {
        e.gapMarker.position.z += scroll * dt;
        e.gapMarker.material.opacity = 0.5 + 0.35 * Math.abs(Math.sin(e.t * 6));
        if (e.gapMarker.position.z > 30) { c.scene.remove(e.gapMarker); e.gapMarker = null; }
      }
      mk.material.opacity = 0.45 + 0.4 * Math.abs(Math.sin(e.t * 10));
      if (e.wait > 0) {
        e.wait -= dt; // 落ちる前は、ぶら下がっていた所で震える
        p.copy(e.from).add(_a.set(Math.sin(e.t * 60) * 0.15, 0, 0));
      } else if (!e.landed) {
        e.fall = Math.min(1, e.fall + dt / 0.9);
        const k = e.fall * e.fall;
        p.set(THREE.MathUtils.lerp(e.from.x, mk.position.x, e.fall), THREE.MathUtils.lerp(e.from.y, 2.5, k), THREE.MathUtils.lerp(e.from.z, mk.position.z, e.fall));
        if (e.fall >= 1) {
          e.landed = true;
          e.grow = 0;
          e.r = 0.01; // 柱になったら、下の縦の線で当たりを見る
          e.noLock = true;
          e.mesh.rotation.x = Math.PI; // 先を上に向ける
          c.scene.remove(mk);
          c.explode(_a.set(p.x, 0.5, p.z), false);
        }
      } else {
        p.z += scroll * dt; // 地面に刺さって流れてくる
        // 0.3 秒かけて高さ約 8 m の氷の柱に伸びる (高く飛んでも、よけるには 9 m 以上いる)
        e.grow = Math.min(1, e.grow + dt / 0.3);
        const h = 2.5 + 5.5 * e.grow;
        e.mesh.scale.set(1.2, 1.2 * h / 2.5, 1.2);
        p.y = h / 2;
        const P = ctx.player;
        if (!e.hit && Math.hypot(P.x - p.x, P.z - p.z) < 1.2 + ctx.playerR && P.y < h + ctx.playerR) {
          e.hit = true;
          ctx.onPlayerHit(15);
        }
      }
      if (p.z > 30) e.dead = true;
    },
    onDeath(c, e) {
      c.scene.remove(e.marker);
      if (e.gapMarker) c.scene.remove(e.gapMarker);
    },
  },
};
