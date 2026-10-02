// 光る刀と残像（トレイル）
import * as THREE from 'three';
import { BLADE_LENGTH, BLADE_OFFSET } from '../core/config.js';

const TRAIL_LEN = 14;

export class Saber {
  constructor(colorIndex, colorHex) {
    this.color = colorIndex;
    this.colorHex = colorHex;
    this.anyColor = false;
    this.root = new THREE.Group();
    this.root.name = `saber-${colorIndex}`;

    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.024, 0.2, 14),
      new THREE.MeshStandardMaterial({ color: 0x2a2a33, metalness: 0.85, roughness: 0.3 }),
    );
    handle.rotation.x = Math.PI / 2;
    handle.position.z = 0.06;
    const guard = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.025, 14),
      new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 0.6, metalness: 0.5, roughness: 0.4 }),
    );
    guard.rotation.x = Math.PI / 2;
    guard.position.z = -0.04;

    this.blade = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.009, 0.009, BLADE_LENGTH, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    const glowMat = new THREE.MeshBasicMaterial({
      color: colorHex, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, BLADE_LENGTH, 12), glowMat);
    const outer = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, BLADE_LENGTH, 12),
      new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    for (const m of [core, glow, outer]) {
      m.rotation.x = Math.PI / 2;
      m.position.z = -BLADE_OFFSET - BLADE_LENGTH / 2;
      this.blade.add(m);
    }
    this.root.add(handle, guard, this.blade);

    this.hiltLocal = new THREE.Vector3(0, 0, -BLADE_OFFSET);
    this.tipLocal = new THREE.Vector3(0, 0, -BLADE_OFFSET - BLADE_LENGTH);
    this.hilt = new THREE.Vector3();
    this.tip = new THREE.Vector3();
    this.prevHilt = new THREE.Vector3();
    this.prevTip = new THREE.Vector3();
    this.dt = 1 / 72;
    this.valid = false;
    this.enabled = true;

    this.trail = new Trail(colorHex);
  }

  setVisible(v) {
    this.root.visible = v;
    this.trail.mesh.visible = v;
  }

  // 位置の履歴を消す（持ち替え直後に巨大なスイングとして扱わないため）
  reset() {
    this.valid = false;
    this.trail.reset();
  }

  // 毎フレーム、姿勢を更新したあとに呼ぶ
  sample(dt) {
    this.root.updateWorldMatrix(true, false);
    this.prevHilt.copy(this.hilt);
    this.prevTip.copy(this.tip);
    this.hilt.copy(this.hiltLocal).applyMatrix4(this.root.matrixWorld);
    this.tip.copy(this.tipLocal).applyMatrix4(this.root.matrixWorld);
    if (!this.valid) {
      this.prevHilt.copy(this.hilt);
      this.prevTip.copy(this.tip);
      this.valid = true;
    }
    this.dt = dt;
    this.trail.push(this.hilt, this.tip);
  }

  // 刀身の速さ (m/s)
  tipSpeed() {
    return this.prevTip.distanceTo(this.tip) / Math.max(this.dt, 1e-4);
  }
}

// 直近数フレームの刀身位置をつないだ帯
class Trail {
  constructor(colorHex) {
    this.count = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(TRAIL_LEN * 2 * 3);
    this.col = new Float32Array(TRAIL_LEN * 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const idx = [];
    for (let i = 0; i < TRAIL_LEN - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    this.geo = geo;
    this.base = new THREE.Color(colorHex);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
  }

  reset() {
    this.count = 0;
  }

  push(hilt, tip) {
    // 履歴はリングバッファで持ち、毎フレームの確保を避ける
    if (!this.ring) {
      this.ring = Array.from({ length: TRAIL_LEN }, () => [new THREE.Vector3(), new THREE.Vector3()]);
      this.head = 0;
      this.count = this.count || 0;
    }
    this.head = (this.head + TRAIL_LEN - 1) % TRAIL_LEN;
    // 付け根側 25% は残像を出さない
    this.ring[this.head][0].lerpVectors(hilt, tip, 0.25);
    this.ring[this.head][1].copy(tip);
    this.count = Math.min(TRAIL_LEN, this.count + 1);
    const n = this.count;
    for (let i = 0; i < TRAIL_LEN; i++) {
      const p = this.ring[(this.head + Math.min(i, n - 1)) % TRAIL_LEN];
      const k = i < n ? Math.pow(1 - i / TRAIL_LEN, 1.6) * 0.7 : 0;
      for (let j = 0; j < 2; j++) {
        const v = p[j];
        const o = (i * 2 + j) * 3;
        this.pos[o] = v.x; this.pos[o + 1] = v.y; this.pos[o + 2] = v.z;
        const kk = k * (j === 1 ? 1 : 0.35);
        this.col[o] = this.base.r * kk; this.col[o + 1] = this.base.g * kk; this.col[o + 2] = this.base.b * kk;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
