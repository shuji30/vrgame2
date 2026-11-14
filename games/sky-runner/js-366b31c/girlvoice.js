// 女の子の声 (プレイヤーが女の子のときだけ)。vrsample (「ふたりの休日」) と同じく、ブラウザの音声合成で読む。
// 日本語の女性の声を名前で選び、声ごとに高さと速さを合わせる。台詞は仮名で書く (漢字は読み違えることがある)。
// vrsample と同じ所 (shuji30.github.io) で開いていれば、そちらで選んだ声 (localStorage の vrsample.voice) を使う。
// 日本語の声が無い端末では話さない (英語の声で読むと片言になる)。そのときは呼んだ側が、今までの音に戻す

// 場面ごとの台詞。同じ場面でも、続けて同じものは選ばない
const LINES = {
  go: ['いくよー！'],
  scream: ['きゃーーっ！'],
  stage: ['つぎも いくよー！', 'まだまだ いけるよ！', 'よーし、つぎ！'],
  warning: ['なにか おっきいのが くる！', 'きをつけて！', 'ボスだ…！がんばろ！'],
  bossDown: ['やったー！', 'たおしたよ！', 'えへへ、かっちゃった！'],
  escaped: ['にげられちゃった…', 'あれれ、いっちゃった'],
  hit: ['いたっ！', 'きゃっ！', 'あぶなーい！', 'わわっ！'],
  heal: ['げんき でた！', 'やった、かいふく！'],
  lowLife: ['ピンチかも…', 'もう あぶないよー'],
  kill: ['えいっ！', 'あたった！', 'やったね！', 'よしっ！'],
  ring: ['わっか、くぐった！', 'ナイス！'],
  extend: ['やった、ひとり ふえた！'],
  bonus: ['ボーナスだ！わーい！'],
  idle: ['いっしょに がんばろうね！', 'まだまだ いくよー！', 'ふふっ、きもちいい！'], // 「たのしいね」「そら、きれいだね」は録音 (main.js)
  over: ['まけちゃった…', 'うう、くやしい…'],
  ending: ['ぜんぶ クリア！ありがとう！'],
};
// 同じ場面で、次に話すまでの秒
const COOLDOWN = { go: 0, scream: 0, kill: 8, ring: 10, hit: 4, lowLife: 20, heal: 5, default: 2 };

// 声の選び方 (vrsample の voiceScore と同じ)。自然な声・若い女性の声を先に、男性の声は使わない
function voiceScore(name) {
  let score = 0;
  if (/natural|online|neural|enhanced|premium/i.test(name)) score += 3;
  if (/aoi|mayu|shiori/i.test(name)) score += 3;
  if (/nanami/i.test(name)) score += 2;
  if (/haruka|ayumi|sayaka|kyoko|o-ren|mizuki|female|女性/i.test(name)) score += 1;
  if (/google/i.test(name)) score += 1.5;
  if (/ichiro|keita|otoya|hattori|daichi|naoki|male|男性/i.test(name) && !/female/i.test(name)) score -= 10;
  return score;
}
// 声ごとの高さと速さ (自然な声は上げすぎると割れて機械っぽくなる)
function tuningFor(name) {
  if (/natural|online|neural|enhanced|premium/i.test(name)) return { pitch: 1.18, rate: 1.1 };
  if (/google/i.test(name)) return { pitch: 1.3, rate: 1.12 };
  return { pitch: 1.3, rate: 1.08 };
}

// isMuted: 音を消しているか (消していれば話さない)
export function createGirlVoice({ isMuted = () => false } = {}) {
  const synth = window.speechSynthesis ?? null;
  let voice = null, tuning = tuningFor('');
  let clock = 0;
  let talkUntil = 0;   // 口を動かす時刻まで (音声合成の onend が来ない端末もあるので、長さからも見積もる)
  const lastSaid = {}, lastLine = {};

  function pickVoice() {
    if (!synth) return;
    const ja = synth.getVoices().filter((v) => /^ja/i.test(v.lang));
    let saved = null;
    try { saved = localStorage.getItem('vrsample.voice'); } catch (_) { /* 読めない環境 */ }
    const best = ja.map((v, i) => ({ v, s: voiceScore(v.name) - i * 0.01 })).sort((a, b) => b.s - a.s)[0]?.v;
    voice = ja.find((v) => v.name === saved && voiceScore(v.name) > -5) || best || null;
    tuning = tuningFor(voice?.name || '');
  }
  pickVoice();
  synth?.addEventListener?.('voiceschanged', pickVoice);

  // text を読む。cut: 話している途中でも切って話す、queue: ほかの声 (英語のアナウンス) のあとに続けて話す
  function speak(text, { cut = false, queue = false, pitch = 0, rate = 0 } = {}) {
    if (!synth || !voice || isMuted()) return false;
    if (!cut && !queue && (synth.speaking || synth.pending)) return false; // おしゃべりは、ほかの声に重ねない
    try {
      if (cut) synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      try { u.voice = voice; } catch (_) { /* 既定の声で話す */ }
      u.pitch = Math.min(2, tuning.pitch + pitch);
      u.rate = Math.min(2, tuning.rate + rate);
      u.onstart = () => { talkUntil = clock + text.length * 0.13 + 0.2; };
      u.onend = () => { talkUntil = 0; };
      synth.speak(u);
      return true;
    } catch (_) {
      return false; // 音声合成が使えなくても、ゲームは続ける
    }
  }

  return {
    // 日本語の声で話せるか (話せなければ、呼んだ側が今までの音を鳴らす)
    get ready() { return !!(synth && voice && !isMuted()); },
    // 口を動かす間 true
    get talking() { return clock < talkUntil; },
    update(dt) { clock += dt; },
    // kind: LINES の場面。chance: 話す確率
    say(kind, { chance = 1, cut = false, queue = false } = {}) {
      const lines = LINES[kind];
      if (!lines || Math.random() > chance) return false;
      if (clock - (lastSaid[kind] ?? -Infinity) < (COOLDOWN[kind] ?? COOLDOWN.default)) return false;
      const pool = lines.length > 1 ? lines.filter((l) => l !== lastLine[kind]) : lines;
      const line = pool[Math.floor(Math.random() * pool.length)];
      const opts = kind === 'scream' ? { cut: true, pitch: 0.3, rate: -0.1 } : { cut, queue };
      if (!speak(line, opts)) return false;
      lastSaid[kind] = clock;
      lastLine[kind] = line;
      return true;
    },
  };
}
