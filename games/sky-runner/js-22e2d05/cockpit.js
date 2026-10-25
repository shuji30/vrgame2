// コックピットの計器 (昔のロボットアニメ風): 正面のパネルと左右の台に、ボタン・スイッチ・丸いメーター・レーダーをいっぱいに。
// 1 枚のキャンバスに描いて、3 枚の板 (1 つにまとめたジオメトリ、描画 1 回) に貼る。ランプとレーダーは少しずつ描き直す
// 座標は ship.glb の 'Ship' ノードの中 (2 倍される前)。目 (PilotEye) は (0, 0.34, -0.26)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const W = 512, H = 512;
// キャンバスの中の場所 (上から 正面・左の台・右の台)
const AREA = { main: [0, 0, 512, 160], left: [0, 168, 512, 164], right: [0, 340, 512, 164] };
const COLORS = ['#ff3a2a', '#ffd23a', '#36e070', '#f4f4f4', '#ff8a1a', '#3ab0ff'];
const rand = (a, b) => a + Math.random() * (b - a);

// 三角形の真ん中が drop(x, y, z) に当たるものを消す (モデルに穴を開ける)
function dropTriangles(geo, drop) {
  const pos = geo.attributes.position;
  const idx = geo.index ? geo.index.array : Array.from({ length: pos.count }, (_, i) => i);
  const keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    if (!drop((pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3, (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3)) keep.push(a, b, c);
  }
  geo.setIndex(keep);
}

// 座る所を深くする: 胴体の上の面に穴を開け、下に足元まで続く溝 (床・壁) を作って、シートとペダルを置く。
// 元の CockpitTub (浅い箱) と背もたれ、前の黒い台と小さな画面 3 つは消す。キャノピーのガラスは胴体より下を切る
export function openCockpit(ship) {
  const fuselage = ship.getObjectByName('Fuselage');
  if (fuselage) dropTriangles(fuselage.geometry, (x, y, z) => Math.abs(x) < 0.1 && y > 0.18 && z > -0.55 && z < -0.05);
  const canopy = ship.getObjectByName('Canopy');
  if (canopy) dropTriangles(canopy.geometry, (x, y) => y < -0.15); // 縦は 0.19 倍・中心 0.22 なので、胴体の上 (0.19) より下
  for (const n of ['CockpitTub', 'Seat', 'Dashboard', 'ScreenL', 'ScreenC', 'ScreenR']) { const o = ship.getObjectByName(n); if (o) o.visible = false; }

  const parts = [];
  const box = (w, h, d, color, x, y, z, rx = 0) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.applyMatrix4(new THREE.Matrix4().makeRotationX(rx)).translate(x, y, z);
    const c = new THREE.Color(color), n = g.attributes.position.count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3));
    parts.push(g);
  };
  // 溝: 床 (y = -0.09)、左右の壁と縁、後ろの壁。前は計器の下の奥 (z = -0.7) まで続き、上に天井をかける
  const wall = 0x343c48;
  box(0.21, 0.006, 0.66, 0x1c2026, 0, -0.093, -0.37);
  for (const sx of [-1, 1]) {
    box(0.006, 0.29, 0.51, wall, sx * 0.108, 0.055, -0.295);
    box(0.006, 0.24, 0.15, wall, sx * 0.108, 0.03, -0.625);
    box(0.02, 0.012, 0.51, 0x4a5560, sx * 0.108, 0.2, -0.295);
  }
  box(0.21, 0.24, 0.006, wall, 0, 0.03, -0.703);
  box(0.222, 0.006, 0.153, wall, 0, 0.153, -0.625);
  box(0.222, 0.05, 0.006, wall, 0, 0.175, -0.55);
  box(0.222, 0.29, 0.006, wall, 0, 0.055, -0.037);
  // シート: 溝の底の台に、座面 (上の面が y = 0)・後ろへ少し倒した背もたれ・頭当て、座面の横の黄色い取っ手
  const seat = 0x2e3c56, pad = 0x3d4f70;
  box(0.1, 0.05, 0.16, 0x3a434c, 0, -0.065, -0.3);
  box(0.15, 0.04, 0.24, seat, 0, -0.02, -0.3);
  box(0.13, 0.008, 0.22, pad, 0, 0.002, -0.3);
  box(0.15, 0.3, 0.035, seat, 0, 0.148, -0.145, 0.17);
  box(0.13, 0.27, 0.008, pad, 0, 0.151, -0.165, 0.17);
  box(0.09, 0.06, 0.045, 0x1c2230, 0, 0.325, -0.114, 0.17);
  for (const sx of [-1, 1]) box(0.012, 0.012, 0.09, 0xf0c020, sx * 0.081, -0.005, -0.36);
  // ペダル: 座って足を伸ばした先 (計器の下の奥)。足の板は上を奥へ倒し、黒いゴムのすじを付ける。下を向くと見える
  for (const sx of [-1, 1]) {
    box(0.012, 0.04, 0.012, 0x5a646e, sx * 0.045, -0.07, -0.63);
    box(0.04, 0.07, 0.008, 0x8a949e, sx * 0.045, -0.035, -0.62, -0.6);
    for (const k of [-1, 0, 1]) box(0.034, 0.006, 0.004, 0x15191e, sx * 0.045, -0.032 + k * 0.0165, -0.616 - k * 0.0113, -0.6);
  }
  box(0.13, 0.012, 0.02, 0x3a434c, 0, -0.084, -0.64);
  const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.2 }));
  mesh.name = 'CockpitSeat';
  (ship.getObjectByName('Ship') || ship).add(mesh);
}

// 板を作り、UV をキャンバスの中のその場所に合わせる
function plate(w, h, [x, y, aw, ah]) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * aw) / W, 1 - (y + (1 - uv.getY(i)) * ah) / H);
  return g;
}

export class CockpitPanel {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;

    // 正面: 上の縁を奥へ 30 度倒して、目の方へ向ける (下の縁は座る所の溝の前の縁)。左右: 溝の縁の外に、内側へ傾けて置く
    const main = plate(0.3, 0.094, AREA.main).applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(0, 0.241, -0.5735), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 6), new THREE.Vector3(1, 1, 1)));
    const side = (sx, area) => plate(0.26, 0.083, area).applyMatrix4(new THREE.Matrix4().makeRotationZ(-Math.PI / 2 * sx)) // 長い方を前後に
      .applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2)) // 上を向ける
      .applyMatrix4(new THREE.Matrix4().makeRotationZ(sx * 0.55)) // 内側 (目の方) へ傾ける
      .applyMatrix4(new THREE.Matrix4().makeTranslation(sx * 0.16, 0.23, -0.3));
    this.mesh = new THREE.Mesh(mergeGeometries([main, side(-1, AREA.left), side(1, AREA.right)]),
      new THREE.MeshBasicMaterial({ map: this.tex, side: THREE.DoubleSide }));
    this.mesh.name = 'CockpitPanel';

    this.layout();
    this.missiles = 0;
    this.missileMax = 8;
    this.locks = 0;
    this.t = 0;
    this.redrawT = 0;
    this.draw();
  }

  // ボタンやメーターの置き場所を決める (毎回は変えない)
  layout() {
    const btns = [], lamps = [], toggles = [], gauges = [], bars = [], segs = [];
    const grid = (x0, y0, cols, rows, s, gap, list, extra = {}) => {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
        list.push({ x: x0 + c * (s + gap), y: y0 + r * (s + gap), s, col: COLORS[Math.floor(rand(0, COLORS.length))], on: Math.random() < 0.5, rate: rand(0.3, 2.5), ...extra });
    };
    const [, my] = AREA.main;
    // 正面: 真ん中にレーダー、左右に丸いメーター、そのまわりにボタンの列
    this.radar = { x: 256, y: my + 84, r: 58 };
    gauges.push({ x: 150, y: my + 58, r: 30, v: 0.4 }, { x: 362, y: my + 58, r: 30, v: 0.7 }, { x: 150, y: my + 124, r: 24, v: 0.2 }, { x: 362, y: my + 124, r: 24, v: 0.55 });
    grid(10, my + 14, 4, 3, 18, 6, btns);
    grid(410, my + 14, 4, 3, 18, 6, btns);
    grid(14, my + 96, 7, 1, 10, 6, lamps, { round: true });
    grid(408, my + 96, 7, 1, 10, 6, lamps, { round: true });
    segs.push({ x: 196, y: my + 6, n: 3, key: 'spd' }, { x: 280, y: my + 6, n: 3, key: 'alt' });
    // 左右の台: スイッチの列・ボタンの格子・ランプ・メーター
    for (const key of ['left', 'right']) {
      const [, y] = AREA[key];
      grid(14, y + 12, 9, 1, 14, 10, toggles);
      grid(14, y + 52, 8, 3, 20, 6, btns);
      grid(250, y + 52, 10, 2, 12, 7, lamps, { round: true });
      gauges.push({ x: 290, y: y + 125, r: 30, v: rand(0.2, 0.8) }, { x: 370, y: y + 125, r: 30, v: rand(0.2, 0.8) }, { x: 450, y: y + 125, r: 30, v: rand(0.2, 0.8) });
      grid(250, y + 12, 6, 1, 26, 12, btns, { wide: true });
      bars.push({ x: 14, y: y + 136, w: 220, h: 14 });
    }
    Object.assign(this, { btns, lamps, toggles, gauges, bars, segs });
  }

  // 下地 (金属の板、縁、ねじ、黄色い文字)
  drawBase(g, [x, y, w, h], label) {
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, '#4a5560');
    gr.addColorStop(1, '#2a3038');
    g.fillStyle = gr;
    g.fillRect(x, y, w, h);
    g.strokeStyle = '#7d8a96';
    g.lineWidth = 3;
    g.strokeRect(x + 2, y + 2, w - 4, h - 4);
    g.fillStyle = '#8f9aa5';
    for (const [sx, sy] of [[x + 7, y + 7], [x + w - 7, y + 7], [x + 7, y + h - 7], [x + w - 7, y + h - 7]]) { g.beginPath(); g.arc(sx, sy, 2.5, 0, Math.PI * 2); g.fill(); }
    // 黄色と黒のしま (注意の帯)
    g.save();
    g.beginPath(); g.rect(x + w - 90, y + h - 12, 80, 7); g.clip();
    for (let i = -2; i < 14; i++) { g.fillStyle = i % 2 ? '#111' : '#f0c020'; g.beginPath(); g.moveTo(x + w - 90 + i * 8, y + h - 5); g.lineTo(x + w - 82 + i * 8, y + h - 12); g.lineTo(x + w - 74 + i * 8, y + h - 12); g.lineTo(x + w - 82 + i * 8, y + h - 5); g.fill(); }
    g.restore();
    g.font = 'bold 9px monospace';
    g.fillStyle = '#f0d040';
    g.fillText(label, x + 14, y + h - 5);
  }

  draw() {
    const g = this.g, t = this.t;
    this.drawBase(g, AREA.main, 'MAIN SYSTEM  RX-18');
    this.drawBase(g, AREA.left, 'WEAPON CONTROL');
    this.drawBase(g, AREA.right, 'ENGINE / LIFE SUPPORT');
    // 四角いボタン: 光っているものは明るく、まわりに光
    for (const b of this.btns) {
      const on = b.on !== (Math.sin(t * b.rate * 3) > 0.85);
      const w = b.wide ? b.s * 1.4 : b.s;
      g.fillStyle = '#15191e';
      g.fillRect(b.x - 2, b.y - 2, w + 4, b.s + 4);
      g.fillStyle = b.col;
      g.globalAlpha = on ? 1 : 0.28;
      g.fillRect(b.x, b.y, w, b.s);
      g.globalAlpha = on ? 0.6 : 0.15;
      g.fillStyle = '#fff';
      g.fillRect(b.x + 2, b.y + 2, w - 4, b.s * 0.3);
      g.globalAlpha = 1;
    }
    // 丸いランプ: ちかちか
    for (const l of this.lamps) {
      const on = Math.sin(t * l.rate * 4 + l.x) > 0;
      g.fillStyle = '#111';
      g.beginPath(); g.arc(l.x + l.s / 2, l.y + l.s / 2, l.s / 2 + 1.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = l.col;
      g.globalAlpha = on ? 1 : 0.22;
      g.beginPath(); g.arc(l.x + l.s / 2, l.y + l.s / 2, l.s / 2, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
    // レバーのスイッチ (銀色)
    for (const s of this.toggles) {
      g.fillStyle = '#1a1e24';
      g.fillRect(s.x, s.y, s.s, s.s * 2);
      g.fillStyle = '#d8dde4';
      const up = s.on;
      g.fillRect(s.x + s.s * 0.3, up ? s.y + 2 : s.y + s.s, s.s * 0.4, s.s - 2);
      g.beginPath(); g.arc(s.x + s.s / 2, up ? s.y + 3 : s.y + s.s * 2 - 3, s.s * 0.32, 0, Math.PI * 2); g.fill();
    }
    // 丸いメーター: 白い文字盤に針
    for (const m of this.gauges) {
      const v = m.v + Math.sin(t * 1.3 + m.x) * 0.08;
      g.fillStyle = '#0c0f12';
      g.beginPath(); g.arc(m.x, m.y, m.r + 3, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e8ecd8';
      g.beginPath(); g.arc(m.x, m.y, m.r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#222';
      g.lineWidth = 1.5;
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI * 0.75 + (i / 8) * Math.PI * 1.5;
        g.beginPath(); g.moveTo(m.x + Math.cos(a) * m.r * 0.75, m.y + Math.sin(a) * m.r * 0.75); g.lineTo(m.x + Math.cos(a) * m.r * 0.92, m.y + Math.sin(a) * m.r * 0.92); g.stroke();
      }
      g.strokeStyle = '#e02020';
      g.beginPath(); g.arc(m.x, m.y, m.r * 0.84, Math.PI * 1.95, Math.PI * 2.25); g.stroke(); // 赤い所 (危ない)
      const a = Math.PI * 0.75 + v * Math.PI * 1.5;
      g.strokeStyle = '#d01818';
      g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(m.x, m.y); g.lineTo(m.x + Math.cos(a) * m.r * 0.85, m.y + Math.sin(a) * m.r * 0.85); g.stroke();
      g.fillStyle = '#222';
      g.beginPath(); g.arc(m.x, m.y, 3, 0, Math.PI * 2); g.fill();
    }
    // 棒のメーター (緑から赤へ)
    for (const b of this.bars) {
      g.fillStyle = '#0a0d10';
      g.fillRect(b.x, b.y, b.w, b.h);
      const n = Math.floor(b.w / 8), k = Math.floor(n * (0.55 + 0.35 * Math.sin(t * 2 + b.x)));
      for (let i = 0; i < n; i++) {
        g.fillStyle = i / n > 0.8 ? '#ff3020' : i / n > 0.6 ? '#ffd020' : '#30ff60';
        g.globalAlpha = i < k ? 1 : 0.15;
        g.fillRect(b.x + 2 + i * 8, b.y + 2, 6, b.h - 4);
      }
      g.globalAlpha = 1;
    }
    // レーダー: 緑の画面に、回る線と光の点
    {
      const { x, y, r } = this.radar;
      g.fillStyle = '#0c0f12';
      g.beginPath(); g.arc(x, y, r + 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#032a12';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(80,255,140,0.45)';
      g.lineWidth = 1;
      for (const k of [0.33, 0.66, 1]) { g.beginPath(); g.arc(x, y, r * k, 0, Math.PI * 2); g.stroke(); }
      g.beginPath(); g.moveTo(x - r, y); g.lineTo(x + r, y); g.moveTo(x, y - r); g.lineTo(x, y + r); g.stroke();
      const a = t * 2.4;
      for (let i = 0; i < 12; i++) {
        g.strokeStyle = `rgba(90,255,150,${0.9 * (1 - i / 12)})`;
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a - i * 0.06) * r, y + Math.sin(a - i * 0.06) * r); g.stroke();
      }
      g.fillStyle = '#9fffb0';
      for (let i = 0; i < 5; i++) {
        const pa = i * 1.7 + 0.4, pr = r * (0.3 + 0.13 * i);
        const fade = ((a - pa) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        g.globalAlpha = Math.max(0, 1 - fade / 3);
        g.beginPath(); g.arc(x + Math.cos(pa) * pr, y + Math.sin(pa) * pr, 3, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    }
    // ミサイルの残り (左下) とロックの数 (右下)。VR のコックピットでは画面の端の表示が見えないので、ここに出す
    {
      const y = AREA.main[1] + 123;
      g.font = 'bold 11px monospace';
      g.fillStyle = '#f0d040';
      g.fillText('MISSILE', 16, y - 3);
      for (let i = 0; i < this.missileMax; i++) {
        g.fillStyle = '#0a0d10';
        g.fillRect(14 + i * 14, y, 12, 22);
        g.fillStyle = i < this.missiles ? '#f4f4f4' : 'rgba(255,255,255,0.12)';
        g.fillRect(16 + i * 14, y + 2, 8, 18);
      }
      g.fillStyle = '#f0d040';
      g.fillText('LOCK', 392, y - 3);
      g.fillStyle = '#100604';
      g.fillRect(392, y, 44, 22);
      g.font = 'bold 18px monospace';
      g.fillStyle = this.locks ? '#ff3a2a' : '#5a2010';
      g.fillText(String(this.locks).padStart(2, '0'), 397, y + 18);
    }
    // 7 セグメント風の数字 (橙)
    for (const s of this.segs) {
      g.fillStyle = '#100604';
      g.fillRect(s.x, s.y, 36, 18);
      g.font = 'bold 15px monospace';
      g.fillStyle = '#ff8a20';
      const v = s.key === 'spd' ? 200 + Math.floor((Math.sin(t * 0.7) + 1) * 30) : 100 + Math.floor((Math.sin(t * 0.5 + 1) + 1) * 40);
      g.fillText(String(v).padStart(s.n, '0'), s.x + 3, s.y + 14);
    }
    this.tex.needsUpdate = true;
  }

  // ランプとレーダーは 1 秒に 10 回だけ描き直す (テクスチャを送る回数を少なく)
  update(dt, missiles = this.missiles, locks = this.locks) {
    this.t += dt;
    if (missiles !== this.missiles || locks !== this.locks) { // ミサイルとロックは変わったらすぐ描き直す
      this.missiles = missiles;
      this.locks = locks;
      this.redrawT = 0;
    }
    this.redrawT -= dt;
    if (this.redrawT > 0) return;
    this.redrawT = 0.1;
    this.draw();
  }
}
