import * as THREE from 'three';
import { Game, lapMode } from './game.js';
import { InputManager, setBridgePads, setHidPads } from './input/devices.js';
import { HIDManager } from './input/webhid.js';
import { CalibrationUI } from './input/calibration.js';
import { FFBBridge } from './ffb.js';
import { TRACKS } from './core/tracks.js';
import { setupOnline } from './net/lobby.js';
import { CHARACTERS } from './scene/characters.js';
import { TouchControls, isTouchDevice } from './input/touch.js';
import { fetchLaps, submitLap, lapsTable } from './net/laps.js';

const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// スマートフォンは描画の解像度を抑えて軽くする
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouchDevice() ? 1.5 : 2));
renderer.setSize(window.innerWidth || 16, window.innerHeight || 9);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local'); // 着座。頭の位置はリセンターで運転席に合わせる
renderer.xr.setFoveation?.(1);
$('app').appendChild(renderer.domElement);

const input = new InputManager();
// スマートフォン: 画面のスティックとボタンで遊ぶ（AT のみ）
if (isTouchDevice()) {
  input.touch = new TouchControls(document.getElementById('hud'));
  input.config.transmission = 'auto';
}
// VR のコントローラーも入力に使う（ハンコンが無い Quest などでも運転できる）
input.getXRSources = () => renderer.xr.getSession()?.inputSources || [];
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
  speedway: 'デイトナ風のトライオーバル。31° のバンクを全開で。前の車の真後ろにつくとスリップストリームで速くなる',
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
// BGM の音量（メニューで変えたらすぐ反映。レース中ならそのまま鳴らす）
$('opt-music').addEventListener('change', (e) => {
  game.music.setVolume(Number(e.target.value));
  if (game.state === 'race') game.music.play();
  raceOptions();
});
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
  if (m.handling) $('opt-handling').value = m.handling;
  if (m.camera) $('opt-camera').value = m.camera;
  if (m.mode) setMode(m.mode, false);
  if (m.mode && m.mode !== game.theme && !(m.track && TRACKS.some((t) => t.id === m.track))) {
    game.setTrack(trackSel.value, mode);
    game.showAttract();
  }
  if (m.npcs != null) npcSel.value = m.npcs;
  if (m.level) $('opt-level').value = m.level;
  if (m.laps) $('opt-laps').value = m.laps;
  if (m.shake != null) $('opt-shake').value = m.shake;
  if (m.music != null) $('opt-music').value = String(m.music);
  game.music.setVolume(Number($('opt-music').value));
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
  const o = { npcs: Number(npcSel.value), level: $('opt-level').value, laps: Number($('opt-laps').value), manual: input.config.transmission === 'manual', shake: Number($('opt-shake').value), music: Number($('opt-music').value), vehicle: $('opt-vehicle').value, track: trackSel.value, mode, character: charSel.value, name: driverName(), handling: $('opt-handling').value, camera: $('opt-camera').value };
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
  const o = raceOptions();
  game.startRace(o);
  game.setCameraMode(o.camera || 'chase');
});
$('opt-camera').addEventListener('change', () => raceOptions());
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
// 結果画面のボタン（次のコース / もう一度 / やめる）
document.querySelector('[data-hud=board]').addEventListener('click', (ev) => {
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (act === 'next') game.nextCourse();
  else if (act === 'again') game.restart();
  else if (act === 'quit') game.toMenu();
});
// 次のコースへ進んだらメニューの選択も合わせる
game.onTrackChange = (id) => {
  trackSel.value = id;
  describeTrack();
  raceOptions();
  refreshRanking();
};
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
  game.renderMirrors(renderer);
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
const VEHICLE_NAMES = { kart: 'カート', gt3: 'GT3', drift: 'ドリフト', formula: 'フォーミュラ' };
function driverName() {
  return ($('opt-name').value || '').trim().slice(0, 16) || 'Player';
}
let rankReq = 0;
async function refreshRanking() {
  const handling = $('opt-handling').value;
  const key = { track: trackSel.value, vehicle: $('opt-vehicle').value, mode: lapMode(mode, handling) };
  const hName = key.mode.endsWith('-real') ? '・リアル' : key.mode.endsWith('-arcade') ? '・アーケード' : '';
  $('ranking-title').textContent = `🏆 ベストラップ ランキング（${game.track.def.name}・${VEHICLE_NAMES[key.vehicle]}・${mode === 'real' ? '本格' : 'パーティー'}${hName}）`;
  const id = ++rankReq;
  let top = null;
  try { top = await fetchLaps(key); } catch { /* つながらない */ }
  if (id === rankReq) $('ranking').innerHTML = lapsTable(top, driverName());
}
for (const id of ['opt-track', 'opt-vehicle', 'opt-handling']) $(id).addEventListener('change', refreshRanking);
$('opt-handling').addEventListener('change', () => raceOptions());
for (const b of document.querySelectorAll('#opt-mode button')) b.addEventListener('click', refreshRanking);
$('opt-name').addEventListener('change', () => { raceOptions(); refreshRanking(); });
refreshRanking();
// レース開始時にコースレコード（ランキング 1 位）を取ってきて HUD に出す
// 自己ベスト（コース × 車種 × モードごと。このブラウザに保存）
const PB_STORE = 'turbokart:pb';
const pbKey = (k) => `${k.track}|${k.vehicle}|${k.mode}`;
function loadPB() {
  try { return JSON.parse(localStorage.getItem(PB_STORE) || '{}'); } catch { return {}; }
}
game.onPersonalBest = (sec) => {
  const all = loadPB();
  all[pbKey({ track: game.trackId, vehicle: game.opts.vehicle || 'kart', mode: lapMode(game.theme, game.opts.handling) })] = sec;
  try { localStorage.setItem(PB_STORE, JSON.stringify(all)); } catch { /* 保存できない */ }
};
game.onRaceStart = async (opts) => {
  const key = { track: game.trackId, vehicle: opts.vehicle || 'kart', mode: lapMode(game.theme, opts.handling) };
  game.hud.personalBest = loadPB()[pbKey(key)] || null;
  try {
    const top = await fetchLaps(key);
    if (game.trackId === key.track) game.hud.courseRecord = top?.[0] || null;
  } catch { /* つながらない */ }
};
// ゴールしたら自分のベストラップを登録して、結果画面にランキングを出す（自動運転の確認中は登録しない）
game.onFinish = async (me) => {
  // 前のレースのランキング表示を残さない
  game.rankText = '';
  game.rankBoard = null;
  game.rankHtml = '';
  if (game.autodrive || !me.bestLap) {
    game.rankText = 'このレースは登録されません';
    return;
  }
  const key = { track: game.trackId, vehicle: game.opts.vehicle || 'kart', mode: lapMode(game.theme, game.opts.handling) };
  const name = game.playerName || driverName();
  game.rankHtml = '<p class="muted">ランキングに登録しています…</p>';
  let r = null;
  try { r = await submitLap(key, name, me.bestLap); } catch { /* つながらない */ }
  if (r?.top?.[0]) game.hud.courseRecord = r.top[0];
  // VR のリザルトの右側に出す（rankText はその下に出す一言）
  game.rankText = r?.rank ? `${r.rank} 位に入りました！` : r ? `あなたのベストラップ ${(me.bestLap).toFixed(3)} 秒` : '';
  game.rankBoard = { top: r ? r.top : null, rank: r?.rank || null, me: name };
  game.rankHtml = `<h3 style="margin:14px 0 6px">🏆 ベストラップ ランキング${r?.rank ? `　<span style="color:#ffd23f">${r.rank} 位に入りました！</span>` : ''}</h3>${lapsTable(r ? r.top : null, name)}`;
  refreshRanking();
};
