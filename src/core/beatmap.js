// 曲の構成から譜面を自動生成する。
// 方針: 左手=赤=レーン0-1、右手=青=レーン2-3。各手は「下→上→下…」と交互に振る（パリティ）ので
// 無理のない流れになる。同じ手の連続間隔、壁・爆弾の配置も手の動きと衝突しないよう制約する。
import { Dir, dirAngle, mirrorDir } from './slice.js';
import { mulberry32, hashString } from './rng.js';
import { sectionAt } from './songs.js';

export const DIFFICULTIES = {
  easy: {
    key: 'easy', name: 'Easy', step: 2, sameHandGap: 2, njs: 9, density: 0.9,
    doubleChance: 0, diagChance: 0, dotChance: 0.15, rowVar: 0.1, bombChance: 0, walls: 'none',
  },
  normal: {
    key: 'normal', name: 'Normal', step: 1, sameHandGap: 2, njs: 11, density: 0.85,
    doubleChance: 0.1, diagChance: 0.2, dotChance: 0.08, rowVar: 0.2, bombChance: 0, walls: 'none',
  },
  hard: {
    key: 'hard', name: 'Hard', step: 1, sameHandGap: 1, njs: 13, density: 0.85,
    doubleChance: 0.15, diagChance: 0.35, dotChance: 0.05, rowVar: 0.3, bombChance: 0.1, walls: 'outer',
  },
  expert: {
    key: 'expert', name: 'Expert', step: 0.5, sameHandGap: 1, njs: 15, density: 0.85,
    doubleChance: 0.12, diagChance: 0.4, dotChance: 0.04, rowVar: 0.35, bombChance: 0.12, walls: 'half',
  },
};
export const DIFF_ORDER = ['easy', 'normal', 'hard', 'expert'];

const SIDE_LANES = [[0, 1], [2, 3]];
const INNER = [1, 2];
const OUTER = [0, 3];
// 壁の前後に確保する余白（拍）
const WALL_MARGIN = 1;

function wallBlocks(wall, beat, lane) {
  return beat >= wall.beat - WALL_MARGIN && beat <= wall.beat + wall.beats + WALL_MARGIN && wall.lanes.includes(lane);
}

function generateWalls(song, diff, rng, secPerBeat) {
  const walls = [];
  if (diff.walls === 'none') return walls;
  for (const sec of song.sections) {
    if (sec.energy < 0.6) continue;
    const startBeat = sec.from * 4 + 4;
    const endBeat = sec.to * 4 - 4;
    if (endBeat - startBeat < 8) continue;
    if (diff.walls === 'half' && rng() < 0.6) {
      // 中央寄りの壁: 体を反対側へ傾けて避ける
      const side = rng() < 0.5 ? 0 : 1;
      const beats = 2 + Math.floor(rng() * 3);
      walls.push(makeWall(startBeat + 4, beats, SIDE_LANES[side], side === 0 ? [-1.0, -0.1] : [0.1, 1.0], secPerBeat, 'half'));
    } else if (rng() < 0.55) {
      const side = rng() < 0.5 ? 0 : 1;
      const lane = OUTER[side];
      const beats = 4 + Math.floor(rng() * 5);
      const x = side === 0 ? [-1.0, -0.5] : [0.5, 1.0];
      walls.push(makeWall(startBeat, beats, [lane], x, secPerBeat, 'outer'));
    }
  }
  return walls;
}

function makeWall(beat, beats, lanes, xRange, secPerBeat, kind) {
  return {
    beat, beats, lanes, kind,
    time: beat * secPerBeat,
    duration: beats * secPerBeat,
    x0: xRange[0], x1: xRange[1], y0: 0, y1: 2.4,
  };
}

export function generateBeatmap(song, diffKey) {
  const diff = DIFFICULTIES[diffKey];
  if (!diff) throw new Error(`unknown difficulty: ${diffKey}`);
  const rng = mulberry32(hashString(`${song.id}:${diffKey}`));
  const secPerBeat = 60 / song.bpm;
  const totalBeats = song.bars * 4;
  const firstBeat = 8;
  const lastBeat = totalBeats - 8;

  const walls = generateWalls(song, diff, rng, secPerBeat);
  const notes = [];
  const hands = [
    { last: -99, parity: 'up' },
    { last: -99, parity: 'up' },
  ];
  let nextHand = 1;

  // 爆弾を置くために片手を休ませる区間 [from, to)
  const rests = [[], []];
  const resting = (h, beat) => rests[h].some(([a, b]) => beat >= a && beat < b);
  const lanesFor = (h, beat) => SIDE_LANES[h].filter((l) => !walls.some((w) => wallBlocks(w, beat, l)));
  const canHand = (h, beat) =>
    beat - hands[h].last >= diff.sameHandGap - 1e-6 && !resting(h, beat) && lanesFor(h, beat).length > 0;
  // 休みが長ければ自然な「振り下ろし」から始める
  const nextParity = (h, beat) =>
    beat - hands[h].last > 4 ? 'down' : hands[h].parity === 'down' ? 'up' : 'down';

  const pickRow = () => {
    const r = rng();
    if (r < diff.rowVar * 0.35) return 2;
    if (r < diff.rowVar) return 1;
    return 0;
  };

  const pickDir = (h, lane, parity) => {
    if (rng() < diff.dotChance) return Dir.ANY;
    if (rng() < diff.diagChance) {
      const inner = INNER.includes(lane);
      // 内側レーンで内向きに斜め切りすると反対の手のレーンへはみ出すので外向きのみ
      const outward = inner || rng() < 0.6;
      const goLeft = h === 0 ? outward : !outward;
      if (parity === 'down') return goLeft ? Dir.DOWN_LEFT : Dir.DOWN_RIGHT;
      return goLeft ? Dir.UP_LEFT : Dir.UP_RIGHT;
    }
    return parity === 'down' ? Dir.DOWN : Dir.UP;
  };

  const place = (h, beat, lane, row, dir, parity) => {
    notes.push({
      beat,
      time: beat * secPerBeat,
      lane, row, dir, color: h,
      swing: parity,
      angle: dirAngle(dir),
    });
    hands[h].last = beat;
    hands[h].parity = parity;
  };

  for (let beat = firstBeat; beat <= lastBeat + 1e-6; beat += diff.step) {
    const energy = sectionAt(song, Math.floor(beat / 4)).energy;
    if (energy < 0.25) continue;
    if (beat % 4 === 0 && diff.bombChance && energy >= 0.6 && rng() < diff.bombChance * 1.5) {
      rests[rng() < 0.5 ? 0 : 1].push([beat + 1, beat + 3]);
    }
    const offbeat = Math.abs(beat % 1) > 1e-6;
    let p = diff.density * (0.4 + 0.6 * energy);
    if (offbeat) p *= energy;
    if (rng() >= p) continue;

    const wantDouble = !offbeat && rng() < diff.doubleChance * energy * 1.5;
    if (wantDouble && canHand(0, beat) && canHand(1, beat) && nextParity(0, beat) === nextParity(1, beat)) {
      const parity = nextParity(0, beat);
      const useInner = rng() < 0.6;
      const lanes = [useInner ? 1 : 0, useInner ? 2 : 3];
      if (lanesFor(0, beat).includes(lanes[0]) && lanesFor(1, beat).includes(lanes[1])) {
        const row = pickRow();
        const dirL = pickDir(0, lanes[0], parity);
        const dirR = dirL === Dir.ANY ? Dir.ANY : mirrorDir(dirL);
        place(0, beat, lanes[0], row, dirL, parity);
        place(1, beat, lanes[1], row, dirR, parity);
        continue;
      }
    }

    let h = -1;
    if (canHand(nextHand, beat)) h = nextHand;
    else if (canHand(1 - nextHand, beat)) h = 1 - nextHand;
    if (h < 0) continue;

    const avail = lanesFor(h, beat);
    const innerLane = INNER[h];
    const outerLane = OUTER[h];
    let lane;
    if (!avail.includes(outerLane)) lane = innerLane;
    else if (!avail.includes(innerLane)) lane = outerLane;
    else lane = rng() < 0.55 ? innerLane : outerLane;
    const parity = nextParity(h, beat);
    place(h, beat, lane, pickRow(), pickDir(h, lane, parity), parity);
    nextHand = 1 - h;
  }

  notes.sort((a, b) => a.time - b.time || a.color - b.color);
  const bombs = generateBombs(song, diff, rng, notes, walls, secPerBeat, firstBeat, lastBeat);
  notes.forEach((n, i) => { n.id = i; });

  return {
    song, diff,
    njs: diff.njs,
    notes, bombs, walls,
    duration: totalBeats * secPerBeat,
  };
}

// 爆弾: その手が前後 1 拍ノーツを持たない時刻に、外側レーン最上段へ置く。
// 爆弾を挟む直前・直後のノーツを最下段へ寄せ、手の通り道（下〜中段）と重ならないようにする
function generateBombs(song, diff, rng, notes, walls, secPerBeat, firstBeat, lastBeat) {
  const bombs = [];
  if (!diff.bombChance) return bombs;
  for (let beat = firstBeat + 2; beat <= lastBeat - 2; beat += 0.5) {
    const energy = sectionAt(song, Math.floor(beat / 4)).energy;
    if (energy < 0.5 || rng() >= diff.bombChance * energy) continue;
    const h = rng() < 0.5 ? 0 : 1;
    const mine = notes.filter((n) => n.color === h);
    if (mine.some((n) => Math.abs(n.beat - beat) < 1)) continue;
    const lane = OUTER[h];
    if (walls.some((w) => wallBlocks(w, beat, lane))) continue;
    if (bombs.some((b) => Math.abs(b.beat - beat) < 1)) continue;
    const prev = mine.filter((n) => n.beat < beat).pop();
    const next = mine.find((n) => n.beat > beat);
    // 同時押しの相方も揃えて下段へ
    for (const n of [prev, next]) {
      if (!n) continue;
      for (const m of notes) if (m.beat === n.beat) m.row = 0;
    }
    bombs.push({ beat, time: beat * secPerBeat, lane, row: 2, angle: 0 });
  }
  return bombs;
}
