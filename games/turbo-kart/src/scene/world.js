// コースの見た目: 起伏のある地形・路面（ターマック / 荒れたターマック / ダート）・縁石・バリア・木・山
// theme: 'party'（明るいトゥーン、顔のある木・風船・信号機マスコット・コイン）
//        'real'（写実的: PBR の路面、ガードレール、グランドスタンド、太陽の影）
import * as THREE from 'three';
import { pointAt, locate, wrapS, curvatureAt, wallAt } from '../core/track.js';
import { roadHeight, surfaceType } from '../core/surface.js';
import { mulberry32 } from '../core/rng.js';
import { coinLayout } from '../core/coins.js';
import { skyDome, clouds } from './style.js';
import { mat, addOutline } from './theme.js';

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

// コースに沿った縦の帯（ガードレールなど）。lat の位置に、路面の高さ + y0..y1 で立てる
function wallStrip(track, { lat, y0, y1, baseLat = lat, from = 0, to = track.length }) {
  const len = wrapS(track, to - from) || track.length;
  const n = Math.max(1, Math.ceil(len / track.ds));
  const pos = new Float32Array((n + 1) * 2 * 3);
  const uv = new Float32Array((n + 1) * 2 * 2);
  for (let i = 0; i <= n; i++) {
    const s = from + (i * len) / n;
    // lat / baseLat は数値か、s ごとの関数（急なカーブの内側で壁が手前に来る場合）
    const p = pointAt(track, s, typeof lat === 'function' ? lat(s) : lat);
    const y = roadHeight(track, s, typeof baseLat === 'function' ? baseLat(s) : baseLat);
    pos.set([p.x, y + y0, p.z, p.x, y + y1, p.z], i * 6);
    uv.set([s / 4, 0, s / 4, 1], i * 4);
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
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

// 1 つの区間に対する地形の高さ（路面に合わせ、離れるほど基準の丘へなじませる）
function heightNear(track, l, hills) {
  const wall = track.halfWidth + track.runoff;
  const d = Math.abs(l.lateral);
  if (d <= wall + 1.5) return roadHeight(track, l.s, Math.sign(l.lateral) * Math.min(d, wall)) - 0.25;
  const edge = roadHeight(track, l.s, Math.sign(l.lateral) * wall) - 0.25;
  const k = Math.min(1, (d - wall - 1.5) / 28);
  const sm = k * k * (3 - 2 * k);
  return edge + (hills - edge) * sm;
}

// 地形の高さ。立体交差のように近くに別の区間があるときは低い方に合わせる（上の道は橋になる）
export function terrainHeight(track, x, z) {
  const hills = BASE + 2.5 * Math.sin(x * 0.012 + 1) * Math.sin(z * 0.01 + 0.4) + 1.2 * Math.sin(x * 0.031 - z * 0.023);
  const l = locate(track, x, z);
  let h = heightNear(track, l, hills);
  const reach = track.halfWidth + track.runoff + 30;
  let best = Infinity, bi = -1;
  for (let i = 0; i < track.N; i += 2) {
    const ds = Math.abs(i - l.i);
    if (Math.min(ds, track.N - ds) < 120) continue;
    const d = (track.x[i] - x) ** 2 + (track.z[i] - z) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  if (bi >= 0 && best < reach * reach) h = Math.min(h, heightNear(track, locate(track, x, z, bi), hills));
  return h;
}

// 直線区間（前後 25m がほぼまっすぐ）か
const isStraight = (track, s0) => {
  for (let d = -25; d <= 25; d += 5) if (Math.abs(curvatureAt(track, s0 + d)) > 1 / 300) return false;
  return true;
};

export function buildWorld(scene, track, { theme = 'party' } = {}) {
  const real = theme === 'real';
  const party = !real;
  const M = (params, kind) => mat(theme, params, kind);
  const group = new THREE.Group();
  scene.add(group);
  const updaters = [];
  // 毎フレーム呼ぶ（風船・コイン・信号機・太陽の影の追従）。ctx: { dt, time, race, focus }
  group.userData.update = (ctx) => { for (const f of updaters) f(ctx); };

  // コースを切り替えるときに丸ごと外せるよう、空と光も group に入れる
  // 空はカメラの描画距離（1500m）に収まる大きさにして、注目しているカートに追従させる
  let sky;
  updaters.push(({ focus }) => { if (focus && sky) sky.position.set(focus.x, 0, focus.z); });
  if (real) {
    scene.background = new THREE.Color(0xb9c9d8);
    scene.fog = new THREE.Fog(0xc4d0db, 250, 1300);
    group.add(sky = skyDome(1300, { top: 0x2f63a8, horizon: 0xd3dde6, bottom: 0xa9b5bf }));
    group.add(new THREE.HemisphereLight(0xdbe7ff, 0x48553a, 0.7));
  } else {
    scene.background = new THREE.Color(0x9fd9ff);
    scene.fog = new THREE.Fog(0xc8efff, 260, 1100);
    group.add(sky = skyDome(1300));
    group.add(new THREE.HemisphereLight(0xffffff, 0x6fbf3a, 1.6));
  }
  const sun = new THREE.DirectionalLight(real ? 0xfff1dc : 0xfff4dc, real ? 3.2 : 2.4);
  sun.position.set(80, 140, 40);
  group.add(sun, sun.target);
  if (real) {
    // 影は注目しているカートの周り（約 80m 四方）だけに落とす
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -40;
    sc.right = sc.top = 40;
    sc.near = 10;
    sc.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    const off = new THREE.Vector3(80, 140, 40).normalize().multiplyScalar(200);
    updaters.push(({ focus }) => {
      if (!focus) return;
      sun.target.position.set(focus.x, focus.y, focus.z);
      sun.position.set(focus.x + off.x, focus.y + off.y, focus.z + off.z);
    });
  }

  const hw = track.halfWidth;
  const wall = hw + track.runoff;

  // 地形（コースの範囲 + 余白をグリッドで覆う）
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.N; i++) {
    minX = Math.min(minX, track.x[i]); maxX = Math.max(maxX, track.x[i]);
    minZ = Math.min(minZ, track.z[i]); maxZ = Math.max(maxZ, track.z[i]);
  }
  const MARGIN = 160, CELL = 5;
  const x0 = minX - MARGIN, z0 = minZ - MARGIN;
  const nx = Math.ceil((maxX - minX + 2 * MARGIN) / CELL), nz = Math.ceil((maxZ - minZ + 2 * MARGIN) / CELL);
  const tg = new THREE.PlaneGeometry(nx * CELL, nz * CELL, nx, nz);
  tg.rotateX(-Math.PI / 2);
  tg.translate(x0 + (nx * CELL) / 2, 0, z0 + (nz * CELL) / 2);
  const tp = tg.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setY(i, terrainHeight(track, tp.getX(i), tp.getZ(i)));
  tg.computeVertexNormals();
  // 芝（パーティーは芝刈りの縞模様のある明るい芝、本格は落ち着いた色）
  const grassTex = canvasTexture(256, 256, (ctx, w, h) => {
    speckle(ctx, w, h, real ? '#4f7431' : '#5ccf3c', real ? 55 : 40, real ? 14000 : 5000);
    ctx.fillStyle = `rgba(255,255,255,${real ? 0.04 : 0.08})`;
    ctx.fillRect(0, 0, w / 2, h);
  });
  grassTex.repeat.set(nx / 3, nz / 3);
  const terrain = new THREE.Mesh(tg, M({ map: grassTex }, 'cloth'));
  terrain.receiveShadow = real;
  group.add(terrain);
  // 地平線まで続く平地
  const far = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), M({ color: real ? 0x4c6a33 : 0x5ccf3c }, 'cloth'));
  far.rotation.x = -Math.PI / 2;
  far.position.set(x0 + (nx * CELL) / 2, BASE - 3, z0 + (nz * CELL) / 2);
  group.add(far);

  // 路面
  const tarmacTex = canvasTexture(256, 512, (ctx, w, h) => {
    if (real) {
      speckle(ctx, w, h, '#3d3f44', 34, 22000, 1);
      // 走行ラインのタイヤ跡（中央付近がわずかに黒い）
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0.25, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.18)');
      g.addColorStop(0.75, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(235,235,230,0.9)';
      ctx.fillRect(6, 0, 5, h);
      ctx.fillRect(w - 11, 0, 5, h);
      return;
    }
    speckle(ctx, w, h, '#50535e', 40, 9000);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(8, 0, 6, h);
    ctx.fillRect(w - 14, 0, 6, h);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(w / 2 - 3, 0, 6, h * 0.45);
  });
  const roughTex = canvasTexture(256, 512, (ctx, w, h) => {
    speckle(ctx, w, h, real ? '#45464b' : '#585a63', 60, 12000);
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
    speckle(ctx, w, h, real ? '#8f6f4c' : '#c08a4e', 70, 16000, 3);
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
  const road = (map, roughness) => (real ? new THREE.MeshStandardMaterial({ map, roughness, metalness: 0 }) : M({ map }));
  const mats = {
    tarmac: road(tarmacTex, 0.82),
    rough: road(roughTex, 0.9),
    dirt: road(dirtTex, 1),
  };
  const curbTex = canvasTexture(64, 128, (ctx, w, h) => {
    ctx.fillStyle = real ? '#c8262a' : '#e8262c';
    ctx.fillRect(0, 0, w, h / 2);
    ctx.fillStyle = real ? '#e9e9e4' : '#f4f4f4';
    ctx.fillRect(0, h / 2, w, h / 2);
  });
  const curbMat = M({ map: curbTex }, 'plastic');
  const runTex = canvasTexture(64, 64, (ctx, w, h) => speckle(ctx, w, h, real ? '#56793a' : '#66d846', 30, 300));
  const runMat = M({ map: runTex }, 'cloth');
  const gravelMat = M({ map: canvasTexture(64, 64, (ctx, w, h) => speckle(ctx, w, h, real ? '#b7a68a' : '#e0b77a', 60, 700, 2)) }, 'cloth');

  const addRibbon = (geo, material) => {
    const m = new THREE.Mesh(geo, material);
    m.receiveShadow = real;
    group.add(m);
    return m;
  };
  for (const r of surfaceRanges(track)) {
    const dirt = r.type === 'dirt';
    // ダート区間は道幅いっぱいが土。舗装区間は縁石の内側が舗装
    const inner = dirt ? hw : hw - 0.85;
    addRibbon(ribbon(track, { lat0: -inner, lat1: inner, segs: 6, dy: 0.01, from: r.from, to: r.to }), mats[r.type]);
    if (!dirt) {
      addRibbon(ribbon(track, { lat0: -hw, lat1: -hw + 0.9, dy: 0.03, vScale: 2, from: r.from, to: r.to }), curbMat);
      addRibbon(ribbon(track, { lat0: hw - 0.9, lat1: hw, dy: 0.03, vScale: 2, from: r.from, to: r.to }), curbMat);
    }
    const side = dirt ? gravelMat : runMat;
    addRibbon(ribbon(track, { lat0: -wall, lat1: -hw, segs: 2, dy: 0.005, vScale: 4, from: r.from, to: r.to }), side);
    addRibbon(ribbon(track, { lat0: hw, lat1: wall, segs: 2, dy: 0.005, vScale: 4, from: r.from, to: r.to }), side);
  }

  // 高架（立体交差の上の道など）の橋脚
  const pillarGeo = new THREE.CylinderGeometry(0.6, 0.8, 1, 10);
  const pillarMat = M({ color: 0xc9c2b8 }, 'plastic');
  for (let s0 = 0; s0 < track.length; s0 += 9) {
    for (const lat of [-hw + 1.5, hw - 1.5]) {
      const p = pointAt(track, s0, lat);
      const top = roadHeight(track, s0, lat);
      const ground = terrainHeight(track, p.x, p.z);
      if (top - ground < 2.5) continue;
      const pl = new THREE.Mesh(pillarGeo, pillarMat);
      pl.scale.y = top - ground;
      pl.position.set(p.x, (top + ground) / 2, p.z);
      group.add(pl);
    }
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
  addRibbon(lineGeo, M({ map: checker }));

  // スタートゲート
  const start = pointAt(track, s0, 0);
  const gate = new THREE.Group();
  const postMat = M({ color: real ? 0x3a3d44 : 0x2a2a33 }, 'metal');
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), postMat);
    post.position.set(0, 3.5, side * (hw + 1.5));
    gate.add(post);
  }
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 1.4, hw * 2 + 3.6),
    M({
      map: canvasTexture(512, 64, (ctx, w, h) => {
        ctx.fillStyle = real ? '#15171c' : '#ff3b3b';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#fff';
        ctx.font = `${real ? '600 34px' : 'bold 40px'} system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${track.def.name.toUpperCase()}  ·  START / FINISH`, w / 2, h / 2 + 2);
      }, false),
    }),
  );
  banner.position.y = 6.8;
  gate.add(banner);
  if (party) gate.add(signalMascot(updaters, hw));
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
  const padMat = new THREE.MeshBasicMaterial({ map: padTex, color: real ? 0xbbbbbb : 0xffffff });
  for (const pad of track.def.boostPads || []) {
    const g = ribbon(track, { lat0: pad.lateral - 1.1, lat1: pad.lateral + 1.1, dy: 0.045, vScale: 3.2, from: pad.s - 1.6, to: pad.s + 1.6 });
    const uvs = g.attributes.uv;
    for (let i = 0; i < uvs.count; i++) {
      const u = uvs.getX(i), v = uvs.getY(i);
      uvs.setXY(i, v - (pad.s - 1.6) / 3.2, 1 - u);
    }
    group.add(new THREE.Mesh(g, padMat));
  }

  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc3 = new THREE.Vector3();
  if (real) {
    buildArmco(group, track, wall);
    buildGrandstand(group, track, wall, s0);
  } else {
    // タイヤバリア（赤白交互）
    const spacing = 1.1;
    const per = Math.floor(track.length / spacing);
    const tires = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.45, 0.45, 0.9, 10), M({ color: 0xffffff }), per * 2);
    let n = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < per; i++) {
        const s = i * spacing;
        const w = wallAt(track, s, side);
        const p = pointAt(track, s, side * (w + 0.45));
        m4.makeTranslation(p.x, roadHeight(track, s, side * w) + 0.45, p.z);
        tires.setMatrixAt(n, m4);
        tires.setColorAt(n, col.set(Math.floor(i / 3) % 2 ? 0xe8262c : 0xf2f2f2));
        n++;
      }
    }
    group.add(tires);
  }

  // 木（コースから離れた場所だけ）。丸い木と円錐の木を混ぜる
  const rng = mulberry32(42);
  const treeCount = 320;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.4, 2.4, 7), M({ color: real ? 0x5a4330 : 0x8a5a2b }, 'cloth'), treeCount);
  // 写実モードは葉の塊をでこぼこにして、作り物っぽさを減らす
  const ballGeo = real ? lumpy(new THREE.IcosahedronGeometry(2.6, 3), 0.55, 1.3) : new THREE.IcosahedronGeometry(2.6, 1);
  const coneGeo = real ? lumpy(new THREE.CylinderGeometry(0.01, 2.3, 6, 14, 6), 0.35, 2.1) : new THREE.ConeGeometry(2.3, 6, 8);
  const balls = new THREE.InstancedMesh(ballGeo, M({ color: 0xffffff }, 'cloth'), treeCount);
  const cones = new THREE.InstancedMesh(coneGeo, M({ color: 0xffffff }, 'cloth'), treeCount);
  const faces = []; // パーティー: 顔を付ける木（位置・大きさ・コースの方向）
  let nb = 0, nc = 0, t = 0, tries = 0;
  while (t < treeCount && tries < 6000) {
    tries++;
    const x = x0 + rng() * nx * CELL, z = z0 + rng() * nz * CELL;
    const l = locate(track, x, z);
    if (Math.abs(l.lateral) < wall + 7) continue;
    const y = terrainHeight(track, x, z);
    const sc = 0.8 + rng() * 0.7;
    sc3.set(sc, sc * (real ? 1.25 : 1), sc);
    trunks.setMatrixAt(t, m4.compose(v.set(x, y + 1.2 * sc, z), q, sc3));
    if (rng() < 0.65) {
      balls.setMatrixAt(nb, m4.compose(v.set(x, y + 4.2 * sc, z), q, sc3));
      balls.setColorAt(nb++, real ? col.setHSL(0.22 + rng() * 0.06, 0.45, 0.22 + rng() * 0.08) : col.setHSL(0.25 + rng() * 0.08, 0.75, 0.42 + rng() * 0.1));
      // コースに近い木の一部に顔を付ける（コースの方を向く）
      if (party && Math.abs(l.lateral) < wall + 40 && rng() < 0.45) {
        const p = pointAt(track, l.s, 0);
        faces.push({ x, y: y + 4.2 * sc, z, sc, dir: Math.atan2(p.z - z, p.x - x) });
      }
    } else {
      cones.setMatrixAt(nc, m4.compose(v.set(x, y + 4.6 * sc, z), q, sc3));
      cones.setColorAt(nc++, real ? col.setHSL(0.3 + rng() * 0.05, 0.4, 0.17 + rng() * 0.06) : col.setHSL(0.33 + rng() * 0.05, 0.7, 0.3 + rng() * 0.08));
    }
    t++;
  }
  trunks.count = t;
  balls.count = nb;
  cones.count = nc;
  for (const o of [trunks, balls, cones]) o.castShadow = real;
  group.add(trunks, balls, cones);
  if (party && faces.length) group.add(treeFaces(faces));

  if (party) {
    // 花畑（コース脇の芝に色とりどりの花）
    const flowerCount = 1800;
    const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.22, 0), M({ color: 0xffffff }), flowerCount);
    const petals = [0xff4f7b, 0xffd23f, 0xffffff, 0xff8a1f, 0xb06cff, 0x4fc3ff];
    let nf = 0;
    for (let i = 0; i < 9000 && nf < flowerCount; i++) {
      const fs = rng() * track.length;
      const side = rng() < 0.5 ? -1 : 1;
      const lat = side * (wall + 2 + rng() * 22);
      const p = pointAt(track, fs, lat);
      const y = terrainHeight(track, p.x, p.z);
      flowers.setMatrixAt(nf, m4.compose(v.set(p.x, y + 0.25, p.z), q, sc3.set(1, 1, 1)));
      flowers.setColorAt(nf++, col.set(petals[Math.floor(rng() * petals.length)]));
    }
    flowers.count = nf;
    group.add(flowers);
  }

  // ストレート沿いの看板（パーティーはカラフル、本格は架空のスポンサー）
  const boardMats = real
    ? SPONSORS.map((sp) => M({ map: canvasTexture(512, 128, (ctx, w, h) => sponsorBoard(ctx, w, h, sp), false), side: THREE.DoubleSide }, 'plastic'))
    : [M({ map: canvasTexture(512, 128, partyBoard, false), side: THREE.DoubleSide })];
  const boardGeo = new THREE.PlaneGeometry(6, 1.5);
  const balloonSpots = [];
  let boards = 0;
  for (let bs = 0; bs < track.length && boards < 240; bs += 7) {
    if (!isStraight(track, bs)) continue;
    for (const side of [-1, 1]) {
      const p = pointAt(track, bs, side * (wall + 1.3));
      const b = new THREE.Mesh(boardGeo, boardMats[boards % boardMats.length]);
      b.position.set(p.x, roadHeight(track, bs, side * wall) + 1.1, p.z);
      b.rotation.y = -p.heading;
      b.castShadow = real;
      group.add(b);
      if (boards % 5 === 0) balloonSpots.push({ x: p.x, y: b.position.y + 0.8, z: p.z });
      boards++;
    }
  }
  if (party && balloonSpots.length) group.add(balloons(balloonSpots, updaters));

  // 旗（バンクの外側に並べる。パーティーのみ）
  if (party) {
    const flagGeo = new THREE.PlaneGeometry(1.4, 0.9);
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 4.5, 6);
    const poleMat = M({ color: 0xeeeeee });
    const flagColors = [0xff4f7b, 0xffd23f, 0xffffff, 0xff8a1f, 0xb06cff, 0x4fc3ff];
    for (const bk of track.def.banks || []) {
      for (let fs = bk.from + 6; fs < bk.to - 6; fs += 12) {
        const side = bk.turn === 'R' ? -1 : 1;
        const p = pointAt(track, fs, side * (wall + 2));
        const y = roadHeight(track, fs, side * wall);
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(p.x, y + 2.25, p.z);
        const flag = new THREE.Mesh(flagGeo, M({ color: flagColors[Math.floor(rng() * flagColors.length)], side: THREE.DoubleSide }));
        flag.position.set(p.x, y + 4, p.z + 0.7);
        flag.rotation.y = -p.heading + Math.PI / 2;
        group.add(pole, flag);
      }
    }
  }

  // 遠景の山
  const mountMat = real ? new THREE.MeshLambertMaterial({ color: 0x75838f }) : M({ color: 0x7fb8e8, fog: false });
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = Math.max(maxX - minX, maxZ - minZ) / 2 + 380 + rng() * 120;
    const h = 60 + rng() * 90;
    const m = new THREE.Mesh(real ? ridgeMountain(90 + rng() * 80, h, rng) : new THREE.ConeGeometry(90 + rng() * 60, h, 5), mountMat);
    m.position.set(cx + Math.cos(a) * r, h / 2 - 5, cz + Math.sin(a) * r);
    m.rotation.y = rng() * Math.PI;
    // 遠くの山どうしが重なる所で奥行きの精度不足のちらつきが出ないよう、背景として先に描く
    if (real) { m.renderOrder = -5; mountMat.depthWrite = false; }
    group.add(m);
  }

  const cloudMat = real ? new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9aa6b2, roughness: 1, transparent: true, opacity: 0.8, fog: false }) : null;
  group.add(clouds(rng, { x: cx, z: cz }, real ? 16 : 26, cloudMat));

  if (party) group.add(coinMeshes(track, updaters));
  return group;
}

// ---- パーティーモードの飾り ----

function partyBoard(ctx, w, h) {
  const cols = ['#ff3b5c', '#ffd23f', '#2fb4ff', '#7cff6a'];
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = cols[i];
    ctx.fillRect((i * w) / 4, 0, w / 4, h);
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = 'italic 900 72px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.strokeText('TURBO KART!', w / 2, h / 2 + 4);
  ctx.fillText('TURBO KART!', w / 2, h / 2 + 4);
}

// 顔のある木（白目・黒目・口をまとめてインスタンス描画）
function treeFaces(list) {
  const g = new THREE.Group();
  const n = list.length;
  const white = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 10, 8), mat('party', { color: 0xffffff }), n * 2);
  const pupil = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), mat('party', { color: 0x1c1420 }), n * 2);
  const mouth = new THREE.InstancedMesh(new THREE.TorusGeometry(0.6, 0.12, 6, 14, Math.PI), mat('party', { color: 0x5a2a1a }), n);
  const o = new THREE.Object3D();
  list.forEach((f, i) => {
    const r = 2.6 * f.sc;
    const cx = Math.cos(f.dir), cz = Math.sin(f.dir);
    // 右方向（顔の横）
    const rx = -cz, rz = cx;
    for (const [k, side] of [[0, -1], [1, 1]]) {
      o.position.set(f.x + cx * r * 0.88 + rx * side * r * 0.3, f.y + r * 0.2, f.z + cz * r * 0.88 + rz * side * r * 0.3);
      o.rotation.set(0, 0, 0);
      o.scale.setScalar(f.sc);
      o.updateMatrix();
      white.setMatrixAt(i * 2 + k, o.matrix);
      o.position.set(f.x + cx * r * 1.0 + rx * side * r * 0.3, f.y + r * 0.2, f.z + cz * r * 1.0 + rz * side * r * 0.3);
      o.updateMatrix();
      pupil.setMatrixAt(i * 2 + k, o.matrix);
    }
    o.position.set(f.x + cx * r * 0.92, f.y - r * 0.2, f.z + cz * r * 0.92);
    // 口: 円弧を下向き（笑顔）にして、コースの方を向ける
    o.rotation.set(0, -f.dir + Math.PI / 2, Math.PI);
    o.scale.setScalar(f.sc);
    o.updateMatrix();
    mouth.setMatrixAt(i, o.matrix);
  });
  g.add(white, pupil, mouth);
  return g;
}

// ストレートの看板の上にふわふわ揺れる風船
function balloons(spots, updaters) {
  const n = spots.length * 3;
  const ball = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 14, 10), mat('party', { color: 0xffffff }), n);
  const strings = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 1.6, 4), mat('party', { color: 0xeeeeee }), n);
  const colors = [0xff4f7b, 0xffd23f, 0x4fc3ff, 0x7cff6a, 0xb06cff, 0xff8a1f];
  const col = new THREE.Color();
  const items = [];
  spots.forEach((s, i) => {
    for (let k = 0; k < 3; k++) {
      const id = i * 3 + k;
      ball.setColorAt(id, col.set(colors[(i + k * 2) % colors.length]));
      items.push({ id, x: s.x + (k - 1) * 0.5, y: s.y + 1.6 + (k === 1 ? 0.4 : 0), z: s.z, ph: Math.random() * 6.28 });
    }
  });
  const o = new THREE.Object3D();
  const place = (time) => {
    for (const it of items) {
      const sway = Math.sin(time * 1.3 + it.ph) * 0.12;
      o.position.set(it.x + sway, it.y + Math.sin(time * 1.7 + it.ph) * 0.12, it.z);
      o.rotation.set(0, 0, sway * 0.5);
      o.scale.set(1, 1.15, 1);
      o.updateMatrix();
      ball.setMatrixAt(it.id, o.matrix);
      o.position.set(it.x + sway * 0.5, it.y - 1.1, it.z);
      o.scale.set(1, 1, 1);
      o.updateMatrix();
      strings.setMatrixAt(it.id, o.matrix);
    }
    ball.instanceMatrix.needsUpdate = strings.instanceMatrix.needsUpdate = true;
  };
  place(0);
  let t = 0, acc = 0;
  updaters.push(({ dt }) => {
    t += dt;
    acc += dt;
    if (acc < 1 / 30) return; // 揺れは 30fps で十分
    acc = 0;
    place(t);
  });
  const g = new THREE.Group();
  g.add(ball, strings);
  return g;
}

// スタートゲートの信号機マスコット: カウントダウンで赤が 1 つずつ灯り、スタートで全部が緑になる
function signalMascot(updaters, hw) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 2.6), mat('party', { color: 0x2a2a33 }));
  addOutline(body, 0.04);
  g.add(body);
  const lamps = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.MeshBasicMaterial({ color: 0x441111 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), m);
    lamp.position.set(-0.22, 0.05, (i - 1) * 0.8);
    g.add(lamp);
    lamps.push(m);
  }
  // 目と口（後ろ側 = 走ってくるカートから見える面）
  for (const z of [-0.45, 0.45]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), mat('party', { color: 0xffffff }));
    eye.position.set(-0.26, 0.75, z);
    eye.scale.set(0.5, 1.2, 1);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), mat('party', { color: 0x1c1420 }));
    pupil.position.set(-0.33, 0.73, z);
    g.add(eye, pupil);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 6, 16, Math.PI), mat('party', { color: 0x1c1420 }));
  smile.position.set(-0.26, -0.55, 0);
  smile.rotation.set(0, -Math.PI / 2, Math.PI);
  g.add(smile);
  g.position.set(0, 5.4, 0);
  g.scale.setScalar(Math.min(1.4, hw / 4));
  const OFF = 0x441111, RED = 0xff2a2a, GREEN = 0x3dff6a;
  updaters.push(({ race }) => {
    if (!race) return;
    const t = race.time;
    for (let i = 0; i < 3; i++) {
      let c = OFF;
      if (race.state === 'countdown') c = t >= -3 + i ? RED : OFF;
      else if (t < 2.5) c = GREEN;
      lamps[i].color.setHex(c);
    }
  });
  return g;
}

// コース上のコイン（回転する金色の円盤）。取られたコインは race.coins の respawnAt まで隠す
function coinMeshes(track, updaters) {
  const layout = coinLayout(track);
  const geo = new THREE.CylinderGeometry(0.45, 0.45, 0.1, 20);
  geo.rotateX(Math.PI / 2);
  const m = new THREE.InstancedMesh(geo, mat('party', { color: 0xffc928, emissive: 0x6a4a00 }), layout.length);
  const ys = layout.map((c) => roadHeight(track, c.s, c.lateral) + 0.75);
  const o = new THREE.Object3D();
  let t = 0;
  const place = (race) => {
    for (let i = 0; i < layout.length; i++) {
      const c = layout[i];
      const hidden = race?.coins?.[i] && race.coins[i].respawnAt > race.time;
      o.position.set(c.x, ys[i] + Math.sin(t * 3 + i) * 0.08, c.z);
      o.rotation.set(0, t * 3 + i * 0.4, 0);
      o.scale.setScalar(hidden ? 0.0001 : 1);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  };
  place(null);
  updaters.push(({ dt, race }) => {
    t += dt;
    place(race);
  });
  return m;
}

// ---- 写実モードの設備 ----

// 頂点を外向きに不規則にずらす（葉の塊のでこぼこ）
function lumpy(geo, amount, freq) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * freq + 1.7) * Math.sin(v.y * freq * 1.3 + 0.4) * Math.sin(v.z * freq * 0.9 + 2.2);
    const len = Math.hypot(v.x, v.z) || 1;
    const d = amount * n;
    p.setXYZ(i, v.x + (v.x / len) * d, v.y + d * 0.5, v.z + (v.z / len) * d);
  }
  g.computeVertexNormals();
  return g;
}

// 稜線が不規則な山（円錐の頂点を角度と高さに応じて揺らし、頂上を丸める）
function ridgeMountain(r, h, rng) {
  // ConeGeometry は高さを分割すると三角形が半分欠けるので、先端がごく細い円柱で作る
  const g = new THREE.CylinderGeometry(0.01, r, h, 72, 16);
  const p = g.attributes.position;
  const ph = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const u = (y + h / 2) / h; // 0 = 裾, 1 = 頂上
    // 角度ごとに半径を変えて尾根と谷を作る。裾は凹ませて（凹型の斜面）山らしくする
    const n = 1 + 0.2 * Math.sin(a * 3 + ph[0]) + 0.08 * Math.sin(a * 5 + ph[1] + u * 2) + 0.03 * Math.sin(a * 9 + ph[2]);
    const concave = 1 - 0.35 * Math.sin(Math.PI * u);
    p.setX(i, x * n * concave);
    p.setZ(i, z * n * concave);
  }
  g.computeVertexNormals();
  return g;
}

const SPONSORS = [
  { bg: '#0d2a5c', fg: '#ffffff', text: 'NORDLINE TYRES', accent: '#f2c230' },
  { bg: '#f3f3f0', fg: '#c8102e', text: 'APEX MOTOR OIL', accent: '#1a1a1a' },
  { bg: '#121212', fg: '#e6e6e6', text: 'VELOCITA', accent: '#e4002b' },
  { bg: '#e87511', fg: '#ffffff', text: 'KAIZEN FUEL', accent: '#1a1a1a' },
  { bg: '#ffffff', fg: '#0a5a3c', text: 'GREENLAP', accent: '#0a5a3c' },
];

function sponsorBoard(ctx, w, h, sp) {
  ctx.fillStyle = sp.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = sp.accent;
  ctx.fillRect(0, h - 14, w, 14);
  ctx.fillStyle = sp.fg;
  ctx.font = 'italic 800 62px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sp.text, w / 2, h / 2 - 4);
}

// ガードレール（2 段の鋼板と支柱）
function buildArmco(group, track, wall) {
  const steel = new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const lat = (s) => side * (wallAt(track, s, side) + 0.3);
    const baseLat = (s) => side * wallAt(track, s, side);
    for (const [y0, y1] of [[0.45, 0.75], [0.85, 1.15]]) {
      const m = new THREE.Mesh(wallStrip(track, { lat, y0, y1, baseLat }), steel);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
  }
  const spacing = 4;
  const per = Math.floor(track.length / spacing);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.3, 0.12), new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.7, roughness: 0.5 }), per * 2);
  const m4 = new THREE.Matrix4();
  let n = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < per; i++) {
      const s = i * spacing;
      const w = wallAt(track, s, side);
      const p = pointAt(track, s, side * (w + 0.45));
      m4.makeTranslation(p.x, roadHeight(track, s, side * w) + 0.65, p.z);
      posts.setMatrixAt(n++, m4);
    }
  }
  posts.castShadow = true;
  group.add(posts);
}

// スタート・フィニッシュのストレートに、グランドスタンドとピット棟
function buildGrandstand(group, track, wall, s0) {
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa8a8a2, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: 0.5, metalness: 0.3 });
  // 観客席（色のついた点々で観客を表す）
  const crowd = (() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#5c5f66';
    ctx.fillRect(0, 0, 256, 64);
    const cols = ['#d33', '#36c', '#eee', '#fc3', '#2a2', '#222', '#e83'];
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = cols[Math.floor(Math.random() * cols.length)];
      ctx.fillRect(Math.random() * 256, Math.random() * 64, 3, 4);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  })();
  const seats = new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.95 });
  const len = 90;
  const side = 1; // コースの右側（ピットは反対側）
  for (let k = 0; k < 6; k++) {
    // 段々: 外側ほど高い
    const lat0 = side * (wall + 4 + k * 1.6), lat1 = side * (wall + 4 + (k + 1) * 1.6);
    const y = 0.8 + k * 1.0;
    const step = new THREE.Mesh(ribbonFlat(track, s0 - len / 2, s0 + len / 2, lat0, lat1, y), concrete);
    const riser = new THREE.Mesh(wallStrip(track, { lat: lat0, y0: y - 1.0, y1: y, baseLat: side * wall, from: s0 - len / 2, to: s0 + len / 2 }), seats);
    crowd.repeat.set(len / 8, 1);
    step.receiveShadow = riser.receiveShadow = true;
    group.add(step, riser);
  }
  // 屋根
  const roof = new THREE.Mesh(ribbonFlat(track, s0 - len / 2, s0 + len / 2, side * (wall + 3), side * (wall + 15), 9.5), roofMat);
  roof.castShadow = true;
  group.add(roof);
  // ピット棟（反対側）
  const pit = new THREE.Group();
  const p = pointAt(track, s0 + 10, -side * (wall + 9));
  const building = new THREE.Mesh(new THREE.BoxGeometry(70, 6, 10), new THREE.MeshStandardMaterial({ color: 0xe9ebee, roughness: 0.6 }));
  building.position.y = 3;
  const glass = new THREE.Mesh(new THREE.BoxGeometry(70.2, 1.6, 10.2), new THREE.MeshPhysicalMaterial({ color: 0x1b2836, roughness: 0.05, metalness: 0.6, clearcoat: 1 }));
  glass.position.y = 4.6;
  const doors = new THREE.Mesh(new THREE.BoxGeometry(68, 3.2, 10.1), new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.7 }));
  doors.position.y = 1.7;
  building.castShadow = glass.castShadow = true;
  pit.add(building, glass, doors);
  pit.position.set(p.x, roadHeight(track, s0, -side * wall), p.z);
  pit.rotation.y = -p.heading;
  group.add(pit);
}

// コースに沿った水平の板（一定の高さ）
function ribbonFlat(track, from, to, lat0, lat1, y) {
  const g = ribbon(track, { lat0, lat1, from, to, dy: 0 });
  const pos = g.attributes.position;
  // 路面の高さ（中央）+ y に揃える
  const n = pos.count / 2;
  for (let i = 0; i < n; i++) {
    const s = from + ((to - from) * i) / (n - 1);
    const base = roadHeight(track, s, 0) + y;
    pos.setY(i * 2, base);
    pos.setY(i * 2 + 1, base);
  }
  g.computeVertexNormals();
  return g;
}
