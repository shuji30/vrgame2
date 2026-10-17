// ボーナスステージで乗る水晶のそり。頭はプレイヤーの下 (一人称) か機体の下 (三人称) に置き、
// 胴体は後ろへうねりながらついてくる
import * as THREE from 'three';
import { makeFriendlyDragon } from './combat.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class DragonRide {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.head = null;
    this.segs = [];
    this.t = 0;
    this.headPos = new THREE.Vector3(); // 木との当たり判定の中心
  }

  start() {
    this.stop();
    const { head, segs } = makeFriendlyDragon(10);
    this.head = head;
    this.segs = segs;
    for (const p of [head, ...segs]) this.scene.add(p.mesh);
    this.active = true;
    this.t = 0;
    this.placed = false;
  }

  stop() {
    for (const p of [this.head, ...this.segs]) {
      if (!p) continue;
      this.scene.remove(p.mesh);
      p.mats.forEach((m) => m.dispose());
    }
    this.head = null;
    this.segs = [];
    this.active = false;
  }

  // anchor: 頭を置くワールド座標
  update(dt, anchor) {
    if (!this.active) return;
    this.t += dt;
    const h = this.head;
    if (!this.placed) {
      this.placed = true;
      this.segs.forEach((s, i) => s.spine.copy(anchor).add(_a.set(0, 0, (i + 1) * 3)));
    }
    h.mesh.position.copy(anchor);
    h.spine.copy(anchor);
    h.mesh.rotation.set(Math.sin(this.t * 2) * 0.04, Math.PI, Math.sin(this.t * 1.3) * 0.05); // 前 (-Z) を向く
    // 胴体: 後ろへ流しながら前の節についていき、うねりを足す
    let prev = h;
    this.segs.forEach((s, i) => {
      s.spine.z += 10 * dt;
      const d = _a.subVectors(s.spine, prev.spine);
      const len = d.length() || 1;
      s.spine.copy(prev.spine).addScaledVector(d, ((prev.r + s.r) * 0.72) / len);
      const amp = Math.min(1, (i + 1) / 4) * 1.2;
      s.mesh.position.copy(s.spine).add(_b.set(Math.sin(this.t * 3 - i * 0.6) * amp, Math.cos(this.t * 2.4 - i * 0.5) * amp * 0.5, 0));
      s.mesh.lookAt(prev.mesh.position);
      prev = s;
    });
    this.headPos.copy(anchor);
  }
}
