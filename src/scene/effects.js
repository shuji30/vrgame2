// 切断した破片・火花・得点ポップアップ
import * as THREE from 'three';
import { NOTE_SIZE } from '../core/config.js';

const MAX_SPARKS = 700;
const GRAVITY = -7;

export class Effects {
  constructor(scene, views) {
    this.scene = scene;
    this.views = views;
    const S = NOTE_SIZE;
    this.halfGeo = new THREE.BoxGeometry(S, S / 2, S);
    this.capGeo = new THREE.PlaneGeometry(S * 0.96, S * 0.96);
    this.capMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    this.halves = [];
    this.halfPool = [];

    // 火花
    const geo = new THREE.BufferGeometry();
    this.sPos = new Float32Array(MAX_SPARKS * 3).fill(-999);
    this.sCol = new Float32Array(MAX_SPARKS * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.sCol, 3));
    this.sparkGeo = geo;
    this.sparks = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.035, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);
    this.sVel = new Float32Array(MAX_SPARKS * 3);
    this.sLife = new Float32Array(MAX_SPARKS);
    this.sMax = new Float32Array(MAX_SPARKS).fill(1);
    this.sBase = new Float32Array(MAX_SPARKS * 3);
    this.sNext = 0;

    this.popups = [];
    this.popPool = [];
  }

  // 切断: 2 つの破片を切断方向の両側へ飛ばす
  slice(pose, dir, colorIndex, colorHex, speedZ) {
    const len = Math.hypot(dir.x, dir.y) || 1;
    const d = { x: dir.x / len, y: dir.y / len };
    const n = { x: -d.y, y: d.x };
    const ang = Math.atan2(d.y, d.x);
    for (const side of [-1, 1]) {
      const h = this.halfPool.pop() || this.makeHalf();
      h.mesh.material = this.views.noteMats[colorIndex];
      h.mesh.position.set(0, side * NOTE_SIZE / 4, 0);
      h.cap.position.set(0, 0, 0);
      h.group.position.set(pose.x, pose.y, pose.z);
      h.group.rotation.set(0, 0, ang);
      h.group.scale.setScalar(1);
      h.vel.set(n.x * side * 1.8 + d.x * 1.2, n.y * side * 1.8 + d.y * 1.2 + 0.8, speedZ * 0.12);
      h.spin.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, side * 5);
      h.life = 0.7;
      this.scene.add(h.group);
      this.halves.push(h);
    }
    this.burst(pose, colorHex, 26, d);
  }

  makeHalf() {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(this.halfGeo, this.views.noteMats[0]);
    const cap = new THREE.Mesh(this.capGeo, this.capMat);
    cap.rotation.x = Math.PI / 2;
    group.add(mesh, cap);
    return { group, mesh, cap, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 };
  }

  burst(p, colorHex, count, d = null, speed = 2.5) {
    const c = new THREE.Color(colorHex);
    for (let k = 0; k < count; k++) {
      const i = this.sNext;
      this.sNext = (this.sNext + 1) % MAX_SPARKS;
      this.sPos[i * 3] = p.x; this.sPos[i * 3 + 1] = p.y; this.sPos[i * 3 + 2] = p.z;
      let vx = (Math.random() - 0.5) * speed, vy = (Math.random() - 0.5) * speed, vz = (Math.random() - 0.3) * speed;
      if (d) { vx += d.x * speed; vy += d.y * speed; }
      this.sVel[i * 3] = vx; this.sVel[i * 3 + 1] = vy; this.sVel[i * 3 + 2] = vz;
      const life = 0.35 + Math.random() * 0.4;
      this.sLife[i] = life;
      this.sMax[i] = life;
      const w = Math.random() < 0.3 ? 1 : 0;
      this.sBase[i * 3] = w ? 1 : c.r; this.sBase[i * 3 + 1] = w ? 1 : c.g; this.sBase[i * 3 + 2] = w ? 1 : c.b;
    }
  }

  explode(p) {
    this.burst(p, 0xff6a2a, 60, null, 4.5);
    this.burst(p, 0xffffff, 20, null, 3);
  }

  // 得点などの文字を浮かべる
  popup(p, text, color = '#ffffff') {
    const item = this.popPool.pop() || this.makePopup();
    const ctx = item.ctx;
    ctx.clearRect(0, 0, 256, 128);
    ctx.font = 'bold 72px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(text, 128, 64);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 64);
    item.tex.needsUpdate = true;
    item.sprite.position.set(p.x, p.y + 0.15, p.z);
    item.sprite.material.opacity = 1;
    item.life = 0.7;
    this.scene.add(item.sprite);
    this.popups.push(item);
  }

  makePopup() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    sprite.scale.set(0.36, 0.18, 1);
    return { canvas, ctx: canvas.getContext('2d'), tex, sprite, life: 0 };
  }

  clear() {
    for (const h of this.halves) { this.scene.remove(h.group); this.halfPool.push(h); }
    this.halves.length = 0;
    for (const p of this.popups) { this.scene.remove(p.sprite); this.popPool.push(p); }
    this.popups.length = 0;
    this.sLife.fill(0);
    this.sPos.fill(-999);
    this.sparkGeo.attributes.position.needsUpdate = true;
  }

  update(dt) {
    for (let i = this.halves.length - 1; i >= 0; i--) {
      const h = this.halves[i];
      h.life -= dt;
      h.vel.y += GRAVITY * dt;
      h.group.position.addScaledVector(h.vel, dt);
      h.group.rotation.x += h.spin.x * dt;
      h.group.rotation.y += h.spin.y * dt;
      h.group.rotation.z += h.spin.z * dt;
      if (h.life < 0.4) h.group.scale.setScalar(Math.max(0.01, h.life / 0.4));
      if (h.life <= 0) {
        this.scene.remove(h.group);
        this.halfPool.push(h);
        this.halves.splice(i, 1);
      }
    }

    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.sLife[i] <= 0) continue;
      this.sLife[i] -= dt;
      const o = i * 3;
      if (this.sLife[i] <= 0) {
        this.sPos[o + 1] = -999;
        this.sCol[o] = this.sCol[o + 1] = this.sCol[o + 2] = 0;
        continue;
      }
      this.sVel[o + 1] += GRAVITY * 0.4 * dt;
      this.sPos[o] += this.sVel[o] * dt;
      this.sPos[o + 1] += this.sVel[o + 1] * dt;
      this.sPos[o + 2] += this.sVel[o + 2] * dt;
      const k = this.sLife[i] / this.sMax[i];
      this.sCol[o] = this.sBase[o] * k;
      this.sCol[o + 1] = this.sBase[o + 1] * k;
      this.sCol[o + 2] = this.sBase[o + 2] * k;
    }
    this.sparkGeo.attributes.position.needsUpdate = true;
    this.sparkGeo.attributes.color.needsUpdate = true;

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= dt;
      p.sprite.position.y += dt * 0.5;
      p.sprite.material.opacity = Math.min(1, p.life / 0.3);
      if (p.life <= 0) {
        this.scene.remove(p.sprite);
        this.popPool.push(p);
        this.popups.splice(i, 1);
      }
    }
  }
}
