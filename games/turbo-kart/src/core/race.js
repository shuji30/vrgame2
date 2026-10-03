// レース全体: 全カートの物理・衝突・周回・順位（描画やネットワークには依存しない）
import { locate, pointAt, wrapS } from './track.js';
import { createKart, stepKart, forwardSpeed, KART, VEHICLES } from './physics.js';
import { SURFACES } from './surface.js';
import { createDriver, driveAI } from './ai.js';
import { mulberry32 } from './rng.js';
import { rideState, surfaceParams } from './surface.js';

const G = 9.8;

export const NPC_NAMES = ['Blaze', 'Nova', 'Rex', 'Luna', 'Turbo', 'Pixel', 'Viper', 'Mocha', 'Comet', 'Ziggy', 'Echo', 'Rio', 'Kiki', 'Bolt'];
export const KART_COLORS = [0xff3b3b, 0x2f8cff, 0x2fd06a, 0xffc42e, 0xb05cff, 0xff7a1f, 0x18d6d6, 0xff5ab4, 0xf2f2f2, 0x6b6b7a, 0x9be03a, 0x3a4bff, 0xc98a4a, 0x00a37a];
const COUNTDOWN = 3;

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
  constructor(track, entries, { laps = 3, seed = 1, level = 'normal', manual = [], vehicle = 'kart' } = {}) {
    this.spec = VEHICLES[vehicle] || KART;
    this.track = track;
    this.laps = laps;
    this.level = level;
    this.rng = mulberry32(seed);
    this.time = -COUNTDOWN; // 0 でスタート
    this.state = 'countdown';
    this.karts = entries.map((e, i) => {
      const g = gridSlot(track, i);
      const kart = createKart(g.x, g.z, g.heading, this.spec);
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
        progress: 0,
        position: i + 1,
        input: { steer: 0, throttle: 0, brake: 0, handbrake: 0 },
        boostPadCool: 0,
        events: [],
      };
    });
    for (const e of this.karts) this.applyTerrain(e);
    for (const e of this.karts) e.prevS = undefined;
    this.updateProgress();
  }

  get player() {
    return this.karts.find((k) => k.type === 'player') || null;
  }

  // inputs: Map(index → 入力)。NPC は内部で AI が操作する
  step(dt, inputs = new Map()) {
    this.time += dt;
    for (const e of this.karts) e.events.length = 0;
    if (this.state === 'countdown' && this.time >= 0) this.state = 'racing';
    const racing = this.state !== 'countdown';

    const player = this.player;
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
        input = driveAI(e.driver, e.kart, e.loc, this.track, others, e.finished ? 0.6 : pace, dt);
      } else if (e.type === 'player' && e.finished) {
        // ゴール後は自動でクールダウン走行
        if (!e.driver) e.driver = createDriver(this.rng, 'easy');
        input = driveAI(e.driver, e.kart, e.loc, this.track, this.karts.filter((o) => o !== e), 0.6, dt);
      } else {
        input = inputs.get(e.index) || e.input;
      }
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

  // 路面の種類・坂・バンクをカートに反映し、描画/FFB 用の姿勢 (ride) を更新する
  applyTerrain(e) {
    const t = this.track;
    const k = e.kart;
    const ride = rideState(t, e.loc, k.heading, t.heading[e.loc.i]);
    const p = surfaceParams(t, e.loc.s);
    k.gripBase = p.grip;
    k.maxLatBase = p.maxLat;
    k.rollingExtra = p.rolling;
    // 路面ごとのグリップは舗装に対する比で、車種の値に掛ける
    k.mu = this.spec.mu * (p.maxLat / SURFACES.tarmac.maxLat);
    k.tireB = this.spec.tireB * (p.B / SURFACES.tarmac.B);
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
    const limit = t.halfWidth + t.runoff - this.spec.radius;
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
      e.loc = locate(t, k.x, k.z, e.loc.i);
    }
  }

  collideKarts() {
    const ks = this.karts;
    const R = this.spec.radius * 2;
    for (let a = 0; a < ks.length; a++) {
      for (let b = a + 1; b < ks.length; b++) {
        const A = ks[a].kart, B = ks[b].kart;
        // 立体交差の上と下にいる車はぶつからない
        if (Math.abs((ks[a].ride?.y ?? 0) - (ks[b].ride?.y ?? 0)) > 3) continue;
        const dx = B.x - A.x, dz = B.z - A.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const over = (R - d) / 2;
        // 他プレイヤー（remote）は動かさず、こちら側だけ押し戻す
        const ra = ks[a].type === 'remote', rb = ks[b].type === 'remote';
        const wa = ra ? 0 : rb ? 2 : 1, wb = rb ? 0 : ra ? 2 : 1;
        A.x -= nx * over * wa; A.z -= nz * over * wa;
        B.x += nx * over * wb; B.z += nz * over * wb;
        const rel = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz;
        if (rel < 0) {
          const j = -rel * 0.6;
          if (!ra) { A.vx -= nx * j * wa * 0.5; A.vz -= nz * j * wa * 0.5; }
          if (!rb) { B.vx += nx * j * wb * 0.5; B.vz += nz * j * wb * 0.5; }
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

export { forwardSpeed };
