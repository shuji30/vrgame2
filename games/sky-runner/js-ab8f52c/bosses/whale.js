// ボス: 溶岩の結晶鯨 (MAGMA WHALE)。15 面。黒曜石の鯨が地面の中を泳ぎ、前方の地面から浮上する (1 秒前に地面に橙色の印)。
// 浮上している約 4 秒の間、背中の 3 つの潮吹き穴から火の玉を噴き上げてプレイヤーへ落とす。
// 体は硬く弾を跳ね返す。浮上している間だけ、光る潮吹き穴を撃てる。3 つとも壊すと倒せる (ゲージは潮吹き穴の残りの体力)
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;
const _a = new THREE.Vector3();

const GEO = {
  body: new THREE.SphereGeometry(1, 12, 8),
  fin: new THREE.ConeGeometry(1, 3, 4),
  tail: new THREE.ConeGeometry(1, 2, 4).rotateX(-Math.PI / 2),
  hole: new THREE.OctahedronGeometry(1, 0),
  marker: new THREE.RingGeometry(3, 5, 24).rotateX(-Math.PI / 2),
};

function mat(color, emissive, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, flatShading: true, roughness: 0.4, metalness: 0.4, ...extra });
  m.userData.base = m.emissive.clone();
  return m;
}

export function spawnWhale(c, def) {
  const side = c.sideMode;
  const k = side ? 0.6 : 1.3;
  const holeHp = Math.round((def.hp || 300) / 3);
  const bodyM = mat(0x24182a, 0x000000);
  const lavaM = mat(0xff8a30, 0xc03a00);
  const g = new THREE.Group();
  const body = new THREE.Mesh(GEO.body, bodyM);
  body.scale.set(5, 4, 13);
  g.add(body);
  for (const sx of [-1, 1]) {
    const fin = new THREE.Mesh(GEO.fin, lavaM);
    fin.position.set(sx * 5, -1, 2);
    fin.rotation.z = sx * -1.2;
    fin.scale.set(1.4, 2, 0.6);
    g.add(fin);
  }
  const tail = new THREE.Mesh(GEO.tail, lavaM);
  tail.position.z = -14;
  tail.scale.set(4, 0.6, 3);
  g.add(tail);
  // 背中の溶岩の割れ目 (光る筋)
  for (let i = 0; i < 4; i++) {
    const v = new THREE.Mesh(GEO.fin, lavaM);
    v.position.set(rand(-2, 2), 3.2, -6 + i * 4);
    v.scale.set(0.4, 0.8, 0.4);
    g.add(v);
  }
  g.scale.setScalar(k);
  const grp = { type: 'whale', t: 0, escape: Infinity, total: 1, kills: 0, leaving: false, bonus: 11000 };
  const w = {
    kind: 'whale', mesh: g, mats: [bodyM, lavaM], r: 4 * k, hp: 1, // 当たりは小さめ (背中の潮吹き穴を覆わないように) score: 0, t: 0, flash: 0, fireT: Infinity, k,
    state: 'under', timer: 2, x: c.lastPlayer?.x ?? 0, z: c.holdZ(-55), rise: 0, marker: null, holes: [], holeHp, bossGroup: grp, noLock: true,
  };
  grp.ratio = () => Math.max(0, w.holes.reduce((s, h) => s + Math.max(0, h.dead ? 0 : h.hp), 0) / (holeHp * 3));
  c.bossGroup = grp;
  g.position.set(w.x, -30, w.z);
  c.addEnemy(w, 6 * k);
  w.shadow.visible = false;
  for (let i = 0; i < 3; i++) {
    const m = mat(0xffd36a, 0xff6a10);
    const mesh = new THREE.Mesh(GEO.hole, m);
    mesh.scale.setScalar(1.6 * k);
    const h = { kind: 'blowhole', mesh, mats: [m], r: 2.2 * k, hp: holeHp, score: 2000, t: 0, flash: 0, fireT: Infinity, whale: w, slot: i, noItem: true };
    mesh.position.copy(g.position);
    c.addEnemy(h, 0);
    h.shadow.visible = false;
    w.holes.push(h);
  }
  c.bossDefeated = false;
}

export const WHALE_KINDS = {
  whale: {
    big: true,
    sideAbs: true,
    shielded: () => true, // 体は硬い
    update(c, e, dt, scroll, ctx, p) {
      e.timer -= dt;
      // 潮吹き穴が全部壊れたら倒れる
      if (e.holes.every((h) => h.dead)) { c.damage(e, 1); return; }
      const hz = c.holdZ(-48);
      if (e.state === 'under') {
        e.rise = Math.max(0, e.rise - dt * 1.2);
        if (e.timer <= 0) {
          // 浮上する場所に橙色の印 (1 秒の予告)
          e.x = ctx.side ? 0 : ctx.player.x + rand(-10, 10);
          e.z = hz + rand(-6, 6);
          e.marker = new THREE.Mesh(GEO.marker, new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0.8, depthWrite: false }));
          e.marker.position.set(e.x, 0.08, e.z);
          c.scene.add(e.marker);
          e.state = 'warn';
          e.timer = 1;
        }
      } else if (e.state === 'warn') {
        e.marker.material.opacity = 0.4 + 0.5 * Math.abs(Math.sin(e.t * 12));
        if (Math.random() < dt * 10) c.sparks.emit(_a.set(e.x + rand(-3, 3), 0.5, e.z + rand(-3, 3)), new THREE.Vector3(rand(-2, 2), rand(4, 8), rand(-2, 2)), new THREE.Color(0xff7a20), 1.2, 0.5);
        if (e.timer <= 0) {
          c.scene.remove(e.marker);
          e.marker = null;
          e.state = 'up';
          e.timer = Math.max(3, 4.2 - (c.level - 1) * 0.05);
          for (const h of e.holes) h.fireT = 0.6 + h.slot * 0.3;
        }
      } else if (e.state === 'up') {
        e.rise = Math.min(1, e.rise + dt * 1.5);
        if (e.timer <= 0) { e.state = 'under'; e.timer = rand(1.6, 2.4); for (const h of e.holes) h.fireT = Infinity; }
      }
      // 浮上の高さ: 潜っている間は地面の下、浮上すると背中が地面の上に出る
      const y = THREE.MathUtils.lerp(-30, (ctx.side ? 4 : 7) * e.k, e.rise); // 3D は高めに浮上 (自機の陰に隠れないように)
      p.set(e.x, y + Math.sin(e.t * 1.5) * 0.4 * e.rise, e.z);
      e.mesh.rotation.z = Math.sin(e.t * 0.8) * 0.08;
      e.mesh.rotation.y = ctx.side ? Math.PI / 2 : 0; // 横スクロールは横向き
    },
    onDeath(c, e) {
      if (e.marker) c.scene.remove(e.marker);
      for (const h of e.holes) if (!h.dead) { h.dead = true; c.explode(h.mesh.position, true); }
      c.explode(e.mesh.position, true);
    },
  },

  // 潮吹き穴 (弱点): 背中に並ぶ。浮上している間だけ撃てて、火の玉を噴き上げる
  blowhole: {
    big: true,
    sideAbs: true,
    shielded: (e) => e.whale.rise < 0.8,
    update(c, e, dt, scroll, ctx, p) {
      const w = e.whale;
      if (w.dead) { e.dead = true; return; }
      // 背中に横に並べる (3D は x 方向、横スクロールは z 方向。どれも手前から撃てる)
      const off = (e.slot - 1) * 4.5 * w.k;
      const wp = w.mesh.position;
      if (ctx.side) p.set(wp.x, wp.y + 4.6 * w.k, wp.z + off);
      else p.set(wp.x + off, wp.y + 4.6 * w.k, wp.z + 3 * w.k);
      e.noLock = w.rise < 0.8;
      e.mats[0].userData.base.setHex(w.rise > 0.8 ? 0xff6a10 : 0x301000); // 浮上して光っている間だけ撃てる
      e.mesh.rotation.y += dt * 3;
    },
    fire(c, e, ctx, p) {
      e.fireT = rand(0.7, 1.0);
      if (e.whale.rise < 0.8) return;
      // 火の玉を高く噴き上げて、プレイヤーのいる所へ落とす
      c.fireBullet(p.clone().add(new THREE.Vector3(0, 2, 0)), ctx.player, rand(-0.08, 0.08), 'fireball');
    },
  },
};
