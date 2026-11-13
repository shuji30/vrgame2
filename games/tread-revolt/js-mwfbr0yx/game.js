// ゲームの進行:シミュレーション・描画・視点・VR・音・FFB・無線をつなぐ
import * as THREE from '../vendor/three.module.js';
import { Sim } from './core/sim.js';
import { World } from './scene/world.js';
import { Fx } from './scene/fx.js';
import { Cockpit } from './scene/cockpit.js';
import { buildVehicle, buildUnit } from './scene/models.js';
import { buildBoss } from './scene/bossmodels.js';
import { FfbModel } from './core/ffbmodel.js';
import { clamp, damp, wrapAngle, yawTo, fmtTime, DEG } from './core/util.js';
import { bossProgress } from './core/boss.js';
import { isStill } from './core/ballistics.js';
import { LIBERATION } from './core/stages.js';
import { Vignette } from './scene/comfort.js';
import { TankTelemetry } from './core/telemetry.js';

const STEP = 1 / 60;
const WHO = { leader: 'リーダー', mech: '整備士', boss: '公社司令官', town: '町の人', sys: '' };

export class Game {
  constructor(app) {
    this.app = app; // { renderer, audio, input, bridge, settings, hud, xr, onEnd }
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 2000);
    this.seat = new THREE.Group(); // 視点の原点(VR の rig を兼ねる)
    // seat → xrOffset → camera。視点のリセットは xrOffset で頭の位置と向きを打ち消す
    this.xrOffset = new THREE.Group();
    this.seat.add(this.xrOffset);
    this.xrOffset.add(this.camera);
    this.scene.add(this.seat);
    this.view = 'cockpit';
    this.paused = false;
    this.running = false;
    this.models = new Map();
    this.time = 0;
    this.acc = 0;
    this.radioQ = [];
    this.radioT = 0;
    this.msgs = [];
    this.viewYaw = 0;
    this.seatY = 0;
    this.lastViewYaw = 0;
    this.yawRate = 0;
    this.ffbModel = new FfbModel();
    this.telem = new TankTelemetry();
    this.shake = 0;
    this.buildVignette();
    this.buildHorizon();
    this.hatchRing = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.08, 8, 24), new THREE.MeshStandardMaterial({ color: 0x5a4a32, roughness: 0.8 }));
    this.hatchRing.rotation.x = Math.PI / 2;
    this.hatchRing.position.y = -0.55;
    this.hatchRing.visible = false;
    this.seat.add(this.hatchRing);
    this.xrMenu = null;
  }

  buildVignette() {
    // vrgame4 の球型ビネット:カメラを包む球に描くので、Pimax の広い視野でも周辺まで覆える。被弾は周りを赤く縁取る
    this.vig = new Vignette(this.camera);
  }

  // 地平線の固定表示(酔い対策の設定)
  buildHorizon() {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(40, 0.04, 4, 96), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, fog: false, depthWrite: false }));
    ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    this.horizon = ring;
    this.scene.add(ring);
  }

  get settings() {
    return this.app.settings;
  }

  // ------------------------------------------------------------ 開始と終了
  start(cfg) {
    this.cfg = cfg;
    const S = this.settings;
    this.sim = new Sim(cfg.stage, {
      mode: cfg.mode, difficulty: S.difficulty, players: cfg.players, versus: cfg.versus, authority: cfg.authority ?? true,
      comfortTurn: S.comfortTurn ?? 1, seed: cfg.seed,
    });
    if (cfg.idPrefix) this.sim.idPrefix = cfg.idPrefix;
    this.me = this.sim.byId.get(cfg.localId || 'p1');
    this.world = new World(this.scene, this.sim, { shadows: S.shadows });
    this.fx = new Fx(this.scene);
    this.cockpit = new Cockpit({ kind: this.me.kind });
    this.cockpit.group.rotation.y = Math.PI; // コックピットは +Z が前に作ってある
    this.seat.add(this.cockpit.group);
    this.cockpit.setWheelOffset(S.wheelOffset || {});
    this.renderer = this.app.renderer;
    this.renderer.shadowMap.enabled = !!S.shadows;
    this.view = 'cockpit';
    this.viewYaw = this.me.yaw;
    this.seatY = this.me.y;
    this.paused = false;
    this.running = true;
    this.ended = false;
    this.time = 0;
    this.radioQ = [];
    this.radioT = 0;
    this.app.hud.reset();
    this.app.audio.playMusic(cfg.stage.music || 'area1');
    this.app.audio.jingle('start');
    this.app.audio.setInterior(true);
    this.bossShown = false;
    this.tutorial = cfg.tutorial || null;
    this.pendingRecenter = 2; // 出撃直後に自動でリセット(頭の姿勢が届いてから)
    this.processEvents();
  }

  stop() {
    this.running = false;
    for (const m of this.models.values()) { this.scene.remove(m.root); m.dispose?.(); }
    this.models.clear();
    this.world?.dispose();
    if (this.fx) this.scene.remove(this.fx.group);
    if (this.cockpit) this.seat.remove(this.cockpit.group);
    this.app.audio.pruneEngines(new Set());
    if (this.me) this.app.audio.removeEngine(this.me.id);
    this.app.bridge?.stopForces();
    this.sim = null;
  }

  // ------------------------------------------------------------ 毎フレーム
  frame(dt) {
    if (!this.running) return;
    dt = Math.min(dt, 0.1);
    const a = this.app.input.poll(dt);
    this.actions = a;
    const inXR = this.renderer.xr.isPresenting;
    if (a.pause && !this.ended) this.app.onPause?.(!this.paused);
    if (this.paused) { this.render(); return; }
    if (a.recenter) this.recenter(true);
    if (a.view) this.cycleView();
    if (a.hatch) this.setView(this.view === 'hatch' ? 'cockpit' : 'hatch');

    // VR の操作を共通アクションへ(次のフレームで使う)
    if (inXR && this.app.xr) {
      const headYaw = this.headYawLocal();
      this.app.input.xr = this.app.xr.poll(this.cockpit, headYaw);
    } else this.app.input.xr = null;

    const cmd = this.makeCommand(a);
    this.time += dt;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 4) {
      this.sim.step(STEP, new Map([[this.me.id, cmd]]));
      this.app.net?.afterStep?.(this.sim, cmd);
      cmd.fire = false; cmd.subPress = false; cmd.subSelect = false; cmd.pitchStep = 0; cmd.quickTurn = false; cmd.weaponSwap = false;
      this.acc -= STEP;
      steps++;
      this.processEvents();
    }
    if (steps === 4) this.acc = 0;
    if (this.pendingRecenter > 0 && this.renderer.xr.isPresenting && --this.pendingRecenter === 0) this.recenter();
    this.tutorial?.update(this, dt);
    this.updateModels(dt);
    this.updateCamera(dt, inXR);
    this.updateAudio(dt);
    this.updateFfb(dt);
    this.updateHud(dt);
    this.world.update(dt, this.time);
    this.world.follow(this.me.x, this.me.z);
    this.fx.syncShells(this.sim.shots);
    this.fx.update(dt);
    this.app.net?.frame?.(this, dt);
    this.checkEnd(dt);
    this.render();
  }

  render() {
    if (document.hidden && !this.renderer.xr.isPresenting) return; // 裏のタブでは描かない(オンラインで進めるだけ)
    this.renderer.render(this.scene, this.camera);
  }

  makeCommand(a) {
    const cmd = { ...a };
    // VR で砲塔を頭に追従:頭の向き(車体基準)を砲塔の目標角に
    if (a.turretYaw != null) cmd.turretYaw = a.turretYaw;
    // ハンコンなし:曲射の距離はアナログでなければ自動
    return cmd;
  }

  headYawLocal() {
    // 視点(seat)は車体の向き。カメラのローカルの向き → 車体基準の角度
    const q = this.xrOffset.quaternion.clone().multiply(this.camera.quaternion); // リセットの補正込み
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const local = Math.atan2(-fwd.x, -fwd.z); // seat のローカルで、-Z が前
    // seat は yaw+π 回してあるので、左が +
    // local は左を向くと正(砲塔の角度も左が正)
    return wrapAngle(local + (this.viewYaw - this.me.yaw));
  }

  // 視点のリセット:いまの頭の位置と向きを、座席の原点・正面にする(VR)
  recenter(announce = false) {
    if (!this.renderer.xr.isPresenting) return;
    const cam = this.camera;
    const yaw = Math.atan2(-new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).x, -new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).z);
    this.xrOffset.rotation.set(0, -yaw, 0);
    const p = cam.position.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
    this.xrOffset.position.set(-p.x, -p.y, -p.z);
    if (announce) { this.flashMsg('視点をリセットしました', 1.2); this.app.audio.play('click'); }
  }

  cycleView() {
    const order = ['cockpit', 'hatch', 'diorama'];
    this.setView(order[(order.indexOf(this.view) + 1) % order.length]);
  }

  setView(v) {
    if (this.view === v) return;
    this.view = v;
    this.app.audio.setInterior(v === 'cockpit');
    this.app.audio.play('click');
    this.flashMsg({ cockpit: 'コックピット視点', hatch: '砲塔ハッチ視点(被弾に注意)', diorama: 'ジオラマ視点' }[v], 1.2);
  }

  // ------------------------------------------------------------ 視点
  updateCamera(dt, inXR) {
    const me = this.me;
    const S = this.settings;
    // エレベーターで飛んでいる間はジオラマ視点
    let view = this.view;
    if (me.air && !inXR) view = 'diorama';
    if (me.air && inXR) view = 'diorama';
    if (!me.alive || me.drop > 0) view = 'diorama';
    if (this.sim.mission.state === 'exit') view = 'diorama';
    this.activeView = view;
    const spec = me.spec;
    const followTurret = !inXR; // デスクトップは砲塔の向きに視点を合わせる(VR は車体の向き)
    const targetYaw = followTurret ? me.yaw + me.turret : me.yaw;
    // VR のスナップ旋回:誤差が一定を超えたら一気に回す
    if (inXR && S.snapTurn && view !== 'diorama') {
      const err = wrapAngle(targetYaw - this.viewYaw);
      if (Math.abs(err) > 30 * DEG) { this.viewYaw = wrapAngle(this.viewYaw + Math.sign(err) * 30 * DEG); this.snapFade = 0.12; }
    } else {
      this.viewYaw = targetYaw;
    }
    const yr = wrapAngle(this.viewYaw - this.lastViewYaw) / Math.max(dt, 1e-3);
    this.lastViewYaw = this.viewYaw;
    this.yawRate = damp(this.yawRate, view === 'diorama' ? 0 : yr, 10, dt);

    this.cockpit.group.visible = view === 'cockpit';
    this.hatchRing.visible = view === 'hatch';
    const ownModel = this.models.get(me.id);
    if (ownModel) ownModel.root.visible = view !== 'cockpit' && me.alive;

    if (view === 'diorama') {
      this.seat.scale.setScalar(inXR ? 40 : 1);
      // 盤面は回さない(北が奥)。自機が盤の手前に来るように置く
      const tx = me.x, tz = me.z;
      this.dioramaPos ??= { x: tx, z: tz };
      const dp = this.dioramaPos;
      const dd = Math.hypot(tx - dp.x, tz - dp.z);
      if (dd > 12) { dp.x += (tx - dp.x) * dt * 1.5; dp.z += (tz - dp.z) * dt * 1.5; }
      if (inXR) {
        // 盤面(地面)が手前 0.6m、高さ 0.8m の卓に見える
        this.seat.position.set(dp.x, -0.8 * 40 + 0.0 + 40 * 0.9, dp.z - 0.6 * 40);
        this.seat.position.y = this.sim.terrain.height(dp.x, dp.z) - 0.8 * 40 + 1.2 * 40 * 0.0;
        this.seat.rotation.set(0, Math.PI, 0);
      } else {
        this.seat.position.set(dp.x, me.y + 62, dp.z - 52);
        this.seat.rotation.set(0, Math.PI, 0);
        this.camera.rotation.set(-0.86, 0, 0);
      }
    } else {
      this.dioramaPos = null;
      this.seat.scale.setScalar(1);
      let eye = spec.eye;
      if (spec.body === 'mech') eye -= me.crouch * 2.2;
      if (view === 'hatch') eye = spec.height + 1.25;
      // 高さはなめらかに(揺れを伝えない)
      const ty = me.y + eye;
      this.seatY = Math.abs(ty - this.seatY) > 8 ? ty : damp(this.seatY, ty, 5, dt);
      const fwd = view === 'cockpit' ? 0.3 : -0.6;
      const yawPos = followTurret ? this.viewYaw : me.yaw;
      this.seat.position.set(me.x + Math.sin(yawPos) * fwd, this.seatY, me.z + Math.cos(yawPos) * fwd);
      this.seat.rotation.set(0, this.viewYaw + Math.PI, 0);
      if (!inXR) {
        // 砲身の仰角に少しだけ合わせる(見下ろしすぎない)
        const pitch = view === 'hatch' ? -0.12 : -0.05 + me.gunPitch * 0.5;
        this.camera.rotation.set(pitch, 0, 0);
      }
    }
    if (!inXR) {
      this.camera.position.set(0, 0, 0);
      // 被弾の揺れは画面には出さず、ごく小さいものだけ(設定で 0 にできる)
    }
    // ビネット:旋回中だけ視野の周りを暗く(急に変えず、なめらかに追う)
    let vig = view === 'diorama' ? 0 : clamp(Math.abs(this.yawRate) / 1.1, 0, 1) * (S.vignette ?? 0.6);
    if (this.snapFade > 0) { this.snapFade -= dt; vig = 1; }
    this.vig.update(dt, vig);
    // 地平線
    this.horizon.visible = !!S.horizon && view !== 'diorama';
    this.horizon.position.set(this.seat.position.x, this.seat.position.y, this.seat.position.z);
    // 照準と曲射の着弾予想
    const showAim = me.alive && !(me.drop > 0) && me.wheelie < 0.3;
    this.fx.setReticle(this.camera, me.aim, !!me.aim.lock, me.spread, showAim && view !== 'diorama' || (showAim && view === 'diorama'));
    this.fx.setLob(me.lobAim, me.alive && (me.wheelie > 0.05 || this.actions?.lob), this.time);
    // コックピットの小物とレバー
    const accel = (me.v - (this.lastV ?? me.v)) / Math.max(dt, 1e-3);
    this.lastV = me.v;
    this.cockpit.sway(dt, accel, me.w, me.bump || 0);
    const a = this.actions || {};
    this.cockpit.setLevers(me.tl / Math.max(spec.speed, 1), me.tr / Math.max(spec.speed, 1), me.wheelie);
    const w = this.app.input.wheel;
    this.cockpit.wheelRig.visible = this.app.input.active === 'wheel';
    if (w) this.cockpit.setWheel(w.steer * ((this.app.input.wheelCfg.steer.lockDeg || 270) / 2) * DEG, [w.clutch || 0, w.brake || 0, w.throttle || 0]);
    void a;
  }

  // ------------------------------------------------------------ モデル
  modelFor(e) {
    let m = this.models.get(e.id);
    if (m) return m;
    if (e.type === 'boss') {
      const b = buildBoss(e.boss);
      m = { root: b.root, boss: b, update: () => {} };
    } else if (e.isPlayer || e.ctrl === 'bot' || e.ctrl === 'remote') {
      const faction = this.sim.mode === 'versus' && e.team === 1 ? 'zark' : 'guard';
      m = buildVehicle(e.kind, { faction, color: e.color, number: String((e.index ?? 0) + 7).padStart(2, '0') });
    } else {
      m = buildUnit(e.type);
    }
    if (this.settings.shadows) m.root.traverse((c) => { if (c.isMesh) c.castShadow = true; });
    this.scene.add(m.root);
    this.models.set(e.id, m);
    return m;
  }

  updateModels(dt) {
    for (const e of this.sim.ents) {
      const m = this.modelFor(e);
      const showDead = !e.alive;
      if (showDead || (e.hidden && e.type !== 'amphib' && e.type !== 'launcher')) { if (e !== this.me) m.root.visible = false; if (!e.alive) continue; }
      if (e !== this.me) m.root.visible = !e.hidden || e.type === 'launcher' && e.rise > 0;
      if (e.type === 'amphib' && e.hidden) m.root.visible = false;
      if (e.type === 'launcher' && e.hidden) m.root.visible = false;
      m.root.position.set(e.x, e.y, e.z);
      m.root.rotation.y = e.yaw;
      if (m.boss) { m.boss.update(e, dt, this.time); continue; }
      m.update({
        dt, tl: e.tl || 0, tr: e.tr || 0, turret: e.turret || 0, gunPitch: e.gunPitch || 0, pitch: e.pitch || 0, roll: e.roll || 0,
        wheelie: e.wheelie || 0, crouch: e.crouch || 0, rise: e.rise ?? 1, popped: e.popped || 0, recoil: (e.fireT || 0) / 0.35,
        hp01: e.hp / (e.maxHp || 1), trackBrokenL: e.trackDmg?.[0] > 0, trackBrokenR: e.trackDmg?.[1] > 0, time: this.time, team: e.team,
      });
      // 走ったあとの土ぼこり
      if ((e.isPlayer || e.ctrl === 'bot' || e.spec?.body === 'tank') && Math.abs(e.v || 0) > 3 && !e.air && Math.random() < dt * 8) {
        const back = -(e.radius || 2);
        this.fx.trail(e.x + Math.sin(e.yaw) * back, e.y, e.z + Math.cos(e.yaw) * back, e.surf?.kind);
      }
    }
    // 対戦:旗と拠点
    if (this.sim.points && !this.pointModels) {
      this.pointModels = this.sim.points.map((p) => { const m = buildUnit('capturePoint'); m.root.position.set(p.x, this.sim.terrain.height(p.x, p.z), p.z); this.scene.add(m.root); return m; });
    }
    this.pointModels?.forEach((m, i) => { m.setTeam?.(this.sim.points[i].owner); m.update({ dt, time: this.time, team: this.sim.points[i].owner }); });
    if (this.sim.flags && !this.flagModels) {
      this.flagModels = this.sim.flags.map((f) => { const m = buildUnit('flag', { team: f.team }); this.scene.add(m.root); return m; });
    }
    this.flagModels?.forEach((m, i) => {
      const f = this.sim.flags[i];
      const c = f.carrier && this.sim.byId.get(f.carrier);
      m.root.position.set(f.x, this.sim.terrain.height(f.x, f.z) + (c ? 3 : 0), f.z);
      m.update({ dt, time: this.time });
    });
  }

  // ------------------------------------------------------------ イベント
  processEvents() {
    const sim = this.sim;
    if (!sim) return;
    const au = this.app.audio;
    const me = this.me;
    for (const ev of sim.events) {
      this.app.net?.onEvent?.(ev, this);
      if (this.tutorial) (this.tutorialEvents ||= []).push(ev);
      const mine = ev.id === me.id;
      const pos = ev.x != null ? { x: ev.x, y: ev.y ?? 0, z: ev.z } : null;
      switch (ev.t) {
        case 'radio': this.radioQ.push(ev); break;
        case 'fire': {
          const e = sim.byId.get(ev.id);
          if (ev.kind === 'cannon') {
            au.play(mine ? 'cannon' : 'cannonEnemy', { ...pos, strength: ev.strength ?? 1 });
            this.fx.muzzle(ev.x, ev.y, ev.z, ev.yaw ?? (e ? e.yaw + e.turret : 0), e?.spec?.dmg > 40 ? 1.3 : 1);
            if (mine) { this.telem.recoil(ev.strength ?? 1); this.ffbModel.recoil(ev.strength ?? 1); this.cockpit.sway(0.05, -30, 0, 0.5); this.app.haptic?.(0.6, 80); }
          } else if (ev.kind === 'cannonEnemy' || ev.kind === 'bigCannon') {
            au.play(ev.kind, pos);
            this.fx.muzzle(ev.x, ev.y, ev.z, e ? e.yaw + (e.turret || 0) : 0, ev.kind === 'bigCannon' ? 1.4 : 0.8);
          } else if (ev.kind === 'mg') au.play(mine ? 'mg' : 'mgEnemy', { ...pos, gain: mine ? 0.7 : 0.6 });
          else if (ev.kind === 'mgEnemy') au.play('mgEnemy', { ...pos, gain: 0.6 });
          else if (ev.kind === 'lob') { au.play('lob', pos); this.fx.muzzle(ev.x, ev.y, ev.z, 0, 0.8); if (mine) this.ffbModel.recoil(0.8); }
          else if (ev.kind === 'missile') au.play('missile', pos);
          else if (ev.kind === 'smoke') au.play('smoke', pos);
          break;
        }
        case 'explode': {
          const small = ev.shot === 'mg' || ev.shot === 'mgEnemy';
          if (small) { this.fx.tiny(ev.x, ev.y, ev.z, ev.kind); if (Math.random() < 0.3) au.play('impactGround', { ...pos, gain: 0.3 }); break; }
          if (ev.kind === 'water') { this.fx.explosion(ev.x, ev.y, ev.z, ev.size, 'water'); au.play('splash', pos); break; }
          this.fx.explosion(ev.x, ev.y, ev.z, ev.size, ev.kind === 'air' ? 'air' : 'ground');
          au.play(ev.size >= 2 ? 'explosion' : ev.kind === 'ground' ? 'impactGround' : 'smallExplosion', pos);
          break;
        }
        case 'hit':
          if (mine) {
            const rel = wrapAngle(yawTo(me.x, me.z, ev.fx, ev.fz) - me.yaw);
            au.play('hit', { x: ev.fx, y: me.y + 2, z: ev.fz, strength: clamp(ev.dmg / 30, 0.3, 1) });
            this.ffbModel.hit(rel > 0 ? -1 : 1, clamp(ev.dmg / 30, 0.3, 1));
            this.telem.hit(rel > 0 ? 1 : -1, clamp(ev.dmg / 30, 0.3, 1));
            this.vig.hit(clamp(ev.dmg / 25, 0.3, 0.8));
            this.app.haptic?.(0.8, 120);
            this.app.hud.hitDir(wrapAngle(rel - (this.viewYaw - me.yaw)));
            if (ev.hp < 0.3 && !this.warnedLow) { this.warnedLow = true; sim.radio('mech', '装甲がもたない!遮蔽物に隠れろ!'); }
          }
          break;
        case 'ricochet':
          au.play('ricochet', pos);
          if (ev.armor && this.me && Math.hypot(ev.x - me.x, ev.z - me.z) < 200 && !this.armorHinted) { this.armorHinted = true; sim.radio('mech', '弾かれた!発射台は壁に守られてる、曲射で上から狙え!'); }
          break;
        case 'kill': {
          this.fx.wreck(ev.x, ev.y, ev.z, ev.big);
          au.play(ev.big ? 'bigExplosion' : 'explosion', pos);
          if (ev.id === me.id) { this.flashMsg('撃破された……', 2); this.warnedLow = false; }
          if (ev.by === me.id && ev.id !== me.id) this.app.hud.killPop(ev.type);
          break;
        }
        case 'hitPart': break;
        case 'partDown': this.fx.explosion(ev.x, ev.y, ev.z, 2.5); au.play('bigExplosion', pos); break;
        case 'reload': if (mine) au.play('reload'); break;
        case 'wake': {
          const u = sim.byId.get(ev.id);
          au.play(ev.type === 'mine' ? 'mine' : 'wake', pos);
          if (u?.type === 'boss' && !this.bossShown) { this.bossShown = true; }
          break;
        }
        case 'boss':
          au.play('bossRoar');
          au.playMusic('boss');
          au.jingle('bossAppear');
          this.flashMsg(ev.name, 3, true);
          break;
        case 'gear': if (mine) au.play('gear'); break;
        case 'click': if (mine) { au.play('click'); this.ffbModel.click(); } break;
        case 'elevator': if (mine) { au.play('elevator'); this.flashMsg(`エレベーター!残り ${ev.left} 回`, 2); } break;
        case 'land': if (mine) { au.play('land'); this.ffbModel.bump(0.8); this.fx.explosion(me.x, me.y, me.z, 1.5, 'ground'); } break;
        case 'drop': if (ev.id === me.id) au.play('drop'); break;
        case 'trackBreak': if (mine) { au.play('trackBreak'); this.radioQ.push({ who: 'mech', text: ev.side === 0 ? '左の履帯をやられた!直すまで左は動かん!' : '右の履帯をやられた!直すまで右は動かん!' }); } break;
        case 'repair': if (mine) { au.play('repair'); this.flashMsg(ev.side === 0 ? '左の履帯 修理完了' : '右の履帯 修理完了', 1.5); } break;
        case 'gate': au.play('gateOpen', { x: ev.x, y: 2, z: ev.z }); break;
        case 'rise': au.play('alarm', { x: ev.x, y: 2, z: ev.z }); break;
        case 'objective': au.play('objective'); break;
        case 'bonus': au.play('bonus'); this.app.hud.killPop('bonus', ev.score); break;
        case 'smoke': this.fx.smokeCloud(ev.x, ev.y, ev.z); break;
        case 'danger': this.fx.danger(ev.x, sim.terrain.height(ev.x, ev.z), ev.z, ev.r, ev.time); break;
        case 'stomp': au.play('stomp', { x: ev.x, y: 0, z: ev.z }); if (Math.hypot(ev.x - me.x, ev.z - me.z) < 60) this.ffbModel.bump(0.3); break;
        case 'drill': au.play('drill', { x: ev.x, y: 3, z: ev.z }); break;
        case 'quake': this.ffbModel.bump(1); break;
        case 'crunch': if (mine) au.play('crunch', { gain: 0.6 }); break;
        case 'capture': au.play('capture'); this.flashMsg(ev.flag ? `${ev.team === me.team ? '味方' : '敵'}が旗を持ち帰った!` : `拠点${'ABC'[ev.id] ?? ''}を${ev.team === me.team ? '確保' : ev.team < 0 ? '中立化' : '奪われた'}`, 2); break;
        case 'flag': au.play('flag'); this.flashMsg(ev.team === me.team ? '味方の旗を奪われた!' : '敵の旗を奪った!', 2); break;
        case 'flagReturn': this.flashMsg('旗が戻った', 1.5); break;
        case 'weapon': if (mine) this.flashMsg(ev.weapon === 'cannon' ? '腕の主砲' : '肩のロケット', 1.2); break;
        case 'sub': if (mine) this.flashMsg(ev.sub === 'mg' ? '副武装:機銃' : '副武装:スモーク', 1.2); break;
        case 'mission':
          if (ev.state === 'play') this.flashMsg(sim.mode === 'versus' ? '試合開始!' : '作戦開始!', 2, true);
          if (ev.state === 'clear') { au.jingle('clear'); this.flashMsg(sim.mode === 'training' ? '' : '全目標撃破!', 3, true); }
          if (ev.state === 'fail') { au.jingle('fail'); this.flashMsg('作戦失敗', 3, true); }
          if (ev.state === 'over') { au.jingle(ev.winner === me.team ? 'clear' : 'fail'); this.flashMsg(ev.winner === me.team ? '勝利!' : ev.winner < 0 ? '引き分け' : '敗北……', 3, true); }
          break;
        default: break;
      }
    }
    sim.events.length = 0;
  }

  flashMsg(text, sec = 2, big = false) {
    this.app.hud.message(text, sec, big);
  }

  // ------------------------------------------------------------ 音
  updateAudio(dt) {
    const au = this.app.audio;
    const cam = this.camera;
    const p = cam.getWorldPosition(new THREE.Vector3());
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    au.setListener(p, f, { x: 0, y: 1, z: 0 });
    const me = this.me;
    const active = new Set();
    if (me.alive) {
      au.setEngine(me.id, { x: me.x, y: me.y + 1, z: me.z, yaw: me.yaw, tl: me.tl, tr: me.tr, maxSpeed: me.spec.speed, gear: me.gear, local: true, kind: me.spec.body === 'mech' ? 'mech' : me.kind });
      active.add(me.id);
    } else au.removeEngine(me.id);
    // 近くの車両 4 台
    const near = this.sim.ents.filter((e) => e !== me && e.alive && !e.hidden && (e.spec?.body === 'tank' || e.spec?.body === 'mech' || e.type === 'boss') && !e.static || e.type === 'boss' && e.alive)
      .map((e) => [e, Math.hypot(e.x - me.x, e.z - me.z)]).filter(([, d]) => d < 120).sort((a, b) => a[1] - b[1]).slice(0, 4);
    for (const [e] of near) {
      au.setEngine(e.id, { x: e.x, y: e.y + 1, z: e.z, yaw: e.yaw, tl: e.tl || e.v || 0, tr: e.tr || e.v || 0, maxSpeed: e.spec?.speed || 8, gear: 2, local: false, kind: e.type === 'boss' ? 'boss' : e.type === 'scout' ? 'scout' : e.kind === 'heavy' || e.type === 'heavyTank' ? 'heavy' : 'tank' });
      active.add(e.id);
    }
    au.pruneEngines(active);
    au.update(dt);
  }

  updateFfb(dt) {
    const br = this.app.bridge;
    const me = this.me;
    if (br?.connected && this.settings.simhub !== false && me.alive) br.telemetry(this.telem.compute(me, dt, this.time, this.sim.mission.state === 'play'));
    if (!br?.connected || !this.settings.ffb) return;
    if (me.bump > 0.2) this.ffbModel.bump(me.bump * 0.6);
    Object.assign(this.ffbModel.set, { gain: this.settings.ffbGain ?? 0.8, spring: this.settings.ffbSpring ?? 0.45 });
    const f = this.ffbModel.update({
      dt, speed01: clamp(Math.abs(me.v) / me.spec.speed, 0, 1), rough: (me.surf?.rough ?? 0.3) + (me.onDebris ? 0.4 : 0), roadHz: me.surf?.hz ?? 14,
      turretWeight: me.spec.ffbDamper, turretLimit: me.turretLimit || 0,
    });
    // 機器によって力の左右が逆になるので、設定で反転できるようにする
    if (this.settings.ffbInvert) f.c = -f.c;
    br.ffb(f);
  }

  // ------------------------------------------------------------ 計器と画面表示
  updateHud(dt) {
    const sim = this.sim, me = this.me, m = sim.mission;
    // 無線
    this.radioT -= dt;
    if (this.radioT <= 0 && this.radioQ.length) {
      const r = this.radioQ.shift();
      const dur = 1.8 + r.text.length * 0.075;
      this.radioT = dur;
      this.app.hud.radio(WHO[r.who] ?? r.who, r.text, dur);
      this.app.audio.radio(true);
      this.app.audio.speak(r.text, { enabled: this.settings.speech });
    }
    this.instT = (this.instT || 0) - dt;
    const objText = sim.mode === 'versus' ? versusText(sim, me) : m.objectives ? `目標 ${m.objectives - m.objectivesLeft}/${m.objectives}` : '';
    const state = {
      tl: me.tl / me.spec.speed, tr: me.tr / me.spec.speed, brokenL: me.trackDmg[0] > 0, brokenR: me.trackDmg[1] > 0,
      reload01: 1 - me.reload / ((me.weapon === 'rockets' ? 4.6 : me.spec.reload) || 1), hp01: me.hp / me.maxHp, gear: me.gear, speed: me.v,
      still: isStill(me.v, me.w), subLabel: me.spec.body === 'mech' ? (me.weapon === 'cannon' ? '腕の主砲' : '肩のロケット') + ' / ' + (me.sub === 'mg' ? '機銃' : `煙×${me.smokeAmmo}`) : me.sub === 'mg' ? '副:機銃' : `副:スモーク ×${me.smokeAmmo}`,
      timeLeft: m.timeLimit ? m.timeLeft : null, objText,
      livesText: sim.mode === 'versus' ? `撃破 ${me.kills} / 被撃破 ${me.deaths}` : sim.mode === 'training' ? '' : `残機 ${Math.max(0, m.lives)}`,
      scoreText: sim.mode === 'versus' ? '' : `SCORE ${m.score}`, turret: me.turret,
      elevText: sim.elevators.length ? `エレベーター ×${sim.elevUses}` : '',
      extra: me.wheelie > 0.3 ? `曲射 ${Math.round(me.lobRangeNow || 0)}m` : me.trackDmg.some((t) => t > 0) ? '履帯 修理中…' : '',
    };
    if (this.instT <= 0) {
      this.instT = 0.1;
      this.cockpit.draw(state);
      this.cockpit.drawRadar(sim, me, this.viewYaw);
    }
    // ボスの体力
    const boss = sim.ents.find((e) => e.type === 'boss' && e.ai.state !== 'sleep');
    this.app.hud.update({
      ...state, view: this.activeView, reticle: true, mode: sim.mode, still: state.still, spread: me.spread,
      boss: boss ? { name: boss.name, hp: boss.alive ? bossProgress(boss) : 0 } : null,
      respawn: !me.alive && me.respawnT > 0 ? me.respawnT : 0, lob: me.wheelie > 0.3 ? me.lobRangeNow : 0,
      teamScore: m.teamScore, rule: m.rule, target: m.target,
      timeText: m.timeLimit ? fmtTime(m.timeLeft) : '', inXR: this.renderer.xr.isPresenting,
    });
  }

  // ------------------------------------------------------------ 終了の判定
  checkEnd(dt) {
    const m = this.sim.mission;
    if (this.ended) return;
    const done = m.state === 'done' || m.state === 'fail' || m.state === 'over';
    if (!done) return;
    this.endT = (this.endT || 0) + dt;
    if (this.endT < (m.state === 'done' ? 0.5 : 3.5)) return;
    this.ended = true;
    this.endT = 0;
    const st = this.sim.stage;
    if (m.state === 'done' && st.boss && LIBERATION[st.area]) for (const [who, text] of LIBERATION[st.area]) this.app.hud.radio(WHO[who], text, 6);
    this.app.onEnd?.({
      state: m.state, stage: st, score: m.score, timeBonus: m.timeBonus, noDeathBonus: m.noDeathBonus, bonus: m.bonus, kills: m.kills, deaths: m.deaths,
      shots: m.shots, hits: m.hits, winner: m.winner, teamScore: m.teamScore, myTeam: this.me.team, players: this.sim.ents.filter((e) => e.isPlayer || e.ctrl === 'bot').map((e) => ({ name: e.name, team: e.team, kills: e.kills, deaths: e.deaths, score: e.score })),
      reason: m.failReason,
    });
  }
}

function versusText(sim, me) {
  const m = sim.mission;
  const [a, b] = m.teamScore;
  const mine = me.team === 0 ? a : b, theirs = me.team === 0 ? b : a;
  const label = m.rule === 'dm' ? '撃破' : m.rule === 'dom' ? '拠点' : '旗';
  return `${label} 味方 ${Math.floor(mine)} - ${Math.floor(theirs)} 敵 (先取 ${m.target})`;
}
