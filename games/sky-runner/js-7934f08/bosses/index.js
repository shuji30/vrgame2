// 新しいボスの一覧。type ごとに 出し方 (spawn) と、部品の動き (kinds: enemies.js の EXTRA と同じ形)
import { MIRROR_KINDS, spawnMirror } from './mirror.js';
import { GEODERING_KINDS, spawnGeodeRing } from './geodering.js';
import { MINE_KINDS, spawnMine } from './mine.js';
import { COLOSSUS_KINDS, spawnColossus } from './colossus.js';

export const BOSSES = {
  mirror: { spawn: spawnMirror, kinds: MIRROR_KINDS },       // ミラーコア: 鏡が弾を撃ち返す
  geodering: { spawn: spawnGeodeRing, kinds: GEODERING_KINDS }, // 晶洞の輪: 殻を開いたときだけ倒せる群れ
  mine: { spawn: spawnMine, kinds: MINE_KINDS },               // 浮遊鉱山: 壊せない母艦。耐えれば去る
  colossus: { spawn: spawnColossus, kinds: COLOSSUS_KINDS },   // 磁鉄の巨像: 電極のバリア、地面の破片を投げる
};
