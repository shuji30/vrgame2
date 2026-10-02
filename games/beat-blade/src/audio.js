// WebAudio によるリアルタイム作曲・演奏と効果音。
// 曲の時刻は AudioContext の時計を基準にするので、映像（ノーツ位置）と音が自然に同期する。
// AudioContext が使えない／ブロックされている場合は performance.now() の時計で無音進行する。
import { sectionAt } from './core/songs.js';
import { mulberry32, hashString } from './core/rng.js';

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
const LOOKAHEAD_SEC = 0.3;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.song = null;
    this.playing = false;
    this.paused = false;
    this.useClock = false;
    this.musicVolume = 0.75;
    this.sfxVolume = 0.9;
  }

  // ユーザー操作のハンドラ内から呼ぶ（自動再生ポリシー対策）
  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 4;
      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(comp).connect(ctx.destination);
      this.music = ctx.createGain();
      this.music.gain.value = this.musicVolume;
      this.music.connect(this.master);
      this.sfx = ctx.createGain();
      this.sfx.gain.value = this.sfxVolume;
      this.sfx.connect(this.master);
      // リード用ディレイ
      this.delay = ctx.createDelay(1.5);
      this.delayFb = ctx.createGain();
      this.delayFb.gain.value = 0.33;
      this.delayOut = ctx.createGain();
      this.delayOut.gain.value = 0.5;
      this.delay.connect(this.delayFb).connect(this.delay);
      this.delay.connect(this.delayOut).connect(this.music);
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended' && !this.paused) this.ctx.resume();
  }

  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  // ---- 曲の再生 ----

  playSong(song) {
    this.stop(true);
    this.song = song;
    this.rng = mulberry32(hashString(song.id + ':music'));
    this.sec16 = 60 / song.bpm / 4;
    this.totalSteps = song.bars * 16;
    this.nextStep = 0;
    this.playing = true;
    this.paused = false;
    this.lastTime = 0;
    if (this.ctx && this.ctx.state !== 'closed') {
      // resume() 直後で suspended のままでも、再開すれば時計が進むのでそのまま使う
      this.useClock = false;
      this.realStart = performance.now();
      this.bus = this.ctx.createGain();
      this.bus.connect(this.music);
      this.delay.delayTime.value = this.sec16 * 3;
      this.latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
      this.startTime = this.ctx.currentTime + 0.2;
      this.update();
    } else {
      this.useClock = true;
      this.clockStart = performance.now() / 1000 + 0.2;
      this.pausedTotal = 0;
    }
  }

  // 曲の経過秒（曲頭 = 0）
  songTime() {
    if (!this.playing) return this.lastTime;
    let t;
    if (this.useClock) {
      const now = this.paused ? this.pauseAt : performance.now() / 1000;
      t = now - this.clockStart - this.pausedTotal;
    } else {
      t = this.ctx.currentTime - this.startTime - this.latency;
    }
    this.lastTime = t;
    return t;
  }

  pause() {
    if (!this.playing || this.paused) return;
    this.paused = true;
    if (this.useClock) this.pauseAt = performance.now() / 1000;
    else this.ctx.suspend();
  }

  resume() {
    if (!this.playing || !this.paused) return;
    this.paused = false;
    if (this.useClock) this.pausedTotal += performance.now() / 1000 - this.pauseAt;
    else {
      this.realStart = performance.now();
      this.ctx.resume();
    }
  }

  stop(immediate = false) {
    if (this.bus) {
      const bus = this.bus;
      const t = this.ctx.currentTime;
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(0, t + (immediate ? 0.05 : 0.8));
      setTimeout(() => bus.disconnect(), 1200);
      this.bus = null;
    }
    if (this.paused && this.ctx && !this.useClock) this.ctx.resume();
    this.playing = false;
    this.paused = false;
  }

  // 毎フレーム呼ぶ。少し先までの音符をスケジュールする
  update() {
    if (!this.playing || this.useClock || this.paused || !this.bus) return;
    if (this.ctx.state !== 'running') {
      // 自動再生がブロックされたままなら無音の時計に切り替える
      if (performance.now() - this.realStart > 800) this.fallbackToClock();
      return;
    }
    const horizon = this.ctx.currentTime + LOOKAHEAD_SEC;
    while (this.nextStep < this.totalSteps && this.startTime + this.nextStep * this.sec16 < horizon) {
      const t = this.startTime + this.nextStep * this.sec16;
      if (t >= this.ctx.currentTime - 0.05) this.scheduleStep(this.nextStep, t);
      this.nextStep++;
    }
  }

  fallbackToClock() {
    const t = this.songTime();
    this.useClock = true;
    this.pausedTotal = 0;
    this.clockStart = performance.now() / 1000 - t;
    this.bus.disconnect();
    this.bus = null;
  }

  // 16 分音符 1 つ分の演奏内容
  scheduleStep(i, time) {
    const s = this.song;
    const bar = Math.floor(i / 16);
    const st = i % 16;
    const sec = sectionAt(s, bar);
    const e = sec.energy;
    const chord = s.progression[bar % s.progression.length];
    const nextSec = sectionAt(s, bar + 1);
    const fillBar = nextSec !== sec && nextSec.energy > e && bar + 1 < s.bars;
    const lastBar = bar === s.bars - 1;

    if (st === 0 && bar === sec.from && e >= 0.7) this.crash(time);
    if (lastBar) {
      if (st === 0) {
        this.kick(time, 1);
        this.crash(time);
        this.pad(time, chord.map((n) => midiToFreq(s.rootMidi + 12 + n)), this.sec16 * 16, 0.08);
        this.bass(time, midiToFreq(s.rootMidi + chord[0]), this.sec16 * 12, 0.3);
      }
      return;
    }

    // ドラム
    const kickOn = e >= 0.5 ? st % 4 === 0 : e >= 0.3 && st % 8 === 0;
    if (kickOn) this.kick(time, 0.95);
    if (e >= 0.5 && (st === 4 || st === 12)) this.snare(time, 0.45);
    if (fillBar && st >= 8) this.snare(time, 0.12 + (st - 8) * 0.035);
    if (e >= 0.4 && st % 4 === 2) this.hat(time, 0.16, e >= 0.9 ? 0.14 : 0.05);
    if (e >= 0.9 && st % 2 === 1) this.hat(time, 0.06, 0.03);

    // ベース
    if (e >= 0.4) {
      if (st % 2 === 0) {
        const oct = st % 4 === 2 ? 12 : 0;
        this.bass(time, midiToFreq(s.rootMidi + chord[0] + oct), this.sec16 * 1.7, e >= 0.9 ? 0.3 : 0.24);
      }
    } else if (st === 0) {
      this.bass(time, midiToFreq(s.rootMidi + chord[0]), this.sec16 * 14, 0.18);
    }

    // パッド
    if (st === 0) {
      this.pad(time, chord.map((n) => midiToFreq(s.rootMidi + 12 + n)), this.sec16 * 16, 0.045 + 0.03 * (1 - e));
    }

    // リード
    const tones = [chord[0], chord[1], chord[2], chord[0] + 12];
    if (e >= 0.8) {
      const every = e >= 1 ? 1 : 2;
      if (st % every === 0) {
        const pat = [0, 1, 2, 3, 2, 1, 2, 3];
        const idx = pat[(st / every) % pat.length];
        const up = (bar % 2 === 1 && st >= 8) ? 12 : 0;
        this.lead(time, midiToFreq(s.rootMidi + 24 + tones[idx] + up), this.sec16 * every * 0.9, 0.05);
      }
    } else if (e >= 0.55 && st % 4 === 0 && this.rng() < 0.75) {
      const n = tones[Math.floor(this.rng() * tones.length)];
      this.lead(time, midiToFreq(s.rootMidi + 24 + n), this.sec16 * 3.5, 0.045);
    }
  }

  // ---- 楽器 ----

  env(g, t, vol, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  kick(t, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    this.env(g, t, vol, 0.003, 0.38);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.45);
  }

  noise(t, { type, freq, q = 1, vol, decay, dest, attack = 0.002 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, vol, attack, decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + decay + 0.05);
    return f;
  }

  snare(t, vol) {
    this.noise(t, { type: 'bandpass', freq: 1900, q: 0.8, vol, decay: 0.18, dest: this.bus });
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    this.env(g, t, vol * 0.6, 0.002, 0.1);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.15);
  }

  hat(t, vol, decay) {
    this.noise(t, { type: 'highpass', freq: 8000, vol, decay, dest: this.bus });
  }

  crash(t) {
    this.noise(t, { type: 'highpass', freq: 4500, vol: 0.16, decay: 1.4, dest: this.bus });
  }

  bass(t, freq, dur, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 5;
    f.frequency.setValueAtTime(1100, t);
    f.frequency.exponentialRampToValueAtTime(180, t + Math.min(dur, 0.3));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  pad(t, freqs, dur, vol) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.35);
    g.gain.setValueAtTime(vol, t + dur * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
    f.connect(g).connect(this.bus);
    for (const fr of freqs) {
      for (const det of [-8, 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = fr;
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.3);
      }
    }
  }

  lead(t, freq, dur, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(900, t + dur);
    const g = ctx.createGain();
    this.env(g, t, vol, 0.004, dur);
    o.connect(f).connect(g);
    g.connect(this.bus);
    g.connect(this.delay);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---- 効果音 ----

  panner(x) {
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (!p) return this.sfx;
    p.pan.value = Math.max(-1, Math.min(1, x));
    p.connect(this.sfx);
    return p;
  }

  slice(x = 0, quality = 1) {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    const dest = this.panner(x);
    const f = this.noise(t, { type: 'bandpass', freq: 4200, q: 1.2, vol: 0.32, decay: 0.14, dest });
    f.frequency.exponentialRampToValueAtTime(700, t + 0.12);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.value = 1800 + 900 * quality;
    this.env(g, t, 0.12, 0.001, 0.05);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.08);
  }

  bad(x = 0) {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.18);
    this.env(g, t, 0.22, 0.003, 0.2);
    o.connect(g).connect(this.panner(x));
    o.start(t);
    o.stop(t + 0.25);
  }

  miss() {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    this.noise(t, { type: 'lowpass', freq: 350, vol: 0.12, decay: 0.12, dest: this.sfx });
  }

  bomb(x = 0) {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    const dest = this.panner(x);
    this.noise(t, { type: 'lowpass', freq: 700, vol: 0.5, decay: 0.6, dest });
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    this.env(g, t, 0.6, 0.003, 0.55);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.6);
  }

  click() {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.value = 1100;
    this.env(g, t, 0.15, 0.001, 0.05);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.08);
  }

  fail() {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 1.0);
    this.env(g, t, 0.25, 0.01, 1.0);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 1.1);
  }
}
