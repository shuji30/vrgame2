import * as THREE from 'three';
import { World } from './world.js';
import { Input } from './input.js';
import { Hud, DebugPanel } from './hud.js';
import { Avatar } from './avatar.js';
import { SledRide } from './ride.js';
import { Combat, MISSILE_MAX, loadEnemyModels } from './combat.js';
import { STAGES, STAGE_COUNT, stageAt } from './stages.js';
import { Vignette, VIGNETTE_LEVELS } from './comfort.js';
import { CEIL_Y } from './world.js';
import { TouchControls, isTouchDevice } from './touch.js';
import { WheelInput } from './wheel/devices.js';
import { WheelPanel } from './wheel/calibration.js';
import { THEMES } from './world.js';
import { VERSION, loadBuildInfo } from './version.js';
import { RANK_CHARS, fetchTop, submitScore } from './ranking.js';
import { BGM_LIST, SE_LIST, captureAudioStream, initAudio, previewBGM, sfx, setEngine, say, startBGM, stopBGM, setBGMEnabled, setBGMMode, setEngineEnabled, setPaused, toggleMute } from './audio.js';

// ---- 定数
const X_LIMIT = 96;        // 左右の移動範囲 (m)
const Y_MAX = 20;          // 上昇できる高さ (リグの高さ, m)
const MOVE_X = 18;         // スティックを倒しきったときの横移動速度 (m/s)
const WHEEL_X_BOOST = 1.6; // ハンコンは切る角度が小さくなりがちなので、横移動を速くする
const moveX = (a) => MOVE_X * (a.source === 'wheel' ? WHEEL_X_BOOST : 1);
const MOVE_Y = 12;
const SPEED = {
  base: 40,                // 基準速度 (m/s)。速さは面ごとに固定 (加速・減速はない)
  ret: 0.25,               // MISS やつまずきで落ちた倍率が 1.0 倍に戻る速さ (/s)
};
const HARD_MULT = 1.2;     // 難しいモードの点の倍率
// 横スクロール: カメラ (リグ) を +X 側の空中に置いて -X 向きにし、プレイヤーは x = 0 の平面を飛ぶ。
// 画面の右 = 前 (-Z)。プレイヤーは画面の左寄り (z = +12) から始まる
const SIDE_CAM = new THREE.Vector3(26, 8.5, -8);
const SIDE_Z_MIN = -24, SIDE_Z_MAX = 10, SIDE_Z_START = 6; // 画面に収まる範囲
const SIDE_SCROLL = 0.3; // 横スクロールでは地面の流れを遅くする (映る範囲が狭いため)
const READY_TIME = 2.5;    // 開始時に 0 から基準速度までゆっくり加速する時間 (s)
const DEV_STAGE_LEN = Number(new URLSearchParams(location.search).get('stageLen')) || 0; // 開発用: ?stageLen=10 でボスまでを短くする
const NO_HUD = new URLSearchParams(location.search).has('nohud'); // 開発用: プロモーション用の撮影で HUD を消す
const DEV_START_STAGE = Number(new URLSearchParams(location.search).get('stage')) || 1; // 開発用: ?stage=7 で途中のステージから
const LIVES = 3;
const EXTENDS = [100000, 300000, 600000, 1000000]; // この点数で残機が 1 増える
const LIVES_MAX = 5;
const BONUS_LEN = 20;      // ボーナスステージの長さ (s)
const BONUS_TREE = 500;    // 木 1 本の点数
const LIFE_MAX = 100;      // ライフ。0 になると残機が 1 減り、満タンに戻る
const HEAL = 35;           // 回復アイテム 1 個で戻るライフ
const HARD_HEAL = 20;      // 難しいモードの回復量
// 全面クリアしたか (ごほうび: タイトルの ★、サウンドテストの 2 曲、難しいモード)
let cleared = false;
try { cleared = localStorage.getItem('skyrunner.cleared') === '1'; } catch (_) { /* 保存なし */ }
const hardMode = () => cleared && settings.hard;
const OBSTACLE_DAMAGE = 20;
const RING_BONUS = 500; // 浮遊リングをくぐったときの点

// ハイスコアは、ふつうと難しいモードで分ける
let hiScore = 0, hiHard = 0;
const hiNow = () => (hardMode() ? hiHard : hiScore);
let progress = 1; // 到達した面 (タイトルの CONTINUE で、そこから始められる)
try { progress = Math.max(1, Math.min(18, Number(localStorage.getItem('skyrunner.progress')) || 1)); } catch (_) { /* 保存なし */ }
try {
  hiScore = Number(localStorage.getItem('skyrunner.hi')) || 0;
  hiHard = Number(localStorage.getItem('skyrunner.hiHard')) || 0;
} catch (_) { /* 保存なし */ }

// ---- 設定 (localStorage に保存)
const settings = { scale: 1.0, bgm: true, engine: true, invertY: false, player: 'ship', view: '1st', mode: '3d', vignette: 'weak', vrGentle: true, autoFire: true, hard: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('skyrunner.settings') || '{}')); } catch (_) { /* 保存なし */ }
// 開発用: ?player=ship|human&view=1st|3rd で上書きする
for (const key of ['player', 'view', 'mode']) {
  const v = new URLSearchParams(location.search).get(key);
  if (v) settings[key] = v;
}
const applyAudioSettings = () => { setBGMEnabled(settings.bgm); setEngineEnabled(settings.engine); };
const saveSettings = () => { try { localStorage.setItem('skyrunner.settings', JSON.stringify(settings)); } catch (_) { /* 保存不可 */ } };

// ---- レンダラーとシーン
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 4000);
const rig = new THREE.Group();   // プレイヤー。VR ではこの中で頭が動く
rig.add(camera);
scene.add(rig);
camera.position.set(0, 1.6, 0);

const world = new World(scene);
const input = new Input(renderer.domElement);
const hud = new Hud(camera);
const touch = new TouchControls(document.getElementById('touch'));
input.touch = touch;
// ハンコン (ハンドル + ペダル)。設定はタイトル画面の「ハンコン設定」で行う
input.wheel = new WheelInput();
const wheelPanel = document.getElementById('wheelPanel');
new WheelPanel(wheelPanel, input.wheel);
const debugPanel = new DebugPanel(rig);
const avatar = new Avatar(scene, rig, camera);
avatar.load('./assets/').catch((e) => console.error('モデルを読み込めませんでした', e));
const combat = new Combat(scene);
const ride = new SledRide(scene);
combat.forceWave = new URLSearchParams(location.search).get('wave'); // 開発用: ?wave=moai などで出す敵を固定する
loadEnemyModels('./assets/enemies.glb').catch((e) => console.error('敵のモデルを読み込めませんでした', e));
debugPanel.visible = new URLSearchParams(location.search).has('debug');
if (debugPanel.visible) Object.assign(window, { __combat: combat, __input: input }); // 開発用: ?debug のときだけ、戦闘と入力の中身を見られるようにする

// VR の酔い対策: 速く飛んでいるときや大きく動いているときに、視野の周りを暗くする
const vignette = new Vignette(camera);

// 被弾したときに視界を赤くする (デスクトップのみ。VR は周りの赤い縁取り)
const flash = new THREE.Mesh(
  new THREE.SphereGeometry(0.2, 12, 8),
  new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, fog: false }),
);
flash.renderOrder = 999;
camera.add(flash);

// ---- VR コントローラー (簡易な銃のモデルとレーザー)
function makeGun() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.14), new THREE.MeshStandardMaterial({ color: 0x334455, metalness: 0.4, roughness: 0.4 }));
  body.position.z = -0.03;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x99ccff, emissive: 0x2266aa }));
  barrel.position.set(0, 0.01, -0.13);
  const laser = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -0.2), new THREE.Vector3(0, 0, -4)]),
    new THREE.LineBasicMaterial({ color: 0x66ffff, transparent: true, opacity: 0.35 }),
  );
  g.add(body, barrel, laser);
  return g;
}

for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  c.visible = false;
  c.add(makeGun());
  c.addEventListener('connected', (e) => {
    c.userData.src = e.data;
    c.visible = e.data.targetRayMode === 'tracked-pointer';
  });
  c.addEventListener('disconnected', () => {
    c.userData.src = null;
    c.visible = false;
  });
  rig.add(c);
  input.controllers.push(c);
}

// ---- ゲームの状態
const S = {
  mode: 'title',        // 'title' | 'play' | 'over'
  stage: 1,
  phase: 'normal',      // 'normal' → 'warning' → 'boss' → 'clear' → (奇数ステージは 'bonus' → 'bonusEnd') → 次のステージ
  bonusCount: 0,
  phaseT: 0,
  stageT: 0,
  baseSpeed: SPEED.base,
  lives: LIVES,
  life: LIFE_MAX,
  lowLifeT: 0,
  extendIdx: 0,
  overT: 0,
  paused: false,
  factor: 1,            // 速さの倍率 (MISS やつまずきで一時的に落ちる)
  ready: 0,             // 開始時の加速 (0..1)
  dist: 0,
  hits: 0,
  invuln: 0,
  msg: '', sub: '', msgT: 0,
  px: 0, py: 1, vx: 0, vy: 0,
  pz: SIDE_Z_START, vz: 0, // 横スクロールでの画面の左右 (z)
  floorOffset: 0,       // 参照空間が 'local' (床の高さが分からない) のときの補正
  refSpace: '-',
  fps: 60,
};

function showMsg(msg, sub = '', time = 2) {
  S.msg = msg;
  S.sub = sub;
  S.msgT = time;
}

const overlay = document.getElementById('overlay');

function startPlay(stageNo) {
  if (!Number.isInteger(stageNo)) stageNo = selectedStage; // タイトルで選んだ面 (もう一度のときも同じ面から)
  stopPreview();
  wheelPanel.open = false; // ハンコン設定を閉じる (開いている間は、ハンコンをゲームの操作として読まないため)
  input.wheel.panelOpen = false;
  S.fromStart = stageNo === 1;
  initAudio();
  Object.assign(S, {
    mode: 'play', paused: false, entry: null, factor: 1, ready: 0, dist: 0, hits: 0, invuln: 0, px: 0, py: 1, vx: 0, vy: 0, pz: SIDE_Z_START, vz: 0,
    stage: 1, phase: 'normal', phaseT: 0, stageT: 0, baseSpeed: SPEED.base, lives: LIVES, life: LIFE_MAX, lowLifeT: 0, extendIdx: 0, overT: 0, slowT: 0,
  });
  if (isSide()) S.py = 8; // 横スクロールは画面の中ほどの高さから
  world.clear();
  combat.reset();
  avatar.recenter();
  avatar.destroyed = false;
  avatar.fallT = -1;
  avatar.stumbleT = 0;
  endBonus();
  overlay.hidden = true;
  applyAudioSettings();
  setPaused(false);
  stopBGM();
  startBGM();
  applyStage(stageNo, true);
}

// ステージ表の内容を反映する
function applyStage(n, first = false) {
  S.stage = n;
  if (n > progress && n <= STAGE_COUNT) {
    progress = n;
    try { localStorage.setItem('skyrunner.progress', String(n)); } catch (_) { /* 保存不可 */ }
  }
  S.stageT = 0;
  S.phaseT = 0;
  // ボスラッシュの何体目から始めるか (CONTINUE で太陽の前から / 開発用: ?rush=7)
  S.rushIndex = pendingRush ?? Math.max(0, Number(new URLSearchParams(location.search).get('rush')) || 0);
  pendingRush = null;
  const st = stageAt(n);
  combat.hard = hardMode();
  combat.level = st.diff + (combat.hard ? 2 : 0); // 難しいモードは 2 段強く
  combat.bonusLevel = st.diff; // 撃破ボーナスは難しいモードでも面の強さのまま (点全体に HARD_MULT をかける)
  combat.mult = combat.hard ? HARD_MULT : 1;
  combat.density = st.density;
  combat.waveTable = st.waves;
  world.applyTheme(st.palette);
  world.setObstacles(st.obstacles);
  world.setCeiling(st.ceiling);
  S.baseTarget = st.speed;
  if (first) S.baseSpeed = st.speed;
  combat.ceilingY = st.ceiling ? CEIL_Y - 8 : Infinity;
  S.stageLen = DEV_STAGE_LEN || st.length;
  setBGMMode('rock', st.bgm);
  const title = `STAGE ${n}`;
  if (st.kind === 'bonus') {
    startBonus(title, st.name);
  } else if (st.kind === 'rush') {
    S.phase = 'warning';
    showMsg(title, `${st.name} - BOSS RUSH`, 3.5);
    sfx.warning();
  } else {
    S.phase = 'normal';
    showMsg(first ? 'GO AHEAD!' : title, first ? `${title}  ${st.name}` : st.name, first ? READY_TIME : 2.5);
  }
  say(first ? 'Go ahead!' : `Stage ${n}`);
}

function togglePause(p) {
  S.paused = p;
  setPaused(p);
}

// タイトルのステージ選択 (開発用の ?stage=N があれば、それを最初に選んでおく)
let selectedStage = Math.max(1, Math.min(STAGE_COUNT, DEV_START_STAGE));
const stageSel = document.getElementById('stageSel');
STAGES.forEach((st, i) => {
  const kind = st.kind === 'bonus' ? '  ★BONUS' : st.kind === 'rush' ? '  ★BOSS RUSH' : '';
  stageSel.add(new Option(`STAGE ${String(i + 1).padStart(2, '0')}  ${st.name}${kind}`, String(i + 1)));
});
stageSel.value = String(selectedStage);
stageSel.addEventListener('change', () => { selectedStage = Number(stageSel.value); });

// サウンドテスト: BGM は押すたびに 再生 / 停止、効果音は押すたびに鳴らす
let previewing = null;
const bgmButtons = [];
function stopPreview() {
  if (!previewing) return;
  previewing = null;
  previewBGM(null);
  bgmButtons.forEach((b) => b.classList.remove('playing'));
}
const sndButton = (name, desc, onClick) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.append(name);
  const s = document.createElement('small');
  s.textContent = desc;
  b.append(s);
  b.addEventListener('click', onClick);
  return b;
};
// 曲の一覧 (全面クリアしたら作り直して、伏せていた曲を出す)
function buildBgmList() {
  const list = document.getElementById('bgmList');
  list.replaceChildren();
  bgmButtons.length = 0;
  for (const m of BGM_LIST) {
    if (m.locked && !cleared) { // 全面クリアするまでは名前を伏せる
      const b = sndButton('？？？', '全面クリアで解放', () => {});
      b.disabled = true;
      list.append(b);
      continue;
    }
    const b = sndButton(m.name, m.desc, () => {
      const again = previewing === m.id;
      stopPreview();
      if (again) return;
      previewing = m.id;
      previewBGM(m.id);
      b.classList.add('playing');
    });
    bgmButtons.push(b);
    list.append(b);
  }
}
buildBgmList();
for (const e of SE_LIST) document.getElementById('seList').append(sndButton(e.name, e.desc, () => { initAudio(); e.play(); }));
document.getElementById('soundTest').addEventListener('toggle', (ev) => { if (!ev.target.open) stopPreview(); });

// 最終ボス (太陽) の前まで来たら、そこから続けられる
let pendingRush = null;
let sunCheckpoint = false;
try { sunCheckpoint = localStorage.getItem('skyrunner.sun') === '1'; } catch (_) { /* 保存なし */ }
function saveSunCheckpoint() {
  sunCheckpoint = true;
  try { localStorage.setItem('skyrunner.sun', '1'); } catch (_) { /* 保存不可 */ }
}
const sunIndex = () => STAGES[STAGE_COUNT - 1].rush.findIndex((r) => r.type === 'sun');

const showHiScore = () => {
  // 難しいモードを選んでいるときは、難しいモードのハイスコアを出す
  const hi = hardMode() ? `HARD ${hiHard}` : String(hiScore);
  document.getElementById('hiscore').textContent = cleared ? `★ ALL CLEAR   ${hi}` : hi;
  const btn = document.getElementById('btnContinue');
  btn.hidden = progress <= 1;
  btn.querySelector('small').textContent = progress === STAGE_COUNT && sunCheckpoint ? '最終ボスの前から' : `STAGE ${progress} から`;
};

function toTitle() {
  S.mode = 'title';
  showHiScore();
  endBonus();
  combat.reset();
  S.paused = false;
  S.msg = '';
  overlay.hidden = false;
  setPaused(false);
  setEngine(0);
  stopBGM();
  const session = renderer.xr.getSession();
  if (session) session.end();
}

// ---- VR に入る。床の高さが取れない機器では 'local' にして高さを補正する
async function enterVR() {
  initAudio();
  try {
    renderer.xr.setFramebufferScaleFactor(settings.scale);
    if (input.wheel.hasBindings()) input.wheel.bridge.connect(); // VR の最中はブリッジ経由でハンコンを読む
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    let type = 'local-floor';
    try { await session.requestReferenceSpace('local-floor'); } catch (_) { type = 'local'; }
    renderer.xr.setReferenceSpaceType(type);
    S.refSpace = type;
    S.floorOffset = type === 'local' ? 1.6 : 0;
    session.addEventListener('end', onSessionEnd);
    await renderer.xr.setSession(session);
    renderer.xr.setFoveation?.(1); // 視野の端を粗く描いて軽くする (Quest で効く)
    startPlay();
  } catch (err) {
    console.error(err);
    document.getElementById('status').textContent = `VR を開始できませんでした: ${err.message}`;
  }
}

function onSessionEnd() {
  camera.position.set(0, 1.6, 0);
  camera.rotation.set(0, 0, 0);
  S.floorOffset = 0;
  S.refSpace = '-';
  if (S.mode !== 'title') toTitle();
}

// ---- 毎フレームの処理
const P = new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;
const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));
const ease = (t) => t * t * (3 - 2 * t);

const isSide = () => settings.mode === 'side';
const vrGentle = () => renderer.xr.isPresenting && settings.vrGentle;
const yMax = () => Math.min(stageAt(S.stage).ceiling ? CEIL_Y - 8 : Y_MAX, vrGentle() ? 12 : Y_MAX);
const moveY = () => MOVE_Y * (vrGentle() ? 0.6 : 1);

// ハンコンのクラッチ: 踏み込み量 = 高さ (a.altitude 0..1)。目標の高さへ、上下の速さを抑えてなめらかに近づける
// (急に動くと VR で酔いやすい)。返り値は新しい上下の速さ
function altitudeVy(dt, altitude) {
  const target = clamp(altitude, 0, 1) * yMax();
  const vmax = moveY() * 1.5;
  const want = clamp((target - S.py) * 2.5, -vmax, vmax);
  return S.vy + (want - S.vy) * (1 - Math.exp(-dt * 6));
}
// 上下の入力 (スティックなど。上下反転の設定を効かせる) + ハンコンのパドル (反転しない)
const liftInput = (a) => clamp((settings.invertY ? -a.move.y : a.move.y) + (a.lift || 0), -1, 1);

function movePlayer(dt, a) {
  if (isSide()) return moveSide(dt, a);
  const ox = S.px, oy = S.py;
  if (a.abs && !renderer.xr.isPresenting) {
    // マウス: 画面上の位置へ機体が寄っていく (原作のような操作感)
    const k = 1 - Math.exp(-dt * 5);
    S.px += (a.abs.x * X_LIMIT - S.px) * k;
    S.py += ((a.abs.y * 0.5 + 0.5) * yMax() - S.py) * k;
  } else {
    // スティック: 速度を滑らかに変える (急に動き出すと VR で酔いやすい)
    const k = 1 - Math.exp(-dt * 8);
    const my = liftInput(a); // 上下反転 (操縦桿のように、前に倒すと下がる)
    S.vx += (a.move.x * moveX(a) - S.vx) * k;
    if (a.altitude != null) S.vy = altitudeVy(dt, a.altitude); // ハンコンのクラッチ: 高さを位置で決める
    else S.vy += (my * moveY() - S.vy) * k;
    S.px += S.vx * dt;
    S.py += S.vy * dt;
  }
  S.px = clamp(S.px, -X_LIMIT, X_LIMIT);
  S.py = clamp(S.py, 0, yMax());
  S.vx = (S.px - ox) / dt;
  S.vy = (S.py - oy) / dt;
}

function nextStage() {
  if (S.stage >= STAGE_COUNT) return allClear();
  applyStage(S.stage + 1);
}

// 全 18 面クリア
function allClear() {
  S.phase = 'ending';
  S.phaseT = 0;
  S.endingStep = -1;
  showMsg('ALL CLEAR!!', `CONGRATULATIONS!  SCORE ${combat.score}`, 5);
  sfx.clear();
  say('Congratulations');
  setBGMMode('ending', { key: 0, tempo: 152 }); // エンディングの曲 (ステージのテンポの影響を受けない)
  combat.clearHostiles();
  try { localStorage.setItem('skyrunner.cleared', '1'); } catch (_) { /* 保存不可 */ } // クリアのごほうび用
  // 読み込み直さなくても、タイトルに戻ったらごほうびが出るように
  if (!cleared) {
    cleared = true;
    buildBgmList();
    unlockHard();
  }
}

// エンディング (約 90 秒): 1〜18 面の景色を順に通り過ぎ、面の名前とボスの名前を出す。最後に点数の内訳。5 秒たったら飛ばせる
const ENDING_START = 5, ENDING_PER = 4.4;
const ENDING_LEN = ENDING_START + STAGE_COUNT * ENDING_PER + 6;
function updateEnding() {
  const i = Math.floor((S.phaseT - ENDING_START) / ENDING_PER);
  if (S.phaseT >= ENDING_START && i < STAGE_COUNT && i !== S.endingStep) {
    S.endingStep = i;
    const st = STAGES[i];
    world.fadeTheme(st.palette); // 色は 1.2 秒かけて移す
    world.setObstacles(st.obstacles);
    world.setCeiling(false); // 天井は出さない (景色を見せる)
    const boss = st.kind === 'bonus' ? 'BONUS STAGE' : st.kind === 'rush' ? 'BOSS RUSH → ' + BOSS_INFO.sun[0] : BOSS_INFO[st.boss?.type]?.[0] || '';
    showMsg(`STAGE ${i + 1}  ${st.name}`, boss, ENDING_PER - 0.4);
  } else if (i >= STAGE_COUNT && S.endingStep < STAGE_COUNT) {
    S.endingStep = STAGE_COUNT;
    showMsg('THANK YOU FOR PLAYING', `SCORE ${combat.score}   ENEMIES ${combat.kills}   HITS ${S.hits}`, 6);
  }
}

// ボスの名前と、倒し方のひとこと (初めて会ったときだけ WARNING の 2 行目に出す)
const BOSS_INFO = {
  serpent: ['プリズム連珠', '頭を狙え'],
  twin: ['双晶', '2 つの頭を狙え'],
  squad: ['ロボット部隊', '縦一列の突進をよけて撃て'],
  swarm: ['旋回する群れ', '逃げる前に全部落とせ'],
  mirror: ['ミラーコア', '鏡は弾を撃ち返す。すき間から核を撃て'],
  geodering: ['晶洞の輪', '殻が開いて光ったときだけ倒せる'],
  mine: ['浮遊鉱山', '壊せない。耐えろ、出撃口を壊せ'],
  colossus: ['磁鉄の巨像', '電極を先に壊せ'],
  sun: ['プリズムの太陽', '最後の戦い'],
  crown: ['氷晶の冠', '赤い印をよけろ。つららを壊せば雨が減る'],
  worm: ['砂岩の大蛇', '頭だけが弱点。進む先を狙え'],
  turbine: ['双子の回転刃', '刃は戻ってくる。真ん中の核を撃て'],
  phantom: ['水晶の亡霊', '目が水色の本物を撃て。分身は紫'],
  laserwing: ['光翼の母船', '光線は上下によけろ。翼の先を壊せ'],
  mantis: ['硝子のカマキリ', '斬撃をよけたら、光る腹を撃て'],
  whale: ['溶岩の結晶鯨', '浮上したら背中の潮吹き穴を撃て'],
};
let bossSeen = new Set();
try { bossSeen = new Set(JSON.parse(localStorage.getItem('skyrunner.bossSeen') || '[]')); } catch (_) { /* 保存なし */ }
function warningText(def) {
  const info = BOSS_INFO[def?.type];
  if (!info) return '巨大な敵が接近中';
  if (bossSeen.has(def.type)) return info[0];
  bossSeen.add(def.type);
  try { localStorage.setItem('skyrunner.bossSeen', JSON.stringify([...bossSeen])); } catch (_) { /* 保存不可 */ }
  return `${info[0]} — ${info[1]}`;
}

// ステージの進行: 通常 → WARNING → ボス → STAGE CLEAR → 次のステージ
function updateStage(dt) {
  S.stageT += dt;
  S.phaseT += dt;
  const st = stageAt(S.stage);
  if (S.phase === 'normal' && S.stageT > S.stageLen) {
    S.phase = 'warning';
    S.phaseT = 0;
    showMsg('WARNING!!', warningText(st.kind === 'rush' ? st.rush[S.rushIndex] : st.boss), 3.5);
    sfx.warning();
  } else if (S.phase === 'warning' && S.phaseT > 3.5) {
    S.phase = 'boss';
    S.phaseT = 0;
    const def = st.kind === 'rush' ? st.rush[S.rushIndex] : st.boss;
    combat.level = (def.diff ?? st.diff) + (combat.hard ? 2 : 0);
    combat.spawnBoss(def);
    setBGMMode(def.type === 'sun' ? 'finale' : 'boss'); // 最終ボスは専用の曲
  } else if (S.phase === 'boss' && (combat.bossDefeated || combat.bossEscaped)) {
    const escaped = combat.bossEscaped;
    combat.bossDefeated = combat.bossEscaped = false;
    combat.clearHostiles(); // 残った敵の弾や破片を消す
    S.phaseT = 0;
    if (st.kind === 'rush' && S.rushIndex < st.rush.length - 1) {
      // ボスラッシュ: 次のボスへ
      S.rushIndex++;
      S.phase = 'warning';
      S.phaseT = -1.5; // WARNING の 3.5 秒と合わせて、ボスの間は 5 秒
      const next = st.rush[S.rushIndex];
      showMsg(`BOSS ${S.rushIndex + 1} / ${st.rush.length}`, next.type === 'sun' ? warningText(next) : '回復アイテムを取って、次のボスへ', 3);
      if (next.type === 'sun') saveSunCheckpoint(); // 最終ボスの前まで来たら、CONTINUE で太陽の前から始められる
      combat.spawnItem(new THREE.Vector3(P.x, Math.max(3, P.y), -60));
      sfx.warning();
    } else {
      S.phase = 'clear';
      showMsg('STAGE CLEAR!', escaped ? '敵は逃げ去った' : `BOSS BONUS ${combat.lastBossBonus}`, 4.5);
      sfx.clear();
      setBGMMode('rock', st.bgm);
    }
  } else if (S.phase === 'clear' && S.phaseT > 5) {
    nextStage();
  } else if (S.phase === 'ending') {
    updateEnding();
    if (S.phaseT > ENDING_LEN) gameOver(true);
  } else if (S.phase === 'bonus' && S.phaseT > BONUS_LEN) {
    S.phase = 'bonusEnd';
    S.phaseT = 0;
    const pts = S.bonusCount * BONUS_TREE;
    combat.score += pts;
    world.mode = 'normal';
    showMsg(`BONUS ${pts}`, `なぎ倒した木 ${S.bonusCount} 本 × ${BONUS_TREE}`, 3.5);
    sfx.clear();
  } else if (S.phase === 'bonusEnd' && S.phaseT > 3.5) {
    endBonus();
    nextStage();
  }
  // 点数が一定を超えるごとに残機を増やす
  if (S.extendIdx < EXTENDS.length && combat.score >= EXTENDS[S.extendIdx]) {
    S.extendIdx++;
    if (S.lives < LIVES_MAX) {
      S.lives++;
      showMsg('EXTEND!', '残機 +1', 1.5);
      sfx.clear();
    }
  }
}

// 機体の爆発: 一人称のときは目の前で見えるよう、少し前方で爆発させる
const boomPos = new THREE.Vector3();
function playerExplosion(big) {
  boomPos.copy(P);
  if (settings.view === '1st') boomPos.add(new THREE.Vector3(THREE.MathUtils.randFloatSpread(5), THREE.MathUtils.randFloatSpread(3), -THREE.MathUtils.randFloat(4, 8)));
  else boomPos.add(new THREE.Vector3(THREE.MathUtils.randFloatSpread(3), THREE.MathUtils.randFloatSpread(2), THREE.MathUtils.randFloatSpread(3)));
  combat.explode(boomPos, big);
}

// ボーナスステージ: 水晶のそりに乗って、木をなぎ倒す (敵は出ず、ダメージも受けない)
function startBonus(title = 'BONUS STAGE', name = '') {
  S.phase = 'bonus';
  S.phaseT = 0;
  S.bonusCount = 0;
  world.mode = 'bonus';
  ride.start();
  avatar.riding = true;
  setBGMMode('bonus');
  showMsg(title, `${name ? name + ' - ' : ''}BONUS STAGE: 水晶のそりで木をなぎ倒せ!`, 3);
  say('Bonus stage');
}

function endBonus() {
  if (ride.active) setBGMMode('rock');
  ride.stop();
  avatar.riding = false;
  world.mode = 'normal';
}

// そりを置く位置: 一人称は自分の足元 (そりの上に立ち、先頭の水晶が前に見える)、三人称は機体の真下
const rideAnchor = new THREE.Vector3();
function updateRide(dt) {
  if (!ride.active) return;
  if (settings.view === '1st') camera.getWorldPosition(rideAnchor).add(new THREE.Vector3(0, -1.9, -0.6));
  else avatar.center(settings.player, rideAnchor).add(new THREE.Vector3(0, -1.3, 0.3));
  ride.update(dt, rideAnchor);
  if (S.phase !== 'bonus') return;
  // そりで体当たりした木を、なぎ倒す
  for (let i = 0; i < 6; i++) {
    const o = world.hitTest(ride.headPos, 3);
    if (!o) break;
    world.knockDown(o);
    S.bonusCount++;
    combat.explode(o.group.position.clone().setY(2), false);
    input.rumble(0.4, 80);
  }
}

function gameOver(cleared = false) {
  S.mode = 'over';
  S.overT = 0;
  S.boomT = cleared ? Infinity : 0;
  S.cleared = cleared;
  if (!cleared && settings.player === 'human') {
    S.boomT = Infinity; // 人間は爆発せず、地面に倒れる (avatar.fall)
  } else if (!cleared) {
    avatar.destroyed = true;
    playerExplosion(true);
  }
  S.paused = false;
  if (cleared) {
    setBGMMode(false);
    stopBGM();
  } else {
    setBGMMode('gameover', { key: 0, tempo: 152 }); // 子守唄 (ステージのキーとテンポの影響を受けない)
  }
  if (S.fromStart && combat.score > hiNow()) { // ハイスコアは 1 面から通したときだけ
    if (combat.hard) hiHard = combat.score;
    else hiScore = combat.score;
    try { localStorage.setItem(combat.hard ? 'skyrunner.hiHard' : 'skyrunner.hi', String(combat.score)); } catch (_) { /* 保存不可 */ }
  }
  showMsg(cleared ? 'CONGRATULATIONS!' : 'GAME OVER', `SCORE ${combat.score}   ${combat.hard ? 'HARD HI' : 'HI'} ${hiNow()}`, Infinity);
  if (!cleared) say('Game over');
  // オンラインのランキング: 1 面から通したときだけ、イニシャルを入れて送る
  S.entry = S.fromStart && combat.score > 0 ? {
    state: 'input', pos: 0, chars: [...lastInitials()].map((c) => Math.max(0, RANK_CHARS.indexOf(c))),
    base: S.sub, score: combat.score, mode: combat.hard ? 'hard' : 'normal', stage: S.stage, cleared,
  } : null;
}

// ---- ランキングのイニシャル入力 (上下で文字を変え、決定 / 右で次の文字、左で戻る。キーボードは文字を直接打てる)
const lastInitials = () => {
  try { return localStorage.getItem('skyrunner.initials') || 'AAA'; } catch (_) { return 'AAA'; }
};
const nav = { x: 0, y: 0, t: 0 };
// スティックを倒した瞬間と、倒し続けている間の繰り返しを、-1 / 0 / +1 で返す
function navStep(axis, v, dt) {
  const d = v > 0.6 ? 1 : v < -0.6 ? -1 : 0;
  if (d !== nav[axis]) {
    nav[axis] = d;
    nav.t = 0.4;
    return d;
  }
  if (d && (nav.t -= dt) <= 0) {
    nav.t = 0.15;
    return d;
  }
  return 0;
}
function entryText(e) {
  if (e.state === 'sending') return '送信中…';
  if (e.state === 'done') return `ONLINE RANK ${e.rank} / ${e.total}  (${e.mode === 'hard' ? '難しいモード' : 'ふつう'})`;
  if (e.state === 'error') return 'ランキングに送れませんでした';
  if (e.state === 'skipped') return '';
  return 'NAME  ' + e.chars.map((c, i) => (i === e.pos ? `[${RANK_CHARS[c]}]` : ` ${RANK_CHARS[c]} `)).join('');
}
function updateEntry(dt, a) {
  const e = S.entry;
  const wheel = a.source === 'wheel'; // ハンコンは上下がないので、ハンドルの左右で文字を変える
  const typing = e.typed && a.source === 'kb'; // 文字を打ったあとは WASD を移動として読まない
  const up = typing ? 0 : navStep('y', wheel ? a.move.x : a.move.y + (a.lift || 0), dt);
  const side = wheel || typing ? 0 : navStep('x', a.move.x, dt);
  if (up) e.chars[e.pos] = (e.chars[e.pos] + up + RANK_CHARS.length) % RANK_CHARS.length; // 上 (ハンドルは右) で次の文字
  if (side < 0) e.pos = Math.max(0, e.pos - 1);
  if (a.back) e.state = 'skipped';
  else if (side > 0 || a.confirm || (a.fire && a.source === 'touch' && !e.touchHeld)) nextEntryChar();
  e.touchHeld = a.fire && a.source === 'touch';
}
function nextEntryChar() {
  const e = S.entry;
  if (e.pos < 2) { e.pos++; return; }
  const name = e.chars.map((c) => RANK_CHARS[c]).join('');
  try { localStorage.setItem('skyrunner.initials', name); } catch (_) { /* 保存不可 */ }
  e.state = 'sending';
  submitScore({ name, score: e.score, mode: e.mode, stage: e.stage, cleared: e.cleared, player: settings.player, version: VERSION })
    .then(({ rank, total }) => { Object.assign(e, { state: 'done', rank, total }); loadRanking(); })
    .catch((err) => { console.warn(err); e.state = 'error'; });
}
addEventListener('keydown', (ev) => {
  const e = S.entry;
  if (S.mode !== 'over' || e?.state !== 'input' || S.overT <= 2 || ev.repeat) return;
  const k = ev.key.toUpperCase();
  if (k.length === 1 && RANK_CHARS.includes(k)) {
    e.chars[e.pos] = RANK_CHARS.indexOf(k);
    e.typed = true;
    nextEntryChar();
  }
});

// タイトルのランキング (ふつう / 難しいモード、上位 10 件)
async function loadRanking() {
  for (const mode of ['normal', 'hard']) {
    const el = document.getElementById(mode === 'hard' ? 'rankHard' : 'rankNormal');
    try {
      const rows = await fetchTop(mode);
      el.replaceChildren(...rows.map((r) => {
        const li = document.createElement('li');
        li.textContent = `${r.name}  ${r.score}  ${r.cleared ? '★ ALL CLEAR' : `STAGE ${r.stage}`}`;
        return li;
      }));
      if (!rows.length) el.textContent = 'まだ記録がありません';
    } catch (_) {
      el.textContent = '読み込めませんでした';
    }
  }
}
document.getElementById('ranking').addEventListener('toggle', (ev) => { if (ev.target.open) loadRanking(); });

// damage: 減らすライフの量
function moveSide(dt, a) {
  const oz = S.pz, oy = S.py;
  if (a.abs && !renderer.xr.isPresenting) {
    const k = 1 - Math.exp(-dt * 5);
    S.pz += ((SIDE_Z_MIN + SIDE_Z_MAX) / 2 - a.abs.x * (SIDE_Z_MAX - SIDE_Z_MIN) / 2 - S.pz) * k;
    S.py += ((a.abs.y * 0.5 + 0.5) * yMax() - S.py) * k;
  } else {
    const k = 1 - Math.exp(-dt * 8);
    const my = liftInput(a);
    S.vz += (-a.move.x * moveX(a) - S.vz) * k; // 右へ倒すと前 (-Z) へ
    if (a.altitude != null) S.vy = altitudeVy(dt, a.altitude);
    else S.vy += (my * moveY() - S.vy) * k;
    S.pz += S.vz * dt;
    S.py += S.vy * dt;
  }
  S.pz = clamp(S.pz, SIDE_Z_MIN, SIDE_Z_MAX);
  S.py = clamp(S.py, 0, yMax());
  S.vz = (S.pz - oz) / dt;
  S.vy = (S.py - oy) / dt;
  S.vx = 0;
}

function onHit(damage) {
  if (S.invuln > 0 || S.mode !== 'play' || ['bonus', 'bonusEnd', 'clear', 'ending'].includes(S.phase)) return; // クリアのあとは当たらない
  S.hits++;
  vignette.hit(0.4 + damage / 60);
  S.life -= damage;
  if (S.life > 0) {
    S.invuln = 0.8;
    flash.material.opacity = 0.25 + damage / 80;
    sfx.damage();
    input.rumble(0.6 + damage / 100, 200);
    return;
  }
  // ライフが尽きた: 残機を 1 減らしてライフを満タンに戻す
  S.lives--;
  const human = settings.player === 'human';
  if (human) {
    sfx.scream(); // 「あーっ」
    avatar.fall(S.lives <= 0);
  }
  if (S.lives <= 0) {
    S.life = 0;
    flash.material.opacity = 0.8;
    sfx.damage();
    input.rumble(1.0, 500);
    gameOver();
    return;
  }
  S.life = LIFE_MAX;
  S.invuln = 3;
  slowDown(0.75, 1.5);
  flash.material.opacity = 0.8;
  sfx.damage();
  sfx.explode(true);
  input.rumble(1.0, 500);
  if (!human) playerExplosion(true);
  showMsg('MISS!', `残機 ${S.lives}`, 2);
}

// 減速: 速さの倍率を to まで、なめらかに落とす
function slowDown(to, time) {
  S.slowTo = to;
  S.slowT = time;
}

// 人間が茂みに足を引っかけた: ダメージは受けず、よろけて減速する
function stumble() {
  if (S.invuln > 0) return;
  S.invuln = 0.8;
  slowDown(0.6, 1);
  avatar.stumble();
  sfx.hit();
  input.rumble(0.5, 150);
}

function onPickup(type) {
  if (type !== 'heal') return;
  if (S.life >= LIFE_MAX) {
    combat.score += 2000;
    showMsg('LIFE FULL', 'BONUS 2000', 1.2);
  } else {
    const heal = hardMode() ? HARD_HEAL : HEAL;
    S.life = Math.min(LIFE_MAX, S.life + heal);
    showMsg('RECOVER!', `LIFE +${heal}`, 1.2);
  }
  sfx.heal();
  input.rumble(0.3, 100);
}

// バージョンと公開日時 (タイトル画面とポーズ画面に出す)
let buildInfo = `v${VERSION}`;
loadBuildInfo().then((text) => {
  buildInfo = text;
  document.getElementById('version').textContent = text;
});

const ENTRY_HINT = {
  xr: 'ランキングに名前を: 左スティック上下で文字、トリガーで次へ   A: 送らない',
  pad: 'ランキングに名前を: 上下で文字、A で次へ   B: 送らない',
  kb: 'ランキングに名前を: 英数字を打つ (または ↑↓ と Enter)   Backspace: 送らない',
  mouse: 'ランキングに名前を: 英数字を打つ (または ↑↓ と Enter)   Backspace: 送らない',
  touch: 'ランキングに名前を: スティック上下で文字、FIRE で次へ',
  wheel: 'ランキングに名前を: ハンドルで文字、機関砲のボタンで次へ   タイトルへのボタン: 送らない',
};
const RETRY_HINT = {
  touch: 'FIRE: もう一度',
  xr: 'トリガー: もう一度   A: タイトルへ',
  pad: 'A / START: もう一度   B: タイトルへ',
  kb: 'Space / Enter: もう一度   Backspace: タイトルへ',
  mouse: 'クリック: もう一度   Backspace: タイトルへ',
  wheel: '機関砲のボタン: もう一度   タイトルへのボタン / Backspace: タイトルへ',
};

// ---- 照準と射撃
const sidePos = new THREE.Vector3(); // 横スクロールでのプレイヤーの位置
const eyeW = new THREE.Vector3();
const aimOrigin = new THREE.Vector3();
const aimDir = new THREE.Vector3();
const missileOrigin = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v2 = new THREE.Vector2();
const handAims = [0, 1].map(() => ({ origin: new THREE.Vector3(), aimOrigin: new THREE.Vector3(), aimDir: new THREE.Vector3() }));

function controllerRay(c, out) {
  c.getWorldPosition(out.origin);
  out.aimOrigin.copy(out.origin);
  out.aimDir.set(0, 0, -1).applyQuaternion(c.getWorldQuaternion(_q));
  return out;
}

function updateCombat(dt, speed, a) {
  const presenting = renderer.xr.isPresenting;
  const kind = settings.player, view = settings.view;
  const side = isSide();
  const humanVR = presenting && kind === 'human' && view === '1st' && !side;
  camera.getWorldPosition(eyeW);

  // ロックオンの向き: 横スクロールは前 (画面の右)、VR は視線 (人間の一人称は右手のコントローラー)、デスクトップは正面
  if (side) {
    aimOrigin.copy(P);
    aimDir.set(0, 0, -1);
  } else if (presenting) {
    aimOrigin.copy(eyeW);
    camera.getWorldDirection(aimDir);
    if (humanVR) {
      const right = input.controllers.find((c) => c.visible && c.userData.src?.handedness === 'right');
      if (right) {
        const r = controllerRay(right, handAims[0]);
        aimOrigin.copy(r.aimOrigin);
        aimDir.copy(r.aimDir);
      }
    }
  } else {
    aimOrigin.copy(view === '3rd' ? avatar.hitPoint : eyeW);
    aimDir.set(0, 0, -1);
  }

  // 機関砲: 人間の一人称 VR は手のコントローラーから、それ以外は機体の銃口から
  // 自動で撃つ (設定): プレイ中は撃ちっぱなし (ボーナスステージ・ポーズ中は撃たない)
  const auto = settings.autoFire && S.mode === 'play' && !S.paused && !['bonus', 'bonusEnd', 'ending'].includes(S.phase);
  let guns = [], firing = a.fire || auto;
  if (humanVR) {
    a.handFire.forEach((h, i) => { if (h.fire) guns.push(controllerRay(h.controller, handAims[i % 2])); });
    firing = firing || guns.length > 0;
    if (!guns.length && firing) guns = [{ origin: eyeW, aimOrigin, aimDir }];
  } else {
    firing = firing || a.handFire.some((h) => h.fire);
    guns = avatar.muzzles(kind).map((p) => ({ origin: p, aimOrigin, aimDir }));
    if (!guns.length) guns = [{ origin: eyeW, aimOrigin, aimDir }];
  }

  const layer = presenting ? renderer.xr.getBaseLayer?.() : null;
  const halfHeight = (layer?.framebufferHeight ?? renderer.getDrawingBufferSize(_v2).y) / 2;

  combat.update({
    dt, scroll: side ? speed * SIDE_SCROLL : speed, world, side, planeX: side ? 0 : null,
    spawn: S.mode === 'play' && S.ready >= 1 && S.phase === 'normal',
    active: S.mode === 'play' && S.ready >= 1 && !['clear', 'bonus', 'bonusEnd', 'ending'].includes(S.phase),
    player: P, playerR: avatar.radius, eye: eyeW,
    aimOrigin, aimDir, guns, firing,
    missile: a.missile, missileOrigin: avatar.center(kind, missileOrigin),
    showAim: !humanVR, halfHeight,
    gunStyle: kind === 'human' ? 'fireball' : 'beam',
    onPlayerHit: (damage) => onHit(damage),
    onPickup,
  });
}

function update(dt) {
  const a = input.state;
  if (a.debug) debugPanel.toggle();

  let speed = 15; // タイトル画面では景色だけゆっくり流す
  let running = true;

  if (S.mode === 'title') {
    // パッドの A / START でもデスクトップモードを開始できる
    if (a.confirm && (a.source === 'pad' || a.source === 'wheel') && !renderer.xr.isPresenting) startPlay();
    if (a.leftRight) setPlayer(a.leftRight < 0 ? 'ship' : 'human');
  } else if (S.mode === 'over') {
    // ゲームオーバー: 景色だけゆっくり止まっていく。2 秒たったら、もう一度 / タイトルへ
    S.overT += dt;
    speed = S.baseSpeed * S.factor * Math.max(0, 1 - S.overT / 2.5);
    // 最初の 1.5 秒は爆発が続く
    if (S.overT < 1.5 && (S.boomT -= dt) <= 0) {
      S.boomT = 0.12;
      playerExplosion(Math.random() < 0.5);
    }
    if (S.entry) S.sub = [S.entry.base, entryText(S.entry)].filter(Boolean).join('   ');
    if (S.overT > 2 && S.entry?.state === 'input') updateEntry(dt, a);
    else if (S.overT > 2 && S.entry?.state !== 'sending') {
      if (a.back) toTitle();
      else if (a.confirm || (a.fire && a.source === 'touch')) startPlay(); // タッチは射撃ボタンでもう一度
    }
  } else {
    // エンディングを飛ばすのはポーズのボタンだけ (決定は機関砲と同じボタンなので、撃ち続けていた人がうっかり飛ばさないように)
    if (S.phase === 'ending') { if (S.phaseT > ENDING_START && a.pause) gameOver(true); }
    else if (a.pause) togglePause(!S.paused);
    else if (S.paused && a.back) toTitle();
    else if (S.paused && a.confirm) togglePause(false);

    if (S.paused) {
      speed = 0;
      running = false;
    } else {
      if (a.view && isSide()) {
        showMsg('SIDE VIEW', '横スクロールでは視点は固定です', 1.2);
      } else if (a.view) {
        settings.view = settings.view === '1st' ? '3rd' : '1st';
        saveSettings();
        showMsg(settings.view === '1st' ? 'VIEW: 1ST PERSON' : 'VIEW: 3RD PERSON', '', 1.2);
        avatar.recenter();
      }
      if (a.recenter) {
        avatar.recenter();
        showMsg('RECENTER', '', 0.8);
      }

      S.factor = approach(S.factor, 1, SPEED.ret * dt);

      S.ready = Math.min(1, S.ready + dt / READY_TIME);
      // 基準速度は、面が変わっても 3 秒ほどかけて移る。MISS やつまずきの減速も、急には落とさない
      S.baseSpeed = approach(S.baseSpeed, S.baseTarget ?? S.baseSpeed, 4 * dt);
      if (S.slowT > 0) {
        S.slowT -= dt;
        S.factor = approach(S.factor, Math.min(S.factor, S.slowTo), 1.2 * dt);
      }
      speed = S.baseSpeed * S.factor * ease(S.ready);
      updateStage(dt);
      movePlayer(dt, a);
      S.dist += speed * dt;
      S.invuln -= dt;
    }
  }

  const side = isSide();
  if (side) {
    rig.position.set(SIDE_CAM.x, SIDE_CAM.y + S.floorOffset, SIDE_CAM.z);
    rig.rotation.y = Math.PI / 2; // -X 向き (プレイヤーの平面を真横から見る)
  } else {
    rig.position.set(S.px, S.py + S.floorOffset, 0);
    rig.rotation.y = 0;
  }
  sidePos.set(0, S.py + 1.6, S.pz);
  const play = S.mode === 'play';
  const inGame = play || S.mode === 'over';
  avatar.update(dt, {
    kind: settings.player, view: side ? 'side' : inGame ? settings.view : '3rd',
    vx: S.vx, vy: S.vy, thrust: inGame ? speed / SPEED.base : 0.3, presenting: renderer.xr.isPresenting, sidePos,
  });
  P.copy(avatar.hitPoint);
  world.side = side;
  // ボス戦 (WARNING から撃破まで) は障害物を出さない
  world.update(dt, side ? speed * SIDE_SCROLL : speed, P, running && !(play && (S.phase === 'warning' || S.phase === 'boss')));

  if (play && running) updateRide(dt);
  world.reach = yMax() + 1.6; // 今飛べる高さ (これより低い柱は飛び越えられる高さで出す)
  if (play && running && !ride.active) {
    // 浮遊リングの真ん中をくぐったらボーナス
    const ringO = world.ringPass(P);
    if (ringO) {
      combat.score += Math.round(RING_BONUS * combat.mult);
      showMsg(`RING +${Math.round(RING_BONUS * combat.mult)}`, '', 0.8);
      sfx.lock();
      input.rumble(0.2, 40);
    }
  }
  if (play && running && !ride.active && S.invuln <= 0) {
    const o = world.hitTest(P, avatar.radius * 0.7); // 障害物には少し小さめの当たりで (かすっただけでは当たらない)
    if (o && o.kind === 'bush' && settings.player === 'human') stumble();
    else if (o) onHit(OBSTACLE_DAMAGE);
    if (o && ['tree', 'bush', 'mushroom', 'crystal'].includes(o.kind)) world.knockDown(o); // ぶつかった木などは、すり抜けずに倒れる
  }
  // ライフが少ないときは警告音
  if (play && running && S.life < LIFE_MAX * 0.3 && (S.lowLifeT -= dt) <= 0) {
    S.lowLifeT = 1.2;
    sfx.lowLife();
  }
  const riding = ['bonus', 'bonusEnd'].includes(S.phase); // ボーナスステージはそりを操るだけ (撃たない)
  if (play && running) updateCombat(dt, speed, riding ? { ...a, fire: false, handFire: [], missile: false } : a);
  if (combat.announce) {
    showMsg(combat.announce, '', 2);
    say(combat.announce.toLowerCase().replace('!', ''));
    combat.announce = '';
  }
  else if (S.mode === 'over') updateCombat(dt, speed, { ...a, fire: false, handFire: [], missile: false }); // 爆発や煙の続きを見せる

  flash.material.opacity = Math.max(0, flash.material.opacity - dt * 1.2);
  if (renderer.xr.isPresenting) flash.material.opacity = 0; // VR では視界全体を光らせない
  // ビネットの強さ: 速さと上下左右の動きに合わせる (VR のときだけ)
  {
    const lvl = renderer.xr.isPresenting ? VIGNETTE_LEVELS[settings.vignette] ?? 0 : 0;
    const motion = play && running
      ? THREE.MathUtils.clamp(Math.max(0, speed / SPEED.base - 0.85) * 1.6 + Math.abs(S.vy) / MOVE_Y * 0.7 + Math.abs(S.vx) / MOVE_X * 0.5 + Math.abs(S.vz) / MOVE_X * 0.3, 0, 1)
      : 0;
    vignette.update(dt, lvl * (0.25 + 0.75 * motion));
  }
  setEngine(S.mode === 'play' && running ? speed / SPEED.base : 0);

  // デスクトップのみ: 機体の傾きと速度による画角の変化 (VR ではカメラを動かさない)
  if (!renderer.xr.isPresenting) {
    // 爆発で画面を揺らす (デスクトップのみ)
    const shake = S.mode === 'over' ? Math.max(0, 1 - S.overT / 1.8) * 0.25 : 0;
    camera.position.set(THREE.MathUtils.randFloatSpread(shake), 1.6 + THREE.MathUtils.randFloatSpread(shake), 0);
    camera.rotation.z += ((side ? 0 : -S.vx * 0.012) - camera.rotation.z) * Math.min(1, dt * 6);
    // タイトル画面では少し左を向き、自機がメニューに隠れず右寄りに見えるようにする
    camera.rotation.y += ((S.mode === 'title' && innerWidth > 700 && !side ? 0.3 : 0) - camera.rotation.y) * Math.min(1, dt * 3);
    const fov = (side ? 50 : 75) + (S.mode === 'play' ? (speed / SPEED.base - 1) * (side ? 6 : 14) : 0);
    if (Math.abs(fov - camera.fov) > 0.01) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    }
  }

  if (S.msgT > 0) {
    S.msgT -= dt;
    if (S.msgT <= 0) S.msg = S.sub = '';
  }

  hud.mesh.visible = inGame && !NO_HUD;
  // デスクトップでは HUD を画面いっぱいに広げる (VR では視野の中央に収める)。縦長の画面 (スマートフォン) では幅に合わせて縮める
  {
    const visW = 2 * 1.5 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    hud.mesh.scale.setScalar(renderer.xr.isPresenting ? 1 : Math.min(1.7, (visW / 1.6) * 0.98));
  }
  // スマートフォン: プレイ中だけタッチ操作のボタンを出す
  touch.show(isTouchDevice() && inGame && !renderer.xr.isPresenting);
  hud.draw({
    play,
    dist: Math.floor(S.dist),
    hits: S.hits,
    kmh: Math.round(speed * 3.6),
    view: `${settings.player === 'ship' ? 'SHIP' : 'HUMAN'} ${isSide() ? 'SIDE' : settings.view.toUpperCase()}`,
    score: combat.score,
    missiles: combat.missileStock,
    missileMax: MISSILE_MAX,
    locks: combat.locks.length,
    msg: S.paused ? 'PAUSE' : S.msg,
    sub: S.paused ? (a.source === 'pad' ? 'START: 再開   B: タイトルへ' : a.source === 'xr' ? 'X/トリガー: 再開   A: タイトルへ' : a.source === 'wheel' ? 'ポーズ / 機関砲のボタン: 再開   タイトルへのボタン: タイトルへ' : 'Esc/クリック: 再開   Backspace: タイトルへ') : S.sub,
    hint: S.paused ? buildInfo : S.mode === 'over' && S.overT > 2 ? (S.entry?.state === 'input' ? ENTRY_HINT[a.source] || ENTRY_HINT.kb : S.entry?.state === 'sending' ? '' : RETRY_HINT[a.source]) : '', // プレイ中は操作方法を出さない
    lives: S.lives,
    life: Math.max(0, Math.round(S.life)),
    lifeMax: LIFE_MAX,
    blink: S.life < LIFE_MAX * 0.3 && Math.floor(performance.now() / 250) % 2 === 0,
    // エンディング中は、いま通り過ぎている面を出す
    stageNo: S.phase === 'ending' && S.endingStep >= 0 && S.endingStep < STAGE_COUNT ? S.endingStep + 1 : S.stage, stageCount: STAGE_COUNT, hard: combat.hard,
    // ボスラッシュの間は、何体目かも出す
    stageName: S.phase === 'ending' && S.endingStep >= 0 && S.endingStep < STAGE_COUNT ? STAGES[S.endingStep].name : stageAt(S.stage).kind === 'rush' && ['warning', 'boss'].includes(S.phase) ? `${stageAt(S.stage).name}  BOSS ${S.rushIndex + 1}/${stageAt(S.stage).rush.length}` : stageAt(S.stage).name,
    hi: Math.max(hiNow(), combat.score),
    mult: Math.round(combat.mult * 10) / 10,
    boss: combat.bossRatio === null ? null : Math.round(combat.bossRatio * 100) / 100,
    bonus: S.phase === 'bonus' ? { count: S.bonusCount, left: Math.max(0, Math.ceil(BONUS_LEN - S.phaseT)) } : null,
  });

  S.fps += (1 / Math.max(dt, 1e-4) - S.fps) * 0.05;
  debugPanel.draw(dt, { fps: S.fps, xr: renderer.xr.isPresenting, refSpace: S.refSpace, scale: settings.scale, version: buildInfo, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }, input);
}

// 開発用: プロモーション動画の録画で、ゲームの音を取り出す
window.__audioStream = () => captureAudioStream();
// 開発用: 自動テストからすぐ撃墜させる
window.__debugPx = () => S.px;
window.__debugKill = () => { S.lives = 1; S.invuln = 0; onHit(999); };
window.__debugScore = (n) => { combat.score = n; }; // 開発用: 点を決める (ランキングの確認)
window.__debugClear = () => allClear(); // 開発用: すぐ全面クリアにする (エンディングとごほうびの確認)
window.__enemies = () => combat.enemies.map((e) => [e.kind, ...e.mesh.position.toArray().map((v) => Math.round(v * 10) / 10)]); // 開発用: 敵の位置
// 開発用: 自動テストから状態を読む
window.__debugSub = () => `${S.sub}  ${JSON.stringify(S.entry)}`; // 開発用: ゲームオーバーの 2 行目とランキングの入力
window.__debugState = () => ({
  gameMode: settings.mode, msg: S.msg, bonusCount: S.bonusCount, destroyed: avatar.destroyed, shipVisible: avatar.models.ship?.obj.visible, overT: S.overT, frame: renderer.info.render.frame, mode: S.mode, py: S.py, version: document.getElementById('version').textContent, phase: S.phase, stage: S.stage, lives: S.lives, boss: combat.bossRatio, ready: S.ready, score: combat.score, kills: combat.kills, enemies: combat.enemies.length,
  shots: combat.shots.length, missiles: combat.missiles.length, stock: combat.missileStock, locks: combat.locks.length, hits: S.hits,
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(Math.max(clock.getDelta(), 1e-4), 0.05);
  input.update();
  update(dt);
  renderer.render(scene, camera);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- タイトル画面
const btnVR = document.getElementById('btnVR');
const btnDesk = document.getElementById('btnDesk');
const selScale = document.getElementById('scale');
const status = document.getElementById('status');
const padStatus = document.getElementById('pads');

// プレイヤーの選択 (宇宙船 / 人間)。パッドの左右でも切り替えられる
const playerInputs = [...document.querySelectorAll('input[name="player"]')];
function setPlayer(kind) {
  settings.player = kind;
  saveSettings();
  playerInputs.forEach((el) => { el.checked = el.value === kind; });
}
setPlayer(settings.player === 'human' ? 'human' : 'ship');
// モードの選択 (3D / 横スクロール)
const modeInputs = [...document.querySelectorAll('input[name="mode"]')];
function setMode(mode) {
  settings.mode = mode;
  saveSettings();
  modeInputs.forEach((el) => { el.checked = el.value === mode; });
  world.clear();
}
setMode(settings.mode === 'side' ? 'side' : '3d');
modeInputs.forEach((el) => el.addEventListener('change', () => setMode(el.value)));
playerInputs.forEach((el) => el.addEventListener('change', () => setPlayer(el.value)));
showHiScore();
selScale.value = String(settings.scale);
const selVignette = document.getElementById('vignette');
selVignette.value = settings.vignette;
selVignette.addEventListener('change', () => { settings.vignette = selVignette.value; saveSettings(); });
// 難しいモード: 全面クリアするまで選べない
function unlockHard() {
  const hard = document.getElementById('hard');
  hard.disabled = !cleared;
  hard.closest('label').classList.toggle('locked', !cleared);
  if (!cleared) settings.hard = false;
}
unlockHard();
for (const key of ['bgm', 'engine', 'invertY', 'vrGentle', 'autoFire', 'hard']) {
  const el = document.getElementById(key);
  el.checked = settings[key];
  el.addEventListener('change', () => { settings[key] = el.checked; saveSettings(); applyAudioSettings(); showHiScore(); });
}
addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat && S.entry?.state !== 'input') showMsg(toggleMute() ? 'SOUND OFF' : 'SOUND ON', '', 1);
});
selScale.addEventListener('change', () => { settings.scale = Number(selScale.value); saveSettings(); });
btnDesk.addEventListener('click', () => startPlay(selectedStage)); // クリックの情報をステージ番号と取り違えないように
document.getElementById('btnContinue').addEventListener('click', () => {
  if (progress === STAGE_COUNT && sunCheckpoint) pendingRush = sunIndex(); // 最終ボスの前から
  startPlay(progress);
});
btnVR.addEventListener('click', enterVR);
if (new URLSearchParams(location.search).has('play')) startPlay(); // 開発用: ?play ですぐ開始
if (new URLSearchParams(location.search).has('bonus')) { // 開発用: ?play&bonus でボーナスステージ (5 面) から始める
  S.ready = 1;
  applyStage(5);
}

if (!window.isSecureContext) {
  status.textContent = 'HTTPS か localhost で開かないと VR は使えません。';
} else if (!navigator.xr) {
  status.textContent = 'このブラウザは WebXR に対応していません (デスクトップモードで遊べます)。';
} else {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    btnVR.disabled = !ok;
    status.textContent = ok
      ? 'VR ヘッドセットを使えます。'
      : 'VR ヘッドセットが見つかりません。PCVR の場合は OpenXR ランタイム (Pimax Play / SteamVR) が起動しているか確認してください。';
  });
}

setInterval(() => {
  const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
  padStatus.textContent = pads.length
    ? `パッド接続中: ${pads.map((p) => p.id.replace(/\s*\(.*\)/, '')).join(', ')}  (A / START で出撃、左右で機体を選択)`
    : 'パッドを使う場合は、接続してからいずれかのボタンを押してください。';
}, 500);
