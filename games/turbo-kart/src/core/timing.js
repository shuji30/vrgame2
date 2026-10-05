// レース中のタイム表示に使う計算（three.js 非依存）

// このレースで最も速いラップ { time, name }（まだ誰も 1 周していなければ null）
export function fastestLap(race) {
  let best = null;
  for (const e of race.karts) if (e.bestLap && (!best || e.bestLap < best.time)) best = { time: e.bestLap, name: e.name };
  return best;
}

// タイミング表: 自分も含めた全員（NPC も）を順位順に、直前のラップとベストラップ。
// npc: 人ではない車（表では少し薄く表示）。fastest: 全員の中の最速ラップ
export function timingRows(race) {
  const rows = [...race.karts].sort((a, b) => a.position - b.position)
    .map((e) => ({
      pos: e.position, name: e.name, color: e.color, last: e.lastLap ?? null, best: e.bestLap ?? null,
      me: e.type === 'player', npc: !(e.human || e.type === 'player'),
    }));
  return { rows, fastest: fastestLap(race) };
}
