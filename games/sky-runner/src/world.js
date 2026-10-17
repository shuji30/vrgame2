// 地面・空・遠景・障害物
import * as THREE from 'three';

export const FOG_NEAR = 70;
export const FOG_FAR = 210;
const SPAWN_Z = -210;
const SPAWN_SPACING = 11;   // 何 m 進むごとに障害物を出すか (速度に関係なく密度が一定になる)
const REMOVE_Z = 40;        // 後ろを振り返っても急に消えて見えないよう、少し後ろまで残す
const CHECKER = 8;          // 市松模様の1マス (m)

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
    };
    this.mat = {
      column: new THREE.MeshStandardMaterial({ roughness: 0.5 }),
      cap: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
      bush: new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.9 }),
      leaf: new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.8 }),
      shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
    };

    this.obstacles = [];
    this.spawnAcc = 0;
    this.offset = 0;
    this.applyTheme(0);
  }

  applyTheme(i) {
    const th = THEMES[i % THEMES.length];
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
  }

  addShadow(o, r) {
    const s = new THREE.Mesh(this.geo.shadow, this.mat.shadow);
    s.scale.setScalar(r);
    s.position.set(o.group.position.x, 0.03, o.group.position.z);
    this.scene.add(s);
    o.shadow = s;
  }

  spawnOne(x, z) {
    const g = new THREE.Group();
    const roll = Math.random();
    let o;
    if (roll < 0.4) {
      const r = rand(0.9, 1.5), h = rand(5, 16);
      const col = new THREE.Mesh(this.geo.column, this.mat.column);
      col.scale.set(r, h, r);
      col.position.y = h / 2;
      const cap = new THREE.Mesh(this.geo.cap, this.mat.cap);
      cap.scale.set(r * 2.6, 0.6, r * 2.6);
      cap.position.y = h + 0.3;
      g.add(col, cap);
      o = { kind: 'column', group: g, r, h: h + 0.6 };
    } else if (roll < 0.75) {
      const r = rand(0.8, 2.0);
      const b = new THREE.Mesh(this.geo.bush, this.mat.bush);
      b.scale.set(r, r * 0.8, r);
      b.rotation.y = rand(0, Math.PI);
      b.position.y = r * 0.6;
      g.add(b);
      o = { kind: 'bush', group: g, r, cy: r * 0.6 };
    } else {
      const h = rand(4, 9);
      const trunk = new THREE.Mesh(this.geo.trunk, this.mat.trunk);
      trunk.scale.set(1, h * 0.45, 1);
      trunk.position.y = h * 0.225;
      const leaf = new THREE.Mesh(this.geo.leaf, this.mat.leaf);
      leaf.scale.set(h * 0.28, h * 0.65, h * 0.28);
      leaf.position.y = h * 0.45 + h * 0.3;
      g.add(trunk, leaf);
      o = { kind: 'tree', group: g, r: h * 0.18, h };
    }
    g.position.set(x, 0, z);
    o.prevZ = z;
    this.scene.add(g);
    this.addShadow(o, o.r * 1.3);
    this.obstacles.push(o);
  }

  update(dt, speed, camPos, spawn) {
    const d = speed * dt;
    this.offset = (this.offset + d) % (CHECKER * 2);
    this.groundUni.uOff.value = this.offset;
    this.sky.position.set(camPos.x, 0, camPos.z);
    this.mountains.position.x = camPos.x * 0.9; // ほぼ無限遠に見せる

    if (spawn) {
      this.spawnAcc += d;
      while (this.spawnAcc > SPAWN_SPACING) {
        this.spawnAcc -= SPAWN_SPACING;
        const z = SPAWN_Z + this.spawnAcc;
        this.spawnOne(rand(-34, 34), z);
        // ときどきプレイヤーの進路上にも置いて、避ける必要を作る
        if (Math.random() < 0.25) this.spawnOne(camPos.x + rand(-4, 4), z - rand(0, 5));
      }
    }

    for (const o of this.obstacles) {
      o.prevZ = o.group.position.z;
      o.group.position.z += d;
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

  // 点 p (半径 r) が障害物に当たったら、その障害物を返す。
  // 高速時に1フレームですり抜けないよう、前フレームから z をまたいだかで判定する
  hitTest(p, r) {
    for (const o of this.obstacles) {
      if (o.dead) continue;
      const z0 = o.prevZ, z1 = o.group.position.z;
      const crossed = (z0 - p.z) * (z1 - p.z) <= 0;
      const dz = crossed ? 0 : z1 - p.z;
      if (Math.abs(dz) > o.r + r) continue;
      const dx = p.x - o.group.position.x;
      if (o.kind === 'bush') {
        const dy = p.y - o.cy;
        if (dx * dx + dy * dy + dz * dz < (o.r + r) ** 2) return o;
      } else if (p.y < o.h + r && dx * dx + dz * dz < (o.r + r) ** 2) {
        return o;
      }
    }
    return null;
  }

  clear() {
    this.obstacles.forEach((o) => this.removeObstacle(o));
    this.obstacles = [];
    this.spawnAcc = 0;
  }
}
