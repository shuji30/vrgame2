// ボス: 光翼の母船 (LASER WING)。13 面。大きなガラスの翼の母船。両方の翼の先に光線の発射口、中央に核。
// 細い赤い予告の線を約 1 秒引いたあと、太い光線で左右に薙ぎ払う (プレイヤーのいた高さを通るので、上下に動いてよける)。
// 横スクロールでは上下に薙ぐ (前後に動いてよける)。発射口は撃って壊せて、壊すとその側の光線が止まる。核はいつでも撃てる
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

const GEO = {
  wing: new THREE.BoxGeometry(1, 1, 1),
  core: new THREE.IcosahedronGeometry(1, 1),
  emitter: new THREE.OctahedronGeometry(1, 0),
  beam: new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), // 原点から +z へ長さ 1
};

function mat(color, emissive, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, flatShading: true, roughness: 0.15, metalness: 0.3, ...extra });
  m.userData.base = m.emissive.clone();
  return m;
}

// 点 p と線分 a-b の距離
function segDist(p, a, b) {
  _c.subVectors(b, a);
  const t = THREE.MathUtils.clamp(_a.subVectors(p, a).dot(_c) / _c.lengthSq(), 0, 1);
  return _b.copy(a).addScaledVector(_c, t).distanceTo(p);
}

export function spawnLaserWing(c, def) {
  const side = c.sideMode;
  const k = side ? 0.6 : 1;
  const hp = def.hp || 380;
  const wingM = mat(0xd8f6ff, 0x1a4a6a, { transparent: true, opacity: 0.8 });
  const frameM = mat(0x8a8fa8, 0x000000, { metalness: 0.7 });
  const coreM = mat(0xffffff, 0x60e0ff);
  const g = new THREE.Group();
  const wing = new THREE.Mesh(GEO.wing, wingM);
  wing.scale.set(30, 0.8, 9);
  const spine = new THREE.Mesh(GEO.wing, frameM);
  spine.scale.set(4, 2, 14);
  const core = new THREE.Mesh(GEO.core, coreM);
  core.scale.setScalar(2.6);
  core.position.y = 1.6;
  g.add(wing, spine, core);
  if (side) g.rotation.z = Math.PI / 2; // 横スクロールは翼を縦に
  g.scale.setScalar(k);
  const grp = { type: 'laserwing', t: 0, escape: Infinity, total: 1, kills: 0, leaving: false, bonus: 10000 };
  const body = {
    kind: 'laserwing', mesh: g, mats: [wingM, frameM, coreM], r: 4 * k, hp, maxHp: hp, score: 0, t: 0, flash: 0, fireT: 3,
    k, x: c.lastPlayer?.x ?? 0, z: SPAWN_Z, emitters: [], beamT: 3, turn: 0, bossGroup: grp,
  };
  grp.ratio = () => Math.max(0, body.hp / body.maxHp);
  c.bossGroup = grp;
  g.position.set(body.x, 14, SPAWN_Z);
  c.addEnemy(body, 8 * k);
  for (const sx of [-1, 1]) {
    const m = mat(0xffb0a0, 0x802010);
    const mesh = new THREE.Mesh(GEO.emitter, m);
    mesh.scale.setScalar(2 * k);
    const em = { kind: 'emitter', mesh, mats: [m], r: 2.4 * k, hp: 10 + c.level, score: 1500, t: 0, flash: 0, fireT: Infinity, body, sx, beam: null };
    mesh.position.copy(g.position);
    c.addEnemy(em, 0);
    em.shadow.visible = false;
    body.emitters.push(em);
  }
  c.bossDefeated = false;
}

// 光線を 1 本始める: 予告の線 (1 秒) → 光線で薙ぐ (1.2 秒)
function startBeam(c, em, ctx) {
  const P = ctx.player;
  const line = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3)), new THREE.LineBasicMaterial({ color: 0xff3020 }));
  line.frustumCulled = false;
  const beam = new THREE.Mesh(GEO.beam, new THREE.MeshBasicMaterial({ color: 0xffe0f0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.visible = false;
  c.scene.add(line, beam);
  const sweep = rand(26, 34) * (em.sx > 0 ? -1 : 1); // 翼の外から内へ薙ぐ
  em.beam = {
    line, beam, t: 0, warn: 1.0, dur: 1.2, hit: false, y: P.y, x: P.x, z: P.z,
    // 横スクロールは高さで薙ぐ
    from: ctx.side ? new THREE.Vector3(0, P.y + 12, P.z) : new THREE.Vector3(P.x - sweep, P.y, P.z),
    to: ctx.side ? new THREE.Vector3(0, Math.max(1, P.y - 12), P.z) : new THREE.Vector3(P.x + sweep, P.y, P.z),
  };
}

function endBeam(c, em) {
  if (!em.beam) return;
  c.scene.remove(em.beam.line, em.beam.beam);
  em.beam = null;
}

export const LASERWING_KINDS = {
  laserwing: {
    big: true,
    update(c, e, dt, scroll, ctx, p) {
      const hz = c.holdZ(-60);
      e.z = Math.min(hz, e.z + (scroll * 0.4 + 26) * dt);
      e.x += ((ctx.player.x ?? 0) - e.x) * Math.min(1, dt * 0.25);
      p.set(e.x + Math.sin(e.t * 0.35) * (ctx.side ? 0 : 8), 14 + Math.sin(e.t * 0.6) * 1.2, e.z);
      // 光線: 発射口が残っていれば、交互に (体力が半分を切ると両方同時に)
      if (e.z >= hz - 1 && e.emitters.every((m) => !m.beam)) e.beamT -= dt;
      if (e.beamT <= 0) {
        const live = e.emitters.filter((m) => !m.dead);
        if (live.length) {
          e.turn++;
          const both = e.hp < e.maxHp * 0.5;
          for (const m of live) if (both || live.length === 1 || (e.turn % 2 === 0) === (m.sx > 0)) startBeam(c, m, ctx);
        }
        e.beamT = rand(2.4, 3.2) / (1 + (c.level - 1) * 0.05);
      }
    },
    fire(c, e, ctx, p) {
      e.fireT = rand(2.2, 3);
      if (e.emitters.some((m) => m.beam)) return; // 光線の間は撃たない
      for (let s = -2; s <= 2; s++) c.fireBullet(p.clone(), ctx.player, s * 0.12);
    },
    onDeath(c, e) {
      for (const m of e.emitters) { endBeam(c, m); if (!m.dead) { m.dead = true; c.explode(m.mesh.position, true); } }
    },
  },

  emitter: {
    big: true,
    sideAbs: true,
    update(c, e, dt, scroll, ctx, p) {
      const b = e.body;
      if (b.dead) { endBeam(c, e); e.dead = true; return; }
      const bp = b.mesh.position, d = 15 * b.k;
      if (ctx.side) p.set(bp.x, bp.y + e.sx * d * 0.6, bp.z);
      else p.set(bp.x + e.sx * d, bp.y, bp.z);
      e.mesh.rotation.y += dt * 2;
      const B = e.beam;
      if (!B) { e.mats[0].userData.base.setHex(0x802010); return; }
      B.t += dt;
      // 光線の先: 予告の間は始まりの所、薙いでいる間は from → to へ動く。プレイヤーの向こう 60 m まで伸ばす
      const u = B.t < B.warn ? 0 : Math.min(1, (B.t - B.warn) / B.dur);
      const aim = _a.lerpVectors(B.from, B.to, u);
      const dir = _b.subVectors(aim, p).normalize();
      const end = _c.copy(p).addScaledVector(dir, p.distanceTo(aim) + 60);
      const pos = B.line.geometry.attributes.position;
      pos.setXYZ(0, p.x, p.y, p.z);
      pos.setXYZ(1, end.x, end.y, end.z);
      pos.needsUpdate = true;
      if (B.t < B.warn) {
        // 予告: 赤い線が点滅し、発射口が赤く光る
        B.line.visible = Math.floor(B.t * 12) % 2 === 0;
        e.mats[0].userData.base.setHex(0xff3020);
      } else {
        B.line.visible = false;
        B.beam.visible = true;
        B.beam.position.copy(p);
        B.beam.lookAt(end);
        const len = p.distanceTo(end);
        B.beam.scale.set(1.1, 1.1, len);
        // 当たり: 光線の線分とプレイヤーの距離 (1 回の光線で 1 回だけ)
        if (!B.hit && segDist(ctx.player, p, end) < 1.1 + ctx.playerR) {
          B.hit = true;
          ctx.onPlayerHit(15);
        }
        if (u >= 1) endBeam(c, e);
      }
    },
    onDeath(c, e) { endBeam(c, e); },
  },
};
