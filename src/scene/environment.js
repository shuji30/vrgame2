// ネオン調のステージ。曲のビートに合わせてリング・レーザー・レールが光る
import * as THREE from 'three';
import { COLORS } from '../core/config.js';

const BG = 0x05030d;

export class Environment {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    scene.background = new THREE.Color(BG);
    scene.fog = new THREE.Fog(BG, 14, 75);

    scene.add(new THREE.HemisphereLight(0x9a8cff, 0x200820, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(0.5, 4, 3);
    scene.add(dir);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.MeshStandardMaterial({ color: 0x07050f, roughness: 0.95, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);

    const grid = new THREE.GridHelper(240, 120, 0x3b1d70, 0x1a0e38);
    grid.position.y = 0.003;
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    grid.material.depthWrite = false;
    this.group.add(grid);

    // トラック
    const track = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.06, 90),
      new THREE.MeshStandardMaterial({ color: 0x0c0b1c, roughness: 0.4, metalness: 0.7 }),
    );
    track.position.set(0, 0.03, -44);
    this.group.add(track);

    this.rails = [];
    for (const [x, c] of [[-1.07, COLORS.left], [1.07, COLORS.right]]) {
      const m = new THREE.MeshBasicMaterial({ color: c, fog: true });
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 90), m);
      rail.position.set(x, 0.07, -44);
      this.group.add(rail);
      this.rails.push({ mat: m, base: new THREE.Color(c) });
    }

    // プレイヤーの足場
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.05, 1.4),
      new THREE.MeshStandardMaterial({ color: 0x15132a, roughness: 0.5, metalness: 0.5 }),
    );
    pad.position.set(0, 0.025, 0);
    this.group.add(pad);
    const padEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.4, 0.05, 1.4)),
      new THREE.LineBasicMaterial({ color: 0x8a6bff }),
    );
    padEdge.position.copy(pad.position);
    this.group.add(padEdge);
    this.padEdge = padEdge;

    // リング
    this.rings = [];
    const ringGeo = new THREE.TorusGeometry(7.5, 0.07, 6, 64);
    for (let i = 0; i < 14; i++) {
      const base = new THREE.Color(i % 2 ? COLORS.right : COLORS.left);
      const mat = new THREE.MeshBasicMaterial({ color: base.clone(), transparent: true, opacity: 0.9 });
      const ring = new THREE.Mesh(ringGeo, mat);
      ring.position.set(0, 3.2, -14 - i * 5);
      ring.rotation.z = i * 0.3;
      this.group.add(ring);
      this.rings.push({ mesh: ring, mat, base, dir: i % 2 ? 1 : -1 });
    }

    // レーザー
    this.lasers = [];
    const beamGeo = new THREE.BoxGeometry(0.07, 0.07, 70);
    beamGeo.translate(0, 0, -35);
    for (let i = 0; i < 10; i++) {
      const side = i < 5 ? -1 : 1;
      const base = new THREE.Color(side < 0 ? COLORS.left : COLORS.right);
      const mat = new THREE.MeshBasicMaterial({
        color: base.clone(), transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const beam = new THREE.Mesh(beamGeo, mat);
      beam.position.set(side * (9 + (i % 5) * 1.2), 0.2, -18 - (i % 5) * 4);
      this.group.add(beam);
      this.lasers.push({ mesh: beam, mat, base, side, phase: i * 1.3 });
    }

    // 星
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 90 + Math.random() * 60;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 0.9);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph);
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.group.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xbfb8ff, size: 0.35, fog: false })));

    this.flash = 0;
    this.time = 0;
  }

  // ノーツを切ったときなどに一瞬明るくする
  pulse(amount = 1) {
    this.flash = Math.min(1.5, this.flash + amount);
  }

  // t: 曲の時刻, bpm, energy: 盛り上がり (0..1)
  update(dt, t, bpm, energy) {
    this.time += dt;
    const beat = (t * bpm) / 60;
    const phase = beat - Math.floor(beat);
    const kick = energy >= 0.5 || (energy >= 0.3 && Math.floor(beat) % 2 === 0) ? Math.exp(-phase * 5) : 0;
    this.flash = Math.max(0, this.flash - dt * 4);
    const glow = 0.25 + 0.55 * energy + 0.6 * kick * energy + 0.4 * this.flash;

    for (const r of this.rings) {
      r.mesh.rotation.z += dt * (0.08 + 0.35 * energy) * r.dir;
      const s = 1 + 0.035 * kick * energy;
      r.mesh.scale.set(s, s, 1);
      r.mat.color.copy(r.base).multiplyScalar(Math.min(1.6, glow));
    }
    for (const l of this.lasers) {
      const a = this.time * (0.4 + energy) + l.phase;
      l.mesh.rotation.x = 0.35 + 0.25 * Math.sin(a);
      l.mesh.rotation.y = l.side * (0.25 + 0.2 * Math.cos(a * 0.7));
      l.mat.opacity = Math.min(1, 0.15 + glow * 0.6);
    }
    for (const r of this.rails) r.mat.color.copy(r.base).multiplyScalar(0.5 + glow * 0.6);
  }
}
