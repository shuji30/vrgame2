// カートの見た目（アニメ調）。前方 = ローカル +X、右 = +Z。ハンドルは入力に合わせて回る
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toon } from './style.js';

// 運転者の目の位置（カートのローカル座標）
export const EYE = new THREE.Vector3(-0.25, 1.0, 0);

let shared = null;
function geos() {
  if (shared) return shared;
  shared = {
    body: new RoundedBoxGeometry(1.75, 0.3, 1.0, 3, 0.12),
    nose: new RoundedBoxGeometry(0.75, 0.26, 0.95, 3, 0.12),
    pod: new RoundedBoxGeometry(0.95, 0.24, 0.24, 3, 0.1),
    bumper: new RoundedBoxGeometry(0.2, 0.18, 1.35, 2, 0.08),
    seat: new RoundedBoxGeometry(0.45, 0.55, 0.52, 3, 0.12),
    wingPost: new THREE.BoxGeometry(0.06, 0.32, 0.06),
    wing: new RoundedBoxGeometry(0.32, 0.06, 1.25, 2, 0.03),
    tireF: new THREE.CylinderGeometry(0.25, 0.25, 0.26, 20),
    tireR: new THREE.CylinderGeometry(0.29, 0.29, 0.34, 20),
    rim: new THREE.CylinderGeometry(0.15, 0.15, 0.28, 14),
    column: new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6),
    steer: new THREE.TorusGeometry(0.17, 0.028, 10, 32),
    spoke: new THREE.BoxGeometry(0.03, 0.32, 0.05),
    lever: new THREE.CylinderGeometry(0.012, 0.016, 0.38, 8),
    knob: new THREE.SphereGeometry(0.03, 10, 8),
    torso: new THREE.CapsuleGeometry(0.21, 0.3, 4, 10),
    arm: new THREE.CapsuleGeometry(0.07, 0.32, 4, 8),
    helmet: new THREE.SphereGeometry(0.25, 20, 16),
    stripe: new THREE.TorusGeometry(0.25, 0.035, 8, 24, Math.PI),
    visor: new THREE.SphereGeometry(0.255, 20, 16, -0.9, 1.8, 1.0, 0.75),
    exhaust: new THREE.CylinderGeometry(0.06, 0.07, 0.28, 10),
    flame: new THREE.ConeGeometry(0.11, 0.55, 10),
    plate: new THREE.PlaneGeometry(0.42, 0.26),
    shadow: new THREE.PlaneGeometry(2.6, 1.7),
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
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

function numberPlate(n, color) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 80;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(2, 2, 124, 76, 18);
  ctx.fill();
  ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
  ctx.font = 'italic 900 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), 64, 44);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class KartModel {
  constructor(color, name, { isPlayer = false, number = 1 } = {}) {
    const G = geos();
    this.group = new THREE.Group();
    const base = new THREE.Color(color);
    const paint = toon({ color: base });
    const accent = toon({ color: base.clone().offsetHSL(0.08, 0, 0.15) });
    const dark = toon({ color: 0x23232b });
    const chrome = toon({ color: 0xd9dde5 });
    const tire = toon({ color: 0x1b1b20 });
    const rimMat = toon({ color: 0xffd23f });

    const body = new THREE.Mesh(G.body, paint);
    body.position.y = 0.3;
    const nose = new THREE.Mesh(G.nose, accent);
    nose.position.set(0.95, 0.28, 0);
    const bumperF = new THREE.Mesh(G.bumper, dark);
    bumperF.position.set(1.35, 0.22, 0);
    const bumperR = new THREE.Mesh(G.bumper, dark);
    bumperR.position.set(-1.0, 0.25, 0);
    const podL = new THREE.Mesh(G.pod, accent);
    podL.position.set(0.05, 0.32, -0.62);
    const podR = podL.clone();
    podR.position.z = 0.62;
    const seat = new THREE.Mesh(G.seat, dark);
    seat.position.set(-0.42, 0.6, 0);
    // リアウイング
    const wing = new THREE.Mesh(G.wing, accent);
    wing.position.set(-0.98, 0.78, 0);
    const postL = new THREE.Mesh(G.wingPost, dark);
    postL.position.set(-0.95, 0.6, -0.35);
    const postR = postL.clone();
    postR.position.z = 0.35;
    // ゼッケン
    const plate = new THREE.Mesh(G.plate, toon({ map: numberPlate(number, color) }));
    plate.position.set(1.33, 0.36, 0);
    plate.rotation.y = Math.PI / 2;
    this.group.add(body, nose, bumperF, bumperR, podL, podR, seat, wing, postL, postR, plate);

    // マフラーとブーストの炎
    this.flames = [];
    for (const z of [-0.22, 0.22]) {
      const ex = new THREE.Mesh(G.exhaust, chrome);
      ex.rotation.z = Math.PI / 2;
      ex.position.set(-1.1, 0.42, z);
      const flame = new THREE.Mesh(G.flame, new THREE.MeshBasicMaterial({ color: 0x5fd8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      flame.rotation.z = Math.PI / 2;
      flame.position.set(-1.5, 0.42, z);
      flame.visible = false;
      this.group.add(ex, flame);
      this.flames.push(flame);
    }

    this.wheels = [];
    for (const [x, z, front] of [[0.68, -0.66, true], [0.68, 0.66, true], [-0.62, -0.7, false], [-0.62, 0.7, false]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, front ? 0.25 : 0.29, z);
      const spin = new THREE.Group();
      const w = new THREE.Mesh(front ? G.tireF : G.tireR, tire);
      w.rotation.x = Math.PI / 2;
      const rim = new THREE.Mesh(G.rim, rimMat);
      rim.rotation.x = Math.PI / 2;
      spin.add(w, rim);
      pivot.add(spin);
      this.group.add(pivot);
      this.wheels.push({ pivot, spin, front });
    }

    // ハンドル（ほぼ垂直。下側をわずかに手前に）
    this.steerGroup = new THREE.Group();
    this.steerGroup.position.set(0.22, 0.74, 0);
    this.steerGroup.rotation.z = -0.15;
    const column = new THREE.Mesh(G.column, dark);
    column.rotation.z = Math.PI / 2;
    column.position.set(0.1, -0.02, 0);
    this.steerWheel = new THREE.Group();
    const ring = new THREE.Mesh(G.steer, toon({ color: 0x3a3a46 }));
    ring.rotation.y = Math.PI / 2;
    // スポークは横と下だけ（上は視界をふさがないように空ける）
    const spoke = new THREE.Mesh(G.spoke, chrome);
    spoke.scale.y = 0.5;
    spoke.position.y = -0.08;
    const spoke2 = new THREE.Mesh(G.spoke, chrome);
    spoke2.rotation.x = Math.PI / 2;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, 0.05), toon({ color: 0xffd23f }));
    grip.position.y = 0.17;
    this.steerWheel.add(ring, spoke, spoke2, grip);
    this.steerGroup.add(column, this.steerWheel);
    this.group.add(this.steerGroup);

    // サイドブレーキのレバー（シートの右横。引くと後ろへ倒れる）
    this.lever = new THREE.Group();
    this.lever.position.set(-0.32, 0.4, 0.36);
    const rod = new THREE.Mesh(G.lever, chrome);
    rod.position.y = 0.19;
    const knob = new THREE.Mesh(G.knob, toon({ color: 0xff3b5c }));
    knob.position.y = 0.39;
    this.lever.add(rod, knob);
    this.group.add(this.lever);

    // ドライバー（プレイヤーのコックピット視点では隠す）。大きなヘルメットでかわいらしく
    this.driver = new THREE.Group();
    const suit = toon({ color: base.clone().offsetHSL(0, -0.1, -0.1) });
    const torso = new THREE.Mesh(G.torso, suit);
    torso.position.set(-0.38, 0.9, 0);
    for (const z of [-0.2, 0.2]) {
      const arm = new THREE.Mesh(G.arm, suit);
      arm.position.set(-0.08, 0.88, z);
      arm.rotation.z = Math.PI / 2.6;
      this.driver.add(arm);
    }
    const helmet = new THREE.Mesh(G.helmet, toon({ color: 0xffffff }));
    helmet.position.set(-0.32, 1.32, 0);
    const stripe = new THREE.Mesh(G.stripe, paint);
    stripe.position.copy(helmet.position);
    stripe.rotation.set(0, Math.PI / 2, Math.PI / 2);
    const visor = new THREE.Mesh(G.visor, toon({ color: 0x1c2a4a }));
    visor.rotation.y = -Math.PI / 2;
    visor.position.copy(helmet.position);
    this.driver.add(torso, helmet, stripe, visor);
    this.group.add(this.driver);

    const shadow = new THREE.Mesh(G.shadow, new THREE.MeshBasicMaterial({ map: blobShadow(), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.04;
    this.group.add(shadow);

    if (!isPlayer && name) this.group.add(this.makeLabel(name, color));
    this.wheelSpin = 0;
    this.flameT = 0;
    // ヨー → ピッチ → ロールの順に回す
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
    sp.position.y = 2.1;
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
    this.wheelSpin -= (v / 0.27) * dt;
    for (const w of this.wheels) {
      w.spin.rotation.z = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = -kart.steerAngle;
    }
    this.steerWheel.rotation.x = steer * THREE.MathUtils.degToRad(lockDeg / 2);
    const hb = kart.handbrakeInput || 0;
    this.lever.rotation.z = 0.35 + hb * 0.6;
    // ブースト中は青い炎がゆらめく
    this.flameT += dt;
    const boosting = kart.boost > 0;
    for (const f of this.flames) {
      f.visible = boosting;
      if (boosting) {
        const s = 0.8 + Math.sin(this.flameT * 40 + f.position.z * 10) * 0.25 + Math.random() * 0.15;
        f.scale.set(1, s, 1);
        f.position.x = -1.38 - 0.28 * s;
      }
    }
  }
}
