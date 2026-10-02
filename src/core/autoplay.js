// オートプレイ: 譜面から各手の位置を時刻の関数として計算する。
// デモ再生と、譜面が実際に切り切れるかの自動テストの両方に使う
import { DIR_VEC, Dir } from './slice.js';
import { noteTarget } from './judge.js';
import { HAND_Z, BLADE_LENGTH, BLADE_OFFSET, BLADE_TILT } from './config.js';

const SW = 0.14; // スイング半区間（秒）。ノーツ時刻の ±SW で振り抜く
const AMP = 0.45; // ノーツ中心から振り始め／振り終わりまでの距離
const REST = [{ x: -0.45, y: 1.0 }, { x: 0.45, y: 1.0 }];

const smooth = (u) => {
  const k = Math.min(1, Math.max(0, u));
  return k * k * (3 - 2 * k);
};
const mix = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

export function swingVec(note) {
  const v = DIR_VEC[note.dir];
  if (v && note.dir !== Dir.ANY) return v;
  return note.swing === 'down' ? { x: 0, y: -1 } : { x: 0, y: 1 };
}

// 手の位置から刀身の付け根・先端（刀身は -Z 方向へ少し上向き）
export function bladeFromHand(hand, tilt = BLADE_TILT) {
  const sy = Math.sin(tilt), cz = Math.cos(tilt);
  return {
    hilt: { x: hand.x, y: hand.y + sy * BLADE_OFFSET, z: hand.z - cz * BLADE_OFFSET },
    tip: { x: hand.x, y: hand.y + sy * (BLADE_OFFSET + BLADE_LENGTH), z: hand.z - cz * (BLADE_OFFSET + BLADE_LENGTH) },
  };
}

export class Autoplay {
  constructor(map, heightOffset = 0) {
    this.h = heightOffset;
    this.hands = [0, 1].map((c) => map.notes.filter((n) => n.color === c));
    this.walls = map.walls.filter((w) => w.kind === 'half');
  }

  start(n) {
    const t = noteTarget(n, this.h), v = swingVec(n);
    return { x: t.x - v.x * AMP, y: t.y - v.y * AMP };
  }

  end(n) {
    const t = noteTarget(n, this.h), v = swingVec(n);
    return { x: t.x + v.x * AMP, y: t.y + v.y * AMP };
  }

  rest(color) {
    return { x: REST[color].x, y: REST[color].y + this.h };
  }

  // 次に振る（または振っている最中の）ノーツの添字
  indexAt(list, t) {
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].time + SW <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  handPos(color, t) {
    const list = this.hands[color];
    const i = this.indexAt(list, t);
    const n = list[i];
    const prev = list[i - 1];
    let p;
    if (n && t >= n.time - SW) {
      p = mix(this.start(n), this.end(n), smooth((t - (n.time - SW)) / (2 * SW)));
    } else if (!n && !prev) {
      p = this.rest(color);
    } else if (!n) {
      p = mix(this.end(prev), this.rest(color), smooth((t - (prev.time + SW)) / 0.6));
    } else if (!prev) {
      const toT = n.time - SW;
      p = mix(this.rest(color), this.start(n), smooth((t - (toT - 0.6)) / 0.6));
    } else {
      const fromT = prev.time + SW, toT = n.time - SW;
      const gap = toT - fromT;
      const from = this.end(prev), to = this.start(n);
      if (gap > 1.6) {
        // 長い休みはいったん構えの位置に戻る
        const r = this.rest(color);
        p = t < fromT + 0.6 ? mix(from, r, smooth((t - fromT) / 0.6)) : mix(r, to, smooth((t - (toT - 0.6)) / 0.6));
      } else {
        p = mix(from, to, smooth((t - fromT) / gap));
      }
    }
    // 中央を越えて反対の手のレーンに入らないようにする
    const x = color === 0 ? Math.min(p.x, -0.1) : Math.max(p.x, 0.1);
    return { x, y: p.y, z: HAND_Z };
  }

  // 中央寄りの壁を避けるための頭の横移動量
  headOffsetX(t) {
    let x = 0;
    for (const w of this.walls) {
      const a = w.time - 0.6, b = w.time + w.duration + 0.4;
      if (t < a - 0.4 || t > b + 0.4) continue;
      const k = t < a ? smooth((t - (a - 0.4)) / 0.4) : t > b ? 1 - smooth((t - b) / 0.4) : 1;
      x += (w.x0 < 0 ? 0.32 : -0.32) * k;
    }
    return x;
  }
}
