// エフェクト:発砲炎・煙・爆発・破片・水しぶき、弾の表示、曲射と危険の印、照準
// 主砲は閃光・煙・FFBの反動をそろえる。敵弾は明るい発光色にして見失わないようにする
import * as THREE from '../../vendor/three.module.js';
import { makeShellMesh, makeLobMarker, makeDangerMarker } from './models.js';

function radialTex(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const TEX = {};
function texs() {
  if (TEX.fire) return TEX;
  TEX.fire = radialTex([[0, 'rgba(255,255,230,1)'], [0.25, 'rgba(255,200,80,0.95)'], [0.6, 'rgba(255,90,20,0.5)'], [1, 'rgba(120,20,0,0)']]);
  TEX.smoke = radialTex([[0, 'rgba(255,255,255,0.75)'], [0.5, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
  TEX.spark = radialTex([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,220,120,0.9)'], [1, 'rgba(255,120,0,0)']]);
  TEX.glow = radialTex([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']]);
  return TEX;
}

const POOL = 500;

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    const T = texs();
    this.mats = {
      fire: new THREE.SpriteMaterial({ map: T.fire, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      smoke: new THREE.SpriteMaterial({ map: T.smoke, color: 0x777777, depthWrite: false, transparent: true }),
      dust: new THREE.SpriteMaterial({ map: T.smoke, color: 0xb09a74, depthWrite: false, transparent: true }),
      water: new THREE.SpriteMaterial({ map: T.smoke, color: 0xd8ecff, depthWrite: false, transparent: true }),
      spark: new THREE.SpriteMaterial({ map: T.spark, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      white: new THREE.SpriteMaterial({ map: T.smoke, color: 0xeeeeee, depthWrite: false, transparent: true }),
    };
    this.parts = [];
    this.free = [];
    for (let i = 0; i < POOL; i++) {
      const s = new THREE.Sprite(this.mats.smoke);
      s.visible = false;
      this.group.add(s);
      this.free.push({ s, life: 0 });
    }
    this.shells = new Map();
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 30, 2);
      this.group.add(l);
      this.lights.push({ l, t: 0 });
    }
    this.lobMarker = makeLobMarker();
    this.lobMarker.visible = false;
    this.group.add(this.lobMarker);
    this.dangers = [];
    // 照準(地面・目標に置く輪)
    const ringGeo = new THREE.RingGeometry(0.85, 1, 32);
    this.reticle = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide, toneMapped: false }));
    this.reticle.renderOrder = 1000;
    this.group.add(this.reticle);
    this.reticleDot = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), this.reticle.material);
    this.reticleDot.renderOrder = 1000;
    this.reticle.add(this.reticleDot);
  }

  spawn(kind, x, y, z, o = {}) {
    const p = this.free.pop();
    if (!p) return;
    p.s.material = this.mats[kind] || this.mats.smoke;
    p.s.visible = true;
    p.s.position.set(x, y, z);
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.g = o.g ?? 0;
    p.life = p.max = o.life || 1;
    p.size0 = o.size || 1;
    p.size1 = o.grow ?? p.size0 * 2;
    p.op = o.op ?? 1;
    p.drag = o.drag ?? 1.5;
    p.s.scale.setScalar(p.size0);
    p.s.material = p.s.material.clone();
    if (o.color != null) p.s.material.color.set(o.color);
    this.parts.push(p);
  }

  flash(x, y, z, intensity = 60, color = 0xffb060) {
    const L = this.lights.reduce((a, b) => (a.t < b.t ? a : b));
    L.l.position.set(x, y, z);
    L.l.color.set(color);
    L.l.intensity = intensity;
    L.t = 0.08;
  }

  muzzle(x, y, z, yaw, big = 1) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    for (let i = 0; i < 3; i++) this.spawn('fire', x + fx * i * 0.7 * big, y, z + fz * i * 0.7 * big, { life: 0.12, size: 1.6 * big * (1 - i * 0.2), grow: 2.4 * big, vx: fx * 6, vz: fz * 6 });
    for (let i = 0; i < 6; i++) this.spawn('smoke', x, y, z, { life: 1.6, size: 1 * big, grow: 4.5 * big, vx: fx * (4 + Math.random() * 4) + (Math.random() - 0.5) * 3, vy: 1 + Math.random(), vz: fz * (4 + Math.random() * 4) + (Math.random() - 0.5) * 3, op: 0.55 });
    // 発砲の衝撃で地面の土ぼこり
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * 6.28;
      this.spawn('dust', x + Math.sin(a) * 2, y - 1.5, z + Math.cos(a) * 2, { life: 1.2, size: 1.5, grow: 4, vx: Math.sin(a) * 5, vz: Math.cos(a) * 5, op: 0.35 });
    }
    this.flash(x, y, z, 80 * big);
  }

  explosion(x, y, z, size = 1, kind = 'ground') {
    if (kind === 'water') {
      for (let i = 0; i < 10 * size; i++) this.spawn('water', x, y, z, { life: 1.1, size: 0.8 * size, grow: 2.5 * size, vx: (Math.random() - 0.5) * 4, vy: 8 + Math.random() * 9 * size, vz: (Math.random() - 0.5) * 4, g: 18, op: 0.8 });
      return;
    }
    const n = Math.round(6 + size * 8);
    for (let i = 0; i < n; i++) this.spawn('fire', x + (Math.random() - 0.5) * size, y + Math.random() * size, z + (Math.random() - 0.5) * size, { life: 0.25 + Math.random() * 0.3, size: 1.2 * size, grow: 4 * size, vx: (Math.random() - 0.5) * 8 * size, vy: Math.random() * 6 * size, vz: (Math.random() - 0.5) * 8 * size });
    for (let i = 0; i < n; i++) this.spawn(kind === 'ground' ? 'dust' : 'smoke', x, y + 0.5, z, { life: 1.5 + Math.random() * 1.5, size: 1.5 * size, grow: 6 * size, vx: (Math.random() - 0.5) * 6 * size, vy: 1 + Math.random() * 4 * size, vz: (Math.random() - 0.5) * 6 * size, op: 0.6 });
    for (let i = 0; i < n; i++) this.spawn('spark', x, y + 0.5, z, { life: 0.5 + Math.random() * 0.6, size: 0.25, grow: 0.1, vx: (Math.random() - 0.5) * 22, vy: 4 + Math.random() * 14, vz: (Math.random() - 0.5) * 22, g: 25, drag: 0.3 });
    this.flash(x, y + 1, z, 120 * size, 0xff8a3a);
  }

  // 装甲に弾かれた:白っぽい火花を跳ねさせる(効いていない合図)
  deflect(x, y, z) {
    for (let i = 0; i < 10; i++) this.spawn('spark', x, y, z, { life: 0.25 + Math.random() * 0.25, size: 0.2, grow: 0.05, vx: (Math.random() - 0.5) * 30, vy: 2 + Math.random() * 10, vz: (Math.random() - 0.5) * 30, g: 25, drag: 0.2 });
    this.flash(x, y, z, 50, 0xcfe0ff);
  }

  tiny(x, y, z, kind = 'ground') {
    this.spawn(kind === 'water' ? 'water' : 'dust', x, y, z, { life: 0.5, size: 0.4, grow: 1.2, vy: 2, op: 0.6 });
    this.spawn('spark', x, y, z, { life: 0.15, size: 0.5, grow: 0.2 });
  }

  smokeCloud(x, y, z) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.28, r = Math.random() * 9;
      this.spawn('white', x + Math.sin(a) * r, y + 1 + Math.random() * 5, z + Math.cos(a) * r, { life: 10 + Math.random() * 3, size: 5, grow: 9, vx: Math.sin(a) * 0.4, vy: 0.15, vz: Math.cos(a) * 0.4, op: 0.85, drag: 0.2 });
    }
  }

  // 撃破:大きな爆発と黒煙
  wreck(x, y, z, big) {
    this.explosion(x, y + 1, z, big ? 4 : 2);
    for (let i = 0; i < (big ? 24 : 10); i++) this.spawn('smoke', x + (Math.random() - 0.5) * 3, y + 1, z + (Math.random() - 0.5) * 3, { life: 3 + Math.random() * 2, size: 2, grow: big ? 12 : 7, vy: 2 + Math.random() * 3, color: 0x2a2a2a, op: 0.7, drag: 0.5 });
  }

  // 走行中の土ぼこり
  trail(x, y, z, kind) {
    this.spawn(kind === 'water' ? 'water' : 'dust', x + (Math.random() - 0.5), y + 0.3, z + (Math.random() - 0.5), { life: 1.2, size: 0.8, grow: 3, vy: 0.6, op: 0.3 });
  }

  danger(x, y, z, r, time) {
    const m = makeDangerMarker();
    m.position.set(x, y + 0.3, z);
    m.scale.setScalar(r);
    this.group.add(m);
    this.dangers.push({ m, t: time + 0.3, max: time + 0.3 });
  }

  // シミュレーションの弾と表示を合わせる
  syncShells(shots) {
    const seen = new Set();
    for (const s of shots) {
      if (s.delay > 0) continue;
      seen.add(s.id);
      let m = this.shells.get(s.id);
      if (!m) {
        const kind = s.kind === 'mgEnemy' ? 'mg' : s.kind === 'mortar' ? 'lob' : s.kind === 'rocket' ? 'missile' : s.kind === 'smoke' ? 'lob' : s.kind;
        m = makeShellMesh(s.team === 0 || s.kind === 'mg' || s.kind === 'missile' || s.kind === 'bomb' ? kind : s.kind === 'mgEnemy' ? 'mg' : 'enemy');
        if (s.team !== 0 && s.kind === 'enemy') m.scale.setScalar(s.big ? 1 : 0.7);
        this.group.add(m);
        this.shells.set(s.id, m);
      }
      m.position.set(s.x, s.y, s.z);
      m.lookAt(s.x + s.vx, s.y + s.vy, s.z + s.vz);
      if ((s.kind === 'missile' || s.kind === 'rocket') && Math.random() < 0.7) this.spawn('smoke', s.x, s.y, s.z, { life: 0.9, size: 0.5, grow: 2, op: 0.5 });
      if (s.kind === 'lob' && Math.random() < 0.4) this.spawn('spark', s.x, s.y, s.z, { life: 0.3, size: 0.6, grow: 0.2 });
    }
    for (const [id, m] of this.shells) {
      if (!seen.has(id)) { this.group.remove(m); this.shells.delete(id); }
    }
  }

  setReticle(camera, aim, locked, spreadDeg, visible) {
    this.reticle.visible = visible;
    if (!visible) return;
    this.reticle.position.set(aim.x, aim.y, aim.z);
    this.reticle.lookAt(camera.getWorldPosition(new THREE.Vector3()));
    const d = camera.getWorldPosition(new THREE.Vector3()).distanceTo(this.reticle.position);
    const s = Math.max(d * 0.018, d * Math.tan((spreadDeg * Math.PI) / 180) * 0.6);
    this.reticle.scale.setScalar(s);
    this.reticle.material.color.set(locked ? 0xff5a3a : spreadDeg < 0.2 ? 0x66ff99 : 0xffd84a);
  }

  // snapped:着弾点が敵の距離に合っている(緑にして、速く脈打たせる)
  setLob(p, visible, time, snapped = false) {
    this.lobMarker.visible = !!visible;
    if (!visible || !p) return;
    this.lobMarker.position.set(p.x, p.y + 0.3, p.z);
    this.lobMarker.scale.setScalar(snapped ? 5 + Math.sin(time * 12) * 0.8 : 6 + Math.sin(time * 6) * 0.5);
    this.lobMarker.material.color.setHex(snapped ? 0x55ff88 : 0xffffff);
    // 合っているときはボスや建物に隠れないよう手前に描く
    this.lobMarker.material.depthTest = !snapped;
  }

  update(dt) {
    const keep = [];
    for (const p of this.parts) {
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        p.s.material.dispose();
        this.free.push(p);
        continue;
      }
      const k = 1 - p.life / p.max;
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag; p.vz *= drag; p.vy = p.vy * drag - p.g * dt;
      p.s.position.x += p.vx * dt;
      p.s.position.y += p.vy * dt;
      p.s.position.z += p.vz * dt;
      p.s.scale.setScalar(p.size0 + (p.size1 - p.size0) * k);
      p.s.material.opacity = p.op * (1 - k);
      keep.push(p);
    }
    this.parts = keep;
    for (const L of this.lights) {
      L.t -= dt;
      if (L.t <= 0) L.l.intensity = 0;
      else L.l.intensity *= 0.7;
    }
    this.dangers = this.dangers.filter((d) => {
      d.t -= dt;
      d.m.material.opacity = 0.5 + 0.5 * Math.sin(d.t * 18);
      if (d.t <= 0) { this.group.remove(d.m); d.m.material.dispose(); return false; }
      return true;
    });
  }
}
