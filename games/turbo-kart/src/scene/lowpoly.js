// ローポリ化: 模型（車・カート）の丸い形の分割数を減らして、角ばった見た目にする（アーケードモード）
// three.js の標準の形は作ったときの引数（geometry.parameters）を持っているので、同じ引数で分割数だけ減らして作り直す
// 同じ形を何度も作らないよう、引数ごとに使い回す
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const cache = new Map();
const lim = (n, max, min = 3) => Math.max(min, Math.min(n ?? max, max));

function rebuild(g) {
  const p = g.parameters;
  if (!p) return null;
  switch (g.type) {
    case 'SphereGeometry':
      return new THREE.SphereGeometry(p.radius, lim(p.widthSegments, 8, 4), lim(p.heightSegments, 6, 2), p.phiStart, p.phiLength, p.thetaStart, p.thetaLength);
    case 'CylinderGeometry':
      return new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, lim(p.radialSegments, 8), 1, p.openEnded, p.thetaStart, p.thetaLength);
    case 'ConeGeometry':
      return new THREE.ConeGeometry(p.radius, p.height, lim(p.radialSegments, 6), 1, p.openEnded, p.thetaStart, p.thetaLength);
    case 'TorusGeometry':
      return new THREE.TorusGeometry(p.radius, p.tube, lim(p.radialSegments, 4), lim(p.tubularSegments, 10), p.arc);
    case 'CircleGeometry':
      // 計器の文字盤などに使うので、多角形でも丸く見える程度は残す
      return new THREE.CircleGeometry(p.radius, lim(p.segments, 10), p.thetaStart, p.thetaLength);
    case 'CapsuleGeometry':
      return new THREE.CapsuleGeometry(p.radius, p.length, lim(p.capSegments, 2, 1), lim(p.radialSegments, 6));
    case 'BoxGeometry': {
      // RoundedBoxGeometry は引数を残さず「1×1×1 で分割の多い箱」に見えるので、実際の大きさを測って
      // 角を 1 段だけ面取りした箱にする
      if (p.width !== 1 || p.height !== 1 || p.depth !== 1 || p.widthSegments < 3) return null;
      g.computeBoundingBox();
      const s = g.boundingBox.getSize(new THREE.Vector3());
      const c = g.boundingBox.getCenter(new THREE.Vector3());
      const out = new RoundedBoxGeometry(s.x, s.y, s.z, 1, Math.min(s.x, s.y, s.z) * 0.18);
      out.translate(c.x, c.y, c.z);
      return out;
    }
    case 'IcosahedronGeometry':
    case 'OctahedronGeometry':
    case 'DodecahedronGeometry':
      return p.detail > 0 ? new THREE[g.type](p.radius, 0) : null;
    case 'LatheGeometry':
      return new THREE.LatheGeometry(p.points, lim(p.segments, 8), p.phiStart, p.phiLength);
    default:
      return null;
  }
}

function lowGeometry(g) {
  if (cache.has(g)) return cache.get(g);
  let out = g;
  try {
    out = rebuild(g) || g;
  } catch {
    out = g;
  }
  cache.set(g, out);
  return out;
}

// root の下のメッシュの形と材質をローポリ用にする。skip(mesh) が true のものはそのまま
export function lowpolyize(root, skip = () => false) {
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || skip(o)) return;
    o.geometry = lowGeometry(o.geometry);
    for (const m of [].concat(o.material)) {
      // 光の当たる材質は面ごとに 1 色（足し算で光らせる炎などは対象外）
      if ('flatShading' in m && !m.flatShading && m.blending !== THREE.AdditiveBlending && !m.isMeshBasicMaterial) {
        m.flatShading = true;
        m.needsUpdate = true;
      }
    }
  });
}
