// 追加の敵 (鉱石とガラスの題材)。種類ごとに 出し方 (spawn)・動き (update)・攻撃 (fire)・倒されたとき (onDeath) を持つ。
// combat.js から呼ばれ、c は Combat (fireBullet / addEnemy などを使う)。モデルは結晶の形を Three.js で組み立てる
//   kamikaze: 体当たりしてきて、ぶつかると自分も爆発する
//   heavy:    大きい敵。同時に出しすぎない (ガンシップ・建設ロボと同じ扱い)
//   shielded: true を返す間は、弾を跳ね返す
//   big:      倒したときの爆発を大きくし、回復アイテムを落とすことがある
import * as THREE from 'three';
import { CEIL_Y } from './world.js';
import { sfx } from './audio.js';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const DUST = new THREE.Color(0xb89a70);
const K = 1.8; // 敵の大きさの倍率 (近づいたときに画面いっぱいに迫って見えるように)

// Blender で作ったモデル (assets/enemies.glb を combat.js が読んで入れる)。読み込むまでは下の図形で組み立てる
export const MODELS = {};

// 共有するジオメトリ (敵ごとに作り直さない)
const GEO = {
  dart: new THREE.OctahedronGeometry(1, 0).scale(0.55, 0.55, 2.2),
  lens: new THREE.CylinderGeometry(2.4, 2.4, 0.5, 10).rotateX(Math.PI / 2),
  lensCore: new THREE.SphereGeometry(0.9, 10, 8),
  tower: new THREE.CylinderGeometry(1.1, 1.5, 6, 6).translate(0, -4.4, 0), // 水晶塔の胴 (原点 = 頭。頭の 1.4〜7.4 m 下)
  towerHead: new THREE.OctahedronGeometry(1.4, 0),
  batBody: new THREE.OctahedronGeometry(0.8, 0).scale(0.8, 0.6, 1.3),
  batWing: new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.6, 0, 0, 0.7, 2.6, 0.3, -0.2], 3)),
  gem: new THREE.IcosahedronGeometry(1, 0),
  orb: new THREE.SphereGeometry(1, 12, 10),
  jellyCap: new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), // クラゲの笠 (上向きのお椀)
  jellyRim: new THREE.TorusGeometry(1, 0.06, 4, 24).rotateX(Math.PI / 2),
  tentacle: new THREE.CylinderGeometry(0.14, 0.05, 1, 5).translate(0, -0.5, 0), // 原点 = 付け根。下へ長さ 1
};
// クラゲの触手の光 (細い線なので、材質は 1 つを共有する)
const TENTACLE_MAT = new THREE.MeshBasicMaterial({ color: 0x9ff8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
GEO.batWing.computeVertexNormals();
// 二十面体の 20 枚の装甲板 (開くときに 1 枚ずつ外へ広がる)。描画を 1 回にするため、20 枚を 1 つの形にまとめ、
// 頂点ごとに「その板の中心」(aCenter) を持たせる。開き方はシェーダーで、板の中心の向きへずらして作る (icoShellMat)
GEO.icoShell = (() => {
  const pos = new THREE.IcosahedronGeometry(1, 0).toNonIndexed().attributes.position;
  const verts = [], centers = [];
  for (let f = 0; f < pos.count; f += 3) {
    const v = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, f + k));
    const c = v[0].clone().add(v[1]).add(v[2]).divideScalar(3);
    // 外の面と、内側へ 22% 縮めた面をつないで、厚みのある装甲板にする
    const o = v.map((p) => p.clone().sub(c));
    const i = v.map((p) => p.clone().multiplyScalar(0.78).sub(c));
    const tris = [o[0], o[1], o[2], i[0], i[2], i[1]];
    for (let k = 0; k < 3; k++) {
      const n = (k + 1) % 3;
      tris.push(o[k], i[k], i[n], o[k], i[n], o[n]);
    }
    for (const t of tris) {
      verts.push(t.x + c.x, t.y + c.y, t.z + c.z);
      centers.push(c.x, c.y, c.z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('aCenter', new THREE.Float32BufferAttribute(centers, 3));
  geo.computeVertexNormals(); // 頂点を共有しない形なので、板ごとの平らな面のまま
  return geo;
})();
// 二十面体の装甲板の材質: userData.open (0〜0.15) の分だけ、板を中心から外へずらす
function icoShellMat() {
  const m = mat(0x4a4258, 0x120c22, { metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide, own: true }); // 鈍く光る黒鉄の装甲 (開き具合は敵ごと)
  m.userData.open = { value: 0 };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOpen = m.userData.open;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aCenter;\nuniform float uOpen;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += aCenter * uOpen;');
  };
  m.customProgramCacheKey = () => 'icoShell';
  return m;
}
GEO.icoCore = new THREE.IcosahedronGeometry(0.72, 1);
// マンモス: 毛の塊 (丸を伸ばして使う)、脚、鼻の節、反り返った牙
GEO.blob = new THREE.IcosahedronGeometry(1, 1);
GEO.leg = new THREE.CylinderGeometry(0.55, 0.45, 2.6, 7).translate(0, -1.3, 0); // 原点 = 付け根
GEO.trunkSeg = new THREE.CylinderGeometry(0.42, 0.34, 1, 7).translate(0, -0.5, 0);
GEO.tusk = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
  [0, 0, 0], [0.15, -0.9, 0.5], [0.35, -1.2, 1.4], [0.55, -0.7, 2.2], [0.6, 0.2, 2.5],
].map((v) => new THREE.Vector3(...v))), 14, 0.2, 6);

// マテリアルは同じ色どうしで共有する (敵ごとに作らない。被弾の光は combat の applyFlash が白い材質に差し替える)。
// own: 敵ごとに色や形を変えるもの (二十面体の装甲の開き、衛星コアの核の色) は、敵ごとに作って発光色で光らせる
const SHARED = new Map();
export function mat(color, emissive = 0x000000, { own = false, ...extra } = {}) {
  const key = own ? null : JSON.stringify([color, emissive, extra.metalness, extra.roughness, extra.opacity, extra.side]);
  if (key && SHARED.has(key)) return SHARED.get(key);
  const m = new THREE.MeshStandardMaterial({ color, emissive, flatShading: true, roughness: 0.2, metalness: 0.2, ...extra });
  m.userData.base = m.emissive.clone();
  m.userData.shared = !own;
  if (key) SHARED.set(key, m);
  return m;
}
function build(parts) {
  const g = new THREE.Group();
  const mats = [], flashMeshes = [];
  for (const [geo, m, setup] of parts) {
    const mesh = new THREE.Mesh(geo, m);
    setup?.(mesh);
    g.add(mesh);
    if (m.userData.shared) {
      mesh.userData.mat = m;
      flashMeshes.push(mesh);
    } else if (!mats.includes(m)) mats.push(m);
  }
  return { mesh: g, mats, flashMeshes };
}

// Blender のモデルがあればそれを、なければ図形 (parts) で組み立てる。モデルはほかの敵と同じく -Z が前なので 180 度回す。
// own: 敵ごとに色を変えるもの (衛星コアの核) は材質を複製して、発光色で光らせる
export function model(key, parts, own = false) {
  const tpl = MODELS[key];
  if (!tpl) return build(parts);
  const inner = tpl.clone();
  const mats = [], flashMeshes = [], copies = new Map();
  inner.traverse((o) => {
    if (!o.isMesh) return;
    if (own) {
      if (!copies.has(o.material)) {
        const m = o.material.clone();
        m.userData.base = m.emissive.clone();
        copies.set(o.material, m);
        mats.push(m);
      }
      o.material = copies.get(o.material);
    } else {
      o.userData.mat = o.material;
      flashMeshes.push(o);
    }
  });
  inner.rotation.y = Math.PI;
  const g = new THREE.Group();
  g.add(inner);
  return { mesh: g, mats, flashMeshes };
}

// 目の手前で砕く (迫力の決まり: 目の 6 m 以内に大きな物を入れない)。体当たりしてくる大きな物に使う。
// 物の前の面 (中心 + r) が目の 8 m 手前に来たら 1 回だけ見て、当たる位置なら砕けてダメージ。外れていれば、
// それる向き (e.veer) を決める。呼んだ側は、それる向きへ横に動かして、表面から目まで 6 m 以上あける (veerAway)
// core: 当たる範囲 (半径の何割)。1 で今までの体当たりと同じ
export function eyeGuard(c, e, ctx, pos, r, dmg = 25, core = 1) {
  const P = ctx.player;
  if (e.eyeChecked || ctx.side || pos.z + r < P.z - 8) return false;
  e.eyeChecked = true;
  e.noHit = true; // 当たりはここで見た (このあとは通り抜けない)
  const d = Math.hypot(pos.x - P.x, pos.y - P.y);
  if (d < r * core + ctx.playerR) {
    ctx.onPlayerHit(dmg);
    c.explode(pos.clone(), true);
    e.dead = true; // 倒したことにはしない (点は入らない)
    return true;
  }
  if (d < r + 6) e.veer = Math.sign(pos.x - P.x) || 1; // 表面から目まで 6 m ないときだけ、横へそれる
  return false;
}
// それる: x を返す。表面から目まで 6 m 以上あくまで、毎秒 30 m で横へ
export function veerAway(e, x, r, ctx, dt) {
  if (!e.veer || Math.abs(x - ctx.player.x) >= r + 6) return x;
  return x + e.veer * 30 * dt;
}

// ボスの部品: Blender のモデルを複製する (材質はボスごとに複製して、発光色で光らせる)。モデルは -Z が前なので 180 度回す。
// first: mats の先頭に並べる材質の名前 (コードが mats[0]・mats[1] を見て光らせるため)
export function bossModel(key, first = []) {
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

export const EXTRA = {
  // ---- 水晶の矢 (CRYSTAL DART): 5 本が列になり、らせんを描きながら突っ込んでくる。近づくほど輪が小さくなる
  dart: {
    kamikaze: true,
    spawn(c, px, py) {
      const cx = px + rand(-8, 8), cy = THREE.MathUtils.clamp(py + rand(0, 4), 3, 12), dir = Math.random() < 0.5 ? 1 : -1;
      for (let k = 0; k < 5; k++) {
        const e = { kind: 'dart', ...model('dart', [[GEO.dart, mat(0x9ff0ff, 0x2a8ab0)]]), r: 1.1 * K, hp: 1, score: 200, t: 0, flash: 0, fireT: Infinity,
          cx, cy, z: SPAWN_Z - k * 9, phase: k * 0.7, dir };
        e.mesh.scale.setScalar(K);
        e.mesh.position.set(cx, cy, e.z);
        c.addEnemy(e, 0.8 * K);
      }
    },
    update(c, e, dt, scroll, ctx, p) {
      e.z += (scroll * 0.5 + 34) * dt;
      e.cx += (ctx.player.x - e.cx) * Math.min(1, dt * 0.4);
      e.cy += (ctx.player.y - e.cy) * Math.min(1, dt * 0.3);
      const R = 8 * THREE.MathUtils.clamp(-e.z / 160, 0.25, 1);
      const a = e.t * 3.2 * e.dir + e.phase;
      _a.set(e.cx + Math.cos(a) * R, Math.max(1.5, e.cy + Math.sin(a) * R * 0.7), e.z);
      _b.subVectors(_a, p); // 進む向き
      p.copy(_a);
      if (_b.lengthSq() > 1e-6) e.mesh.lookAt(_b.add(p)); // 先を進む向きに向け、きりもみさせる
      e.mesh.rotateZ(e.t * 8);
    },
  },

  // ---- ガラスのレンズ (PRISM LENS): 横から滑り込んで止まり、回りながら渦巻き状に弾をまき、反対側へ去る
  lens: {
    heavy: true,
    spawn(c, px, py) {
      const n = Math.random() < 0.4 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const side = (k ? -1 : 1) * (Math.random() < 0.5 ? 1 : -1);
        const glass = mat(0xd8f6ff, 0x2a6a88, { transparent: true, opacity: 0.85, forceSinglePass: true });
        const core = mat(0xffffff, 0x60e0ff);
        const e = { kind: 'lens', ...model('lens', [[GEO.lens, glass], [GEO.lensCore, core]]), r: 2.6 * K, hp: 5 + c.level, score: 800, t: 0, flash: 0, fireT: Infinity, delay: k * 0.25,
          state: 'slide', side, x0: px + side * 48, tx: px + side * rand(4, 11), y: THREE.MathUtils.clamp(py + rand(2, 6), 4, 14) + k * 5, z: c.holdZ(rand(-95, -70)), spin: 0, shotA: 0 };
        e.mesh.scale.setScalar(K);
        e.mesh.position.set(e.x0, e.y, e.z);
        c.addEnemy(e, 2 * K);
      }
    },
    update(c, e, dt, scroll, ctx, p) {
      if (e.state === 'slide') {
        p.x += (e.tx - p.x) * Math.min(1, dt * 2.2);
        // 横スクロールでは x を平面にそろえられるので、時間で止まる
        if (ctx.side ? e.t > 1.2 : Math.abs(e.tx - p.x) < 0.5) { e.state = 'hover'; e.hold = 3.5; e.fireT = 0.3 + e.delay; }
      } else if (e.state === 'hover') {
        e.hold -= dt;
        e.spin += dt * 4;
        if (e.hold <= 0) e.state = 'leave';
      } else {
        p.x -= e.side * 30 * dt;
        e.y += 4 * dt;
        if (ctx.side ? e.t > 9 : Math.abs(p.x - ctx.player.x) > 70) e.dead = true;
      }
      p.y = e.y + Math.sin(e.t * 1.7) * 1.2;
      p.z = e.z;
      e.mesh.lookAt(ctx.player);
      e.mesh.rotateZ(e.spin);
    },
    fire(c, e, ctx, p, lv) {
      if (e.state !== 'hover') return;
      e.fireT = 0.5 / Math.min(1.3, lv);
      // 3 発の扇を、向きを少しずつ回しながら撃つ (渦巻き)
      e.shotA += 0.7;
      for (const s of [-0.25, 0, 0.25]) c.fireBullet(p.clone(), ctx.player, Math.sin(e.shotA) * 0.35 + s);
    },
  },

  // ---- 水晶塔 (SPIRE TURRET): 前方の地面から突き出してくる砲台。せり上がると 3 連射する
  turret: {
    spawn(c, px) {
      const xs = Math.random() < 0.5 ? [px - rand(6, 13), px + rand(6, 13)] : [px + rand(-10, 10)];
      for (const [i, x] of xs.entries()) {
        const body = mat(0x6a4a9a, 0x1a0a30);
        const head = mat(0xff9af0, 0x803070);
        // 当たり・ロック・ミサイルは原点を見るので、原点を光る頭に置く (胴は下へ伸ばす)
        const made = model('turret', [[GEO.tower, body], [GEO.towerHead, head, (m) => { m.name = 'head'; }]]);
        const e = { kind: 'turret', ...made, r: 2.4 * K, hp: Math.round(4 + c.level * 1.5), score: 900, t: 0, flash: 0, fireT: Infinity, rise: 0, burst: 0 };
        e.head = e.mesh.getObjectByName('head') || e.mesh.getObjectByName('TowerHead');
        e.mesh.scale.setScalar(K);
        e.mesh.position.set(x, -2 * K, (c.sideMode ? SPAWN_Z - 60 : SPAWN_Z + 40) - i * 12);
        c.addEnemy(e, 1.8 * K);
      }
    },
    update(c, e, dt, scroll, ctx, p) {
      p.z += scroll * dt; // 地面と一緒に流れてくる
      if (p.z > -160) e.rise = Math.min(1, e.rise + dt * 1.4);
      p.y = 7.4 * K - 9.4 * K * (1 - e.rise) ** 3; // 地面からせり上がる (頭が 7.4 × K の高さまで)
      e.head.rotation.y += dt * 3;
      if (e.rise >= 1 && e.fireT === Infinity) e.fireT = 0.6;
    },
    fire(c, e, ctx, p, lv) {
      // 3 連射して、少し休む
      c.fireBullet(p.clone(), ctx.player, 0, 'shell');
      e.burst++;
      e.fireT = e.burst % 3 ? 0.22 : rand(1.8, 2.6) / lv;
    },
  },

  // ---- 結晶コウモリ (GLASS BAT): 6 匹が V 字の編隊で高空を来て、1 匹ずつ急降下して襲いかかり、また上へ抜ける
  bat: {
    kamikaze: true,
    spawn(c, px) {
      const cx = px + rand(-6, 6), top = Math.min(18, (c.ceilingY ?? 40) - 3);
      for (let k = 0; k < 6; k++) {
        const body = mat(0x6a4aa0, 0x8040c0); // 霧になじまない明るさに
        const wing = mat(0xc8a8ff, 0x4a2a8a, { transparent: true, opacity: 0.9, side: THREE.DoubleSide, forceSinglePass: true }); // 羽は 1 枚の三角なので両面
        const made = model('bat', [[GEO.batBody, body], [GEO.batWing, wing, (m) => { m.name = 'wL'; m.scale.x = -1; }], [GEO.batWing, wing, (m) => { m.name = 'wR'; }]]);
        const slot = k - 2.5;
        const e = { kind: 'bat', ...made, r: 1.4 * K, hp: 1, score: 250, t: 0, flapPh: k * 0.3, flash: 0, fireT: Infinity,
          state: 'cruise', x: cx + slot * 6.5, y: top - Math.abs(slot) * 1.2, z: SPAWN_Z - Math.abs(slot) * 6, diveT: 2.4 + k * 0.4, u: 0 };
        // モデルは 180 度回して置くので、モデルの右の羽 (BatWingR) が画面の左。羽ばたきの向きは図形と同じになる
        e.wL = e.mesh.getObjectByName('wL') || e.mesh.getObjectByName('BatWingR');
        e.wR = e.mesh.getObjectByName('wR') || e.mesh.getObjectByName('BatWingL');
        e.mesh.scale.setScalar(K);
        e.mesh.position.set(e.x, e.y, e.z);
        c.addEnemy(e, K);
      }
    },
    update(c, e, dt, scroll, ctx, p) {
      e.z += (scroll * 0.45 + (e.state === 'cruise' ? 36 : 52)) * dt;
      if (e.state === 'cruise') {
        p.set(e.x + Math.sin(e.t * 2) * 1.5, e.y, e.z);
        // 出てから決まった時間で、1 匹ずつ (0.4 秒ごとに) 降りはじめる
        if (e.t > e.diveT) {
          e.state = 'dive';
          e.from = p.clone();
          e.to = ctx.player.clone();
          e.dur = THREE.MathUtils.clamp((-e.z - 4) / (scroll * 0.45 + 52), 0.6, 1.4); // z = -4 で狙った所に届く時間
        }
      } else {
        // 急降下: 狙った位置まで弧を描いて降り、通り過ぎたら上へ抜ける
        e.u += dt / e.dur;
        const k = Math.min(1, e.u);
        p.set(THREE.MathUtils.lerp(e.from.x, e.to.x, k), THREE.MathUtils.lerp(e.from.y, e.to.y, Math.sin(k * Math.PI / 2)) + Math.max(0, e.u - 1) * 18, e.z);
      }
      const flap = Math.sin((e.t + e.flapPh) * (e.state === 'dive' ? 10 : 16)) * 0.7;
      e.wL.rotation.z = -flap;
      e.wR.rotation.z = flap;
      e.mesh.rotation.x = e.state === 'dive' && e.u < 1 ? 0.5 : 0;
    },
  },

  // ---- 跳ねる結晶 (BOUNCE GEM): 地面で大きく跳ねながら迫ってくる。撃つと 2 つに割れて斜めに跳ね散る
  bouncer: {
    kamikaze: true,
    spawn(c, px) {
      const n = Math.random() < 0.5 ? 2 : 1;
      for (let k = 0; k < n; k++) EXTRA.bouncer.make(c, px + rand(-10, 10), SPAWN_Z - k * 18, 2.4 * K, 0, 3 + c.level);
    },
    make(c, x, z, size, vx, hp) {
      const e = { kind: 'bouncer', ...model('bouncer', [[GEO.gem, mat(0xffd36a, 0x7a4a10)]]), r: size, size, hp, score: size > 3 ? 600 : 150, t: 0, flash: 0, fireT: Infinity,
        vx, vy: rand(4, 10), z, x, dmg: size > 3 ? 25 : 15 };
      e.mesh.scale.setScalar(size);
      e.mesh.position.set(x, size + 6, z);
      c.addEnemy(e, size);
      return e;
    },
    update(c, e, dt, scroll, ctx, p) {
      e.z += (scroll * 0.5 + 22) * dt;
      e.vy -= 30 * dt;
      p.y += e.vy * dt;
      if (p.y < e.size) {
        p.y = e.size;
        e.vy = e.size > 3 ? rand(16, 20) : rand(11, 14); // 着地したら、また跳ねる
      }
      if (c.ceilingY && p.y > c.ceilingY - e.size) { p.y = c.ceilingY - e.size; e.vy = -Math.abs(e.vy); }
      if (!e.veer) e.x += (e.vx + (ctx.player.x - e.x) * 0.35) * dt;
      e.x = veerAway(e, e.x, e.size, ctx, dt);
      p.x = e.x;
      p.z = e.z;
      if (eyeGuard(c, e, ctx, p, e.size, e.dmg)) return;
      e.mesh.rotation.x += dt * 3;
      e.mesh.rotation.z += dt * 2;
    },
    onDeath(c, e) {
      if (e.size < 3) return;
      for (const s of [-1, 1]) {
        const half = EXTRA.bouncer.make(c, e.mesh.position.x + s * 2.5, e.mesh.position.z, 1.2 * K, s * 9, 1);
        half.mesh.position.y = e.mesh.position.y;
        half.vy = 12;
      }
    },
  },

  // ---- 結晶の二十面体 (PRISM ICOSA): 天井のある面で、床と天井を転がってくる。
  // 転がりながら、150〜130 m 先で 20 枚のパネルが少し浮き上がって開き、中の赤い核からミサイルを 1 発撃つ。閉じている間は弾を跳ね返し、開いている間だけ壊せる (パネルは少しだけ開く)。
  // 開いている間はゆっくり近づき (地面に対してはうしろへ転がる)、閉じるとまた速く転がってくる (よけるか、開いている間に壊す)
  icosa: {
    kamikaze: true, heavy: true, big: true,
    spawn(c, px) {
      // 大きくて重い: 直径 約 13.5 m。5〜6 個の組が、天井の組・床の組と交互に、次々に転がってくる。
      // 床の組と天井の組の両方をよけられる「真ん中の高さ」はない (上下を交互によける)。どの組にも 1 本、横のすき間 (幅 8 m 以上) を残す
      const n = 5 + Math.floor(Math.random() * 2);
      const R = 3.4 * K * 1.1;
      const gapX = px + rand(-10, 10);
      const xs = Array.from({ length: n }, () => {
        const x = px + rand(-22, 22);
        return Math.abs(x - gapX) < R + 4 ? gapX + (x < gapX ? -1 : 1) * (R + 4 + rand(0, 6)) : x;
      });
      const holdZ = rand(-150, -130); // 組の全部が、同じ所で開く (前後の間は 14 m のまま)
      const top = c.icosaTop = !c.icosaTop; // 前の組と反対側
      const pack = {}; // 1 列で 1 組 (重い敵の数え方)
      for (let k = 0; k < n; k++) {
        const shell = icoShellMat();
        const core = mat(0xff5060, 0xff2040);
        const parts = [[GEO.icoShell, shell], [GEO.icoCore, core, (m) => { m.name = 'core'; m.scale.setScalar(0.01); }]];
        const ceil = top;
        const e = { kind: 'icosa', ...build(parts), r: R * 0.9, R, hp: 6 + c.level, score: 1200, t: 0, flash: 0, fireT: Infinity, dmg: 25,
          ceil, pack, x: xs[k], z: SPAWN_Z - k * 14, state: 'roll', open: 0, holdT: 0, shots: 0, holdZ: c.holdZ(holdZ - k * 14) };
        e.core = e.mesh.getObjectByName('core');
        e.shell = shell;
        e.mesh.scale.setScalar(R);
        e.mesh.position.set(e.x, ceil ? CEIL_Y - R : R, e.z);
        c.addEnemy(e, 2.8 * K);
      }
    },
    shielded: (e) => e.open < 0.7,
    update(c, e, dt, scroll, ctx, p) {
      const z0 = e.z;
      // 閉じている間は速く転がってくる。開いている間はゆっくり (プレイヤーへ毎秒 15 m。地面に対してはうしろへ転がる)
      e.z += (e.state === 'open' ? 15 : scroll + 10) * dt;
      if (e.state === 'roll') {
        e.holdT -= dt;
        // 開く場所まで来たら、1 回だけ開く
        if (e.z >= e.holdZ && !e.opened) { e.state = 'open'; e.opened = true; e.holdT = 0; e.shots = 0; }
      } else {
        // 転がりながら開き、撃ち、閉じる
        e.holdT += dt;
        e.open = THREE.MathUtils.clamp(e.holdT < 2.4 ? (e.holdT - 0.3) / 0.4 : (2.9 - e.holdT) / 0.4, 0, 1);
        if (e.holdT > 0.75 && e.fireT === Infinity && e.shots === 0) e.fireT = 0;
        if (e.holdT > 3) { e.state = 'roll'; e.open = 0; e.holdT = 1.2; }
      }
      e.x = veerAway(e, e.x, e.R, ctx, dt);
      p.set(e.x, e.ceil ? CEIL_Y - e.R : e.R, e.z);
      if (eyeGuard(c, e, ctx, p, e.r, e.dmg)) return;
      // 転がる: 地面に対する速さの分だけ回す (天井では逆向き)
      const ground = (e.z - z0) / Math.max(dt, 1e-4) - scroll;
      e.mesh.rotation.x += (ground / e.R) * dt * (e.ceil ? -1 : 1); // 開いている間も転がり続ける
      e.shell.userData.open.value = e.open * 0.15; // パネルは少しだけ開き、すき間から赤い核の光がのぞく
      e.core.scale.setScalar(Math.max(0.01, e.open));
    },
    fire(c, e, ctx, p) {
      if (e.state !== 'open' || e.open < 0.7 || (!ctx.side && p.z > ctx.player.z - 40)) { e.fireT = Infinity; return; } // 近すぎるときは撃たない (見てからよけられるように)
      // 中の核からミサイル (煙を引く弾) を、少し角度をつけて撃つ
      c.fireBullet(p.clone(), ctx.player, rand(-0.1, 0.1), 'shell');
      e.shots++;
      e.fireT = Infinity; // 5〜6 個の組で来るので、1 回開くごとに 1 発
    },
  },

  // ---- マンモス (MAMMOTH): 1 面。前方の地面を歩いてきて、150 m 先で前脚を上げて鼻を振り上げ、鳴いて鼻から弾を 3 発吹く。
  // そのあと頭を下げて、プレイヤーめがけて突進してくる (72 m 先から。最初の 0.3 秒だけ追う。上へ飛ぶか、横へよける)。硬くて大きい。
  // 1 面は操作を覚える面なので、1 体ずつ、面の最初の 15 秒は出さない (combat.spawnWave)
  mammoth: {
    heavy: true, big: true,
    spawn(c, px) {
      const n = 1;
      for (let k = 0; k < n; k++) {
        // Blender のモデルがないとき (読み込む前) だけ、図形と材質で組み立てる
        const M = MODELS.mammoth;
        const own = { own: true };
        const [fur, dark, tusk, eye] = M ? [] : [
          mat(0x6e4429, 0x000000, { roughness: 0.95, metalness: 0, ...own }),
          mat(0x4a2c1a, 0x000000, { roughness: 0.95, metalness: 0, ...own }),
          mat(0xf6efdc, 0x2a2618, { roughness: 0.3, side: THREE.DoubleSide, ...own }), // 左の牙は裏返して使うので両面
          mat(0xff6030, 0xff3010, own),
        ];
        const g = new THREE.Group();
        const add = (parent, geo, m, pos, scale, rot) => {
          const mesh = new THREE.Mesh(geo, m);
          mesh.position.set(...pos);
          if (scale) mesh.scale.set(...scale);
          if (rot) mesh.rotation.set(...rot);
          parent.add(mesh);
          return mesh;
        };
        // Blender のモデルがあれば、部品を軸の位置に置く。材質はモデルと共有し、被弾の光は差し替えで行う (combat の applyFlash)
        const mats = M ? [] : [fur, dark, tusk, eye];
        const flashMeshes = [];
        const part = (parent, tpl, pos, scale) => {
          const o = tpl.clone();
          o.traverse((m) => {
            if (!m.isMesh) return;
            m.userData.mat = m.material;
            flashMeshes.push(m);
          });
          o.position.set(...pos);
          o.rotation.y = Math.PI; // モデルはほかの敵と同じく -Z が前なので、+Z (プレイヤーの方) へ向ける
          if (scale) o.scale.set(...scale);
          parent.add(o);
          return o;
        };
        // 胴 (原点 = 胴の真ん中。当たり・ロックはここを見る)、背中のこぶ、しっぽ
        if (M) part(g, M.body, [0, 0, 0]);
        else {
          add(g, GEO.blob, fur, [0, 0, 0], [2.3, 2.0, 3.1]);
          add(g, GEO.blob, fur, [0, 1.5, 0.9], [1.7, 1.4, 1.7]);
          add(g, GEO.trunkSeg, dark, [0, 0.4, -3], [0.4, 1.4, 0.4], [-0.5, 0, 0]);
        }
        // 頭は首を軸に上下に振る
        const head = new THREE.Group();
        head.position.set(0, 0.8, 2.6);
        g.add(head);
        if (M) part(head, M.head, [0, 0, 0]);
        else {
          add(head, GEO.blob, fur, [0, 0.3, 0.8], [1.5, 1.6, 1.4]);
          for (const sx of [-1, 1]) {
            add(head, GEO.blob, dark, [sx * 1.4, 0.4, 0.4], [0.25, 1.0, 0.8]); // 耳
            add(head, GEO.blob, eye, [sx * 0.75, 0.75, 1.95], [0.18, 0.18, 0.18]); // 光る目
            add(head, GEO.tusk, tusk, [sx * 0.55, -0.4, 1.7], [sx, 1, 1]); // 牙は左右で外へ反る
          }
        }
        // 鼻: 4 つの節。根元から順に曲げて、垂らしたり振り上げたりする
        const trunk = [];
        let parent = head;
        for (let i = 0; i < 4; i++) {
          const seg = new THREE.Group();
          seg.position.set(0, i ? -0.95 : -0.2, i ? 0 : 2.1);
          parent.add(seg);
          const w = 1 - i * 0.15;
          if (M) part(seg, M.trunk, [0, 0, 0], [w, 1, w]);
          else add(seg, GEO.trunkSeg, dark, [0, 0, 0], [w, 1, w]);
          trunk.push(seg);
          parent = seg;
        }
        // 脚: 付け根を軸に振る
        const legs = [];
        for (const [lx, lz] of [[-1.3, 1.8], [1.3, 1.8], [-1.3, -1.8], [1.3, -1.8]]) {
          const leg = new THREE.Group();
          leg.position.set(lx, -1.2, lz);
          g.add(leg);
          if (M) part(leg, M.leg, [0, 0, 0]);
          else add(leg, GEO.leg, dark, [0, 0, 0]);
          legs.push(leg);
        }
        const S = 1.5 * (c.sideMode ? 0.7 : 1);
        g.scale.setScalar(S);
        const e = {
          kind: 'mammoth', mesh: g, mats, flashMeshes: M ? flashMeshes : null, r: 3.2 * S, hp: 14 + c.level * 4, score: 2000, t: rand(0, 2), flash: 0, fireT: Infinity, dmg: 25,
          S, head, trunk, legs, state: 'walk', timer: 0, step: 0, x: px + (n > 1 ? (k ? 1 : -1) * rand(10, 14) : rand(-6, 6)), z: SPAWN_Z - k * 25,
        };
        g.position.set(e.x, 3.8 * S, e.z);
        c.addEnemy(e, 3.2 * S);
      }
    },
    update(c, e, dt, scroll, ctx, p) {
      const P = ctx.player;
      let gait = 4, swing = 0.35, rear = 0, headDown = 0, trunkUp = 0;
      if (e.state === 'walk') {
        // 地面を歩いてくる (地面より少し速く)。プレイヤーの列へゆっくり寄る
        e.z += (scroll + 7) * dt;
        e.x += THREE.MathUtils.clamp(P.x - e.x, -3 * dt, 3 * dt);
        if (e.z > (c.sideMode ? -60 : -150)) { e.state = 'rear'; e.timer = 0; sfx.trumpet(); }
      } else if (e.state === 'rear') {
        // 前脚を上げて鼻を振り上げ、鳴いて鼻から弾を吹く (1.3 秒)
        e.timer += dt;
        e.z += scroll * dt;
        const k = Math.sin(Math.min(1, e.timer / 1.3) * Math.PI);
        rear = k * 0.45;
        trunkUp = k;
        gait = 0;
        if (e.timer > 0.6 && e.fireT === Infinity && !e.fired) { e.fired = true; e.fireT = 0; }
        if (e.timer > 1.3) {
          e.state = 'charge';
          e.timer = 0;
          sfx.whoosh();
        }
      } else {
        // 突進: 頭を下げて、地響きを立てて走ってくる。最初の 0.25 秒だけプレイヤーの列を追う (最後の 0.5 秒以上はまっすぐ)
        // 体は目を通り抜けない: 鼻先が目の 8 m 手前に来たら、当たる位置なら踏ん張って牙を突き立て、砕ける (ダメージ 25)。
        // 外れていれば、横へそれて表面が 6 m 以上離れた所を走り抜ける
        e.timer += dt;
        e.noHit = true;
        if (e.timer < 0.25) e.x += THREE.MathUtils.clamp(P.x - e.x, -14 * dt, 14 * dt);
        e.z += (scroll + 32) * dt;
        const front = 4.8 * e.S; // 胴の中心から鼻先まで
        // 上下は体の高さ (地面から背中まで) の中なら当たる
        const hy = THREE.MathUtils.clamp(P.y, 1, 5.8 * e.S);
        if (eyeGuard(c, e, ctx, _a.set(e.x, hy, e.z + front * 0.4), front * 0.6, 25, 0.7)) { sfx.trumpet(); return; }
        e.x = veerAway(e, e.x, 2.3 * e.S, ctx, dt); // 胴の横 (半幅 3.5 m) から目まで 6 m 以上
        gait = 11;
        swing = 0.6;
        headDown = 1;
        if (Math.random() < dt * 25) c.smoke.emit(_a.set(e.x + rand(-3, 3), 0.4, e.z + rand(-2, 2)), _b.set(rand(-3, 3), rand(1, 3), rand(-2, 2)), DUST, 2, 0.9, 2.5, 0.95);
      }
      // 歩く: 脚を対角に振り、体を少し上下させる。前脚を上げるときは体を起こす
      e.step += dt * gait;
      e.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(e.step + (i === 0 || i === 3 ? 0 : Math.PI)) * swing - (i < 2 ? rear * 1.6 : 0); });
      const bob = gait ? Math.abs(Math.sin(e.step)) * 0.25 : 0;
      e.mesh.rotation.x = -rear + headDown * 0.08;
      p.set(e.x, (3.8 + bob + rear * 2) * e.S, e.z);
      e.mesh.rotation.y = c.sideMode ? 0 : THREE.MathUtils.clamp((P.x - e.x) * 0.02, -0.4, 0.4);
      e.head.rotation.x = headDown * 0.45 - trunkUp * 0.35;
      // 鼻: ふだんはぶらぶら、鳴くときは振り上げる
      e.trunk.forEach((seg, i) => { seg.rotation.x = Math.sin(e.t * 2.4 - i * 0.6) * 0.12 + 0.1 - trunkUp * (0.55 + i * 0.12); });
      if (p.z > 25) e.dead = true;
    },
    fire(c, e, ctx) {
      // 鼻の先から、ゆっくりした玉を 3 発 (扇形)
      e.fireT = Infinity;
      const tip = e.trunk[3].getWorldPosition(new THREE.Vector3());
      for (let s = -1; s <= 1; s++) c.fireBullet(tip.clone(), ctx.player, s * 0.13);
    },
  },

  // ---- 水晶のクラゲ (CRYSTAL JELLY): 10 面。3 匹がふわふわ漂ってくる。幅 14 m のガラスの笠から、6 m おきに光の触手 3 本
  // (長さ 10 m、縦の線) を垂らす。垂らす前に笠が 0.8 秒明るく光る。触手は動かない。触れると 10。間をぬけるか、笠の上を越える。
  // 笠を撃つと (3 発) 割れて触手も消える。ゆっくりなので VR にやさしい
  jelly: {
    spawn(c, px) {
      const top = Math.min(9, (c.ceilingY ?? 40) - 3);
      for (let k = 0; k < 3; k++) {
        // Blender のモデル (CrystalJelly。笠 JellyCap と触手 JellyTent0〜2 は動かす部品) か、読み込む前は図形で。
        // 笠は目の近くで薄くするので、材質はクラゲごと (mats[0] が笠)
        const jm = bossModel('jelly', ['JellyCap', 'JellyGlow', 'JellyTentacle']);
        let g, capM, cap, tentacles, mats, flashMeshes;
        if (jm) {
          g = jm.mesh;
          mats = jm.mats;
          capM = mats[0];
          cap = g.getObjectByName('JellyCap');
          tentacles = [0, 1, 2].map((i) => g.getObjectByName(`JellyTent${i}`));
          for (const t of tentacles) { t.scale.set(1, 0.01, 1); t.visible = false; }
          flashMeshes = null;
        } else {
          // 笠は目の近くで薄くするので、クラゲごとの材質にする
          capM = mat(0xd8f6ff, 0x2a7aa0, { transparent: true, opacity: 0.6, side: THREE.DoubleSide, forceSinglePass: true, own: true });
          const glow = mat(0xffffff, 0x60e0ff);
          g = new THREE.Group();
          cap = new THREE.Mesh(GEO.jellyCap, capM);
          cap.scale.set(7, 2.6, 7);
          const rim = new THREE.Mesh(GEO.jellyRim, glow);
          rim.scale.setScalar(7);
          const core = new THREE.Mesh(GEO.gem, glow);
          core.scale.setScalar(1.1);
          core.position.y = 1;
          g.add(cap, rim, core);
          tentacles = [-6, 0, 6].map((x) => {
            const t = new THREE.Mesh(GEO.tentacle, TENTACLE_MAT);
            t.position.set(x, 0, 0);
            t.scale.set(1, 0.01, 1);
            t.visible = false;
            g.add(t);
            return t;
          });
          mats = [capM];
          flashMeshes = [rim, core];
        }
        const side = k - 1;
        const e = { kind: 'jelly', mesh: g, mats, flashMeshes, cap, capBase: cap.scale.clone(), r: 3, hp: 3, score: 700, t: rand(0, 3), flash: 0, fireT: Infinity,
          x: px + side * 22 + rand(-3, 3), y: top - rand(0, 3), z: SPAWN_Z - Math.abs(side) * 14, tentacles, drop: 0, warn: -1, hitDone: false, capM, dmg: 10 };
        for (const m of e.flashMeshes || []) m.userData.mat = m.material;
        g.position.set(e.x, e.y, e.z);
        c.addEnemy(e, 4);
      }
    },
    update(c, e, dt, scroll, ctx, p) {
      const P = ctx.player;
      e.z += (scroll * 0.5 + 10) * dt; // ゆっくり漂ってくる
      p.set(e.x + Math.sin(e.t * 0.6) * 1.2, e.y + Math.sin(e.t * 1.3) * 0.6, e.z);
      // 笠が脈打つ
      const pulse = 1 + Math.sin(e.t * 2.2) * 0.06;
      // 幅 14 m の笠が頭の近くを通るときは、目から 6 m 以内で薄くする (迫力の決まり)
      const near = p.distanceTo(P) - 7;
      e.capM.opacity = 0.6 * THREE.MathUtils.clamp(near / 6, 0.12, 1);
      e.cap.scale.set(e.capBase.x * pulse, e.capBase.y / pulse, e.capBase.z * pulse);
      // 触手を垂らす: 120 m 先で笠が 0.8 秒明るく光り (予告)、0.5 秒で 10 m 伸びる
      if (e.warn < 0 && p.z > -120) e.warn = 0;
      if (e.warn >= 0 && e.warn < 0.8) {
        e.warn += dt;
        e.flash = Math.sin(e.warn * 20) > 0 ? 0.05 : 0; // 明るく点滅
      } else if (e.warn >= 0.8) {
        e.drop = Math.min(1, e.drop + dt / 0.5);
      }
      for (const t of e.tentacles) {
        t.visible = e.drop > 0;
        t.scale.y = Math.max(0.01, 10 * e.drop);
        t.rotation.z = Math.sin(e.t * 1.5 + t.position.x) * 0.04; // ほんの少しゆれる (向きは変わらない)
      }
      // 当たり: 縦の触手 (付け根から 10 m 下まで) とプレイヤーの距離
      if (e.drop > 0.5 && !e.hitDone) {
        for (const t of e.tentacles) {
          const tx = p.x + t.position.x, bottom = p.y - 10 * e.drop;
          if (Math.hypot(P.x - tx, P.z - p.z) < 0.6 + ctx.playerR && P.y < p.y + ctx.playerR && P.y > bottom - ctx.playerR) {
            e.hitDone = true;
            ctx.onPlayerHit(10);
            break;
          }
        }
      }
      if (p.z > 30) e.dead = true;
    },
  },

  // ---- 衛星コア (ORBIT CORE): 8 の字を描いて漂うコアのまわりを、3 つの衛星が回って守る。
  // 衛星が残っている間、コアは弾を跳ね返す。全部落とすとコアが撃ってくる
  orbiter: {
    heavy: true, big: true,
    spawn(c, px, py) {
      const core = MODELS.orbiter ? null : mat(0x80ffd0, 0x20a070, { own: true }); // 守りがなくなると赤く光らせるので敵ごと
      const e = { kind: 'orbiter', ...model('orbiter', [[GEO.orb, core]], true), r: 2 * K, hp: 8 + c.level * 2, score: 1500, t: 0, flash: 0, fireT: Infinity,
        cx: px + rand(-5, 5), cy: THREE.MathUtils.clamp(py + rand(2, 5), 5, 13), z: SPAWN_Z, sats: [] };
      e.mesh.scale.setScalar(1.8 * K);
      e.mesh.position.set(e.cx, e.cy, e.z);
      c.addEnemy(e, 1.6 * K);
      for (let k = 0; k < 3; k++) {
        const s = { kind: 'satellite', ...model('satellite', [[GEO.gem, mat(0xffffff, 0x4060ff)]]), r: 1.1 * K, hp: 2, score: 300, t: 0, flash: 0, fireT: Infinity, core: e, a: (k / 3) * Math.PI * 2 };
        s.mesh.scale.setScalar(0.9 * K);
        s.mesh.position.copy(e.mesh.position);
        c.addEnemy(s, 0.8 * K);
        e.sats.push(s);
      }
    },
    shielded: (e) => e.sats.some((s) => !s.dead),
    update(c, e, dt, scroll, ctx, p) {
      const hz = c.holdZ(-70);
      e.z = Math.min(hz, e.z + (scroll * 0.4 + 22) * dt);
      if (e.z >= hz) e.hold = (e.hold || 0) + dt;
      const leave = (e.hold || 0) > 8;
      p.set(e.cx + Math.sin(e.t * 0.9) * 12, e.cy + Math.sin(e.t * 1.8) * 3 + (leave ? (e.hold - 8) * 10 : 0), e.z);
      if (p.y > 50) e.dead = true;
      const open = !EXTRA.orbiter.shielded(e);
      if (open && e.fireT === Infinity) {
        e.fireT = 0.8;
        e.mats[0].userData.base = new THREE.Color(0xff4060); // 守りがなくなったコアは赤く光る
      }
    },
    fire(c, e, ctx, p, lv) {
      e.fireT = 1.4 / lv;
      for (const sp of [-0.15, 0, 0.15]) c.fireBullet(p.clone(), ctx.player, sp);
    },
  },

  // 衛星 (衛星コアの部品): コアのまわりを回る。体当たりで傷つく
  satellite: {
    kamikaze: true,
    spawn() {},
    update(c, e, dt, scroll, ctx, p) {
      const core = e.core;
      if (core.dead) { e.dead = true; c.explode(p); return; }
      e.a += dt * 2.4;
      const R = 4.8 * K;
      p.set(core.mesh.position.x + Math.cos(e.a) * R, core.mesh.position.y + Math.sin(e.a) * R * 0.6, core.mesh.position.z + Math.sin(e.a) * R * 0.5);
      e.mesh.rotation.y += dt * 4;
    },
  },
};
