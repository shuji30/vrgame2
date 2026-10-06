// レース中の BGM（WebAudio でその場で演奏する）。80 年代のアーケードのドライブゲーム風の、
// 明るいフュージョン調のオリジナル曲。FM 音源風のリード、スラップ風のベース、シンコペーションのコード、ラテン風のドラム
const BPM = 132;
const STEP = 60 / BPM / 4; // 16 分音符の長さ（秒）
const LOOKAHEAD = 0.15; // 先にスケジュールしておく時間（秒）

const hz = (m) => 440 * 2 ** ((m - 69) / 12);

// コード進行（1 小節に 1 つか 2 つ）。b: ベースの音、n: コードの構成音（MIDI 番号）
const C = {
  Dmaj7: { b: 38, n: [62, 66, 69, 73] },
  Em7: { b: 40, n: [64, 67, 71, 74] },
  A7: { b: 45, n: [61, 64, 67, 69] },
  A7sus: { b: 45, n: [62, 64, 67, 69] },
  A6: { b: 45, n: [61, 64, 66, 69] },
  Fsm7: { b: 42, n: [61, 64, 66, 69] },
  Bm7: { b: 47, n: [62, 66, 69, 71] },
  Gmaj7: { b: 43, n: [62, 66, 67, 71] },
  Fs7: { b: 42, n: [61, 64, 66, 70] },
};
const BARS = [
  // A
  [C.Dmaj7], [C.Em7, C.A7], [C.Fsm7], [C.Bm7], [C.Gmaj7], [C.Fsm7], [C.Em7], [C.A7sus, C.A7],
  // B
  [C.Gmaj7], [C.A6], [C.Fsm7], [C.Bm7], [C.Em7], [C.Fs7], [C.Gmaj7, C.A7], [C.Dmaj7],
];
// メロディ: 小節ごとに [16 分音符の位置, 音, 長さ]
const MELODY = [
  [[0, 81, 3], [3, 78, 3], [6, 76, 2], [8, 78, 6], [14, 81, 2]],
  [[0, 83, 2], [2, 81, 2], [4, 79, 4], [8, 76, 2], [10, 79, 2], [12, 81, 4]],
  [[0, 85, 4], [4, 83, 2], [6, 81, 4], [10, 78, 6]],
  [[0, 74, 2], [2, 76, 2], [4, 78, 2], [6, 81, 2], [8, 83, 8]],
  [[0, 86, 3], [3, 83, 3], [6, 79, 2], [8, 81, 4], [12, 83, 4]],
  [[0, 85, 3], [3, 81, 3], [6, 78, 2], [8, 76, 4], [12, 78, 4]],
  [[0, 79, 2], [2, 81, 2], [4, 83, 2], [6, 86, 4], [10, 88, 6]],
  [[0, 86, 6], [6, 85, 2], [8, 83, 2], [10, 81, 6]],
  [[0, 83, 6], [6, 86, 2], [8, 85, 6], [14, 83, 2]],
  [[0, 81, 8], [8, 78, 4], [12, 81, 4]],
  [[0, 85, 6], [6, 88, 2], [8, 86, 6], [14, 85, 2]],
  [[0, 83, 8], [8, 81, 2], [10, 83, 2], [12, 86, 4]],
  [[0, 88, 4], [4, 86, 2], [6, 83, 4], [10, 79, 2], [12, 81, 4]],
  [[0, 82, 4], [4, 85, 4], [8, 88, 4], [12, 90, 4]],
  [[0, 91, 4], [4, 90, 2], [6, 86, 2], [8, 88, 4], [12, 85, 4]],
  [[0, 86, 10], [12, 81, 2], [14, 85, 2]],
];
// ベース: [位置, ルートからの半音]（オクターブで跳ねるファンク風）
const BASS = [[0, 0], [3, 12], [4, 0], [6, 0], [8, 0], [10, 12], [11, 7], [14, 0], [15, 12]];
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

    // ドラム
    if (s === 0 || s === 8 || (s === 10 && bar % 2 === 1)) this.kick(t);
    if (s === 4 || s === 12) this.snare(t);
    if (fill && s >= 12) this.tom(t, 220 - (s - 12) * 35);
    else if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.16 : 0.08, s % 4 === 2 ? 0.09 : 0.03);
    if (s === 6 || s === 14 || (s === 11 && bar % 4 === 3)) this.cowbell(t);

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

  // FM 音源風のリード（サイン波をサイン波で変調し、変調の深さを時間で減らすとブラス風の立ち上がりになる）
  lead(t, m, dur) {
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
    // 長い音は少し遅れてビブラート
    if (dur > STEP * 3) {
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

  snare(t) {
    this.noiseHit(t, 'bandpass', 1800, 0.8, 0.35, 0.18);
    const ctx = this.audio.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.12);
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
}
