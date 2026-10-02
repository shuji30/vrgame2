// スコア・コンボ・倍率・エネルギーの管理
export const MAX_CUT = 115;

// 全ノーツを最高点で切った場合の理論値
export function maxScoreFor(noteCount) {
  let s = 0, mult = 1, prog = 0;
  for (let i = 0; i < noteCount; i++) {
    s += MAX_CUT * mult;
    if (mult < 8 && ++prog >= mult * 2) { mult *= 2; prog = 0; }
  }
  return s;
}

export const RANKS = [
  [0.9, 'SS'], [0.8, 'S'], [0.65, 'A'], [0.5, 'B'], [0.35, 'C'], [0.2, 'D'], [0, 'E'],
];

export function rankFor(acc) {
  for (const [th, r] of RANKS) if (acc >= th) return r;
  return 'E';
}

export class ScoreKeeper {
  constructor(totalNotes, { noFail = false } = {}) {
    this.totalNotes = totalNotes;
    this.noFail = noFail;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.mult = 1;
    this.multProgress = 0;
    this.energy = 0.5;
    this.hits = 0;
    this.misses = 0;
    this.badCuts = 0;
    this.bombHits = 0;
    this.wallHits = 0;
    this.judged = 0;
    this.failed = false;
    this.version = 0; // HUD の再描画判定用
  }

  get multNeeded() { return this.mult * 2; }

  good(points) {
    this.hits++;
    this.judged++;
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.score += points * this.mult;
    if (this.mult < 8 && ++this.multProgress >= this.mult * 2) {
      this.mult *= 2;
      this.multProgress = 0;
    }
    this.energy = Math.min(1, this.energy + 0.012);
    this.version++;
  }

  breakCombo() {
    this.combo = 0;
    if (this.mult > 1) this.mult /= 2;
    this.multProgress = 0;
  }

  miss() {
    this.misses++;
    this.judged++;
    this.breakCombo();
    this.damage(0.15);
  }

  bad() {
    this.badCuts++;
    this.judged++;
    this.breakCombo();
    this.damage(0.1);
  }

  bomb() {
    this.bombHits++;
    this.breakCombo();
    this.damage(0.15);
  }

  wallEnter() {
    this.wallHits++;
    this.breakCombo();
    this.damage(0.05);
  }

  wallTick(dt) {
    this.damage(1.3 * dt);
  }

  damage(x) {
    this.version++;
    this.energy -= x;
    if (this.energy <= 0) {
      this.energy = 0;
      if (!this.noFail) this.failed = true;
    }
  }

  // ここまで判定したノーツに対する達成率
  get accuracy() {
    const max = maxScoreFor(this.judged);
    return max > 0 ? this.score / max : 1;
  }

  // 曲全体に対する達成率（リザルト用）
  get finalAccuracy() {
    const max = maxScoreFor(this.totalNotes);
    return max > 0 ? this.score / max : 0;
  }

  get rank() { return rankFor(this.accuracy); }
}
