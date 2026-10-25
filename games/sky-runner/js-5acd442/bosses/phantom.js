// ボス: 水晶の亡霊 (CRYSTAL PHANTOM)。11 面。半透明の結晶の亡霊が、4 秒ごとに消えて、別の場所に分身 3 体と一緒に現れる。
// 本物だけが地面に影を落とし、目が水色に光る (分身は影がなく、目が紫)。分身は 1 発で砕けるが、ダメージは入らない。
// 本物も分身も弾を撃つので、早く本物を見抜くほど楽になる。
// 体力が半分を切ると「分身の突撃」(DECOY DIVE): 現れてすぐ分身の目が赤くなり (0.8 秒、低いうなり)、そのときプレイヤーが
// いた所へまっすぐ飛んでくる (毎秒 35 m)。目の 10 m 手前で砕けて、線の近く (横 3 m) にいれば 15。本物はその場に残る
import * as THREE from 'three';
import { sfx } from '../audio.js';

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

// decoy: 分身は薄く (本物と見分けやすく)
function makeGhost(k, eyeColor, decoy = false) {
  const op = decoy ? [0.55, 0.35] : [0.85, 0.6];
  const bodyM = mat(0xd8e8ff, 0x3a3a8a, { opacity: op[0] });
  const cloakM = mat(0xb8c8ff, 0x2a2a6a, { side: THREE.DoubleSide, opacity: op[1] });
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
    eye.scale.setScalar(2.6); // VR でも見分けられる大きさ
    g.add(eye);
  }
  g.scale.setScalar(k);
  return { mesh: g, mats: [bodyM, cloakM, eyeM], op };
}

export function spawnPhantom(c, def) {
  const side = c.sideMode;
  const k = side ? 0.65 : 1;
  const hp = def.hp || 380;
  const made = makeGhost(k, 0x60f0ff);
  const grp = { type: 'phantom', t: 0, escape: Infinity, total: 1, kills: 0, leaving: false, bonus: 10000 };
  const ph = {
    kind: 'phantom', ...made, r: 3.6 * k, hp, maxHp: hp, score: 0, t: 0, flash: 0, fireT: 2, k,
    state: 'enter', timer: 0, fade: 1, z: SPAWN_Z, slots: [], at: new THREE.Vector3(0, 10, SPAWN_Z), decoys: [], bossGroup: grp,
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
  e.mats[0].opacity = e.op[0] * f;
  e.mats[1].opacity = e.op[1] * f;
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
        if (e.z >= c.holdZ(-50)) { e.state = 'show'; e.timer = 3; e.at.copy(p); } // 近づいた所から始める (一瞬で飛ばない)
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
            const made = makeGhost(e.k, 0xc060ff, true);
            // 分身にはエイムアシストを効かせない
            const d = { kind: 'decoy', noAssist: true, ...made, r: 3.4 * e.k, hp: 1, score: 50, t: 0, flash: 0, fireT: rand(0.8, 1.6), at: slots[i].clone(), fade: 0, owner: e, noItem: true };
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
        if (e.timer <= 0) {
          e.state = 'show';
          e.timer = Math.max(2.6, 4 - (c.level - 1) * 0.1);
          // 分身の突撃 (体力が半分を切ってから。横スクロールではしない)
          if (e.hp < e.maxHp * 0.5 && !ctx.side) {
            for (const d of e.decoys) if (!d.dead) d.dive = { state: 'warn', t: 0 };
            if (e.decoys.length) sfx.roar();
          }
        }
      }
      e.shadow.visible = e.state !== 'out' || e.fade > 0.2;
      // 本物の足元に水色の光の輪 (影とは別の手がかり)
      if (!e.ring) {
        e.ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.2, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x60f0ff, transparent: true, depthWrite: false }));
        c.scene.add(e.ring);
        e.marker = e.ring; // 片付けは combat.remove に任せる
      }
      e.ring.position.set(p.x, 0.1, p.z);
      e.ring.material.opacity = 0.7 * e.fade;
      e.ring.visible = p.y > -10;
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
      if (e.dive && diveDecoy(c, e, dt, ctx, p)) return;
      p.copy(e.at).add(new THREE.Vector3(0, Math.sin(e.t * 1.6 + 1) * 0.8, 0));
      e.mesh.lookAt(ctx.player.x, ctx.player.y, ctx.player.z + 30);
      e.noLock = e.fade < 0.6;
    },
    fire(c, e, ctx, p) {
      e.fireT = rand(1.8, 2.6);
      if (e.fade < 0.9 || e.dive) return; // 突撃する分身は撃たない
      c.fireBullet(p.clone(), ctx.player);
    },
  },
};

const RED_EYE = new THREE.Color(0xff2030);
// 分身の突撃: 目が赤くなる予告 (0.8 秒) → まっすぐ飛ぶ → 目の 10 m 手前で砕ける。突撃中は true を返す
function diveDecoy(c, e, dt, ctx, p) {
  const D = e.dive, P = ctx.player;
  D.t += dt;
  if (D.state === 'warn') {
    const eye = e.mats[2];
    eye.userData.base.copy(RED_EYE).multiplyScalar(0.5 + 0.5 * Math.abs(Math.sin(D.t * 12)));
    p.copy(e.at).add(new THREE.Vector3(Math.sin(D.t * 40) * 0.2, 0, 0)); // 震える
    e.mesh.lookAt(P);
    if (D.t >= 0.8 && e.fade > 0.9) {
      D.state = 'fly';
      D.vel = P.clone().sub(p).normalize().multiplyScalar(35); // そのときいた所へ、まっすぐ (追わない)
      e.noHit = true; // 当たりは砕けるときに見る
      eye.userData.base.copy(RED_EYE);
      sfx.whoosh();
    }
    return true;
  }
  p.addScaledVector(D.vel, dt);
  e.mesh.lookAt(P);
  if (p.z + e.r > P.z - 10) {
    if (Math.hypot(p.x - P.x, p.y - P.y) < 3 + ctx.playerR) ctx.onPlayerHit(15);
    c.explode(p.clone(), false);
    e.dead = true; // 倒したことにはしない
  }
  return true;
}
