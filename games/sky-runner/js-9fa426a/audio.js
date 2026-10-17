// WebAudio で効果音と BGM をすべて合成する(外部音源ファイル不要)

let ctx = null, master = null, sfxBus = null, bgmBus = null, noiseBuf = null;
let muted = false, timer = null, step = 0, nextTime = 0;
let transpose = 0, tempo = 152;
let bgmEnabled = true, engineEnabled = true;

const MASTER_VOL = 0.6;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER_VOL;
  // 最終段のリミッター (BGM と効果音が重なっても音割れしないように)
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  master.connect(limiter).connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.8;
  sfxBus.connect(master);
  bgmBus = ctx.createGain();
  bgmBus.gain.value = 0.35;
  bgmBus.connect(master);

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function env(g, t, a, d, v) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function osc(type, f, t, dur, vol, bus, f2) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  env(g, t, 0.005, dur, vol);
  o.connect(g).connect(bus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(t, dur, vol, freq, bus, type = 'lowpass') {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  env(g, t, 0.003, dur, vol);
  src.connect(f).connect(g).connect(bus);
  src.start(t);
  src.stop(t + dur + 0.05);
}

const now = () => ctx.currentTime;

export const sfx = {
  shot() {
    if (!ctx) return;
    osc('square', 1500, now(), 0.07, 0.08, sfxBus, 350);
  },
  hit() {
    if (!ctx) return;
    osc('square', 260, now(), 0.06, 0.15, sfxBus, 120);
  },
  explode(big = false) {
    if (!ctx) return;
    const t = now();
    noise(t, big ? 1.3 : 0.45, big ? 0.9 : 0.5, big ? 900 : 1800, sfxBus);
    osc('sawtooth', big ? 140 : 220, t, big ? 0.9 : 0.3, 0.25, sfxBus, 30);
  },
  damage() {
    if (!ctx) return;
    const t = now();
    noise(t, 0.7, 0.8, 600, sfxBus);
    osc('sawtooth', 320, t, 0.7, 0.35, sfxBus, 40);
  },
  enemyShot() {
    if (!ctx) return;
    osc('triangle', 700, now(), 0.18, 0.12, sfxBus, 180);
  },
  // 近くを通り過ぎる風切り音 (ゴォッ)
  whoosh() {
    if (!ctx) return;
    const t = now();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.25);
    f.frequency.exponentialRampToValueAtTime(250, t + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.22);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    src.connect(f).connect(g).connect(sfxBus);
    src.start(t);
    src.stop(t + 0.8);
  },
  heal() {
    if (!ctx) return;
    const t = now();
    [72, 79, 84, 91].forEach((m, i) => osc('triangle', mtof(m), t + i * 0.06, 0.25, 0.2, sfxBus));
  },
  lowLife() {
    if (!ctx) return;
    const t = now();
    osc('square', 520, t, 0.08, 0.1, sfxBus);
    osc('square', 520, t + 0.14, 0.08, 0.1, sfxBus);
  },
  // 翼竜の鳴き声 (甲高く震えながら下がる)
  screech() {
    if (!ctx) return;
    const t = now();
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(2200, t);
    o.frequency.exponentialRampToValueAtTime(800, t + 0.7);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 28;
    const lg = ctx.createGain();
    lg.gain.value = 120;
    lfo.connect(lg).connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 2;
    const g = ctx.createGain();
    env(g, t, 0.03, 0.7, 0.25);
    o.connect(f).connect(g).connect(sfxBus);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.8);
    lfo.stop(t + 0.8);
  },
  // ボスの火炎放射 (ゴォーッという轟音)
  fireBreath() {
    if (!ctx) return;
    const t = now();
    noise(t, 1.7, 0.7, 700, sfxBus);
    noise(t, 1.5, 0.3, 2500, sfxBus, 'bandpass');
    osc('sawtooth', 70, t, 1.6, 0.25, sfxBus, 45);
  },
  // やられたときの叫び声「あーっ」: 声帯の音 (のこぎり波) を、母音「あ」の響き (フォルマント) に通す
  scream() {
    if (!ctx) return;
    const t = now(), dur = 1.4;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(330, t);
    o.frequency.linearRampToValueAtTime(380, t + 0.15);
    o.frequency.exponentialRampToValueAtTime(140, t + dur); // 落ちながら声が下がる
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6;
    const lg = ctx.createGain();
    lg.gain.value = 9;
    lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.06);
    g.gain.setValueAtTime(0.5, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // 「あ」のフォルマント (約 800Hz・1200Hz・2600Hz)
    for (const [f, q, v] of [[800, 8, 1], [1200, 9, 0.6], [2600, 10, 0.25]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const fg = ctx.createGain();
      fg.gain.value = v * 2.5;
      o.connect(bp).connect(fg).connect(g);
    }
    g.connect(sfxBus);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  },
  // 殻に弾が跳ね返される音 (キンッ)
  ricochet() {
    if (!ctx) return;
    const t = now();
    osc('triangle', 2600, t, 0.12, 0.12, sfxBus, 1800);
    osc('sine', 3900, t, 0.08, 0.06, sfxBus);
  },
  lock() {
    if (!ctx) return;
    osc('square', 1760, now(), 0.05, 0.08, sfxBus);
  },
  missile() {
    if (!ctx) return;
    const t = now();
    noise(t, 0.6, 0.6, 1200, sfxBus, 'bandpass');
    osc('sawtooth', 300, t, 0.5, 0.15, sfxBus, 900);
  },
  warning() {
    if (!ctx) return;
    const t = now();
    for (let i = 0; i < 4; i++) {
      osc('square', 880, t + i * 0.5, 0.22, 0.15, sfxBus);
      osc('square', 660, t + i * 0.5 + 0.25, 0.22, 0.15, sfxBus);
    }
  },
  clear() {
    if (!ctx) return;
    const t = now();
    [72, 76, 79, 84, 88, 91, 96].forEach((m, i) =>
      osc('square', mtof(m), t + i * 0.09, 0.3, 0.15, sfxBus));
  },
};

// ---- BGM: ハードロック (E マイナー、8小節ループ)
// 歪ませたギターのパワーコードで刻むリフ (A) と、リードギターが入るサビ (B)
let band = null;

function distCurve(k) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

// フェイザー: オールパスフィルターを6段重ね、原音と混ぜて谷 (ノッチ) を作る。
// 谷の周波数を LFO でゆっくり上下させると、音が「シュワーッ」とうねる
function phaser(input, rate, phase) {
  const out = ctx.createGain();
  const wet = ctx.createGain();
  wet.gain.value = 0.9;
  input.connect(out); // 原音
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rate;
  const depth = ctx.createGain();
  depth.gain.value = 750; // 中心 1000Hz から 250〜1750Hz まで動かす
  lfo.connect(depth);
  let node = input;
  for (let i = 0; i < 6; i++) {
    const ap = ctx.createBiquadFilter();
    ap.type = 'allpass';
    ap.frequency.value = 1000;
    ap.Q.value = 0.6;
    depth.connect(ap.frequency);
    node = node.connect(ap);
  }
  // フィードバックで谷を深くし、うねりを強調する (ループにはディレイが必要)
  const fbDelay = ctx.createDelay(0.01);
  fbDelay.delayTime.value = 0.0005;
  const fb = ctx.createGain();
  fb.gain.value = 0.45;
  node.connect(fbDelay).connect(fb).connect(input);
  node.connect(wet).connect(out);
  // 左右で LFO の位置をずらして始め、うねりが左右を回るようにする
  lfo.start(ctx.currentTime + phase / rate);
  return out;
}

// フランジャー: ごく短いディレイ (0.6〜10ms) を原音に重ねる。ディレイ時間を縮めていくと
// 櫛のように並んだ谷が高い方へ移動し、ジェット機のような「ギュイーン」という音になる。
// 普段は wet = 0 にしておき、曲の決まった場所でディレイ時間を動かしながらかける (flangerSweep)
function flanger(input) {
  const out = ctx.createGain();
  input.connect(out);
  const delay = ctx.createDelay(0.03);
  delay.delayTime.value = 0.01;
  const fb = ctx.createGain();
  fb.gain.value = 0.82; // 高めのフィードバックで、谷を深く鋭くする
  const wet = ctx.createGain();
  wet.gain.value = 0;
  input.connect(delay);
  delay.connect(fb).connect(delay);
  delay.connect(wet).connect(out);
  return { out, wet, delay };
}

// ワウ: バンドパスフィルター。中心周波数を動かすと「ワウワウ」としゃべるような音になる
function wah(input) {
  const out = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 2.4;
  filter.frequency.value = 600;
  const wet = ctx.createGain();
  wet.gain.value = 1.9; // バンドパスで細くなる分を補う
  const dry = ctx.createGain();
  dry.gain.value = 0.5; // 原音を多めに混ぜて、かかりを控えめにする
  input.connect(filter).connect(wet).connect(out);
  input.connect(dry).connect(out);
  return { out, filter };
}

// 入力 → 歪み → キャビネット風のフィルター → エフェクト → 定位 → 出力 の経路を作り、入力ノードを返す。
// fx = { phaser: {rate, phase}, flanger: true, wah: true }。操作用のノードは input.fx に入れる
function ampChain(drive, tone, level, pan, out, fx = {}) {
  const input = ctx.createGain();
  const sh = ctx.createWaveShaper();
  sh.curve = distCurve(drive);
  sh.oversample = '4x';
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 80;
  const low = ctx.createBiquadFilter();  // 低音弦の太さ
  low.type = 'peaking';
  low.frequency.value = 140;
  low.gain.value = 5;
  const mid = ctx.createBiquadFilter();  // 抜けの良い中域
  mid.type = 'peaking';
  mid.frequency.value = 1500;
  mid.Q.value = 0.8;
  mid.gain.value = 6;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = tone;
  const g = ctx.createGain();
  g.gain.value = level;
  let node = input.connect(sh).connect(hp).connect(low).connect(mid).connect(lp);
  input.fx = {};
  if (fx.wah) {
    input.fx.wah = wah(node);
    node = input.fx.wah.out;
  }
  if (fx.phaser) node = phaser(node, fx.phaser.rate, fx.phaser.phase);
  if (fx.flanger) {
    input.fx.flanger = flanger(node);
    node = input.fx.flanger.out;
  }
  node = node.connect(g);
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    node = node.connect(p);
  }
  node.connect(out);
  return input;
}

// バンドのミキサー: ギター (左右2本)・リード・ベース → コンプレッサー → BGM 出力、ドラム → BGM 出力
function ensureBand() {
  if (band) return;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 6;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.15;
  const makeup = ctx.createGain();
  makeup.gain.value = 1.5;
  comp.connect(makeup).connect(bgmBus);

  const bass = ctx.createGain();
  bass.gain.value = 0.35;
  const bassSh = ctx.createWaveShaper();
  bassSh.curve = distCurve(2.5);
  const bassLp = ctx.createBiquadFilter();
  bassLp.type = 'lowpass';
  bassLp.frequency.value = 1100;
  bass.connect(bassSh).connect(bassLp).connect(comp);

  // ドラムはコンプレッサーを通さず、アタックをつぶさない
  const drums = ctx.createGain();
  drums.gain.value = 1.9;
  drums.connect(bgmBus);

  band = {
    gtrL: ampChain(40, 4200, 0.3, -0.7, comp, { phaser: { rate: 0.22, phase: 0 }, flanger: true }),
    gtrR: ampChain(40, 4000, 0.3, 0.7, comp, { phaser: { rate: 0.26, phase: 0.5 }, flanger: true }),
    lead: ampChain(16, 5200, 0.4, 0, comp, { wah: true }),
    bass, drums,
  };
}

function sustainEnv(g, t, dur, vol) {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.004);
  g.gain.setValueAtTime(vol, t + dur * 0.75);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

// パワーコード (根音 + 5度 + オクターブ) を左右のギターで重ねて弾く。muted = ブリッジミュートの刻み
function powerChord(root, t, dur, muted, intervals = [0, 7, 12]) {
  for (const [side, det] of [[band.gtrL, -8], [band.gtrR, 9]]) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = muted ? 900 : 7000;
    lp.connect(side);
    for (const iv of intervals) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(root + iv);
      o.detune.value = det;
      const g = ctx.createGain();
      sustainEnv(g, t, dur, muted ? 0.8 : 0.5);
      o.connect(g).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
  }
}

// リードギター (ビブラートとワウ付き)
function leadNote(n, t, dur, spb, opts = {}) {
  // ワウ: 長い音は8分音符ごとに開閉して「ワウワウ」、短い音は1回だけ開く
  const f = band.lead.fx.wah.filter.frequency;
  f.cancelScheduledValues(t);
  if (opts.fixedWah) {
    f.setValueAtTime(opts.fixedWah, t); // 速弾きやスライドでは開いたままにする
  } else if (dur >= spb * 4) {
    const per = spb * 2;
    f.setValueAtTime(650, t);
    for (let x = t; x < t + dur - 0.01; x += per) {
      f.linearRampToValueAtTime(1500, x + per * 0.45);
      f.linearRampToValueAtTime(650, x + per);
    }
  } else {
    f.setValueAtTime(650, t);
    f.exponentialRampToValueAtTime(1400, t + Math.min(dur * 0.8, 0.15));
  }

  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = mtof(n);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.5;
  const lg = ctx.createGain();
  lg.gain.setValueAtTime(0, t);
  lg.gain.linearRampToValueAtTime(mtof(n) * (opts.vibrato ?? 0.012), t + Math.min(dur, 0.6)); // 伸ばすほど深くかかる
  lfo.connect(lg).connect(o.frequency);
  const g = ctx.createGain();
  sustainEnv(g, t, dur, opts.vol ?? 0.7);
  o.connect(g).connect(band.lead);
  o.start(t);
  lfo.start(t);
  o.stop(t + dur + 0.02);
  lfo.stop(t + dur + 0.02);
}

// スライド (ギュイーン): 音程を一気に駆け上がり、頂点で大きくビブラートをかける。
// ピッキングハーモニクス風に、1オクターブ+5度上の倍音を重ねてキュイッと鳴かせる
function slideUp(from, to, t, dur, riseRatio = 0.45) {
  const rise = dur * riseRatio;
  const f = band.lead.fx.wah.filter.frequency;
  f.cancelScheduledValues(t);
  f.setValueAtTime(900, t);
  f.exponentialRampToValueAtTime(2400, t + rise);
  for (const [mult, vol] of [[1, 0.75], [3, 0.22]]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(mtof(from) * mult, t);
    o.frequency.exponentialRampToValueAtTime(mtof(to) * mult, t + rise);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6.5;
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t + rise);
    lg.gain.linearRampToValueAtTime(mtof(to) * mult * 0.03, t + rise + (dur - rise) * 0.5);
    lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain();
    sustainEnv(g, t, dur, vol);
    o.connect(g).connect(band.lead);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.02);
    lfo.stop(t + dur + 0.02);
  }
}

// ベース: のこぎり波 + サイン波の低音を軽く歪ませる
function bassNote(n, t, dur) {
  for (const [type, vol] of [['sawtooth', 0.45], ['sine', 0.7]]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = mtof(n);
    const g = ctx.createGain();
    sustainEnv(g, t, dur, vol);
    o.connect(g).connect(band.bass);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}

function kick(t) {
  osc('sine', 170, t, 0.25, 1.2, band.drums, 42);    // 胴鳴り
  osc('square', 900, t, 0.012, 0.25, band.drums, 200); // アタック (ビーター)
  noise(t, 0.015, 0.4, 4000, band.drums);
}
function snare(t, vol = 1) {
  noise(t, 0.22, 0.9 * vol, 2200, band.drums, 'bandpass');
  noise(t, 0.08, 0.4 * vol, 6000, band.drums, 'highpass');
  osc('triangle', 230, t, 0.12, 0.6 * vol, band.drums, 160);
}
function hat(t, open) { noise(t, open ? 0.22 : 0.035, open ? 0.2 : 0.16, 8000, band.drums, 'highpass'); }
function crash(t) { noise(t, 1.6, 0.35, 4500, band.drums, 'highpass'); }

// リフの書き方: x = 刻み (ミュート)、X = 開放のアクセント (次の記号まで伸ばす)、. = 休み/伸ばし
// r = [前半の根音, 後半の根音] (ギターの MIDI ノート。E2 = 40)
const RIFF_A1 = 'x.x.x.x.X..xX...';
const RIFF_A2 = 'x.x.xX..x.x.X.X.';
const RIFF_B = 'X...X...X...X.x.';
const BARS = [
  { r: [40, 40], p: RIFF_A1 }, { r: [40, 43], p: RIFF_A2 }, { r: [48, 48], p: RIFF_A1 }, { r: [50, 47], p: RIFF_A2 },
  { r: [45, 45], p: RIFF_B }, { r: [48, 48], p: RIFF_B }, { r: [43, 50], p: RIFF_B }, { r: [40, 40], p: RIFF_A1 },
];
// リードギター: 小節ごとに [開始ステップ, ノート, 長さ(ステップ)]
const LEAD = [
  [], [], [], [],
  [[0, 76, 4], [4, 79, 2], [6, 81, 6], [12, 79, 2], [14, 76, 2]],
  [[0, 79, 4], [4, 81, 2], [6, 84, 6], [12, 83, 2], [14, 81, 2]],
  [[0, 83, 6], [6, 81, 2], [8, 79, 4], [12, 78, 4]],
  [],
];
// 速弾き: 小節ごとに { 開始ステップ, 1音の長さ (ステップ。2/3 = 1拍6連符), ノートの並び }
const H = (a) => a.flat();
const SHRED = {
  // 4小節目の後半: E ハーモニックマイナーで2オクターブ駆け上がってサビへ
  3: { start: 8, len: 2 / 3, notes: [64, 66, 67, 69, 71, 72, 75, 76, 78, 79, 81, 83] },
  // 8小節目の前半: 6音ずつ下がっていくシーケンス (ギュイーンの前まで)
  7: {
    start: 0, len: 2 / 3,
    notes: H([[88, 86, 83, 86, 83, 81], [86, 83, 81, 83, 81, 79]]), // 12音 = 8ステップ
  },
};
// ギュイーン (スライド): 8小節目の後半で3オクターブを1拍半かけて駆け上がり、
// 頂点でビブラートをかけたまま、ループの頭の1拍目まで伸ばす (12ステップ = 約1.2秒)
const SLIDES = { 7: { start: 8, from: 52, to: 88, len: 12, rise: 0.5 } };
const STEPS = BARS.length * 16;

// フランジャーをかける場所。ディレイ時間を 10ms → 0.6ms へ縮めて「ギュイーン」と上げる
//   3〜4小節目: 2小節かけて上がり、サビの頭でちょうど頂点に届く
//   8小節目: 1小節で上がり、ループの頭に戻る
function flangerSweep(barNo, t, barLen) {
  const sweep = barNo === 2 ? barLen * 2 : barNo === 7 ? barLen : 0;
  const off = barNo === 4 || barNo === 0;
  for (const [side, k] of [[band.gtrL, 1], [band.gtrR, 0.85]]) {
    const { wet, delay } = side.fx.flanger;
    const d = delay.delayTime;
    if (sweep) {
      d.cancelScheduledValues(t);
      d.setValueAtTime(0.01 * k, t);
      d.exponentialRampToValueAtTime(0.0006 * k, t + sweep);
      wet.gain.cancelScheduledValues(t);
      wet.gain.setValueAtTime(wet.gain.value, t);
      wet.gain.linearRampToValueAtTime(0.8, t + sweep * 0.25);
    }
    if (off) {
      wet.gain.cancelScheduledValues(t);
      wet.gain.setTargetAtTime(0, t, 0.12);
    }
  }
}

function playStep(s, t) {
  ensureBand();
  const barNo = Math.floor(s / 16), i = s % 16;
  const bar = BARS[barNo];
  const spb = 60 / tempo / 4;
  const root = bar.r[i < 8 ? 0 : 1] + transpose;

  // ギター
  const c = bar.p[i];
  if (c === 'x') powerChord(root, t, spb * 0.9, true);
  if (c === 'X') {
    let len = 1;
    while (i + len < 16 && bar.p[i + len] === '.') len++;
    powerChord(root, t, spb * len * 0.95, false);
  }
  // ベース: 8分で根音を刻む
  if (i % 2 === 0) bassNote(root - 12, t, spb * 1.8);
  // リード
  for (const [st, n, len] of LEAD[barNo]) if (st === i) leadNote(n + transpose, t, spb * len, spb);
  const sh = SHRED[barNo];
  if (sh && sh.start === i) {
    sh.notes.forEach((n, k) => leadNote(n + transpose, t + k * sh.len * spb, sh.len * spb * 1.05, spb, { fixedWah: 1700, vibrato: 0, vol: 0.6 }));
  }
  const sl = SLIDES[barNo];
  if (sl && sl.start === i) slideUp(sl.from + transpose, sl.to + transpose, t, sl.len * spb, sl.rise);
  if (i === 0) flangerSweep(barNo, t, spb * 16);
  // ドラム: 8ビート。サビは裏でもバスドラを踏む
  const chorus = barNo >= 4 && barNo < 7;
  if (i === 0 || i === 8 || (chorus && (i === 6 || i === 14)) || (!chorus && i === 10)) kick(t);
  if (i === 4 || i === 12) snare(t);
  if (barNo === 7 && i >= 12) snare(t, 0.5 + (i - 12) * 0.15); // フィル
  if (i % 2 === 0) hat(t, chorus && i % 4 === 2);
  if (i === 0 && (barNo === 0 || barNo === 4)) crash(t);
}

// ---- ボス戦の曲: 恐怖を感じさせる不協和音 (E ロクリアン、テンポ 126 の重いハーフタイム)
//   ・低い E と B♭ (三全音) の持続音を、少しずらした 2 音のうなりで鳴らし続ける
//   ・ギターは 5 度の代わりに三全音のパワーコードで、半音でうごめくリフを刻む
//   ・高音で半音ずつぶつかる和音 (クラスター) を震わせて突き刺す
//   ・倍音のずれた金属の鐘、後半は半音ずつ落ちていく悲鳴のようなリード
//   ・ドラムは心臓の鼓動のようなバスドラ、最後は連打とタムで盛り上げる
const BOSS_TEMPO = 126;
const BOSS_ROOTS = [40, 40, 41, 40, 46, 45, 46, 47]; // E E F E B♭ A B♭ B (ギターの根音)
const BOSS_RIFF = [
  'X..x.x..X..x.xx.', 'X..x.x..X..xx.x.', 'X..x.x..X..x.xx.', 'X...X...x.x.x.x.',
  'X..x.x..X..x.xx.', 'X..x.x..X..xx.x.', 'X..x.x..X...X...', 'xxxxxxxxX...X...',
];
const TRITONE = [0, 6, 12];
// 悲鳴のようなリード: [小節, 開始ステップ, ノート, 長さ]
const BOSS_LEAD = [
  [4, 0, 88, 6], [4, 6, 87, 2], [4, 8, 86, 8],
  [5, 0, 85, 6], [5, 6, 84, 2], [5, 8, 82, 8],
  [6, 0, 81, 4], [6, 4, 82, 4], [6, 8, 76, 8],
  [7, 8, 70, 2], [7, 10, 76, 2], [7, 12, 82, 4],
];
const BOSS_STEPS = BOSS_ROOTS.length * 16;

function drone(t, dur) {
  for (const [n, det] of [[28, 0], [28, 9], [34, -6], [34, 4]]) { // E1 と B♭1、少しずらしてうならせる
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(n);
    o.detune.value = det;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(180, t);
    lp.frequency.linearRampToValueAtTime(420, t + dur * 0.5); // じわじわ明るくなって迫る
    lp.frequency.linearRampToValueAtTime(180, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.3);
    g.gain.setValueAtTime(0.18, t + dur - 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(band.bass);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

// 半音でぶつかる高音の和音を、トレモロで震わせる
function clusterStab(t, dur, notes) {
  const out = ctx.createGain();
  out.gain.value = 0;
  const trem = ctx.createOscillator();
  trem.frequency.value = 13;
  const tremDepth = ctx.createGain();
  tremDepth.gain.value = 0.05;
  trem.connect(tremDepth).connect(out.gain);
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 5000;
  out.connect(lp).connect(bgmBus);
  for (const n of notes) {
    for (const det of [-12, 12]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(n);
      o.detune.value = det;
      o.connect(out);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }
  trem.start(t);
  trem.stop(t + dur + 0.05);
}

// 金属の鐘: 倍音が整数倍からずれているので、不気味に濁って響く
function bell(t, f) {
  for (const [mult, vol, len] of [[1, 0.25, 2.4], [2.76, 0.12, 1.6], [5.4, 0.08, 1.0], [8.93, 0.05, 0.6]]) {
    osc('sine', f * mult, t, len, vol, bgmBus);
  }
}

function tom(t, f) {
  osc('sine', f, t, 0.3, 0.8, band.drums, f * 0.5);
  noise(t, 0.05, 0.2, 1500, band.drums);
}

function bossStep(s, t) {
  ensureBand();
  const barNo = Math.floor(s / 16), i = s % 16;
  const spb = 60 / BOSS_TEMPO / 4;
  const root = BOSS_ROOTS[barNo];
  if (i === 0) drone(t, spb * 16);
  // ギター: 三全音のパワーコード
  const c = BOSS_RIFF[barNo][i];
  if (c === 'x') powerChord(root, t, spb * 0.9, true, TRITONE);
  if (c === 'X') {
    let len = 1;
    while (i + len < 16 && BOSS_RIFF[barNo][i + len] === '.') len++;
    powerChord(root, t, spb * len * 0.95, false, TRITONE);
  }
  // ベース: 根音と、半音上をうごめく
  if (i % 4 === 0) bassNote(root - 12 + (i === 12 ? 1 : 0), t, spb * 3.5);
  // 高音のクラスター (2 小節ごと) と鐘 (4 小節ごと)
  if (i === 0 && barNo % 2 === 1) clusterStab(t, spb * 7, [76, 77, 82, 83]);
  if (i === 8 && barNo % 2 === 0) clusterStab(t, spb * 3, [71, 72, 77]);
  if (i === 0 && barNo % 4 === 0) bell(t, 233);
  if (i === 8 && barNo % 4 === 2) bell(t, 165);
  // 悲鳴のようなリード (後半)
  for (const [b, st, n, len] of BOSS_LEAD) {
    if (b === barNo && st === i) leadNote(n, t, spb * len, spb, { fixedWah: 2200, vibrato: 0.03, vol: 0.55 });
  }
  // フランジャー: 4 小節目と 8 小節目でギュイーンと上げ、1・6 小節目で止める
  if (i === 0) flangerSweep({ 3: 2, 7: 7, 0: 0, 5: 4 }[barNo] ?? -1, t, spb * 16);
  // ドラム: 心臓の鼓動 (ドクッ、ドクン) とハーフタイムのスネア。最後の小節はバスドラの連打とタム
  if (barNo === 7) {
    if (i < 8) kick(t);
    if (i >= 8) tom(t, [180, 180, 150, 150, 120, 120, 95, 95][i - 8]);
  } else {
    if (i === 0 || i === 2 || i === 6 || i === 10 || (barNo % 2 === 1 && i === 14)) kick(t);
    if (i === 8) snare(t);
    if (i % 4 === 2) hat(t, false);
  }
  if (i === 0 && (barNo === 0 || barNo === 4)) crash(t);
}

// ---- ボーナスステージの曲: ポップで楽しい曲 (C メジャー、テンポ 160、C → G → Am → F)
//   歪ませない明るいシンセのメロディ、裏拍で跳ねるコード、弾むベース、鉄琴のアルペジオ、手拍子
const BONUS_TEMPO = 160;
const BONUS_CHORDS = [
  [36, [0, 4, 7]], [43, [0, 4, 7]], [45, [0, 3, 7]], [41, [0, 4, 7]],
  [36, [0, 4, 7]], [43, [0, 4, 7]], [45, [0, 3, 7]], [41, [0, 4, 7]],
];
// メロディ: 小節ごとに [開始ステップ, ノート, 長さ]
const BONUS_MEL = [
  [[0, 72, 2], [2, 76, 2], [4, 79, 4], [8, 81, 2], [10, 79, 2], [12, 76, 4]],
  [[0, 74, 2], [2, 79, 2], [4, 83, 4], [8, 81, 2], [10, 79, 2], [12, 74, 4]],
  [[0, 76, 2], [2, 81, 2], [4, 84, 4], [8, 83, 2], [10, 81, 2], [12, 79, 4]],
  [[0, 77, 2], [2, 81, 2], [4, 79, 2], [6, 77, 2], [8, 76, 4], [12, 74, 2], [14, 72, 2]],
  [[0, 84, 4], [4, 83, 2], [6, 84, 2], [8, 79, 4], [12, 76, 4]],
  [[0, 83, 4], [4, 81, 2], [6, 83, 2], [8, 79, 8]],
  [[0, 81, 2], [2, 83, 2], [4, 84, 2], [6, 86, 2], [8, 88, 4], [12, 84, 4]],
  [[0, 86, 2], [2, 84, 2], [4, 81, 2], [6, 77, 2], [8, 79, 4], [12, 83, 2], [14, 86, 2]],
];
const BONUS_STEPS = BONUS_CHORDS.length * 16;

// 明るいシンセのメロディ (2 つの矩形波を少しずらして重ね、ビブラートをかける)
function popLead(n, t, dur) {
  const g = ctx.createGain();
  sustainEnv(g, t, dur, 0.09);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4500;
  g.connect(lp).connect(bgmBus);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 6;
  const lg = ctx.createGain();
  lg.gain.setValueAtTime(0, t);
  lg.gain.linearRampToValueAtTime(mtof(n) * 0.01, t + Math.min(dur, 0.4));
  lfo.connect(lg);
  for (const [type, det, mul] of [['square', -6, 1], ['square', 7, 1], ['triangle', 0, 2]]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = mtof(n) * mul;
    o.detune.value = det;
    lg.connect(o.frequency);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  lfo.start(t);
  lfo.stop(t + dur + 0.02);
}

function popStab(notes, t, dur) {
  for (const n of notes) osc('sawtooth', mtof(n), t, dur, 0.035, bgmBus);
}

function clap(t) {
  for (const dt of [0, 0.012, 0.024]) noise(t + dt, 0.06, 0.35, 1500, band.drums, 'bandpass');
}

function bonusStep(s, t) {
  ensureBand();
  const barNo = Math.floor(s / 16), i = s % 16;
  const spb = 60 / BONUS_TEMPO / 4;
  let [root, chord] = BONUS_CHORDS[barNo];
  if (barNo === 7 && i >= 8) root = 43; // 最後の小節の後半は G へ (頭に戻る準備)
  // ベース: 根音・5度・オクターブを跳ねるように
  const bassPat = [0, null, 12, null, 7, null, 12, 7, 0, null, 12, null, 7, 12, 7, null];
  if (bassPat[i] !== null) osc('square', mtof(root - 12 + bassPat[i]), t, spb * 0.9, 0.11, band.bass);
  // 裏拍で跳ねるコード
  if (i % 4 === 2) popStab(chord.map((c) => root + 24 + c), t, spb * 0.8);
  // メロディ
  for (const [st, n, len] of BONUS_MEL[barNo]) if (st === i) popLead(n, t, spb * len * 0.95);
  // 鉄琴のアルペジオ (キラキラ)
  if (i % 2 === 1) {
    const arp = [0, 4, 7, 12, 7, 4, 12, 16];
    osc('sine', mtof(root + 48 + chord[0] + arp[(i >> 1) % arp.length] - (chord[1] === 3 && arp[(i >> 1) % arp.length] === 4 ? 1 : 0)), t, 0.3, 0.05, bgmBus);
  }
  // ドラム: バスドラ、手拍子 (2・4 拍目)、16 分のハイハット
  if (i === 0 || i === 8 || (barNo % 2 === 1 && i === 10)) kick(t);
  if (i === 4 || i === 12) clap(t);
  hat(t, i % 4 === 2);
  if (barNo === 7 && i >= 12) snare(t, 0.4 + (i - 12) * 0.15);
  if (i === 0 && barNo % 4 === 0) crash(t);
}

let song = 'rock';

function schedule() {
  const songs = {
    rock: [playStep, tempo, STEPS],
    boss: [bossStep, BOSS_TEMPO, BOSS_STEPS],
    bonus: [bonusStep, BONUS_TEMPO, BONUS_STEPS],
  };
  const [play, bpm, steps] = songs[song];
  const spb = 60 / bpm / 4;
  while (nextTime < ctx.currentTime + 0.12) {
    // 1ステップの演奏でエラーが出ても、BGM 全体が止まらないように次へ進める
    try { play(step, nextTime); } catch (e) { console.error(e); }
    nextTime += spb;
    step = (step + 1) % steps;
  }
}

export function startBGM() {
  if (!ctx || timer || !bgmEnabled) return;
  step = 0;
  nextTime = ctx.currentTime + 0.1;
  timer = setInterval(schedule, 25);
}

export function stopBGM() {
  clearInterval(timer);
  timer = null;
}

export function setBGMEnabled(on) {
  bgmEnabled = on;
  if (!on) stopBGM();
}

// 曲を切り替える (曲の頭から)。mode: 'rock' (通常) | 'boss' | 'bonus'。true / false はボス戦 / 通常。
// opts: { key, tempo } 通常の曲のキー (半音) とテンポ (ステージごとに上げる)
export function setBGMMode(mode, opts) {
  const next = mode === true ? 'boss' : mode === false ? 'rock' : mode;
  if (opts) {
    transpose = opts.key || 0;
    tempo = opts.tempo || 152;
  }
  if (next === song) return;
  song = next;
  step = 0;
  // フランジャーを止めておく (前の曲の途中でかかっていた場合)
  if (band) for (const side of [band.gtrL, band.gtrR]) side.fx.flanger.wet.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
}

// ポーズ中は音をすべて止める (BGM の位置もそのまま止まる)
export function setPaused(p) {
  if (!ctx) return;
  if (p) ctx.suspend();
  else ctx.resume();
}

// ---- エンジン音: 低い風切り音。速度が上がるほど音が高く、明るく、大きくなる (level 0 で無音)
// 中〜高音域のノイズは水の流れ、うなりのある2音は鳥のさえずりのように聞こえるので使わない
let eng = null;

export function setEngine(level) {
  if (!ctx) return;
  if (!engineEnabled) level = 0;
  if (!eng) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.5;
    const lp2 = ctx.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.Q.value = 0.5;
    const hum = ctx.createOscillator();
    hum.type = 'triangle';
    const humGain = ctx.createGain();
    humGain.gain.value = 0.25;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(lp).connect(lp2).connect(g);
    hum.connect(humGain).connect(g);
    g.connect(sfxBus);
    src.start();
    hum.start();
    eng = { lp, lp2, hum, g };
  }
  const t = ctx.currentTime;
  eng.lp.frequency.setTargetAtTime(160 + level * 260, t, 0.2);
  eng.lp2.frequency.setTargetAtTime(220 + level * 320, t, 0.2);
  eng.hum.frequency.setTargetAtTime(48 + level * 24, t, 0.2);
  eng.g.gain.setTargetAtTime(level > 0 ? 0.12 + level * 0.12 : 0, t, 0.25);
}

export function setEngineEnabled(on) {
  engineEnabled = on;
  if (!on) setEngine(0);
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : MASTER_VOL;
  return muted;
}

export function say(text) {
  try {
    if (!window.speechSynthesis || muted) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.pitch = 0.7;
    u.rate = 1.0;
    speechSynthesis.speak(u);
  } catch (_) { /* 音声合成が使えない環境では無視 */ }
}
