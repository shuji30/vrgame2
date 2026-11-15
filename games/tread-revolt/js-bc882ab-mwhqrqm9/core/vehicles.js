// 車種と敵の性能表。バランスの数値はここに集める
import { DEG } from './util.js';

// プレイヤーが選べる車体(戦車3タイプ+歩行メカ)
// speed: 2速で全開のときの履帯速度(m/s)、accel: 履帯の加速(m/s^2)、track: 左右の履帯の間隔(m)
// turnMax: 旋回速度の上限(rad/s)、turret: 砲塔の旋回速度(rad/s)、reload: 主砲の装填(s)
// armor: 受けるダメージの倍率(小さいほど硬い)、radius: 当たり判定の半径、height: 車高、eye: 視点の高さ
export const VEHICLES = {
  light: {
    kind: 'light', name: '軽戦車 ハウンド', desc: '速い・脆い。側面に回り込む', body: 'tank',
    speed: 13, accel: 11, track: 2.5, turnMax: 1.55, turret: 75 * DEG, reload: 2.2,
    hp: 80, armor: 1.25, dmg: 26, splash: 2.5, shellSpeed: 105, radius: 2.1, height: 2.0, eye: 1.9,
    ffbDamper: 0.12, mgRate: 12,
  },
  medium: {
    kind: 'medium', name: '中戦車 マトック', desc: '標準。迷ったらこれ', body: 'tank',
    speed: 10, accel: 8, track: 2.9, turnMax: 1.25, turret: 52 * DEG, reload: 3.0,
    hp: 115, armor: 1.0, dmg: 34, splash: 3, shellSpeed: 95, radius: 2.4, height: 2.4, eye: 2.1,
    ffbDamper: 0.25, mgRate: 11,
  },
  heavy: {
    kind: 'heavy', name: '重戦車 アンヴィル', desc: '遅い・硬い。主砲が重い', body: 'tank',
    speed: 7.6, accel: 5.5, track: 3.3, turnMax: 0.95, turret: 36 * DEG, reload: 3.8,
    hp: 165, armor: 0.72, dmg: 48, splash: 3.6, shellSpeed: 90, radius: 2.8, height: 2.9, eye: 2.5,
    ffbDamper: 0.45, mgRate: 10,
  },
  mech: {
    kind: 'mech', name: '歩行メカ ストライダー', desc: 'いちばん速い。視点が高い。接近戦は主砲のボタンで炸薬パンチ。しゃがみ・急旋回・武器の持ち替え', body: 'mech',
    // いちばん素早く動ける(足の車輪で走る):最高速・加速・旋回とも軽戦車より上
    speed: 14.5, accel: 13, track: 2.3, turnMax: 1.75, turret: 85 * DEG, reload: 2.6,
    hp: 95, armor: 1.15, dmg: 30, splash: 2.8, shellSpeed: 100, radius: 2.0, height: 6.5, eye: 5.6,
    ffbDamper: 0.2, mgRate: 12,
  },
};

export const VEHICLE_ORDER = ['medium', 'light', 'heavy', 'mech'];

// 変速。sp: 速度の倍率、ac: 加速の倍率、turn: 旋回の倍率、brake: 減速の倍率
export const GEARS = {
  1: { sp: 0.55, ac: 1.5, turn: 1.1, brake: 1.4, label: '1' },
  2: { sp: 1.0, ac: 1.0, turn: 1.0, brake: 1.0, label: '2' },
  3: { sp: 1.45, ac: 0.72, turn: 0.72, brake: 0.6, label: '3' },
  R: { sp: 0.6, ac: 1.0, turn: 1.0, brake: 1.0, label: 'R' },
};

// 敵の性能。wake: 起動する距離、range: 射程、score: 撃破点
export const UNITS = {
  lightTank: { hp: 40, speed: 7, accel: 6, track: 2.6, turnMax: 1.1, turret: 45 * DEG, reload: 3.6, dmg: 11, shellSpeed: 70, radius: 2.2, height: 2.2, wake: 55, range: 60, score: 100, body: 'tank', kind: 'lightTank' },
  heavyTank: { hp: 120, speed: 4.6, accel: 3.5, track: 3.4, turnMax: 0.7, turret: 28 * DEG, reload: 4.6, dmg: 20, shellSpeed: 70, radius: 3.0, height: 3.0, wake: 60, range: 70, score: 300, body: 'tank', kind: 'heavyTank' },
  commandTank: { hp: 85, speed: 5.5, accel: 4, track: 3.0, turnMax: 0.9, turret: 35 * DEG, reload: 6.5, dmg: 16, shellSpeed: 26, radius: 2.7, height: 2.8, wake: 65, range: 85, score: 400, body: 'tank', kind: 'commandTank', missiles: true },
  amphib: { hp: 45, speed: 6.5, accel: 5, track: 2.6, turnMax: 1.0, turret: 45 * DEG, reload: 3.8, dmg: 12, shellSpeed: 70, radius: 2.3, height: 2.0, wake: 42, range: 55, score: 200, body: 'tank', kind: 'amphib', swim: true },
  scout: { hp: 22, speed: 14, accel: 12, track: 2.2, turnMax: 1.6, turret: 120 * DEG, reload: 0.12, dmg: 1.2, shellSpeed: 120, radius: 1.9, height: 1.8, wake: 60, range: 40, score: 150, body: 'tank', kind: 'scout', mg: true },
  truck: { hp: 30, speed: 8, accel: 4, track: 2.4, turnMax: 0.8, turret: 0, reload: 99, dmg: 0, shellSpeed: 0, radius: 2.4, height: 3, wake: 45, range: 0, score: 2000, body: 'tank', kind: 'truck', harmless: true, bonus: true },
  turret8: { hp: 30, reload: 4.4, dmg: 10, shellSpeed: 45, radius: 2.4, height: 2.2, wake: 45, range: 60, score: 150, body: 'static', kind: 'turret8' },
  bigTurret: { hp: 150, turret: 30 * DEG, reload: 3.2, dmg: 18, shellSpeed: 75, radius: 3.6, height: 4.5, wake: 75, range: 95, score: 1000, body: 'static', kind: 'bigTurret', objective: true },
  launcher: { hp: 110, reload: 7, dmg: 18, shellSpeed: 24, radius: 4.0, height: 3.0, wake: 90, range: 120, score: 1200, body: 'static', kind: 'launcher', objective: true, lobOnly: true, missiles: true },
  mine: { hp: 1, dmg: 26, radius: 0.9, height: 0.6, wake: 9, range: 6, score: 50, body: 'static', kind: 'mine' },
  skyFortress: { hp: 160, reload: 6, dmg: 16, radius: 9, height: 4, wake: 110, range: 120, score: 3000, body: 'air', kind: 'skyFortress', airOnly: true, bonus: true },
  target: { hp: 20, radius: 1.6, height: 3, wake: 0, range: 0, score: 10, body: 'static', kind: 'target', harmless: true },
};

// 難易度(敵の攻撃力と命中精度)
export const DIFFICULTY = {
  // move:敵の戦車の動き。0 = 止まって撃つ、1 = 装填中に位置を変える、2 = さらに側面・背後を取りに来る
  easy: { label: 'イージー', dmg: 0.6, spread: 1.6, reload: 1.25, move: 0 },
  normal: { label: 'ノーマル', dmg: 1.0, spread: 1.0, reload: 1.0, move: 1 },
  hard: { label: 'ハード', dmg: 1.35, spread: 0.7, reload: 0.85, move: 2 },
};
