// エリアボスの見た目。部位の位置は core/boss.js の parts と一致させる
// 採掘機械の改造品:黄色い作業機の地に、公社の寒色の装甲板をボルト留めした姿。弱点は光る
import * as THREE from '../../vendor/three.module.js';
import { BOSSES } from '../core/boss.js';

const M = {};
function mats() {
  if (M.steel) return M;
  M.steel = new THREE.MeshStandardMaterial({ color: 0x4a5a6c, roughness: 0.7, metalness: 0.4, flatShading: true });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.8, metalness: 0.5, flatShading: true });
  M.yellow = new THREE.MeshStandardMaterial({ color: 0xb08a2a, roughness: 0.75, metalness: 0.2, flatShading: true });
  M.rust = new THREE.MeshStandardMaterial({ color: 0x6a4a32, roughness: 0.95, metalness: 0.1, flatShading: true });
  M.teal = new THREE.MeshStandardMaterial({ color: 0x2a8a8a, roughness: 0.6, metalness: 0.3, flatShading: true });
  M.track = new THREE.MeshStandardMaterial({ color: 0x1e1e20, roughness: 0.95, metalness: 0.2, flatShading: true });
  M.weak = new THREE.MeshStandardMaterial({ color: 0xff4a1a, emissive: 0xff4a1a, emissiveIntensity: 2.2, roughness: 0.4 });
  M.dead = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1 });
  M.drill = new THREE.MeshStandardMaterial({ color: 0x9a9aa0, roughness: 0.35, metalness: 0.9, flatShading: true });
  return M;
}

const box = (w, h, d, m, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
};
const cyl = (r, h, m, x = 0, y = 0, z = 0, axis = 'y', seg = 12) => {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  o.position.set(x, y, z);
  if (axis === 'x') o.rotation.z = Math.PI / 2;
  if (axis === 'z') o.rotation.x = Math.PI / 2;
  o.castShadow = true;
  return o;
};

// 砲塔(部位)
function gunTurret(m, long = 4) {
  const g = new THREE.Group();
  g.add(box(3, 1.4, 3, m.steel, 0, -0.3, 0));
  g.add(cyl(0.25, long, m.dark, 0.5, 0, long / 2, 'z', 8));
  g.add(cyl(0.25, long, m.dark, -0.5, 0, long / 2, 'z', 8));
  return g;
}

function weakCore(r) {
  const m = mats();
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.85, 1), m.weak);
  g.add(s);
  const cage = new THREE.Mesh(new THREE.TorusGeometry(r, 0.18, 6, 16), m.dark);
  g.add(cage);
  g.userData.glow = s;
  return g;
}

export function buildBoss(id) {
  const m = mats();
  const B = BOSSES[id];
  const root = new THREE.Group();
  const body = new THREE.Group(); // 下がる・潜る部分
  root.add(body);
  const parts = new Map();
  const legs = [];
  let drill = null, bucket = null;
  const b = B.body;

  if (id === 'hauler') {
    // 鉱石運搬車:巨大な履帯の上に荷台と装甲の箱
    for (const s of [-1, 1]) {
      body.add(box(3, 3.4, 27, m.track, s * 5.6, 1.7, 0));
      for (let z = -11; z <= 11; z += 4.4) body.add(cyl(1.3, 3.2, m.dark, s * 5.6, 1.7, z, 'x', 10));
    }
    body.add(box(10, 3.2, 26, m.yellow, 0, 4.6, 0));
    body.add(box(11, 1.2, 24, m.steel, 0, 6.6, 0));
    body.add(box(8, 2.4, 6, m.steel, 0, 8.2, 9)); // 運転室
    body.add(box(7, 0.8, 1, m.teal, 0, 8.6, 12.1));
    body.add(box(9, 4, 3, m.dark, 0, 4, -12.6)); // 機関部の囲い
    for (let i = -2; i <= 2; i++) body.add(box(0.5, 3, 0.4, m.rust, i * 1.6, 4.3, -14.2));
  } else if (id === 'walker') {
    // 多脚:六角の胴体と6本の脚
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 7, 4.5, 6), m.steel);
    hull.position.y = 8.75;
    hull.castShadow = true;
    body.add(hull);
    body.add(cyl(4, 1.5, m.dark, 0, 11.6, 0, 'y', 6));
    body.add(box(2, 1, 6, m.teal, 0, 9.5, 6));
    const legPos = [[7.5, 6], [-7.5, 6], [7.5, -6], [-7.5, -6], [8.5, 0], [-8.5, 0]];
    legPos.forEach(([x, z], i) => {
      const leg = new THREE.Group();
      leg.position.set(x * 0.7, 8, z * 0.7);
      const upper = box(1.4, 1.4, 6, m.yellow, 0, 0, 0);
      upper.position.set(x * 0.25, -1.5, z * 0.25);
      upper.lookAt(new THREE.Vector3(x * 0.6, -4, z * 0.6).add(leg.position));
      leg.add(upper);
      const lower = cyl(0.7, 7, m.dark, x * 0.42, -4.5, z * 0.42, 'y', 8);
      leg.add(lower);
      const foot = cyl(1.4, 0.6, m.rust, x * 0.42, -7.8, z * 0.42, 'y', 8);
      leg.add(foot);
      body.add(leg);
      legs.push({ leg, i, x, z });
    });
  } else if (id === 'dredger') {
    // 浚渫機:船体、バケットの鎖、上部の機関室
    const hull = box(14, 5, 30, m.yellow, 0, 1.5, 0);
    body.add(hull);
    body.add(box(14.4, 1, 30.4, m.rust, 0, -0.5, 0));
    body.add(box(10, 3, 12, m.steel, 0, 5.4, -3));
    body.add(box(6, 1, 8, m.teal, 0, 7.2, -3));
    const arm = new THREE.Group();
    arm.position.set(0, 4, 11);
    arm.rotation.x = 0.5;
    arm.add(box(2.4, 1.6, 12, m.dark, 0, 0, 5));
    for (let i = 0; i < 6; i++) arm.add(box(2.8, 1.2, 1.4, m.rust, 0, -0.9, i * 2));
    body.add(arm);
    bucket = arm;
  } else if (id === 'driller') {
    // 掘削機:箱型の巨体と、前の円錐ドリル
    for (const s of [-1, 1]) body.add(box(3.4, 4, 30, m.track, s * 6, 2, 0));
    body.add(box(12, 6, 28, m.yellow, 0, 6, 0));
    body.add(box(13, 1.2, 26, m.steel, 0, 9.4, -1));
    body.add(box(6, 3, 5, m.steel, 0, 11.5, -8));
    body.add(box(9, 6, 2, m.dark, 0, 6, -15));
    for (const s of [-1, 1]) body.add(cyl(0.8, 6, m.dark, s * 4, 12, -12, 'y', 8));
    drill = new THREE.Group();
    drill.position.set(0, 5, 15);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(4.6, 9, 10), m.drill);
    cone.rotation.x = Math.PI / 2;
    cone.position.z = 4.5;
    drill.add(cone);
    for (let i = 0; i < 5; i++) {
      const fl = box(0.5, 0.5, 8, m.dark, 0, 0, 4);
      fl.rotation.z = (i / 5) * Math.PI * 2;
      fl.position.set(Math.cos((i / 5) * 6.28) * 2.4, Math.sin((i / 5) * 6.28) * 2.4, 3.6);
      drill.add(fl);
    }
    body.add(drill);
  }

  // 部位
  for (const p of B.parts()) {
    let o;
    if (p.weak) o = weakCore(p.r);
    else if (p.gun) o = gunTurret(m, p.name === 'cannon' ? 6 : 4);
    else if (p.mortar) { o = new THREE.Group(); o.add(cyl(1.6, 1.4, m.steel)); const t = cyl(0.7, 3, m.dark, 0, 1.4, 0.6); t.rotation.x = 0.5; o.add(t); }
    else if (p.arm) { o = new THREE.Group(); o.add(box(4, 2.4, 3, m.rust)); }
    else { o = new THREE.Group(); }
    o.position.set(p.ox, p.oy, p.oz);
    o.userData.part = p.name;
    (p.knee ? root : body).add(o);
    parts.set(p.name, o);
  }

  let t = 0;
  return {
    root,
    parts,
    update(e, dt, time) {
      t += dt;
      // 光る弱点の点滅。守られている弱点は暗く
      for (const p of e.parts) {
        const o = parts.get(p.name);
        if (!o) continue;
        if (!p.alive) {
          if (!o.userData.down) {
            o.userData.down = true;
            o.traverse((c) => { if (c.isMesh) c.material = m.dead; });
            o.scale.setScalar(0.7);
          }
          continue;
        }
        const g = o.userData.glow;
        if (g) {
          const shielded = p.shielded && !partOpen(e, p);
          g.material = shielded ? m.dark : m.weak;
          g.scale.setScalar(1 + Math.sin(time * 6) * 0.08);
        }
        if (p.gun && e.ai?.state !== 'sleep') {
          // 砲塔をプレイヤーへ向けるそぶり
          o.rotation.y = Math.sin(time * 0.7 + p.ox) * 0.6;
        }
      }
      if (id === 'walker') {
        body.position.y = -e.lower * 3.2;
        const walk = (e.v || 0) > 0.1;
        for (const L of legs) {
          const ph = time * 2.2 + L.i * 1.05;
          L.leg.position.y = 8 + (walk ? Math.max(0, Math.sin(ph)) * 0.8 : 0) - e.lower * 3.2;
        }
      }
      if (id === 'dredger') {
        body.position.y = -e.sub * 7;
        for (const p of e.parts) { const o = parts.get(p.name); if (o && o.parent === root) o.position.y = p.oy - e.sub * 7; }
        if (bucket) bucket.rotation.x = 0.5 + Math.sin(time * 1.5) * 0.25;
      }
      if (id === 'driller' && drill) {
        const spin = e.phase === 'windup' || e.phase === 'charge' ? 18 : 2;
        drill.rotation.z += spin * dt;
      }
    },
  };
}

function partOpen(e, p) {
  if (e.boss === 'walker') return e.parts.filter((q) => q.knee && !q.alive).length >= 2;
  if (e.boss === 'dredger') return !e.parts.some((q) => q.vent && q.alive);
  return true;
}
