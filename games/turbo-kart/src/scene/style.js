// 見た目の共通設定: アニメ調（セルシェーディング）の材質と、明るい空
import * as THREE from 'three';

let gradient = null;
function gradientMap() {
  if (gradient) return gradient;
  // 3 段階の陰影
  const data = new Uint8Array([90, 170, 255]);
  gradient = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

// MeshLambertMaterial と同じ引数で使えるトゥーン材質
export function toon(params = {}) {
  return new THREE.MeshToonMaterial({ ...params, gradientMap: gradientMap() });
}

// 上は濃い青、地平線は明るい水色のグラデーションの空
// colors: { top, horizon, bottom }（省略時はパーティーの明るい空）
export function skyDome(radius = 1200, colors = {}) {
  const geo = new THREE.SphereGeometry(radius, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(colors.top ?? 0x4aa3ff) },
      horizon: { value: new THREE.Color(colors.horizon ?? 0xd2f1ff) },
      bottom: { value: new THREE.Color(colors.bottom ?? 0x9fd9ff) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, bottom, min(1.0, -h * 4.0));
      gl_FragColor = vec4(c, 1.0); }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -10;
  return m;
}

// もこもこの雲（白い球をいくつか寄せ集めたもの）
// material を渡すと写実モード用の雲になる（平たく、少し透ける）
export function clouds(rng, center, count = 26, material = null) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 12, 10);
  // 地面の照り返しで緑がからないよう、自ら少し光らせる
  const mat = material || toon({ color: 0xffffff, emissive: 0xc8d4e0, fog: false });
  const flat = material ? 0.45 : 1;
  for (let i = 0; i < count; i++) {
    const cloud = new THREE.Group();
    const n = 4 + Math.floor(rng() * 4);
    for (let k = 0; k < n; k++) {
      const s = new THREE.Mesh(geo, mat);
      const r = 10 + rng() * 10;
      s.scale.set(r * 1.4, r * 0.8 * flat, r);
      s.position.set((k - n / 2) * 13 + rng() * 6, rng() * 6, rng() * 10);
      cloud.add(s);
    }
    const a = rng() * Math.PI * 2, d = 320 + rng() * 380;
    cloud.position.set(center.x + Math.cos(a) * d, (material ? 170 : 90) + rng() * 90, center.z + Math.sin(a) * d);
    cloud.rotation.y = rng() * Math.PI;
    g.add(cloud);
  }
  return g;
}
