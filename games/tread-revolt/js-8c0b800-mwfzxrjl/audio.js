// 効果音・エンジン音・BGM(すべて WebAudio で合成。外部音源なし)
// AudioContext は unlock() で初めて作る(node で import しても落ちない)
import { MusicPlayer, TRACKS } from './music.js';

const MAX_POS = 24; // 同時に鳴らす位置付き効果音の上限
// 自車の中で鳴る音:ハッチを閉じていてもこもらせない
const OWN = new Set(['cannon', 'mg', 'hit', 'ricochet', 'reload', 'gear', 'click', 'land', 'trackBreak', 'repair', 'crunch', 'smoke', 'lob', 'missile']);
// エンジンの種類ごとの基本音程(Hz)と音量
const KIND = {
  tank: { f: 38, g: 1 }, heavy: { f: 30, g: 1.2 }, light: { f: 50, g: 0.8 }, scout: { f: 62, g: 0.7 },
  mech: { f: 44, g: 0.9 }, boss: { f: 22, g: 1.6 },
};
const GEAR = { 1: 1.4, 2: 1.0, 3: 0.75, R: 1.3 };
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

function setPos(p, x, y, z, t) {
  if (p.positionX) {
    p.positionX.setTargetAtTime(x, t, 0.02);
    p.positionY.setTargetAtTime(y, t, 0.02);
    p.positionZ.setTargetAtTime(z, t, 0.02);
  } else p.setPosition(x, y, z);
}

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.vol = { master: 0.8, sfx: 0.9, music: 0.35 };
    this.inside = true;
    this.engines = new Map();
    this.posVoices = [];
    this.music = null;
    this.musicId = null;
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    // 出力系統:master ← (sfx, music)、外の音は lowpass(車内でこもる)を通す
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.ratio.value = 4;
    this.comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(this.comp);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.extBus = ctx.createGain();
    this.extLp = ctx.createBiquadFilter();
    this.extLp.type = 'lowpass';
    this.extLp.Q.value = 0.7;
    this.extBus.connect(this.extLp).connect(this.sfxBus);
    // ノイズは一度だけ作る
    const mk = (fn) => {
      const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      fn(d, n);
      return b;
    };
    this.white = mk((d, n) => { for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; });
    this.brown = mk((d, n) => {
      let l = 0;
      for (let i = 0; i < n; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; }
    });
    this.music = new MusicPlayer(ctx, this.musicBus, this.white);
    this.setVolumes({});
    this.setInterior(this.inside);
    if (ctx.state === 'suspended') ctx.resume();
    if (this._pendingMusic) this.playMusic(this._pendingMusic, this._pendingFallback);
  }

  setVolumes({ master, sfx, music } = {}) {
    if (master != null) this.vol.master = clamp(master);
    if (sfx != null) this.vol.sfx = clamp(sfx);
    if (music != null) this.vol.music = clamp(music);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.6, t, 0.05);
  }

  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.01);
      L.positionY.setTargetAtTime(pos.y, t, 0.01);
      L.positionZ.setTargetAtTime(pos.z, t, 0.01);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.01);
      L.forwardY.setTargetAtTime(fwd.y, t, 0.01);
      L.forwardZ.setTargetAtTime(fwd.z, t, 0.01);
      L.upX.setTargetAtTime(up.x, t, 0.01);
      L.upY.setTargetAtTime(up.y, t, 0.01);
      L.upZ.setTargetAtTime(up.z, t, 0.01);
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  setInterior(inside) {
    this.inside = !!inside;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.extLp.frequency.setTargetAtTime(this.inside ? 900 : 18000, t, 0.12);
    this.extBus.gain.setTargetAtTime(this.inside ? 0.8 : 1, t, 0.12);
  }

  _panner(x, y, z, ref = 6) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.maxDistance = 3000;
    p.rolloffFactor = 1;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else p.setPosition(x, y, z);
    return p;
  }

  // ===================== エンジン =====================
  setEngine(id, o) {
    if (!this.ctx) return;
    let e = this.engines.get(id);
    if (!e) {
      e = this._makeEngine(o);
      this.engines.set(id, e);
    }
    e.st = o;
    e.seen = this.ctx.currentTime;
    const ctx = this.ctx, t = ctx.currentTime, k = e.k;
    const yaw = o.yaw || 0, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const x = o.x || 0, y = (o.y || 0) + 0.8, z = o.z || 0;
    // 左履帯は +X 側(yaw=0 のとき)
    setPos(e.pl, x + cy * 1.6, y, z - sy * 1.6, t);
    setPos(e.pr, x - cy * 1.6, y, z + sy * 1.6, t);
    setPos(e.pc, x, y, z, t);
    const tl = clamp(o.tl || 0, -1, 1), tr = clamp(o.tr || 0, -1, 1);
    const gf = GEAR[o.gear] ?? 1;
    const load = Math.max(Math.abs(tl), Math.abs(tr));
    const T = (p, v, tau = 0.08) => p.setTargetAtTime(v, t, tau);
    // 左右の履帯:速さで音程・明るさ・音量
    for (const [side, sp] of [[e.L, tl], [e.R, tr]]) {
      const a = Math.abs(sp);
      const f = k.f * (1 + 1.6 * a * gf);
      T(side.o1.frequency, f);
      T(side.o2.frequency, f * 1.005);
      T(side.lp.frequency, 220 + 1500 * a * gf);
      T(side.g.gain, (0.12 + 0.55 * a) * k.g);
      T(side.lfo.frequency, 3 + 22 * a);
      T(side.clk.gain, 0.25 * a * k.g);
    }
    // 共通の低い唸り:負荷とギアで重さが変わる
    T(e.sub.frequency, k.f * 0.5 * (1 + 0.9 * load * gf));
    T(e.subG.gain, (0.35 + 0.35 * load) * k.g * (o.gear === 3 ? 1.2 : 1));
    // 逆回転・超信地の軋み
    const diff = Math.abs(tl - tr) / 2;
    const counter = tl * tr < 0 ? Math.min(Math.abs(tl), Math.abs(tr)) : 0;
    const sq = clamp(Math.max(0, diff - 0.25) * 0.8 + counter * 1.3);
    T(e.sqG.gain, sq * 0.22 * Math.min(1.5, k.g), 0.06);
    T(e.sqTone.frequency, 650 + 600 * sq);
    T(e.sqBp.frequency, 1400 + 1200 * sq);
    if (e.servo) {
      T(e.servoG.gain, 0.05 + 0.12 * load);
      T(e.servo.frequency, 900 + 1400 * load);
    }
    e.load = load;
  }

  _makeEngine(o) {
    const ctx = this.ctx, t = ctx.currentTime;
    const k = KIND[o.kind] || KIND.tank, local = !!o.local;
    const nodes = [], srcs = [];
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.setTargetAtTime(local ? 0.55 : 0.75, t, 0.2);
    // 自車はこもらせない
    out.connect(local ? this.sfxBus : this.extBus);
    const ref = local ? 2.5 : o.kind === 'boss' ? 30 : 8;
    const mkP = () => { const p = this._panner(o.x || 0, o.y || 0, o.z || 0, ref); p.connect(out); nodes.push(p); return p; };
    const pl = mkP(), pr = mkP(), pc = mkP();
    const osc = (type, f) => { const n = ctx.createOscillator(); n.type = type; n.frequency.value = f; n.start(t); srcs.push(n); return n; };
    const gain = (v, dest) => { const g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); nodes.push(g); return g; };
    const filt = (type, f, q, dest) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.connect(dest); nodes.push(b); return b; };
    const noise = (buf, dest) => { const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true; n.connect(dest); n.start(t, Math.random()); srcs.push(n); return n; };
    const track = (p) => {
      const g = gain(0, p);
      const lp = filt('lowpass', 300, 3, g);
      const o1 = osc('sawtooth', k.f), o2 = osc('square', k.f);
      const og = gain(0.5, lp);
      o1.connect(og);
      o2.connect(og);
      // 履帯のガチャガチャ:ノイズを LFO で刻む
      const clk = gain(0, p);
      const cg = gain(0, clk);
      noise(this.white, filt('bandpass', 2600, 1.5, cg));
      const lfo = osc('square', 4);
      lfo.connect(gain(0.5, cg.gain));
      cg.gain.value = 0.5;
      return { g, lp, o1, o2, clk, lfo };
    };
    const e = { k, local, out, pl, pr, pc, nodes, srcs, load: 0, step: 0 };
    e.L = track(pl);
    e.R = track(pr);
    e.subG = gain(0, pc);
    e.sub = osc('sine', k.f / 2);
    e.sub.connect(filt('lowpass', 120, 0.7, e.subG));
    // 軋み:帯域ノイズ+揺れる高音
    e.sqG = gain(0, pc);
    e.sqBp = filt('bandpass', 1800, 6, e.sqG);
    noise(this.white, e.sqBp);
    e.sqTone = osc('triangle', 800);
    const sqTg = gain(0.25, e.sqG);
    e.sqTone.connect(filt('bandpass', 1200, 4, sqTg));
    const vib = osc('sine', 13);
    vib.connect(gain(40, e.sqTone.frequency));
    if (o.kind === 'mech') {
      // サーボの唸り
      e.servoG = gain(0, pc);
      e.servo = osc('sawtooth', 1200);
      e.servo.connect(filt('bandpass', 1800, 8, e.servoG));
    }
    if (o.kind === 'boss') {
      // 巨大な地鳴り
      const rg = gain(0.9, pc);
      noise(this.brown, filt('lowpass', 90, 1, rg));
      const deep = osc('sawtooth', 18);
      deep.connect(filt('lowpass', 70, 2, gain(0.5, pc)));
    }
    return e;
  }

  removeEngine(id) {
    const e = this.engines.get(id);
    if (!e || !this.ctx) return;
    this.engines.delete(id);
    const t = this.ctx.currentTime;
    e.out.gain.cancelScheduledValues(t);
    e.out.gain.setTargetAtTime(0, t, 0.08);
    for (const s of e.srcs) s.stop(t + 0.5);
    setTimeout(() => {
      for (const n of [...e.srcs, ...e.nodes, e.out]) try { n.disconnect(); } catch { /* 済 */ }
    }, 700);
  }

  // activeIds に無いエンジンを止める(自車 local は残す)
  pruneEngines(activeIds) {
    const keep = activeIds instanceof Set ? activeIds : new Set(activeIds || []);
    for (const [id, e] of this.engines) if (!keep.has(id) && !e.local) this.removeEngine(id);
  }

  update(dt) {
    if (!this.ctx) return;
    // メカの足音(擦れる金属音+ドスン)
    for (const e of this.engines.values()) {
      if (!e.servo || !e.st) continue;
      if (e.load < 0.05) { e.step = 0; continue; }
      e.step += dt * (0.8 + 1.6 * e.load);
      if (e.step >= 1) {
        e.step -= 1;
        const o = { x: e.st.x, y: e.st.y, z: e.st.z, gain: e.local ? 0.5 : 0.8, muffle: !e.local };
        const v = this._voice(o);
        this._n(v, 0, 0.35, { f: 3200, f2: 1500, ft: 'bandpass', q: 3, peak: 0.25, a: 0.03 });
        this._t(v, 0, 0.3, { f: 70, f2: 35, peak: 0.6 });
        this._done(v);
      }
    }
  }

  // ===================== 効果音 =====================
  // ボイス:1 回分の音のまとまり。終わったら切断する
  _voice(o = {}, name) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = o.gain ?? 1;
    const v = { out, nodes: [out], end: 0, r: o.pitch || 1, s: clamp(o.strength ?? 0.7) };
    if (o.x != null) {
      const muffle = o.muffle ?? !OWN.has(name);
      const p = this._panner(o.x, o.y || 0, o.z || 0, o.ref || 6);
      out.connect(p).connect(muffle ? this.extBus : this.sfxBus);
      v.nodes.push(p);
      if (this.posVoices.length >= MAX_POS) this._kill(this.posVoices.shift());
      this.posVoices.push(v);
      v.pos = true;
    } else out.connect(this.sfxBus);
    v.t0 = ctx.currentTime + 0.005;
    return v;
  }
  _kill(v) {
    if (!v || v.dead) return;
    v.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    v.dead = true;
    setTimeout(() => this._free(v), 150);
  }
  _free(v) {
    for (const n of v.nodes) try { n.disconnect(); } catch { /* 済 */ }
    const i = this.posVoices.indexOf(v);
    if (i >= 0) this.posVoices.splice(i, 1);
  }
  _done(v) {
    setTimeout(() => { if (!v.freed) { v.freed = true; this._free(v); } }, (v.end + 0.3) * 1000);
  }
  _env(g, t0, a, peak, hold, dur) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    if (hold) g.gain.setValueAtTime(peak, t0 + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
  // 音程つき:{ type, f, f2(終わりの周波数), sw(スイープ時間), peak, a, hold, lp }
  _t(v, at, dur, { type = 'sine', f, f2, sw, peak = 0.5, a = 0.004, hold = 0, lp, q = 1 }) {
    const ctx = this.ctx, t0 = v.t0 + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f * v.r, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2 * v.r, t0 + (sw || dur));
    this._env(g, t0, a, peak, hold, dur);
    if (lp) {
      const b = ctx.createBiquadFilter();
      b.frequency.value = lp;
      b.Q.value = q;
      o.connect(b).connect(g);
      v.nodes.push(b);
    } else o.connect(g);
    g.connect(v.out);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
    v.nodes.push(o, g);
    v.end = Math.max(v.end, at + dur);
    return o;
  }
  // ノイズ:{ ft(フィルタ種類), f, f2, q, peak, a, hold, buf }
  _n(v, at, dur, { ft = 'lowpass', f = 1000, f2, q = 1, peak = 0.5, a = 0.003, hold = 0, buf }) {
    const ctx = this.ctx, t0 = v.t0 + at;
    const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = buf === 'brown' ? this.brown : this.white;
    s.loop = true;
    s.playbackRate.value = v.r;
    b.type = ft;
    b.Q.value = q;
    b.frequency.setValueAtTime(f, t0);
    if (f2) b.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    this._env(g, t0, a, peak, hold, dur);
    s.connect(b).connect(g).connect(v.out);
    s.start(t0, Math.random() * 1.5);
    s.stop(t0 + dur + 0.02);
    v.nodes.push(s, b, g);
    v.end = Math.max(v.end, at + dur);
    return b;
  }
  // 金属音:非整数倍の部分音
  _metal(v, at, dur, f, peak, parts = [1, 1.47, 2.09, 2.76, 3.9]) {
    parts.forEach((m, i) => this._t(v, at, dur * (1 - i * 0.12), { type: i ? 'sine' : 'triangle', f: f * m, peak: peak / (1 + i * 0.6) }));
  }

  play(name, opts = {}) {
    if (!this.ctx) return;
    const fn = SFX[name];
    if (!fn) return;
    const v = this._voice(opts, name);
    fn.call(this, v, v.s);
    this._done(v);
  }

  radio(on) {
    if (!this.ctx) return;
    const v = this._voice({ gain: 0.5 });
    this._t(v, 0, 0.012, { type: 'square', f: on ? 1400 : 900, peak: 0.3 });
    this._n(v, on ? 0.01 : 0, on ? 0.12 : 0.2, { ft: 'bandpass', f: 2200, q: 1.5, peak: 0.25, hold: on ? 0.05 : 0.1 });
    if (!on) this._t(v, 0.2, 0.01, { type: 'square', f: 700, peak: 0.2 });
    this._done(v);
  }

  speak(text, opts = {}) {
    if (!opts.enabled || typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      const u = new window.SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.rate = opts.rate ?? 1.1;
      u.volume = opts.volume ?? 1;
      if (opts.interrupt) window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* 非対応 */ }
  }

  // ===================== BGM =====================
  // BGM は曲のファイル(assets/bgm/<id>.m4a か <id>.wav、くり返して鳴らす 1 周)を流す。
  // 読み込むまでは合成で鳴らし、読み込めたらファイルに切りかえる(WAV は scripts/render-bgm.mjs で書き出せる)。
  // fallback を渡すと、id の曲のファイルが無いときにそちらを流す(アリーナごとの曲がまだ無いときなど)
  playMusic(id, fallback = null) {
    if (!this.ctx) { this._pendingMusic = id; this._pendingFallback = fallback; return; }
    if (this.musicId === id) return;
    this.musicId = id;
    this._stopWav(1.5);
    const ready = (k) => { const b = this._wavCache?.get(k); return b && b !== 'loading' && b !== 'none' ? b : null; };
    const buf = ready(id) || (this._wavCache?.get(id) === 'none' && fallback && ready(fallback));
    if (buf) { this.music.stop(1.5); this._playWav(id, buf, 1.5); return; }
    const synth = TRACKS[id] ? id : fallback;
    if (synth && TRACKS[synth]) this.music.play(synth, 1.5); else this.music.stop(1.5);
    this._loadWav(id)
      .then((b) => b || (fallback ? this._loadWav(fallback) : null))
      .then((b) => {
        if (!b || this.musicId !== id) return;
        this.music.stop(2);
        this._playWav(id, b, 2);
      });
  }
  _loadWav(id) {
    this._wavCache ||= new Map();
    const c = this._wavCache.get(id);
    if (c && c !== 'loading') return Promise.resolve(c === 'none' ? null : c);
    if (c === 'loading') return this._wavLoading.get(id);
    this._wavCache.set(id, 'loading');
    this._wavLoading ||= new Map();
    const get = (ext) => fetch(new URL(`../assets/bgm/${id}.${ext}`, import.meta.url))
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then((a) => this.ctx.decodeAudioData(a));
    const p = get('m4a').catch(() => get('wav'))
      .then((b) => { this._wavCache.set(id, b); return b; })
      .catch(() => { this._wavCache.set(id, 'none'); return null; });
    this._wavLoading.set(id, p);
    return p;
  }
  _playWav(id, buf, fade) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    // 書き出しで音割れしないよう下げてあるので、合成のときと同じくらいの大きさに戻す
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(2.4, t + fade);
    src.connect(g).connect(this.music.out);
    src.start(t);
    this._wav = { id, src, g };
  }
  _stopWav(fade = 1) {
    const w = this._wav;
    if (!w) return;
    this._wav = null;
    const t = this.ctx.currentTime;
    w.g.gain.cancelScheduledValues(t);
    w.g.gain.setValueAtTime(Math.max(0.0001, w.g.gain.value), t);
    w.g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, fade));
    w.src.stop(t + fade + 0.1);
  }
  stopMusic(fade = 1) {
    this._pendingMusic = null;
    this._pendingFallback = null;
    this.musicId = null;
    if (this.music) this.music.stop(fade);
    if (this.ctx) this._stopWav(fade);
  }
  jingle(id) {
    if (this.music) this.music.jingle(id);
  }
}

// 効果音レシピ(this = GameAudio、v = ボイス、s = 強さ 0..1)
const SFX = {
  cannon(v, s) {
    const d = 1 - 0.2 * s;
    this._t(v, 0, 1.1, { f: 95 * d, f2: 30, sw: 0.5, peak: 0.7 + 0.3 * s });
    this._t(v, 0, 1.4, { f: 48 * d, f2: 24, peak: 0.6 });
    this._n(v, 0, 0.9, { f: 2500, f2: 150, peak: 0.9, q: 0.7 });
    this._n(v, 0, 0.07, { ft: 'highpass', f: 1500, peak: 0.6 });
    this._n(v, 0.05, 1.6, { f: 200, f2: 60, peak: 0.5, buf: 'brown', a: 0.05 });
    // 薬莢の落ちる音
    this._metal(v, 0.35, 0.25, 2300, 0.07);
    this._metal(v, 0.5, 0.15, 2450, 0.035);
  },
  cannonEnemy(v) {
    this._t(v, 0, 0.7, { f: 110, f2: 40, sw: 0.3, peak: 0.7 });
    this._n(v, 0, 0.6, { f: 3000, f2: 200, peak: 0.8 });
    this._n(v, 0, 0.05, { ft: 'highpass', f: 2000, peak: 0.5 });
  },
  bigCannon(v) {
    this._t(v, 0, 2, { f: 70, f2: 20, sw: 0.8, peak: 1 });
    this._n(v, 0, 1.4, { f: 1800, f2: 80, peak: 1 });
    this._n(v, 0.05, 2.5, { f: 150, f2: 40, peak: 0.7, buf: 'brown', a: 0.1 });
    this._n(v, 0, 0.1, { ft: 'highpass', f: 1000, peak: 0.6 });
  },
  mg(v) {
    this._n(v, 0, 0.05, { ft: 'bandpass', f: 1300 * (0.9 + Math.random() * 0.2), q: 1.2, peak: 0.45 });
    this._t(v, 0, 0.045, { type: 'square', f: 170, f2: 70, peak: 0.25, lp: 900 });
  },
  mgEnemy(v) {
    this._n(v, 0, 0.04, { ft: 'bandpass', f: 1800, q: 1.5, peak: 0.4 });
    this._t(v, 0, 0.035, { type: 'square', f: 220, f2: 90, peak: 0.2, lp: 1200 });
  },
  lob(v) {
    this._t(v, 0, 0.35, { f: 130, f2: 45, peak: 0.8 });
    this._n(v, 0, 0.3, { f: 700, f2: 150, peak: 0.6 });
    this._n(v, 0.05, 0.5, { ft: 'bandpass', f: 900, f2: 2500, q: 2, peak: 0.08, a: 0.1 });
  },
  missile(v) {
    this._n(v, 0, 1.3, { ft: 'bandpass', f: 400, f2: 2600, q: 1.2, peak: 0.6, a: 0.04 });
    this._t(v, 0, 1.1, { type: 'sawtooth', f: 180, f2: 620, peak: 0.08, lp: 1500 });
    this._n(v, 0, 0.12, { f: 600, peak: 0.6 });
  },
  explosion(v) {
    this._n(v, 0, 1.3, { f: 3000, f2: 120, peak: 1 });
    this._t(v, 0, 0.9, { f: 75, f2: 28, peak: 0.8 });
    this._n(v, 0.05, 1.8, { f: 250, f2: 50, peak: 0.6, buf: 'brown', a: 0.05 });
    this._n(v, 0.2, 0.6, { ft: 'highpass', f: 3000, peak: 0.08, a: 0.1 }); // 破片
  },
  bigExplosion(v) {
    this._n(v, 0, 2.2, { f: 2500, f2: 60, peak: 1 });
    this._t(v, 0, 1.6, { f: 60, f2: 18, peak: 1 });
    this._n(v, 0.15, 1.8, { f: 1500, f2: 80, peak: 0.8 });
    this._n(v, 0.1, 3, { f: 180, f2: 35, peak: 0.8, buf: 'brown', a: 0.1 });
    this._n(v, 0.3, 1.2, { ft: 'highpass', f: 2500, peak: 0.1, a: 0.2 });
  },
  smallExplosion(v) {
    this._n(v, 0, 0.5, { f: 4000, f2: 300, peak: 0.8 });
    this._t(v, 0, 0.35, { f: 120, f2: 50, peak: 0.6 });
  },
  hit(v, s) {
    this._metal(v, 0, 0.7, 380 * (1 - 0.15 * s), 0.35 + 0.25 * s);
    this._n(v, 0, 0.08, { ft: 'highpass', f: 1200, peak: 0.8 });
    this._t(v, 0, 0.6, { f: 70, f2: 28, peak: 0.8 * (0.5 + s) });
    this._n(v, 0, 0.7, { f: 400, f2: 80, peak: 0.6, buf: 'brown' });
  },
  ricochet(v) {
    this._metal(v, 0, 0.3, 900, 0.3);
    this._t(v, 0.02, 0.45, { f: 3200, f2: 800, peak: 0.18 });
    this._n(v, 0, 0.04, { ft: 'highpass', f: 2500, peak: 0.5 });
  },
  impactGround(v) {
    this._t(v, 0, 0.3, { f: 85, f2: 40, peak: 0.7 });
    this._n(v, 0, 0.45, { f: 900, f2: 180, peak: 0.7 });
    this._n(v, 0.06, 0.4, { ft: 'highpass', f: 2500, peak: 0.08, a: 0.05 });
  },
  splash(v) {
    this._n(v, 0, 0.9, { ft: 'bandpass', f: 1600, f2: 500, q: 0.8, peak: 0.6, a: 0.03 });
    this._n(v, 0, 0.3, { f: 400, peak: 0.5 });
    this._n(v, 0.3, 0.8, { ft: 'highpass', f: 3000, peak: 0.08, a: 0.1 });
  },
  reload(v) {
    // ガチャン×2+チャイム
    this._t(v, 0, 0.09, { type: 'square', f: 150, f2: 90, peak: 0.4, lp: 900 });
    this._n(v, 0, 0.04, { ft: 'bandpass', f: 2500, q: 2, peak: 0.5 });
    this._t(v, 0.13, 0.1, { type: 'square', f: 110, f2: 70, peak: 0.45, lp: 800 });
    this._n(v, 0.13, 0.05, { ft: 'bandpass', f: 1800, q: 2, peak: 0.5 });
    this._t(v, 0.28, 0.5, { f: 1320, peak: 0.16 });
    this._t(v, 0.28, 0.5, { f: 1980, peak: 0.07 });
  },
  wake(v) {
    // 起動音+短いサイレン
    this._t(v, 0, 1, { type: 'sawtooth', f: 50, f2: 420, peak: 0.25, lp: 1600, q: 4, hold: 0.6 });
    this._t(v, 0, 1, { type: 'square', f: 25, f2: 210, peak: 0.12, lp: 800, hold: 0.6 });
    for (let i = 0; i < 2; i++) {
      const t = 0.95 + i * 0.22;
      this._t(v, t, 0.2, { type: 'triangle', f: 900, f2: 1700, sw: 0.1, peak: 0.3, hold: 0.08 });
    }
  },
  alarm(v) {
    for (let i = 0; i < 4; i++) this._t(v, i * 0.5, 0.48, { type: 'sawtooth', f: 480, f2: 1000, peak: 0.18, lp: 2500, hold: 0.35 });
  },
  gear(v) {
    this._n(v, 0, 0.06, { f: 1400, peak: 0.6 });
    this._t(v, 0, 0.12, { type: 'square', f: 95, f2: 55, peak: 0.35, lp: 600 });
    this._metal(v, 0.02, 0.08, 1700, 0.08);
  },
  click(v) {
    this._t(v, 0, 0.025, { f: 2600, peak: 0.15 });
    this._n(v, 0, 0.015, { ft: 'highpass', f: 3000, peak: 0.25 });
  },
  gateOpen(v) {
    this._n(v, 0, 2.1, { f: 380, peak: 0.6, a: 0.3, hold: 1.4, buf: 'brown' });
    this._t(v, 0, 2, { type: 'sawtooth', f: 42, f2: 38, peak: 0.25, lp: 300, a: 0.3, hold: 1.3 });
    this._n(v, 0.1, 1.8, { ft: 'bandpass', f: 1400, f2: 1100, q: 6, peak: 0.12, a: 0.2, hold: 1.2 });
    this._metal(v, 1.95, 0.6, 260, 0.4);
    this._t(v, 1.95, 0.5, { f: 70, f2: 30, peak: 0.7 });
  },
  elevator(v) {
    this._n(v, 0, 1, { ft: 'highpass', f: 2500, f2: 5000, peak: 0.35, a: 0.02 });
    this._t(v, 0.1, 2.2, { type: 'sawtooth', f: 70, f2: 220, peak: 0.22, lp: 700, a: 0.3, hold: 1.4 });
    this._n(v, 0.1, 2.2, { f: 200, peak: 0.4, buf: 'brown', a: 0.3, hold: 1.4 });
  },
  land(v) {
    this._t(v, 0, 0.6, { f: 75, f2: 28, peak: 0.9 });
    this._n(v, 0, 0.5, { f: 350, f2: 80, peak: 0.7 });
    this._metal(v, 0.02, 0.3, 300, 0.2);
  },
  trackBreak(v) {
    this._n(v, 0, 0.05, { ft: 'highpass', f: 1500, peak: 0.9 });
    this._t(v, 0, 0.18, { type: 'square', f: 320, f2: 80, peak: 0.3, lp: 1500 });
    this._metal(v, 0, 0.4, 700, 0.3);
    for (let i = 0; i < 6; i++) this._n(v, 0.12 + i * 0.07, 0.06, { ft: 'bandpass', f: 2200 + i * 150, q: 3, peak: 0.35 - i * 0.04 });
  },
  repair(v) {
    for (let i = 0; i < 8; i++) {
      this._n(v, i * 0.06, 0.03, { ft: 'bandpass', f: 3200, q: 4, peak: 0.4 });
      this._t(v, i * 0.06, 0.02, { type: 'square', f: 1400, peak: 0.05 });
    }
  },
  mine(v) {
    this._n(v, 0, 0.06, { f: 900, peak: 0.5 });
    this._t(v, 0.08, 0.08, { type: 'square', f: 1500, peak: 0.15, hold: 0.05 });
    this._t(v, 0.24, 0.08, { type: 'square', f: 1500, peak: 0.15, hold: 0.05 });
  },
  smoke(v) {
    this._t(v, 0, 0.14, { f: 220, f2: 60, peak: 0.6 });
    this._n(v, 0, 0.06, { f: 1200, peak: 0.6 });
    this._n(v, 0.05, 0.7, { ft: 'bandpass', f: 900, f2: 500, q: 0.7, peak: 0.25, a: 0.05 });
  },
  objective(v) {
    this._t(v, 0, 0.9, { f: 60, f2: 30, peak: 0.6 });
    [57, 60, 64, 69].forEach((m, i) => this._t(v, i * 0.07, 1.2 - i * 0.1, { type: 'triangle', f: 440 * 2 ** ((m - 69) / 12) * 2, peak: 0.12 }));
  },
  bonus(v) {
    [1047, 1319, 1568, 2093].forEach((f, i) => this._t(v, i * 0.06, 0.25, { type: 'square', f, peak: 0.07, lp: 4000 }));
  },
  ui(v) { this._t(v, 0, 0.05, { type: 'triangle', f: 900, peak: 0.15 }); },
  uiOk(v) {
    this._t(v, 0, 0.07, { type: 'square', f: 880, peak: 0.08, lp: 3000 });
    this._t(v, 0.07, 0.15, { type: 'square', f: 1320, peak: 0.08, lp: 3000 });
  },
  uiBack(v) {
    this._t(v, 0, 0.07, { type: 'square', f: 660, peak: 0.08, lp: 2000 });
    this._t(v, 0.07, 0.12, { type: 'square', f: 440, peak: 0.08, lp: 2000 });
  },
  countdown(v) { this._t(v, 0, 0.18, { type: 'square', f: 880, peak: 0.12, hold: 0.1, lp: 3000 }); },
  countdownGo(v) { this._t(v, 0, 0.6, { type: 'square', f: 1760, peak: 0.12, hold: 0.3, lp: 4000 }); },
  capture(v) {
    [523, 659, 784, 1047].forEach((f, i) => this._t(v, i * 0.09, 0.5 - i * 0.05, { type: 'sawtooth', f, peak: 0.08, lp: 3000 }));
    this._t(v, 0.36, 0.8, { f: 2093, peak: 0.08 });
  },
  flag(v) {
    this._t(v, 0, 0.12, { type: 'square', f: 784, peak: 0.1, lp: 3000 });
    this._t(v, 0.14, 0.35, { type: 'square', f: 1175, peak: 0.1, lp: 3000, hold: 0.2 });
  },
  drop(v) {
    this._n(v, 0, 1.6, { ft: 'bandpass', f: 300, f2: 2400, q: 1.5, peak: 0.5, a: 0.8 });
    this._t(v, 0, 1.6, { f: 900, f2: 200, peak: 0.1, a: 0.5 });
  },
  bossRoar(v) {
    for (const f of [55, 55.7, 82.5, 27.5]) {
      this._t(v, 0, 2.8, { type: 'sawtooth', f, f2: f * 0.9, peak: 0.22, lp: 700, q: 3, a: 0.25, hold: 1.6 });
    }
    this._n(v, 0, 3, { f: 300, f2: 80, peak: 0.6, buf: 'brown', a: 0.3, hold: 1.4 });
  },
  drill(v) {
    this._t(v, 0, 2.3, { type: 'sawtooth', f: 25, f2: 240, sw: 1.8, peak: 0.25, lp: 1200, a: 0.3, hold: 1.5 });
    this._t(v, 0, 2.3, { type: 'square', f: 12, f2: 120, sw: 1.8, peak: 0.12, lp: 600, a: 0.3, hold: 1.5 });
    this._n(v, 0, 2.3, { ft: 'bandpass', f: 300, f2: 3000, q: 3, peak: 0.3, a: 0.5, hold: 1.2 });
  },
  stomp(v) {
    this._t(v, 0, 0.7, { f: 55, f2: 22, peak: 1 });
    this._n(v, 0, 0.6, { f: 280, f2: 60, peak: 0.8, buf: 'brown' });
    this._metal(v, 0.05, 0.3, 180, 0.25);
  },
  crunch(v) {
    const n = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      this._n(v, Math.random() * 0.4, 0.06, { ft: 'bandpass', f: 600 + Math.random() * 2500, q: 2, peak: 0.3 });
    }
    this._metal(v, 0.1, 0.2, 900 + Math.random() * 600, 0.08);
  },
};
