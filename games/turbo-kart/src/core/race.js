// レース全体: 全カートの物理・衝突・周回・順位（描画やネットワークには依存しない）
import { locate, pointAt, wrapS, wallAt } from './track.js';
import { createKart, stepKart, forwardSpeed, KART, VEHICLES, realSpec } from './physics.js';
import { SURFACES } from './surface.js';
import { createDriver, driveAI } from './ai.js';
import { mulberry32 } from './rng.js';
import { rideState, surfaceParams } from './surface.js';
import { coinLayout, collectCoins } from './coins.js';
import { ItemSystem } from './items.js';

const G = 9.8;

export const NPC_NAMES = ['Blaze', 'Nova', 'Rex', 'Luna', 'Turbo', 'Pixel', 'Viper', 'Mocha', 'Comet', 'Ziggy', 'Echo', 'Rio', 'Kiki', 'Bolt'];
// 1 レースに出られる車の数（プレイヤーと NPC の合計。オンラインでも同じ）
export const MAX_KARTS = 11;
export const KART_COLORS = [0xff3b3b, 0x2f8cff, 0x2fd06a, 0xffc42e, 0xb05cff, 0xff7a1f, 0x18d6d6, 0xff5ab4, 0xf2f2f2, 0x6b6b7a, 0x9be03a, 0x3a4bff, 0xc98a4a, 0x00a37a];
const COUNTDOWN = 3;

// NPC 用の諸元: npcBoost（グリップ・加速・最高速の倍率）があれば上乗せする。プレイヤーの車は変えない
const npcSpecs = new Map();
// 強さごとの性能アップの効き具合（つよい = 全開、ふつう = 一部、やさしい = ほぼ無し）
export const NPC_BOOST_LEVEL = { easy: 0.25, normal: 0.5, hard: 1 };

export function npcSpec(spec, level = 'normal') {
  const b = spec.npcBoost;
  if (!b) return spec;
  const f = NPC_BOOST_LEVEL[level] ?? NPC_BOOST_LEVEL.normal;
  const k = (x) => 1 + ((x ?? 1) - 1) * f;
  const key = `${level}`;
  let m = npcSpecs.get(spec);
  if (!m) npcSpecs.set(spec, (m = new Map()));
  if (!m.has(key)) {
    m.set(key, {
      ...spec,
      mu: spec.mu * k(b.mu),
      maxLat: spec.maxLat * k(b.mu),
      muGrass: spec.muGrass * k(b.mu),
      baseAccel: spec.baseAccel * k(b.accel),
      gearTop: spec.gearTop.map((v) => v * k(b.top)),
    });
  }
  return m.get(key);
}

// スタートラインの位置（弧長）
export function startS(track) {
  return track.def.startS || 0;
}

// 出走位置: スタートラインの後方に 2 列で並べる
export function gridSlot(track, i) {
  const row = Math.floor(i / 2);
  const side = i % 2 === 0 ? -1 : 1;
  const s = wrapS(track, startS(track) - 8 - row * 7 - (side > 0 ? 3.5 : 0));
  const p = pointAt(track, s, side * track.halfWidth * 0.45);
  return { x: p.x, z: p.z, heading: p.heading, s };
}

export class Race {
  // entries: [{ name, color, type: 'player' | 'npc' | 'remote', id }]
  // coins: パーティーモードのコイン（拾うと最高速が少し上がる）
  // items: パーティーモードのアイテム（アイテムボックス・投げ物・スター・カミナリなど）
  constructor(track, entries, { laps = 3, seed = 1, level = 'normal', manual = [], vehicle = 'kart', coins = false, items = false, realistic = false } = {}) {
    // realistic: 本格モード（実車寄りの諸元）
    this.spec = realistic ? realSpec(VEHICLES[vehicle] || KART) : VEHICLES[vehicle] || KART;
    this.coins = coins ? coinLayout(track).map((c) => ({ ...c, respawnAt: -Infinity })) : [];
    this.track = track;
    this.laps = laps;
    this.level = level;
    this.rng = mulberry32(seed);
    this.time = -COUNTDOWN; // 0 でスタート
    this.state = 'countdown';
    this.karts = entries.map((e, i) => {
      const g = gridSlot(track, i);
      // NPC の車は、車種によっては見えない性能アップ（spec.npcBoost）を持つ
      const kart = createKart(g.x, g.z, g.heading, e.type === 'npc' ? npcSpec(this.spec, level) : this.spec);
      return {
        ...e,
        index: i,
        kart,
        loc: locate(track, g.x, g.z),
        driver: e.type === 'npc' ? createDriver(this.rng, level) : null,
        manual: manual.includes(i),
        lap: 0,
        // スタートラインの手前から始めるので、最初の通過で 1 周目に入る
        started: false,
        halfway: true,
        finished: false,
        finishTime: null,
        lapTimes: [],
        lapStart: 0,
        bestLap: null,
        lastLap: null,
        progress: 0,
        position: i + 1,
        input: { steer: 0, throttle: 0, brake: 0, handbrake: 0 },
        coins: 0,
        boostPadCool: 0,
        events: [],
      };
    });
    for (const e of this.karts) this.applyTerrain(e);
    for (const e of this.karts) e.prevS = undefined;
    this.events = []; // レース全体の出来事（カミナリ・アイテムの命中など）
    // items: true（オフライン）または 'host' / 'client'（オンライン）
    this.items = items ? new ItemSystem(this, typeof items === 'string' ? items : 'local') : null;
    this.updateProgress();
  }

  get player() {
    return this.karts.find((k) => k.type === 'player') || null;
  }

  // inputs: Map(index → 入力)。NPC は内部で AI が操作する
  step(dt, inputs = new Map()) {
    this.time += dt;
    for (const e of this.karts) e.events.length = 0;
    this.events.length = 0;
    if (this.state === 'countdown' && this.time >= 0) this.state = 'racing';
    const racing = this.state !== 'countdown';

    const player = this.player;
    if (racing) this.updateDraft();
    for (const e of this.karts) {
      if (e.type === 'remote') {
        // 他プレイヤー（とホストが走らせる NPC）はネットワークから受け取った位置へ追従する
        this.stepRemote(e, dt);
        continue;
      }
      let input;
      if (!racing) {
        // カウントダウン中はその場で待機（ブレーキ長押しの後退も起こさない）
        e.input = { ...(inputs.get(e.index) || e.input), throttle: 0, brake: 0, handbrake: 0 };
        e.kart.vx = 0;
        e.kart.vz = 0;
        e.kart.yawRate = 0;
        this.applyTerrain(e);
        continue;
      }
      if (e.type === 'npc') {
        const others = this.karts.filter((o) => o !== e);
        // ラバーバンド: プレイヤーと離れすぎないよう少しだけ速さを補正
        // 「つよい」は手加減なし、「ふつう」は大差のときだけ少し緩め、「やさしい」は早めに待つ
        let pace = 1;
        if (player && !player.finished) {
          const gap = e.progress - player.progress;
          const rb = { easy: [60, 0.95], normal: [120, 0.98], hard: [Infinity, 1] }[this.level] || [120, 0.98];
          pace = gap > rb[0] ? rb[1] : gap < -60 ? 1.03 : 1;
        }
        // ゴール後はゆっくり流す
        // スミ雲で前が見えにくいときは少し慎重に走る
        input = driveAI(e.driver, e.kart, e.loc, this.track, others, (e.finished ? 0.6 : pace) * (e.ink > 0 ? 0.95 : 1), dt);
      } else if (e.type === 'player' && e.finished) {
        // ゴール後は自動でクールダウン走行
        if (!e.driver) e.driver = createDriver(this.rng, 'easy');
        input = driveAI(e.driver, e.kart, e.loc, this.track, this.karts.filter((o) => o !== e), 0.6, dt);
      } else {
        input = inputs.get(e.index) || e.input;
      }
      if (this.items) {
        if (input.useItem) this.items.use(e, false);
        if (input.useItemBack) this.items.use(e, true);
        input = this.items.overrideInput(e, input);
      }
      if (e.type === 'player' && !e.finished) this.checkStuck(e, dt);
      e.input = input;
      this.applyTerrain(e);
      const r = stepKart(e.kart, input, dt, { manual: e.manual });
      if (r.miniTurbo) e.events.push({ type: 'miniTurbo', amount: r.miniTurbo });
    }

    for (const e of this.karts) this.collideWalls(e);
    this.collideKarts();
    for (const e of this.karts) {
      if (e.type === 'remote') continue;
      this.checkBoostPads(e, dt);
    }
    if (racing && this.coins.length) collectCoins(this);
    if (racing && this.items) this.items.step(dt);
    this.updateProgress();
  }

  // e.net: { x, z, h, vx, vz, yaw, sa, st, g, b, dr, age(受信からの秒), lap, sd, f, ft, bl }
  stepRemote(e, dt) {
    const n = e.net;
    const k = e.kart;
    if (n) {
      const age = Math.min(0.3, n.age || 0);
      const px = n.x + n.vx * age, pz = n.z + n.vz * age;
      const err = Math.hypot(px - k.x, pz - k.z);
      const a = err > 8 ? 1 : Math.min(1, dt * 15);
      k.x += (px - k.x) * a;
      k.z += (pz - k.z) * a;
      const ph = n.h + (n.yaw || 0) * age;
      k.heading += Math.atan2(Math.sin(ph - k.heading), Math.cos(ph - k.heading)) * a;
      k.vx = n.vx;
      k.vz = n.vz;
      k.yawRate = n.yaw || 0;
      k.steerAngle = n.sa || 0;
      k.gear = n.g ?? k.gear;
      k.boost = n.b || 0;
      k.driftTime = n.dr || 0;
      k.handbrakeInput = n.hb || 0;
      e.input = { ...e.input, steer: n.st || 0, throttle: n.th || 0 };
    }
    this.applyTerrain(e);
  }

  // スリップストリーム: 25m 以内の前の車の真後ろ（横のずれが車幅程度）にいると draft が 0..1 になる
  updateDraft() {
    const t = this.track;
    const w = this.spec.width ?? 1.4;
    for (const e of this.karts) {
      let best = 0;
      for (const o of this.karts) {
        if (o === e) continue;
        let d = wrapS(t, o.loc.s - e.loc.s);
        if (d > t.length / 2) d -= t.length;
        if (d < 2 || d > 25) continue;
        if (Math.abs(o.loc.lateral - e.loc.lateral) > w * 1.1) continue;
        best = Math.max(best, 1 - d / 25);
      }
      // 速いほど効く（低速ではほとんど効かない）
      const v = Math.hypot(e.kart.vx, e.kart.vz);
      e.kart.draft = best * Math.min(1, v / 25);
    }
  }

  // 路面の種類・坂・バンクをカートに反映し、描画/FFB 用の姿勢 (ride) を更新する
  applyTerrain(e) {
    const t = this.track;
    const k = e.kart;
    // 4 輪の位置は車種の大きさに合わせる（カートは従来の値）
    const dims = this.spec.id && this.spec.id !== 'kart' ? { half: this.spec.wheelbase / 2, tw: 0.85 } : undefined;
    const ride = rideState(t, e.loc, k.heading, t.heading[e.loc.i], dims);
    const p = surfaceParams(t, e.loc.s);
    k.gripBase = p.grip;
    k.maxLatBase = p.maxLat;
    k.rollingExtra = p.rolling;
    // 路面ごとのグリップは舗装に対する比で、車種の値に掛ける
    const spec = k.spec || this.spec;
    k.mu = spec.mu * (p.maxLat / SURFACES.tarmac.maxLat);
    k.tireB = spec.tireB * (p.B / SURFACES.tarmac.B);
    k.slopeAccel = -G * Math.sin(ride.pitch);
    k.bankAccel = -G * Math.sin(ride.roll);
    // バンク上の荷重: 重力の法線成分 + 旋回の遠心力のうちバンクに押しつける成分
    const turnG = Math.min(3, Math.abs(k.yawRate * (k.vx * Math.cos(k.heading) + k.vz * Math.sin(k.heading))) / G);
    k.loadScale = Math.cos(ride.roll) + Math.abs(Math.sin(ride.roll)) * turnG;
    k.latBonus = 0;
    e.prevRide = e.ride || ride;
    e.ride = ride;
    e.surfaceType = p.type;
  }

  collideWalls(e) {
    const t = this.track;
    const k = e.kart;
    e.loc = locate(t, k.x, k.z, e.loc.i);
    const lat = e.loc.lateral;
    const abs = Math.abs(lat);
    const type = e.surfaceType || 'tarmac';
    k.surface = abs > t.halfWidth ? 'grass' : abs > t.halfWidth - 0.9 && type !== 'dirt' ? 'curb' : type;
    // 壁の位置はカーブの内側で手前になる（track.wallR / wallL）
    const limit = wallAt(t, e.loc.s, Math.sign(lat) || 1) - this.spec.radius;
    if (abs > limit) {
      const i = e.loc.i;
      // コースの右方向
      const rx = -t.tz[i], rz = t.tx[i];
      const sign = Math.sign(lat);
      const over = abs - limit;
      k.x -= rx * sign * over;
      k.z -= rz * sign * over;
      const vn = (k.vx * rx + k.vz * rz) * sign;
      if (vn > 0) {
        k.vx -= rx * sign * vn * 1.3;
        k.vz -= rz * sign * vn * 1.3;
        k.vx *= 0.9;
        k.vz *= 0.9;
        e.events.push({ type: 'wall', strength: vn, side: sign });
      }
      e.wallT = 0.6; // 壁に触れている（自動復帰の判定用）
      e.loc = locate(t, k.x, k.z, e.loc.i);
    }
  }

  // 自動復帰: 壁ぎわやコース外で 3 秒以上ほとんど動けなければ、同じ地点のコース中央に進行方向を向けて戻す
  checkStuck(e, dt) {
    const k = e.kart;
    e.wallT = Math.max(0, (e.wallT || 0) - dt);
    const slow = Math.hypot(k.vx, k.vz) < 1.5;
    const trapped = e.wallT > 0 || Math.abs(e.loc.lateral) > this.track.halfWidth;
    e.stuckT = slow && trapped ? (e.stuckT || 0) + dt : 0;
    // 壁にこすりながら動き続けて前へ進めないとき（ヘアピンの内側に入り込んだ GT3 など、曲がりきれない）も助ける:
    // 壁に触れているかコース外にいて、4 秒で 8m も進めなければ
    const L = this.track.length;
    if (!e.stall || !trapped) e.stall = { s: e.loc.s, t: 0 };
    e.stall.t += dt;
    const ahead = ((e.loc.s - e.stall.s) % L + L * 1.5) % L - L / 2;
    if (ahead > 8) e.stall = { s: e.loc.s, t: 0 };
    if (e.stuckT < 3 && e.stall.t < 4) return;
    e.stuckT = 0;
    e.stall = null;
    const p = pointAt(this.track, e.loc.s, 0);
    Object.assign(k, { x: p.x, z: p.z, heading: p.heading, vx: 0, vz: 0, yawRate: 0 });
    e.loc = locate(this.track, k.x, k.z, e.loc.i);
    e.events.push({ type: 'rescue' });
  }

  // 車同士の衝突。車体は向きに沿った細長いカプセル（幅 = spec.width、長さ = spec.length）
  collideKarts() {
    const ks = this.karts;
    const P = this.spec;
    const r = (P.width ?? P.radius * 1.4) / 2;
    const half = Math.max(0, (P.length ?? 2) / 2 - r);
    const yawK = (P.mass / P.Iz) * 0.35; // 中心を外れた当たりで車の向きが変わる量（控えめ）
    for (let a = 0; a < ks.length; a++) {
      for (let b = a + 1; b < ks.length; b++) {
        const A = ks[a].kart, B = ks[b].kart;
        // 立体交差の上と下にいる車はぶつからない
        if (Math.abs((ks[a].ride?.y ?? 0) - (ks[b].ride?.y ?? 0)) > 3) continue;
        const reach = 2 * (half + r);
        if (Math.abs(B.x - A.x) > reach || Math.abs(B.z - A.z) > reach) continue;
        const c = closestSegments(A, B, half);
        const dx = c.bx - c.ax, dz = c.bz - c.az;
        const d2 = dx * dx + dz * dz;
        if (d2 >= 4 * r * r) continue;
        const d = Math.sqrt(d2);
        // 中心線が重なるほど深く入ったときは、中心どうしを結ぶ向きに押し出す
        let nx, nz;
        if (d > 1e-4) { nx = dx / d; nz = dz / d; } else {
          const cd = Math.hypot(B.x - A.x, B.z - A.z) || 1;
          nx = (B.x - A.x) / cd; nz = (B.z - A.z) / cd;
        }
        const over = (2 * r - d) / 2;
        // 他プレイヤー（remote）は動かさず、こちら側だけ押し戻す
        const ra = ks[a].type === 'remote', rb = ks[b].type === 'remote';
        const wa = ra ? 0 : rb ? 2 : 1, wb = rb ? 0 : ra ? 2 : 1;
        A.x -= nx * over * wa; A.z -= nz * over * wa;
        B.x += nx * over * wb; B.z += nz * over * wb;
        // 接触点での相対速度（回転による速度も含める）
        const px = (c.ax + c.bx) / 2, pz = (c.az + c.bz) / 2;
        const rax = px - A.x, raz = pz - A.z, rbx = px - B.x, rbz = pz - B.z;
        const vax = A.vx - (A.yawRate || 0) * raz, vaz = A.vz + (A.yawRate || 0) * rax;
        const vbx = B.vx - (B.yawRate || 0) * rbz, vbz = B.vz + (B.yawRate || 0) * rbx;
        const rel = (vbx - vax) * nx + (vbz - vaz) * nz;
        if (rel < 0) {
          const j = -rel * 0.6;
          if (!ra) {
            A.vx -= nx * j * wa * 0.5; A.vz -= nz * j * wa * 0.5;
            A.yawRate -= (rax * nz - raz * nx) * j * wa * 0.5 * yawK;
          }
          if (!rb) {
            B.vx += nx * j * wb * 0.5; B.vz += nz * j * wb * 0.5;
            B.yawRate += (rbx * nz - rbz * nx) * j * wb * 0.5 * yawK;
          }
          ks[a].events.push({ type: 'bump', strength: -rel, nx, nz });
          ks[b].events.push({ type: 'bump', strength: -rel, nx: -nx, nz: -nz });
        }
      }
    }
  }

  checkBoostPads(e, dt) {
    e.boostPadCool = Math.max(0, e.boostPadCool - dt);
    if (e.boostPadCool > 0) return;
    for (const pad of this.track.def.boostPads || []) {
      let ds = wrapS(this.track, e.loc.s - pad.s);
      if (ds > this.track.length / 2) ds -= this.track.length;
      if (Math.abs(ds) < 1.5 && Math.abs(e.loc.lateral - pad.lateral) < 1.8) {
        e.kart.boost = Math.max(e.kart.boost, 1.2);
        e.boostPadCool = 1;
        e.events.push({ type: 'boostPad' });
      }
    }
  }

  // 周回と順位
  updateProgress() {
    const L = this.track.length;
    for (const e of this.karts) {
      if (e.type === 'remote' && e.net) {
        // 周回とゴールは本人の判定を使う
        e.lap = e.net.lap ?? e.lap;
        e.started = !!e.net.sd;
        if (e.net.f && !e.finished) e.events.push({ type: 'finish' });
        e.finished = !!e.net.f;
        e.finishTime = e.net.ft ?? null;
        e.bestLap = e.net.bl ?? e.bestLap;
        e.lastLap = e.net.ll ?? e.lastLap;
        const sr = wrapS(this.track, e.loc.s - startS(this.track));
        e.progress = e.finished ? this.laps * L + 1e6 - e.finishTime : (e.started ? (e.lap - 1) * L : -L) + sr;
        continue;
      }
      // スタートラインからの距離
      const s = wrapS(this.track, e.loc.s - startS(this.track));
      const prev = e.prevS ?? s;
      e.prevS = s;
      if (s > L * 0.33 && s < L * 0.66) e.halfway = true;
      // スタートライン（s=0）を前向きに通過
      if (prev > L * 0.8 && s < L * 0.2 && e.halfway && !e.finished && this.state !== 'countdown') {
        e.halfway = false;
        if (!e.started) {
          e.started = true;
          e.lap = 1;
          e.lapStart = this.time;
        } else {
          const lt = this.time - e.lapStart;
          e.lapTimes.push(lt);
          e.lastLap = lt;
          if (e.bestLap == null || lt < e.bestLap) e.bestLap = lt;
          e.lapStart = this.time;
          if (e.lap >= this.laps) {
            e.finished = true;
            e.finishTime = this.time;
            e.events.push({ type: 'finish' });
          } else {
            e.lap++;
            e.events.push({ type: 'lap', lap: e.lap });
          }
        }
      } else if (prev < L * 0.2 && s > L * 0.8 && e.started && !e.finished) {
        // 逆走でラインを戻った
        e.halfway = true;
      }
      const lapBase = e.started ? (e.lap - 1) * L : -L;
      e.progress = e.finished ? this.laps * L + 1e6 - e.finishTime : lapBase + s;
    }
    const order = [...this.karts].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return b.progress - a.progress;
    });
    order.forEach((e, i) => { e.position = i + 1; });
    // プレイヤーがいればプレイヤーのゴールで、いなければ全員のゴールで終了
    const p = this.player;
    if (this.state === 'racing' && (p ? p.finished : this.karts.every((e) => e.finished))) {
      this.state = 'finished';
    }
  }

  standings() {
    return [...this.karts].sort((a, b) => a.position - b.position);
  }
}

// 2 台の車体の中心線（向きに沿った長さ 2*half の線分）どうしの最も近い点
function closestSegments(A, B, half) {
  const ux = Math.cos(A.heading) * half, uz = Math.sin(A.heading) * half;
  const vx = Math.cos(B.heading) * half, vz = Math.sin(B.heading) * half;
  // 線分 A: A + s*u（s = -1..1）、線分 B: B + t*v
  const wx = A.x - B.x, wz = A.z - B.z;
  const a = ux * ux + uz * uz, b = ux * vx + uz * vz, c = vx * vx + vz * vz;
  const d = ux * wx + uz * wz, e = vx * wx + vz * wz;
  const clamp = (x) => Math.max(-1, Math.min(1, x));
  let s, t;
  if (a < 1e-9) {
    s = 0;
    t = c < 1e-9 ? 0 : clamp(e / c);
  } else {
    const den = a * c - b * b;
    s = den > 1e-9 ? clamp((b * e - c * d) / den) : 0;
    t = c < 1e-9 ? 0 : clamp((b * s + e) / c);
    s = clamp((b * t - d) / a);
  }
  return { ax: A.x + ux * s, az: A.z + uz * s, bx: B.x + vx * t, bz: B.z + vz * t };
}

export { forwardSpeed };
