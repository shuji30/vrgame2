// ステージ表: 全 18 面。進行・敵の組み合わせ・障害物・色・BGM・ボスをここで決める。
// 構成 (5・12 面がボーナス、18 面がボスラッシュ、天井のある面、速くて短い面、
// 倒すまで進めないボスと時間で逃げるボス) は原作を参考にし、名前と色はオリジナル。
//
// 各項目:
//   name     ステージ名
//   kind     'normal' | 'bonus' | 'rush'
//   length   ボスが出るまでの秒数
//   speed    基準速度 (m/s)
//   diff     難しさ (1〜8)。敵の体力・撃つ頻度・出る間隔に効く
//   density  敵の群れが出る間隔の倍率 (大きいほど多く出る)
//   waves    出てくる敵と重み (fighter 戦闘機、gremlin 結晶の小虫、pill ダンゴムシ、moai 晶洞岩、ptero 翼竜、mech 建設ロボ 3 機、gunship ガンシップ、
//            dart 水晶の矢、lens ガラスのレンズ、turret 水晶塔、bat 結晶コウモリ、bouncer 跳ねる結晶、orbiter 衛星コア)
//   obstacles 障害物の重み (column 柱 / bush 茂み / tree 木 / rock 浮遊岩 / mushroom 巨大キノコ / crystal 水晶 / arch ガラスのアーチ /
//            monolith 黒曜石の石板 / spike 地面のトゲ / ring 浮遊リング (くぐるとボーナス))。lane: 進路上に置く確率
//   ceiling  天井がある面
//   palette  地面の 2 色 (a, b)、霧と地平線 (fog)、空の上 (sky)、遠景の山 (mount)、柱の帯 (col)、茂みや木の葉 (bush)
//   bgm      通常の曲のキー (半音) とテンポ
//   boss     { type: 'serpent' | 'twin' | 'squad' | 'swarm' | 'mirror' (ミラーコア。tier 1〜3), hp, escape (秒。この時間で逃げる。0 = 倒すまで), diff (ボスラッシュで使う強さ) }
//   rush     ボスラッシュの順番 (18 面)

export const STAGES = [
  {
    name: 'SUNNY FIELD', kind: 'normal', length: 45, speed: 40, diff: 1, density: 0.9,
    waves: [['fighter', 3], ['dart', 1.5], ['gremlin', 1]],
    obstacles: { bush: 3, tree: 2, ring: 1.2, column: 0.5, lane: 0.25 },
    palette: { a: 0xe9cf6a, b: 0x3e9c3c, fog: 0xf6dcae, sky: 0x2f72d8, mount: 0x5a70a8, col: ['#f4f4f4', '#e2559a'], bush: 0x2e8b3a },
    bgm: { key: 0, tempo: 152, song: 'rock' },
    boss: { type: 'serpent', hp: 380, escape: 0 },
  },
  {
    name: 'MINT COAST', kind: 'normal', length: 50, speed: 41, diff: 2, density: 1.0,
    waves: [['moai', 2.5], ['bouncer', 1.5], ['fighter', 1]],
    obstacles: { bush: 2, tree: 1.5, arch: 1.2, column: 1, lane: 0.27 },
    palette: { a: 0x8fe6cf, b: 0x2e8a8a, fog: 0xd8f4ec, sky: 0x2a8ed8, mount: 0x3a7a9a, col: ['#ffffff', '#2fa0b8'], bush: 0x2fa070 },
    bgm: { key: 0, tempo: 152, song: 'pops' },
    boss: { type: 'mirror', hp: 150, tier: 1, escape: 0 },
  },
  {
    name: 'CANDY GROVE', kind: 'normal', length: 50, speed: 42, diff: 3, density: 1.05,
    waves: [['gremlin', 2.5], ['bat', 1.5], ['ptero', 1]],
    obstacles: { mushroom: 3.5, spike: 1, ring: 0.8, lane: 0.28 },
    palette: { a: 0xffbcd9, b: 0x9a52c8, fog: 0xffe2f0, sky: 0x6a3ad0, mount: 0x9a6ac0, col: ['#ffffff', '#ff6aa8'], bush: 0xd062c4 },
    bgm: { key: 1, tempo: 154, song: 'jazz' },
    boss: { type: 'twin', hp: 520, escape: 0 },
  },
  {
    name: 'STEEL CANYON', kind: 'normal', length: 40, speed: 46, diff: 3, density: 1.0, ceiling: true,
    waves: [['mech', 3], ['turret', 1.5], ['fighter', 1]],
    obstacles: { column: 2.5, monolith: 1.2, lane: 0.3 },
    palette: { a: 0xcfd3dc, b: 0x5a6070, fog: 0xd8dce8, sky: 0x4a5a80, mount: 0x5a6478, col: ['#e8ecf4', '#3a4458'], bush: 0x6a7a6a },
    bgm: { key: 1, tempo: 158, song: 'metal' },
    boss: { type: 'squad', hp: 0, escape: 32 },
  },
  {
    name: 'CLOUD GARDEN', kind: 'bonus', length: 20, speed: 40, diff: 1, density: 0,
    waves: [], obstacles: { tree: 1, lane: 0 },
    palette: { a: 0xfff2c4, b: 0x8ad86a, fog: 0xfffbe8, sky: 0x7ac8ff, mount: 0x9ab8e0, col: ['#ffffff', '#ffd23a'], bush: 0x4ab84a },
    bgm: { key: 0, tempo: 160 },
  },
  {
    name: 'AMBER DUNES', kind: 'normal', length: 50, speed: 43, diff: 3, density: 1.05,
    waves: [['lens', 2], ['fighter', 2], ['gunship', 1]],
    obstacles: { rock: 2, monolith: 1.5, spike: 1, lane: 0.28 },
    palette: { a: 0xf3c477, b: 0xc0702a, fog: 0xf8e0b8, sky: 0xd88a4a, mount: 0xb07a50, col: ['#fff4e0', '#c0502a'], bush: 0x8a8a3a },
    bgm: { key: 2, tempo: 156, song: 'bossa' },
    boss: { type: 'swarm', hp: 0, escape: 30 },
  },
  {
    name: 'FROST PLAIN', kind: 'normal', length: 50, speed: 44, diff: 4, density: 1.15,
    waves: [['pill', 2.5], ['dart', 1.5], ['fighter', 1]],
    obstacles: { crystal: 2.5, rock: 1, tree: 1, lane: 0.3 },
    palette: { a: 0xdce8f2, b: 0x6aa8d8, fog: 0xf0f8ff, sky: 0x4a78c0, mount: 0x8aa8d0, col: ['#ffffff', '#5a8ac8'], bush: 0x4a8a8a },
    bgm: { key: 2, tempo: 158, song: 'classical' },
    boss: { type: 'serpent', hp: 520, escape: 0 },
  },
  {
    name: 'STONE VALLEY', kind: 'normal', length: 50, speed: 45, diff: 5, density: 1.2,
    waves: [['moai', 2], ['turret', 2], ['ptero', 1]],
    obstacles: { column: 1.5, rock: 1.5, arch: 1, lane: 0.3 },
    palette: { a: 0xbfae94, b: 0x6a5a48, fog: 0xd8ccb8, sky: 0x7a6a8a, mount: 0x6a5a5a, col: ['#efe6d8', '#7a5a3a'], bush: 0x6a7a4a },
    bgm: { key: 3, tempo: 160, song: 'reggae' },
    boss: { type: 'mirror', hp: 300, tier: 2, escape: 0 },
  },
  {
    name: 'IRON TUNNEL', kind: 'normal', length: 38, speed: 49, diff: 6, density: 1.2, ceiling: true,
    waves: [['mech', 2.5], ['orbiter', 1.5], ['fighter', 1]],
    obstacles: { column: 2.5, monolith: 1, lane: 0.33 },
    palette: { a: 0x9a9aa0, b: 0x303438, fog: 0x9aa0a8, sky: 0x202838, mount: 0x40444c, col: ['#d8dce4', '#202428'], bush: 0x4a5a4a },
    bgm: { key: 3, tempo: 164, song: 'grunge' },
    boss: { type: 'squad', hp: 0, escape: 30 },
  },
  {
    name: 'SPORE MARSH', kind: 'normal', length: 55, speed: 46, diff: 5, density: 1.3,
    waves: [['bouncer', 2], ['pill', 2], ['gremlin', 1]],
    obstacles: { mushroom: 3, bush: 1.5, spike: 1, lane: 0.3 },
    palette: { a: 0xb4dd6a, b: 0x7a7a2a, fog: 0xd8ecc0, sky: 0x5a8a6a, mount: 0x4a6a5a, col: ['#f0ffe0', '#6a9a2a'], bush: 0x3a8a3a },
    bgm: { key: 4, tempo: 160, song: 'alternative' },
    boss: { type: 'swarm', hp: 0, escape: 30 },
  },
  {
    name: 'DUSK RUINS', kind: 'normal', length: 55, speed: 47, diff: 7, density: 1.35,
    waves: [['ptero', 2], ['bat', 2], ['moai', 1]],
    obstacles: { column: 2, arch: 1.5, rock: 1, lane: 0.32 },
    palette: { a: 0xf3a986, b: 0x7a3a5a, fog: 0xf8c8a8, sky: 0x4a2a6a, mount: 0x6a3a5a, col: ['#fff0e8', '#a03a5a'], bush: 0x7a5a3a },
    bgm: { key: 4, tempo: 162, song: 'classical' },
    boss: { type: 'serpent', hp: 760, escape: 0 },
  },
  {
    name: 'NEON YARD', kind: 'bonus', length: 20, speed: 42, diff: 1, density: 0,
    waves: [], obstacles: { tree: 1, lane: 0 },
    palette: { a: 0x6af0ff, b: 0xff4ad8, fog: 0xffd8f8, sky: 0x2a1a6a, mount: 0x5a3a9a, col: ['#ffffff', '#ff4ad8'], bush: 0x2ad0c0 },
    bgm: { key: 2, tempo: 164 },
  },
  {
    name: 'CHROME BAY', kind: 'normal', length: 50, speed: 45, diff: 5, density: 1.2,
    waves: [['lens', 2], ['orbiter', 1.5], ['gunship', 1], ['fighter', 1], ['dart', 1]],
    obstacles: { monolith: 2, crystal: 1.5, ring: 1, lane: 0.3 },
    palette: { a: 0xd6e4f2, b: 0x3a5a8a, fog: 0xe0ecf8, sky: 0x1a3a7a, mount: 0x3a5a7a, col: ['#ffffff', '#2a4a8a'], bush: 0x3a6a8a },
    bgm: { key: 5, tempo: 162, song: 'pops' },
    boss: { type: 'swarm', hp: 0, escape: 32 },
  },
  {
    name: 'SHADOW HALL', kind: 'normal', length: 45, speed: 48, diff: 6, density: 1.3, ceiling: true,
    waves: [['bat', 2], ['gremlin', 2], ['turret', 1]],
    obstacles: { column: 2, crystal: 1.5, mushroom: 0.8, lane: 0.33 },
    palette: { a: 0x6a5a8a, b: 0x2a2040, fog: 0x3a2a50, sky: 0x0a0418, mount: 0x2a1a3a, col: ['#c8b8e8', '#3a2058'], bush: 0x5a3a7a },
    bgm: { key: 5, tempo: 166, song: 'metal' },
    boss: { type: 'mirror', hp: 400, tier: 3, escape: 0 },
  },
  {
    name: 'CRIMSON WASTE', kind: 'normal', length: 55, speed: 49, diff: 7, density: 1.4,
    waves: [['dart', 2], ['bouncer', 1.5], ['ptero', 1], ['mech', 1]],
    obstacles: { rock: 2, spike: 1.5, column: 1.5, lane: 0.33 },
    palette: { a: 0xd8583a, b: 0x401818, fog: 0x8a5040, sky: 0x300808, mount: 0x501818, col: ['#ffd8c8', '#601010'], bush: 0x6a3a1a },
    bgm: { key: 6, tempo: 166, song: 'grunge' },
    boss: { type: 'serpent', hp: 900, escape: 0 },
  },
  {
    name: 'STORM DECK', kind: 'normal', length: 50, speed: 50, diff: 7, density: 1.4,
    waves: [['gunship', 2], ['orbiter', 1.5], ['lens', 1], ['mech', 1], ['bat', 1.5]],
    obstacles: { column: 2, ring: 1.5, monolith: 1, lane: 0.33 },
    palette: { a: 0x7a8298, b: 0x202838, fog: 0x505870, sky: 0x101828, mount: 0x283040, col: ['#e0e4ee', '#283040'], bush: 0x3a4a5a },
    bgm: { key: 6, tempo: 168, song: 'jazz' },
    boss: { type: 'squad', hp: 0, escape: 34 },
  },
  {
    name: 'BONE DESERT', kind: 'normal', length: 60, speed: 52, diff: 8, density: 1.5,
    waves: [['fighter', 1.5], ['dart', 1], ['bat', 1], ['bouncer', 1], ['turret', 1], ['lens', 0.8], ['orbiter', 0.8], ['moai', 0.8], ['mech', 0.8]],
    obstacles: { crystal: 1.5, column: 1.5, arch: 1, rock: 1, monolith: 1, lane: 0.36 },
    palette: { a: 0xebe3d3, b: 0x404040, fog: 0xc8c0b0, sky: 0x282018, mount: 0x4a4038, col: ['#ffffff', '#202020'], bush: 0x5a5a4a },
    bgm: { key: 7, tempo: 170, song: 'rock' },
    boss: { type: 'twin', hp: 1000, escape: 0 },
  },
  {
    name: 'THE VOID', kind: 'rush', length: 4, speed: 46, diff: 8, density: 0,
    waves: [], obstacles: { rock: 1, lane: 0 },
    palette: { a: 0x3a2a5a, b: 0x0a0614, fog: 0x1a1030, sky: 0x000008, mount: 0x1a1030, col: ['#b8a8e8', '#100820'], bush: 0x2a1a4a },
    bgm: { key: 0, tempo: 152 },
    // これまでのボスを順に (体力は少なめ)
    rush: [
      { type: 'serpent', hp: 300, escape: 0, diff: 1 }, { type: 'twin', hp: 380, escape: 0, diff: 3 },
      { type: 'mirror', hp: 200, tier: 2, escape: 0, diff: 3 },
      { type: 'squad', hp: 0, escape: 22, diff: 3 }, { type: 'swarm', hp: 0, escape: 22, diff: 4 },
      { type: 'serpent', hp: 450, escape: 0, diff: 5 }, { type: 'twin', hp: 600, escape: 0, diff: 6 },
    ],
  },
];

export const STAGE_COUNT = STAGES.length;
export const stageAt = (n) => STAGES[Math.max(1, Math.min(STAGE_COUNT, Number.isInteger(n) ? n : 1)) - 1];
