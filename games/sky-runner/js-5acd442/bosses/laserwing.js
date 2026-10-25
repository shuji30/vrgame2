// ボス: 光翼の母船 (LASER WING)。13 面。大きなガラスの翼の母船。両方の翼の先に光線の発射口、中央に核。
// 細い赤い予告の線を約 1 秒引いたあと、太い光線で左右に薙ぎ払う。光線の高さは上段・中段・下段からランダムで、
// 左右対称 (両方同じ段)・非対称 (両方ちがう段)・片側だけ、もランダム (空いている段へ上下に動いてよける)。
// 発射口は壊せない (弾を跳ね返す)。核はいつでも撃てる。
// 体力が半分を切ると、2 回に 1 回は片方が「縦の光線」(VERTICAL CUT): そのときのプレイヤーの横の位置を、上から床まで切る
// (横へよける)。予告は、その位置の少し先に立つ赤い縦の線。もう片方は上段か下段の横の光線
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
    k, x: c.lastPlayer?.x ?? 0, z: SPAWN_Z, emitters: [], beamT: 3, bossGroup: grp,
  };
  grp.ratio = () => Math.max(0, body.hp / body.maxHp);
  c.bossGroup = grp;
  g.position.set(body.x, 14, SPAWN_Z);
  c.addEnemy(body, 8 * k);
  for (const sx of [-1, 1]) {
    const m = mat(0xffb0a0, 0x802010);
    const mesh = new THREE.Mesh(GEO.emitter, m);
    mesh.scale.setScalar(2 * k);
    const em = { kind: 'emitter', mesh, mats: [m], r: 2.4 * k, hp: Infinity, score: 0, t: 0, flash: 0, fireT: Infinity, body, sx, beam: null, noLock: true };
    mesh.position.copy(g.position);
    c.addEnemy(em, 0);
    em.shadow.visible = false;
    body.emitters.push(em);
  }
  c.bossDefeated = false;
}

// 光線の段の高さ (下段・中段・上段)。天井のある面は天井の下に収める
function levels(c) {
  const top = Math.min(c.ceilingY, 30);
  return [3.5, top * 0.45, top - 6];
}

// 光線を 1 本始める: 予告の線 (1 秒) → 光線で薙ぐ (1.2 秒)。y: 光線がプレイヤーの所を通る高さ
// vertical: 縦の光線 (プレイヤーの横の位置を、上から床まで切る。横には動かない)
function startBeam(c, em, ctx, y, vertical = false) {
  const P = ctx.player;
  const line = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3)), new THREE.LineBasicMaterial({ color: 0xff3020 }));
  line.frustumCulled = false;
  const beam = new THREE.Mesh(GEO.beam, new THREE.MeshBasicMaterial({ color: 0xffe0f0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.visible = false;
  c.scene.add(line, beam);
  const sweep = rand(26, 34) * (em.sx > 0 ? -1 : 1); // 翼の外から内へ薙ぐ
  if (vertical && !ctx.side) {
    const top = Math.min(c.ceilingY, 30);
    // 予告: プレイヤーの 12 m 先に、床から上まで赤い縦の線 (切られる場所が見える)
    const mark = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([P.x, 0, P.z - 12, P.x, top, P.z - 12], 3)), new THREE.LineBasicMaterial({ color: 0xff3020 }));
    mark.frustumCulled = false;
    c.scene.add(mark);
    em.beam = {
      line, beam, mark, t: 0, warn: 1.0, dur: 0.9, hit: false, y, x: P.x, z: P.z, vertical: true,
      from: new THREE.Vector3(P.x, top, P.z), to: new THREE.Vector3(P.x, 0.3, P.z),
    };
    return;
  }
  em.beam = {
    line, beam, t: 0, warn: 1.0, dur: ctx.side ? 0.6 : 1.2, hit: false, y, x: P.x, z: P.z,
    // 横スクロールは薙がずに、その段の高さの横一文字の光線 (上下によける)
    from: ctx.side ? new THREE.Vector3(0, y, P.z + 40) : new THREE.Vector3(P.x - sweep, y, P.z),
    to: ctx.side ? new THREE.Vector3(0, y, P.z + 40) : new THREE.Vector3(P.x + sweep, y, P.z),
  };
}

function endBeam(c, em) {
  if (!em.beam) return;
  c.scene.remove(em.beam.line, em.beam.beam);
  if (em.beam.mark) {
    c.scene.remove(em.beam.mark);
    em.beam.mark.geometry.dispose();
    em.beam.mark.material.dispose();
  }
  em.beam.line.geometry.dispose();
  em.beam.line.material.dispose();
  em.beam.beam.material.dispose(); // 円柱の形は共有なので捨てない
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
      // 光線: 段 (上・中・下) と組み合わせ (対称・非対称・片側) をランダムに選ぶ。
      // 1 つは 6 割の確率でプレイヤーのいる段をねらう。両方撃っても、必ず 1 段は空く
      if (e.z >= hz - 1 && e.emitters.every((m) => !m.beam)) e.beamT -= dt;
      if (e.beamT <= 0) {
        const L = levels(c);
        const near = L.reduce((bi, y, i) => (Math.abs(y - ctx.player.y) < Math.abs(L[bi] - ctx.player.y) ? i : bi), 0);
        const a = Math.random() < 0.6 ? near : Math.floor(Math.random() * 3);
        const r = Math.random(), single = e.hp < e.maxHp * 0.5 ? 0.15 : 0.3; // 体力が半分を切ると、両方撃つことが多い
        const [left, right] = e.emitters[0].sx < 0 ? e.emitters : [e.emitters[1], e.emitters[0]];
        e.volleys = (e.volleys || 0) + 1;
        if (e.hp < e.maxHp * 0.5 && e.volleys % 2 === 0 && !ctx.side) {
          // 縦の光線と、上段か下段の横の光線 (中ほどの高さで横へよければ、どちらも当たらない)
          const vert = Math.random() < 0.5 ? left : right;
          startBeam(c, vert, ctx, L[1], true);
          startBeam(c, vert === left ? right : left, ctx, L[Math.random() < 0.5 ? 0 : 2]);
        } else if (r < single) {
          startBeam(c, Math.random() < 0.5 ? left : right, ctx, L[a]); // 片側だけ
        } else if (r < single + (1 - single) / 2) {
          for (const m of e.emitters) startBeam(c, m, ctx, L[a]); // 左右対称: 同じ段を両側から
        } else {
          const b = (a + 1 + Math.floor(Math.random() * 2)) % 3; // 非対称: 左右で別の段
          const swap = Math.random() < 0.5;
          startBeam(c, left, ctx, L[swap ? b : a]);
          startBeam(c, right, ctx, L[swap ? a : b]);
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
    endBeam, // combat.remove から呼ぶ
    big: true,
    shielded: () => true, // 壊せない (弾を跳ね返す)
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
      if (B.mark) B.mark.visible = B.t >= B.warn || Math.floor(B.t * 12) % 2 === 0;
      if (B.t < B.warn) {
        // 予告: 赤い線が点滅し、発射口が赤く光る
        B.line.visible = Math.floor(B.t * 12) % 2 === 0;
        e.mats[0].userData.base.setHex(0xff3020);
      } else {
        B.beam.visible = true;
        B.beam.position.copy(p);
        B.beam.lookAt(end);
        const len = p.distanceTo(end);
        // VR で目の横を太い光が通らないよう、太い光線はプレイヤーの 6 m 手前までにし、その先は細い線だけ
        const dz = dir.z > 0.05 ? (ctx.player.z - 6 - p.z) / dir.z : len;
        B.beam.scale.set(1.1, 1.1, THREE.MathUtils.clamp(dz, 1, len));
        B.line.visible = dz < len;
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
