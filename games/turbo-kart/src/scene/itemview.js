// アイテムの見た目: アイテムボックス・コース上の投げ物（バナナ・ボール）・バリア・スターの光
// race.items（core/items.js）の状態を毎フレーム描画に写すだけで、ゲームの判定には関わらない
import * as THREE from 'three';
import { roadHeight } from '../core/surface.js';
import { toon } from './style.js';
import { addOutline } from './theme.js';

function boxTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 128, 128);
  g.addColorStop(0, '#ff5ad1');
  g.addColorStop(0.5, '#ffd23f');
  g.addColorStop(1, '#4fc3ff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 116, 116);
  ctx.fillStyle = '#fff';
  ctx.font = '900 92px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(80,30,90,0.6)';
  ctx.strokeText('!', 64, 70);
  ctx.fillText('!', 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 投げ物の形
function makeObject(kind) {
  const g = new THREE.Group();
  if (kind === 'banana') {
    const peel = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.11, 8, 16, Math.PI * 1.1), toon({ color: 0xffd93b }));
    peel.rotation.set(Math.PI / 2, 0, 0.2);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), toon({ color: 0x5a3a12 }));
    tip.position.set(0.32, 0, 0);
    addOutline(peel, 0.02);
    g.add(peel, tip);
    g.userData.h = 0.15;
  } else {
    // ボール: 甲羅のような半球と白い縁取り
    const color = kind === 'homing' ? 0xff3b3b : 0x2fd06a;
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon({ color }));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.08, 8, 20), toon({ color: 0xffffff }));
    rim.rotation.x = Math.PI / 2;
    const dots = new THREE.Mesh(new THREE.IcosahedronGeometry(0.44, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 }));
    dots.scale.y = 0.6;
    addOutline(shell, 0.02);
    g.add(shell, rim, dots);
    g.userData.h = 0.1;
    g.userData.spin = true;
  }
  return g;
}

export class ItemView {
  constructor(scene, race) {
    this.scene = scene;
    this.race = race;
    this.group = new THREE.Group();
    scene.add(this.group);
    const items = race.items;
    // アイテムボックス（回転する半透明の箱）
    const geo = new THREE.BoxGeometry(1.1, 1.1, 1.1);
    const mat = new THREE.MeshBasicMaterial({ map: boxTexture(), transparent: true, opacity: 0.88 });
    this.boxes = new THREE.InstancedMesh(geo, mat, items.boxes.length);
    this.boxes.frustumCulled = false;
    this.group.add(this.boxes);
    this.boxY = items.boxes.map((b) => roadHeight(race.track, b.s, b.lateral) + 1.0);
    this.objs = new Map(); // id → mesh
    // バリア（シャボン玉）とスターの光
    this.shieldGeo = new THREE.SphereGeometry(1.0, 20, 14);
    this.shieldMat = new THREE.MeshBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0.25, depthWrite: false });
    this.starMat = new THREE.MeshBasicMaterial({ color: 0xffff66, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    this.aura = new Map(); // kart index → { shield, star }
    this.o = new THREE.Object3D();
    this.t = 0;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { o.geometry?.dispose?.(); });
  }

  // models: カートの見た目（race.karts と同じ順）
  update(dt, models, hideAuraFor = -1) {
    const race = this.race;
    const items = race.items;
    this.t += dt;
    const o = this.o;
    // ボックス: 取られたら消え、復活するときにふくらむ
    items.boxes.forEach((b, i) => {
      const left = b.respawnAt - race.time;
      const s = left > 0 ? (left < 0.4 ? 1 - left / 0.4 : 0.0001) : 1;
      o.position.set(b.x, this.boxY[i] + Math.sin(this.t * 2 + i) * 0.12, b.z);
      o.rotation.set(this.t * 0.9 + i, this.t * 1.3 + i, 0.4);
      o.scale.setScalar(s);
      o.updateMatrix();
      this.boxes.setMatrixAt(i, o.matrix);
    });
    this.boxes.instanceMatrix.needsUpdate = true;
    // 投げ物
    const alive = new Set();
    for (const ob of items.objects) {
      alive.add(ob.id);
      let m = this.objs.get(ob.id);
      if (!m) {
        m = makeObject(ob.kind);
        this.group.add(m);
        this.objs.set(ob.id, m);
      }
      const y = roadHeight(race.track, ob.s, ob.lateral);
      // 前に投げたバナナは放物線
      const arc = ob.fly > 0 ? Math.sin((ob.fly / 0.8) * Math.PI) * 2.2 : 0;
      m.position.set(ob.x ?? 0, y + (m.userData.h || 0) + arc, ob.z ?? 0);
      if (m.userData.spin) m.rotation.y += dt * 12;
    }
    for (const [id, m] of this.objs) {
      if (alive.has(id)) continue;
      this.group.remove(m);
      this.objs.delete(id);
    }
    // バリアとスター
    race.karts.forEach((e, i) => {
      const a = this.aura.get(i) || {};
      const model = models[i];
      const big = (race.spec.length || 2) / 2 + 0.4;
      const showShield = e.shield && i !== hideAuraFor;
      if (showShield && !a.shield) {
        a.shield = new THREE.Mesh(this.shieldGeo, this.shieldMat);
        model.group.add(a.shield);
      }
      if (a.shield) {
        a.shield.visible = showShield;
        a.shield.scale.set(big, 1.1, big * 0.7);
        a.shield.position.y = 0.8;
      }
      const showStar = e.star > 0 && i !== hideAuraFor;
      if (showStar && !a.star) {
        a.star = new THREE.Mesh(this.shieldGeo, this.starMat.clone());
        model.group.add(a.star);
      }
      if (a.star) {
        a.star.visible = showStar;
        if (showStar) {
          a.star.material.color.setHSL((this.t * 1.5) % 1, 1, 0.6);
          a.star.scale.set(big * (1 + Math.sin(this.t * 12) * 0.05), 1.2, big * 0.75);
          a.star.position.y = 0.8;
        }
      }
      this.aura.set(i, a);
    });
  }
}
