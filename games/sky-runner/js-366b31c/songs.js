// ステージごとの BGM (ジャンル別の 8 曲)。audio.js の楽器 (kit) を使って、16 分音符 1 つずつ合成して鳴らす。
// mix は曲全体の音量の倍率 (アコースティックな曲は小さくなりがちなので、ロックと揃える)。
// どの曲も 8 小節 × 16 ステップでループする (子守唄だけ 3 拍子で 1 小節 12 ステップ)。ノートは MIDI 番号、kit.tr() はステージごとの移調 (半音)

// 曲の名前 (サウンドテストに出す) [名前, 説明]
export const GENRE_NAMES = {
  classical: ['GLASS CONCERTO', 'クラシック / 弦楽の協奏曲'],
  jazz: ['MIDNIGHT QUARTZ', 'ジャズ / スウィング'],
  pops: ['SUNNY SKY POP', 'ポップス / 王道進行'],
  alternative: ['STATIC HORIZON', 'オルタナティブ / 静と動'],
  bossa: ['AMBER BREEZE', 'ボサノバ / ナイロンギターとフルート'],
  reggae: ['ISLAND ORBIT', 'レゲエ / ワンドロップ'],
  metal: ['IRON STORM', 'メタル / ツーバスとギャロップ'],
  grunge: ['RUST FALLOUT', 'グランジ / 静と轟音'],
  finale: ['SOLAR PRISM', '最終ボス / オーケストラ'],
  ending: ['SKY BEYOND', 'エンディング'],
  gameover: ['GOODNIGHT CRYSTAL', 'ゲームオーバー / 子守唄'],
};

export function makeSongs(kit) {
  const { mtof, osc, noise, kick, snare, hat, crash, clap, bassNote, powerChord, leadNote, popLead, sustainEnv } = kit;
  const ctx = () => kit.ctx();
  const out = () => kit.bgmBus();
  const T = (n) => n + kit.tr();

  // ---- 楽器
  // 撥弦 (ナイロンギター・ピアノの代わり・ピチカート): 音が出た瞬間が一番大きく、すぐ減衰する
  function pluck(n, t, dur, vol, type = 'triangle', cut = 3000, pan = 0) {
    const c = ctx();
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = mtof(n);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cut, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(200, cut * 0.25), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o.connect(lp).connect(g);
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(out());
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  // エレピ (ジャズ・ポップス): サイン波に 1 オクターブ上の倍音をうっすら重ねる
  function epiano(notes, t, dur, vol = 0.05) {
    for (const n of notes) {
      osc('sine', mtof(n), t, dur, vol, out());
      osc('sine', mtof(n) * 2, t, dur * 0.4, vol * 0.25, out());
    }
  }
  // 持続する和音 (ストリングス・パッド): 2 本ののこぎり波を少しずらし、ゆっくり立ち上げる
  function pad(notes, t, dur, vol = 0.03, cut = 1800) {
    const c = ctx();
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cut;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.25, dur * 0.3));
    g.gain.setValueAtTime(vol, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, t + dur);
    lp.connect(g).connect(out());
    for (const n of notes) {
      for (const det of [-7, 7]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.02);
      }
    }
  }
  // 歌うような旋律 (バイオリン・フルート・メロディカ): ビブラート付き
  function melody(n, t, dur, { type = 'sawtooth', vol = 0.06, cut = 3500, vib = 0.008, breath = 0 } = {}) {
    const c = ctx();
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = mtof(n);
    const lfo = c.createOscillator();
    lfo.frequency.value = 5.2;
    const lg = c.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(mtof(n) * vib, t + Math.min(dur, 0.5));
    lfo.connect(lg).connect(o.frequency);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cut;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.setValueAtTime(vol, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(out());
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.02);
    lfo.stop(t + dur + 0.02);
    if (breath) noise(t, Math.min(0.08, dur), breath, 2500, out(), 'bandpass'); // フルートの息の音
  }
  // ウッドベース (ジャズ・ボサノバ): はじいた低音
  function upright(n, t, dur) {
    osc('sine', mtof(n), t, dur, 0.5, kit.band().bass);
    osc('triangle', mtof(n), t, dur * 0.5, 0.25, kit.band().bass);
  }
  // 太いサブベース (レゲエ): 歪ませない深いサイン波
  function dub(n, t, dur) {
    const c = ctx();
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = mtof(n);
    const g = c.createGain();
    sustainEnv(g, t, dur, 0.32);
    o.connect(g).connect(out());
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  const drums = () => kit.band().drums;
  const rim = (t, vol = 0.35) => { noise(t, 0.03, vol, 1900, drums(), 'bandpass'); osc('square', 820, t, 0.015, vol * 0.4, drums()); };
  const brush = (t, vol = 0.18) => noise(t, 0.12, vol, 3200, drums(), 'bandpass');
  const ride = (t, vol = 0.12) => { noise(t, 0.35, vol, 7500, drums(), 'highpass'); osc('sine', 5200, t, 0.25, vol * 0.08, drums()); };
  const shaker = (t, vol = 0.06) => noise(t, 0.04, vol, 9000, drums(), 'highpass');
  const timpani = (n, t) => { osc('sine', mtof(n), t, 0.9, 0.7, drums(), mtof(n) * 0.92); noise(t, 0.06, 0.15, 400, drums()); };
  const tom = (n, t) => osc('sine', mtof(n), t, 0.3, 0.8, drums(), mtof(n) * 0.6);
  // 和音: [根音, [構成音の半音差]] を実際のノートに
  const chordNotes = (root, ivs, base = 0) => ivs.map((v) => T(root + base + v));

  return {
    // ---- クラシック: 弦楽の急速なアルペジオ (イ短調、バロックの協奏曲風)
    classical: {
      name: 'GLASS CONCERTO', desc: 'クラシック / 弦楽の協奏曲', tempo: 144, mix: 3.5,
      chords: [[57, [0, 3, 7]], [50, [0, 3, 7]], [55, [0, 4, 7]], [48, [0, 4, 7]], [53, [0, 4, 7]], [50, [0, 3, 7]], [52, [0, 4, 7]], [52, [0, 4, 7, 10]]],
      mel: [
        [[0, 76, 8], [8, 74, 4], [12, 72, 4]], [[0, 77, 8], [8, 76, 4], [12, 74, 4]],
        [[0, 74, 6], [6, 72, 2], [8, 71, 8]], [[0, 72, 4], [4, 76, 4], [8, 79, 8]],
        [[0, 81, 8], [8, 79, 4], [12, 77, 4]], [[0, 77, 6], [6, 76, 2], [8, 74, 8]],
        [[0, 76, 4], [4, 80, 4], [8, 83, 8]], [[0, 80, 4], [4, 83, 4], [8, 88, 8]],
      ],
      step(s, t, spb) {
        const bar = Math.floor(s / 16), i = s % 16;
        const [root, ivs] = this.chords[bar];
        // バイオリンの 16 分アルペジオ (上がって下がる)
        const arp = [0, 1, 2, 3, 2, 1, 0, 1][(i % 8)];
        const tones = [...ivs.slice(0, 3), 12];
        pluck(T(root + 12 + tones[arp % tones.length]), t, spb * 1.6, 0.07, 'sawtooth', 3200, i % 2 ? 0.4 : -0.4);
        // チェロ: 8 分で根音
        if (i % 2 === 0) pluck(T(root - 12), t, spb * 1.9, 0.18, 'sawtooth', 900);
        // ストリングスの和音とバイオリンの旋律
        if (i === 0) pad(chordNotes(root, ivs), t, spb * 16, 0.022, 1500);
        for (const [st, n, len] of this.mel[bar]) if (st === i) melody(T(n), t, spb * len * 0.95, { vol: 0.07, cut: 3800, vib: 0.01 });
        // ティンパニ: 小節の頭、後半は 1・3 拍目
        if (i === 0 || (bar >= 4 && i === 8)) timpani(T(root - 24), t);
        if (bar === 7 && i >= 12) timpani(T(root - 24), t);
      },
    },

    // ---- ジャズ: 4 ビートのスウィング。ウォーキングベース、ライドシンバル、エレピ、ビブラフォン
    jazz: {
      name: 'MIDNIGHT QUARTZ', desc: 'ジャズ / スウィング', tempo: 168, swing: 0.33, mix: 2.8,
      // Gm7 | C7 | Fmaj7 | D7 | Gm7 | C7 | Am7 D7 | Gm7 C7
      chords: [[[43, [0, 3, 7, 10]]], [[48, [0, 4, 7, 10]]], [[41, [0, 4, 7, 11]]], [[50, [0, 4, 7, 10]]], [[43, [0, 3, 7, 10]]], [[48, [0, 4, 7, 10]]], [[45, [0, 3, 7, 10]], [50, [0, 4, 7, 10]]], [[43, [0, 3, 7, 10]], [48, [0, 4, 7, 10]]]],
      walk: [[0, 2, 3, 5], [0, 4, 7, 6], [0, 4, 7, 9], [0, -2, -3, -4], [0, 2, 3, 4], [0, 7, 4, 2], [0, 7, 0, 4], [0, 3, 0, 1]],
      mel: [
        [[0, 74, 3], [6, 77, 2], [8, 79, 6]], [[2, 76, 2], [4, 74, 2], [6, 72, 4], [12, 70, 4]],
        [[0, 69, 6], [8, 72, 2], [10, 76, 6]], [[0, 78, 4], [6, 74, 2], [8, 72, 8]],
        [[2, 70, 2], [4, 74, 2], [6, 77, 2], [8, 81, 6]], [[0, 79, 2], [2, 76, 2], [4, 72, 4], [10, 70, 4]],
        [[0, 72, 4], [6, 74, 2], [8, 78, 6]], [[0, 77, 4], [6, 76, 2], [8, 74, 4], [12, 72, 4]],
      ],
      step(s, t, spb) {
        const bar = Math.floor(s / 16), i = s % 16;
        const ch = this.chords[bar][i < 8 || this.chords[bar].length === 1 ? 0 : 1];
        const [root, ivs] = ch;
        // ウォーキングベース: 4 分音符で歩く
        if (i % 4 === 0) {
          const two = this.chords[bar].length > 1; // 1 小節に 2 つの和音: 根音と 5 度、1 つなら音階を歩く
          upright(T(root - 12 + (two ? (i % 8 === 0 ? 0 : 7) : this.walk[bar][i / 4])), t, spb * 3.6);
        }
        // ライド: チーン・チッキ・チーン・チッキ。ハイハットは 2・4 拍目
        if (i % 4 === 0) ride(t);
        if (i === 6 || i === 14) ride(t, 0.08);
        if (i === 4 || i === 12) noise(t, 0.04, 0.12, 6000, drums(), 'highpass');
        if (bar % 2 === 1 && (i === 14 || i === 6)) brush(t, 0.12);
        if (i === 0 && bar % 4 === 0) kick(t);
        // エレピのコンピング (裏拍に軽く)
        if (i === 6 || i === 10 || (bar % 2 && i === 14)) epiano(chordNotes(root, ivs, 12), t, spb * 2.5, 0.035);
        // ビブラフォンの旋律
        for (const [st, n, len] of this.mel[bar]) if (st === i) {
          osc('sine', mtof(T(n)), t, spb * len * 1.1, 0.07, out());
          osc('sine', mtof(T(n)) * 4, t, 0.15, 0.012, out());
        }
      },
    },

    // ---- ポップス: 4 つ打ち、王道進行 (IV-V-iii-vi)、ピアノの刻みと明るいシンセのメロディ
    pops: {
      name: 'SUNNY SKY POP', desc: 'ポップス / 王道進行', tempo: 150, mix: 1.6,
      chords: [[43, [0, 4, 7]], [45, [0, 4, 7]], [42, [0, 3, 7]], [47, [0, 3, 7]], [43, [0, 4, 7]], [45, [0, 4, 7]], [50, [0, 4, 7]], [50, [0, 4, 7]]],
      mel: [
        [[0, 74, 2], [2, 76, 2], [4, 78, 4], [8, 81, 4], [12, 78, 4]], [[0, 76, 2], [2, 78, 2], [4, 79, 4], [8, 81, 2], [10, 83, 2], [12, 81, 4]],
        [[0, 78, 4], [4, 76, 2], [6, 74, 2], [8, 73, 4], [12, 74, 4]], [[0, 71, 4], [4, 74, 4], [8, 78, 8]],
        [[0, 83, 4], [4, 81, 2], [6, 79, 2], [8, 78, 4], [12, 79, 4]], [[0, 81, 4], [4, 83, 2], [6, 85, 2], [8, 86, 8]],
        [[0, 85, 2], [2, 86, 2], [4, 88, 4], [8, 86, 4], [12, 85, 4]], [[0, 86, 12]],
      ],
      step(s, t, spb) {
        const bar = Math.floor(s / 16), i = s % 16;
        const [root, ivs] = this.chords[bar];
        if (i % 4 === 0) kick(t);
        if (i === 4 || i === 12) { snare(t, 0.7); clap(t); }
        hat(t, i % 4 === 2);
        if (i === 0 && bar % 4 === 0) crash(t);
        if (i % 2 === 0) osc('square', mtof(T(root - 12 + (i % 4 === 2 ? 12 : 0))), t, spb * 1.8, 0.1, kit.band().bass);
        if (i % 2 === 0) epiano(chordNotes(root, ivs, 12), t, spb * 1.6, 0.03);
        for (const [st, n, len] of this.mel[bar]) if (st === i) popLead(T(n), t, spb * len * 0.95);
        if (i % 2 === 1) osc('sine', mtof(T(root + 36 + ivs[(i >> 1) % 3])), t, 0.25, 0.035, out());
      },
    },

    // ---- オルタナティブ: クリーンなギターのアルペジオと 8 分のベース、後半は歪んだギターで爆発する
    alternative: {
      name: 'STATIC HORIZON', desc: 'オルタナティブ / 静と動', tempo: 148,
      chords: [[40, [0, 7, 14, 15]], [36, [0, 7, 14, 16]], [43, [0, 7, 14, 16]], [38, [0, 7, 14, 17]], [40, [0, 7, 12]], [36, [0, 7, 12]], [43, [0, 7, 12]], [38, [0, 7, 12]]],
      mel: [
        [], [], [[0, 71, 4], [4, 74, 4], [8, 76, 8]], [[0, 74, 4], [4, 71, 4], [8, 69, 8]],
        [[0, 79, 6], [6, 78, 2], [8, 76, 8]], [[0, 76, 4], [4, 79, 4], [8, 83, 8]], [[0, 81, 6], [6, 79, 2], [8, 78, 8]], [[0, 76, 4], [4, 78, 4], [8, 74, 8]],
      ],
      step(s, t, spb) {
        const bar = Math.floor(s / 16), i = s % 16;
        const [root, ivs] = this.chords[bar];
        const loud = bar >= 4;
        if (!loud) {
          // クリーンギター: 8 分のアルペジオ (左右に揺らす)
          if (i % 2 === 0) pluck(T(root + 12 + ivs[(i >> 1) % ivs.length]), t, spb * 3, 0.07, 'triangle', 2600, (i % 4 ? 0.5 : -0.5));
        } else if (i % 2 === 0) {
          powerChord(T(root), t, spb * (i % 8 === 6 ? 2 : 1.9), i % 4 === 2);
        }
        if (i % 2 === 0) bassNote(T(root - 12), t, spb * 1.8);
        for (const [st, n, len] of this.mel[bar]) if (st === i) melody(T(n), t, spb * len * 0.95, { type: 'square', vol: 0.045, cut: 2200, vib: 0.006 });
        if (i === 0 || i === 6 || i === 10) kick(t);
        if (i === 4 || i === 12) snare(t, loud ? 1 : 0.6);
        if (i % 2 === 0) hat(t, loud && i % 4 === 2);
        if (i === 0 && (bar === 0 || bar === 4)) crash(t);
        if (bar === 3 && i >= 12) tom(T(50 - (i - 12) * 3), t);
      },
    },

    // ---- ボサノバ: ナイロンギターのシンコペーション、リムショットのクラーベ、フルートの旋律
    bossa: {
      name: 'AMBER BREEZE', desc: 'ボサノバ / ナイロンギターとフルート', tempo: 140, mix: 3.5,
      // Fmaj7 | Gm7 C7 | Fmaj7 | B♭maj7 | Am7 | D7 | Gm7 | C7
      chords: [[[53, [0, 4, 7, 11]]], [[55, [0, 3, 7, 10]], [48, [0, 4, 7, 10]]], [[53, [0, 4, 7, 11]]], [[46, [0, 4, 7, 11]]], [[57, [0, 3, 7, 10]]], [[50, [0, 4, 7, 10]]], [[55, [0, 3, 7, 10]]], [[48, [0, 4, 7, 10]]]],
      mel: [
        [[0, 81, 6], [6, 79, 2], [8, 77, 8]], [[0, 79, 4], [4, 77, 2], [6, 76, 2], [8, 74, 8]],
        [[0, 76, 4], [4, 77, 2], [6, 79, 2], [8, 81, 8]], [[0, 82, 6], [6, 81, 2], [8, 77, 8]],
        [[0, 79, 4], [4, 76, 4], [8, 72, 8]], [[0, 78, 4], [4, 81, 4], [8, 84, 8]],
        [[0, 82, 4], [4, 79, 2], [6, 77, 2], [8, 74, 8]], [[0, 76, 4], [4, 79, 4], [8, 82, 4], [12, 79, 4]],
      ],
      step(s, t, spb) {
        const bar = Math.floor(s / 16), i = s % 16;
        const chs = this.chords[bar];
        const [root, ivs] = chs[chs.length > 1 && i >= 8 ? 1 : 0];
        // ギター: 親指のベース (1・3 拍目、3 拍目は 5 度) と、指で弾くシンコペーションの和音
        if (i === 0 || i === 8) pluck(T(root - 12 + (i === 8 && chs.length === 1 ? 7 : 0)), t, spb * 4, 0.2, 'triangle', 1200);
        if ([0, 3, 6, 10, 13].includes(i)) for (const n of chordNotes(root, ivs.slice(1), 0)) pluck(n, t, spb * 2.2, 0.045, 'triangle', 2400);
        for (const [st, n, len] of this.mel[bar]) if (st === i) melody(T(n), t, spb * len * 0.95, { type: 'sine', vol: 0.08, cut: 5000, vib: 0.01, breath: 0.03 });
        // リムショットのクラーベ (3-2) とシェイカー、ブラシ
        if ([0, 6, 12].includes(i) && bar % 2 === 0) rim(t);
        if ([4, 8].includes(i) && bar % 2 === 1) rim(t);
        shaker(t, i % 2 ? 0.04 : 0.07);
        if (i === 0 || i === 8) osc('sine', 60, t, 0.2, 0.6, drums(), 40);
      },
    },

    // ---- レゲエ: ワンドロップ (3 拍目にバスドラとリム)、裏打ちのギターとオルガン、太いベース、メロディカ
    reggae: {
      name: 'ISLAND ORBIT', desc: 'レゲエ / ワンドロップ', tempo: 150, mix: 2.8,
      chords: [[45, [0, 3, 7]], [43, [0, 4, 7]], [41, [0, 4, 7]], [43, [0, 4, 7]], [45, [0, 3, 7]], [43, [0, 4, 7]], [41, [0, 4, 7]], [40, [0, 4, 7]]],
      bass: [[0, 0, 3], [3, 7, 1], [6, 12, 2], [10, 10, 2], [12, 7, 4]],
      mel: [
        [[2, 76, 2], [4, 72, 2], [8, 69, 6]], [[2, 74, 2], [4, 71, 2], [8, 67, 6]],
        [[0, 69, 2], [2, 72, 2], [4, 77, 4], [10, 76, 2], [12, 72, 4]], [[0, 74, 8], [8, 71, 8]],
        [[2, 81, 2], [4, 79, 2], [6, 76, 2], [8, 72, 8]], [[2, 79, 2], [4, 76, 2], [6, 74, 2], [8, 71, 8]],
        [[0, 72, 2], [2, 74, 2], [4, 77, 4], [8, 76, 4], [12, 74, 4]], [[0, 71, 8], [8, 68, 8]],
      ],
      step(s, t, spb) {
        const bar = Math.floor(s / 16), i = s % 16;
        const [root, ivs] = this.chords[bar];
        // 裏打ち (スカンク): 2・4 拍目に短く切ったギター、すぐ後にオルガンの「バブル」
        if (i === 4 || i === 12) for (const n of chordNotes(root, ivs, 12)) pluck(n, t, spb * 0.8, 0.05, 'square', 2600);
        if (i === 6 || i === 14 || i === 7 || i === 15) for (const n of chordNotes(root, ivs, 12)) osc('square', mtof(n), t, spb * 0.5, 0.012, out());
        for (const [st, iv, len] of this.bass) if (st === i) dub(T(root - 12 + iv), t, spb * len * 0.9);
        for (const [st, n, len] of this.mel[bar]) if (st === i) melody(T(n), t, spb * len * 0.9, { type: 'square', vol: 0.04, cut: 1800, vib: 0.012 });
        // ワンドロップ: 3 拍目にバスドラとリム。ハイハットは 8 分
        if (i === 8) { kick(t); rim(t, 0.45); }
        if (i % 2 === 0) hat(t, i === 14);
        if (bar === 7 && i >= 12 && i % 2 === 0) tom(T(52 - (i - 12) * 2), t);
      },
    },

    // ---- メタル: ツーバスの連打とギャロップの刻み、ハモるリード
    metal: {
      name: 'IRON STORM', desc: 'メタル / ツーバスとギャロップ', tempo: 176,
      roots: [40, 40, 36, 38, 40, 40, 43, 42],
      gallop: 'x.xxx.xxx.xxX...',
      lead: [
        [], [[0, 76, 4], [4, 79, 4], [8, 83, 8]], [[0, 84, 4], [4, 83, 4], [8, 79, 8]], [[0, 81, 4], [4, 78, 4], [8, 74, 8]],
        [[0, 76, 2], [2, 78, 2], [4, 79, 2], [6, 81, 2], [8, 83, 8]], [[0, 84, 2], [2, 83, 2], [4, 81, 2], [6, 79, 2], [8, 78, 8]], [[0, 79, 4], [4, 83, 4], [8, 86, 8]], [[0, 85, 4], [4, 83, 4], [8, 82, 8]],
      ],
      step(s, t, spb) {
        const bar = Math.floor(s / 16), i = s % 16;
        const root = T(this.roots[bar]);
        const c = this.gallop[i];
        if (c === 'x') powerChord(root, t, spb * 0.85, true);
        if (c === 'X') powerChord(root, t, spb * 3.8, false);
        if (i % 2 === 0) bassNote(root - 12, t, spb * 1.8);
        for (const [st, n, len] of this.lead[bar]) if (st === i) {
          leadNote(T(n), t, spb * len, spb, { vol: 0.55 });
          leadNote(T(n - 4), t, spb * len, spb, { vol: 0.3, vibrato: 0.01 }); // 3 度下でハモる
        }
        // ツーバス: 後半は 16 分で踏み続ける
        if (bar >= 4 || i % 2 === 0) kick(t);
        if (i === 4 || i === 12) snare(t);
        if (i % 4 === 0) hat(t, false);
        if (i === 0 && bar % 2 === 0) crash(t);
        if (bar === 7 && i >= 12) tom(T(55 - (i - 12) * 4), t);
      },
    },

    // ---- 最終ボス: オーケストラ風 (D マイナー、16 小節)。弦の 16 分の刻み、低音の弦、金管の勇ましい旋律、合唱、ティンパニ
    finale: {
      name: 'SOLAR PRISM', desc: '最終ボス / オーケストラ', tempo: 144, mix: 2.6, steps: 256,
      // 1 小節ごとの和音: Dm | B♭ | Gm | A | Dm | F | C | A7 (×2)
      chords: [[50, [0, 3, 7]], [46, [0, 4, 7]], [43, [0, 3, 7]], [45, [0, 4, 7]], [50, [0, 3, 7]], [41, [0, 4, 7]], [48, [0, 4, 7]], [45, [0, 4, 7, 10]]],
      mel: [
        [[0, 74, 4], [4, 69, 2], [6, 74, 2], [8, 77, 4], [12, 76, 4]], [[0, 74, 6], [6, 72, 2], [8, 70, 8]],
        [[0, 67, 4], [4, 70, 2], [6, 74, 2], [8, 79, 4], [12, 77, 4]], [[0, 76, 8], [8, 73, 8]],
        [[0, 81, 4], [4, 77, 2], [6, 81, 2], [8, 86, 8]], [[0, 84, 4], [4, 81, 4], [8, 77, 8]],
        [[0, 79, 4], [4, 76, 2], [6, 79, 2], [8, 84, 4], [12, 82, 4]], [[0, 81, 8]],
      ],
      step(s, t, spb) {
        const bar = Math.floor(s / 16) % 16, i = s % 16, b8 = bar % 8, second = bar >= 8;
        const [root, ivs] = this.chords[b8];
        // 弦の 16 分の刻み (根音・5 度・オクターブを行き来する)
        const ost = [0, 12, 7, 12][i % 4];
        pluck(T(root + 12 + ost), t, spb * 1.4, 0.06, 'sawtooth', 2600, i % 2 ? 0.35 : -0.35);
        // 低音の弦 (8 分)
        if (i % 2 === 0) pluck(T(root - 12), t, spb * 1.9, 0.2, 'sawtooth', 700);
        // 合唱の和音 (柔らかいパッド)
        if (i === 0) pad(chordNotes(root, ivs, 12), t, spb * 16, 0.02, 900);
        // 金管の旋律 (後半は 1 オクターブ上の弦も重ねる)
        const m = b8 === 7 && second ? [[0, 74, 12]] : this.mel[b8];
        for (const [st, n, len] of m) if (st === i) {
          melody(T(n - 12), t, spb * len * 0.95, { vol: 0.09, cut: 1500, vib: 0.006 });
          if (second) melody(T(n), t, spb * len * 0.95, { vol: 0.05, cut: 3800, vib: 0.01 });
        }
        // ティンパニ (1・3 拍目、4 小節ごとにロール)、後半は行進のスネアとシンバル
        if (i === 0 || i === 8) timpani(T(root - 24), t);
        if (b8 % 4 === 3 && i >= 12) timpani(T(root - 24), t);
        if (second && (i === 4 || i === 12)) snare(t, 0.4);
        if (second && i % 4 === 2) snare(t, 0.15);
        if (i === 0 && bar % 4 === 0) crash(t);
      },
    },

    // ---- エンディング: 明るく穏やかに (D メジャー、16 小節)。ピアノのアルペジオ、ストリングス、フルート
    ending: {
      name: 'SKY BEYOND', desc: 'エンディング', tempo: 100, mix: 5, steps: 256,
      chords: [[50, [0, 4, 7]], [45, [0, 4, 7]], [47, [0, 3, 7]], [43, [0, 4, 7]], [50, [0, 4, 7]], [45, [0, 4, 7]], [43, [0, 4, 7]], [45, [0, 4, 7]]],
      mel: [
        [[0, 78, 6], [6, 76, 2], [8, 74, 8]], [[0, 76, 6], [6, 78, 2], [8, 73, 8]],
        [[0, 74, 4], [4, 76, 4], [8, 78, 8]], [[0, 79, 6], [6, 78, 2], [8, 74, 8]],
        [[0, 81, 6], [6, 79, 2], [8, 78, 8]], [[0, 76, 4], [4, 78, 4], [8, 81, 8]],
        [[0, 83, 6], [6, 81, 2], [8, 79, 4], [12, 78, 4]], [[0, 76, 16]],
      ],
      step(s, t, spb) {
        const bar = Math.floor(s / 16) % 16, i = s % 16, b8 = bar % 8, second = bar >= 8;
        const [root, ivs] = this.chords[b8];
        // ピアノのアルペジオ (8 分)
        if (i % 2 === 0) {
          const tones = [0, ivs[1], ivs[2], 12, ivs[2] + 12, 12, ivs[2], ivs[1]];
          epiano([T(root + 12 + tones[(i >> 1) % 8])], t, spb * 3, 0.045);
        }
        if (i === 0) {
          pluck(T(root - 12), t, spb * 14, 0.18, 'sine', 600); // 低音
          pad(chordNotes(root, ivs, 12), t, spb * 16, 0.016, 1200); // ストリングス
        }
        // フルートの旋律 (後半は 1 オクターブ上で、少しだけ飾る)
        const m = b8 === 7 && second ? [[0, 74, 16]] : this.mel[b8];
        for (const [st, n, len] of m) if (st === i) melody(T(n + (second ? 12 : 0) - (second && n > 80 ? 12 : 0)), t, spb * len * 0.95, { type: 'sine', vol: 0.08, cut: 5000, vib: 0.01, breath: 0.025 });
        // やわらかいブラシとシェイカー (後半から)
        if (second) {
          if (i === 4 || i === 12) brush(t, 0.12);
          if (i % 2 === 0) shaker(t, 0.04);
        }
      },
    },

    // ---- ゲームオーバー: 子守唄のようなスローバラード (F メジャー、3 拍子、16 小節)。
    //   オルゴールのアルペジオ、オルゴールの旋律 (後半はやわらかいフルートを重ねる)、低いサイン波、うすいストリングス。打楽器なし
    gameover: {
      name: 'GOODNIGHT CRYSTAL', desc: 'ゲームオーバー / 子守唄', tempo: 58, mix: 4.5, steps: 192, beats: 3,
      // F | Dm | B♭ | C | F | Am | B♭ | C7 || F | B♭ | Gm | C | Am | Dm | B♭ C | F
      chords: [[[53, [0, 4, 7]]], [[50, [0, 3, 7]]], [[46, [0, 4, 7]]], [[48, [0, 4, 7]]], [[53, [0, 4, 7]]], [[45, [0, 3, 7]]], [[46, [0, 4, 7]]], [[48, [0, 4, 7, 10]]],
        [[53, [0, 4, 7]]], [[46, [0, 4, 7]]], [[43, [0, 3, 7]]], [[48, [0, 4, 7]]], [[45, [0, 3, 7]]], [[50, [0, 3, 7]]], [[46, [0, 4, 7]], [48, [0, 4, 7]]], [[53, [0, 4, 7]]]],
      mel: [
        [[0, 69, 6], [6, 70, 2], [8, 72, 4]], [[0, 74, 8], [8, 72, 4]], [[0, 70, 6], [6, 69, 2], [8, 67, 4]], [[0, 67, 12]],
        [[0, 69, 6], [6, 70, 2], [8, 72, 4]], [[0, 76, 8], [8, 74, 4]], [[0, 74, 4], [4, 72, 4], [8, 70, 4]], [[0, 67, 8], [8, 70, 4]],
        [[0, 72, 6], [6, 74, 2], [8, 72, 4]], [[0, 77, 8], [8, 74, 4]], [[0, 74, 6], [6, 72, 2], [8, 70, 4]], [[0, 72, 12]],
        [[0, 69, 6], [6, 72, 2], [8, 76, 4]], [[0, 74, 8], [8, 72, 4]], [[0, 70, 4], [4, 69, 4], [8, 67, 4]], [[0, 65, 12]],
      ],
      step(s, t, spb) {
        const bar = Math.floor(s / 12) % 16, i = s % 12, second = bar >= 8;
        const chs = this.chords[bar];
        const [root, ivs] = chs[chs.length > 1 && i >= 6 ? 1 : 0];
        // オルゴールのアルペジオ (8 分): 根音から上がって下りる
        if (i % 2 === 0) {
          const tones = [0, ivs[2], 12, ivs[1] + 12, 12, ivs[2]];
          pluck(T(root + 12 + tones[i >> 1]), t, spb * 7, 0.035, 'sine', 4500, (i % 4 ? 0.3 : -0.3));
        }
        if (i === 0 || (chs.length > 1 && i === 6)) {
          pluck(T(root - 12), t, spb * 11, 0.16, 'sine', 500); // 低音
          pad(chordNotes(root, ivs, 12), t, spb * (chs.length > 1 ? 6 : 12), 0.009, 1000); // うすいストリングス
        }
        // 旋律: オルゴール (三角波をはじいて長く響かせる)。後半はフルートを 1 オクターブ下に重ねる
        for (const [st, n, len] of this.mel[bar]) if (st === i) {
          pluck(T(n + 12), t, spb * Math.max(8, len * 1.5), 0.05, 'triangle', 6000);
          if (second) melody(T(n), t, spb * len * 0.95, { type: 'sine', vol: 0.05, cut: 3000, vib: 0.006, breath: 0.012 });
        }
      },
    },

    // ---- グランジ: 静かなアルペジオから、ファズの効いたパワーコードで轟音になる (ドロップ D、重いテンポ)
    grunge: {
      name: 'RUST FALLOUT', desc: 'グランジ / 静と轟音', tempo: 116,
      roots: [38, 41, 43, 46, 38, 41, 43, 44],
      riff: 'X.....X.X...X...',
      mel: [
        [[0, 69, 8], [8, 72, 8]], [[0, 74, 8], [8, 72, 4], [12, 69, 4]], [[0, 67, 12]], [[0, 70, 8], [8, 69, 8]],
        [[0, 74, 6], [6, 72, 2], [8, 74, 8]], [[0, 77, 6], [6, 76, 2], [8, 74, 8]], [[0, 79, 8], [8, 77, 4], [12, 74, 4]], [[0, 75, 8], [8, 74, 8]],
      ],
      step(s, t, spb) {
        const bar = Math.floor(s / 16), i = s % 16;
        const root = T(this.roots[bar]);
        const loud = bar >= 4;
        if (!loud) {
          if (i % 2 === 0) pluck(root + 12 + [0, 7, 12, 15, 12, 7, 3, 7][(i >> 1)], t, spb * 3, 0.07, 'triangle', 2000, (i % 4 ? 0.4 : -0.4));
          if (i === 0) bassNote(root - 12, t, spb * 15);
        } else {
          if (this.riff[i] === 'X') {
            let len = 1;
            while (i + len < 16 && this.riff[i + len] === '.') len++;
            powerChord(root, t, spb * len * 0.97, false, [0, 7, 12, 19]);
          }
          if (i % 2 === 0) bassNote(root - 12, t, spb * 1.9);
        }
        // 気だるいリード (大きなビブラート)
        for (const [st, n, len] of this.mel[bar]) if (st === i) leadNote(T(n), t, spb * len, spb, { vol: loud ? 0.5 : 0.35, vibrato: 0.02 });
        // ドラム: 重いバスドラと大きなスネア、轟音ではクラッシュを叩き続ける
        if (i === 0 || i === 10 || (loud && i === 7)) kick(t);
        if (i === 4 || i === 12) snare(t, loud ? 1.1 : 0.5);
        if (i % 2 === 0) loud ? (i % 8 === 0 ? crash(t) : hat(t, true)) : hat(t, false);
        if (bar === 3 && i >= 8 && i % 2 === 0) tom(T(52 - (i - 8) * 2), t);
      },
    },
  };
}
