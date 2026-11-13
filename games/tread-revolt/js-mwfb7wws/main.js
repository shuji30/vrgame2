// 起動とメニュー。画面(HTML)はデスクトップ用で、VR の中では同じボタンを板に映して操作する
import * as THREE from '../vendor/three.module.js';
import { GameAudio } from './audio.js';
import { FfbBridge } from './input/bridge.js';
import { InputManager } from './input/input.js';
import { XrControls } from './input/xr.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { buildVehicle } from './scene/models.js';
import { VEHICLES, VEHICLE_ORDER, DIFFICULTY } from './core/vehicles.js';
import { STAGE_INFO, STAGE_COUNT, campaignStage, trainingStage, arenaStage, ARENA_LIST, AREA_NAMES } from './core/stages.js';
import { WHEEL_ACTIONS, defaultWheelConfig } from './core/tankmap.js';
import { detectChange } from './core/inputmap.js';
import { Tutorial } from './tutorial.js';
import { Online } from './net/online.js';
import { loadBuildInfo } from './version.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const SETTINGS_KEY = 'treadrevolt:settings';
const PROGRESS_KEY = 'treadrevolt:progress';

const DEFAULT_SETTINGS = {
  difficulty: 'normal', vehicle: 'medium', scheme: 'tracks', manualPitch: false, mouseSens: 1,
  vignette: 0.6, snapTurn: false, horizon: false, comfortTurn: 1, shadows: true,
  master: 0.8, sfx: 0.9, music: 0.35, speech: false,
  vrScale: 0.8, ffb: true, ffbInvert: true, ffbGain: 0.8, ffbSpring: 0.45, xrMode: 'sticks', turretHead: true, wheelOffset: { x: 0, y: 0, z: 0 }, name: 'PLAYER',
};
const settings = { ...DEFAULT_SETTINGS, ...load(SETTINGS_KEY, {}) };
const progress = { cleared: -1, best: {}, ...load(PROGRESS_KEY, {}) };

function load(k, d) {
  try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; }
}
function save(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できない環境 */ }
}

// ------------------------------------------------------------ 描画とサブシステム
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('snap') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
$('#app').appendChild(renderer.domElement);

const audio = new GameAudio();
const bridge = new FfbBridge();
bridge.start();
const input = new InputManager(bridge);
const hud = new Hud($('#hud'));
const xr = new XrControls(renderer);
const app = { renderer, audio, input, bridge, settings, hud, xr, onEnd: null, onPause: null, net: null };
const game = new Game(app);
xr.attach(game.seat);
applySettings();

function applySettings() {
  input.settings.scheme = settings.scheme;
  input.settings.manualPitch = settings.manualPitch;
  input.settings.mouseSens = settings.mouseSens;
  xr.mode = settings.xrMode;
  xr.turretHead = settings.turretHead;
  audio.setVolumes({ master: settings.master, sfx: settings.sfx, music: settings.music });
  save(SETTINGS_KEY, settings);
}

// ------------------------------------------------------------ メニューの背景(格納庫で回る車両)
const menu = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500), model: null, kind: null };
{
  const s = menu.scene;
  s.background = new THREE.Color(0x1a1610);
  s.fog = new THREE.Fog(0x1a1610, 20, 60);
  s.add(new THREE.HemisphereLight(0xffe0b0, 0x302418, 1.2));
  const key = new THREE.DirectionalLight(0xffd8a0, 2.4);
  key.position.set(6, 10, 4);
  s.add(key);
  const rim = new THREE.PointLight(0xff7a2a, 60, 30);
  rim.position.set(-6, 4, -6);
  s.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshStandardMaterial({ color: 0x3a3228, roughness: 0.9, metalness: 0.2 }));
  floor.rotation.x = -Math.PI / 2;
  s.add(floor);
  const turn = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.2, 0.3, 40), new THREE.MeshStandardMaterial({ color: 0x5a4a36, roughness: 0.7, metalness: 0.5 }));
  turn.position.y = 0.15;
  s.add(turn);
  menu.turn = turn;
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 12, 0.8), new THREE.MeshStandardMaterial({ color: 0x2a241c }));
    const a = (i / 8) * Math.PI * 2;
    p.position.set(Math.sin(a) * 18, 6, Math.cos(a) * 18);
    s.add(p);
  }
  menu.camera.position.set(8, 4.2, 9);
  menu.camera.lookAt(0, 1.4, 0);
  menu.rig = new THREE.Group();
  menu.rig.position.set(0, 0, 9);
  s.add(menu.rig);
}
function setMenuVehicle(kind) {
  if (menu.kind === kind) return;
  if (menu.model) menu.turn.remove(menu.model.root);
  menu.model = buildVehicle(kind, { faction: 'guard' });
  menu.model.root.position.y = 0.3;
  menu.turn.add(menu.model.root);
  menu.kind = kind;
}
setMenuVehicle(settings.vehicle);

// ------------------------------------------------------------ 画面の切り替え
let current = 'title';
const history = [];
function show(id, push = true) {
  if (push && current !== id) history.push(current);
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== `s-${id}`;
  current = id;
  focusIndex = 0;
  if (id === 'campaign') renderStages();
  if (id === 'settings') renderSettings();
  if (id === 'vehicle') renderVehicles();
  if (id === 'versus') renderVersus();
  if (id === 'online') online.render($('#online-card'));
  updateFocus();
}
function back() {
  const prev = history.pop() || 'title';
  show(prev, false);
}
document.addEventListener('click', (e) => {
  audio.unlock();
  const b = e.target.closest('[data-go]');
  if (!b) return;
  const go = b.dataset.go;
  audio.play('uiOk');
  if (go === 'back') back();
  else if (go === 'training') startTraining();
  else if (go === 'settings' && playing) { show('settings'); }
  else show(go);
});

// ------------------------------------------------------------ ステージ選択
let pending = null; // 出撃の準備
function renderStages() {
  const el = $('#stage-list');
  let html = '';
  let area = 0;
  for (const s of STAGE_INFO) {
    if (s.area !== area) {
      if (area) html += '</div>';
      area = s.area;
      html += `<div class="area-head">エリア${area} ${AREA_NAMES[area]}</div><div class="stages">`;
    }
    const locked = s.index > progress.cleared + 1 && !params.has('unlock');
    const best = progress.best[s.id];
    html += `<button data-stage="${s.index}" ${locked ? 'disabled' : ''}>${s.id} ${s.name}${s.boss ? ' ★' : ''}<small>${locked ? '前のステージをクリアすると選べる' : `制限時間 ${Math.floor(s.time / 60)}:${String(s.time % 60).padStart(2, '0')}`}${best ? ` <span class="best">ベスト ${best}</span>` : ''}</small></button>`;
  }
  html += '</div>';
  el.innerHTML = html;
  el.querySelectorAll('[data-stage]').forEach((b) => b.addEventListener('click', () => {
    pending = { mode: 'campaign', stageIndex: Number(b.dataset.stage) };
    show('vehicle');
  }));
}

function renderVehicles() {
  const el = $('#vehicle-list');
  el.innerHTML = VEHICLE_ORDER.map((k) => {
    const v = VEHICLES[k];
    return `<button data-veh="${k}" class="${settings.vehicle === k ? 'on' : ''}">${v.name}<small>${v.desc}<br>速さ ${'■'.repeat(Math.round(v.speed / 3))} 装甲 ${'■'.repeat(Math.round(v.hp / 35))} 主砲 ${'■'.repeat(Math.round(v.dmg / 11))}</small></button>`;
  }).join('');
  el.querySelectorAll('[data-veh]').forEach((b) => b.addEventListener('click', () => { settings.vehicle = b.dataset.veh; setMenuVehicle(settings.vehicle); applySettings(); renderVehicles(); }));
  $('#diff-list').innerHTML = Object.entries(DIFFICULTY).map(([k, d]) => `<button data-diff="${k}" class="${settings.difficulty === k ? 'on' : ''}">${d.label}</button>`).join('');
  $('#diff-list').querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => { settings.difficulty = b.dataset.diff; applySettings(); renderVehicles(); }));
  $('#vehicle-title').textContent = pending?.mode === 'versus' ? '車両の選択(対戦)' : `車両の選択 ― ${pending ? STAGE_INFO[pending.stageIndex]?.id + ' ' + STAGE_INFO[pending.stageIndex]?.name : ''}`;
  setMenuVehicle(settings.vehicle);
}
$('#btn-sortie').addEventListener('click', () => {
  if (!pending) return;
  if (pending.mode === 'versus') startVersus();
  else startCampaign(pending.stageIndex);
});

// ------------------------------------------------------------ 対戦(ボット)
const vs = { rule: 'dm', arena: 'plains', size: 2 };
function renderVersus() {
  const rules = [['dm', 'デスマッチ', '先に10両撃破したチームの勝ち'], ['dom', '拠点制圧', '3つの拠点を確保して点を稼ぐ'], ['ctf', '旗取り', '敵の旗を自陣へ3回持ち帰る']];
  $('#rule-list').innerHTML = rules.map(([k, n, d]) => `<button data-rule="${k}" class="${vs.rule === k ? 'on' : ''}">${n}<small>${d}</small></button>`).join('');
  $('#arena-list').innerHTML = ARENA_LIST.map((a) => `<button data-arena="${a.id}" class="${vs.arena === a.id ? 'on' : ''}">${a.name}</button>`).join('');
  $('#size-list').innerHTML = [1, 2, 3, 4].map((n) => `<button data-size="${n}" class="${vs.size === n ? 'on' : ''}">${n} vs ${n}</button>`).join('');
  $('#s-versus').querySelectorAll('[data-rule]').forEach((b) => b.addEventListener('click', () => { vs.rule = b.dataset.rule; renderVersus(); }));
  $('#s-versus').querySelectorAll('[data-arena]').forEach((b) => b.addEventListener('click', () => { vs.arena = b.dataset.arena; renderVersus(); }));
  $('#s-versus').querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => { vs.size = Number(b.dataset.size); renderVersus(); }));
}
$('#btn-versus-next').addEventListener('click', () => { pending = { mode: 'versus' }; show('vehicle'); });

// ------------------------------------------------------------ 開始
let playing = false;
let lastStart = null;

function begin(cfg) {
  audio.unlock();
  lastStart = cfg;
  for (const s of document.querySelectorAll('.screen')) s.hidden = true;
  current = 'game';
  history.length = 0;
  hud.show(true);
  if (game.running) game.stop();
  game.start(cfg);
  playing = true;
  // シェーダーを先に作っておく(最初の爆発や被弾で止まらないように)
  try { renderer.compile(game.scene, game.camera); } catch { /* 無視 */ }
  if (!renderer.xr.isPresenting && !params.has('nolock')) renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
}

function startCampaign(index) {
  const stage = campaignStage(index);
  begin({ mode: 'campaign', stage, stageIndex: index, players: [{ id: 'p1', name: settings.name, vehicle: settings.vehicle, ctrl: params.has('bot') ? 'bot' : 'local' }] });
}

function startTraining() {
  begin({ mode: 'training', stage: trainingStage(), players: [{ id: 'p1', name: settings.name, vehicle: settings.vehicle, ctrl: 'local' }], tutorial: new Tutorial() });
}

function startVersus() {
  const players = [{ id: 'p1', name: settings.name, vehicle: settings.vehicle, ctrl: 'local', team: 0 }];
  const kinds = ['medium', 'light', 'heavy', 'mech'];
  for (let i = 1; i < vs.size; i++) players.push({ id: `b0${i}`, name: `僚機${i}`, vehicle: kinds[i % 4], ctrl: 'bot', team: 0 });
  for (let i = 0; i < vs.size; i++) players.push({ id: `b1${i}`, name: `敵機${i + 1}`, vehicle: kinds[(i + 1) % 4], ctrl: 'bot', team: 1 });
  begin({ mode: 'versus', stage: arenaStage(vs.arena), players, versus: { rule: vs.rule } });
}

function quit() {
  playing = false;
  game.stop();
  hud.show(false);
  document.exitPointerLock?.();
  audio.playMusic('title');
  if (app.net) { app.net.leave?.(); }
  show('title', false);
}

app.onPause = (on) => {
  if (!playing) return;
  game.paused = on;
  if (on) { show('pause', false); document.exitPointerLock?.(); bridge.stopForces(); }
  else resume();
};
function resume() {
  game.paused = false;
  for (const s of document.querySelectorAll('.screen')) s.hidden = true;
  current = 'game';
  if (!renderer.xr.isPresenting) renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
}
$('#btn-resume').addEventListener('click', resume);
$('#btn-retry').addEventListener('click', () => { if (lastStart) { const c = { ...lastStart }; if (c.mode === 'campaign') startCampaign(c.stageIndex); else if (c.mode === 'training') startTraining(); else if (c.mode === 'versus') startVersus(); } });
$('#btn-quit').addEventListener('click', quit);
renderer.domElement.addEventListener('click', () => {
  audio.unlock();
  if (playing && !game.paused && !renderer.xr.isPresenting) renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
});

// ------------------------------------------------------------ 結果
app.onEnd = (r) => {
  document.exitPointerLock?.();
  bridge.stopForces();
  const card = $('#result-card');
  const st = r.stage;
  let html = '';
  if (r.state === 'over') {
    const win = r.winner === r.myTeam;
    html = `<p class="result-big">${r.winner < 0 ? '引き分け' : win ? '勝利!' : '敗北'}</p><p class="muted">${st.name} ― ${{ dm: 'デスマッチ', dom: '拠点制圧', ctf: '旗取り' }[game.sim?.mission.rule] || ''}</p>
      <table class="score-table">${r.players.map((p) => `<tr><td>${p.team === r.myTeam ? '味方' : '敵'} ${esc(p.name)}</td><td>${p.kills} 撃破 / ${p.deaths}</td></tr>`).join('')}</table>
      <div class="row"><button class="primary" id="r-again">もう1戦</button><button id="r-menu">メニューへ</button></div>`;
  } else if (r.state === 'done') {
    const idx = lastStart?.stageIndex ?? -1;
    if (lastStart?.mode === 'campaign') {
      progress.cleared = Math.max(progress.cleared, idx);
      progress.best[st.id] = Math.max(progress.best[st.id] || 0, r.score);
      save(PROGRESS_KEY, progress);
    }
    const acc = r.shots ? Math.round((Math.min(r.hits, r.shots) / r.shots) * 100) : 0;
    const last = idx >= STAGE_COUNT - 1;
    html = `<p class="result-big">${last ? 'ヴェイン解放!' : 'ステージクリア'}</p><p class="muted">${st.id} ${st.name}</p>
      <table class="score-table">
        <tr><td>撃破</td><td>${r.kills}</td></tr><tr><td>命中率</td><td>${acc}%</td></tr>
        <tr><td>残り時間ボーナス</td><td>${r.timeBonus}</td></tr><tr><td>ノーミスボーナス</td><td>${r.noDeathBonus}</td></tr>
        <tr><td>ボーナス目標</td><td>${r.bonus}</td></tr><tr><td><b>スコア</b></td><td>${r.score}</td></tr>
        <tr><td>ベスト</td><td>${progress.best[st.id] || r.score}</td></tr>
      </table>
      ${last ? '<p class="note">本部は陥落し、私兵部隊は惑星から撤退した。自警団の機体はふたたび作業機械に戻され、鉱山と町の再建に使われる。</p>' : ''}
      <div class="row">${!last && lastStart?.mode === 'campaign' ? '<button class="primary" id="r-next">次のステージへ ▶</button>' : ''}<button id="r-again">もう一度</button><button id="r-menu">メニューへ</button></div>`;
  } else {
    html = `<p class="result-big">作戦失敗</p><p class="muted">${st.id} ${st.name} ― ${r.reason === 'time' ? '時間切れ' : '全機撃破された'}</p>
      <table class="score-table"><tr><td>撃破</td><td>${r.kills}</td></tr><tr><td>スコア</td><td>${r.score}</td></tr></table>
      <div class="row"><button class="primary" id="r-again">もう一度</button><button id="r-menu">メニューへ</button></div>`;
  }
  card.innerHTML = html;
  show('result', false);
  $('#r-again')?.addEventListener('click', () => $('#btn-retry').click());
  $('#r-menu')?.addEventListener('click', quit);
  $('#r-next')?.addEventListener('click', () => startCampaign(lastStart.stageIndex + 1));
  if (app.net?.onEnd) app.net.onEnd(r);
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ------------------------------------------------------------ 設定・ハンコン
let learning = null;
function renderSettings() {
  const c = $('#settings-card');
  const S = settings;
  const W = input.wheelCfg;
  const slider = (key, label, min, max, step, obj = S, fmt = (v) => v) => `<label class="field"><span>${label}</span><input type="range" data-set="${key}" data-obj="${obj === S ? 's' : obj === W ? 'w' : 'st'}" min="${min}" max="${max}" step="${step}" value="${obj[key]}"><b data-show="${key}">${fmt(obj[key])}</b></label>`;
  const check = (key, label, obj = S) => `<label class="field"><span>${label}</span><input type="checkbox" data-set="${key}" data-obj="${obj === S ? 's' : 'w'}" ${obj[key] ? 'checked' : ''}><span></span></label>`;
  const sel = (key, label, opts, obj = S) => `<label class="field"><span>${label}</span><select data-set="${key}" data-obj="${obj === S ? 's' : 'w'}">${opts.map(([v, n]) => `<option value="${v}" ${String(obj[key]) === String(v) ? 'selected' : ''}>${n}</option>`).join('')}</select><span></span></label>`;
  c.innerHTML = `
    <h2>設定</h2>
    <label class="field"><span>名前(オンライン)</span><input type="text" data-set="name" data-obj="s" value="${esc(S.name)}" maxlength="12"><span></span></label>
    ${sel('scheme', '操作方式', [['tracks', '左右の履帯を別々に(標準)'], ['easy', '簡易操作(前後+旋回)']])}
    ${check('manualPitch', '砲身を手動で上下(上級者向け)')}
    ${slider('mouseSens', 'マウスの感度(砲塔)', 0.3, 3, 0.1)}
    <h2>酔い対策</h2>
    ${slider('vignette', '旋回中のビネットの強さ', 0, 1, 0.05)}
    ${slider('comfortTurn', '旋回速度の上限', 0.5, 1, 0.05)}
    ${check('snapTurn', 'スナップ旋回(VR)')}
    ${check('horizon', '地平線の固定表示')}
    <h2>VR</h2>
    ${sel('xrMode', 'VR の操作', [['sticks', 'タンクコントロール(左右スティック)'], ['levers', '掴んで倒す仮想レバー']])}
    ${check('turretHead', '砲塔を頭の向きに追従')}
    ${sel('vrScale', 'VR の解像度', [['0.5', '0.5(軽い)'], ['0.65', '0.65'], ['0.8', '0.8(標準)'], ['1', '1.0(高精細)']])}
    <p class="note">Pimax:OpenXR ランタイムを Pimax Play か SteamVR に。映像がずれるときは Parallel Projections を ON に。視野が広いので酔いやすい人はビネットを強めに。</p>
    <h2>画面と音</h2>
    ${check('shadows', '影(重いときは切る)')}
    ${slider('master', '全体の音量', 0, 1, 0.05)}
    ${slider('sfx', '効果音', 0, 1, 0.05)}
    ${slider('music', 'BGM', 0, 1, 0.05)}
    ${check('speech', '無線を読み上げる')}
    <h2>ハンコン(ffb-bridge 経由)</h2>
    <p class="status" id="bridge-status"></p>
    <p class="note">vrgame2 の ffb-bridge を起動しておくと、ここでハンコンの割り当てとキャリブレーションができます。割り当て:「割り当て」を押してから、その操作(ペダルを踏む、ボタンを押す)をする。ペダルは踏み切ってから離す。</p>
    ${sel('pedals', 'ペダル', [['3', '3ペダル(クラッチ=左履帯、アクセル=右履帯、ブレーキ=主砲)'], ['2', '2ペダル(ブレーキ=左履帯、アクセル=右履帯)']], W)}
    ${check('swap', '左右を入れ替える(パドルも連動)', W)}
    ${slider('brakeFire', 'ブレーキで撃つ踏み込み', 0.2, 0.95, 0.05, W)}
    ${slider('lockDeg', 'ハンドルの効く角度(°)', 90, 900, 10, W.steer)}
    ${slider('wheelDeg', 'ハンドルの回転角(ドライバー設定、°)', 180, 1080, 10, W.steer)}
    ${slider('deadzone', 'ハンドルの不感帯', 0, 0.2, 0.01, W.steer)}
    <table class="keys" id="wheel-rows">${WHEEL_ACTIONS.map((a) => `<tr data-act="${a.key}"><th>${a.label}${a.optional ? ' <span class="muted">(任意)</span>' : ''}</th><td class="bind"></td><td><div class="meter"><i></i></div></td><td><button data-learn="${a.key}">割り当て</button> <button data-clear="${a.key}">消す</button></td></tr>`).join('')}</table>
    <div class="row"><button id="w-reset">割り当てを初期化</button><button id="w-scan">デバイスを探し直す</button></div>
    <h2>FFB</h2>
    ${check('ffb', 'FFB を出す')}
    ${check('ffbInvert', 'FFB の左右を反転(テストで逆に回るときに切り替える)')}
    ${slider('ffbGain', '強さ', 0, 1, 0.05)}
    ${slider('ffbSpring', 'センタースプリング', 0, 1, 0.05)}
    <div class="row"><button data-ffbtest="left">テスト:左</button><button data-ffbtest="right">テスト:右</button><button data-ffbtest="rumble">テスト:振動</button></div>
    <h2>VR のハンドル位置合わせ</h2>
    ${slider('x', '左右(m)', -0.3, 0.3, 0.01, S.wheelOffset)}
    ${slider('y', '上下(m)', -0.3, 0.3, 0.01, S.wheelOffset)}
    ${slider('z', '前後(m)', -0.3, 0.3, 0.01, S.wheelOffset)}
    <div class="row"><button data-go="back">◀ 戻る</button><button id="reset-progress">進行状況を消す</button></div>`;
  c.querySelectorAll('[data-set]').forEach((el) => {
    el.addEventListener('input', () => {
      const key = el.dataset.set;
      const objName = el.dataset.obj;
      let obj = objName === 's' ? S : W;
      if (['lockDeg', 'wheelDeg', 'deadzone'].includes(key)) obj = W.steer;
      if (['x', 'y', 'z'].includes(key)) obj = S.wheelOffset;
      let v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
      if (key === 'pedals' || key === 'vrScale') v = Number(v);
      obj[key] = v;
      const show = c.querySelector(`[data-show="${key}"]`);
      if (show) show.textContent = v;
      input.saveWheel();
      applySettings();
      if (game.cockpit) game.cockpit.setWheelOffset(S.wheelOffset);
    });
  });
  c.querySelectorAll('[data-learn]').forEach((b) => b.addEventListener('click', () => startLearn(b.dataset.learn)));
  c.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => { delete W.bindings[b.dataset.clear]; input.saveWheel(); renderBindings(); }));
  c.querySelectorAll('[data-ffbtest]').forEach((b) => b.addEventListener('click', () => {
    let eff = b.dataset.ffbtest;
    if (settings.ffbInvert && eff !== 'rumble') eff = eff === 'left' ? 'right' : 'left';
    bridge.test(eff, settings.ffbGain);
  }));
  $('#w-reset').addEventListener('click', () => { if (confirm('ハンコンの割り当てを初期化しますか?')) { input.wheelCfg = defaultWheelConfig(); input.saveWheel(); renderSettings(); } });
  $('#w-scan').addEventListener('click', () => bridge.rescan());
  $('#reset-progress').addEventListener('click', () => { if (confirm('クリアの記録とベストスコアを消しますか?')) { progress.cleared = -1; progress.best = {}; save(PROGRESS_KEY, progress); } });
  renderBindings();
  renderBridgeStatus();
}

function renderBindings() {
  const W = input.wheelCfg;
  for (const tr of document.querySelectorAll('#wheel-rows tr')) {
    const b = W.bindings[tr.dataset.act];
    tr.querySelector('.bind').innerHTML = learning?.key === tr.dataset.act ? '<span style="color:var(--accent2)">操作してください…</span>' : b ? `${b.kind === 'axis' ? '軸' : 'ボタン'} ${b.control} <small class="muted">${esc(b.pad.slice(0, 28))}</small>` : '<span class="muted">未割り当て</span>';
  }
}

function renderBridgeStatus() {
  const el = $('#bridge-status');
  if (!el) return;
  if (bridge.connected) {
    const devs = (bridge.status.devices || []).map((d) => (typeof d === 'string' ? d : d.name)).join('、');
    el.innerHTML = `<span class="ok">● ブリッジ接続中</span> 入力 ${bridge.inputCount} 回受信 ${devs ? `/ ${esc(devs)}` : ''}`;
  } else {
    el.innerHTML = `<span class="bad">● ブリッジ未接続</span> ― vrgame2 の ffb-bridge(ZIP)を展開して start.bat を起動してください。このページの URL(${esc(location.origin)})が許可されている必要があります。`;
  }
}
bridge.onChange(() => renderBridgeStatus());

function startLearn(key) {
  const act = WHEEL_ACTIONS.find((a) => a.key === key);
  learning = { key, act, base: snapshot(), t: 0, found: null };
  renderBindings();
}
function snapshot() {
  return bridge.pads.map((p) => ({ id: p.id, index: p.index, axes: [...p.axes], buttons: [...p.buttons] }));
}
function learnTick(dt) {
  if (!learning) return;
  const L = learning;
  L.t += dt;
  const snap = snapshot();
  if (!L.found) {
    const ch = detectChange(L.base, snap);
    if (ch && ch.kind === L.act.kind) {
      const base = L.base.find((b) => b.id === ch.id && b.index === ch.index);
      L.found = { kind: ch.kind, pad: ch.id, index: ch.index, control: ch.control, rest: base?.axes[ch.control] ?? -1, full: snap.find((p) => p.id === ch.id)?.axes[ch.control] ?? 1 };
      L.t = 0;
      if (ch.kind === 'button' || L.act.key === 'steer') finishLearn();
    } else if (L.t > 10) { learning = null; renderBindings(); }
  } else {
    // ペダル:踏み切った値を記録してから確定
    const pad = snap.find((p) => p.id === L.found.pad);
    const v = pad?.axes[L.found.control];
    if (v != null && Math.abs(v - L.found.rest) > Math.abs(L.found.full - L.found.rest)) L.found.full = v;
    if (L.t > 1.5 && v != null && Math.abs(v - L.found.rest) < 0.15) finishLearn();
    if (L.t > 6) finishLearn();
  }
}
function finishLearn() {
  const L = learning;
  const W = input.wheelCfg;
  if (L.act.key === 'steer') { W.steer.center = L.base.find((b) => b.id === L.found.pad)?.axes[L.found.control] ?? 0; L.found.rest = undefined; }
  W.bindings[L.act.key] = L.found;
  if (L.act.pedal) W.pedalCal[L.act.key] = { rest: L.found.rest, full: L.found.full, deadzone: 0.04 };
  input.saveWheel();
  learning = null;
  audio.play('uiOk');
  renderBindings();
}
function meterTick() {
  if (current !== 'settings' || !bridge.live) return;
  const w = input.wheel || (input.wheelBound ? null : null);
  for (const tr of document.querySelectorAll('#wheel-rows tr')) {
    const i = tr.querySelector('.meter i');
    const b = input.wheelCfg.bindings[tr.dataset.act];
    if (!b) { i.style.width = '0'; continue; }
    const pad = bridge.pads.find((p) => p.id === b.pad);
    let v = 0;
    if (pad) v = b.kind === 'axis' ? (pad.axes[b.control] + 1) / 2 : pad.buttons[b.control] ? 1 : 0;
    i.style.width = `${Math.round(v * 100)}%`;
  }
  void w;
}

// ------------------------------------------------------------ メニューのキー・パッド・VR 操作
let focusIndex = 0;
function focusables() {
  const scr = document.querySelector('.screen:not([hidden])');
  return scr ? [...scr.querySelectorAll('button:not(:disabled)')] : [];
}
function updateFocus() {
  const list = focusables();
  list.forEach((b, i) => b.classList.toggle('focus', i === focusIndex));
  vrMenu.dirty = true;
}
function menuNav(a) {
  const list = focusables();
  if (!list.length) return;
  if (a.down || a.rightUi) { focusIndex = (focusIndex + 1) % list.length; audio.play('ui'); updateFocus(); list[focusIndex].scrollIntoView({ block: 'nearest' }); }
  if (a.up || a.leftUi) { focusIndex = (focusIndex - 1 + list.length) % list.length; audio.play('ui'); updateFocus(); list[focusIndex].scrollIntoView({ block: 'nearest' }); }
  if (a.ok && !(a.ok && document.activeElement?.tagName === 'INPUT')) { audio.unlock(); list[focusIndex]?.click(); updateFocus(); }
  if (a.back && current !== 'title' && current !== 'pause') { audio.play('uiBack'); back(); }
}

// VR の中のメニュー:いま表示している画面のボタンを板に映す
const vrMenu = {
  canvas: document.createElement('canvas'), mesh: null, dirty: true,
  init() {
    this.canvas.width = 1024; this.canvas.height = 1024;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false }));
    this.mesh.position.set(0, 0, -1.3);
  },
  draw() {
    const g = this.canvas.getContext('2d');
    g.clearRect(0, 0, 1024, 1024);
    g.fillStyle = 'rgba(20,16,10,0.92)';
    g.fillRect(0, 0, 1024, 1024);
    g.strokeStyle = '#ff8a2a';
    g.lineWidth = 6;
    g.strokeRect(3, 3, 1018, 1018);
    const scr = document.querySelector('.screen:not([hidden])');
    const title = scr?.querySelector('h2, .title-logo, .result-big')?.textContent || 'TREAD REVOLT';
    g.fillStyle = '#ffc24a';
    g.font = 'bold 54px system-ui, sans-serif';
    g.fillText(title.slice(0, 22), 40, 80);
    const list = focusables();
    const start = Math.max(0, Math.min(focusIndex - 6, list.length - 12));
    list.slice(start, start + 12).forEach((b, i) => {
      const idx = start + i;
      const y = 130 + i * 72;
      g.fillStyle = idx === focusIndex ? 'rgba(255,138,42,0.45)' : 'rgba(255,220,160,0.08)';
      g.fillRect(30, y, 964, 62);
      g.fillStyle = '#f4ead8';
      g.font = 'bold 34px system-ui, sans-serif';
      g.fillText((b.childNodes[0]?.textContent || b.textContent).trim().slice(0, 30), 50, y + 43);
    });
    g.fillStyle = 'rgba(244,234,216,0.6)';
    g.font = '26px system-ui, sans-serif';
    g.fillText('スティック上下で選択、トリガーで決定', 40, 1000);
    this.tex.needsUpdate = true;
    this.dirty = false;
  },
};
vrMenu.init();

// ------------------------------------------------------------ VR
const vrBtn = $('#vrBtn');
if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    if (!ok) return;
    vrBtn.hidden = false;
    vrBtn.addEventListener('click', enterVR);
  }).catch(() => {});
}
// VR の開始(vrgame4 の手順):解像度スケールは開始前に。段階を表示し、10 秒返事がなければランタイムを案内する
const vrStatus = document.createElement('div');
vrStatus.style.cssText = 'position:fixed;right:16px;bottom:64px;z-index:20;max-width:420px;background:rgba(0,0,0,.75);padding:8px 12px;font-size:13px;border-left:3px solid #ff8a2a';
vrStatus.hidden = true;
document.body.appendChild(vrStatus);
function vrStep(t) {
  vrStatus.hidden = !t;
  vrStatus.textContent = t;
  if (t) console.log('[VR]', t);
}
async function enterVR() {
  audio.unlock();
  if (renderer.xr.isPresenting) { renderer.xr.getSession()?.end(); return; }
  const slow = setTimeout(() => vrStep(`${vrStatus.textContent} ― 10 秒たっても返事がありません。SteamVR / Pimax Play が起動していて、OpenXR ランタイムになっているか確かめてください`), 10000);
  try {
    vrStep('VR を始めています…(1/3 ヘッドセットに頼んでいます)');
    renderer.xr.setFramebufferScaleFactor(settings.vrScale || 0.8);
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    vrStep('VR を始めています…(2/3 座席の位置を決めています)');
    // コックピットは座って遊ぶので、頭の位置を原点にする local を使う
    renderer.xr.setReferenceSpaceType('local');
    session.addEventListener('end', () => { vrBtn.textContent = 'ENTER VR'; game.camera.position.set(0, 0, 0); game.camera.rotation.set(0, 0, 0); });
    vrStep('VR を始めています…(3/3 描く準備をしています)');
    // Chrome 156 の WebXR Layers(投影レイヤー)は Pimax の OpenXR と組み合わさると止まるので、昔からの XRWebGLLayer で描かせる
    try { Object.defineProperty(session.renderState, 'layers', { value: undefined, configurable: true }); } catch { /* そのまま */ }
    await renderer.xr.setSession(session);
    renderer.xr.setFoveation?.(1);
    vrBtn.textContent = 'EXIT VR';
    vrStep('');
    document.exitPointerLock?.();
  } catch (e) {
    console.error(e);
    vrStep(`VR を開始できませんでした: ${e.name ? `${e.name}: ` : ''}${e.message}`);
  } finally {
    clearTimeout(slow);
  }
}

// 振動:VR コントローラーとゲームパッド(どちらも try で囲む)
app.haptic = (strength = 0.5, ms = 60) => {
  try {
    const s = renderer.xr.getSession();
    if (s) for (const src of s.inputSources) src.gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms);
  } catch { /* 対応していない */ }
  try {
    for (const g of navigator.getGamepads?.() || []) g?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 });
  } catch { /* 対応していない */ }
};

// ------------------------------------------------------------ メインループ
let last = performance.now();
let menuT = 0;
renderer.setAnimationLoop((t) => {
  const now = t || performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  learnTick(dt);
  if ((menuT += dt) > 0.1) { menuT = 0; meterTick(); }
  const inXR = renderer.xr.isPresenting;
  if (playing && game.running && current === 'game') {
    game.frame(dt);
    attachVrMenu(null);
    return;
  }
  // メニュー中
  if (inXR) input.xr = xr.poll(null, null); else input.xr = null;
  const a = input.poll(dt);
  menuNav(a);
  if (playing && game.running) {
    // ポーズ・結果の画面:ゲームの絵の上に重ねる
    if (a.pause && current === 'pause') resume();
    attachVrMenu(game.camera);
    if (vrMenu.dirty || inXR) vrMenu.draw();
    game.render();
  } else {
    menu.turn.rotation.y += dt * 0.35;
    if (inXR) {
      attachVrMenu(menu.rig);
      if (vrMenu.dirty) vrMenu.draw();
      menu.rig.position.set(0, 1.2, 8);
      if (!menu.rig.children.includes(game.camera)) { /* メニューの視点は XR が動かす */ }
      renderer.render(menu.scene, menu.xrCam || (menu.xrCam = makeMenuXrCam()));
    } else {
      attachVrMenu(null);
      renderer.render(menu.scene, menu.camera);
    }
  }
});

function makeMenuXrCam() {
  const cam = new THREE.PerspectiveCamera(70, 1, 0.05, 500);
  menu.rig.add(cam);
  return cam;
}

function attachVrMenu(parent) {
  const inXR = renderer.xr.isPresenting;
  if (!inXR || !parent) { vrMenu.mesh.parent?.remove(vrMenu.mesh); return; }
  if (vrMenu.mesh.parent !== parent) {
    vrMenu.mesh.parent?.remove(vrMenu.mesh);
    parent.add(vrMenu.mesh);
    if (parent === menu.rig) vrMenu.mesh.position.set(0, 0.1, -1.3);
    else vrMenu.mesh.position.set(0, 0, -1.2);
  }
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  game.camera.aspect = menu.camera.aspect = innerWidth / innerHeight;
  game.camera.updateProjectionMatrix();
  menu.camera.updateProjectionMatrix();
});

// ------------------------------------------------------------ オンライン
const online = new Online({ app, game, settings, begin, quit, show, esc, campaignStage, arenaStage, STAGE_INFO, ARENA_LIST, VEHICLES });
app.online = online;

// ------------------------------------------------------------ 起動
$('#loading').hidden = true;
$('#title-note').innerHTML = '推奨:PC の Chrome / Edge。VR は PCVR(OpenXR)。ハンコンは vrgame2 の ffb-bridge を起動しておく。<br><span id="ver"></span>';
loadBuildInfo().then((t) => { $('#ver').textContent = t; });
audio.playMusic('title');
if (params.has('stage')) {
  pending = { mode: 'campaign', stageIndex: Number(params.get('stage')) };
  if (params.get('vehicle')) settings.vehicle = params.get('vehicle');
  startCampaign(Number(params.get('stage')));
  if (params.get('view')) game.setView(params.get('view'));
} else if (params.has('training')) startTraining();
else if (params.has('versus')) { if (params.get('versus')) vs.rule = params.get('versus'); startVersus(); }
else show('title', false);

// テスト用:外から状態を見られるようにする
window.__tr = { game, settings, input, bridge, audio };
