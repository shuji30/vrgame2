// ボス: 晶洞の輪 (GEODE RING)。小さな晶洞岩 8 個が 2 つの輪になって逆向きに回る。
// 殻が閉じている間は弾を跳ね返し (無害)、殻が開いて中の結晶が明るい水色に光っている間だけ倒せる。開くと光の輪を吐く。
// 時間で逃げる (escape 秒)。tier 1 (10 面): 開いている 1.6 秒 / tier 2 (13 面): 1.0 秒、輪ごとに交互に開く
// 撃破と逃げる判定は combat.js の bossGroup (全部倒せば撃破、残って逃げれば逃げられた)
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;

const GEO = {
  half: new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), // 殻の半分 (上向きのお椀)
  gem: new THREE.OctahedronGeometry(0.62, 0),
};

const TIERS = {
  1: { open: 1.6, closed: [2.6, 3.8], R: [13, 7.5], speed: 0.5 },
  2: { open: 1.0, closed: [2.2, 3.2], R: [14, 8], speed: 0.65, alternate: true },
};

export function spawnGeodeRing(c, def) {
  const tier = TIERS[def.tier || 1];
  const side = c.sideMode;
  const grp = { type: 'geodering', t: 0, escape: def.escape || 30, total: 0, kills: 0, leaving: false, bonus: 6000 };
  c.bossGroup = grp;
  const center = { x: c.lastPlayer?.x ?? 0, y: THREE.MathUtils.clamp((c.lastPlayer?.y ?? 6) + 4, 8, 13), z: SPAWN_Z, a: 0 };
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
      center, tier, ring, slot, lid, gemM, open: 0, phase: 'closed', timer: rand(...tier.closed) * (tier.alternate ? 1 : 1) + (tier.alternate && ring ? tier.open + 0.4 : 0) + slot * 0.35,
      bossGroup: grp,
    };
    g.position.set(center.x, center.y, SPAWN_Z);
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
      // 輪の中心: 輪の最初の 1 個だけが動かす (ほかは同じ中心を使う)
      if (e.ring === 0 && e.slot === 0) {
        const hz = c.holdZ(-62);
        C.z = Math.min(hz, C.z + (scroll * 0.4 + 30) * dt);
        C.a += dt * T.speed;
        C.x += ((ctx.player.x ?? 0) - C.x) * Math.min(1, dt * 0.3);
        if (e.bossGroup.leaving) C.y += 12 * dt; // 時間切れ: 上へ逃げていく
      }
      if (e.bossGroup.leaving && C.y > 60) { e.dead = true; return; }
      // 2 つの輪は逆向きに回る
      const R = ctx.side ? [9, 5][e.ring] : T.R[e.ring];
      const a = (e.ring ? -C.a : C.a) + (e.slot / 4) * Math.PI * 2 + (e.ring ? Math.PI / 4 : 0);
      const sway = Math.sin(c.time * 0.4) * (ctx.side ? 0 : 5);
      if (ctx.side) p.set(C.x, C.y + Math.sin(a) * R, C.z + Math.cos(a) * R);
      else p.set(C.x + sway + Math.cos(a) * R, C.y + Math.sin(a) * R * 0.75, C.z);
      // 殻の開け閉め: 閉じる → 開く (open 秒) → 閉じる
      e.timer -= dt;
      if (e.timer <= 0) {
        if (e.phase === 'closed') { e.phase = 'open'; e.timer = T.open; e.fireT = 0.35; }
        else { e.phase = 'closed'; e.timer = rand(...T.closed) + (T.alternate ? T.open : 0); e.fireT = Infinity; }
      }
      const want = e.phase === 'open' && !e.bossGroup.leaving ? 1 : 0;
      e.open += THREE.MathUtils.clamp(want - e.open, -dt * 5, dt * 6);
      e.lid.rotation.x = -1.2 * e.open;
      // 倒せるときは中の結晶が明るい水色に光る (閉じている間は暗い)
      e.gemM.userData.base.setHex(e.open > 0.6 ? 0x60f0ff : 0x103040);
      e.mesh.lookAt(ctx.player.x, ctx.player.y, ctx.player.z + 40); // 開いた口をこちらへ向ける
    },
    fire(c, e, ctx, p) {
      e.fireT = Infinity; // 開くたびに 1 発
      c.fireBullet(p.clone(), ctx.player, 0, 'ring');
    },
  },
};
