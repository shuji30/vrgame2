// 手続き生成テクスチャ(CanvasTexture)。外部ファイルは使わない。
// 多くは「白〜灰の明暗だけ」の素材で、マテリアルの color で着色して使い回す。
import * as THREE from '../../vendor/three.module.js';

const CACHE = new Map();

// 再現可能な乱数
export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function speck(g, w, h, n, r, cols, sz = 2) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[(r() * cols.length) | 0];
    const s = 1 + r() * sz;
    g.fillRect(r() * w, r() * h, s, s);
  }
}
function line(g, x0, y0, x1, y1, c, wd) {
  g.strokeStyle = c; g.lineWidth = wd;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
}
function seam(g, x0, y0, x1, y1) {
  line(g, x0, y0, x1, y1, 'rgba(38,32,26,.75)', 2.5);
  line(g, x0 + 1.5, y0 + 1.5, x1 + 1.5, y1 + 1.5, 'rgba(255,255,255,.35)', 1);
}
function bolt(g, x, y, r = 2.2) {
  g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.arc(x + 0.7, y + 0.9, r, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.arc(x, y, r * 0.75, 0, 7); g.fill();
}
function circle(g, x, y, r, c) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }

// 名前 → [幅, 高さ, 描画関数(g,w,h,r,a,b)]
const DRAW = {
  // 自軍:手作り感(溶接パッチ・垂れ汚れ・擦れ)
  panelG: [256, 256, (g, w, h, r) => {
    g.fillStyle = '#ebe5da'; g.fillRect(0, 0, w, h);
    speck(g, w, h, 2600, r, ['rgba(0,0,0,.06)', 'rgba(255,255,255,.1)', 'rgba(90,70,50,.08)'], 3);
    for (let i = 0; i < 16; i++) { g.fillStyle = 'rgba(80,60,40,.07)'; g.fillRect(r() * w, r() * h, 2 + r() * 5, 20 + r() * 70); }
    for (let i = 0; i < 3; i++) {
      const x = 20 + r() * 180, y = 20 + r() * 180, pw = 30 + r() * 50, ph = 24 + r() * 40;
      g.fillStyle = 'rgba(125,88,58,.42)'; g.fillRect(x, y, pw, ph);
      g.setLineDash([2, 2]); g.strokeStyle = 'rgba(70,48,32,.85)'; g.lineWidth = 3; g.strokeRect(x, y, pw, ph); g.setLineDash([]);
      bolt(g, x + 5, y + 5, 1.6); bolt(g, x + pw - 5, y + ph - 5, 1.6);
    }
    seam(g, 0, 1, w, 1); seam(g, 0, 128, w, 128); seam(g, 1, 0, 1, 128); seam(g, 160, 128, 160, h); seam(g, 90, 0, 90, 128);
    for (let x = 8; x < w; x += 16) { bolt(g, x, 7); bolt(g, x, 134); }
    for (let i = 0; i < 50; i++) { const x = r() * w, y = r() * h; line(g, x, y, x + r() * 14 - 7, y + r() * 4, 'rgba(255,255,255,.28)', 1); }
  }],
  // 敵軍:均一で角ばった継ぎ目・六角ボルト・スリット
  panelZ: [256, 256, (g, w, h, r) => {
    g.fillStyle = '#eef1f3'; g.fillRect(0, 0, w, h);
    speck(g, w, h, 1600, r, ['rgba(0,0,0,.05)', 'rgba(255,255,255,.1)'], 2);
    seam(g, 0, 1, w, 1); seam(g, 0, 128, w, 128); seam(g, 1, 0, 1, h);
    seam(g, 96, 1, 128, 40); seam(g, 128, 40, 230, 40); seam(g, 230, 40, 230, 128);
    seam(g, 60, 128, 60, 200); seam(g, 60, 200, 100, 240); seam(g, 100, 240, 256, 240);
    for (let x = 10; x < w; x += 22) { g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x, 5, 4, 4); g.fillRect(x, 132, 4, 4); }
    g.fillStyle = 'rgba(20,24,28,.6)'; for (let i = 0; i < 4; i++) g.fillRect(150, 70 + i * 10, 60, 4);
    g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(150, 160, 40, 16);
    g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(154, 164, 10, 8); g.fillRect(168, 166, 18, 3);
    for (let i = 0; i < 20; i++) { const x = r() * w, y = r() * h; line(g, x, y, x + r() * 10, y, 'rgba(255,255,255,.25)', 1); }
  }],
  // リベット打ちの金属板
  metal: [256, 256, (g, w, h, r) => {
    g.fillStyle = '#d2cec8'; g.fillRect(0, 0, w, h);
    speck(g, w, h, 2400, r, ['rgba(0,0,0,.07)', 'rgba(255,255,255,.08)', 'rgba(140,70,30,.12)'], 3);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const x = i * 128, y = j * 128;
      g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.06})`; g.fillRect(x + 2, y + 2, 124, 124);
      seam(g, x + 1, y, x + 1, y + 128); seam(g, x, y + 1, x + 128, y + 1);
      for (let k = 10; k < 128; k += 13) { bolt(g, x + k, y + 8, 2); bolt(g, x + 8, y + k, 2); }
    }
  }],
  concrete: [256, 256, (g, w, h, r) => {
    g.fillStyle = '#dcdad4'; g.fillRect(0, 0, w, h);
    speck(g, w, h, 5000, r, ['rgba(0,0,0,.07)', 'rgba(255,255,255,.12)', 'rgba(0,0,0,.03)'], 3);
    line(g, 0, 128, w, 128, 'rgba(0,0,0,.18)', 2);
    for (let x = 32; x < w; x += 64) for (let y = 32; y < h; y += 64) circle(g, x, y, 3, 'rgba(0,0,0,.3)');
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(60,50,40,.08)'; g.fillRect(r() * w, r() * h * 0.5, 6 + r() * 20, 40 + r() * 100); }
    for (let i = 0; i < 4; i++) {
      let x = r() * w, y = r() * h; g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += r() * 16 - 8; y += r() * 14; g.lineTo(x, y); } g.stroke();
    }
  }],
  // 履帯:u=長さ方向(1リンク)、v=幅方向。明暗差を強くして回転が見えるように
  track: [64, 128, (g, w, h, r) => {
    g.fillStyle = '#353331'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#8c867e'; g.fillRect(4, 0, 26, h);
    g.fillStyle = '#c4bcb0'; g.fillRect(4, 0, 5, h);
    g.fillStyle = '#1e1c1a'; g.fillRect(30, 0, 5, h);
    g.fillStyle = '#5e5a54'; g.fillRect(37, 6, 23, 50); g.fillRect(37, 72, 23, 50);
    g.fillStyle = '#76716a'; g.fillRect(37, 58, 23, 12);
    for (const y of [14, 114]) { circle(g, 48, y, 4, '#24221f'); circle(g, 47, y - 1, 2, '#9a948c'); }
    speck(g, w, h, 300, r, ['rgba(0,0,0,.25)', 'rgba(120,90,60,.25)'], 2);
  }],
  // 転輪のハブ(白い印で回転が分かる)
  hub: [128, 128, (g, w, h) => {
    g.fillStyle = '#2a2826'; g.fillRect(0, 0, w, h);
    circle(g, 64, 64, 54, '#e8e4dc'); circle(g, 64, 64, 48, '#c8c4bc');
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + 0.5; circle(g, 64 + Math.cos(a) * 31, 64 + Math.sin(a) * 31, 8, '#3a3633'); }
    g.fillStyle = '#ffffff'; g.fillRect(64, 59, 50, 10);
    circle(g, 64, 64, 15, '#55514c');
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; bolt(g, 64 + Math.cos(a) * 10, 64 + Math.sin(a) * 10, 2); }
  }],
  // ステンシル番号(a=文字列, b='g'|'z')
  stencil: [256, 128, (g, w, h, r, txt, sty) => {
    g.clearRect(0, 0, w, h);
    if (sty === 'z') {
      g.fillStyle = '#2fd0c0';
      g.beginPath(); g.moveTo(8, 24); g.lineTo(44, 64); g.lineTo(8, 104); g.lineTo(26, 104); g.lineTo(62, 64); g.lineTo(26, 24); g.fill();
      g.fillRect(70, 100, 176, 8);
      g.fillStyle = '#f4f8fa'; g.font = 'bold 76px "Arial Narrow", Arial, sans-serif'; g.textBaseline = 'middle';
      g.fillText(txt, 74, 58);
    } else {
      g.fillStyle = '#f2ede2'; g.font = 'bold 104px "Arial Black", Impact, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, w / 2, h / 2 + 4);
      g.globalCompositeOperation = 'destination-out';
      g.fillRect(0, h / 2 - 2, w, 6);
      speck(g, w, h, 500, r, ['#000'], 3);
      g.globalCompositeOperation = 'source-over';
    }
  }],
  hazard: [128, 128, (g, w, h, r) => {
    g.fillStyle = '#e8b820'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1c1a18';
    for (let i = -2; i < 4; i++) { g.beginPath(); g.moveTo(i * 64, h); g.lineTo(i * 64 + 32, h); g.lineTo(i * 64 + 32 + h, 0); g.lineTo(i * 64 + h, 0); g.fill(); }
    speck(g, w, h, 400, r, ['rgba(0,0,0,.25)', 'rgba(255,255,255,.2)', 'rgba(110,70,30,.3)'], 3);
  }],
  // ビル窓(1タイル=1ベイ×1階)
  windows: [128, 128, (g, w, h, r) => {
    g.fillStyle = '#e4e2de'; g.fillRect(0, 0, w, h);
    speck(g, w, h, 900, r, ['rgba(0,0,0,.06)', 'rgba(255,255,255,.1)'], 2);
    g.fillStyle = '#8a8884'; g.fillRect(14, 22, 100, 80);
    const gr = g.createLinearGradient(0, 26, 0, 98); gr.addColorStop(0, '#2a3a4c'); gr.addColorStop(1, '#6a88a6');
    g.fillStyle = gr; g.fillRect(18, 26, 92, 72);
    g.fillStyle = 'rgba(255,255,255,.16)'; g.beginPath(); g.moveTo(30, 98); g.lineTo(70, 26); g.lineTo(86, 26); g.lineTo(46, 98); g.fill();
    g.fillStyle = '#8a8884'; g.fillRect(62, 26, 4, 72);
    g.fillStyle = '#b8b6b0'; g.fillRect(10, 102, 108, 6);
    g.fillStyle = 'rgba(0,0,0,.1)'; g.fillRect(0, 124, w, 4);
  }],
  roof: [128, 128, (g, w, h, r) => {
    g.fillStyle = '#d8d4d0'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      const gr = g.createLinearGradient(0, y, 0, y + 16); gr.addColorStop(0, 'rgba(255,255,255,.15)'); gr.addColorStop(1, 'rgba(0,0,0,.3)');
      g.fillStyle = gr; g.fillRect(0, y, w, 16);
      for (let x = (y / 16) % 2 ? 0 : 12; x < w; x += 24) line(g, x, y, x, y + 16, 'rgba(0,0,0,.3)', 1.5);
    }
    speck(g, w, h, 500, r, ['rgba(0,0,0,.1)', 'rgba(255,255,255,.1)'], 2);
  }],
  crate: [128, 128, (g, w, h, r) => {
    g.fillStyle = '#e2d4b8'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 26) line(g, 0, y, w, y, 'rgba(60,40,20,.35)', 2);
    speck(g, w, h, 700, r, ['rgba(80,50,20,.12)', 'rgba(255,255,255,.1)'], 3);
    g.strokeStyle = '#7a6448'; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12);
    line(g, 12, 12, w - 12, h - 12, '#8a7454', 10);
    for (const [x, y] of [[8, 8], [w - 8, 8], [8, h - 8], [w - 8, h - 8]]) bolt(g, x, y, 2.5);
  }],
  container: [128, 128, (g, w, h, r) => {
    g.fillStyle = '#d6d2cc'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      const gr = g.createLinearGradient(x, 0, x + 16, 0);
      gr.addColorStop(0, 'rgba(0,0,0,.25)'); gr.addColorStop(0.4, 'rgba(255,255,255,.2)'); gr.addColorStop(1, 'rgba(0,0,0,.15)');
      g.fillStyle = gr; g.fillRect(x, 0, 16, h);
    }
    speck(g, w, h, 500, r, ['rgba(130,60,20,.25)', 'rgba(0,0,0,.1)'], 4);
  }],
  sandbag: [128, 64, (g, w, h, r) => {
    g.fillStyle = '#6a5e48'; g.fillRect(0, 0, w, h);
    for (let row = 0; row < 2; row++) for (let i = -1; i < 3; i++) {
      const x = i * 52 + (row ? 26 : 0) + 26, y = row * 32 + 16;
      g.fillStyle = `rgb(${200 + r() * 30},${188 + r() * 25},${150 + r() * 25})`;
      g.beginPath(); g.ellipse(x, y, 25, 14, 0, 0, 7); g.fill();
      line(g, x - 18, y - 2, x + 18, y - 4, 'rgba(0,0,0,.15)', 1);
    }
    speck(g, w, h, 300, r, ['rgba(0,0,0,.12)'], 2);
  }],
  foliage: [128, 128, (g, w, h, r) => {
    g.fillStyle = '#b8c0a8'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { const v = 150 + r() * 105; g.fillStyle = `rgba(${v},${v},${v * 0.9},.7)`; g.beginPath(); g.arc(r() * w, r() * h, 3 + r() * 7, 0, 7); g.fill(); }
  }],
  bark: [64, 128, (g, w, h, r) => {
    g.fillStyle = '#c8bcae'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 30; i++) { const x = r() * w; line(g, x, 0, x + r() * 6 - 3, h, 'rgba(40,30,20,.35)', 1 + r() * 2); }
  }],
  rock: [128, 128, (g, w, h, r) => {
    g.fillStyle = '#d4d0ca'; g.fillRect(0, 0, w, h);
    speck(g, w, h, 2500, r, ['rgba(0,0,0,.1)', 'rgba(255,255,255,.12)', 'rgba(100,80,60,.1)'], 4);
    for (let i = 0; i < 5; i++) { const x = r() * w, y = r() * h; line(g, x, y, x + r() * 40 - 20, y + r() * 40 - 20, 'rgba(0,0,0,.3)', 1.5); }
  }],
  bullseye: [256, 256, (g, w, h) => {
    g.fillStyle = '#d8c8a0'; g.fillRect(0, 0, w, h);
    const cols = ['#1a1a1a', '#f2f0ea', '#d42a20', '#f2f0ea', '#d42a20', '#f2f0ea', '#1a1a1a'];
    cols.forEach((c, i) => circle(g, 128, 128, 126 - i * 18, c));
  }],
  // 弱点の発光スリット(emissiveMap用)
  grille: [64, 64, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 12) { g.fillStyle = '#fff'; g.fillRect(4, y, w - 8, 6); }
  }],
  // 旗(a=0|1)
  flag: [256, 160, (g, w, h, r, team) => {
    const t = +team === 1;
    g.fillStyle = t ? '#2a78d8' : '#e8741e'; g.fillRect(0, 0, w, h);
    g.fillStyle = t ? '#123a70' : '#7a3410'; g.fillRect(0, 128, w, 32); g.fillRect(0, 0, w, 14);
    g.fillStyle = '#f4f0e6';
    g.save(); g.translate(128, 72);
    for (let i = 0; i < 10; i++) { g.rotate(Math.PI / 5); g.fillRect(-9, -50, 18, 16); }
    circle(g, 0, 0, 38, '#f4f0e6'); circle(g, 0, 0, 18, t ? '#2a78d8' : '#e8741e');
    g.restore();
  }],
  // 地面マーカー(a='lob'|'danger')
  marker: [256, 256, (g, w, h, r, kind) => {
    g.clearRect(0, 0, w, h);
    const c = kind === 'danger' ? '255,40,30' : '255,150,40';
    g.shadowColor = `rgba(${c},1)`; g.shadowBlur = 14;
    g.strokeStyle = `rgba(${c},1)`; g.lineWidth = 12; g.beginPath(); g.arc(128, 128, 112, 0, 7); g.stroke();
    g.lineWidth = 5; g.setLineDash([14, 10]); g.beginPath(); g.arc(128, 128, 82, 0, 7); g.stroke(); g.setLineDash([]);
    if (kind === 'danger') { g.lineWidth = 10; line(g, 60, 60, 196, 196, `rgba(${c},1)`, 10); line(g, 196, 60, 60, 196, `rgba(${c},1)`, 10); }
    else for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; line(g, 128 + Math.cos(a) * 96, 128 + Math.sin(a) * 96, 128 + Math.cos(a) * 124, 128 + Math.sin(a) * 124, `rgba(${c},1)`, 6); }
    circle(g, 128, 128, 8, `rgba(${c},1)`);
  }],
};

// 名前と引数でキャッシュしたテクスチャを返す
export function tex(name, a = '', b = '') {
  const key = name + '|' + a + '|' + b;
  let t = CACHE.get(key);
  if (t) return t;
  const [w, h, fn] = DRAW[name];
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  fn(c.getContext('2d'), w, h, rng(key.length * 7919 + key.charCodeAt(0)), a, b);
  t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = name === 'grille' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 4;
  CACHE.set(key, t);
  return t;
}
