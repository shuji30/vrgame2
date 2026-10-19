// オンラインのランキング (Supabase の REST API)。表の作り方は docs/ranking-setup.sql
// 公開用の鍵 (publishable) はページに入れてよい鍵。できることは「読む」と「1 件追加する」だけに絞ってある
const URL_BASE = 'https://suuliihbjbolzqhcaffo.supabase.co/rest/v1/scores';
const KEY = 'sb_publishable_LI_jF9syYzRfDWrUlCUOEg_yY_JauBH';
const HEADERS = { apikey: KEY, 'Content-Type': 'application/json' };
const TIMEOUT = 8000;

export const RANK_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

async function call(url, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { ...opts, headers: { ...HEADERS, ...opts.headers }, signal: ctl.signal });
    if (!res.ok) throw new Error(`ranking ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// 上位 limit 件 [{ name, score, stage, cleared, created_at }]
export async function fetchTop(mode, limit = 10) {
  const res = await call(`${URL_BASE}?select=name,score,stage,cleared,created_at&mode=eq.${mode}&order=score.desc,created_at.asc&limit=${limit}`);
  return res.json();
}

// 点を送り、その点が何位か ({ rank, total }) を返す
export async function submitScore({ name, score, mode, stage, cleared, player, version }) {
  await call(URL_BASE, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ name, score, mode, stage, cleared, player, version }) });
  const count = async (filter) => {
    const res = await call(`${URL_BASE}?select=id&mode=eq.${mode}${filter}`, { method: 'HEAD', headers: { Prefer: 'count=exact' } });
    return Number(res.headers.get('content-range')?.split('/')[1]) || 0;
  };
  const [above, total] = await Promise.all([count(`&score=gt.${score}`), count('')]);
  return { rank: above + 1, total };
}
