// 後半の面の新しい敵 (2026-10-25 にユーザーの希望で追加: 新しい敵が出ない面をなくす)。enemies.js の EXTRA と同じ形。
//   8 面 岩の亀・11 面 砂時計の番人・13 面 巨大オニヤンマ (編隊)・14 面 地面を走る巨大蜘蛛・15 面 黒曜石のエイ・
//   16 面 雷の結晶球・17 面 磁石の浮遊機雷
// モデルは Blender (assets/enemies.glb。models.blend の Zako の、その面の列)。読み込む前は簡単な図形で出す。
// どれも迫力の決まり (VR 版) に合わせる: 予告 0.8 秒以上、最後はまっすぐ、目の 6 m 以内に大きな物を入れない
import * as THREE from 'three';
import { model, mat, eyeGuard, veerAway } from './enemies.js';
import { sfx } from './audio.js';

const rand = (a, b) => a + Math.random() * (b - a);
const SPAWN_Z = -230;
const _a = new THREE.Vector3();

// 読み込む前に使う代わりの形
const GEO = {
  dome: new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  glass: new THREE.CylinderGeometry(1.6, 1.6, 8, 10),
  body: new THREE.OctahedronGeometry(1, 0),
  orb: new THREE.IcosahedronGeometry(1, 1),
};
// 名前の付いた材質 (光らせる所) を探す
const findMats = (made, name) => made.mats.filter((m) => m.name === name);

export const LATE_KINDS = {
  // ---- 8 面 岩の亀 (ROCK TORTOISE): 横の地面を歩いてくる。甲羅は弾を跳ね返す。
  // 120 m 先で首を出して目が光り (0.8 秒)、岩を 2 発投げる。首を出している 1.6 秒だけ倒せる
  tortoise: {
    heavy: true, big: true,
    shielded: (e) => e.open < 0.5,
    spawn(c, px) {
      const n = Math.random() < 0.5 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const side = (k ? -1 : 1) * (Math.random() < 0.5 ? 1 : -1);
        const made = model('tortoise', [[GEO.dome, mat(0x6a5440, 0, { own: true }), (m) => m.scale.set(3, 1.9, 3.6)]], true);
        const e = { kind: 'tortoise', ...made, r: 3.2, hp: 4 + c.level, score: 700, t: 0, flash: 0, fireT: Infinity,
          x: px + side * rand(10, 16), z: SPAWN_Z - k * 30, state: 'walk', timer: 0, open: 0,
          head: made.mesh.getObjectByName('TortoiseHead'), eyes: findMats(made, 'TortEye') };
        if (e.head) e.headZ = e.head.position.z;
        e.mesh.position.set(e.x, 1.8, e.z);
        c.addEnemy(e, 3.5);
      }
    },
    update(c, e, dt, scroll, ctx, p) {
      const P = ctx.player;
      e.z += (scroll + 5) * dt; // 地面と一緒に流れながら、少し歩く
      e.timer += dt;
      if (e.state === 'walk' && e.z > -120) { e.state = 'warn'; e.timer = 0; }
      else if (e.state === 'warn' && e.timer >= 0.8) {
        e.state = 'open';
        e.timer = 0;
        for (const s of [-0.08, 0.08]) c.fireBullet(_a.set(e.x, 3, e.z + 3).clone(), P, s, 'shell'); // 岩を 2 発
      } else if (e.state === 'open' && e.timer >= 1.6) e.state = 'done';
      // 首を出す (予告の間に出てきて、撃てる間は出したまま)
      const want = e.state === 'warn' || e.state === 'open' ? 1 : 0;
      e.open += THREE.MathUtils.clamp(want - e.open, -dt * 3, dt * 3);
      if (e.head) e.head.position.z = e.headZ - 1.2 * e.open; // モデルは前が -Z
      for (const m of e.eyes) m.userData.base.setHex(e.state === 'warn' ? 0xffd040 : 0xff9020).multiplyScalar(e.state === 'warn' ? 0.6 + 0.4 * Math.abs(Math.sin(e.t * 14)) : 1);
      p.set(e.x, 1.8 + Math.abs(Math.sin(e.t * 3)) * 0.12, e.z);
      e.mesh.rotation.y = Math.atan2(P.x - p.x, P.z - p.z) * 0.6;
      if (p.z > 30) e.dead = true;
    },
  },

  // ---- 11 面 砂時計の番人 (HOURGLASS): 地面に立つ高さ 8 m の砂時計。砂が落ちる (3.5 秒)。最後の 1 秒は赤く光り、
  // ひっくり返って光の輪を 4 発。落ちきる前に壊すと点が 2 倍
  hourglass: {
    big: true,
    spawn(c, px) {
      const n = Math.random() < 0.4 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const side = (k ? -1 : 1) * (Math.random() < 0.5 ? 1 : -1);
        const made = model('hourglass', [[GEO.glass, mat(0xffd36a, 0x5a4010, { own: true })]], true);
        const e = { kind: 'hourglass', ...made, r: 2.6, hp: 5 + Math.ceil(c.level / 2), score: 1200, t: 0, flash: 0, fireT: Infinity,
          x: px + side * rand(8, 14), z: SPAWN_Z - k * 25, sand: 1, flipT: -1, flips: 0,
          top: made.mesh.getObjectByName('HGSandTop'), bot: made.mesh.getObjectByName('HGSandBot'), frame: findMats(made, 'HGFrame') };
        e.mesh.position.set(e.x, 4.25, e.z);
        c.addEnemy(e, 2.6);
      }
    },
    update(c, e, dt, scroll, ctx, p) {
      e.z += scroll * dt; // 地面に立って流れてくる
      p.set(e.x, 4.25, e.z);
      if (e.flipT >= 0) {
        // ひっくり返る (0.5 秒)
        e.flipT += dt;
        e.mesh.rotation.z = Math.PI * Math.min(1, e.flipT / 0.5);
        if (e.flipT >= 0.5) {
          e.flipT = -1;
          e.mesh.rotation.z = 0;
          e.sand = 1;
          e.flips++;
          e.score = 600; // ひっくり返ったあとは、ふつうの点
          for (const s of [-0.3, -0.1, 0.1, 0.3]) c.fireBullet(_a.set(p.x, p.y + 1, p.z).clone(), ctx.player, s, 'ring');
        }
      } else if (e.z > -170 && e.z < -30) {
        e.sand = Math.max(0, e.sand - dt / 3.5);
        if (e.sand <= 0) e.flipT = 0;
      }
      if (e.top) e.top.scale.y = Math.max(0.03, e.sand);
      if (e.bot) e.bot.scale.y = Math.max(0.03, 1 - e.sand);
      // 最後の 1 秒は赤く光る (予告)
      const warn = e.sand < 1 / 3.5 && e.flipT < 0;
      for (const m of e.frame) m.userData.base.setHex(warn ? 0xff3020 : 0x5a4010).multiplyScalar(warn ? 0.5 + 0.5 * Math.abs(Math.sin(e.t * 14)) : 1);
      if (p.z > 30) e.dead = true;
    },
  },

  // ---- 13 面 巨大オニヤンマ (GIANT DRAGONFLY): 羽を広げて 10 m。3 匹の V 字の編隊で来て、60 m 先でそろって止まり、
  // ぴゅっと横へ動く・止まって撃つを 3 回くり返す。最後は編隊のまま、プレイヤーの横 12 m 以上を一気にかすめて抜ける
  dragonfly: {
    heavy: true,
    spawn(c, px, py) {
      const G = { state: 'approach', cx: px + rand(-10, 10), cy: THREE.MathUtils.clamp((py ?? 6) + rand(3, 6), 6, Math.min(18, (c.ceilingY ?? 40) - 4)), z: SPAWN_Z, t: 0, darts: 0, members: [] };
      const slots = [[0, 0], [-8, -7], [8, -7]]; // V 字 (先頭と、左右うしろ)
      for (const [ox, oz] of slots) {
        const made = model('dragonfly', [[GEO.body, mat(0x14181c, 0), (m) => m.scale.set(1, 1, 5)]]);
        const e = { kind: 'dragonfly', ...made, pack: G, r: 2.6, hp: 4 + Math.ceil(c.level / 2), score: 600, t: rand(0, 1), flash: 0, fireT: Infinity, G, ox, oz,
          wings: [0, 1, 2, 3].map((i) => made.mesh.getObjectByName(`DragonWing${i}`)).filter(Boolean) };
        e.mesh.position.set(G.cx + ox, G.cy, G.z + oz);
        G.members.push(e);
        c.addEnemy(e, 2);
      }
    },
    update(c, e, dt, scroll, ctx, p) {
      const G = e.G, P = ctx.player;
      // 編隊の動きは、生き残っている最初の 1 匹が 1 フレームに 1 回だけ進める
      if (G.members.find((m) => !m.dead) === e) {
        G.t += dt;
        if (G.state === 'approach') {
          G.z += (scroll * 0.5 + 45) * dt;
          if (G.z > -60) { G.state = 'hover'; G.t = 0; G.tx = G.cx; G.ty = G.cy; }
        } else if (G.state === 'hover') {
          // 止まる (1 秒、撃つ) → ぴゅっと横へ (0.35 秒) を 3 回
          G.z += scroll * 0.05 * dt;
          if (G.t > 1.35) {
            G.t = 0;
            G.darts++;
            if (G.darts > 3) {
              G.state = 'swoop';
              G.side = Math.sign(G.cx - P.x) || 1;
              sfx.whoosh();
            } else {
              G.tx = P.x + rand(-14, 14);
              G.ty = THREE.MathUtils.clamp(P.y + rand(2, 7), 5, Math.min(18, (c.ceilingY ?? 40) - 4));
              for (const m of G.members) if (!m.dead) m.fireT = rand(0.05, 0.3); // 止まったら撃つ
            }
          }
          const k = G.t < 0.35 ? Math.min(1, dt * 10) : Math.min(1, dt * 2);
          G.cx += (G.tx - G.cx) * k;
          G.cy += (G.ty - G.cy) * k;
        } else {
          // かすめて抜ける: 編隊ごと、プレイヤーの横 12 m 以上を通る
          G.z += (scroll * 0.6 + 55) * dt;
          G.cx += (P.x + G.side * 14 - G.cx) * Math.min(1, dt * 3);
          for (const m of G.members) m.noHit = true;
        }
      }
      // 自分の位置: 編隊の中の場所。抜けるときは横に一列 (内側でも 12 m 以上離れる)
      const swoop = G.state === 'swoop';
      const ox = swoop ? G.side * Math.abs(e.ox) * 0.5 : e.ox;
      p.set(G.cx + ox + Math.sin(e.t * 2) * 0.4, G.cy + Math.sin(e.t * 3 + e.ox) * 0.5, G.z + e.oz);
      e.mesh.rotation.y = swoop ? 0 : Math.atan2(P.x - p.x, P.z - p.z) * 0.5;
      e.mesh.rotation.z = THREE.MathUtils.clamp((G.tx ?? G.cx) - G.cx, -10, 10) * -0.03;
      // 羽ばたき (速い)
      const flap = Math.sin(e.t * 38) * 0.35;
      for (const w of e.wings) w.rotation.z = Math.sign(w.position.x) * flap;
      if (p.z > 30) e.dead = true;
    },
    fire(c, e, ctx, p) {
      e.fireT = Infinity;
      if (e.G.state === 'hover') c.fireBullet(p.clone(), ctx.player);
    },
  },

  // ---- 14 面 地面を走る巨大蜘蛛 (GIANT SPIDER): 脚を広げて 12 m。遠くで左右にジグザグに走って近づき、60 m 先で目が赤く光る (0.8 秒)。
  // そのあと地面をまっすぐ毎秒 45 m で突っ込む。目の 8 m 手前で、当たる位置なら砕けて 25 (高く飛べば越えられる)。外れれば横へそれて走り抜ける
  gspider: {
    heavy: true, big: true,
    spawn(c, px) {
      const made = model('gspider', [[GEO.body, mat(0x24202c, 0, { own: true }), (m) => m.scale.set(1.6, 1, 2)]], true);
      const e = { kind: 'gspider', ...made, r: 3.6, hp: 8 + c.level, score: 1500, t: 0, flash: 0, fireT: Infinity,
        x: px + rand(-12, 12), z: SPAWN_Z, state: 'run', timer: 0, legs: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => made.mesh.getObjectByName(`GSpiderLeg${i}`)).filter(Boolean),
        eyes: findMats(made, 'GSpiderEye'), vel: new THREE.Vector3() };
      e.mesh.position.set(e.x, 2.2, e.z);
      c.addEnemy(e, 5);
    },
    update(c, e, dt, scroll, ctx, p) {
      const P = ctx.player;
      e.timer += dt;
      let run = 1;
      if (e.state === 'run') {
        e.z += (scroll * 0.5 + 30) * dt;
        e.x += Math.sin(e.t * 2.4) * 22 * dt; // ジグザグ
        if (e.z > -60) { e.state = 'warn'; e.timer = 0; sfx.screech(); }
      } else if (e.state === 'warn') {
        e.z += scroll * 0.3 * dt; // 身構える
        run = 0.3;
        if (e.timer >= 0.8) {
          e.state = 'dash';
          e.vel.set(P.x - e.x, 0, P.z - e.z).normalize().multiplyScalar(45); // そのときいた所へ、まっすぐ (追わない)
        }
      } else {
        e.x += e.vel.x * dt;
        e.z += e.vel.z * dt;
        run = 2;
        e.x = veerAway(e, e.x, 6, ctx, dt); // 外れたら横へ (脚の先から目まで 6 m 以上)
      }
      p.set(e.x, 2.2 + Math.abs(Math.sin(e.t * 10 * run)) * 0.15, e.z);
      if (e.state === 'dash') {
        // 目の 8 m 手前: 高さは体 (地面から 4.5 m) の中なら当たる。上へ飛べば越えられる
        if (eyeGuard(c, e, ctx, _a.set(p.x, THREE.MathUtils.clamp(P.y, 0.5, 4.5), p.z), 4.2, 25, 0.8)) return;
      }
      for (const m of e.eyes) m.userData.base.setHex(e.state === 'warn' ? 0xff2030 : 0x801020).multiplyScalar(e.state === 'warn' ? 0.5 + 0.5 * Math.abs(Math.sin(e.t * 16)) : 1);
      // 脚: 走る速さで交互に振る
      e.legs.forEach((l, i) => { l.rotation.y = Math.sin(e.t * 14 * run + i * 1.7) * 0.3 * Math.min(1, run); });
      const face = e.state === 'dash' ? Math.atan2(e.vel.x, e.vel.z) : Math.atan2(P.x - p.x, P.z - p.z);
      e.mesh.rotation.y = face;
      if (p.z > 30) e.dead = true;
    },
  },

  // ---- 15 面 黒曜石のエイ (OBSIDIAN RAY): 3 匹が地面すれすれを滑ってくる。40 m 先で 1 匹ずつ背中の割れ目が光り (0.8 秒)、
  // 跳ね上がって後ろへ宙返りし (こちらへは来ない)、腹から火の玉を 2 発。溶岩の腹が見えている 1.5 秒だけ倒せる。地面にいる間は弾を跳ね返す
  ray: {
    shielded: (e) => e.state !== 'flip',
    spawn(c, px) {
      for (let k = 0; k < 3; k++) {
        const made = model('ray', [[GEO.body, mat(0x1a1420, 0, { own: true }), (m) => m.scale.set(3, 0.4, 2.5)]], true);
        const e = { kind: 'ray', ...made, r: 2.6, hp: 3 + Math.ceil(c.level / 2), score: 600, t: rand(0, 2), flash: 0, fireT: Infinity,
          x: px + (k - 1) * 11, y: 1.5, z: SPAWN_Z - k * 14, state: 'glide', timer: 0, cracks: findMats(made, 'RayCrack') };
        e.mesh.position.set(e.x, e.y, e.z);
        c.addEnemy(e, 3);
      }
    },
    update(c, e, dt, scroll, ctx, p) {
      e.timer += dt;
      if (e.state === 'glide') {
        e.z += (scroll * 0.6 + 25) * dt;
        e.x += Math.sin(e.t * 1.5) * 3 * dt;
        if (e.z > -40) { e.state = 'warn'; e.timer = 0; }
      } else if (e.state === 'warn') {
        e.z += scroll * 0.4 * dt;
        if (e.timer >= 0.8) {
          e.state = 'flip';
          e.timer = 0;
          for (const s of [-0.1, 0.1]) c.fireBullet(_a.set(e.x, e.y + 1, e.z).clone(), ctx.player, s, 'fireball');
        }
      } else if (e.state === 'flip') {
        // 跳ね上がって後ろへ宙返り (1.5 秒)。腹 (溶岩) がこちらを向く
        const k = Math.min(1, e.timer / 1.5);
        e.y = 1.5 + Math.sin(k * Math.PI) * 9 + k * 4;
        e.z -= 22 * dt;
        e.mesh.rotation.x = -Math.PI * k;
        if (k >= 1) { e.state = 'leave'; e.timer = 0; }
      } else {
        e.y += 14 * dt;
        e.z -= 40 * dt;
        if (e.y > 45) e.dead = true;
      }
      p.set(e.x, e.y, e.z);
      for (const m of e.cracks) m.userData.base.setHex(0xc03a00).multiplyScalar(e.state === 'warn' ? 0.6 + 1.4 * Math.abs(Math.sin(e.t * 14)) : 1);
      if (p.z > 30) e.dead = true;
    },
  },

  // ---- 16 面 雷の結晶球 (STORM ORB): 2 個が 18 m 離れて近づき、70 m 先で間に細い予告の線 (1 秒)、そのあと横一文字の稲妻を張る。
  // 稲妻はプレイヤーの所を通るとき、高さが合えば 15 (上下によける)。片方を壊せば稲妻は消える。目の近くでは稲妻を薄くする
  stormorb: {
    spawn(c, px, py) {
      const pair = { y: THREE.MathUtils.clamp(py ?? 6, 3, Math.min(14, (c.ceilingY ?? 40) - 3)), cx: px, z: SPAWN_Z, state: 'approach', t: 0, orbs: [], hit: false };
      for (const sx of [-1, 1]) {
        const made = model('stormorb', [[GEO.orb, mat(0xd8f0ff, 0x60a0ff), (m) => m.scale.setScalar(1.4)]]);
        const e = { kind: 'stormorb', ...made, r: 1.8, hp: 3, score: 400, t: 0, flash: 0, fireT: Infinity, pair, sx };
        e.mesh.position.set(pair.cx + sx * 9, pair.y, pair.z);
        pair.orbs.push(e);
        c.addEnemy(e, 1.5);
      }
      // 予告の線と稲妻 (片付けは、片方の玉の marker として combat.remove に任せる)
      pair.line = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3)), new THREE.LineBasicMaterial({ color: 0xff3020 }));
      pair.line.frustumCulled = false;
      pair.line.visible = false;
      pair.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 6, 1, true).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      pair.beam.visible = false;
      c.scene.add(pair.line, pair.beam);
      pair.orbs[0].marker = pair.line;
      pair.orbs[1].marker = pair.beam;
    },
    update(c, e, dt, scroll, ctx, p) {
      const A = e.pair, P = ctx.player;
      const alive = A.orbs.filter((o) => !o.dead);
      if (alive[0] === e) {
        A.t += dt;
        A.z += (scroll * 0.5 + 18) * dt;
        if (A.state === 'approach' && A.z > -70) { A.state = 'warn'; A.t = 0; }
        else if (A.state === 'warn' && A.t >= 1) { A.state = 'beam'; A.t = 0; sfx.lock(); }
        const both = alive.length === 2;
        const [L, R] = A.orbs.map((o) => o.mesh.position);
        // 細い予告の線 (点滅)
        A.line.visible = both && A.state === 'warn' && Math.floor(A.t * 10) % 2 === 0;
        if (A.line.visible) {
          const pos = A.line.geometry.attributes.position;
          pos.setXYZ(0, L.x, L.y, L.z);
          pos.setXYZ(1, R.x, R.y, R.z);
          pos.needsUpdate = true;
        }
        // 稲妻: 2 個の間の横一文字。ぴりぴり揺れる。目の 6 m 以内では薄くする
        A.beam.visible = both && A.state === 'beam';
        if (A.beam.visible) {
          A.beam.position.set((L.x + R.x) / 2, A.y + rand(-0.15, 0.15), A.z);
          A.beam.scale.set(L.distanceTo(R) - 2.4, rand(0.7, 1.3), rand(0.7, 1.3));
          A.beam.material.opacity = 0.85 * THREE.MathUtils.clamp(Math.abs(A.z - P.z) / 6, 0.15, 1);
          // プレイヤーの所を通るとき、高さが合えば 15 (1 回だけ)
          if (!A.hit && A.z > P.z - 1 && Math.abs(P.y - A.y) < 1.2 + ctx.playerR && Math.abs(P.x - A.cx) < 8) {
            A.hit = true;
            ctx.onPlayerHit(15);
          }
        }
      }
      p.set(A.cx + e.sx * 9, A.y + Math.sin(e.t * 2 + e.sx) * 0.3, A.z);
      e.mesh.rotation.y += dt * 2;
      e.mesh.rotation.x += dt * 1.3;
      if (p.z > 30) e.dead = true;
    },
  },

  // ---- 17 面 磁石の浮遊機雷 (MAGNET MINE): ゆっくり近づき、30 m 先で角の先が赤く点滅 (1 秒) してから破裂し、弾を 6 発まく。
  // 先に撃てば止められる (破裂したときは点にならない)
  magnetmine: {
    spawn(c, px, py) {
      const n = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const made = model('magnetmine', [[GEO.orb, mat(0x3a3a48, 0, { own: true }), (m) => m.scale.setScalar(1.6)]], true);
        const e = { kind: 'magnetmine', ...made, r: 2.2, hp: 3, score: 500, t: rand(0, 2), flash: 0, fireT: Infinity,
          x: px + rand(-14, 14), y: THREE.MathUtils.clamp((py ?? 6) + rand(-2, 5), 3, Math.min(16, (c.ceilingY ?? 40) - 3)), z: SPAWN_Z - k * 22,
          state: 'drift', timer: 0, lights: findMats(made, 'MineLight') };
        e.mesh.position.set(e.x, e.y, e.z);
        c.addEnemy(e, 1.8);
      }
    },
    update(c, e, dt, scroll, ctx, p) {
      const P = ctx.player;
      e.timer += dt;
      if (e.state === 'drift') {
        e.z += (scroll * 0.5 + 15) * dt;
        e.x += THREE.MathUtils.clamp(P.x - e.x, -2 * dt, 2 * dt); // 磁石のように、ゆっくり寄ってくる
        if (e.z > P.z - 30) { e.state = 'warn'; e.timer = 0; sfx.lock(); }
      } else {
        e.z += scroll * 0.2 * dt;
        if (e.timer >= 1) {
          for (let s = -2.5; s <= 2.5; s += 1) c.fireBullet(_a.set(e.x, e.y, e.z).clone(), P, s * 0.2, 'orb', null, s !== -2.5);
          c.explode(_a.set(e.x, e.y, e.z), false);
          e.dead = true; // 破裂したときは点にならない
          return;
        }
      }
      for (const m of e.lights) m.userData.base.setHex(0xff2010).multiplyScalar(e.state === 'warn' ? (Math.floor(e.timer * 10) % 2 ? 1.6 : 0.2) : 0.6);
      p.set(e.x, e.y + Math.sin(e.t * 1.5) * 0.4, e.z);
      e.mesh.rotation.y += dt * 0.6;
      if (p.z > 30) e.dead = true;
    },
  },
};
