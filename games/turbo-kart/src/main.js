import * as THREE from 'three';
import { Game } from './game.js';
import { InputManager, setBridgePads, setHidPads } from './input/devices.js';
import { HIDManager } from './input/webhid.js';
import { CalibrationUI } from './input/calibration.js';
import { FFBBridge } from './ffb.js';
import { TRACKS } from './core/tracks.js';
import { setupOnline } from './net/lobby.js';
import { CHARACTERS } from './scene/characters.js';
import { fetchLaps, submitLap, lapsTable } from './net/laps.js';

const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth || 16, window.innerHeight || 9);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local'); // 着座。頭の位置はリセンターで運転席に合わせる
renderer.xr.setFoveation?.(1);
$('app').appendChild(renderer.domElement);

const input = new InputManager();
const ffb = new FFBBridge();
const hid = new HIDManager();
ffb.hid = hid;
setBridgePads(() => ffb.inputPads());
setHidPads(() => hid.pads());

const screens = { menu: $('menu'), calib: $('calib'), online: $('online') };
const ui = {
  hud: $('hud'),
  debug: $('debug'),
  showScreen(name) {
    for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
    if (name !== 'race') ui.hud.hidden = true;
  },
  showPause(on) {
    $('pause').hidden = !on;
  },
  showResults() {},
  // HUD の FFB 状態表示
  ffbStatus(st) {
    const el = $('ffb-state');
    const txt = `FFB: ${st.state}${st.error ? ` ⚠ ${st.error}` : ''}`;
    if (el.textContent !== txt) el.textContent = txt;
    el.className = st.ok && !st.error ? 'ok' : 'ng';
    const bar = $('ffb-meter').firstElementChild;
    const f = Math.max(-1, Math.min(1, st.force || 0));
    bar.style.left = `${50 + Math.min(0, f) * 50}%`;
    bar.style.width = `${Math.abs(f) * 50}%`;
  },
};

const game = new Game({ renderer, input, ffb, ui });
// コースの選択（選ぶと背景のデモ走行もそのコースになる）
const trackSel = $('opt-track');
const TRACK_DESC = {
  'thunder-ring': 'デイトナ風バンク・シケイン・ダート・アップダウンのオリジナルコース',
  'eight-hills': '立体交差のある 8 の字。S 字・ヘアピン・スプーン・130R 風の高速コーナー',
  'speed-temple': '長いストレートとシケイン、パラボリカ風の大きな最終コーナー',
  'forest-ring': 'オー・ルージュ風の急な上り、長いストレート、高低差の大きい森のコース',
  'river-park': '反時計回り。シケインとヘアピン、アップダウンの続くテクニカルコース',
};
for (const t of TRACKS) trackSel.add(new Option(`${t.name}${t.sub && t.sub !== 'オリジナル' ? `（${t.sub}）` : ''}`, t.id));
const describeTrack = () => {
  const t = game.track;
  $('track-desc').textContent = `${t.def.name} — ${TRACK_DESC[t.def.id] || ''}（1 周 ${(t.length / 1000).toFixed(2)}km）`;
};
trackSel.addEventListener('change', () => {
  game.setTrack(trackSel.value, game.theme);
  game.showAttract();
  describeTrack();
});
$('opt-shake').addEventListener('change', (e) => { game.shake = Number(e.target.value); });
const calib = new CalibrationUI($('calib'), input, ffb, hid);
game.resize(window.innerWidth, window.innerHeight);

// メニュー
const npcSel = $('opt-npcs');
for (let i = 0; i <= 10; i++) npcSel.add(new Option(`${i} 台`, i, i === 10, i === 10));
const STORE = 'turbokart:menu';
// モード（パーティー / 本格）とキャラクター
const charSel = $('opt-char');
for (const c of CHARACTERS) charSel.add(new Option(`${c.emoji} ${c.name}`, c.id));
let mode = 'party';
const setMode = (m, rebuild = true) => {
  mode = m === 'real' ? 'real' : 'party';
  for (const b of document.querySelectorAll('#opt-mode button')) b.classList.toggle('on', b.dataset.mode === mode);
  $('char-field').hidden = mode !== 'party';
  if (rebuild && game.theme !== mode) {
    game.setTrack(trackSel.value, mode);
    game.showAttract();
  }
};
for (const b of document.querySelectorAll('#opt-mode button')) b.addEventListener('click', () => { setMode(b.dataset.mode); raceOptions(); });
charSel.addEventListener('change', () => { game.character = charSel.value; raceOptions(); });
try {
  const m = JSON.parse(localStorage.getItem(STORE) || '{}');
  if (m.character && CHARACTERS.some((c) => c.id === m.character)) charSel.value = game.character = m.character;
  if (m.name) $('opt-name').value = m.name;
  if (m.mode) setMode(m.mode, false);
  if (m.mode && m.mode !== game.theme && !(m.track && TRACKS.some((t) => t.id === m.track))) {
    game.setTrack(trackSel.value, mode);
    game.showAttract();
  }
  if (m.npcs != null) npcSel.value = m.npcs;
  if (m.level) $('opt-level').value = m.level;
  if (m.laps) $('opt-laps').value = m.laps;
  if (m.shake != null) $('opt-shake').value = m.shake;
  if (m.vehicle) $('opt-vehicle').value = m.vehicle;
  if (m.track && TRACKS.some((t) => t.id === m.track)) {
    trackSel.value = m.track;
    game.setTrack(m.track, mode);
    game.showAttract();
  }
} catch {
  // 既定値
}
setMode(mode, false);
describeTrack();
$('opt-trans').value = input.config.transmission;
$('opt-trans').addEventListener('change', (e) => {
  input.config.transmission = e.target.value;
  input.save();
});
$('opt-stability').value = input.config.stability === false ? '0' : '1';
$('opt-stability').addEventListener('change', (e) => {
  input.config.stability = e.target.value === '1';
  input.save();
});

function raceOptions() {
  const o = { npcs: Number(npcSel.value), level: $('opt-level').value, laps: Number($('opt-laps').value), manual: input.config.transmission === 'manual', shake: Number($('opt-shake').value), vehicle: $('opt-vehicle').value, track: trackSel.value, mode, character: charSel.value, name: driverName() };
  game.playerName = o.name;
  game.shake = o.shake;
  try {
    localStorage.setItem(STORE, JSON.stringify(o));
  } catch {
    // 保存できない環境
  }
  return o;
}

function summary() {
  const b = input.config.bindings;
  const list = ['steer', 'throttle', 'brake', 'handbrake', 'shiftUp', 'shiftDown'].filter((k) => b[k]);
  $('input-summary').textContent = list.length
    ? `ハンコン設定済み（${list.length}/6 項目）・${input.config.transmission === 'manual' ? 'MT' : 'AT'}`
    : 'ハンコン未設定（キーボード / ゲームパッドで遊べます）';
}
summary();

$('btn-start').addEventListener('click', () => {
  game.audio.init();
  game.startRace(raceOptions());
});
$('btn-calib').addEventListener('click', () => {
  ui.showScreen('calib');
  calib.open();
});
$('btn-calib-close').addEventListener('click', () => {
  calib.close();
  $('opt-trans').value = input.config.transmission;
  summary();
  ui.showScreen('menu');
});
$('btn-resume').addEventListener('click', () => game.pause(false));
$('btn-ffb-reset').addEventListener('click', () => ffb.reset());
$('btn-restart').addEventListener('click', () => game.restart());
$('btn-menu').addEventListener('click', () => game.toMenu());

// VR
const vrBtn = $('btn-vr');
let pendingVR = null;
// VR を開始する。opts があれば VR に入ったらそのレースを始める（null ならデモ走行のまま待機）
async function vrStart(opts) {
  game.audio.init();
  pendingVR = opts;
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    await renderer.xr.setSession(session);
  } catch (e) {
    pendingVR = null;
    alert(`VR を開始できませんでした: ${e.message}`);
  }
}
async function setupVR() {
  if (!navigator.xr || !(await navigator.xr.isSessionSupported('immersive-vr').catch(() => false))) {
    vrBtn.disabled = true;
    vrBtn.textContent = 'VR 非対応の環境';
    return;
  }
  vrBtn.addEventListener('click', () => vrStart(raceOptions()));
}
setupVR();
renderer.xr.addEventListener('sessionstart', () => {
  if (pendingVR) game.startRace(pendingVR);
  pendingVR = null;
  game.onXRStart();
});
renderer.xr.addEventListener('sessionend', () => game.onXREnd());

window.addEventListener('resize', () => {
  if (!window.innerWidth || !window.innerHeight) return;
  renderer.setSize(window.innerWidth, window.innerHeight);
  game.resize(window.innerWidth, window.innerHeight);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !game.xrOn && !window.__kart?.noAutoPause) game.pause(true);
});
window.addEventListener('beforeunload', () => ffb.stop());
window.addEventListener('pagehide', () => ffb.stop());

renderer.setAnimationLoop(() => {
  game.update();
  renderer.render(game.scene, game.camera);
});

setupOnline({ game, ui, input, getVR: () => vrStart, $ });

window.__kart = {
  game, input, ffb,
  // 自動テスト用: 実時間に依存せず進める
  step(sec, fps = 60) {
    for (let i = 0; i < Math.round(sec * fps); i++) game.update(1 / fps);
    renderer.render(game.scene, game.camera);
    const me = game.me;
    return me && { state: game.state, time: game.race.time, lap: me.lap, pos: me.position, s: me.loc.s, lat: me.loc.lateral, surface: me.kart.surface, kmh: Math.round(Math.abs(me.kart.vx * Math.cos(me.kart.heading) + me.kart.vz * Math.sin(me.kart.heading)) * 3.6) };
  },
};
const q = new URLSearchParams(location.search);
if (q.get('autodrive') === '1') game.autodrive = true;
if (q.get('autostart') === '1') game.startRace(raceOptions());
if (q.get('cam') === 'cockpit') game.setCameraMode('cockpit');

// ---- ベストラップのランキング ----
const VEHICLE_NAMES = { kart: 'カート', gt3: 'GT3', formula: 'フォーミュラ' };
function driverName() {
  return ($('opt-name').value || '').trim().slice(0, 16) || 'Player';
}
let rankReq = 0;
async function refreshRanking() {
  const key = { track: trackSel.value, vehicle: $('opt-vehicle').value, mode };
  $('ranking-title').textContent = `🏆 ベストラップ ランキング（${game.track.def.name}・${VEHICLE_NAMES[key.vehicle]}・${mode === 'real' ? '本格' : 'パーティー'}）`;
  const id = ++rankReq;
  let top = null;
  try { top = await fetchLaps(key); } catch { /* つながらない */ }
  if (id === rankReq) $('ranking').innerHTML = lapsTable(top, driverName());
}
for (const id of ['opt-track', 'opt-vehicle']) $(id).addEventListener('change', refreshRanking);
for (const b of document.querySelectorAll('#opt-mode button')) b.addEventListener('click', refreshRanking);
$('opt-name').addEventListener('change', () => { raceOptions(); refreshRanking(); });
refreshRanking();
// ゴールしたら自分のベストラップを登録して、結果画面にランキングを出す（自動運転の確認中は登録しない）
game.onFinish = async (me) => {
  if (game.autodrive || !me.bestLap) return;
  const key = { track: game.trackId, vehicle: game.opts.vehicle || 'kart', mode: game.theme };
  const name = game.playerName || driverName();
  game.rankHtml = '<p class="muted">ランキングに登録しています…</p>';
  let r = null;
  try { r = await submitLap(key, name, me.bestLap); } catch { /* つながらない */ }
  game.rankHtml = `<h3 style="margin:14px 0 6px">🏆 ベストラップ ランキング${r?.rank ? `　<span style="color:#ffd23f">${r.rank} 位に入りました！</span>` : ''}</h3>${lapsTable(r ? r.top : null, name)}`;
  refreshRanking();
};
