// パーティーモードのドライバー: 動物キャラクター 10 種（オリジナル）。大きな頭の 2.5 頭身
// 頭の正面 = ローカル +X。表情: normal（笑顔）/ happy（1 位のドヤ顔）/ dizzy（目を回す）/ cry（泣き顔）
import * as THREE from 'three';
import { toon } from './style.js';
import { addOutline } from './theme.js';

export const CHARACTERS = [
  { id: 'bear', name: 'クマ', emoji: '🐻', color: 0x9a6a3f, muzzle: 0xe8cfa6, ears: 'round', nose: 0x3a2418 },
  { id: 'cat', name: 'ネコ', emoji: '🐱', color: 0xf2a65a, muzzle: 0xfff4e6, ears: 'triangle', nose: 0xff7a9a, whiskers: true },
  { id: 'penguin', name: 'ペンギン', emoji: '🐧', color: 0x2b3550, muzzle: 0xffffff, ears: 'none', beak: 0xffa31a, mask: true },
  { id: 'frog', name: 'カエル', emoji: '🐸', color: 0x6cc04a, muzzle: 0xc9f0a0, ears: 'none', frogEyes: true },
  { id: 'rabbit', name: 'ウサギ', emoji: '🐰', color: 0xf4f0f0, muzzle: 0xffffff, ears: 'long', inner: 0xffb3c6, nose: 0xff7a9a },
  { id: 'pig', name: 'ブタ', emoji: '🐷', color: 0xf5a9b8, muzzle: 0xf5a9b8, ears: 'small', snout: 0xf08aa0 },
  { id: 'panda', name: 'パンダ', emoji: '🐼', color: 0xf7f7f7, muzzle: 0xffffff, ears: 'round', earColor: 0x222222, patches: true, nose: 0x222222 },
  { id: 'fox', name: 'キツネ', emoji: '🦊', color: 0xe8762c, muzzle: 0xffffff, ears: 'pointy', earTip: 0x2a1a10, nose: 0x2a1a10 },
  { id: 'chick', name: 'ヒヨコ', emoji: '🐤', color: 0xffd84a, muzzle: 0xffd84a, ears: 'none', beak: 0xff8a1f, tuft: true },
  { id: 'koala', name: 'コアラ', emoji: '🐨', color: 0x9aa3ad, muzzle: 0xc9cfd6, ears: 'fluffy', inner: 0xf2f2f2, bigNose: 0x2b2b30 },
];

// ドライバーの動き（KartModel / CarModel 共通）。model.driver を曲がる向きへ傾け、
// model.head（パーティーのみ）を上下の衝撃でバネのように弾ませる
export function animateDriver(model, pose, kart, dt) {
  const k = model.theme === 'party' ? 0.022 : 0.008;
  const target = Math.max(-0.35, Math.min(0.35, (kart.lateralAccel || 0) * k));
  model.lean = (model.lean || 0) + (target - (model.lean || 0)) * Math.min(1, dt * 8);
  model.driver.rotation.x = model.lean;
  if (!model.head || !(dt > 0)) return;
  const b = (model.bob ||= { y: 0, v: 0, prevY: null, vy0: null });
  if (b.prevY != null) {
    const vy = (pose.y - b.prevY) / dt;
    if (b.vy0 != null) b.v -= Math.max(-3, Math.min(3, vy - b.vy0)) * 0.05;
    b.vy0 = vy;
  }
  b.prevY = pose.y;
  b.v += (-b.y * 220 - b.v * 9) * dt;
  b.y = Math.max(-0.1, Math.min(0.1, b.y + b.v * dt));
  const h = model.head.group;
  h.position.y = model.headBase + b.y;
  const s = model.headScale ?? 1;
  h.scale.set(s * (1 - b.y * 1.2), s * (1 + b.y * 2), s * (1 - b.y * 1.2));
}

export function characterById(id) {
  return CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
}

const R = 0.3; // 頭の半径
let G = null;
function geos() {
  if (G) return G;
  G = {
    head: new THREE.SphereGeometry(R, 24, 18),
    ball: new THREE.SphereGeometry(1, 14, 10),
    eye: new THREE.SphereGeometry(0.055, 12, 10),
    shine: new THREE.SphereGeometry(0.017, 8, 6),
    arc: new THREE.TorusGeometry(0.045, 0.012, 6, 12, Math.PI),
    bar: new THREE.BoxGeometry(0.012, 0.012, 0.1),
    mouth: new THREE.TorusGeometry(0.06, 0.013, 6, 14, Math.PI),
    open: new THREE.CircleGeometry(0.045, 14),
    cone: new THREE.ConeGeometry(1, 1, 12),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
    whisker: new THREE.BoxGeometry(0.004, 0.004, 0.14),
    tear: new THREE.SphereGeometry(0.03, 8, 6),
    // 正面（+X）を覆う球面の一部
    mask: new THREE.SphereGeometry(R * 1.012, 24, 16, Math.PI - 0.95, 1.9, 0.7, 1.55),
  };
  return G;
}

const M = {};
function m(color) {
  return (M[color] ||= toon({ color }));
}
const black = () => m(0x1c1420);

// 頭を作る。返り値: { group, setExpression(name) }
export function buildHead(id) {
  const c = characterById(id);
  const g = geos();
  const group = new THREE.Group();
  const head = new THREE.Mesh(g.head, m(c.color));
  addOutline(head, 0.02);
  group.add(head);
  const at = (mesh, x, y, z, sx = 1, sy = sx, sz = sx) => {
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    group.add(mesh);
    return mesh;
  };

  // 顔のパーツ（正面 = +X）
  // 顔の白い部分（ペンギン）: 頭よりわずかに大きい球の前面だけ
  if (c.mask) at(new THREE.Mesh(g.mask, m(c.muzzle)), 0, 0, 0);
  else if (c.muzzle !== c.color && !c.frogEyes) at(new THREE.Mesh(g.ball, m(c.muzzle)), R * 0.72, -0.08, 0, 0.12, 0.1, 0.14);
  if (c.patches) for (const z of [-0.1, 0.1]) at(new THREE.Mesh(g.ball, m(0x222222)), R * 0.82, 0.04, z, 0.04, 0.075, 0.06).rotation.x = z > 0 ? -0.5 : 0.5;
  if (c.nose) at(new THREE.Mesh(g.ball, m(c.nose)), R * 1.02, -0.04, 0, 0.03, 0.025, 0.04);
  if (c.bigNose) at(new THREE.Mesh(g.ball, m(c.bigNose)), R * 0.98, -0.03, 0, 0.05, 0.07, 0.06);
  if (c.snout) {
    const s = at(new THREE.Mesh(g.cyl, m(c.snout)), R * 0.98, -0.06, 0, 0.08, 0.06, 0.08);
    s.rotation.z = Math.PI / 2;
    for (const z of [-0.03, 0.03]) at(new THREE.Mesh(g.ball, m(0x8a3a4a)), R * 0.98 + 0.031, -0.06, z, 0.008, 0.015, 0.012);
  }
  if (c.beak) {
    const b = at(new THREE.Mesh(g.cone, m(c.beak)), R * 1.04, -0.05, 0, 0.05, 0.1, 0.05);
    b.rotation.z = -Math.PI / 2;
  }
  if (c.whiskers) {
    for (const side of [-1, 1]) for (const dy of [-0.02, 0.01]) {
      const w = at(new THREE.Mesh(g.whisker, black()), R * 0.88, -0.06 + dy, side * 0.15);
      w.rotation.x = side * dy * 6;
    }
  }
  if (c.tuft) for (const [dx, rz] of [[-0.02, 0.4], [0.02, -0.2]]) {
    const t = at(new THREE.Mesh(g.cone, m(c.color)), dx, R + 0.04, 0, 0.035, 0.12, 0.035);
    t.rotation.z = rz;
  }
  // 頬
  for (const z of [-0.17, 0.17]) at(new THREE.Mesh(g.ball, m(0xff8fa8)), R * 0.78, -0.07, z, 0.02, 0.03, 0.045);

  // 耳
  const earColor = c.earColor ?? c.color;
  for (const side of [-1, 1]) {
    switch (c.ears) {
      case 'round': at(new THREE.Mesh(g.ball, m(earColor)), -0.02, R * 0.85, side * R * 0.68, 0.07, 0.1, 0.1); break;
      case 'fluffy': {
        at(new THREE.Mesh(g.ball, m(earColor)), -0.02, R * 0.6, side * R * 0.95, 0.06, 0.15, 0.13);
        at(new THREE.Mesh(g.ball, m(c.inner)), 0.02, R * 0.6, side * R * 0.95, 0.03, 0.1, 0.08);
        break;
      }
      case 'triangle':
      case 'pointy':
      case 'small': {
        const big = c.ears === 'pointy' ? 1.3 : c.ears === 'small' ? 0.7 : 1;
        const e = at(new THREE.Mesh(g.cone, m(earColor)), -0.02, R * 0.88, side * R * 0.55, 0.08 * big, 0.16 * big, 0.05 * big);
        e.rotation.x = side * 0.45;
        if (c.earTip) {
          const t = at(new THREE.Mesh(g.cone, m(c.earTip)), -0.02, R * 0.88 + 0.07 * big * Math.cos(0.45), side * (R * 0.55 + 0.07 * big * Math.sin(0.45)), 0.04 * big, 0.06 * big, 0.026 * big);
          t.rotation.x = side * 0.45;
        }
        break;
      }
      case 'long': {
        const e = at(new THREE.Mesh(g.ball, m(earColor)), -0.04, R + 0.17, side * 0.1, 0.05, 0.22, 0.07);
        e.rotation.x = side * 0.18;
        const inner = at(new THREE.Mesh(g.ball, m(c.inner)), -0.0, R + 0.17, side * 0.1, 0.02, 0.17, 0.045);
        inner.rotation.x = side * 0.18;
        break;
      }
      default: break;
    }
  }

  // 目と口（表情ごとに切り替え）
  const eyeY = c.frogEyes ? R * 0.78 : 0.06;
  const eyeX = c.frogEyes ? R * 0.35 : R * 0.86;
  if (c.frogEyes) for (const z of [-0.12, 0.12]) at(new THREE.Mesh(g.ball, m(c.color)), R * 0.25, R * 0.72, z, 0.1, 0.1, 0.1);
  const eyeZ = c.frogEyes ? 0.12 : 0.105;
  const ex = (c.frogEyes ? eyeX + 0.08 : eyeX);
  const faces = {};
  // 白い顔（マスク）の上に出るよう、目と口を少し前へ
  const out = c.mask ? 0.016 : 0;
  const set = (name, parts) => { faces[name] = parts; for (const p of parts) { p.visible = false; p.position.x += out; } };
  // normal: 黒目 + ハイライト
  const normal = [];
  for (const z of [-eyeZ, eyeZ]) {
    normal.push(at(new THREE.Mesh(g.eye, black()), ex, eyeY, z, 0.7, 1, 0.7));
    normal.push(at(new THREE.Mesh(g.shine, m(0xffffff)), ex + 0.035, eyeY + 0.025, z - 0.012));
  }
  const smile = at(new THREE.Mesh(g.mouth, black()), R * 0.97, -0.1, 0);
  smile.rotation.set(0, Math.PI / 2, Math.PI);
  normal.push(smile);
  set('normal', normal);
  // happy: ^ ^ の目と大きな笑顔
  const happy = [];
  for (const z of [-eyeZ, eyeZ]) {
    const a = at(new THREE.Mesh(g.arc, black()), ex, eyeY - 0.01, z);
    a.rotation.y = Math.PI / 2;
    happy.push(a);
  }
  const grin = at(new THREE.Mesh(g.mouth, black()), R * 0.97, -0.1, 0, 1.3);
  grin.rotation.set(0, Math.PI / 2, Math.PI);
  happy.push(grin);
  set('happy', happy);
  // dizzy: × の目と O の口
  const dizzy = [];
  for (const z of [-eyeZ, eyeZ]) for (const r of [0.8, -0.8]) {
    const b = at(new THREE.Mesh(g.bar, black()), ex + 0.01, eyeY, z);
    b.rotation.x = r;
    dizzy.push(b);
  }
  const oh = at(new THREE.Mesh(g.open, m(0x5a1a2a)), R * 0.99, -0.1, 0);
  oh.rotation.y = Math.PI / 2;
  dizzy.push(oh);
  set('dizzy', dizzy);
  // cry: 目 + 涙 + への字口
  const cry = [];
  for (const z of [-eyeZ, eyeZ]) {
    cry.push(at(new THREE.Mesh(g.eye, black()), ex, eyeY, z, 0.6, 0.8, 0.6));
    cry.push(at(new THREE.Mesh(g.tear, m(0x6ec8ff)), ex + 0.02, eyeY - 0.08, z * 1.25, 0.8, 1.3, 0.8));
  }
  const frown = at(new THREE.Mesh(g.mouth, black()), R * 0.97, -0.13, 0, 0.8);
  frown.rotation.set(0, Math.PI / 2, 0);
  cry.push(frown);
  set('cry', cry);

  let cur = null;
  const setExpression = (name) => {
    if (name === cur || !faces[name]) return;
    if (cur) for (const p of faces[cur]) p.visible = false;
    for (const p of faces[name]) p.visible = true;
    cur = name;
  };
  setExpression('normal');
  return { group, setExpression, character: c };
}
