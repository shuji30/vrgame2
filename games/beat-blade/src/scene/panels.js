// 3D 空間に浮かぶ Canvas 描画の UI。VR ではコントローラーのレイ、デスクトップではマウスで操作する
import * as THREE from 'three';
import { SONGS, songDuration, formatTime } from '../core/songs.js';
import { DIFFICULTIES, DIFF_ORDER } from '../core/beatmap.js';

const FONT = 'system-ui, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif';
const RED = '#ff2a55';
const BLUE = '#2a8cff';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class CanvasPanel {
  constructor(width, height, px = 1024) {
    this.W = px;
    this.H = Math.round((px * height) / width);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, fog: false, depthWrite: false }),
    );
    this.mesh.renderOrder = 10;
    this.mesh.userData.panel = this;
    this.buttons = [];
    this.hoverId = null;
  }

  get visible() { return this.mesh.visible; }
  set visible(v) { this.mesh.visible = v; }

  buttonAtUV(uv) {
    const x = uv.x * this.W, y = (1 - uv.y) * this.H;
    return this.buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) || null;
  }

  setHover(id) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.redraw();
  }

  redraw() {
    this.buttons = [];
    this.ctx.clearRect(0, 0, this.W, this.H);
    this.draw(this.ctx);
    this.texture.needsUpdate = true;
  }

  draw() {}

  background(ctx, accent = '#8a6bff') {
    roundRect(ctx, 6, 6, this.W - 12, this.H - 12, 36);
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, 'rgba(22,14,48,0.92)');
    g.addColorStop(1, 'rgba(8,6,22,0.92)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 5;
    const b = ctx.createLinearGradient(0, 0, this.W, 0);
    b.addColorStop(0, RED);
    b.addColorStop(0.5, accent);
    b.addColorStop(1, BLUE);
    ctx.strokeStyle = b;
    ctx.stroke();
  }

  text(ctx, s, x, y, { size = 36, color = '#fff', align = 'left', weight = '600', baseline = 'middle' } = {}) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(s, x, y);
  }

  button(ctx, id, x, y, w, h, label, { active = false, color = '#8a6bff', size = 34, sub = null } = {}) {
    this.buttons.push({ id, x, y, w, h });
    const hover = this.hoverId === id;
    roundRect(ctx, x, y, w, h, Math.min(22, h / 3));
    ctx.fillStyle = active ? color : hover ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.lineWidth = hover ? 4 : 2;
    ctx.strokeStyle = active || hover ? '#ffffff' : 'rgba(255,255,255,0.25)';
    ctx.stroke();
    if (sub) {
      this.text(ctx, label, x + w / 2, y + h * 0.4, { size, align: 'center', weight: '700' });
      this.text(ctx, sub, x + w / 2, y + h * 0.75, { size: size * 0.55, align: 'center', color: 'rgba(255,255,255,0.75)', weight: '500' });
    } else {
      this.text(ctx, label, x + w / 2, y + h / 2 + 2, { size, align: 'center', weight: '700' });
    }
  }
}

export class MenuPanel extends CanvasPanel {
  constructor(state, getBest) {
    super(1.9, 1.5, 1216);
    this.state = state; // { song, diff, autoplay, noFail }
    this.getBest = getBest;
  }

  draw(ctx) {
    const W = this.W;
    const st = this.state;
    const song = SONGS[st.song];
    this.background(ctx, song.accent);
    this.button(ctx, 'exit', 40, 36, 200, 60, '◀ GAMES', { size: 26 });
    // タイトル
    ctx.save();
    ctx.shadowColor = song.accent;
    ctx.shadowBlur = 24;
    this.text(ctx, 'BEAT', W / 2 - 18, 80, { size: 76, align: 'right', weight: '900', color: RED });
    this.text(ctx, 'BLADE', W / 2 + 18, 80, { size: 76, align: 'left', weight: '900', color: BLUE });
    ctx.restore();
    this.text(ctx, 'WebXR rhythm slasher', W / 2, 138, { size: 26, align: 'center', color: 'rgba(255,255,255,0.6)', weight: '500' });

    // 曲リスト
    this.text(ctx, 'SONG', 60, 192, { size: 26, color: 'rgba(255,255,255,0.6)' });
    SONGS.forEach((s, i) => {
      const y = 212 + i * 116;
      const best = this.getBest(s.id, st.diff);
      const sub = `BPM ${s.bpm}  ·  ${formatTime(songDuration(s))}  ·  ${best ? `BEST ${best.score.toLocaleString()} (${best.rank})` : 'NO RECORD'}`;
      this.button(ctx, `song:${i}`, 60, y, W - 120, 100, s.title, { active: st.song === i, color: hexA(s.accent, 0.45), size: 40, sub });
    });

    // 難易度
    const dy = 580;
    this.text(ctx, 'DIFFICULTY', 60, dy, { size: 26, color: 'rgba(255,255,255,0.6)' });
    const bw = (W - 120 - 3 * 20) / 4;
    const diffColors = { easy: '#2fbf71', normal: '#2a8cff', hard: '#ff8a1f', expert: '#ff2a55' };
    DIFF_ORDER.forEach((d, i) => {
      this.button(ctx, `diff:${d}`, 60 + i * (bw + 20), dy + 22, bw, 80, DIFFICULTIES[d].name, {
        active: st.diff === d, color: diffColors[d], size: 34,
      });
    });

    // オプション
    const oy = 724;
    const ow = (W - 120 - 20) / 2;
    this.button(ctx, 'opt:autoplay', 60, oy, ow, 76, `AUTO PLAY  ${st.autoplay ? 'ON' : 'OFF'}`, { active: st.autoplay, color: '#7a4dff', size: 30 });
    this.button(ctx, 'opt:nofail', 60 + ow + 20, oy, ow, 76, `NO FAIL  ${st.noFail ? 'ON' : 'OFF'}`, { active: st.noFail, color: '#7a4dff', size: 30 });

    // 開始
    this.button(ctx, 'play', W / 2 - 230, 822, 460, 96, '▶  PLAY', { active: true, color: song.accent, size: 48 });
    this.text(ctx, 'Point & pull the trigger  /  Click to select', W / 2, 936, { size: 22, align: 'center', color: 'rgba(255,255,255,0.45)', weight: '500' });
  }
}

export class PausePanel extends CanvasPanel {
  constructor() {
    super(1.2, 0.9, 768);
  }

  draw(ctx) {
    const W = this.W;
    this.background(ctx);
    this.text(ctx, 'PAUSED', W / 2, 90, { size: 64, align: 'center', weight: '900' });
    this.button(ctx, 'resume', 120, 160, W - 240, 92, 'RESUME', { active: true, color: '#2fbf71', size: 38 });
    this.button(ctx, 'restart', 120, 272, W - 240, 92, 'RESTART', { size: 38 });
    this.button(ctx, 'menu', 120, 384, W - 240, 92, 'MENU', { size: 38 });
  }
}

export class ResultsPanel extends CanvasPanel {
  constructor() {
    super(1.6, 1.3, 1024);
    this.data = null;
  }

  draw(ctx) {
    const W = this.W;
    const d = this.data;
    if (!d) return;
    this.background(ctx, d.song.accent);
    this.text(ctx, d.failed ? 'FAILED' : 'SONG CLEARED', W / 2, 78, {
      size: 60, align: 'center', weight: '900', color: d.failed ? RED : '#7cffb0',
    });
    this.text(ctx, `${d.song.title}  —  ${d.diffName}${d.autoplay ? '  (AUTO)' : ''}`, W / 2, 140, { size: 30, align: 'center', color: 'rgba(255,255,255,0.75)' });

    ctx.save();
    ctx.shadowColor = d.song.accent;
    ctx.shadowBlur = 30;
    this.text(ctx, d.rank, 250, 330, { size: 210, align: 'center', weight: '900', color: rankColor(d.rank) });
    ctx.restore();

    const x = 470;
    const rows = [
      ['SCORE', d.score.toLocaleString()],
      ['ACCURACY', `${(d.accuracy * 100).toFixed(1)}%`],
      ['MAX COMBO', `${d.maxCombo}`],
      ['CUTS', `${d.hits} / ${d.total}`],
      ['MISS / BAD', `${d.misses} / ${d.badCuts}`],
    ];
    rows.forEach(([k, v], i) => {
      const y = 214 + i * 58;
      this.text(ctx, k, x, y, { size: 26, color: 'rgba(255,255,255,0.6)' });
      this.text(ctx, v, W - 70, y, { size: 38, align: 'right', weight: '800' });
    });
    if (d.newBest) {
      this.text(ctx, '★ NEW BEST ★', W / 2, 540, { size: 40, align: 'center', weight: '900', color: '#ffd84a' });
    }
    const bw = 330;
    this.button(ctx, 'retry', W / 2 - bw - 20, 590, bw, 96, 'RETRY', { active: true, color: d.song.accent, size: 40 });
    this.button(ctx, 'menu', W / 2 + 20, 590, bw, 96, 'MENU', { size: 40 });
  }
}

// プレイ中の左右の表示板
export class Hud {
  constructor() {
    this.left = new CanvasPanel(1.0, 0.75, 512);
    this.right = new CanvasPanel(1.0, 0.75, 512);
    this.left.draw = (ctx) => this.drawLeft(ctx);
    this.right.draw = (ctx) => this.drawRight(ctx);
    this.left.mesh.position.set(-1.75, 1.15, -2.9);
    this.left.mesh.rotation.y = 0.42;
    this.right.mesh.position.set(1.75, 1.15, -2.9);
    this.right.mesh.rotation.y = -0.42;
    this.group = new THREE.Group();
    this.group.add(this.left.mesh, this.right.mesh);
    this.score = null;
    this.progress = 0;
    this.duration = 1;
    this.key = '';
  }

  set visible(v) { this.group.visible = v; }

  update(score, t, duration) {
    const key = `${score.version}|${Math.floor(t)}`;
    if (key === this.key) return;
    this.key = key;
    this.score = score;
    this.t = t;
    this.duration = duration;
    this.left.redraw();
    this.right.redraw();
  }

  drawLeft(ctx) {
    const s = this.score;
    if (!s) return;
    const W = 512;
    this.left.text(ctx, 'SCORE', W / 2, 46, { size: 26, align: 'center', color: 'rgba(255,255,255,0.6)' });
    this.left.text(ctx, s.score.toLocaleString(), W / 2, 108, { size: 66, align: 'center', weight: '800' });
    this.left.text(ctx, `${(s.accuracy * 100).toFixed(1)}%  ${s.rank}`, W / 2, 168, { size: 34, align: 'center', color: rankColor(s.rank), weight: '700' });
    // 倍率リング
    const cx = W / 2, cy = 280, r = 62;
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    if (s.mult < 8) {
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * s.multProgress) / s.multNeeded);
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#ffd84a';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    this.left.text(ctx, `×${s.mult}`, cx, cy + 3, { size: 52, align: 'center', weight: '900' });
  }

  drawRight(ctx) {
    const s = this.score;
    if (!s) return;
    const W = 512;
    this.right.text(ctx, 'COMBO', W / 2, 46, { size: 26, align: 'center', color: 'rgba(255,255,255,0.6)' });
    this.right.text(ctx, `${s.combo}`, W / 2, 116, { size: 84, align: 'center', weight: '900' });
    // エネルギー
    const x = 56, w = W - 112;
    this.right.text(ctx, 'ENERGY', x, 196, { size: 22, color: 'rgba(255,255,255,0.6)' });
    roundRect(ctx, x, 214, w, 30, 15);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
    roundRect(ctx, x, 214, Math.max(30, w * s.energy), 30, 15);
    ctx.fillStyle = s.energy < 0.3 ? RED : s.energy < 0.6 ? '#ffd84a' : '#7cffb0';
    ctx.fill();
    // 進行
    const p = Math.min(1, Math.max(0, this.t / this.duration));
    this.right.text(ctx, `${formatTime(this.t)} / ${formatTime(this.duration)}`, x, 296, { size: 26, color: 'rgba(255,255,255,0.8)' });
    roundRect(ctx, x, 320, w, 14, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
    roundRect(ctx, x, 320, Math.max(14, w * p), 14, 7);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
}

function rankColor(r) {
  return { SS: '#ffd84a', S: '#ffe98a', A: '#7cffb0', B: '#7cd8ff', C: '#c6a6ff', D: '#ff9a9a', E: '#ff5a5a' }[r] || '#fff';
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
