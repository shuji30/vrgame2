import * as THREE from 'three';
import { World } from './world.js';
import { Input, HINTS } from './input.js';
import { Hud, DebugPanel } from './hud.js';
import { Avatar } from './avatar.js';
import { Combat, MISSILE_MAX, loadEnemyModels } from './combat.js';
import { THEMES } from './world.js';
import { VERSION, loadBuildInfo } from './version.js';
import { initAudio, sfx, setEngine, say, startBGM, stopBGM, setBGMEnabled, setBGMMode, setEngineEnabled, setPaused, toggleMute } from './audio.js';

// ---- 定数
const X_LIMIT = 32;        // 左右の移動範囲 (m)
const Y_MAX = 8;           // 上昇できる高さ (リグの高さ, m)
const MOVE_X = 18;         // スティックを倒しきったときの横移動速度 (m/s)
const MOVE_Y = 9;
const SPEED = {
  base: 40,                // 基準速度 (m/s)
  min: 0.5, max: 1.5,      // アクセル/ブレーキの範囲 (基準に対する倍率)
  accel: 0.6,              // 倍率の変化の上限 (/s)。急な加減速は酔いやすいので抑える
  ret: 0.25,               // 自動で 1.0 倍に戻る速さ (/s)
};
const READY_TIME = 2.5;    // 開始時に 0 から基準速度までゆっくり加速する時間 (s)
const STAGE_LEN = Number(new URLSearchParams(location.search).get('stageLen')) || 60; // ボスが出るまでの時間 (s)。開発用に ?stageLen=10 で短くできる
const LIVES = 3;
const EXTEND_EVERY = 50000; // この点数ごとに残機が 1 増える
const LIVES_MAX = 5;
const LIFE_MAX = 100;      // ライフ。0 になると残機が 1 減り、満タンに戻る
const HEAL = 35;           // 回復アイテム 1 個で戻るライフ
const OBSTACLE_DAMAGE = 20;

let hiScore = 0;
try { hiScore = Number(localStorage.getItem('skyrunner.hi')) || 0; } catch (_) { /* 保存なし */ }

// ---- 設定 (localStorage に保存)
const settings = { scale: 1.0, autoReturn: true, bgm: true, engine: true, invertY: false, player: 'ship', view: '1st' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('skyrunner.settings') || '{}')); } catch (_) { /* 保存なし */ }
// 開発用: ?player=ship|human&view=1st|3rd で上書きする
for (const key of ['player', 'view']) {
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
const debugPanel = new DebugPanel(rig);
const avatar = new Avatar(scene, rig, camera);
avatar.load('./assets/').catch((e) => console.error('モデルを読み込めませんでした', e));
const combat = new Combat(scene);
combat.forceWave = new URLSearchParams(location.search).get('wave'); // 開発用: ?wave=moai などで出す敵を固定する
loadEnemyModels('./assets/enemies.glb').catch((e) => console.error('敵のモデルを読み込めませんでした', e));
debugPanel.visible = new URLSearchParams(location.search).has('debug');

// 被弾したときに視界を赤くする
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
  phase: 'normal',      // 'normal' → 'warning' → 'boss' → 'clear' → 次のステージ
  phaseT: 0,
  stageT: 0,
  baseSpeed: SPEED.base,
  lives: LIVES,
  life: LIFE_MAX,
  lowLifeT: 0,
  nextExtend: EXTEND_EVERY,
  overT: 0,
  paused: false,
  factor: 1,            // アクセル/ブレーキの倍率
  ready: 0,             // 開始時の加速 (0..1)
  dist: 0,
  hits: 0,
  invuln: 0,
  msg: '', sub: '', msgT: 0,
  px: 0, py: 1, vx: 0, vy: 0,
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

function startPlay() {
  initAudio();
  Object.assign(S, {
    mode: 'play', paused: false, factor: 1, ready: 0, dist: 0, hits: 0, invuln: 0, px: 0, py: 1, vx: 0, vy: 0,
    stage: 1, phase: 'normal', phaseT: 0, stageT: 0, baseSpeed: SPEED.base, lives: LIVES, life: LIFE_MAX, lowLifeT: 0, nextExtend: EXTEND_EVERY, overT: 0,
  });
  setBGMMode(false);
  world.clear();
  world.applyTheme(0);
  combat.reset();
  avatar.recenter();
  avatar.destroyed = false;
  overlay.hidden = true;
  applyAudioSettings();
  setPaused(false);
  stopBGM();
  startBGM();
  showMsg('GET READY!', '', READY_TIME);
  say('Get ready!');
}

function togglePause(p) {
  S.paused = p;
  setPaused(p);
}

function toTitle() {
  S.mode = 'title';
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
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    let type = 'local-floor';
    try { await session.requestReferenceSpace('local-floor'); } catch (_) { type = 'local'; }
    renderer.xr.setReferenceSpaceType(type);
    S.refSpace = type;
    S.floorOffset = type === 'local' ? 1.6 : 0;
    session.addEventListener('end', onSessionEnd);
    await renderer.xr.setSession(session);
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

function movePlayer(dt, a) {
  const ox = S.px, oy = S.py;
  if (a.abs && !renderer.xr.isPresenting) {
    // マウス: 画面上の位置へ機体が寄っていく (原作のような操作感)
    const k = 1 - Math.exp(-dt * 5);
    S.px += (a.abs.x * X_LIMIT - S.px) * k;
    S.py += ((a.abs.y * 0.5 + 0.5) * Y_MAX - S.py) * k;
  } else {
    // スティック: 速度を滑らかに変える (急に動き出すと VR で酔いやすい)
    const k = 1 - Math.exp(-dt * 8);
    const my = settings.invertY ? -a.move.y : a.move.y; // 上下反転 (操縦桿のように、前に倒すと下がる)
    S.vx += (a.move.x * MOVE_X - S.vx) * k;
    S.vy += (my * MOVE_Y - S.vy) * k;
    S.px += S.vx * dt;
    S.py += S.vy * dt;
  }
  S.px = clamp(S.px, -X_LIMIT, X_LIMIT);
  S.py = clamp(S.py, 0, Y_MAX);
  S.vx = (S.px - ox) / dt;
  S.vy = (S.py - oy) / dt;
}

function nextStage() {
  S.stage++;
  combat.level = S.stage;
  world.applyTheme(S.stage - 1);
  S.baseSpeed = Math.min(60, SPEED.base + (S.stage - 1) * 4);
  S.phase = 'normal';
  S.stageT = 0;
  showMsg(`STAGE ${S.stage}`, THEMES[(S.stage - 1) % THEMES.length].name, 2.5);
  say(`Stage ${S.stage}`);
}

// ステージの進行: 通常 → WARNING → ボス → STAGE CLEAR → 次のステージ
function updateStage(dt) {
  S.stageT += dt;
  S.phaseT += dt;
  if (S.phase === 'normal' && S.stageT > STAGE_LEN) {
    S.phase = 'warning';
    S.phaseT = 0;
    showMsg('WARNING!!', '巨大な敵が接近中', 3.5);
    sfx.warning();
  } else if (S.phase === 'warning' && S.phaseT > 3.5) {
    S.phase = 'boss';
    S.phaseT = 0;
    combat.spawnBoss();
    setBGMMode(true);
  } else if (S.phase === 'boss' && combat.bossDefeated) {
    combat.bossDefeated = false;
    S.phase = 'clear';
    S.phaseT = 0;
    showMsg('STAGE CLEAR!', `BOSS BONUS ${10000 * S.stage}`, 4.5);
    sfx.clear();
    setBGMMode(false);
  } else if (S.phase === 'clear' && S.phaseT > 5) {
    nextStage();
  }
  // 点数が一定を超えるごとに残機を増やす
  if (combat.score >= S.nextExtend) {
    S.nextExtend += EXTEND_EVERY;
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

function gameOver() {
  S.mode = 'over';
  S.overT = 0;
  S.boomT = 0;
  avatar.destroyed = true;
  playerExplosion(true);
  S.paused = false;
  setBGMMode(false);
  stopBGM();
  if (combat.score > hiScore) {
    hiScore = combat.score;
    try { localStorage.setItem('skyrunner.hi', String(hiScore)); } catch (_) { /* 保存不可 */ }
  }
  showMsg('GAME OVER', `SCORE ${combat.score}   HI ${hiScore}`, Infinity);
  say('Game over');
}

// damage: 減らすライフの量
function onHit(damage) {
  if (S.invuln > 0 || S.mode !== 'play') return;
  S.hits++;
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
  S.factor = Math.min(S.factor, 0.75);
  flash.material.opacity = 0.8;
  sfx.damage();
  sfx.explode(true);
  input.rumble(1.0, 500);
  playerExplosion(true);
  showMsg('MISS!', `残機 ${S.lives}`, 2);
}

function onPickup(type) {
  if (type !== 'heal') return;
  if (S.life >= LIFE_MAX) {
    combat.score += 2000;
    showMsg('LIFE FULL', 'BONUS 2000', 1.2);
  } else {
    S.life = Math.min(LIFE_MAX, S.life + HEAL);
    showMsg('RECOVER!', `LIFE +${HEAL}`, 1.2);
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

const RETRY_HINT = {
  xr: 'トリガー: もう一度   A: タイトルへ',
  pad: 'A / START: もう一度   B: タイトルへ',
  kb: 'Space / Enter: もう一度   Backspace: タイトルへ',
  mouse: 'クリック: もう一度   Backspace: タイトルへ',
};

// ---- 照準と射撃
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
  const humanVR = presenting && kind === 'human' && view === '1st';
  camera.getWorldPosition(eyeW);

  // ロックオンの向き: VR は視線 (人間の一人称は右手のコントローラー)、デスクトップは正面
  if (presenting) {
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
  let guns = [], firing = a.fire;
  if (humanVR) {
    a.handFire.forEach((h, i) => { if (h.fire) guns.push(controllerRay(h.controller, handAims[i % 2])); });
    firing = firing || guns.length > 0;
    if (!guns.length && a.fire) guns = [{ origin: eyeW, aimOrigin, aimDir }];
  } else {
    firing = firing || a.handFire.some((h) => h.fire);
    guns = avatar.muzzles(kind).map((p) => ({ origin: p, aimOrigin, aimDir }));
    if (!guns.length) guns = [{ origin: eyeW, aimOrigin, aimDir }];
  }

  const layer = presenting ? renderer.xr.getBaseLayer?.() : null;
  const halfHeight = (layer?.framebufferHeight ?? renderer.getDrawingBufferSize(_v2).y) / 2;

  combat.update({
    dt, scroll: speed, world,
    spawn: S.mode === 'play' && S.ready >= 1 && S.phase === 'normal',
    active: S.mode === 'play' && S.ready >= 1 && S.phase !== 'clear',
    player: P, playerR: avatar.radius, eye: eyeW,
    aimOrigin, aimDir, guns, firing,
    missile: a.missile, missileOrigin: avatar.center(kind, missileOrigin),
    showAim: !humanVR, halfHeight,
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
    if (a.confirm && a.source === 'pad' && !renderer.xr.isPresenting) startPlay();
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
    if (S.overT > 2) {
      if (a.back) toTitle();
      else if (a.confirm) startPlay();
    }
  } else {
    if (a.pause) togglePause(!S.paused);
    else if (S.paused && a.back) toTitle();
    else if (S.paused && a.confirm) togglePause(false);

    if (S.paused) {
      speed = 0;
      running = false;
    } else {
      if (a.view) {
        settings.view = settings.view === '1st' ? '3rd' : '1st';
        saveSettings();
        showMsg(settings.view === '1st' ? 'VIEW: 1ST PERSON' : 'VIEW: 3RD PERSON', '', 1.2);
        avatar.recenter();
      }
      if (a.recenter) {
        avatar.recenter();
        showMsg('RECENTER', '', 0.8);
      }

      if (Math.abs(a.throttle) > 0.01) S.factor += a.throttle * SPEED.accel * dt;
      else if (settings.autoReturn) S.factor = approach(S.factor, 1, SPEED.ret * dt);
      S.factor = clamp(S.factor, SPEED.min, SPEED.max);

      S.ready = Math.min(1, S.ready + dt / READY_TIME);
      speed = S.baseSpeed * S.factor * ease(S.ready);
      combat.mult = 1 + Math.max(0, S.factor - 1) * 2; // 1.5 倍速でスコア 2 倍
      updateStage(dt);
      movePlayer(dt, a);
      S.dist += speed * dt;
      S.invuln -= dt;
    }
  }

  rig.position.set(S.px, S.py + S.floorOffset, 0);
  const play = S.mode === 'play';
  const inGame = play || S.mode === 'over';
  avatar.update(dt, {
    kind: settings.player, view: inGame ? settings.view : '3rd',
    vx: S.vx, vy: S.vy, thrust: inGame ? speed / SPEED.base : 0.3, presenting: renderer.xr.isPresenting,
  });
  P.copy(avatar.hitPoint);
  world.update(dt, speed, P, running);

  if (play && running && S.invuln <= 0 && world.hitTest(P, avatar.radius)) onHit(OBSTACLE_DAMAGE);
  // ライフが少ないときは警告音
  if (play && running && S.life < LIFE_MAX * 0.3 && (S.lowLifeT -= dt) <= 0) {
    S.lowLifeT = 1.2;
    sfx.lowLife();
  }
  if (play && running) updateCombat(dt, speed, a);
  if (combat.announce) {
    showMsg(combat.announce, '', 2);
    say(combat.announce.toLowerCase().replace('!', ''));
    combat.announce = '';
  }
  else if (S.mode === 'over') updateCombat(dt, speed, { ...a, fire: false, handFire: [], missile: false }); // 爆発や煙の続きを見せる

  flash.material.opacity = Math.max(0, flash.material.opacity - dt * 1.2);
  setEngine(S.mode === 'play' && running ? speed / SPEED.base : 0);

  // デスクトップのみ: 機体の傾きと速度による画角の変化 (VR ではカメラを動かさない)
  if (!renderer.xr.isPresenting) {
    // 爆発で画面を揺らす (デスクトップのみ)
    const shake = S.mode === 'over' ? Math.max(0, 1 - S.overT / 1.8) * 0.25 : 0;
    camera.position.set(THREE.MathUtils.randFloatSpread(shake), 1.6 + THREE.MathUtils.randFloatSpread(shake), 0);
    camera.rotation.z += (-S.vx * 0.012 - camera.rotation.z) * Math.min(1, dt * 6);
    const fov = 75 + (S.mode === 'play' ? (speed / SPEED.base - 1) * 14 : 0);
    if (Math.abs(fov - camera.fov) > 0.01) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    }
  }

  if (S.msgT > 0) {
    S.msgT -= dt;
    if (S.msgT <= 0) S.msg = S.sub = '';
  }

  hud.mesh.visible = inGame;
  // デスクトップでは HUD を画面いっぱいに広げる (VR では視野の中央に収める)
  hud.mesh.scale.setScalar(renderer.xr.isPresenting ? 1 : 1.7);
  hud.draw({
    play,
    dist: Math.floor(S.dist),
    hits: S.hits,
    factor: Math.round(S.factor * 100) / 100,
    kmh: Math.round(speed * 3.6),
    view: `${settings.player === 'ship' ? 'SHIP' : 'HUMAN'} ${settings.view.toUpperCase()}`,
    score: combat.score,
    missiles: combat.missileStock,
    missileMax: MISSILE_MAX,
    locks: combat.locks.length,
    msg: S.paused ? 'PAUSE' : S.msg,
    sub: S.paused ? (a.source === 'pad' ? 'START: 再開   B: タイトルへ' : a.source === 'xr' ? 'X/トリガー: 再開   A: タイトルへ' : 'Esc/クリック: 再開   Backspace: タイトルへ') : S.sub,
    hint: S.paused ? buildInfo : play ? HINTS[a.source] : S.mode === 'over' && S.overT > 2 ? RETRY_HINT[a.source] : '',
    lives: S.lives,
    life: Math.max(0, Math.round(S.life)),
    lifeMax: LIFE_MAX,
    blink: S.life < LIFE_MAX * 0.3 && Math.floor(performance.now() / 250) % 2 === 0,
    stage: S.stage,
    hi: Math.max(hiScore, combat.score),
    mult: Math.round(combat.mult * 10) / 10,
    boss: combat.bossRatio === null ? null : Math.round(combat.bossRatio * 100) / 100,
  });

  S.fps += (1 / Math.max(dt, 1e-4) - S.fps) * 0.05;
  debugPanel.draw(dt, { fps: S.fps, xr: renderer.xr.isPresenting, refSpace: S.refSpace, scale: settings.scale, version: buildInfo }, input);
}

// 開発用: 自動テストからすぐ撃墜させる
window.__debugPx = () => S.px;
window.__debugKill = () => { S.lives = 1; S.invuln = 0; onHit(999); };
// 開発用: 自動テストから状態を読む
window.__debugState = () => ({
  destroyed: avatar.destroyed, shipVisible: avatar.models.ship?.obj.visible, overT: S.overT, frame: renderer.info.render.frame, mode: S.mode, py: S.py, version: document.getElementById('version').textContent, phase: S.phase, stage: S.stage, lives: S.lives, boss: combat.bossRatio, ready: S.ready, score: combat.score, kills: combat.kills, enemies: combat.enemies.length,
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
const chkReturn = document.getElementById('autoReturn');
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
playerInputs.forEach((el) => el.addEventListener('change', () => setPlayer(el.value)));
selScale.value = String(settings.scale);
chkReturn.checked = settings.autoReturn;
for (const key of ['bgm', 'engine', 'invertY']) {
  const el = document.getElementById(key);
  el.checked = settings[key];
  el.addEventListener('change', () => { settings[key] = el.checked; saveSettings(); applyAudioSettings(); });
}
addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) showMsg(toggleMute() ? 'SOUND OFF' : 'SOUND ON', '', 1);
});
selScale.addEventListener('change', () => { settings.scale = Number(selScale.value); saveSettings(); });
chkReturn.addEventListener('change', () => { settings.autoReturn = chkReturn.checked; saveSettings(); });
btnDesk.addEventListener('click', startPlay);
btnVR.addEventListener('click', enterVR);
if (new URLSearchParams(location.search).has('play')) startPlay(); // 開発用: ?play ですぐ開始

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
    ? `パッド接続中: ${pads.map((p) => p.id.replace(/\s*\(.*\)/, '')).join(', ')}  (A / START で開始)`
    : 'パッドを使う場合は、接続してからいずれかのボタンを押してください。';
}, 500);
