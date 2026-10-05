// レース中のタイム表示に使う計算（three.js 非依存）

// このレースで最も速いラップ { time, name }（まだ誰も 1 周していなければ null）
export function fastestLap(race) {
  let best = null;
  for (const e of race.karts) if (e.bestLap && (!best || e.bestLap < best.time)) best = { time: e.bestLap, name: e.name };
  return best;
}

// オンライン対戦のタイミング表: 参加者（人）を順位順に、直前のラップとベストラップ。
// fastest: 全員（NPC も含む）の中の最速ラップ
export function timingRows(race) {
  const rows = race.karts.filter((e) => e.human || e.type === 'player').sort((a, b) => a.position - b.position)
    .map((e) => ({ pos: e.position, name: e.name, color: e.color, last: e.lastLap ?? null, best: e.bestLap ?? null, me: e.type === 'player' }));
  return { rows, fastest: fastestLap(race) };
}
