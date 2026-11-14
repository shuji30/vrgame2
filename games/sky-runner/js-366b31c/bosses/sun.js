// 最終ボス: プリズムの太陽 (PRISM SUN)。18 面のボスラッシュのあとに出る。体力が減るごとに、これまでのボスの仕組みを順に使う。
//   第 1 段階 (体力 3/4 まで): まわりを鏡が回り、弾を撃ち返す (ミラーコアの鏡をそのまま使う)。すき間から核を撃つ
//   第 2 段階 (0.4 まで): 鏡が砕け、地面の岩と柱を浮かせて投げてくる (磁鉄の巨像の破片を使う)
//   第 3 段階: 光の花びらを閉じて守り (弾を跳ね返す)、開いて水色に光っている間だけ倒せる。開くと渦巻き弾
//   どの段階でも、花びらから 1 枚ずつ順にミサイルを撃つ (五月雨撃ち)
import * as THREE from 'three';
import { makeDebris, launchDebris } from './colossus.js';
import { bossModel } from '../enemies.js';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;
const _a = new THREE.Vector3();

const GEO = {
  core: new THREE.IcosahedronGeometry(1, 1),
  ray: new THREE.ConeGeometry(0.35, 2.2, 6).translate(0, 1.6, 0), // 原点から外へ伸びる光の花びら
  mirror: new THREE.CylinderGeometry(1, 1, 0.12, 6).rotateX(Math.PI / 2),
  rim: new THREE.TorusGeometry(1, 0.08, 4, 6),
};

function mat(color, emissive, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, flatShading: true, roughness: 0.2, metalness: 0.3, ...extra });
  m.userData.base = m.emissive.clone();
  return m;
}

export function spawnSun(c, def) {
  const side = c.sideMode;
  const k = side ? 0.6 : 1;
  const hp = def.hp || 900;
  // 核: Blender のモデル (PrismSun。半径 5) か図形で。mats[0] は核 (段階と、倒せるときの色を変える)
  const cm = bossModel('sun', ['SunCore', 'SunGold']);
  const coreM = cm ? cm.mats[0] : mat(0xffe08a, 0xff9a20);
  const g = new THREE.Group();
  if (cm) g.add(cm.mesh);
  else {
    const core = new THREE.Mesh(GEO.core, coreM);
    core.scale.setScalar(5);
    g.add(core);
  }
  // 花びら: Blender のモデル (SunPetal) を 1 枚作って 12 枚に複製する (材質は 12 枚で共有)
  const pm = bossModel('sunPetal', ['SunPetalMat']);
  const rayM = pm ? pm.mats[0] : mat(0xfff2c4, 0xff7a10, { metalness: 0.5 });
  const rays = [];
  for (let i = 0; i < 12; i++) {
    const r = pm ? pm.mesh.clone() : new THREE.Mesh(GEO.ray, rayM);
    const a = (i / 12) * Math.PI * 2;
    r.rotation.z = a;
    r.scale.setScalar(3);
    r.position.set(Math.cos(a + Math.PI / 2) * 4, Math.sin(a + Math.PI / 2) * 4, 0);
    g.add(r);
    rays.push(r);
  }
  g.scale.setScalar(k);
  const grp = { type: 'sun', t: 0, escape: Infinity, total: 1, kills: 0, leaving: false, bonus: 30000 };
  const sun = {
    kind: 'sun', mesh: g, mats: cm ? [...cm.mats, rayM] : [coreM, rayM], r: 6 * k, hp, maxHp: hp, score: 0, t: 0, flash: 0, fireT: 3, noAssist: true,
    k, rays, coreM, stage: 1, x: c.lastPlayer?.x ?? 0, y: THREE.MathUtils.clamp((c.lastPlayer?.y ?? 6) + 5, 9, 13), z: SPAWN_Z,
    // 鏡 (ミラーコアの鏡の動きが読む値)
    tier: { R: side ? 8 : 15 }, a: 0, mirrors: [], reflectT: 0, reflectEvery: 0.9,
    // 第 2 段階の投げる攻撃 (磁鉄の巨像の破片が読む値)
    held: [], throwT: 3,
    // 第 3 段階の開け閉め
    open: 0, petal: 'closed', petalT: 2,
    bossGroup: grp,
  };
  grp.ratio = () => Math.max(0, sun.hp / sun.maxHp);
  c.bossGroup = grp;
  g.position.set(sun.x, sun.y, SPAWN_Z);
  c.addEnemy(sun, 5 * k);
  // 第 1 段階の鏡 (横スクロールは 5 枚、3D は 7 枚)
  const n = side ? 5 : 7, size = side ? 2.6 : 4.3;
  for (let i = 0; i < n; i++) {
    // 鏡: ミラーコアのモデル (MirrorPlate) を使い回す。読み込む前は図形で
    const pmd = bossModel('mirrorPlate', ['MirrorGlass', 'MirrorRim']) || (() => {
      const glass = mat(0xe8fbff, 0x3a7a9a);
      const rimM = mat(0xffd36a, 0x7a5a10);
      const grp = new THREE.Group();
      const rim = new THREE.Mesh(GEO.rim, rimM);
      rim.rotation.z = Math.PI / 6;
      grp.add(new THREE.Mesh(GEO.mirror, glass), rim);
      return { mesh: grp, mats: [glass, rimM] };
    })();
    const mg = pmd.mesh;
    mg.scale.setScalar(size);
    const m = { kind: 'mirror', mesh: mg, mats: pmd.mats, r: size * 0.95, hp: Infinity, score: 0, t: 0, flash: 0, fireT: Infinity,
      core: sun, slot: (i / n) * Math.PI * 2, noLock: true, reflectT: 0, dmg: 15 };
    mg.position.copy(g.position);
    c.addEnemy(m, 0);
    m.shadow.visible = false;
    sun.mirrors.push(m);
  }
  c.bossDefeated = false;
}

export const SUN_KINDS = {
  sun: {
    big: true,
    // 第 3 段階は、花びらが開いている間だけ倒せる
    shielded: (e) => e.stage === 3 && e.open < 0.6,
    update(c, e, dt, scroll, ctx, p) {
      const hz = c.holdZ(-60);
      e.z = Math.min(hz, e.z + (scroll * 0.4 + 28) * dt);
      e.x += ((ctx.player.x ?? 0) - e.x) * Math.min(1, dt * 0.2);
      p.set(e.x + Math.sin(e.t * 0.3) * (ctx.side ? 0 : 10), e.y + Math.sin(e.t * 0.5) * 2, e.z);
      e.mesh.rotation.z += dt * (e.stage === 3 ? 0.6 : 0.25);
      e.a += dt * 0.55;
      e.reflectT -= dt;
      // 段階の切り替え (体力 2/3・1/3)
      const ratio = e.hp / e.maxHp;
      if (e.stage === 1 && ratio < 0.75) {
        e.stage = 2;
        for (const m of e.mirrors) if (!m.dead) { m.dead = true; c.explode(m.mesh.position, false); }
        c.announce = 'PHASE 2';
        c.spawnItem(p.clone()); // 段階が変わるたびに回復を 1 個
        e.coreM.userData.base.setHex(0xff5a20);
      } else if (e.stage === 2 && ratio < 0.4) {
        e.stage = 3;
        for (const d of e.held) if (!d.dead) { d.dead = true; c.explode(d.mesh.position, false); }
        e.held = [];
        c.announce = 'FINAL PHASE';
        c.spawnItem(p.clone());
      }
      // 第 2 段階: 浮かせて (1 秒光って予告)、投げる
      if (e.stage === 2 && e.z >= hz - 1) {
        e.throwT -= dt;
        if (e.throwT <= 1 && !e.held.length) for (let i = 0; i < 4; i++) e.held.push(makeDebris(c, e, i, 4));
        if (e.throwT <= 0 && e.held.length) {
          for (const d of e.held) if (!d.dead) launchDebris(d, ctx);
          e.held = [];
          e.throwT = rand(2.6, 3.4);
        }
      }
      // 五月雨撃ち: 花びらから 1 枚ずつ順に (0.1 秒おきに) ミサイルを撃つ
      if (e.rain) {
        e.rain.t -= dt;
        while (e.rain.t <= 0 && e.rain.n < e.rain.petals.length) {
          e.rain.t += 0.1;
          const from = e.rays[e.rain.petals[e.rain.n++]].getWorldPosition(new THREE.Vector3());
          c.fireBullet(from, ctx.player, rand(-0.08, 0.08), 'shell');
        }
        if (e.rain.n >= e.rain.petals.length) e.rain = null;
      }
      // 第 3 段階: 花びらを閉じる (2.2 秒) → 開く (1.6 秒)。開く 0.5 秒前に震えて予告
      if (e.stage === 3) {
        e.petalT -= dt;
        if (e.petalT <= 0) {
          e.petal = e.petal === 'closed' ? 'open' : 'closed';
          e.petalT = e.petal === 'open' ? 1.6 : 2.2;
          if (e.petal === 'open') e.fireT = 0.2;
        }
        const want = e.petal === 'open' ? 1 : 0;
        e.open += THREE.MathUtils.clamp(want - e.open, -dt * 4, dt * 5);
        const warn = e.petal === 'closed' && e.petalT < 0.5;
        e.rays.forEach((r, i) => {
          const a = (i / 12) * Math.PI * 2;
          const d = 4 + e.open * 3 + (warn ? Math.sin(e.t * 40 + i) * 0.3 : 0);
          r.position.set(Math.cos(a + Math.PI / 2) * d, Math.sin(a + Math.PI / 2) * d, 0);
          r.scale.setScalar(3 - (1 - e.open) * 1.2);
        });
        e.coreM.userData.base.setHex(e.open > 0.6 ? 0x60f0ff : warn ? 0x8a5a40 : 0x5a2010); // 倒せるときは水色
      }
    },
    fire(c, e, ctx, p) {
      if (e.stage === 3) {
        // 開いている間は 4 本の渦巻き弾。閉じている間は、1 枚おきの花びらから五月雨撃ち
        if (e.petal !== 'open') {
          e.fireT = 2.2;
          if (!e.rain) e.rain = { t: 0, n: 0, petals: [0, 2, 4, 6, 8, 10] };
          return;
        }
        e.fireT = 0.3;
        e.spA = (e.spA || 0) + 0.7;
        for (let k = 0; k < 4; k++) c.fireBullet(p.clone(), ctx.player, Math.sin(e.spA + (k * Math.PI) / 2) * 0.55);
        return;
      }
      // 第 1・2 段階: 9 発の扇と、12 枚の花びらからの五月雨撃ちをかわるがわる (投げている間は撃たない)
      e.fireT = rand(1.3, 1.7);
      if (e.held.length || e.rain) return;
      e.volley = (e.volley || 0) + 1;
      if (e.volley % 2) for (let s = -4; s <= 4; s++) c.fireBullet(p.clone(), ctx.player, s * 0.1);
      else {
        const first = Math.floor(Math.random() * 12), dir = Math.random() < 0.5 ? 1 : -1; // 回る向きに順に
        e.rain = { t: 0, n: 0, petals: Array.from({ length: 12 }, (_, i) => (first + dir * i + 12) % 12) };
      }
    },
    onDeath(c, e) {
      for (const x of [...e.mirrors, ...e.held]) if (!x.dead) { x.dead = true; c.explode(x.mesh.position, false); }
    },
  },
};
