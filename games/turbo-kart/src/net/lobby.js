// オンライン対戦のロビー画面（ルーム作成・参加・設定・スタート）
import { OnlineSession } from './online.js';
import { TRACKS } from '../core/tracks.js';

const STORE = 'turbokart:online';

// 既定のサーバー URL: ゲームと同じサイトに server/ を置いた場合（お名前.com など）はそれを使う
function defaultServer() {
  if (/github\.io$/.test(location.hostname)) return '';
  return new URL('../../server/api.php', location.href).href;
}

export function setupOnline({ game, ui, input, getVR, $ }) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { /* 既定値 */ }
  const save = () => {
    try { localStorage.setItem(STORE, JSON.stringify({ name: $('net-name').value, server: $('net-server').value })); } catch { /* 保存できない */ }
  };
  $('net-name').value = saved.name || '';
  $('net-server').value = saved.server || defaultServer();
  for (const t of TRACKS) $('net-track').add(new Option(t.name, t.id));
  for (let i = 0; i <= 10; i++) $('net-npcs').add(new Option(`${i} 台`, i, i === 0, i === 0));

  let session = null;

  const checkServer = async () => {
    const url = $('net-server').value.trim();
    const el = $('net-health');
    if (!url) {
      el.textContent = 'サーバー URL を入力してください（お名前.com に server/ をデプロイした URL）';
      return false;
    }
    try {
      const h = await fetch(`${url}?a=health`).then((r) => r.json());
      el.textContent = h.ok ? `サーバー接続 OK（PHP ${h.php}）` : `サーバーエラー: ${h.error}`;
      return !!h.ok;
    } catch (e) {
      el.textContent = `サーバーに接続できません: ${e.message}`;
      return false;
    }
  };

  const render = () => {
    const inLobby = !!session && session.state !== 'idle';
    document.querySelector('[data-net=entry]').hidden = inLobby;
    document.querySelector('[data-net=lobby]').hidden = !inLobby;
    if (!inLobby) return;
    $('net-room').textContent = session.room || '';
    $('net-players').innerHTML = session.players.map((p) => {
      const me = p.id === session.self;
      const ok = me || session.mesh.isOpen(p.id);
      const host = p.id === session.host ? ' 👑' : '';
      return `<li>${escapeHtml(p.name)}${host}${me ? '（あなた）' : ''} <span style="color:${ok ? 'var(--ok)' : 'var(--accent2)'}">${ok ? '● 接続' : '○ 接続中…'}</span></li>`;
    }).join('');
    const isHost = session.isHost;
    for (const el of document.querySelectorAll('#net-settings select')) el.disabled = !isHost;
    const st = session.settings || {};
    if (!isHost) {
      if (st.track) $('net-track').value = st.track;
      if (st.vehicle) $('net-vehicle').value = st.vehicle;
      if (st.laps) $('net-laps').value = st.laps;
      if (st.npcs != null) $('net-npcs').value = st.npcs;
    }
    const ready = session.allConnected();
    $('net-start').disabled = !isHost || !ready || session.state === 'racing';
    $('net-status').textContent = session.error
      ? `エラー: ${session.error}`
      : session.state === 'racing'
        ? 'レース中'
        : isHost
          ? ready ? '全員とつながりました。スタートできます' : '参加者と接続中…'
          : 'ホストのスタートを待っています';
  };

  const settingsFromForm = () => ({
    track: $('net-track').value,
    vehicle: $('net-vehicle').value,
    laps: Number($('net-laps').value),
    npcs: Number($('net-npcs').value),
  });

  const open = async (fn) => {
    save();
    if (!(await checkServer())) return;
    session = new OnlineSession($('net-server').value.trim());
    session.onChange(render);
    session.onStart = (msg) => {
      const st = msg.settings || {};
      game.audio.init();
      game.startRace({
        track: st.track, vehicle: st.vehicle, laps: st.laps || 3, npcs: st.npcs || 0, level: 'hard',
        manual: input.config.transmission === 'manual',
        online: { session, grid: msg.grid, seed: msg.seed, countdown: (msg.at - session.hostNow()) / 1000 },
      });
      render();
    };
    try {
      await fn(session, $('net-name').value.trim() || 'Player');
      if (session.isHost) await session.setSettings(settingsFromForm());
    } catch (e) {
      $('net-health').textContent = `失敗しました: ${e.message}`;
      session = null;
    }
    render();
  };

  $('btn-online').addEventListener('click', () => {
    ui.showScreen('online');
    render();
    checkServer();
  });
  $('net-back').addEventListener('click', () => ui.showScreen('menu'));
  $('net-server').addEventListener('change', () => { save(); checkServer(); });
  $('net-create').addEventListener('click', () => open((s, name) => s.create(name)));
  $('net-join').addEventListener('click', () => {
    const code = $('net-code').value.trim().toUpperCase();
    if (!/^[A-Z2-9]{4}$/.test(code)) {
      $('net-health').textContent = 'ルームコード（4 文字）を入力してください';
      return;
    }
    open((s, name) => s.join(code, name));
  });
  for (const el of document.querySelectorAll('#net-settings select')) {
    el.addEventListener('change', () => session?.isHost && session.setSettings(settingsFromForm()));
  }
  $('net-start').addEventListener('click', () => session?.startRace());
  $('net-vr').addEventListener('click', () => getVR()(null));
  $('net-leave').addEventListener('click', async () => {
    await session?.leave();
    session = null;
    render();
  });
  window.addEventListener('beforeunload', () => session?.leave());
  window.__online = () => session;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
