// GT3・フォーミュラの車内（運転席視点のときだけ表示する）: シート、ダッシュボード、メーター、ドアの内張り、
// ロールケージ、足もとのアクセルとブレーキなど。外から見る車体は運転席の中まで詰まっているので、
// 車内視点では代わりにこれを出す。ペダルは実車と同じくダッシュボードの下（VR でのぞき込むと見える）
// 前方 = ローカル +X、右 = +Z
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mat } from './theme.js';
import { mirrorGlass } from './mirrors.js';

const box = (w, h, d, m, x, y, z, r = 0.02) => {
  const mesh = new THREE.Mesh(r > 0 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
};

// x0..x1（前後）、y0..y1（高さ）、z0..z1（左右）の箱
const span = (x0, x1, y0, y1, z0, z1, m, r = 0.02) => box(x1 - x0, y1 - y0, z1 - z0, m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, r);

// バケットシート（seat: 座面の中心、recline: 背もたれの傾き）
function seat(theme, { x, y, z, recline, width = 0.5, accent }) {
  const g = new THREE.Group();
  const fabric = mat(theme, { color: 0x24252c }, 'rubber');
  const shell = mat(theme, { color: 0x15161a }, 'carbon');
  const belt = mat(theme, { color: accent ?? 0xe0402a }, 'paint');
  g.position.set(x, y, z);
  // 座面と、太ももの横の張り出し
  g.add(box(0.48, 0.07, width, fabric, 0, 0, 0, 0.03));
  for (const s of [-1, 1]) g.add(box(0.44, 0.1, 0.07, shell, 0, 0.05, s * (width / 2 + 0.02), 0.03));
  // 背もたれ（腰から後ろへ傾ける）。肩の張り出しとヘッドレスト、ベルト
  const back = new THREE.Group();
  back.position.set(-0.24, 0.02, 0);
  back.rotation.z = recline;
  back.add(box(0.07, 0.72, width, fabric, -0.03, 0.36, 0, 0.03));
  back.add(box(0.06, 0.74, width + 0.08, shell, -0.08, 0.37, 0, 0.03));
  for (const s of [-1, 1]) {
    back.add(box(0.14, 0.5, 0.07, shell, 0.03, 0.42, s * (width / 2 + 0.02), 0.03));
    back.add(box(0.012, 0.6, 0.05, belt, 0.0, 0.42, s * 0.11, 0));
  }
  back.add(box(0.1, 0.2, 0.3, shell, -0.02, 0.84, 0, 0.04));
  g.add(back);
  // 腰のベルト
  g.add(box(0.05, 0.012, width * 0.8, belt, 0.1, 0.045, 0, 0));
  return g;
}

// 吊り下げ式のペダル（上の軸を中心に、踏むと前へ倒れる）
function pedal(theme, { x, y, z, len, padW, padH, color }) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const arm = mat(theme, { color: 0x8c9099 }, 'metal');
  const pad = mat(theme, { color }, 'metal');
  pivot.add(box(0.025, len, 0.025, arm, 0, -len / 2, 0, 0));
  const p = box(0.02, padH, padW, pad, -0.015, -len, 0, 0.006);
  p.rotation.z = 0.25;
  pivot.add(p);
  return pivot;
}

// opts: { kind: 'gt3' | 'formula', theme, real, seatZ, eye, paint, carbon, accent }
// 返り値: { group: 車内（運転席視点のときだけ表示する）, pedals: { accel, brake }, mirrors: ルームミラーの鏡 }
export function buildCockpit(opts) {
  const { kind, theme, seatZ, eye, paint } = opts;
  const g = new THREE.Group();
  const trim = mat(theme, { color: 0x3c3e47 }, 'carbon');
  const floorMat = mat(theme, { color: 0x2c2d33 }, 'rubber');
  const metal = mat(theme, { color: 0xb8bcc4 }, 'metal');

  let pedals;
  const mirrors = [];
  if (kind === 'gt3') {
    // 床・センタートンネル・足もとの奥の壁・ダッシュボードの下側（ひざの前）
    g.add(span(-1.0, 1.35, 0.26, 0.3, -0.92, 0.92, floorMat, 0));
    g.add(span(-0.75, 0.95, 0.3, 0.52, -0.15, 0.15, trim));
    g.add(span(0.98, 1.06, 0.3, 0.86, -0.92, 0.92, trim, 0));
    g.add(span(0.55, 0.98, 0.62, 0.86, -0.92, 0.92, trim));
    // エアコンの吹き出し口
    for (const z of [-0.75, -0.06, 0.1, 0.75]) g.add(span(0.27, 0.29, 0.86, 0.9, z - 0.05, z + 0.05, floorMat, 0));
    // A ピラーとフロントガラスの上枠、天井の内張り（前の景色の枠になる）
    for (const s of [-1, 1]) g.add(tube(new THREE.Vector3(0.62, 0.86, s * 0.86), new THREE.Vector3(0.0, 1.3, s * 0.78), 0.045, trim));
    g.add(span(-0.05, 0.05, 1.27, 1.33, -0.8, 0.8, trim, 0.02));
    g.add(span(-1.05, -0.05, 1.32, 1.36, -0.8, 0.8, mat(theme, { color: 0x2e3036 }, 'rubber'), 0));
    // ルームミラー（フロントガラスの上枠から吊るし、運転手の方へ向ける。後ろの景色の中央が映る）。ドリフト車はドアミラーだけ
    if (opts.roomMirror !== false) {
    const roomMirror = new THREE.Group();
    roomMirror.position.set(0.02, 1.19, -0.08);
    roomMirror.rotation.y = -0.35;
    roomMirror.add(box(0.035, 0.085, 0.28, trim, 0.0, 0, 0, 0.015));
    const room = mirrorGlass(0.26, 0.07, 0.26, 0.74);
    room.position.set(-0.019, 0, 0);
    roomMirror.add(room);
    g.add(roomMirror);
    g.add(span(0.0, 0.03, 1.23, 1.28, -0.1, -0.06, trim, 0));
    mirrors.push(room);
    }
    // ドアの取っ手（内側）
    for (const s of [-1, 1]) g.add(span(0.2, 0.32, 0.78, 0.81, s > 0 ? 0.83 : -0.86, s > 0 ? 0.86 : -0.83, metal, 0.005));
    // ドアの内張り（左右）と、肘置き
    for (const s of [-1, 1]) {
      g.add(span(-1.0, 1.3, 0.3, 0.88, s > 0 ? 0.86 : -0.94, s > 0 ? 0.94 : -0.86, trim));
      g.add(span(-0.6, 0.3, 0.7, 0.76, s > 0 ? 0.78 : -0.86, s > 0 ? 0.86 : -0.78, floorMat));
    }
    // シートの後ろの隔壁（振り返っても道路が素通しにならない）
    g.add(span(-1.08, -1.0, 0.3, 1.05, -0.92, 0.92, trim, 0));
    // ロールケージ: シートの後ろの輪とドアに沿った棒
    for (const s of [-1, 1]) {
      g.add(tube(new THREE.Vector3(-0.95, 0.3, s * 0.8), new THREE.Vector3(-0.95, 1.05, s * 0.72), 0.025, metal));
      g.add(tube(new THREE.Vector3(-0.95, 0.75, s * 0.82), new THREE.Vector3(0.9, 0.7, s * 0.8), 0.022, metal));
    }
    g.add(tube(new THREE.Vector3(-0.95, 1.05, -0.72), new THREE.Vector3(-0.95, 1.05, 0.72), 0.025, metal));
    // センターコンソールとシーケンシャルのシフトレバー
    g.add(span(0.05, 0.6, 0.52, 0.66, -0.13, 0.13, trim));
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8), metal);
    lever.position.set(0.15, 0.75, -0.05);
    lever.rotation.z = 0.25;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), trim);
    knob.position.set(0.12, 0.86, -0.05);
    g.add(lever, knob);
    g.add(seat(theme, { x: eye.x + 0.05, y: 0.42, z: seatZ, recline: 0.28, accent: opts.accent }));
    // フットレスト（左足）とペダル（右足でアクセル、その左にブレーキ）
    g.add(span(0.7, 0.96, 0.3, 0.44, seatZ - 0.3, seatZ - 0.2, metal, 0.01));
    pedals = {
      brake: pedal(theme, { x: 0.8, y: 0.62, z: seatZ - 0.03, len: 0.24, padW: 0.11, padH: 0.09, color: 0xe8ebf0 }),
      accel: pedal(theme, { x: 0.8, y: 0.62, z: seatZ + 0.14, len: 0.27, padW: 0.08, padH: 0.15, color: 0xe8ebf0 }),
    };
    if (!opts.real) {
      // アニメ調の GT3 は外の車体が運転席まで詰まっているので、ボンネット・後ろ・ドアの外板を代わりに出す
      g.add(span(0.8, 2.3, 0.24, 0.86, -1.0, 1.0, paint, 0.2));
      g.add(span(-2.3, -1.0, 0.24, 0.86, -1.0, 1.0, paint, 0.2));
      for (const s of [-1, 1]) g.add(span(-1.05, 1.3, 0.24, 0.86, s > 0 ? 0.94 : -1.0, s > 0 ? 1.0 : -0.94, paint, 0.02));
    }
  } else {
    // フォーミュラ: 細いモノコックの中に寝そべるように座る。足もと（ペダル）はノーズのカバーの中
    const half = opts.real ? 0.39 : 0.37;
    g.add(span(-0.6, 1.3, 0.12, 0.16, -half, half, floorMat, 0));
    for (const s of [-1, 1]) g.add(span(-0.6, 0.6, 0.16, opts.real ? 0.64 : 0.62, s > 0 ? half - 0.04 : -half, s > 0 ? half : -half + 0.04, paint, 0.015));
    // 内側の黒い内張り（モノコックの内壁）と、運転席の開口のふちのパッド
    for (const s of [-1, 1]) {
      g.add(span(-0.55, 0.6, 0.18, 0.5, s > 0 ? half - 0.06 : -half + 0.04, s > 0 ? half - 0.04 : -half + 0.06, trim, 0));
      g.add(span(-0.6, 0.2, 0.6, 0.66, s > 0 ? half - 0.1 : -half, s > 0 ? half : -half + 0.1, floorMat, 0.025));
    }
    // 足もとの奥の壁（ノーズの付け根）と、シートの後ろの隔壁
    g.add(span(1.3, 1.36, 0.12, 0.6, -half, half, trim, 0));
    g.add(span(-0.68, -0.6, 0.12, opts.real ? 0.95 : 0.8, -half, half, trim, 0));
    g.add(seat(theme, { x: eye.x, y: 0.22, z: 0, recline: 0.55, width: 0.42, accent: opts.accent }));
    pedals = {
      brake: pedal(theme, { x: 1.12, y: 0.46, z: -0.1, len: 0.2, padW: 0.13, padH: 0.11, color: 0xe8ebf0 }),
      accel: pedal(theme, { x: 1.12, y: 0.46, z: 0.1, len: 0.22, padW: 0.1, padH: 0.16, color: 0xe8ebf0 }),
    };
  }
  g.add(pedals.brake, pedals.accel);
  if (kind === 'formula' && !opts.real) {
    // アニメ調のフォーミュラ: 車体の前後（運転席の前のノーズの付け根と、後ろのエンジンの前）
    g.add(span(0.6, 1.8, 0.21, 0.63, -0.375, 0.375, paint, 0.12));
    g.add(span(-1.6, -0.6, 0.21, 0.63, -0.375, 0.375, paint, 0.12));
    // サイドポッド（運転席の左右だけ）
    for (const s of [-1, 1]) g.add(span(-1.2, 0.5, 0.15, 0.57, s > 0 ? 0.4 : -0.8, s > 0 ? 0.8 : -0.4, paint, 0.15));
  } else if (kind === 'formula') {
    // 写実のフォーミュラ: サイドポッド（運転席の左右だけ。前に吸気口）
    for (const s of [-1, 1]) g.add(span(-1.5, 0.45, 0.14, 0.56, s > 0 ? 0.4 : -0.75, s > 0 ? 0.75 : -0.4, paint, 0.08));
  }
  return { group: g, pedals, mirrors };
}

// GT ハンドル（上下が平らな長方形。左右のグリップ、ボタンの並んだ中央のパネル、裏のシフトパドル）
// ハンドルの面は YZ 平面（運転手は -X 側から見る）。中央には VR のメーター（hud.dash）が付く
export function gtWheel(theme) {
  const g = new THREE.Group();
  const grip = mat(theme, { color: 0x2b2c32 }, 'rubber');
  const carbon = mat(theme, { color: 0x18191d }, 'carbon');
  const metal = mat(theme, { color: 0xb8bcc4 }, 'metal');
  const ez = 0.14, top = 0.1, bottom = -0.09;
  // 左右のグリップ（太め）と、上下の平らな部分（角は丸める）
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, top - bottom - 0.04, 6, 12), grip);
    c.position.set(0, (top + bottom) / 2, s * ez);
    g.add(c);
  }
  g.add(box(0.035, 0.035, ez * 2, grip, 0, top, 0, 0.015));
  g.add(box(0.035, 0.035, ez * 2, grip, 0, bottom, 0, 0.015));
  // 中央のパネル（カーボン）と、左右のボタン・ダイヤル
  g.add(box(0.03, 0.15, ez * 2 - 0.02, carbon, 0.01, 0.0, 0, 0.012));
  const colors = [0xe53935, 0x43a047, 0x1e88e5, 0xfdd835, 0xffffff, 0xfb8c00];
  let i = 0;
  for (const s of [-1, 1]) {
    for (const y of [0.045, 0.0, -0.045]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 12), new THREE.MeshStandardMaterial({ color: colors[i++ % colors.length], roughness: 0.4 }));
      b.rotation.z = Math.PI / 2;
      b.position.set(-0.008, y, s * 0.098);
      g.add(b);
    }
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 14), metal);
    knob.rotation.z = Math.PI / 2;
    knob.position.set(-0.01, -0.07, s * 0.05);
    g.add(knob);
  }
  // シフトパドル（裏側）
  for (const s of [-1, 1]) g.add(box(0.008, 0.11, 0.07, metal, 0.04, 0.03, s * 0.12, 0.004));
  // 真上の目印
  g.add(box(0.037, 0.02, 0.035, mat(theme, { color: 0xffd23f }), 0, top, 0, 0));
  return g;
}

// フォーミュラのハンドル（長方形の本体に左右のグリップ。上にシフトランプ、ボタンとダイヤル、裏に大きなパドル）
export function formulaWheel(theme) {
  const g = new THREE.Group();
  const grip = mat(theme, { color: 0x2b2c32 }, 'rubber');
  const carbon = mat(theme, { color: 0x18191d }, 'carbon');
  const metal = mat(theme, { color: 0xb8bcc4 }, 'metal');
  // 本体（下側が少し広い）
  g.add(box(0.04, 0.12, 0.2, carbon, 0.005, 0.005, 0, 0.02));
  g.add(box(0.04, 0.05, 0.25, carbon, 0.005, -0.045, 0, 0.02));
  // 左右のグリップ（少し外へ開く）
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.1, 6, 12), grip);
    c.position.set(0, -0.005, s * 0.135);
    c.rotation.x = s * 0.2;
    g.add(c);
  }
  // シフトランプ（エンジンの回転が上がると左から点く。carmodel.js の update で光らせる）
  const lights = [0x2ecc40, 0x2ecc40, 0x2ecc40, 0xff3b30, 0xff3b30, 0xff3b30, 0x3a7bff, 0x3a7bff, 0x3a7bff];
  g.userData.shiftLights = lights.map((c, i) => {
    const m = new THREE.MeshBasicMaterial({ color: 0x1c1d22 });
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.008, 0.012), m);
    l.position.set(-0.016, 0.055, (i - 4) * 0.016);
    g.add(l);
    return { material: m, color: new THREE.Color(c) };
  });
  // ボタンとダイヤル
  const colors = [0xfdd835, 0xe53935, 0x1e88e5, 0xffffff];
  let i = 0;
  for (const s of [-1, 1]) {
    for (const y of [0.03, -0.01]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.01, 12), new THREE.MeshStandardMaterial({ color: colors[i++ % colors.length], roughness: 0.4 }));
      b.rotation.z = Math.PI / 2;
      b.position.set(-0.017, y, s * 0.075);
      g.add(b);
    }
    for (const z of [0.03, 0.09]) {
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.018, 14), metal);
      knob.rotation.z = Math.PI / 2;
      knob.position.set(-0.02, -0.05, s * z);
      g.add(knob);
    }
  }
  // 裏の大きなシフトパドル
  for (const s of [-1, 1]) g.add(box(0.006, 0.09, 0.1, metal, 0.04, 0.0, s * 0.09, 0.004));
  return g;
}

// 丸ハンドル（ドリフト車）: 革巻きのリング、3 本スポーク、中央のホーンパッド、真上の目印
export function roundWheel(theme) {
  const g = new THREE.Group();
  const leather = mat(theme, { color: 0x24252b }, 'rubber');
  const metal = mat(theme, { color: 0x9a9ea6 }, 'metal');
  const R = 0.18;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.022, 10, 36), leather);
  ring.rotation.y = Math.PI / 2;
  g.add(ring);
  // スポーク（左右と下）
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.035, R), metal);
    sp.position.set(0.012, Math.sin(a) * R / 2, Math.cos(a) * R / 2);
    sp.rotation.x = -a;
    g.add(sp);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.03, 18), leather);
  hub.rotation.z = Math.PI / 2;
  hub.position.x = 0.005;
  g.add(hub);
  g.add(box(0.03, 0.02, 0.03, mat(theme, { color: 0xffd23f }), 0, R, 0, 0));
  return g;
}

// アナログメーター（ドリフト車）: スピードメーターとタコメーター。運転手から見て左が速度、右が回転
// 返り値: { group, set(kmh, rpm) }（rpm は 0..1）
export function analogGauges(theme) {
  const g = new THREE.Group();
  const faces = [canvasDial('km/h', 260, 20, null), canvasDial('×1000rpm', 9, 1, 7.5)];
  const needles = [];
  const r = 0.058;
  faces.forEach((tex, i) => {
    const z = i === 0 ? -0.068 : 0.068;
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.008, r + 0.008, 0.02, 28), mat(theme, { color: 0x111216 }, 'metal'));
    bezel.rotation.z = Math.PI / 2;
    bezel.position.set(0.01, 0, z);
    const face = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshBasicMaterial({ map: tex }));
    face.rotation.y = -Math.PI / 2;
    face.position.set(-0.001, 0, z);
    // 針（中心で回る。0 の位置は左下）
    const pivot = new THREE.Group();
    pivot.position.set(-0.004, 0, z);
    const n = new THREE.Mesh(new THREE.BoxGeometry(0.002, r * 0.85, 0.004), new THREE.MeshBasicMaterial({ color: 0xff3b1f }));
    n.position.y = r * 0.4;
    pivot.add(n);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.004, 12), new THREE.MeshBasicMaterial({ color: 0x222222 }));
    cap.rotation.z = Math.PI / 2;
    cap.position.set(-0.006, 0, z);
    g.add(bezel, face, pivot, cap);
    needles.push(pivot);
  });
  // 0 が左下（-135°）、最大が右下（+135°）。運転手は -X 側から見るので X 軸まわりに回す
  const ang = (f) => (0.75 - Math.max(0, Math.min(1, f)) * 1.5) * Math.PI;
  return {
    group: g,
    set(kmh, rpm) {
      needles[0].rotation.x = -ang(kmh / 260);
      needles[1].rotation.x = -ang(rpm);
    },
  };
}

// メーターの文字盤（Canvas）。max までの目盛りと数字、red から先は赤
function canvasDial(label, max, step, red) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0d0e12';
  ctx.beginPath();
  ctx.arc(128, 128, 128, 0, Math.PI * 2);
  ctx.fill();
  const toA = (v) => Math.PI * (0.75 + (v / max) * 1.5); // 左下から時計回りに 270°
  if (red != null) {
    ctx.strokeStyle = '#e0261c';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(128, 128, 104, toA(red), toA(max));
    ctx.stroke();
  }
  ctx.strokeStyle = '#f2f2f2';
  ctx.fillStyle = '#f2f2f2';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 26px system-ui, sans-serif';
  for (let v = 0; v <= max + 1e-6; v += step / 2) {
    const a = toA(v), major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    ctx.lineWidth = major ? 5 : 2;
    ctx.beginPath();
    ctx.moveTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112);
    ctx.lineTo(128 + Math.cos(a) * (major ? 92 : 100), 128 + Math.sin(a) * (major ? 92 : 100));
    ctx.stroke();
    if (major && (max <= 10 || v % (step * 2) === 0)) ctx.fillText(String(v), 128 + Math.cos(a) * 72, 128 + Math.sin(a) * 72);
  }
  ctx.font = '20px system-ui, sans-serif';
  ctx.fillStyle = '#aab';
  ctx.fillText(label, 128, 190);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function tube(a, b, r, m) {
  const d = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), m);
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return mesh;
}
