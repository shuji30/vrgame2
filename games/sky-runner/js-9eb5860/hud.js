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
      text(g, `SCORE ${d.score}`, 24, 52, 38);
      if (d.mult > 1.05) text(g, `x${d.mult.toFixed(1)}`, 24 + g.measureText(`SCORE ${d.score}`).width + 16, 52, 30, '#ffe680');
      text(g, `HI ${d.hi}   STAGE ${d.stage}`, 24, 90, 24, '#cfe8ff');
      text(g, `VIEW ${d.view}   DIST ${d.dist} m`, 24, 120, 20, '#cfe8ff');

      // 残機 (三角の印)
      g.fillStyle = '#ffe14a';
      for (let i = 0; i < d.lives; i++) {
        const x = 1000 - i * 34, y = 40;
        g.beginPath();
        g.moveTo(x - 12, y + 12);
        g.lineTo(x, y - 14);
        g.lineTo(x + 12, y + 12);
        g.closePath();
        g.fill();
      }

      // ボーナスステージ: なぎ倒した木の本数と残り時間
      if (d.bonus) {
        text(g, `TREES ${d.bonus.count}`, 512, 108, 40, '#8dff9a', 'center');
        text(g, `${d.bonus.left}`, 512, 146, 30, '#fff', 'center');
      }

      // ボスの体力
      if (d.boss !== null) {
        const bx0 = 312, bx1 = 712, by = 150;
        text(g, 'BOSS', bx0 - 10, by + 20, 24, '#ff6060', 'right');
        g.fillStyle = 'rgba(0,0,0,0.55)';
        g.fillRect(bx0 - 3, by - 3, bx1 - bx0 + 6, 26);
        g.fillStyle = '#ff3a3a';
        g.fillRect(bx0, by, (bx1 - bx0) * d.boss, 20);
      }

      // ライフゲージ (少ないと赤く点滅する)。画面の上に置く
      {
        // 画面の上の中央
        const lx0 = 330, lx1 = 760, ly = 22, lh = 30;
        const r = d.life / d.lifeMax;
        text(g, 'LIFE', lx0 - 10, ly + lh - 4, 24, '#fff', 'right');
        g.fillStyle = 'rgba(0,0,0,0.55)';
        g.fillRect(lx0 - 3, ly - 3, lx1 - lx0 + 6, lh + 6);
        g.fillStyle = r < 0.3 ? (d.blink ? '#ff2020' : '#901010') : r < 0.6 ? '#ffd030' : '#30e060';
        g.fillRect(lx0, ly, (lx1 - lx0) * r, lh);
        g.strokeStyle = 'rgba(255,255,255,0.8)';
        g.lineWidth = 2;
        for (let i = 1; i < 4; i++) {
          const x = lx0 + ((lx1 - lx0) * i) / 4;
          g.beginPath();
          g.moveTo(x, ly);
          g.lineTo(x, ly + lh);
          g.stroke();
        }
        text(g, `${d.life}`, lx1 + 10, ly + lh - 3, 26, '#fff');
      }

      // ミサイルの残り (四角) とロック数
      for (let i = 0; i < d.missileMax; i++) {
        g.fillStyle = i < d.missiles ? '#ffffff' : 'rgba(255,255,255,0.2)';
        g.fillRect(24 + i * 22, 420, 16, 34);
      }
      text(g, 'MISSILE', 24, 408, 22, '#fff');
      if (d.locks) text(g, `LOCK ${d.locks}`, 24 + d.missileMax * 22 + 16, 452, 34, '#ff4040');

      // 速度計 (右側に縦置き): 0.5倍〜1.5倍で下から上へ伸びる。白い目盛りが基準速度 (1.0倍)
      const sx = 968, sw = 30, sy0 = 140, sy1 = 400;
      const t = (d.factor - 0.5) / 1.0;
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(sx - 4, sy0 - 4, sw + 8, sy1 - sy0 + 8);
      g.fillStyle = `hsl(${120 - t * 120}, 85%, 55%)`;
      g.fillRect(sx, sy1 - (sy1 - sy0) * t, sw, (sy1 - sy0) * t);
      g.fillStyle = '#fff';
      g.fillRect(sx - 8, (sy0 + sy1) / 2 - 2, sw + 16, 4);
      text(g, `x${d.factor.toFixed(2)}`, sx + sw, sy0 - 14, 26, '#ffe680', 'right');
      text(g, `${d.kmh}`, sx + sw, sy1 + 36, 30, '#fff', 'right');
      text(g, 'km/h', sx + sw, sy1 + 62, 20, '#fff', 'right');
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
    line(info.version || '');
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
