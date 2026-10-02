// ノーツ・爆弾・壁の見た目（オブジェクトプールで再利用）
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { NOTE_SIZE, COLORS } from '../core/config.js';
import { Dir } from '../core/slice.js';

export class ObjectViews {
  constructor(scene) {
    this.scene = scene;
    const S = NOTE_SIZE;
    this.noteGeo = new RoundedBoxGeometry(S, S, S, 3, 0.06);
    this.noteMats = [COLORS.left, COLORS.right].map((c) => new THREE.MeshStandardMaterial({
      color: c, emissive: c, emissiveIntensity: 0.28, metalness: 0.35, roughness: 0.35,
    }));
    // 下向き（切る方向）の矢印
    const shape = new THREE.Shape();
    shape.moveTo(-0.14, 0.05);
    shape.lineTo(0.14, 0.05);
    shape.lineTo(0, -0.09);
    shape.closePath();
    this.arrowGeo = new THREE.ShapeGeometry(shape);
    this.dotGeo = new THREE.CircleGeometry(0.055, 20);
    this.markMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    // ノーツ背後の淡い光
    this.haloGeo = new THREE.PlaneGeometry(S * 1.9, S * 1.9);
    this.haloMats = [COLORS.left, COLORS.right].map((c) => new THREE.MeshBasicMaterial({
      color: c, transparent: true, opacity: 0.35, map: haloTexture(),
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));

    this.bombGeo = new THREE.IcosahedronGeometry(0.17, 1);
    this.bombMat = new THREE.MeshStandardMaterial({ color: COLORS.bomb, metalness: 0.9, roughness: 0.25 });
    this.spikeGeo = new THREE.ConeGeometry(0.035, 0.12, 6);
    this.spikeMat = new THREE.MeshStandardMaterial({ color: 0x3a3a46, metalness: 0.8, roughness: 0.3, emissive: 0x330010, emissiveIntensity: 1 });

    this.wallGeo = new THREE.BoxGeometry(1, 1, 1);
    this.wallMat = new THREE.MeshBasicMaterial({
      color: COLORS.wall, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
    });
    this.wallEdgeGeo = new THREE.EdgesGeometry(this.wallGeo);
    this.wallEdgeMat = new THREE.LineBasicMaterial({ color: COLORS.wall });

    this.pools = { arrow: [], dot: [], bomb: [], wall: [] };
  }

  makeNote(dot) {
    const g = new THREE.Group();
    const box = new THREE.Mesh(this.noteGeo, this.noteMats[0]);
    const mark = new THREE.Mesh(dot ? this.dotGeo : this.arrowGeo, this.markMat);
    mark.position.z = NOTE_SIZE / 2 + 0.003;
    const halo = new THREE.Mesh(this.haloGeo, this.haloMats[0]);
    halo.position.z = -NOTE_SIZE * 0.55;
    g.add(box, mark, halo);
    g.userData = { box, halo, kind: dot ? 'dot' : 'arrow' };
    return g;
  }

  makeBomb() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.bombGeo, this.bombMat));
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
      [1, 1, 1], [-1, 1, -1], [1, -1, -1], [-1, -1, 1]];
    for (const d of dirs) {
      const v = new THREE.Vector3(...d).normalize();
      const s = new THREE.Mesh(this.spikeGeo, this.spikeMat);
      s.position.copy(v).multiplyScalar(0.17);
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
      g.add(s);
    }
    g.userData = { kind: 'bomb' };
    return g;
  }

  makeWall() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.wallGeo, this.wallMat));
    g.add(new THREE.LineSegments(this.wallEdgeGeo, this.wallEdgeMat));
    g.userData = { kind: 'wall' };
    return g;
  }

  acquireNote(note) {
    const kind = note.dir === Dir.ANY ? 'dot' : 'arrow';
    const g = this.pools[kind].pop() || this.makeNote(kind === 'dot');
    g.userData.box.material = this.noteMats[note.color];
    g.userData.halo.material = this.haloMats[note.color];
    g.visible = true;
    g.scale.setScalar(1);
    this.scene.add(g);
    return g;
  }

  acquireBomb() {
    const g = this.pools.bomb.pop() || this.makeBomb();
    g.visible = true;
    this.scene.add(g);
    return g;
  }

  acquireWall(wall, njs) {
    const g = this.pools.wall.pop() || this.makeWall();
    g.scale.set(wall.x1 - wall.x0, wall.y1 - wall.y0, wall.duration * njs);
    g.visible = true;
    this.scene.add(g);
    return g;
  }

  release(g) {
    if (!g) return;
    this.scene.remove(g);
    this.pools[g.userData.kind].push(g);
  }
}

let haloTex = null;
function haloTexture() {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  haloTex = new THREE.CanvasTexture(c);
  return haloTex;
}
