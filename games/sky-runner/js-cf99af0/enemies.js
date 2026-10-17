// 追加の敵 (鉱石とガラスの題材)。種類ごとに 出し方 (spawn)・動き (update)・攻撃 (fire)・倒されたとき (onDeath) を持つ。
// combat.js から呼ばれ、c は Combat (fireBullet / addEnemy などを使う)。モデルは結晶の形を Three.js で組み立てる
//   kamikaze: 体当たりしてきて、ぶつかると自分も爆発する
//   heavy:    大きい敵。同時に出しすぎない (ガンシップ・建設ロボと同じ扱い)
//   shielded: true を返す間は、弾を跳ね返す
//   big:      倒したときの爆発を大きくし、回復アイテムを落とすことがある
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const K = 1.8; // 敵の大きさの倍率 (近づいたときに画面いっぱいに迫って見えるように)

// 共有するジオメトリ (敵ごとに作り直さない)
const GEO = {
  dart: new THREE.OctahedronGeometry(1, 0).scale(0.55, 0.55, 2.2),
  lens: new THREE.CylinderGeometry(2.4, 2.4, 0.5, 10).rotateX(Math.PI / 2),
  lensCore: new THREE.SphereGeometry(0.9, 10, 8),
  tower: new THREE.CylinderGeometry(1.1, 1.5, 6, 6).translate(0, -4.4, 0), // 水晶塔の胴 (原点 = 頭。頭の 1.4〜7.4 m 下)
  towerHead: new THREE.OctahedronGeometry(1.4, 0),
  batBody: new THREE.OctahedronGeometry(0.8, 0).scale(0.8, 0.6, 1.3),
  batWing: new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.6, 0, 0, 0.7, 2.6, 0.3, -0.2], 3)),
  gem: new THREE.IcosahedronGeometry(1, 0),
  orb: new THREE.SphereGeometry(1, 12, 10),
};
GEO.batWing.computeVertexNormals();

// 被弾で白く光らせるため、マテリアルは敵ごとに作る (元の発光色を覚えておく)
function mat(color, emissive = 0x000000, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, flatShading: true, roughness: 0.2, metalness: 0.2, ...extra });
  m.userData.base = m.emissive.clone();
  return m;
}
function build(parts) {
  const g = new THREE.Group();
  const mats = [];
  for (const [geo, m, setup] of parts) {
    const mesh = new THREE.Mesh(geo, m);
    setup?.(mesh);
    g.add(mesh);
    if (!mats.includes(m)) mats.push(m);
  }
  return { mesh: g, mats };
}

export const EXTRA = {
  // ---- 水晶の矢 (CRYSTAL DART): 5 本が列になり、らせんを描きながら突っ込んでくる。近づくほど輪が小さくなる
  dart: {
    kamikaze: true,
    spawn(c, px, py) {
      const cx = px + rand(-8, 8), cy = THREE.MathUtils.clamp(py + rand(0, 4), 3, 12), dir = Math.random() < 0.5 ? 1 : -1;
      for (let k = 0; k < 5; k++) {
        const m = mat(0x9ff0ff, 0x2a8ab0);
        const e = { kind: 'dart', ...build([[GEO.dart, m]]), r: 1.1 * K, hp: 1, score: 200, t: 0, flash: 0, fireT: Infinity,
          cx, cy, z: SPAWN_Z - k * 9, phase: k * 0.7, dir };
        e.mesh.scale.setScalar(K);
        e.mesh.position.set(cx, cy, e.z);
        c.addEnemy(e, 0.8 * K);
      }
    },
    update(c, e, dt, scroll, ctx, p) {
      e.z += (scroll * 0.5 + 34) * dt;
      e.cx += (ctx.player.x - e.cx) * Math.min(1, dt * 0.4);
      e.cy += (ctx.player.y - e.cy) * Math.min(1, dt * 0.3);
      const R = 8 * THREE.MathUtils.clamp(-e.z / 160, 0.25, 1);
      const a = e.t * 3.2 * e.dir + e.phase;
      _a.set(e.cx + Math.cos(a) * R, Math.max(1.5, e.cy + Math.sin(a) * R * 0.7), e.z);
      _b.subVectors(_a, p); // 進む向き
      p.copy(_a);
      if (_b.lengthSq() > 1e-6) e.mesh.lookAt(_b.add(p)); // 先を進む向きに向け、きりもみさせる
      e.mesh.rotateZ(e.t * 8);
    },
  },

  // ---- ガラスのレンズ (PRISM LENS): 横から滑り込んで止まり、回りながら渦巻き状に弾をまき、反対側へ去る
  lens: {
    heavy: true,
    spawn(c, px, py) {
      const n = Math.random() < 0.4 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const side = (k ? -1 : 1) * (Math.random() < 0.5 ? 1 : -1);
        const glass = mat(0xd8f6ff, 0x2a6a88, { transparent: true, opacity: 0.85, forceSinglePass: true });
        const core = mat(0xffffff, 0x60e0ff);
        const e = { kind: 'lens', ...build([[GEO.lens, glass], [GEO.lensCore, core]]), r: 2.6 * K, hp: 5 + c.level, score: 800, t: 0, flash: 0, fireT: Infinity, delay: k * 0.25,
          state: 'slide', side, x0: px + side * 48, tx: px + side * rand(4, 11), y: THREE.MathUtils.clamp(py + rand(2, 6), 4, 14) + k * 5, z: c.holdZ(rand(-95, -70)), spin: 0, shotA: 0 };
        e.mesh.scale.setScalar(K);
        e.mesh.position.set(e.x0, e.y, e.z);
        c.addEnemy(e, 2 * K);
      }
    },
    update(c, e, dt, scroll, ctx, p) {
      if (e.state === 'slide') {
        p.x += (e.tx - p.x) * Math.min(1, dt * 2.2);
        // 横スクロールでは x を平面にそろえられるので、時間で止まる
        if (ctx.side ? e.t > 1.2 : Math.abs(e.tx - p.x) < 0.5) { e.state = 'hover'; e.hold = 3.5; e.fireT = 0.3 + e.delay; }
      } else if (e.state === 'hover') {
        e.hold -= dt;
        e.spin += dt * 4;
        if (e.hold <= 0) e.state = 'leave';
      } else {
        p.x -= e.side * 30 * dt;
        e.y += 4 * dt;
        if (ctx.side ? e.t > 9 : Math.abs(p.x - ctx.player.x) > 70) e.dead = true;
      }
      p.y = e.y + Math.sin(e.t * 1.7) * 1.2;
      p.z = e.z;
      e.mesh.lookAt(ctx.player);
      e.mesh.rotateZ(e.spin);
    },
    fire(c, e, ctx, p, lv) {
      if (e.state !== 'hover') return;
      e.fireT = 0.5 / Math.min(1.3, lv);
      // 3 発の扇を、向きを少しずつ回しながら撃つ (渦巻き)
      e.shotA += 0.7;
      for (const s of [-0.25, 0, 0.25]) c.fireBullet(p.clone(), ctx.player, Math.sin(e.shotA) * 0.35 + s);
    },
  },

  // ---- 水晶塔 (SPIRE TURRET): 前方の地面から突き出してくる砲台。せり上がると 3 連射する
  turret: {
    spawn(c, px) {
      const xs = Math.random() < 0.5 ? [px - rand(6, 13), px + rand(6, 13)] : [px + rand(-10, 10)];
      for (const [i, x] of xs.entries()) {
        const body = mat(0x6a4a9a, 0x1a0a30);
        const head = mat(0xff9af0, 0x803070);
        // 当たり・ロック・ミサイルは原点を見るので、原点を光る頭に置く (胴は下へ伸ばす)
        const made = build([[GEO.tower, body], [GEO.towerHead, head, (m) => { m.name = 'head'; }]]);
        const e = { kind: 'turret', ...made, r: 2.4 * K, hp: Math.round(4 + c.level * 1.5), score: 900, t: 0, flash: 0, fireT: Infinity, rise: 0, burst: 0 };
        e.head = e.mesh.getObjectByName('head');
        e.mesh.scale.setScalar(K);
        e.mesh.position.set(x, -2 * K, (c.sideMode ? SPAWN_Z - 60 : SPAWN_Z + 40) - i * 12);
        c.addEnemy(e, 1.8 * K);
      }
    },
    update(c, e, dt, scroll, ctx, p) {
      p.z += scroll * dt; // 地面と一緒に流れてくる
      if (p.z > -160) e.rise = Math.min(1, e.rise + dt * 1.4);
      p.y = 7.4 * K - 9.4 * K * (1 - e.rise) ** 3; // 地面からせり上がる (頭が 7.4 × K の高さまで)
      e.head.rotation.y += dt * 3;
      if (e.rise >= 1 && e.fireT === Infinity) e.fireT = 0.6;
    },
    fire(c, e, ctx, p, lv) {
      // 3 連射して、少し休む
      c.fireBullet(p.clone(), ctx.player, 0, 'shell');
      e.burst++;
      e.fireT = e.burst % 3 ? 0.22 : rand(1.8, 2.6) / lv;
    },
  },

  // ---- 結晶コウモリ (GLASS BAT): 6 匹が V 字の編隊で高空を来て、1 匹ずつ急降下して襲いかかり、また上へ抜ける
  bat: {
    kamikaze: true,
    spawn(c, px) {
      const cx = px + rand(-6, 6), top = Math.min(18, (c.ceilingY ?? 40) - 3);
      for (let k = 0; k < 6; k++) {
        const body = mat(0x6a4aa0, 0x8040c0); // 霧になじまない明るさに
        const wing = mat(0xc8a8ff, 0x4a2a8a, { transparent: true, opacity: 0.9, side: THREE.DoubleSide, forceSinglePass: true }); // 羽は 1 枚の三角なので両面
        const made = build([[GEO.batBody, body], [GEO.batWing, wing, (m) => { m.name = 'wL'; m.scale.x = -1; }], [GEO.batWing, wing, (m) => { m.name = 'wR'; }]]);
        const slot = k - 2.5;
        const e = { kind: 'bat', ...made, r: 1.4 * K, hp: 1, score: 250, t: 0, flapPh: k * 0.3, flash: 0, fireT: Infinity,
          state: 'cruise', x: cx + slot * 6.5, y: top - Math.abs(slot) * 1.2, z: SPAWN_Z - Math.abs(slot) * 6, diveT: 2.4 + k * 0.4, u: 0 };
        e.wL = e.mesh.getObjectByName('wL');
        e.wR = e.mesh.getObjectByName('wR');
        e.mesh.scale.setScalar(K);
        e.mesh.position.set(e.x, e.y, e.z);
        c.addEnemy(e, K);
      }
    },
    update(c, e, dt, scroll, ctx, p) {
      e.z += (scroll * 0.45 + (e.state === 'cruise' ? 36 : 52)) * dt;
      if (e.state === 'cruise') {
        p.set(e.x + Math.sin(e.t * 2) * 1.5, e.y, e.z);
        // 出てから決まった時間で、1 匹ずつ (0.4 秒ごとに) 降りはじめる
        if (e.t > e.diveT) {
          e.state = 'dive';
          e.from = p.clone();
          e.to = ctx.player.clone();
          e.dur = THREE.MathUtils.clamp((-e.z - 4) / (scroll * 0.45 + 52), 0.6, 1.4); // z = -4 で狙った所に届く時間
        }
      } else {
        // 急降下: 狙った位置まで弧を描いて降り、通り過ぎたら上へ抜ける
        e.u += dt / e.dur;
        const k = Math.min(1, e.u);
        p.set(THREE.MathUtils.lerp(e.from.x, e.to.x, k), THREE.MathUtils.lerp(e.from.y, e.to.y, Math.sin(k * Math.PI / 2)) + Math.max(0, e.u - 1) * 18, e.z);
      }
      const flap = Math.sin((e.t + e.flapPh) * (e.state === 'dive' ? 10 : 16)) * 0.7;
      e.wL.rotation.z = -flap;
      e.wR.rotation.z = flap;
      e.mesh.rotation.x = e.state === 'dive' && e.u < 1 ? 0.5 : 0;
    },
  },

  // ---- 跳ねる結晶 (BOUNCE GEM): 地面で大きく跳ねながら迫ってくる。撃つと 2 つに割れて斜めに跳ね散る
  bouncer: {
    kamikaze: true,
    spawn(c, px) {
      const n = Math.random() < 0.5 ? 2 : 1;
      for (let k = 0; k < n; k++) EXTRA.bouncer.make(c, px + rand(-10, 10), SPAWN_Z - k * 18, 2.4 * K, 0, 3 + c.level);
    },
    make(c, x, z, size, vx, hp) {
      const m = mat(0xffd36a, 0x7a4a10);
      const e = { kind: 'bouncer', ...build([[GEO.gem, m]]), r: size, size, hp, score: size > 3 ? 600 : 150, t: 0, flash: 0, fireT: Infinity,
        vx, vy: rand(4, 10), z, x, dmg: size > 3 ? 25 : 15 };
      e.mesh.scale.setScalar(size);
      e.mesh.position.set(x, size + 6, z);
      c.addEnemy(e, size);
      return e;
    },
    update(c, e, dt, scroll, ctx, p) {
      e.z += (scroll * 0.5 + 22) * dt;
      e.vy -= 30 * dt;
      p.y += e.vy * dt;
      if (p.y < e.size) {
        p.y = e.size;
        e.vy = e.size > 3 ? rand(16, 20) : rand(11, 14); // 着地したら、また跳ねる
      }
      if (c.ceilingY && p.y > c.ceilingY - e.size) { p.y = c.ceilingY - e.size; e.vy = -Math.abs(e.vy); }
      e.x += (e.vx + (ctx.player.x - e.x) * 0.35) * dt;
      p.x = e.x;
      p.z = e.z;
      e.mesh.rotation.x += dt * 3;
      e.mesh.rotation.z += dt * 2;
    },
    onDeath(c, e) {
      if (e.size < 3) return;
      for (const s of [-1, 1]) {
        const half = EXTRA.bouncer.make(c, e.mesh.position.x + s * 2.5, e.mesh.position.z, 1.2 * K, s * 9, 1);
        half.mesh.position.y = e.mesh.position.y;
        half.vy = 12;
      }
    },
  },

  // ---- 衛星コア (ORBIT CORE): 8 の字を描いて漂うコアのまわりを、3 つの衛星が回って守る。
  // 衛星が残っている間、コアは弾を跳ね返す。全部落とすとコアが撃ってくる
  orbiter: {
    heavy: true, big: true,
    spawn(c, px, py) {
      const core = mat(0x80ffd0, 0x20a070);
      const e = { kind: 'orbiter', ...build([[GEO.orb, core]]), r: 2 * K, hp: 8 + c.level * 2, score: 1500, t: 0, flash: 0, fireT: Infinity,
        cx: px + rand(-5, 5), cy: THREE.MathUtils.clamp(py + rand(2, 5), 5, 13), z: SPAWN_Z, sats: [] };
      e.mesh.scale.setScalar(1.8 * K);
      e.mesh.position.set(e.cx, e.cy, e.z);
      c.addEnemy(e, 1.6 * K);
      for (let k = 0; k < 3; k++) {
        const m = mat(0xffffff, 0x4060ff);
        const s = { kind: 'satellite', ...build([[GEO.gem, m]]), r: 1.1 * K, hp: 2, score: 300, t: 0, flash: 0, fireT: Infinity, core: e, a: (k / 3) * Math.PI * 2 };
        s.mesh.scale.setScalar(0.9 * K);
        s.mesh.position.copy(e.mesh.position);
        c.addEnemy(s, 0.8 * K);
        e.sats.push(s);
      }
    },
    shielded: (e) => e.sats.some((s) => !s.dead),
    update(c, e, dt, scroll, ctx, p) {
      const hz = c.holdZ(-70);
      e.z = Math.min(hz, e.z + (scroll * 0.4 + 22) * dt);
      if (e.z >= hz) e.hold = (e.hold || 0) + dt;
      const leave = (e.hold || 0) > 8;
      p.set(e.cx + Math.sin(e.t * 0.9) * 12, e.cy + Math.sin(e.t * 1.8) * 3 + (leave ? (e.hold - 8) * 10 : 0), e.z);
      if (p.y > 50) e.dead = true;
      const open = !EXTRA.orbiter.shielded(e);
      if (open && e.fireT === Infinity) {
        e.fireT = 0.8;
        e.mats[0].userData.base = new THREE.Color(0xff4060); // 守りがなくなったコアは赤く光る
      }
    },
    fire(c, e, ctx, p, lv) {
      e.fireT = 1.4 / lv;
      for (const sp of [-0.15, 0, 0.15]) c.fireBullet(p.clone(), ctx.player, sp);
    },
  },

  // 衛星 (衛星コアの部品): コアのまわりを回る。体当たりで傷つく
  satellite: {
    kamikaze: true,
    spawn() {},
    update(c, e, dt, scroll, ctx, p) {
      const core = e.core;
      if (core.dead) { e.dead = true; c.explode(p); return; }
      e.a += dt * 2.4;
      const R = 4.8 * K;
      p.set(core.mesh.position.x + Math.cos(e.a) * R, core.mesh.position.y + Math.sin(e.a) * R * 0.6, core.mesh.position.z + Math.sin(e.a) * R * 0.5);
      e.mesh.rotation.y += dt * 4;
    },
  },
};
