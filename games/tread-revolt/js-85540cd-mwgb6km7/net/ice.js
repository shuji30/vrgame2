// オンライン対戦の ICE サーバー(STUN と TURN)。
// 直接つながらない回線(スマホのモバイル回線、会社・学校のネットワークなど)では、TURN で中継してつなぐ。
// TURN は Cloudflare Realtime を使い、合言葉は自前の Worker(cloudflare/turn-worker/)から短い期限で受け取る。
// Worker の URL は TURN_URL に書く(URL に ?turn=<Worker の URL> を付けると、その場で試せる)。
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

// ICE サーバーの一覧と、Cloudflare の中継(TURN)があるかを返す。取れなければ iceServers は null(PeerJS の既定)
export async function getIceServers() {
  if (cache && cache.until > Date.now()) return { iceServers: cache.list, relay: true };
  const base = turnUrl();
  if (!base) return { iceServers: null, relay: false };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(`${base.replace(/\/+$/, '')}/ice`, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json();
    const list = Array.isArray(d.iceServers) ? d.iceServers : [];
    if (!list.some((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)))) throw new Error('TURN がない');
    cache = { list: [...list, { urls: 'stun:stun.l.google.com:19302' }], until: Date.now() + Math.max(60, (d.ttl || 3600) - 300) * 1000 };
    return { iceServers: cache.list, relay: true };
  } catch (e) {
    console.warn('Cloudflare の TURN の合言葉を取れませんでした。PeerJS の既定のままつなぎます', e);
    return { iceServers: null, relay: false };
  }
}
