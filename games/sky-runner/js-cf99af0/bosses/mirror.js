// ボス: ミラーコア (MIRROR CORE)。光る結晶の核のまわりを、六角形の鏡がゆっくり回る。
// 鏡は壊せず、当たったプレイヤーの弾を撃ち返してくる。鏡が回るすき間から核を撃って倒す。
// tier 1 (2 面): 鏡 6 枚 / tier 2 (8 面): 鏡 8 枚、核が大きく円を描く / tier 3 (14 面): 鏡 8 枚が時々逆回りし、体力が半分を切ると渦巻き弾
// 核と鏡は enemies.js の EXTRA と同じ形 (update / fire) で動かす。撃破と逃げる判定は combat.js の bossGroup に乗せる
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;

const GEO = {
  core: new THREE.IcosahedronGeometry(1, 1),
  shell: new THREE.IcosahedronGeometry(1.25, 0),
  mirror: new THREE.CylinderGeometry(1, 1, 0.12, 6).rotateX(Math.PI / 2), // 六角形の板 (面は z を向く)
  rim: new THREE.TorusGeometry(1, 0.08, 4, 6),
};

function mat(color, emissive, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, flatShading: true, roughness: 0.15, metalness: 0.3, ...extra });
  m.userData.base = m.emissive.clone();
  return m;
}

const TIERS = {
  1: { mirrors: 6, R: 14, speed: 0.45, size: 4.6, move: 0, fan: 5 },
  2: { mirrors: 8, R: 15, speed: 0.6, size: 4.3, move: 1, fan: 5 },
  3: { mirrors: 8, R: 15, speed: 0.75, size: 4.3, move: 1, fan: 7, reverse: true, spiral: true },
};

// ボスを出す (combat.spawnBoss から呼ぶ)。def: { type: 'mirror', hp, tier }
export function spawnMirror(c, def) {
  const tier = TIERS[def.tier || 1];
  const hp = def.hp || 160 + c.level * 30;
  const coreMat = mat(0xbff8ff, 0x40c8ff);
  const shellMat = mat(0x9fe8ff, 0x1a5a80, { transparent: true, opacity: 0.45, forceSinglePass: true });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(GEO.core, coreMat), new THREE.Mesh(GEO.shell, shellMat));
  const core = {
    kind: 'mcore', mesh: g, mats: [coreMat, shellMat], r: 5.6, hp, maxHp: hp, score: 0, t: 0, flash: 0, fireT: 3,
    tier, cy: THREE.MathUtils.clamp((c.lastPlayer?.y ?? 6) + 5, 8, 13), cx: c.lastPlayer?.x ?? 0, z: SPAWN_Z, a: 0, dir: 1, mirrors: [], shotA: 0, reflectT: 0,
  };
  g.scale.setScalar(5.2);
  g.position.set(core.cx, core.cy, SPAWN_Z);
  // 撃破・逃げる判定と体力の表示は bossGroup で (escape: Infinity = 倒すまで)
  const grp = { type: 'mirror', t: 0, escape: Infinity, total: 1, kills: 0, leaving: false, bonus: 10000, ratio: () => Math.max(0, core.hp / core.maxHp) };
  c.bossGroup = grp;
  core.bossGroup = grp;
  c.addEnemy(core, 4);
  for (let i = 0; i < tier.mirrors; i++) {
    const glass = mat(0xe8fbff, 0x3a7a9a);
    const rimM = mat(0xffd36a, 0x7a5a10);
    const mg = new THREE.Group();
    const plate = new THREE.Mesh(GEO.mirror, glass);
    const rim = new THREE.Mesh(GEO.rim, rimM);
    rim.rotation.z = Math.PI / 6;
    mg.add(plate, rim);
    mg.scale.setScalar(tier.size);
    const m = { kind: 'mirror', mesh: mg, mats: [glass, rimM], r: tier.size * 0.95, hp: Infinity, score: 0, t: 0, flash: 0, fireT: Infinity,
      core, slot: (i / tier.mirrors) * Math.PI * 2, noLock: true, reflectT: 0 };
    mg.position.copy(g.position);
    c.addEnemy(m, 0);
    m.shadow.visible = false;
    core.mirrors.push(m);
  }
  c.bossDefeated = false;
}

export const MIRROR_KINDS = {
  mcore: {
    big: true,
    update(c, e, dt, scroll, ctx, p) {
      const T = e.tier;
      const hz = c.holdZ(-58);
      e.z = Math.min(hz, e.z + (scroll * 0.4 + 30) * dt);
      // 鏡の回転。tier 3 は時々逆回りにする (向きが変わる前に 0.6 秒止まる)
      if (T.reverse) {
        e.revT = (e.revT ?? rand(5, 8)) - dt;
        if (e.revT < 0.6 && e.revT > 0) e.spinK = Math.max(0, (e.spinK ?? 1) - dt * 3);
        else e.spinK = Math.min(1, (e.spinK ?? 1) + dt * 2);
        if (e.revT <= 0) { e.dir *= -1; e.revT = rand(5, 8); }
      }
      e.a += dt * T.speed * e.dir * (e.spinK ?? 1) * (e.hp < e.maxHp * 0.5 ? 1.35 : 1);
      // 位置: tier 1 は左右にゆっくり揺れる、tier 2 以上は大きな円を描く (頭の真上には来ない高さ)
      const px = ctx.player.x;
      e.cx += (px - e.cx) * Math.min(1, dt * 0.25);
      const ox = T.move ? Math.sin(e.t * 0.35) * 14 : Math.sin(e.t * 0.5) * 6;
      const oy = T.move ? Math.cos(e.t * 0.35) * 3 : 0;
      p.set(e.cx + ox, e.cy + oy, e.z);
      e.mesh.rotation.y += dt * 0.6;
      e.mesh.rotation.x += dt * 0.25;
      e.reflectT -= dt;
      if (e.hp < e.maxHp * 0.5) e.mats[0].userData.base.setHex(0xff5a8a); // 体力が半分を切ると赤く光る
    },
    fire(c, e, ctx, p, lv) {
      const T = e.tier;
      if (T.spiral && e.hp < e.maxHp * 0.5) {
        // 渦巻き: 0.45 秒ごとに 2 発ずつ、向きを回しながら
        e.fireT = 0.45 / Math.min(1.3, lv);
        e.shotA += 0.8;
        for (const s of [0, Math.PI]) c.fireBullet(p.clone(), ctx.player, Math.sin(e.shotA + s) * 0.5);
        return;
      }
      // 扇: 核から 5〜7 発
      e.fireT = rand(1.8, 2.4) / Math.min(1.5, lv);
      const n = T.fan;
      for (let k = 0; k < n; k++) c.fireBullet(p.clone(), ctx.player, (k - (n - 1) / 2) * 0.12);
    },
    onDeath(c, e) {
      // 核が砕けると、鏡も一緒に砕け散る
      for (const m of e.mirrors) {
        if (m.dead) continue;
        m.dead = true;
        c.explode(m.mesh.position, false);
      }
    },
  },

  mirror: {
    // 弾を撃ち返す (combat.js の弾の当たりで、このフラグを見る)
    reflect: true,
    update(c, e, dt, scroll, ctx, p) {
      const core = e.core;
      if (core.dead) { e.dead = true; return; }
      const R = core.tier.R;
      const a = core.a + e.slot;
      // 核のまわりの水平な輪 (少し傾ける)。前 (+z) を通るときに核を隠す
      const cp = core.mesh.position;
      p.set(cp.x + Math.sin(a) * R, cp.y + Math.sin(a * 2) * 1.2 + Math.cos(a) * 1.5, cp.z + Math.cos(a) * R);
      // 鏡の面は外向き (輪の外側を向く)
      e.mesh.lookAt(cp.x + Math.sin(a) * R * 2, p.y, cp.z + Math.cos(a) * R * 2);
    },
  },
};
