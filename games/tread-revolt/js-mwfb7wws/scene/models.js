// TREAD REVOLT の車両・敵ユニット・障害物・弾のローポリモデル。
// 形は箱と円柱、細部は textures.js の手続きテクスチャ。ジオメトリ/マテリアルはキャッシュして共有。
// 座標:メートル、Y上、前方+Z、接地 y=0。左 = +X(前を向いたとき左手側)、右 = -X。
import * as THREE from '../../vendor/three.module.js';
import { tex, rng } from './textures.js';

const PI = Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------- キャッシュ ----------
const GEO = new Map();
const gc = (k, fn) => { let g = GEO.get(k); if (!g) { g = fn(); GEO.set(k, g); } return g; };
const MATS = new Map();

// マテリアル。t=テクスチャ名 or [名前,引数...]。o: e=発光色 ei=強さ em=発光マップ r m flat basic tr add op ds decal
function mat(color, t = null, o = {}) {
  const key = [color, t, o.e, o.ei, o.em, o.r, o.m, o.flat, o.basic, o.tr, o.add, o.op, o.ds, o.decal].join('|');
  let m = MATS.get(key);
  if (m) return m;
  const map = t ? (Array.isArray(t) ? tex(...t) : tex(t)) : null;
  const side = o.ds ? THREE.DoubleSide : THREE.FrontSide;
  if (o.basic) {
    m = new THREE.MeshBasicMaterial({ color, map, side, transparent: !!(o.tr || o.add), opacity: o.op ?? 1,
      depthWrite: !(o.tr || o.add), blending: o.add ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false });
  } else {
    m = new THREE.MeshStandardMaterial({ color, map, side, roughness: o.r ?? 0.78, metalness: o.m ?? 0.15,
      flatShading: o.flat ?? true, transparent: !!o.tr, emissive: o.e ?? 0, emissiveIntensity: o.ei ?? 1,
      emissiveMap: o.em ? tex(o.em) : null });
  }
  if (o.decal) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; m.depthWrite = false; }
  MATS.set(key, m);
  return m;
}

// 錐台ボックス(底面 y=0、上面を tx,tz 倍に縮小し ox,oz ずらす)。UVはメートル基準(su,sv)。
// グループ順は BoxGeometry と同じ(+x,-x,+y,-y,+z,-z)
function B(w, h, d, tx = 1, tz = 1, ox = 0, oz = 0, su = 2, sv = 2) {
  return gc(`B${w},${h},${d},${tx},${tz},${ox},${oz},${su},${sv}`, () => {
    const W = w / 2, D = d / 2, TW = W * tx, TD = D * tz;
    const b = [[-W, 0, -D], [W, 0, -D], [W, 0, D], [-W, 0, D]];
    const t = [[-TW + ox, h, -TD + oz], [TW + ox, h, -TD + oz], [TW + ox, h, TD + oz], [-TW + ox, h, TD + oz]];
    const faces = [[b[1], b[2], t[2], t[1]], [b[3], b[0], t[0], t[3]], [t[0], t[1], t[2], t[3]], [b[0], b[1], b[2], b[3]], [b[2], b[3], t[3], t[2]], [b[0], b[1], t[1], t[0]]];
    const cen = [ox / 2, h / 2, oz / 2], pos = [], uv = [], idx = [], geo = new THREE.BufferGeometry();
    const A = new THREE.Vector3(), Bv = new THREE.Vector3(), N = new THREE.Vector3();
    faces.forEach((f, fi) => {
      const s = pos.length / 3;
      for (const p of f) {
        pos.push(...p);
        if (fi < 2) uv.push(p[2] / su, p[1] / sv); else if (fi < 4) uv.push(p[0] / su, p[2] / sv); else uv.push(p[0] / su, p[1] / sv);
      }
      // 外向きになるよう巻き方向を決める(潰れた面にも対応)
      A.set(f[1][0] - f[0][0], f[1][1] - f[0][1], f[1][2] - f[0][2]);
      Bv.set(f[2][0] - f[0][0], f[2][1] - f[0][1], f[2][2] - f[0][2]);
      if (A.lengthSq() < 1e-8) A.set(f[3][0] - f[2][0], f[3][1] - f[2][1], f[3][2] - f[2][2]).negate();
      N.crossVectors(A, Bv);
      const c = f.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4, a[2] + p[2] / 4], [0, 0, 0]);
      const out = N.x * (c[0] - cen[0]) + N.y * (c[1] - cen[1]) + N.z * (c[2] - cen[2]) >= 0;
      if (out) idx.push(s, s + 1, s + 2, s, s + 2, s + 3); else idx.push(s, s + 2, s + 1, s, s + 3, s + 2);
      geo.addGroup(fi * 6, 6, fi);
    });
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  });
}
// 円柱(中心原点)。axis='x'|'y'|'z'、上面(rt)が +軸側
function C(rt, rb, h, seg = 8, axis = 'y', open = false) {
  return gc(`C${rt},${rb},${h},${seg},${axis},${open}`, () => {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
    if (axis === 'x') g.rotateZ(-PI / 2); else if (axis === 'z') g.rotateX(PI / 2);
    return g;
  });
}
// 半球(低分割)
const DOME = (r, seg = 8) => gc(`D${r},${seg}`, () => new THREE.SphereGeometry(r, seg, 3, 0, PI * 2, 0, PI / 2));
const PLANE = (w, h) => gc(`P${w},${h}`, () => new THREE.PlaneGeometry(w, h));

function add(p, g, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  if (rx || ry || rz) o.rotation.set(rx, ry, rz);
  p.add(o);
  return o;
}
function grp(p, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); if (p) p.add(g); return g; }

// ---------- 陣営の配色 ----------
const PAL = {
  guard: { paint: 0xc9974e, dark: 0x6e4c2e, accent: 0xd8682a, metal: 0x5e5850, visor: 0xffb040, tex: 'panelG' },
  zark: { paint: 0x6c8296, dark: 0x3a4654, accent: 0x2fb5a8, metal: 0x4a5058, visor: 0x40f0e0, tex: 'panelZ' },
};
const WEAK_COL = 0xff4a1a;
function kit(o) {
  const fac = o.faction === 'zark' ? 'zark' : 'guard', P = PAL[fac], G = fac === 'guard';
  return {
    fac, P, G,
    paint: mat(o.color ?? P.paint, P.tex, { r: 0.72, m: 0.25 }),
    dark: mat(P.dark, P.tex, { r: 0.8, m: 0.25 }),
    metal: mat(P.metal, 'metal', { r: 0.6, m: 0.5 }),
    black: mat(0x24221f, null, { r: 0.9 }),
    accent: mat(P.accent, null, G ? {} : { e: P.accent, ei: 0.35 }),
    visor: mat(0x101010, null, { e: P.visor, ei: 1.6 }),
    weakGrille: mat(0x3a0c04, null, { e: WEAK_COL, ei: 2.6, em: 'grille' }),
    weakCore: mat(0x401004, null, { e: WEAK_COL, ei: 2.8 }),
    rubber: mat(0x2a2826, null, { r: 0.95 }),
    hub: mat(o.color ?? P.paint, 'hub', { r: 0.7, m: 0.3 }),
    num: o.number ?? (G ? '07' : '21'),
  };
}
// ステンシル(番号/部隊マーク)の板
function decal(p, txt, sty, w, x, y, z, ry) {
  return add(p, PLANE(w, w / 2), mat(0xffffff, ['stencil', txt, sty], { tr: true, decal: true, r: 0.8 }), x, y, z, 0, ry, 0);
}
// 転輪(側面=ゴム、両キャップ=ハブ)
const wheelMats = (k) => [k.rubber, k.hub, k.hub];

// ---------- 履帯ベルト ----------
const TH = 0.08, PITCH = 0.3;
// 円の列 [z,y,r](反時計回り)に外接するベルト。u=周長/リンク長、v=幅
function beltGeo(key, cs, tw) {
  return gc('belt' + key, () => {
    const n = cs.length, tan = [];
    for (let i = 0; i < n; i++) {
      const a = cs[i], b = cs[(i + 1) % n], dz = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dz, dy);
      const ux = dz / d, uy = dy / d, s = (a[2] - b[2]) / d, c = Math.sqrt(1 - s * s);
      tan.push(Math.atan2(-ux * c + uy * s, uy * c + ux * s));
    }
    const P = [];
    for (let i = 0; i < n; i++) {
      const c = cs[i], a0 = tan[(i + n - 1) % n];
      let da = tan[i] - a0; while (da < 0) da += 2 * PI; while (da >= 2 * PI) da -= 2 * PI;
      const seg = Math.max(1, Math.ceil(da / (PI / 7)));
      for (let k = 0; k <= seg; k++) { const a = a0 + da * k / seg, cz = Math.cos(a), cy = Math.sin(a); P.push([c[0] + cz * c[2], c[1] + cy * c[2], cz, cy]); }
    }
    P.push(P[0]);
    const S = [0]; let s = 0;
    for (let k = 1; k < P.length; k++) { s += Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]); S.push(s); }
    const pu = Math.max(1, Math.round(s / PITCH)) / s, hw = tw / 2;
    const pos = [], nor = [], uv = [], idx = [];
    const strip = (fn) => {
      const base = pos.length / 3;
      P.forEach((p, k) => { for (const e of [0, 1]) { const v = fn(p, e); pos.push(v[0], v[1], v[2]); nor.push(v[3], v[4], v[5]); uv.push(S[k] * pu, v[6]); } });
      for (let k = 0; k < P.length - 1; k++) { const a = base + k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    };
    strip((p, e) => [e ? hw : -hw, p[1] + p[3] * TH, p[0] + p[2] * TH, 0, p[3], p[2], e]);
    strip((p, e) => [e ? hw : -hw, p[1], p[0], 0, -p[3], -p[2], e]);
    for (const sx of [1, -1]) strip((p, e) => [sx * hw, p[1] + p[3] * TH * e, p[0] + p[2] * TH * e, sx, 0, 0, e * 0.15]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.userData.pu = pu;
    return g;
  });
}

// 左右の履帯と転輪を作る。戻り値の配列 [左(+X), 右(-X)]
function makeTracks(body, sp, k, own) {
  const { L, th, tw, wr, nw } = sp, zb = L / 2 - 0.9, rs = th * 0.3, ri = th * 0.27;
  const cs = [[-zb, wr + TH, wr], [zb, wr + TH, wr], [L / 2 - ri - TH - 0.02, th - ri - TH, ri], [-(L / 2 - rs - TH), th - rs - TH, rs]];
  const geo = beltGeo(`${L},${th},${tw},${wr}`, cs, tw), x0 = sp.W / 2 - 0.45;
  const wm = wheelMats(k), sides = [];
  for (const sx of [1, -1]) {
    const t = tex('track').clone(); t.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ color: 0x8f8a84, map: t, roughness: 0.85, metalness: 0.35, side: THREE.DoubleSide });
    own.push(t, m);
    const x = sx * x0;
    add(body, geo, m, x, 0, 0);
    const wheels = [];
    for (let i = 0; i < nw; i++) {
      const z = -zb + 2 * zb * i / (nw - 1);
      const w = add(body, C(wr, wr, tw * 0.72, 10, 'x'), wm, x, wr + TH, z); w.userData.r = wr; wheels.push(w);
    }
    for (const c of [cs[2], cs[3]]) { const w = add(body, C(c[2], c[2], tw * 0.8, 8, 'x'), wm, x, c[1], c[0]); w.userData.r = c[2]; wheels.push(w); }
    // 切れた履帯の垂れ下がり片
    const flap = grp(body, x, TH, -L / 2 + 0.2);
    add(flap, B(tw * 0.9, 0.05, 1.5, 1, 1, 0, 0, 1, 1), m, 0, 0, -0.75);
    flap.visible = false;
    sides.push({ tex: t, m, wheels, flap, pu: geo.userData.pu, broken: false });
  }
  return sides;
}
function updTracks(sides, s, dt) {
  sides.forEach((sd, i) => {
    const v = (i ? s.tr : s.tl) || 0;
    sd.tex.offset.x = (sd.tex.offset.x + v * dt * sd.pu) % 1;
    for (const w of sd.wheels) w.rotation.x += v * dt / w.userData.r;
    const br = !!(i ? s.trackBrokenR : s.trackBrokenL);
    if (br !== sd.broken) { sd.broken = br; sd.m.color.setHex(br ? 0x4a3c36 : 0x8f8a84); sd.flap.visible = br; }
    if (br) sd.flap.rotation.x = 0.55 + 0.35 * Math.sin((s.time || 0) * 11 + i * 2);
  });
}

// ---------- 戦車 ----------
const TANK = {
  light: { L: 5.6, W: 3.0, H: 1.6, tw: 0.72, th: 0.95, nw: 5, wr: 0.3, tr: 1.0, th2: 0.62, bl: 3.4, br: 0.075 },
  medium: { L: 6.6, W: 3.6, H: 1.9, tw: 0.8, th: 1.05, nw: 6, wr: 0.34, tr: 1.25, th2: 0.72, bl: 4.0, br: 0.095 },
  heavy: { L: 7.6, W: 4.2, H: 2.6, tw: 0.9, th: 1.25, nw: 7, wr: 0.38, tr: 1.5, th2: 0.85, bl: 4.6, br: 0.115 },
};

// f: { twin, pods, skirts, boat, antenna }
function buildTank(sp, o, f = {}) {
  const k = kit(o), { G } = k, own = [];
  const root = new THREE.Group(), tilt = grp(root), piv = grp(tilt, 0, 0, -sp.L / 2), body = grp(piv, 0, 0, sp.L / 2);
  const { L, W, H, th, tw } = sp;
  const sides = makeTracks(body, sp, k, own);
  const lw = W - 2 * tw - 0.1, uh = H - th, UL = L - 1.2, uz = -0.3;
  // 車体下部
  add(body, B(lw, th - 0.3, L - 0.7, 1, 0.9), k.dark, 0, 0.3, 0);
  let topF;
  if (f.boat) {
    // 舟形車体:履帯の上半分まで覆う、尖った艇首
    const bh = uh + 0.45, bl = L - 0.6;
    add(body, B(W + 0.1, bh, bl, 0.94, 0.92), k.paint, 0, th - 0.45, -0.3);
    add(body, B(W * 0.9, bh, 0.2, 1.05, 6.5, 0, 0.55), k.paint, 0, th - 0.45, bl / 2 - 0.2);
    add(body, B(W + 0.14, 0.12, bl * 0.95), k.accent, 0, th - 0.2, -0.3);
    topF = bl / 2 - 0.3 - 0.2;
  } else {
    const tx = G ? 0.93 : 0.9, tz = G ? 0.78 : 0.7;
    add(body, B(W, uh, UL, tx, tz, 0, -(1 - tz) / 2 * UL), k.paint, 0, th, uz);
    topF = uz + UL / 2 * (2 * tz - 1);
    // 前面下部の板(自軍は採掘機由来の排土板)
    if (G) add(body, B(lw + 0.5, 0.55, 0.18, 1, 1, 0, 0.12), k.metal, 0, 0.35, L / 2 - 0.25, -0.3);
    else add(body, B(lw, 0.5, 0.6, 1, 0.3, 0, -0.2), k.dark, 0, th - 0.5, L / 2 - 0.6);
  }
  // 操縦手のバイザーと視点
  // 視点は砲身の下・やや左に置き、砲塔が回っても砲身と重ならないようにする
  const ex = W * 0.15;
  add(body, B(0.7, 0.16, 0.35, 0.85, 0.7), k.dark, ex, H, topF - 0.3);
  add(body, B(0.55, 0.06, 0.02), k.visor, ex, H + 0.05, topF - 0.12);
  const eye = grp(body, ex, H + 0.2, topF - 0.25);
  // ライト、排気、工具箱、牽引フック
  for (const sx of [1, -1]) {
    add(body, C(0.12, 0.12, 0.12, 6, 'z'), mat(0xffe8b0, null, { e: 0xffd890, ei: G ? 1.2 : 0.2 }), sx * (W / 2 - 0.35), H - 0.05, topF + 0.05);
    add(body, C(0.07, 0.07, 0.25, 5, 'x'), k.metal, sx * 0.5, 0.75, L / 2 - 0.3);
  }
  const rearZ = uz - UL / 2;
  if (G) {
    for (const sx of [1, -1]) {
      add(body, C(0.09, 0.11, 0.9, 6), k.metal, sx * (W / 2 - 0.5), H + 0.2, rearZ + 0.25);
      add(body, C(0.13, 0.09, 0.12, 6), k.black, sx * (W / 2 - 0.5), H + 0.68, rearZ + 0.25);
    }
    add(body, B(0.9, 0.4, 0.5), k.dark, -(W / 2 - 0.6), th, uz + 0.3);
    add(body, B(1.1, 0.06, 0.8), k.dark, W / 4, H, rearZ + 0.7);
  } else {
    for (const sx of [1, -1]) add(body, B(0.5, 0.3, 0.25, 1, 1), k.black, sx * (W / 2 - 0.7), th + 0.2, rearZ - 0.12);
  }
  // サイドスカートと青緑ストライプ(敵軍・重戦車)
  let skirtY = 0;
  if ((f.skirts || !G) && !f.boat) {
    skirtY = th - 0.55;
    for (const sx of [1, -1]) {
      add(body, B(0.08, 0.5, L * 0.78, 1, 1, 0, 0, 1, 1), k.paint, sx * (W / 2 + 0.03), skirtY, -0.1);
      if (!G) add(body, B(0.1, 0.08, L * 0.78), k.accent, sx * (W / 2 + 0.04), skirtY + 0.5, -0.1);
    }
  }
  // 弱点:機関室グリル(敵のみ)
  const weak = [];
  if (!G) {
    const gW = Math.min(W * 0.45, 1.6);
    weak.push(add(body, B(gW, 0.06, 0.9, 1, 1, 0, 0, gW, 0.9), k.weakGrille, 0, H, f.boat ? -L / 2 + 1.2 : rearZ + 0.7));
  }

  // 砲塔
  const tz0 = f.boat ? -0.4 : uz - (G ? 0.05 : 0.1) * L;
  const tur = grp(body, 0, H + 0.08, tz0);
  const r = f.boat ? sp.tr * 0.75 : sp.tr, h2 = f.boat ? sp.th2 * 0.85 : sp.th2;
  add(tur, C(r * 0.9, r * 0.95, 0.12, 8), k.metal, 0, -0.03, 0);
  let gz;
  if (G) {
    // 鋳造風の丸い砲塔
    add(tur, C(r * 0.86, r, h2, 8), k.paint, 0, h2 / 2, 0);
    add(tur, DOME(r * 0.86), k.paint, 0, h2, 0).scale.y = 0.42;
    add(tur, B(r * 1.25, h2 * 0.75, r * 0.9, 0.95, 0.9), k.paint, 0, 0.08, -r * 0.95);
    for (const sx of [1, -1]) {
      add(tur, B(0.06, h2 * 0.55, r * 0.6), k.dark, sx * r * 0.93, h2 * 0.18, r * 0.25, 0, sx * 0.35, 0);
      add(tur, B(0.35, 0.3, r * 0.7), k.dark, sx * r * 0.75, 0.15, -r * 1.05);
      decal(tur, k.num, 'g', 0.75, sx * (r * 0.97), h2 * 0.5, -r * 0.3, sx * (PI / 2 + 0.2));
      for (let i = 0; i < 2; i++) add(tur, C(0.06, 0.06, 0.3, 5, 'z'), k.black, sx * r * 0.7, h2 * 0.75 + i * 0.13, r * 0.5, -0.3, sx * 0.4, 0);
    }
    gz = r * 0.82;
  } else {
    // 角ばった楔形砲塔
    add(tur, B(2 * r, h2, 2.3 * r, 0.74, 0.62, 0, -0.22 * r), k.paint, 0, 0, -0.15 * r);
    add(tur, B(1.3 * r, h2 * 0.8, 0.7 * r, 0.8, 0.5, 0, -0.15 * r), k.dark, 0, 0.05, -1.45 * r);
    add(tur, B(0.5, 0.3, 0.45, 0.8, 0.7), k.dark, -r * 0.45, h2, -0.2 * r);
    add(tur, B(0.3, 0.12, 0.04), k.visor, -r * 0.45, h2 + 0.1, 0.03);
    for (const sx of [1, -1]) {
      const ang = Math.atan2(r * 0.26, h2);
      decal(tur, k.num, 'z', 0.8, sx * (r * 0.875 + 0.03), h2 * 0.48, -0.35 * r, 0).rotation.set(-ang, sx * PI / 2, 0, 'YXZ');
      add(tur, B(0.04, 0.09, 1.6 * r), k.accent, sx * (r * 0.948 + 0.01), h2 * 0.2, -0.2 * r, 0, 0, sx * ang);
    }
    gz = r * 0.9;
  }
  // ハッチ(頭出し位置)
  add(tur, C(0.3, 0.34, 0.22, 8), k.dark, r * 0.3, h2 + (G ? 0.25 : 0.08), -r * 0.25);
  const hatch = grp(tur, r * 0.3, h2 + (G ? 0.5 : 0.35), -r * 0.25);
  // アンテナ
  const antH = f.antenna ? 3.4 : 1.8;
  add(tur, C(0.015, 0.025, antH, 3), k.black, -r * 0.6, h2 + antH / 2, -r * 0.9);
  if (f.antenna) add(tur, C(0.35, 0.05, 0.12, 8), k.metal, -r * 0.6, h2 + antH, -r * 0.9);

  // 砲
  const gun = grp(tur, 0, h2 * 0.5, gz);
  add(gun, C(h2 * 0.36, h2 * 0.42, 0.5, 8, 'z'), k.dark, 0, 0, 0.1);
  const bar = grp(gun);
  const { bl, br } = sp;
  const barX = f.twin ? [0.22, -0.22] : [0];
  let muzzle;
  for (const bx of barX) {
    add(bar, C(br, br * 1.25, bl, 8, 'z'), k.metal, bx, 0, bl / 2 + 0.2);
    add(bar, C(br * 1.6, br * 1.6, bl * 0.12, 8, 'z'), k.metal, bx, 0, bl * 0.55);
    add(bar, C(br * 1.7, br * 1.7, 0.32, 6, 'z'), k.dark, bx, 0, bl + 0.12);
    const m = grp(bar, bx, 0, bl + 0.32); if (!muzzle) muzzle = m;
  }
  // ミサイルポッド(指揮戦車)
  let muzzle2;
  if (f.pods) {
    for (const sx of [1, -1]) {
      const px = sx * (r + 0.4);
      add(gun, B(0.6, 0.6, 1.2, 1, 1, 0, 0, 1, 1), k.dark, px, -0.3, -0.2);
      add(gun, B(0.06, 0.32, 0.3), k.metal, sx * (r + 0.07), -0.25, -0.2);
      for (let i = 0; i < 4; i++) add(gun, C(0.08, 0.08, 0.06, 6, 'z'), k.weakCore, px + ((i & 1) - 0.5) * 0.26, -0.15 + ((i >> 1) - 0.5) * 0.26, 0.42);
      if (sx < 0) muzzle2 = grp(gun, px, 0, 0.5);
    }
  }

  const dispose = () => own.forEach((x) => x.dispose());
  return {
    root, muzzle, muzzle2, eye, hatch, weak, dispose,
    update(s) {
      const dt = s.dt || 0;
      updTracks(sides, s, dt);
      tur.rotation.y = s.turret || 0;
      gun.rotation.x = -(s.gunPitch || 0);
      bar.position.z = -(s.recoil || 0) * bl * 0.09;
      tilt.rotation.x = -(s.pitch || 0);
      tilt.rotation.z = s.roll || 0;
      piv.rotation.x = -(s.wheelie || 0) * 0.66;
      if (f.boat) tilt.position.y = -(1 - (s.rise ?? 1)) * (H + 0.8);
    },
  };
}

// ---------- 歩行メカ(足裏の車輪で滑走) ----------
function buildMech(o) {
  const k = kit(o), { G } = k, own = [];
  const root = new THREE.Group(), tilt = grp(root), body = grp(tilt);
  const HIP = 3.0, A = 1.65, BL = 1.7, ANK = 0.85;
  const pelvis = grp(body, 0, HIP, 0);
  add(pelvis, B(1.9, 0.7, 1.3, 0.85, 0.85), k.dark, 0, -0.45, 0);
  // 脚
  const legs = [];
  for (const sx of [1, -1]) {
    const hip = grp(pelvis, sx * 1.05, -0.2, 0);
    add(hip, C(0.38, 0.38, 0.6, 8, 'x'), k.metal, 0, 0, 0);
    add(hip, B(0.75, A, 0.85, 0.85, 0.9), k.paint, 0, -A, 0);
    const knee = grp(hip, 0, -A, 0);
    add(knee, C(0.36, 0.36, 0.85, 8, 'x'), k.dark, 0, 0, 0.05);
    add(knee, B(0.85, BL, 1.0, 0.82, 0.85), k.paint, 0, -BL, 0);
    add(knee, C(0.07, 0.07, BL * 0.8, 6), k.metal, sx * 0.2, -BL * 0.5, -0.58);
    add(knee, B(0.9, 0.5, 0.15, 0.9, 1), G ? k.dark : k.accent, 0, -0.6, 0.48);
    const ank = grp(knee, 0, -BL, 0);
    add(ank, C(0.28, 0.28, 0.6, 8, 'x'), k.metal);
    add(ank, B(1.0, 0.45, 1.9, 0.85, 0.75, 0, 0.1), k.dark, 0, -0.55, 0.15);
    add(ank, B(1.1, 0.12, 0.3, 1, 1), k.metal, 0, -0.62, 1.1);
    const wheels = [];
    for (const wz of [0.75, -0.45]) { const w = add(ank, C(0.3, 0.3, 0.4, 10, 'x'), wheelMats(k), 0, -ANK + 0.3, wz); w.userData.r = 0.3; wheels.push(w); }
    legs.push({ hip, knee, ank, wheels });
  }
  // 上半身(砲塔として旋回)
  const torso = grp(pelvis, 0, 0, 0);
  add(torso, C(0.8, 0.9, 0.5, 8), k.metal, 0, 0.15, 0);
  add(torso, B(3.0, 1.9, 2.3, 0.86, 0.78, 0, -0.08), k.paint, 0, 0.3, 0);
  add(torso, B(2.4, 0.9, 0.5, 0.9, 0.6), k.dark, 0, 0.6, 1.15);
  add(torso, B(1.8, 1.3, 0.9, 0.9, 0.9), k.dark, 0, 0.45, -1.45);
  for (const sx of [1, -1]) {
    add(torso, C(0.14, 0.16, 1.1, 6), k.metal, sx * 0.6, 1.9, -1.6);
    decal(torso, k.num, G ? 'g' : 'z', 0.8, sx * 1.42, 1.1, -0.2, sx * PI / 2);
  }
  // 頭部センサー
  add(torso, B(0.95, 0.65, 1.05, 0.8, 0.7, 0, -0.08), k.paint, 0, 2.2, 0.35);
  add(torso, B(0.7, 0.16, 0.06), k.visor, 0, 2.48, 0.88);
  add(torso, C(0.02, 0.02, 1.2, 3), k.black, 0.3, 3.3, 0.1);
  const eye = grp(torso, 0, 2.5, 0.6);
  const hatch = grp(torso, 0, 2.95, 0);
  // 肩
  for (const sx of [1, -1]) {
    if (G) add(torso, DOME(0.75), k.paint, sx * 1.75, 1.65, 0).scale.y = 0.7;
    else add(torso, B(1.0, 0.6, 1.3, 0.6, 0.7, sx * 0.15), k.paint, sx * 1.75, 1.45, 0);
  }
  // 右腕:アームキャノン(-X)
  const arm = grp(torso, -1.95, 1.3, 0);
  add(arm, B(0.65, 0.7, 1.3, 1, 1), k.dark, 0, -0.35, 0.2);
  const can = grp(arm);
  add(can, C(0.17, 0.22, 3.0, 8, 'z'), k.metal, 0, 0, 1.9);
  add(can, C(0.3, 0.3, 0.6, 8, 'z'), k.dark, 0, 0, 0.9);
  add(can, C(0.26, 0.26, 0.35, 6, 'z'), k.dark, 0, 0, 3.4);
  const muzzle = grp(can, 0, 0, 3.6);
  // 左腕と肩ミサイル(+X)
  const larm = grp(torso, 1.95, 1.3, 0);
  add(larm, B(0.6, 1.6, 0.7, 0.9, 1), k.dark, 0, -1.6, 0.1);
  add(larm, B(0.75, 0.6, 0.8), k.paint, 0, -2.1, 0.15);
  add(torso, B(1.2, 0.9, 1.5, 1, 1, 0, 0, 1, 1), k.dark, 1.3, 2.0, -0.2);
  for (let i = 0; i < 6; i++) add(torso, C(0.1, 0.1, 0.05, 6, 'z'), k.weakCore, 1.3 + ((i % 3) - 1) * 0.32, 2.25 + ((i / 3) | 0) * 0.36, 0.56);
  const muzzle2 = grp(torso, 1.3, 2.45, 0.6);
  const weak = [];
  if (!G) weak.push(add(torso, B(1.2, 0.8, 0.06, 1, 1, 0, 0, 1.2, 0.8), k.weakGrille, 0, 0.7, -1.92));

  let ph = 0;
  const ik = (L, dy, dz) => {
    const d = Math.min(Math.hypot(dy, dz), A + BL - 0.001), phi = Math.atan2(dz, -dy);
    const al = Math.acos(clamp((A * A + d * d - BL * BL) / (2 * A * d), -1, 1));
    const be = Math.acos(clamp((A * A + BL * BL - d * d) / (2 * A * BL), -1, 1));
    L.hip.rotation.x = -(phi + al); L.knee.rotation.x = PI - be; L.ank.rotation.x = -(L.hip.rotation.x + L.knee.rotation.x);
  };
  const upd = (s) => {
    const dt = s.dt || 0, tl = s.tl || 0, tr = s.tr || 0, v = (tl + tr) / 2, turn = (tr - tl) / 2;
    const amp = Math.min(1, Math.abs(v) / 5 + Math.abs(turn) / 5);
    ph += dt * 2 * PI * (Math.abs(v) * 0.22 + Math.abs(turn) * 0.15);
    const cr = s.crouch || 0, bob = Math.abs(Math.sin(ph)) * 0.12 * amp;
    pelvis.position.y = HIP * (1 - 0.4 * cr) - bob;
    const hipY = pelvis.position.y - 0.2, dir = v < -0.1 ? -1 : 1;
    legs.forEach((L, i) => {
      const p = ph + i * PI, sx = i ? -1 : 1;
      const fz = Math.sin(p) * 0.55 * amp * dir - sx * clamp(turn * 0.08, -0.4, 0.4);
      const lift = Math.max(0, Math.cos(p)) * 0.18 * amp;
      ik(L, ANK + lift - hipY, fz);
      const wv = i ? tr : tl;
      for (const w of L.wheels) w.rotation.x += wv * dt / 0.3;
    });
    body.rotation.x = 0.06 * clamp(v / 8, -1, 1) - (s.wheelie || 0) * 0.22;
    body.rotation.z = Math.sin(ph) * 0.03 * amp + clamp(turn * 0.01, -0.06, 0.06);
    torso.rotation.y = s.turret || 0;
    arm.rotation.x = -(s.gunPitch || 0);
    can.position.z = -(s.recoil || 0) * 0.35;
    tilt.rotation.x = -(s.pitch || 0); tilt.rotation.z = s.roll || 0;
  };
  upd({});
  return { root, muzzle, muzzle2, eye, hatch, weak, update: upd, dispose: () => own.forEach((x) => x.dispose()) };
}

export function buildVehicle(kind, opts = {}) {
  if (kind === 'mech') return buildMech(opts);
  const sp = TANK[kind] || TANK.medium;
  return buildTank(sp, opts, kind === 'heavy' ? { skirts: true } : {});
}

// ---------- 装輪車(偵察車・トラック) ----------
function buildWheeled(type, o) {
  const k = kit({ faction: 'zark', ...o });
  const root = new THREE.Group(), tilt = grp(root), body = grp(tilt);
  const truck = type === 'truck';
  const r = truck ? 0.55 : 0.5, Wd = truck ? 2.6 : 2.5, zs = truck ? [2.6, -1.3, -2.6] : [1.45, -1.45];
  const wheels = [], steer = [];
  for (const z of zs) for (const sx of [1, -1]) {
    const sg = grp(body, sx * (Wd / 2 - 0.22), r, z);
    const w = add(sg, C(r, r, 0.42, 10, 'x'), wheelMats(k)); wheels.push(w);
    if (z === zs[0]) steer.push(sg);
  }
  const weak = [];
  let tur = null, gun = null, muzzle;
  if (truck) {
    const cargo = mat(0x8a8466, 'concrete', { r: 0.95 });
    add(body, B(1.6, 0.35, 7.6), k.metal, 0, 0.5, 0);
    add(body, B(2.5, 1.6, 1.8, 0.95, 0.85, 0, -0.1), k.paint, 0, 0.85, 2.6);
    add(body, B(2.2, 0.55, 0.05), mat(0x1a2430, null, { r: 0.2, m: 0.6 }), 0, 1.75, 3.45, -0.25);
    add(body, B(2.3, 0.9, 0.8, 0.95, 0.75, 0, -0.08), k.paint, 0, 0.85, 3.7);
    add(body, B(1.6, 0.4, 0.05), k.black, 0, 1.0, 4.1);
    add(body, B(2.6, 0.25, 5.2), k.dark, 0, 0.85, -1.1);
    for (const sx of [1, -1]) add(body, B(0.1, 0.6, 5.2), k.dark, sx * 1.25, 1.1, -1.1);
    add(body, B(2.4, 1.4, 4.6, 0.9, 0.96), cargo, 0, 1.1, -1.2);
    add(body, B(1.1, 0.8, 1.1), mat(0xa08860, 'crate'), 0.6, 1.1, 1.0);
    add(body, B(2.5, 0.3, 0.12, 1, 1, 0, 0, 1, 0.3), mat(0xffffff, 'hazard'), 0, 0.55, -3.85);
    for (const sx of [1, -1]) add(body, B(0.8, 0.12, 1.4), k.dark, sx * 1.1, r + 0.55, 2.6);
    muzzle = grp(body, 0, 1.5, 0);
  } else {
    add(body, B(2.0, 0.6, 4.4, 1, 0.9), k.dark, 0, 0.45, 0);
    add(body, B(2.5, 0.8, 4.0, 0.82, 0.62, 0, -0.35), k.paint, 0, 1.0, -0.1);
    add(body, B(2.3, 0.55, 0.9, 0.9, 0.25, 0, -0.32), k.paint, 0, 0.6, 2.3);
    for (const z of zs) for (const sx of [1, -1]) add(body, B(0.55, 0.1, 1.3), k.paint, sx * (Wd / 2 - 0.22), r + 0.55, z);
    for (const sx of [1, -1]) add(body, B(0.08, 0.1, 3.4), k.accent, sx * 1.22, 1.1, 0);
    add(body, C(0.42, 0.42, 0.3, 10, 'z'), wheelMats(k), 0, 1.25, -2.2);
    add(body, C(0.015, 0.02, 2.0, 3), k.black, 0.8, 2.6, -1.5);
    decal(body, k.num, 'z', 0.7, 1.13, 1.3, 0.6, PI / 2 - 0.25);
    weak.push(add(body, B(1.0, 0.05, 0.7, 1, 1, 0, 0, 1, 0.7), k.weakGrille, 0, 1.8, -1.3));
    tur = grp(body, 0, 1.8, 0.2);
    add(tur, B(1.0, 0.45, 1.2, 0.75, 0.65, 0, -0.1), k.paint);
    gun = grp(tur, 0, 0.25, 0.45);
    add(gun, C(0.04, 0.06, 1.3, 5, 'z'), k.metal, 0, 0, 0.6);
    add(gun, B(0.25, 0.25, 0.4), k.dark, 0, -0.12, 0);
    muzzle = grp(gun, 0, 0, 1.3);
  }
  for (const sx of [1, -1]) add(body, C(0.1, 0.1, 0.08, 6, 'z'), mat(0xffe8b0, null, { e: 0xffd890, ei: 0.4 }), sx * 0.8, truck ? 1.25 : 0.9, truck ? 4.1 : 2.75);
  return {
    root, muzzle, weak, dispose() {},
    update(s) {
      const dt = s.dt || 0, v = ((s.tl || 0) + (s.tr || 0)) / 2;
      for (const w of wheels) w.rotation.x += v * dt / r;
      for (const g of steer) g.rotation.y = clamp(((s.tr || 0) - (s.tl || 0)) * 0.12, -0.45, 0.45);
      if (tur) tur.rotation.y = s.turret || 0;
      if (gun) gun.rotation.x = -(s.gunPitch || 0);
      tilt.rotation.x = -(s.pitch || 0); tilt.rotation.z = s.roll || 0;
    },
  };
}

// ---------- 固定・特殊ユニット ----------
const TEAM_COL = { '-1': 0xd8d8d8, 0: 0xff8a2a, 1: 0x3a9cff };

function buildTurret8(o) {
  const k = kit({ faction: 'zark', ...o });
  const root = new THREE.Group();
  add(root, C(2.6, 3.0, 1.0, 8), mat(0x8a8c8e, 'concrete'), 0, 0.5, 0);
  const head = grp(root, 0, 1.0, 0);
  add(head, C(1.8, 2.1, 0.8, 8), k.paint, 0, 0.4, 0);
  add(head, DOME(1.8), k.paint, 0, 0.8, 0).scale.y = 0.35;
  const bars = [];
  let muzzle;
  for (let i = 0; i < 8; i++) {
    const g = grp(head, 0, 0.45, 0); g.rotation.y = i * PI / 4;
    const b = grp(g);
    add(b, C(0.1, 0.13, 1.6, 6, 'z'), k.metal, 0, 0, 2.5);
    add(b, B(0.4, 0.4, 0.4), k.dark, 0, -0.2, 1.75);
    const m = grp(b, 0, 0, 3.3); if (!muzzle) muzzle = m;
    bars.push(b);
  }
  const weak = [add(head, C(0.45, 0.5, 0.3, 8), k.weakCore, 0, 1.45, 0)];
  add(head, B(0.1, 0.1, 1.5), k.accent, 0, 0.82, 1.0);
  return {
    root, muzzle, weak, dispose() {},
    update(s) { head.rotation.y = s.turret || 0; const rc = -(s.recoil || 0) * 0.3; for (const b of bars) b.position.z = rc; },
  };
}

function buildBigTurret(o) {
  const k = kit({ faction: 'zark', ...o });
  const root = new THREE.Group();
  add(root, B(6, 2.0, 6, 0.8, 0.8), mat(0x8a8a88, 'concrete'), 0, 0, 0);
  for (const sx of [1, -1]) add(root, B(6.02, 0.3, 0.1, 0.8, 1, 0, 0, 1, 0.3), mat(0xffffff, 'hazard'), 0, 0.2, sx * 3.0);
  add(root, C(2.4, 2.6, 0.5, 10), k.metal, 0, 2.25, 0);
  const tur = grp(root, 0, 2.5, 0);
  add(tur, B(4.2, 1.8, 5.0, 0.75, 0.7, 0, -0.3), k.paint, 0, 0, 0);
  add(tur, B(3.0, 1.4, 1.4, 0.85, 0.8), k.dark, 0, 0.1, -2.6);
  add(tur, B(0.8, 0.5, 0.8), k.dark, 1.2, 1.8, -0.6);
  add(tur, B(0.6, 0.14, 0.05), k.visor, 1.2, 2.05, -0.18);
  for (const sx of [1, -1]) add(tur, B(0.06, 0.15, 4.0), k.accent, sx * 2.0, 0.7, 0, 0, 0, sx * 0.25);
  // 背面の弱点コア
  const core = add(tur, C(0.75, 0.75, 0.4, 10, 'z'), k.weakCore, 0, 0.85, -3.35);
  for (let i = 0; i < 3; i++) add(tur, B(1.7, 0.08, 0.08), k.metal, 0, 0.5 + i * 0.35, -3.6);
  const gun = grp(tur, 0, 0.9, 2.3);
  add(gun, B(2.4, 1.1, 0.9, 0.9, 0.9), k.dark, 0, -0.55, 0);
  const bar = grp(gun);
  const ms = [];
  for (const sx of [1, -1]) {
    add(bar, C(0.18, 0.24, 6.0, 8, 'z'), k.metal, sx * 0.7, 0, 3.4);
    add(bar, C(0.34, 0.34, 0.6, 8, 'z'), k.dark, sx * 0.7, 0, 6.3);
    ms.push(grp(bar, sx * 0.7, 0, 6.6));
  }
  return {
    root, muzzle: ms[0], muzzle2: ms[1], weak: [core], dispose() {},
    update(s) { tur.rotation.y = s.turret || 0; gun.rotation.x = -(s.gunPitch || 0); bar.position.z = -(s.recoil || 0) * 0.6; },
  };
}

function buildLauncher(o) {
  const k = kit({ faction: 'zark', ...o });
  const root = new THREE.Group(), wallM = mat(0x8e8c88, 'concrete'), hz = mat(0xffffff, 'hazard');
  for (let i = 0; i < 4; i++) {
    const g = grp(root); g.rotation.y = i * PI / 2;
    add(g, B(7.0, 3.0, 0.6, 1, 1, 0, 0.12), wallM, 0, 0, 3.2);
    add(g, B(7.0, 0.35, 0.05, 1, 1, 0, 0, 1, 0.35), hz, 0, 2.5, 3.51);
  }
  add(root, B(6.4, 0.05, 6.4), mat(0x2a2826, 'metal'), 0, 0.01, 0);
  const lift = grp(root);
  add(lift, B(4.4, 0.4, 4.4), k.dark, 0, 0, 0);
  const rail = grp(lift, 0, 0.4, -1.2); rail.rotation.x = -0.9;
  for (const sx of [1, -1]) add(rail, B(0.25, 0.3, 6.0, 1, 1, 0, 0, 1, 1), k.metal, sx * 0.55, 0, 2.8);
  add(rail, C(0.38, 0.38, 4.6, 8, 'z'), k.paint, 0, 0.6, 2.8);
  add(rail, C(0.02, 0.38, 1.0, 8, 'z'), k.weakCore, 0, 0.6, 5.6);
  for (let i = 0; i < 4; i++) add(rail, B(0.06, 0.75, 0.8), k.dark, 0, 0.6, 0.9, 0, 0, i * PI / 2 + PI / 4);
  add(rail, C(0.3, 0.2, 0.2, 8, 'z'), mat(0x200800, null, { e: 0xffa040, ei: 2 }), 0, 0.6, 0.4);
  const weak = [add(lift, B(1.0, 0.6, 1.0), k.weakCore, 1.4, 0.4, 1.3)];
  const muzzle = grp(rail, 0, 0.6, 6.2);
  return {
    root, muzzle, weak, dispose() {},
    update(s) { const rs = s.rise ?? 1; lift.position.y = -3.4 * (1 - rs); lift.visible = rs > 0.02; },
  };
}

function buildMine() {
  const root = new THREE.Group(), pop = grp(root);
  const m = mat(0x3c3a36, 'metal', { m: 0.5 });
  add(pop, C(0.48, 0.55, 0.2, 10), m, 0, 0.1, 0);
  add(pop, C(0.25, 0.4, 0.12, 10), mat(0x5a5650, 'metal'), 0, 0.26, 0);
  const sp = gc('spike', () => new THREE.ConeGeometry(0.06, 0.32, 4));
  for (let i = 0; i < 6; i++) { const a = i * PI / 3, s = add(pop, sp, m, Math.cos(a) * 0.5, 0.22, Math.sin(a) * 0.5); s.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9); }
  const on = add(pop, C(0.08, 0.08, 0.1, 6), mat(0xff2010, null, { basic: true }), 0, 0.37, 0);
  const off = add(pop, C(0.08, 0.08, 0.1, 6), mat(0x501010, null), 0, 0.37, 0);
  const muzzle = grp(pop, 0, 0.3, 0);
  return {
    root, muzzle, weak: [], dispose() {},
    update(s) {
      const p = s.popped || 0;
      pop.position.y = -0.3 + p * 0.65;
      const b = ((s.time || 0) * (p > 0.5 ? 6 : 1.5)) % 1 < 0.5;
      on.visible = b; off.visible = !b;
    },
  };
}

function buildSkyFortress(o) {
  // 原点=船体中心(呼び出し側が高度を設定)
  const k = kit({ faction: 'zark', ...o });
  const root = new THREE.Group(), hull = grp(root);
  add(hull, B(7, 3.6, 22, 0.75, 0.85, 0, 0, 3, 3), k.paint, 0, -1.8, 0);
  add(hull, B(5.2, 2.6, 4, 0.6, 0.3, 0, -1.2), k.paint, 0, -1.4, 12.5);
  add(hull, B(3.2, 1.6, 5, 0.8, 0.7, 0, -0.4), k.dark, 0, 1.8, 3.5);
  add(hull, B(2.6, 0.3, 0.05), k.visor, 0, 2.7, 6.05);
  add(hull, B(0.15, 0.2, 18), k.accent, 3.0, 0.3, 0, 0, 0, 0.3);
  add(hull, B(0.15, 0.2, 18), k.accent, -3.0, 0.3, 0, 0, 0, -0.3);
  decal(hull, k.num, 'z', 2.2, 3.5, -0.4, -4, PI / 2);
  decal(hull, k.num, 'z', 2.2, -3.5, -0.4, -4, -PI / 2);
  // 揚力ファン×4
  const blades = [];
  for (const fz of [4.5, -7]) {
    add(hull, B(15, 0.5, 2.6, 1, 1, 0, 0, 3, 3), k.dark, 0, -0.2, fz);
    for (const sx of [1, -1]) {
      const fx = sx * 7.2;
      add(hull, C(2.1, 2.1, 0.9, 12, 'y', true), mat(PAL.zark.paint, 'panelZ', { ds: true }), fx, 0, fz);
      add(hull, C(0.4, 0.4, 0.5, 8), k.metal, fx, 0, fz);
      const bl = grp(hull, fx, 0.05, fz);
      add(bl, B(3.8, 0.06, 0.4), k.black); add(bl, B(0.4, 0.06, 3.8), k.black);
      blades.push(bl);
    }
  }
  // 爆弾倉と下部の弱点コア
  add(hull, B(2.6, 0.2, 4), k.black, 0, -1.95, -0.5);
  for (const sx of [1, -1]) add(hull, B(1.3, 0.08, 4), k.dark, sx * 1.9, -2.0, -0.5, 0, 0, sx * 0.6);
  const core = add(hull, C(1.2, 0.9, 0.7, 12), k.weakCore, 0, -2.1, -6.5);
  add(hull, C(1.6, 1.6, 0.3, 12), k.metal, 0, -1.85, -6.5);
  // 機首下の機銃とエンジン
  const chin = grp(hull, 0, -2.0, 10);
  add(chin, C(0.5, 0.5, 0.5, 8), k.dark);
  add(chin, C(0.08, 0.1, 1.6, 6, 'z'), k.metal, 0, -0.1, 0.9);
  const muzzle2 = grp(chin, 0, -0.1, 1.7);
  for (const sx of [1, -1]) {
    add(hull, C(0.9, 1.0, 2.6, 8, 'z'), k.dark, sx * 2.2, -0.4, -11.5);
    add(hull, C(0.7, 0.7, 0.1, 8, 'z'), mat(0x200800, null, { e: 0x40c0ff, ei: 2 }), sx * 2.2, -0.4, -12.85);
  }
  const muzzle = grp(hull, 0, -2.2, -0.5);
  return {
    root, muzzle, muzzle2, weak: [core], dispose() {},
    update(s) {
      const t = s.time || 0;
      blades.forEach((b, i) => { b.rotation.y = t * (i & 1 ? -14 : 14); });
      hull.position.y = Math.sin(t * 1.3) * 0.25;
      hull.rotation.x = -(s.pitch || 0); hull.rotation.z = (s.roll || 0) + Math.sin(t * 0.9) * 0.02;
      chin.rotation.y = s.turret || 0;
    },
  };
}

function buildTarget() {
  const root = new THREE.Group(), wood = mat(0xb08a5c, 'crate'), steel = mat(0x6a6660, 'metal');
  for (const sx of [1, -1]) { add(root, C(0.1, 0.12, 3.0, 6), wood, sx * 1.2, 1.5, -0.1); add(root, B(0.5, 0.3, 0.5), steel, sx * 1.2, 0, -0.1); }
  const be = mat(0xffffff, 'bullseye', { r: 0.9 });
  add(root, C(1.35, 1.35, 0.12, 16, 'z'), [wood, be, be], 0, 1.75, 0);
  add(root, B(2.8, 0.15, 0.2), steel, 0, 0.35, -0.1);
  return { root, muzzle: grp(root, 0, 1.75, 0), weak: [], dispose() {}, update() {} };
}

function buildFlag(o) {
  const team = o.team === 1 ? 1 : 0, root = new THREE.Group();
  add(root, C(0.06, 0.07, 6, 6), mat(0xb0b0b0, 'metal', { m: 0.6 }), 0, 3, 0);
  add(root, C(0.4, 0.5, 0.25, 8), mat(0x4a4844, 'metal'), 0, 0.12, 0);
  add(root, C(0.12, 0.12, 0.12, 6), mat(TEAM_COL[team], null, { e: TEAM_COL[team], ei: 1.5 }), 0, 6.05, 0);
  const geo = new THREE.PlaneGeometry(2.0, 1.3, 8, 1), base = geo.attributes.position.array.slice();
  const cloth = add(root, geo, mat(0xffffff, ['flag', team], { ds: true, flat: false, r: 0.9 }), 1.02, 5.25, 0);
  const pos = geo.attributes.position;
  return {
    root, muzzle: grp(root, 0, 3, 0), weak: [],
    dispose() { geo.dispose(); },
    update(s) {
      const t = s.time || 0;
      for (let i = 0; i < pos.count; i++) { const x = base[i * 3] + 1; pos.array[i * 3 + 2] = Math.sin(t * 5 - x * 2.2) * 0.14 * x; }
      pos.needsUpdate = true;
      cloth.rotation.y = Math.sin(t * 0.7) * 0.15;
    },
  };
}

function buildCapturePoint(o) {
  const root = new THREE.Group();
  const ring = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const disc = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false });
  const lamp = new THREE.MeshStandardMaterial({ color: 0x202020, emissive: 0xffffff, emissiveIntensity: 2 });
  const rg = new THREE.RingGeometry(7.6, 8, 48); rg.rotateX(-PI / 2);
  const dg = new THREE.CircleGeometry(7.6, 48); dg.rotateX(-PI / 2);
  add(root, rg, ring, 0, 0.06, 0).renderOrder = 5;
  add(root, dg, disc, 0, 0.04, 0).renderOrder = 4;
  const steel = mat(0x5a5854, 'metal');
  add(root, C(0.15, 0.22, 6, 8), steel, 0, 3, 0);
  add(root, C(0.9, 1.1, 0.4, 8), steel, 0, 0.2, 0);
  add(root, C(0.4, 0.4, 0.6, 8), lamp, 0, 6.2, 0);
  for (let i = 0; i < 8; i++) { const a = i * PI / 4; add(root, B(0.3, 0.6, 0.3), mat(0xffffff, 'hazard'), Math.cos(a) * 8.3, 0, Math.sin(a) * 8.3); }
  let cur = null;
  const setTeam = (t) => {
    if (t === cur) return; cur = t;
    const c = TEAM_COL[t] ?? TEAM_COL[-1];
    ring.color.setHex(c); disc.color.setHex(c); lamp.emissive.setHex(c);
  };
  setTeam(o.team ?? -1);
  return {
    root, muzzle: grp(root, 0, 3, 0), weak: [], setTeam,
    dispose() { ring.dispose(); disc.dispose(); lamp.dispose(); rg.dispose(); dg.dispose(); },
    update(s) {
      if (s.team !== undefined) setTeam(s.team);
      const t = s.time || 0;
      lamp.emissiveIntensity = 1.5 + Math.sin(t * 4) * 0.8;
      disc.opacity = 0.1 + Math.sin(t * 2) * 0.04;
    },
  };
}

export function buildUnit(type, opts = {}) {
  const z = { faction: 'zark', ...opts };
  switch (type) {
    case 'lightTank': return buildTank({ ...TANK.light, L: 5.5, tr: 0.9, bl: 3.0, br: 0.065 }, z, { twin: true, skirts: true });
    case 'heavyTank': return buildTank({ ...TANK.heavy, L: 8.0, W: 4.4, nw: 8, bl: 5.0, br: 0.13 }, z, { skirts: true });
    case 'commandTank': return buildTank({ ...TANK.medium, L: 7.0, nw: 6 }, z, { pods: true, antenna: true, skirts: true });
    case 'amphib': return buildTank({ ...TANK.medium, L: 6.5, W: 3.4, H: 1.8, th: 0.9, wr: 0.3 }, z, { boat: true });
    case 'scout': case 'truck': return buildWheeled(type, z);
    case 'turret8': return buildTurret8(z);
    case 'bigTurret': return buildBigTurret(z);
    case 'launcher': return buildLauncher(z);
    case 'mine': return buildMine(z);
    case 'skyFortress': return buildSkyFortress(z);
    case 'target': return buildTarget(z);
    case 'flag': return buildFlag(opts);
    case 'capturePoint': return buildCapturePoint(opts);
    default: return buildTank(TANK.medium, z);
  }
}

// ---------- 障害物 ----------
const THEME = {
  1: { soil: 0x9a7a4e, conc: 0xc9c0a8, accent: 0xc8a040, leaf: 0x6f8f3a, wall: 0xd8ccb0, roof: 0xa0503a, metal: 0x8a8070 },
  2: { soil: 0x6a6a6a, conc: 0xb0b4b8, accent: 0x4a6a90, leaf: 0x5a7a50, wall: 0xb8bcc4, roof: 0x50545c, metal: 0x7a8490 },
  3: { soil: 0x6e5a40, conc: 0xbcbcb0, accent: 0x7ab0d0, leaf: 0x4f9a40, wall: 0xe0dccc, roof: 0x5a6f88, metal: 0x80888a },
  4: { soil: 0x5a524c, conc: 0x8a8684, accent: 0xb02a20, leaf: 0x506040, wall: 0x7a7672, roof: 0x4a4442, metal: 0x6e6a66 },
};
// ゴツゴツした塊(正規化:x,z∈[-1,1], y∈[0,1])
function lumpGeo(v) {
  return gc('lump' + v, () => {
    const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, r = rng(v * 131 + 7), J = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = [p.getX(i), p.getY(i), p.getZ(i)].map((a) => a.toFixed(3)).join();
      if (!J.has(key)) J.set(key, 0.75 + r() * 0.4);
      const s = J.get(key);
      p.setXYZ(i, p.getX(i) * s, Math.max(p.getY(i) * s, -0.35), p.getZ(i) * s);
    }
    g.computeBoundingBox();
    const bb = g.boundingBox;
    g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    g.scale(2 / (bb.max.x - bb.min.x), 1 / (bb.max.y - bb.min.y), 2 / (bb.max.z - bb.min.z));
    g.computeVertexNormals();
    return g;
  });
}
const hashSz = (w, d, h) => ((w * 73 + d * 151 + h * 37) * 10) | 0;

export function buildProp(kind, size = {}, theme = 1) {
  const T = THEME[theme] || THEME[1];
  const w = size.w ?? (size.r ?? 1) * 2, d = size.d ?? (size.r ?? 1) * 2, h = size.h ?? (size.r ?? 1) * (kind === 'wreck' ? 0.7 : 1.5);
  const hs = hashSz(w, d, h), root = new THREE.Group();
  const conc = mat(T.conc, 'concrete'), metal = mat(T.metal, 'metal', { m: 0.45 }), hz = mat(0xffffff, 'hazard');
  const dark = mat(0x3a3836, 'metal');
  switch (kind) {
    case 'rock': {
      const m = add(root, lumpGeo(hs % 3), mat(theme === 1 ? 0xb8a88a : T.conc, 'rock'), 0, -0.1, 0);
      m.scale.set(w / 2, h + 0.1, d / 2);
      break;
    }
    case 'building': {
      const win = mat(T.wall, 'windows', { r: 0.6 }), roof = mat(0x6a6866, 'concrete');
      add(root, B(w, h, d, 1, 1, 0, 0, 4, 3.5), [win, win, roof, roof, win, win], 0, 0, 0);
      add(root, B(w + 0.15, 1.2, d + 0.15, 1, 1, 0, 0, 2, 2), mat(0x8a8884, 'concrete'), 0, 0, 0);
      add(root, B(w + 0.2, 0.35, d + 0.2), conc, 0, h, 0);
      add(root, B(Math.min(3, w * 0.3), 1.2, Math.min(2.5, d * 0.3)), metal, w * 0.2, h + 0.35, -d * 0.15);
      add(root, C(0.9, 0.9, 1.8, 8), metal, -w * 0.25, h + 1.25, d * 0.2);
      break;
    }
    case 'house': {
      const wh = h * 0.55;
      add(root, B(w, wh, d, 1, 1, 0, 0, 2, 2), mat(T.wall, 'concrete'), 0, 0, 0);
      add(root, B(w + 0.5, h - wh, d + 0.5, 1, 0.02, 0, 0, 2, 2), mat(T.roof, 'roof'), 0, wh, 0);
      add(root, B(0.9, 1.9, 0.08), mat(0x5a3e28, 'crate'), w * 0.2, 0, d / 2);
      const gl = mat(0x2a3a4a, null, { r: 0.2, m: 0.6 });
      for (const sx of [-1, 1]) add(root, B(0.9, 0.8, 0.08), gl, sx * w * 0.3 - 0.2, wh * 0.45, d / 2);
      add(root, B(0.6, 1.2, 0.6), conc, -w * 0.25, h * 0.75, -d * 0.1);
      break;
    }
    case 'wall': {
      const m = theme === 4 ? metal : conc;
      add(root, B(w, h, d, 1, 1, 0, 0, 2, 2), m, 0, 0, 0);
      add(root, B(w + 0.1, 0.15, d + 0.1), theme === 4 ? mat(T.accent, null) : mat(0x8a8884, 'concrete'), 0, h - 0.15, 0);
      if (theme === 4) add(root, B(w + 0.02, 0.4, d + 0.02, 1, 1, 0, 0, 1, 0.4), hz, 0, 0.3, 0);
      break;
    }
    case 'crate': {
      const m = mat(theme === 4 ? 0x8a8070 : 0xc8a878, 'crate');
      const cw = w / 2 - 0.05, ch = h / 2;
      add(root, B(cw, ch, d, 1, 1, 0, 0, cw, ch), m, -w / 4, 0, 0);
      add(root, B(cw, ch, d * 0.95, 1, 1, 0, 0, cw, ch), m, w / 4, 0, 0, 0, 0.08, 0);
      add(root, B(cw, ch, d * 0.9, 1, 1, 0, 0, cw, ch), m, -w / 8, ch, 0, 0, -0.15, 0);
      break;
    }
    case 'container': {
      const cols = [0xc0582a, 0x3a6a9a, 0x5a7a48, T.accent, 0xb0a890];
      const m = mat(cols[hs % cols.length], 'container', { m: 0.4 }), f = mat(0x4a4844, 'metal');
      add(root, B(w, h, d, 1, 1, 0, 0, 2.4, h), m, 0, 0, 0);
      const long = d > w;
      for (const s of [1, -1]) add(root, long ? B(w + 0.06, h + 0.04, 0.12) : B(0.12, h + 0.04, d + 0.06), f, long ? 0 : s * (w / 2), 0, long ? s * (d / 2) : 0);
      break;
    }
    case 'sandbag':
      add(root, B(w, h, d, 0.9, 0.7, 0, 0, 1.6, 0.6), mat(theme === 3 ? 0xa89870 : 0xc8b890, 'sandbag', { flat: false }), 0, 0, 0);
      break;
    case 'tree': {
      const r = size.r ?? 0.6, leaf = mat(T.leaf, 'foliage');
      add(root, C(r * 0.55, r * 0.8, h * 0.45, 6), mat(0x8a6a4a, 'bark'), 0, h * 0.225, 0);
      const c1 = add(root, lumpGeo(hs % 3), leaf, 0, h * 0.35, 0); c1.scale.set(r * 3.6, h * 0.5, r * 3.6);
      const c2 = add(root, lumpGeo((hs + 1) % 3), leaf, r * 0.6, h * 0.62, -r * 0.4); c2.scale.set(r * 2.5, h * 0.38, r * 2.5);
      break;
    }
    case 'pillar': {
      if (size.r) {
        add(root, C(size.r, size.r, h, 8), metal, 0, h / 2, 0);
        for (const y of [0.2, h - 0.2]) add(root, C(size.r + 0.12, size.r + 0.12, 0.4, 8), dark, 0, y, 0);
      } else {
        add(root, B(w, h, d), metal, 0, 0, 0);
        add(root, B(w + 0.2, 0.4, d + 0.2), dark, 0, 0, 0);
        add(root, B(w + 0.2, 0.4, d + 0.2), dark, 0, h - 0.4, 0);
      }
      if (theme === 4) add(root, B(w + 0.04, 0.5, d + 0.04, 1, 1, 0, 0, 1, 0.5), hz, 0, 1.0, 0);
      break;
    }
    case 'bunker': {
      add(root, B(w, h, d, 0.82, 0.78), conc, 0, 0, 0);
      add(root, B(w * 0.6, 0.25, 0.2), mat(0x101010, null), 0, h * 0.55, d / 2 - (d / 2) * 0.22 * 0.55 + 0.02);
      add(root, C(0.6, 0.7, 0.3, 8), dark, w * 0.2, h + 0.15, -d * 0.1);
      break;
    }
    case 'silo': {
      const r = size.r ?? Math.min(w, d) / 2;
      add(root, C(r, r, h, 12), mat(T.metal, 'container', { m: 0.45 }), 0, h / 2, 0);
      add(root, DOME(r, 12), metal, 0, h, 0).scale.y = 0.35;
      for (const y of [h * 0.3, h * 0.65]) add(root, C(r + 0.05, r + 0.05, 0.25, 12), dark, 0, y, 0);
      add(root, B(0.5, h, 0.2), dark, 0, 0, r + 0.1);
      break;
    }
    case 'gate': {
      add(root, B(w, h, d, 1, 1, 0, 0, 2, 2), metal, 0, 0, 0);
      for (const y of [0.3, h - 0.8]) add(root, B(w + 0.02, 0.5, d + 0.04, 1, 1, 0, 0, 1, 0.5), hz, 0, y, 0);
      for (let x = -w / 2 + 1; x < w / 2; x += 2) add(root, B(0.15, h * 0.6, d + 0.1), dark, x, h * 0.2, 0);
      add(root, B(w + 0.6, 0.25, d + 0.6), dark, 0, h, 0);
      break;
    }
    case 'machine': {
      const acc = mat(T.accent, 'metal');
      add(root, B(w * 0.8, h * 0.7, d * 0.8, 0.95, 0.95), metal, 0, 0, 0);
      add(root, B(w * 0.4, h * 0.3, d * 0.5), acc, -w * 0.15, h * 0.7, 0);
      add(root, C(h * 0.15, h * 0.15, w, 8, 'x'), dark, 0, h * 0.85, d * 0.3);
      add(root, C(0.25, 0.25, d, 6, 'z'), acc, w * 0.35, h * 0.5, 0);
      add(root, C(Math.min(w, d) * 0.22, Math.min(w, d) * 0.22, h * 0.9, 10), metal, w * 0.3, h * 0.45, -d * 0.2);
      add(root, B(w * 0.82, 0.3, 0.05, 1, 1, 0, 0, 1, 0.3), hz, 0, 0.2, d * 0.4);
      break;
    }
    case 'hedge':
      add(root, B(w, h, d, 0.85, 0.7, 0, 0, 1.5, 1.5), mat(T.leaf, 'foliage'), 0, 0, 0);
      break;
    case 'tanktrap': {
      const m = mat(theme === 4 ? 0x5a4a40 : 0x6a5e52, 'metal'), beam = B(0.22, 0.22, 2.0);
      const nx = Math.max(1, Math.round(w / 2.4)), nz = Math.max(1, Math.round(d / 2.4)), r = rng(hs);
      let n = 0;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz && n < 6; j++, n++) {
        const g = grp(root, (i - (nx - 1) / 2) * 2.4, 0.75, (j - (nz - 1) / 2) * 2.4); g.rotation.y = r() * PI;
        add(g, beam, m, 0, -0.11, -1, 0.6, 0, 0); add(g, beam, m, 0, -0.11, -1, 0.6, 2.1, 0); add(g, beam, m, 0, -0.11, -1, 0.6, -2.1, 0);
      }
      break;
    }
    case 'wreck': {
      const r = size.r ?? 2.5, burnt = mat(0x2e2a26, 'panelG', { r: 0.95 }), ember = mat(0x200400, null, { e: 0xff5a1a, ei: 1.6 });
      const g = grp(root, 0, 0, 0); g.rotation.set(0.12, hs % 6, -0.18);
      add(g, B(r * 1.3, r * 0.4, r * 1.7, 0.8, 0.7), burnt, 0, -0.1, 0);
      add(g, C(r * 0.35, r * 0.42, r * 0.25, 8), burnt, r * 0.5, r * 0.18, -r * 0.9, 0.8, 0, 0.4);
      add(g, C(0.06, 0.08, r * 1.2, 6, 'z'), burnt, -r * 0.3, r * 0.3, r * 0.9, 0.3, 0.6, 0);
      add(g, B(r * 0.5, 0.3, r * 0.4), burnt, -r * 0.6, 0, -r * 0.5, 0, 0.7, 0.3);
      add(g, B(0.3, 0.1, 0.4), ember, 0.2, r * 0.38, 0.1);
      add(g, B(0.25, 0.08, 0.3), ember, -r * 0.3, r * 0.2, -r * 0.3);
      break;
    }
    default:
      add(root, B(w, h, d), conc, 0, 0, 0);
  }
  return root;
}

// ---------- 弾・マーカー ----------
const SHELL = {
  shell: () => [C(0.06, 0.09, 1.0, 6, 'z'), mat(0xfff3b0, null, { basic: true })],
  enemy: () => [gc('sphE', () => new THREE.SphereGeometry(0.35, 10, 8)), mat(0xff2fa8, null, { basic: true })],
  mg: () => [C(0.025, 0.035, 0.6, 4, 'z'), mat(0xffe080, null, { basic: true })],
  missile: () => [C(0.12, 0.12, 1.2, 6, 'z'), mat(0x6a6e72, 'metal', { m: 0.5 })],
  lob: () => [gc('sphL', () => new THREE.SphereGeometry(0.22, 8, 6)), mat(0xffa040, null, { basic: true })],
  bomb: () => [C(0.22, 0.22, 0.9, 8, 'z'), mat(0x3a3c3e, 'metal', { m: 0.5 })],
};
export function makeShellMesh(kind = 'shell') {
  const [g, m] = (SHELL[kind] || SHELL.shell)();
  const o = new THREE.Mesh(g, m);
  const halo = (r, c, op) => add(o, gc('halo' + r, () => new THREE.SphereGeometry(r, 8, 6)), mat(c, null, { basic: true, add: true, op }));
  if (kind === 'enemy') halo(0.6, 0xff40c0, 0.35);
  else if (kind === 'lob') halo(0.45, 0xff8020, 0.35);
  else if (kind === 'missile') {
    add(o, gc('cone', () => new THREE.ConeGeometry(0.12, 0.3, 6).rotateX(PI / 2)), mat(0xd04030, null), 0, 0, 0.75);
    add(o, gc('flame', () => new THREE.ConeGeometry(0.11, 0.7, 6).rotateX(-PI / 2)), mat(0xffb040, null, { basic: true, add: true, op: 0.9 }), 0, 0, -0.95);
    for (let i = 0; i < 4; i++) add(o, B(0.03, 0.2, 0.25), mat(0x3a3c3e, null), 0, 0, -0.55, 0, 0, i * PI / 2);
  } else if (kind === 'bomb') {
    add(o, gc('bnose', () => new THREE.SphereGeometry(0.22, 8, 4)), o.material, 0, 0, 0.45);
    for (let i = 0; i < 4; i++) add(o, B(0.03, 0.35, 0.3), mat(0x3a3c3e, null), 0, 0, -0.6, 0, 0, i * PI / 2);
    halo(0.3, 0xff4020, 0.25).position.z = -0.6;
  } else if (kind === 'shell') halo(0.18, 0xffe060, 0.4).scale.set(1, 1, 3);
  return o;
}
function marker(kind) {
  const g = gc('marker', () => new THREE.PlaneGeometry(2, 2).rotateX(-PI / 2));
  const m = new THREE.MeshBasicMaterial({ map: tex('marker', kind), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const o = new THREE.Mesh(g, m);
  o.renderOrder = 999;
  return o;
}
// 曲射の着弾予測リング(半径1、XZ平面)
export function makeLobMarker() { return marker('lob'); }
// 爆撃・迫撃の警告リング(赤、×印)
export function makeDangerMarker() { return marker('danger'); }
