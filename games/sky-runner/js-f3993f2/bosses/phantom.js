// ボス: 水晶の亡霊 (CRYSTAL PHANTOM)。11 面。半透明の結晶の亡霊が、4 秒ごとに消えて、別の場所に分身 3 体と一緒に現れる。
// 本物だけが地面に影を落とし、目が水色に光る (分身は影がなく、目が紫)。分身は 1 発で砕けるが、ダメージは入らない。
// 本物も分身も弾を撃つので、早く本物を見抜くほど楽になる
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;
const HIDE_Y = -60;

const GEO = {
  body: new THREE.OctahedronGeometry(1, 0).scale(1, 1.5, 1),
  cloak: new THREE.ConeGeometry(1, 2.4, 6, 1, true).translate(0, -1.6, 0),
  eye: new THREE.SphereGeometry(0.28, 8, 6),
};

function mat(color, emissive, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, flatShading: true, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.85, ...extra });
  m.userData.base = m.emissive.clone();
  return m;
}

function makeGhost(k, eyeColor) {
  const bodyM = mat(0xd8e8ff, 0x3a3a8a);
  const cloakM = mat(0xb8c8ff, 0x2a2a6a, { side: THREE.DoubleSide, opacity: 0.6 });
  const eyeM = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: eyeColor, transparent: true }); // 目の色は発光で (被弾の光り方を共通にするため)
  eyeM.userData.base = eyeM.emissive.clone();
  const g = new THREE.Group();
  const body = new THREE.Mesh(GEO.body, bodyM);
  body.scale.setScalar(3);
  const cloak = new THREE.Mesh(GEO.cloak, cloakM);
  cloak.scale.set(3.6, 3, 3.6);
  g.add(body, cloak);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(GEO.eye, eyeM);
    eye.position.set(sx * 0.9, 1.2, 2.4);
    eye.scale.setScalar(1.6);
    g.add(eye);
  }
  g.scale.setScalar(k);
  return { mesh: g, mats: [bodyM, cloakM, eyeM] };
}

export function spawnPhantom(c, def) {
  const side = c.sideMode;
  const k = side ? 0.65 : 1;
  const hp = def.hp || 380;
  const made = makeGhost(k, 0x60f0ff);
  const grp = { type: 'phantom', t: 0, escape: Infinity, total: 1, kills: 0, leaving: false, bonus: 10000 };
  const ph = {
    kind: 'phantom', ...made, r: 3.6 * k, hp, maxHp: hp, score: 0, t: 0, flash: 0, fireT: 2, k,
    state: 'enter', timer: 0, fade: 1, z: SPAWN_Z, slots: [], at: new THREE.Vector3(0, 10, SPAWN_Z), decoys: [], bossGroup: grp, noAssist: true,
  };
  grp.ratio = () => Math.max(0, ph.hp / ph.maxHp);
  c.bossGroup = grp;
  ph.mesh.position.copy(ph.at);
  c.addEnemy(ph, 3 * k);
  c.bossDefeated = false;
}

// 現れる場所 (プレイヤーの前方に 4 か所)
function pickSlots(c, ctx, k) {
  const P = ctx.player, z = c.holdZ(-50);
  const base = ctx.side
    ? [[0, 5, -6], [0, 15, -6], [0, 6, 6], [0, 16, 6]]
    : [[-15, 7, 0], [15, 7, 0], [-6, 15, -4], [6, 15, -4]];
  return base.map(([x, y, dz]) => new THREE.Vector3((ctx.side ? 0 : P.x) + x * k, y, z + dz * (ctx.side ? 1 : 1)))
    .sort(() => Math.random() - 0.5);
}

function setFade(e, f) {
  e.fade = f;
  e.mats[0].opacity = 0.85 * f;
  e.mats[1].opacity = 0.6 * f;
  e.mats[2].opacity = f;
}

export const PHANTOM_KINDS = {
  phantom: {
    big: true,
    sideAbs: true,
    shielded: (e) => e.fade < 0.6, // 消えかけの間は当たらない
    update(c, e, dt, scroll, ctx, p) {
      e.timer -= dt;
      if (e.state === 'enter') {
        // 最初は奥から近づいてくる
        e.z = Math.min(c.holdZ(-50), e.z + (scroll * 0.4 + 30) * dt);
        p.set(ctx.side ? 0 : ctx.player.x, 10, e.z);
        if (e.z >= c.holdZ(-50)) { e.state = 'show'; e.timer = 3; }
      } else if (e.state === 'show') {
        p.copy(e.at).add(new THREE.Vector3(0, Math.sin(e.t * 1.6) * 0.8, 0));
        if (e.timer <= 0) { e.state = 'out'; e.timer = 0.5; }
      } else if (e.state === 'out') {
        // 消える (分身も一緒に)
        setFade(e, Math.max(0, e.timer / 0.5));
        for (const d of e.decoys) if (!d.dead) setFade(d, e.fade);
        if (e.timer <= 0) {
          for (const d of e.decoys) d.dead = true;
          e.decoys = [];
          const slots = pickSlots(c, ctx, e.k);
          e.at.copy(slots[0]);
          p.set(0, HIDE_Y, -50);
          // 分身: 体力が減るほど増える (2 → 3 体)
          const n = e.hp < e.maxHp * 0.6 ? 3 : 2;
          for (let i = 1; i <= n; i++) {
            const made = makeGhost(e.k, 0xc060ff);
            const d = { kind: 'decoy', ...made, r: 3.4 * e.k, hp: 1, score: 50, t: 0, flash: 0, fireT: rand(0.8, 1.6), at: slots[i].clone(), fade: 0, owner: e, noItem: true };
            d.mesh.position.copy(d.at);
            setFade(d, 0);
            c.addEnemy(d, 0);
            d.shadow.visible = false; // 分身は影を落とさない (本物を見分ける手がかり)
            e.decoys.push(d);
          }
          e.state = 'in';
          e.timer = 0.5;
        }
      } else if (e.state === 'in') {
        p.copy(e.at);
        setFade(e, 1 - Math.max(0, e.timer / 0.5));
        for (const d of e.decoys) if (!d.dead) setFade(d, e.fade);
        if (e.timer <= 0) { e.state = 'show'; e.timer = Math.max(2.6, 4 - (c.level - 1) * 0.1); }
      }
      e.shadow.visible = e.state !== 'out' || e.fade > 0.2;
      e.noLock = e.fade < 0.6;
      e.mesh.lookAt(ctx.player.x, ctx.player.y, ctx.player.z + 30);
    },
    fire(c, e, ctx, p) {
      e.fireT = rand(1.4, 2);
      if (e.fade < 0.9) return;
      for (const s of [-0.12, 0, 0.12]) c.fireBullet(p.clone(), ctx.player, s);
    },
    onDeath(c, e) {
      for (const d of e.decoys) if (!d.dead) { d.dead = true; c.explode(d.mesh.position, false); }
    },
  },

  // 分身: 本物と同じ姿で、影がなく目が紫。1 発で砕ける (ダメージにはならない)
  decoy: {
    sideAbs: true,
    update(c, e, dt, scroll, ctx, p) {
      if (e.owner.dead) { e.dead = true; return; }
      p.copy(e.at).add(new THREE.Vector3(0, Math.sin(e.t * 1.6 + 1) * 0.8, 0));
      e.mesh.lookAt(ctx.player.x, ctx.player.y, ctx.player.z + 30);
      e.noLock = e.fade < 0.6;
    },
    fire(c, e, ctx, p) {
      e.fireT = rand(1.8, 2.6);
      if (e.fade < 0.9) return;
      c.fireBullet(p.clone(), ctx.player);
    },
  },
};
