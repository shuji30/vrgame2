// プレイヤーの女の子 (「ふたりの休日」の女の子)。モデルは assets/girl.vrm (VRM 1.0)
// VRM にはモーションが入っていないので、飛ぶ姿勢・走る姿勢は正規化ボーンに角度を入れて作る。
// 正規化ボーンは T ポーズで向きがそろっている (前 = +Z、上 = +Y)。
//   x を + に回すと: 背骨は前へ倒れ、腿は後ろへ、すねは膝を曲げる向き
// 飛ぶときはスニーカーの底から火を噴く (人間のモデルの炎を借りる)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// 飛ぶ姿勢: 右手を前へ伸ばし (手から火の玉を撃つ)、左手は下ろして、脚は膝を曲げて後ろへ流す。
// 脚をそろえておく (後ろから追う三人称のカメラで、スカートの中が見えないように)
const FLY = {
  spine: [0.12, 0, 0],
  head: [-0.18, 0, 0],
  rightUpperArm: [-0.1, 1.45, 0],
  rightLowerArm: [0, 0.1, 0],
  leftUpperArm: [0.15, 0, -1.25],
  leftLowerArm: [0, -0.35, 0],
  leftUpperLeg: [0.28, 0, 0.02],
  rightUpperLeg: [0.18, 0, -0.02],
  leftLowerLeg: [0.95, 0, 0],
  rightLowerLeg: [0.6, 0, 0],
  leftFoot: [0.45, 0, 0],
  rightFoot: [0.35, 0, 0],
};
// 走る姿勢 (sw: 脚を振る位相の sin)。右手は撃つので前へ伸ばしたまま
function runPose(sw) {
  return {
    spine: [0.18, 0, 0],
    head: [-0.12, 0, 0],
    rightUpperArm: FLY.rightUpperArm,
    rightLowerArm: FLY.rightLowerArm,
    leftUpperArm: [-sw * 0.6, 0, -1.2],
    leftLowerArm: [0, -0.5, 0],
    leftUpperLeg: [-sw * 0.75, 0, 0.02],
    rightUpperLeg: [sw * 0.75, 0, -0.02],
    leftLowerLeg: [0.25 + Math.max(0, -sw) * 1.1, 0, 0],
    rightLowerLeg: [0.25 + Math.max(0, sw) * 1.1, 0, 0],
    leftFoot: [0, 0, 0],
    rightFoot: [0, 0, 0],
  };
}
// モデルは身長 1.4 m と小柄なので、人間 (ハリアー。飛ぶ姿勢で高さ約 2 m) と同じくらいの大きさにする
const SCALE = 1.5;
const ANKLE = 0.07 * SCALE; // 足首のボーンから靴の底までの高さ (m)

// flameSrc: 炎のメッシュ (人間のモデルの HFlameL)。無ければ炎を出さない
export async function loadGirl(url, flameSrc) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('VRM ではありません: ' + url);
  VRMUtils.rotateVRM0(vrm);
  VRMUtils.removeUnnecessaryVertices(vrm.scene);
  VRMUtils.combineSkeletons(vrm.scene);
  vrm.scene.traverse((o) => { if (o.isMesh) o.frustumCulled = false; }); // スキンのメッシュは囲みの箱が当てにならない

  const h = vrm.humanoid;
  const bones = {};
  for (const name of [...Object.keys(FLY), 'hips', 'leftEye', 'rightEye', 'rightHand']) bones[name] = h.getNormalizedBoneNode(name);

  // 原点 = 腰。VRM は +Z を向いているので、ゲームの前 (-Z) へ向ける
  const obj = new THREE.Group();
  obj.name = 'Girl';
  const body = new THREE.Group();
  body.rotation.y = Math.PI;
  body.scale.setScalar(SCALE);
  body.position.y = -(bones.hips?.position.y ?? 0.7) * SCALE;
  body.add(vrm.scene);
  obj.add(body);

  // 右手の先から撃つ (T ポーズで右腕は -X へ伸びている)
  const muzzle = new THREE.Object3D();
  muzzle.name = 'HMuzzle';
  muzzle.position.set(-0.14, 0, 0);
  bones.rightHand?.add(muzzle);

  // スニーカーの底から火を噴く
  const flames = [];
  if (flameSrc) {
    for (const side of ['left', 'right']) {
      const foot = bones[`${side}Foot`];
      if (!foot) continue;
      const f = flameSrc.clone();
      f.name = 'HFlame';
      f.rotation.set(Math.PI, 0, 0); // 炎の長さの向き (+Y) を足の裏の向き (-Y) へ
      f.scale.multiplyScalar(0.55);
      f.position.set(0, -0.17, -0.02);
      f.renderOrder = 10;
      foot.add(f);
      flames.push({ mesh: f, base: f.scale.clone() });
    }
  }

  const set = (run, sw) => {
    const r = runPose(sw);
    for (const [name, a] of Object.entries(FLY)) {
      const b = bones[name];
      if (!b) continue;
      const q = r[name];
      b.rotation.set(a[0] + (q[0] - a[0]) * run, a[1] + (q[1] - a[1]) * run, a[2] + (q[2] - a[2]) * run);
    }
  };

  const ex = vrm.expressionManager;
  const face = (name, w) => { if (ex?.getExpression(name)) ex.setValue(name, w); };

  const legs = {
    // run: 0 = 飛ぶ … 1 = 走る
    pose(run, sw) { set(run, sw); },
    // 低いほうの靴の底の高さ (ワールド座標)
    footY() {
      let y = Infinity;
      for (const n of ['leftFoot', 'rightFoot']) if (bones[n]) y = Math.min(y, bones[n].getWorldPosition(_p).y - ANKLE);
      return y;
    },
  };

  // 目の位置 (原点から見た座標)。飛ぶ姿勢にしてから測る
  set(0, 0);
  vrm.update(0);
  obj.updateMatrixWorld(true);
  const eye = new THREE.Vector3();
  if (bones.leftEye && bones.rightEye) {
    eye.copy(bones.leftEye.getWorldPosition(_p)).add(bones.rightEye.getWorldPosition(_q)).multiplyScalar(0.5);
  } else bones.head?.getWorldPosition(eye);

  let mouthT = 0;
  return {
    obj, eye, flames, muzzles: [muzzle], legs, vrm,
    // 毎フレーム: 表情 (やられたら驚く)、話している間は口 (あ・お を交互に)、揺れもの (髪・スカート)
    tick(dt, fallen, talking) {
      mouthT += dt;
      const open = talking ? 0.25 + 0.45 * Math.abs(Math.sin(mouthT * 11)) : 0;
      face('happy', fallen ? 0 : 0.35);
      face('surprised', fallen ? 1 : 0);
      face('aa', fallen ? 0 : open * (Math.sin(mouthT * 4.3) > 0 ? 1 : 0.4));
      face('oh', fallen ? 0 : open * (Math.sin(mouthT * 4.3) > 0 ? 0 : 0.6));
      vrm.update(dt);
    },
    credit: vrm.meta ? `${vrm.meta.name || ''} (作: ${(vrm.meta.authors || []).join(', ')})` : '',
  };
}

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
