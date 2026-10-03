// 見た目のテーマ: 'party'（コミカルなトゥーン）と 'real'（写実的な PBR）
// 物理・操作感はテーマに関係なく同じ。見た目だけを切り替える
import * as THREE from 'three';
import { toon } from './style.js';

export const THEMES = ['party', 'real'];

// テーマに合わせた材質。real は MeshStandardMaterial（paint だけクリアコート付きの Physical）
//   kind: 'paint' | 'metal' | 'rubber' | 'glass' | 'plastic' | 'carbon' | 'cloth'（省略時 plastic）
export function mat(theme, params = {}, kind = 'plastic') {
  if (theme !== 'real') return toon(params);
  const p = { ...params };
  switch (kind) {
    case 'paint':
      return new THREE.MeshPhysicalMaterial({ roughness: 0.32, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, ...p });
    case 'metal':
      return new THREE.MeshStandardMaterial({ roughness: 0.28, metalness: 0.95, ...p });
    case 'rubber':
      return new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, ...p });
    case 'glass':
      return new THREE.MeshPhysicalMaterial({ roughness: 0.05, metalness: 0.1, clearcoat: 1, ...p });
    case 'carbon':
      return new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.4, ...p });
    case 'cloth':
      return new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...p });
    default:
      return new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05, ...p });
  }
}

// 輪郭線（裏返した少し大きいメッシュ）。トゥーンの縁取りに使う
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x1a1020, side: THREE.BackSide });
export function addOutline(mesh, width = 0.04) {
  const o = new THREE.Mesh(mesh.geometry, outlineMat);
  // ジオメトリの大きさに対して一定の太さになるよう拡大率を決める
  mesh.geometry.computeBoundingSphere();
  const r = mesh.geometry.boundingSphere?.radius || 1;
  o.scale.setScalar(1 + width / r);
  o.position.copy(mesh.geometry.boundingSphere.center).multiplyScalar(-(width / r));
  o.renderOrder = -1;
  mesh.add(o);
  return o;
}

// レンダラーとシーンの設定（トーンマッピング・環境マップ・影）
let envCache = null;
export function applyRendererTheme(renderer, scene, theme) {
  if (theme === 'real') {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene.environment = envCache ||= outdoorEnvironment(renderer);
  } else {
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = false;
    scene.environment = null;
  }
}

// 屋外の映り込み用の環境マップ（空のグラデーション + 地面 + 太陽）
function outdoorEnvironment(renderer) {
  const s = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP;
      void main(){
        float h = vP.y;
        vec3 sky = mix(vec3(0.85,0.9,0.95), vec3(0.25,0.45,0.8), pow(max(h,0.0), 0.5));
        vec3 ground = mix(vec3(0.32,0.34,0.3), vec3(0.18,0.22,0.15), min(1.0, -h * 3.0));
        vec3 c = h > 0.0 ? sky : ground;
        vec3 sun = normalize(vec3(0.5, 0.75, 0.3));
        c += vec3(6.0, 5.6, 5.0) * pow(max(dot(vP, sun), 0.0), 400.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  s.add(new THREE.Mesh(geo, m));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.02);
  pm.dispose();
  geo.dispose();
  m.dispose();
  return rt.texture;
}
