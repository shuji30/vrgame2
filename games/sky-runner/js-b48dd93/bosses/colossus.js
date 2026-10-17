// ボス: 磁鉄の巨像 (MAGNET COLOSSUS)。磁鉄鉱の塊でできた巨像が前方の地面に立ち、頭に U 字の磁石を載せている。
// 左右に浮かぶ 2 つの電極が残っている間、本体はバリアで弾を跳ね返す (先に電極を壊す)。体力が半分を切ると電極が 1 度だけ戻る。
// 両腕を上げると磁石が赤く光り、地面から岩と柱の破片が浮き上がって (1 秒の予告)、プレイヤーへ飛んでくる。
// 岩は撃って壊せる、柱は壊せない。正面だけでなく、少しずらした所を狙うものも混ぜる
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;
const _a = new THREE.Vector3();

const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  magnet: new THREE.TorusGeometry(1, 0.32, 6, 12, Math.PI), // U 字 (半円)
  orb: new THREE.IcosahedronGeometry(1, 1),
  rock: new THREE.DodecahedronGeometry(1, 0),
  pillar: new THREE.CylinderGeometry(1, 1, 1, 8),
};

function mat(color, emissive, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, flatShading: true, roughness: 0.7, metalness: 0.4, ...extra });
  m.userData.base = m.emissive.clone();
  return m;
}

export function spawnColossus(c, def) {
  const side = c.sideMode;
  const k = side ? 0.6 : 1;
  const hp = def.hp || 320;
  const ironM = mat(0x3a3a48, 0x000000);
  const darkM = mat(0x24242e, 0x000000);
  const magM = mat(0xc83a3a, 0x300808, { metalness: 0.6 });
  const tipM = mat(0xe8ecf4, 0x202430, { metalness: 0.8 });
  const eyeM = mat(0x80ffd0, 0x40c090);
  // 原点 = 胸 (当たりの中心)。脚と頭は上下に伸ばす
  const g = new THREE.Group();
  const add = (geo, m, x, y, z, sx, sy, sz, name) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    if (name) mesh.name = name;
    g.add(mesh);
    return mesh;
  };
  add(GEO.box, ironM, 0, 0, 0, 10, 8, 6);            // 胴
  add(GEO.box, darkM, 0, -5.5, 0, 7, 3, 5);          // 腰
  add(GEO.box, ironM, -2.6, -11, 0, 2.6, 8, 3);      // 左脚
  add(GEO.box, ironM, 2.6, -11, 0, 2.6, 8, 3);       // 右脚
  add(GEO.box, darkM, 0, 6, 0, 5, 4, 4.5);           // 頭
  add(GEO.box, eyeM, 0, 6.3, 2.3, 3.4, 0.7, 0.2);    // 目の光
  const magnet = add(GEO.magnet, magM, 0, 9.2, 0, 3.4, 3.4, 3.4, 'magnet');
  for (const sx of [-1, 1]) add(GEO.box, tipM, sx * 3.4, 9.2, 0, 1.6, 1.4, 1.6); // 磁石の先
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group(); // 肩を軸に回す
    arm.position.set(sx * 6.4, 2.5, 0);
    const a = new THREE.Mesh(GEO.box, ironM);
    a.scale.set(2.4, 9, 2.6);
    a.position.y = -4;
    arm.add(a);
    g.add(arm);
    arms.push(arm);
  }
  g.scale.setScalar(k);
  const grp = { type: 'colossus', t: 0, escape: Infinity, total: 1, kills: 0, leaving: false, bonus: 12000 };
  const body = {
    kind: 'colossus', mesh: g, mats: [ironM, darkM, magM, tipM, eyeM], r: 7 * k, hp, maxHp: hp, score: 0, t: 0, flash: 0, fireT: 5,
    k, magM, magnet, arms, x: c.lastPlayer?.x ?? 0, z: SPAWN_Z, electrodes: [], revived: false,
    throwT: 4, raise: 0, held: [], bossGroup: grp, noAssist: true,
  };
  grp.ratio = () => Math.max(0, body.hp / body.maxHp);
  c.bossGroup = grp;
  g.position.set(body.x, 15 * k, SPAWN_Z);
  // バリアの殻 (電極が残っている間だけ見える) と、電極からの光の線 (ワールドに置く)
  const shellM = new THREE.MeshBasicMaterial({ color: 0x80e8ff, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending });
  body.barrier = new THREE.Mesh(GEO.orb, shellM);
  body.barrier.scale.set(9, 13, 7);
  body.barrier.position.y = 1;
  g.add(body.barrier);
  body.beams = [0, 1].map(() => {
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const ln = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x9ff4ff }));
    ln.frustumCulled = false;
    c.scene.add(ln);
    return ln;
  });
  c.addEnemy(body, 7 * k);
  makeElectrodes(c, body);
  c.bossDefeated = false;
}

function makeElectrodes(c, body) {
  body.electrodes = [-1, 1].map((sx) => {
    const m = mat(0x9fe8ff, 0x3a9ad0);
    const mesh = new THREE.Mesh(GEO.orb, m);
    mesh.scale.setScalar(2.2 * body.k);
    const e = { kind: 'electrode', mesh, mats: [m], r: 2.6 * body.k, hp: 10 + c.level, score: 1500, t: 0, flash: 0, fireT: Infinity, body, sx, big: true };
    mesh.position.copy(body.mesh.position);
    c.addEnemy(e, 1.5 * body.k);
    return e;
  });
}

export const COLOSSUS_KINDS = {
  colossus: {
    big: true,
    shielded: (e) => e.electrodes.some((x) => !x.dead), // 電極が残っている間はバリア
    update(c, e, dt, scroll, ctx, p) {
      const hz = c.holdZ(-62);
      e.z = Math.min(hz, e.z + (scroll * 0.4 + 26) * dt);
      e.x += ((ctx.player.x ?? 0) - e.x) * Math.min(1, dt * 0.2);
      // ゆっくり歩くように少し揺れる (地面に立つので、胸の高さは 15 m)
      p.set(e.x + Math.sin(e.t * 0.4) * 5, 15 * e.k + Math.abs(Math.sin(e.t * 0.8)) * 0.4, e.z);
      e.mesh.rotation.y = Math.sin(e.t * 0.4) * 0.12;
      const shield = COLOSSUS_KINDS.colossus.shielded(e);
      e.mats[4].userData.base.setHex(shield ? 0x206050 : 0x60f0ff); // バリアがない間は目が水色に光る (いま倒せる)
      // バリア: 半透明の殻と、電極から本体への光の線
      e.barrier.visible = shield;
      e.barrier.material.opacity = 0.18 + Math.sin(e.t * 6) * 0.06;
      e.beams.forEach((ln, i) => {
        const el = e.electrodes[i];
        ln.visible = !!el && !el.dead;
        if (ln.visible) {
          const a = ln.geometry.attributes.position;
          a.setXYZ(0, el.mesh.position.x, el.mesh.position.y, el.mesh.position.z);
          a.setXYZ(1, p.x, p.y, p.z);
          a.needsUpdate = true;
        }
      });
      // 体力が半分を切ると、電極が 1 度だけ戻る
      if (!e.revived && e.hp < e.maxHp * 0.5) {
        e.revived = true;
        makeElectrodes(c, e);
      }
      // 投げる: 腕を上げて磁石が赤く光る (1 秒) → 浮かせた破片を投げる
      if (e.z >= hz - 1) e.throwT -= dt; // 止まってから数える (近づく間に減って予告なしで飛んでこないように)
      if (e.throwT <= 1 && !e.held.length && e.z >= hz - 1) {
        const n = e.hp < e.maxHp * 0.5 ? 4 : 3;
        for (let i = 0; i < n; i++) e.held.push(makeDebris(c, e, i, n));
        e.throwT = 1; // 必ず 1 秒の予告
      }
      const want = e.held.length ? 1 : 0;
      e.raise += THREE.MathUtils.clamp(want - e.raise, -dt * 2, dt * 3);
      for (const arm of e.arms) arm.rotation.z = Math.sign(arm.position.x) * e.raise * 2.4;
      e.magM.userData.base.setHex(0x300808).lerp(new THREE.Color(0xff2a10), e.raise);
      if (e.throwT <= 0 && e.held.length) {
        for (const d of e.held) if (!d.dead) launchDebris(d, ctx);
        e.held = [];
        e.throwT = rand(4, 5.5) / (1 + (c.level - 1) * 0.06);
      }
    },
    fire(c, e, ctx, p) {
      // 頭から 5 発の扇 (投げている間は撃たない)
      e.fireT = rand(3, 4);
      if (e.held.length) return;
      const from = _a.copy(p).add(new THREE.Vector3(0, 6 * e.k, 3));
      for (let s = -2; s <= 2; s++) c.fireBullet(from.clone(), ctx.player, s * 0.12);
    },
    onDeath(c, e) {
      for (const x of [...e.electrodes, ...e.held]) if (!x.dead) { x.dead = true; c.explode(x.mesh.position, false); }
      for (const ln of e.beams) c.scene.remove(ln);
    },
  },

  electrode: {
    big: true, // 壊すと大きく爆発し、回復アイテムを落とすことがある
    update(c, e, dt, scroll, ctx, p) {
      const b = e.body;
      if (b.dead) { e.dead = true; return; }
      const bp = b.mesh.position;
      // 本体の左右で、ゆっくり上下に揺れる (横スクロールは胴の前の上と下)
      if (ctx.side) p.set(bp.x, bp.y + e.sx * 8 * b.k + Math.sin(e.t * 1.3 + e.sx) * 1.5, bp.z + 8 * b.k);
      else p.set(bp.x + e.sx * 13 * b.k, bp.y + 2 * b.k + Math.sin(e.t * 1.3 + e.sx) * 3 * b.k, bp.z + 3 * b.k);
      e.mesh.rotation.y += dt * 2;
    },
  },

  // 投げられる破片: 浮き上がって光り (予告)、投げられたら一直線に飛ぶ。岩は撃って壊せる、柱は壊せない
  debris: {
    kamikaze: true,
    sideAbs: true,
    shielded: (e) => e.hp === Infinity, // 柱は壊せない (弾を跳ね返す)
    update(c, e, dt, scroll, ctx, p) {
      if (!e.vel) {
        // 浮き上がって待つ (光って予告する)
        const b = e.body;
        if (b.dead) { e.dead = true; return; }
        e.lift = Math.min(1, e.lift + dt * 1.6);
        const bp = b.mesh.position;
        if (ctx.side) p.set(bp.x, THREE.MathUtils.lerp(0.5, bp.y + (e.oy - 6 + e.ox * 0.5) * b.k, e.lift), bp.z + 10 * b.k); // 横スクロールは胴の前に縦に並べる
        else p.set(bp.x + e.ox * b.k, THREE.MathUtils.lerp(0.5, bp.y + e.oy * b.k, e.lift), bp.z + 6 * b.k);
        e.mats[0].userData.base.setHex(e.glow).multiplyScalar(0.4 + 0.6 * Math.abs(Math.sin(e.t * 9)));
      } else {
        p.addScaledVector(e.vel, dt);
        if (p.z > 30 || e.t > 8) e.dead = true;
      }
      e.mesh.rotation.x += dt * e.spin;
      e.mesh.rotation.z += dt * e.spin * 0.6;
    },
  },
};

export function makeDebris(c, body, i, n) {
  const pillar = i % 3 === 1; // 3 つに 1 つは壊せない柱
  const m = pillar ? mat(0x9a8a7a, 0x000000) : mat(0x6a5a4a, 0x000000);
  const mesh = new THREE.Mesh(pillar ? GEO.pillar : GEO.rock, m);
  if (pillar) mesh.scale.set(1.3, 6, 1.3);
  else mesh.scale.setScalar(rand(2, 2.8));
  mesh.scale.multiplyScalar(body.k);
  const d = {
    kind: 'debris', mesh, mats: [m], r: (pillar ? 2.6 : 2.4) * body.k, hp: pillar ? Infinity : 3, score: pillar ? 0 : 300, t: 0, flash: 0, fireT: Infinity,
    body, lift: 0, ox: (i - (n - 1) / 2) * 9, oy: 8 + (i % 2) * 4, spin: rand(1, 2.5), glow: pillar ? 0xff8030 : 0xffd040, dmg: pillar ? 25 : 20,
    noLock: pillar, vel: null,
  };
  mesh.position.copy(body.mesh.position);
  c.addEnemy(d, 1.6 * body.k);
  return d;
}

export function launchDebris(d, ctx) {
  // 半分は正面、残りは左右に少しずらした所を狙う (よける楽しさ)
  const off = Math.random() < 0.5 ? 0 : rand(3, 6) * (Math.random() < 0.5 ? -1 : 1);
  const target = _a.copy(ctx.player).add(new THREE.Vector3(ctx.side ? 0 : off, ctx.side ? off * 0.6 : 0, 0));
  d.vel = target.sub(d.mesh.position).normalize().multiplyScalar(ctx.side ? 22 : 42);
  d.mats[0].userData.base.setHex(d.glow).multiplyScalar(0.6);
}
