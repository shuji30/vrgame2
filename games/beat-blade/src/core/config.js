// ゲーム全体で共有する定数（three.js に依存しない）

// レーン（左→右）と段（下→上）。単位はメートル
export const LANE_X = [-0.75, -0.25, 0.25, 0.75];
export const ROW_Y = [0.8, 1.2, 1.6];

export const NOTE_SIZE = 0.4;
// 当たり判定は見た目より少し大きめ
export const NOTE_HALF = { x: 0.23, y: 0.23, z: 0.26 };
export const BOMB_HALF = { x: 0.17, y: 0.17, z: 0.17 };

// ノーツはビート時刻ちょうどに z = HIT_Z へ到達する（プレイヤーは原点で -Z を向く）
export const HIT_Z = -1.0;
// オートプレイ／デスクトップ操作時の手の z 位置
export const HAND_Z = HIT_Z + 0.45;
// これより手前に来たらミス
export const MISS_Z = 0.5;
// これより奥のノーツは切れない
export const CUT_MIN_Z = -2.6;
// ノーツが出現してから到達するまでの秒数
export const LOOKAHEAD = 1.8;

export const BLADE_LENGTH = 1.0;
// 手（コントローラー原点）から刀身の付け根までの距離
export const BLADE_OFFSET = 0.05;
// オートプレイ／デスクトップ時の刀身の上向き傾き（ラジアン）
export const BLADE_TILT = 0.08;

// 切断とみなす最低スイング速度 (m/s)
export const MIN_CUT_SPEED = 0.9;
// 矢印方向との内積がこれ以上なら正しい方向（約 66°）
export const DIR_TOLERANCE = 0.4;

export const HEAD_RADIUS = 0.11;

export const COLORS = {
  left: 0xff2a55,
  right: 0x2a8cff,
  bomb: 0x22222c,
  wall: 0xff3cac,
};
