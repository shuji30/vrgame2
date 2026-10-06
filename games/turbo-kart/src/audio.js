// 効果音（WebAudio で合成）: エンジン・スキール・路面ノイズ・衝突・カウントダウン
export class KartAudio {
  constructor() {
    this.ctx = null;
  }

  // ユーザー操作のハンドラ内で呼ぶ
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    // エンジン: のこぎり波 2 本 + ローパス
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 900;
    this.engFilter.Q.value = 4;
    this.engFilter.connect(this.engGain).connect(this.master);
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const o2g = ctx.createGain();
    o2g.gain.value = 0.35;
    this.osc1.connect(this.engFilter);
    this.osc2.connect(o2g).connect(this.engFilter);
    this.osc1.start();
    this.osc2.start();

    // ノイズ（スキール・路面）
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const mk = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { f, g };
    };
    this.skid = mk('bandpass', 1800, 6);
    this.road = mk('lowpass', 300, 0.7);
    this.wind = mk('highpass', 2500, 0.5);
  }

  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  // 毎フレーム: kart の状態から音を更新
  update(kart, speed, throttle, active, vehicle = 'kart') {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    const set = (param, v, tc = 0.05) => param.setTargetAtTime(v, t, tc);
    if (!active) {
      set(this.engGain.gain, 0, 0.1);
      set(this.skid.g.gain, 0, 0.05);
      set(this.road.g.gain, 0, 0.1);
      set(this.wind.g.gain, 0, 0.1);
      return;
    }
    const rpm = Math.min(1.1, kart.rpm);
    // 車種ごとのエンジン音: GT3 は低く太く、フォーミュラは高く鋭く
    const [lo, span] = { kart: [55, 190], gt3: [38, 150], drift: [48, 210], formula: [90, 420] }[vehicle] || [55, 190];
    const base = lo + rpm * span + (kart.boost > 0 ? 25 : 0);
    set(this.osc1.frequency, base, 0.03);
    set(this.osc2.frequency, base * 0.5, 0.03);
    set(this.engFilter.frequency, 500 + throttle * 1400 + rpm * 800, 0.05);
    set(this.engGain.gain, 0.08 + throttle * 0.1, 0.05);
    const skid = speed > 6 ? Math.min(1, Math.max(0, (kart.slip - 0.12) * 4)) : 0;
    set(this.skid.g.gain, kart.surface === 'dirt' || kart.surface === 'grass' ? 0 : skid * 0.12, 0.04);
    let roadVol = Math.min(1, speed / 25) * 0.08;
    let roadHz = 300;
    if (kart.surface === 'dirt') { roadVol *= 3; roadHz = 700; }
    else if (kart.surface === 'grass') { roadVol *= 2.2; roadHz = 450; }
    else if (kart.surface === 'rough' || kart.surface === 'curb') { roadVol *= 2.2; roadHz = 220; }
    set(this.road.g.gain, roadVol, 0.05);
    set(this.road.f.frequency, roadHz, 0.1);
    set(this.wind.g.gain, Math.min(1, speed / 30) ** 2 * 0.05, 0.1);
  }

  thump(strength) {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(Math.min(0.6, 0.1 + strength * 0.08), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.25);
  }

  beep(high) {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = high ? 1320 : 660;
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (high ? 0.6 : 0.25));
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.7);
  }

  whoosh() {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(3000, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.7);
  }

  // コインを拾った音（ピコーン: 2 音の短い上昇）
  coin() {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const [f, d] of [[988, 0], [1319, 0.07]]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.18);
      o.connect(g).connect(this.master);
      o.start(t + d);
      o.stop(t + d + 0.2);
    }
  }

  // コミカルなぶつかり音（ボヨーン: 音程が下がるバネの音）
  boing(strength = 1) {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.35);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 22;
    const lg = ctx.createGain();
    lg.gain.value = 40;
    lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.35, 0.12 + strength * 0.03), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g).connect(this.master);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.42);
    lfo.stop(t + 0.42);
  }

  // 順位が上がった音（ピロリン）
  up() {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [784, 988, 1175].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.06);
      g.gain.exponentialRampToValueAtTime(0.14, t + i * 0.06 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.2);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.06);
      o.stop(t + i * 0.06 + 0.22);
    });
  }

  // ルーレットのカチッという音
  tick() {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.04);
  }

  // ルーレットが止まって当たり（ファンファーレ）
  jackpot() {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [[523, 0], [659, 0.08], [784, 0.16], [1047, 0.24], [1047, 0.36]].forEach(([f, d]) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.16, t + d + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.22);
      o.connect(g).connect(this.master);
      o.start(t + d);
      o.stop(t + d + 0.24);
    });
  }

  // アイテムボックスを割った音（キラキラ）
  itemBox() {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [1568, 2093, 2637, 3136].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.035);
      g.gain.exponentialRampToValueAtTime(0.08, t + i * 0.035 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.035 + 0.15);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.035);
      o.stop(t + i * 0.035 + 0.17);
    });
  }

  // カミナリ（低いノイズの轟き）
  thunder() {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 1.5);
  }

  silence() {
    if (this.ctx) this.update(null, 0, 0, false);
  }
}
