// 戦闘: 敵、敵弾、自機の機関砲、ロックオン、追尾ミサイル、爆発と煙
import * as THREE from 'three';
import { sfx } from './audio.js';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;
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
  bulletHalo: new THREE.SphereGeometry(0.75, 10, 8),
  mBody: new THREE.CylinderGeometry(0.08, 0.08, 1.1, 8).rotateX(Math.PI / 2),
  mTip: new THREE.ConeGeometry(0.08, 0.3, 8).rotateX(-Math.PI / 2),
  mFin: new THREE.BoxGeometry(0.4, 0.02, 0.2),
  shadow: new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2),
};
const MAT = {
  shot: new THREE.MeshBasicMaterial({ color: 0x9ffcff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  bullet: new THREE.MeshBasicMaterial({ color: 0xffd040 }),
  bulletHalo: new THREE.MeshBasicMaterial({ color: 0xff5010, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
  missile: new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4 }),
  missileTip: new THREE.MeshStandardMaterial({ color: 0xd02020, roughness: 0.4 }),
  eye: new THREE.MeshBasicMaterial({ color: 0xff3020 }),
  shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
};

function makeFighter() {
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
    this.spawn = { fighter: 3, gunship: 14 };
    this.time = 0;
    this.score = 0;
    this.kills = 0;
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
    for (const list of [this.enemies, this.bullets, this.shots, this.missiles]) {
      list.forEach((o) => this.remove(o));
      list.length = 0;
    }
    this.locks = [];
    this.missileStock = MISSILE_MAX;
    this.spawn = { fighter: 3, gunship: 14 };
    this.time = 0;
    this.score = 0;
    this.kills = 0;
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
    const cx = px + rand(-10, 10), cy = THREE.MathUtils.clamp(py + rand(-1, 5), 3, 12);
    const amp = rand(4, 10), w = rand(0.8, 1.5), pattern = Math.random() < 0.5 ? 'weave' : 'spiral';
    for (let k = 0; k < n; k++) {
      const { mesh, mats } = makeFighter();
      const e = {
        kind: 'fighter', mesh, mats, r: 1.6, hp: 1, score: 100,
        t: -k * 0.35, cx, cy, amp, w, pattern, phase: k * 0.5, z: SPAWN_Z - k * 9,
        fireT: rand(1.5, 4), flash: 0,
      };
      this.addEnemy(e, 1.8);
    }
  }

  spawnGunship(px, py) {
    const { mesh, mats } = makeGunship();
    const e = {
      kind: 'gunship', mesh, mats, r: 3.2, hp: 8, score: 1000,
      t: 0, x: px + rand(-6, 6), y: THREE.MathUtils.clamp(py + rand(1, 5), 4, 12), z: SPAWN_Z,
      hover: 0, fireT: 2, flash: 0,
    };
    this.addEnemy(e, 3.5);
  }

  addEnemy(e, shadowR) {
    e.shadow = new THREE.Mesh(GEO.shadow, MAT.shadow);
    e.shadow.scale.setScalar(shadowR);
    this.scene.add(e.mesh, e.shadow);
    this.enemies.push(e);
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

  fireBullet(from, at, spread = 0) {
    const dir = _d.subVectors(at, from).normalize();
    if (spread) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
    const m = new THREE.Mesh(GEO.bullet, MAT.bullet);
    m.add(new THREE.Mesh(GEO.bulletHalo, MAT.bulletHalo));
    m.position.copy(from);
    this.scene.add(m);
    this.bullets.push({ mesh: m, vel: dir.clone().multiplyScalar(34), r: 0.45, life: 8 });
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
    e.hp -= amount;
    e.flash = 0.08;
    if (e.hp > 0) {
      sfx.hit();
      return;
    }
    e.dead = true;
    this.score += e.score;
    this.kills++;
    this.explode(e.mesh.position, e.kind === 'gunship');
  }

  // ---- 毎フレーム
  // ctx: { dt, scroll, active (敵を出して攻撃させるか), player: Vector3 (当たり判定の中心), playerR, eye,
  //        aimOrigin / aimDir (ロックオンの向き), guns: [{ origin, aimOrigin, aimDir }], firing,
  //        missile (押した瞬間), missileOrigin, showAim, halfHeight, onPlayerHit }
  update(ctx) {
    const { dt, scroll } = ctx;
    this.time += dt;

    // 出現
    if (ctx.active) {
      this.spawn.fighter -= dt;
      this.spawn.gunship -= dt;
      if (this.spawn.fighter <= 0) {
        this.spawn.fighter = rand(3.5, 6);
        this.spawnFighterWave(ctx.player.x, ctx.player.y);
      }
      if (this.spawn.gunship <= 0) {
        this.spawn.gunship = rand(14, 20);
        this.spawnGunship(ctx.player.x, ctx.player.y);
      }
    }

    // 敵の動き
    for (const e of this.enemies) {
      e.t += dt;
      const p = e.mesh.position;
      if (e.kind === 'fighter') {
        e.z += (scroll * 0.55 + 20) * dt;
        const s = Math.sin(e.t * e.w + e.phase), c = Math.cos(e.t * e.w + e.phase);
        const x = e.pattern === 'weave' ? e.cx + e.amp * s : e.cx + e.amp * 0.6 * c;
        const y = e.pattern === 'weave' ? e.cy + 1.5 * Math.sin(e.t * e.w * 1.7) : e.cy + e.amp * 0.4 * s;
        p.set(x, Math.max(1.5, y), e.z);
        e.mesh.rotation.z = -c * 0.7;
      } else {
        if (e.hover < 7) {
          e.z = Math.min(-75, e.z + (scroll * 0.5 + 18) * dt);
          if (e.z >= -75) e.hover += dt;
          p.set(e.x + Math.sin(e.t * 0.7) * 5, e.y + Math.sin(e.t * 1.3) * 1.2, e.z);
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

      // 被弾したら一瞬白く光らせる
      e.flash -= dt;
      for (const m of e.mats) m.emissive.setHex(e.flash > 0 ? 0xffffff : 0x000000);

      // 敵の攻撃
      e.fireT -= dt;
      if (ctx.active && e.fireT <= 0 && p.z > -170 && p.z < -35) {
        if (e.kind === 'fighter') {
          e.fireT = rand(3, 6);
          if (Math.random() < 0.5) this.fireBullet(p, ctx.player);
        } else {
          e.fireT = 1.6;
          for (const sp of [-0.12, 0, 0.12]) this.fireBullet(_b.copy(p).add(_c.set(0, -0.2, 3)), ctx.player, sp);
        }
      }
      if (!e.dead && p.distanceTo(ctx.player) < e.r + ctx.playerR) ctx.onPlayerHit();
    }

    // 敵弾
    for (const b of this.bullets) {
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      const s = 1 + Math.sin(this.time * 30) * 0.15;
      b.mesh.scale.setScalar(s);
      if (b.life <= 0 || b.mesh.position.z > REMOVE_Z) b.dead = true;
      else if (b.mesh.position.distanceTo(ctx.player) < b.r + ctx.playerR) {
        b.dead = true;
        ctx.onPlayerHit();
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
    for (const key of ['enemies', 'bullets', 'shots', 'missiles']) {
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
