// コースごとの BGM（すべてオリジナル曲）。music.js が演奏する
//   bpm: テンポ / bars: 16 小節のコード進行（1 小節に 1〜2 個） / melody: 小節ごとの [16 分の位置, 音, 長さ]
//   （melody が無ければ gen の指定から自動で作る） / bass: [位置, ルートからの半音] / stabs: コードを刻む位置
//   drums: 'rock' | 'four'（4 つ打ち） | 'latin'（カウベル） | 'half'（ハーフタイム） / lead: 'lyricon' | 'fm' | 'square' | 'saw'
import { mulberry32 } from './core/rng.js';

const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const QUALITY = {
  '': [0, 4, 7, 12], m: [0, 3, 7, 12], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
  6: [0, 4, 7, 9], sus4: [0, 5, 7, 12], '7sus': [0, 5, 7, 10], add9: [0, 4, 7, 14],
};

// コード名（'F#m7' など）→ { b: ベースの音, n: コードの構成音（60〜72 あたりに収める） }
export function chord(name) {
  const m = name.match(/^([A-G][#b]?)(.*)$/);
  const root = NOTE[m[1]];
  const iv = QUALITY[m[2]] ?? QUALITY[''];
  const base = 60 + root; // 根音を 60〜71 に
  const n = [...new Set(iv.map((x) => base + x).map((x) => (x > 74 ? x - 12 : x)))].sort((a, b) => a - b);
  return { b: 36 + root, n, pcs: iv.map((x) => (root + x) % 12) };
}

const bars = (list) => list.map((b) => (Array.isArray(b) ? b : [b]).map(chord));

// 自動のメロディ: リズムの型（16 分の位置と長さ）に、拍の頭はコードの音、それ以外は音階の音を、
// 前の音から近い順に選んで並べる。2 小節ごとに上がって下がる山形。A と A' は同じリズムで音だけ変える
function genMelody(barList, { seed, key, minor = false, lo = 66, hi = 83, rhythms, plan }) {
  const rng = mulberry32(seed);
  const steps = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const scale = [];
  for (let m = lo; m <= hi; m++) if (steps.includes((m - key + 120) % 12)) scale.push(m);
  let prev = scale[Math.floor(scale.length / 2)];
  return barList.map((chords, bi) => {
    const rhythm = rhythms[plan[bi] % rhythms.length];
    const up = bi % 2 === 0;
    return rhythm.map(([p, len], i) => {
      const ch = chords.length > 1 && p >= 8 ? chords[1] : chords[0];
      const strong = p % 4 === 0 || len >= 4;
      const cands = strong ? scale.filter((m) => ch.pcs.includes(m % 12)) : scale;
      let dir = up ? (i < rhythm.length / 2 ? 1 : 0.3) : (i < rhythm.length / 2 ? 0.2 : -1);
      // 音域の端では折り返す
      if (prev > hi - 4) dir = -1;
      if (prev < lo + 4) dir = 1;
      const target = prev + dir * (2 + rng() * 3) + (rng() - 0.5) * 2;
      // 同じ音を続けすぎない（直前と同じ音は、ほかに近い候補があれば避ける）
      const pool = cands.filter((c) => c !== prev);
      let best = (pool.length ? pool : cands)[0];
      for (const c of pool.length ? pool : cands) if (Math.abs(c - target) < Math.abs(best - target)) best = c;
      // 最後の小節は主音で終わる
      if (bi === barList.length - 1 && i === rhythm.length - 1) {
        best = scale.reduce((a, c) => ((c - key) % 12 === 0 && Math.abs(c - prev) < Math.abs(a - prev) ? c : a), best);
      }
      prev = best;
      return [p, best, len];
    });
  });
}

// リズムの型（16 分の位置, 長さ）
const R = {
  drive: [[0, 3], [3, 3], [6, 2], [8, 4], [12, 2], [14, 2]],
  long: [[0, 6], [6, 2], [8, 8]],
  run: [[0, 2], [2, 2], [4, 2], [6, 2], [8, 3], [11, 3], [14, 2]],
  sync: [[0, 3], [3, 3], [6, 4], [10, 6]],
  hold: [[0, 12], [12, 2], [14, 2]],
  disco: [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]],
  euro: [[0, 2], [2, 1], [3, 1], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]],
  wave: [[0, 8], [8, 4], [12, 4]],
};

const SONGS = {
  // Coastal Speedway: レース中継のテーマのような疾走感のあるフュージョンロック（リリコン風のリード）
  speedway: {
    bpm: 150, drums: 'rock', lead: 'lyricon',
    bars: bars(['Gmaj7', 'A6', 'F#m7', 'Bm7', 'Em7', 'F#m7', 'Gmaj7', ['A7sus', 'A7'], 'Gmaj7', 'A', 'Bm7', ['Bm7', 'A6'], 'Gmaj7', 'A', ['Em7', 'A7'], 'Dmaj7']),
    melody: [
      [[0, 71, 3], [3, 74, 3], [6, 76, 2], [8, 78, 4], [12, 76, 2], [14, 74, 2]],
      [[0, 73, 6], [6, 71, 2], [8, 69, 4], [12, 71, 2], [14, 73, 2]],
      [[0, 73, 3], [3, 76, 3], [6, 73, 2], [8, 69, 6], [14, 66, 2]],
      [[0, 69, 4], [4, 71, 4], [8, 66, 8]],
      [[0, 67, 2], [2, 69, 2], [4, 71, 2], [6, 74, 2], [8, 76, 3], [11, 74, 3], [14, 71, 2]],
      [[0, 73, 4], [4, 69, 2], [6, 73, 2], [8, 76, 6], [14, 78, 2]],
      [[0, 79, 6], [6, 78, 2], [8, 76, 2], [10, 74, 2], [12, 71, 4]],
      [[0, 74, 8], [8, 73, 4], [12, 76, 2], [14, 78, 2]],
      [[0, 79, 4], [4, 78, 2], [6, 76, 2], [8, 74, 4], [12, 71, 4]],
      [[0, 73, 3], [3, 76, 3], [6, 78, 2], [8, 76, 8]],
      [[0, 74, 2], [2, 73, 2], [4, 71, 4], [8, 73, 2], [10, 74, 2], [12, 76, 4]],
      [[0, 78, 6], [6, 76, 2], [8, 73, 8]],
      [[0, 71, 3], [3, 74, 3], [6, 78, 2], [8, 81, 6], [14, 79, 2]],
      [[0, 78, 4], [4, 76, 4], [8, 73, 4], [12, 76, 4]],
      [[0, 74, 4], [4, 76, 4], [8, 78, 4], [12, 79, 4]],
      [[0, 78, 12], [12, 74, 2], [14, 76, 2]],
    ],
    bass: [[0, 0], [2, 0], [3, 12], [4, 0], [6, 0], [8, 0], [10, 0], [11, 12], [12, 0], [14, 7]],
    stabs: [3, 6, 10, 14],
  },
  // River Park: 80 年代アーケードのドライブゲーム風の明るいラテン・フュージョン（FM 音源風のリード）
  'river-park': {
    bpm: 132, drums: 'latin', lead: 'fm',
    bars: bars(['Dmaj7', ['Em7', 'A7'], 'F#m7', 'Bm7', 'Gmaj7', 'F#m7', 'Em7', ['A7sus', 'A7'], 'Gmaj7', 'A6', 'F#m7', 'Bm7', 'Em7', 'F#7', ['Gmaj7', 'A7'], 'Dmaj7']),
    melody: [
      [[0, 81, 3], [3, 78, 3], [6, 76, 2], [8, 78, 6], [14, 81, 2]],
      [[0, 83, 2], [2, 81, 2], [4, 79, 4], [8, 76, 2], [10, 79, 2], [12, 81, 4]],
      [[0, 85, 4], [4, 83, 2], [6, 81, 4], [10, 78, 6]],
      [[0, 74, 2], [2, 76, 2], [4, 78, 2], [6, 81, 2], [8, 83, 8]],
      [[0, 86, 3], [3, 83, 3], [6, 79, 2], [8, 81, 4], [12, 83, 4]],
      [[0, 85, 3], [3, 81, 3], [6, 78, 2], [8, 76, 4], [12, 78, 4]],
      [[0, 79, 2], [2, 81, 2], [4, 83, 2], [6, 86, 4], [10, 88, 6]],
      [[0, 86, 6], [6, 85, 2], [8, 83, 2], [10, 81, 6]],
      [[0, 83, 6], [6, 86, 2], [8, 85, 6], [14, 83, 2]],
      [[0, 81, 8], [8, 78, 4], [12, 81, 4]],
      [[0, 85, 6], [6, 88, 2], [8, 86, 6], [14, 85, 2]],
      [[0, 83, 8], [8, 81, 2], [10, 83, 2], [12, 86, 4]],
      [[0, 88, 4], [4, 86, 2], [6, 83, 4], [10, 79, 2], [12, 81, 4]],
      [[0, 82, 4], [4, 85, 4], [8, 88, 4], [12, 90, 4]],
      [[0, 91, 4], [4, 90, 2], [6, 86, 2], [8, 88, 4], [12, 85, 4]],
      [[0, 86, 10], [12, 81, 2], [14, 85, 2]],
    ],
    bass: [[0, 0], [3, 12], [4, 0], [6, 0], [8, 0], [10, 12], [11, 7], [14, 0], [15, 12]],
    stabs: [3, 6, 10, 14],
  },
  // Misty Pass（峠）: 日本のフュージョン（E メジャー、矩形波のリード）
  'misty-pass': {
    bpm: 144, drums: 'rock', lead: 'square',
    bars: bars(['Amaj7', 'B6', 'G#m7', 'C#m7', 'F#m7', ['B7sus', 'B7'], 'Emaj7', 'C#7', 'Amaj7', 'B', ['G#m7', 'C#m7'], ['F#m7', 'B7'], 'Amaj7', 'G#m7', 'F#m7', ['Bsus4', 'B']]),
    gen: { seed: 8, key: 4, lo: 64, hi: 83, rhythms: [R.drive, R.run, R.sync, R.long], plan: [0, 1, 2, 3, 0, 1, 2, 3, 1, 0, 1, 2, 0, 1, 0, 3] },
    bass: [[0, 0], [2, 0], [3, 12], [6, 0], [8, 0], [10, 0], [11, 12], [14, 7]],
    stabs: [2, 6, 10, 14],
  },
  // Speed Temple: イタロディスコ（A マイナー、4 つ打ち、オクターブで跳ねるベース）
  'speed-temple': {
    bpm: 126, drums: 'four', lead: 'saw',
    bars: bars(['Am', 'Am', 'F', 'G', 'Am', 'Am', 'F', 'E', 'F', 'G', 'Em', 'Am', 'F', 'G', 'E', 'E']),
    gen: { seed: 21, key: 9, minor: true, lo: 64, hi: 81, rhythms: [R.disco, R.long, R.run, R.hold], plan: [0, 1, 0, 1, 0, 1, 2, 3, 0, 2, 0, 1, 0, 2, 2, 3] },
    bass: [[0, 0], [2, 12], [4, 0], [6, 12], [8, 0], [10, 12], [12, 0], [14, 12]],
    stabs: [2, 6, 10, 14],
  },
  // Forest Ring: 森を抜ける壮大なロック（D マイナー）
  'forest-ring': {
    bpm: 140, drums: 'rock', lead: 'lyricon',
    bars: bars(['Dm', 'Bb', 'C', 'Am', 'Dm', 'Bb', 'Gm', 'A', 'Bb', 'C', 'Dm', 'Dm', 'Bb', 'C', 'A', 'A']),
    gen: { seed: 33, key: 2, minor: true, lo: 62, hi: 81, rhythms: [R.long, R.drive, R.sync, R.hold], plan: [0, 1, 0, 2, 0, 1, 2, 3, 1, 1, 0, 2, 1, 1, 2, 3] },
    bass: [[0, 0], [2, 0], [4, 0], [6, 0], [8, 0], [10, 0], [12, 0], [14, 7]],
    stabs: [6, 14],
  },
  // Eight Hills: ユーロビート（F# マイナー、速い 4 つ打ち、裏で跳ねるオクターブのベース）
  'eight-hills': {
    bpm: 156, drums: 'four', lead: 'saw',
    bars: bars(['F#m', 'D', 'E', 'C#m', 'F#m', 'D', 'E', 'E', 'D', 'E', 'F#m', 'F#m', 'D', 'E', 'C#', 'C#']),
    gen: { seed: 55, key: 6, minor: true, lo: 66, hi: 85, rhythms: [R.euro, R.drive, R.run, R.hold], plan: [0, 1, 0, 2, 0, 1, 2, 3, 0, 0, 1, 2, 0, 0, 2, 3] },
    bass: [[0, 0], [2, 12], [4, 0], [6, 12], [8, 0], [10, 12], [12, 0], [14, 12]],
    stabs: [2, 6, 10, 14],
  },
  // Thunder Ring: 夕暮れの海沿いを流すシンセウェイブ（C マイナー、ハーフタイム）
  'thunder-ring': {
    bpm: 112, drums: 'half', lead: 'square',
    bars: bars(['Cm', 'Ab', 'Eb', 'Bb', 'Cm', 'Ab', 'Fm', 'G', 'Ab', 'Bb', 'Cm', 'Cm', 'Ab', 'Bb', 'G', 'G']),
    gen: { seed: 77, key: 0, minor: true, lo: 63, hi: 82, rhythms: [R.wave, R.long, R.sync, R.hold], plan: [0, 1, 0, 3, 0, 1, 2, 3, 1, 0, 1, 2, 1, 0, 2, 3] },
    bass: [[0, 0], [2, 0], [4, 0], [6, 0], [8, 0], [10, 0], [12, 0], [14, 0]],
    stabs: [],
  },
};

const cache = new Map();
export function songFor(trackId) {
  const id = SONGS[trackId] ? trackId : 'thunder-ring';
  if (!cache.has(id)) {
    const s = SONGS[id];
    cache.set(id, { id, ...s, melody: s.melody || genMelody(s.bars, s.gen) });
  }
  return cache.get(id);
}

export const SONG_IDS = Object.keys(SONGS);
