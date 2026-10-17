// 戦闘: 敵、敵弾、自機の機関砲、ロックオン、追尾ミサイル、爆発と煙
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sfx } from './audio.js';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;
// 敵の大きさ (Blender のモデルに対する倍率)。近くまで迫ったとき画面いっぱいに見えるよう大きめにする
const FIGHTER_SCALE = 1.6, GUNSHIP_SCALE = 1.4, MOAI_SCALE = 1.7, GREMLIN_SCALE = 2.6, MECH_SCALE = 1.4, PILL_SCALE = 1.6, BOSS_SCALE = 1.3;
const REMOVE_Z = 40;

const GUN_SPEED = 230;      // 機関砲の弾速 (m/s)
const LOCK_ANGLE = 0.14;    // この角度 (rad, 約8度) の中に入った敵をロックする
const UNLOCK_ANGLE = 0.4;   // ここまで外れたらロックを外す
const LOCK_MAX = 4;
const LOCK_INTERVAL = 0.13; // 1機ロックするのにかかる時間 (s)
const MISSILE_MAX = 8;
const MISSILE_REGEN = 1.6;  // 1発回復するまでの時間 (s)

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

// 線分 a-b と点 c の距離が r 未満か (高速の弾が1フレームですり抜けないように)
function segHit(a, b, c, r) {
  _a.subVectors(b, a);
  _b.subVectors(c, a);
  const L = _a.lengthSq();
  const t = L > 0 ? THREE.MathUtils.clamp(_b.dot(_a) / L, 0, 1) : 0;
  _c.copy(a).addScaledVector(_a, t);
  return _c.distanceToSquared(c) < r * r;
}

// ---- パーティクル (煙・火花)。Points 1つでまとめて描く
const particleVert = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
attribute float aSize;
uniform float uScale;
varying vec3 vC;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale * projectionMatrix[1][1] / max(-mv.z, 0.1);
  vC = aColor;
  // カメラのすぐ近くの煙は視界をふさぐので薄くする (VR のコックピットで特に大事)
  vA = aAlpha * smoothstep(2.0, 9.0, -mv.z);
}`;
const particleFrag = /* glsl */ `
varying vec3 vC;
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5);
  if (r > 0.5) discard;
  gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.1, r));
  #include <colorspace_fragment>
}`;

class Particles {
  constructor(scene, max, additive) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    const attr = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', attr(this.pos, 3));
    g.setAttribute('aColor', attr(this.col, 3));
    g.setAttribute('aAlpha', attr(this.alpha, 1));
    g.setAttribute('aSize', attr(this.size, 1));
    g.setDrawRange(0, 0);
    this.uniforms = { uScale: { value: 400 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: particleVert, fragmentShader: particleFrag,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(p, v, color, size, life, grow = 0, drag = 0.9) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.size[i] = size;
    this.age[i] = 0;
    this.life[i] = life;
    this.grow[i] = grow;
    this.drag[i] = drag;
    this.alpha[i] = 1;
  }

  copy(dst, src) {
    for (const [arr, k] of [[this.pos, 3], [this.vel, 3], [this.col, 3], [this.alpha, 1], [this.size, 1], [this.age, 1], [this.life, 1], [this.grow, 1], [this.drag, 1]]) {
      for (let j = 0; j < k; j++) arr[dst * k + j] = arr[src * k + j];
    }
  }

  update(dt, scroll, halfHeight) {
    this.uniforms.uScale.value = halfHeight;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.copy(i, --this.n);
        i--;
        continue;
      }
      const k = Math.pow(this.drag[i], dt * 60);
      for (let j = 0; j < 3; j++) {
        this.vel[i * 3 + j] *= k;
        this.pos[i * 3 + j] += this.vel[i * 3 + j] * dt;
      }
      this.pos[i * 3 + 2] += scroll * dt; // 地面と一緒に後ろへ流れる
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = 1 - this.age[i] / this.life[i];
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    for (const name of ['position', 'aColor', 'aAlpha', 'aSize']) g.attributes[name].needsUpdate = true;
  }

  clear() { this.n = 0; }
}

// ---- 照準とロックオンの印 (Canvas で描いたスプライト)
function reticleTexture(draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  draw(cv.getContext('2d'));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSprite(tex) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, fog: false }));
  s.renderOrder = 900;
  return s;
}

const LOCK_TEX = () => reticleTexture((g) => {
  g.strokeStyle = '#ff3030';
  g.lineWidth = 8;
  const c = 64, a = 46, b = 22;
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    g.beginPath();
    g.moveTo(c + sx * a, c + sy * b);
    g.lineTo(c + sx * a, c + sy * a);
    g.lineTo(c + sx * b, c + sy * a);
    g.stroke();
  }
  g.fillStyle = '#ff3030';
  g.beginPath();
  g.arc(c, c, 6, 0, Math.PI * 2);
  g.fill();
});

const AIM_TEX = () => reticleTexture((g) => {
  g.strokeStyle = 'rgba(120,255,160,0.9)';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(64, 64, 34, 0, Math.PI * 2);
  g.stroke();
  for (const [x0, y0, x1, y1] of [[64, 8, 64, 36], [64, 92, 64, 120], [8, 64, 36, 64], [92, 64, 120, 64]]) {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }
});

// ---- 敵のモデル (ローポリ。マテリアルは被弾時に光らせるため敵ごとに複製する)
const GEO = {
  fBody: new THREE.ConeGeometry(0.55, 3, 6).rotateX(Math.PI / 2), // 先端が +Z (プレイヤーの方) を向く
  fWing: new THREE.BoxGeometry(3.4, 0.12, 1.1),
  fFin: new THREE.BoxGeometry(0.12, 0.8, 0.8),
  fEye: new THREE.SphereGeometry(0.25, 8, 6),
  gBody: new THREE.BoxGeometry(4.5, 1.6, 5),
  gPod: new THREE.CylinderGeometry(0.7, 0.7, 4.5, 10).rotateX(Math.PI / 2),
  gEye: new THREE.SphereGeometry(0.6, 12, 8),
  gGun: new THREE.CylinderGeometry(0.18, 0.18, 2, 8).rotateX(Math.PI / 2),
  shot: new THREE.CylinderGeometry(0.06, 0.06, 3, 6).rotateX(Math.PI / 2),
  bullet: new THREE.SphereGeometry(0.4, 10, 8),
  ring: new THREE.TorusGeometry(0.75, 0.2, 8, 20),
  item: new THREE.OctahedronGeometry(1.1),
  itemHalo: new THREE.SphereGeometry(1.8, 16, 10),
  shell: new THREE.SphereGeometry(0.55, 10, 8),
  bulletHalo: new THREE.SphereGeometry(0.75, 10, 8),
  mBody: new THREE.CylinderGeometry(0.08, 0.08, 1.1, 8).rotateX(Math.PI / 2),
  mTip: new THREE.ConeGeometry(0.08, 0.3, 8).rotateX(-Math.PI / 2),
  mFin: new THREE.BoxGeometry(0.4, 0.02, 0.2),
  shadow: new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2),
};
const MAT = {
  shot: new THREE.MeshBasicMaterial({ color: 0x9ffcff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  bullet: new THREE.MeshBasicMaterial({ color: 0xffd040 }),
  ring: new THREE.MeshBasicMaterial({ color: 0xd060ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  shell: new THREE.MeshBasicMaterial({ color: 0xff8030 }),
  item: new THREE.MeshStandardMaterial({ color: 0x30ff80, emissive: 0x10a040, roughness: 0.2, metalness: 0.3, flatShading: true }),
  itemCross: new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
  itemHalo: new THREE.MeshBasicMaterial({ color: 0x40ff90, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }),
  bulletHalo: new THREE.MeshBasicMaterial({ color: 0xff5010, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
  missile: new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4 }),
  missileTip: new THREE.MeshStandardMaterial({ color: 0xd02020, roughness: 0.4 }),
  eye: new THREE.MeshBasicMaterial({ color: 0xff3020 }),
  shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
};

function makeFighter() {
  if (TPL.fighter) return instance(TPL.fighter);
  const mat = new THREE.MeshStandardMaterial({ color: 0x40444c, metalness: 0.5, roughness: 0.45, flatShading: true });
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x8a1c1c, metalness: 0.3, roughness: 0.5, flatShading: true });
  const g = new THREE.Group();
  const body = new THREE.Mesh(GEO.fBody, mat);
  const wing = new THREE.Mesh(GEO.fWing, wingMat);
  wing.position.z = -0.6;
  const fin = new THREE.Mesh(GEO.fFin, wingMat);
  fin.position.set(0, 0.45, -1.1);
  const eye = new THREE.Mesh(GEO.fEye, MAT.eye);
  eye.position.set(0, 0.3, 0.4);
  g.add(body, wing, fin, eye);
  return { mesh: g, mats: [mat, wingMat] };
}

function makeGunship() {
  if (TPL.gunship) return instance(TPL.gunship);
  const mat = new THREE.MeshStandardMaterial({ color: 0x5a5048, metalness: 0.6, roughness: 0.4, flatShading: true });
  const podMat = new THREE.MeshStandardMaterial({ color: 0x2a2e36, metalness: 0.7, roughness: 0.35, flatShading: true });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(GEO.gBody, mat));
  for (const sx of [-1, 1]) {
    const pod = new THREE.Mesh(GEO.gPod, podMat);
    pod.position.set(sx * 3, -0.2, 0);
    const gun = new THREE.Mesh(GEO.gGun, podMat);
    gun.position.set(sx * 3, -0.2, 3);
    g.add(pod, gun);
  }
  const eye = new THREE.Mesh(GEO.gEye, MAT.eye);
  eye.position.set(0, 0.2, 2.5);
  g.add(eye);
  return { mesh: g, mats: [mat, podMat] };
}

// 読み込み前に使う代わりの形
function fallback(color, r) {
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.6, flatShading: true });
  return { mesh: new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat), mats: [mat] };
}

// ---- Blender で作った敵のモデル (assets/enemies.glb)。読み込むまでは上の簡易モデルを使う
const TPL = {};
const WHITE = new THREE.Color(0xffffff), BLACK = new THREE.Color(0x000000), DUST = new THREE.Color(0.55, 0.5, 0.42);
const ITEM_COL = new THREE.Color(0.3, 1, 0.5);

// 部品を同じマテリアルごとに1つのメッシュへまとめる (描画回数を減らして VR でも軽くする)。
// parts に名前を渡した部品 (あご・耳・羽など動かすもの) は別にまとめ、同じ名前の子として元の位置に置く
function bake(root, parts = []) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const partNodes = parts.map((n) => root.getObjectByName(n)).filter(Boolean);
  const inPart = (o) => {
    for (let p = o; p && p !== root; p = p.parent) if (partNodes.includes(p)) return true;
    return false;
  };
  const byMat = new Map();
  root.traverse((o) => {
    if (!o.isMesh || inPart(o)) return;
    let g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (g.index) g = g.toNonIndexed();
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
  });
  const group = new THREE.Group();
  for (const [mat, geos] of byMat) {
    mat.flatShading = true;
    group.add(new THREE.Mesh(mergeGeometries(geos), mat));
  }
  for (const node of partNodes) {
    const sub = bake(node);
    sub.name = node.name;
    new THREE.Matrix4().multiplyMatrices(inv, node.matrixWorld).decompose(sub.position, sub.quaternion, sub.scale);
    sub.userData.base = sub.position.clone();
    group.add(sub);
  }
  return group;
}

// モデルの中の点 (空オブジェクト) の位置を、モデルの原点から見た座標で返す
function localPoint(root, name) {
  const node = root.getObjectByName(name);
  if (!node) return null;
  root.updateMatrixWorld(true);
  return node.getWorldPosition(new THREE.Vector3()).applyMatrix4(new THREE.Matrix4().copy(root.matrixWorld).invert());
}

export async function loadEnemyModels(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const models = {
    fighter: ['EnemyFighter'], gunship: ['EnemyGunship'], head: ['BossHead'], segment: ['BossSegment'], tail: ['BossTail'],
    moai: ['Moai', ['MoaiJaw']],
    gremlin: ['Gremlin', ['GremEarL', 'GremEarR', 'GremWingL', 'GremWingR']],
    mech: ['HeavyMech', ['MechEye']],
    pill: ['PillBug', ['PillSeg0', 'PillSeg1', 'PillSeg2']],
  };
  for (const [key, [name, parts]] of Object.entries(models)) {
    const node = gltf.scene.getObjectByName(name);
    if (node) TPL[key] = bake(node, parts);
  }
  const mech = gltf.scene.getObjectByName('HeavyMech');
  if (mech) TPL.mechMuzzle = localPoint(mech, 'MechMuzzle');
  // ダンゴムシの節を1つずつ (割れたあとに使う)
  TPL.pillSeg = [0, 1, 2].map((i) => {
    const n = gltf.scene.getObjectByName(`PillSeg${i}`);
    return n ? bake(n) : null;
  });
}

// モデルを複製する。マテリアルは被弾時に光らせるため敵ごとに複製し、元の発光色を覚えておく。
// モデルは -Z が前なので、内側で 180 度回して +Z (プレイヤーの方) を前にする
// yOff: モデルの原点が足元にあるものは、体の中心が原点になるよう下げる (当たり判定とロックの中心)
function instance(tpl, yOff = 0) {
  const inner = tpl.clone();
  inner.position.y = -yOff;
  const mats = [];
  inner.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.material.userData.base = o.material.emissive.clone();
    mats.push(o.material);
  });
  inner.rotation.y = Math.PI;
  const g = new THREE.Group();
  g.add(inner);
  return { mesh: g, mats };
}

export class Combat {
  constructor(scene) {
    this.scene = scene;
    this.enemies = [];
    this.bullets = [];
    this.shots = [];
    this.missiles = [];
    this.locks = [];
    this.lockT = 0;
    this.missileStock = MISSILE_MAX;
    this.regenT = 0;
    this.gunT = 0;
    this.gunSide = 0;
    this.spawn = { wave: 3 };
    this.time = 0;
    this.score = 0;
    this.kills = 0;
    this.level = 1;          // ステージ。上がるほど敵が多く、よく撃ってくる
    this.mult = 1;           // スコア倍率 (速く飛ぶほど上がる)
    this.boss = null;
    this.bossDefeated = false;
    this.announce = '';      // 画面に出したい知らせ (main.js が読んで消す)
    this.items = [];         // 回復アイテム
    this.itemT = 15;
    this.sparks = new Particles(scene, 1500, true);
    this.smoke = new Particles(scene, 2500, false);
    this.lockTex = LOCK_TEX();
    this.lockMarkers = Array.from({ length: LOCK_MAX }, () => {
      const s = makeSprite(this.lockTex);
      s.visible = false;
      scene.add(s);
      return s;
    });
    this.aim = makeSprite(AIM_TEX());
    this.aim.visible = false;
    scene.add(this.aim);
  }

  reset() {
    for (const list of [this.enemies, this.bullets, this.shots, this.missiles, this.items]) {
      list.forEach((o) => this.remove(o));
      list.length = 0;
    }
    this.itemT = 15;
    this.locks = [];
    this.missileStock = MISSILE_MAX;
    this.spawn = { wave: 3 };
    this.time = 0;
    this.score = 0;
    this.kills = 0;
    this.level = 1;
    this.boss = null;
    this.bossDefeated = false;
    this.sparks.clear();
    this.smoke.clear();
  }

  remove(o) {
    this.scene.remove(o.mesh);
    if (o.shadow) this.scene.remove(o.shadow);
    if (o.mats) o.mats.forEach((m) => m.dispose());
  }

  // ---- 出現
  spawnFighterWave(px, py) {
    const n = 4 + Math.floor(Math.random() * 3);
    const behind = Math.random() < 0.35; // 後ろから追い越してくる
    const w = rand(1.6, 2.8);
    for (let k = 0; k < n; k++) {
      const { mesh, mats } = makeFighter();
      mesh.scale.setScalar(FIGHTER_SCALE);
      const e = {
        kind: 'fighter', mesh, mats, r: 3.0, hp: 1, score: 100,
        t: k * 0.3, w, phase: k * 0.45, fireT: rand(1.5, 4), flash: 0,
        state: behind ? 'behind' : 'approach', z: behind ? 40 + k * 9 : SPAWN_Z - k * 9,
        ox: rand(-7, 7), oy: rand(3, 6), yaw: behind ? Math.PI : 0, jink: 0, jinkTo: 0, jinkT: rand(0.3, 1), lastX: px,
      };
      mesh.position.set(px + e.ox, py + e.oy, e.z);
      this.addEnemy(e, 1.8 * FIGHTER_SCALE);
    }
  }

  updateFighter(e, dt, scroll, ctx) {
    const p = e.mesh.position, P = ctx.player;
    if (e.state === 'behind') {
      // 後ろから頭の上を追い越して前へ抜け、遠くで U ターンする
      e.z -= 62 * dt;
      p.set(P.x + e.ox + Math.sin(e.t * 2.5) * 2, P.y + e.oy, e.z);
      if (e.z < -95) {
        e.state = 'turn';
        e.turnT = 0;
      }
    } else if (e.state === 'turn') {
      e.turnT += dt;
      const k = Math.min(1, e.turnT / 0.8);
      e.yaw = Math.PI * (1 - k);
      e.z -= 30 * (1 - k) * dt;
      p.z = e.z;
      p.y += 5 * (1 - k) * dt;
      if (k >= 1) e.state = 'approach';
    } else if (e.state === 'approach') {
      // 距離に関係なく画面の左右 30 度くらいまで振れるよう、角度で位置を決める
      e.z += (scroll * 0.6 + 38) * dt;
      const dist = Math.max(10, -e.z);
      e.jinkT -= dt;
      if (e.jinkT <= 0) {
        e.jinkT = rand(0.5, 1.3);
        e.jinkTo = rand(-0.35, 0.35); // 急な切り返し
      }
      e.jink += (e.jinkTo - e.jink) * Math.min(1, dt * 7);
      const ax = 0.5 * Math.sin(e.t * e.w + e.phase) + e.jink;
      const ay = 0.2 * Math.sin(e.t * e.w * 1.7 + e.phase);
      p.set(P.x + Math.tan(ax) * dist, Math.max(2, P.y + 1 + Math.tan(ay) * dist * 0.7), e.z);
      if (e.z > -16) {
        // 自機のすぐ横をかすめて後ろへ抜ける
        e.state = 'flyby';
        const side = Math.sign(p.x - P.x) || 1;
        e.passX = P.x + side * (e.r + 2.6);
        e.passY = P.y + rand(0.5, 2.5);
      }
    } else {
      e.z += (scroll * 0.6 + 48) * dt;
      p.x += (e.passX - p.x) * Math.min(1, dt * 6);
      p.y += (e.passY - p.y) * Math.min(1, dt * 6);
      p.z = e.z;
    }
    // 横に動いた分だけ機体を傾ける
    const vx = (p.x - e.lastX) / Math.max(dt, 1e-4);
    e.lastX = p.x;
    e.bank = (e.bank || 0) + (THREE.MathUtils.clamp(-vx * 0.03, -1.2, 1.2) - (e.bank || 0)) * Math.min(1, dt * 8);
    e.mesh.rotation.set(0, e.yaw, e.bank);
  }

  spawnGunship(px, py) {
    const { mesh, mats } = makeGunship();
    mesh.scale.setScalar(GUNSHIP_SCALE);
    const e = {
      kind: 'gunship', mesh, mats, r: 3.6 * GUNSHIP_SCALE, hp: 6 + this.level * 2, score: 1000,
      t: 0, x: px + rand(-6, 6), y: THREE.MathUtils.clamp(py + rand(1, 5), 4, 12), z: SPAWN_Z,
      hover: 0, fireT: 2, flash: 0,
    };
    this.addEnemy(e, 3.5 * GUNSHIP_SCALE);
  }

  // 出す敵の群れを重み付きで選ぶ。重いもの (ガンシップ・重モビルスーツ) は同時に出しすぎない
  spawnWave(px, py) {
    const heavy = this.enemies.filter((e) => e.kind === 'gunship' || e.kind === 'mech').length;
    const table = [
      ['fighter', 3], ['gremlin', 2.2], ['pill', 2], ['moai', 1.6],
      ['mech', heavy === 0 ? 1.3 : 0], ['gunship', heavy < 2 ? 1 : 0],
    ];
    let r = Math.random() * table.reduce((a, [, w]) => a + w, 0);
    const kind = this.forceWave || table.find(([, w]) => (r -= w) < 0)?.[0] || 'fighter';
    ({
      fighter: () => this.spawnFighterWave(px, py),
      gunship: () => this.spawnGunship(px, py),
      gremlin: () => this.spawnGremlins(px, py),
      pill: () => this.spawnPills(px),
      moai: () => this.spawnMoai(px),
      mech: () => this.spawnMechTrio(px),
    })[kind]();
  }

  // モアイ風の石像: 地面に立ち、口を開けてリングを吐く (左右に2体並ぶことが多い)
  spawnMoai(px) {
    const xs = Math.random() < 0.6 ? [px - rand(7, 11), px + rand(7, 11)] : [px + rand(-9, 9)];
    for (const [i, x] of xs.entries()) {
      const made = TPL.moai ? instance(TPL.moai, 3) : fallback(0x6b625a, 2.6);
      const e = { kind: 'moai', ...made, r: 3 * MOAI_SCALE, hp: 10 + this.level * 2, score: 800, t: 0, fireT: rand(1, 2.5) + i * 0.6, mouth: 0, flash: 0 };
      e.mesh.scale.setScalar(MOAI_SCALE);
      e.mesh.position.set(x, 3 * MOAI_SCALE, SPAWN_Z - i * 10);
      e.jaw = e.mesh.getObjectByName('MoaiJaw');
      this.addEnemy(e, 2.4 * MOAI_SCALE);
    }
  }

  // グレムリン風の小鬼: 小さくてすばしこい。ジグザグに跳ね回り、近くで体当たりしてくる
  spawnGremlins(px, py) {
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const made = TPL.gremlin ? instance(TPL.gremlin) : fallback(0x337a28, 0.8);
      const e = {
        kind: 'gremlin', ...made, r: 1.1 * GREMLIN_SCALE * 0.75, hp: 2, score: 300, t: rand(0, 3), flash: 0, fireT: Infinity,
        cx: px + rand(-12, 12), cy: THREE.MathUtils.clamp(py + rand(-1, 4), 1.5, 10), z: SPAWN_Z - k * 6, dash: null,
      };
      e.parts = ['GremEarL', 'GremEarR', 'GremWingL', 'GremWingR'].map((n2) => e.mesh.getObjectByName(n2)).filter(Boolean);
      e.mesh.scale.setScalar(GREMLIN_SCALE);
      this.addEnemy(e, 0.9 * GREMLIN_SCALE * 0.6);
    }
  }

  // 重モビルスーツの3機編隊: 縦一列で突っ込んできて、先頭から順に撃っては左右上へ散る (ジェットストリームアタック)
  spawnMechTrio(px) {
    const group = { phase: 'approach', lane: px, at: 0 };
    for (let role = 0; role < 3; role++) {
      const made = TPL.mech ? instance(TPL.mech, 3) : fallback(0x4a2a6a, 2.8);
      const e = {
        kind: 'mech', ...made, r: 3.2 * MECH_SCALE, hp: 10 + this.level * 3, score: 1500, t: role * 0.4, flash: 0, fireT: Infinity,
        role, group, z: SPAWN_Z - role * 9, off: new THREE.Vector2(), offTo: new THREE.Vector2(), fired: 0, dustT: 0,
      };
      e.mesh.scale.setScalar(MECH_SCALE);
      e.mesh.position.set(px, 3.3 * MECH_SCALE, e.z);
      e.eye = e.mesh.getObjectByName('MechEye');
      this.addEnemy(e, 2.6 * MECH_SCALE);
    }
  }

  // ダンゴムシ: 丸まって地面を転がってくる。撃つと3つの節に割れて、それぞれが追いかけてくる
  spawnPills(px) {
    const n = 2 + Math.floor(Math.random() * 2);
    for (let k = 0; k < n; k++) {
      const made = TPL.pill ? instance(TPL.pill) : fallback(0x40485a, 1.5);
      const e = { kind: 'pill', ...made, r: 1.8 * PILL_SCALE, hp: 4 + this.level, score: 400, t: rand(0, 3), flash: 0, fireT: Infinity, x: px + rand(-10, 10) };
      e.mesh.scale.setScalar(PILL_SCALE);
      e.mesh.position.set(e.x, 1.5 * PILL_SCALE, SPAWN_Z - k * 14);
      this.addEnemy(e, 1.6 * PILL_SCALE);
    }
  }

  splitPill(e) {
    const segs = [0, 1, 2].map((i) => e.mesh.getObjectByName(`PillSeg${i}`));
    for (let i = 0; i < 3; i++) {
      const made = TPL.pillSeg?.[i] ? instance(TPL.pillSeg[i]) : fallback(0x40485a, 0.9);
      const part = { kind: 'pillpart', ...made, r: 1.1 * PILL_SCALE, hp: 2, score: 200, t: 0, flash: 0, fireT: Infinity };
      part.mesh.scale.setScalar(PILL_SCALE);
      if (segs[i]) segs[i].getWorldPosition(part.mesh.position);
      else part.mesh.position.copy(e.mesh.position);
      part.mesh.quaternion.copy(e.mesh.quaternion);
      part.vel = new THREE.Vector3((i - 1) * 11 + rand(-2, 2), rand(6, 10), rand(-4, 4));
      part.spin = new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6));
      this.addEnemy(part, 0.9);
    }
  }

  // 3機編隊の動き。approach: 縦一列でプレイヤーの列へ寄せながら突っ込む
  // → attack: 先頭から 0.7 秒ずつずらして撃ち、上・右・左へ散る → retreat: 下がって去る
  updateMech(e, dt, scroll, ctx) {
    const G = e.group, p = e.mesh.position;
    const alive = this.enemies.filter((o) => o.group === G && !o.dead);
    const leader = alive[0] === e; // 先頭が落とされたら、次の機体が先頭になる
    if (G.phase === 'approach') {
      if (leader) {
        G.lane += THREE.MathUtils.clamp(ctx.player.x - G.lane, -7 * dt, 7 * dt);
        if (p.z > -55) {
          G.phase = 'attack';
          G.at = 0;
          this.announce = 'JET STREAM ATTACK!';
        }
      }
      e.z += (scroll * 0.5 + 46) * dt;
    } else if (G.phase === 'attack') {
      if (leader) G.at += dt;
      e.z = Math.min(e.z + (scroll * 0.5 + 30) * dt, -20 - e.role * 7);
      const local = G.at - e.role * 0.7;
      if (local >= 0 && e.fired === 0) {
        e.fired = 1;
        this.fireMechShell(e, ctx);
        // 1機目は上、2機目は右、3機目は左へ散る
        e.offTo.set([0, 14, -14][e.role], [9, 1, 1][e.role]);
      }
      if (local >= 1.3 && e.fired === 1) {
        e.fired = 2;
        this.fireMechShell(e, ctx);
      }
      if (leader && G.at > 4.5) G.phase = 'retreat';
    } else {
      e.z -= 32 * dt;
      e.offTo.y = 4;
      if (e.z < SPAWN_Z) e.dead = true;
    }
    e.off.lerp(e.offTo, Math.min(1, dt * 6));
    p.set(G.lane + e.off.x, 3.3 * MECH_SCALE + e.off.y + Math.sin(e.t * 2) * 0.15, e.z);
    e.mesh.rotation.y = Math.atan2(ctx.player.x - p.x, ctx.player.z - p.z) * 0.7;
    e.mesh.rotation.z = THREE.MathUtils.clamp((e.offTo.x - e.off.x) * -0.04, -0.3, 0.3);
    if (e.eye) e.eye.position.x = e.eye.userData.base.x + Math.sin(e.t * 2.5) * 0.4;
    // スカートの下から砂ぼこり (地面の近くにいるときだけ)
    e.dustT -= dt;
    if (e.dustT <= 0 && p.y < 8) {
      e.dustT = 0.06;
      this.smoke.emit(_b.set(p.x + rand(-1.5, 1.5), 0.3, p.z + rand(-1.5, 1.5)), _c.set(rand(-3, 3), 1, rand(-3, 3)), DUST, 1.4, 0.8, 2.5, 0.95);
    }
  }

  fireMechShell(e, ctx) {
    if (!ctx.active) return;
    const p = e.mesh.position;
    const muzzle = TPL.mechMuzzle
      ? _b.set(-TPL.mechMuzzle.x, TPL.mechMuzzle.y - 3, -TPL.mechMuzzle.z).multiplyScalar(MECH_SCALE).applyQuaternion(e.mesh.quaternion).add(p)
      : _b.copy(p).add(_c.set(2, 1, 2));
    this.fireBullet(muzzle.clone(), ctx.player, 0, 'shell');
  }

  // ---- 回復アイテム: 光る緑の結晶。通り抜けると取れる (近づくと吸い寄せられる)
  spawnItem(pos) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(GEO.item, MAT.item));
    const cross = new THREE.Group();
    for (const [w, h] of [[0.9, 0.28], [0.28, 0.9]]) cross.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), MAT.itemCross));
    g.add(cross);
    g.add(new THREE.Mesh(GEO.itemHalo, MAT.itemHalo));
    g.position.copy(pos);
    g.position.y = Math.max(2, pos.y);
    this.scene.add(g);
    this.items.push({ mesh: g, cross, t: 0, y: g.position.y });
  }

  updateItems(dt, scroll, ctx) {
    if (ctx.spawn) {
      this.itemT -= dt;
      if (this.itemT <= 0) {
        this.itemT = rand(18, 26);
        this.spawnItem(_a.set(ctx.player.x + rand(-8, 8), THREE.MathUtils.clamp(ctx.player.y + rand(-2, 3), 2, 9), SPAWN_Z * 0.8));
      }
    }
    for (const it of this.items) {
      it.t += dt;
      const p = it.mesh.position;
      p.z += scroll * dt;
      const d = p.distanceTo(ctx.player);
      if (d < 7) p.lerp(ctx.player, Math.min(1, dt * 4)); // 近づくと吸い寄せられる
      else p.y = it.y + Math.sin(it.t * 3) * 0.4;
      it.mesh.rotation.y += dt * 2.5;
      it.cross.lookAt(ctx.eye);
      it.mesh.scale.setScalar(1 + Math.sin(it.t * 8) * 0.08);
      if (d < 2.2 + ctx.playerR) {
        it.dead = true;
        ctx.onPickup?.('heal');
        const v = new THREE.Vector3();
        for (let i = 0; i < 30; i++) this.sparks.emit(p, v.randomDirection().multiplyScalar(rand(4, 10)), ITEM_COL, 0.8, 0.5);
      } else if (p.z > REMOVE_Z) it.dead = true;
    }
  }

  addEnemy(e, shadowR) {
    e.shadow = new THREE.Mesh(GEO.shadow, MAT.shadow);
    e.shadow.scale.setScalar(shadowR);
    this.scene.add(e.mesh, e.shadow);
    this.enemies.push(e);
  }

  // ---- ボス: 機械の大蛇。頭のうしろに胴体の節がつながり、頭を追ってうねる
  spawnBoss() {
    const lv = this.level;
    const n = 10 + lv * 2;
    const b = { parts: [], hp: 300 + lv * 100, maxHp: 300 + lv * 100, t: 0, fireT: 3, segFireT: 2, dying: -1, exploded: 0, lungeT: 9, lunge: 0 };
    const add = (tpl, fallbackR, r, isHead) => {
      let made;
      if (tpl) made = instance(tpl);
      else {
        const mat = new THREE.MeshStandardMaterial({ color: isHead ? 0x9a1c1c : 0x40444c, metalness: 0.5, roughness: 0.4, flatShading: true });
        made = { mesh: new THREE.Mesh(new THREE.IcosahedronGeometry(fallbackR, 1), mat), mats: [mat] };
      }
      made.mesh.scale.setScalar(BOSS_SCALE);
      r *= BOSS_SCALE;
      const e = { kind: 'boss', boss: b, isHead, mesh: made.mesh, mats: made.mats, r, hp: Infinity, score: 0, flash: 0, fireT: Infinity };
      e.mesh.position.set(0, 8, SPAWN_Z - b.parts.length * 3);
      this.addEnemy(e, r * 1.2);
      b.parts.push(e);
    };
    add(TPL.head, 2.2, 2.6, true);
    for (let i = 0; i < n; i++) add(TPL.segment, 1.4, 1.6, false);
    add(TPL.tail, 1.1, 1.3, false);
    this.boss = b;
    this.bossDefeated = false;
  }

  get bossRatio() { return this.boss ? Math.max(0, this.boss.hp / this.boss.maxHp) : null; }

  updateBoss(dt, ctx) {
    const b = this.boss;
    if (!b) return;
    b.t += dt;
    const t = b.t;
    // 倒したら、頭からしっぽへ順に爆発させる
    if (b.dying >= 0) {
      b.dying += dt;
      while (b.exploded < b.parts.length && b.dying > b.exploded * 0.11) {
        const part = b.parts[b.exploded++];
        this.explode(part.mesh.position, true);
        part.dead = true;
      }
      if (b.exploded >= b.parts.length && b.dying > b.parts.length * 0.11 + 0.8) {
        this.boss = null;
        this.bossDefeated = true;
      }
      return;
    }
    const head = b.parts[0];
    const target = _d.set(
      ctx.player.x * 0.4 + 18 * Math.sin(t * 0.62),
      THREE.MathUtils.clamp(ctx.player.y + 2 + 5 * Math.sin(t * 1.3), 3, 16),
      -30 + 8 * Math.sin(t * 0.41),
    );
    if (t < 5) target.z = THREE.MathUtils.lerp(-200, target.z, t / 5); // 遠くから迫ってくる
    // 噛みつき: ときどき目の前まで突っ込んでくる
    b.lungeT -= dt;
    if (b.lungeT <= 0 && t > 6) {
      b.lungeT = rand(6, 9);
      b.lunge = 1.2;
      sfx.whoosh();
    }
    if (b.lunge > 0) {
      b.lunge -= dt;
      target.set(ctx.player.x + 4, ctx.player.y + 1.5, -10);
    }
    head.mesh.position.lerp(target, 1 - Math.exp(-dt * (b.lunge > 0 ? 3.5 : 2.6)));
    head.mesh.lookAt(ctx.player);
    // 胴体: 前の節から一定の距離を保ってついていく。少し後ろへ流してうねりを出す
    let prev = head;
    for (let i = 1; i < b.parts.length; i++) {
      const part = b.parts[i];
      const pos = part.mesh.position;
      pos.z -= 16 * dt;
      const d = _a.subVectors(pos, prev.mesh.position);
      const len = d.length() || 1;
      pos.copy(prev.mesh.position).addScaledVector(d, ((prev.r + part.r) * 0.75) / len);
      part.mesh.lookAt(prev.mesh.position);
      prev = part;
    }
    if (!ctx.active || t < 5) return;
    // 攻撃: 頭から扇形に撃つ。体力が半分を切ると、胴体からも撃ってくる
    const hp = head.mesh.position;
    b.fireT -= dt;
    if (b.fireT <= 0) {
      b.fireT = Math.max(0.7, 1.6 - this.level * 0.12);
      const n = b.hp < b.maxHp * 0.5 ? 5 : 3;
      const from = _c.copy(hp).add(_b.set(0, -0.5, 2.5));
      for (let k = 0; k < n; k++) this.fireBullet(from, ctx.player, (k - (n - 1) / 2) * 0.13);
    }
    if (b.hp < b.maxHp * 0.5) {
      b.segFireT -= dt;
      if (b.segFireT <= 0) {
        b.segFireT = Math.max(0.35, 0.9 - this.level * 0.08);
        const part = b.parts[1 + Math.floor(Math.random() * (b.parts.length - 1))];
        this.fireBullet(part.mesh.position, ctx.player);
      }
    }
  }

  // ---- 発射
  fireGun(origin, target) {
    const dir = _d.subVectors(target, origin).normalize();
    const m = new THREE.Mesh(GEO.shot, MAT.shot);
    m.position.copy(origin);
    m.lookAt(_a.copy(origin).add(dir));
    this.scene.add(m);
    this.shots.push({ mesh: m, pos: origin.clone(), prev: origin.clone(), vel: dir.clone().multiplyScalar(GUN_SPEED), life: 1.1 });
  }

  fireMissiles(origin, forward) {
    if (this.missileStock <= 0) return 0;
    const targets = this.locks.length ? [...this.locks] : [null];
    let n = 0;
    for (const [i, target] of targets.entries()) {
      if (this.missileStock <= 0) break;
      this.missileStock--;
      const g = new THREE.Group();
      g.add(new THREE.Mesh(GEO.mBody, MAT.missile));
      const tip = new THREE.Mesh(GEO.mTip, MAT.missileTip);
      tip.position.z = -0.7;
      g.add(tip);
      for (const rz of [0, Math.PI / 2]) {
        const fin = new THREE.Mesh(GEO.mFin, MAT.missileTip);
        fin.rotation.z = rz;
        fin.position.z = 0.45;
        g.add(fin);
      }
      // 左右交互に、機体から少し落としてから点火する
      const side = (i % 2 ? 1 : -1) * (0.6 + 0.3 * Math.floor(i / 2));
      const pos = origin.clone().add(new THREE.Vector3(side, -0.6, 0));
      const vel = forward.clone().multiplyScalar(28).add(new THREE.Vector3(side * 3, -3, 0));
      g.position.copy(pos);
      this.scene.add(g);
      this.missiles.push({ mesh: g, pos, vel, target, age: -i * 0.06, life: 5, puffT: 0 });
      n++;
    }
    this.locks = [];
    if (n) sfx.missile();
    return n;
  }

  // type: 'orb' (光る弾)、'ring' (モアイのリング、遅いが大きい)、'shell' (バズーカ、煙を引く)
  fireBullet(from, at, spread = 0, type = 'orb') {
    const dir = _d.subVectors(at, from).normalize();
    if (spread) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
    let m, speed = 34, r = 0.45;
    if (type === 'ring') {
      m = new THREE.Mesh(GEO.ring, MAT.ring);
      speed = 22;
      r = 0.9;
    } else if (type === 'shell') {
      m = new THREE.Mesh(GEO.shell, MAT.shell);
      m.add(new THREE.Mesh(GEO.bulletHalo, MAT.bulletHalo));
      speed = 27;
      r = 0.7;
    } else {
      m = new THREE.Mesh(GEO.bullet, MAT.bullet);
      m.add(new THREE.Mesh(GEO.bulletHalo, MAT.bulletHalo));
    }
    m.position.copy(from);
    m.lookAt(_a.copy(from).add(dir));
    this.scene.add(m);
    this.bullets.push({ mesh: m, vel: dir.clone().multiplyScalar(speed), r, life: 9, type, puffT: 0 });
    sfx.enemyShot();
  }

  // ---- 爆発
  explode(p, big = false) {
    const n = big ? 120 : 45;
    const hot = new THREE.Color(), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.randomDirection().multiplyScalar(rand(4, big ? 26 : 16));
      hot.setHSL(rand(0.03, 0.13), 1, rand(0.5, 0.7));
      this.sparks.emit(p, v, hot, rand(0.6, big ? 2.2 : 1.4), rand(0.4, 0.9), 0, 0.92);
    }
    const grey = new THREE.Color();
    for (let i = 0; i < (big ? 30 : 12); i++) {
      v.randomDirection().multiplyScalar(rand(1, 5));
      grey.setScalar(rand(0.2, 0.4));
      this.smoke.emit(p, v, grey, rand(1.5, 3), rand(1, 1.8), 3, 0.95);
    }
    sfx.explode(big);
  }

  damage(e, amount) {
    e.flash = 0.08;
    if (e.kind === 'boss') {
      const b = e.boss;
      if (b.dying >= 0) return;
      b.hp -= amount * (e.isHead ? 1.5 : 0.5); // 頭が弱点。胴体の節は硬い
      sfx.hit();
      if (b.hp <= 0) {
        b.dying = 0;
        this.score += Math.round(10000 * this.level * this.mult);
        this.kills++;
        sfx.explode(true);
      }
      return;
    }
    e.hp -= amount;
    if (e.hp > 0) {
      sfx.hit();
      return;
    }
    e.dead = true;
    this.score += Math.round(e.score * this.mult);
    this.kills++;
    this.explode(e.mesh.position, e.kind === 'gunship' || e.kind === 'mech' || e.kind === 'moai');
    if (e.kind === 'pill') this.splitPill(e);
    if (['gunship', 'mech', 'moai'].includes(e.kind) && Math.random() < 0.35) this.spawnItem(e.mesh.position);
  }

  // ---- 毎フレーム
  // ctx: { dt, scroll, spawn (新しい敵を出すか), active (敵に攻撃させるか), player: Vector3 (当たり判定の中心), playerR, eye, world,
  //        aimOrigin / aimDir (ロックオンの向き), guns: [{ origin, aimOrigin, aimDir }], firing,
  //        missile (押した瞬間), missileOrigin, showAim, halfHeight, onPlayerHit }
  update(ctx) {
    const { dt, scroll } = ctx;
    this.time += dt;

    // 出現
    if (ctx.spawn) {
      this.spawn.wave -= dt;
      if (this.spawn.wave <= 0) {
        this.spawn.wave = rand(3.5, 5.5) / (1 + (this.level - 1) * 0.15);
        this.spawnWave(ctx.player.x, ctx.player.y);
      }
    }
    this.updateBoss(dt, ctx);
    this.updateItems(dt, scroll, ctx);

    // 敵の動き
    for (const e of this.enemies) {
      e.t += dt;
      const p = e.mesh.position;
      if (e.kind === 'boss') {
        // updateBoss で動かす
      } else if (e.kind === 'moai') {
        p.z += scroll * dt; // 地面と一緒に流れてくる
        e.mesh.rotation.y = Math.atan2(ctx.player.x - p.x, ctx.player.z - p.z); // こちらを向く
        e.mouth = Math.max(0, e.mouth - dt * 1.5);
        if (e.jaw) e.jaw.rotation.x = -0.6 * Math.min(1, e.mouth * 2);
      } else if (e.kind === 'gremlin') {
        if (e.dash) {
          p.addScaledVector(e.dash, dt);
        } else {
          e.z += (scroll * 0.5 + 34) * dt;
          // ジグザグ (三角波) に、画面の左右いっぱいまで跳ねる
          const dist = Math.max(10, -e.z);
          const tri = (2 / Math.PI) * Math.asin(Math.sin(e.t * 4.4));
          const hop = Math.abs(Math.sin(e.t * 6.5)) * 4;
          p.set(ctx.player.x + (e.cx - ctx.player.x) * 0.3 + tri * dist * 0.5, Math.max(2, e.cy + hop), e.z);
          if (p.z > -38 && Math.random() < dt * 1.2) {
            e.dash = _a.subVectors(ctx.player, p).normalize().multiplyScalar(62).clone();
            sfx.hit();
          }
        }
        e.mesh.rotation.y = Math.sin(e.t * 5) * 0.4;
        for (const part of e.parts) {
          const wing = part.name.includes('Wing');
          const sign = part.name.endsWith('L') ? -1 : 1;
          part.rotation.z = sign * Math.sin(e.t * (wing ? 22 : 9)) * (wing ? 0.7 : 0.25);
        }
      } else if (e.kind === 'mech') {
        this.updateMech(e, dt, scroll, ctx);
      } else if (e.kind === 'pill') {
        p.z += (scroll + 24) * dt; // 地面より速く転がってくる
        // ジグザグに転がりながら、プレイヤーの列へ寄ってくる
        const want = ctx.player.x + Math.sin(e.t * 2.2) * Math.max(4, -p.z * 0.35);
        e.x += THREE.MathUtils.clamp(want - e.x, -16 * dt, 16 * dt);
        p.set(e.x, 1.5 * PILL_SCALE, p.z);
        e.mesh.rotation.x -= ((scroll + 24) / (1.5 * PILL_SCALE)) * dt;
      } else if (e.kind === 'pillpart') {
        // 割れた節: はじけ飛んだあと、プレイヤーへ向かってくる
        const want = _a.subVectors(ctx.player, p).normalize().multiplyScalar(40);
        e.vel.lerp(want, Math.min(1, dt * (e.t > 0.5 ? 2.4 : 0.2)));
        e.vel.y -= (e.t < 0.6 ? 14 : 0) * dt;
        p.addScaledVector(e.vel, dt);
        p.z += scroll * 0.3 * dt;
        if (p.y < 1) p.y = 1;
        e.mesh.rotation.x += e.spin.x * dt;
        e.mesh.rotation.y += e.spin.y * dt;
        e.mesh.rotation.z += e.spin.z * dt;
      } else if (e.kind === 'fighter') {
        this.updateFighter(e, dt, scroll, ctx);
      } else if (e.kind === 'gunship') {
        if (e.hover < 7) {
          e.z = Math.min(-40, e.z + (scroll * 0.5 + 26) * dt);
          if (e.z >= -40) e.hover += dt;
          p.set(ctx.player.x * 0.3 + e.x * 0.7 + Math.sin(e.t * 0.9) * 14, e.y + Math.sin(e.t * 1.6) * 3, e.z);
        } else {
          // 去っていく (上昇しながら遠ざかる)
          p.y += 9 * dt;
          p.z -= 25 * dt;
          if (p.y > 45) e.dead = true;
        }
        e.mesh.rotation.z = Math.sin(e.t * 0.7) * 0.15;
      }
      if (p.z > REMOVE_Z) e.dead = true;
      e.shadow.position.set(p.x, 0.05, p.z);
      if (!e.whooshed && e.kind !== 'boss' && p.distanceTo(ctx.eye) < e.r + 9) {
        e.whooshed = true;
        sfx.whoosh();
      }

      // 被弾したら一瞬白く光らせる
      e.flash -= dt;
      for (const m of e.mats) m.emissive.copy(e.flash > 0 ? WHITE : m.userData.base || BLACK);

      // 敵の攻撃
      e.fireT -= dt;
      if (ctx.active && e.kind !== 'boss' && e.fireT <= 0 && p.z > -170 && p.z < -35) {
        const lv = 1 + (this.level - 1) * 0.2;
        if (e.kind === 'fighter') {
          e.fireT = rand(3, 6) / lv;
          if (Math.random() < 0.5) this.fireBullet(p, ctx.player);
        } else if (e.kind === 'moai') {
          // 口を開けてリングを吐く
          e.fireT = rand(2.2, 3.2) / lv;
          e.mouth = 1;
          const mouth = _b.set(0, -0.9, 1.6).multiplyScalar(MOAI_SCALE).applyQuaternion(e.mesh.quaternion).add(p);
          this.fireBullet(mouth.clone(), ctx.player, 0, 'ring');
        } else if (e.kind === 'gunship') {
          e.fireT = 1.6;
          for (const sp of [-0.12, 0, 0.12]) this.fireBullet(_b.copy(p).add(_c.set(0, -0.2, 3)), ctx.player, sp);
        }
      }
      if (!e.dead && p.distanceTo(ctx.player) < e.r + ctx.playerR) {
        ctx.onPlayerHit(e.kind === 'boss' ? 30 : 25);
        // 体当たりしてくる敵は、ぶつかったら自分も爆発する
        if (e.kind === 'gremlin' || e.kind === 'pillpart' || e.kind === 'pill') {
          e.dead = true;
          this.explode(p);
        }
      }
    }

    // 敵弾
    for (const b of this.bullets) {
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      if (b.type === 'ring') {
        b.mesh.rotateZ(dt * 6);
        b.mesh.scale.setScalar(1 + Math.sin(this.time * 12) * 0.12);
      } else {
        b.mesh.scale.setScalar(1 + Math.sin(this.time * 30) * 0.15);
      }
      if (b.type === 'shell' && (b.puffT -= dt) <= 0) {
        b.puffT = 0.03;
        this.smoke.emit(b.mesh.position, _c.set(0, 0, 0), DUST, 0.8, 0.7, 2, 0.98);
      }
      if (b.life <= 0 || b.mesh.position.z > REMOVE_Z) b.dead = true;
      else if (b.mesh.position.distanceTo(ctx.player) < b.r + ctx.playerR) {
        b.dead = true;
        ctx.onPlayerHit(b.type === 'shell' ? 20 : b.type === 'ring' ? 18 : 12);
      }
    }

    // 機関砲
    this.gunT -= dt;
    if (ctx.firing && ctx.guns?.length && this.gunT <= 0) {
      this.gunT = 0.085;
      // 銃ごとに { origin: 銃口, aimOrigin / aimDir: 狙う向き }。銃口から照準の 90m 先へ撃つ
      const g = ctx.guns[this.gunSide++ % ctx.guns.length];
      // 照準の近くに敵がいれば、その敵へ向ける (エイムアシスト)
      const near = this.nearestInCone(g.aimOrigin, g.aimDir, 0.08);
      const aimAt = near ? near.mesh.position.clone() : g.aimOrigin.clone().addScaledVector(g.aimDir, 90);
      this.fireGun(g.origin, aimAt);
      sfx.shot();
    }
    for (const s of this.shots) {
      s.prev.copy(s.pos);
      s.pos.addScaledVector(s.vel, dt);
      s.mesh.position.copy(s.pos);
      s.life -= dt;
      if (s.life <= 0) { s.dead = true; continue; }
      for (const b of this.bullets) {
        if (!b.dead && segHit(s.prev, s.pos, b.mesh.position, b.r + 0.3)) {
          b.dead = s.dead = true;
          this.score += 10;
          this.explode(b.mesh.position);
          break;
        }
      }
      if (s.dead) continue;
      for (const e of this.enemies) {
        if (!e.dead && segHit(s.prev, s.pos, e.mesh.position, e.r)) {
          s.dead = true;
          this.damage(e, 1);
          break;
        }
      }
      if (s.dead || !ctx.world) continue;
      for (const o of ctx.world.obstacles) {
        if (o.dead) continue;
        const op = o.group.position;
        const c = _d.set(op.x, o.kind === 'bush' ? o.cy : THREE.MathUtils.clamp(s.pos.y, 0, o.h), op.z);
        if (!segHit(s.prev, s.pos, c, o.r)) continue;
        s.dead = true;
        if (o.kind === 'bush') {
          o.dead = true;
          this.score += Math.round(50 * this.mult);
          this.explode(c);
        } else {
          this.sparks.emit(c, _b.set(0, 2, 2), WHITE, 0.6, 0.15);
        }
        break;
      }
    }

    // ロックオン: 照準の近くの敵を順番にロックする
    this.locks = this.locks.filter((e) => !e.dead && e.mesh.position.z < ctx.aimOrigin.z - 6
      && _a.subVectors(e.mesh.position, ctx.aimOrigin).angleTo(ctx.aimDir) < UNLOCK_ANGLE);
    this.lockT -= dt;
    if (ctx.active && this.lockT <= 0 && this.locks.length < LOCK_MAX && this.missileStock > this.locks.length) {
      const cand = this.nearestInCone(ctx.aimOrigin, ctx.aimDir, LOCK_ANGLE, this.locks);
      if (cand) {
        this.locks.push(cand);
        this.lockT = LOCK_INTERVAL;
        sfx.lock();
      }
    }

    // ミサイル
    if (ctx.missile) this.fireMissiles(ctx.missileOrigin || ctx.player, ctx.aimDir);
    this.regenT += dt;
    if (this.missileStock >= MISSILE_MAX) this.regenT = 0;
    else if (this.regenT >= MISSILE_REGEN) {
      this.regenT = 0;
      this.missileStock++;
    }
    const smokeCol = new THREE.Color(0.75, 0.75, 0.78), fireCol = new THREE.Color(1, 0.6, 0.2), zero = new THREE.Vector3();
    for (const m of this.missiles) {
      m.age += dt;
      m.life -= dt;
      const ignited = m.age > 0.16;
      if (ignited) {
        const speed = Math.min(190, m.vel.length() + 160 * dt);
        const dir = _a.copy(m.vel).normalize();
        if (m.target && !m.target.dead) {
          const want = _b.subVectors(m.target.mesh.position, m.pos).normalize();
          dir.lerp(want, Math.min(1, dt * 8)).normalize();
        }
        if (m.pos.y < 1.2 && dir.y < 0.15) dir.y = 0.15; // 地面に刺さらないよう上へ逃がす
        m.vel.copy(dir).multiplyScalar(speed);
        // 煙と炎
        m.puffT -= dt;
        while (m.puffT <= 0) {
          m.puffT += 0.012;
          this.smoke.emit(m.pos, zero, smokeCol, 0.5, 1.1, 2.2, 0.98);
          this.sparks.emit(m.pos, zero, fireCol, 0.45, 0.07, 0, 1);
        }
      } else {
        m.vel.y -= 9.8 * dt; // 点火までは落ちる
      }
      m.pos.addScaledVector(m.vel, dt);
      m.mesh.position.copy(m.pos);
      m.mesh.lookAt(_c.copy(m.pos).add(m.vel));
      m.mesh.rotateY(Math.PI); // モデルは -Z が先端なので向きを合わせる
      if (m.target && !m.target.dead && m.pos.distanceTo(m.target.mesh.position) < m.target.r + 1) {
        m.dead = true;
        this.damage(m.target, 4);
        this.explode(m.pos);
      } else if (m.life <= 0 || m.pos.y < -0.5) {
        m.dead = true;
        this.explode(m.pos);
      }
    }

    // 片付け
    for (const key of ['enemies', 'bullets', 'shots', 'missiles', 'items']) {
      const list = this[key];
      if (list.some((o) => o.dead)) {
        this[key] = list.filter((o) => {
          if (o.dead) this.remove(o);
          return !o.dead;
        });
      }
    }

    // 照準とロックの印 (距離に比例して大きくし、見た目の大きさを一定にする)
    this.aim.visible = !!ctx.showAim;
    if (ctx.showAim) {
      this.aim.position.copy(ctx.aimOrigin).addScaledVector(ctx.aimDir, 60);
      this.aim.scale.setScalar(60 * 0.06);
    }
    this.lockMarkers.forEach((s, i) => {
      const e = this.locks[i];
      s.visible = !!e;
      if (!e) return;
      s.position.copy(e.mesh.position);
      const d = e.mesh.position.distanceTo(ctx.eye);
      s.scale.setScalar(Math.max(e.r * 2.4, d * 0.07));
      s.material.rotation = -this.time * 3;
    });

    this.sparks.update(dt, scroll * 0.5, ctx.halfHeight);
    this.smoke.update(dt, scroll * 0.8, ctx.halfHeight);
  }

  // 円錐 (aimDir から angle 以内) の中で、いちばん中心に近い敵
  nearestInCone(origin, dir, angle, exclude = []) {
    let best = null, bestA = angle;
    for (const e of this.enemies) {
      if (e.dead || exclude.includes(e)) continue;
      const v = _c.subVectors(e.mesh.position, origin);
      if (v.z > -8 || v.length() > 220) continue;
      const a = v.angleTo(dir);
      if (a < bestA) {
        bestA = a;
        best = e;
      }
    }
    return best;
  }
}

export { MISSILE_MAX };
