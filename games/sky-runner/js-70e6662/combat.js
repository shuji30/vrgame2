// 戦闘: 敵、敵弾、自機の機関砲、ロックオン、追尾ミサイル、爆発と煙
import * as THREE from 'three';
import { EXTRA, MODELS } from './enemies.js';
import { BOSSES } from './bosses/index.js';

for (const b of Object.values(BOSSES)) Object.assign(EXTRA, b.kinds); // 新しいボスの部品も、追加の敵と同じ形で動かす
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sfx } from './audio.js';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;
// 横スクロール: 画面に映るのは奥行き 40m ほどなので、敵は画面の右端のすぐ外に出し、前後の動きを遅くする
const SIDE_SPAWN_SHIFT = 175; // 遠くに出る敵を、この分だけ手前 (画面の右端の外) へずらす
const SIDE_Z_SCALE = 0.3;     // 前後の動きの速さの倍率
const SIDE_BULLET_SCALE = 0.55;
// 敵の大きさ (Blender のモデルに対する倍率)。近くまで迫ったとき画面いっぱいに見えるよう大きめにする
const GEODE_Y = 1.6; // 晶洞岩の中心の高さ (モデルの原点は足元)
const FIGHTER_SCALE = 1.6, GUNSHIP_SCALE = 1.4, MOAI_SCALE = 1.7, GREMLIN_SCALE = 2.6, MECH_SCALE = 1.4, PILL_SCALE = 1.6, BOSS_SCALE = 2.2, PTERO_SCALE = 1.5;
const REMOVE_Z = 40;
const SMALL_KINDS = new Set(['gremlin', 'pillpart', 'dart', 'bat', 'satellite']); // 体当たりのダメージが 15 の小さい敵 (ほかは 25)
const HEAL_HALF = new Set(['worm', 'phantom', 'mantis', 'whale', 'mine']); // 体力が半分で回復を 1 個出す長めのボス

const GUN_SPEED = 230;      // 機関砲の弾速 (m/s)
const FIREBALL_SPEED = 170; // 人間の火の玉の弾速 (m/s)
const LOCK_ANGLE = 0.14;    // この角度 (rad, 約8度) の中に入った敵をロックする
const UNLOCK_ANGLE = 0.4;   // ここまで外れたらロックを外す
const LOCK_MAX = 4;
const LOCK_INTERVAL = 0.13; // 1機ロックするのにかかる時間 (s)
const MISSILE_MAX = 8;
const MISSILE_REGEN = 1.6;  // 1発回復するまでの時間 (s)

const RED_EYE = new THREE.Color(0xff2010);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3();

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

// 同じ形と材質のものをたくさん描くとき (敵の光る弾、自機の光線) は、1 回の描画にまとめる (Quest の描画回数を減らす)。
// 弾そのものは中身のない Object3D で動かし、毎フレームその位置・向き・大きさを書き写す
class InstancePool {
  constructor(scene, geo, mat, max) {
    this.max = max;
    this.n = 0;
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // 弾は画面じゅうに散らばるので、まとめて描く
    scene.add(this.mesh);
  }
  begin() { this.n = 0; }
  push(o) {
    if (this.n >= this.max) return;
    o.updateMatrix();
    this.mesh.setMatrixAt(this.n++, o.matrix);
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

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
  fireball: new THREE.SphereGeometry(0.35, 10, 8),
  fireballHalo: new THREE.SphereGeometry(0.75, 12, 8),
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
  glint: new THREE.MeshBasicMaterial({ color: 0xffffff }), // 鏡が撃ち返す光 (撃ち落とせない)
  glintHalo: new THREE.MeshBasicMaterial({ color: 0x60e8ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
  ring: new THREE.MeshBasicMaterial({ color: 0xd060ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  shell: new THREE.MeshBasicMaterial({ color: 0xff8030 }),
  fire: new THREE.MeshBasicMaterial({ color: 0xff6010, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  fireballCore: new THREE.MeshBasicMaterial({ color: 0xffe9a0 }),
  fireballHalo: new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
  item: new THREE.MeshStandardMaterial({ color: 0x30ff80, emissive: 0x10a040, roughness: 0.2, metalness: 0.3, flatShading: true }),
  itemCross: new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
  itemHalo: new THREE.MeshBasicMaterial({ color: 0x40ff90, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }),
  bulletHalo: new THREE.MeshBasicMaterial({ color: 0xff5010, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
  missile: new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4 }),
  missileTip: new THREE.MeshStandardMaterial({ color: 0xd02020, roughness: 0.4 }),
  eye: new THREE.MeshBasicMaterial({ color: 0xff3020 }),
  shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
};

// own: 材質を敵ごとに (群れのボスは、急降下の前に翼を赤く光らせるため)
function makeFighter(own = false) {
  if (TPL.fighter) return instance(TPL.fighter, 0, !own);
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
  if (TPL.gunship) return instance(TPL.gunship, 0, true);
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
// ボスの色 (頭のプリズムと、光の帯の色相)。単頭は水色、双晶は青と紫
const BOSS_HUES = { single: [0.52], twin: [0.6, 0.78] };
const FIRE_COL = new THREE.Color(1, 0.55, 0.15);

// ボーナスステージで乗る「水晶のそり」(そり本体と、うしろに連なる光のかけら)。敵ではないので当たり判定はない
export function makeCrystalSled(nSegs = 10) {
  const part = (tpl, fallbackR, scale) => {
    let made;
    if (tpl) made = instance(tpl);
    else {
      const mat = new THREE.MeshStandardMaterial({ color: 0xbfeaf8, roughness: 0.2, flatShading: true });
      made = { mesh: new THREE.Mesh(new THREE.IcosahedronGeometry(fallbackR, 1), mat), mats: [mat] };
    }
    made.mesh.scale.setScalar(scale);
    return { mesh: made.mesh, mats: made.mats, r: fallbackR * scale, spine: new THREE.Vector3() };
  };
  const head = part(TPL.sled, 2.4, 0.8);
  const segs = Array.from({ length: nSegs }, (_, i) => part(TPL.shard, 1.6, 0.5 - i * 0.02));
  return { head, segs, ready: sledReady() };
}
export const sledReady = () => !!TPL.sled;

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
    moai: ['Geode', ['GeodeTop']],                                   // 晶洞岩: 上の殻が開く
    gremlin: ['CrystalBug', ['BugAntL', 'BugAntR', 'BugWingL', 'BugWingR']], // 結晶の小虫: 触角と羽が動く
    mech: ['DozerBot', ['DozerEye']],                                 // 建設ロボ: バイザーの光が動く
    pill: ['PillBug', ['PillSeg0', 'PillSeg1', 'PillSeg2']],
    ptero: ['Pterosaur', ['PteroWingL', 'PteroWingR']],
    sled: ['CrystalSled'], shard: ['SledShard'],                      // ボーナスステージの水晶のそり
  };
  for (const [key, [name, parts]] of Object.entries(models)) {
    const node = gltf.scene.getObjectByName(name);
    if (node) TPL[key] = bake(node, parts);
  }
  // 追加の敵 (enemies.js)。名前の付いた部品は動かすもの
  const extra = {
    dart: ['CrystalDart'], lens: ['GlassLens'], turret: ['CrystalSpire', ['TowerHead']], bat: ['GlassBat', ['BatWingL', 'BatWingR']],
    bouncer: ['BounceGem'], orbiter: ['OrbitCore'], satellite: ['OrbitSat'],
  };
  for (const [key, [name, parts]] of Object.entries(extra)) {
    const node = gltf.scene.getObjectByName(name);
    if (node) MODELS[key] = bake(node, parts);
  }
  // マンモスは動かす軸ごとの部品 (胴・頭・鼻の節・脚)。それぞれ原点が軸。組み立ては enemies.js
  const mam = ['MammothBody', 'MammothHead', 'MammothTrunk', 'MammothLeg'].map((n) => gltf.scene.getObjectByName(n));
  if (mam.every(Boolean)) {
    const [body, head, trunk, leg] = mam.map((n) => bake(n));
    MODELS.mammoth = { body, head, trunk, leg };
  }
  const mech = gltf.scene.getObjectByName('DozerBot');
  if (mech) TPL.mechMuzzle = localPoint(mech, 'DozerMuzzle');
  // ダンゴムシの節を1つずつ (割れたあとに使う)
  TPL.pillSeg = [0, 1, 2].map((i) => {
    const n = gltf.scene.getObjectByName(`PillSeg${i}`);
    return n ? bake(n) : null;
  });
}

// モデルを複製する。モデルは -Z が前なので、内側で 180 度回して +Z (プレイヤーの方) を前にする
// yOff: モデルの原点が足元にあるものは、体の中心が原点になるよう下げる (当たり判定とロックの中心)
// share: 材質をモデルと共有する (数の多い雑魚。被弾の光は材質の差し替え、flashMeshes で行う)。
//        共有しないときは、敵ごとに材質を複製して発光色で光らせる (色を変えるボスや建設ロボの目)
function instance(tpl, yOff = 0, share = false) {
  const inner = tpl.clone();
  inner.position.y = -yOff;
  const mats = [], flashMeshes = [];
  inner.traverse((o) => {
    if (!o.isMesh) return;
    if (share) {
      o.userData.mat = o.material;
      flashMeshes.push(o);
      return;
    }
    o.material = o.material.clone();
    o.material.userData.base = o.material.emissive.clone();
    mats.push(o.material);
  });
  if (share) return wrap(inner, { mats, flashMeshes });
  return wrap(inner, { mats });
}
function wrap(inner, made) {
  inner.rotation.y = Math.PI;
  const g = new THREE.Group();
  g.add(inner);
  return { mesh: g, ...made };
}

// 被弾で一瞬白く光らせる。材質を共有している敵は、光っている間だけ白い材質に差し替える
// 両面にする (コウモリの羽など 1 枚の板が、光っている間に裏から消えないように)
export const FLASH_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
function applyFlash(e) {
  const on = e.flash > 0;
  if (e.flashMeshes && on !== e.flashOn) {
    e.flashOn = on;
    for (const m of e.flashMeshes) m.material = on ? FLASH_MAT : m.userData.mat;
  }
  for (const m of e.mats) m.emissive.copy(on ? WHITE : m.userData.base || BLACK);
}

const MAMMOTH = { first: 10, every: 8, max: 5 }; // マンモスを必ず出す時刻 (面の始まりからの秒) と数

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
    this.level = 1;          // 難しさ (ステージ表の diff)。上がるほど敵が硬く、よく撃ってくる
    this.density = 1;        // 敵の群れが出る量の倍率 (ステージ表)
    this.waveTable = null;   // 出てくる敵と重み (ステージ表)
    this.bossGroup = null;   // 群れのボス (ロボット部隊・旋回する群れ)
    this.bossEscaped = false;
    this.ceilingY = Infinity; // 天井のある面では、空を飛ぶ敵とボスの高さの上限
    this.lastBossBonus = 0;
    this.mult = 1;           // スコア倍率 (難しいモードで上がる)
    this.bonusLevel = 1;     // 撃破ボーナスにかける面の強さ (難しいモードの +2 を含まない)
    this.boss = null;
    this.bossDefeated = false;
    this.announce = '';      // 画面に出したい知らせ (main.js が読んで消す)
    this.items = [];         // 回復アイテム
    this.itemT = 15;
    this.stageT = 0;
    this.appearAt = {};     // 出現音を最後に鳴らした時刻 (敵の種類ごと)
    this.mammothN = 0;      // この面で必ず出したマンモスの数
    this.sparks = new Particles(scene, 1500, true);
    // まとめて描く弾: 敵の光る弾 (核と光の輪) と、自機の光線
    this.pools = {
      orb: [new InstancePool(scene, GEO.bullet, MAT.bullet, 400), new InstancePool(scene, GEO.bulletHalo, MAT.bulletHalo, 400)],
      shot: [new InstancePool(scene, GEO.shot, MAT.shot, 200)],
    };
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
    this.drawPools(); // まとめて描く弾も消す
    this.itemT = 15;
    this.stageT = 0;
    this.locks = [];
    this.missileStock = MISSILE_MAX;
    this.spawn = { wave: 3 };
    this.time = 0;
    this.score = 0;
    this.kills = 0;
    this.level = 1;
    this.boss = null;
    this.bossGroup = null;
    this.bossDefeated = false;
    this.bossEscaped = false;
    this.sparks.clear();
    this.smoke.clear();
  }

  remove(o) {
    this.scene.remove(o.mesh);
    if (o.shadow) this.scene.remove(o.shadow);
    if (o.marker) this.scene.remove(o.marker); // 地面の予告の印 (氷晶の冠のつららなど)
    if (o.gapMarker) this.scene.remove(o.gapMarker); // 氷の柵の抜け道の印
    if (o.beam) EXTRA[o.kind]?.endBeam?.(this, o); // 光翼の光線 (面が変わったときも片付ける)
    if (o.mats) o.mats.forEach((m) => m.dispose());
  }

  // ---- 出現
  spawnFighterWave(px, py) {
    const n = 4 + Math.floor(Math.random() * 3);
    const behind = Math.random() < 0.35; // 後ろから追い越してくる
    const w = rand(1.6, 2.8);
    for (let k = 0; k < n; k++) {
      const { mesh, mats, flashMeshes } = makeFighter();
      mesh.scale.setScalar(FIGHTER_SCALE);
      const e = {
        kind: 'fighter', mesh, mats, flashMeshes, r: 3.0, hp: 1, score: 100,
        t: k * 0.3, w, phase: k * 0.45, fireT: rand(1.5, 4), flash: 0,
        state: behind ? 'behind' : 'approach', z: behind ? 40 + k * 9 : SPAWN_Z - k * 9,
        // 後ろから来るときは横に 9〜13 m 離れて追い越す (見えない後ろから当たらないように。翼の端から目まで 6 m 以上)
        ox: behind ? (Math.random() < 0.5 ? -1 : 1) * rand(9, 13) : rand(-7, 7), oy: rand(3, 6), yaw: behind ? Math.PI : 0, noHit: behind, jink: 0, jinkTo: 0, jinkT: rand(0.3, 1), lastX: px,
      };
      mesh.position.set(px + e.ox, py + e.oy, e.z);
      this.addEnemy(e, 1.8 * FIGHTER_SCALE);
    }
  }

  updateFighter(e, dt, scroll, ctx) {
    const p = e.mesh.position, P = ctx.player;
    if (e.state === 'orbit' || e.state.startsWith('swarm')) {
      // 旋回する群れ: 2 つの輪が逆向きに回る。最初の 4 秒で遠くから迫ってくる
      const g = e.bossGroup;
      const gt = g ? g.t : e.t;
      const cz = THREE.MathUtils.lerp(SPAWN_Z, ctx.side ? -16 : -48, Math.min(1, gt / 4));
      const dir = e.ring ? 1 : -1;
      const a = dir * gt * 1.1 + (e.slot / 4) * Math.PI * 2 + e.ring * 0.4;
      const R = ctx.side ? 8 : 12;
      const ox = P.x + Math.cos(a) * R, oy = Math.max(3, P.y + 4 + Math.sin(a) * R * 0.7), oz = cz + Math.sin(a * 2) * 4;
      if (e.state === 'orbit') p.set(ox, oy, oz);
      else this.swarmDive(e, dt, ctx, _d.set(ox, oy, oz));
    } else if (e.state === 'leave') {
      p.y += 24 * dt;
      p.z -= 40 * dt;
      if (p.y > 70) e.dead = true;
    } else if (e.state === 'behind') {
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
      if (k >= 1) {
        e.state = 'approach';
        e.noHit = false; // 前に回ってきてから当たる
      }
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
        e.passX = P.x + side * (e.r + 6); // 翼の端から目まで 6 m 以上あけてかすめる
        e.passY = P.y + rand(0.5, 2.5);
        if (ctx.side) e.passY = Math.max(2, P.y + (Math.random() < 0.5 ? -1 : 1) * (e.r + 3)); // 横スクロールは上下にかすめる
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

  // 群れの急降下 (SWARM DIVE。旋回する群れの 2 つめの攻撃): 翼が赤く光る (0.8 秒、甲高い音) → プレイヤーの横 12 m の点へ
  // まっすぐ毎秒 40 m で急降下、30 m 手前で 1 発 → すれ違ったら当たらず、上へ大きく回って輪 (home) に戻る
  swarmDive(e, dt, ctx, home) {
    const p = e.mesh.position, P = ctx.player;
    e.st += dt;
    if (e.state === 'swarmWarn') {
      p.copy(home);
      e.baseEm ??= e.mats.map((m) => m.userData.base.clone()); // 戻ったら元の光り方に
      for (const m of e.mats) m.userData.base.setHex(0xff2010).multiplyScalar(0.4 + 0.6 * Math.abs(Math.sin(e.st * 14)));
      if (e.st >= 0.8) {
        e.state = 'swarmDive';
        e.st = 0;
        e.diveVel = _a.set(P.x + e.diveSide * 12, P.y, P.z).sub(p).normalize().multiplyScalar(40).clone(); // まっすぐ (追わない)
        e.shotDone = false;
      }
    } else if (e.state === 'swarmDive') {
      p.addScaledVector(e.diveVel, dt);
      if (!e.shotDone && p.z > P.z - 30) {
        e.shotDone = true;
        this.fireBullet(p.clone(), P, 0);
      }
      if (p.z > P.z) { e.state = 'swarmBack'; e.st = 0; e.noHit = true; e.backFrom = p.clone(); } // すれ違ったら当たらない
    } else {
      // 上へ大きく回って、輪の位置へ戻る (2 秒)
      const k = Math.min(1, e.st / 2);
      p.lerpVectors(e.backFrom, home, k * k * (3 - 2 * k));
      p.y += Math.sin(k * Math.PI) * 25;
      if (k >= 1) {
        e.state = 'orbit';
        e.noHit = false;
        e.mats.forEach((m, i) => m.userData.base.copy(e.baseEm[i]));
        if (e.bossGroup) e.bossGroup.diver = null;
      }
    }
  }

  spawnGunship(px, py) {
    const { mesh, mats, flashMeshes } = makeGunship();
    mesh.scale.setScalar(GUNSHIP_SCALE);
    const e = {
      kind: 'gunship', mesh, mats, flashMeshes, r: 3.6 * GUNSHIP_SCALE, hp: 6 + this.level * 2, score: 1000,
      t: 0, x: px + rand(-6, 6), y: THREE.MathUtils.clamp(py + rand(1, 5), 4, 22), z: SPAWN_Z,
      hover: 0, fireT: 2, flash: 0,
    };
    this.addEnemy(e, 3.5 * GUNSHIP_SCALE);
  }

  // 横スクロールで「止まって撃つ」敵の止まる位置 (画面の中)。3D では z3d のまま
  holdZ(z3d) {
    return this.sideMode ? -18 : z3d;
  }

  // エンディング: 敵を 1 体だけ出して、life 秒のあいだ目の前で回して見せる (撃たず、当たらず、倒せない)。
  // ふだんの出し方で群れを出し、最初の 1 体だけ残す
  showcase(kind, life) {
    const P = this.lastPlayer || new THREE.Vector3(0, 5, 0);
    const before = this.enemies.length, force = this.forceWave;
    this.forceWave = kind;
    this.spawnWave(P.x, P.y);
    this.forceWave = force;
    const [e, ...rest] = this.enemies.slice(before);
    for (const o of rest) o.dead = true;
    if (!e) return;
    e.display = { t: 0, life };
    e.hp = Infinity;
    e.noLock = true;
    e.fireT = Infinity;
    e.mesh.rotation.set(0, Math.PI, 0);
    e.mesh.position.set(P.x, Math.max(e.r, P.y), P.z - 200);
  }

  updateShowcase(e, dt, ctx) {
    const D = e.display, P = ctx.player, p = e.mesh.position;
    D.t += dt;
    // 遠くから目の前 (大きさに合わせた距離) まで寄ってきて、ゆっくり回る。名前の文字と重ならないよう、目の高さより少し下に置く。
    // 最後の 0.7 秒で上へ遠ざかる
    const leave = D.t > D.life - 0.7;
    const k = Math.min(1, dt * (leave ? 2 : 3));
    p.x += (P.x - p.x) * k;
    p.y += ((leave ? P.y + 30 : Math.max(e.r * 0.8, P.y - 1.5)) - p.y) * k;
    p.z += ((leave ? P.z - 220 : P.z - Math.max(12, e.r * 3.5)) - p.z) * k;
    e.mesh.rotation.y += dt * 0.9;
    e.shadow.position.set(p.x, 0.05, p.z);
    e.flash -= dt;
    applyFlash(e);
    if (D.t > D.life) e.dead = true;
  }

  // 出す敵の群れを重み付きで選ぶ。重いもの (ガンシップ・建設ロボ・レンズ・衛星コア) は同時に出しすぎない
  spawnWave(px, py) {
    const isHeavy = (k) => k === 'gunship' || k === 'mech' || !!EXTRA[k]?.heavy;
    // 重い敵は「組」で数える (建設ロボは 3 機で 1 組、二十面体は 1 列で 1 組)。建設ロボの組は、ほかの重い敵とは別に 1 組まで
    const live = this.enemies.filter((e) => !e.dead && isHeavy(e.kind));
    const heavy = new Set(live.map((e) => e.group || e.pack || e)).size;
    const mechGroups = new Set(live.filter((e) => e.kind === 'mech').map((e) => e.group)).size;
    const ok = (k) => (k === 'mech' ? mechGroups === 0 : isHeavy(k) ? heavy - mechGroups < 2 : true);
    // ステージ表の組み合わせ (なければ全種類)
    const base = this.waveTable || [['fighter', 3], ['gremlin', 2.2], ['pill', 2], ['moai', 1.6], ['ptero', 1.8], ['mech', 1.3], ['gunship', 1]];
    // マンモスは面の最初の 10 秒は出さない。同時に出るのは 1 体まで
    const mammothLive = live.some((e) => e.kind === 'mammoth');
    let table = base.filter(([k]) => ok(k) && !(k === 'mammoth' && (this.stageT < MAMMOTH.first || mammothLive)));
    if (!table.length) table = base.filter(([k]) => !isHeavy(k)); // 上限で出せないときは、表の中の重くない敵から選び直す
    if (!table.length) table = [['fighter', 1]];
    let r = Math.random() * table.reduce((a, [, w]) => a + w, 0);
    let kind = this.forceWave || table.find(([, w]) => (r -= w) < 0)?.[0] || table[0][0];
    // マンモスのいる面では、10 秒すぎから 8 秒ごとに必ず 1 体ずつ出す (くじ運で少なくならないように)
    if (!this.forceWave && table.some(([k]) => k === 'mammoth') && this.mammothN < MAMMOTH.max && this.stageT >= MAMMOTH.first + this.mammothN * MAMMOTH.every) kind = 'mammoth';
    if (kind === 'mammoth') this.mammothN++;
    if (EXTRA[kind]) return EXTRA[kind].spawn(this, px, py); // 追加の敵 (enemies.js)
    ({
      fighter: () => this.spawnFighterWave(px, py),
      gunship: () => this.spawnGunship(px, py),
      gremlin: () => this.spawnGremlins(px, py),
      pill: () => (Math.random() < 0.4 ? this.spawnPillTriangle(px, py) : this.spawnPills(px)),
      moai: () => this.spawnMoai(px),
      mech: () => this.spawnMechTrio(px),
      ptero: () => this.spawnPteros(px),
    })[kind]();
  }

  // 晶洞岩 (GEODE): 地面に立ち、二枚貝のように割れて開き、中の結晶から光の輪を吐く (左右に2体並ぶことが多い)
  spawnMoai(px) {
    const xs = Math.random() < 0.6 ? [px - rand(7, 11), px + rand(7, 11)] : [px + rand(-9, 9)];
    for (const [i, x] of xs.entries()) {
      const made = TPL.moai ? instance(TPL.moai, GEODE_Y, true) : fallback(0x4a403a, 2.2);
      const e = { kind: 'moai', ...made, r: 2.4 * MOAI_SCALE, hp: 6 + this.level * 2, score: 800, t: 0, fireT: rand(1.5, 3) + i * 0.6, mouth: 0, openT: 0, flash: 0 };
      e.mesh.scale.setScalar(MOAI_SCALE);
      e.mesh.position.set(x, GEODE_Y * MOAI_SCALE, SPAWN_Z - i * 10);
      e.jaw = e.mesh.getObjectByName('GeodeTop');
      this.addEnemy(e, 2.4 * MOAI_SCALE);
    }
  }

  // 結晶の小虫: 小さくてすばしこい。ジグザグに跳ね回り、近くで体当たりしてくる
  spawnGremlins(px, py) {
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const made = TPL.gremlin ? instance(TPL.gremlin, 0, true) : fallback(0x337a28, 0.8);
      const e = {
        kind: 'gremlin', ...made, r: 1.1 * GREMLIN_SCALE * 0.75, hp: 2, score: 300, t: rand(0, 3), flash: 0, fireT: Infinity,
        cx: px + rand(-12, 12), cy: THREE.MathUtils.clamp(py + rand(-1, 4), 1.5, 18), z: SPAWN_Z - k * 6, dash: null,
      };
      e.parts = ['BugAntL', 'BugAntR', 'BugWingL', 'BugWingR'].map((n2) => e.mesh.getObjectByName(n2)).filter(Boolean);
      e.mesh.scale.setScalar(GREMLIN_SCALE);
      this.addEnemy(e, 0.9 * GREMLIN_SCALE * 0.6);
    }
  }

  // 建設ロボの3機編隊: 縦一列で突っ込んできて、目の前まで迫りながら先頭から順に撃っては左右上へ散り、すぐ横をかすめて背後へ抜ける (DOMINO RUSH)
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
      e.eyeMats = [];
      e.eye?.traverse((o) => { if (o.isMesh) e.eyeMats.push([o.material, o.material.userData.base.clone()]); });
      this.addEnemy(e, 2.6 * MECH_SCALE);
    }
  }

  // 翼竜: 高空で大きな弧を描いて横切り、近づくと甲高く鳴いて急降下し、すぐ横をかすめて舞い上がる
  spawnPteros(px) {
    const n = 2 + Math.floor(Math.random() * 2);
    for (let k = 0; k < n; k++) {
      const made = TPL.ptero ? instance(TPL.ptero, 0, true) : fallback(0x73331f, 1.2);
      const e = {
        kind: 'ptero', ...made, r: 2.2 * PTERO_SCALE, hp: 4 + this.level, score: 600, t: rand(0, 6), flash: 0, fireT: rand(1, 2.5) + k * 0.7,
        state: 'glide', z: SPAWN_Z - k * 18, alt: Math.min(this.ceilingY, rand(16, 26)), phase: k * 1.3, vel: new THREE.Vector3(),
      };
      e.mesh.scale.setScalar(PTERO_SCALE);
      e.mesh.position.set(px, e.alt, e.z);
      e.wings = ['PteroWingL', 'PteroWingR'].map((n2) => e.mesh.getObjectByName(n2)).filter(Boolean);
      this.addEnemy(e, 2 * PTERO_SCALE);
    }
  }

  updatePtero(e, dt, scroll, ctx) {
    const p = e.mesh.position, P = ctx.player;
    let flapRate = 4, flapAmp = 0.45, fold = 0;
    if (e.state === 'glide') {
      e.z += (scroll * 0.5 + 30) * dt;
      const dist = Math.max(20, -e.z);
      p.set(P.x + Math.tan(0.6 * Math.sin(e.t * 0.8 + e.phase)) * dist, e.alt + Math.sin(e.t * 1.5) * 2, e.z);
      e.mesh.rotation.set(0, 0, -0.5 * Math.cos(e.t * 0.8 + e.phase));
      if (e.z > -75 && Math.random() < dt * 1.5) {
        // 急降下: 自機のすぐ横をねらって突っ込む
        e.state = 'dive';
        const side = Math.sign(p.x - P.x) || 1;
        const aim = ctx.side ? _a.set(P.x, P.y + e.r + 5, P.z) : _a.set(P.x + side * (e.r + 4.5), P.y + 3, P.z);
        e.vel.subVectors(aim, p).normalize().multiplyScalar(60);
        sfx.screech();
      }
    } else if (e.state === 'dive') {
      p.addScaledVector(e.vel, dt);
      fold = 1;
      if (p.z > -4) e.state = 'climb';
    } else {
      e.vel.y += 45 * dt; // 舞い上がる
      p.addScaledVector(e.vel, dt);
      flapRate = 9;
      flapAmp = 0.7;
      if (p.y > 70) e.dead = true;
    }
    if (e.state !== 'glide') e.mesh.lookAt(_b.copy(p).add(e.vel));
    // 羽ばたき (急降下のときは翼をすぼめる)
    for (const w of e.wings) {
      const sign = w.name.endsWith('L') ? -1 : 1;
      w.rotation.z = sign * (fold ? 0.9 : Math.sin(e.t * flapRate) * flapAmp);
    }
  }

  // ダンゴムシ: 丸まって地面を転がってくる。撃つと3つの節に割れて、それぞれが追いかけてくる
  spawnPills(px) {
    const n = 2 + Math.floor(Math.random() * 2);
    for (let k = 0; k < n; k++) {
      const made = TPL.pill ? instance(TPL.pill, 0, true) : fallback(0x40485a, 1.5);
      const e = this.makePill(made, 'roll');
      e.x = px + rand(-10, 10);
      e.mesh.position.set(e.x, 1.5 * PILL_SCALE, SPAWN_Z - k * 14);
      this.addEnemy(e, 1.6 * PILL_SCALE);
    }
  }

  // 3 匹が空中で三角形に並び、ゆっくり回りながら 1 匹ずつ順に殻を開いて玉を吐く。しばらくすると転がって突っ込んでくる
  spawnPillTriangle(px, py) {
    for (let slot = 0; slot < 3; slot++) {
      const made = TPL.pill ? instance(TPL.pill, 0, true) : fallback(0x40485a, 1.5);
      const e = this.makePill(made, 'tri');
      e.slot = slot;
      e.openT = 1.5 + slot * 0.9; // 順番に開く
      e.cx = px;
      e.cy = THREE.MathUtils.clamp(py + 3, 6, 24);
      e.mesh.position.set(px, e.cy, SPAWN_Z);
      this.addEnemy(e, 1.6 * PILL_SCALE);
    }
  }

  makePill(made, mode) {
    made.mesh.scale.setScalar(PILL_SCALE);
    return {
      kind: 'pill', ...made, r: 1.8 * PILL_SCALE, hp: 3 + Math.ceil(this.level / 2), score: 500, t: rand(0, 3), flash: 0, fireT: Infinity,
      mode, open: 0, openTo: 0, openT: rand(1.5, 3), fired: false,
      segs: [0, 1, 2].map((i) => made.mesh.getObjectByName(`PillSeg${i}`)).filter(Boolean),
    };
  }

  // 殻の開け閉め: 閉じているあいだは弾を跳ね返し、開いたときだけ倒せて、玉を吐く
  updatePillShell(e, dt, ctx) {
    e.openT -= dt;
    if (e.openT <= 0) {
      if (e.openTo === 0) {
        e.openTo = 1;
        e.openT = 1.7;
        e.fired = false;
      } else {
        e.openTo = 0;
        e.openT = e.mode === 'tri' ? 2.7 : rand(1.8, 3);
      }
    }
    e.open += THREE.MathUtils.clamp(e.openTo - e.open, -dt * 4, dt * 4);
    // 開いたら玉を吐く (三角形の編隊は 3 方向)
    if (e.open > 0.9 && !e.fired && ctx.active) {
      e.fired = true;
      const from = e.mesh.position.clone().add(_c.set(0, 0.5, 1.5 * PILL_SCALE));
      if (e.mode === 'tri') for (const sp of [-0.15, 0, 0.15]) this.fireBullet(from, ctx.player, sp);
      else this.fireBullet(from, ctx.player);
    }
    // 見た目: 節が前後に開いて、反り返る (モデルの前は -Z)
    const [s0, s1, s2] = e.segs;
    if (s0 && s2) {
      s0.position.z = s0.userData.base.z - 0.9 * e.open;
      s0.rotation.x = -0.5 * e.open;
      s2.position.z = s2.userData.base.z + 0.9 * e.open;
      s2.rotation.x = 0.5 * e.open;
      if (s1) s1.position.y = s1.userData.base.y + 0.2 * e.open;
    }
    // 開いているときは転がらず、まっすぐ立つ
    if (e.open > 0.05) {
      const up = Math.round(e.mesh.rotation.x / (Math.PI * 2)) * Math.PI * 2;
      e.mesh.rotation.x += (up - e.mesh.rotation.x) * Math.min(1, dt * 10);
    }
  }

  // ダンゴムシの殻と、閉じた晶洞岩に当たった弾は跳ね返る
  pillShielded(e) {
    return (e.kind === 'pill' && e.open < 0.6) || (e.kind === 'moai' && e.mouth < 0.5) || !!EXTRA[e.kind]?.shielded?.(e);
  }

  splitPill(e) {
    const segs = [0, 1, 2].map((i) => e.mesh.getObjectByName(`PillSeg${i}`));
    for (let i = 0; i < 3; i++) {
      const made = TPL.pillSeg?.[i] ? instance(TPL.pillSeg[i], 0, true) : fallback(0x40485a, 0.9);
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

  // 3機編隊の動き (planner-review-v1.5.8 の H1)。approach: 縦一列でプレイヤーの列へ寄せながら突っ込む
  // → attack: 先頭は 55 m 先で止まり、0.5 秒目を赤く光らせてから体当たり (約 1.4 秒。追うのは最初の 0.2 秒だけ、あとはまっすぐ)。
  //   当たるときは目の 2 m 手前で砕ける (体の中を抜けない)。2・3 機目は 1 発ずつ撃って左右上へ散り、すぐ横をかすめて背後へ抜ける
  // → 部隊のボスは、全機が抜けて 2 秒休んでから、遠くへ戻ってまた攻めてくる
  updateMech(e, dt, scroll, ctx) {
    if (e.bossGroup?.wall) return this.updateMechWall(e, dt, scroll, ctx);
    const G = e.group, p = e.mesh.position, P = ctx.player;
    const alive = this.enemies.filter((o) => o.group === G && !o.dead);
    const leader = alive[0] === e; // 先頭が落とされたら、次の機体が先頭になる
    if (G.phase === 'approach') {
      if (leader) {
        G.lane += THREE.MathUtils.clamp(P.x - G.lane, -12 * dt, 12 * dt);
        if (p.z > -70) {
          G.phase = 'attack';
          G.at = 0;
          G.rammer = e; // 体当たりするのは、このときの先頭の 1 機だけ
          this.announce = 'DOMINO RUSH!';
        }
      }
      e.z += (scroll * 0.5 + 56) * dt;
    } else if (G.phase === 'attack') {
      if (leader) G.at += dt;
      if (e === G.rammer && !ctx.side) {
        if (!e.ram) {
          e.z = Math.min(e.z + (scroll * 0.5 + 30) * dt, P.z - 55); // 55 m 先で止まって合図
          G.lane += THREE.MathUtils.clamp(P.x - G.lane, -6 * dt, 6 * dt);
          const warn = G.at > 0.4;
          this.setMechEye(e, warn); // 体当たりの合図: 目が赤く光る (0.5 秒)
          if (G.at > 0.9) {
            e.ram = { t: 0, vel: _a.subVectors(P, p).normalize().multiplyScalar(34 + this.level).clone() }; // 55 m を約 1.4 秒
            e.noHit = true; // 当たりは下で見る (目の手前で砕く)
            sfx.whoosh();
          }
        }
      } else {
        // 2・3 機目 (横スクロールは全機): 撃って散り、すぐ横をかすめて背後へ抜ける
        const local = G.at - e.role * 0.7;
        if (!e.passing) e.z = Math.min(e.z + (scroll * 0.5 + 30) * dt, ctx.side ? -10 - e.role * 6 : -28 - e.role * 7);
        if (local >= 0 && e.fired === 0) {
          e.fired = 1;
          this.fireMechShell(e, ctx);
          e.offTo.set([0, 14, -14][e.role], [9, 1, 1][e.role]);
        }
        if (local >= 1.6 && !e.passing && !ctx.side) {
          e.passing = true;
          const away = e.offTo.x === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(e.offTo.x);
          e.offTo.set(away * 15, 5); // 15 m 横をかすめる
        }
        if (e.passing) e.z = Math.min(e.z + (scroll * 0.5 + 45) * dt, P.z + 20); // 背後 20 m で待つ (消える所まで行かない)
      }
      // 全機が背後へ抜けたら (横スクロールは 4.5 秒で) 終わり
      const done = ctx.side ? G.at > 4.5 : alive.every((o) => (o.ram || o.passing) && o.mesh.position.z > P.z + 12);
      if (leader && done) {
        if (G.regroup) {
          G.phase = 'rest';
          G.at = 0;
        } else if (ctx.side) {
          G.phase = 'retreat';
        } else {
          for (const o of alive) o.dead = true;
        }
      }
    } else if (G.phase === 'rest') {
      // 部隊のボス: 2 秒休んでから、遠くへ戻ってもう一度攻めてくる
      if (leader) G.at += dt;
      if (leader && G.at > 2) {
        G.phase = 'approach';
        for (const o of alive) {
          o.ram = o.passing = null;
          o.noHit = o.noLock = false;
          o.mesh.visible = o.shadow.visible = true;
          o.fired = 0;
          o.z = SPAWN_Z * 0.6 - o.role * 9;
          o.off.set(0, 0);
          o.offTo.set(0, 0);
          this.setMechEye(o, false);
        }
      }
    } else {
      // 去る (部隊のボスが時間切れになったとき、横スクロールの攻撃のあと)
      e.ram = null;
      e.z -= 32 * dt;
      e.offTo.y = 4;
      if (e.z < SPAWN_Z || (G.regroup === false && e.z < -80 && !ctx.side)) e.dead = true;
      if (G.regroup && leader && e.z < -80) {
        G.phase = 'approach';
        for (const o of alive) { o.fired = 0; o.passing = null; o.offTo.set(0, 0); }
      }
    }
    if (e.ram) {
      const R = e.ram;
      R.t += dt;
      if (R.t < 0.2) R.vel.lerp(_a.subVectors(P, p).normalize().multiplyScalar(R.vel.length()), Math.min(1, dt * 6));
      p.addScaledVector(R.vel, dt);
      p.z = Math.min(p.z, P.z + 20); // 背後 20 m で待つ (部隊のボスが、また攻めてくるまで)
      p.y = Math.max(3.3 * MECH_SCALE * 0.6, p.y);
      e.z = p.z;
      e.mesh.rotation.x = -0.35; // 前のめりに突っ込む
      // 目の 2 m 手前まで来たら: 当たる位置なら砕けてダメージ。外れていればそのまま背後へ抜ける
      if (!R.checked && p.z > P.z - e.r - 2) {
        R.checked = true;
        if (Math.hypot(p.x - P.x, p.y - P.y) < e.r * 0.6 + ctx.playerR) { // 当たりは体の芯 (6 割) だけ。かすめても当たらない
          // 砕けて見えなくなり、背後で待つ (倒したことにはしない。部隊のボスなら、次の攻撃でまた出てくる)
          ctx.onPlayerHit(25);
          this.explode(p.clone(), true);
          e.mesh.visible = e.shadow.visible = false;
          e.noLock = true;
          p.z = P.z + 20;
        }
      }
    } else {
      e.off.lerp(e.offTo, Math.min(1, dt * 6));
      p.set(G.lane + e.off.x, 3.3 * MECH_SCALE + e.off.y + Math.sin(e.t * 2) * 0.15, e.z);
      e.mesh.rotation.x = 0;
    }
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

  // ロボの壁 (DOMINO WALL。部隊のボスの 2 つめの攻撃): 残りが横一列に並び (間 16 m)、1 か所だけ空けて地面に緑の道しるべ。
  // 目が左から順に赤く光り (1 秒)、列は地面に沿ってまっすぐ毎秒 20 m 近づく。抜け道を外れてロボに当たるときは、目の 8 m 手前で砕けて 25
  startMechWall(g, alive, ctx) {
    const P = ctx.player;
    const n = alive.length + 1, gapIdx = Math.floor(Math.random() * n);
    const x0 = P.x - ((n - 1) / 2) * 16 + rand(-4, 4);
    const guide = new THREE.Mesh(new THREE.PlaneGeometry(6, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x40ff80, transparent: true, opacity: 0.5, depthWrite: false }));
    this.scene.add(guide);
    g.wall = { t: 0, z: P.z - 100, guide, gapX: x0 + gapIdx * 16, done: false };
    let i = 0;
    for (const e of alive.sort((a, b) => a.mesh.position.x - b.mesh.position.x)) {
      if (i === gapIdx) i++;
      e.wallX = x0 + i * 16;
      e.wallI = i;
      e.wallFrom = e.mesh.position.clone();
      e.wallHit = false;
      e.ram = e.passing = null;
      e.noHit = true; // 当たりは目の手前で見る
      e.mesh.visible = e.shadow.visible = true;
      i++;
    }
    this.announce = 'DOMINO WALL!';
  }

  updateMechWall(e, dt, scroll, ctx) {
    const W = e.bossGroup.wall, p = e.mesh.position, P = ctx.player;
    if (e.wallX === undefined) return; // 並び始めたあとに出てきた機体はない
    // 並ぶ (1.5 秒) → 目が左から順に赤く光る (1 秒) → まっすぐ近づく
    const k = Math.min(1, W.t / 1.5);
    const y = 3.3 * MECH_SCALE;
    if (W.t < 2.5) {
      p.lerpVectors(e.wallFrom, _a.set(e.wallX, y, W.z), k * k * (3 - 2 * k));
      this.setMechEye(e, W.t > 1.5 + e.wallI * 0.15);
    } else {
      this.setMechEye(e, true);
      p.set(e.wallX, y, W.z);
      // 目の 8 m 手前で、当たる位置なら砕けて 25 (抜け道にいれば、ロボの表面まで 8 m 以上)
      if (!e.wallHit && p.z + e.r > P.z - 8) {
        e.wallHit = true;
        if (Math.abs(p.x - P.x) < e.r * 0.8 + ctx.playerR && P.y < 9 + ctx.playerR) {
          ctx.onPlayerHit(25);
          this.explode(p.clone(), true);
          e.mesh.visible = e.shadow.visible = false;
          e.noLock = true;
        }
      }
    }
    e.mesh.rotation.set(0, 0, 0);
  }

  // 建設ロボの目を赤く光らせる (体当たりの合図) / 元に戻す
  setMechEye(e, red) {
    for (const [m, base] of e.eyeMats || []) m.userData.base.copy(red ? RED_EYE : base);
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
  // ボスを倒したとき: 残った敵の弾と、体当たりしてくる敵 (破片・ドローンなど) を消す
  clearHostiles() {
    for (const b of this.bullets) b.dead = true;
    for (const e of this.enemies) {
      if (e.kind !== 'boss' && (EXTRA[e.kind]?.kamikaze || e.kind === 'pillpart')) { e.dead = true; this.explode(e.mesh.position); }
    }
  }

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
        this.spawnItem(_a.set(ctx.player.x + rand(-8, 8), THREE.MathUtils.clamp(ctx.player.y + rand(-2, 3), 2, 15), SPAWN_Z * 0.8)); // 高く飛んでいても取りに行ける高さ (15 m まで)
      }
    }
    for (const it of this.items) {
      it.t += dt;
      const p = it.mesh.position;
      if (ctx.planeX !== undefined && ctx.planeX !== null) p.x = ctx.planeX;
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
    if (this.sideMode && e.mesh.position.z < -100) {
      e.mesh.position.z += SIDE_SPAWN_SHIFT;
      if (typeof e.z === 'number') e.z += SIDE_SPAWN_SHIFT;
      if (e.spine) e.spine.z += SIDE_SPAWN_SHIFT;
    }
    e.shadow = new THREE.Mesh(GEO.shadow, MAT.shadow);
    e.shadow.scale.setScalar(shadowR);
    this.scene.add(e.mesh, e.shadow);
    this.enemies.push(e);
  }

  // ---- ボス: プリズム連珠。大きなプリズムの頭のうしろに光るガラス玉の節がつながり、うねりながら頭を追う。
  // 偶数ステージは二首: 胴体の先が二股に分かれ、首ごとに頭が付く (2 つの頭は別々に動いて交互に攻撃する)
  // def: { type: 'serpent' | 'twin' | 'squad' | 'swarm', hp, escape }
  spawnBoss(def = { type: 'serpent', hp: 400 }) {
    this.bossDefeated = false;
    this.bossEscaped = false;
    if (def.type === 'squad' || def.type === 'swarm') return this.spawnBossGroup(def);
    if (BOSSES[def.type]) return BOSSES[def.type].spawn(this, def); // 新しいボス (src/bosses/)
    const lv = this.level;
    const twin = def.type === 'twin';
    const hp = def.hp || Math.round((300 + lv * 100) * (twin ? 1.4 : 1));
    const b = { parts: [], heads: [], body: [], twin, hp, maxHp: hp, t: 0, segFireT: 2, dying: -1, exploded: 0, lunging: null };
    const hues = twin ? BOSS_HUES.twin : BOSS_HUES.single;
    const make = (tpl, fallbackR, r, isHead, scale = 1, hue = hues[0]) => {
      let made;
      if (tpl) made = instance(tpl);
      else {
        const mat = new THREE.MeshStandardMaterial({ color: 0x7fd8f0, metalness: 0.3, roughness: 0.2, flatShading: true });
        made = { mesh: new THREE.Mesh(new THREE.IcosahedronGeometry(fallbackR, 1), mat), mats: [mat] };
      }
      // プリズムとガラス玉の色を、頭ごとの色相に塗る (胴体は少し暗く)
      for (const m of made.mats) {
        if (m.name === 'EN_PrismMain') m.color.setHSL(hue, 0.75, isHead ? 0.62 : 0.55);
        if (m.name === 'EN_OrbGlass') {
          m.color.setHSL(hue, 0.6, 0.6);
          m.emissive.setHSL(hue, 0.8, 0.22);
          m.userData.base = m.emissive.clone();
        }
      }
      made.mesh.scale.setScalar(BOSS_SCALE * scale);
      r *= BOSS_SCALE * scale;
      const e = { kind: 'boss', boss: b, isHead, mesh: made.mesh, mats: made.mats, r, hp: Infinity, score: 0, flash: 0, fireT: Infinity };
      e.mesh.position.set(0, 8, SPAWN_Z - b.parts.length * 3);
      e.spine = e.mesh.position.clone(); // うねりを足す前の「背骨」の位置
      this.addEnemy(e, r * 1.2);
      b.parts.push(e);
      return e;
    };
    const nHeads = twin ? 2 : 1;
    for (let h = 0; h < nHeads; h++) {
      const head = make(TPL.head, 2.2, 2.6, true, 1, hues[h]);
      const neck = twin ? Array.from({ length: 6 }, () => make(TPL.segment, 1.4, 1.6, false, 0.8, hues[h])) : [];
      const H = {
        head, neck, side: twin ? (h ? 1 : -1) : 0, sign: h ? 1 : -1, phase: h * 2.1, hue: hues[h], hp: hp / nHeads,
        fireT: 3 + h * 0.8, breathT: 8 + h * 3, breath: 0, flameT: 0, lungeT: 9 + h * 4, lunge: 0,
      };
      for (const part of [head, ...neck]) part.owner = H; // 二首は首ごとに体力を持ち、片方ずつ壊せる
      b.heads.push(H);
    }
    if (twin) {
      // 2 本の首が合わさる付け根。首はここから頭へ曲線でかけ渡し、胴体はここから後ろへつなげる (首と胴体が離れないように)
      const at = new THREE.Vector3(0, 8, SPAWN_Z - 14);
      b.hub = { spine: at, r: 1.6 * BOSS_SCALE * 0.8, mesh: { position: at } };
      b.lost = []; // 壊れた首 (頭から順に爆発させる)
      b.rushT = 16; // 二首そろって目の前まで迫ってくる攻撃
      b.rush = -1;
      b.volleyT = 0;
    }
    for (let i = 0; i < 9 + lv * 2; i++) b.body.push(make(TPL.segment, 1.4, 1.6, false));
    b.body.push(make(TPL.tail, 1.1, 1.3, false));
    this.boss = b;
    this.bossDefeated = false;
  }

  // 群れのボス: ロボット部隊 (3 機編隊 × 2 が波状攻撃をくり返す) / 旋回する群れ (8 機が 2 つの輪で逆向きに回って撃つ)。
  // 全滅させれば撃破 (ボスボーナス)、escape 秒たつと去っていく (ボーナスなしで次へ)
  spawnBossGroup(def) {
    const g = { type: def.type, t: 0, escape: def.escape || 30, total: 0, kills: 0, leaving: false };
    this.bossGroup = g;
    const before = this.enemies.length;
    if (def.type === 'squad') {
      const P = this.lastPlayer || new THREE.Vector3();
      this.spawnMechTrio(P.x - 10);
      this.spawnMechTrio(P.x + 10);
      for (const e of this.enemies.slice(before)) {
        e.hp = Math.round(e.hp * 1.6);
        e.group.regroup = true; // 攻撃し終えたら下がって、また攻めてくる
      }
    } else {
      for (let i = 0; i < 8; i++) {
        const { mesh, mats, flashMeshes } = makeFighter(true);
        mesh.scale.setScalar(FIGHTER_SCALE * 1.2);
        const e = {
          kind: 'fighter', mesh, mats, flashMeshes, r: 3.4, hp: 6 + this.level, score: 500,
          t: 0, fireT: rand(1, 3), flash: 0, state: 'orbit', ring: i % 2, slot: Math.floor(i / 2), yaw: 0, bank: 0, lastX: 0,
        };
        mesh.position.set(0, 10, SPAWN_Z);
        this.addEnemy(e, 1.8 * FIGHTER_SCALE);
      }
    }
    for (const e of this.enemies.slice(before)) e.bossGroup = g;
    g.total = this.enemies.length - before;
  }

  updateBossGroup(dt, ctx) {
    const g = this.bossGroup;
    if (!g) return;
    g.t += dt;
    const alive = this.enemies.filter((e) => e.bossGroup === g && !e.dead);
    if (!g.leaving && g.t > g.escape) {
      g.leaving = true;
      for (const e of alive) {
        if (e.kind === 'fighter') e.state = 'leave';
        if (e.kind === 'mech') { e.group.regroup = false; e.group.phase = 'retreat'; }
      }
    }
    // 群れの急降下: 4 機倒したか 15 秒たったら、輪から 1 機ずつ (前の 1 機が戻ってから)
    if (g.type === 'swarm' && !g.leaving && !ctx.side && (g.kills >= 4 || g.t > 15)) {
      if (g.diver?.dead) g.diver = null;
      g.diveGap = (g.diveGap ?? 0) - dt;
      if (!g.diver && g.diveGap <= 0) {
        const ready = alive.filter((o) => o.state === 'orbit');
        const d = ready[Math.floor(Math.random() * ready.length)];
        if (d) {
          g.diver = d;
          g.diveN = (g.diveN || 0) + 1;
          d.state = 'swarmWarn';
          d.st = 0;
          d.diveSide = g.diveN % 2 ? 1 : -1; // 左右交互
          sfx.screech();
          g.diveGap = 1.2;
        }
      }
    }
    // ロボの壁: 3 機倒したか 16 秒たったら 1 回だけ (残りが 1 機だけのときは使わない)
    if (g.type === 'squad' && !g.wallUsed && !g.leaving && !ctx.side && (g.kills >= 3 || g.t > 16) && alive.length >= 2) {
      g.wallUsed = true;
      this.startMechWall(g, alive, ctx);
    }
    const W = g.wall;
    if (W) {
      W.t += dt;
      if (W.t >= 2.5) W.z += 20 * dt; // まっすぐ毎秒 20 m (追わない)
      W.guide.position.set(W.gapX, 0.1, W.z + 6);
      W.guide.material.opacity = 0.35 + 0.25 * Math.abs(Math.sin(W.t * 5));
      // 列がうしろへ抜けたら、もとの攻め方に戻る
      if (W.z > ctx.player.z + 20 || alive.length === 0) {
        this.scene.remove(W.guide);
        W.guide.geometry.dispose();
        W.guide.material.dispose();
        g.wall = null;
        for (const o of alive) {
          o.wallX = undefined;
          o.noHit = o.noLock = false;
          o.mesh.visible = o.shadow.visible = true;
          o.fired = 0;
          o.z = SPAWN_Z * 0.6 - (o.role || 0) * 9;
          o.mesh.position.z = o.z;
          o.off.set(0, 0);
          o.offTo.set(0, 0);
          this.setMechEye(o, false);
          o.group.phase = 'approach';
          o.group.at = 0;
        }
      }
    }
    // 長いボスの途中で 1 回だけ回復 (体力が半分を切ったとき)
    if (g.ratio && !g.healed && HEAL_HALF.has(g.type) && g.ratio() < 0.5) {
      g.healed = true;
      const P = this.lastPlayer || new THREE.Vector3();
      this.spawnItem(new THREE.Vector3(P.x, Math.max(3, P.y), -60));
    }
    // 倒すまで進めないボスでも、180 秒で逃げた扱いにする (面が止まらない保険)
    if (g.escape === Infinity && !g.endure && g.t > 180) for (const e of alive) e.dead = true;
    // 保険: 逃げ始めて 8 秒たっても残っていたら消す (どのボスでも面が止まらないように)
    if (g.leaving && g.t > g.escape + 8) for (const e of alive) e.dead = true;
    if ((alive.length === 0 || (g.leaving && g.t > g.escape + 8)) && g.t > 1) {
      this.bossGroup = null;
      if (g.wall) this.scene.remove(g.wall.guide);
      if (g.kills >= g.total || g.endure) { // endure: 耐えきれば撃破扱い (壊せない母艦)
        this.bossDefeated = true;
        this.lastBossBonus = Math.round((g.bonus ?? 5000) * this.bonusLevel * this.mult);
        this.score += this.lastBossBonus;
      } else {
        this.bossEscaped = true;
      }
    }
  }

  get bossRatio() {
    if (this.boss) return Math.max(0, this.boss.hp / this.boss.maxHp);
    const g = this.bossGroup;
    if (g) return g.ratio ? g.ratio() : (g.total - g.kills) / g.total;
    return null;
  }

  // 節を「背骨」に沿って前の節から一定の距離でついていかせ、そこにうねり (しっぽへ伝わる波) を足して表示する
  followChain(chain, from, startIdx, dt, t) {
    let prevSpine = from.spine, prevR = from.r, prevMesh = from.mesh;
    const amp = 3.2 * (BOSS_SCALE / 2.2);
    chain.forEach((part, k) => {
      const idx = startIdx + k;
      part.spine.z -= 16 * dt; // 少し後ろへ流す
      const d = _a.subVectors(part.spine, prevSpine);
      const len = d.length() || 1;
      part.spine.copy(prevSpine).addScaledVector(d, ((prevR + part.r) * 0.72) / len);
      const a = Math.min(1, idx / 5) * amp; // 頭から離れるほど大きくくねる
      part.mesh.position.copy(part.spine).add(_b.set(Math.sin(t * 3 - idx * 0.55) * a, Math.cos(t * 2.4 - idx * 0.5) * a * 0.6, 0));
      part.mesh.lookAt(prevMesh.position);
      prevSpine = part.spine;
      prevR = part.r;
      prevMesh = part.mesh;
    });
  }

  updateBoss(dt, ctx) {
    const b = this.boss;
    if (!b) return;
    b.t += dt;
    const t = b.t, P = ctx.player;
    // 倒したら、頭からしっぽへ順に爆発させる
    if (b.dying >= 0) {
      b.dying += dt;
      while (b.exploded < b.parts.length && b.dying > b.exploded * 0.11) {
        const part = b.parts[b.exploded++];
        if (part.dead) continue; // 先に壊れた首
        this.explode(part.mesh.position, true);
        part.dead = true;
      }
      if (b.exploded >= b.parts.length && b.dying > b.parts.length * 0.11 + 0.8) {
        this.boss = null;
        this.bossDefeated = true;
      }
      return;
    }

    // 壊れた首: 頭から順に爆発させる (残りは落ちていく)
    for (const L of b.lost || []) {
      L.t += dt;
      for (const part of L.parts) if (!part.dead) part.mesh.position.y -= 8 * L.t * dt;
      while (L.n < L.parts.length && L.t > L.n * 0.12) {
        const part = L.parts[L.n++];
        this.explode(part.mesh.position, L.n === 1);
        part.dead = true;
      }
    }
    if (b.lost) b.lost = b.lost.filter((L) => L.n < L.parts.length);

    // 突進 (二首): 遠くからうなって迫り、プレイヤーの左右の目の前に頭を並べて撃ちまくり、また下がる
    const RUSH_IN = 1.4, RUSH_HOLD = 3.2, RUSH_OUT = 1.4;
    let rushK = 0;
    if (b.twin && !ctx.side) {
      if (b.rush < 0) {
        b.rushT -= dt;
        if (b.rushT <= 0 && t > 8 && !b.lunging && b.heads.every((H) => H.breath <= 0)) {
          b.rush = 0;
          b.volleyT = RUSH_IN;
          sfx.roar();
          sfx.whoosh();
        }
      } else {
        b.rush += dt;
        const r = b.rush;
        rushK = r < RUSH_IN ? THREE.MathUtils.smoothstep(r, 0, RUSH_IN)
          : r < RUSH_IN + RUSH_HOLD ? 1 : 1 - THREE.MathUtils.smoothstep(r, RUSH_IN + RUSH_HOLD, RUSH_IN + RUSH_HOLD + RUSH_OUT);
        if (r > RUSH_IN + RUSH_HOLD + RUSH_OUT) {
          b.rush = -1;
          b.rushT = b.heads.length > 1 ? rand(13, 17) : rand(9, 12); // 首が 1 本になると怒って、よく迫ってくる
        }
      }
    }

    // 頭: それぞれの目標へ向かう。二首は左右に分かれ、動きの位相もずらす
    for (const H of b.heads) {
      if (b.twin && b.heads.length === 1) H.side += (0 - H.side) * Math.min(1, dt); // 1 本になったら真ん中へ寄る
      const target = _d.set(
        P.x * 0.4 + H.side * 11 + 18 * Math.sin(t * 0.62 + H.phase) + 5 * Math.sin(t * 1.9 + H.phase),
        THREE.MathUtils.clamp(P.y + 3 + 6 * Math.sin(t * 1.3 + H.phase) + 2 * Math.sin(t * 2.7 + H.phase), 6, Math.min(32, this.ceilingY)),
        ctx.side ? -20 + 5 * Math.sin(t * 0.41 + H.phase) : -38 + 8 * Math.sin(t * 0.41 + H.phase),
      );
      if (t < 5) target.z = THREE.MathUtils.lerp(ctx.side ? -60 : -200, target.z, t / 5); // 遠くから迫ってくる
      // 突進: プレイヤーの左右、少し前に頭を並べる (ぶつからない距離)
      if (rushK > 0) target.lerp(_e.set(P.x + H.sign * 10, Math.max(4, P.y + 2.5), P.z - 13), rushK);
      // 噛みつき: ときどき目の前まで突っ込んでくる (同時に噛みつくのは 1 つの頭だけ)
      H.lungeT -= dt;
      if (H.lungeT <= 0 && t > 6 && !b.lunging && H.breath <= 0 && !(b.rush >= 0)) {
        H.lungeT = rand(6, 9) * (b.twin ? 1.4 : 1);
        H.lunge = 1.2;
        b.lunging = H;
        sfx.whoosh();
      }
      if (H.lunge > 0) {
        H.lunge -= dt;
        target.set(P.x + (b.twin ? H.sign : 1) * 7, P.y + 3, ctx.side ? P.z - 9 : -14); // 巨大なので少し離れた位置で噛みつく
        if (H.lunge <= 0) b.lunging = null;
      }
      H.head.spine.lerp(target, 1 - Math.exp(-dt * (rushK > 0 ? 8 : H.lunge > 0 ? 3.5 : 2.6)));
      H.head.mesh.position.copy(H.head.spine);
      H.head.mesh.lookAt(P);
      if (!b.twin) this.followChain(H.neck, H.head, 1, dt, t + H.phase);
      // 二首: 体力が半分を切った頭は煙を上げ、3 割を切ると赤く点滅する (どちらの首があと少しで壊れるか分かるように)
      if (b.twin && H.hp < b.maxHp / 4) {
        if (Math.random() < dt * 20) this.smoke.emit(H.head.mesh.position, _b.set(rand(-2, 2), rand(3, 6), rand(-2, 2)), DUST, 3, 1.2, 3, 0.96);
        if (H.hp < b.maxHp * 0.15 && Math.sin(t * 14) > 0) H.head.flash = Math.max(H.head.flash, 0.05);
      }
    }
    if (b.twin) {
      // 付け根: 頭たちのうしろ下。突進のときは胴体ごと迫ってくる
      const hub = b.hub.spine;
      const want = _c.set(0, 0, 0);
      for (const H of b.heads) want.add(H.head.spine);
      want.multiplyScalar(1 / b.heads.length).add(_b.set(0, -2, -14));
      if (rushK > 0) want.lerp(_b.set(P.x, Math.max(5, P.y), P.z - 32), rushK);
      hub.lerp(want, 1 - Math.exp(-dt * 2));
      for (const H of b.heads) { // 首が伸びきらないように、離れすぎた頭のほうへ寄る
        const d = hub.distanceTo(H.head.spine);
        if (d > 30) hub.lerp(H.head.spine, (d - 30) / d);
      }
      // 首: 頭から付け根まで曲線でかけ渡す (外側へふくらませ、少しうねらせる)。最後の節が付け根に重なる
      for (const H of b.heads) {
        const a = H.head.mesh.position, n = H.neck.length;
        const ctrl = _d.addVectors(a, hub).multiplyScalar(0.5).add(_b.set(H.side * 4, 3, 0));
        H.neck.forEach((part, k) => {
          const u = (k + 1) / n, v = 1 - u;
          part.spine.set(0, 0, 0).addScaledVector(a, v * v).addScaledVector(ctrl, 2 * u * v).addScaledVector(hub, u * u);
          const w = Math.sin(Math.PI * u) * 1.6; // 両端は動かさない
          part.mesh.position.copy(part.spine).add(_b.set(Math.sin(t * 3 + H.phase - k * 0.7) * w, Math.cos(t * 2.4 + H.phase - k * 0.6) * w * 0.6, 0));
          part.mesh.lookAt(k ? H.neck[k - 1].mesh.position : a);
        });
      }
    }
    // 胴体の先 (二首なら首の付け根) から胴体をつなげる
    const root = b.twin ? b.hub : b.heads[0].head;
    this.followChain(b.body, root, b.twin ? 5 : 1, dt, t);

    if (!ctx.active || t < 5) return;
    if (b.rush >= 0) {
      // 突進中は、左右の頭がかわるがわる目の前から扇の弾を撃つ (真ん中は少し外す)
      if (b.rush > RUSH_IN && b.rush < RUSH_IN + RUSH_HOLD) {
        b.volleyT -= dt;
        if (b.volleyT <= 0) {
          b.volleyT = Math.max(0.35, 0.6 - this.level * 0.03) * (b.heads.length > 1 ? 1 : 0.8);
          b.volleyN = (b.volleyN || 0) + 1;
          const H = b.heads[b.volleyN % b.heads.length], head = H.head;
          const from = _c.copy(head.mesh.position).add(_b.set(0, -0.5, 2.5).multiplyScalar(BOSS_SCALE).applyQuaternion(head.mesh.quaternion));
          const n = b.hp < b.maxHp * 0.5 ? 6 : 4;
          for (let k = 0; k < n; k++) this.fireBullet(from.clone(), P, (k - (n - 1) / 2) * 0.16);
        }
      }
      return; // 突進中はほかの攻撃をしない
    }
    for (const H of b.heads) {
      const head = H.head;
      // 光の帯: ときどき口の核から光を噴き出す (首を振るので、帯が左右に流れる)
      H.breathT -= dt;
      if (H.breathT <= 0 && H.lunge <= 0 && !b.heads.some((o) => o !== H && o.breath > 0)) {
        H.breathT = rand(4.5, 6.5) / (1 + (this.level - 1) * 0.1) * (b.twin ? 1.3 : 1);
        H.breath = 1.6;
        sfx.fireBreath();
      }
      if (H.breath > 0) {
        H.breath -= dt;
        H.flameT -= dt;
        const mouth = _c.set(0, -0.35, 2.9).multiplyScalar(BOSS_SCALE).applyQuaternion(head.mesh.quaternion).add(head.mesh.position);
        while (H.flameT <= 0) {
          H.flameT += 0.04;
          const sway = Math.sin(t * 2.2 + H.phase) * 0.25;
          this.fireBullet(mouth.clone(), _b.copy(P).add(_a.set(rand(-1.5, 1.5), rand(-1, 1), 0)), sway, 'fire', H.hue);
        }
        continue; // 光の帯を吐いている頭は、ほかの攻撃をしない
      }
      // 頭から扇形に撃つ
      H.fireT -= dt;
      if (H.fireT <= 0) {
        H.fireT = Math.max(0.7, 1.6 - this.level * 0.12) * (b.twin ? 1.5 : 1);
        const n = b.hp < b.maxHp * 0.5 ? 5 : 3;
        const from = _c.copy(head.mesh.position).add(_b.set(0, -0.5, 2.5).multiplyScalar(BOSS_SCALE).applyQuaternion(head.mesh.quaternion));
        for (let k = 0; k < n; k++) this.fireBullet(from.clone(), P, (k - (n - 1) / 2) * 0.13);
      }
    }
    // 体力が半分を切ると、胴体からも撃ってくる
    if (b.hp < b.maxHp * 0.5) {
      b.segFireT -= dt;
      if (b.segFireT <= 0) {
        b.segFireT = Math.max(0.35, 0.9 - this.level * 0.08);
        const part = b.body[Math.floor(Math.random() * b.body.length)];
        this.fireBullet(part.mesh.position.clone(), P);
      }
    }
  }

  // まとめて描く弾 (光る弾・光線) の位置を、描画用の InstancedMesh へ書き写す
  drawPools() {
    for (const list of Object.values(this.pools)) list.forEach((p) => p.begin());
    for (const o of [...this.bullets, ...this.shots]) {
      const key = o.mesh.userData.pool;
      if (key) for (const p of this.pools[key]) p.push(o.mesh);
    }
    for (const list of Object.values(this.pools)) list.forEach((p) => p.end());
  }

  // ---- 発射
  // style: 'beam' (宇宙船の光線)、'fireball' (ランナーの火の玉。火の粉を散らして飛ぶ)
  fireGun(origin, target, style = 'beam') {
    const dir = _d.subVectors(target, origin).normalize();
    let m, speed = GUN_SPEED;
    if (style === 'fireball') {
      m = new THREE.Mesh(GEO.fireball, MAT.fireballCore);
      m.add(new THREE.Mesh(GEO.fireballHalo, MAT.fireballHalo));
      speed = FIREBALL_SPEED;
    } else {
      m = new THREE.Object3D(); // 光線は pools.shot でまとめて描く
      m.userData.pool = 'shot';
    }
    m.position.copy(origin);
    m.lookAt(_a.copy(origin).add(dir));
    this.scene.add(m);
    this.shots.push({ mesh: m, pos: origin.clone(), prev: origin.clone(), vel: dir.clone().multiplyScalar(speed), life: 1.3, fireball: style === 'fireball' });
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

  // type: 'orb' (光る弾)、'ring' (晶洞岩の光の輪、遅いが大きい)、'shell' (バズーカ、煙を引く)
  // quiet: 発射音を鳴らさない (弾幕で一度にたくさん撃つとき。音は呼ぶ側で 1 回だけ鳴らす)
  fireBullet(from, at, spread = 0, type = 'orb', hue = null, quiet = false) {
    const dir = _d.subVectors(at, from).normalize();
    if (spread) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
    let m, speed = 34 * (this.hard ? 1.35 : 1), r = 0.45; // 難しいモードは敵の弾が速い
    let mats = null;
    if (type === 'fireball') {
      m = new THREE.Mesh(GEO.fireball, MAT.fireballCore);
      m.add(new THREE.Mesh(GEO.fireballHalo, MAT.fireballHalo));
      m.scale.setScalar(1.6);
      speed = 30;
      r = 0.8;
    } else if (type === 'fire') {
      // 炎 (hue があればボスの光の帯): 進むにつれて大きく膨らみ、薄れていく
      const mat = MAT.fire.clone();
      if (hue != null) mat.color.setHSL(hue + rand(-0.04, 0.04), 0.9, rand(0.6, 0.75));
      else mat.color.setHSL(rand(0.02, 0.1), 1, rand(0.5, 0.65));
      m = new THREE.Mesh(GEO.bullet, mat);
      mats = [mat];
      speed = rand(30, 38);
      r = 1.0;
    } else if (type === 'ring') {
      m = new THREE.Mesh(GEO.ring, MAT.ring);
      speed = 22;
      r = 0.9;
    } else if (type === 'glint') {
      m = new THREE.Mesh(GEO.bullet, MAT.glint);
      m.add(new THREE.Mesh(GEO.bulletHalo, MAT.glintHalo));
      speed = 38;
    } else if (type === 'shell') {
      m = new THREE.Mesh(GEO.shell, MAT.shell);
      m.add(new THREE.Mesh(GEO.bulletHalo, MAT.bulletHalo));
      speed = 27;
      r = 0.7;
    } else {
      m = new THREE.Object3D(); // 光る弾は pools.orb でまとめて描く (弾幕で何十発も出るため)
      m.userData.pool = 'orb';
    }
    m.position.copy(from);
    m.lookAt(_a.copy(from).add(dir));
    this.scene.add(m);
    this.bullets.push({ mesh: m, vel: dir.clone().multiplyScalar(speed), r, life: type === 'fire' ? 2.4 : 9, age: 0, type, puffT: 0, mats });
    if (type !== 'fire' && !quiet) sfx.enemyShot();
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

  // 二首のボスの首を 1 本壊す (頭から付け根へ順に爆発)。残った首は真ん中へ寄り、怒ってよく迫ってくる
  breakBossHead(b, H) {
    H.dead = true;
    b.heads = b.heads.filter((h) => h !== H);
    if (b.lunging === H) b.lunging = null;
    b.lost.push({ parts: [H.head, ...H.neck], t: 0, n: 0 });
    for (const part of [H.head, ...H.neck]) part.noLock = part.noHit = true;
    b.rushT = Math.min(b.rushT, 4);
    const bonus = Math.round(3000 * this.bonusLevel * this.mult);
    this.score += bonus;
    this.announce = `HEAD BREAK!  +${bonus}`; // 首を 1 本壊したことを、はっきり見せる
    this.kills++;
    sfx.explode(true);
    sfx.roar();
  }

  damage(e, amount) {
    e.flash = 0.08;
    if (e.kind === 'boss') {
      const b = e.boss;
      if (b.dying >= 0) return;
      const dmg = amount * (e.isHead ? 1.5 : 0.5); // 頭が弱点。胴体の節は硬い
      sfx.hit();
      if (b.twin) {
        // 二首: 首ごとに体力を持つ (胴体に当てると、体力の多いほうの首が減る)。片方の体力がなくなると、その首が壊れる
        const H = e.owner || b.heads.reduce((x, y) => (y.hp > x.hp ? y : x));
        if (H.dead) return;
        H.hp -= dmg;
        if (H.hp <= 0 && b.heads.length > 1) this.breakBossHead(b, H);
        b.hp = b.heads.reduce((sum, h) => sum + Math.max(0, h.hp), 0);
      } else {
        b.hp -= dmg;
      }
      if (b.hp <= 0) {
        b.dying = 0;
        this.lastBossBonus = Math.round(10000 * this.bonusLevel * this.mult);
        this.score += this.lastBossBonus;
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
    if (e.bossGroup) e.bossGroup.kills++;
    this.score += Math.round(e.score * this.mult);
    this.kills++;
    const big = ['gunship', 'mech', 'moai', 'ptero'].includes(e.kind) || EXTRA[e.kind]?.heavy || EXTRA[e.kind]?.big;
    this.explode(e.mesh.position, !!big);
    if (e.kind === 'pill') this.splitPill(e);
    EXTRA[e.kind]?.onDeath?.(this, e);
    if ((['gunship', 'mech', 'moai'].includes(e.kind) || EXTRA[e.kind]?.big) && !e.noItem && Math.random() < 0.35) this.spawnItem(e.mesh.position);
  }

  // ---- 毎フレーム
  // ctx: { dt, scroll, spawn (新しい敵を出すか), active (敵に攻撃させるか), player: Vector3 (当たり判定の中心), playerR, eye, world,
  //        side / planeX (横スクロールのとき、敵をそろえる平面の x),
  //        aimOrigin / aimDir (ロックオンの向き), guns: [{ origin, aimOrigin, aimDir }], firing,
  //        missile (押した瞬間), missileOrigin, showAim, halfHeight, onPlayerHit }
  update(ctx) {
    const { dt, scroll } = ctx;
    this.time += dt;
    this.sideMode = !!ctx.side;

    // 出現
    if (ctx.spawn) {
      this.spawn.wave -= dt;
      if (this.spawn.wave <= 0) {
        this.spawn.wave = rand(3.5, 5.5) / (this.density || 1) * (ctx.side ? 0.7 : 1); // 横スクロールは少し多めに出す
        this.spawnWave(ctx.player.x, ctx.player.y);
      }
    }
    this.lastPlayer = ctx.player;
    if (ctx.spawn) this.stageT += dt; // 面の通常の区間が始まってからの時間
    this.updateBoss(dt, ctx);
    this.updateBossGroup(dt, ctx);
    this.updateItems(dt, scroll, ctx);

    // 敵の動き
    for (const e of this.enemies) {
      e.t += dt;
      if (e.display) { this.updateShowcase(e, dt, ctx); continue; } // エンディングの紹介 (動かず、撃たず、当たらない)
      const p = e.mesh.position;
      const z0 = p.z;
      if (e.kind === 'boss') {
        // updateBoss で動かす
      } else if (e.kind === 'moai') {
        p.z += scroll * dt; // 地面と一緒に流れてくる
        e.mesh.rotation.y = Math.atan2(ctx.player.x - p.x, ctx.player.z - p.z); // こちらを向く
        // 撃つ少し前に上の殻が開き始め、撃ったあともしばらく開いている (開いている間だけ倒せる)
        e.openT -= dt;
        const wantOpen = e.fireT < 0.9 || e.openT > 0 ? 1 : 0;
        e.mouth += THREE.MathUtils.clamp(wantOpen - e.mouth, -dt * 2.5, dt * 3);
        if (e.jaw) e.jaw.rotation.x = 1.15 * e.mouth;
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
      } else if (e.kind === 'ptero') {
        this.updatePtero(e, dt, scroll, ctx);
      } else if (e.kind === 'pill') {
        this.updatePillShell(e, dt, ctx);
        const closed = e.open < 0.05;
        if (e.mode === 'tri' && e.t < 14) {
          // 三角形の編隊: 正面で三角形に並んで回る
          const cz = THREE.MathUtils.lerp(SPAWN_Z, ctx.side ? -16 : -40, Math.min(1, e.t / 4));
          const a = (e.slot / 3) * Math.PI * 2 + e.t * 0.5 + Math.PI / 2;
          const R = ctx.side ? 5 : 7;
          e.cx += (ctx.player.x - e.cx) * Math.min(1, dt * 0.8);
          p.set(e.cx + Math.cos(a) * R, Math.max(2.5, e.cy + Math.sin(a) * R), cz);
          if (closed) e.mesh.rotation.x -= 3 * dt;
        } else if (e.mode === 'tri') {
          // しばらくすると、そろって転がりながら突っ込んでくる
          e.openTo = 0;
          p.z += (scroll * 0.5 + 40) * dt;
          p.y = Math.max(1.5 * PILL_SCALE, p.y - 8 * dt);
          e.mesh.rotation.x -= 12 * dt;
        } else {
          // 地面を転がってくる。殻を開いている間は止まって (地面と一緒に流れて) 玉を吐く
          p.z += (scroll + (closed ? 24 : -scroll * 0.6)) * dt;
          if (closed) {
            const want = ctx.player.x + Math.sin(e.t * 2.2) * Math.max(4, -p.z * 0.35);
            e.x += THREE.MathUtils.clamp(want - e.x, -16 * dt, 16 * dt);
            e.mesh.rotation.x -= ((scroll + 24) / (1.5 * PILL_SCALE)) * dt;
          }
          p.set(e.x, 1.5 * PILL_SCALE, p.z);
        }
      } else if (e.kind === 'pillpart') {
        // 割れた節: はじけ飛んだあと、プレイヤーへ向かってくる
        // 一度プレイヤーの横を過ぎたら、もう追わない (後ろから戻ってくると、よけられないため)
        if (p.z > ctx.player.z - 6) e.noHome = true;
        if (e.noHome) {
          e.vel.z = Math.max(e.vel.z, 25);
          // 横向きの勢いも止めて、まっすぐ後ろへ抜ける (斜め後ろから寄ってこないように)
          const k = Math.exp(-dt * 8);
          e.vel.x *= k;
          e.vel.y *= k;
        } else {
          const want = _a.subVectors(ctx.player, p).normalize().multiplyScalar(40);
          e.vel.lerp(want, Math.min(1, dt * (e.t > 0.5 ? 2.4 : 0.2)));
        }
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
          const hz = this.holdZ(-40);
          e.z = Math.min(hz, e.z + (scroll * 0.5 + 26) * dt);
          if (e.z >= hz) e.hover += dt;
          p.set(ctx.player.x * 0.3 + e.x * 0.7 + Math.sin(e.t * 0.9) * 14, e.y + Math.sin(e.t * 1.6) * 3, e.z);
        } else {
          // 去っていく (上昇しながら遠ざかる)
          p.y += 9 * dt;
          p.z -= 25 * dt;
          if (p.y > 45) e.dead = true;
        }
        e.mesh.rotation.z = Math.sin(e.t * 0.7) * 0.15;
      } else if (EXTRA[e.kind]) {
        EXTRA[e.kind].update(this, e, dt, scroll, ctx, p);
      }
      if (ctx.planeX !== undefined && ctx.planeX !== null) p.x = ctx.planeX; // 横スクロール: 同じ平面にそろえる
      if (ctx.side && e.kind !== 'boss' && !EXTRA[e.kind]?.sideAbs) { // 毎フレーム位置を決め直す部品は縮めない
        p.z = z0 + (p.z - z0) * SIDE_Z_SCALE;
        if (typeof e.z === 'number') e.z = p.z;
      }
      if (p.z > REMOVE_Z) e.dead = true;
      e.shadow.position.set(p.x, 0.05, p.z);
      // 出現音: 敵が見え始めたとき (150 m より近づいたとき) に、種類ごとの音を鳴らす (同じ種類は 2 秒に 1 回まで)
      if (!e.announced && e.kind !== 'boss' && !e.bossGroup && p.z > ctx.player.z - 150 && p.y > -2) {
        e.announced = true;
        if ((this.appearAt[e.kind] ?? -9) < this.time - 2) {
          this.appearAt[e.kind] = this.time;
          sfx.appear(e.kind);
        }
      }
      if (!e.whooshed && e.kind !== 'boss' && p.distanceTo(ctx.eye) < e.r + 9) {
        e.whooshed = true;
        sfx.whoosh();
      }

      // 被弾したら一瞬白く光らせる
      e.flash -= dt;
      applyFlash(e);

      // 敵の攻撃
      e.fireT -= dt;
      const inRange = ctx.side ? p.z > -30 && p.z < -6 : p.z > -170 && p.z < -35; // 撃ってよい距離 (横スクロールは画面の中)
      if (ctx.active && e.kind !== 'boss' && e.fireT <= 0 && inRange) {
        const lv = 1 + (this.level - 1) * 0.2;
        if (e.kind === 'fighter') {
          e.fireT = rand(3, 6) / lv;
          if (Math.random() < 0.5) this.fireBullet(p, ctx.player);
        } else if (e.kind === 'moai') {
          // 口を開けてリングを吐く
          e.fireT = rand(2.4, 3.4) / lv;
          e.openT = 1.0;
          const mouth = _b.set(0, 0.7, 0.5).multiplyScalar(MOAI_SCALE).applyQuaternion(e.mesh.quaternion).add(p);
          this.fireBullet(mouth.clone(), ctx.player, 0, 'ring');
        } else if (e.kind === 'ptero') {
          // 上空を横切りながら、口から火の玉を吐く
          e.fireT = rand(1.8, 3) / lv;
          if (e.state === 'glide') {
            const mouth = _b.set(0, 0.5, 3.2).multiplyScalar(PTERO_SCALE).applyQuaternion(e.mesh.quaternion).add(p);
            this.fireBullet(mouth.clone(), ctx.player, 0, 'fireball');
          }
        } else if (e.kind === 'gunship') {
          e.fireT = 1.6;
          for (const sp of [-0.12, 0, 0.12]) this.fireBullet(_b.copy(p).add(_c.set(0, -0.2, 3)), ctx.player, sp);
        } else if (EXTRA[e.kind]?.fire) {
          EXTRA[e.kind].fire(this, e, ctx, p, lv);
        }
      }
      if (!e.dead && !e.noHit && p.distanceTo(ctx.player) < e.r + ctx.playerR) { // noHit: 今は当たらない (うしろにいる回転刃など)
        ctx.onPlayerHit(e.kind === 'boss' ? 30 : e.dmg ?? (SMALL_KINDS.has(e.kind) ? 15 : 25)); // 小さい敵の体当たりは軽め
        // 体当たりしてくる敵は、ぶつかったら自分も爆発する
        if (e.kind === 'gremlin' || e.kind === 'pillpart' || e.kind === 'pill' || EXTRA[e.kind]?.kamikaze) {
          e.dead = true;
          this.explode(p);
        }
      }
    }

    // 敵弾
    const flat = ctx.planeX !== undefined && ctx.planeX !== null;
    for (const b of this.bullets) {
      if (flat) b.vel.x = 0;
      _e.copy(b.mesh.position);
      b.mesh.position.addScaledVector(b.vel, dt * (flat ? SIDE_BULLET_SCALE : 1));
      if (flat) b.mesh.position.x = ctx.planeX;
      // 障害物に当たった弾は止まる (柱や石板の陰に隠れてよけられる)。炎・光の帯は止まらない
      if (ctx.world && b.type !== 'fire' && ctx.world.shotTest(_e, b.mesh.position, _f, true)) {
        b.dead = true;
        this.sparks.emit(_f, _c.set(0, 2, 0), WHITE, 0.5, 0.12);
        continue;
      }
      b.life -= dt;
      b.age += dt;
      if (b.type === 'fire') {
        const k = b.age / 2.4;
        b.mesh.scale.setScalar(1.5 + k * 7);
        // カメラのすぐ近くでは薄くする (目の前で画面が真っ白にならないように)
        const near = THREE.MathUtils.clamp((b.mesh.position.distanceTo(ctx.eye) - 3) / 10, 0.15, 1);
        b.mats[0].opacity = 0.9 * (1 - k) * near;
        b.r = 1.0 + k * 2.5;
        if ((b.puffT -= dt) <= 0) {
          b.puffT = 0.05;
          this.sparks.emit(b.mesh.position, _c.set(rand(-3, 3), rand(-1, 4), rand(-3, 3)), b.mats[0].color, 1.2, 0.35);
        }
      } else if (b.type === 'ring') {
        b.mesh.rotateZ(dt * 6);
        b.mesh.scale.setScalar(1 + Math.sin(this.time * 12) * 0.12);
      } else {
        b.mesh.scale.setScalar(1 + Math.sin(this.time * 30) * 0.15);
      }
      if (b.type === 'fireball') {
        b.mesh.scale.setScalar(1.6 + Math.sin(this.time * 35) * 0.2);
        this.sparks.emit(b.mesh.position, _c.set(rand(-2, 2), rand(-1, 3), rand(-2, 2)), FIRE_COL, 1.0, 0.25);
      }
      if (b.type === 'shell' && (b.puffT -= dt) <= 0) {
        b.puffT = 0.03;
        this.smoke.emit(b.mesh.position, _c.set(0, 0, 0), DUST, 0.8, 0.7, 2, 0.98);
      }
      if (b.life <= 0 || b.mesh.position.z > REMOVE_Z) b.dead = true;
      else if (b.mesh.position.distanceTo(ctx.player) < b.r + ctx.playerR) {
        b.dead = true;
        ctx.onPlayerHit(b.type === 'shell' ? 20 : b.type === 'ring' ? 18 : b.type === 'fire' || b.type === 'glint' ? 10 : b.type === 'fireball' ? 15 : 12);
      }
    }

    // 機関砲
    this.gunT -= dt;
    if (ctx.firing && ctx.guns?.length && this.gunT <= 0) {
      this.gunT = 0.085;
      // 銃ごとに { origin: 銃口, aimOrigin / aimDir: 狙う向き }。銃口から照準の 90m 先へ撃つ
      const g = ctx.guns[this.gunSide++ % ctx.guns.length];
      // 照準の近くに敵がいれば、その敵へ向ける (エイムアシスト)
      let near = this.nearestInCone(g.aimOrigin, g.aimDir, 0.08);
      if (near?.noAssist) near = null; // ミラーコアの核は、見えている所を狙って撃つ (中心へ曲げると鏡に当たる)
      // 動いている敵は、弾が届くまでに進む分だけ先を狙う (先読み)
      const aimAt = near ? near.mesh.position.clone() : g.aimOrigin.clone().addScaledVector(g.aimDir, 90);
      if (near?.vel) aimAt.addScaledVector(near.vel, g.origin.distanceTo(aimAt) / (ctx.gunStyle === 'fireball' ? FIREBALL_SPEED : GUN_SPEED)); // 火の玉は遅いので、その分先を狙う
      this.fireGun(g.origin, aimAt, ctx.gunStyle);
      sfx.shot();
    }
    for (const s of this.shots) {
      s.prev.copy(s.pos);
      s.pos.addScaledVector(s.vel, dt);
      s.mesh.position.copy(s.pos);
      s.life -= dt;
      if (s.fireball) {
        // 火の玉: ゆらめきながら火の粉を散らす
        s.mesh.scale.setScalar(1 + Math.sin(this.time * 40 + s.life * 20) * 0.15);
        this.sparks.emit(s.pos, _c.set(rand(-2, 2), rand(-2, 2), rand(-2, 2)), FIRE_COL, 0.7, 0.15);
      }
      if (s.life <= 0) { s.dead = true; continue; }
      for (const b of this.bullets) {
        if (!b.dead && b.type !== 'fire' && b.type !== 'glint' && segHit(s.prev, s.pos, b.mesh.position, b.r + 0.3)) { // 炎・光の帯・鏡の光は撃ち落とせない
          b.dead = s.dead = true;
          this.score += 10;
          this.explode(b.mesh.position);
          break;
        }
      }
      if (s.dead) continue;
      for (const e of this.enemies) {
        if (!e.dead && !s.ricochet && segHit(s.prev, s.pos, e.mesh.position, e.r)) {
          if (EXTRA[e.kind]?.reflect) {
            // 鏡: 当たった弾を、プレイヤーへ撃ち返す (撃ち返しはボス全体で 0.6 秒に 1 発まで。ほかは鏡に吸われる)
            s.dead = true;
            this.sparks.emit(s.pos, _b.set(0, 3, 4), WHITE, 0.8, 0.2);
            const host = e.core || e;
            if (host.reflectT <= 0) {
              host.reflectT = host.reflectEvery ?? 0.6;
              this.fireBullet(s.pos.clone(), ctx.player, 0, 'glint');
              sfx.ricochet();
            }
            break;
          }
          if (this.pillShielded(e)) {
            // 跳ね返る: 当たった面で反射して、弱く飛んでいく (もう当たらない)
            const n = _a.subVectors(s.pos, e.mesh.position).normalize();
            s.vel.reflect(n).multiplyScalar(0.5);
            s.ricochet = true;
            s.life = Math.min(s.life, 0.35);
            this.sparks.emit(s.pos, _b.copy(n).multiplyScalar(6), WHITE, 0.7, 0.2);
            sfx.ricochet();
            break;
          }
          s.dead = true;
          this.damage(e, 1);
          break;
        }
      }
      if (s.dead || !ctx.world) continue;
      const o = ctx.world.shotTest(s.prev, s.pos, _d); // 障害物の形 (部品) で当たりを見る
      if (o) {
        const c = _d;
        s.dead = true;
        if (o.hitPart.breakable) {
          // 壊せる部品 (アーチの上の宝石): その部品だけ消す
          o.group.remove(o.hitPart.mesh);
          o.parts = o.parts.filter((pt) => pt !== o.hitPart);
          this.score += Math.round(100 * this.mult);
          this.explode(c);
        } else if (o.breakable) {
          o.dead = true;
          this.score += Math.round(50 * this.mult);
          this.explode(c);
        } else {
          this.sparks.emit(c, _b.set(0, 2, 2), WHITE, 0.6, 0.15);
        }
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
      // ミサイルも鏡に当たると砕ける (ダメージなし)
      const mirror = this.enemies.find((e) => !e.dead && EXTRA[e.kind]?.reflect && m.pos.distanceTo(e.mesh.position) < e.r);
      if (mirror) {
        m.dead = true;
        sfx.ricochet();
        this.explode(m.pos);
      } else if (m.target && !m.target.dead && m.pos.distanceTo(m.target.mesh.position) < m.target.r + 1) {
        m.dead = true;
        if (this.pillShielded(m.target)) sfx.ricochet();
        else this.damage(m.target, 4);
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
    this.drawPools();

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
      if (e.dead || e.noLock || exclude.includes(e) || EXTRA[e.kind]?.shielded?.(e)) continue; // 盾のある敵 (いま倒せない) にはロックしない
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
