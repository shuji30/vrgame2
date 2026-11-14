// オンライン対戦の ICE サーバー(STUN と TURN)。
// 直接つながらない回線(スマホのモバイル回線、会社・学校のネットワークなど)では、TURN で中継してつなぐ。
// TURN は Metered の Open Relay(無料枠 毎月 20GB)を使う。合言葉は Metered の API から受け取る:
//   TURN_URL = 'https://<アプリ名>.metered.live/api/v1/turn/credentials?apiKey=<API キー>'(ICE サーバーの配列が返る)
// Cloudflare の TURN に切り替えるときは、自前の Worker(cloudflare/turn-worker/)の URL を書く(末尾に /ice を足して呼ぶ)。
// URL に ?turn=<URL> を付けると、その場で試せる(Metered の URL は encodeURIComponent して付ける)。
// 空のときや合言葉を取れないときは、PeerJS の既定(Google の STUN と、PeerJS 運営の無保証の TURN)のまま

export const TURN_URL = '';

let cache = null; // { list, until }

function turnUrl() {
  try {
    const q = new URLSearchParams(location.search).get('turn');
    if (q) return q;
  } catch { /* location がない */ }
  return TURN_URL;
}

export const hasTurn = () => !!turnUrl();

// ICE サーバーの一覧と、中継(TURN)があるかを返す。取れなければ iceServers は null(PeerJS の既定)
export async function getIceServers() {
  if (cache && cache.until > Date.now()) return { iceServers: cache.list, relay: true };
  const base = turnUrl();
  if (!base) return { iceServers: null, relay: false };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    // Metered の API はそのまま、自前の Worker は /ice を足して呼ぶ
    const url = /metered\.live|\/api\/v1\/turn\/credentials/.test(base) ? base : `${base.replace(/\/+$/, '')}/ice`;
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json();
    // Metered は配列をそのまま、Worker は { iceServers, ttl } を返す
    const raw = Array.isArray(d) ? d : Array.isArray(d.iceServers) ? d.iceServers : d.iceServers ? [d.iceServers] : [];
    const list = raw.filter((s) => s && s.urls);
    if (!list.some((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)))) throw new Error('TURN がない');
    cache = { list: [...list, { urls: 'stun:stun.l.google.com:19302' }], until: Date.now() + Math.max(60, (d.ttl || 3600) - 300) * 1000 };
    return { iceServers: cache.list, relay: true };
  } catch (e) {
    console.warn('TURN の合言葉を取れませんでした。PeerJS の既定のままつなぎます', e);
    return { iceServers: null, relay: false };
  }
}
