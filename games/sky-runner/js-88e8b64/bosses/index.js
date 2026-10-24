// 新しいボスの一覧。type ごとに 出し方 (spawn) と、部品の動き (kinds: enemies.js の EXTRA と同じ形)
import { MIRROR_KINDS, spawnMirror } from './mirror.js';
import { GEODERING_KINDS, spawnGeodeRing } from './geodering.js';
import { MINE_KINDS, spawnMine } from './mine.js';
import { COLOSSUS_KINDS, spawnColossus } from './colossus.js';
import { SUN_KINDS, spawnSun } from './sun.js';
import { CROWN_KINDS, spawnCrown } from './crown.js';
import { WORM_KINDS, spawnWorm } from './worm.js';
import { TURBINE_KINDS, spawnTurbine } from './turbine.js';
import { PHANTOM_KINDS, spawnPhantom } from './phantom.js';
import { LASERWING_KINDS, spawnLaserWing } from './laserwing.js';
import { MANTIS_KINDS, spawnMantis } from './mantis.js';
import { WHALE_KINDS, spawnWhale } from './whale.js';

export const BOSSES = {
  mirror: { spawn: spawnMirror, kinds: MIRROR_KINDS },       // ミラーコア: 鏡が弾を撃ち返す
  geodering: { spawn: spawnGeodeRing, kinds: GEODERING_KINDS }, // 晶洞の輪: 殻を開いたときだけ倒せる群れ
  mine: { spawn: spawnMine, kinds: MINE_KINDS },               // 浮遊鉱山: 出撃口を壊すと本体に弾が効く
  colossus: { spawn: spawnColossus, kinds: COLOSSUS_KINDS },   // 磁鉄の巨像: 電極のバリア、地面の破片を投げる
  sun: { spawn: spawnSun, kinds: SUN_KINDS },
  crown: { spawn: spawnCrown, kinds: CROWN_KINDS },            // 氷晶の冠: つららの雨 (地面に予告の印)
  worm: { spawn: spawnWorm, kinds: WORM_KINDS },               // 砂岩の大蛇: 地面から弧を描いて飛び出す。頭だけが弱点
  turbine: { spawn: spawnTurbine, kinds: TURBINE_KINDS },      // 双子の回転刃: 円盤を投げてくる。中央の核を撃つ
  phantom: { spawn: spawnPhantom, kinds: PHANTOM_KINDS },      // 水晶の亡霊: 分身と入れ替わる。影のある本物を撃つ
  laserwing: { spawn: spawnLaserWing, kinds: LASERWING_KINDS }, // 光翼の母船: 予告の線のあと光線で薙ぎ払う
  mantis: { spawn: spawnMantis, kinds: MANTIS_KINDS },         // 硝子のカマキリ: 鎌の斬撃。振り終わりに腹の結晶が開く
  whale: { spawn: spawnWhale, kinds: WHALE_KINDS },            // 溶岩の結晶鯨: 地面から浮上して火の玉。潮吹き穴が弱点                  // 最終ボス プリズムの太陽: 鏡 → 投げる → 開いたときだけ
};
