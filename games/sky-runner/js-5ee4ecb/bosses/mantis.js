// ボス: 硝子のカマキリ (GLASS MANTIS)。14 面 (天井のある面)。ガラスのカマキリが大きな鎌を振り上げ、0.8 秒光って予告したあと、
// 横に長い三日月の斬撃を飛ばしてくる (プレイヤーのいた高さを飛ぶので、上下に動いてよける)。体力が半分を切ると両方の鎌で 2 段。
// 腹の結晶は、ふだんは弾を跳ね返す。鎌を振り終わった直後の 1.6 秒だけ水色に光って開き、倒せる
import * as THREE from 'three';
import { bossModel } from '../enemies.js';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;

const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  gem: new THREE.OctahedronGeometry(1, 0),
  head: new THREE.ConeGeometry(1, 1.6, 3).rotateX(Math.PI / 2),
  wave: new THREE.TorusGeometry(10, 0.5, 4, 24, Math.PI * 0.9), // 三日月の斬撃 (半円より少し短い弧)
};

function mat(color, emissive, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, flatShading: true, roughness: 0.15, metalness: 0.3, ...extra });
  m.userData.base = m.emissive.clone();
  return m;
}

export function spawnMantis(c, def) {
  const side = c.sideMode;
  const k = side ? 0.65 : 1.4; // 3D は大きく
  const hp = def.hp || 380;
  // Blender のモデル (GlassMantis) があればそれを。mats は [ガラス, 暗い殻, 腹の結晶, 左の刃, 右の刃]
  const model = bossModel('mantis', ['MantisGlass', 'MantisDark', 'MantisGem', 'MantisBladeL', 'MantisBladeR']);
  let g, mats, gemM, belly, arms, armSign;
  if (model) {
    g = model.mesh;
    mats = model.mats;
    gemM = mats[2];
    belly = g.getObjectByName('MantisBelly');
    // モデルは 180 度回して置くので、左右と、振り上げる向きが図形と逆になる
    arms = [['MantisArmL', 'MantisBladeL'], ['MantisArmR', 'MantisBladeR']].map(([an, bn]) => {
      const arm = g.getObjectByName(an);
      let blade = null;
      arm.traverse((o) => { if (o.isMesh && o.material.name === bn) blade = o; });
      return { arm, sx: -Math.sign(arm.position.x), blade };
    });
    armSign = -1;
  } else {
    const glassM = mat(0xc8ffd8, 0x1a5a3a, { transparent: true, opacity: 0.85 });
    const darkM = mat(0x2a4a3a, 0x000000);
    gemM = mat(0xe8fff0, 0x103a2a);
    g = new THREE.Group();
    const add = (geo, m, x, y, z, sx, sy, sz) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      g.add(mesh);
      return mesh;
    };
    add(GEO.box, glassM, 0, 2.5, 0, 3, 5, 3);        // 胸
    belly = add(GEO.gem, gemM, 0, -2, -1, 3.2, 4, 3.2); // 腹の結晶 (弱点)
    add(GEO.head, darkM, 0, 6, 1.5, 2.2, 2.2, 2.2);   // 頭
    for (const sx of [-1, 1]) add(GEO.box, darkM, sx * 1.6, -6, 0, 0.6, 6, 0.6); // 脚
    arms = [-1, 1].map((sx) => {
      const arm = new THREE.Group();
      arm.position.set(sx * 2.4, 4, 1);
      const upper = new THREE.Mesh(GEO.box, glassM);
      upper.scale.set(1, 6, 1);
      upper.position.y = 3;
      const blade = new THREE.Mesh(GEO.box, mat(0xe8fff0, 0x2a8a5a, { metalness: 0.8 }));
      blade.scale.set(0.5, 7, 1.4);
      blade.position.set(0, 6, 2.5);
      blade.rotation.x = 1.2;
      arm.add(upper, blade);
      g.add(arm);
      return { arm, sx, blade };
    });
    mats = [glassM, darkM, gemM, ...arms.map((a) => a.blade.material)];
    armSign = 1;
  }
  g.scale.setScalar(k);
  const grp = { type: 'mantis', t: 0, escape: Infinity, total: 1, kills: 0, leaving: false, bonus: 10000 };
  const body = {
    kind: 'mantis', mesh: g, mats, r: 4 * k, hp, maxHp: hp, score: 0, t: 0, flash: 0, fireT: 3,
    k, arms, gemM, belly, bellyBase: belly.scale.clone(), armSign, x: c.lastPlayer?.x ?? 0, z: SPAWN_Z, state: 'idle', timer: 2.5, open: 0, turn: 0, bossGroup: grp, // 盾のある間はアシストが選ばない (開いている間だけ効く)
  };
  grp.ratio = () => Math.max(0, body.hp / body.maxHp);
  c.bossGroup = grp;
  g.position.set(body.x, 9, SPAWN_Z);
  c.addEnemy(body, 4 * k);
  c.bossDefeated = false;
}

// vert: 縦の三日月 (右の鎌。プレイヤーのいた横の位置を飛ぶので、左右によける)。横スクロールでは横の三日月だけ
function launchWave(c, body, ctx, vert) {
  if (ctx.side) vert = false;
  const m = mat(0xe8fff0, vert ? 0xc060ff : 0x60f0c0, { transparent: true, opacity: 0.85 }); // 縦は紫、横は緑
  const arc = new THREE.Mesh(GEO.wave, m);
  arc.rotation.x = Math.PI / 2; // 水平な弧 (プレイヤーの方へふくらむ)
  const mesh = new THREE.Group();
  mesh.add(arc);
  if (vert) mesh.rotation.z = Math.PI / 2; // 縦に立てる
  mesh.scale.setScalar(ctx.side ? 0.5 : 1);
  const P = ctx.player;
  const from = body.mesh.position.clone();
  const y = THREE.MathUtils.clamp(P.y, 1, (c.ceilingY ?? 40) - 2);
  from.y = vert ? Math.max(10, y) : y;
  if (vert) from.x = P.x;
  const w = { kind: 'slashwave', mesh, mats: [m], r: 0.1, hp: Infinity, score: 0, t: 0, flash: 0, fireT: Infinity, noLock: true, vz: 42, y: from.y, x: from.x, vert, hit: false, R: 10 * (ctx.side ? 0.5 : 1) };
  mesh.position.copy(from);
  c.addEnemy(w, 0);
  w.shadow.visible = false;
}

export const MANTIS_KINDS = {
  mantis: {
    big: true,
    shielded: (e) => e.open < 0.6, // 腹の結晶は、鎌を振り終わった直後だけ開く
    update(c, e, dt, scroll, ctx, p) {
      const hz = c.holdZ(-50);
      e.z = Math.min(hz, e.z + (scroll * 0.4 + 28) * dt);
      e.x += ((ctx.player.x ?? 0) - e.x) * Math.min(1, dt * 0.6); // 素早く横に回り込む
      const top = c.ceilingY ? c.ceilingY - 11 : 9;
      p.set(e.x, Math.min(9, top) + Math.sin(e.t * 1.2) * 0.6, e.z);
      e.timer -= dt;
      if (e.state === 'idle' && e.timer <= 0 && e.z >= hz - 1) {
        e.state = 'raise';
        e.timer = 0.8;
        e.turn++;
      } else if (e.state === 'raise') {
        // 予告: 鎌を振り上げて光る
        const both = e.hp < e.maxHp * 0.5;
        for (const a of e.arms) if (both || (e.turn % 2 === 0) === (a.sx > 0)) {
          a.arm.rotation.x = -1.6 * (1 - e.timer / 0.8) * e.armSign;
          a.blade.material.userData.base.setHex(0xff4060);
        }
        if (e.timer <= 0) {
          // 左の鎌は横の三日月、右の鎌は縦の三日月。体力が半分を切ると両方 (十字)
          for (const a of e.arms) if (both || (e.turn % 2 === 0) === (a.sx > 0)) launchWave(c, e, ctx, a.sx > 0);
          e.state = 'open';
          e.timer = 1.6;
        }
      } else if (e.state === 'open') {
        for (const a of e.arms) {
          a.arm.rotation.x = e.armSign * Math.min(0.4, e.armSign * a.arm.rotation.x + dt * 8); // 振り下ろす
          a.blade.material.userData.base.setHex(0x2a8a5a);
        }
        if (e.timer <= 0) { e.state = 'idle'; e.timer = rand(1.4, 2.2) / (1 + (c.level - 1) * 0.05); }
      } else {
        for (const a of e.arms) a.arm.rotation.x += (0 - a.arm.rotation.x) * Math.min(1, dt * 4);
      }
      const want = e.state === 'open' ? 1 : 0;
      e.open += THREE.MathUtils.clamp(want - e.open, -dt * 4, dt * 6);
      e.gemM.userData.base.setHex(e.open > 0.6 ? 0x60f0ff : 0x103a2a); // 倒せるときは水色
      e.belly.scale.copy(e.bellyBase).multiplyScalar(1 + e.open * 0.22); // 開くと腹の結晶がふくらむ
    },
    fire(c, e, ctx, p) {
      e.fireT = rand(2.6, 3.4);
      if (e.state !== 'idle') return;
      for (const s of [-0.15, 0, 0.15]) c.fireBullet(p.clone(), ctx.player, s);
    },
  },

  // 三日月の斬撃: 前へ飛ぶ。プレイヤーの高さ ±1.8 m・横幅の中にいたら当たる (撃ち落とせない)
  slashwave: {
    sideAbs: true,
    shielded: () => true,
    update(c, e, dt, scroll, ctx, p) {
      const z0 = p.z;
      p.z += e.vz * dt;
      p.y = e.y;
      if (e.vert) p.x = e.x;
      const P = ctx.player;
      // 見た目の三日月 (プレイヤーの方へふくらむ弧) の、プレイヤーの位置での先端が、プレイヤーを越えたら当たり。
      // 横の三日月は横の位置で、縦の三日月は高さで先端を見る。幅 (±1.8 m) の外にいればよけられる
      const along = e.vert ? P.y - e.y : ctx.side ? 0 : P.x - p.x;
      const across = e.vert ? P.x - e.x : P.y - e.y;
      const u = along / e.R;
      const bulge = Math.abs(u) < 1 ? e.R * Math.sqrt(1 - u * u) : -Infinity;
      const crossed = (z0 + bulge - P.z) * (p.z + bulge - P.z) <= 0;
      if (!e.hit && crossed && Math.abs(across) < 1.8 + ctx.playerR) {
        e.hit = true;
        ctx.onPlayerHit(20);
      }
      // 縦の三日月は、目の近く (6 m 以内) では薄くする (VR で目の前を大きな光がふさがないように)
      const near = e.vert ? THREE.MathUtils.clamp(Math.abs(p.z - P.z) / 6, 0.15, 1) : 1;
      e.mats[0].opacity = 0.85 * Math.max(0, 1 - e.t / 3) * near;
      if (p.z > 30 || e.t > 3) e.dead = true;
    },
  },
};
