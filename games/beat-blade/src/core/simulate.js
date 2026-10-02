// オートプレイで 1 曲を最後まで回す（テストと分析スクリプト用）。ゲームループと同じ手順で判定する
import { Autoplay, bladeFromHand } from './autoplay.js';
import { PlaySession } from './session.js';

export function simulate(map, { fps = 90, onEvent } = {}) {
  const auto = new Autoplay(map);
  const session = new PlaySession(map);
  const prev = [null, null];
  const counts = { good: 0, bad: 0, miss: 0, bomb: 0, wall: 0 };
  const problems = [];
  const parts = { swing: 0, angle: 0, acc: 0 };
  const dt = 1 / fps;
  for (let t = 0; t <= map.duration + 1; t += dt) {
    const sabers = [0, 1].map((c) => {
      const b = bladeFromHand(auto.handPos(c, t));
      const p = prev[c] || b;
      prev[c] = b;
      return { color: c, anyColor: false, prevHilt: p.hilt, prevTip: p.tip, hilt: b.hilt, tip: b.tip, dt };
    });
    const head = { x: auto.headOffsetX(t), y: 1.6, z: 0 };
    for (const e of session.step(t, sabers, head)) {
      onEvent?.(e, t);
      if (e.type === 'cut') {
        if (e.good) {
          counts.good++;
          parts.swing += e.judge.score.swing;
          parts.angle += e.judge.score.angle;
          parts.acc += e.judge.score.acc;
        } else {
          counts.bad++;
          problems.push({ t, note: e.item.obj, judge: e.judge, saber: e.saber.color });
        }
      } else if (e.type === 'miss') {
        counts.miss++;
        problems.push({ t, note: e.item.obj, miss: true });
      } else if (e.type === 'bomb') {
        counts.bomb++;
        problems.push({ t, bomb: e.item.obj, saber: e.saber.color });
      } else if (e.type === 'wallEnter') {
        counts.wall++;
        problems.push({ t, wall: true });
      }
    }
  }
  const n = Math.max(1, counts.good);
  return {
    counts,
    problems,
    session,
    avg: { swing: parts.swing / n, angle: parts.angle / n, acc: parts.acc / n },
  };
}
