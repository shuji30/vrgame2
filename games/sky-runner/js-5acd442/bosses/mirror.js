// ボス: ミラーコア (MIRROR CORE)。光る結晶の核のまわりを、六角形の鏡がゆっくり回る。
// 鏡は壊せず、当たったプレイヤーの弾を撃ち返してくる。鏡が回るすき間から核を撃って倒す。
// tier 1 (2 面): 鏡 6 枚 / tier 2 (8 面): 鏡 8 枚、核が大きく円を描く / tier 3 (14 面): 鏡 8 枚が時々逆回りし、体力が半分を切ると渦巻き弾
// 体力が半分を切ると「鏡の突進」(MIRROR CHARGE): 約 4 秒ごとに鏡 1 枚が核の前に出て、縁が赤く 1 秒震えたあと、
// そのときプレイヤーがいた所へまっすぐ飛んでくる。目の 11 m 手前で砕けて、線の近く (横 3 m) にいれば 15。2 秒で輪に戻る
// 核と鏡は enemies.js の EXTRA と同じ形 (update / fire) で動かす。撃破と逃げる判定は combat.js の bossGroup に乗せる
import * as THREE from 'three';
import { MODELS } from '../enemies.js';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;
const _a = new THREE.Vector3();

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
  // side: 横スクロールのとき (輪を画面の面に立てるので、枚数を減らし小さくする)
  1: { mirrors: 6, R: 14, speed: 0.45, size: 4.6, move: 0, fan: 5, side: { mirrors: 4, R: 8, k: 0.6 } },
  2: { mirrors: 8, R: 15, speed: 0.6, size: 4.3, move: 1, fan: 5, side: { mirrors: 5, R: 8, k: 0.6 } },
  3: { mirrors: 8, R: 15, speed: 0.75, size: 4.3, move: 1, fan: 7, reverse: true, spiral: true, side: { mirrors: 5, R: 8, k: 0.6 } },
};

// Blender のモデルを複製する (材質はボスごとに複製して、発光色で光らせる)。モデルは -Z が前なので 180 度回す。
// first: mats の先頭に並べる材質の名前 (コードが mats[0]・mats[1] を見て光らせるため)
function fromModel(key, first) {
  const tpl = MODELS[key];
  if (!tpl) return null;
  const inner = tpl.clone();
  const copies = new Map();
  inner.traverse((o) => {
    if (!o.isMesh) return;
    if (!copies.has(o.material)) {
      const cm = o.material.clone();
      cm.userData.base = cm.emissive.clone();
      copies.set(o.material, cm);
    }
    o.material = copies.get(o.material);
  });
  inner.rotation.y = Math.PI;
  const g = new THREE.Group();
  g.add(inner);
  const mats = [...copies.values()];
  const order = (m) => { const i = first.indexOf(m.name); return i < 0 ? first.length : i; };
  mats.sort((a, b) => order(a) - order(b));
  return { mesh: g, mats };
}

// ボスを出す (combat.spawnBoss から呼ぶ)。def: { type: 'mirror', hp, tier }
export function spawnMirror(c, def) {
  const base = TIERS[def.tier || 1];
  const sd = c.sideMode ? base.side : null;
  const tier = sd ? { ...base, mirrors: sd.mirrors, R: sd.R, size: base.size * sd.k } : base;
  const coreK = sd ? sd.k : 1;
  const hp = def.hp || 160 + c.level * 30;
  // 核: Blender のモデル (MirrorCore) か、読み込む前は図形で。mats[0] は核の結晶 (体力が半分を切ると赤く光らせる)
  const made = fromModel('mirrorCore', ['MirrorCoreMat']) || (() => {
    const coreMat = mat(0xbff8ff, 0x40c8ff);
    const shellMat = mat(0x9fe8ff, 0x1a5a80, { transparent: true, opacity: 0.45, forceSinglePass: true });
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(GEO.core, coreMat), new THREE.Mesh(GEO.shell, shellMat));
    return { mesh: grp, mats: [coreMat, shellMat] };
  })();
  const g = made.mesh;
  const core = {
    kind: 'mcore', mesh: g, mats: made.mats, r: 5.6 * coreK, hp, noAssist: true, maxHp: hp, score: 0, t: 0, flash: 0, fireT: 3,
    tier, cy: THREE.MathUtils.clamp((c.lastPlayer?.y ?? 6) + 5, 8, 13), cx: c.lastPlayer?.x ?? 0, z: SPAWN_Z, a: 0, dir: 1, mirrors: [], shotA: 0, reflectT: 0,
  };
  g.scale.setScalar(5.2 * coreK);
  g.position.set(core.cx, core.cy, SPAWN_Z);
  // 撃破・逃げる判定と体力の表示は bossGroup で (escape: Infinity = 倒すまで)
  const grp = { type: 'mirror', t: 0, escape: Infinity, total: 1, kills: 0, leaving: false, bonus: 10000, ratio: () => Math.max(0, core.hp / core.maxHp) };
  c.bossGroup = grp;
  core.bossGroup = grp;
  c.addEnemy(core, 4);
  for (let i = 0; i < tier.mirrors; i++) {
    // 鏡: Blender のモデル (MirrorPlate) か図形で。mats[1] は金の縁 (鏡の突進の予告で赤く光らせる)
    const pm = fromModel('mirrorPlate', ['MirrorGlass', 'MirrorRim']) || (() => {
      const glass = mat(0xe8fbff, 0x3a7a9a);
      const rimM = mat(0xffd36a, 0x7a5a10);
      const grp = new THREE.Group();
      const rim = new THREE.Mesh(GEO.rim, rimM);
      rim.rotation.z = Math.PI / 6;
      grp.add(new THREE.Mesh(GEO.mirror, glass), rim);
      return { mesh: grp, mats: [glass, rimM] };
    })();
    const mg = pm.mesh;
    mg.scale.setScalar(tier.size);
    const m = { kind: 'mirror', mesh: mg, mats: pm.mats, r: tier.size * 0.95, hp: Infinity, score: 0, t: 0, flash: 0, fireT: Infinity,
      core, slot: (i / tier.mirrors) * Math.PI * 2, noLock: true, reflectT: 0, dmg: 15 };
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
      // 鏡の突進 (体力が半分を切ってから、約 4 秒ごとに 1 枚)
      if (e.hp < e.maxHp * 0.5 && !ctx.side && e.z >= hz - 1) {
        e.chargeT = (e.chargeT ?? 1.5) - dt;
        const free = e.mirrors.filter((m) => !m.dead && !m.charge);
        if (e.chargeT <= 0 && free.length === e.mirrors.filter((m) => !m.dead).length) { // 前の鏡が戻ってから
          const m = free[Math.floor(Math.random() * free.length)];
          if (m) m.charge = { state: 'warn', t: 0, from: m.mesh.position.clone() };
          e.chargeT = rand(3.6, 4.4);
        }
      }
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
    // 弾を撃ち返す (combat.js の弾の当たりで、このフラグを見る)。sideAbs: 横スクロールで z を縮めない
    reflect: true, sideAbs: true,
    update(c, e, dt, scroll, ctx, p) {
      const core = e.core;
      if (core.dead) { e.dead = true; return; }
      if (e.charge && chargeMirror(c, e, dt, ctx, p)) return;
      const R = core.tier.R;
      const a = core.a + e.slot;
      const cp = core.mesh.position;
      if (ctx.side) {
        // 横スクロール: 輪を画面の面 (y-z) に立てる。鏡は外向き
        p.set(cp.x, cp.y + Math.sin(a) * R, cp.z + Math.cos(a) * R);
        e.mesh.lookAt(cp.x, cp.y + Math.sin(a) * R * 2, cp.z + Math.cos(a) * R * 2);
        return;
      }
      // 核のまわりの水平な輪 (少し傾ける)。前 (+z) を通るときに核を隠す
      p.set(cp.x + Math.sin(a) * R, cp.y + Math.sin(a * 2) * 1.2 + Math.cos(a) * 1.5, cp.z + Math.cos(a) * R);
      // 鏡の面は外向き (輪の外側を向く)
      e.mesh.lookAt(cp.x + Math.sin(a) * R * 2, p.y, cp.z + Math.cos(a) * R * 2);
    },
  },
};

// 鏡の突進: 予告 (核の前で赤く震える 1 秒) → まっすぐ飛ぶ (毎秒 30 m) → 目の 11 m 手前で砕ける → 2 秒で輪に戻る。
// 輪にいないときは true を返す (いつもの輪の動きをしない)
function chargeMirror(c, e, dt, ctx, p) {
  const C = e.charge, P = ctx.player, cp = e.core.mesh.position;
  C.t += dt;
  const rim = e.mats[1];
  if (C.state === 'warn') {
    // 核の前へ出て、縁が赤く光って震える
    const k = Math.min(1, C.t / 0.4);
    _a.set(cp.x, cp.y, cp.z + e.core.tier.R * 0.7);
    p.lerpVectors(C.from, _a, k).add(_a.set(Math.sin(C.t * 55) * 0.25, 0, 0));
    e.mesh.lookAt(P);
    rim.userData.base.setHex(0xff3020).multiplyScalar(0.5 + 0.5 * Math.abs(Math.sin(C.t * 14)));
    if (C.t >= 1.0) {
      C.state = 'fly';
      C.t = 0;
      C.vel = P.clone().sub(p).normalize().multiplyScalar(30); // そのときいた所へ、まっすぐ (追わない)
      e.noHit = true; // 当たりは砕けるときに見る
    }
    return true;
  }
  if (C.state === 'fly') {
    p.addScaledVector(C.vel, dt);
    if (p.z + e.r > P.z - 11) {
      // 目の 11 m 手前で砕ける。飛んできた線の近くにいれば 15
      if (Math.hypot(p.x - P.x, p.y - P.y) < 3 + ctx.playerR) ctx.onPlayerHit(15);
      c.explode(p.clone(), true);
      C.state = 'gone';
      C.t = 0;
      e.mesh.visible = false;
    }
    return true;
  }
  if (C.state === 'gone') {
    p.set(cp.x, -80, cp.z); // 見えない所で待つ (弾を撃ち返さない)
    if (C.t >= 2) {
      e.charge = null;
      e.noHit = false;
      e.mesh.visible = true;
      rim.userData.base.setHex(0x7a5a10);
      return false;
    }
    return true;
  }
  return false;
}
