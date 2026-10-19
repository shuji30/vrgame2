// 地面・空・遠景・障害物
import * as THREE from 'three';

export const FOG_NEAR = 70;
export const FOG_FAR = 210;
const SPAWN_Z = -210;
const SPAWN_SPACING = 14;   // 何 m 進むごとに障害物を出すか (速度に関係なく密度が一定になる。巨大なので間隔は広め)
const REMOVE_Z = 40;        // 後ろを振り返っても急に消えて見えないよう、少し後ろまで残す
const CHECKER = 8;          // 市松模様の1マス (m)
export const CEIL_Y = 26;   // 天井の高さ (m)

export const THEMES = [
  { name: 'MEADOW', a: 0xe9cf6a, b: 0x3e9c3c, fog: 0xf6dcae, sky: 0x2f72d8, mount: 0x5a70a8, col: ['#f4f4f4', '#e2559a'], bush: 0x2e8b3a },
  { name: 'LAGOON', a: 0x86d8ff, b: 0x2a52b8, fog: 0xcbe9ff, sky: 0x18287a, mount: 0x4a5a9a, col: ['#ffe066', '#ff7a1a'], bush: 0x2fb0a0 },
  { name: 'DREAM', a: 0xffa3d2, b: 0x8a3cb8, fog: 0xffd2ea, sky: 0x44106e, mount: 0x8a5aaa, col: ['#ffffff', '#3ec0ff'], bush: 0xd062c4 },
  { name: 'VOLCANO', a: 0x484848, b: 0xb02424, fog: 0x5a2622, sky: 0x0a0214, mount: 0x301010, col: ['#c8c8c8', '#383838'], bush: 0x806040 },
];

const groundVert = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// 遠くでちらつかないよう、画素の大きさで模様をぼかす (box-filtered checker)
const groundFrag = /* glsl */ `
uniform float uOff;
uniform vec3 cA;
uniform vec3 cB;
uniform vec3 fogC;
uniform float fogNear;
uniform float fogFar;
varying vec3 vW;
float checker(vec2 p) {
  vec2 w = fwidth(p) + 0.001;
  vec2 i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
  return 0.5 - 0.5 * i.x * i.y;
}
void main() {
  vec2 p = vec2(vW.x, vW.z - uOff) / ${CHECKER.toFixed(1)};
  vec3 col = mix(cA, cB, checker(p));
  float d = distance(vW.xz, cameraPosition.xz);
  col = mix(col, fogC, smoothstep(fogNear, fogFar, d));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const skyVert = /* glsl */ `
varying vec3 vP;
void main() {
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const skyFrag = /* glsl */ `
uniform vec3 top;
uniform vec3 bottom;
varying vec3 vP;
void main() {
  float h = normalize(vP).y;
  gl_FragColor = vec4(mix(bottom, top, smoothstep(0.0, 0.45, h)), 1.0);
  #include <colorspace_fragment>
}`;

const rand = (a, b) => a + Math.random() * (b - a);

function stripeTexture(c1, c2) {
  const cv = document.createElement('canvas');
  cv.width = 4;
  cv.height = 64;
  const g = cv.getContext('2d');
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? c2 : c1;
    g.fillRect(0, i * 8, 4, 8);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

// 障害物の種類 (ステージ表 obstacles の重みの名前)
export const OBSTACLE_KINDS = ['column', 'bush', 'tree', 'rock', 'mushroom', 'crystal', 'arch', 'monolith', 'spike', 'ring'];

export class World {
  constructor(scene) {
    this.scene = scene;
    scene.fog = new THREE.Fog(0xffffff, FOG_NEAR, FOG_FAR);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.8));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(30, 60, 25);
    scene.add(sun);

    // 地面
    this.groundUni = {
      uOff: { value: 0 },
      cA: { value: new THREE.Color() },
      cB: { value: new THREE.Color() },
      fogC: { value: new THREE.Color() },
      fogNear: { value: FOG_NEAR },
      fogFar: { value: FOG_FAR },
    };
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400),
      new THREE.ShaderMaterial({ uniforms: this.groundUni, vertexShader: groundVert, fragmentShader: groundFrag }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = -450;
    scene.add(ground);
    // 天井 (天井のある面だけ表示)。床と同じ模様を、下向きに貼る
    // (床と同じ uniforms を共有するので、色と模様の流れも床と一緒に変わる)
    this.ceiling = new THREE.Mesh(ground.geometry, new THREE.ShaderMaterial({
      uniforms: this.groundUni, vertexShader: groundVert, fragmentShader: groundFrag, side: THREE.DoubleSide,
    }));
    this.ceiling.rotation.x = Math.PI / 2;
    this.ceiling.position.set(0, CEIL_Y, -450);
    this.ceiling.visible = false;
    scene.add(this.ceiling);

    // 空 (カメラに追従する大きな球)
    this.skyUni = { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1500, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.skyUni, vertexShader: skyVert, fragmentShader: skyFrag,
        side: THREE.BackSide, depthWrite: false,
      }),
    );
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    // 遠景の山 (フォグの外側にあるので、色をあらかじめ空になじませる)
    this.mountMat = new THREE.MeshBasicMaterial({ fog: false });
    this.mountains = new THREE.Group();
    const cone = new THREE.ConeGeometry(1, 1, 5);
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(cone, this.mountMat);
      const w = rand(60, 150), h = rand(40, 130);
      m.scale.set(w, h, w * 0.6);
      m.position.set(-1100 + i * 88 + rand(-30, 30), h / 2 - 2, -1100 + rand(-80, 40));
      m.rotation.y = rand(0, Math.PI);
      this.mountains.add(m);
    }
    scene.add(this.mountains);

    // 障害物の共有ジオメトリとマテリアル
    this.geo = {
      column: new THREE.CylinderGeometry(1, 1, 1, 14),
      cap: new THREE.BoxGeometry(1, 1, 1),
      bush: new THREE.IcosahedronGeometry(1, 0),
      trunk: new THREE.CylinderGeometry(0.25, 0.4, 1, 6),
      leaf: new THREE.ConeGeometry(1, 1, 7),
      shadow: new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2),
      rock: new THREE.DodecahedronGeometry(1, 0),
      mushStem: new THREE.CylinderGeometry(0.35, 0.5, 1, 8),
      mushCap: new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      mushDot: new THREE.SphereGeometry(0.16, 6, 4),
      crystal: new THREE.CylinderGeometry(0.75, 1, 1, 6),
      ring: new THREE.TorusGeometry(1, 0.12, 8, 32),
    };
    this.mat = {
      column: new THREE.MeshStandardMaterial({ roughness: 0.5 }),
      cap: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
      bush: new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.9 }),
      leaf: new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.8 }),
      shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
      rock: new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.95 }),
      mushStem: new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.8 }),
      mushCap: new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.6 }),
      mushDot: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
      crystal: new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.15, metalness: 0.2 }),
      glass: new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.1, metalness: 0.1, color: 0xd8f4ff, emissive: 0x204050 }),
      obsidian: new THREE.MeshStandardMaterial({ color: 0x4a3a6a, roughness: 0.25, metalness: 0.3, emissive: 0x1a1030 }),
      ring: new THREE.MeshBasicMaterial({ color: 0xffe066 }),
    };

    this.obstacles = [];
    this.spawnAcc = 0;
    this.offset = 0;
    this.mode = 'normal'; // 'bonus' のときは木だけを密に出す
    this.side = false;    // 横スクロール: 障害物をプレイヤーの平面 (x = 0) と奥の背景に分けて置く
    this.applyTheme(0);
  }

  // i: THEMES の番号、またはステージ表のパレット (オブジェクト)
  applyTheme(i) {
    this.fade = null;
    const th = typeof i === 'object' ? i : THEMES[i % THEMES.length];
    this.theme = th;
    const fog = new THREE.Color(th.fog);
    this.groundUni.cA.value.setHex(th.a);
    this.groundUni.cB.value.setHex(th.b);
    this.groundUni.fogC.value.copy(fog);
    this.scene.fog.color.copy(fog);
    this.skyUni.bottom.value.copy(fog);
    this.skyUni.top.value.setHex(th.sky);
    this.mountMat.color.setHex(th.mount).lerp(fog, 0.45);
    this.mat.column.map?.dispose();
    this.mat.column.map = stripeTexture(th.col[0], th.col[1]);
    this.mat.column.needsUpdate = true;
    this.mat.bush.color.setHex(th.bush);
    this.mat.leaf.color.setHex(th.bush).multiplyScalar(0.8);
    this.mat.rock.color.setHex(th.mount).lerp(new THREE.Color(0x8a8070), 0.5);
    this.mat.mushCap.color.setHex(th.col[1] ? parseInt(th.col[1].slice(1), 16) : 0xff4a6a);
    // 水晶はステージの空の色を明るくした色、ほのかに光らせる
    this.mat.crystal.color.setHex(th.crystal ?? th.sky).lerp(new THREE.Color(0xffffff), 0.45);
    this.mat.crystal.emissive.setHex(th.crystal ?? th.sky).multiplyScalar(0.25);
  }

  // 色を time 秒かけて移す (エンディング用。VR で視野全体の明るさが急に跳ばないように)。
  // 地面・霧・空・遠景の色だけを混ぜ、障害物の色はすぐに変える
  fadeTheme(i, time = 1.2) {
    const cols = () => [this.groundUni.cA.value, this.groundUni.cB.value, this.groundUni.fogC.value, this.scene.fog.color,
      this.skyUni.bottom.value, this.skyUni.top.value, this.mountMat.color];
    const from = cols().map((c) => c.clone());
    this.applyTheme(i);
    const to = cols().map((c) => c.clone());
    cols().forEach((c, k) => c.copy(from[k]));
    this.fade = { cols, from, to, t: 0, time };
  }

  // ステージごとの障害物の出方 ({ column, bush, tree, rock, mushroom, lane })
  setObstacles(table) {
    this.obstacleTable = table || null;
  }

  pickKind() {
    const t = this.obstacleTable;
    if (!t) return undefined;
    const kinds = OBSTACLE_KINDS.filter((k) => t[k] > 0);
    let r = Math.random() * kinds.reduce((a, k) => a + t[k], 0);
    return kinds.find((k) => (r -= t[k]) < 0) || kinds[0];
  }

  // 天井のある面: 床と同じ模様の天井を、上に重ねる
  setCeiling(on) {
    this.ceiling.visible = !!on;
  }

  addShadow(o, r) {
    const s = new THREE.Mesh(this.geo.shadow, this.mat.shadow);
    s.scale.setScalar(r);
    s.position.set(o.group.position.x, 0.03, o.group.position.z);
    this.scene.add(s);
    o.shadow = s;
  }

  // 障害物を 1 つ置く。lane = プレイヤーの進路上に置くもの (大きすぎないようにする)。
  // 当たり判定は o.parts (グループの原点から見た形の一覧) で持つ:
  //   { c: 'cyl', r, y0, y1 } 縦の円柱、{ c: 'sph', r, y } 球、{ c: 'box', hx, hz, y0, y1 } 箱。dx / dz で原点からずらす
  spawnOne(x, z, force, lane = false) {
    const g = new THREE.Group();
    const kind = force || this.pickKind();
    const roll = kind ? { column: 0, bush: 0.5, tree: 0.9 }[kind] ?? -1 : Math.random();
    const reach = this.reach || 20; // 今のプレイヤーが飛べる高さ (これより低い柱は飛び越えられる)
    // 横スクロールのプレイヤーの平面 (x = 0) では横によけられないので、上に 5 m 以上の隙間を残す
    const top = this.side && x === 0 ? reach - 5 : Infinity;
    const tallH = (lo, hi) => Math.min(Math.random() < 0.5 ? rand(0.45, 0.75) * reach : rand(lo, hi), this.ceiling.visible ? CEIL_Y - 0.6 : Infinity, top - 1);
    const size = lane ? 0.7 : 1; // 進路上のものは小さめに
    let o;
    if (kind === 'rock') {
      // 浮遊岩: 空中に浮かぶ大岩。ゆっくり回る。撃って壊せる
      const r = rand(2.6, 5.5) * size;
      const m = new THREE.Mesh(this.geo.rock, this.mat.rock);
      m.scale.set(r, r * rand(0.7, 1), r);
      m.rotation.set(rand(0, 3), rand(0, 3), 0);
      const cy = rand(r + 1, this.ceiling.visible ? CEIL_Y - r - 1 : 17);
      m.position.y = cy;
      g.add(m);
      o = { kind: 'rock', group: g, r, cy, breakable: true, spin: rand(-1, 1), mesh: m, baseY: cy, parts: [{ c: 'sph', r: r * 0.85, y: cy }] };
    } else if (kind === 'mushroom') {
      // 巨大キノコ: 色とりどりのかさ。撃って壊せる (当たるのは柄とかさだけ。かさの下はくぐれる)
      const h = rand(8, 18) * size, cr = h * rand(0.45, 0.6);
      const stem = new THREE.Mesh(this.geo.mushStem, this.mat.mushStem);
      stem.scale.set(h * 0.18, h, h * 0.18);
      stem.position.y = h / 2;
      const cap = new THREE.Mesh(this.geo.mushCap, this.mat.mushCap);
      cap.scale.set(cr, cr * 0.7, cr);
      cap.position.y = h * 0.92;
      g.add(stem, cap);
      for (let i = 0; i < 5; i++) {
        const dot = new THREE.Mesh(this.geo.mushDot, this.mat.mushDot);
        const a = (i / 5) * Math.PI * 2 + rand(0, 1);
        dot.position.set(Math.cos(a) * cr * 0.6, h * 0.92 + cr * 0.5, Math.sin(a) * cr * 0.6);
        dot.scale.setScalar(cr * 0.9);
        g.add(dot);
      }
      o = { kind: 'mushroom', group: g, r: cr * 0.8, h: h + cr * 0.6, breakable: true,
        parts: [{ c: 'cyl', r: h * 0.08, y0: 0, y1: h }, { c: 'cyl', r: cr * 0.9, y0: h * 0.92, y1: h * 0.92 + cr * 0.55 }] };
    } else if (kind === 'crystal') {
      // 水晶のクラスター: 傾いた六角柱が何本も地面から突き出す (高いものは飛び越えられない)
      const h = tallH(16, 34) * size, n = 3 + Math.floor(Math.random() * 3);
      const parts = [];
      for (let i = 0; i < n; i++) {
        const hh = h * (i === 0 ? 1 : rand(0.35, 0.7)), r = rand(0.9, 1.7) * (i === 0 ? 1.4 : 1);
        const a = (i / n) * Math.PI * 2, d = i === 0 ? 0 : rand(1.2, 2.6);
        const m = new THREE.Mesh(this.geo.crystal, this.mat.crystal);
        m.scale.set(r, hh, r);
        m.position.set(Math.cos(a) * d, hh / 2 - 0.3, Math.sin(a) * d);
        m.rotation.set(Math.sin(a) * 0.25 * (i ? 1 : 0.2), rand(0, 1), Math.cos(a) * 0.25 * (i ? 1 : 0.2));
        g.add(m);
        parts.push({ c: 'cyl', r: r * 0.95, y0: 0, y1: hh, dx: Math.cos(a) * d, dz: Math.sin(a) * d });
      }
      o = { kind: 'crystal', group: g, r: 3.4, h, parts };
    } else if (kind === 'arch') {
      // ガラスのアーチ: 左右の柱と上の梁。真ん中をくぐり抜ける (横に長いので、進路には置かない)
      const w = rand(9, 13), h = Math.min(rand(9, 14), reach - 1, this.ceiling.visible ? CEIL_Y - 3 : Infinity);
      const parts = [];
      for (const sx of [-1, 1]) {
        const m = new THREE.Mesh(this.geo.cap, this.mat.glass);
        m.scale.set(1.6, h, 1.6);
        m.position.set(sx * w, h / 2, 0);
        g.add(m);
        parts.push({ c: 'box', hx: 0.9, hz: 0.9, y0: 0, y1: h, dx: sx * w });
      }
      const beam = new THREE.Mesh(this.geo.cap, this.mat.glass);
      beam.scale.set(w * 2 + 1.6, 1.6, 1.6);
      beam.position.y = h + 0.8;
      g.add(beam);
      const gem = new THREE.Mesh(this.geo.bush, this.mat.crystal);
      gem.scale.setScalar(1.3);
      gem.position.y = h + 2.2;
      g.add(gem);
      parts.push({ c: 'box', hx: w + 0.8, hz: 0.9, y0: h, y1: h + 1.6 });
      o = { kind: 'arch', group: g, r: w + 1, h: h + 1.6, parts };
    } else if (kind === 'monolith') {
      // 黒曜石の石板: 横に広く薄い壁。回り込むか、上を飛び越える
      const w = rand(4, 8) * size, h = Math.min(rand(0.35, 0.7) * reach, this.ceiling.visible ? CEIL_Y - 4 : Infinity), d = 1.2;
      const m = new THREE.Mesh(this.geo.cap, this.mat.obsidian);
      m.scale.set(w * 2, h, d);
      m.position.y = h / 2;
      g.add(m);
      o = { kind: 'monolith', group: g, r: w, h, parts: [{ c: 'box', hx: w, hz: d / 2 + 0.3, y0: 0, y1: h }] };
    } else if (kind === 'spike') {
      // 地面のトゲ: 低い水晶のトゲの群れ。撃って壊せる
      const r = rand(2, 3.6);
      for (let i = 0; i < 5; i++) {
        const a = rand(0, Math.PI * 2), d = i ? rand(0.6, r * 0.8) : 0, hh = rand(1.6, 3.4);
        const m = new THREE.Mesh(this.geo.leaf, this.mat.crystal);
        m.scale.set(0.5, hh, 0.5);
        m.position.set(Math.cos(a) * d, hh / 2, Math.sin(a) * d);
        m.rotation.set(rand(-0.3, 0.3), 0, rand(-0.3, 0.3));
        g.add(m);
      }
      o = { kind: 'spike', group: g, r, h: 3, breakable: true, parts: [{ c: 'cyl', r: r * 0.85, y0: 0, y1: 2.6 }] };
    } else if (kind === 'ring') {
      // 浮遊リング: 空中に浮かぶ光の輪。真ん中をくぐるとボーナス (輪そのものに当たるとダメージ)
      const R = rand(4, 5.5), cy = rand(R + 1.5, Math.max(R + 2, Math.min(reach - 1, this.ceiling.visible ? CEIL_Y - R - 1 : 16)));
      const m = new THREE.Mesh(this.geo.ring, this.mat.ring);
      m.scale.setScalar(R);
      m.position.y = cy;
      g.add(m);
      const parts = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        parts.push({ c: 'sph', r: 0.7, y: cy + Math.sin(a) * R, dx: Math.cos(a) * R });
      }
      o = { kind: 'ring', group: g, r: R + 0.7, cy, R, h: cy + R, parts, mesh: m };
    } else if (roll < 0.4) {
      // 巨大な柱: 半分ほどは飛び越えられる高さ、残りは横によけるしかない高さ
      const r = rand(1.8, 3.4) * (lane ? 0.75 : 1);
      const h = tallH(24, 40);
      const col = new THREE.Mesh(this.geo.column, this.mat.column);
      col.scale.set(r, h, r);
      col.position.y = h / 2;
      const cap = new THREE.Mesh(this.geo.cap, this.mat.cap);
      cap.scale.set(r * 2.2, 0.9, r * 2.2);
      cap.position.y = h + 0.45;
      g.add(col, cap);
      o = { kind: 'column', group: g, r, h: h + 0.9, parts: [{ c: 'cyl', r, y0: 0, y1: h }, { c: 'box', hx: r * 1.1, hz: r * 1.1, y0: h, y1: h + 0.9 }] };
    } else if (roll < 0.75) {
      const r = rand(1.4, 3.2) * size;
      const b = new THREE.Mesh(this.geo.bush, this.mat.bush);
      b.scale.set(r, r * 0.8, r);
      b.rotation.y = rand(0, Math.PI);
      b.position.y = r * 0.6;
      g.add(b);
      o = { kind: 'bush', group: g, r, cy: r * 0.6, breakable: true, parts: [{ c: 'sph', r: r * 0.85, y: r * 0.6 }] };
    } else {
      const h = Math.min(rand(9, 22) * size, top);
      const trunk = new THREE.Mesh(this.geo.trunk, this.mat.trunk);
      trunk.scale.set(h / 7, h * 0.45, h / 7);
      trunk.position.y = h * 0.225;
      const leaf = new THREE.Mesh(this.geo.leaf, this.mat.leaf);
      leaf.scale.set(h * 0.28, h * 0.65, h * 0.28);
      leaf.position.y = h * 0.45 + h * 0.3;
      g.add(trunk, leaf);
      // 葉は円すいなので、上へ行くほど細い 3 段の円柱で近似する (細い先の近くでは当たらない)
      const L = h * 0.65, base = h * 0.45 - L * 0.05, R = h * 0.28;
      o = { kind: 'tree', group: g, r: h * 0.18, h,
        parts: [{ c: 'cyl', r: h / 7 * 0.35, y0: 0, y1: base }, { c: 'cyl', r: R * 0.8, y0: base, y1: base + L * 0.33 },
          { c: 'cyl', r: R * 0.5, y0: base + L * 0.33, y1: base + L * 0.66 }, { c: 'cyl', r: R * 0.2, y0: base + L * 0.66, y1: base + L * 0.9 }] };
    }
    g.position.set(x, 0, z);
    o.prevZ = z;
    this.scene.add(g);
    this.addShadow(o, o.kind === 'arch' || o.kind === 'monolith' ? Math.min(o.r, 6) : Math.min(o.r * 1.3, 6));
    if (o.kind === 'ring') o.shadow.visible = false;
    this.obstacles.push(o);
    return o;
  }

  // 点 q (グループから見た座標) が部品 pt に、半径 r の球として触れているか
  static touches(pt, qx, qy, qz, r) {
    const x = qx - (pt.dx || 0), z = qz - (pt.dz || 0);
    if (pt.c === 'sph') return x * x + (qy - pt.y) ** 2 + z * z < (pt.r + r) ** 2;
    const dy = qy < pt.y0 ? pt.y0 - qy : qy > pt.y1 ? qy - pt.y1 : 0;
    if (pt.c === 'cyl') {
      const h = Math.max(0, Math.hypot(x, z) - pt.r);
      return h * h + dy * dy < r * r;
    }
    const ex = Math.max(0, Math.abs(x) - pt.hx), ez = Math.max(0, Math.abs(z) - pt.hz);
    return ex * ex + dy * dy + ez * ez < r * r;
  }

  // 点 p (半径 r) が障害物に当たったら、その障害物を返す (同じ障害物には 1 回だけ)。
  // 高速時に1フレームですり抜けないよう、前フレームから z をまたいだかで判定する
  hitTest(p, r, once = true) {
    for (const o of this.obstacles) {
      if (o.dead || o.knocked || (once && o.hurt)) continue;
      const z0 = o.prevZ, z1 = o.group.position.z;
      if (Math.min(z0, z1) - o.r - r - 3 > p.z || Math.max(z0, z1) + o.r + r + 3 < p.z) continue;
      const qx = p.x - o.group.position.x;
      for (const pt of o.parts) {
        // 部品ごとに z をまたいだかを見る (またいだら z の差は 0 とみなす)
        const a = z0 + (pt.dz || 0) - p.z, b = z1 + (pt.dz || 0) - p.z;
        const qz = a * b <= 0 ? (pt.dz || 0) : b + (pt.dz || 0);
        if (World.touches(pt, qx, p.y, qz, r)) {
          if (once) o.hurt = true;
          return o;
        }
      }
    }
    return null;
  }

  // 弾 (prev → pos の線分) が当たった障害物と、当たった点を返す
  shotTest(prev, pos, out) {
    for (const o of this.obstacles) {
      if (o.dead || o.knocked) continue;
      const op = o.group.position;
      if (Math.abs(pos.z - op.z) > o.r + 8 && Math.abs(prev.z - op.z) > o.r + 8) continue;
      for (let k = 0; k <= 4; k++) {
        out.lerpVectors(prev, pos, k / 4);
        for (const pt of o.parts) if (World.touches(pt, out.x - op.x, out.y, out.z - op.z, 0.3)) return o;
      }
    }
    return null;
  }

  // 浮遊リングの真ん中をくぐったら、そのリングを返す (1 つにつき 1 回)
  ringPass(p) {
    for (const o of this.obstacles) {
      if (o.kind !== 'ring' || o.passed || o.hurt) continue;
      const z0 = o.prevZ, z1 = o.group.position.z;
      if ((z0 - p.z) * (z1 - p.z) > 0) continue;
      if (Math.hypot(p.x - o.group.position.x, p.y - o.cy) < o.R - 0.6) {
        o.passed = true;
        return o;
      }
    }
    return null;
  }

  update(dt, speed, camPos, spawn) {
    if (this.fade) {
      const f = this.fade;
      f.t = Math.min(f.time, f.t + dt);
      const k = f.t / f.time;
      f.cols().forEach((c, n) => c.lerpColors(f.from[n], f.to[n], k));
      if (k >= 1) this.fade = null;
    }
    const d = speed * dt;
    this.offset = (this.offset + d) % (CHECKER * 2);
    this.groundUni.uOff.value = this.offset;
    if (this.ceiling.visible) this.ceiling.position.x = camPos.x;
    this.sky.position.set(camPos.x, 0, camPos.z);
    this.mountains.position.x = camPos.x * 0.9; // ほぼ無限遠に見せる

    if (spawn) {
      this.spawnAcc += d;
      const bonus = this.mode === 'bonus';
      const spawnZ = this.side ? -70 : SPAWN_Z; // 横スクロールは画面の右端のすぐ外に出す
      const spacing = bonus ? 5 : SPAWN_SPACING;
      while (this.spawnAcc > spacing) {
        this.spawnAcc -= spacing;
        const z = spawnZ + this.spawnAcc;
        if (this.side) {
          // 横スクロール: カメラは +X 側から見るので、手前 (x > 0) には置かない
          if (Math.random() < (bonus ? 0.7 : 0.3)) this.spawnOne(0, z, bonus ? 'tree' : undefined);
          this.spawnOne(-rand(12, 70), z - rand(0, 5), bonus ? 'tree' : undefined);
          continue;
        }
        if (bonus) {
          // ボーナスステージ: 木だけを、プレイヤーの進路のまわりに密に並べる
          this.spawnOne(camPos.x + rand(-16, 16), z, 'tree');
          if (Math.random() < 0.6) this.spawnOne(camPos.x + rand(-5, 5), z - rand(0, 3), 'tree');
          continue;
        }
        this.spawnOne(camPos.x + rand(-38, 38), z); // プレイヤーのまわりに出す (端へ行っても障害物がある)
        // ときどきプレイヤーの進路上にも置いて、避ける必要を作る
        // 進路上のものは、前のものから 28 m 以上あける。横に長いアーチは置かない
        this.laneGap = (this.laneGap || 0) + spacing;
        if (this.laneGap >= 28 && Math.random() < (this.obstacleTable?.lane ?? 0.25) * 0.7) {
          this.laneGap = 0;
          let k = this.pickKind();
          if (k === 'arch') k = 'column';
          this.spawnOne(camPos.x + rand(-4, 4), z - rand(0, 5), k, true);
        }
      }
    }

    for (const o of this.obstacles) {
      o.prevZ = o.group.position.z;
      o.group.position.z += d;
      if (o.kind === 'rock') {
        o.mesh.rotation.y += o.spin * dt;
        o.mesh.position.y = o.baseY + Math.sin(o.prevZ * 0.05) * 0.6;
        o.parts[0].y = o.mesh.position.y;
      } else if (o.kind === 'ring') {
        o.mesh.rotation.z += dt * 0.8; // 光の輪がゆっくり回る
      }
      if (o.knocked) {
        // なぎ倒された木: 前へ倒れながら跳ね上がる
        o.fallT += dt;
        const k = Math.min(1, o.fallT * 2.5);
        o.group.rotation.x = -k * 1.45;
        o.group.rotation.z = o.fallSide * k * 0.5;
        o.group.position.y = Math.sin(Math.min(1, o.fallT * 1.6) * Math.PI) * 3;
      }
      o.shadow.position.z = o.group.position.z;
      if (o.group.position.z > REMOVE_Z) o.dead = true;
    }
    if (this.obstacles.some((o) => o.dead)) {
      this.obstacles = this.obstacles.filter((o) => {
        if (o.dead) this.removeObstacle(o);
        return !o.dead;
      });
    }
  }

  removeObstacle(o) {
    this.scene.remove(o.group);
    this.scene.remove(o.shadow);
  }

  knockDown(o) {
    o.knocked = true;
    o.fallT = 0;
    o.fallSide = Math.random() < 0.5 ? -1 : 1;
  }

  clear() {
    this.obstacles.forEach((o) => this.removeObstacle(o));
    this.obstacles = [];
    this.spawnAcc = 0;
  }
}
