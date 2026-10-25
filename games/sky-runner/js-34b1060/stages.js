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
//            dart 水晶の矢、lens ガラスのレンズ、turret 水晶塔、bat 結晶コウモリ、bouncer 跳ねる結晶、orbiter 衛星コア、mammoth マンモス、jelly 水晶のクラゲ)
//   obstacles 障害物の重み (column 柱 / bush 茂み / tree 木 / rock 浮遊岩 / mushroom 巨大キノコ / crystal 水晶 / arch ガラスのアーチ /
//            monolith 黒曜石の石板 / spike 地面のトゲ / ring 浮遊リング (くぐるとボーナス))。lane: 進路上に置く確率
//   ceiling  天井がある面
//   palette  地面の 2 色 (a, b)、霧と地平線 (fog)、空の上 (sky)、遠景の山 (mount)、柱の帯 (col)、茂みや木の葉 (bush)
//   bgm      通常の曲のキー (半音) とテンポ
//   boss     { type: 'serpent' | 'twin' | 'squad' | 'swarm' | 'mirror' (ミラーコア。tier 1〜3) | 'geodering' (晶洞の輪。tier 1〜2) | 'mine' (浮遊鉱山) | 'colossus' (磁鉄の巨像) | 'sun' (最終ボス) | 'crown' (氷晶の冠) | 'worm' (砂岩の大蛇) | 'turbine' (双子の回転刃) | 'phantom' (水晶の亡霊) | 'laserwing' (光翼の母船) | 'mantis' (硝子のカマキリ) | 'whale' (溶岩の結晶鯨), hp, escape (秒。この時間で逃げる。0 = 倒すまで), diff (ボスラッシュで使う強さ) }
//   rush     ボスラッシュの順番 (18 面)

export const STAGES = [
  {
    // 夜の空の道 (2026-10-25 にユーザーの希望で、曲 (01 Gravity Left Behind) とイメージ「スカイハイウェイ」に合わせて夜にした。
    // 前は昼の SUNNY FIELD)。星と三日月、ビル街、道の左右を流れる光の筋、街灯と縞の柱
    name: 'SKY HIGHWAY', kind: 'normal', length: 45, speed: 40, diff: 1, density: 0.9,
    waves: [['fighter', 3], ['dart', 1.5], ['gremlin', 1], ['mammoth', 2.5]],
    obstacles: { pylon: 2.2, column: 1.2, ring: 1.0, lane: 0.25 },
    palette: { a: 0x161b28, b: 0x0a0d14, fog: 0x1c2a4c, sky: 0x02040c, mount: 0x0a1020, col: ['#e8f4ff', '#ff3050'], bush: 0x2a3a5a, crystal: 0x6ab8ff, lamp: 0x9fd8ff, night: true },
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
    boss: { type: 'twin', hp: 440, escape: 0 },
  },
  {
    name: 'STEEL CANYON', kind: 'normal', length: 40, speed: 46, diff: 3, density: 1.0, ceiling: true,
    waves: [['mech', 3], ['icosa', 4], ['turret', 1.5], ['fighter', 1]],
    obstacles: { column: 2.5, lane: 0.3 }, // 二十面体の面: 黒い石板は出さない
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
    boss: { type: 'crown', hp: 300, escape: 0 },
  },
  {
    name: 'STONE VALLEY', kind: 'normal', length: 50, speed: 45, diff: 5, density: 1.2,
    waves: [['moai', 2], ['turret', 2], ['ptero', 1], ['tortoise', 1.6]],
    obstacles: { column: 1.5, rock: 1.5, arch: 1, lane: 0.3 },
    palette: { a: 0xbfae94, b: 0x6a5a48, fog: 0xd8ccb8, sky: 0x7a6a8a, mount: 0x6a5a5a, col: ['#efe6d8', '#7a5a3a'], bush: 0x6a7a4a },
    bgm: { key: 3, tempo: 160, song: 'reggae' },
    boss: { type: 'worm', hp: 240, escape: 0 },
  },
  {
    name: 'IRON TUNNEL', kind: 'normal', length: 38, speed: 49, diff: 6, density: 1.2, ceiling: true,
    waves: [['mech', 2.5], ['icosa', 4], ['orbiter', 1.5], ['fighter', 1]],
    obstacles: { column: 2.5, lane: 0.33 }, // 二十面体の面: 黒い石板は出さない
    palette: { a: 0x9a9aa0, b: 0x303438, fog: 0x9aa0a8, sky: 0x202838, mount: 0x40444c, col: ['#d8dce4', '#202428'], bush: 0x4a5a4a },
    bgm: { key: 3, tempo: 164, song: 'grunge' },
    boss: { type: 'turbine', hp: 360, escape: 0 },
  },
  {
    name: 'SPORE MARSH', kind: 'normal', length: 55, speed: 46, diff: 5, density: 1.3,
    waves: [['bouncer', 2], ['pill', 2], ['gremlin', 1], ['jelly', 1.8]],
    obstacles: { mushroom: 3, bush: 1.5, spike: 1, lane: 0.3 },
    palette: { a: 0xb4dd6a, b: 0x7a7a2a, fog: 0xd8ecc0, sky: 0x5a8a6a, mount: 0x4a6a5a, col: ['#f0ffe0', '#6a9a2a'], bush: 0x3a8a3a },
    bgm: { key: 4, tempo: 160, song: 'alternative' },
    boss: { type: 'geodering', escape: 30, tier: 1 },
  },
  {
    name: 'DUSK RUINS', kind: 'normal', length: 55, speed: 47, diff: 7, density: 1.35,
    waves: [['ptero', 2], ['bat', 2], ['moai', 1], ['hourglass', 1.6]],
    obstacles: { column: 2, arch: 1.5, rock: 1, lane: 0.32 },
    palette: { a: 0xf3a986, b: 0x7a3a5a, fog: 0xf8c8a8, sky: 0x4a2a6a, mount: 0x6a3a5a, col: ['#fff0e8', '#a03a5a'], bush: 0x7a5a3a },
    bgm: { key: 4, tempo: 162, song: 'classical' },
    boss: { type: 'phantom', hp: 320, escape: 0 },
  },
  {
    name: 'NEON YARD', kind: 'bonus', length: 20, speed: 42, diff: 1, density: 0,
    waves: [], obstacles: { pylon: 1, lane: 0 }, // 12 面のボーナスは人工物 (ネオンの街灯) をなぎ倒す
    palette: { a: 0x6af0ff, b: 0xff4ad8, fog: 0xffd8f8, sky: 0x2a1a6a, mount: 0x5a3a9a, col: ['#ffffff', '#ff4ad8'], bush: 0x2ad0c0 },
    bgm: { key: 2, tempo: 164 },
  },
  {
    name: 'CHROME BAY', kind: 'normal', length: 50, speed: 45, diff: 5, density: 1.2,
    waves: [['lens', 2], ['orbiter', 1.5], ['gunship', 1], ['fighter', 1], ['dart', 1], ['dragonfly', 1.8]],
    obstacles: { monolith: 2, crystal: 1.5, ring: 1, lane: 0.3 },
    palette: { a: 0xd6e4f2, b: 0x3a5a8a, fog: 0xe0ecf8, sky: 0x1a3a7a, mount: 0x3a5a7a, col: ['#ffffff', '#2a4a8a'], bush: 0x3a6a8a },
    bgm: { key: 5, tempo: 162, song: 'pops' },
    boss: { type: 'laserwing', hp: 380, escape: 0 },
  },
  {
    name: 'SHADOW HALL', kind: 'normal', length: 45, speed: 48, diff: 6, density: 1.3, ceiling: true,
    waves: [['bat', 2], ['icosa', 3.5], ['gremlin', 2], ['turret', 1], ['gspider', 1.4]],
    obstacles: { column: 2, crystal: 1.5, mushroom: 0.8, lane: 0.33 },
    palette: { a: 0x6a5a8a, b: 0x2a2040, fog: 0x3a2a50, sky: 0x0a0418, mount: 0x2a1a3a, col: ['#c8b8e8', '#3a2058'], bush: 0x5a3a7a },
    bgm: { key: 5, tempo: 166, song: 'metal' },
    boss: { type: 'mantis', hp: 320, escape: 0 },
  },
  {
    name: 'CRIMSON WASTE', kind: 'normal', length: 55, speed: 49, diff: 7, density: 1.4,
    waves: [['dart', 2], ['bouncer', 1.5], ['ptero', 1], ['mech', 1], ['ray', 1.6]],
    obstacles: { rock: 2, spike: 1.5, column: 1.5, lane: 0.33 },
    palette: { a: 0xd8583a, b: 0x401818, fog: 0x8a5040, sky: 0x300808, mount: 0x501818, col: ['#ffd8c8', '#601010'], bush: 0x6a3a1a },
    bgm: { key: 6, tempo: 166, song: 'grunge' },
    boss: { type: 'whale', hp: 300, escape: 0 },
  },
  {
    name: 'STORM DECK', kind: 'normal', length: 50, speed: 50, diff: 7, density: 1.4,
    waves: [['gunship', 2], ['orbiter', 1.5], ['lens', 1], ['mech', 1], ['bat', 1.5], ['stormorb', 1.6]],
    obstacles: { column: 2, ring: 1.5, monolith: 1, lane: 0.33 },
    palette: { a: 0x7a8298, b: 0x202838, fog: 0x505870, sky: 0x101828, mount: 0x283040, col: ['#e0e4ee', '#283040'], bush: 0x3a4a5a },
    bgm: { key: 6, tempo: 168, song: 'jazz' },
    boss: { type: 'mine', hp: 360, escape: 0 },
  },
  {
    name: 'BONE DESERT', kind: 'normal', length: 60, speed: 52, diff: 8, density: 1.5,
    waves: [['fighter', 1.5], ['dart', 1], ['bat', 1], ['bouncer', 1], ['turret', 1], ['lens', 0.8], ['orbiter', 0.8], ['moai', 0.8], ['mech', 0.8], ['magnetmine', 1.4]],
    obstacles: { crystal: 1.5, column: 1.5, arch: 1, rock: 1, monolith: 1, lane: 0.36 },
    palette: { a: 0xebe3d3, b: 0x404040, fog: 0xc8c0b0, sky: 0x282018, mount: 0x4a4038, col: ['#ffffff', '#202020'], bush: 0x5a5a4a },
    bgm: { key: 7, tempo: 170, song: 'rock' },
    boss: { type: 'colossus', hp: 340, escape: 0 },
  },
  {
    name: 'THE VOID', kind: 'rush', length: 4, speed: 46, diff: 8, density: 0,
    waves: [], obstacles: { rock: 1, lane: 0 },
    palette: { a: 0x3a2a5a, b: 0x0a0614, fog: 0x1a1030, sky: 0x000008, mount: 0x1a1030, col: ['#b8a8e8', '#100820'], bush: 0x2a1a4a },
    bgm: { key: 0, tempo: 152 },
    // これまでのボスを順に (体力は少なめ)
    rush: [
      { type: 'serpent', hp: 300, escape: 0, diff: 1 }, { type: 'twin', hp: 380, escape: 0, diff: 3 },
      { type: 'mirror', hp: 180, tier: 2, escape: 0, diff: 3 },
      { type: 'squad', hp: 0, escape: 22, diff: 3 }, { type: 'geodering', tier: 1, escape: 22, diff: 4 },
      { type: 'mine', hp: 220, escape: 0, diff: 6 }, { type: 'colossus', hp: 280, escape: 0, diff: 6 },
      { type: 'sun', hp: 600, escape: 0, diff: 8 }, // 最終ボス
    ],
  },
];

export const STAGE_COUNT = STAGES.length;
export const stageAt = (n) => STAGES[Math.max(1, Math.min(STAGE_COUNT, Number.isInteger(n) ? n : 1)) - 1];

// ボスの名前と、倒し方のひとこと (初めて会ったときだけ WARNING の 2 行目に出す)
export const BOSS_INFO = {
  serpent: ['プリズム連珠', '頭を狙え'],
  twin: ['双晶', '2 つの頭を狙え'],
  squad: ['ロボット部隊', '縦一列の突進をよけて撃て'],
  swarm: ['旋回する群れ', '逃げる前に全部落とせ'],
  mirror: ['ミラーコア', '鏡は弾を撃ち返す。すき間から核を撃て'],
  geodering: ['晶洞の輪', '殻が開いて光ったときだけ倒せる'],
  mine: ['浮遊鉱山', '出撃口を壊して、本体を撃て'],
  colossus: ['磁鉄の巨像', '電極を先に壊せ'],
  sun: ['プリズムの太陽', '最後の戦い'],
  crown: ['氷晶の冠', '赤い印をよけろ。つららを壊せば雨が減る'],
  worm: ['砂岩の大蛇', '頭だけが弱点。進む先を狙え'],
  turbine: ['双子の回転刃', '刃は戻ってくる。真ん中の核を撃て'],
  phantom: ['水晶の亡霊', '目が水色の本物を撃て。分身は紫'],
  laserwing: ['光翼の母船', '光線は上下によけろ。翼の先を壊せ'],
  mantis: ['硝子のカマキリ', '斬撃をよけたら、光る腹を撃て'],
  whale: ['溶岩の結晶鯨', '浮上したら背中の潮吹き穴を撃て'],
};

// エンディングで紹介する敵の名前と、ひとこと
export const ENEMY_INFO = {
  fighter: ['FIGHTER', '戦闘機'],
  dart: ['CRYSTAL DART', '水晶の矢'],
  gremlin: ['CRYSTAL BUG', '結晶の小虫'],
  mammoth: ['MAMMOTH', 'マンモス'],
  moai: ['GEODE', '晶洞岩'],
  bouncer: ['BOUNCE GEM', '跳ねる結晶'],
  pill: ['PILL BUG', 'ダンゴムシ'],
  bat: ['GLASS BAT', '結晶コウモリ'],
  ptero: ['PTERO', '翼竜'],
  mech: ['BUILDER ROBO', '建設ロボ'],
  icosa: ['PRISM ICOSA', '結晶の二十面体'],
  turret: ['SPIRE TURRET', '水晶塔'],
  gunship: ['GUNSHIP', 'ガンシップ'],
  lens: ['PRISM LENS', 'ガラスのレンズ'],
  orbiter: ['ORBIT CORE', '衛星コア'],
  jelly: ['CRYSTAL JELLY', '水晶のクラゲ'],
  tortoise: ['ROCK TORTOISE', '岩の亀'],
  hourglass: ['HOURGLASS', '砂時計の番人'],
  dragonfly: ['GIANT DRAGONFLY', '巨大オニヤンマ'],
  gspider: ['GIANT SPIDER', '地を走る巨大蜘蛛'],
  ray: ['OBSIDIAN RAY', '黒曜石のエイ'],
  stormorb: ['STORM ORB', '雷の結晶球'],
  magnetmine: ['MAGNET MINE', '磁石の浮遊機雷'],
};

// ---- お話 (案 A「ひびの入った太陽」。docs/story-proposal.md)。
// 空のガラスの太陽にひびが入り、こぼれた光のかけらが石や虫や機械に宿ってあばれだした。ランナーは 18 の土地をこえて太陽へ向かう。
// 文は相棒の通信士ベリル (灯台から文字で通信してくる) のことば。1 行は全角 20 文字まで (VR で一目で読める長さ)
export const STORY = {
  // プロローグ (初めて 1 面から出撃したときだけ。飛ばせる)
  prologue: [
    'むかし、空にはガラスの太陽があった',
    'ある朝、その太陽にひびが入った',
    'こぼれた光は、石や虫に宿ってあばれだした',
    '行こう、ランナー。太陽まで 18 の土地をこえて',
  ],
  // 面のはじめの 1 行 (1〜18 面)
  stage: [
    '夜の空の道だ。撃って、よけて、体を慣らそう',
    '海べりの鏡は光を返してくる。気をつけて',
    '甘い色の森。でも結晶はかたいよ',
    '天井のある谷。上にはにげられない',
    'ひと休み。そりで雲の庭をすべって',
    'こはくの砂丘。空で群れが回ってる',
    'ここから光がうすい。寒くなるよ',
    '岩が歩いてる…亀だ。首を出したら撃って',
    '鉄のトンネル。刃の音をよく聞いて',
    '胞子の沼。光るクラゲの間をぬけて',
    '砂時計の番人が、時を数えてる',
    'つけっぱなしの街灯、ぜんぶ倒しちゃって',
    '太陽が見えてきた。トンボの編隊が来る',
    '暗い広間。床を走る足音…蜘蛛だ',
    '黒曜石のエイが、低くすべってくる',
    '嵐の中だ。雷の帯は上か下へよけて',
    '磁石の機雷は、はじける前に撃って',
    'ここが太陽の前。かけらが集まってくる',
  ],
  // ボスを倒したとき (逃げられたとき) の 1 行
  boss: {
    serpent: ['連珠がほどけて、光の粒に戻った'],
    mirror: ['鏡のくもりが晴れた'],
    twin: ['2 つの頭が、1 つの石に戻った'],
    squad: ['部隊は止まった。もう掘らない', '部隊は谷の奥へ帰っていった'],
    swarm: ['群れがほどけて、砂に光が降った', '群れは空の向こうへ散った'],
    crown: ['冠がとけて、平原に朝が来た'],
    worm: ['大蛇は谷の底でねむった'],
    turbine: ['刃が止まった。静かになったね'],
    geodering: ['輪が閉じて、沼の光が落ち着いた', '輪は沼の底へしずんだ'],
    phantom: ['分身が消えて、夕日が戻った'],
    laserwing: ['母船が翼をたたんだ'],
    mantis: ['カマキリが鎌を下ろした'],
    whale: ['鯨が潜った。熱が冷めていく'],
    mine: ['出撃口が閉じた。嵐が弱まる'],
    colossus: ['巨像がひざをついた。太陽はすぐそこ'],
    sun: ['太陽が光を 7 色に分け直した'],
  },
  // 章の区切り (6 面と 12 面のあと。初回だけ)
  chapter: {
    6: ['ひびが広がってる。光がうすくなってきた', 'ここからは寒いよ。がんばって'],
    12: ['太陽が見えてきた。もう少しだよ', '…帰ったら、街灯のこと怒られないかな'],
  },
  // エンディング (はじめと終わりの 2 行ずつ。敵の見送りに重ねて出す)
  endingStart: ['空に色が戻った', 'かけらが抜けて、みんな元の姿に戻っていく'],
  endingEnd: ['おかえり、ランナー', '明日の太陽は、きっときれいだよ'],
};
