// 敵AI:休眠 → 接近(側面へ回り込む)→ 攻撃(止まって撃ち、撃たれたら遮蔽物へ下がる)
// 対戦のボットもこれを使う。出力は履帯の指示(プレイヤーと同じ共通アクション)
import { clamp, wrapAngle, yawTo, dist } from './util.js';

// 目標地点へ向かう履帯の指示
export function steerTo(e, tx, tz, opt = {}) {
  const want = yawTo(e.x, e.z, tx, tz);
  const err = wrapAngle(want - e.yaw);
  const d = dist(e.x, e.z, tx, tz);
  const arrive = opt.arrive ?? 6;
  let fwd = clamp(d / (arrive * 2), 0, 1) * (opt.speed ?? 1);
  // 大きくずれていたらその場で回る(超信地旋回)
  if (Math.abs(err) > 1.0) fwd = 0;
  else fwd *= Math.cos(err);
  if (d < arrive) fwd = 0;
  const turn = clamp(err * 1.8, -1, 1);
  // 左旋回(err>0)= 右の履帯を速く
  return { left: clamp(fwd - turn, -1, 1), right: clamp(fwd + turn, -1, 1), err, d };
}

// 障害物と水をよける向きの補正(前方を探って、ふさがっていれば横へ逃がす)
export function avoid(e, sim, tx, tz) {
  const look = 9;
  const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
  const blocked = (ang) => {
    const cx = e.x + Math.sin(e.yaw + ang) * look, cz = e.z + Math.cos(e.yaw + ang) * look;
    if (sim.terrain.isWater(cx, cz, e.spec.radius) && !e.spec.swim) return true;
    if (!sim.terrain.inBounds(cx, cz, 3)) return true;
    for (const o of sim.obstacles.near(cx, cz, e.spec.radius + 1)) {
      if (o.passable) continue;
      const dx = cx - o.x, dz = cz - o.z;
      if (Math.hypot(dx, dz) < o.br + e.spec.radius) return true;
    }
    return false;
  };
  if (!blocked(0)) return { x: tx, z: tz };
  e.ai.side ??= Math.random() < 0.5 ? 1 : -1;
  for (const a of [0.6, 1.1, 1.6]) {
    for (const s of [e.ai.side, -e.ai.side]) {
      if (!blocked(a * s)) {
        e.ai.side = s;
        return { x: e.x + Math.sin(e.yaw + a * s) * 20, z: e.z + Math.cos(e.yaw + a * s) * 20 };
      }
    }
  }
  return { x: e.x - fx * 10, z: e.z - fz * 10 };
}

// 一番近い敵(見えているもの優先)
export function nearestFoe(e, sim, maxD = 1e9) {
  let best = null, bd = maxD;
  for (const o of sim.ents) {
    if (!o.alive || o.team === e.team || o.harmless || o.hidden) continue;
    if (o.team !== 0 && e.team !== 0 && sim.mode !== 'versus') continue;
    const d = dist(e.x, e.z, o.x, o.z);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

// 遮蔽物の陰になる地点を探す(相手から見て遮蔽物の向こう側)
export function findCover(e, sim, foe) {
  let best = null, bd = 1e9;
  for (const o of sim.obstacles.near(e.x, e.z, 40)) {
    if (o.passable || o.h < 2) continue;
    const ang = yawTo(foe.x, foe.z, o.x, o.z);
    const off = o.br + e.spec.radius + 2;
    const cx = o.x + Math.sin(ang) * off, cz = o.z + Math.cos(ang) * off;
    if (sim.terrain.isWater(cx, cz, 2) && !e.spec.swim) continue;
    const d = dist(e.x, e.z, cx, cz);
    if (d < bd) { bd = d; best = { x: cx, z: cz }; }
  }
  return best;
}

// 戦車型の敵とボットの思考。cmd を返す(turretYaw は砲塔の目標の絶対方位)
export function thinkTank(e, sim, dt) {
  const ai = e.ai;
  ai.t = (ai.t || 0) + dt;
  ai.think = (ai.think || 0) - dt;
  const cmd = { left: 0, right: 0, turretYaw: null, fire: false, mg: false };
  const foe = ai.forceTarget && ai.forceTarget.alive ? ai.forceTarget : nearestFoe(e, sim);
  if (!foe) return cmd;
  const d = dist(e.x, e.z, foe.x, foe.z);
  const range = e.spec.range || 60;

  if (ai.state === 'sleep') return cmd;

  // 目標(見越し)に砲塔を向ける
  const sp = e.spec.shellSpeed || 80;
  const t = d / sp;
  const lx = foe.x + (foe.vx || 0) * t * 0.8, lz = foe.z + (foe.vz || 0) * t * 0.8;
  cmd.turretYaw = yawTo(e.x, e.z, lx, lz);
  cmd.aimX = lx;
  cmd.aimZ = lz;
  cmd.aimY = foe.y + (foe.spec?.height || 2) * 0.5;

  const los = d < range && sim.canSee(e, foe);

  // 撃たれたら遮蔽物へ下がる
  if (ai.hitT > 0) {
    ai.hitT -= dt;
    if (!ai.cover) ai.cover = findCover(e, sim, foe);
    if (ai.cover) {
      const s = steerTo(e, ai.cover.x, ai.cover.z, { arrive: 3 });
      Object.assign(cmd, { left: s.left, right: s.right });
      ai.state = 'retreat';
      cmd.fire = los && Math.random() < 0.3;
      return cmd;
    }
  } else {
    ai.cover = null;
  }

  if (los && d < range * 0.85) {
    // 攻撃:止まって撃つ。対戦ボットは少し動き回る
    ai.state = 'attack';
    if (e.ctrl === 'bot' && ai.strafe) {
      const s = steerTo(e, ai.strafe.x, ai.strafe.z, { arrive: 4, speed: 0.6 });
      Object.assign(cmd, { left: s.left, right: s.right });
      if (s.d < 5) ai.strafe = null;
    } else if (e.ctrl === 'bot' && Math.random() < dt * 0.3) {
      const a = Math.random() * 6.28;
      ai.strafe = { x: e.x + Math.sin(a) * 15, z: e.z + Math.cos(a) * 15 };
    }
    cmd.fire = true;
    cmd.mg = !!e.spec.mg;
    if (e.spec.kind === 'scout') {
      // 偵察車は周りを回りながら撃つ
      const a = yawTo(foe.x, foe.z, e.x, e.z) + 0.5;
      const s = steerTo(e, foe.x + Math.sin(a) * 28, foe.z + Math.cos(a) * 28, { arrive: 3 });
      Object.assign(cmd, { left: s.left, right: s.right });
    }
    return cmd;
  }

  // 接近:プレイヤーの側面へ回り込む
  ai.state = 'approach';
  if (ai.think <= 0 || !ai.goal) {
    ai.think = 1.2 + Math.random();
    ai.flank ??= Math.random() < 0.5 ? 1 : -1;
    const side = (foe.yaw || 0) + (Math.PI / 2) * ai.flank;
    const r = Math.min(range * 0.6, d * 0.7);
    ai.goal = { x: foe.x + Math.sin(side) * r * 0.6 + (e.x - foe.x) * 0.25, z: foe.z + Math.cos(side) * r * 0.6 + (e.z - foe.z) * 0.25 };
    if (ai.goalOverride) ai.goal = ai.goalOverride;
  }
  const g = avoid(e, sim, ai.goal.x, ai.goal.z);
  const s = steerTo(e, g.x, g.z, { arrive: 5 });
  Object.assign(cmd, { left: s.left, right: s.right });
  // 動きながらでも、射程内で見えていればときどき撃つ
  cmd.fire = los && Math.random() < 0.35;
  return cmd;
}
