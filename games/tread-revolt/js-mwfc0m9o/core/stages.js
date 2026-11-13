// ステージ定義:4エリア・全11ステージ(協力ミッション)、試験場、対戦用の戦場
// 原作の構成(固定砲台をすべて壊すとクリア、休眠する敵、エレベーター、発射台、空中要塞)を下敷きに、配置はオリジナル
import { makeRng } from './rng.js';

const box = (kind, x, z, w, d, h, rot = 0, extra = {}) => ({ shape: 'box', kind, x, z, w, d, h, rot, ...extra });
const cyl = (kind, x, z, r, h, extra = {}) => ({ shape: 'cyl', kind, x, z, r, h, ...extra });
const U = (type, x, z, extra = {}) => ({ type, x, z, ...extra });

// 何もない場所に散らす
function scatter(rng, out, n, area, make, keep = []) {
  let tries = 0;
  while (n > 0 && tries++ < n * 40) {
    const x = rng.range(area[0], area[1]);
    const z = rng.range(area[2], area[3]);
    if (keep.some((k) => (x - k[0]) ** 2 + (z - k[1]) ** 2 < k[2] * k[2])) continue;
    out.push(make(x, z, rng));
    n--;
  }
}

const rock = (x, z, rng) => {
  const s = rng.range(2.5, 6);
  return rng.chance(0.5) ? cyl('rock', x, z, s * 0.6, rng.range(2, 4.5)) : box('rock', x, z, s, s * rng.range(0.6, 1.2), rng.range(1.8, 4), rng.range(0, 3));
};
const tree = (x, z, rng) => cyl('tree', x, z, 0.7, rng.range(6, 10));
const sandbag = (x, z, rng) => box('sandbag', x, z, rng.range(6, 10), 1.6, 1.3, rng.range(-0.5, 0.5), { lowCover: true });

// 道に沿った区間を避けるための点列
function along(pts, r) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 8);
    for (let k = 0; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, r]);
  }
  return out;
}

// 市街地のブロック(建物の格子)
function cityBlocks(rng, obs, x0, x1, z0, z1, block = 34, street = 18, skip = []) {
  for (let x = x0; x + block <= x1; x += block + street) {
    for (let z = z0; z + block <= z1; z += block + street) {
      const cx = x + block / 2, cz = z + block / 2;
      if (skip.some((s) => Math.abs(cx - s[0]) < s[2] && Math.abs(cz - s[1]) < s[2])) continue;
      // 1ブロックに建物 1〜4 棟
      const split = rng.int(1, 3);
      if (split === 1) obs.push(box('building', cx, cz, block - 2, block - 2, rng.range(9, 22)));
      else {
        const hw = (block - 3) / 2;
        for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          if (rng.chance(0.2)) continue;
          obs.push(box(rng.chance(0.75) ? 'building' : 'house', cx + (ox * (hw + 1)) / 2, cz + (oz * (hw + 1)) / 2, hw, hw, rng.range(7, 18)));
        }
      }
    }
  }
}

// 屋内の部屋(外周の壁と門)
function room(obs, cx, cz, w, d, doors, h = 7) {
  // doors: { n, s, e, w } に門の情報 {gate: group} か 'open'
  const t = 2;
  const sides = [
    ['n', cx, cz + d / 2, w, t],
    ['s', cx, cz - d / 2, w, t],
    ['e', cx - w / 2, cz, t, d],
    ['w', cx + w / 2, cz, t, d],
  ];
  for (const [k, x, z, ww, dd] of sides) {
    const door = doors[k];
    if (!door) { obs.push(box('wall', x, z, ww, dd, h)); continue; }
    const gap = 16;
    const horiz = ww > dd;
    const len = horiz ? ww : dd;
    const seg = (len - gap) / 2;
    if (horiz) {
      obs.push(box('wall', x - (gap + seg) / 2, z, seg, dd, h));
      obs.push(box('wall', x + (gap + seg) / 2, z, seg, dd, h));
      if (door.gate) obs.push(box('gate', x, z, gap, 1.2, h - 1, 0, { gate: door.gate }));
    } else {
      obs.push(box('wall', x, z - (gap + seg) / 2, ww, seg, h));
      obs.push(box('wall', x, z + (gap + seg) / 2, ww, seg, h));
      if (door.gate) obs.push(box('gate', x, z, 1.2, gap, h - 1, 0, { gate: door.gate }));
    }
  }
}

// ---------------------------------------------------------------- 協力ミッション
const AREA_NAMES = ['', '平原の前線基地', '市街地', '河岸の農耕地', '首都要塞'];

function stage1_1() {
  const rng = makeRng(101);
  const road = [[0, -200], [0, -150], [-40, -110], [-40, -60], [30, -20], [30, 30], [0, 70], [0, 200]];
  const obs = [];
  const keep = [...along(road, 14), [0, 150, 50], [0, -195, 20]];
  scatter(rng, obs, 34, [-105, 105, -200, 60], rock, keep);
  scatter(rng, obs, 26, [-105, 105, -200, 200], tree, [...keep, [0, 140, 75]]);
  scatter(rng, obs, 8, [-80, 80, 80, 140], sandbag, keep);
  obs.push(box('bunker', -55, 175, 14, 8, 4), box('bunker', 55, 175, 14, 8, 4), box('wall', 0, 205, 120, 2, 5));
  obs.push(box('crate', 22, 120, 5, 5, 3), box('crate', -25, 105, 5, 5, 3), box('container', 40, 95, 12, 2.6, 2.8, 0.4), box('container', -45, 130, 12, 2.6, 2.8, -0.2));
  return {
    id: '1-1', area: 1, name: '前線突破', time: 280, size: [220, 420], seed: 11, hills: 1.4,
    bumps: [{ x: -80, z: -40, r: 40, h: 9 }, { x: 85, z: -120, r: 35, h: 8 }, { x: 80, z: 40, r: 30, h: 6 }, { x: -70, z: 90, r: 26, h: 5 }],
    flats: [{ x: 0, z: -195, r: 14 }, { x: -40, z: 175, r: 14 }, { x: 40, z: 175, r: 14 }, { x: 60, z: -20, r: 8 }],
    roads: [{ pts: road, w: 12 }],
    obstacles: obs,
    elevators: [{ x: 60, z: -20 }],
    spawn: { x: 0, z: -195, yaw: 0 },
    exit: { x: 0, z: 192 },
    units: [
      U('lightTank', -30, -150, { yaw: Math.PI }), U('lightTank', -55, -90, { yaw: Math.PI }),
      U('turret8', -10, -80), U('lightTank', 45, -40, { yaw: Math.PI }), U('lightTank', 15, 10, { yaw: Math.PI }),
      U('turret8', 50, 20), U('lightTank', -20, 50, { yaw: Math.PI }),
      ...[[-40, 105], [10, 100], [35, 120], [-25, 150], [25, 150]].map(([x, z]) => U('lightTank', x, z, { yaw: Math.PI, group: 'plain' })),
      U('bigTurret', -40, 175, { yaw: Math.PI }), U('bigTurret', 40, 175, { yaw: Math.PI }),
    ],
    briefing: [
      ['leader', 'こちらリーダー。目標は町へ続く道の先、前線基地の大型砲台2基だ。'],
      ['leader', '敵は近づくまで眠っている。曲がり道ごとに待ち伏せがあるぞ、慎重に進め。'],
      ['mech', '止まって撃てば弾はまっすぐ飛ぶ。走りながらだとばらつくからな。'],
    ],
  };
}

function stage1_2() {
  const rng = makeRng(102);
  const water = [{ x: -70, z: -30, r: 26 }, { x: 60, z: 40, r: 22 }, { x: -20, z: 95, w: 70, d: 18 }];
  const fields = [{ x: 40, z: -70, w: 70, d: 40 }, { x: -70, z: 50, w: 50, d: 60 }, { x: 80, z: -10, w: 40, d: 50 }];
  const obs = [];
  const keep = [[0, -135, 20], ...water.map((w) => [w.x, w.z, (w.r || w.w / 2) + 8]), [0, 125, 40], [-90, -100, 8], [100, 90, 8]];
  scatter(rng, obs, 22, [-140, 140, -140, 140], rock, keep);
  scatter(rng, obs, 18, [-140, 140, -140, 140], tree, keep);
  for (const f of fields) for (let i = 0; i < 3; i++) obs.push(box('hedge', f.x - f.w / 2 + 8 + i * (f.w - 16) / 2, f.z + f.d / 2 + 2, 8, 1.4, 1.2, 0, { lowCover: true }));
  // 発射台の周りの壁(直接は狙えない)
  for (const lx of [-45, 45]) {
    obs.push(box('wall', lx, 118, 18, 2, 4.5), box('wall', lx - 9, 128, 2, 18, 4.5), box('wall', lx + 9, 128, 2, 18, 4.5));
  }
  const pack = [[-20, 10], [10, 0], [25, 25], [-35, 35], [0, 45], [35, -20], [-5, -25], [20, 60]];
  return {
    id: '1-2', area: 1, name: '池と畑', time: 200, size: [300, 300], seed: 12, hills: 1.0,
    bumps: [{ x: -100, z: 100, r: 30, h: 7 }, { x: 110, z: -100, r: 30, h: 6 }],
    flats: [{ x: 0, z: -135, r: 14 }, { x: -45, z: 128, r: 12 }, { x: 45, z: 128, r: 12 }, { x: -90, z: -100, r: 8 }, { x: 100, z: 90, r: 8 }],
    water, fields,
    obstacles: obs,
    elevators: [{ x: -90, z: -100 }, { x: 100, z: 90 }],
    spawn: { x: 0, z: -135, yaw: 0 },
    exit: { x: 0, z: 130 },
    units: [
      ...pack.map(([x, z]) => U('lightTank', x, z, { yaw: Math.PI, group: 'pack' })),
      U('turret8', -40, -60, { group: 'pack' }), U('turret8', 70, 90, { group: 'pack' }),
      U('launcher', -45, 128, { trigger: 'pack' }), U('launcher', 45, 128, { trigger: 'pack' }),
    ],
    briefing: [
      ['leader', '池と畑の地帯だ。水には入れないが、弾は水の上を飛び越える。畑は足が遅くなる。'],
      ['leader', '戦車の群れを片づけると、敵は地下から発射台を出してくるはずだ。'],
      ['mech', '発射台は壁に守られてる。逆立ちして曲射で上から落とせ。エレベーターも使えるぞ。'],
    ],
  };
}

function stage1_b() {
  const rng = makeRng(103);
  const obs = [];
  const loop = [[-80, -60], [80, -60], [100, 40], [40, 100], [-60, 100], [-100, 30]];
  scatter(rng, obs, 24, [-140, 140, -140, 140], rock, [...along([...loop, loop[0]], 16), [0, -125, 20]]);
  scatter(rng, obs, 10, [-140, 140, -140, 140], sandbag, [...along([...loop, loop[0]], 16), [0, -125, 20]]);
  return {
    id: '1-B', area: 1, name: '移動要塞', time: 300, size: [300, 300], seed: 13, hills: 0.8, boss: true,
    bumps: [{ x: 0, z: 20, r: 26, h: 5 }],
    flats: [{ x: 0, z: -125, r: 14 }],
    roads: [{ pts: [...loop, loop[0]], w: 22 }],
    obstacles: obs,
    elevators: [{ x: 0, z: 20 }],
    spawn: { x: 0, z: -125, yaw: 0 },
    exit: { x: 0, z: -110 },
    units: [U('boss', -80, -60, { boss: 'hauler', path: loop }), U('lightTank', -100, 100, { group: 'esc' }), U('lightTank', 100, 100, { group: 'esc' }), U('lightTank', 120, -20, { group: 'esc' })],
    briefing: [
      ['leader', '来たぞ。鉱石運搬車を改造した移動要塞だ。前線の最後の砦になる。'],
      ['mech', '前は装甲が厚い。後ろの機関部が光ってるはずだ、そこを狙え!'],
    ],
  };
}

function stage2_1() {
  const rng = makeRng(201);
  const obs = [];
  cityBlocks(rng, obs, -125, 125, -170, 120, 34, 18, [[0, -165, 30], [0, 150, 40]]);
  obs.push(box('wall', 0, 186, 120, 2, 5), box('crate', -30, 140, 5, 5, 3), box('crate', 30, 140, 5, 5, 3), box('container', 0, 125, 14, 2.6, 2.8));
  const roads = [];
  for (let x = -125 + 34 + 9; x < 125; x += 52) roads.push({ pts: [[x, -190], [x, 190]], w: 16 });
  for (let z = -170 + 34 + 9; z < 120; z += 52) roads.push({ pts: [[-130, z], [130, z]], w: 16 });
  const loop = [[-73, -84], [83, -84], [83, 72], [-73, 72]];
  return {
    id: '2-1', area: 2, name: '市街潜入', time: 270, size: [260, 380], seed: 21, hills: 0, indoor: false, flatGround: true,
    roads, obstacles: obs,
    flats: [],
    spawn: { x: 0, z: -180, yaw: 0 },
    exit: { x: 0, z: 170 },
    units: [
      U('lightTank', -21, -110, { wake: 28 }), U('lightTank', 31, -110, { wake: 28 }), U('scout', -73, -60), U('scout', 83, -40),
      U('lightTank', -73, -32, { wake: 28 }), U('lightTank', 31, -32, { wake: 28 }), U('lightTank', -21, 20, { wake: 28 }), U('turret8', 83, 20),
      U('lightTank', 31, 72, { wake: 28 }), U('lightTank', -73, 72, { wake: 28 }), U('scout', -21, 100), U('heavyTank', 0, 125),
      U('truck', -73, -84, { path: loop }), U('truck', 83, 72, { path: [...loop].reverse() }),
      U('bigTurret', -40, 160, { yaw: Math.PI }), U('bigTurret', 0, 172, { yaw: Math.PI }), U('bigTurret', 40, 160, { yaw: Math.PI }),
    ],
    briefing: [
      ['leader', '町に入る。住民はまだ鉱山に連れて行かれたままだ。北の広場の砲台3基を落とせ。'],
      ['leader', '建物の陰に待ち伏せがいる。角を曲がる前に砲塔を向けておけ。'],
      ['mech', '走り回ってるトラックは公社の補給車だ。壊せばボーナスだぞ。'],
    ],
  };
}

function stage2_b() {
  const rng = makeRng(202);
  const obs = [];
  cityBlocks(rng, obs, -130, 130, -130, 130, 30, 16, [[0, 0, 62], [0, -115, 25]]);
  scatter(rng, obs, 8, [-50, 50, -50, 50], (x, z, r) => box('crate', x, z, 4, 4, 3, r.range(0, 1)), [[0, 0, 12]]);
  return {
    id: '2-B', area: 2, name: '制圧戦車', time: 300, size: [260, 260], seed: 22, hills: 0, flatGround: true, boss: true,
    roads: [{ pts: [[0, -130], [0, 130]], w: 16 }, { pts: [[-130, 0], [130, 0]], w: 16 }],
    obstacles: obs,
    spawn: { x: 0, z: -115, yaw: 0 },
    exit: { x: 0, z: -100 },
    units: [U('boss', 0, 40, { boss: 'walker' }), U('scout', -60, 60, { group: 'esc' }), U('scout', 60, 60, { group: 'esc' })],
    briefing: [
      ['leader', '広場に多脚の制圧戦車がいる。町を押さえつけてきた張本人だ。'],
      ['mech', '脚の関節が光ってる。脚を2本折れば胴体が落ちて、腹の動力炉が狙えるはずだ。'],
    ],
  };
}

function riverWithBridges(x0, x1, z, d, bridges) {
  // 横に流れる川を、橋の位置で区切る
  const out = [];
  let cur = x0;
  for (const b of [...bridges].sort((a, c) => a - c)) {
    if (b - 8 > cur) out.push({ x: (cur + b - 8) / 2, z, w: b - 8 - cur, d });
    cur = b + 8;
  }
  if (x1 > cur) out.push({ x: (cur + x1) / 2, z, w: x1 - cur, d });
  return out;
}

function stage3_1() {
  const rng = makeRng(301);
  const water = riverWithBridges(-160, 160, 0, 26, [-60, 70]);
  const fields = [{ x: -80, z: -80, w: 60, d: 50 }, { x: 70, z: -90, w: 60, d: 40 }, { x: -70, z: 80, w: 60, d: 50 }, { x: 80, z: 70, w: 50, d: 50 }];
  const obs = [];
  const keep = [[0, -165, 20], [-60, 0, 26], [70, 0, 26], [0, 150, 40], [0, 0, 30], [100, -40, 8]];
  scatter(rng, obs, 26, [-145, 145, -170, 170], tree, [...keep, [0, 0, 30], ...water.map((w) => [w.x, w.z, w.w / 2 + 6])]);
  scatter(rng, obs, 12, [-145, 145, -170, 170], rock, [...keep, ...water.map((w) => [w.x, w.z, w.w / 2 + 6])]);
  for (const f of fields) obs.push(box('house', f.x + f.w / 2 + 8, f.z, 8, 10, 6));
  obs.push(box('silo', 30, 120, 8, 8, 12), box('wall', -55, 150, 2, 22, 4.5), box('wall', -35, 150, 2, 22, 4.5), box('wall', -45, 140, 22, 2, 4.5));
  return {
    id: '3-1', area: 3, name: '河岸の畑', time: 270, size: [300, 360], seed: 31, hills: 0.9,
    water, fields,
    roads: [{ pts: [[-60, -180], [-60, 180]], w: 12 }, { pts: [[70, -180], [70, 180]], w: 12 }],
    bridges: [{ x: -60, z: 0, w: 16, d: 30 }, { x: 70, z: 0, w: 16, d: 30 }],
    flats: [{ x: 0, z: -165, r: 14 }, { x: 40, z: 155, r: 12 }, { x: -45, z: 150, r: 14 }, { x: 100, z: -40, r: 8 }],
    obstacles: obs,
    elevators: [{ x: 100, z: -40 }],
    spawn: { x: 0, z: -165, yaw: 0 },
    exit: { x: 0, z: 160 },
    units: [
      U('amphib', -110, 0, { yaw: 1.5 }), U('amphib', 10, 2, { yaw: -1.5 }), U('amphib', 120, -2),
      ...[[-60, -40], [-56, -48], [70, -38], [74, -46], [-60, 40], [70, 45]].map(([x, z]) => U('mine', x, z)),
      U('lightTank', -80, -60), U('lightTank', 70, -110), U('turret8', 0, 60), U('lightTank', -70, 70), U('lightTank', 90, 80), U('heavyTank', 0, 110),
      U('bigTurret', -100, 150, { yaw: Math.PI }), U('bigTurret', 40, 155, { yaw: Math.PI }), U('launcher', -45, 150),
    ],
    briefing: [
      ['leader', '町の食料を支える農地だ。川を渡って対岸の砲台と発射台を落とせ。'],
      ['mech', '川から戦車が出てくるぞ。橋の上には機雷が埋まってるかもしれん。見えたら機銃で撃て。'],
    ],
  };
}

function stage3_2() {
  const rng = makeRng(302);
  const road = [[0, -190], [0, -140], [60, -100], [60, -40], [-50, 0], [-50, 60], [20, 100], [20, 190]];
  const water = [{ x: -90, z: -120, w: 60, d: 40 }, { x: 100, z: 60, w: 50, d: 60 }, { x: -110, z: 120, r: 22 }];
  const mud = [{ x: 0, z: -70, w: 70, d: 34 }, { x: 70, z: 20, w: 50, d: 40 }, { x: -60, z: -40, w: 50, d: 40 }, { x: -20, z: 140, w: 60, d: 30 }];
  const obs = [];
  const keep = [...along(road, 12), ...water.map((w) => [w.x, w.z, (w.r || w.w / 2) + 6]), [20, 170, 40]];
  scatter(rng, obs, 20, [-145, 145, -190, 190], tree, keep);
  scatter(rng, obs, 16, [-145, 145, -190, 190], rock, keep);
  for (const m of mud) obs.push(box('hedge', m.x, m.z - m.d / 2 - 2, m.w * 0.6, 1.2, 1.1, 0, { lowCover: true }));
  return {
    id: '3-2', area: 3, name: '水田の道', time: 290, size: [300, 400], seed: 32, hills: 0.7,
    water, mud, roads: [{ pts: road, w: 11 }],
    flats: [{ x: 0, z: -185, r: 14 }, { x: -20, z: 175, r: 12 }, { x: 20, z: 180, r: 10 }, { x: 60, z: 175, r: 12 }],
    obstacles: obs,
    elevators: [{ x: 100, z: -150 }, { x: -100, z: 40 }],
    spawn: { x: 0, z: -185, yaw: 0 },
    exit: { x: 20, z: 160 },
    units: [
      U('skyFortress', 0, 0, { path: { cx: 0, cz: 20, r: 90 } }),
      U('lightTank', 40, -120), U('amphib', -90, -110), U('mine', 60, -70), U('mine', 55, -60), U('lightTank', 60, -20), U('heavyTank', -40, 20),
      U('amphib', 100, 55), U('turret8', -60, 90), U('commandTank', 20, 120), U('lightTank', -30, 140), U('lightTank', 70, 140),
      U('bigTurret', -20, 175, { yaw: Math.PI }), U('bigTurret', 20, 182, { yaw: Math.PI }), U('bigTurret', 60, 175, { yaw: Math.PI }),
    ],
    briefing: [
      ['leader', '水田の中のくねった道を抜けて、砲台群を叩け。制限時間は長めだが油断するな。'],
      ['leader', '上空に空中要塞がいる。落とさなくても任務は果たせるが、落とせば大きなボーナスだ。'],
      ['mech', '空の相手には曲射だ。爆弾の落ちる場所に赤い印が出るから、そこから逃げろ。'],
    ],
  };
}

function stage3_b() {
  const rng = makeRng(303);
  const water = [{ x: 0, z: 10, w: 70, d: 300 }];
  const obs = [];
  scatter(rng, obs, 18, [-145, 145, -150, 150], tree, [[0, 0, 50], [-80, -120, 20]]);
  scatter(rng, obs, 14, [-145, 145, -150, 150], rock, [[0, 0, 50], [-80, -120, 20]]);
  return {
    id: '3-B', area: 3, name: '浚渫要塞', time: 320, size: [300, 300], seed: 33, hills: 0.8, boss: true,
    water, fields: [{ x: -90, z: 60, w: 50, d: 60 }, { x: 95, z: -60, w: 50, d: 60 }],
    flats: [{ x: -80, z: -120, r: 14 }, { x: -60, z: 40, r: 8 }, { x: 60, z: -30, r: 8 }],
    obstacles: obs,
    elevators: [{ x: -60, z: 40 }, { x: 60, z: -30 }],
    spawn: { x: -80, z: -120, yaw: 0.6 },
    exit: { x: -80, z: -100 },
    units: [U('boss', 0, 60, { boss: 'dredger' }), U('amphib', 0, -60, { group: 'esc' }), U('amphib', 10, 100, { group: 'esc' })],
    briefing: [
      ['leader', '川底をさらう浚渫機を改造した水陸両用の要塞だ。川から上がってくるぞ。'],
      ['mech', '側面の吸気口を壊せば上のハッチが開く。中の動力炉は上からしか狙えん。曲射かエレベーターだ!'],
    ],
  };
}

function stage4_1() {
  const obs = [];
  // 3×3 の部屋。左下から右上へ蛇行して進む
  const S = 64;
  const rooms = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) rooms.push({ i, j, x: (i - 1) * S, z: (j - 1) * S });
  const order = [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1], [0, 2], [1, 2], [2, 2]];
  const doors = new Map();
  const key = (i, j) => `${i},${j}`;
  for (let k = 0; k < order.length; k++) doors.set(key(...order[k]), {});
  for (let k = 0; k < order.length - 1; k++) {
    const [ai, aj] = order[k], [bi, bj] = order[k + 1];
    const g = { gate: `r${k + 1}` };
    const A = doors.get(key(ai, aj)), B = doors.get(key(bi, bj));
    if (bi > ai) { A.w = g; } else if (bi < ai) { A.e = g; } else if (bj > aj) { A.n = g; }
    void B;
  }
  // 壁は共有されるので、部屋ごとに作ると二重になる。外周と仕切りを別に作る
  const half = (S * 3) / 2;
  obs.push(box('wall', 0, half, S * 3, 2, 8), box('wall', 0, -half, S * 3, 2, 8), box('wall', half, 0, 2, S * 3, 8), box('wall', -half, 0, 2, S * 3, 8));
  for (const r of rooms) {
    const d = doors.get(key(r.i, r.j));
    // 北の仕切り
    if (r.j < 2) addPartition(obs, r.x, r.z + S / 2, S, true, d.n || doors.get(key(r.i, r.j + 1)).s);
    if (r.i < 2) addPartition(obs, r.x + S / 2, r.z, S, false, d.w || doors.get(key(r.i + 1, r.j)).e);
  }
  // 部屋の中の柱と機械
  for (const r of rooms) {
    obs.push(cyl('pillar', r.x - 16, r.z - 16, 2, 7), cyl('pillar', r.x + 16, r.z + 16, 2, 7));
    obs.push(box('machine', r.x + 14, r.z - 14, 8, 6, 4));
  }
  const units = [];
  const fill = [
    [['lightTank', -8, 6], ['lightTank', 10, 12]],
    [['heavyTank', 0, 10], ['turret8', -18, 18]],
    [['lightTank', -10, 0], ['lightTank', 10, -10], ['commandTank', 0, 20]],
    [['heavyTank', -10, 0], ['turret8', 15, 15]],
    [['lightTank', 0, 0], ['lightTank', -15, 15], ['lightTank', 15, -15]],
    [['commandTank', 0, 10], ['heavyTank', 12, -10]],
    [['heavyTank', -10, 10], ['heavyTank', 10, -10], ['turret8', 0, 0]],
    [['lightTank', -12, 12], ['commandTank', 12, 12], ['lightTank', 0, -16]],
  ];
  for (let k = 0; k < fill.length; k++) {
    const [i, j] = order[k];
    const r = rooms.find((q) => q.i === i && q.j === j);
    // 部屋 k の敵を全滅させると、次の部屋への門 r(k+1) が開く
    for (const [t, ox, oz] of fill[k]) units.push(U(t, r.x + ox, r.z + oz, { group: `r${k + 1}`, yaw: Math.PI, wake: 40 }));
  }
  const last = rooms.find((q) => q.i === 2 && q.j === 2);
  units.push(
    U('bigTurret', last.x - 14, last.z + 14, { yaw: Math.PI, group: 'r9' }), U('bigTurret', last.x + 14, last.z + 14, { yaw: Math.PI, group: 'r9' }),
    U('bigTurret', last.x - 14, last.z - 6, { yaw: Math.PI, group: 'r9' }), U('bigTurret', last.x + 14, last.z - 6, { yaw: Math.PI, group: 'r9' }),
  );
  return {
    id: '4-1', area: 4, name: '区画制圧', time: 420, size: [S * 3, S * 3], seed: 41, indoor: true, hills: 0,
    obstacles: obs,
    spawn: { x: -S, z: -S - 22, yaw: 0 },
    exit: { x: S, z: S + 18 },
    units,
    briefing: [
      ['leader', 'ザルク採掘公社の現地本部だ。区画を1部屋ずつ制圧していく。'],
      ['leader', '部屋の敵を全滅させると次の門が開く。最後の部屋の大型砲台2組が目標だ。'],
      ['boss', '……ネズミが入り込んだか。ヴェイン・ガード、ここがお前たちの墓場だ。'],
    ],
  };
}

function addPartition(obs, x, z, S, horiz, door) {
  const gap = 16;
  const seg = (S - gap) / 2;
  if (horiz) {
    obs.push(box('wall', x - (gap + seg) / 2, z, seg, 2, 7), box('wall', x + (gap + seg) / 2, z, seg, 2, 7));
    if (door?.gate) obs.push(box('gate', x, z, gap, 1.2, 6, 0, { gate: door.gate }));
    else obs.push(box('wall', x, z, gap, 2, 7));
  } else {
    obs.push(box('wall', x, z - (gap + seg) / 2, 2, seg, 7), box('wall', x, z + (gap + seg) / 2, 2, seg, 7));
    if (door?.gate) obs.push(box('gate', x, z, 1.2, gap, 6, 0, { gate: door.gate }));
    else obs.push(box('wall', x, z, 2, gap, 7));
  }
}

function stage4_2() {
  const rng = makeRng(402);
  const obs = [];
  // 中央の部屋(門は砲台列を壊すと開く)
  room(obs, 0, 80, 70, 60, { s: { gate: 'rows' } }, 8);
  for (const x of [-80, 80]) for (let z = -100; z <= 100; z += 40) obs.push(cyl('pillar', x, z, 2.2, 8));
  scatter(rng, obs, 14, [-110, 110, -130, 40], (x, z, r) => box(r.chance(0.5) ? 'machine' : 'container', x, z, r.range(6, 12), r.range(4, 8), r.range(3, 5), r.range(0, 1.5)), [[0, -135, 20], [0, -40, 12], [0, 20, 30]]);
  const rows = [];
  for (const z of [-50, 15]) for (const x of [-60, -25, 25, 60]) rows.push(U('turret8', x, z, { group: 'rows' }));
  return {
    id: '4-2', area: 4, name: '中央突破', time: 330, size: [240, 300], seed: 42, indoor: true, hills: 0,
    obstacles: obs,
    elevators: [{ x: 0, z: -40 }],
    spawn: { x: 0, z: -135, yaw: 0 },
    exit: { x: 0, z: 95 },
    units: [
      ...rows,
      U('heavyTank', -40, -30, { group: 'rows' }), U('heavyTank', 40, -30, { group: 'rows' }), U('commandTank', 0, 0, { group: 'rows' }),
      U('skyFortress', 0, 60, { path: { cx: 0, cz: 40, r: 60 } }),
      U('lightTank', -15, 75, { group: 'core' }), U('lightTank', 15, 75, { group: 'core' }),
      U('launcher', 0, 92),
    ],
    briefing: [
      ['leader', '本部の中央区画だ。砲台の列を越えれば中央の部屋の門が開く。'],
      ['leader', '最後の発射台を落とせば、残るは奥の掘削機だけだ。'],
      ['boss', '空中要塞、出せ。あの錆びた作業機械どもを一台も通すな。'],
    ],
  };
}

function stage4_b() {
  const obs = [];
  for (const x of [-70, 70]) for (const z of [-80, 0, 80]) obs.push(cyl('pillar', x, z, 3, 9));
  obs.push(box('machine', -40, -40, 10, 8, 4), box('machine', 40, 40, 10, 8, 4), box('container', 40, -60, 12, 3, 3, 0.5), box('container', -40, 60, 12, 3, 3, -0.5));
  return {
    id: '4-B', area: 4, name: '巨大掘削機', time: 360, size: [200, 240], seed: 43, indoor: true, hills: 0, boss: true,
    obstacles: obs,
    elevators: [{ x: -75, z: -40 }, { x: 75, z: 40 }],
    spawn: { x: 0, z: -105, yaw: 0 },
    exit: { x: 0, z: -90 },
    units: [U('boss', 0, 60, { boss: 'driller' }), U('commandTank', -60, 90, { group: 'esc' }), U('commandTank', 60, 90, { group: 'esc' })],
    briefing: [
      ['leader', '最後だ。採掘用の巨大掘削機を作り替えた、公社の防衛の主力機。'],
      ['mech', '正面のドリルには何も効かん。突進させて壁にぶつけろ。止まった隙に後ろの動力炉だ!'],
      ['boss', '掘削機、起動。この惑星の地面ごと、お前たちを削り取ってやる。'],
    ],
  };
}

// ---------------------------------------------------------------- 試験場(訓練場)
export function trainingStage() {
  const obs = [
    box('wall', 0, 60, 30, 2, 5), box('wall', -50, 20, 2, 24, 4), box('wall', 50, 20, 2, 24, 4),
    box('sandbag', -20, 0, 10, 1.6, 1.3, 0, { lowCover: true }), box('sandbag', 20, 0, 10, 1.6, 1.3, 0, { lowCover: true }),
    box('crate', -60, -40, 5, 5, 3), box('crate', 60, -40, 5, 5, 3), box('container', 0, -30, 12, 2.6, 2.8, 1.57),
    cyl('rock', -80, 70, 4, 3), cyl('rock', 80, 70, 4, 3),
  ];
  return {
    id: 'T', area: 1, name: '試験場', time: 0, size: [220, 220], seed: 5, hills: 0.25, training: true,
    flats: [{ x: 0, z: -80, r: 30 }, { x: 70, z: -80, r: 8 }],
    obstacles: obs,
    elevators: [{ x: 70, z: -80 }],
    spawn: { x: 0, z: -80, yaw: 0 },
    units: [
      U('target', 0, -20, { respawn: 4 }), U('target', -30, 40, { respawn: 4 }), U('target', 30, 40, { respawn: 4 }),
      U('target', -70, 10, { respawn: 4 }), U('target', 70, 10, { respawn: 4 }), U('target', 0, 75, { respawn: 4, tag: 'lob' }),
      U('target', -40, 90, { respawn: 4 }), U('target', 45, 95, { respawn: 4 }),
    ],
    briefing: [['mech', 'ようこそ試験場へ。ここでは時間制限なしで、操作をひと通り試せる。']],
  };
}

// ---------------------------------------------------------------- 対戦の戦場
export const ARENAS = {
  plains: () => {
    const rng = makeRng(901);
    const obs = [];
    scatter(rng, obs, 26, [-110, 110, -110, 110], rock, [[0, -100, 18], [0, 100, 18], [0, 0, 10], [-60, 0, 10], [60, 0, 10]]);
    scatter(rng, obs, 12, [-110, 110, -110, 110], sandbag, [[0, -100, 18], [0, 100, 18]]);
    return {
      id: 'V1', area: 1, name: '平原の演習場', size: [240, 240], seed: 91, hills: 1.3, versus: true,
      bumps: [{ x: -60, z: -40, r: 25, h: 6 }, { x: 60, z: 40, r: 25, h: 6 }],
      flats: [{ x: 0, z: -100, r: 16 }, { x: 0, z: 100, r: 16 }, { x: 0, z: 0, r: 10 }, { x: -60, z: 0, r: 10 }, { x: 60, z: 0, r: 10 }, { x: 90, z: -90, r: 8 }, { x: -90, z: 90, r: 8 }],
      obstacles: obs, elevators: [{ x: 90, z: -90 }, { x: -90, z: 90 }],
      bases: [{ x: 0, z: -100, yaw: 0 }, { x: 0, z: 100, yaw: Math.PI }], points: [[-60, 0], [0, 0], [60, 0]],
    };
  },
  city: () => {
    const rng = makeRng(902);
    const obs = [];
    cityBlocks(rng, obs, -120, 120, -100, 100, 30, 18, [[0, -110, 22], [0, 110, 22], [0, 0, 20]]);
    return {
      id: 'V2', area: 2, name: '旧市街', size: [240, 260], seed: 92, hills: 0, flatGround: true, versus: true,
      roads: [{ pts: [[0, -130], [0, 130]], w: 16 }],
      obstacles: obs, bases: [{ x: 0, z: -115, yaw: 0 }, { x: 0, z: 115, yaw: Math.PI }], points: [[-72, 0], [0, 0], [72, 0]],
    };
  },
  river: () => {
    const rng = makeRng(903);
    const water = riverWithBridges(-130, 130, 0, 22, [-70, 0, 70]);
    const obs = [];
    scatter(rng, obs, 24, [-115, 115, -115, 115], tree, [[0, -100, 18], [0, 100, 18], [0, 0, 22], [-70, 0, 22], [70, 0, 22], [-70, -50, 10], [70, 50, 10]]);
    return {
      id: 'V3', area: 3, name: '河岸の橋', size: [240, 240], seed: 93, hills: 0.8, versus: true, water,
      bridges: [{ x: -70, z: 0, w: 16, d: 26 }, { x: 0, z: 0, w: 16, d: 26 }, { x: 70, z: 0, w: 16, d: 26 }],
      fields: [{ x: -60, z: -60, w: 50, d: 30 }, { x: 60, z: 60, w: 50, d: 30 }],
      flats: [{ x: 0, z: -100, r: 16 }, { x: 0, z: 100, r: 16 }],
      obstacles: obs, bases: [{ x: 0, z: -100, yaw: 0 }, { x: 0, z: 100, yaw: Math.PI }], points: [[-70, -40], [0, 0], [70, 40]],
    };
  },
  fortress: () => {
    const obs = [];
    room(obs, 0, 0, 60, 60, { n: 'open', s: 'open', e: 'open', w: 'open' }, 7);
    for (const [x, z] of [[-70, -60], [70, -60], [-70, 60], [70, 60]]) obs.push(box('machine', x, z, 14, 10, 4));
    for (const x of [-40, 40]) for (const z of [-80, 80]) obs.push(cyl('pillar', x, z, 2.2, 7));
    return {
      id: 'V4', area: 4, name: '本部の格納区画', size: [220, 240], seed: 94, indoor: true, hills: 0, versus: true,
      obstacles: obs, elevators: [{ x: -90, z: 0 }, { x: 90, z: 0 }],
      bases: [{ x: 0, z: -105, yaw: 0 }, { x: 0, z: 105, yaw: Math.PI }], points: [[-60, 0], [0, 0], [60, 0]],
    };
  },
};

export const ARENA_LIST = [
  { id: 'plains', name: '平原の演習場' }, { id: 'city', name: '旧市街' }, { id: 'river', name: '河岸の橋' }, { id: 'fortress', name: '本部の格納区画' },
];

// ---------------------------------------------------------------- 一覧
const BUILDERS = [stage1_1, stage1_2, stage1_b, stage2_1, stage2_b, stage3_1, stage3_2, stage3_b, stage4_1, stage4_2, stage4_b];
export const STAGE_COUNT = BUILDERS.length;
export const STAGE_INFO = BUILDERS.map((b, i) => {
  const s = b();
  return { index: i, id: s.id, area: s.area, name: s.name, areaName: AREA_NAMES[s.area], boss: !!s.boss, time: s.time };
});
export function campaignStage(index) {
  const s = BUILDERS[index]();
  s.index = index;
  s.areaName = AREA_NAMES[s.area];
  s.music = s.boss ? 'boss' : `area${s.area}`;
  return s;
}
export function arenaStage(id) {
  const s = (ARENAS[id] || ARENAS.plains)();
  s.areaName = s.name;
  s.music = 'versus';
  return s;
}
export { AREA_NAMES };

// エリアの最後(ボス撃破後)の、町の人々の声
export const LIBERATION = {
  1: [['town', 'こちら町の見張り台……前線基地の旗が降りた!みんな、外へ出られるぞ!']],
  2: [['town', '鉱山から戻ってきた人たちが通りに出てる。ありがとう、ヴェイン・ガード!']],
  3: [['town', '畑に水が戻った。今年の収穫は、取り返したこの手で刈り入れるよ。']],
  4: [['town', '本部が落ちた!公社の連中が港へ逃げていく……ヴェインは、私たちの星だ!']],
};
