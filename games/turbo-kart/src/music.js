// レース中の BGM（WebAudio でその場で演奏する）。曲はコースごと（songs.js。すべてオリジナル曲）
import { songFor } from './songs.js';

const LOOKAHEAD = 0.15; // 先にスケジュールしておく時間（秒）

const hz = (m) => 440 * 2 ** ((m - 69) / 12);

export class Music {
  constructor(audio) {
    this.audio = audio;
    this.volume = 0.6;
    this.playing = false;
    this.timer = null;
    this.setSong('thunder-ring');
  }

  // コースの曲に切り替える（演奏中なら頭から）
  setSong(trackId) {
    const song = songFor(trackId);
    if (song === this.song) return;
    this.song = song;
    this.stepLen = 60 / song.bpm / 4; // 16 分音符の長さ（秒）
    if (this.echo) this.echo.delayTime.value = this.stepLen * 3;
    this.step = 0;
  }

  // 0..1（0 で止める）
  setVolume(v) {
    this.volume = v;
    if (this.out) this.out.gain.setTargetAtTime(this.level(), this.audio.ctx.currentTime, 0.1);
    if (v <= 0) this.stop();
  }

  level() {
    return this.volume * 0.45 * (this.ducked ? 0.35 : 1);
  }

  // ポーズ中は小さくする
  duck(on) {
    this.ducked = on;
    if (this.out) this.out.gain.setTargetAtTime(this.level(), this.audio.ctx.currentTime, 0.2);
  }

  setup() {
    const ctx = this.audio.ctx;
    if (this.out || !ctx) return !!this.out;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(ctx.destination);
    // リード用のエコー（付点 8 分）
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = this.stepLen * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    this.echo.connect(fb).connect(this.echo);
    this.echo.connect(wet).connect(this.out);
    // ドラム用のノイズ
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  play() {
    if (this.volume <= 0 || !this.audio.ctx || !this.setup()) return;
    const ctx = this.audio.ctx;
    this.out.gain.cancelScheduledValues(ctx.currentTime);
    this.out.gain.setTargetAtTime(this.level(), ctx.currentTime, 0.3);
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.next = ctx.currentTime + 0.1;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  // fade: 秒（0 ですぐ止める）
  stop(fade = 0.8) {
    if (!this.playing) return;
    this.playing = false;
    const ctx = this.audio.ctx;
    this.out.gain.cancelScheduledValues(ctx.currentTime);
    this.out.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.01, fade / 3));
    clearInterval(this.timer);
    this.timer = null;
  }

  schedule() {
    const ctx = this.audio.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // タブが裏に回っていた後などは、遅れた分を飛ばす
    if (this.next < ctx.currentTime - 0.2) this.next = ctx.currentTime + 0.05;
    while (this.next < ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.next);
      this.step = (this.step + 1) % (this.song.bars.length * 16);
      this.next += this.stepLen;
    }
  }

  playStep(step, t) {
    const song = this.song;
    const STEP = this.stepLen;
    const bar = Math.floor(step / 16) % song.bars.length;
    const s = step % 16;
    const chords = song.bars[bar];
    const chord = chords.length > 1 && s >= 8 ? chords[1] : chords[0];
    const fill = bar % 8 === 7; // 8 小節目はフィル
    this.drums(song.drums, bar, s, t, fill);

    // ベース
    for (const [p, iv] of song.bass) if (p === s) this.bass(t, chord.b + iv, iv === 12 ? 1 : 0.85);

    // コード: 裏拍で短く刻み、小節の頭は少し長めに鳴らす（ハーフタイムの曲は長く伸ばすだけ）
    if (song.stabs.includes(s)) this.chord(t, chord.n, STEP * 1.3, 0.05);
    if (song.drums === 'half') {
      if (s === 0 || (s === 8 && chords.length > 1)) this.chord(t, chord.n, STEP * (chords.length > 1 ? 8 : 16), 0.03);
    } else if (s === 0 || (s === 8 && chords.length > 1)) this.chord(t, chord.n, STEP * 7, 0.025);

    // メロディ
    for (const [p, m, len] of song.melody[bar]) if (p === s) this.lead(t, m, len * STEP);
  }

  // ドラム（曲の型ごと）
  drums(style, bar, s, t, fill) {
    if (s === 0 && bar % 8 === 0) this.crash(t);
    if (style === 'four') {
      // 4 つ打ち: 毎拍キック、2・4 拍目にスネア、裏拍にオープンハイハット
      if (s % 4 === 0) this.kick(t);
      if (s === 4 || s === 12) this.snare(t);
      if (fill && s >= 12) this.snare(t, 0.6);
      this.hat(t, s % 4 === 2 ? 0.16 : 0.05, s % 4 === 2 ? 0.12 : 0.03);
    } else if (style === 'latin') {
      if (s === 0 || s === 8 || (s === 10 && bar % 2 === 1)) this.kick(t);
      if (s === 4 || s === 12) this.snare(t);
      if (fill && s >= 12) this.tom(t, 220 - (s - 12) * 35);
      else if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.16 : 0.08, s % 4 === 2 ? 0.09 : 0.03);
      if (s === 6 || s === 14 || (s === 11 && bar % 4 === 3)) this.cowbell(t);
    } else if (style === 'half') {
      // ハーフタイム: 小節の頭と 3 拍目の裏にキック、3 拍目にスネア（ゆったり大きなノリ）
      if (s === 0 || s === 10) this.kick(t);
      if (s === 8) this.snare(t);
      if (fill && s >= 12) this.tom(t, 200 - (s - 12) * 30);
      else if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.1 : 0.06, 0.04);
    } else {
      // ロック: 16 分のハイハット（8 分の裏を強く）、8 小節目はタムとスネアのフィル
      if (s === 0 || s === 6 || s === 8 || (s === 14 && bar % 2 === 1)) this.kick(t);
      if (s === 4 || s === 12) this.snare(t);
      if (fill && s >= 8) {
        if (s % 2 === 0) this.tom(t, 260 - (s - 8) * 22);
        else this.snare(t, 0.5);
      } else this.hat(t, s % 4 === 2 ? 0.14 : s % 2 === 0 ? 0.09 : 0.05, s % 4 === 2 ? 0.07 : 0.03);
    }
  }

  env(g, t, peak, attack, dur, release = 0.05) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(peak * 0.6, t + attack, dur * 0.4);
    g.gain.setTargetAtTime(0, t + dur, release);
  }

  // リリコン（ウインドシンセ）風のリード: 少しずらした 2 本ののこぎり波を、息で開くようなフィルターに通す。
  // 音の出だしは少し下からしゃくり上げ、長い音には遅れてビブラート
  lead(t, m, dur) {
    const type = this.song.lead;
    if (type === 'fm') this.leadFM(t, m, dur);
    else if (type === 'square' || type === 'saw') this.leadSynth(t, m, dur, type);
    else this.leadLyricon(t, m, dur);
  }

  leadLyricon(t, m, dur) {
    const STEP = this.stepLen;
    const ctx = this.audio.ctx;
    const f = hz(m);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(f * 2, t);
    lp.frequency.linearRampToValueAtTime(f * 7, t + 0.05);
    lp.frequency.setTargetAtTime(f * 4.5, t + 0.05, 0.15);
    const g = ctx.createGain();
    this.env(g, t, 0.13, 0.02, dur * 0.95, 0.05);
    lp.connect(g);
    g.connect(this.out);
    g.connect(this.echo);
    const oscs = [];
    for (const [type, det, vol] of [['sawtooth', -6, 1], ['sawtooth', 6, 1], ['square', 0, 0.35]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.setValueAtTime(det - 90, t);
      o.detune.linearRampToValueAtTime(det, t + 0.05);
      const og = ctx.createGain();
      og.gain.value = vol * 0.5;
      o.connect(og).connect(lp);
      oscs.push(o);
    }
    if (dur > STEP * 3) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 6;
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(18, t + Math.min(dur, 0.45));
      lfo.connect(lg);
      for (const o of oscs) lg.connect(o.detune);
      lfo.start(t);
      lfo.stop(t + dur + 0.4);
    }
    for (const o of oscs) {
      o.start(t);
      o.stop(t + dur + 0.4);
    }
  }

  // FM 音源風のリード（サイン波をサイン波で変調し、変調の深さを時間で減らすとブラス風の立ち上がりになる）
  leadFM(t, m, dur) {
    const ctx = this.audio.ctx;
    const f = hz(m);
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * 2;
    modGain.gain.setValueAtTime(f * 2.2, t);
    modGain.gain.setTargetAtTime(f * 0.7, t, 0.08);
    mod.connect(modGain).connect(car.frequency);
    if (dur > this.stepLen * 3) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 5.5;
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(dur, 0.5));
      lfo.connect(lg).connect(car.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.4);
    }
    const g = ctx.createGain();
    this.env(g, t, 0.16, 0.012, dur * 0.95, 0.06);
    car.connect(g);
    g.connect(this.out);
    g.connect(this.echo);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.4);
    mod.stop(t + dur + 0.4);
  }

  // シンセのリード: square = 矩形波（ゲーム機やシンセウェイブ風）、saw = 少しずらしたのこぎり波 3 本（ユーロビートやディスコ風の明るい音）
  leadSynth(t, m, dur, type) {
    const ctx = this.audio.ctx;
    const f = hz(m);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.5;
    lp.frequency.setValueAtTime(f * (type === 'saw' ? 10 : 6), t);
    lp.frequency.setTargetAtTime(f * (type === 'saw' ? 6 : 4), t, 0.2);
    const g = ctx.createGain();
    this.env(g, t, type === 'saw' ? 0.09 : 0.1, 0.008, dur * 0.92, 0.05);
    lp.connect(g);
    g.connect(this.out);
    g.connect(this.echo);
    const oscs = [];
    for (const det of type === 'saw' ? [-12, 0, 12] : [-4, 4]) {
      const o = ctx.createOscillator();
      o.type = type === 'saw' ? 'sawtooth' : 'square';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      oscs.push(o);
    }
    if (dur > this.stepLen * 3) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 5.8;
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(15, t + Math.min(dur, 0.4));
      lfo.connect(lg);
      for (const o of oscs) lg.connect(o.detune);
      lfo.start(t);
      lfo.stop(t + dur + 0.4);
    }
    for (const o of oscs) {
      o.start(t);
      o.stop(t + dur + 0.4);
    }
  }

  // カウベル（2 つの矩形波。ラテン風のリズムに）
  cowbell(t) {
    const ctx = this.audio.ctx;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 800;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    bp.connect(g).connect(this.out);
    for (const f of [540, 800]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(bp);
      o.start(t);
      o.stop(t + 0.16);
    }
  }

  // スラップ風のベース（のこぎり波 + フィルターを素早く閉じる）
  bass(t, m, vel) {
    const STEP = this.stepLen;
    const ctx = this.audio.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz(m);
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = hz(m) / 2;
    const subG = ctx.createGain();
    subG.gain.value = 0.35;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.setTargetAtTime(380, t, 0.05);
    const g = ctx.createGain();
    this.env(g, t, 0.2 * vel, 0.004, STEP * 1.6, 0.03);
    o.connect(lp);
    sub.connect(subG).connect(lp);
    lp.connect(g).connect(this.out);
    o.start(t);
    sub.start(t);
    o.stop(t + STEP * 2 + 0.2);
    sub.stop(t + STEP * 2 + 0.2);
  }

  // コード（少しずらした 2 本ののこぎり波でブラス / シンセのような厚み）
  chord(t, notes, dur, peak) {
    const ctx = this.audio.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.setTargetAtTime(1200, t, 0.12);
    const g = ctx.createGain();
    this.env(g, t, peak, 0.01, dur, 0.06);
    lp.connect(g).connect(this.out);
    for (const m of notes) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(m);
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.4);
      }
    }
  }

  kick(t) {
    const ctx = this.audio.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.32);
  }

  noiseHit(t, type, freq, q, peak, decay) {
    const ctx = this.audio.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.02);
  }

  snare(t, vel = 1) {
    this.noiseHit(t, 'bandpass', 1800, 0.8, 0.35 * vel, 0.18);
    const ctx = this.audio.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.12);
  }

  crash(t) {
    this.noiseHit(t, 'highpass', 5000, 0.5, 0.22, 1.2);
  }

  hat(t, peak, decay) {
    this.noiseHit(t, 'highpass', 8000, 0.7, peak, decay);
  }

  tom(t, f0) {
    const ctx = this.audio.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.27);
  }
}
