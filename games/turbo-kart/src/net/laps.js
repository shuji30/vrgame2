// ベストラップのランキング（サーバー: server/api.php の laps / submitLap）
// サーバーの URL はオンライン対戦と同じ（ゲームと同じサイトの server/、またはロビーで入力した URL）
const ONLINE_STORE = 'turbokart:online';

export function lapServer() {
  try {
    const saved = JSON.parse(localStorage.getItem(ONLINE_STORE) || '{}').server;
    if (saved) return saved;
  } catch {
    // 既定値
  }
  if (/github\.io$/.test(location.hostname)) return '';
  return new URL('../../server/api.php', location.href).href;
}

// key: { track, vehicle, mode }
export async function fetchLaps(key) {
  const base = lapServer();
  if (!base) return null;
  const q = new URLSearchParams({ a: 'laps', ...key });
  const r = await fetch(`${base}?${q}`).then((x) => x.json());
  return r.ok ? r.top : null;
}

export async function submitLap(key, name, seconds) {
  const base = lapServer();
  if (!base || !(seconds > 0)) return null;
  const r = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ a: 'submitLap', ...key, name, ms: Math.round(seconds * 1000) }),
  }).then((x) => x.json());
  return r.ok ? r : null;
}

export function fmtMs(ms) {
  const t = ms / 1000;
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(3).padStart(6, '0')}`;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// トップ 10 の表（me: 自分の名前を強調）
export function lapsTable(top, me = '') {
  if (!top) return '<p class="muted">ランキングのサーバーにつながりません</p>';
  if (!top.length) return '<p class="muted">まだ記録がありません。最初の記録を作ろう！</p>';
  const rows = top.map((r, i) => `<tr class="${r.name === me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td>${fmtMs(r.ms)}</td><td class="muted">${esc(r.date || '')}</td></tr>`).join('');
  return `<table class="laps"><thead><tr><th>#</th><th>DRIVER</th><th>BEST LAP</th><th>DATE</th></tr></thead><tbody>${rows}</tbody></table>`;
}
