// レース中の BGM（WebAudio でその場で演奏する）。80〜90 年代のレース中継のテーマのような、
// 疾走感のあるフュージョンロックのオリジナル曲。リリコン（ウインドシンセ）風のリード、8 分で刻むベース、
// 裏拍のブラス風コード、16 分のハイハット
const BPM = 150;
const STEP = 60 / BPM / 4; // 16 分音符の長さ（秒）
const LOOKAHEAD = 0.15; // 先にスケジュールしておく時間（秒）

const hz = (m) => 440 * 2 ** ((m - 69) / 12);

// コード進行（1 小節に 1 つか 2 つ）。b: ベースの音、n: コードの構成音（MIDI 番号）
const C = {
  Dmaj7: { b: 38, n: [62, 66, 69, 73] },
  Em7: { b: 40, n: [64, 67, 71, 74] },
  A: { b: 45, n: [61, 64, 69, 73] },
  A7: { b: 45, n: [61, 64, 67, 69] },
  A7sus: { b: 45, n: [62, 64, 67, 69] },
  A6: { b: 45, n: [61, 64, 66, 69] },
  Fsm7: { b: 42, n: [61, 64, 66, 69] },
  Bm7: { b: 47, n: [62, 66, 69, 71] },
  Gmaj7: { b: 43, n: [62, 66, 67, 71] },
};
const BARS = [
  // A: 王道進行（IV → V → iii → vi）で一気に走り出す
  [C.Gmaj7], [C.A6], [C.Fsm7], [C.Bm7], [C.Em7], [C.Fsm7], [C.Gmaj7], [C.A7sus, C.A7],
  // B: サビ。最後は D に解決して頭へ戻る
  [C.Gmaj7], [C.A], [C.Bm7], [C.Bm7, C.A6], [C.Gmaj7], [C.A], [C.Em7, C.A7], [C.Dmaj7],
];
// メロディ: 小節ごとに [16 分音符の位置, 音, 長さ]
const MELODY = [
  [[0, 71, 3], [3, 74, 3], [6, 76, 2], [8, 78, 4], [12, 76, 2], [14, 74, 2]],
  [[0, 73, 6], [6, 71, 2], [8, 69, 4], [12, 71, 2], [14, 73, 2]],
  [[0, 73, 3], [3, 76, 3], [6, 73, 2], [8, 69, 6], [14, 66, 2]],
  [[0, 69, 4], [4, 71, 4], [8, 66, 8]],
  [[0, 67, 2], [2, 69, 2], [4, 71, 2], [6, 74, 2], [8, 76, 3], [11, 74, 3], [14, 71, 2]],
  [[0, 73, 4], [4, 69, 2], [6, 73, 2], [8, 76, 6], [14, 78, 2]],
  [[0, 79, 6], [6, 78, 2], [8, 76, 2], [10, 74, 2], [12, 71, 4]],
  [[0, 74, 8], [8, 73, 4], [12, 76, 2], [14, 78, 2]],
  [[0, 79, 4], [4, 78, 2], [6, 76, 2], [8, 74, 4], [12, 71, 4]],
  [[0, 73, 3], [3, 76, 3], [6, 78, 2], [8, 76, 8]],
  [[0, 74, 2], [2, 73, 2], [4, 71, 4], [8, 73, 2], [10, 74, 2], [12, 76, 4]],
  [[0, 78, 6], [6, 76, 2], [8, 73, 8]],
  [[0, 71, 3], [3, 74, 3], [6, 78, 2], [8, 81, 6], [14, 79, 2]],
  [[0, 78, 4], [4, 76, 4], [8, 73, 4], [12, 76, 4]],
  [[0, 74, 4], [4, 76, 4], [8, 78, 4], [12, 79, 4]],
  [[0, 78, 12], [12, 74, 2], [14, 76, 2]],
];
// ベース: [位置, ルートからの半音]（8 分で刻み、ところどころオクターブで跳ねる）
const BASS = [[0, 0], [2, 0], [3, 12], [4, 0], [6, 0], [8, 0], [10, 0], [11, 12], [12, 0], [14, 7]];
// コードを短く刻む位置（裏拍を強調）
const STABS = [3, 6, 10, 14];

export class Music {
  constructor(audio) {
    this.audio = audio;
    this.volume = 0.6;
    this.playing = false;
    this.timer = null;
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
    this.echo.delayTime.value = STEP * 3;
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
      this.step = (this.step + 1) % (BARS.length * 16);
      this.next += STEP;
    }
  }

  playStep(step, t) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chords = BARS[bar];
    const chord = chords.length > 1 && s >= 8 ? chords[1] : chords[0];
    const fill = bar % 8 === 7; // 8 小節目はタムのフィル

    // ドラム: 頭と 8 小節ごとにクラッシュ、16 分のハイハット（8 分の裏を強く）
    if (s === 0 && bar % 8 === 0) this.crash(t);
    if (s === 0 || s === 6 || s === 8 || (s === 14 && bar % 2 === 1)) this.kick(t);
    if (s === 4 || s === 12) this.snare(t);
    if (fill && s >= 8) {
      if (s % 2 === 0) this.tom(t, 260 - (s - 8) * 22);
      else this.snare(t, 0.5);
    } else this.hat(t, s % 4 === 2 ? 0.14 : s % 2 === 0 ? 0.09 : 0.05, s % 4 === 2 ? 0.07 : 0.03);

    // ベース
    for (const [p, iv] of BASS) if (p === s) this.bass(t, chord.b + iv, iv === 12 ? 1 : 0.85);

    // コード: 裏拍で短く刻み、小節の頭は少し長めに鳴らす
    if (STABS.includes(s)) this.chord(t, chord.n, STEP * 1.3, 0.05);
    if (s === 0 || (s === 8 && chords.length > 1)) this.chord(t, chord.n, STEP * 7, 0.025);

    // メロディ
    for (const [p, m, len] of MELODY[bar]) if (p === s) this.lead(t, m, len * STEP);
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

  // スラップ風のベース（のこぎり波 + フィルターを素早く閉じる）
  bass(t, m, vel) {
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
