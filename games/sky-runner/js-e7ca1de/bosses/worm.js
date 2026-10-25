// ボス: 砂岩の大蛇 (SANDSTONE WYRM)。8 面。前方の地面から弧を描いて飛び出し、また潜る。
// 飛び出す 1 秒前に、地面に茶色い印と砂煙が出る。体の節は硬く (弾を跳ね返す)、頭だけが弱点。地上に出ている間だけ撃てる。
// 3D ではプレイヤーの前を左右に横切って飛び、横スクロールでは画面の面の中で前後に飛ぶ。頭が一番高い所で扇の弾を撃ち、
// 頂上を越えたあとは、地上に出ている一番うしろの節 (しっぽ) からミサイルを 3 発撃つ
import * as THREE from 'three';
import { sfx } from '../audio.js';
import { bossModel, eyeGuard } from '../enemies.js';

const rand = (a, b) => a + Math.random() * (b - a);
const HIDE_Y = -60; // 潜っている間の置き場所 (当たらない)
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

const GEO = {
  head: new THREE.DodecahedronGeometry(1, 0),
  jaw: new THREE.ConeGeometry(0.7, 1.6, 5).rotateX(Math.PI / 2),
  seg: new THREE.DodecahedronGeometry(1, 0),
  marker: new THREE.RingGeometry(2, 3.4, 20).rotateX(-Math.PI / 2),
};

function mat(color, emissive, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, flatShading: true, roughness: 0.85, metalness: 0.1, ...extra });
  m.userData.base = m.emissive.clone();
  return m;
}

export function spawnWorm(c, def) {
  const side = c.sideMode;
  const k = side ? 0.65 : 1.4; // 3D は大きく (50 m 先でも迫力が出るように)
  const hp = def.hp || 320;
  // 頭: Blender のモデル (WormHead) か、読み込む前は図形で
  const hm = bossModel('wormHead', ['WormSand', 'WormEye']) || (() => {
    const headM = mat(0xc89a5a, 0x000000);
    const eyeM = mat(0x80ffd0, 0x40c090);
    const grp = new THREE.Group();
    const head = new THREE.Mesh(GEO.head, headM);
    head.scale.set(3, 2.4, 3.6);
    grp.add(head);
    for (const sx of [-1, 1]) {
      const jaw = new THREE.Mesh(GEO.jaw, headM);
      jaw.position.set(sx * 1.4, -0.8, 3.4);
      jaw.scale.setScalar(1.4);
      grp.add(jaw);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), eyeM);
      eye.position.set(sx * 1.5, 0.9, 2.6);
      grp.add(eye);
    }
    return { mesh: grp, mats: [headM, eyeM] };
  })();
  const g = hm.mesh;
  g.scale.setScalar(k);
  const grp = { type: 'worm', t: 0, escape: Infinity, total: 1, kills: 0, leaving: false, bonus: 10000 };
  const w = {
    kind: 'worm', mesh: g, mats: hm.mats, r: 3.4 * k, hp, maxHp: hp, score: 0, t: 0, flash: 0, fireT: Infinity,
    k, state: 'under', timer: 2.5, u: 0, path: [], segs: [], from: new THREE.Vector3(), to: new THREE.Vector3(), apex: 14, dur: 2.4,
    fired: false, dir: 1, bossGroup: grp, noLock: true,
  };
  grp.ratio = () => Math.max(0, w.hp / w.maxHp);
  c.bossGroup = grp;
  g.position.set(0, HIDE_Y, -50);
  // 飛び出す場所の印: 1 つを使い回す (飛ぶたびに材質を作らない)。combat.remove が片付ける
  w.marker = new THREE.Mesh(GEO.marker, new THREE.MeshBasicMaterial({ color: 0xff8a30, transparent: true, opacity: 0.8, depthWrite: false }));
  w.marker.visible = false;
  c.scene.add(w.marker);
  c.addEnemy(w, 3 * k);
  w.shadow.visible = false;
  for (let i = 0; i < 11; i++) {
    // 体の節: Blender のモデル (WormSeg。半径 1) か図形で。1 つおきに少し暗い色
    const sm = bossModel('wormSeg', ['WormSegSand']);
    if (sm && i % 2) sm.mats[0].color.setHex(0xa8804a);
    const fm = sm ? null : mat(i % 2 ? 0xa8804a : 0xb88e56, 0x000000);
    const mesh = sm ? sm.mesh : new THREE.Mesh(GEO.seg, fm);
    const m = sm ? sm.mats : [fm];
    const s = 2.6 * (1 - i * 0.05) * k;
    mesh.scale.set(s, s * 0.85, s);
    const seg = { kind: 'wormSeg', mesh, mats: m, r: s * 0.9, hp: Infinity, score: 0, t: 0, flash: 0, fireT: Infinity, head: w, idx: i, noLock: true, dmg: 20 };
    mesh.position.set(0, HIDE_Y, -50);
    c.addEnemy(seg, 0);
    seg.shadow.visible = false;
    w.segs.push(seg);
  }
  c.bossDefeated = false;
}

export const WORM_KINDS = {
  worm: {
    big: true,
    sideAbs: true,
    shielded: (e) => e.state !== 'leap', // 潜っている間は撃てない
    update(c, e, dt, scroll, ctx, p) {
      const P = ctx.player;
      e.timer -= dt;
      if (e.state === 'under') {
        p.set(0, HIDE_Y, -50);
        if (e.timer <= 0) {
          // 次に飛び出す場所を決めて、地面に印を出す (1 秒の予告)
          e.dir *= -1;
          e.leaps = (e.leaps || 0) + 1;
          // 跳び方は「横切る → 体当たり → 横切る → 頭上越え」のくり返し (横スクロールは横切るだけ)
          const kind = ctx.side ? 'cross' : ['over', 'cross', 'lunge', 'cross'][e.leaps % 4];
          e.charge = kind === 'over'; // 正面から頭の上を越えて背後へ潜る
          e.lunge = kind === 'lunge'; // 体当たり: そのときいた所へ、まっすぐ突っ込んでくる
          const z = c.holdZ(rand(-44, -30));
          if (e.lunge) {
            // 60 m 先の地面から飛び出し、プレイヤーのいた所 (高さも) へまっすぐ。最初の 0.3 秒で起き上がり、そのあとは毎秒 34 m
            e.from.set(P.x + rand(-2, 2), -4, P.z - 60);
            e.to.copy(P);
            e.dur = 60 / 34 + 0.3;
            e.eyeChecked = false;
            e.veer = 0;
          } else if (e.charge) {
            // プレイヤーの真上を 9 m ほどで通るよう、放物線の高さを決める (前 55 m から後ろ 25 m へ)
            const x = P.x + rand(-3, 3);
            e.from.set(x, -4, P.z - 55);
            e.to.set(x, -4, P.z + 25);
            const u = 55 / 80;
            e.apex = (P.y + 9 + 4) / (4 * u * (1 - u)) - 4;
            e.dur = 2.6;
          } else if (ctx.side) {
            e.from.set(0, -4, -42);
            e.to.set(0, -4, -6);
            if (e.dir < 0) [e.from.z, e.to.z] = [e.to.z, e.from.z];
          } else {
            const span = rand(16, 24);
            e.from.set(P.x - e.dir * span, -4, z);
            e.to.set(P.x + e.dir * span, -4, z + rand(-6, 6));
          }
          if (!e.charge && !e.lunge) {
            e.apex = ctx.side ? 15 : rand(11, 16) + P.y * 0.5; // 高く飛んでいても届くように
            e.dur = Math.max(2.4, 2.9 - (c.level - 1) * 0.05); // 弾が届くよう、ゆっくり跳ぶ
          }
          e.marker.position.set(e.from.x, 0.08, e.from.z);
          e.marker.visible = true;
          e.state = 'warn';
          e.timer = 1;
        }
      } else if (e.state === 'warn') {
        p.set(0, HIDE_Y, -50);
        e.marker.material.opacity = 0.4 + 0.5 * Math.abs(Math.sin(e.t * 12));
        if (Math.random() < dt * 14) c.sparks.emit(_a.set(e.from.x + rand(-2, 2), 0.5, e.from.z + rand(-2, 2)), new THREE.Vector3(rand(-2, 2), rand(3, 7), rand(-2, 2)), new THREE.Color(0xc8a070), 1.4, 0.6); // 砂煙
        if (e.timer <= 0) {
          e.marker.visible = false;
          e.state = 'leap';
          e.u = 0;
          if (e.charge) sfx.roar();
          e.fired = false;
          e.tailShots = 0;
          e.tailT = 0;
          e.path = [];
        }
      } else {
        if (e.lunge) { lunge(c, e, dt, ctx, p); return; }
        // 弧を描いて飛ぶ (放物線)。頭上を越えるときは、頂上の高さを今のプレイヤーの高さに合わせ直す (上へ動いても当たらない)
        if (e.charge) e.apex = (P.y + 9 + 4) / (4 * (55 / 80) * (25 / 80)) - 4;
        e.u += dt / e.dur;
        const u = Math.min(1, e.u);
        e.vel = e.vel || new THREE.Vector3();
        const px = p.x, py = p.y, pz = p.z;
        p.lerpVectors(e.from, e.to, u);
        p.y = -4 + (e.apex + 4) * 4 * u * (1 - u);
        // 進む向きに頭を向ける
        _a.lerpVectors(e.from, e.to, Math.min(1, u + 0.02));
        _a.y = -4 + (e.apex + 4) * 4 * Math.min(1, u + 0.02) * (1 - Math.min(1, u + 0.02));
        if (u < 1) e.mesh.lookAt(_a);
        e.vel.set(p.x - px, p.y - py, p.z - pz).divideScalar(Math.max(dt, 1e-3)); // エイムアシストの先読みに使う
        e.path.unshift(p.clone());
        if (e.path.length > 200) e.path.length = 200;
        if (!e.fired && u > (e.charge ? 0.3 : 0.45)) {
          e.fired = true;
          if (e.charge) sfx.whoosh();
          for (let s = -2; s <= 2; s++) c.fireBullet(p.clone(), P, s * 0.14);
        }
        // しっぽからミサイル: 頂上を越えたら、地上に出ている一番うしろの節から 3 発 (頭の上を越えるときは岩くずを降らせるので撃たない)
        if (!e.charge && u > 0.5 && e.tailShots < 3 && (e.tailT -= dt) <= 0) {
          const tail = e.segs.findLast((sg) => sg.mesh.visible && sg.mesh.position.y > 1);
          if (tail) {
            e.tailShots++;
            e.tailT = 0.4 / (1 + (c.level - 1) * 0.05);
            c.fireBullet(tail.mesh.position.clone(), P, rand(-0.12, 0.12), 'shell');
            sfx.enemyShot();
          }
        }
        // 突っ込むときは、頭の上を越えたあとも節から岩くずを降らせる
        if (e.charge && u > 0.5 && u < 0.68 && Math.random() < dt * 6) c.fireBullet(p.clone(), _b.set(P.x + (Math.random() < 0.5 ? -1 : 1) * rand(2.5, 4.5), P.y - 1, P.z + rand(-2, 4)), 0, 'shell'); // 真上からは当てない (少し横へ落とす)
        if (u >= 1 && e.segs.every((s) => s.mesh.position.y < -1)) {
          e.state = 'under';
          e.timer = rand(1.2, 2) / (1 + (c.level - 1) * 0.05);
        }
        if (u >= 1) p.y = HIDE_Y;
      }
      e.noLock = e.state !== 'leap' || p.y < 0;
    },
    onDeath(c, e) {
      c.scene.remove(e.marker);
      e.marker.material.dispose();
      for (const s of e.segs) if (!s.dead) { s.dead = true; if (s.mesh.position.y > 0) c.explode(s.mesh.position, false); }
    },
  },

  // 体の節: 頭の通った道をたどる。硬くて弾を跳ね返す。地面の下では隠す
  wormSeg: {
    sideAbs: true,
    shielded: () => true,
    update(c, e, dt, scroll, ctx, p) {
      const h = e.head;
      if (h.dead) { e.dead = true; return; }
      const i = Math.round((e.idx + 1) * 4.5); // 何フレーム前の頭の位置をたどるか
      const q = h.state === 'leap' ? h.path[Math.min(i, h.path.length - 1)] : null;
      if (q && h.path.length > i && q.y > -2) {
        p.copy(q);
        e.mesh.visible = true;
      } else {
        p.set(0, HIDE_Y, -50);
        e.mesh.visible = false;
      }
    },
  },
};

// 体当たり (LUNGE): 地面から飛び出して起き上がり (0.3 秒)、そのときいた所へまっすぐ突っ込む (追わない)。
// 頭が目の 8 m 手前に来たら、当たる位置なら砂をはね上げて潜り 25 (目の中を通らない)。外れていれば横へそれて潜る
function lunge(c, e, dt, ctx, p) {
  const P = ctx.player;
  e.u += dt;
  const px = p.x, py = p.y, pz = p.z;
  if (e.diving) {
    // 潜る: 下へ急いで沈み、そのまま地面の中へ
    e.diving += dt;
    p.y -= 40 * dt;
    p.x += (e.veer || 0) * 20 * dt;
    p.z += 10 * dt;
  } else if (e.u < 0.3) {
    // 起き上がる: 地面から斜めに頭を出す (砂煙)
    const k = e.u / 0.3;
    p.set(e.from.x, -4 + (e.to.y + 4) * k * 0.8, e.from.z + 6 * k);
    if (Math.random() < dt * 30) c.sparks.emit(_a.set(e.from.x + rand(-2, 2), 0.5, e.from.z + rand(-2, 2)), new THREE.Vector3(rand(-3, 3), rand(4, 9), rand(-1, 3)), new THREE.Color(0xc8a070), 1.6, 0.7);
  } else {
    if (!e.lungeVel) {
      e.lungeVel = _b.subVectors(e.to, p).normalize().multiplyScalar(34).clone();
      sfx.roar();
    }
    p.addScaledVector(e.lungeVel, dt);
    if (!e.fired && p.z > P.z - 40) {
      e.fired = true;
      for (let s = -1; s <= 1; s++) c.fireBullet(p.clone(), P, s * 0.16); // 突っ込みながら 3 発
    }
    // 目の 8 m 手前: 当たる位置なら潜って 25。外れていれば横へそれて潜る
    if (eyeGuard(c, e, ctx, p, e.r, 25, 0.8)) {
      e.dead = false; // 頭は倒れない (eyeGuard は砕けた物を消すので、戻す)
      e.noHit = true;
      e.diving = 0.001;
      c.sparks.emit(p.clone(), new THREE.Vector3(0, 8, 0), new THREE.Color(0xc8a070), 3, 0.8);
    } else if (e.eyeChecked && !e.diving) {
      e.diving = 0.001;
    }
  }
  if (!e.diving || p.y > -2) {
    _a.set(p.x + (p.x - px), p.y + (p.y - py), p.z + (p.z - pz));
    if (_a.distanceToSquared(p) > 1e-6) e.mesh.lookAt(_a);
  }
  e.vel = e.vel || new THREE.Vector3();
  e.vel.set(p.x - px, p.y - py, p.z - pz).divideScalar(Math.max(dt, 1e-3));
  e.path.unshift(p.clone());
  if (e.path.length > 200) e.path.length = 200;
  // 頭も節もみな地面の下に入ったら、次の跳び方へ
  if (e.diving && p.y < -6 && e.segs.every((sg) => sg.mesh.position.y < -1)) {
    e.lunge = false;
    e.lungeVel = null;
    e.diving = 0;
    e.noHit = false;
    e.state = 'under';
    e.timer = rand(1.2, 2) / (1 + (c.level - 1) * 0.05);
    p.y = HIDE_Y;
  }
}
