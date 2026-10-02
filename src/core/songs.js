// 収録曲。音は audio.js がこの定義から WebAudio でリアルタイム合成する
// progression: 1 小節 1 コード。rootMidi からの半音オフセット
// sections: 小節範囲ごとの盛り上がり度合い (0..1)。譜面の密度と楽器の編成に使う

export const SONGS = [
  {
    id: 'starlight-run',
    title: 'Starlight Run',
    bpm: 100,
    bars: 40,
    rootMidi: 38, // D2
    progression: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], // D A Bm G
    sections: [
      { from: 0, to: 4, energy: 0.3 },
      { from: 4, to: 12, energy: 0.55 },
      { from: 12, to: 20, energy: 0.8 },
      { from: 20, to: 24, energy: 0.4 },
      { from: 24, to: 36, energy: 0.85 },
      { from: 36, to: 40, energy: 0.3 },
    ],
    accent: '#7cf7ff',
  },
  {
    id: 'neon-pulse',
    title: 'Neon Pulse',
    bpm: 128,
    bars: 48,
    rootMidi: 45, // A2
    progression: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]], // Am F C G
    sections: [
      { from: 0, to: 4, energy: 0.3 },
      { from: 4, to: 12, energy: 0.6 },
      { from: 12, to: 20, energy: 1.0 },
      { from: 20, to: 24, energy: 0.4 },
      { from: 24, to: 32, energy: 0.7 },
      { from: 32, to: 44, energy: 1.0 },
      { from: 44, to: 48, energy: 0.3 },
    ],
    accent: '#ff4fd8',
  },
  {
    id: 'crimson-drive',
    title: 'Crimson Drive',
    bpm: 140,
    bars: 56,
    rootMidi: 40, // E2
    progression: [[0, 3, 7], [5, 8, 12], [8, 12, 15], [7, 11, 14]], // Em Am C B
    sections: [
      { from: 0, to: 4, energy: 0.35 },
      { from: 4, to: 12, energy: 0.65 },
      { from: 12, to: 24, energy: 1.0 },
      { from: 24, to: 28, energy: 0.45 },
      { from: 28, to: 36, energy: 0.75 },
      { from: 36, to: 52, energy: 1.0 },
      { from: 52, to: 56, energy: 0.3 },
    ],
    accent: '#ff5a3c',
  },
];

export function sectionAt(song, bar) {
  for (const s of song.sections) if (bar >= s.from && bar < s.to) return s;
  return song.sections[song.sections.length - 1];
}

export function songDuration(song) {
  return (song.bars * 4 * 60) / song.bpm;
}

export function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
