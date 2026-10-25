// ボス: 晶洞の輪 (GEODE RING)。小さな晶洞岩 8 個が 2 つの輪になって逆向きに回る。
// 殻が閉じている間は弾を跳ね返し (無害)、殻が開いて中の結晶が明るい水色に光っている間だけ倒せる。開くと光の輪を吐く。
// 時間で逃げる (escape 秒)。tier 1 (10 面): 開いている 1.6 秒 / tier 2 (13 面): 1.0 秒、輪ごとに交互に開く
// 撃破と逃げる判定は combat.js の bossGroup (全部倒せば撃破、残って逃げれば逃げられた)。
// 4 個倒したか 15 秒たったら「晶洞の行進」(GEODE MARCH): 輪から 1 個ずつ、25 m 先まで 1.2 秒でまっすぐ出てきて、
// 殻が震えて光り (0.8 秒)、開いて 1.6 秒 (倒せる)、光の輪を 3 発の扇で吐いて閉じ、輪へ戻る
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;

const GEO = {
  half: new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), // 殻の半分 (上向きのお椀)
  gem: new THREE.OctahedronGeometry(0.62, 0),
};

const TIERS = {
  1: { open: 1.6, closed: [2.6, 3.8], R: [13, 7.5], speed: 0.5 },
  2: { open: 1.3, closed: [2.4, 2.4], R: [14, 8], speed: 0.65, alternate: true }, // 交互に開くよう、閉じている時間は一定
};

export function spawnGeodeRing(c, def) {
  const tier = TIERS[def.tier || 1];
  const side = c.sideMode;
  const grp = { type: 'geodering', t: 0, escape: def.escape || 30, total: 0, kills: 0, leaving: false, bonus: 6000 };
  c.bossGroup = grp;
  const center = { x: c.lastPlayer?.x ?? 0, y: THREE.MathUtils.clamp((c.lastPlayer?.y ?? 6) + 4, 8, 13), z: SPAWN_Z, a: 0, members: [], marchGap: 0 };
  for (let i = 0; i < 8; i++) {
    const ring = i % 2, slot = Math.floor(i / 2);
    const rock = new THREE.MeshStandardMaterial({ color: 0x5a4a5a, emissive: 0x000000, flatShading: true, roughness: 0.9 });
    const gemM = new THREE.MeshStandardMaterial({ color: 0xcff8ff, emissive: 0x206080, flatShading: true, roughness: 0.1, metalness: 0.2 });
    for (const m of [rock, gemM]) m.userData.base = m.emissive.clone();
    const g = new THREE.Group();
    const bottom = new THREE.Mesh(GEO.half, rock);
    bottom.rotation.x = Math.PI; // 下のお椀
    const lid = new THREE.Group(); // 上の殻 (うしろの縁を軸に開く)
    const top = new THREE.Mesh(GEO.half, rock);
    top.position.z = 1;
    lid.position.z = -1;
    lid.add(top);
    const gem = new THREE.Mesh(GEO.gem, gemM);
    g.add(bottom, lid, gem);
    g.scale.setScalar(side ? 2.2 : 3);
    const e = {
      kind: 'geode', mesh: g, mats: [rock, gemM], r: side ? 2.4 : 3.2, hp: 3 + Math.floor(c.level / 3), score: 600, t: 0, flash: 0, fireT: Infinity,
      center, tier, ring, slot, lid, gemM, open: 0, phase: 'closed',
      // 交互に開く tier では、2 つ目の輪を半周期ずらす
      timer: (tier.alternate ? 1 + ring * (tier.open + tier.closed[0]) / 2 : rand(...tier.closed)) + slot * 0.25,
      bossGroup: grp,
    };
    g.position.set(center.x, center.y, SPAWN_Z);
    center.members.push(e);
    c.addEnemy(e, side ? 0 : 2.4);
    if (side) e.shadow.visible = false;
  }
  grp.total = 8;
  c.bossDefeated = false;
}

export const GEODERING_KINDS = {
  geode: {
    sideAbs: true,
    shielded: (e) => e.open < 0.6, // 殻が閉じている間は跳ね返す
    update(c, e, dt, scroll, ctx, p) {
      const C = e.center, T = e.tier;
      // 輪の中心: 1 フレームに 1 回だけ、最初に来た 1 個が動かす (どれを先に倒しても輪は回る)
      if (C.lastT !== c.time) {
        C.lastT = c.time;
        if (e.bossGroup.leaving) C.leaveT = (C.leaveT || 0) + dt;
        const hz = c.holdZ(-62);
        C.z = Math.min(hz, C.z + (scroll * 0.4 + 30) * dt);
        C.a += dt * T.speed;
        C.x += ((ctx.player.x ?? 0) - C.x) * Math.min(1, dt * 0.3);
        if (e.bossGroup.leaving) C.y += 12 * dt; // 時間切れ: 上へ逃げていく
        // 晶洞の行進: 前の 1 個が戻ってから 1 秒あけて、次の 1 個
        const G = e.bossGroup;
        if (C.marcher?.dead) C.marcher = null;
        C.marchGap -= dt;
        if (!C.marcher && C.marchGap <= 0 && !G.leaving && !ctx.side && C.z >= hz - 1 && (G.kills >= 4 || G.t > 15)) {
          const live = C.members.filter((m) => !m.dead);
          const m = live[Math.floor(Math.random() * live.length)];
          if (m) {
            C.marcher = m;
            m.march = { state: 'out', u: 0, from: m.mesh.position.clone(), to: new THREE.Vector3(ctx.player.x, THREE.MathUtils.clamp(ctx.player.y, 3, 14), ctx.player.z - 25) };
          }
        }
      }
      if (e.bossGroup.leaving && (C.y > 60 || C.leaveT > 8)) { e.dead = true; return; } // 逃げ始めて 8 秒で必ず消える
      // 2 つの輪は逆向きに回る
      const R = ctx.side ? [9, 5][e.ring] : T.R[e.ring];
      const a = (e.ring ? -C.a : C.a) + (e.slot / 4) * Math.PI * 2 + (e.ring ? Math.PI / 4 : 0);
      const sway = Math.sin(c.time * 0.4) * (ctx.side ? 0 : 5);
      if (ctx.side) p.set(C.x, C.y + Math.sin(a) * R, C.z + Math.cos(a) * R);
      else p.set(C.x + sway + Math.cos(a) * R, C.y + Math.sin(a) * R * 0.75, C.z);
      if (e.march && march(c, e, dt, ctx, p)) return;
      // 殻の開け閉め: 閉じる → 開く (open 秒) → 閉じる
      e.timer -= dt;
      if (e.timer <= 0) {
        if (e.phase === 'closed') { e.phase = 'open'; e.timer = T.open; e.fireT = 0.35; }
        else { e.phase = 'closed'; e.timer = rand(...T.closed); e.fireT = Infinity; }
      }
      const want = e.phase === 'open' && !e.bossGroup.leaving ? 1 : 0;
      e.open += THREE.MathUtils.clamp(want - e.open, -dt * 5, dt * 6);
      // 開く 0.45 秒前の予告: 殻が小刻みに震えて、すき間から光が漏れる
      const warn = e.phase === 'closed' && e.timer < 0.45 && !e.bossGroup.leaving;
      e.lid.rotation.x = -1.2 * e.open - (warn ? 0.12 + Math.sin(e.t * 50) * 0.06 : 0);
      // 倒せるときは中の結晶が明るい水色に光る (閉じている間は暗い、予告の間は少し光る)
      e.gemM.userData.base.setHex(e.open > 0.6 ? 0x60f0ff : warn ? 0x2a8aa8 : 0x103040);
      e.mesh.lookAt(ctx.player.x, ctx.player.y, ctx.player.z + 40); // 開いた口をこちらへ向ける
    },
    fire(c, e, ctx, p) {
      e.fireT = Infinity; // 開くたびに 1 発
      c.fireBullet(p.clone(), ctx.player, 0, 'ring');
    },
  },
};

// 晶洞の行進: 出る (1.2 秒、まっすぐ) → 震えて光る (0.8 秒) → 開く (1.6 秒、扇 3 発) → 戻る (1.2 秒)。p には輪の位置が入っている
function march(c, e, dt, ctx, p) {
  const M = e.march, C = e.center;
  M.u += dt;
  const ease = (k) => k * k * (3 - 2 * k);
  let want = 0, shake = 0;
  if (M.state === 'out') {
    p.lerpVectors(M.from, M.to, ease(Math.min(1, M.u / 1.2)));
    if (M.u >= 1.2) { M.state = 'warn'; M.u = 0; }
  } else if (M.state === 'warn') {
    p.copy(M.to);
    shake = 0.12 + Math.sin(e.t * 50) * 0.06; // 殻が震えて、すき間から光が漏れる
    if (M.u >= 0.8) { M.state = 'open'; M.u = 0; M.fired = false; }
  } else if (M.state === 'open') {
    p.copy(M.to);
    want = 1;
    if (!M.fired && e.open > 0.6) {
      M.fired = true;
      for (const s of [-0.18, 0, 0.18]) c.fireBullet(p.clone(), ctx.player, s, 'ring'); // 扇のすき間か上下へよける
    }
    if (M.u >= 1.6) { M.state = 'back'; M.u = 0; M.from.copy(p); }
  } else {
    // 輪の位置 (p) へ戻る
    const k = ease(Math.min(1, M.u / 1.2));
    p.lerpVectors(M.from, p, k);
    if (M.u >= 1.2) {
      e.march = null;
      C.marcher = null;
      C.marchGap = 1;
      e.phase = 'closed';
      e.timer = rand(...e.tier.closed);
    }
  }
  e.phase = want ? 'open' : 'closed';
  e.fireT = Infinity; // 行進の間は、いつもの 1 発は撃たない
  e.open += THREE.MathUtils.clamp(want - e.open, -dt * 5, dt * 6);
  e.lid.rotation.x = -1.2 * e.open - shake;
  e.gemM.userData.base.setHex(e.open > 0.6 ? 0x60f0ff : shake ? 0x2a8aa8 : 0x103040);
  e.mesh.lookAt(ctx.player.x, ctx.player.y, ctx.player.z + 40);
  return true;
}
