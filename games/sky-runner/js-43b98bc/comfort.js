// VR の酔い対策: 速く飛んでいるときや大きく動いているときに、視野の周りをなめらかに暗くする (ビネット)。
// 被弾したときも、視界全体ではなく周りを赤く縁取る。
// カメラを包む球に描くので、Pimax のような広い視野の機種でも周辺まで覆える
import * as THREE from 'three';

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position; // カメラから見た向き (カメラの子なので、-Z が正面)
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
uniform float uStrength; // 0..1: 暗くする強さ (強いほど、はっきり見える範囲が狭くなる)
uniform float uDamage;   // 0..1: 被弾の赤い縁取り
varying vec3 vDir;
void main() {
  float a = acos(clamp(dot(normalize(vDir), vec3(0.0, 0.0, -1.0)), -1.0, 1.0)); // 正面からの角度 (rad)
  float inner = mix(1.25, 0.5, uStrength);
  float v = smoothstep(inner, inner + 0.5, a) * uStrength;
  float d = smoothstep(0.45, 1.25, a) * uDamage;
  float alpha = clamp(v + d, 0.0, 0.95);
  vec3 col = mix(vec3(0.0), vec3(0.85, 0.05, 0.05), d / max(v + d, 1e-3));
  gl_FragColor = vec4(col, alpha);
}`;

export const VIGNETTE_LEVELS = { off: 0, weak: 0.55, strong: 0.9 };

export class Vignette {
  constructor(camera) {
    this.uniforms = { uStrength: { value: 0 }, uDamage: { value: 0 } };
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
        side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false,
      }),
    );
    this.mesh.renderOrder = 1001;
    this.mesh.frustumCulled = false;
    camera.add(this.mesh);
    this.strength = 0;
    this.damage = 0;
  }

  hit(amount) { this.damage = Math.min(1, Math.max(this.damage, amount)); }

  // target: 0..1。急に変わると逆に気になるので、なめらかに追う
  update(dt, target) {
    this.strength += (target - this.strength) * Math.min(1, dt * (target > this.strength ? 4 : 1.5));
    this.damage = Math.max(0, this.damage - dt * 1.4);
    this.uniforms.uStrength.value = this.strength;
    this.uniforms.uDamage.value = this.damage;
    this.mesh.visible = this.strength > 0.01 || this.damage > 0.01;
  }
}
