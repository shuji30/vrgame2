// プレイヤーの見た目 (宇宙船 / 人間) と視点 (一人称 / 三人称)
// モデルは Blender で作った assets/ship.glb と assets/harrier.glb (blender の元データは assets/models.blend)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CockpitPanel, makeSeatAndPedals } from './cockpit.js';

// 三人称で、目の高さから見てモデルをどこに置くか (rig の中の座標)
const THIRD_OFFSET = {
  ship: new THREE.Vector3(0, -1.6, -9),
  human: new THREE.Vector3(0, -1.1, -5),
};
// 当たり判定の半径 (m)。宇宙船と人間で難しさが変わらないよう、同じにする (宇宙船は翼が大きいが、遊びやすさを優先して小さめ)
const RADIUS = { ship: 0.6, human: 0.6 };

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const LEG_DOWN = 0.84; // 飛ぶ姿勢で後ろへ流れている脚を、真下へ向ける角度
const _box = new THREE.Box3();

// 人間のモデルの脚と左腕を、股関節・肩を支点にした組にまとめる (地面を走るときに振る)。
// モデルの部品はばらばらなので、支点の Group に付け替える
function makeLimbs(obj) {
  const thigh = obj.getObjectByName('ThighL');
  if (!thigh) return null;
  const parent = thigh.parent;
  const limb = (x, y, z, names) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    parent.add(pivot);
    for (const n of names) {
      const o = obj.getObjectByName(n);
      if (o) pivot.attach(o);
    }
    return pivot;
  };
  return {
    L: limb(-0.115, -0.3, 0.02, ['ThighL', 'KneeL', 'ShinL', 'BootL']),
    R: limb(0.115, -0.3, 0.02, ['ThighR', 'KneeR', 'ShinR', 'BootR']),
    arm: limb(-0.28, 0.46, 0, ['UpperArmL', 'ForeArmL', 'HandL']), // 右腕はキャノンを構えているので振らない
    feet: ['BootL', 'BootR'].map((n) => obj.getObjectByName(n)).filter(Boolean),
  };
}

export class Avatar {
  constructor(scene, rig, camera) {
    this.rig = rig;
    this.camera = camera;
    this.models = {};          // kind -> { obj, eye, flames: [{mesh, base}], muzzles }
    this.anchor = new THREE.Vector3(0, 1.6, 0); // 一人称で目を合わせる頭の位置 (rig の中)
    this.recenterPending = true;
    this.destroyed = false;  // ゲームオーバーで爆発したら消す
    this.hidden = false;     // エンディングの間は隠す (影も)
    this.riding = false;     // ボーナスステージで水晶のそりに乗っている (一人称では機体を隠す)
    this.stumbleT = 0;       // 茂みにつまずいてよろけている残り時間
    this.fallT = -1;         // やられて地面に落ちている時間 (-1 = 落ちていない)
    this.fallHold = false;   // true なら落ちたまま (ゲームオーバー)
    this.hitPoint = new THREE.Vector3();
    this.radius = RADIUS.ship;
    this.t = 0;

    this.mount = new THREE.Group();
    rig.add(this.mount);

    // 真下の地面に落とす影 (高さが分かるように)
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    scene.add(this.shadow);
  }

  async load(base) {
    const loader = new GLTFLoader();
    const files = { ship: 'ship.glb', human: 'harrier.glb' };
    await Promise.all(Object.entries(files).map(async ([kind, file]) => {
      const gltf = await loader.loadAsync(base + file);
      const obj = gltf.scene;
      obj.children.forEach((c) => c.position.set(0, 0, 0)); // Blender の上で並べた位置は使わない (原点 = 機体の中心)
      obj.visible = false;
      this.mount.add(obj);
      obj.updateMatrixWorld(true);
      // 目の位置を、モデルの原点から見た座標で覚えておく
      const inv = _m.copy(obj.matrixWorld).invert();
      const eyeNode = obj.getObjectByName(kind === 'ship' ? 'PilotEye' : 'HEye');
      const eye = eyeNode ? eyeNode.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv) : new THREE.Vector3();
      const flames = [];
      obj.traverse((o) => {
        if (o.isMesh && /^H?Flame/.test(o.name)) flames.push({ mesh: o, base: o.scale.clone() });
        if (o.isMesh && o.material?.transparent) o.renderOrder = 10; // キャノピーのガラスは最後に描く
      });
      const muzzles = [];
      obj.traverse((o) => { if (/Muzzle/.test(o.name) && !o.isMesh) muzzles.push(o); });
      this.models[kind] = { obj, eye, flames, muzzles };
      if (kind === 'human') this.models[kind].legs = makeLimbs(obj);
      if (kind === 'ship') {
        // コックピットの計器 (ボタンいっぱい) とシート・ペダル。前の黒い台と小さな画面 3 つ、元の背もたれは消す
        const panel = new CockpitPanel();
        (obj.getObjectByName('Ship') || obj).add(panel.mesh, makeSeatAndPedals());
        for (const n of ['Dashboard', 'ScreenL', 'ScreenC', 'ScreenR', 'Seat']) { const o = obj.getObjectByName(n); if (o) o.visible = false; }
        Object.assign(this.models[kind], { panel, arch: obj.getObjectByName('CanopyArch') });
      }
    }));
  }

  get ready() { return Object.keys(this.models).length > 0; }

  // 銃口のワールド座標 (宇宙船は左右の機関砲、人間は腕のキャノン)
  muzzles(kind) {
    const m = this.models[kind];
    if (!m) return [];
    m.obj.updateMatrixWorld(true);
    m.muzzleWorld ||= m.muzzles.map(() => new THREE.Vector3());
    m.muzzles.forEach((o, i) => o.getWorldPosition(m.muzzleWorld[i]));
    return m.muzzleWorld;
  }

  // モデルの中心 (ミサイルを落とす位置)
  center(kind, out) {
    const m = this.models[kind];
    return m ? m.obj.getWorldPosition(out) : this.camera.getWorldPosition(out);
  }

  recenter() { this.recenterPending = true; }

  stumble() { this.stumbleT = 0.7; }

  // hold: 落ちたまま起き上がらない (ゲームオーバー)
  fall(hold = false) {
    this.fallT = 0;
    this.fallHold = hold;
  }

  // kind: 'ship' | 'human'、view: '1st' | '3rd'
  // sidePos: 横スクロールのときのプレイヤーの位置 (ワールド座標)
  update(dt, { kind, view, vx, vy, thrust, presenting, sidePos }) {
    this.t += dt;
    this.radius = RADIUS[kind];

    // 一人称で目を合わせる頭の位置。VR では開始時と「合わせ直し」のときだけ測り、
    // その後は頭を動かすとコックピットの中で見回せるようにする
    if (!presenting) this.anchor.copy(this.camera.position);
    else if (this.recenterPending) {
      this.anchor.copy(this.camera.position);
      this.recenterPending = false;
    }

    for (const [k, m] of Object.entries(this.models)) {
      const show = k === kind && !(view === '1st' && (kind === 'human' || this.riding)) && !this.destroyed && !this.hidden;
      m.obj.rotation.order = view === 'side' ? 'YXZ' : 'XYZ';
      m.obj.visible = show;
      if (m.arch) m.arch.visible = view !== '1st'; // 前のキャノピーの枠は、コックピットから見ると視界をふさぐので消す
      if (k !== kind) continue;

      if (view === 'side') {
        // リグは横を向いているので、ワールド座標をリグの中の座標に直して置き、向きは前 (-Z) に戻す
        m.obj.position.copy(this.rig.worldToLocal(_v.copy(sidePos)));
        const pitch = THREE.MathUtils.clamp(vy * 0.03, -0.4, 0.4);
        m.pitch = (m.pitch || 0) + (pitch - (m.pitch || 0)) * Math.min(1, dt * 6);
        m.obj.rotation.set(m.pitch, -this.rig.rotation.y, 0);
      } else if (view === '1st') {
        m.obj.position.copy(this.anchor).sub(m.eye);
        m.obj.rotation.set(0, 0, 0); // コックピットは傾けない (VR 酔い防止)
        m.panel?.update(dt);
      } else {
        m.obj.position.copy(this.anchor).add(THIRD_OFFSET[kind]);
        // 三人称ではモデルだけを傾ける。カメラは動かさない
        const roll = THREE.MathUtils.clamp(-vx * 0.04, -0.7, 0.7);
        const pitch = THREE.MathUtils.clamp(vy * 0.025, -0.35, 0.35);
        m.obj.rotation.z += (roll - m.obj.rotation.z) * Math.min(1, dt * 6);
        m.pitch = (m.pitch || 0) + (pitch - (m.pitch || 0)) * Math.min(1, dt * 6); // 追いかける傾きは別に持つ (よろけの分は上に足す)
        m.obj.rotation.x = m.pitch;
      }

      // 人間は地面に降りると走る: 脚を真下に向けて交互に振り、体を起こして足を地面に着ける
      if (m.legs) {
        const originY = this.rig.position.y + m.obj.position.y;
        const lowY = view === 'side' ? originY - 1.1 : originY; // 横スクロールは体の中心を目の高さに置いているので、その分ずらす
        const onGround = lowY < 1.0 && this.fallT < 0 && !this.riding && view !== '1st';
        m.run = (m.run || 0) + ((onGround ? 1 : 0) - (m.run || 0)) * Math.min(1, dt * 8);
        m.runPhase = (m.runPhase || 0) + dt * (9 + thrust * 3);
        const sw = Math.sin(m.runPhase);
        m.legs.L.rotation.x = m.run * (LEG_DOWN + sw * 0.7);
        m.legs.R.rotation.x = m.run * (LEG_DOWN - sw * 0.7);
        m.legs.arm.rotation.x = m.run * sw * 0.7;
        m.obj.rotation.x *= 1 - m.run * 0.85;
        if (m.run > 0.01 && m.legs.feet.length) {
          // 低いほうの足の裏 (ブーツの下端) が地面 (y = 0) にちょうど着くように、体の高さを合わせる
          this.rig.updateMatrixWorld(true); // このフレームで動かしたリグの位置も反映して測る
          let foot = Infinity;
          for (const f of m.legs.feet) foot = Math.min(foot, _box.setFromObject(f).min.y);
          m.obj.position.y -= m.run * foot;
        }
      }

      // よろける: 前のめりになって、少し跳ねる
      if (this.stumbleT > 0) {
        this.stumbleT -= dt;
        const k = Math.sin((1 - this.stumbleT / 0.7) * Math.PI);
        m.obj.rotation.x -= k * 0.9;
        m.obj.position.y += k * 0.4;
      }
      // やられた: うつ伏せに倒れながら、地面まで落ちる
      if (this.fallT >= 0) {
        this.fallT += dt;
        const worldY = this.rig.position.y + m.obj.position.y;
        m.obj.position.y -= Math.min(Math.max(0, worldY - 0.5), 4.9 * this.fallT * this.fallT);
        m.obj.rotation.x = -Math.min(1.45, this.fallT * 3);
        m.obj.rotation.z = Math.sin(this.fallT * 9) * 0.15 * Math.max(0, 1 - this.fallT);
        if (!this.fallHold && this.fallT > 1.6) this.fallT = -1; // 起き上がって復帰する
      }

      // 炎: 速度に合わせて伸び縮みし、ちらつく
      for (const [i, f] of m.flames.entries()) {
        const flicker = 0.85 + 0.15 * Math.sin(this.t * 40 + i * 2.1) + 0.1 * Math.sin(this.t * 67 + i);
        const len = (0.4 + thrust * 0.8) * flicker * (1 - (m.run || 0) * 0.7); // 走っている間は炎を小さく
        f.mesh.scale.set(f.base.x * (0.8 + 0.2 * flicker), f.base.y * len, f.base.z * (0.8 + 0.2 * flicker));
      }
    }

    // 当たり判定の中心: 一人称は頭、三人称はモデルの位置
    const m = this.models[kind];
    if (view === 'side') this.hitPoint.copy(sidePos);
    else if (view === '3rd' && m) m.obj.getWorldPosition(this.hitPoint);
    else this.camera.getWorldPosition(this.hitPoint);

    const h = Math.max(0, this.hitPoint.y);
    this.shadow.position.set(this.hitPoint.x, 0.04, this.hitPoint.z);
    this.shadow.scale.setScalar((kind === 'ship' ? 2.6 : 0.8) * (1 - Math.min(h / 30, 0.5)));
    this.shadow.material.opacity = 0.35 * (1 - Math.min(h / 20, 0.6));
    this.shadow.visible = !!m && !this.destroyed && !this.hidden;
  }
}
