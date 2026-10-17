// ボス: 双子の回転刃 (TWIN TURBINE)。9 面 (天井のある面)。中央の核の左右に、回転する刃の円盤が 1 枚ずつ付いている。
// 円盤が赤く光る 1 秒の予告のあと、それぞれがプレイヤーのいた所へ飛んできて、通り過ぎたら弧を描いて戻る。
// 円盤は壊せず弾を跳ね返す。中央の核を撃って倒す (核は扇の弾も撃つ)。横スクロールでは円盤を核の上下に付ける
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;
const _a = new THREE.Vector3();

const GEO = {
  core: new THREE.IcosahedronGeometry(1, 1),
  axle: new THREE.CylinderGeometry(0.4, 0.4, 1, 8).rotateZ(Math.PI / 2),
  disc: new THREE.CylinderGeometry(1, 1, 0.25, 16).rotateX(Math.PI / 2),
  tooth: new THREE.ConeGeometry(0.35, 1, 4),
};

function mat(color, emissive, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, flatShading: true, roughness: 0.3, metalness: 0.6, ...extra });
  m.userData.base = m.emissive.clone();
  return m;
}

export function spawnTurbine(c, def) {
  const side = c.sideMode;
  const k = side ? 0.65 : 1;
  const hp = def.hp || 360;
  const coreM = mat(0x9fe8ff, 0x3a9ad0);
  const axleM = mat(0x8a8fa0, 0x000000);
  const g = new THREE.Group();
  const core = new THREE.Mesh(GEO.core, coreM);
  core.scale.setScalar(3);
  const axle = new THREE.Mesh(GEO.axle, axleM);
  axle.scale.set(16, 1, 1);
  if (side) axle.rotation.z = Math.PI / 2; // 横スクロールは縦の軸
  g.add(core, axle);
  g.scale.setScalar(k);
  const grp = { type: 'turbine', t: 0, escape: Infinity, total: 1, kills: 0, leaving: false, bonus: 10000 };
  const body = {
    kind: 'turbine', mesh: g, mats: [coreM, axleM], r: 3.4 * k, hp, maxHp: hp, score: 0, t: 0, flash: 0, fireT: 3,
    k, x: c.lastPlayer?.x ?? 0, z: SPAWN_Z, blades: [], cycle: 4, bossGroup: grp,
  };
  grp.ratio = () => Math.max(0, body.hp / body.maxHp);
  c.bossGroup = grp;
  g.position.set(body.x, 12, SPAWN_Z);
  c.addEnemy(body, 4 * k);
  for (const sx of [-1, 1]) {
    const bm = mat(0xd8dce8, 0x202838, { metalness: 0.9 });
    const bg = new THREE.Group();
    const disc = new THREE.Mesh(GEO.disc, bm);
    disc.scale.setScalar(5);
    bg.add(disc);
    for (let i = 0; i < 10; i++) {
      const t = new THREE.Mesh(GEO.tooth, bm);
      const a = (i / 10) * Math.PI * 2;
      t.position.set(Math.cos(a) * 5.4, Math.sin(a) * 5.4, 0);
      t.rotation.z = a - Math.PI / 2;
      t.scale.setScalar(1.6);
      bg.add(t);
    }
    bg.scale.setScalar(k);
    const b = { kind: 'blade', mesh: bg, mats: [bm], r: 5.2 * k, hp: Infinity, score: 0, t: 0, flash: 0, fireT: Infinity, body, sx, state: 'hold', u: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), noLock: true, dmg: 25 };
    bg.position.copy(g.position);
    c.addEnemy(b, 3 * k);
    body.blades.push(b);
  }
  c.bossDefeated = false;
}

// 円盤が止まっている場所 (核の左右、横スクロールは上下)
const slot = (b, side) => {
  const bp = b.body.mesh.position, d = 12 * b.body.k;
  return side ? _a.set(bp.x, bp.y + b.sx * d * 0.7, bp.z) : _a.set(bp.x + b.sx * d, bp.y, bp.z);
};

export const TURBINE_KINDS = {
  turbine: {
    big: true,
    update(c, e, dt, scroll, ctx, p) {
      const hz = c.holdZ(-48);
      e.z = Math.min(hz, e.z + (scroll * 0.4 + 28) * dt);
      e.x += ((ctx.player.x ?? 0) - e.x) * Math.min(1, dt * 0.3);
      const top = c.ceilingY ? c.ceilingY - 12 : 12;
      p.set(e.x + Math.sin(e.t * 0.5) * (ctx.side ? 0 : 10), Math.min(12, top) + Math.sin(e.t * 0.9) * 1.5, e.z);
      // 投げる周期: 止まる → 予告 (1 秒) → 投げる (円盤は自分で戻ってくる)
      if (e.z >= hz - 1 && e.blades.every((b) => b.state === 'hold')) {
        e.cycle -= dt;
        if (e.cycle <= 0) {
          e.cycle = rand(3.2, 4.2) / (1 + (c.level - 1) * 0.05);
          // 交互に 1 枚ずつ、体力が半分を切ったら 2 枚同時に
          const both = e.hp < e.maxHp * 0.5;
          e.turn = (e.turn || 0) + 1;
          for (const b of e.blades) if (both || (e.turn % 2 === 0) === (b.sx > 0)) { b.state = 'warn'; b.u = 0; }
        }
      }
    },
    fire(c, e, ctx, p) {
      e.fireT = rand(2.4, 3.2);
      for (let s = -2; s <= 2; s++) c.fireBullet(p.clone(), ctx.player, s * 0.13);
    },
    onDeath(c, e) {
      for (const b of e.blades) if (!b.dead) { b.dead = true; c.explode(b.mesh.position, true); }
    },
  },

  blade: {
    sideAbs: true,
    shielded: () => true, // 壊せない (弾を跳ね返す)
    update(c, e, dt, scroll, ctx, p) {
      const b = e.body;
      if (b.dead) { e.dead = true; return; }
      const spin = e.state === 'hold' ? 4 : 14;
      e.mesh.rotation.z += dt * spin * e.sx;
      if (e.state === 'hold') {
        p.copy(slot(e, ctx.side));
        e.mats[0].userData.base.setHex(0x202838);
      } else if (e.state === 'warn') {
        // 予告: 赤く光って震える (1 秒)
        e.u += dt;
        p.copy(slot(e, ctx.side)).add(_a.set(Math.sin(e.t * 50) * 0.3, 0, 0));
        e.mats[0].userData.base.setHex(0xff3020).multiplyScalar(0.4 + 0.6 * Math.abs(Math.sin(e.t * 12)));
        if (e.u >= 1) {
          e.state = 'throw';
          e.u = 0;
          e.from.copy(p);
          // プレイヤーのいた所を通り過ぎて、少し後ろまで飛ぶ
          e.to.copy(ctx.player).add(_b.subVectors(ctx.player, p).normalize().multiplyScalar(14));
        }
      } else if (e.state === 'throw') {
        e.u += dt / 1.1;
        p.lerpVectors(e.from, e.to, Math.min(1, e.u));
        if (e.u >= 1) { e.state = 'back'; e.u = 0; e.from.copy(p); }
      } else {
        // 弧を描いて (上へふくらんで) 戻る
        e.u += dt / 1.4;
        const u = Math.min(1, e.u);
        const home = slot(e, ctx.side);
        p.lerpVectors(e.from, home, u);
        p.y += Math.sin(u * Math.PI) * 8;
        if (u >= 1) e.state = 'hold';
      }
    },
  },
};

const _b = new THREE.Vector3();
