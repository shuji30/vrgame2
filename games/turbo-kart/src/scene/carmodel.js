// GT3 とフォーミュラカーの見た目（アニメ調）。KartModel と同じ使い方ができる
// 前方 = ローカル +X、右 = +Z
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mat, addOutline } from './theme.js';
import { buildHead, animateDriver } from './characters.js';
import { buildRealFormula } from './realcars.js';

function label(name, color) {
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
  sp.scale.set(1.8, 0.45, 1);
  return sp;
}

function numberTex(n, color) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
  ctx.font = 'italic 900 70px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class CarModel {
  constructor(type, color, name, { isPlayer = false, number = 1, theme = 'party', character = 'bear' } = {}) {
    this.theme = theme;
    const party = theme === 'party';
    this.type = type;
    this.group = new THREE.Group();
    this.group.rotation.order = 'YZX';
    const base = new THREE.Color(color);
    const paint = mat(theme, { color: base }, 'paint');
    const accent = mat(theme, { color: base.clone().offsetHSL(0.06, 0, party ? 0.12 : 0) }, 'paint');
    const dark = mat(theme, { color: 0x1e1f26 }, 'carbon');
    const glass = mat(theme, { color: party ? 0x223355 : 0x0d1420 }, 'glass');
    const carbon = mat(theme, { color: party ? 0x2b2c33 : 0x1a1b20 }, 'carbon');
    const tire = mat(theme, { color: 0x17171c }, 'rubber');
    const rimMat = mat(theme, { color: party ? 0xd9dde5 : 0x9a9ea6 }, 'metal');
    const formula = type === 'formula';
    // 運転席視点のときに隠す部品（視界をふさぐ屋根・キャビン・ハロー）
    this.cockpitHide = [];

    // 車輪
    const wb = formula ? 3.2 : 2.7;
    const tr = formula ? 0.82 : 0.85;
    const rF = formula ? 0.34 : 0.36, rR = formula ? 0.36 : 0.37;
    const wF = formula ? 0.32 : 0.3, wR = formula ? 0.42 : 0.32;
    this.wheels = [];
    for (const [x, z, front] of [[wb * 0.55, -tr, true], [wb * 0.55, tr, true], [-wb * 0.45, -tr, false], [-wb * 0.45, tr, false]]) {
      const pivot = new THREE.Group();
      const r = front ? rF : rR;
      pivot.position.set(x, r, z);
      const spin = new THREE.Group();
      const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, front ? wF : wR, 22), tire);
      t.rotation.x = Math.PI / 2;
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, (front ? wF : wR) + 0.02, 14), rimMat);
      rim.rotation.x = Math.PI / 2;
      spin.add(t, rim);
      if (theme === 'real') {
        // タイヤ側面の色の帯（コンパウンドの表示）
        const band = new THREE.MeshStandardMaterial({ color: formula ? 0xf2c400 : 0xd8d8d8, roughness: 0.7 });
        for (const s of [-1, 1]) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.8, r * 0.03, 6, 36), band);
          ring.position.z = (s * ((front ? wF : wR) + 0.004)) / 2;
          spin.add(ring);
        }
      }
      pivot.add(spin);
      this.group.add(pivot);
      this.wheels.push({ pivot, spin, front });
    }
    this.wheelRadius = (rF + rR) / 2;

    if (formula && theme === 'real') {
      // 本格: 実車に近いフォーミュラ（細いノーズ・多段のウイング・サイドポッド・エアボックス・ヘイロー・アーム）
      const info = buildRealFormula(this, { paint, accent, carbon, plate: mat(theme, { map: numberTex(number, color) }, 'paint') });
      this.cockpitHide.push(...info.hide);
      this.eye = info.eye;
      this.steerPos = info.steerPos;
    } else if (formula) {
      // モノコック・ノーズ・フロントウイング・サイドポッド・リアウイング
      const tub = new THREE.Mesh(new RoundedBoxGeometry(3.4, 0.42, 0.75, 3, 0.15), paint);
      tub.position.set(0.1, 0.42, 0);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.6, 12), paint);
      nose.rotation.z = -Math.PI / 2;
      nose.scale.set(1, 1, 0.6);
      nose.position.set(2.5, 0.38, 0);
      const fwing = new THREE.Mesh(new RoundedBoxGeometry(0.45, 0.05, 2.0, 2, 0.02), accent);
      fwing.position.set(3.05, 0.14, 0);
      const pods = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.42, 1.6, 3, 0.18), paint);
      pods.position.set(-0.35, 0.36, 0);
      const engine = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.5, 0.6, 3, 0.2), accent);
      engine.position.set(-1.2, 0.62, 0);
      const rwing = new THREE.Mesh(new RoundedBoxGeometry(0.45, 0.07, 1.5, 2, 0.02), accent);
      rwing.position.set(-1.95, 1.0, 0);
      const plateL = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.03), carbon);
      plateL.position.set(-1.95, 0.85, -0.76);
      const plateR = plateL.clone();
      plateR.position.z = 0.76;
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 8, 20, Math.PI), carbon);
      halo.rotation.set(0, Math.PI / 2, 0);
      halo.position.set(0.15, 0.68, 0);
      const num = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), mat(theme, { map: numberTex(number, color) }, 'paint'));
      num.position.set(1.6, 0.64, 0);
      num.rotation.x = -Math.PI / 2;
      num.rotation.z = -Math.PI / 2;
      this.group.add(tub, nose, fwing, pods, engine, rwing, plateL, plateR, halo, num);
      this.cockpitHide.push(halo);
      this.eye = new THREE.Vector3(-0.2, 0.92, 0);
      this.steerPos = new THREE.Vector3(0.22, 0.66, 0);
    } else if (theme === 'real') {
      this.buildRealGT3({ paint, glass, carbon, dark, color, number });
    } else {
      // GT3: ボディ・キャビン・リアウイング・スプリッター
      const body = new THREE.Mesh(new RoundedBoxGeometry(4.6, 0.62, 2.0, 4, 0.25), paint);
      body.position.set(0, 0.55, 0);
      const cabin = new THREE.Mesh(new RoundedBoxGeometry(2.1, 0.55, 1.65, 4, 0.25), glass);
      cabin.position.set(-0.25, 1.08, 0);
      const roof = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.08, 1.45, 2, 0.04), paint);
      roof.position.set(-0.35, 1.36, 0);
      const splitter = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.06, 2.0, 2, 0.02), carbon);
      splitter.position.set(2.35, 0.24, 0);
      const wing = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.07, 1.9, 2, 0.02), carbon);
      wing.position.set(-2.1, 1.42, 0);
      for (const z of [-0.6, 0.6]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.06), carbon);
        post.position.set(-2.05, 1.15, z);
        this.group.add(post);
      }
      const stripe = new THREE.Mesh(new RoundedBoxGeometry(4.62, 0.05, 0.4, 2, 0.02), mat(theme, { color: 0xffffff }, 'paint'));
      stripe.position.set(0, 0.87, 0);
      const num = new THREE.Mesh(new THREE.CircleGeometry(0.32, 24), mat(theme, { map: numberTex(number, color) }, 'paint'));
      num.position.set(0.3, 0.6, 1.005);
      const num2 = num.clone();
      num2.position.z = -1.005;
      num2.rotation.y = Math.PI;
      for (const z of [-0.65, 0.65]) {
        const light = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), new THREE.MeshBasicMaterial({ color: 0xfff6c8 }));
        light.position.set(2.31, 0.62, z);
        light.rotation.y = Math.PI / 2;
        this.group.add(light);
      }
      // ダッシュボード（運転席視点で見える）
      const dash = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.14, 1.6, 2, 0.05), dark);
      dash.position.set(0.55, 0.92, 0);
      this.group.add(body, cabin, roof, splitter, wing, stripe, num, num2, dash);
      this.cockpitHide.push(cabin, roof);
      // 左ハンドル（運転席は進行方向の左 = -Z 側）
      this.eye = new THREE.Vector3(-0.35, 1.18, -0.38);
      // ハンドルは目より 0.3m ほど下（輪の上端が前の景色を遮らない高さ）
      this.steerPos = new THREE.Vector3(0.1, 0.85, -0.38);
    }

    if (party) {
      // 車体に縁取りを付け、GT3 のガラスは半透明にして中の動物が見えるようにする
      const parts = [];
      this.group.traverse((o) => { if (o.isMesh && o.material !== glass) parts.push(o); });
      for (const o of parts) addOutline(o, 0.035);
      glass.transparent = true;
      glass.opacity = 0.45;
    }

    // ハンドル
    this.steerGroup = new THREE.Group();
    this.steerGroup.position.copy(this.steerPos);
    this.steerGroup.rotation.z = -0.15;
    this.steerWheel = new THREE.Group();
    const ringR = formula ? 0.14 : 0.18;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.025, 10, 32), mat(theme, { color: 0x33343e }, 'rubber'));
    ring.rotation.y = Math.PI / 2;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, ringR * 2), mat(theme, { color: 0xd9dde5 }, 'metal'));
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, 0.05), mat(theme, { color: 0xffd23f }));
    grip.position.y = ringR;
    this.steerWheel.add(ring, bar, grip);
    this.steerGroup.add(this.steerWheel);
    this.group.add(this.steerGroup);
    this.lever = new THREE.Group(); // 互換のため（車ではサイドブレーキのレバーを表示しない）

    // ドライバー（頭だけ見える）。腰の位置を支点に傾ける
    this.driver = new THREE.Group();
    this.driver.position.copy(this.eye).add(new THREE.Vector3(-0.05, -0.45, 0));
    if (party) {
      this.head = buildHead(character);
      // GT3 は屋根の下に収まる高さ（フォーミュラはコックピットから頭が出る）
      this.headBase = formula ? 0.47 : 0.35;
      this.head.group.position.set(0, this.headBase, 0);
      this.head.group.scale.setScalar(0.72);
      this.headScale = 0.72;
      this.driver.add(this.head.group);
    } else {
      const hr = formula ? 0.2 : 0.15; // GT3 は屋根を突き抜けないよう小さく低く
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(hr, 18, 14), mat(theme, { color: 0xffffff }, 'paint'));
      helmet.position.set(0, formula ? 0.47 : 0.33, 0);
      const visor = new THREE.Mesh(new THREE.SphereGeometry(hr * 1.025, 18, 14, -0.9, 1.8, 1.0, 0.75), mat(theme, { color: 0x1c2a4a }, 'glass'));
      visor.rotation.y = -Math.PI / 2;
      visor.position.copy(helmet.position);
      this.driver.add(helmet, visor);
    }
    this.group.add(this.driver);

    // ブーストの炎（排気）
    this.flames = [];
    const ex = formula ? [[-2.0, 0.5, 0]] : [[-2.32, 0.32, -0.5], [-2.32, 0.32, 0.5]];
    for (const [x, y, z] of ex) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.6, 10), new THREE.MeshBasicMaterial({ color: 0x5fd8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      f.rotation.z = Math.PI / 2;
      f.position.set(x - 0.3, y, z);
      f.userData.x0 = x;
      f.visible = false;
      this.group.add(f);
      this.flames.push(f);
    }

    // 影
    const sh = document.createElement('canvas');
    sh.width = sh.height = 64;
    const sctx = sh.getContext('2d');
    const g = sctx.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, 64, 64);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(formula ? 6.2 : 5.6, 2.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sh), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.04;
    this.group.add(shadow);
    if (theme === 'real') {
      shadow.material.opacity = 0.5;
      this.group.traverse((o) => { if (o.isMesh && o !== shadow && o.material.blending !== THREE.AdditiveBlending) o.castShadow = true; });
    }

    if (!isPlayer && name) {
      const l = label(name, color);
      l.position.y = formula ? 1.9 : 2.3;
      this.group.add(l);
    }
    this.wheelSpin = 0;
    this.flameT = 0;
    this.rear = { x: -wb * 0.45, z: tr };
  }

  // 写実モードの GT3: 横から見た輪郭を押し出した車体（ボンネット → フロントガラス → ルーフ → リア）
  buildRealGT3({ paint, glass, carbon, dark, color, number }) {
    const V = (x, y) => new THREE.Vector2(x, y);
    const extrude = (shape, depth, bevel, mat) => {
      const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 18 });
      g.translate(0, 0, -depth / 2);
      return new THREE.Mesh(g, mat);
    };
    // 上半分（タイヤの上端より上）: 全幅
    const upper = new THREE.Shape();
    upper.moveTo(2.32, 0.6);
    upper.lineTo(2.3, 0.68);
    upper.splineThru([V(1.9, 0.74), V(1.25, 0.8), V(0.65, 0.84)]);
    upper.splineThru([V(0.15, 1.1), V(-0.35, 1.17), V(-1.0, 1.15)]);
    upper.splineThru([V(-1.6, 1.0), V(-2.0, 0.95), V(-2.3, 0.93)]);
    upper.lineTo(-2.32, 0.6);
    upper.closePath();
    const body = extrude(upper, 1.84, 0.05, paint);
    // 窓（車体よりわずかに外側に出して、横と前後から見えるようにする）
    const win = new THREE.Shape();
    win.moveTo(0.6, 0.87);
    win.splineThru([V(0.15, 1.08), V(-0.35, 1.13), V(-1.0, 1.11)]);
    win.splineThru([V(-1.55, 0.98)]);
    win.lineTo(-1.6, 0.88);
    win.closePath();
    const windows = extrude(win, 1.86, 0.062, glass);
    // 下半分: タイヤの前後と間（ホイールハウスの開口を残す）、中央は細い床
    const lower = (x0, x1, w) => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(x1 - x0, 0.42, w, 3, 0.06), paint);
      m.position.set((x0 + x1) / 2, 0.41, 0);
      return m;
    };
    const bumperF = lower(1.88, 2.36, 1.94);
    const skirt = lower(-0.82, 1.1, 1.94);
    const bumperR = lower(-2.34, -1.6, 1.94);
    const floor = lower(-2.2, 2.2, 1.3);
    // フロントスプリッター・リアディフューザー・スワンネックのリアウイング
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.04, 2.0), carbon);
    splitter.position.set(2.3, 0.22, 0);
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 1.6), carbon);
    diffuser.position.set(-2.32, 0.3, 0);
    const wing = new THREE.Mesh(new RoundedBoxGeometry(0.38, 0.04, 1.85, 2, 0.015), carbon);
    wing.position.set(-2.12, 1.32, 0);
    wing.rotation.z = 0.12;
    for (const z of [-0.45, 0.45]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.42, 0.03), carbon);
      post.position.set(-2.05, 1.12, z);
      post.rotation.z = -0.35;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 0.02), carbon);
      plate.position.set(-2.12, 1.32, z * 2.07);
      this.group.add(post, plate);
    }
    // ライト・ミラー・ゼッケン
    for (const z of [-0.66, 0.66]) {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.38), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 0.8, roughness: 0.2 }));
      head.position.set(2.27, 0.7, z);
      head.rotation.z = -0.35;
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.42), new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.9 }));
      tail.position.set(-2.33, 0.86, z);
      const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.09, 0.16, 2, 0.03), paint);
      mirror.position.set(0.45, 0.97, z * 1.52);
      this.group.add(head, tail, mirror);
    }
    const num = new THREE.Mesh(new THREE.CircleGeometry(0.3, 24), mat('real', { map: numberTex(number, color) }, 'paint'));
    num.position.set(-0.1, 0.42, 0.975);
    const num2 = num.clone();
    num2.position.z = -0.975;
    num2.rotation.y = Math.PI;
    // 運転席視点用のボンネットとダッシュボード（車体の内側からは車体が見えないため）
    const hoodShape = new THREE.Shape();
    hoodShape.moveTo(2.32, 0.6);
    hoodShape.lineTo(2.3, 0.68);
    hoodShape.splineThru([V(1.9, 0.74), V(1.25, 0.8), V(0.65, 0.84)]);
    hoodShape.lineTo(0.62, 0.6);
    hoodShape.closePath();
    const hood = extrude(hoodShape, 1.84, 0.05, paint);
    const dash = new THREE.Mesh(new RoundedBoxGeometry(0.45, 0.14, 1.7, 2, 0.05), dark);
    dash.position.set(0.5, 0.9, 0);
    hood.visible = dash.visible = false;
    this.group.add(body, windows, bumperF, skirt, bumperR, floor, splitter, diffuser, wing, num, num2, hood, dash);
    this.cockpitHide.push(body, windows);
    this.cockpitShow = [hood, dash];
    this.eye = new THREE.Vector3(-0.35, 1.12, -0.38);
    // ハンドルは目より 0.3m ほど下（輪の上端が前の景色を遮らない高さ）
    this.steerPos = new THREE.Vector3(0.1, 0.8, -0.38);
  }

  setCockpit(on) {
    this.driver.visible = !on;
    for (const m of this.cockpitHide) m.visible = !on;
    for (const m of this.cockpitShow || []) m.visible = on;
  }

  setExpression(name) {
    this.head?.setExpression(name);
  }

  update(pose, kart, steer, dt, lockDeg = 270) {
    this.group.position.set(pose.x, pose.y, pose.z);
    this.group.rotation.set(-pose.roll, -pose.heading, pose.pitch);
    const v = kart.vx * Math.cos(kart.heading) + kart.vz * Math.sin(kart.heading);
    this.wheelSpin -= (v / this.wheelRadius) * dt;
    for (const w of this.wheels) {
      w.spin.rotation.z = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = -kart.steerAngle;
    }
    this.steerWheel.rotation.x = steer * THREE.MathUtils.degToRad(lockDeg / 2);
    animateDriver(this, pose, kart, dt);
    this.flameT += dt;
    const boosting = kart.boost > 0;
    for (const f of this.flames) {
      f.visible = boosting;
      if (boosting) {
        const s = 0.8 + Math.sin(this.flameT * 40 + f.position.z * 10) * 0.25 + Math.random() * 0.15;
        f.scale.set(1, s, 1);
        f.position.x = f.userData.x0 - 0.3 * s;
      }
    }
  }
}
