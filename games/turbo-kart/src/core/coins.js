// パーティーモードのコイン: コース上に並べ、拾うと最高速が少し上がる（最大 COIN_MAX 枚）
// 取ったコインは COIN_RESPAWN 秒後に復活する。配置はコースごとに決まっていて、オンラインでも全員同じ
import { pointAt, wrapS } from './track.js';
import { mulberry32 } from './rng.js';

export const COIN_MAX = 10;
export const COIN_BONUS = 0.006; // 1 枚あたりの最高速の上昇（10 枚で +6%）
export const COIN_RESPAWN = 8;
const GROUP_GAP = 110; // コインの列の間隔 (m)
const PER_GROUP = 5;
const SPACING = 3.2;

export function coinLayout(track) {
  const rng = mulberry32(7);
  const hw = track.halfWidth;
  const s0 = track.def.startS || 0;
  const out = [];
  for (let s = s0 + 70; s < s0 + track.length - 50; s += GROUP_GAP) {
    // 加速パネルの近くは避ける
    const near = (track.def.boostPads || []).some((p) => Math.abs(wrapS(track, p.s - s + track.length / 2) - track.length / 2) < 25);
    if (near) continue;
    const lane = [-0.45, 0, 0.45][Math.floor(rng() * 3)] * hw;
    for (let i = 0; i < PER_GROUP; i++) {
      const cs = wrapS(track, s + i * SPACING);
      const p = pointAt(track, cs, lane);
      out.push({ s: cs, lateral: lane, x: p.x, z: p.z });
    }
  }
  return out;
}

// race.time を使って、取られたコインの復活と、カートが拾ったかを判定する
export function collectCoins(race) {
  const t = race.track;
  const time = race.time;
  for (const c of race.coins) {
    if (c.respawnAt > time) continue;
    for (const e of race.karts) {
      if (e.finished && e.type !== 'remote') continue;
      let ds = Math.abs(e.loc.s - c.s);
      ds = Math.min(ds, t.length - ds);
      if (ds > 1.6 || Math.abs(e.loc.lateral - c.lateral) > race.spec.radius * 0.8 + 0.5) continue;
      c.respawnAt = time + COIN_RESPAWN;
      e.coins = Math.min(COIN_MAX, (e.coins || 0) + 1);
      // 他プレイヤーのカートは見た目だけ（速さは本人の画面で計算される）
      if (e.type !== 'remote') e.kart.topBonus = e.coins * COIN_BONUS;
      e.events.push({ type: 'coin', count: e.coins });
      break;
    }
  }
}
