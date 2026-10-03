import * as THREE from 'three';
import { Game } from './game.js';
import { InputManager, setBridgePads, setHidPads } from './input/devices.js';
import { HIDManager } from './input/webhid.js';
import { CalibrationUI } from './input/calibration.js';
import { FFBBridge } from './ffb.js';

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

const screens = { menu: $('menu'), calib: $('calib') };
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
};

const game = new Game({ renderer, input, ffb, ui });
$('opt-shake').addEventListener('change', (e) => { game.shake = Number(e.target.value); });
const calib = new CalibrationUI($('calib'), input, ffb, hid);
game.resize(window.innerWidth, window.innerHeight);

// メニュー
const npcSel = $('opt-npcs');
for (let i = 0; i <= 10; i++) npcSel.add(new Option(`${i} 台`, i, i === 10, i === 10));
const STORE = 'turbokart:menu';
try {
  const m = JSON.parse(localStorage.getItem(STORE) || '{}');
  if (m.npcs != null) npcSel.value = m.npcs;
  if (m.level) $('opt-level').value = m.level;
  if (m.laps) $('opt-laps').value = m.laps;
  if (m.shake != null) $('opt-shake').value = m.shake;
  if (m.vehicle) $('opt-vehicle').value = m.vehicle;
} catch {
  // 既定値
}
$('opt-trans').value = input.config.transmission;
$('opt-trans').addEventListener('change', (e) => {
  input.config.transmission = e.target.value;
  input.save();
});

function raceOptions() {
  const o = { npcs: Number(npcSel.value), level: $('opt-level').value, laps: Number($('opt-laps').value), manual: input.config.transmission === 'manual', shake: Number($('opt-shake').value), vehicle: $('opt-vehicle').value };
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
$('btn-restart').addEventListener('click', () => game.restart());
$('btn-menu').addEventListener('click', () => game.toMenu());

// VR
const vrBtn = $('btn-vr');
let pendingVR = null;
async function setupVR() {
  if (!navigator.xr || !(await navigator.xr.isSessionSupported('immersive-vr').catch(() => false))) {
    vrBtn.disabled = true;
    vrBtn.textContent = 'VR 非対応の環境';
    return;
  }
  vrBtn.addEventListener('click', async () => {
    game.audio.init();
    pendingVR = raceOptions();
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
      await renderer.xr.setSession(session);
    } catch (e) {
      pendingVR = null;
      alert(`VR を開始できませんでした: ${e.message}`);
    }
  });
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
