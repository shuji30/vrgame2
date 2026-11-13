// コックピット:常に視界に入る枠(静止した基準物)、計器、簡易モニター、揺れる小物、仮想レバー、ハンドルとペダル
// 車体の揺れはカメラに伝えず、ここの小物の揺れと FFB で表現する
import * as THREE from '../../vendor/three.module.js';
import { fmtTime, clamp } from '../core/util.js';

const W = 1024, H = 300;

export class Cockpit {
  constructor(opts = {}) {
    this.group = new THREE.Group(); // 視点の原点(目の位置)に置く
    this.kind = opts.kind || 'medium';
    const metal = new THREE.MeshStandardMaterial({ color: 0x4a4438, roughness: 0.85, metalness: 0.35, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23211e, roughness: 0.9, metalness: 0.2 });
    const warm = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.8, metalness: 0.2, flatShading: true });
    this.mats = { metal, dark, warm };
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      this.group.add(m);
      return m;
    };
    // 車内を囲う壁(左右・後ろ・天井・床)。外は前の覗き窓と、左右の細い視察窓からだけ見える
    const wallTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#5a5240';
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 3;
      g.strokeRect(2, 2, 124, 124);
      g.fillStyle = 'rgba(30,25,15,0.7)';
      for (const x of [10, 64, 118]) for (const y of [10, 64, 118]) { g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); }
      for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? 0 : 255},${Math.random() < 0.5 ? 0 : 200},0,0.04)`; g.fillRect(Math.random() * 128, Math.random() * 128, 4, 4); }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(3, 2);
      return t;
    })();
    const wall = new THREE.MeshStandardMaterial({ color: 0x9a8e74, map: wallTex, roughness: 0.9, metalness: 0.2, side: THREE.DoubleSide });
    this.mats.wall = wall;
    const walls = [];
    const W2 = (geo, x, y, z) => { const m = add(geo, wall, x, y, z); walls.push(m); return m; };
    W2(new THREE.BoxGeometry(2.12, 0.04, 1.36), 0, 0.6, 0.02); // 天井
    W2(new THREE.BoxGeometry(2.12, 0.04, 1.36), 0, -0.9, 0.02); // 床
    W2(new THREE.BoxGeometry(2.12, 1.54, 0.04), 0, -0.15, -0.64); // 後ろ
    for (const sx of [1, -1]) {
      W2(new THREE.BoxGeometry(0.04, 0.9, 1.36), sx * 1.04, -0.45, 0.02); // 視察窓より下
      W2(new THREE.BoxGeometry(0.04, 0.52, 1.36), sx * 1.04, 0.34, 0.02); // 視察窓より上
      W2(new THREE.BoxGeometry(0.04, 0.08, 0.9), sx * 1.04, 0.04, -0.21); // 視察窓の後ろ半分はふさぐ
    }
    W2(new THREE.BoxGeometry(2.2, 0.56, 0.06), 0, -0.43, 0.74); // 覗き窓より下の前壁
    // 天井の小さな室内灯
    const lamp = add(new THREE.BoxGeometry(0.12, 0.03, 0.06), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), 0, 0.575, -0.2);
    walls.push(lamp);
    this.walls = walls;
    // 車内灯(暗くなりすぎないように、手元だけを照らす)
    const lampLight = new THREE.PointLight(0xffd9a0, 2.2, 2.6, 1.5);
    lampLight.position.set(0, 0.45, 0);
    this.group.add(lampLight);
    // シート(座面と背もたれ)。目の高さから 0.75m 下が座面
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.95 });
    add(new THREE.BoxGeometry(0.5, 0.1, 0.48), seatMat, 0, -0.8, -0.12);
    add(new THREE.BoxGeometry(0.5, 0.62, 0.1), seatMat, 0, -0.45, -0.4, -0.12);
    add(new THREE.BoxGeometry(0.07, 0.07, 0.4), metal, 0.29, -0.66, -0.12); // ひじ掛け
    add(new THREE.BoxGeometry(0.07, 0.07, 0.4), metal, -0.29, -0.66, -0.12);
    add(new THREE.BoxGeometry(0.1, 0.12, 0.1), metal, 0, -0.87, -0.12); // 脚
    // 覗き窓の枠(上の梁・下の計器盤・左右の柱)
    add(new THREE.BoxGeometry(2.2, 0.32, 0.12), metal, 0, 0.44, 0.62);
    add(new THREE.BoxGeometry(2.2, 0.06, 0.2), warm, 0, 0.27, 0.6); // 窓の上縁
    add(new THREE.BoxGeometry(0.12, 1.2, 0.12), metal, -0.98, 0.0, 0.62, 0, 0, -0.08);
    add(new THREE.BoxGeometry(0.12, 1.2, 0.12), metal, 0.98, 0.0, 0.62, 0, 0, 0.08);
    // 溶接の跡(手作りの改造)
    for (let i = 0; i < 9; i++) add(new THREE.BoxGeometry(0.04, 0.04, 0.03), warm, -0.8 + i * 0.2, 0.3, 0.56);
    // 計器盤
    const dashTilt = -0.55;
    add(new THREE.BoxGeometry(2.2, 0.04, 0.06), dark, 0, -0.16, 0.72);
    add(new THREE.BoxGeometry(2.2, 0.5, 0.1), metal, 0, -0.62, 0.7);
    // 計器(キャンバス)
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const panel = add(new THREE.PlaneGeometry(0.92, 0.92 * (H / W)), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }), 0.08, -0.3, 0.5, -dashTilt, Math.PI);
    this.panel = panel;
    // 簡易モニター(レーダー)
    this.radar = document.createElement('canvas');
    this.radar.width = this.radar.height = 256;
    this.rctx = this.radar.getContext('2d');
    this.rtex = new THREE.CanvasTexture(this.radar);
    this.rtex.colorSpace = THREE.SRGBColorSpace;
    // 運転手の目の方へ向ける(モニターは右手側。コックピットの -X が右)
    add(new THREE.BoxGeometry(0.28, 0.28, 0.04), dark, -0.62, -0.3, 0.6, -dashTilt * 0.6, Math.PI - 0.75);
    const mon = add(new THREE.PlaneGeometry(0.24, 0.24), new THREE.MeshBasicMaterial({ map: this.rtex, toneMapped: false }), -0.603, -0.292, 0.583, -dashTilt * 0.6, Math.PI - 0.75);
    this.monitor = mon;
    // 揺れる小物(お守り)
    this.charmPivot = new THREE.Group();
    this.charmPivot.position.set(-0.62, 0.3, 0.6);
    this.group.add(this.charmPivot);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.1, 4), dark);
    cord.position.y = -0.05;
    this.charmPivot.add(cord);
    const charm = new THREE.Mesh(new THREE.OctahedronGeometry(0.018, 0), new THREE.MeshStandardMaterial({ color: 0xd8a040, metalness: 0.7, roughness: 0.3 }));
    charm.position.y = -0.11;
    this.charmPivot.add(charm);
    this.charm = { ax: 0, az: 0, vx: 0, vz: 0 };
    // 仮想レバー(左右の履帯)
    this.levers = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(-s * 0.26, -0.8, 0.32); // コックピットの +X が左
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.4, 8), metal);
      rod.position.y = 0.2;
      pivot.add(rod);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshStandardMaterial({ color: s < 0 ? 0xd06a2a : 0xd0a02a, roughness: 0.5 }));
      knob.position.y = 0.42;
      pivot.add(knob);
      this.group.add(pivot);
      this.levers.push({ pivot, knob, side: s, grab: null, value: 0, open: 0 });
    }
    // ハンドルとペダル(ハンコンのとき、実物の位置に合わせて表示する)
    this.wheelRig = new THREE.Group();
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 28), dark);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 0.02), dark);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 12), metal);
    hub.rotation.x = Math.PI / 2;
    this.wheelSpin = new THREE.Group();
    this.wheelSpin.add(wheel, spoke, hub);
    this.wheelSpin.rotation.x = -0.35;
    this.wheelRig.add(this.wheelSpin);
    this.pedals = [];
    // ペダル:左からクラッチ・ブレーキ・アクセル(コックピットの +X が左)。床から立てて、踏むと奥へ倒れる
    const pedalMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.4, metalness: 0.7 });
    for (let i = 0; i < 3; i++) {
      const pivot = new THREE.Group();
      pivot.position.set(0.14 - i * 0.14, -0.5, 0.14);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(i === 2 ? 0.06 : 0.08, 0.16, 0.02), pedalMat);
      pad.position.y = 0.08;
      pad.rotation.x = -0.35;
      pivot.add(pad);
      this.wheelRig.add(pivot);
      this.pedals.push(pivot);
    }
    // ハンドルの軸
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), metal);
    column.rotation.x = Math.PI / 2 - 0.35;
    column.position.set(0, -0.05, 0.14);
    this.wheelRig.add(column);
    // Hシフターとハンドブレーキ(右手側。コックピットの -X が右)
    this.shifter = new THREE.Group();
    this.shifter.position.set(-0.32, -0.62, 0.05);
    const sRod = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 6), metal);
    sRod.position.y = 0.1;
    const sKnob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.3 }));
    sKnob.position.y = 0.21;
    this.shifter.add(sRod, sKnob);
    this.wheelRig.add(this.shifter);
    this.handbrake = new THREE.Group();
    this.handbrake.position.set(-0.42, -0.6, -0.08);
    const hRod = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, 0.03), metal);
    hRod.position.y = 0.13;
    this.handbrake.add(hRod);
    this.wheelRig.add(this.handbrake);
    this.wheelRig.position.set(0, -0.36, 0.45);
    this.wheelRig.visible = false;
    this.group.add(this.wheelRig);
    this.t = 0;
    this.lastDraw = 0;
    // 計器は自車の車体より手前に必ず描く(VR ではのぞき窓の位置が車体の甲板に近いため)。奥の部品から順に描く
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      let z = 0;
      for (let p = o; p && p !== this.group; p = p.parent) z += p.position.z;
      // 壁は先に(外側)、計器や小物はその上に描く
      o.renderOrder = this.walls.includes(o) ? 400 : 500 + Math.round((1 - z) * 100);
      o.material.depthTest = false;
      o.material.depthWrite = false;
    });
  }

  setWheelOffset(o) {
    // 左右は設定画面の向き(右が正)に合わせる。コックピットの +X は左
    this.wheelRig.position.set(-(o.x ?? 0), -0.36 + (o.y ?? 0), 0.45 + (o.z ?? 0));
  }

  // 揺れる小物:車体の加速と旋回で振れる(減衰する振り子)
  sway(dt, accel, yawRate, bump) {
    const c = this.charm;
    const k = 40, d = 2.5;
    c.vx += (-k * c.ax - d * c.vx + accel * 0.6 + (Math.random() - 0.5) * bump * 30) * dt;
    c.vz += (-k * c.az - d * c.vz + yawRate * 1.2) * dt;
    c.ax += c.vx * dt;
    c.az += c.vz * dt;
    this.charmPivot.rotation.x = clamp(c.ax, -0.8, 0.8);
    this.charmPivot.rotation.z = clamp(c.az, -0.8, 0.8);
  }

  setLevers(l, r, lobOpen = 0) {
    for (const L of this.levers) {
      if (L.grab) continue; // VR で掴んでいる間は手の位置
      const v = L.side < 0 ? l : r;
      L.pivot.rotation.x = v * 0.5;
      L.pivot.rotation.z = L.side * lobOpen * 0.5;
    }
  }

  // angle: 実物のハンドルの回転角(rad、右が正)。奥向きの Z 軸まわりの正の回転は、座った人から見て右回り
  setWheel(angle, pedals, gear = 2, handbrake = 0) {
    this.wheelSpin.rotation.z = angle;
    pedals.forEach((v, i) => { this.pedals[i].rotation.x = v * 0.45; });
    // Hシフター:1・R は奥、3 は手前。左右は 1/2 が左、3/R が右(見た目の目安)
    const gx = { 1: 0.035, 2: 0.035, 3: -0.035, R: -0.035 }[gear] ?? 0;
    const gz = { 1: 0.4, 2: -0.4, 3: 0.4, R: -0.4 }[gear] ?? 0;
    this.shifter.rotation.set(gz * 0.6, 0, gx * 6);
    this.handbrake.rotation.x = -handbrake * 0.7;
  }

  // 計器を描く(10Hz 程度)
  draw(s) {
    const g = this.ctx;
    g.fillStyle = '#16140f';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#3a342a';
    g.lineWidth = 4;
    g.strokeRect(2, 2, W - 4, H - 4);
    const amber = '#ffb33a', green = '#6cff8a', red = '#ff5a3a', dim = '#5a4a32';
    g.font = 'bold 26px system-ui, sans-serif';
    g.textBaseline = 'middle';
    // 左右の履帯の出力メーター(左右別々に操る楽しさを目で確かめる)
    const meter = (x, v, label, broken) => {
      g.fillStyle = '#0a0a08';
      g.fillRect(x, 30, 60, 230);
      g.fillStyle = dim;
      g.fillRect(x, 144, 60, 2);
      const h = clamp(v, -1, 1) * 112;
      g.fillStyle = broken ? red : v >= 0 ? green : amber;
      if (h >= 0) g.fillRect(x + 6, 145 - h, 48, h); else g.fillRect(x + 6, 147, 48, -h);
      g.fillStyle = broken ? red : '#ddd';
      g.textAlign = 'center';
      g.fillText(broken ? '損傷' : label, x + 30, 280);
    };
    meter(20, s.tl, '左', s.brokenL);
    meter(944, s.tr, '右', s.brokenR);
    g.textAlign = 'left';
    // 装填
    g.fillStyle = '#ddd';
    g.fillText('装填', 110, 50);
    g.fillStyle = '#0a0a08';
    g.fillRect(190, 36, 260, 28);
    g.fillStyle = s.reload01 >= 1 ? green : amber;
    g.fillRect(193, 39, 254 * clamp(s.reload01, 0, 1), 22);
    if (s.reload01 >= 1) { g.fillStyle = '#000'; g.fillText('完了', 290, 51); }
    // 耐久
    g.fillStyle = '#ddd';
    g.fillText('装甲', 110, 95);
    g.fillStyle = '#0a0a08';
    g.fillRect(190, 81, 260, 28);
    g.fillStyle = s.hp01 > 0.35 ? '#5ac8ff' : red;
    g.fillRect(193, 84, 254 * clamp(s.hp01, 0, 1), 22);
    // ギア
    g.fillStyle = '#ddd';
    g.fillText('ギア', 110, 145);
    g.font = 'bold 54px system-ui, sans-serif';
    g.fillStyle = s.gear === 'R' ? red : amber;
    g.fillText(String(s.gear), 200, 147);
    g.font = 'bold 26px system-ui, sans-serif';
    // 速度と照準の状態
    g.fillStyle = '#ddd';
    g.fillText(`${Math.round(Math.abs(s.speed) * 3.6)} km/h`, 270, 147);
    g.fillStyle = s.still ? green : amber;
    g.fillText(s.still ? '停車射撃' : '走行射撃', 110, 195);
    g.fillStyle = '#ddd';
    g.fillText(s.subLabel, 270, 195);
    g.fillText(s.extra || '', 110, 245);
    // 右側:残り時間・目標・残機
    g.textAlign = 'right';
    g.font = 'bold 58px system-ui, sans-serif';
    g.fillStyle = s.timeLeft != null && s.timeLeft < 30 ? red : amber;
    g.fillText(s.timeLeft != null ? fmtTime(s.timeLeft) : '--:--', 900, 60);
    g.font = 'bold 26px system-ui, sans-serif';
    g.fillStyle = '#ddd';
    g.fillText(s.objText || '', 900, 120);
    g.fillText(s.livesText || '', 900, 165);
    g.fillText(s.scoreText || '', 900, 210);
    g.fillStyle = s.elevText ? '#55e0ff' : '#ddd';
    g.fillText(s.elevText || '', 900, 255);
    // 車体と砲塔の向き
    g.save();
    g.translate(560, 150);
    g.strokeStyle = dim;
    g.lineWidth = 3;
    g.beginPath(); g.arc(0, 0, 70, 0, 7); g.stroke();
    g.rotate(s.turret); // 砲塔が上。砲塔が左を向くと車体は右へ傾いて見える
    g.fillStyle = '#8a7a5a';
    g.fillRect(-18, -30, 36, 60); // 車体(上が前)
    g.restore();
    g.save();
    g.translate(560, 150);
    g.strokeStyle = amber;
    g.lineWidth = 6;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -62); g.stroke();
    g.fillStyle = amber;
    g.beginPath(); g.arc(0, 0, 14, 0, 7); g.fill();
    g.restore();
    g.textAlign = 'center';
    g.fillStyle = '#9a8a6a';
    g.font = '20px system-ui, sans-serif';
    g.fillText('砲塔', 560, 250);
    this.tex.needsUpdate = true;
  }

  // レーダー:自分を中心に、砲塔の向きが上
  drawRadar(sim, me, viewYaw) {
    const g = this.rctx;
    const R = 128, range = 160;
    g.fillStyle = '#071a10';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(80,255,140,0.25)';
    g.lineWidth = 2;
    for (const r of [40, 80, 120]) { g.beginPath(); g.arc(R, R, r, 0, 7); g.stroke(); }
    g.beginPath(); g.moveTo(R, 0); g.lineTo(R, 256); g.moveTo(0, R); g.lineTo(256, R); g.stroke();
    const c = Math.cos(viewYaw), s = Math.sin(viewYaw);
    const toScreen = (x, z) => {
      const dx = x - me.x, dz = z - me.z;
      // 視線の向きを上に:右手系で、yaw の向きが画面上
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      return [R - (lx / range) * 120, R - (lz / range) * 120];
    };
    for (const e of sim.ents) {
      if (!e.alive || e === me || e.hidden) continue;
      const [x, y] = toScreen(e.x, e.z);
      if (x < 0 || y < 0 || x > 256 || y > 256) continue;
      const foe = e.team !== me.team;
      g.fillStyle = !foe ? '#5ac8ff' : e.objective || e.type === 'boss' ? '#ff4a2a' : e.ai?.state === 'sleep' ? '#7a6a3a' : '#ffb33a';
      const sz = e.objective || e.type === 'boss' ? 7 : 4;
      if (e.objective || e.type === 'boss') { g.fillRect(x - sz, y - sz, sz * 2, sz * 2); }
      else { g.beginPath(); g.arc(x, y, sz, 0, 7); g.fill(); }
    }
    if (sim.exit?.open) {
      const [x, y] = toScreen(sim.exit.x, sim.exit.z);
      g.strokeStyle = '#7dffb0';
      g.lineWidth = 3;
      g.beginPath(); g.arc(clamp(x, 8, 248), clamp(y, 8, 248), 9, 0, 7); g.stroke();
    }
    for (const el of sim.elevators) {
      const [x, y] = toScreen(el.x, el.z);
      g.strokeStyle = '#55e0ff';
      g.strokeRect(x - 4, y - 4, 8, 8);
    }
    // 自分
    g.fillStyle = '#6cff8a';
    g.beginPath(); g.moveTo(R, R - 10); g.lineTo(R - 7, R + 7); g.lineTo(R + 7, R + 7); g.fill();
    this.rtex.needsUpdate = true;
  }
}
