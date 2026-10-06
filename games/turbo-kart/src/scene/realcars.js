// 本格モードの車体（実車に近い形）: レーシングカートとフォーミュラ
// 前方 = ローカル +X、右 = +Z、地面 = y 0
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mirrorGlass } from './mirrors.js';

const V2 = (x, y) => new THREE.Vector2(x, y);

// 横から見た輪郭（[x, y] の並び。x = 前、y = 上）を押し出し、x の位置ごとに幅を変えた立体
export function profileBody(points, widthAt, material) {
  const shape = new THREE.Shape(points.map(([x, y]) => V2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -0.5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * widthAt(p.getX(i), p.getY(i)));
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

// a から b へ伸びる円柱（パイプ・アーム）
export function tube(a, b, r, material, seg = 8) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), seg), material);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// 車輪（タイヤ + ホイール + 側面の色の帯）。返り値は KartModel / CarModel の wheels と同じ形
function wheel(group, x, z, r, w, front, tire, rim, band) {
  const pivot = new THREE.Group();
  pivot.position.set(x, r, z);
  const spin = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 28), tire);
  t.rotation.x = Math.PI / 2;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.01, 20), rim);
  hub.rotation.x = Math.PI / 2;
  spin.add(t, hub);
  if (band) {
    for (const s of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.8, r * 0.035, 6, 32), band);
      ring.position.z = (s * (w + 0.004)) / 2;
      spin.add(ring);
    }
  }
  pivot.add(spin);
  group.add(pivot);
  return { pivot, spin, front };
}

// ---- レーシングカート ----
// 返り値: { eye, steerPos, steerTilt, wheelR }
export function buildRealKart(model, { paint, accent, dark, tire, rim, plate }) {
  const g = model.group;
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.85, roughness: 0.35 });
  const plastic = new THREE.MeshStandardMaterial({ color: 0x1d1e22, roughness: 0.6 });
  // フレーム（鋼管）: 2 本の主パイプと横のパイプ
  for (const z of [-0.26, 0.26]) g.add(tube(V3(-0.78, 0.07, z * 1.15), V3(0.62, 0.07, z * 0.8), 0.016, steel));
  for (const x of [-0.6, -0.1, 0.35]) g.add(tube(V3(x, 0.07, -0.3), V3(x, 0.07, 0.3), 0.014, steel));
  for (const s of [-1, 1]) {
    g.add(tube(V3(0.55, 0.07, s * 0.2), V3(0.55, 0.07, s * 0.58), 0.014, steel)); // 前輪へ
    g.add(tube(V3(-0.62, 0.07, s * 0.3), V3(-0.62, 0.07, s * 0.62), 0.014, steel)); // 後輪へ
  }
  // リアアクスル
  g.add(tube(V3(-0.62, 0.14, -0.72), V3(-0.62, 0.14, 0.72), 0.02, steel));
  // フロアトレイ
  const floor = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.01, 0.42), plastic);
  floor.position.set(0.2, 0.06, 0);
  // フロントカウル（ノーズ）: 前が低く、ドライバーの足元に向かって盛り上がる
  const nose = profileBody([[1.0, 0.06], [1.02, 0.17], [0.92, 0.26], [0.7, 0.3], [0.55, 0.3], [0.55, 0.06]],
    (x) => lerp(0.62, 0.9, (x - 0.55) / 0.45), paint);
  // フロントパネル（足を守る縦の板）
  const panel = profileBody([[0.58, 0.18], [0.5, 0.46], [0.44, 0.46], [0.48, 0.18]], () => 0.4, accent);
  // サイドポンツーン
  for (const s of [-1, 1]) {
    const pod = profileBody([[0.48, 0.06], [0.46, 0.17], [0.3, 0.22], [-0.38, 0.22], [-0.46, 0.15], [-0.46, 0.06]],
      () => 0.2, paint);
    pod.position.z = s * 0.55;
    g.add(pod);
  }
  // リアバンパー（幅いっぱいの樹脂製）
  const bumper = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.16, 1.42, 3, 0.05), plastic);
  bumper.position.set(-0.9, 0.16, 0);
  // シート（背もたれを少し倒す）
  const seat = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.5, 0.4, 4, 0.12), plastic);
  seat.position.set(-0.36, 0.3, 0);
  seat.rotation.z = 0.32;
  // エンジン（シートの右横）とマフラー
  const engine = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.3, 0.24, 3, 0.04), new THREE.MeshStandardMaterial({ color: 0x5a5e66, metalness: 0.6, roughness: 0.45 }));
  engine.position.set(-0.42, 0.3, 0.42);
  const silencer = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.42, 14), steel);
  silencer.rotation.z = Math.PI / 2;
  silencer.position.set(-0.8, 0.33, 0.4);
  // ゼッケン（ノーズの前）
  const num = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.16), plate);
  num.position.set(0.985, 0.2, 0);
  num.rotation.set(0, Math.PI / 2, -0.35);
  // ステアリングコラム
  g.add(tube(V3(0.52, 0.1, 0), V3(0.17, 0.46, 0), 0.012, steel));
  g.add(floor, nose, panel, bumper, seat, engine, silencer, num);
  // ブーストの炎はマフラーの出口から
  model.flames = [];
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 10), new THREE.MeshBasicMaterial({ color: 0x5fd8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.rotation.z = Math.PI / 2;
  flame.position.set(-1.1, 0.33, 0.4);
  flame.userData.x0 = -1.0;
  flame.visible = false;
  g.add(flame);
  model.flames.push(flame);
  // 車輪: 前は細く、後ろは太い小径のスリック
  const band = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.8 });
  model.wheels = [
    wheel(g, 0.55, -0.6, 0.135, 0.13, true, tire, rim, band),
    wheel(g, 0.55, 0.6, 0.135, 0.13, true, tire, rim, band),
    wheel(g, -0.62, -0.66, 0.14, 0.2, false, tire, rim, band),
    wheel(g, -0.62, 0.66, 0.14, 0.2, false, tire, rim, band),
  ];
  model.rear = { x: -0.62, z: 0.66 };
  return { eye: V3(-0.27, 0.86, 0), steerPos: V3(0.17, 0.47, 0), steerTilt: -0.55, wheelR: 0.14 };
}

// カートのドライバー（寝そべるように座り、足を前に伸ばす）
export function buildKartDriver(driver, suit, helmetMat, visorMat) {
  driver.position.set(-0.3, 0.14, 0);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.28, 4, 10), suit);
  torso.position.set(0.0, 0.3, 0);
  torso.rotation.z = 0.3;
  for (const s of [-1, 1]) {
    driver.add(tube(V3(0.05, 0.1, s * 0.1), V3(0.75, 0.12, s * 0.12), 0.07, suit)); // 脚
    driver.add(tube(V3(-0.02, 0.47, s * 0.17), V3(0.4, 0.34, s * 0.15), 0.05, suit)); // 腕
  }
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 16), helmetMat);
  helmet.position.set(-0.05, 0.71, 0);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.154, 20, 16, -0.9, 1.8, 1.0, 0.75), visorMat);
  visor.rotation.y = -Math.PI / 2;
  visor.position.copy(helmet.position);
  driver.add(torso, helmet, visor);
}

// ---- フォーミュラ ----
// 返り値: { eye, steerPos, hide: 運転席視点で隠す部品 }
export function buildRealFormula(model, { paint, accent, carbon, plate }) {
  const g = model.group;
  const wingMat = carbon;
  // モノコック〜ノーズ: 先端は細く低く、コックピットで最も広い。エンジンカバーはエアボックスへ盛り上がる
  const tubWidth = (x) => {
    if (x > 2.4) return lerp(0.2, 0.36, (3.35 - x) / 0.95);
    if (x > 0.6) return lerp(0.36, 0.78, (2.4 - x) / 1.8);
    if (x > -0.4) return 0.78;
    return lerp(0.78, 0.36, (-0.4 - x) / 1.75);
  };
  const tub = profileBody([
    [3.35, 0.14], [3.33, 0.24], [2.9, 0.36], [2.2, 0.5], [1.4, 0.62], [0.75, 0.66], [0.35, 0.66],
    [-0.15, 0.98], [-0.45, 1.04], [-0.75, 0.96], [-1.5, 0.66], [-2.05, 0.5], [-2.15, 0.2], [-2.0, 0.12], [3.3, 0.12],
  ], tubWidth, paint);
  // 運転席視点用: モノコックの前（ノーズ）と後ろ（エンジンカバー）だけ。間の運転席は cockpit.js の内装で作る
  // 足もとはノーズのカバーの中（実車と同じく上から見えない）。運転席の開口はハンドルのあたりまで
  const tubFront = profileBody([[3.35, 0.14], [3.33, 0.24], [2.9, 0.36], [2.2, 0.5], [1.4, 0.62], [0.75, 0.66], [0.6, 0.66], [0.6, 0.12], [3.3, 0.12]], tubWidth, paint);
  const tubRear = profileBody([[-0.6, 1.0], [-0.75, 0.96], [-1.5, 0.66], [-2.05, 0.5], [-2.15, 0.2], [-2.0, 0.12], [-0.6, 0.12]], tubWidth, paint);
  tubFront.visible = tubRear.visible = false;
  // サイドポッド: 前に吸気口、後ろへ絞り込む
  const pods = profileBody([[0.45, 0.14], [0.45, 0.56], [0.2, 0.6], [-0.7, 0.52], [-1.55, 0.3], [-1.6, 0.14]],
    (x) => (x > 0.1 ? 1.5 : lerp(1.5, 0.8, (0.1 - x) / 1.7)), paint);
  const inlet = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9 });
  for (const s of [-1, 1]) {
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), inlet);
    hole.position.set(0.455, 0.38, s * 0.58);
    hole.rotation.y = Math.PI / 2;
    g.add(hole);
  }
  const airbox = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), inlet);
  airbox.position.set(-0.13, 0.94, 0);
  airbox.rotation.y = Math.PI / 2;
  // シャークフィン
  const fin = profileBody([[-0.6, 1.0], [-1.7, 0.9], [-1.7, 0.6], [-0.9, 0.85]], () => 0.015, paint);
  // フロア
  const floor = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.03, 1.5), carbon);
  floor.position.set(-0.2, 0.1, 0);
  // フロントウイング: 3 枚のエレメントと翼端板
  for (let i = 0; i < 3; i++) {
    const el = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.025, 1.9 - i * 0.12, 2, 0.01), i === 0 ? wingMat : accent);
    el.position.set(3.18 - i * 0.13, 0.12 + i * 0.06, 0);
    el.rotation.z = 0.12 + i * 0.14;
    g.add(el);
  }
  for (const s of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.26, 0.02), wingMat);
    end.position.set(3.08, 0.2, s * 0.96);
    g.add(end);
  }
  // リアウイング: メインプレーンと DRS フラップ、翼端板、中央の支柱
  const main = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.035, 1.0, 2, 0.012), wingMat);
  main.position.set(-2.08, 0.9, 0);
  main.rotation.z = 0.12;
  const flap = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.03, 1.0, 2, 0.01), accent);
  flap.position.set(-2.2, 1.02, 0);
  flap.rotation.z = 0.5;
  const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.03), wingMat);
  pillar.position.set(-2.1, 0.62, 0);
  for (const s of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.02), wingMat);
    end.position.set(-2.12, 0.78, s * 0.51);
    g.add(end);
  }
  // サスペンションのアーム（モノコックから車輪へ）
  const arm = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.4, metalness: 0.3 });
  for (const s of [-1, 1]) {
    for (const [cx, wx] of [[1.95, 1.76], [-1.25, -1.44]]) {
      g.add(tube(V3(cx + 0.25, 0.3, s * 0.2), V3(wx, 0.32, s * 0.68), 0.018, arm, 6));
      g.add(tube(V3(cx - 0.25, 0.3, s * 0.2), V3(wx, 0.32, s * 0.68), 0.018, arm, 6));
      g.add(tube(V3(cx + 0.1, 0.5, s * 0.2), V3(wx, 0.48, s * 0.66), 0.016, arm, 6));
    }
    // ミラー
    const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.07, 0.16, 2, 0.02), paint);
    mirror.position.set(0.5, 0.78, s * 0.55);
    // 鏡の面（自分の車なら後ろの景色が映る。mirrors.js）
    const glass = mirrorGlass(0.14, 0.055, s < 0 ? 0 : 0.62, s < 0 ? 0.38 : 1);
    glass.position.set(0.468, 0.78, s * 0.55);
    g.add(glass);
    model.mirrorGlass.push(glass);
    g.add(mirror, tube(V3(0.5, 0.62, s * 0.4), V3(0.5, 0.75, s * 0.52), 0.01, arm, 4));
  }
  // ヘイロー（運転席の上の保護バー）
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 8, 24, Math.PI), carbon);
  halo.rotation.set(0, Math.PI / 2, 0);
  halo.scale.set(1, 0.55, 1.1);
  halo.position.set(0.1, 0.8, 0);
  const strut = tube(V3(0.52, 0.66, 0), V3(0.42, 0.98, 0), 0.03, carbon);
  // ゼッケン（ノーズの上）
  const num = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), plate);
  num.position.set(2.0, 0.555, 0);
  num.rotation.set(-Math.PI / 2, 0, -Math.PI / 2 + 0.1);
  g.add(tub, pods, airbox, fin, floor, main, flap, pillar, halo, strut, num, tubFront, tubRear);
  return { eye: V3(-0.05, 0.86, 0), steerPos: V3(0.32, 0.6, 0), hide: [halo, strut, airbox, fin, tub, pods], show: [tubFront, tubRear] };
}
