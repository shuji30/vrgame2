// パーティクル演出: ドリフトの火花・土煙・ミニターボの閃光
import * as THREE from 'three';

const MAX = 1500;

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

class Pool {
  // late: 最後の 3 分の 1 だけで消える（紙吹雪用）。grow: 消えるまでに大きさが (1 + grow) 倍に広がる（煙用）
  constructor(scene, { size, additive, opacity = 0.45, late = false, grow = 0 }) {
    this.late = late;
    this.opacity = opacity;
    this.pos = new Float32Array(MAX * 3).fill(-9999);
    this.col = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.max = new Float32Array(MAX).fill(1);
    this.base = new Float32Array(MAX * 3);
    this.next = 0;
    this.alpha = new Float32Array(MAX);
    this.age = new Float32Array(MAX);
    this.additive = additive;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('age', new THREE.BufferAttribute(this.age, 1));
    this.geo = g;
    // 色は保ったまま透明度で消す（暗くなって視界をふさがないように）
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: dotTexture() }, size: { value: size * 300 }, grow: { value: grow } },
      vertexShader: `attribute vec3 color; attribute float alpha; attribute float age; varying vec3 vC; varying float vA; uniform float size; uniform float grow;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (1.0 + grow * age) / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); }`,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(p, v, color, life) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.base.set([color.r, color.g, color.b], i * 3);
    this.life[i] = this.max[i] = life;
  }

  update(dt, gravity, drag) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const o = i * 3;
      if (this.life[i] <= 0) {
        this.pos[o + 1] = -9999;
        this.alpha[i] = 0;
        continue;
      }
      const k = Math.exp(-drag * dt);
      this.vel[o] *= k;
      this.vel[o + 2] *= k;
      this.vel[o + 1] = this.vel[o + 1] * k + gravity * dt;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      const f = this.life[i] / this.max[i];
      this.age[i] = 1 - f;
      this.col[o] = this.base[o];
      this.col[o + 1] = this.base[o + 1];
      this.col[o + 2] = this.base[o + 2];
      this.alpha[i] = this.additive ? f : (this.late ? Math.min(1, f * 3) : f) * this.opacity;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.geo.attributes.age.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.pos.fill(-9999);
    this.geo.attributes.position.needsUpdate = true;
  }
}

// ドリフトの溜まり具合で火花の色が変わる（青 → オレンジ → ピンク）
export function driftTier(driftTime) {
  if (driftTime > 2.4) return 3;
  if (driftTime > 1.6) return 2;
  if (driftTime > 0.8) return 1;
  return 0;
}
const TIER_COLORS = [new THREE.Color(0xffffff), new THREE.Color(0x4fb8ff), new THREE.Color(0xff9a2f), new THREE.Color(0xff5fd2)];
const SMOKE = new THREE.Color(0xe6e6e6);
const DUST = { dirt: new THREE.Color(0xe8c28c), grass: new THREE.Color(0xb6ec8a) };

export class Effects {
  constructor(scene) {
    this.sparks = new Pool(scene, { size: 0.18, additive: true });
    this.dust = new Pool(scene, { size: 0.7, additive: false });
    // タイヤスモーク（後輪が大きく滑ったとき。ドリフト）
    this.smoke = new Pool(scene, { size: 1.5, additive: false, opacity: 0.55, grow: 3 });
    this.confettiPool = new Pool(scene, { size: 0.28, additive: false, opacity: 1, late: true });
    this.tmp = new THREE.Vector3();
    this.tmpS = new THREE.Vector3();
    this.tmpV = new THREE.Vector3();
  }

  clear() {
    this.sparks.clear();
    this.dust.clear();
    this.smoke.clear();
    this.confettiPool.clear();
  }

  // 毎フレーム、各カートについて呼ぶ
  kart(model, kart, speed, dt) {
    const g = model.group;
    const tier = driftTier(kart.driftTime || 0);
    const rate = dt * 60;
    const rear = model.rear || { x: -0.65, z: 0.72 };
    for (const z of [-rear.z, rear.z]) {
      const p = this.tmp.set(rear.x, 0.05, z).applyMatrix4(g.matrixWorld);
      if (kart.driftTime > 0.25 && speed > 7) {
        const color = TIER_COLORS[tier];
        for (let n = 0; n < (tier ? 2 : 1) * rate; n++) {
          const v = this.tmpV.set(-1.5 - Math.random() * 2, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3).applyQuaternion(g.quaternion);
          this.sparks.emit(p, v, color, 0.25 + Math.random() * 0.25);
        }
      }
      // 舗装の上で後輪が大きく滑ると（ドリフト）タイヤから白い煙。滑るほど多く、もくもく広がって立ちのぼる
      const slide = Math.abs(kart.rearSlip || 0);
      if (!DUST[kart.surface] && slide > 0.12 && speed > 4) {
        const amount = Math.min(3, (slide - 0.08) * 8) * rate;
        const count = Math.floor(amount) + (Math.random() < amount % 1 ? 1 : 0);
        for (let n = 0; n < count; n++) {
          const v = this.tmpV.set(-0.3 - Math.random() * 0.8, 0.5 + Math.random() * 0.9, (Math.random() - 0.5) * 1.6).applyQuaternion(g.quaternion);
          this.smoke.emit(this.tmpS.copy(p).setY(p.y + 0.25), v, SMOKE, 1.4 + Math.random() * 1.0);
        }
      }
      const dc = DUST[kart.surface];
      if (dc && speed > 5 && Math.random() < 0.22 * rate) {
        const v = this.tmpV.set(-1 - Math.random(), 0.8 + Math.random(), (Math.random() - 0.5) * 1.5).applyQuaternion(g.quaternion);
        this.dust.emit(p, v, dc, 0.4 + Math.random() * 0.3);
      }
    }
  }

  // ミニターボ発動の閃光
  burst(model, tier) {
    const g = model.group;
    const color = TIER_COLORS[Math.max(1, tier)];
    for (let n = 0; n < 40; n++) {
      const p = this.tmp.set(-1.3, 0.45, (Math.random() - 0.5) * 0.6).applyMatrix4(g.matrixWorld);
      const v = this.tmpV.set(-2 - Math.random() * 3, (Math.random() - 0.3) * 3, (Math.random() - 0.5) * 3).applyQuaternion(g.quaternion);
      this.sparks.emit(p, v, color, 0.3 + Math.random() * 0.3);
    }
  }

  update(dt) {
    this.sparks.update(dt, -9, 2);
    this.dust.update(dt, 1.2, 1.5);
    this.smoke.update(dt, 0.35, 1.4);
    this.confettiPool.update(dt, -2.5, 2.2);
  }
}

const CONFETTI = [0xff4f7b, 0xffd23f, 0x4fc3ff, 0x7cff6a, 0xb06cff, 0xff8a1f, 0xffffff].map((c) => new THREE.Color(c));

// ゴールの紙吹雪（カートの上から降らせる）
Effects.prototype.confetti = function confetti(model, count = 220) {
  const g = model.group;
  for (let n = 0; n < count; n++) {
    const p = this.tmp.set((Math.random() - 0.3) * 6, 3 + Math.random() * 3, (Math.random() - 0.5) * 6).applyMatrix4(g.matrixWorld);
    const v = this.tmpV.set((Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6);
    this.confettiPool.emit(p, v, CONFETTI[n % CONFETTI.length], 2.5 + Math.random() * 1.5);
  }
};

const GOLD = new THREE.Color(0xffd23f);
// コインを拾ったときのキラキラ（車の前の目の高さに出すので、車内視点・VR でも見える）
Effects.prototype.coinSparkle = function coinSparkle(model) {
  const g = model.group;
  const eye = model.eye || new THREE.Vector3(0, 1, 0);
  for (let n = 0; n < 24; n++) {
    const p = this.tmp.set(eye.x + 1.6 + Math.random() * 0.6, eye.y - 0.2 + Math.random() * 0.5, (Math.random() - 0.5) * 1.2).applyMatrix4(g.matrixWorld);
    const v = this.tmpV.set((Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2);
    this.sparks.emit(p, v, GOLD, 0.35 + Math.random() * 0.25);
  }
};
