// エリアボス4体。どれも採掘用の機械を兵器に作り替えた物
// 部位(parts)ごとに体力を持ち、光る弱点(weak)を壊すと倒せる。胴体(body)は弾を止める
import { approachAngle, clamp, dist, wrapAngle, yawTo, smooth01 } from './util.js';
import { solvePitch } from './ballistics.js';

const P = (name, ox, oy, oz, r, hp, extra = {}) => ({ name, ox, oy, oz, r, hp, maxHp: hp, alive: true, ...extra });

export const BOSSES = {
  hauler: {
    name: '移動要塞 ホーラー', hpScale: 1,
    body: { w: 12, d: 26, h: 7, y0: 0.5 }, radius: 13,
    parts: () => [
      P('t1', 4, 8, 7, 1.9, 60, { gun: true }), P('t2', -4, 8, 7, 1.9, 60, { gun: true }),
      P('t3', 4, 8, -5, 1.9, 60, { gun: true }), P('t4', -4, 8, -5, 1.9, 60, { gun: true }),
      P('mortar', 0, 8.6, 1, 2.1, 80, { mortar: true }),
      P('core', 0, 4, -13.6, 2.6, 340, { weak: true, core: true }),
    ],
  },
  walker: {
    name: '多脚制圧戦車 グラップル', hpScale: 1,
    body: { w: 13, d: 13, h: 4.5, y0: 6.5 }, radius: 8,
    parts: () => [
      P('k1', 7.5, 4, 6, 1.7, 55, { weak: true, knee: true }), P('k2', -7.5, 4, 6, 1.7, 55, { weak: true, knee: true }),
      P('k3', 7.5, 4, -6, 1.7, 55, { weak: true, knee: true }), P('k4', -7.5, 4, -6, 1.7, 55, { weak: true, knee: true }),
      P('cannon', 0, 12, 3.5, 1.7, 90, { gun: true }),
      P('core', 0, 5.6, 0, 2.5, 260, { weak: true, core: true, shielded: true }),
    ],
  },
  dredger: {
    name: '浚渫要塞 マッドリバー', hpScale: 1,
    body: { w: 14, d: 30, h: 6, y0: -1 }, radius: 15, swim: true,
    parts: () => [
      P('v1', 7.4, 2.6, -4, 2.4, 70, { weak: true, vent: true }), P('v2', -7.4, 2.6, -4, 2.4, 70, { weak: true, vent: true }),
      P('bucket', 0, 4, 15.5, 2.6, 110, { arm: true }),
      P('core', 0, 6.4, -2, 2.6, 220, { weak: true, core: true, shielded: true, topOnly: true }),
    ],
  },
  driller: {
    name: '巨大掘削機 ボアラー', hpScale: 1,
    body: { w: 14, d: 30, h: 10, y0: 0 }, radius: 16,
    parts: () => [
      P('drill', 0, 5, 17, 3.5, 9999, { armored: true }),
      P('s1', 7.6, 9, 2, 1.9, 85, { gun: true }), P('s2', -7.6, 9, 2, 1.9, 85, { gun: true }),
      P('core', 0, 6, -15.6, 3, 300, { weak: true, core: true }),
      // 止まっている(気絶)間だけ開く上の排気口。当てると動力炉にダメージが通る
      P('vent', 0, 13, -3, 2.8, 1e6, { weak: true, stunOnly: true, link: 'core' }),
    ],
  },
};

export function initBoss(e, def, hpMul = 1) {
  const B = BOSSES[def.boss];
  e.boss = def.boss;
  e.bossDef = B;
  e.name = B.name;
  e.parts = B.parts();
  for (const p of e.parts) { p.hp *= hpMul; p.maxHp = p.hp; }
  e.radius = B.radius;
  e.path = def.path || null;
  e.pathI = 1;
  e.phase = 'idle';
  e.pt = 0; // 状態の経過時間
  e.cd = { gun: 2, mortar: 4, missile: 5, sweep: 6, stomp: 0 };
  e.lower = 0; // 多脚:胴体が落ちた量
  e.sub = 0; // 浚渫:潜っている量
  e.objective = true;
  e.v = 0;
  e.speed = 0;
}

// 部位のワールド座標
export function partPos(e, p) {
  const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
  let oy = p.oy;
  if (e.boss === 'walker' && !p.knee) oy -= e.lower * 3.2;
  if (e.boss === 'dredger') oy -= e.sub * 7;
  return { x: e.x + p.ox * c + p.oz * s, y: e.y + oy, z: e.z - p.ox * s + p.oz * c };
}

// 部位が弾を受け付けるか
export function partVulnerable(e, p, shot) {
  if (!p.alive || p.armored) return false;
  if (p.stunOnly && !e.stunned) return false;
  if (e.boss === 'dredger' && e.sub > 0.5) return false;
  if (p.shielded) {
    if (e.boss === 'walker' && e.parts.filter((q) => q.knee && !q.alive).length < 2) return false;
    if (e.boss === 'dredger' && e.parts.some((q) => q.vent && q.alive)) return false;
  }
  // 上からしか狙えない:曲射弾か、落ちてくる弾だけ
  if (p.topOnly && !(shot.lob || shot.vy < -6)) return false;
  return true;
}

// 胴体の箱に当たったか
export function bodyHit(e, x, y, z) {
  const b = e.bossDef.body;
  const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
  const dx = x - e.x, dz = z - e.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  let y0 = e.y + b.y0;
  if (e.boss === 'walker') y0 -= e.lower * 3.2;
  if (e.boss === 'dredger') y0 -= e.sub * 7;
  return Math.abs(lx) < b.w / 2 && Math.abs(lz) < b.d / 2 && y > y0 && y < y0 + b.h;
}

// 車両を胴体の外へ押し出す(移動する障害物)
export function pushVehicle(e, v) {
  const b = e.bossDef.body;
  if (e.boss === 'walker') {
    // 脚の間はくぐれないよう、円で押す
    const d = dist(e.x, e.z, v.x, v.z);
    const rr = 7.5 + v.spec.radius;
    if (d < rr && d > 1e-3) { v.x = e.x + ((v.x - e.x) / d) * rr; v.z = e.z + ((v.z - e.z) / d) * rr; return true; }
    return false;
  }
  if (e.boss === 'dredger' && e.sub > 0.6) return false;
  const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
  const dx = v.x - e.x, dz = v.z - e.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const hx = b.w / 2 + v.spec.radius, hz = b.d / 2 + v.spec.radius;
  if (Math.abs(lx) >= hx || Math.abs(lz) >= hz) return false;
  let nx = lx, nz = lz;
  if (hx - Math.abs(lx) < hz - Math.abs(lz)) nx = Math.sign(lx) * hx; else nz = Math.sign(lz) * hz;
  v.x = e.x + nx * c + nz * s;
  v.z = e.z - nx * s + nz * c;
  return true;
}

function nearestPlayer(e, sim, maxD = 1e9) {
  let best = null, bd = maxD;
  for (const p of sim.ents) {
    if (!p.alive || p.team !== 0 || p.hidden || !p.isPlayer) continue;
    const d = dist(e.x, e.z, p.x, p.z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// 部位の砲から撃つ
function fireFrom(e, sim, p, foe, opt = {}) {
  const pp = partPos(e, p);
  const d = dist(pp.x, pp.z, foe.x, foe.z);
  const sp = opt.speed || 70;
  const t = d / sp;
  const tx = foe.x + (foe.vx || 0) * t * 0.7, tz = foe.z + (foe.vz || 0) * t * 0.7;
  const sk = opt.spread || 1;
  const yaw = yawTo(pp.x, pp.z, tx, tz) + (sim.rnd() - 0.5) * 0.05 * sim.diff.spread * sk;
  const pitch = solvePitch(d, foe.y + 1.2 - pp.y, sp) + (sim.rnd() - 0.5) * 0.03 * sim.diff.spread * sk;
  const cp = Math.cos(pitch);
  sim.spawnShot({
    kind: 'enemy', x: pp.x + Math.sin(yaw) * 2, y: pp.y, z: pp.z + Math.cos(yaw) * 2,
    vx: Math.sin(yaw) * cp * sp, vy: Math.sin(pitch) * sp, vz: Math.cos(yaw) * cp * sp,
    team: e.team, owner: e.id, dmg: (opt.dmg || 16) * sim.diff.dmg, splash: opt.splash || 3, big: true,
  });
  sim.emit({ t: 'fire', id: e.id, x: pp.x, y: pp.y, z: pp.z, kind: 'bigCannon' });
}

// 迫撃砲:目標の場所へ山なりに撃ち、着弾点に警告を出す
function mortar(e, sim, p, foe) {
  const pp = partPos(e, p);
  const tx = foe.x + (sim.rnd() - 0.5) * 8, tz = foe.z + (sim.rnd() - 0.5) * 8;
  sim.lobAt(e, pp, tx, tz, { dmg: 20 * sim.diff.dmg, splash: 6.5, warn: true });
}

function followPath(e, sim, dt, speed) {
  if (!e.path) return;
  const [tx, tz] = e.path[e.pathI % e.path.length];
  if (dist(e.x, e.z, tx, tz) < 8) e.pathI++;
  const want = yawTo(e.x, e.z, tx, tz);
  e.yaw = approachAngle(e.yaw, want, 0.35 * dt);
  const err = Math.abs(wrapAngle(want - e.yaw));
  e.v = speed * clamp(1.4 - err, 0.2, 1);
  e.x += Math.sin(e.yaw) * e.v * dt;
  e.z += Math.cos(e.yaw) * e.v * dt;
}

export function updateBoss(e, sim, dt) {
  e.pt += dt;
  for (const k in e.cd) e.cd[k] -= dt;
  const foe = nearestPlayer(e, sim);
  const ground = sim.terrain.height(e.x, e.z);
  const px = e.x, pz = e.z;
  e.v = 0;

  if (e.boss === 'hauler') {
    e.y = ground;
    followPath(e, sim, dt, 4.2);
    if (foe) {
      // 甲板の砲塔:順番に撃つ
      const guns = e.parts.filter((p) => p.gun && p.alive);
      if (guns.length && e.cd.gun <= 0 && dist(e.x, e.z, foe.x, foe.z) < 95) {
        e.cd.gun = 3.4 / Math.sqrt(guns.length) * sim.diff.reload;
        fireFrom(e, sim, guns[Math.floor(sim.rnd() * guns.length)], foe, { dmg: 14 });
      }
      const m = e.parts.find((p) => p.mortar && p.alive);
      if (m && e.cd.mortar <= 0) { e.cd.mortar = 6 * sim.diff.reload; mortar(e, sim, m, foe); }
    }
  } else if (e.boss === 'walker') {
    const down = e.parts.filter((p) => p.knee && !p.alive).length;
    e.lower = Math.min(1, e.lower + (down >= 2 ? dt * 0.8 : 0));
    e.y = ground;
    if (foe) {
      const d = dist(e.x, e.z, foe.x, foe.z);
      const want = yawTo(e.x, e.z, foe.x, foe.z);
      e.yaw = approachAngle(e.yaw, want, (down >= 2 ? 0.25 : 0.5) * dt);
      const sp = down >= 2 ? 1.2 : 3.2;
      if (d > 32) { e.v = sp; e.x += Math.sin(e.yaw) * sp * dt; e.z += Math.cos(e.yaw) * sp * dt; }
      if (e.v > 0 && e.cd.stomp <= 0) { e.cd.stomp = 0.8; sim.emit({ t: 'stomp', id: e.id, x: e.x, z: e.z }); }
      const gun = e.parts.find((p) => p.gun && p.alive);
      if (gun && e.cd.gun <= 0 && d < 100) { e.cd.gun = 3.4 * sim.diff.reload; fireFrom(e, sim, gun, foe, { dmg: 14, spread: 1.6 }); }
      // 機銃の掃射(扇状)
      if (e.cd.sweep <= 0 && d < 70) {
        e.cd.sweep = 7 * sim.diff.reload;
        e.sweepT = 1.6;
      }
      if (e.sweepT > 0) {
        e.sweepT -= dt;
        if (Math.floor(e.sweepT * 14) !== Math.floor((e.sweepT + dt) * 14)) {
          const a = want + Math.sin(e.sweepT * 3) * 0.5;
          const sp2 = 110;
          sim.spawnShot({ kind: 'mgEnemy', x: e.x, y: e.y + 8 - e.lower * 3, z: e.z, vx: Math.sin(a) * sp2, vy: -((8 - e.lower * 3) / Math.max(d, 10)) * sp2, vz: Math.cos(a) * sp2, team: e.team, owner: e.id, dmg: 2.2, splash: 0, life: 1.2 });
          sim.emit({ t: 'fire', id: e.id, x: e.x, y: e.y + 8, z: e.z, kind: 'mgEnemy' });
        }
      }
    }
  } else if (e.boss === 'dredger') {
    // 川を行き来しながら、浮上と潜行をくり返す
    const ventsLeft = e.parts.filter((p) => p.vent && p.alive).length;
    // 吸気口を壊したら、もう潜れない(浮いたまま上のハッチが開く)
    const wantSub = ventsLeft > 0 && e.pt % 20 > 14 ? 1 : 0;
    e.sub = clamp(e.sub + (wantSub ? 1 : -1) * dt * 0.5, 0, 1);
    if (e.sub > 0.95 && e.wasUp) { e.wasUp = false; sim.emit({ t: 'splash', x: e.x, y: 0, z: e.z, big: true }); }
    if (e.sub < 0.05) e.wasUp = true;
    e.y = -1.4;
    const zMin = -120, zMax = 120;
    e.dir ??= 1;
    if (e.z > zMax) e.dir = -1;
    if (e.z < zMin) e.dir = 1;
    e.yaw = approachAngle(e.yaw, e.dir > 0 ? 0 : Math.PI, 0.4 * dt);
    // 吸気口を壊されたら機関が止まり、その場に浮いたまま動けない(曲射の的になる)
    if (ventsLeft > 0 && Math.abs(wrapAngle((e.dir > 0 ? 0 : Math.PI) - e.yaw)) < 0.3) {
      e.v = 3;
      e.z += Math.cos(e.yaw) * 3 * dt;
    }
    if (foe && e.sub < 0.3) {
      const d = dist(e.x, e.z, foe.x, foe.z);
      if (e.cd.mortar <= 0 && d < 130) {
        e.cd.mortar = 5.5 * sim.diff.reload;
        mortar(e, sim, e.parts.find((p) => p.name === 'core'), foe);
      }
      // バケットの腕で岸をなぎ払う
      const arm = e.parts.find((p) => p.arm && p.alive);
      if (arm) {
        const ap = partPos(e, arm);
        if (dist(ap.x, ap.z, foe.x, foe.z) < 17 && e.cd.sweep <= 0) {
          e.cd.sweep = 2.4;
          sim.emit({ t: 'drill', id: e.id, x: ap.x, z: ap.z });
          sim.damage(foe, 18 * sim.diff.dmg, { team: e.team, owner: e.id, x: ap.x, z: ap.z, kind: 'melee' });
        }
      }
    }
  } else if (e.boss === 'driller') {
    e.y = ground;
    if (!foe) return;
    const d = dist(e.x, e.z, foe.x, foe.z);
    const want = yawTo(e.x, e.z, foe.x, foe.z);
    if (e.phase === 'idle' || e.phase === 'track') {
      e.phase = 'track';
      e.yaw = approachAngle(e.yaw, want, 0.45 * dt);
      if (d > 40) { e.v = 2.5; e.x += Math.sin(e.yaw) * 2.5 * dt; e.z += Math.cos(e.yaw) * 2.5 * dt; }
      const guns = e.parts.filter((p) => p.gun && p.alive);
      if (guns.length && e.cd.gun <= 0 && d < 100) { e.cd.gun = 6 * sim.diff.reload; fireFrom(e, sim, guns[Math.floor(sim.rnd() * guns.length)], foe, { dmg: 9, spread: 1.8 }); }
      if (e.cd.missile <= 0) {
        e.cd.missile = 14 * sim.diff.reload;
        for (let i = 0; i < 3; i++) sim.spawnMissile(e, { x: e.x + Math.sin(e.yaw + 3.14) * 6, y: e.y + 11, z: e.z + Math.cos(e.yaw + 3.14) * 6 }, foe, { delay: i * 0.35, dmg: 7 * sim.diff.dmg, turn: 1.0 });
      }
      if (e.pt > 9 && Math.abs(wrapAngle(want - e.yaw)) < 0.25 && d < 110) {
        e.phase = 'windup';
        e.pt = 0;
        sim.emit({ t: 'drill', id: e.id, x: e.x, z: e.z, big: true });
        sim.radio('mech', 'ドリルが回り出した!突っ込んでくるぞ、横へ逃げろ!');
      }
    } else if (e.phase === 'windup') {
      e.yaw = approachAngle(e.yaw, want, 0.2 * dt);
      if (e.pt > 2.2) { e.phase = 'charge'; e.pt = 0; }
    } else if (e.phase === 'charge') {
      const sp = 20;
      e.v = sp;
      e.x += Math.sin(e.yaw) * sp * dt;
      e.z += Math.cos(e.yaw) * sp * dt;
      // 体当たり
      for (const p of sim.ents) {
        if (!p.alive || !p.isPlayer || p.hidden) continue;
        const dp = partPos(e, e.parts[0]);
        if (dist(dp.x, dp.z, p.x, p.z) < 5 + p.spec.radius && !p.rammed) {
          p.rammed = 1;
          sim.damage(p, 20 * sim.diff.dmg, { team: e.team, owner: e.id, x: e.x, z: e.z, kind: 'ram' });
          p.x += Math.sin(e.yaw) * 6;
          p.z += Math.cos(e.yaw) * 6;
        }
      }
      // 壁か柱に当たったら止まる(気絶)
      const nose = { x: e.x + Math.sin(e.yaw) * 16, z: e.z + Math.cos(e.yaw) * 16 };
      const hitWall = !sim.terrain.inBounds(nose.x, nose.z, 2) || [...sim.obstacles.near(nose.x, nose.z, 6)].some((o) => !o.passable && dist(o.x, o.z, nose.x, nose.z) < o.br + 4);
      if (hitWall || e.pt > 3.5) {
        // 壁に当たれば長く(8 秒)、外れても機関が過熱して短く(4 秒)止まる。止まっている間は上の排気口が開く
        e.phase = 'stun';
        e.stunLen = hitWall ? 8 : 4;
        e.pt = 0;
        if (!hitWall) sim.radio('mech', '突進のあとで機関が過熱してる!上の排気口を狙え!');
        for (const p of sim.ents) p.rammed = 0;
        if (hitWall) {
          sim.emit({ t: 'explode', x: nose.x, y: 4, z: nose.z, size: 3, kind: 'ground' });
          sim.emit({ t: 'quake', x: nose.x, z: nose.z });
          sim.radio('mech', '壁にめり込んだ!上の排気口が開いたぞ、今だ!後ろの動力炉でもいい!');
        }
      }
    } else if (e.phase === 'stun') {
      e.stunned = true;
      if (e.pt > (e.stunLen || 8)) { e.phase = 'track'; e.pt = 0; e.stunned = false; }
    }
  }

  // 場外に出ない
  const t = sim.terrain;
  e.x = clamp(e.x, -t.hw + 10, t.hw - 10);
  e.z = clamp(e.z, -t.hd + 10, t.hd - 10);
  e.vx = (e.x - px) / Math.max(dt, 1e-4);
  e.vz = (e.z - pz) / Math.max(dt, 1e-4);
}

// 部位を壊したとき。倒したら true
export function onPartDestroyed(e, p, sim) {
  if (p.core) return true;
  if (e.boss === 'walker' && p.knee) {
    const n = e.parts.filter((q) => q.knee && !q.alive).length;
    if (n === 2) sim.radio('mech', '脚が折れた!胴体が落ちるぞ、腹の動力炉が見えた!');
  }
  if (e.boss === 'dredger' && p.vent) {
    if (!e.parts.some((q) => q.vent && q.alive)) sim.radio('mech', '吸気口をつぶした!機関が止まって上のハッチが開いたぞ、曲射で上から叩き込め!');
  }
  if (e.boss === 'hauler' && p.gun && !e.parts.some((q) => q.gun && q.alive)) sim.radio('mech', '甲板の砲塔は全部黙らせた。あとは機関部だ!');
  return false;
}

export const bossProgress = (e) => {
  const core = e.parts.find((p) => p.core);
  return core ? clamp(core.hp / core.maxHp, 0, 1) : 0;
};

export { smooth01 };
