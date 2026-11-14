// オンライン対戦の ICE サーバー(STUN と TURN)。
// 直接つながらない回線(スマホのモバイル回線、会社・学校のネットワークなど)では、TURN で中継してつなぐ。
// TURN は Metered の Open Relay(無料枠 毎月 20GB)を使う。認証情報の一覧を TURN_SERVERS にそのまま書いてある。
// 代わりに Metered の API から受け取るときは TURN_SERVERS を空にして、TURN_URL に書く:
//   TURN_URL = 'https://<アプリ名>.metered.live/api/v1/turn/credentials?apiKey=<API キー>'(ICE サーバーの配列が返る)
// Cloudflare の TURN に切り替えるときは、自前の Worker(cloudflare/turn-worker/)の URL を書く(末尾に /ice を足して呼ぶ)。
// URL に ?turn=<URL> を付けると、その場で試せる(Metered の URL は encodeURIComponent して付ける)。
// 空のときや合言葉を取れないときは、PeerJS の既定(Google の STUN と、PeerJS 運営の無保証の TURN)のまま

export const TURN_URL = '';

// Metered の Open Relay の認証情報(ダッシュボードの「認証情報」で作ったもの。日本の中継サーバー)。
// 合言葉の URL を呼ばずに、この一覧をそのまま使う。ページに書く前提のもので、知られても無料枠(毎月 20GB)を使われるだけ。
// 認証情報を作り直したら、ここを書き換える。空にすると TURN_URL(または PeerJS の既定)を使う
export const TURN_SERVERS = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'turn:jp.relay.metered.ca:80', username: 'd36cfbe295658a712eba91c5', credential: '9rx5miLsiVzc4awl' },
  { urls: 'turn:jp.relay.metered.ca:80?transport=tcp', username: 'd36cfbe295658a712eba91c5', credential: '9rx5miLsiVzc4awl' },
  { urls: 'turn:jp.relay.metered.ca:443', username: 'd36cfbe295658a712eba91c5', credential: '9rx5miLsiVzc4awl' },
  { urls: 'turns:jp.relay.metered.ca:443?transport=tcp', username: 'd36cfbe295658a712eba91c5', credential: '9rx5miLsiVzc4awl' },
];

let cache = null; // { list, until }

function turnUrl() {
  try {
    const q = new URLSearchParams(location.search).get('turn');
    if (q) return q;
  } catch { /* location がない */ }
  return TURN_URL;
}

// ?turn=off で中継を使わずに試せる(PeerJS の既定)
const turnOff = () => { try { return new URLSearchParams(location.search).get('turn') === 'off'; } catch { return false; } };
const useStatic = () => TURN_SERVERS.length > 0 && !turnOff() && !new URLSearchParams(globalThis.location?.search || '').get('turn');

export const hasTurn = () => !turnOff() && (TURN_SERVERS.length > 0 || !!turnUrl());

// ICE サーバーの一覧と、中継(TURN)があるかを返す。取れなければ iceServers は null(PeerJS の既定)
export async function getIceServers() {
  if (turnOff()) return { iceServers: null, relay: false };
  if (useStatic()) return { iceServers: [...TURN_SERVERS, { urls: 'stun:stun.l.google.com:19302' }], relay: true };
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

// 中継サーバーを試す:中継だけを使う設定で接続の候補を集め、中継の候補が出ればつながっている
export async function testRelay(ms = 6000) {
  const { iceServers, relay } = await getIceServers();
  if (!relay || !iceServers) return { ok: false, why: '中継の設定がありません' };
  let pc;
  try {
    pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'relay' });
    pc.createDataChannel('test');
    const found = await new Promise((ok) => {
      const timer = setTimeout(() => ok(null), ms);
      pc.onicecandidate = (e) => {
        const c = e.candidate?.candidate || '';
        if (/ typ relay /.test(c)) { clearTimeout(timer); ok(/ tcp /i.test(c) ? 'TCP' : 'UDP'); }
      };
      pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => ok(null));
    });
    return found ? { ok: true, via: found } : { ok: false, why: '時間切れ' };
  } catch (e) {
    return { ok: false, why: e.message };
  } finally {
    pc?.close();
  }
}
