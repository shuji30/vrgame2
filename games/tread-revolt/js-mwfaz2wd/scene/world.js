// ステージの見た目:地形、水、道、畑、橋、遮蔽物、エレベーター、脱出口、空と光
// エリアごとの色と質感:1 黄土色と緑(土・コンクリート)、2 灰色と青(アスファルト・ガラス)、
// 3 緑と水色(水面・畑・泥)、4 鈍い金属色と赤(鋲打ちの金属床)
import * as THREE from '../../vendor/three.module.js';
import { buildProp } from './models.js';
import { WATER_Y, segDist, rectDist, inRect } from '../core/terrain.js';

export const THEMES = {
  1: { sky: [0x7fa8d0, 0xe8d6a8], fog: 0xcdbf98, fogNear: 120, fogFar: 520, ground: [0x9a8650, 0x7d8a44], road: 0x8c7a5a, field: [0x9db04a, 0x6f8a32], sun: 0xfff1d6, sunI: 2.4, hemi: [0xdfe8ff, 0x6a5a3a], hemiI: 1.1 },
  2: { sky: [0x6f8296, 0xc7cdd4], fog: 0xa9b0b8, fogNear: 90, fogFar: 420, ground: [0x6c6e70, 0x5e6266], road: 0x3d4045, field: [0x6a7a4a, 0x55663a], sun: 0xeef2ff, sunI: 2.0, hemi: [0xd6e2ff, 0x40444a], hemiI: 1.0 },
  3: { sky: [0x78b4dc, 0xdff0e8], fog: 0xbcd8d0, fogNear: 120, fogFar: 520, ground: [0x6f9446, 0x5a7d3a], road: 0x8a7350, field: [0xa7c24e, 0x7aa03a], sun: 0xfff6dc, sunI: 2.3, hemi: [0xe0f4ff, 0x4a5a32], hemiI: 1.15 },
  4: { sky: [0x1a1c22, 0x3a2a26], fog: 0x2a2224, fogNear: 60, fogFar: 260, ground: [0x5a5c60, 0x4a4c50], road: 0x3c3e42, field: [0x555, 0x444], sun: 0xffd2b0, sunI: 1.4, hemi: [0xffc8a8, 0x2a2a30], hemiI: 0.9 },
};

function canvasTex(w, h, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 地面の細かい模様(土の粒・金属床の鋲)
function groundDetail(indoor) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#d8d8d8';
    g.fillRect(0, 0, w, h);
    if (indoor) {
      g.strokeStyle = '#9a9a9a';
      g.lineWidth = 3;
      for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, h); g.stroke(); g.beginPath(); g.moveTo(0, i * 128); g.lineTo(w, i * 128); g.stroke(); }
      g.fillStyle = '#8a8a8a';
      for (let x = 12; x < w; x += 29) for (const y of [8, 120, 136, 248]) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
      for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},0,0.02)`; g.fillRect(Math.random() * w, Math.random() * h, 6, 6); }
    } else {
      for (let i = 0; i < 2600; i++) {
        const v = 150 + Math.random() * 105;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
      }
    }
  }, 1);
}

function stripeTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#222';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffc21a';
    for (let i = -h; i < w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 + h, h); g.lineTo(i + h, h); g.fill(); }
  }, 1);
}

export class World {
  constructor(scene, sim, opts = {}) {
    this.scene = scene;
    this.sim = sim;
    this.stage = sim.stage;
    this.theme = THEMES[sim.stage.area] || THEMES[1];
    this.root = new THREE.Group();
    scene.add(this.root);
    this.obMeshes = new Map();
    this.debrisMeshes = [];
    this.shadows = opts.shadows ?? true;
    this.buildSky();
    this.buildLights();
    this.buildTerrain();
    this.buildWater();
    this.buildBridges();
    this.buildObstacles();
    this.buildPads();
  }

  buildSky() {
    const th = this.theme;
    const geo = new THREE.SphereGeometry(900, 24, 12);
    const top = new THREE.Color(th.sky[0]), bot = new THREE.Color(th.sky[1]);
    const col = [];
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / 900);
      const c = bot.clone().lerp(top, Math.pow(t, 0.6));
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10;
    this.sky = sky;
    this.root.add(sky);
    this.scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
    this.scene.background = new THREE.Color(th.sky[1]);
    // 屋内:遠くの壁と天井の梁
    if (this.stage.indoor) {
      const hw = this.sim.terrain.hw, hd = this.sim.terrain.hd;
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x3b3a3e, roughness: 0.9, metalness: 0.3 });
      const red = new THREE.MeshBasicMaterial({ color: 0xff3a22 });
      for (const [x, z, w, d] of [[0, hd + 3, hw * 2 + 12, 6], [0, -hd - 3, hw * 2 + 12, 6], [hw + 3, 0, 6, hd * 2 + 12], [-hw - 3, 0, 6, hd * 2 + 12]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 24, d), wallMat);
        m.position.set(x, 12, z);
        this.root.add(m);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, 0.4, d + 0.2), red);
        strip.position.set(x, 8, z);
        this.root.add(strip);
      }
      const beamMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.8, metalness: 0.5 });
      for (let z = -hd; z <= hd; z += 30) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 12, 1.6, 1.2), beamMat);
        b.position.set(0, 24, z);
        this.root.add(b);
      }
    }
  }

  buildLights() {
    const th = this.theme;
    const hemi = new THREE.HemisphereLight(th.hemi[0], th.hemi[1], th.hemiI);
    this.root.add(hemi);
    const sun = new THREE.DirectionalLight(th.sun, th.sunI);
    sun.position.set(60, 120, -40);
    if (this.shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const c = sun.shadow.camera;
      c.left = -70; c.right = 70; c.top = 70; c.bottom = -70; c.near = 10; c.far = 300;
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.4;
    }
    this.sun = sun;
    this.root.add(sun);
    this.root.add(sun.target);
    // 屋内は赤い警告灯
    if (this.stage.indoor) {
      for (let i = 0; i < 4; i++) {
        const l = new THREE.PointLight(0xff4a2a, 30, 90, 1.6);
        l.position.set((i % 2 ? 1 : -1) * this.sim.terrain.hw * 0.5, 14, (i < 2 ? 1 : -1) * this.sim.terrain.hd * 0.5);
        this.root.add(l);
      }
    }
  }

  // 影の範囲をプレイヤーに合わせて動かす
  follow(x, z) {
    this.sun.position.set(x + 60, 120, z - 40);
    this.sun.target.position.set(x, 0, z);
    this.sky.position.set(x, 0, z);
  }

  buildTerrain() {
    const t = this.sim.terrain;
    const g = t.grid();
    const th = this.theme;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(g.nx * g.nz * 3);
    const col = new Float32Array(g.nx * g.nz * 3);
    const uv = new Float32Array(g.nx * g.nz * 2);
    const c0 = new THREE.Color(th.ground[0]), c1 = new THREE.Color(th.ground[1]);
    const cRoad = new THREE.Color(th.road), cF0 = new THREE.Color(th.field[0]), cF1 = new THREE.Color(th.field[1]);
    const cSand = new THREE.Color(0xb39a6a), cMud = new THREE.Color(0x5e4a32), cRim = new THREE.Color(th.ground[0]).multiplyScalar(0.8);
    const tmp = new THREE.Color();
    const st = this.stage;
    for (let j = 0; j < g.nz; j++) {
      for (let i = 0; i < g.nx; i++) {
        const k = j * g.nx + i;
        const x = g.x0 + i * g.cell, z = g.z0 + j * g.cell, h = g.h[k];
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        uv[k * 2] = x / 8; uv[k * 2 + 1] = z / 8;
        const n = (Math.sin(x * 0.07) * Math.cos(z * 0.05) + Math.sin(x * 0.013 + z * 0.021)) * 0.25 + 0.5;
        tmp.copy(c0).lerp(c1, n);
        if (!t.indoor) {
          for (const f of st.fields || []) if (inRect(x, z, f)) tmp.copy(cF0).lerp(cF1, (Math.floor((z - f.z) / 3) % 2 === 0) ? 0.2 : 0.8);
          for (const m of st.mud || []) if (rectDist(x, z, m) < 0) tmp.copy(cMud).lerp(new THREE.Color(0x4a6a8a), 0.25);
          for (const r of st.roads || []) { const d = segDist(x, z, r.pts); if (d < r.w / 2) tmp.lerp(cRoad, d < r.w / 2 - 1.5 ? 0.92 : 0.5); }
          for (const w of st.water || []) { const d = rectDist(x, z, w); if (d < 3 && d > -2) tmp.lerp(cSand, 0.6); else if (d <= -2) tmp.copy(cMud); }
        } else {
          // 金属床:区画の境目に赤いライン
          const lx = ((x % 64) + 64) % 64, lz = ((z % 64) + 64) % 64;
          if (lx < 1.2 || lz < 1.2) tmp.lerp(new THREE.Color(0x8a2a22), 0.5);
        }
        if (!t.inBounds(x, z)) tmp.lerp(cRim, 0.6);
        col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
      }
    }
    const idx = [];
    for (let j = 0; j < g.nz - 1; j++) {
      for (let i = 0; i < g.nx - 1; i++) {
        const a = j * g.nx + i, b = a + 1, c = a + g.nx, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: groundDetail(t.indoor), roughness: t.indoor ? 0.6 : 0.95, metalness: t.indoor ? 0.35 : 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = this.shadows;
    this.terrainMesh = mesh;
    this.root.add(mesh);
  }

  buildWater() {
    this.waterMeshes = [];
    const tex = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(120,170,200,0.5)';
      for (let i = 0; i < 40; i++) { g.beginPath(); const y = Math.random() * h; g.moveTo(Math.random() * w, y); g.lineTo(Math.random() * w, y + 2); g.stroke(); }
    }, 1);
    this.waterTex = tex;
    const mat = new THREE.MeshStandardMaterial({ color: this.stage.area === 3 ? 0x4a9ac0 : 0x3d7aa0, map: tex, transparent: true, opacity: 0.82, roughness: 0.15, metalness: 0.3 });
    for (const w of this.stage.water || []) {
      const geo = w.r != null ? new THREE.CircleGeometry(w.r + 2, 32) : new THREE.PlaneGeometry(w.w + 4, w.d + 4);
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(w.x, WATER_Y, w.z);
      if (w.rot) m.rotation.z = w.rot;
      tex.repeat.set(4, 4);
      this.root.add(m);
      this.waterMeshes.push(m);
    }
  }

  buildBridges() {
    const deck = new THREE.MeshStandardMaterial({ color: 0x7a6a52, roughness: 0.9 });
    const rail = new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.8, metalness: 0.4 });
    for (const b of this.stage.bridges || []) {
      const g = new THREE.Group();
      const d = new THREE.Mesh(new THREE.BoxGeometry(b.w, 0.6, b.d), deck);
      d.position.y = 0.05;
      d.receiveShadow = true;
      g.add(d);
      for (const s of [-1, 1]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.9, b.d), rail);
        r.position.set((s * b.w) / 2, 0.7, 0);
        g.add(r);
      }
      g.position.set(b.x, this.sim.terrain.height(b.x, b.z) * 0 + 0, b.z);
      this.root.add(g);
    }
  }

  buildObstacles() {
    const area = this.stage.area;
    for (const o of this.sim.obstacles.list) {
      const size = o.shape === 'box' ? { w: o.w, d: o.d, h: o.h } : { r: o.r, h: o.h };
      const m = buildProp(o.kind, size, area);
      m.position.set(o.x, this.sim.terrain.height(o.x, o.z) - 0.25, o.z);
      m.rotation.y = o.rot || 0;
      if (this.shadows) m.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      this.root.add(m);
      this.obMeshes.set(o.id, m);
    }
  }

  buildPads() {
    const stripes = stripeTex();
    this.pads = [];
    for (const e of this.sim.elevators) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5, 0.5, 24), new THREE.MeshStandardMaterial({ color: 0x444, map: stripes, roughness: 0.6, metalness: 0.4 }));
      base.position.y = 0.2;
      g.add(base);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.55, 24), new THREE.MeshStandardMaterial({ color: 0x6a6e74, roughness: 0.5, metalness: 0.6 }));
      top.position.y = 0.25;
      g.add(top);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(4.1, 0.15, 6, 32), new THREE.MeshBasicMaterial({ color: 0x55e0ff }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.55;
      g.add(ring);
      // 上向きの矢印
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2, 4), new THREE.MeshBasicMaterial({ color: 0x55e0ff, transparent: true, opacity: 0.7 }));
      arrow.position.y = 4;
      g.add(arrow);
      g.position.set(e.x, this.sim.terrain.height(e.x, e.z), e.z);
      this.root.add(g);
      this.pads.push({ g, ring, arrow, top });
    }
    // 脱出口(穴)
    const ex = this.sim.exit;
    if (ex) {
      const g = new THREE.Group();
      const hole = new THREE.Mesh(new THREE.CircleGeometry(ex.r, 32), new THREE.MeshBasicMaterial({ color: 0x050505 }));
      hole.rotation.x = -Math.PI / 2;
      hole.position.y = 0.08;
      g.add(hole);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(ex.r, 0.5, 8, 32), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, map: stripes }));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.2;
      g.add(rim);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(ex.r, ex.r, 60, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      beam.position.y = 30;
      g.add(beam);
      g.position.set(ex.x, this.sim.terrain.height(ex.x, ex.z), ex.z);
      g.visible = false;
      this.exitMesh = g;
      this.exitBeam = beam;
      this.root.add(g);
    }
  }

  update(dt, time) {
    if (this.waterTex) { this.waterTex.offset.x = time * 0.01; this.waterTex.offset.y = time * 0.006; }
    for (const p of this.pads) {
      const on = this.sim.elevUses > 0;
      p.ring.material.color.set(on ? 0x55e0ff : 0x444444);
      p.arrow.visible = on;
      p.arrow.position.y = 3.5 + Math.sin(time * 3) * 0.6;
      p.arrow.rotation.y = time;
    }
    if (this.exitMesh) {
      this.exitMesh.visible = !!this.sim.exit.open;
      this.exitBeam.material.opacity = 0.12 + Math.sin(time * 4) * 0.06;
    }
    // 開いた門は沈める
    for (const o of this.sim.gates) {
      const m = this.obMeshes.get(o.id);
      if (m && !o.alive && m.position.y > -o.h - 1) m.position.y -= dt * 2.5;
    }
    // 残骸
    for (const d of this.sim.debris) {
      if (d.mesh) continue;
      const m = buildProp('wreck', { r: d.r - 0.6, h: 2 }, this.stage.area);
      m.position.set(d.x, this.sim.terrain.height(d.x, d.z), d.z);
      m.rotation.y = d.yaw || 0;
      this.root.add(m);
      d.mesh = m;
      this.debrisMeshes.push(m);
    }
  }

  dispose() {
    this.scene.remove(this.root);
    // モデルのジオメトリは共有キャッシュなので捨てない。地形だけ捨てる
    this.terrainMesh.geometry.dispose();
    this.scene.fog = null;
  }
}
