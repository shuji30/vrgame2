// ゲームのシミュレーション(three.js 非依存。node でテストできる)
// 協力ミッション・試験場・対戦で共用。ホスト(とソロ)は authority=true で判定まで行い、
// クライアントは authority=false で自分の車両と弾の見た目だけを動かす
import { clamp, dist, wrapAngle, yawTo, approachAngle, DEG, smooth01 } from './util.js';
import { makeRng } from './rng.js';
import { Terrain, WATER_Y } from './terrain.js';
import { Obstacles } from './collide.js';
import { VEHICLES, UNITS, DIFFICULTY } from './vehicles.js';
import { initMotion, stepMotion, separate } from './tankphys.js';
import { G, LOB_G, LOB_ANGLE, lobSpeed, lobRange, LOB_MIN, LOB_MAX, solvePitch, spreadDeg, gaussPair, GUN_MIN, GUN_MAX } from './ballistics.js';
import { thinkTank, steerTo } from './ai.js';
import { initBoss, updateBoss, partPos, partVulnerable, bodyHit, pushVehicle, onPartDestroyed } from './boss.js';

const ELEV_H = 26;
const ELEV_DUR = 7.5;
const DROP_T = 2.6;
const RESPAWN_T = 5;

export class Sim {
  constructor(stage, opts = {}) {
    this.stage = stage;
    this.mode = opts.mode || 'campaign'; // campaign | coop | training | versus
    this.authority = opts.authority ?? true;
    this.diff = DIFFICULTY[opts.difficulty || 'normal'];
    this.comfortTurn = opts.comfortTurn ?? 1;
    this.turretRange = (opts.turretRange ?? 90) * DEG; // プレイヤーの砲塔の左右の旋回範囲(180 で全周)
    this.rng = makeRng(opts.seed ?? ((stage.seed || 1) * 31 + 7));
    this.rnd = this.rng.next;
    this.terrain = new Terrain(stage);
    this.obstacles = new Obstacles((stage.obstacles || []).map((o) => ({ ...o })), this.terrain);
    this.gates = this.obstacles.list.filter((o) => o.gate);
    this.elevators = (stage.elevators || []).map((e, i) => ({ id: i, x: e.x, z: e.z, r: 4.5 }));
    this.elevUses = stage.elevatorUses ?? (this.mode === 'training' ? 99 : 3);
    this.ents = [];
    this.byId = new Map();
    this.shots = [];
    this.smokes = [];
    this.debris = [];
    this.events = [];
    this.time = 0;
    this.nextId = 1;
    this.nextShot = 1;
    const players = opts.players || [{ id: 'p1', name: 'PLAYER', vehicle: 'medium', ctrl: 'local' }];
    const nPlayers = players.filter((p) => p.ctrl !== 'bot').length;
    this.nPlayers = nPlayers;
    const timeMul = this.mode === 'coop' ? 1 + 0.1 * (nPlayers - 1) : 1;
    this.mission = {
      state: 'drop', t: 0, timeLimit: (stage.time || 0) * timeMul, timeLeft: (stage.time || 0) * timeMul,
      score: 0, kills: 0, deaths: 0, lives: this.mode === 'coop' ? 2 + nPlayers : 3,
      objectives: 0, objectivesLeft: 0, timeBonus: 0, noDeathBonus: 0, bonus: 0, warned: {}, exitT: 0,
      teamScore: [0, 0], winner: null, rule: opts.versus?.rule || 'dm', target: opts.versus?.target || 0, shots: 0, hits: 0,
    };
    // 対戦
    if (this.mode === 'versus') {
      const v = opts.versus || {};
      this.mission.timeLimit = this.mission.timeLeft = v.time || 300;
      const rule = this.mission.rule;
      this.mission.target = v.target || (rule === 'dm' ? 10 : rule === 'dom' ? 200 : 3);
      this.bases = stage.bases;
      if (rule === 'dom') this.points = stage.points.map(([x, z], i) => ({ id: i, x, z, r: 9, owner: -1, prog: 0 }));
      if (rule === 'ctf') this.flags = [0, 1].map((t) => ({ team: t, hx: stage.bases[t].x, hz: stage.bases[t].z + (t ? 6 : -6), x: stage.bases[t].x, z: stage.bases[t].z + (t ? 6 : -6), carrier: null, home: true }));
    }
    players.forEach((p, i) => this.addPlayer(p, i));
    if (this.mode !== 'versus') {
      const hpMul = this.mode === 'coop' ? 1 + 0.3 * (nPlayers - 1) : 1;
      for (const u of stage.units || []) this.addUnit(u, hpMul);
      // 人数が多いときは軽戦車を足す
      if (this.mode === 'coop' && nPlayers >= 3) {
        const extra = (stage.units || []).filter((u) => u.type === 'lightTank').slice(0, nPlayers * 2);
        for (const u of extra) this.addUnit({ ...u, x: u.x + 8, z: u.z + 6 }, hpMul);
      }
    }
    const obj = this.ents.filter((e) => e.objective);
    this.mission.objectives = this.mission.objectivesLeft = obj.length;
    this.exit = stage.exit ? { x: stage.exit.x, z: stage.exit.z, r: 6, open: false } : null;
    this.radioQueue = [];
    if (stage.briefing) for (const [who, text] of stage.briefing) this.radio(who, text);
  }

  emit(ev) {
    this.events.push(ev);
  }

  radio(who, text) {
    this.emit({ t: 'radio', who, text });
  }

  // ------------------------------------------------------------ 生成
  addPlayer(p, index = 0) {
    const spec = VEHICLES[p.vehicle] || VEHICLES.medium;
    const e = {
      id: p.id, name: p.name || p.id, isPlayer: p.ctrl !== 'bot', ctrl: p.ctrl || 'local', team: p.team ?? 0,
      kind: spec.kind, color: p.color, alive: true, hp: spec.hp, maxHp: spec.hp, radius: spec.radius,
      reload: 0, mgCd: 0, sub: 'mg', smokeAmmo: 3, weapon: 'cannon', turret: 0, gunPitch: 0, turretYaw: 0,
      kills: 0, deaths: 0, score: 0, respawnT: 0, invuln: 0, drop: 0, hatch: false, index, ai: {}, lobAmt: 0,
      aim: { x: 0, y: 0, z: 0, d: 100, lock: null }, lobAim: null, spread: 0, fireT: 0, hitT: 0,
    };
    initMotion(e, spec, 0, 0, 0);
    this.ents.push(e);
    this.byId.set(e.id, e);
    this.spawnPlayer(e);
    return e;
  }

  spawnPoint(e) {
    if (this.mode === 'versus') {
      const b = this.bases[e.team];
      const k = e.index % 4;
      const off = [-9, 9, -18, 18][k];
      return { x: b.x + off, z: b.z, yaw: b.yaw };
    }
    // 中間地点(区画制圧で最後に開けた門の先)があればそこから
    const s = this.checkpoint || this.stage.spawn;
    const k = e.index % 4;
    const off = [0, 8, -8, 16][k];
    return { x: s.x + Math.cos(s.yaw) * off, z: s.z - Math.sin(s.yaw) * off - (k ? 4 : 0) * Math.cos(s.yaw), yaw: s.yaw };
  }

  spawnPlayer(e) {
    const sp = this.spawnPoint(e);
    initMotion(e, e.spec, sp.x, sp.z, sp.yaw);
    e.alive = true;
    e.hp = e.maxHp;
    e.turret = 0;
    e.reload = 0;
    e.smokeAmmo = 3;
    e.drop = 1; // 空から投下されて始まる
    e.y = this.terrain.height(sp.x, sp.z) + 40;
    e.invuln = DROP_T + 2;
    e.hidden = false;
    this.emit({ t: 'drop', id: e.id });
  }

  addUnit(u, hpMul = 1) {
    const id = `u${this.nextId++}`;
    if (u.type === 'boss') {
      const e = { id, type: 'boss', team: 1, alive: true, ctrl: 'ai', x: u.x, z: u.z, y: 0, yaw: u.yaw || 0, vx: 0, vz: 0, hp: 1, maxHp: 1, static: true, ai: { state: 'sleep' }, group: u.group };
      initBoss(e, u, hpMul);
      e.spec = { radius: e.radius, height: 10, body: 'boss' };
      e.awake = false;
      this.ents.push(e);
      this.byId.set(id, e);
      return e;
    }
    const spec = UNITS[u.type];
    const e = {
      id, type: u.type, kind: u.type, team: 1, ctrl: 'ai', alive: true, hp: spec.hp * hpMul, maxHp: spec.hp * hpMul,
      radius: spec.radius, objective: !!spec.objective, harmless: !!spec.harmless, group: u.group, trigger: u.trigger,
      ai: { state: 'sleep', wake: u.wake ?? spec.wake }, reload: 1 + this.rnd() * 2, turret: 0, gunPitch: 0, tag: u.tag,
      respawn: u.respawn, home: { x: u.x, z: u.z, yaw: u.yaw || 0 }, path: u.path, pathI: 0, rise: 1, popped: 0,
    };
    initMotion(e, { ...spec, body: spec.body }, u.x, u.z, u.yaw || 0);
    e.y = this.terrain.height(u.x, u.z);
    if (spec.body === 'static') e.static = true;
    if (u.type === 'launcher' && u.trigger) { e.hidden = true; e.rise = 0; }
    if (u.type === 'amphib') { e.hidden = true; e.rise = 0; }
    if (u.type === 'mine') { e.hidden = true; }
    if (u.type === 'skyFortress') { e.y = 30; e.air = true; e.static = true; e.fpath = u.path || { cx: u.x, cz: u.z, r: 60 }; e.fa = 0; }
    if (u.type === 'target') { e.ai.state = 'idle'; }
    if (u.type === 'truck') e.ai.state = 'drive';
    this.ents.push(e);
    this.byId.set(id, e);
    return e;
  }

  // ------------------------------------------------------------ 弾
  spawnShot(s) {
    s.id = s.id ?? `${this.idPrefix || ''}s${this.nextShot++}`;
    s.life ??= 6;
    s.g ??= 1;
    s.age = 0;
    this.shots.push(s);
    if (!s.remote) this.emit({ t: 'shot', s });
    return s;
  }

  // 目標地点へ山なりに撃つ(敵の迫撃砲・爆撃の警告つき)
  lobAt(e, from, tx, tz, opt = {}) {
    const d = Math.max(dist(from.x, from.z, tx, tz), 10);
    const ang = 60 * DEG;
    const ty = this.terrain.height(tx, tz);
    const g = LOB_G * 0.6;
    // 高低差込みの初速
    const dy = ty - from.y;
    const c = Math.cos(ang), s = Math.sin(ang);
    const v2 = (g * d * d) / (2 * c * c * (d * Math.tan(ang) - dy));
    if (!(v2 > 0)) return;
    const v = Math.sqrt(v2);
    const yaw = yawTo(from.x, from.z, tx, tz);
    this.spawnShot({
      kind: 'mortar', x: from.x, y: from.y, z: from.z, vx: Math.sin(yaw) * c * v, vy: s * v, vz: Math.cos(yaw) * c * v,
      g: g / G, team: e.team, owner: e.id, dmg: opt.dmg || 20, splash: opt.splash || 6, lob: true, life: 12,
    });
    if (opt.warn) this.emit({ t: 'danger', x: tx, z: tz, r: opt.splash || 6, time: (2 * s * v) / g });
    this.emit({ t: 'fire', id: e.id, x: from.x, y: from.y, z: from.z, kind: 'lob' });
  }

  spawnMissile(e, from, target, opt = {}) {
    this.spawnShot({
      kind: 'missile', x: from.x, y: from.y, z: from.z, vx: Math.sin(e.yaw) * 4, vy: 14, vz: Math.cos(e.yaw) * 4,
      g: 0.15, team: e.team, owner: e.id, dmg: opt.dmg || 14, splash: 4, homing: target.id, life: 9, hp: 1, delay: opt.delay || 0, turn: opt.turn || 1.4, speed: 26,
    });
    this.emit({ t: 'fire', id: e.id, x: from.x, y: from.y, z: from.z, kind: 'missile' });
  }

  // ------------------------------------------------------------ 照準
  gunOrigin(e) {
    const ty = e.yaw + e.turret;
    const spec = e.spec;
    const h = spec.body === 'mech' ? 5.2 - e.crouch * 2 : spec.height * 0.72;
    const fwd = spec.radius + 1.2;
    return { x: e.x + Math.sin(ty) * fwd, y: e.y + h, z: e.z + Math.cos(ty) * fwd, yaw: ty };
  }

  computeAim(e, manual) {
    const o = this.gunOrigin(e);
    let best = null, bd = 230;
    for (const t of this.ents) {
      if (!t.alive || t.team === e.team || t.hidden || t.harmless && t.type !== 'target' && t.type !== 'truck') continue;
      const d = dist(o.x, o.z, t.x, t.z);
      if (d > bd || d < 3) continue;
      const tolerance = Math.max(1.5 * DEG, Math.atan2((t.radius || 2) * 0.8, d));
      const da = Math.abs(wrapAngle(yawTo(o.x, o.z, t.x, t.z) - o.yaw));
      if (da < tolerance) { best = t; bd = d; }
    }
    let ax, ay, az, d;
    if (best && best.type === 'boss') {
      // ボス:砲塔を向けている先に一番近い部位(撃てる部位を優先)に合わせる
      let bp = null, bs = 1e9;
      for (const p of best.parts) {
        if (!p.alive || p.armored) continue;
        const pp = partPos(best, p);
        const da = Math.abs(wrapAngle(yawTo(o.x, o.z, pp.x, pp.z) - o.yaw));
        const score = da + (partVulnerable(best, p, { lob: false, vy: 0 }) ? 0 : 0.15);
        if (score < bs) { bs = score; bp = pp; }
      }
      const tgt = bp || { x: best.x, y: best.y + 5, z: best.z };
      ax = tgt.x; ay = tgt.y; az = tgt.z;
      d = dist(o.x, o.z, ax, az);
    } else if (best) {
      d = bd;
      ax = best.x; az = best.z;
      ay = best.y + (best.spec?.height || 2) * (best.air ? 0 : 0.5);
    } else {
      const od = this.obstacles.rayDist(o.x, o.y, o.z, Math.sin(o.yaw), Math.cos(o.yaw), 160);
      d = od ?? 120;
      ax = o.x + Math.sin(o.yaw) * d;
      az = o.z + Math.cos(o.yaw) * d;
      ay = od ? o.y : this.terrain.height(ax, az) + 0.6;
    }
    e.aim.x = ax; e.aim.y = ay; e.aim.z = az; e.aim.d = d; e.aim.lock = best ? best.id : null;
    if (!manual) {
      const p = solvePitch(d, ay - o.y, e.spec.shellSpeed || 95);
      e.gunPitch = approachAngle(e.gunPitch, clamp(p - e.pitch * 0.0, GUN_MIN, GUN_MAX), 25 * DEG * (1 / 60) * 4);
    }
    // 曲射の着弾予想
    const r = e.lobAnalog ? lobRange(e.lobAmt) : this.autoLobRange(e);
    e.lobRangeNow = r;
    const lx = e.x + Math.sin(o.yaw) * r, lz = e.z + Math.cos(o.yaw) * r;
    e.lobAim = { x: lx, z: lz, y: this.terrain.height(lx, lz), r };
  }

  // ハンドブレーキがないとき:曲射の距離は自動
  autoLobRange(e) {
    const ty = e.yaw + e.turret;
    // 照準が捉えている目標(砲塔を向けている相手)を最優先
    const lock = e.aim?.lock && this.byId.get(e.aim.lock);
    if (lock && lock.alive) {
      const d = dist(e.x, e.z, lock.x, lock.z);
      if (d >= LOB_MIN && d <= LOB_MAX) return d;
    }
    let best = null, bd = 1e9;
    for (const t of this.ents) {
      if (!t.alive || t.team === e.team || t.hidden) continue;
      const d = dist(e.x, e.z, t.x, t.z);
      if (d < LOB_MIN || d > LOB_MAX) continue;
      const da = Math.abs(wrapAngle(yawTo(e.x, e.z, t.x, t.z) - ty));
      if (da > 22 * DEG) continue;
      // 向きのずれを重く見る(遠くても、まっすぐ前にいる相手を選ぶ)
      const score = (da * 400 + d * 0.3) * (t.spec?.lobOnly ? 0.4 : t.objective || t.type === 'skyFortress' ? 0.7 : 1);
      if (score < bd) { bd = score; best = t; }
    }
    return best ? dist(e.x, e.z, best.x, best.z) : 90;
  }

  // ------------------------------------------------------------ 1ステップ
  step(dt, inputs = new Map()) {
    this.time += dt;
    const m = this.mission;
    m.t += dt;
    if (m.state === 'drop' && m.t > DROP_T) {
      m.state = 'play';
      this.emit({ t: 'mission', state: 'play' });
    }
    const env = { terrain: this.terrain, obstacles: this.obstacles, debris: this.debris, comfortTurn: this.comfortTurn };

    for (const e of this.ents) {
      if (e.isPlayer || e.ctrl === 'bot') this.updateVehicle(e, e.ctrl === 'bot' ? this.botThink(e, dt) : inputs.get(e.id), env, dt);
      else if (this.authority) this.updateUnit(e, env, dt);
      else this.updatePuppet(e, dt);
    }

    // 押し合い
    const movers = this.ents.filter((e) => e.alive && !e.hidden && e.type !== 'boss' && !e.air && e.type !== 'mine' && e.type !== 'skyFortress' && !(e.drop > 0));
    for (let i = 0; i < movers.length; i++) {
      for (let j = i + 1; j < movers.length; j++) {
        const a = movers[i], b = movers[j];
        if (a.ctrl === 'remote' && b.ctrl === 'remote') continue;
        if (separate(a, b)) { if (a.isPlayer) a.bump = Math.max(a.bump, 0.3); if (b.isPlayer) b.bump = Math.max(b.bump, 0.3); }
      }
    }
    for (const bo of this.ents) {
      if (bo.type !== 'boss' || !bo.alive) continue;
      for (const v of movers) if (!v.static && pushVehicle(bo, v) && v.isPlayer) v.bump = Math.max(v.bump, 0.5);
    }

    this.updateShots(dt);
    // 煙
    for (const s of this.smokes) s.t -= dt;
    this.smokes = this.smokes.filter((s) => s.t > 0);

    if (this.authority) this.updateMission(dt);
    else this.updateElevators(true);
  }

  // ------------------------------------------------------------ プレイヤーとボットの車両
  updateVehicle(e, cmd, env, dt) {
    cmd = cmd || {};
    if (e.ctrl === 'remote') {
      // 位置はネットワークから(補間してなめらかに)。タイマーだけ進める
      e.invuln = Math.max(0, e.invuln - dt);
      if (e.net) {
        const k = Math.min(1, dt * 12);
        if (Math.hypot(e.net.x - e.x, e.net.z - e.z) > 15) { e.x = e.net.x; e.z = e.net.z; e.y = e.net.y; }
        e.x += (e.net.x - e.x) * k;
        e.z += (e.net.z - e.z) * k;
        e.y += (e.net.y - e.y) * k;
        e.yaw = approachAngle(e.yaw, e.net.yaw, Math.abs(wrapAngle(e.net.yaw - e.yaw)) * k);
        e.turret = approachAngle(e.turret, e.net.turret, Math.abs(wrapAngle(e.net.turret - e.turret)) * k);
        e.vx = e.net.vx || 0; e.vz = e.net.vz || 0;
        if (e.drop > 0) e.drop = Math.max(0, e.drop - dt / DROP_T);
      }
      return;
    }
    e.invuln = Math.max(0, e.invuln - dt);
    if (!e.alive) {
      if (e.respawnT > 0) {
        e.respawnT -= dt;
        if (e.respawnT <= 0 && this.authority) this.spawnPlayer(e);
      }
      return;
    }
    // 投下中
    if (e.drop > 0) {
      e.drop = Math.max(0, e.drop - dt / DROP_T);
      const g = this.terrain.height(e.x, e.z);
      e.y = g + 40 * e.drop * e.drop;
      if (e.drop === 0) { e.y = g; this.emit({ t: 'land', id: e.id }); }
      return;
    }
    // 変速
    const gear = cmd.gear ?? 2;
    if (gear !== e.gear) { e.gear = gear; this.emit({ t: 'gear', id: e.id, gear }); }
    // 逆立ち曲射(戦車のみ)
    const isMech = e.spec.body === 'mech';
    e.lobAnalog = !!cmd.lobAnalog;
    if (cmd.lobAmount != null) e.lobAmt = cmd.lobAmount;
    const wheelie = !isMech && cmd.lob ? 0.35 + 0.65 * (e.lobAnalog ? e.lobAmt : 0.6) : 0;
    // 履帯の損傷の修理
    for (let k = 0; k < 2; k++) {
      if (e.trackDmg[k] > 0) {
        e.trackDmg[k] -= dt;
        if (e.trackDmg[k] <= 0) { e.trackDmg[k] = 0; this.emit({ t: 'repair', id: e.id, side: k }); }
      }
    }
    // 歩行メカ:しゃがみ・急旋回・武器の持ち替え
    if (isMech && cmd.weaponSwap) { e.weapon = e.weapon === 'cannon' ? 'rockets' : 'cannon'; this.emit({ t: 'weapon', id: e.id, weapon: e.weapon }); }
    // エレベーター
    if (e.air) this.updateAir(e, dt);
    stepMotion(e, { left: cmd.left, right: cmd.right, wheelie, crouch: isMech && cmd.crouch, quickTurn: isMech && cmd.quickTurn, quickDir: cmd.quickDir }, env, dt);
    if (e.air) e.y = this.terrain.height(e.x, e.z) + e.airH;
    if (e.onDebris && Math.abs(e.v) > 2 && this.rnd() < dt * 3) this.emit({ t: 'crunch', id: e.id });

    // 砲塔:速度制御(ハンドルの角度は直結しない)
    const tr = e.spec.turret;
    if (cmd.turretYaw != null) {
      e.turret = approachAngle(e.turret, wrapAngle(cmd.turretYaw), tr * dt);
    } else {
      e.turret = wrapAngle(e.turret + clamp(cmd.turret || 0, -1, 1) * tr * dt);
    }
    // 歩行メカは上半身のひねりに限界がある
    // 砲塔の旋回範囲(前後が分からなくならないように、既定は左右 90°)。限界の手前から FFB で押し返す
    e.turretLimit = 0;
    const lim = isMech ? Math.min(115 * DEG, this.turretRange) : this.turretRange;
    if (e.isPlayer && lim < Math.PI - 0.01) {
      if (Math.abs(e.turret) > lim) e.turret = Math.sign(e.turret) * lim;
      e.turretLimit = clamp((Math.abs(e.turret) - (lim - 20 * DEG)) / (20 * DEG), 0, 1) * Math.sign(e.turret);
    }
    e.turretRate = (cmd.turret || 0);

    // 砲身の上下(手動は1段ずつ)
    const manual = !!cmd.manualPitch;
    if (manual) {
      if (cmd.pitchStep) {
        const np = clamp(e.gunPitch + cmd.pitchStep * 0.75 * DEG, GUN_MIN, GUN_MAX);
        if (np !== e.gunPitch) this.emit({ t: 'click', id: e.id });
        e.gunPitch = np;
      }
      if (cmd.pitchRate) e.gunPitch = clamp(e.gunPitch + cmd.pitchRate * 14 * DEG * dt, GUN_MIN, GUN_MAX);
    }
    this.computeAim(e, manual);
    e.spread = spreadDeg(e.v, e.spec.speed, e.w, !!e.air);

    // 装填
    if (e.reload > 0) {
      e.reload -= dt;
      if (e.reload <= 0) { e.reload = 0; this.emit({ t: 'reload', id: e.id }); }
    }
    e.mgCd -= dt;
    e.fireT = Math.max(0, e.fireT - dt);
    // 主砲
    const canFire = this.mission.state !== 'drop' && this.mission.state !== 'over' && e.reload <= 0;
    if (cmd.fire && canFire) {
      if (e.wheelie > 0.55 && !isMech) this.fireLob(e);
      else if (e.wheelie < 0.08) this.fireMain(e, cmd.fireStrength ?? 1);
    }
    // 副武装:機銃(押している間)/スモーク(押した瞬間)
    if (cmd.subSelect) { e.sub = e.sub === 'mg' ? 'smoke' : 'mg'; this.emit({ t: 'sub', id: e.id, sub: e.sub }); }
    if (e.sub === 'mg' && cmd.sub && e.mgCd <= 0 && this.mission.state !== 'drop') this.fireMG(e);
    if (e.sub === 'smoke' && cmd.subPress && e.smokeAmmo > 0) this.fireSmoke(e);
    e.hatch = !!cmd.hatch;
  }

  updateAir(e, dt) {
    e.air.t += dt;
    const t = e.air.t, D = ELEV_DUR;
    if (t < 1.3) e.airH = ELEV_H * smooth01(t / 1.3);
    else if (t < D - 1.6) e.airH = ELEV_H;
    else e.airH = ELEV_H * (1 - smooth01((t - (D - 1.6)) / 1.6));
    if (t >= D) {
      e.air = null;
      e.airH = 0;
      this.emit({ t: 'land', id: e.id, elevator: true });
    }
  }

  fireMain(e, strength = 1) {
    const o = this.gunOrigin(e);
    const sp = e.spec.shellSpeed || 95;
    const spreadR = e.spread * DEG * (e.ctrl === 'bot' ? 1.4 : 1);
    if (e.spec.body === 'mech' && e.weapon === 'rockets') {
      // 肩のロケット:3発の斉射
      for (let i = 0; i < 3; i++) {
        const [a, b] = gaussPair(this.rnd);
        const yaw = o.yaw + (i - 1) * 2.2 * DEG + a * spreadR * 0.5;
        const pitch = e.gunPitch + b * spreadR * 0.5 + 1 * DEG;
        const cp = Math.cos(pitch);
        this.spawnShot({ kind: 'rocket', x: o.x, y: o.y + 0.8, z: o.z, vx: Math.sin(yaw) * cp * 75, vy: Math.sin(pitch) * 75, vz: Math.cos(yaw) * cp * 75, team: e.team, owner: e.id, dmg: e.spec.dmg * 0.55, splash: 4.5, life: 4, g: 0.6 });
      }
      e.reload = 4.6;
    } else {
      const [a, b] = gaussPair(this.rnd);
      const yaw = o.yaw + a * spreadR * 0.5;
      const pitch = e.gunPitch + b * spreadR * 0.5;
      const cp = Math.cos(pitch);
      this.spawnShot({ kind: 'shell', x: o.x, y: o.y, z: o.z, vx: Math.sin(yaw) * cp * sp, vy: Math.sin(pitch) * sp, vz: Math.cos(yaw) * cp * sp, team: e.team, owner: e.id, dmg: e.spec.dmg, splash: e.spec.splash, life: 4 });
      e.reload = e.spec.reload;
    }
    this.mission.shots += e.isPlayer ? 1 : 0;
    e.fireT = 0.35;
    this.emit({ t: 'fire', id: e.id, x: o.x, y: o.y, z: o.z, kind: 'cannon', strength, still: e.spread < 0.2, yaw: o.yaw });
  }

  fireLob(e) {
    const o = this.gunOrigin(e);
    const r = e.lobRangeNow || 90;
    const v = lobSpeed(r);
    const c = Math.cos(LOB_ANGLE), s = Math.sin(LOB_ANGLE);
    const yaw = o.yaw + (this.rnd() - 0.5) * 0.02;
    const vv = v * (1 + (this.rnd() - 0.5) * 0.02);
    this.spawnShot({ kind: 'lob', x: e.x, y: e.y + 3, z: e.z, vx: Math.sin(yaw) * c * vv, vy: s * vv, vz: Math.cos(yaw) * c * vv, g: LOB_G / G, team: e.team, owner: e.id, dmg: e.spec.dmg * 1.1, splash: 6, lob: true, life: 10, prox: true });
    e.reload = e.spec.reload * 1.2;
    e.fireT = 0.35;
    this.emit({ t: 'fire', id: e.id, x: e.x, y: e.y + 3, z: e.z, kind: 'lob', strength: 1 });
  }

  fireMG(e) {
    const o = this.gunOrigin(e);
    e.mgCd = 1 / (e.spec.mgRate || 11);
    const yaw = o.yaw + (this.rnd() - 0.5) * 2.4 * DEG;
    const pitch = e.gunPitch + (this.rnd() - 0.5) * 1.6 * DEG;
    const sp = 150;
    this.spawnShot({ kind: 'mg', x: o.x, y: o.y - 0.3, z: o.z, vx: Math.sin(yaw) * Math.cos(pitch) * sp, vy: Math.sin(pitch) * sp, vz: Math.cos(yaw) * Math.cos(pitch) * sp, team: e.team, owner: e.id, dmg: 2.4, splash: 0, life: 1.1, g: 0.3 });
    this.emit({ t: 'fire', id: e.id, x: o.x, y: o.y, z: o.z, kind: 'mg' });
  }

  fireSmoke(e) {
    e.smokeAmmo--;
    const o = this.gunOrigin(e);
    const sp = 28;
    this.spawnShot({ kind: 'smoke', x: o.x, y: o.y + 0.5, z: o.z, vx: Math.sin(o.yaw) * sp * 0.8, vy: 9, vz: Math.cos(o.yaw) * sp * 0.8, team: e.team, owner: e.id, dmg: 0, splash: 0, life: 4 });
    this.emit({ t: 'fire', id: e.id, x: o.x, y: o.y, z: o.z, kind: 'smoke' });
  }

  // ------------------------------------------------------------ 敵
  wake(e, reason = 'near') {
    if (e.ai.state !== 'sleep' || !e.alive) return;
    e.ai.state = e.type === 'boss' ? 'active' : 'approach';
    e.awake = true;
    if (e.type === 'amphib') { e.hidden = false; e.surfacing = 1.4; }
    this.emit({ t: 'wake', id: e.id, x: e.x, y: e.y, z: e.z, type: e.type, reason });
    if (e.type === 'boss') {
      this.emit({ t: 'boss', id: e.id, name: e.name });
    }
    // 近くの仲間も起こす
    for (const o of this.ents) {
      if (o === e || o.team !== e.team || o.ai?.state !== 'sleep' || o.type === 'mine') continue;
      if ((e.group && o.group === e.group) || dist(o.x, o.z, e.x, e.z) < 26) o.ai.wakeT = o.ai.wakeT ?? 0.4 + this.rnd() * 0.8;
    }
  }

  canSee(a, b) {
    const ay = a.y + (a.spec?.height || 2) * 0.7 + (a.air ? 0 : 0);
    const by = b.y + (b.spec?.height || 2) * 0.6;
    // 煙の中は見えない
    for (const s of this.smokes) {
      const t = ((s.x - a.x) * (b.x - a.x) + (s.z - a.z) * (b.z - a.z)) / Math.max(dist2xz(a, b), 1);
      if (t < 0 || t > 1) continue;
      const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
      if (dist(px, pz, s.x, s.z) < s.r) return false;
    }
    if (a.air || b.air) return true;
    return !this.obstacles.blocked(a.x, ay, a.z, b.x, by, b.z);
  }

  players() {
    return this.ents.filter((e) => e.isPlayer && e.alive && !(e.drop > 0));
  }

  updateUnit(e, env, dt) {
    if (!e.alive) {
      if (e.respawn && (e.respawnT -= dt) <= 0) {
        e.alive = true; e.hp = e.maxHp; e.hidden = false;
        this.emit({ t: 'respawnUnit', id: e.id });
      }
      return;
    }
    const ai = e.ai;
    // 起動の判定
    if (ai.state === 'sleep' && !e.trigger) {
      if (ai.wakeT != null) {
        ai.wakeT -= dt;
        if (ai.wakeT <= 0) this.wake(e, 'alarm');
      } else if (this.mission.state === 'play' || this.mode === 'training') {
        const wr = e.type === 'boss' ? 140 : ai.wake;
        for (const p of this.players()) {
          const d = dist(e.x, e.z, p.x, p.z);
          if (d < wr && (d < wr * 0.5 || e.type === 'mine' || e.type === 'boss' || this.canSee(e, p))) { this.wake(e); break; }
        }
      }
    }
    if (e.type === 'boss') {
      if (ai.state !== 'sleep') updateBoss(e, this, dt);
      return;
    }
    const spec = e.spec;
    e.reload -= dt;
    switch (e.type) {
      case 'target':
        return;
      case 'mine': {
        if (ai.state === 'sleep') return;
        e.hidden = false;
        e.popped = Math.min(1, e.popped + dt * 3);
        ai.fuse = (ai.fuse ?? 1.7) - dt;
        if (ai.fuse <= 0) {
          this.explode({ x: e.x, y: e.y + 0.5, z: e.z, team: e.team, owner: e.id, dmg: spec.dmg * this.diff.dmg, splash: 7 }, null, 'mine');
          this.kill(e, null, true);
        }
        return;
      }
      case 'launcher': {
        if (e.trigger && e.hidden) return; // 地下で待機(updateMission で上がる)
        if (e.rise < 1) { e.rise = Math.min(1, e.rise + dt / 3); return; }
        if (ai.state === 'sleep') return;
        if (e.reload <= 0) {
          const foe = this.nearestPlayer(e, spec.range);
          if (foe) { e.reload = spec.reload * this.diff.reload; this.spawnMissile(e, { x: e.x, y: e.y + 4, z: e.z }, foe, { dmg: spec.dmg * this.diff.dmg }); }
          else e.reload = 1;
        }
        return;
      }
      case 'turret8': {
        if (ai.state === 'sleep') return;
        e.turret = wrapAngle(e.turret + dt * 0.35);
        if (e.reload <= 0) {
          const foe = this.nearestPlayer(e, spec.range);
          e.reload = spec.reload * this.diff.reload;
          if (!foe) return;
          for (let k = 0; k < 8; k++) {
            const a = e.yaw + e.turret + (k * Math.PI) / 4;
            const sp = spec.shellSpeed;
            const d = dist(e.x, e.z, foe.x, foe.z);
            const pitch = solvePitch(Math.min(d, 55), foe.y + 1 - (e.y + 1.6), sp);
            this.spawnShot({ kind: 'enemy', x: e.x + Math.sin(a) * 2.6, y: e.y + 1.6, z: e.z + Math.cos(a) * 2.6, vx: Math.sin(a) * Math.cos(pitch) * sp, vy: Math.sin(pitch) * sp, vz: Math.cos(a) * Math.cos(pitch) * sp, team: e.team, owner: e.id, dmg: spec.dmg * this.diff.dmg, splash: 2, life: 3 });
          }
          this.emit({ t: 'fire', id: e.id, x: e.x, y: e.y + 1.6, z: e.z, kind: 'cannonEnemy' });
        }
        return;
      }
      case 'bigTurret': {
        if (ai.state === 'sleep') return;
        const foe = this.nearestPlayer(e, 200);
        if (!foe) return;
        const want = yawTo(e.x, e.z, foe.x, foe.z) - e.yaw;
        e.turret = approachAngle(e.turret, wrapAngle(want), spec.turret * dt);
        const d = dist(e.x, e.z, foe.x, foe.z);
        if (e.reload <= 0 && d < spec.range && Math.abs(wrapAngle(want - e.turret)) < 4 * DEG && this.canSee(e, foe)) {
          e.reload = spec.reload * this.diff.reload;
          this.enemyShoot(e, foe, { twin: true });
        }
        return;
      }
      case 'skyFortress': {
        e.fa += dt * (8 / e.fpath.r);
        e.x = e.fpath.cx + Math.sin(e.fa) * e.fpath.r;
        e.z = e.fpath.cz + Math.cos(e.fa) * e.fpath.r;
        e.yaw = e.fa + Math.PI / 2;
        e.y = 30 + Math.sin(this.time * 0.5) * 1.5;
        if (ai.state === 'sleep') return;
        if (e.reload <= 0) {
          const foe = this.nearestPlayer(e, spec.range);
          e.reload = spec.reload * this.diff.reload;
          if (foe) {
            const tx = foe.x + (foe.vx || 0) * 2.2 + (this.rnd() - 0.5) * 6, tz = foe.z + (foe.vz || 0) * 2.2 + (this.rnd() - 0.5) * 6;
            this.spawnShot({ kind: 'bomb', x: tx, y: e.y - 3, z: tz, vx: 0, vy: -2, vz: 0, team: e.team, owner: e.id, dmg: spec.dmg * this.diff.dmg, splash: 7, life: 8 });
            this.emit({ t: 'danger', x: tx, z: tz, r: 7, time: 2.4 });
          }
        }
        return;
      }
      default:
        break;
    }
    // 戦車型(軽戦車・重戦車・指揮戦車・水陸両用・偵察車・トラック)
    if (e.surfacing > 0) { e.surfacing -= dt; e.rise = 1 - Math.max(0, e.surfacing) / 1.4; }
    if (e.type === 'truck') {
      const cmd = this.truckThink(e);
      stepMotion(e, cmd, env, dt);
      return;
    }
    if (ai.state === 'sleep') { stepMotion(e, { left: 0, right: 0 }, env, dt); if (e.type === 'amphib') e.y -= 2; return; }
    const cmd = thinkTank(e, this, dt);
    stepMotion(e, cmd, env, dt);
    if (cmd.turretYaw != null) e.turret = approachAngle(e.turret, wrapAngle(cmd.turretYaw - e.yaw), spec.turret * dt);
    const err = cmd.turretYaw != null ? Math.abs(wrapAngle(cmd.turretYaw - e.yaw - e.turret)) : 9;
    if (cmd.fire && e.reload <= 0 && err < 5 * DEG) {
      const foe = this.byIdAlive(cmd.target) || this.nearestPlayer(e, spec.range * 1.2);
      if (foe) {
        if (spec.missiles) { e.reload = spec.reload * this.diff.reload; this.spawnMissile(e, { x: e.x, y: e.y + 3, z: e.z }, foe, { dmg: spec.dmg * this.diff.dmg }); }
        else if (spec.mg) { e.reload = 0.13; e.burst = (e.burst || 0) + 1; if (e.burst > 14) { e.burst = 0; e.reload = 2.2; } this.enemyShoot(e, foe, { mg: true }); }
        else { e.reload = spec.reload * this.diff.reload * (0.85 + this.rnd() * 0.3); this.enemyShoot(e, foe); }
      }
    }
  }

  byIdAlive(id) {
    const e = id && this.byId.get(id);
    return e && e.alive ? e : null;
  }

  nearestPlayer(e, maxD = 1e9) {
    let best = null, bd = maxD;
    for (const p of this.ents) {
      if (!p.alive || p.team === e.team || p.hidden || !(p.isPlayer || p.ctrl === 'bot') || p.drop > 0) continue;
      const d = dist(e.x, e.z, p.x, p.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  truckThink(e) {
    if (!e.path) return { left: 0, right: 0 };
    const [tx, tz] = e.path[e.pathI % e.path.length];
    const s = steerTo(e, tx, tz, { arrive: 4, speed: e.ai.state === 'drive' && e.awake ? 1 : 0.7 });
    if (s.d < 8) e.pathI++;
    return { left: s.left, right: s.right };
  }

  enemyShoot(e, foe, opt = {}) {
    const spec = e.spec;
    const sp = opt.mg ? 120 : spec.shellSpeed;
    const h = e.type === 'bigTurret' ? 3.4 : spec.height * 0.7;
    const ty = e.yaw + e.turret;
    const ox = e.x + Math.sin(ty) * (spec.radius + 1), oz = e.z + Math.cos(ty) * (spec.radius + 1), oy = e.y + h;
    const d = dist(ox, oz, foe.x, foe.z);
    const t = d / sp;
    const tx = foe.x + (foe.vx || 0) * t * 0.75, tz = foe.z + (foe.vz || 0) * t * 0.75;
    const spread = (opt.mg ? 2.2 : 1.6) * DEG * this.diff.spread * (e.ai.state === 'attack' ? 1 : 1.8);
    const shots = opt.twin ? [-1, 1] : [0];
    for (const k of shots) {
      const [a, b] = gaussPair(this.rnd);
      const yaw = yawTo(ox, oz, tx, tz) + a * spread;
      const pitch = solvePitch(d, foe.y + 1.2 - oy, sp) + b * spread;
      const cp = Math.cos(pitch);
      const sx = ox + Math.cos(ty) * k * 0.8, sz = oz - Math.sin(ty) * k * 0.8;
      this.spawnShot({ kind: opt.mg ? 'mgEnemy' : 'enemy', x: sx, y: oy, z: sz, vx: Math.sin(yaw) * cp * sp, vy: Math.sin(pitch) * sp, vz: Math.cos(yaw) * cp * sp, team: e.team, owner: e.id, dmg: spec.dmg * this.diff.dmg, splash: opt.mg ? 0 : 2.5, life: opt.mg ? 1.3 : 4, big: opt.twin });
    }
    e.fireT = 0.35;
    this.emit({ t: 'fire', id: e.id, x: ox, y: oy, z: oz, kind: opt.mg ? 'mgEnemy' : opt.twin ? 'bigCannon' : 'cannonEnemy' });
  }

  // 対戦ボット
  botThink(e, dt) {
    if (!e.alive || e.drop > 0) return {};
    const ai = e.ai;
    ai.state = ai.state === 'sleep' ? 'approach' : ai.state || 'approach';
    // ルールごとの目的地
    ai.goalOverride = null;
    const m = this.mission;
    if (m.rule === 'dom' && this.points) {
      const pts = this.points.filter((p) => p.owner !== e.team);
      if (pts.length) {
        const p = pts.reduce((a, b) => (dist(e.x, e.z, a.x, a.z) < dist(e.x, e.z, b.x, b.z) ? a : b));
        ai.goalOverride = { x: p.x, z: p.z };
      }
    } else if (m.rule === 'ctf' && this.flags) {
      const enemyFlag = this.flags[1 - e.team];
      if (enemyFlag.carrier === e.id) ai.goalOverride = { x: this.flags[e.team].hx, z: this.flags[e.team].hz };
      else if (!enemyFlag.carrier) ai.goalOverride = { x: enemyFlag.x, z: enemyFlag.z };
    }
    if (ai.goalOverride) ai.goal = ai.goalOverride;
    e.spec.range = 75;
    const c = thinkTank(e, this, dt);
    if (ai.goalOverride && ai.state === 'attack' && dist(e.x, e.z, ai.goalOverride.x, ai.goalOverride.z) > 8) {
      const s = steerTo(e, ai.goalOverride.x, ai.goalOverride.z, { arrive: 3, speed: 0.8 });
      c.left = s.left; c.right = s.right;
    }
    const cmd = { left: c.left, right: c.right, gear: 2 };
    if (c.turretYaw != null) {
      cmd.turretYaw = wrapAngle(c.turretYaw - e.yaw);
      const err = Math.abs(wrapAngle(c.turretYaw - e.yaw - e.turret));
      cmd.fire = c.fire && err < 3 * DEG && Math.random() < 0.5;
    }
    cmd.sub = c.fire && e.aim.d < 45;
    return cmd;
  }

  // クライアント側:ホストから届いた敵の状態へ補間する
  updatePuppet(e, dt) {
    if (!e.net) return;
    const k = Math.min(1, dt * 10);
    e.x += (e.net.x - e.x) * k;
    e.z += (e.net.z - e.z) * k;
    e.y += (e.net.y - e.y) * k;
    e.yaw = approachAngle(e.yaw, e.net.yaw, Math.abs(wrapAngle(e.net.yaw - e.yaw)) * k);
    e.turret = approachAngle(e.turret || 0, e.net.turret || 0, Math.abs(wrapAngle((e.net.turret || 0) - (e.turret || 0))) * k);
    if (e.trackDmg == null) e.trackDmg = [0, 0];
  }

  // ------------------------------------------------------------ 弾の移動と命中
  updateShots(dt) {
    const keep = [];
    for (const s of this.shots) {
      if (s.delay > 0) { s.delay -= dt; keep.push(s); continue; }
      s.age += dt;
      s.life -= dt;
      if (s.life <= 0 || s.dead) {
        if (!s.dead && (s.kind === 'smoke')) this.makeSmoke(s.x, s.z);
        else if (!s.dead && s.kind === 'missile') this.explode(s, null, 'air');
        continue;
      }
      // 追尾
      if (s.homing) {
        const t = this.byId.get(s.homing);
        if (t && t.alive && s.age > 0.5) {
          const sp = s.speed || 26;
          const tx = t.x - s.x, ty = t.y + 1.5 - s.y, tz = t.z - s.z;
          const L = Math.hypot(tx, ty, tz) || 1;
          const k = Math.min(1, s.turn * dt);
          s.vx += ((tx / L) * sp - s.vx) * k;
          s.vy += ((ty / L) * sp - s.vy) * k;
          s.vz += ((tz / L) * sp - s.vz) * k;
        }
      }
      const speed = Math.hypot(s.vx, s.vy, s.vz);
      const n = Math.max(1, Math.ceil((speed * dt) / 1.8));
      const h = dt / n;
      let done = false;
      for (let i = 0; i < n && !done; i++) {
        s.vy -= G * s.g * h;
        s.x += s.vx * h;
        s.y += s.vy * h;
        s.z += s.vz * h;
        done = this.shotCollide(s);
      }
      if (!done) keep.push(s);
    }
    this.shots = keep;
  }

  shotCollide(s) {
    // 空中目標への近接信管(曲射弾)
    if (s.prox) {
      for (const e of this.ents) {
        if (!e.alive || !e.air || e.team === s.team || e.isPlayer) continue;
        if (Math.hypot(e.x - s.x, e.y - s.y, e.z - s.z) < 8) { this.explode(s, e, 'air'); return true; }
      }
    }
    // 迎撃:プレイヤーの弾で敵のミサイルを落とす
    if (s.team === 0 && (s.kind === 'mg' || s.kind === 'shell')) {
      for (const m of this.shots) {
        if (m.kind !== 'missile' || m.team === s.team || m.dead) continue;
        if (Math.hypot(m.x - s.x, m.y - s.y, m.z - s.z) < 2.2) {
          m.dead = true;
          this.emit({ t: 'explode', x: m.x, y: m.y, z: m.z, size: 1, kind: 'air' });
          return true;
        }
      }
    }
    // 車両・敵
    for (const e of this.ents) {
      if (!e.alive || e.hidden || e.team === s.team || e.id === s.owner || e.drop > 0) continue;
      if (e.type === 'boss') {
        if (dist(e.x, e.z, s.x, s.z) > e.radius + 8) continue;
        for (const p of e.parts) {
          if (!p.alive) continue;
          const pp = partPos(e, p);
          if (Math.hypot(pp.x - s.x, pp.y - s.y, pp.z - s.z) < p.r + (s.kind === 'mg' ? 0.2 : 0.6)) {
            if (partVulnerable(e, p, s)) this.damagePart(e, p, s);
            else this.emit({ t: 'ricochet', x: s.x, y: s.y, z: s.z, id: e.id });
            this.explode(s, e, 'hit', true);
            return true;
          }
        }
        if (bodyHit(e, s.x, s.y, s.z)) {
          this.emit({ t: 'ricochet', x: s.x, y: s.y, z: s.z, id: e.id });
          this.explode(s, e, 'hit', true);
          return true;
        }
        continue;
      }
      const r = e.radius;
      const dx = e.x - s.x, dz = e.z - s.z;
      if (dx * dx + dz * dz > r * r) continue;
      let h = e.spec?.height || 2;
      if (e.crouch) h *= 1 - 0.45 * e.crouch;
      const y0 = e.air ? e.y - (e.type === 'skyFortress' ? 3 : 0) : e.y - 0.4;
      if (s.y < y0 || s.y > y0 + h + (e.wheelie > 0.3 ? 2.5 : 0)) continue;
      this.explode(s, e, 'hit');
      return true;
    }
    // 遮蔽物
    const ob = this.obstacles.pointHit(s.x, s.y, s.z);
    if (ob) { this.explode(s, null, 'ground'); return true; }
    // 水面と地面
    const gy = this.terrain.height(s.x, s.z);
    if (s.y < WATER_Y && this.terrain.isWater(s.x, s.z)) { this.explode(s, null, 'water'); return true; }
    if (s.y < gy) { this.explode(s, null, 'ground'); return true; }
    if (!this.terrain.inBounds(s.x, s.z, -60) || s.y > 300) return true;
    return false;
  }

  makeSmoke(x, z) {
    this.smokes.push({ x, z, r: 11, t: 13 });
    this.emit({ t: 'smoke', x, z, y: this.terrain.height(x, z) });
  }

  // 爆発:直撃と範囲ダメージ
  explode(s, direct, kind, noDamageDirect = false) {
    if (s.kind === 'smoke') { this.makeSmoke(s.x, s.z); return; }
    const size = s.kind === 'mg' || s.kind === 'mgEnemy' ? 0.2 : s.kind === 'bomb' || s.lob ? 2 : s.big ? 1.4 : 1;
    this.emit({ t: 'explode', x: s.x, y: s.y, z: s.z, size, kind, shot: s.kind, team: s.team });
    if (!this.authority) return;
    const src = { team: s.team, owner: s.owner, x: s.x - s.vx * 0.05, z: s.z - s.vz * 0.05, lob: !!s.lob || s.vy < -10, kind: s.kind, vy: s.vy };
    if (direct && !noDamageDirect && direct.type !== 'boss') this.damage(direct, s.dmg, src);
    if (s.splash > 0) {
      for (const e of this.ents) {
        if (!e.alive || e === direct || e.hidden || e.team === s.team || e.type === 'boss') continue;
        const d = Math.hypot(e.x - s.x, e.y + 1 - s.y, e.z - s.z);
        if (d < s.splash + e.radius * 0.5) this.damage(e, s.dmg * 0.55 * (1 - d / (s.splash + e.radius)), { ...src, splash: true });
      }
    }
  }

  damagePart(e, p, s) {
    if (!this.authority) return;
    // つながった部位(掘削機の排気口 → 動力炉)へダメージを回す
    if (p.link) { const q = e.parts.find((x) => x.name === p.link); if (q && q.alive) p = q; }
    let dmg = s.dmg;
    if (e.stunned) dmg *= 1.5;
    p.hp -= dmg;
    this.emit({ t: 'hitPart', id: e.id, part: p.name, hp: p.hp / p.maxHp, x: s.x, y: s.y, z: s.z });
    this.creditHit(s.owner);
    if (p.hp <= 0) {
      p.alive = false;
      const pp = partPos(e, p);
      this.emit({ t: 'partDown', id: e.id, part: p.name, x: pp.x, y: pp.y, z: pp.z });
      if (onPartDestroyed(e, p, this)) this.kill(e, s.owner);
    }
  }

  creditHit(ownerId) {
    const o = this.byId.get(ownerId);
    if (o && o.isPlayer) this.mission.hits++;
  }

  damage(e, dmg, src) {
    if (!this.authority || !e.alive || e.invuln > 0 || dmg <= 0) return;
    if (this.mode === 'training' && e.isPlayer) return;
    if (e.spec?.lobOnly && !src.lob) {
      this.emit({ t: 'ricochet', x: e.x, y: e.y + 2, z: e.z, id: e.id, armor: true });
      return;
    }
    if (e.type === 'skyFortress' && !(src.lob || src.kind === 'shell' || src.kind === 'rocket' || src.kind === 'mg')) return;
    let mul = 1;
    if (e.isPlayer || e.ctrl === 'bot') {
      mul *= e.spec.armor;
      const rel = wrapAngle(yawTo(e.x, e.z, src.x, src.z) - e.yaw);
      const side = Math.abs(rel) > 0.65 && Math.abs(rel) < 2.5;
      if (Math.abs(rel) >= 2.5) mul *= 1.3;
      else if (side) mul *= e.wheelie > 0.3 ? 1.5 : 1.15;
      if (e.hatch) mul *= 1.3;
      // 側面の被弾で履帯が切れる
      if (side && !src.splash && dmg >= 8 && e.spec.body === 'tank' && this.rnd() < 0.3) {
        const k = rel > 0 ? 0 : 1; // 左から撃たれたら左の履帯
        if (e.trackDmg[k] <= 0) { e.trackDmg[k] = 6; this.emit({ t: 'trackBreak', id: e.id, side: k }); }
      }
      if (this.mode === 'versus' && src.team === e.team) return;
    }
    const d = dmg * mul;
    e.hp -= d;
    const owner = this.byId.get(src.owner);
    if (owner?.isPlayer && e.team !== owner.team) this.creditHit(src.owner);
    this.emit({ t: 'hit', id: e.id, dmg: d, fx: src.x, fz: src.z, hp: e.hp / e.maxHp, by: src.owner, kind: src.kind });
    if (e.ai) { e.ai.hitT = e.isPlayer ? 0 : 2.2; if (e.ai.state === 'sleep') this.wake(e, 'hit'); }
    if (e.hp <= 0) this.kill(e, src.owner);
  }

  kill(e, by, silent = false) {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    const killer = by && this.byId.get(by);
    const m = this.mission;
    if (!silent) this.emit({ t: 'kill', id: e.id, by, x: e.x, y: e.y, z: e.z, type: e.type || e.kind, big: e.type === 'boss' || e.objective, air: !!e.air });
    if (e.type === 'boss' || e.objective || e.type === 'skyFortress') this.emit({ t: 'objective', id: e.id, type: e.type });
    // 残骸は減速地形になる
    if ((e.spec?.body === 'tank' || e.spec?.body === 'mech') && !e.air && e.type !== 'truck') {
      this.debris.push({ x: e.x, z: e.z, r: e.radius + 1.6, yaw: e.yaw, kind: e.kind || e.type });
      if (this.debris.length > 40) this.debris.shift();
    }
    if (e.isPlayer || e.ctrl === 'bot') {
      e.deaths++;
      e.air = null;
      e.trackDmg = [0, 0];
      if (this.mode === 'versus') {
        e.respawnT = RESPAWN_T;
        if (killer && killer.team !== e.team) { killer.kills++; m.teamScore[killer.team] += m.rule === 'dm' ? 1 : 0; }
        if (this.flags) for (const f of this.flags) if (f.carrier === e.id) { f.carrier = null; f.x = e.x; f.z = e.z; f.home = false; this.emit({ t: 'flagDrop', team: f.team }); }
      } else if (this.mode === 'training') {
        e.respawnT = 2;
      } else {
        m.deaths++;
        m.lives--;
        if (m.lives >= 0) e.respawnT = this.mode === 'coop' ? RESPAWN_T : 3;
        else e.respawnT = 0;
      }
    } else {
      // 敵
      if (killer && (killer.isPlayer || killer.ctrl === 'bot')) {
        killer.kills++;
        const sc = e.type === 'boss' ? 10000 : (e.spec?.score || 100);
        killer.score += sc;
        m.score += sc;
        m.kills++;
        if (e.spec?.bonus) { m.bonus += sc; this.emit({ t: 'bonus', id: e.id, score: sc, x: e.x, y: e.y, z: e.z }); }
      }
      if (e.respawn) e.respawnT = e.respawn;
    }
  }

  // ------------------------------------------------------------ 任務の進行
  // エレベーター(クライアントは自分の車両だけ判定し、ホストへ知らせる)
  updateElevators(onlyLocal = false) {
    const m = this.mission;
    for (const e of this.ents) {
      if (!e.alive || !(e.isPlayer || e.ctrl === 'bot') || e.drop > 0) continue;
      if (onlyLocal ? e.ctrl !== 'local' : e.ctrl === 'remote') continue;
      let on = null;
      for (const el of this.elevators) if (dist(e.x, e.z, el.x, el.z) < el.r) on = el;
      if (!on) { e.elevLock = false; continue; }
      if (!e.air && !e.elevLock && this.elevUses > 0 && m.state !== 'drop') {
        e.elevLock = true;
        this.elevUses--;
        e.air = { t: 0 };
        e.airH = 0;
        e.tl = e.tr = 0;
        this.emit({ t: 'elevator', id: e.id, left: this.elevUses });
        // 周囲の敵に気づかれる
        this.wakeAround(e);
      }
    }
  }

  wakeAround(e) {
    for (const u of this.ents) if (u.team !== e.team && u.ai?.state === 'sleep' && u.type !== 'mine' && dist(u.x, u.z, e.x, e.z) < 85) u.ai.wakeT = 0.5 + this.rnd();
  }

  updateMission(dt) {
    const m = this.mission;
    this.updateElevators(false);
    // 門と発射台
    for (const g of this.gates) {
      if (!g.alive || g.opening) continue;
      if (!this.ents.some((u) => u.group === g.gate && u.alive && u.team === 1)) {
        g.opening = true;
        g.alive = false;
        this.emit({ t: 'gate', id: g.id, x: g.x, z: g.z });
        // 中間地点:門の、次の敵がいる側へ 10m
        const nextGroup = `r${Number(String(g.gate).replace(/\D/g, '')) + 1}`;
        const next = this.ents.find((u) => u.group === nextGroup && u.alive) || this.ents.find((u) => u.objective && u.alive);
        if (next) {
          const horiz = g.w > g.d;
          const sx = horiz ? 0 : Math.sign(next.x - g.x) || 1, sz = horiz ? Math.sign(next.z - g.z) || 1 : 0;
          // 門の手前(いま制圧した側)に置く。次の部屋へは門をくぐってすぐ
          this.checkpoint = { x: g.x - sx * 10, z: g.z - sz * 10, yaw: Math.atan2(sx, sz) };
        }
        this.radio('mech', '門が開いた!次の区画へ進め。');
      }
    }
    for (const u of this.ents) {
      if (u.type === 'launcher' && u.trigger && u.hidden && u.alive) {
        if (!this.ents.some((o) => o.group === u.trigger && o.alive && o.team === 1)) {
          u.hidden = false;
          u.rise = 0;
          u.ai.state = 'approach';
          if (!this.launcherWarned) {
            this.launcherWarned = true;
            this.radio('leader', '地面が割れた……発射台が出てきたぞ!壁の中だ、曲射で狙え!');
          }
          this.emit({ t: 'rise', id: u.id, x: u.x, z: u.z });
        }
      }
    }
    if (this.mode === 'versus') return this.updateVersus(dt);
    if (this.mode === 'training') return;

    if (m.state === 'play') {
      m.timeLeft -= dt;
      for (const w of [60, 30, 10]) {
        if (m.timeLeft < w && !m.warned[w]) {
          m.warned[w] = true;
          this.radio('leader', w === 60 ? '残り1分!急げ!' : w === 30 ? '残り30秒だ!' : '時間がない!');
        }
      }
      const left = this.ents.filter((e) => e.objective && e.alive).length;
      if (left !== m.objectivesLeft) {
        m.objectivesLeft = left;
        if (left > 0) this.radio('leader', `目標を撃破。残り${left}。`);
      }
      if (left === 0 && m.objectives > 0) {
        m.state = 'clear';
        m.timeBonus = Math.floor(Math.max(0, m.timeLeft)) * 50;
        m.noDeathBonus = m.deaths === 0 ? 3000 : 0;
        m.score += m.timeBonus + m.noDeathBonus;
        if (this.exit) this.exit.open = true;
        this.emit({ t: 'mission', state: 'clear' });
        this.radio('leader', this.stage.boss ? 'やった、デカブツを仕留めた!穴へ降りて撤収しろ。' : '全目標撃破!穴へ降りて次の地区へ向かえ。');
      } else if (m.timeLeft <= 0) {
        this.fail('time');
      } else if (m.lives < 0 && !this.ents.some((e) => e.isPlayer && e.alive)) {
        this.fail('lives');
      }
    } else if (m.state === 'clear') {
      m.exitT += dt;
      const ex = this.exit;
      const inHole = ex && this.ents.some((e) => e.isPlayer && e.alive && dist(e.x, e.z, ex.x, ex.z) < ex.r);
      if (inHole || m.exitT > 30 || !ex) {
        m.state = 'exit';
        m.exitT = 0;
        this.emit({ t: 'mission', state: 'exit' });
      }
    } else if (m.state === 'exit') {
      m.exitT += dt;
      for (const e of this.ents) if (e.isPlayer && e.alive && this.exit) { e.x += (this.exit.x - e.x) * dt * 2; e.z += (this.exit.z - e.z) * dt * 2; e.y -= dt * 6; e.frozen = true; }
      if (m.exitT > 2.6) { m.state = 'done'; this.emit({ t: 'mission', state: 'done' }); }
    }
  }

  fail(reason) {
    const m = this.mission;
    m.state = 'fail';
    m.failReason = reason;
    this.emit({ t: 'mission', state: 'fail', reason });
    this.radio('leader', reason === 'time' ? '時間切れだ……撤退する。' : '全機やられた……撤退だ。');
  }

  updateVersus(dt) {
    const m = this.mission;
    if (m.state !== 'play') return;
    m.timeLeft -= dt;
    if (m.rule === 'dom') {
      for (const p of this.points) {
        let n0 = 0, n1 = 0;
        for (const e of this.ents) if (e.alive && (e.isPlayer || e.ctrl === 'bot') && dist(e.x, e.z, p.x, p.z) < p.r) e.team ? n1++ : n0++;
        const before = p.owner;
        p.prog = clamp(p.prog + (n0 - n1) * 0.3 * dt, -1, 1);
        if (p.prog >= 1) p.owner = 0;
        else if (p.prog <= -1) p.owner = 1;
        else if ((p.owner === 0 && p.prog <= 0) || (p.owner === 1 && p.prog >= 0)) p.owner = -1;
        if (p.owner !== before) this.emit({ t: 'capture', id: p.id, team: p.owner });
        if (p.owner >= 0) m.teamScore[p.owner] += dt;
      }
    } else if (m.rule === 'ctf') {
      for (const f of this.flags) {
        const carrier = f.carrier && this.byId.get(f.carrier);
        if (carrier) { f.x = carrier.x; f.z = carrier.z; }
        for (const e of this.ents) {
          if (!e.alive || !(e.isPlayer || e.ctrl === 'bot') || e.drop > 0) continue;
          if (dist(e.x, e.z, f.x, f.z) > 5) continue;
          if (e.team !== f.team && !f.carrier) { f.carrier = e.id; f.home = false; this.emit({ t: 'flag', team: f.team, by: e.id }); }
          else if (e.team === f.team && !f.carrier && !f.home) { f.x = f.hx; f.z = f.hz; f.home = true; this.emit({ t: 'flagReturn', team: f.team }); }
        }
      }
      // 持ち帰り
      for (const f of this.flags) {
        const c = f.carrier && this.byId.get(f.carrier);
        if (!c) continue;
        const own = this.flags[c.team];
        if (own.home && dist(c.x, c.z, own.hx, own.hz) < 6) {
          m.teamScore[c.team]++;
          c.score += 1;
          f.carrier = null; f.x = f.hx; f.z = f.hz; f.home = true;
          this.emit({ t: 'capture', team: c.team, by: c.id, flag: true });
        }
      }
    }
    const [a, b] = m.teamScore;
    if (a >= m.target || b >= m.target || m.timeLeft <= 0) {
      m.state = 'over';
      m.winner = a === b ? -1 : a > b ? 0 : 1;
      this.emit({ t: 'mission', state: 'over', winner: m.winner });
    }
  }
}

function dist2xz(a, b) {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}
