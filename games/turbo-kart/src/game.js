// ゲーム本体: メニュー → レース → リザルト。PC（追従 / コックピット視点）と VR（着座・コックピット）
import * as THREE from 'three';
import { buildTrack, pointAt } from './core/track.js';
import { TRACKS } from './core/tracks.js';
import { Race, NPC_NAMES, KART_COLORS } from './core/race.js';
import { forwardSpeed } from './core/physics.js';
import { FFBModel } from './core/ffbmodel.js';
import { buildWorld } from './scene/world.js';
import { KartModel } from './scene/kartmodel.js';
import { CarModel } from './scene/carmodel.js';
import { Hud, fmtTime } from './scene/hud.js';
import { KartAudio } from './audio.js';
import { Effects, driftTier } from './scene/fx.js';
import { createDriver, driveAI } from './core/ai.js';

const STEP = 1 / 120; // 物理の固定刻み

// ハンドルを中央へ戻す力。wheel: -1..1（右が正）、正の力は右へ回す
export function centeringForce(wheel, gain = 0.5) {
  const g = Math.max(0.2, gain);
  const pull = Math.max(-0.7, Math.min(0.7, -wheel * 1.6)) * g;
  return { constant: Math.abs(wheel) < 0.01 ? 0 : pull, damper: 0.45 * g, spring: 0.6 * g, rumble: 0, rumbleHz: 0 };
}

const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export class Game {
  constructor({ renderer, input, ffb, ui }) {
    this.renderer = renderer;
    this.input = input;
    this.ffb = ffb;
    this.ui = ui;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 1500);
    this.hud = new Hud(ui.hud);
    this.setTrack(TRACKS[0].id);
    this.ffbModel = new FFBModel();
    this.fx = new Effects(this.scene);
    this.audio = new KartAudio();
    this.clock = new THREE.Clock();
    this.acc = 0;
    this.state = 'menu';
    this.race = null;
    this.models = [];
    this.cameraMode = 'chase';
    // 自分のカートの細かい揺れをどれだけ画面に残すか（0 = 揺れなし）
    this.shake = 0.15;
    this.chase = { pos: new THREE.Vector3(), heading: 0, init: false };
    this.recenterAt = 0;
    this.lastCount = null;
    this.showAttract();
  }

  // コースを切り替える（地形・路面・装飾を作り直す）
  setTrack(id) {
    const def = TRACKS.find((t) => t.id === id) || TRACKS[0];
    if (this.trackId === def.id) return;
    if (this.race) this.clearRace();
    if (this.world) {
      this.scene.remove(this.world);
      this.world.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material) for (const m of [].concat(o.material)) { m.map?.dispose?.(); m.dispose?.(); }
      });
    }
    this.trackId = def.id;
    this.track = buildTrack(def);
    this.world = buildWorld(this.scene, this.track);
    this.hud.setTrack(this.track);
  }

  get xrOn() {
    return this.renderer.xr.isPresenting;
  }

  resize(w, h) {
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // メニューの背景: NPC だけのレースを流しておく
  showAttract() {
    this.startRace({ npcs: 8, laps: 99, level: 'normal', attract: true });
    this.state = 'menu';
  }

  clearRace() {
    for (const m of this.models) this.scene.remove(m.group);
    this.models = [];
    if (this.cockpit) this.cockpit.removeFromParent();
    this.race = null;
  }

  // opts: { npcs, laps, level, manual, attract, vehicle, track, online: { session, grid, seed, countdown } }
  startRace(opts) {
    if (opts.track) this.setTrack(opts.track);
    this.clearRace();
    this.opts = opts;
    const entries = [];
    const n = Math.max(0, Math.min(10, opts.npcs ?? 10));
    const on = opts.online;
    let playerIndex;
    if (on) {
      // オンライン: 参加者をグリッド順に、そのあと NPC（ホストだけが走らせ、他の人には位置を配る）
      on.grid.forEach((p, i) => entries.push({
        name: p.name, color: KART_COLORS[i % KART_COLORS.length], netId: p.id,
        type: p.id === on.session.self ? 'player' : 'remote',
      }));
      for (let i = 0; i < n; i++) {
        entries.push({ name: NPC_NAMES[i], color: KART_COLORS[(on.grid.length + i) % KART_COLORS.length], netId: `npc${i}`, type: on.session.isHost ? 'npc' : 'remote' });
      }
      playerIndex = entries.findIndex((e) => e.type === 'player');
    } else {
      for (let i = 0; i < n; i++) entries.push({ name: NPC_NAMES[i], color: KART_COLORS[(i + 1) % KART_COLORS.length], type: 'npc' });
      if (!opts.attract) entries.push({ name: 'YOU', color: KART_COLORS[0], type: 'player' });
      playerIndex = opts.attract ? -1 : entries.length - 1;
    }
    this.online = on ? on.session : null;
    this.netTimer = 0;
    this.race = new Race(this.track, entries, {
      laps: opts.laps ?? 3,
      vehicle: opts.vehicle || 'kart',
      level: opts.level ?? 'normal',
      seed: on ? on.seed : (Math.random() * 1e9) | 0,
      manual: opts.manual && playerIndex >= 0 ? [playerIndex] : [],
    });
    // オンラインはホストが決めたスタート時刻に合わせてカウントダウンを始める
    if (on) this.race.time = -Math.max(1, on.countdown);
    this.fx.clear();
    this.models = this.race.karts.map((e, i) => {
      const mo = { isPlayer: e.type === 'player', number: i + 1 };
      const v = opts.vehicle || 'kart';
      const m = v === 'kart' ? new KartModel(e.color, e.name, mo) : new CarModel(v, e.color, e.name, mo);
      this.scene.add(m.group);
      return m;
    });
    this.me = playerIndex >= 0 ? this.race.karts[playerIndex] : null;
    this.snapshot();
    this.acc = 0;
    this.lastCount = null;
    this.finishedShown = false;
    this.chase.init = false;
    this.chase.posInit = false;

    // コックピット（VR / PC の車載視点）の取り付け先
    const focus = this.me || this.race.karts[0];
    const model = this.models[focus.index];
    this.cockpit = new THREE.Group();
    this.cockpit.position.copy(model.eye);
    this.cockpit.rotation.y = -Math.PI / 2; // -Z をカートの前方 (+X) に向ける
    this.xrOffset = new THREE.Group();
    this.cockpit.add(this.xrOffset);
    model.group.add(this.cockpit);
    // VR 用のダッシュボードと案内パネル
    // ダッシュボードはハンドル中央（実車のカートと同じくハンドルと一緒に回る）
    this.hud.dash.mesh.position.set(-0.035, 0, 0);
    this.hud.dash.mesh.rotation.set(0, -Math.PI / 2, 0);
    this.hud.dash.mesh.scale.setScalar(0.5);
    model.steerWheel.add(this.hud.dash.mesh);
    this.hud.banner.mesh.position.set(0, 0.25, -3);
    this.cockpit.add(this.hud.banner.mesh);
    this.hud.dash.mesh.visible = this.hud.banner.mesh.visible = false;
    this.hud.bannerText = null;
    for (const m of this.models) m.setCockpit(false);
    if (this.me) this.models[this.me.index].setCockpit(this.cameraMode === 'cockpit' || this.xrOn);

    if (!opts.attract) {
      this.state = 'race';
      this.audio.init();
      this.ui.showScreen('race');
      this.hud.showBoard(this.race, null);
      this.recenterAt = performance.now() + 400;
    }
    this.attachCamera();
  }

  // 物理状態を補間用に保存
  snapshot() {
    for (const e of this.race.karts) {
      const k = e.kart;
      const r = e.ride || { y: 0, pitch: 0, roll: 0 };
      e.prevPose = e.pose || { x: k.x, z: k.z, heading: k.heading, y: r.y, pitch: r.pitch, roll: r.roll };
      e.pose = { x: k.x, z: k.z, heading: k.heading, y: r.y, pitch: r.pitch, roll: r.roll };
    }
  }

  attachCamera() {
    const cam = this.camera;
    cam.removeFromParent();
    cam.position.set(0, 0, 0);
    cam.rotation.set(0, 0, 0);
    if (this.xrOn || (this.me && this.cameraMode === 'cockpit')) {
      this.xrOffset.add(cam);
    } else {
      this.scene.add(cam);
    }
  }

  setCameraMode(mode) {
    this.cameraMode = mode;
    if (this.me) this.models[this.me.index].setCockpit(mode === 'cockpit' || this.xrOn);
    this.attachCamera();
  }

  onXRStart() {
    this.renderer.xr.getCamera();
    this.attachCamera();
    if (this.me) this.models[this.me.index].setCockpit(true);
    this.recenterAt = performance.now() + 500;
  }

  onXREnd() {
    this.xrOffset.position.set(0, 0, 0);
    this.xrOffset.rotation.set(0, 0, 0);
    this.attachCamera();
    if (this.state !== 'menu') this.toMenu();
  }

  // VR: いまの頭の位置と向きを運転席に合わせる
  recenter() {
    if (!this.xrOn) return;
    const cam = this.camera;
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    const yaw = e.y;
    this.xrOffset.rotation.set(0, -yaw, 0);
    const p = cam.position.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
    this.xrOffset.position.set(-p.x, -p.y, -p.z);
  }

  pause(on) {
    if (this.state !== 'race' && this.state !== 'paused') return;
    if (this.online) return; // オンライン中は止めない
    this.state = on ? 'paused' : 'race';
    this.ui.showPause(on);
    if (on) {
      this.ffb.stop();
      this.audio.silence();
    }
    this.clock.getDelta();
  }

  toMenu() {
    if (this.online) {
      // オンラインのレース後はロビーへ戻る
      const s = this.online;
      this.online = null;
      this.ffb.stop();
      this.audio.silence();
      this.hud.hide();
      this.showAttract();
      this.ui.showScreen('online');
      s.backToLobby();
      if (this.xrOn) this.renderer.xr.getSession()?.end();
      return;
    }
    this.ffb.stop();
    this.audio.silence();
    this.hud.hide();
    this.ui.showPause(false);
    this.ui.showScreen('menu');
    this.showAttract();
    if (this.xrOn) this.renderer.xr.getSession()?.end();
  }

  restart() {
    if (this.online) return this.toMenu(); // オンラインはロビーからホストが始める
    this.ui.showPause(false);
    this.startRace({ ...this.opts });
  }

  // ---------- 毎フレーム ----------

  // dtOverride はテストで時間を手動で進めるとき用
  update(dtOverride) {
    const real = Math.min(this.clock.getDelta(), 0.1);
    const dt = dtOverride ?? real;
    const inp = this.input.poll(dt);
    const racing = this.state === 'race';

    if (inp.pause) {
      if (this.state === 'race') this.pause(true);
      else if (this.state === 'paused') this.pause(false);
      else if (this.state === 'results') this.toMenu();
    }
    if (inp.confirm) {
      if (this.state === 'results') this.restart();
      else if (this.state === 'paused' && this.xrOn) this.toMenu();
    }
    if (inp.recenter) this.recenter();
    if (inp.camera && !this.xrOn && this.me) this.setCameraMode(this.cameraMode === 'chase' ? 'cockpit' : 'chase');
    if (inp.debug) this.showDebug = !this.showDebug;
    if (inp.ffbReset) this.ffb.reset();
    if (inp.shiftUp || inp.shiftDown) this.lastShiftInput = { up: inp.shiftUp, at: performance.now() };
    if (this.recenterAt && performance.now() > this.recenterAt && this.xrOn) {
      this.recenter();
      this.recenterAt = 0;
    }

    const race = this.race;
    const events = [];
    if (this.online && this.state !== 'menu') this.syncNet(dt);
    // 押した瞬間の入力は、物理の更新が来るまで保持する（高リフレッシュレートで取りこぼさない）
    if (inp.shiftUp) this.pendingUp = true;
    if (inp.shiftDown) this.pendingDown = true;
    if (this.state !== 'paused') {
      this.acc += dt;
      let first = true;
      let steps = 0;
      while (this.acc >= STEP && steps < 12) {
        this.snapshot();
        const inputs = new Map();
        if (this.me && racing) {
          if (this.autodrive) {
            // 確認用: プレイヤーも AI が運転する（?autodrive=1）
            this.autoDriver ||= createDriver(Math.random, 'hard');
            const others = race.karts.filter((o) => o !== this.me);
            inputs.set(this.me.index, driveAI(this.autoDriver, this.me.kart, this.me.loc, this.track, others, 1, STEP));
          } else {
            inputs.set(this.me.index, {
              steer: inp.steer, throttle: inp.throttle, brake: inp.brake, handbrake: inp.handbrake,
              shiftUp: first && !!this.pendingUp, shiftDown: first && !!this.pendingDown, hGear: inp.hGear,
              // ハンコンは補助なしの素の挙動、キーボード・ゲームパッドは操作補助あり
              assist: inp.source !== 'wheel',
              stability: this.input.config.stability !== false,
            });
            if (first) this.pendingUp = this.pendingDown = false;
          }
        }
        race.step(STEP, inputs);
        if (this.me) events.push(...this.me.events);
        this.acc -= STEP;
        first = false;
        steps++;
      }
      if (steps >= 12) this.acc = 0;
    }
    const alpha = this.state === 'paused' ? 1 : this.acc / STEP;

    // 描画位置
    race.karts.forEach((e, i) => {
      const a = e.prevPose, b = e.pose;
      const pose = {
        x: lerp(a.x, b.x, alpha), z: lerp(a.z, b.z, alpha), heading: lerpAngle(a.heading, b.heading, alpha),
        y: lerp(a.y, b.y, alpha), pitch: lerp(a.pitch, b.pitch, alpha), roll: lerp(a.roll, b.roll, alpha),
      };
      // サスペンション: 車体の姿勢をならして細かい凹凸を吸収する（坂・バンク・うねりは残る）
      const v = (e.vis ||= { y: pose.y, pitch: pose.pitch, roll: pose.roll });
      const mine = e === this.me;
      const k = 1 - Math.exp(-dt / (mine ? 0.18 : 0.1));
      v.y += (pose.y - v.y) * k;
      v.pitch += (pose.pitch - v.pitch) * k;
      v.roll += (pose.roll - v.roll) * k;
      const keep = mine ? this.shake : 0.3;
      pose.y = v.y + (pose.y - v.y) * keep;
      pose.pitch = v.pitch + (pose.pitch - v.pitch) * keep;
      pose.roll = v.roll + (pose.roll - v.roll) * keep;
      // G による車体の傾き: 旋回で外側へロール、ブレーキで前に沈み、加速で後ろに沈む
      const g = (e.gfx ||= { roll: 0, pitch: 0 });
      const kk = 1 - Math.exp(-dt / 0.12);
      g.roll += (Math.max(-0.1, Math.min(0.1, (e.kart.lateralAccel || 0) * 0.0035)) - g.roll) * kk;
      g.pitch += (Math.max(-0.07, Math.min(0.07, (e.kart.longAccel || 0) * 0.0035)) - g.pitch) * kk;
      pose.roll += g.roll;
      pose.pitch += g.pitch;
      e.renderPose = pose;
      // 自分で運転しているときはハンコンの実際の回転角、それ以外（NPC・自動運転・ゴール後）は操作量
      const manualDriving = e === this.me && !this.autodrive && !e.finished && this.state === 'race';
      const steer = manualDriving ? inp.wheel.value : e.input.steer || 0;
      this.models[i].update(pose, e.kart, steer, dt, this.input.config.steer.lockDeg);
    });

    // 火花・土煙
    race.karts.forEach((e, i) => {
      const m = this.models[i];
      m.group.updateMatrixWorld();
      this.fx.kart(m, e.kart, Math.abs(forwardSpeed(e.kart)), dt);
      if (e.kart.driftTime > 0) e.lastTier = driftTier(e.kart.driftTime);
      for (const ev of e.events) if (ev.type === 'miniTurbo') this.fx.burst(m, e.lastTier || 1);
    });
    this.fx.update(dt);

    this.updateCamera(dt);

    if (this.me && this.state !== 'menu') {
      const me = this.me;
      for (const ev of events) {
        if (ev.type === 'lap') me.lapFlash = 2;
        if (ev.type === 'wall' || (ev.type === 'bump' && ev.strength > 1)) this.audio.thump(ev.strength);
        if (ev.type === 'boostPad' || ev.type === 'miniTurbo') this.audio.whoosh();
      }
      if (me.lapFlash > 0) me.lapFlash -= dt;
      // カウントダウンの音
      if (race.state === 'countdown') {
        const n = Math.ceil(-race.time);
        if (n !== this.lastCount && n <= 3) { this.audio.beep(false); this.lastCount = n; }
      } else if (this.lastCount !== 0) {
        this.audio.beep(true);
        this.lastCount = 0;
      }
      const vr = this.xrOn;
      this.hud.dash.mesh.visible = vr || this.cameraMode === 'cockpit';
      this.hud.banner.mesh.visible = vr;
      this.hud.update(race, me, { vr, manual: me.manual, dt });

      // FFB
      if (this.state === 'race' && race.state === 'countdown') {
        // スタート前はハンドルを中央へ戻す（角度に比例して引き戻し、ダンパーで揺れを抑える）
        this.ffb.update(centeringForce(inp.wheel.value, this.ffb.settings.gain));
      } else if (this.state === 'race' && !me.finished) {
        const out = this.ffbModel.compute(me.kart, inp.wheel, events, this.ffb.settings, dt, me.ride, me.prevRide, STEP);
        this.ffb.update(out);
      } else if (this.state !== 'paused') {
        this.ffb.update({ constant: 0, damper: 0.2 * this.ffb.settings.gain, spring: 0.3 * this.ffb.settings.gain, rumble: 0, rumbleHz: 0 });
      }
      this.audio.update(me.kart, Math.abs(forwardSpeed(me.kart)), me.input.throttle || 0, this.state === 'race' || this.state === 'results', this.opts.vehicle || 'kart');
      this.updateDebug(inp);
      this.ui.ffbStatus?.(this.ffb.describe());

      if (me.finished && !this.finishedShown) {
        this.finishedShown = true;
        this.state = 'results';
        this.ui.showResults(true);
      }
      if (this.state === 'results') this.hud.showBoard(race, this.boardHtml());
    }
  }

  // オンライン: 受け取った走行データを反映し、自分（とホストは NPC）の走行データを送る
  syncNet(dt) {
    const s = this.online;
    const race = this.race;
    const now = performance.now();
    const byId = new Map(race.karts.filter((e) => e.netId).map((e) => [e.netId, e]));
    for (const [id, m] of s.remote) {
      const e = byId.get(id);
      if (e && e.type === 'remote') e.net = { ...m, age: (now - m.recv) / 1000 };
    }
    if (s.npcState && !s.isHost) {
      const age = (now - s.npcState.recv) / 1000;
      for (const m of s.npcState.list) {
        const e = byId.get(m.id);
        if (e && e.type === 'remote') e.net = { ...m, age };
      }
    }
    const pack = (e) => {
      const k = e.kart;
      return {
        id: e.netId, x: +k.x.toFixed(2), z: +k.z.toFixed(2), h: +k.heading.toFixed(4), vx: +k.vx.toFixed(2), vz: +k.vz.toFixed(2),
        yaw: +k.yawRate.toFixed(3), sa: +k.steerAngle.toFixed(3), st: +(e.input.steer || 0).toFixed(2), th: +(e.input.throttle || 0).toFixed(2),
        g: k.gear, b: +k.boost.toFixed(2), dr: +(k.driftTime || 0).toFixed(2), hb: +(k.handbrakeInput || 0).toFixed(2),
        lap: e.lap, sd: e.started ? 1 : 0, f: e.finished ? 1 : 0, ft: e.finishTime, bl: e.bestLap,
      };
    };
    this.netTimer += dt;
    if (this.netTimer >= 0.05) {
      this.netTimer = 0;
      if (this.me) s.sendState(pack(this.me));
      this.npcTick = (this.npcTick || 0) + 1;
      if (s.isHost && this.npcTick % 2 === 0) s.sendNpcs(race.karts.filter((e) => e.type === 'npc').map(pack));
    }
  }

  // I キーで入力の状態を表示（パドルなどが届いているかの確認用）
  updateDebug(inp) {
    const el = this.ui.debug;
    if (!el) return;
    el.hidden = !this.showDebug;
    if (!this.showDebug) return;
    const B = this.input.config.bindings;
    const k = this.me.kart;
    const ago = this.lastShiftInput ? `${((performance.now() - this.lastShiftInput.at) / 1000).toFixed(1)} 秒前 (${this.lastShiftInput.up ? '↑' : '↓'})` : 'なし';
    const bind = (a) => (B[a] ? `${B[a].pad} の ${B[a].kind === 'button' ? 'ボタン' : '軸'} ${B[a].control}` : '未割り当て');
    el.textContent = [
      `変速: ${this.me.manual ? 'MT' : 'AT'}  ギア: ${k.gear}  H シフター: ${inp.hGear ?? '未使用'}`,
      `シフトアップ押下中: ${inp.shiftUpHeld ? 'はい' : 'いいえ'}  シフトダウン押下中: ${inp.shiftDownHeld ? 'はい' : 'いいえ'}`,
      `最後に受け取ったシフト操作: ${ago}`,
      `シフトアップ: ${bind('shiftUp')}`,
      `シフトダウン: ${bind('shiftDown')}`,
      `ハンドル: ${bind('steer')}  値 ${inp.steer.toFixed(2)}`,
      `入力デバイス: ${(this.input.pads || []).map((p) => `${p.id}(#${p.index} 軸${p.axes.length}/ボタン${p.buttons.length})`).join(', ')}`,
    ].join('\n');
  }

  boardHtml() {
    const race = this.race;
    const leader = race.standings()[0];
    const rows = race.standings().map((e) => {
      let t;
      if (e.finished) t = e === leader ? fmtTime(e.finishTime) : `+${(e.finishTime - leader.finishTime).toFixed(2)}`;
      else t = `<span class="muted">走行中 LAP ${Math.max(1, e.lap)}</span>`;
      const swatch = `<i style="background:#${new THREE.Color(e.color).getHexString()}"></i>`;
      return `<tr class="${e === this.me ? 'me' : ''}"><td>${e.position}</td><td>${swatch}${e.name}</td><td>${t}</td><td>${fmtTime(e.bestLap)}</td></tr>`;
    }).join('');
    return `<h2>RESULT — ${this.me.position} 位</h2>
      <table><thead><tr><th>#</th><th>DRIVER</th><th>TIME</th><th>BEST LAP</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted">${this.online ? '決定ボタン / Enter・ポーズボタン / Esc でロビーへ戻る' : '決定ボタン / Enter でもう一度 ・ ポーズボタン / Esc でメニュー'}</p>`;
  }

  updateCamera(dt) {
    const focus = this.me || this.race.karts.find((e) => e.position === 1) || this.race.karts[0];
    if (this.xrOn || (this.me && this.cameraMode === 'cockpit')) return; // コックピットは自動で追従
    const pose = focus.renderPose;
    const c = this.chase;
    if (!c.init) {
      c.heading = pose.heading;
      c.init = true;
    }
    c.heading = lerpAngle(c.heading, pose.heading, 1 - Math.exp(-dt * 5));
    const big = (this.opts?.vehicle || 'kart') !== 'kart';
    const back = this.me ? (big ? 7.5 : 4.8) : 11;
    const up = this.me ? (big ? 2.4 : 1.9) : 4;
    // ブースト中は視野を広げてスピード感を出す
    const fov = 75 + (focus.kart.boost > 0 ? 10 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 6);
      this.camera.updateProjectionMatrix();
    }
    const target = new THREE.Vector3(pose.x - Math.cos(c.heading) * back, pose.y + up, pose.z - Math.sin(c.heading) * back);
    if (!c.posInit) {
      c.pos.copy(target);
      c.posInit = true;
    }
    c.pos.lerp(target, 1 - Math.exp(-dt * 8));
    this.camera.position.copy(c.pos);
    this.camera.lookAt(pose.x + Math.cos(c.heading) * 5, pose.y + 0.9, pose.z + Math.sin(c.heading) * 5);
  }
}

export { pointAt };
