// 画面の効果: スミ雲（前が見えにくくなる）とカミナリの光。カメラの子にした板なので VR でも見える
// VR 酔いしないよう、スミは半透明で、光も短く弱めにする
import * as THREE from 'three';

function inkTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');
  // 黒いしみをいくつか（中央は少し空けて、まったく見えなくはしない）
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * 512, y = Math.random() * 256;
    if (Math.abs(x - 256) < 70 && Math.abs(y - 128) < 50) continue;
    const r = 40 + Math.random() * 70;
    const g = ctx.createRadialGradient(x, y, r * 0.3, x, y, r);
    g.addColorStop(0, 'rgba(10,8,20,0.95)');
    g.addColorStop(1, 'rgba(10,8,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class ScreenFx {
  constructor(camera) {
    const geo = new THREE.PlaneGeometry(1.4, 0.7);
    this.inkMat = new THREE.MeshBasicMaterial({ map: inkTexture(), transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
    this.ink = new THREE.Mesh(geo, this.inkMat);
    this.ink.position.z = -0.25;
    this.ink.renderOrder = 999;
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
    this.flashMesh = new THREE.Mesh(geo, this.flashMat);
    this.flashMesh.position.z = -0.24;
    this.flashMesh.renderOrder = 1000;
    this.ink.visible = this.flashMesh.visible = false;
    camera.add(this.ink, this.flashMesh);
    this.inkT = 0;
    this.flashT = 0;
  }

  ink(time = 4) {
    this.inkT = time;
    this.inkMat.map.offset.set(Math.random() * 0.2, Math.random() * 0.2);
  }

  flash() {
    this.flashT = 0.35;
  }

  clear() {
    this.inkT = this.flashT = 0;
    this.update(0);
  }

  update(dt) {
    this.inkT = Math.max(0, this.inkT - dt);
    this.flashT = Math.max(0, this.flashT - dt);
    // 最後の 1 秒で薄れていく
    this.inkMat.opacity = Math.min(1, this.inkT) * 0.8;
    this.flashMat.opacity = Math.min(1, this.flashT / 0.35) * 0.55;
    this.ink.visible = this.inkMat.opacity > 0.01;
    this.flashMesh.visible = this.flashMat.opacity > 0.01;
  }
}
