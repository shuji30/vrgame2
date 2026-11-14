// BGM シーケンサー(すべて WebAudio で合成。外部音源なし)
// 先読みスケジューラ:25ms ごとに 0.1 秒先までの音を予約する

const SC = {
  min: [0, 2, 3, 5, 7, 8, 10],
  dor: [0, 2, 3, 5, 7, 9, 10],
  phr: [0, 1, 3, 5, 7, 8, 10],
  hm: [0, 2, 3, 5, 7, 8, 11],
  maj: [0, 2, 4, 5, 7, 9, 11],
};
const CH = { m: [0, 3, 7, 12], M: [0, 4, 7, 12], s: [0, 5, 7, 12], p: [0, 7, 12, 19], d: [0, 3, 6, 12] };
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 曲データ:prog は「根音のずれ(半音)+和音の種類」、16 文字の文字列は 16 分音符 1 小節
// bass: o=根音 8=1オクターブ上 5=5度 3=3度 7=短7度 .=休 -=伸ばす
// lead: 「音階度数:長さ(16分)」、_ は休符
export const TRACKS = {
  title: {
    bpm: 96, root: 43, sc: 'min', prog: ['0m', '8M', '10M', '7M'], introNoDrums: true,
    bass: 'o-----o-8-----5-', kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.xo',
    arp: '0123', arpRate: 2, pad: 0.55,
    lead: ['4:6 3:2 2:4 0:4', '2:8 3:4 4:4', '5:6 4:2 3:4 4:4', '6:4 7:4 4:8'],
  },
  area1: {
    bpm: 128, root: 40, sc: 'min', prog: ['0m', '8M', '3M', '10M'],
    bass: 'o.o8o.o8o.o8o5o8', kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...xo',
    arp: '0121', arpRate: 1, pad: 0.35,
    lead: ['4:4 3:2 2:2 0:8', '2:4 3:4 4:6 _:2', '5:6 4:2 3:4 2:4', '1:4 2:4 -1:8'],
  },
  area2: {
    bpm: 118, root: 41, sc: 'hm', prog: ['0m', '0m', '8M', '7M'],
    bass: 'o..o..o.o..o..58', kick: 'x..x..x...x.....', snare: '....x.......x..x', hat: 'xxx.xxx.xxx.xx.x',
    arp: '0.2.1.3.', arpRate: 1, pad: 0.3,
    lead: ['0:2 1:2 2:4 _:8', '4:2 3:2 2:4 1:8', '0:2 1:2 2:4 4:4 5:4', '6:8 4:8'],
  },
  area3: {
    bpm: 110, root: 38, sc: 'dor', prog: ['0m', '5M', '0m', '10M'],
    bass: 'o.....o.5.....o.', kick: 'x.....x...x.....', snare: '....x.......x...', hat: '..x...x...x...x.',
    arp: '01230123', arpRate: 2, pad: 0.5,
    lead: ['2:8 4:4 5:4', '4:12 _:4', '7:6 6:2 5:4 4:4', '3:8 2:8'],
  },
  area4: {
    bpm: 100, root: 36, sc: 'phr', prog: ['0m', '1M', '0m', '10m'],
    bass: 'o.oo..o.o.oo.1o.', kick: 'x..x..x.x..x..x.', snare: '....X.......X...', hat: 'x.xxx.xxx.xxx.xo',
    arp: '0..0..1.', arpRate: 1, pad: 0.4,
    lead: ['0:4 1:4 0:8', '_:8 4:4 3:4', '0:4 1:4 3:4 1:4', '0:16'],
  },
  boss: {
    bpm: 150, root: 33, sc: 'phr', prog: ['0m', '1M', '3M', '1M'],
    bass: 'o8o8o8o8o8o8o8o8', kick: 'x.x.x.x.x.x.x.x.', snare: '....X..x....X.xx', hat: 'xxxxxxxxxxxxxxxx',
    arp: '0123', arpRate: 1, pad: 0.35,
    lead: ['7:4 8:4 7:2 6:2 4:4', '7:4 8:4 9:8', '7:2 6:2 4:2 3:2 4:8', '1:8 0:8'],
  },
  versus: {
    bpm: 140, root: 35, sc: 'min', prog: ['0m', '10M', '8M', '10M'],
    bass: 'o.8.o.8.o.8.5.8.', kick: 'x...x...x...x.x.', snare: '....x.......x...', hat: 'xoxoxoxoxoxoxoxo',
    arp: '012321', arpRate: 1, pad: 0.3,
    lead: ['0:2 2:2 4:4 7:8', '6:4 4:4 5:8', '4:2 5:2 6:4 7:4 9:4', '8:8 7:8'],
  },
  training: {
    bpm: 96, root: 38, sc: 'dor', prog: ['0m', '3M', '5M', '3M'],
    bass: 'o...o.5.o...o.5.', kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.',
    arp: '0213', arpRate: 2, pad: 0.45,
    lead: ['4:8 5:4 4:4', '2:16', '4:4 5:4 6:4 7:4', '5:16'],
  },
};

// ジングル:[拍, MIDI, 長さ(拍), 楽器(l=リード p=和音 b=ベース k=キック s=スネア c=シンバル)]
const JINGLES = {
  clear: { bpm: 120, n: [
    [0, 55, 0.5, 'l'], [0.5, 60, 0.5, 'l'], [1, 64, 0.5, 'l'], [1.5, 67, 1.5, 'l'], [0, 36, 2, 'b'], [0, 0, 0, 'k'],
    [3, 65, 0.5, 'l'], [3.5, 69, 0.5, 'l'], [4, 72, 3.5, 'l'], [3, 41, 1, 'b'], [4, 36, 3.5, 'b'],
    [4, 60, 3.5, 'p'], [4, 64, 3.5, 'p'], [4, 67, 3.5, 'p'], [4, 0, 0, 'c'], [4, 0, 0, 'k'], [2.5, 0, 0, 's'], [3, 0, 0, 's'],
  ] },
  fail: { bpm: 90, n: [
    [0, 64, 1, 'l'], [1, 63, 1, 'l'], [2, 62, 1, 'l'], [3, 57, 1.5, 'l'], [0, 33, 4, 'b'],
    [3, 57, 1.5, 'p'], [3, 60, 1.5, 'p'], [3, 63, 1.5, 'p'], [0, 0, 0, 'k'], [3, 0, 0, 'k'],
  ] },
  start: { bpm: 140, n: [
    [0, 52, 0.25, 'l'], [0.5, 52, 0.25, 'l'], [1, 55, 0.25, 'l'], [1.5, 57, 0.25, 'l'], [2, 64, 2, 'l'],
    [0, 28, 0.25, 'b'], [0.5, 28, 0.25, 'b'], [1, 31, 0.25, 'b'], [1.5, 33, 0.25, 'b'], [2, 40, 2, 'b'],
    [2, 52, 2, 'p'], [2, 55, 2, 'p'], [2, 59, 2, 'p'], [0, 0, 0, 'k'], [1, 0, 0, 's'], [1.5, 0, 0, 's'], [2, 0, 0, 'c'], [2, 0, 0, 'k'],
  ] },
  bossAppear: { bpm: 100, n: [
    [0, 33, 0.5, 'b'], [0, 34, 0.5, 'p'], [0, 39, 0.5, 'p'], [0, 0, 0, 'k'],
    [1, 33, 0.5, 'b'], [1, 34, 0.5, 'p'], [1, 40, 0.5, 'p'], [1, 0, 0, 'k'],
    [2, 33, 2, 'b'], [2, 45, 2, 'p'], [2, 46, 2, 'p'], [2, 52, 2, 'p'], [2, 57, 2, 'l'], [2, 0, 0, 'c'], [2, 0, 0, 'k'],
  ] },
};

function parseLead(bars) {
  // 小節ごとに [開始16分, 度数, 長さ] の配列へ
  return bars.map((s) => {
    let pos = 0;
    const out = [];
    for (const tok of s.trim().split(/\s+/)) {
      const [d, l] = tok.split(':');
      const len = +l || 4;
      if (d !== '_') out.push([pos, +d, len]);
      pos += len;
    }
    return out;
  });
}
const degToSemi = (sc, d) => {
  const o = Math.floor(d / 7);
  return sc[((d % 7) + 7) % 7] + 12 * o;
};

export class MusicPlayer {
  constructor(ctx, out, noiseBuf) {
    this.ctx = ctx;
    this.noise = noiseBuf;
    this.bus = out;
    this.out = ctx.createGain();
    this.out.connect(out);
    // 80年代風のディレイ(アルペジオとリード用)
    this.fx = ctx.createDelay(1.5);
    this.fxFb = ctx.createGain();
    this.fxFb.gain.value = 0.32;
    const fxLp = ctx.createBiquadFilter();
    fxLp.frequency.value = 2500;
    this.fxIn = ctx.createGain();
    this.fxIn.gain.value = 0.35;
    this.fxIn.connect(this.fx);
    this.fx.connect(fxLp).connect(this.fxFb).connect(this.fx);
    fxLp.connect(this.out);
    this.songs = [];
    this.cur = null;
    this.timer = null;
  }

  play(id, fade = 1.5) {
    if (this.cur && this.cur.id === id) return;
    const tr = TRACKS[id];
    if (!tr) return;
    this.stop(fade);
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(1, ctx.currentTime + fade);
    g.connect(this.out);
    const lead = parseLead(tr.lead);
    this.fx.delayTime.value = (60 / tr.bpm) * 0.75; // 付点8分
    const s = { id, tr, lead, g, sc: SC[tr.sc], next: ctx.currentTime + 0.05, step: 0, end: Infinity };
    this.songs.push(s);
    this.cur = s;
    this._start();
  }

  stop(fade = 1) {
    const s = this.cur;
    this.cur = null;
    if (!s) return;
    const t = this.ctx.currentTime;
    s.g.gain.cancelScheduledValues(t);
    s.g.gain.setValueAtTime(Math.max(0.0001, s.g.gain.value), t);
    s.g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, fade));
    s.end = t + fade;
  }

  // 現在の曲を一時的に下げる(ジングル用)
  duck(dur, level = 0.25) {
    const p = this.out.gain, t = this.ctx.currentTime;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(level, t, 0.05);
    p.setTargetAtTime(1, t + dur, 0.4);
  }

  jingle(id) {
    const j = JINGLES[id];
    if (!j) return;
    const ctx = this.ctx, b = 60 / j.bpm, t0 = ctx.currentTime + 0.05;
    let len = 0;
    const g = ctx.createGain();
    g.gain.value = 1.1;
    g.connect(this.bus);
    for (const [beat, m, d, ins] of j.n) {
      const t = t0 + beat * b, dur = d * b;
      len = Math.max(len, beat * b + dur);
      if (ins === 'l') this.lead(g, t, m, dur, 0.22, true);
      else if (ins === 'p') this.padNote(g, t, m, dur, 0.09);
      else if (ins === 'b') this.bass(g, t, m, dur, 0.4);
      else if (ins === 'k') this.kick(g, t, 1);
      else if (ins === 's') this.snare(g, t, 0.8);
      else if (ins === 'c') this.cymbal(g, t);
    }
    this.duck(len + 0.3);
    setTimeout(() => g.disconnect(), (len + 3) * 1000);
  }

  _start() {
    if (this.timer) return;
    this.timer = setInterval(() => this._tick(), 25);
  }

  _tick() {
    const now = this.ctx.currentTime;
    for (const s of this.songs) {
      while (s.next < now + 0.1 && s.next < s.end) {
        this._step(s, s.step, s.next);
        s.step++;
        s.next += 60 / s.tr.bpm / 4;
      }
    }
    const alive = [];
    for (const s of this.songs) {
      if (now > s.end + 0.5) s.g.disconnect();
      else alive.push(s);
    }
    this.songs = alive;
    if (!alive.length) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // 1 ステップ(16分音符)分の発音
  _step(s, n, t) {
    const tr = s.tr, st = 60 / tr.bpm / 4, i = n % 16, bar = Math.floor(n / 16);
    const L = tr.prog.length, bi = bar % L, sec = Math.floor(bar / L) % 4;
    const ch = tr.prog[bi], off = parseInt(ch, 10), q = CH[ch.replace(/^-?\d+/, '')] || CH.m;
    const intro = sec === 0 && bar < L;
    const brk = sec === 3;
    const g = s.g;
    const lastBar = bi === L - 1;
    // ドラム
    const noDrums = intro && tr.introNoDrums;
    if (!noDrums) {
      const fill = lastBar && i >= 12 && (sec === 1 || sec === 3);
      if (fill) {
        this.snare(g, t, 0.4 + (i - 12) * 0.15);
        if (i % 2 === 0) this.tom(g, t, 140 - (i - 12) * 15);
      } else {
        const k = tr.kick[i], sn = tr.snare[i], h = tr.hat[i];
        if (k !== '.' && !(brk && bi < 2)) this.kick(g, t, k === 'X' ? 1 : 0.85);
        if (sn !== '.' && !brk) this.snare(g, t, sn === 'X' ? 1 : 0.7);
        if (sn !== '.' && brk && i === 12) this.snare(g, t, 0.5);
        if (h !== '.') this.hat(g, t, h === 'o', i % 4 === 2 ? 0.9 : 0.55);
      }
      if (i === 0 && bi === 0 && bar > 0) this.cymbal(g, t);
    }
    // ベース
    const bc = tr.bass[i];
    if (bc && bc !== '.' && bc !== '-' && !(intro && tr.introNoDrums && i % 8)) {
      let len = 1;
      while (tr.bass[i + len] === '-') len++;
      let m = tr.root + off;
      while (m > tr.root + 7) m -= 12;
      m += { o: 0, 8: 12, 5: 7, 3: q[1], 7: 10, 1: 1 }[bc] ?? 0;
      this.bass(g, t, m, len * st * 0.92, 0.38);
    }
    // パッド(小節頭で 1 小節分)
    if (i === 0 && tr.pad) {
      for (let k = 0; k < 3; k++) this.padNote(g, t, tr.root + 24 + off + q[k] - (off > 6 ? 12 : 0), st * 16, 0.05 * tr.pad);
    }
    // アルペジオ
    if (!intro || tr.introNoDrums) {
      const rate = tr.arpRate || 1;
      if (i % rate === 0) {
        const c = tr.arp[(i / rate) % tr.arp.length];
        if (c !== '.') {
          const up = sec === 2 ? 12 : 0;
          const m = tr.root + 24 + off - (off > 6 ? 12 : 0) + q[+c % 4] + up;
          this.arp(g, t, m, st * rate * 0.8, brk ? 0.05 : 0.08);
        }
      }
    }
    // リード(セクション 1、2 のみ)
    if (sec === 1 || sec === 2) {
      for (const [p, d, len] of s.lead[bi % s.lead.length]) {
        if (p === i) this.lead(g, t, tr.root + 24 + degToSemi(s.sc, d), len * st * 0.95, 0.12, sec === 2);
      }
    }
  }

  // ---- 楽器 ----
  _env(g, t, a, peak, dur, rel = 0.05) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + Math.max(a, dur - rel));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);
  }
  _osc(type, f, t, end, dest, det = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = det;
    o.connect(dest);
    o.start(t);
    o.stop(end);
    o.onended = () => o.disconnect();
    return o;
  }
  _noise(t, dur, type, f, q, dest) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const fl = this.ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    fl.Q.value = q;
    src.connect(fl).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur);
    src.onended = () => { src.disconnect(); fl.disconnect(); };
  }
  _vca(dest) {
    const g = this.ctx.createGain();
    g.connect(dest);
    return g;
  }
  _cleanup(nodes, end) {
    setTimeout(() => nodes.forEach((n) => n.disconnect()), (end - this.ctx.currentTime + 0.3) * 1000);
  }

  bass(dest, t, m, dur, vel) {
    const ctx = this.ctx, f = mtof(m), end = t + dur + 0.08;
    const v = this._vca(dest);
    const lp = ctx.createBiquadFilter();
    lp.Q.value = 7;
    lp.frequency.setValueAtTime(180, t);
    lp.frequency.linearRampToValueAtTime(1400 + f * 4, t + 0.01);
    lp.frequency.exponentialRampToValueAtTime(220, t + Math.min(0.25, dur));
    lp.connect(v);
    this._osc('sawtooth', f, t, end, lp, -8);
    this._osc('sawtooth', f, t, end, lp, 8);
    this._osc('square', f / 2, t, end, lp);
    this._env(v, t, 0.005, vel, dur);
    this._cleanup([v, lp], end);
  }
  padNote(dest, t, m, dur, vel) {
    const ctx = this.ctx, f = mtof(m), end = t + dur + 0.5;
    const v = this._vca(dest);
    const lp = ctx.createBiquadFilter();
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.linearRampToValueAtTime(1600, t + dur * 0.5);
    lp.connect(v);
    for (const d of [-12, 0, 11]) this._osc('sawtooth', f, t, end, lp, d);
    this._env(v, t, Math.min(0.35, dur * 0.3), vel, dur, 0.4);
    this._cleanup([v, lp], end);
  }
  arp(dest, t, m, dur, vel) {
    const ctx = this.ctx, end = t + dur + 0.06;
    const v = this._vca(dest);
    v.connect(this.fxIn);
    const lp = ctx.createBiquadFilter();
    lp.frequency.setValueAtTime(4000, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + dur);
    lp.connect(v);
    this._osc('square', mtof(m), t, end, lp);
    this._env(v, t, 0.003, vel, dur, 0.04);
    this._cleanup([v, lp], end);
  }
  lead(dest, t, m, dur, vel, bright) {
    const ctx = this.ctx, f = mtof(m), end = t + dur + 0.15;
    const v = this._vca(dest);
    v.connect(this.fxIn);
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = bright ? 3200 : 2000;
    lp.Q.value = 2;
    lp.connect(v);
    const a = this._osc('sawtooth', f, t, end, lp, -5);
    const b = this._osc(bright ? 'square' : 'sawtooth', f, t, end, lp, 6);
    // ビブラート(少し遅れて)
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 5.5;
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(dur > 0.3 ? f * 0.012 : 0, t + Math.min(0.4, dur));
    lfo.connect(lg);
    lg.connect(a.frequency);
    lg.connect(b.frequency);
    lfo.start(t);
    lfo.stop(end);
    this._env(v, t, 0.01, vel, dur, 0.12);
    this._cleanup([v, lp, lfo, lg], end);
  }
  kick(dest, t, vel) {
    const ctx = this.ctx, v = this._vca(dest);
    const o = this._osc('sine', 150, t, t + 0.4, v);
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    v.gain.setValueAtTime(vel * 0.9, t);
    v.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    this._noise(t, 0.01, 'highpass', 2000, 0.5, v);
    this._cleanup([v], t + 0.4);
  }
  snare(dest, t, vel) {
    const v = this._vca(dest);
    v.gain.setValueAtTime(vel * 0.4, t);
    v.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    this._noise(t, 0.22, 'bandpass', 1900, 0.8, v);
    const v2 = this._vca(dest);
    this._osc('triangle', 190, t, t + 0.12, v2);
    v2.gain.setValueAtTime(vel * 0.3, t);
    v2.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    this._cleanup([v, v2], t + 0.25);
  }
  tom(dest, t, f) {
    const v = this._vca(dest);
    const o = this._osc('sine', f, t, t + 0.3, v);
    o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.25);
    v.gain.setValueAtTime(0.35, t);
    v.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    this._cleanup([v], t + 0.3);
  }
  hat(dest, t, open, vel) {
    const d = open ? 0.25 : 0.04, v = this._vca(dest);
    v.gain.setValueAtTime(vel * 0.12, t);
    v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    this._noise(t, d, 'highpass', 7500, 0.7, v);
    this._cleanup([v], t + d);
  }
  cymbal(dest, t) {
    const v = this._vca(dest);
    v.gain.setValueAtTime(0.1, t);
    v.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    this._noise(t, 1.6, 'highpass', 5000, 0.4, v);
    this._cleanup([v], t + 1.6);
  }
}
