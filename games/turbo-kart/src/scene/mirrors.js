// バックミラー: 自分の車の上から後ろ向きのカメラで景色を描き、その絵をミラーの面に貼る。
// 1 枚の絵（左右反転）を、左のミラーは左側、ルームミラーは中央、右のミラーは右側だけ使う
import * as THREE from 'three';

// ミラーの面（運転手から見える -X 向きの板）。a..b: 後ろの景色のうち、左から何割〜何割を映すか
export function mirrorGlass(w, h, a, b) {
  const geo = new THREE.PlaneGeometry(w, h);
  geo.rotateY(-Math.PI / 2);
  // 後ろ向きのカメラの絵は左右が逆（絵の左 = 車の右）なので、反転して鏡に映った向きにする
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - (a + uv.getX(i) * (b - a)));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x1a2230, fog: false, toneMapped: false }));
  mesh.userData.mirror = true;
  return mesh;
}

export class RearView {
  constructor() {
    this.target = new THREE.WebGLRenderTarget(512, 160);
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(30, 3.2, 0.5, 600);
    this.frame = 0;
    this.model = null;
  }

  // 自分の車のミラーにこの絵を貼る（ほかの車のミラーは暗いガラスのまま）
  attach(model) {
    if (this.model === model) return;
    this.model = model;
    for (const m of model?.mirrorGlass || []) {
      m.material.map = this.target.texture;
      m.material.color.set(0xffffff);
      m.material.needsUpdate = true;
    }
  }

  // 本番の描画の前に呼ぶ。VR でも重くならないよう 2 フレームに 1 回、小さい絵で描く
  render(renderer, scene, model, active) {
    if (!active || !model?.mirrorGlass?.length) return;
    this.attach(model);
    if (this.frame++ % 2) return;
    const eye = model.eye;
    // 自分の車の屋根・エンジンカバーより上から、少し見下ろして後ろを見る
    const from = model.group.localToWorld(new THREE.Vector3(eye.x - 0.2, eye.y + 0.32, 0));
    const to = model.group.localToWorld(new THREE.Vector3(eye.x - 20, eye.y - 0.6, 0));
    this.camera.position.copy(from);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(to);
    for (const m of model.mirrorGlass) m.visible = false;
    const xr = renderer.xr.enabled;
    const shadows = renderer.shadowMap.autoUpdate;
    const prev = renderer.getRenderTarget();
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false; // 影は本番の描画で作ったものを使い回す
    renderer.setRenderTarget(this.target);
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(prev);
    renderer.shadowMap.autoUpdate = shadows;
    renderer.xr.enabled = xr;
    for (const m of model.mirrorGlass) m.visible = true;
  }
}
