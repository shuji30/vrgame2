// アーケードモードの残り時間: 1 周を CHECKPOINTS_PER_LAP 区間に分け、チェックポイントを通るたびに次の区間の時間を足す
// 0 になったらタイムオーバー（プレイヤーだけが対象。NPC には時間制限はない）
// 区間の持ち時間は「その区間を目安の速さで走ったときの時間 × TIMER_SLACK（強さごと）」
// 目安の速さは、コースの曲がり具合と車の諸元（横 G・加速・ブレーキ）から出した速度の上限（idealSpeeds）
// 描画やネットワークには依存しない（テストできるように）
import { curvatureAt } from './track.js';

export const CHECKPOINTS_PER_LAP = 3;
// 目安の時間に対する持ち時間の倍率（大きいほど余裕がある）
export const TIMER_SLACK = { easy: 1.6, normal: 1.4, hard: 1.28 };
// スタートの出遅れ分としておまけする秒数
export const LAUNCH_BONUS = 3;
const DS = 2; // 速度を見積もる刻み (m)

// コースの各地点（DS 刻み）での目安の速さ (m/s)。人が走る程度に、タイヤの限界・加速・ブレーキを控えめに見る
export function idealSpeeds(track, spec) {
  const n = Math.max(8, Math.ceil(track.length / DS));
  const ds = track.length / n;
  const top = spec.gearTop[spec.gearTop.length - 1];
  const lat = (spec.maxLat || 15) * 0.7;
  const brake = (spec.brakeDecel || 15) * 0.6;
  const accelAt = (v) => Math.max(0.5, (spec.baseAccel || 10) * 0.8 * Math.pow(Math.max(0, 1 - v / top), 0.6));
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.abs(curvatureAt(track, i * ds));
    v[i] = Math.min(top, k > 1e-6 ? Math.sqrt(lat / k) : top);
  }
  // 周回なので 2 周ぶん回して、つなぎ目もなめらかにする
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 1; j <= n; j++) { // 加速の限界（前へ）
      const a = v[(j - 1) % n], i = j % n;
      v[i] = Math.min(v[i], Math.sqrt(a * a + 2 * accelAt(a) * ds));
    }
    for (let j = n - 1; j >= 0; j--) { // ブレーキの限界（後ろへ）
      const b = v[(j + 1) % n];
      v[j] = Math.min(v[j], Math.sqrt(b * b + 2 * brake * ds));
    }
  }
  return { v, ds };
}

// スタートラインから a〜b m（a < b、周回をまたいでよい）を目安の速さで走る時間 (秒)
export function idealTime(ideal, startS, a, b) {
  const { v, ds } = ideal;
  const n = v.length;
  let t = 0;
  for (let d = a; d < b; d += ds) {
    const i = ((Math.floor((startS + d) / ds) % n) + n) % n;
    t += Math.min(ds, b - d) / Math.max(3, v[i]);
  }
  return t;
}

// progress0: スタート時のプレイヤーの進み（スタートラインの手前なので負）
export function createArcadeTimer(track, spec, { laps = 3, level = 'normal', progress0 = 0 } = {}) {
  const L = track.length;
  const per = L / CHECKPOINTS_PER_LAP;
  const slack = TIMER_SLACK[level] ?? TIMER_SLACK.normal;
  const ideal = idealSpeeds(track, spec);
  const s0 = track.def?.startS || 0;
  // 区間ごとの持ち時間（どの周も同じ）
  const extends_ = Array.from({ length: CHECKPOINTS_PER_LAP }, (_, i) => idealTime(ideal, s0, i * per, (i + 1) * per) * slack);
  // 最初の区間はグリッドの位置からの距離ぶんと、止まった状態からの出遅れも足す
  const back = -Math.min(0, progress0);
  return {
    per,
    extends: extends_,
    left: idealTime(ideal, s0, -back, per) * slack + LAUNCH_BONUS,
    next: 1, // 次に通るチェックポイントの番号（progress が next * per を超えたら通過）
    last: laps * CHECKPOINTS_PER_LAP, // 最後のチェックポイント（= ゴール。時間は足さない）
    over: false,
  };
}

// 毎ステップ呼ぶ。racing: カウントダウンが終わっているか。finished: ゴールしたか
// 戻り値: 出来事の配列（{ type: 'checkpoint', extend, left, index } | { type: 'timeOver' }）
export function stepArcadeTimer(t, progress, dt, { racing = true, finished = false } = {}) {
  const events = [];
  if (!racing || finished || t.over) return events;
  // 先にチェックポイントの通過を見る（同じステップで 0 になっても、通っていれば間に合ったことにする）
  while (t.next < t.last && progress >= t.next * t.per) {
    const extend = t.extends[t.next % CHECKPOINTS_PER_LAP];
    t.left += extend;
    t.next++;
    events.push({ type: 'checkpoint', extend, left: t.left, index: t.next - 1 });
  }
  t.left -= dt;
  if (t.left <= 0) {
    t.left = 0;
    t.over = true;
    events.push({ type: 'timeOver' });
  }
  return events;
}

// コース上のチェックポイントの位置（スタートラインからの距離 m）。スタートライン自体は含めない
export function checkpointOffsets(trackLength) {
  const per = trackLength / CHECKPOINTS_PER_LAP;
  return Array.from({ length: CHECKPOINTS_PER_LAP - 1 }, (_, i) => per * (i + 1));
}
