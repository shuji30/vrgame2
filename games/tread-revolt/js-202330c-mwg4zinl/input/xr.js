// VR コントローラー:タンクコントロール(左右スティック前後)と、掴んで倒す仮想レバー
// どちらも共通アクションに変換して InputManager に渡す
import * as THREE from '../../vendor/three.module.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dz = (v, d = 0.18) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));

export class XrControls {
  constructor(renderer) {
    this.renderer = renderer;
    this.mode = 'sticks'; // sticks | levers
    this.turretHead = true; // 砲塔を頭の向きに追従させる
    this.prev = { left: [], right: [] };
    this.grips = [0, 1].map((i) => renderer.xr.getControllerGrip(i));
    this.ctrls = [0, 1].map((i) => renderer.xr.getController(i));
    this.handOf = new Map(); // index → 'left' | 'right'
    this.ctrls.forEach((c, i) => {
      c.addEventListener('connected', (e) => { this.handOf.set(i, e.data.handedness); c.userData.source = e.data; });
      c.addEventListener('disconnected', () => { this.handOf.delete(i); c.userData.source = null; });
    });
    // 手の目印(小さな箱)
    this.handMeshes = this.grips.map(() => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.1), new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.6 }));
      return m;
    });
    this.grips.forEach((g, i) => g.add(this.handMeshes[i]));
    // 手はコックピットの計器より手前に描く
    for (const m of this.handMeshes) { m.renderOrder = 800; m.material.depthTest = false; }
    this.tmp = new THREE.Vector3();
  }

  attach(parent) {
    for (const g of this.grips) parent.add(g);
    for (const c of this.ctrls) parent.add(c);
  }

  source(hand) {
    const session = this.renderer.xr.getSession();
    if (!session) return null;
    for (const s of session.inputSources) if (s.handedness === hand && s.gamepad) return s;
    return null;
  }

  gripOf(hand) {
    for (const [i, h] of this.handOf) if (h === hand) return this.grips[i];
    return null;
  }

  // cockpit: Cockpit(レバーの位置に使う)、camera: XR カメラ、seatYaw: 視点の向き(砲塔追従用)
  poll(cockpit, headYawLocal) {
    const out = { left: 0, right: 0, turret: 0, turretYaw: null, activity: false };
    const L = this.source('left'), R = this.source('right');
    const btn = (s, n) => (s?.gamepad.buttons[n]?.value ?? 0) > 0.5;
    const pl = this.prev.left, pr = this.prev.right;
    const edge = (s, prev, n) => btn(s, n) && !prev[n];
    const ax = (s, n) => dz(s?.gamepad.axes[n] ?? 0);
    const lx = ax(L, 2), ly = ax(L, 3), rx = ax(R, 2), ry = ax(R, 3);
    if (this.mode === 'sticks') {
      out.left = -ly;
      out.right = -ry;
      // 逆立ち曲射:両スティックを外に倒す(倒した量で距離)
      const open = Math.min(-lx, rx);
      if (open > 0.35 && Math.abs(ly) < 0.5 && Math.abs(ry) < 0.5) { out.lob = true; out.lobAmount = clamp((open - 0.35) / 0.6, 0, 1); out.lobAnalog = true; out.left = out.right = 0; }
      else if (!this.turretHead) out.turret = -rx;
    } else if (cockpit) {
      // 仮想レバー:握る(グリップ)と掴み、前後に倒した量が履帯の出力
      for (const lev of cockpit.levers) {
        const hand = lev.side < 0 ? 'left' : 'right';
        const s = hand === 'left' ? L : R;
        const grip = this.gripOf(hand);
        if (!grip || !s) { lev.grab = null; continue; }
        const p = cockpit.group.worldToLocal(grip.getWorldPosition(this.tmp));
        const knob = lev.knob.getWorldPosition(new THREE.Vector3());
        const kl = cockpit.group.worldToLocal(knob);
        const squeeze = btn(s, 1);
        if (squeeze && !lev.grab && p.distanceTo(kl) < 0.14) lev.grab = { z: p.z - Math.sin(lev.pivot.rotation.x) * 0.42, x: p.x };
        if (!squeeze) lev.grab = null;
        if (lev.grab) {
          lev.value = clamp((p.z - lev.grab.z) / 0.2, -1, 1);
          lev.open = clamp(((p.x - lev.grab.x) * (lev.side < 0 ? 1 : -1)) / 0.15, 0, 1);
          lev.pivot.rotation.x = lev.value * 0.5;
        } else {
          lev.value *= 0.8;
          lev.open = 0;
        }
      }
      out.left = cockpit.levers.find((l) => l.side < 0).value;
      out.right = cockpit.levers.find((l) => l.side > 0).value;
      const open = Math.min(...cockpit.levers.map((l) => l.open));
      if (open > 0.3) { out.lob = true; out.lobAmount = clamp((open - 0.3) / 0.7, 0, 1); out.lobAnalog = true; out.left = out.right = 0; }
      if (!this.turretHead) out.turret = -rx - lx;
    }
    if (this.turretHead && headYawLocal != null) out.turretYaw = headYawLocal;
    out.fire = edge(R, pr, 0);
    out.sub = btn(L, 0);
    out.subPress = edge(L, pl, 0);
    out.view = edge(R, pr, 4); // A
    out.hatch = false;
    out.subSelect = edge(L, pl, 4); // X
    out.pause = edge(L, pl, 5); // Y
    out.weaponSwap = edge(R, pr, 5); // B
    out.quickTurn = edge(R, pr, 3);
    out.quickDir = rx < 0 ? 1 : -1;
    out.recenter = edge(L, pl, 3); // 左スティックの押し込み:視点のリセット
    out.crouch = this.mode === 'sticks' ? btn(L, 1) : false; // 歩行メカのしゃがみ:左グリップ
    out.pitchRate = this.turretHead ? -ry * 0 : 0;
    // メニュー
    out.up = (ry < -0.6 && !(pr.ry < -0.6)) || (ly < -0.6 && !(pl.ry < -0.6));
    out.down = (ry > 0.6 && !(pr.ry > 0.6)) || (ly > 0.6 && !(pl.ry > 0.6));
    out.leftUi = rx < -0.6 && !(pr.rx < -0.6);
    out.rightUi = rx > 0.6 && !(pr.rx > 0.6);
    out.ok = out.fire;
    out.back = edge(R, pr, 5);
    out.activity = Math.abs(out.left) + Math.abs(out.right) > 0.05 || out.fire;
    const snap = (s, x, y) => { const a = s ? s.gamepad.buttons.map((b) => b.value > 0.5) : []; a.rx = x; a.ry = y; return a; };
    this.prev.left = snap(L, lx, ly);
    this.prev.right = snap(R, rx, ry);
    return out;
  }
}
