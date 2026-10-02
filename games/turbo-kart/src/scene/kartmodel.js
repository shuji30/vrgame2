// カートの見た目（前方 = ローカル +X）。ハンドルは入力に合わせて回る
import * as THREE from 'three';

// 運転者の目の位置（カートのローカル座標）
export const EYE = new THREE.Vector3(-0.25, 1.0, 0);

let shared = null;
function geos() {
  if (shared) return shared;
  shared = {
    body: new THREE.BoxGeometry(1.7, 0.22, 1.05),
    nose: new THREE.BoxGeometry(0.5, 0.18, 0.9),
    pod: new THREE.BoxGeometry(0.9, 0.18, 0.18),
    seat: new THREE.BoxGeometry(0.45, 0.5, 0.5),
    wheel: new THREE.CylinderGeometry(0.24, 0.24, 0.22, 16),
    hub: new THREE.CylinderGeometry(0.1, 0.1, 0.24, 8),
    column: new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6),
    lever: new THREE.CylinderGeometry(0.012, 0.016, 0.38, 8),
    knob: new THREE.SphereGeometry(0.03, 10, 8),
    steer: new THREE.TorusGeometry(0.17, 0.028, 10, 32),
    spoke: new THREE.BoxGeometry(0.03, 0.32, 0.05),
    torso: new THREE.CapsuleGeometry(0.2, 0.3, 4, 8),
    helmet: new THREE.SphereGeometry(0.17, 16, 12),
    visor: new THREE.SphereGeometry(0.172, 16, 12, -0.9, 1.8, 0.9, 0.8),
    shadow: new THREE.PlaneGeometry(2.4, 1.6),
    exhaust: new THREE.CylinderGeometry(0.05, 0.06, 0.25, 8),
  };
  return shared;
}

let shadowTex = null;
function blobShadow() {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

export class KartModel {
  constructor(color, name, { isPlayer = false } = {}) {
    const G = geos();
    this.group = new THREE.Group();
    const paint = new THREE.MeshLambertMaterial({ color });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1d1d22 });
    const metal = new THREE.MeshLambertMaterial({ color: 0x9aa0aa });
    const tire = new THREE.MeshLambertMaterial({ color: 0x151515 });

    const body = new THREE.Mesh(G.body, paint);
    body.position.y = 0.28;
    const nose = new THREE.Mesh(G.nose, paint);
    nose.position.set(1.0, 0.25, 0);
    const podL = new THREE.Mesh(G.pod, dark);
    podL.position.set(0.05, 0.3, -0.58);
    const podR = podL.clone();
    podR.position.z = 0.58;
    const seat = new THREE.Mesh(G.seat, dark);
    seat.position.set(-0.4, 0.55, 0);
    const exhaust = new THREE.Mesh(G.exhaust, metal);
    exhaust.rotation.z = Math.PI / 2;
    exhaust.position.set(-0.95, 0.45, -0.3);
    this.group.add(body, nose, podL, podR, seat, exhaust);

    this.wheels = [];
    for (const [x, z, front] of [[0.62, -0.62, true], [0.62, 0.62, true], [-0.6, -0.64, false], [-0.6, 0.64, false]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.24, z);
      const spin = new THREE.Group();
      const w = new THREE.Mesh(G.wheel, tire);
      w.rotation.x = Math.PI / 2;
      const hub = new THREE.Mesh(G.hub, metal);
      hub.rotation.x = Math.PI / 2;
      spin.add(w, hub);
      pivot.add(spin);
      this.group.add(pivot);
      this.wheels.push({ pivot, spin, front });
    }

    // ハンドル（運転者の正面）
    this.steerGroup = new THREE.Group();
    this.steerGroup.position.set(0.22, 0.74, 0);
    this.steerGroup.rotation.z = -0.15; // ほぼ垂直。下側をわずかに手前に
    const column = new THREE.Mesh(G.column, dark);
    column.rotation.z = Math.PI / 2;
    column.position.set(0.1, -0.02, 0);
    this.steerWheel = new THREE.Group();
    const ring = new THREE.Mesh(G.steer, new THREE.MeshLambertMaterial({ color: 0x5a5a66 }));
    ring.rotation.y = Math.PI / 2;
    // スポークは横と下だけ（上は視界をふさがないように空ける）
    const spoke = new THREE.Mesh(G.spoke, metal);
    spoke.scale.y = 0.5;
    spoke.position.y = -0.08;
    const spoke2 = new THREE.Mesh(G.spoke, metal);
    spoke2.rotation.x = Math.PI / 2;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, 0.05), new THREE.MeshLambertMaterial({ color: 0xffd84a }));
    grip.position.y = 0.17; // 頂点の目印（センター位置が分かるように）
    this.steerWheel.add(ring, spoke, spoke2, grip);
    this.steerGroup.add(column, this.steerWheel);
    this.group.add(this.steerGroup);

    // サイドブレーキのレバー（シートの右横。引くと手前に倒れる）
    this.lever = new THREE.Group();
    this.lever.position.set(-0.32, 0.36, 0.34);
    const rod = new THREE.Mesh(G.lever, metal);
    rod.position.y = 0.19;
    const knob = new THREE.Mesh(G.knob, new THREE.MeshLambertMaterial({ color: 0xe8262c }));
    knob.position.y = 0.39;
    this.lever.add(rod, knob);
    this.group.add(this.lever);

    // 運転者（プレイヤーのコックピット視点では隠す）
    this.driver = new THREE.Group();
    const torso = new THREE.Mesh(G.torso, new THREE.MeshLambertMaterial({ color: 0x30343c }));
    torso.position.set(-0.35, 0.85, 0);
    const helmet = new THREE.Mesh(G.helmet, paint);
    helmet.position.set(-0.3, 1.22, 0);
    const visor = new THREE.Mesh(G.visor, new THREE.MeshLambertMaterial({ color: 0x111111 }));
    visor.rotation.y = -Math.PI / 2;
    visor.position.copy(helmet.position);
    this.driver.add(torso, helmet, visor);
    this.group.add(this.driver);

    const shadow = new THREE.Mesh(G.shadow, new THREE.MeshBasicMaterial({ map: blobShadow(), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.04;
    this.group.add(shadow);

    if (!isPlayer && name) this.group.add(this.makeLabel(name, color));
    this.wheelSpin = 0;
    // ヨー → ピッチ → ロールの順に回す（前 = +X、右 = +Z）
    this.group.rotation.order = 'YZX';
  }

  makeLabel(name, color) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.roundRect(4, 8, 248, 48, 20);
    ctx.fill();
    ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
    ctx.fillRect(18, 22, 20, 20);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 32px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 50, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
    sp.scale.set(1.6, 0.4, 1);
    sp.position.y = 1.9;
    return sp;
  }

  setCockpit(on) {
    this.driver.visible = !on;
  }

  // pose: { x, z, heading, y, pitch, roll }（補間済みの姿勢）、kart: physics 状態、steer: -1..1
  update(pose, kart, steer, dt, lockDeg = 270) {
    this.group.position.set(pose.x, pose.y, pose.z);
    this.group.rotation.set(-pose.roll, -pose.heading, pose.pitch);
    const v = kart.vx * Math.cos(kart.heading) + kart.vz * Math.sin(kart.heading);
    this.wheelSpin -= (v / 0.24) * dt;
    for (const w of this.wheels) {
      w.spin.rotation.z = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = -kart.steerAngle;
    }
    // 右に切るとハンドルは時計回り（運転者から見て）
    this.steerWheel.rotation.x = steer * THREE.MathUtils.degToRad(lockDeg / 2);
    // サイドブレーキを引くとレバーが後ろへ倒れる
    const hb = kart.handbrakeInput || 0;
    this.lever.rotation.z = 0.35 + hb * 0.6;
  }
}
