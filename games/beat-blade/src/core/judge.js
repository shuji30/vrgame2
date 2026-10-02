// ノーツの位置計算と、刀身との接触・切断判定（ゲーム本体とテストシミュレーションで共用）
import { LANE_X, ROW_Y, HIT_Z, LOOKAHEAD } from './config.js';
import { sweepTest, lerp3, evaluateCut, cutScore, rotate2 } from './slice.js';

const JUMP = 0.3; // 出現直後の「跳ね上がり」演出の割合

export function objectZ(time, t, njs) {
  return HIT_Z - (time - t) * njs;
}

export function noteTarget(obj, heightOffset = 0) {
  return { x: LANE_X[obj.lane], y: ROW_Y[obj.row] + heightOffset };
}

const easeOutCubic = (k) => 1 - Math.pow(1 - k, 3);

// 時刻 t でのノーツ（または爆弾）の姿勢 {x, y, z, angle}
export function notePose(obj, t, njs, heightOffset = 0) {
  const tgt = noteTarget(obj, heightOffset);
  const z = objectZ(obj.time, t, njs);
  const p = 1 - (obj.time - t) / LOOKAHEAD;
  let y = tgt.y;
  let angle = obj.angle || 0;
  if (p < JUMP) {
    const k = easeOutCubic(Math.max(0, p) / JUMP);
    y = 0.15 + (tgt.y - 0.15) * k;
    angle += (1 - k) * Math.PI;
  }
  return { x: tgt.x, y, z, angle };
}

// saber: { prevHilt, prevTip, hilt, tip, dt }
// 接触していれば { vel: 接触点の刀身速度, local: ノーツローカルの接触点, f } を返す
export function testContact(saber, prevPose, pose, half) {
  const hit = sweepTest(saber.prevHilt, saber.prevTip, saber.hilt, saber.tip, prevPose, pose, pose.angle, half);
  if (!hit) return null;
  const p0 = lerp3(saber.prevHilt, saber.prevTip, hit.f);
  const p1 = lerp3(saber.hilt, saber.tip, hit.f);
  const dt = Math.max(saber.dt, 1e-4);
  const vel = { x: (p1.x - p0.x) / dt, y: (p1.y - p0.y) / dt, z: (p1.z - p0.z) / dt };
  return { vel, local: hit.local, f: hit.f };
}

// 接触したノーツの判定。good なら score を含む
export function judgeCut(note, saber, contact, pose) {
  const ev = evaluateCut({
    dir: note.dir,
    color: note.color,
    saberColor: saber.color,
    anyColor: saber.anyColor,
    vel: contact.vel,
  });
  if (ev.type !== 'good') return ev;
  // 切断線（接触点を通りスイング方向に伸びる線）とノーツ中心の距離
  const lv = rotate2(contact.vel, -pose.angle);
  const len = Math.hypot(lv.x, lv.y) || 1;
  const offset = Math.abs((contact.local.x * lv.y - contact.local.y * lv.x) / len);
  return { ...ev, offset, score: cutScore({ speed: ev.speed, dirDot: ev.dirDot, offset }) };
}

// 頭（球）と壁（AABB）の衝突。壁の手前の面は wall.time に z=0 を通過する
export function wallBox(wall, t, njs) {
  const front = -(wall.time - t) * njs;
  return {
    x0: wall.x0, x1: wall.x1, y0: wall.y0, y1: wall.y1,
    z1: front, z0: front - wall.duration * njs,
  };
}

export function headInWall(head, box, radius) {
  const cx = Math.min(Math.max(head.x, box.x0), box.x1);
  const cy = Math.min(Math.max(head.y, box.y0), box.y1);
  const cz = Math.min(Math.max(head.z, box.z0), box.z1);
  const dx = head.x - cx, dy = head.y - cy, dz = head.z - cz;
  return dx * dx + dy * dy + dz * dz < radius * radius;
}
