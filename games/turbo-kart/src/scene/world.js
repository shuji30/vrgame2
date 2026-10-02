// コースの見た目: 起伏のある地形・路面（ターマック / 荒れたターマック / ダート）・縁石・タイヤバリア・木・山
import * as THREE from 'three';
import { pointAt, locate, wrapS } from '../core/track.js';
import { roadHeight, surfaceType } from '../core/surface.js';
import { mulberry32 } from '../core/rng.js';

function canvasTexture(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function speckle(ctx, w, h, base, amp, n, size = 2) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = (Math.random() - 0.5) * amp;
    ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v / 255})` : `rgba(0,0,0,${-v / 255})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}

// コースに沿った帯。[from, to) の弧長範囲、横 lat0..lat1 を segs 分割し、路面の高さ＋dy に置く
function ribbon(track, { lat0, lat1, segs = 1, dy = 0, vScale = 10, from = 0, to = track.length }) {
  const len = wrapS(track, to - from) || track.length;
  const n = Math.max(1, Math.ceil(len / track.ds));
  const cols = segs + 1;
  const pos = new Float32Array((n + 1) * cols * 3);
  const uv = new Float32Array((n + 1) * cols * 2);
  for (let i = 0; i <= n; i++) {
    const s = from + (i * len) / n;
    for (let j = 0; j < cols; j++) {
      const lat = lat0 + ((lat1 - lat0) * j) / segs;
      const p = pointAt(track, s, lat);
      const o = i * cols + j;
      pos.set([p.x, roadHeight(track, s, lat) + dy, p.z], o * 3);
      uv.set([j / segs, s / vScale], o * 2);
    }
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 路面の種類が切り替わる区間に分ける
function surfaceRanges(track) {
  const out = [];
  let cur = surfaceType(track, 0), start = 0;
  for (let s = 1; s <= track.length; s++) {
    const t = s === track.length ? null : surfaceType(track, s);
    if (t !== cur) {
      out.push({ type: cur, from: start, to: s });
      cur = t;
      start = s;
    }
  }
  return out;
}

const BASE = -0.8; // 遠くの地面の基準高さ

// 地形の高さ: コースの近くは路面に合わせ、離れるほど基準の丘へなじませる
export function terrainHeight(track, x, z) {
  const l = locate(track, x, z);
  const wall = track.halfWidth + track.runoff;
  const d = Math.abs(l.lateral);
  const hills = BASE + 2.5 * Math.sin(x * 0.012 + 1) * Math.sin(z * 0.01 + 0.4) + 1.2 * Math.sin(x * 0.031 - z * 0.023);
  if (d <= wall + 1.5) return roadHeight(track, l.s, Math.sign(l.lateral) * Math.min(d, wall)) - 0.25;
  const edge = roadHeight(track, l.s, Math.sign(l.lateral) * wall) - 0.25;
  const k = Math.min(1, (d - wall - 1.5) / 28);
  const sm = k * k * (3 - 2 * k);
  return edge + (hills - edge) * sm;
}

export function buildWorld(scene, track) {
  const group = new THREE.Group();
  scene.add(group);
  scene.background = new THREE.Color(0x8fc4ff);
  scene.fog = new THREE.Fog(0xbad8ff, 150, 650);

  scene.add(new THREE.HemisphereLight(0xdcecff, 0x4a6b2a, 1.4));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(80, 140, 40);
  scene.add(sun);

  const hw = track.halfWidth;
  const wall = hw + track.runoff;

  // 地形（コースの範囲 + 余白をグリッドで覆う）
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.N; i++) {
    minX = Math.min(minX, track.x[i]); maxX = Math.max(maxX, track.x[i]);
    minZ = Math.min(minZ, track.z[i]); maxZ = Math.max(maxZ, track.z[i]);
  }
  const M = 160, CELL = 5;
  const x0 = minX - M, z0 = minZ - M;
  const nx = Math.ceil((maxX - minX + 2 * M) / CELL), nz = Math.ceil((maxZ - minZ + 2 * M) / CELL);
  const tg = new THREE.PlaneGeometry(nx * CELL, nz * CELL, nx, nz);
  tg.rotateX(-Math.PI / 2);
  tg.translate(x0 + (nx * CELL) / 2, 0, z0 + (nz * CELL) / 2);
  const tp = tg.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setY(i, terrainHeight(track, tp.getX(i), tp.getZ(i)));
  tg.computeVertexNormals();
  const grassTex = canvasTexture(256, 256, (ctx, w, h) => speckle(ctx, w, h, '#4c8a2e', 70, 9000));
  grassTex.repeat.set(nx / 3, nz / 3);
  group.add(new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ map: grassTex })));
  // 地平線まで続く平地
  const far = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshLambertMaterial({ color: 0x4f8a32 }));
  far.rotation.x = -Math.PI / 2;
  far.position.set(x0 + (nx * CELL) / 2, BASE - 3, z0 + (nz * CELL) / 2);
  group.add(far);

  // 路面
  const tarmacTex = canvasTexture(256, 512, (ctx, w, h) => {
    speckle(ctx, w, h, '#3b3d42', 60, 14000);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(8, 0, 6, h);
    ctx.fillRect(w - 14, 0, 6, h);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(w / 2 - 3, 0, 6, h * 0.45);
  });
  const roughTex = canvasTexture(256, 512, (ctx, w, h) => {
    speckle(ctx, w, h, '#45464b', 80, 16000);
    // 補修跡とひび
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(20,20,24,${0.25 + Math.random() * 0.3})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 30 + Math.random() * 70, 20 + Math.random() * 50);
    }
    ctx.strokeStyle = 'rgba(15,15,15,0.7)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 20; i++) {
      ctx.beginPath();
      let x = Math.random() * w, y = Math.random() * h;
      ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * 40; y += Math.random() * 30; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(8, 0, 6, h);
    ctx.fillRect(w - 14, 0, 6, h);
  });
  const dirtTex = canvasTexture(256, 512, (ctx, w, h) => {
    speckle(ctx, w, h, '#8a6a45', 90, 20000, 3);
    // わだち
    for (const x of [w * 0.3, w * 0.7]) {
      const g = ctx.createLinearGradient(x - 26, 0, x + 26, 0);
      g.addColorStop(0, 'rgba(60,40,20,0)');
      g.addColorStop(0.5, 'rgba(60,40,20,0.45)');
      g.addColorStop(1, 'rgba(60,40,20,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 26, 0, 52, h);
    }
  });
  const mats = {
    tarmac: new THREE.MeshLambertMaterial({ map: tarmacTex }),
    rough: new THREE.MeshLambertMaterial({ map: roughTex }),
    dirt: new THREE.MeshLambertMaterial({ map: dirtTex }),
  };
  const curbTex = canvasTexture(64, 128, (ctx, w, h) => {
    ctx.fillStyle = '#e8262c';
    ctx.fillRect(0, 0, w, h / 2);
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0, h / 2, w, h / 2);
  });
  const curbMat = new THREE.MeshLambertMaterial({ map: curbTex });
  const runTex = canvasTexture(64, 64, (ctx, w, h) => speckle(ctx, w, h, '#5f8f3a', 50, 600));
  const runMat = new THREE.MeshLambertMaterial({ map: runTex });
  const gravelMat = new THREE.MeshLambertMaterial({ map: canvasTexture(64, 64, (ctx, w, h) => speckle(ctx, w, h, '#9b8462', 70, 900, 2)) });

  for (const r of surfaceRanges(track)) {
    const dirt = r.type === 'dirt';
    // ダート区間は道幅いっぱいが土。舗装区間は縁石の内側が舗装
    const inner = dirt ? hw : hw - 0.85;
    group.add(new THREE.Mesh(ribbon(track, { lat0: -inner, lat1: inner, segs: 6, dy: 0.01, from: r.from, to: r.to }), mats[r.type]));
    if (!dirt) {
      group.add(new THREE.Mesh(ribbon(track, { lat0: -hw, lat1: -hw + 0.9, dy: 0.03, vScale: 2, from: r.from, to: r.to }), curbMat));
      group.add(new THREE.Mesh(ribbon(track, { lat0: hw - 0.9, lat1: hw, dy: 0.03, vScale: 2, from: r.from, to: r.to }), curbMat));
    }
    const side = dirt ? gravelMat : runMat;
    group.add(new THREE.Mesh(ribbon(track, { lat0: -wall, lat1: -hw, segs: 2, dy: 0.005, vScale: 4, from: r.from, to: r.to }), side));
    group.add(new THREE.Mesh(ribbon(track, { lat0: hw, lat1: wall, segs: 2, dy: 0.005, vScale: 4, from: r.from, to: r.to }), side));
  }

  // スタートラインのチェッカー（路面に沿わせる）
  const checker = canvasTexture(32, 128, (ctx, w, h) => {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 16; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff';
      ctx.fillRect((i * w) / 4, (j * h) / 16, w / 4, h / 16);
    }
  }, false);
  const s0 = track.def.startS || 0;
  const lineGeo = ribbon(track, { lat0: -hw, lat1: hw, dy: 0.04, vScale: 2, from: s0 - 1, to: s0 + 1 });
  // UV を「横 = 進行方向」に入れ替えてチェッカーを貼る
  const luv = lineGeo.attributes.uv;
  for (let i = 0; i < luv.count; i++) {
    const u = luv.getX(i), v = luv.getY(i);
    luv.setXY(i, v - (s0 - 1) / 2, u);
  }
  group.add(new THREE.Mesh(lineGeo, new THREE.MeshLambertMaterial({ map: checker })));

  // スタートゲート
  const start = pointAt(track, s0, 0);
  const gate = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: 0x2a2a33 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), postMat);
    post.position.set(0, 3.5, side * (hw + 1.5));
    gate.add(post);
  }
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 1.4, hw * 2 + 3.6),
    new THREE.MeshLambertMaterial({
      map: canvasTexture(512, 64, (ctx, w, h) => {
        ctx.fillStyle = '#ff3b3b';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 40px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('THUNDER RING  ·  START / FINISH', w / 2, h / 2 + 2);
      }, false),
    }),
  );
  banner.position.y = 6.8;
  gate.add(banner);
  gate.position.set(start.x, roadHeight(track, s0, 0), start.z);
  gate.rotation.y = -start.heading;
  group.add(gate);

  // 加速パネル（路面に沿う短い帯）
  const padTex = canvasTexture(128, 64, (ctx, w, h) => {
    ctx.fillStyle = '#ff8a00';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffe14a';
    for (let k = 0; k < 3; k++) {
      const x = 16 + k * 38;
      ctx.beginPath();
      ctx.moveTo(x, 6);
      ctx.lineTo(x + 26, h / 2);
      ctx.lineTo(x, h - 6);
      ctx.lineTo(x + 10, h - 6);
      ctx.lineTo(x + 36, h / 2);
      ctx.lineTo(x + 10, 6);
      ctx.fill();
    }
  }, false);
  const padMat = new THREE.MeshBasicMaterial({ map: padTex });
  for (const pad of track.def.boostPads || []) {
    const g = ribbon(track, { lat0: pad.lateral - 1.1, lat1: pad.lateral + 1.1, dy: 0.045, vScale: 3.2, from: pad.s - 1.6, to: pad.s + 1.6 });
    const uvs = g.attributes.uv;
    for (let i = 0; i < uvs.count; i++) {
      const u = uvs.getX(i), v = uvs.getY(i);
      uvs.setXY(i, v - (pad.s - 1.6) / 3.2, 1 - u);
    }
    group.add(new THREE.Mesh(g, padMat));
  }

  // タイヤバリア（赤白交互）
  const spacing = 1.1;
  const per = Math.floor(track.length / spacing);
  const tires = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.45, 0.45, 0.9, 10), new THREE.MeshLambertMaterial({ color: 0xffffff }), per * 2);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  let n = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < per; i++) {
      const s = i * spacing;
      const lat = side * (wall + 0.45);
      const p = pointAt(track, s, lat);
      m4.makeTranslation(p.x, roadHeight(track, s, side * wall) + 0.45, p.z);
      tires.setMatrixAt(n, m4);
      tires.setColorAt(n, col.set(Math.floor(i / 3) % 2 ? 0xe8262c : 0xf2f2f2));
      n++;
    }
  }
  group.add(tires);

  // 木（コースから離れた場所だけ）
  const rng = mulberry32(42);
  const treeCount = 300;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 2, 6), new THREE.MeshLambertMaterial({ color: 0x6b4423 }), treeCount);
  const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 5.5, 7), new THREE.MeshLambertMaterial({ color: 0xffffff }), treeCount);
  let t = 0, tries = 0;
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc3 = new THREE.Vector3();
  while (t < treeCount && tries < 6000) {
    tries++;
    const x = x0 + rng() * nx * CELL, z = z0 + rng() * nz * CELL;
    const l = locate(track, x, z);
    if (Math.abs(l.lateral) < wall + 7) continue;
    const y = terrainHeight(track, x, z);
    const sc = 0.7 + rng() * 0.8;
    sc3.set(sc, sc, sc);
    trunks.setMatrixAt(t, m4.compose(v.set(x, y + 1 * sc, z), q, sc3));
    leaves.setMatrixAt(t, m4.compose(v.set(x, y + 4.6 * sc, z), q, sc3));
    leaves.setColorAt(t, col.setHSL(0.28 + rng() * 0.06, 0.5, 0.25 + rng() * 0.1));
    t++;
  }
  trunks.count = leaves.count = t;
  group.add(trunks, leaves);

  // 遠景の山
  const mountMat = new THREE.MeshLambertMaterial({ color: 0x8299bb, flatShading: true, fog: false });
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = 560 + rng() * 120;
    const h = 60 + rng() * 90;
    const m = new THREE.Mesh(new THREE.ConeGeometry(90 + rng() * 60, h, 5), mountMat);
    m.position.set(cx + Math.cos(a) * r, h / 2 - 5, cz + Math.sin(a) * r);
    m.rotation.y = rng() * Math.PI;
    group.add(m);
  }

  return group;
}
