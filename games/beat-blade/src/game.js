// ゲーム全体の進行（メニュー → プレイ → リザルト）と入力・描画の橋渡し
import * as THREE from 'three';
import { SONGS, sectionAt } from './core/songs.js';
import { generateBeatmap, DIFFICULTIES, DIFF_ORDER } from './core/beatmap.js';
import { PlaySession } from './core/session.js';
import { Autoplay } from './core/autoplay.js';
import { COLORS, HAND_Z, BLADE_TILT } from './core/config.js';
import { rankFor } from './core/scoring.js';
import { segmentDistance } from './core/slice.js';
import { Environment } from './scene/environment.js';
import { Saber } from './scene/saber.js';
import { ObjectViews } from './scene/objects.js';
import { Effects } from './scene/effects.js';
import { MenuPanel, PausePanel, ResultsPanel, Hud } from './scene/panels.js';

const DESKTOP_CAM = new THREE.Vector3(0, 1.45, 1.15);
const DESKTOP_TARGET = new THREE.Vector3(0, 1.15, -3);
const STORE = 'beatblade:';
const SIDE_COLORS = [COLORS.left, COLORS.right];

function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(STORE + key, JSON.stringify(value));
  } catch {
    // プライベートモード等では保存しない
  }
}

export class Game {
  constructor(renderer, audio) {
    this.renderer = renderer;
    this.audio = audio;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, (window.innerWidth || 16) / (window.innerHeight || 9), 0.05, 300);
    this.rig = new THREE.Group();
    this.rig.add(this.camera);
    this.scene.add(this.rig);
    this.resetDesktopCamera();
    this.fitCamera();
    this.camera.updateProjectionMatrix();

    this.env = new Environment(this.scene);
    // 壁に頭が入ったとき視界を赤くする
    this.vignette = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff1030, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false }),
    );
    this.vignette.renderOrder = 100;
    this.vignette.visible = false;
    this.camera.add(this.vignette);
    this.views = new ObjectViews(this.scene);
    this.effects = new Effects(this.scene, this.views);
    this.sabers = [new Saber(0, COLORS.left), new Saber(1, COLORS.right)];
    for (const s of this.sabers) {
      this.scene.add(s.root);
      this.scene.add(s.trail.mesh);
    }

    const saved = load('settings', {});
    this.settings = {
      song: Number.isInteger(saved.song) && SONGS[saved.song] ? saved.song : 0,
      diff: DIFF_ORDER.includes(saved.diff) ? saved.diff : 'normal',
      autoplay: !!saved.autoplay,
      noFail: !!saved.noFail,
    };
    this.menu = new MenuPanel(this.settings, (id, d) => this.getBest(id, d));
    this.pausePanel = new PausePanel();
    this.results = new ResultsPanel();
    this.hud = new Hud();
    this.panels = [this.menu, this.pausePanel, this.results];
    this.ui = new THREE.Group();
    for (const p of this.panels) this.ui.add(p.mesh);
    this.scene.add(this.ui, this.hud.group);

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(0, 0);
    this.mouseInside = false;
    this.tmp = new THREE.Vector3();
    this.controllers = [];
    this.setupXR();
    this.setupDesktop();

    this.clock = new THREE.Clock();
    this.idleTime = 0;
    this.state = 'menu';
    this.session = null;
    this.placeUI();
    this.showMenu();
  }

  // ---------- 入力 ----------

  setupXR() {
    const xr = this.renderer.xr;
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    for (let i = 0; i < 2; i++) {
      const c = xr.getController(i);
      c.userData = { handedness: null, gamepad: null, hover: null, pressed: [] };
      c.addEventListener('connected', (e) => {
        c.userData.handedness = e.data.handedness;
        c.userData.gamepad = e.data.gamepad || null;
      });
      c.addEventListener('disconnected', () => {
        c.userData.handedness = null;
        c.userData.gamepad = null;
      });
      c.addEventListener('selectstart', () => this.onSelect(c));
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
      line.scale.z = 3;
      c.add(line);
      c.userData.line = line;
      this.rig.add(c);
      this.controllers.push(c);
    }
    xr.addEventListener('sessionstart', () => {
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, 0, 0);
      this.placeUI();
      const session = xr.getSession();
      session?.addEventListener('visibilitychange', () => {
        if (session.visibilityState !== 'visible' && this.state === 'playing') this.pause();
      });
      for (const s of this.sabers) s.reset();
    });
    xr.addEventListener('sessionend', () => {
      this.resetDesktopCamera();
      this.placeUI();
      if (this.state === 'playing') this.pause();
      for (const s of this.sabers) s.reset();
    });
  }

  setupDesktop() {
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.mouseInside = true;
    });
    el.addEventListener('pointerleave', () => { this.mouseInside = false; });
    el.addEventListener('pointerdown', (e) => {
      this.audio.init();
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      if (this.state === 'playing') return;
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const hit = this.pickPanel(this.raycaster);
      if (hit?.button) this.onPanelClick(hit.panel, hit.button.id);
    });
    window.addEventListener('keydown', (e) => {
      this.audio.init();
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
      } else if (e.code === 'Enter' || e.code === 'Space') {
        if (this.state === 'menu' || this.state === 'results') this.startSong();
        else if (this.state === 'paused') this.resume();
        e.preventDefault();
      } else if (e.code === 'KeyR' && this.state !== 'menu') {
        this.startSong();
      } else if (e.code === 'KeyM' && this.state !== 'playing') {
        this.showMenu();
      }
    });
    window.addEventListener('resize', () => this.resize());
    // タブが隠れると描画が止まり音だけ進むので、自動でポーズする
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.state === 'playing' && !this.xrOn) this.pause();
    });
  }

  resize() {
    // 最小化や非表示でサイズが 0 になると投影行列が壊れるので無視する
    if (!window.innerWidth || !window.innerHeight) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.fitCamera();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // 縦長の画面でも横方向が見切れないよう、水平視野角を最低 72° に保つ
  fitCamera() {
    const minH = THREE.MathUtils.degToRad(72);
    const v = 2 * Math.atan(Math.tan(minH / 2) / this.camera.aspect);
    this.camera.fov = Math.max(70, THREE.MathUtils.radToDeg(v));
  }

  get xrOn() {
    return this.renderer.xr.isPresenting;
  }

  controllerFor(color) {
    const hand = color === 0 ? 'left' : 'right';
    return this.controllers.find((c) => c.userData.handedness === hand) || null;
  }

  haptic(color, intensity, ms) {
    if (!this.xrOn) return;
    const gp = this.controllerFor(color)?.userData.gamepad;
    const act = gp?.hapticActuators?.[0];
    try {
      if (act?.pulse) act.pulse(intensity, ms);
      else gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: intensity });
    } catch {
      // 非対応の環境では無視
    }
  }

  // VR のコントローラーボタン（A/B/X/Y）でポーズ
  pollButtons() {
    if (!this.xrOn) return;
    for (const c of this.controllers) {
      const gp = c.userData.gamepad;
      if (!gp) continue;
      for (const bi of [4, 5]) {
        const down = !!gp.buttons[bi]?.pressed;
        if (down && !c.userData.pressed[bi]) {
          if (this.state === 'playing') this.pause();
          else if (this.state === 'paused') this.resume();
        }
        c.userData.pressed[bi] = down;
      }
    }
  }

  pickPanel(raycaster) {
    const meshes = this.panels.filter((p) => p.visible).map((p) => p.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length || !hits[0].uv) return null;
    const panel = hits[0].object.userData.panel;
    const button = panel.buttonAtUV(hits[0].uv);
    return { panel, button, distance: hits[0].distance };
  }

  updatePointers() {
    const hovers = new Map();
    const showLines = this.xrOn && this.state !== 'playing';
    for (const c of this.controllers) {
      c.userData.line.visible = showLines && !!c.userData.handedness;
      c.userData.hover = null;
      if (!showLines || !c.userData.handedness) continue;
      this.raycaster.setFromXRController(c);
      const hit = this.pickPanel(this.raycaster);
      c.userData.line.scale.z = hit ? hit.distance : 3;
      if (hit?.button) {
        c.userData.hover = hit;
        hovers.set(hit.panel, hit.button.id);
      }
    }
    if (!this.xrOn && this.mouseInside && this.state !== 'playing') {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const hit = this.pickPanel(this.raycaster);
      if (hit?.button) hovers.set(hit.panel, hit.button.id);
      this.renderer.domElement.style.cursor = hit?.button ? 'pointer' : 'default';
    }
    for (const p of this.panels) if (p.visible) p.setHover(hovers.get(p) || null);
  }

  onSelect(c) {
    this.audio.init();
    if (this.state === 'playing') return;
    const h = c.userData.hover;
    if (h?.button) {
      this.onPanelClick(h.panel, h.button.id);
      this.haptic(c.userData.handedness === 'left' ? 0 : 1, 0.3, 20);
    }
  }

  onPanelClick(panel, id) {
    if (!id) return;
    this.audio.click();
    if (panel === this.menu) {
      const s = this.settings;
      if (id.startsWith('song:')) s.song = Number(id.slice(5));
      else if (id.startsWith('diff:')) s.diff = id.slice(5);
      else if (id === 'opt:autoplay') s.autoplay = !s.autoplay;
      else if (id === 'opt:nofail') s.noFail = !s.noFail;
      else if (id === 'play') return this.startSong();
      else if (id === 'exit') return this.exitToLauncher();
      save('settings', s);
      this.menu.redraw();
    } else if (panel === this.pausePanel) {
      if (id === 'resume') this.resume();
      else if (id === 'restart') this.startSong();
      else if (id === 'menu') this.showMenu();
    } else if (panel === this.results) {
      if (id === 'retry') this.startSong();
      else if (id === 'menu') this.showMenu();
    }
  }

  // ---------- 状態遷移 ----------

  // ゲーム選択画面へ戻る（VR 中ならセッションを終えてから）
  exitToLauncher() {
    const go = () => { location.href = '../../'; };
    const session = this.renderer.xr.getSession();
    if (session) session.end().then(go, go);
    else go();
  }

  resetDesktopCamera() {
    this.camera.position.copy(DESKTOP_CAM);
    this.camera.lookAt(DESKTOP_TARGET);
  }

  placeUI() {
    if (this.xrOn) {
      this.ui.position.set(0, 1.45, -2.1);
      this.ui.rotation.set(0, 0, 0);
    } else {
      this.ui.position.set(0, 1.32, -0.75);
      this.ui.lookAt(DESKTOP_CAM);
    }
  }

  showPanel(panel) {
    for (const p of this.panels) p.visible = p === panel;
    if (panel) {
      panel.hoverId = null;
      panel.redraw();
    }
  }

  getBest(songId, diff) {
    const b = load(`best:${songId}:${diff}`, null);
    // 壊れた記録は無視する
    if (!b || !Number.isFinite(b.score) || typeof b.rank !== 'string') return null;
    return b;
  }

  showMenu() {
    this.audio.stop();
    this.clearObjects();
    this.session = null;
    this.state = 'menu';
    this.hud.visible = false;
    this.showPanel(this.menu);
  }

  startSong() {
    this.audio.init();
    const song = SONGS[this.settings.song];
    const map = generateBeatmap(song, this.settings.diff);
    this.clearObjects();
    let h = 0;
    if (this.xrOn) {
      const head = this.camera.getWorldPosition(this.tmp);
      if (head.y > 0.5) h = Math.min(0.2, Math.max(-0.25, (head.y - 1.65) * 0.5));
    }
    this.map = map;
    this.song = song;
    this.session = new PlaySession(map, { heightOffset: h, noFail: this.settings.noFail });
    this.autoplay = this.settings.autoplay ? new Autoplay(map, h) : null;
    // デスクトップでは頭を動かせないので、壁を避ける体の傾きは常に自動で行う
    this.guide = this.autoplay || new Autoplay(map, h);
    this.lastSongT = null;
    this.wallBuzz = 0;
    this.audio.playSong(song);
    this.state = 'playing';
    this.showPanel(null);
    this.hud.visible = true;
    this.hud.key = '';
    for (const s of this.sabers) s.reset();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.pause();
    this.showPanel(this.pausePanel);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.audio.init();
    this.audio.resume();
    this.state = 'playing';
    this.showPanel(null);
    for (const s of this.sabers) s.reset();
  }

  finish(failed) {
    const sc = this.session.score;
    this.audio.stop();
    if (failed) this.audio.fail();
    this.clearObjects();
    const acc = sc.finalAccuracy;
    const data = {
      song: this.song,
      diffName: DIFFICULTIES[this.settings.diff].name,
      autoplay: !!this.autoplay,
      failed,
      score: sc.score,
      accuracy: acc,
      rank: failed ? 'E' : rankFor(acc),
      maxCombo: sc.maxCombo,
      hits: sc.hits,
      total: sc.totalNotes,
      misses: sc.misses,
      badCuts: sc.badCuts,
      newBest: false,
    };
    if (!failed && !this.autoplay && Number.isFinite(sc.score) && sc.score > 0) {
      const key = `best:${this.song.id}:${this.settings.diff}`;
      const best = this.getBest(this.song.id, this.settings.diff);
      if (!best || sc.score > best.score) {
        save(key, { score: sc.score, rank: data.rank, acc });
        data.newBest = true;
      }
    }
    this.lastResult = data;
    this.results.data = data;
    this.state = 'results';
    this.hud.visible = false;
    this.showPanel(this.results);
  }

  clearObjects() {
    if (!this.xrOn) this.resetDesktopCamera();
    this.vignette.visible = false;
    this.vignette.material.opacity = 0;
    const s = this.session;
    if (s) {
      for (const a of [...s.notes, ...s.bombs, ...s.walls]) {
        this.views.release(a.view);
        a.view = null;
      }
    }
    this.effects.clear();
  }

  // ---------- 刀の取り付け先 ----------

  updateSabers(t) {
    const playing = this.state === 'playing' || this.state === 'paused';
    for (const saber of this.sabers) {
      let parent = this.scene;
      let mode = 'none';
      if (playing && this.autoplay) mode = 'auto';
      else if (this.xrOn) {
        const c = this.controllerFor(saber.color);
        if (c) { parent = c; mode = 'controller'; }
      } else if (playing && saber.color === 1) mode = 'mouse';

      if (saber.root.parent !== parent) {
        parent.add(saber.root);
        saber.root.position.set(0, 0, 0);
        saber.root.rotation.set(0, 0, 0);
        saber.reset();
      }
      saber.mode = mode;
      saber.anyColor = mode === 'mouse';
      saber.setVisible(playing && mode !== 'none');

      if (mode === 'auto') {
        const p = this.autoplay.handPos(saber.color, t);
        saber.root.position.set(p.x, p.y, p.z);
        saber.root.rotation.set(BLADE_TILT, 0, 0);
      } else if (mode === 'mouse') {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const { origin, direction } = this.raycaster.ray;
        const k = (HAND_Z - origin.z) / direction.z;
        if (!Number.isFinite(k)) continue;
        const x = THREE.MathUtils.clamp(origin.x + direction.x * k, -1.6, 1.6);
        const y = THREE.MathUtils.clamp(origin.y + direction.y * k, 0.2, 2.4);
        saber.root.position.set(x, y, HAND_Z);
        saber.root.rotation.set(BLADE_TILT, 0, 0);
      }
    }
  }

  // ---------- メインループ ----------

  // dtOverride はテストで時間を手動で進めるとき用
  update(dtOverride) {
    const real = Math.min(this.clock.getDelta(), 0.1);
    const dt = dtOverride ?? real;
    this.audio.update();
    if (this.state === 'playing') {
      this.updatePlaying(dt);
    } else {
      this.idleTime += dt;
      this.updateSabers(this.audio.lastTime);
      for (const s of this.sabers) if (s.root.visible) s.sample(dt);
      const energy = this.state === 'paused' ? 0.15 : 0.3;
      this.env.update(dt, this.idleTime, 96, energy);
    }
    this.updatePointers();
    this.effects.update(dt);
    this.pollButtons();
  }

  updatePlaying(dt) {
    const t = this.audio.songTime();
    const sdt = this.lastSongT == null ? dt : t - this.lastSongT;
    this.lastSongT = t;
    this.updateSabers(t);
    const active = [];
    for (const s of this.sabers) {
      if (!s.root.visible) continue;
      s.sample(sdt > 1e-4 ? sdt : dt);
      active.push(s);
    }

    let head;
    if (this.xrOn) head = this.camera.getWorldPosition(this.tmp);
    else {
      head = { x: this.guide.headOffsetX(t), y: 1.6, z: 0 };
      this.camera.position.x = DESKTOP_CAM.x + head.x * 0.6;
    }

    if (active.length === 2) this.checkClash(dt);

    const session = this.session;
    const events = session.step(t, active, head);
    for (const e of events) this.handleEvent(e);

    for (const a of session.notes) {
      a.view.position.set(a.pose.x, a.pose.y, a.pose.z);
      a.view.rotation.set(0, 0, a.pose.angle);
    }
    for (const a of session.bombs) {
      a.view.position.set(a.pose.x, a.pose.y, a.pose.z);
      a.view.rotation.set(t * 1.3, t * 0.9, 0);
    }
    for (const a of session.walls) {
      const b = a.box;
      a.view.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
    }
    const vm = this.vignette.material;
    vm.opacity += ((session.inWall ? 0.45 : 0) - vm.opacity) * Math.min(1, dt * 12);
    this.vignette.visible = vm.opacity > 0.01;
    if (session.inWall) {
      this.wallBuzz -= dt;
      if (this.wallBuzz <= 0) {
        this.haptic(0, 0.5, 60);
        this.haptic(1, 0.5, 60);
        this.wallBuzz = 0.1;
      }
    }

    const bar = Math.max(0, Math.floor((t * this.song.bpm) / 240));
    this.env.update(dt, t, this.song.bpm, t < 0 ? 0.2 : sectionAt(this.song, bar).energy);
    this.hud.update(session.score, Math.max(0, t), this.map.duration);

    if (session.score.failed) this.finish(true);
    else if (t > this.map.duration + 0.3 && session.done) this.finish(false);
  }

  // 左右の刀が触れ合ったら火花と振動
  checkClash(dt) {
    const [a, b] = this.sabers;
    const c = segmentDistance(a.hilt, a.tip, b.hilt, b.tip);
    this.clashCool = (this.clashCool || 0) - dt;
    if (c.dist < 0.05 && this.clashCool <= 0) {
      this.effects.burst(c.point, 0xffffff, 8, null, 1.5);
      this.haptic(0, 0.25, 20);
      this.haptic(1, 0.25, 20);
      this.clashCool = 0.05;
    }
  }

  handleEvent(e) {
    const a = e.item;
    switch (e.type) {
      case 'spawn':
        if (e.kind === 'note') a.view = this.views.acquireNote(a.obj);
        else if (e.kind === 'bomb') a.view = this.views.acquireBomb();
        else a.view = this.views.acquireWall(a.obj, this.map.njs);
        break;
      case 'cut': {
        this.views.release(a.view);
        const c = a.obj.color;
        this.effects.slice(a.pose, e.contact.vel, c, SIDE_COLORS[c], this.map.njs);
        if (e.good) {
          const pts = e.judge.score.total;
          this.effects.popup(a.pose, `${pts}`, pts >= 110 ? '#ffffff' : pts >= 100 ? '#d8e6ff' : '#a9b4c8');
          this.audio.slice(a.pose.x, pts / 115);
          this.haptic(e.saber.color, 0.55, 35);
          this.env.pulse(0.35);
        } else {
          this.effects.popup(a.pose, e.judge.reason === 'color' ? 'WRONG' : 'BAD', '#ff5a6a');
          this.audio.bad(a.pose.x);
          this.haptic(e.saber.color, 0.9, 80);
        }
        break;
      }
      case 'miss':
        this.views.release(a.view);
        this.effects.popup({ x: a.pose.x, y: a.pose.y, z: -0.6 }, 'MISS', '#ff8a8a');
        this.audio.miss();
        break;
      case 'bomb':
        this.views.release(a.view);
        this.effects.explode(a.pose);
        this.audio.bomb(a.pose.x);
        this.haptic(e.saber.color, 1.0, 150);
        break;
      case 'despawn':
        this.views.release(a.view);
        break;
      case 'wallEnter':
        this.audio.bad(0);
        break;
      default:
        break;
    }
  }
}
