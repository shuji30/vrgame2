// コントローラーの生の値 → ゲーム入力への変換（キャリブレーション値を使う。three.js 非依存）

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ハンドル: raw は -1..1。cal = { min, center, max, invert, wheelDeg, lockDeg, deadzone, gamma }
// wheelDeg: ドライバー設定のハンドル回転角（例 900°）、lockDeg: ゲーム内でフルロックになる角度（例 360°）
export function mapSteer(raw, cal) {
  const c = cal.center ?? 0;
  const half = raw >= c ? (cal.max ?? 1) - c : c - (cal.min ?? -1);
  let v = half > 1e-6 ? (raw - c) / half : 0;
  if (cal.invert) v = -v;
  // v は「ハンドルの物理的な回転 / 片側の最大回転」。ロック角に合わせて拡大する
  const ratio = clamp((cal.lockDeg ?? 360) / (cal.wheelDeg ?? 900), 0.05, 1);
  const beyond = Math.abs(v) / ratio; // 1 を超えるとロック角より回している
  v = clamp(v / ratio, -1, 1);
  const dz = cal.deadzone ?? 0;
  const a = Math.abs(v);
  v = a <= dz ? 0 : Math.sign(v) * (a - dz) / (1 - dz);
  const g = cal.gamma ?? 1;
  return { value: Math.sign(v) * Math.pow(Math.abs(v), g), beyond };
}

// ペダル: cal = { rest, full, deadzone, gamma }。rest は離した値、full は踏み切った値（向きは自動）
export function mapPedal(raw, cal) {
  const span = (cal.full ?? 1) - (cal.rest ?? -1);
  if (Math.abs(span) < 1e-6) return 0;
  let v = clamp((raw - (cal.rest ?? -1)) / span, 0, 1);
  const dz = cal.deadzone ?? 0.03;
  v = v <= dz ? 0 : (v - dz) / (1 - dz);
  return Math.pow(v, cal.gamma ?? 1);
}

// 学習モード: 基準スナップショットから一番大きく動いた軸か、新たに押されたボタンを返す
// snapshot: [{ id, index, axes: number[], buttons: number[] }]
export function detectChange(baseline, snapshot, { axisThreshold = 0.35 } = {}) {
  let best = null;
  for (const pad of snapshot) {
    const base = baseline.find((b) => b.id === pad.id && b.index === pad.index);
    if (!base) continue;
    pad.buttons.forEach((v, i) => {
      if (v > 0.5 && (base.buttons[i] ?? 0) < 0.5) {
        const score = 10 + v;
        if (!best || score > best.score) best = { kind: 'button', id: pad.id, index: pad.index, control: i, score };
      }
    });
    pad.axes.forEach((v, i) => {
      const d = Math.abs(v - (base.axes[i] ?? 0));
      if (d > axisThreshold && (!best || d > best.score)) best = { kind: 'axis', id: pad.id, index: pad.index, control: i, score: d };
    });
  }
  return best;
}
