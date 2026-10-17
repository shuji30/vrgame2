// HUD と入力デバッグ表示。Canvas に描いてテクスチャとして 3D 空間に置く
import * as THREE from 'three';

function makePanel(w, h, cw, ch) {
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }),
  );
  mesh.renderOrder = 1000;
  return { canvas, ctx: canvas.getContext('2d'), tex, mesh };
}

const FONT = '"Segoe UI", "Hiragino Sans", "Meiryo", sans-serif';

function text(g, s, x, y, size, color = '#fff', align = 'left') {
  g.font = `bold ${size}px ${FONT}`;
  g.textAlign = align;
  g.lineJoin = 'round';
  g.lineWidth = Math.max(4, size * 0.14);
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(s, x, y);
  g.fillStyle = color;
  g.fillText(s, x, y);
}

export class Hud {
  constructor(camera) {
    Object.assign(this, makePanel(1.6, 0.8, 1024, 512));
    // 視野の中央付近に収める (Pimax のような広視野でも周辺に散らばらない)
    this.mesh.position.set(0, 0.02, -1.5);
    camera.add(this.mesh);
    this.key = '';
  }

  draw(d) {
    const key = JSON.stringify(d);
    if (key === this.key) return;
    this.key = key;
    const g = this.ctx;
    g.clearRect(0, 0, 1024, 512);

    if (d.play) {
      text(g, `DIST ${d.dist} m`, 24, 52, 34);
      text(g, `HIT ${d.hits}`, 24, 94, 28, '#ffd0d0');
      text(g, `VIEW ${d.view}`, 24, 130, 22, '#cfe8ff');

      // 速度計: 0.5倍〜1.5倍。白い目盛りが基準速度 (1.0倍)
      const x0 = 640, x1 = 1000, y = 28, h = 26;
      const t = (d.factor - 0.5) / 1.0;
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(x0 - 4, y - 4, x1 - x0 + 8, h + 8);
      g.fillStyle = `hsl(${120 - t * 120}, 85%, 55%)`;
      g.fillRect(x0, y, (x1 - x0) * t, h);
      g.fillStyle = '#fff';
      g.fillRect(x0 + (x1 - x0) * 0.5 - 2, y - 6, 4, h + 12);
      text(g, `${d.kmh} km/h`, x1, y + h + 40, 32, '#fff', 'right');
      text(g, `x${d.factor.toFixed(2)}`, x0, y + h + 40, 28, '#ffe680');
    }

    if (d.msg) text(g, d.msg, 512, 236, 70, '#ffe14a', 'center');
    if (d.sub) text(g, d.sub, 512, 296, 30, '#fff', 'center');
    if (d.hint) {
      g.globalAlpha = 0.85;
      text(g, d.hint, 512, 492, 21, '#fff', 'center');
      g.globalAlpha = 1;
    }
    this.tex.needsUpdate = true;
  }
}

const fmt = (v) => (v >= 0 ? ' ' : '') + v.toFixed(2);

export class DebugPanel {
  constructor(parent) {
    Object.assign(this, makePanel(1.0, 1.0, 1024, 1024));
    this.mesh.position.set(0, 1.25, -1.4);
    this.mesh.rotation.x = -0.35;
    this.mesh.renderOrder = 998; // HUD より奥に描く
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.t = 0;
  }

  get visible() { return this.mesh.visible; }
  set visible(v) { this.mesh.visible = v; }
  toggle() { this.mesh.visible = !this.mesh.visible; }

  draw(dt, info, input) {
    if (!this.mesh.visible) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.1;

    const g = this.ctx;
    g.fillStyle = 'rgba(10,15,30,0.82)';
    g.fillRect(0, 0, 1024, 1024);
    g.fillStyle = '#7fffd4';
    g.font = 'bold 30px monospace';
    g.textAlign = 'left';
    let y = 44;
    const line = (s, color = '#e8f0ff', size = 22) => {
      g.fillStyle = color;
      g.font = `${size}px monospace`;
      g.fillText(s, 20, y);
      y += size + 8;
    };
    line('INPUT DEBUG  (I / Back / 右グリップ で閉じる)', '#7fffd4', 26);
    line(`fps ${info.fps.toFixed(0)}  xr ${info.xr}  refSpace ${info.refSpace}  fbScale ${info.scale}`);
    const s = input.state;
    line(`source ${s.source}  move ${fmt(s.move.x)},${fmt(s.move.y)}  throttle ${fmt(s.throttle)}  fire ${s.fire || s.handFire.some((h) => h.fire)}`);
    y += 8;

    line(`GAMEPADS (${input.debug.pads.length})`, '#ffd27f', 24);
    for (const p of input.debug.pads) {
      line(p.id.slice(0, 70), '#fff');
      line(`  mapping: ${p.mapping}`);
      line(`  axes: ${p.axes.map(fmt).join(' ')}`);
      line(`  btn: ${p.buttons.map((v, i) => `${i}:${v.toFixed(1)}`).join(' ')}`.slice(0, 80));
      if (p.buttons.length > 9) line(`       ${p.buttons.slice(9).map((v, i) => `${i + 9}:${v.toFixed(1)}`).join(' ')}`);
    }
    y += 8;
    line(`XR CONTROLLERS (${input.debug.xr.length})`, '#ffd27f', 24);
    for (const c of input.debug.xr) {
      line(`[${c.hand}] ${c.profiles}`.slice(0, 76), '#fff');
      line(`  axes: ${c.axes.map(fmt).join(' ')}`);
      line(`  btn: ${c.buttons.map((v, i) => `${i}:${v.toFixed(1)}`).join(' ')}`);
    }
    this.tex.needsUpdate = true;
  }
}
