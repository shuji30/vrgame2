// 協力プレイの仲間の機体を描く。位置は 1 秒に 15 回しか届かないので、少し遅らせて (DELAY)、
// 届いた 2 つの位置の間をなめらかにつなぐ。頭の上に名前を出す。
// 前後 (z) は自分の機体に合わせる: 一人称はカメラ、三人称は 5〜9 m 先の機体が「自分の位置」なので、
// そのまま描くと視点のちがう仲間が画面の外になる。仲間はいつも自分と横に並んで飛ぶように見せる
import * as THREE from 'three';

const DELAY = 110;  // 描く時刻を、届いた時刻からどれだけ遅らせるか (ms)
const STALE = 2500; // これだけ届かなければ隠す (ms)

export class RemotePlayers {
  // avatar: 自分の Avatar (読み込んだモデルを写して使う)
  constructor(scene, avatar) {
    this.scene = scene;
    this.avatar = avatar;
    this.peers = new Map(); // id → { group, kind, model, label, name, buf: [{ at, p, q }] }
  }

  // 1 フレームごと。session: CoopSession、selfZ: 自分の機体の前後の位置
  update(dt, session, selfZ = 0) {
    this.selfZ = selfZ;
    const now = performance.now();
    const seen = new Set();
    if (session?.state === 'playing') {
      for (const [id, s] of session.remote) {
        seen.add(id);
        const peer = this.peerFor(id, session);
        // 新しい位置が届いていれば、なめらかにつなぐための列に足す
        if (peer.last !== s) {
          peer.last = s;
          peer.buf.push({ at: s.recv, p: new THREE.Vector3(s.x, s.y, s.z), q: new THREE.Quaternion(s.qx, s.qy, s.qz, s.qw) });
          if (peer.buf.length > 8) peer.buf.shift();
          if (s.k && s.k !== peer.kind) this.setKind(peer, s.k);
        }
        peer.group.visible = now - s.recv < STALE && !s.h && !!peer.model;
        this.place(peer, now - DELAY);
        peer.model?.tick?.(dt, false, false);
      }
    }
    // いなくなった人・プレイ中でないときは消す
    for (const [id, peer] of this.peers) if (!seen.has(id)) this.remove(id);
  }

  peerFor(id, session) {
    let peer = this.peers.get(id);
    if (peer) return peer;
    const group = new THREE.Group();
    this.scene.add(group);
    const name = session.players.find((p) => p.id === id)?.name || '';
    peer = { group, kind: null, model: null, buf: [], name, label: makeLabel(name || '???') };
    group.add(peer.label);
    this.peers.set(id, peer);
    this.setKind(peer, session.info.get(id)?.kind || 'ship');
    return peer;
  }

  // プレイヤーの種類のモデルに着せかえる
  setKind(peer, kind) {
    peer.kind = kind;
    if (peer.model) peer.group.remove(peer.model.obj);
    peer.model = null;
    const label = peer.label;
    label.position.y = kind === 'ship' ? 2.2 : 1.6;
    if (kind === 'girl') {
      // 女の子は揺れもの (髪・スカート) があるので、写さずに読み込む
      const want = peer;
      import('../girl.js')
        .then(({ loadGirl }) => loadGirl(`${this.avatar.base}girl.vrm`, this.avatar.models.human?.obj.getObjectByName('HFlameL')))
        .then((g) => { if (want.kind === 'girl' && !want.model) { want.model = g; want.group.add(g.obj); g.obj.visible = true; } })
        .catch((e) => console.error('仲間の女の子のモデルを読み込めませんでした', e));
      return;
    }
    const src = this.avatar.models[kind];
    if (!src) return;
    const obj = src.obj.clone(true);
    obj.visible = true;
    obj.position.set(0, 0, 0);
    obj.rotation.set(0, 0, 0);
    obj.getObjectByName('CanopyArch')?.removeFromParent(); // 自分用の部品 (コックピットの枠と計器) は出さない
    obj.traverse((o) => { if (o.isMesh && o.userData.cockpitPanel) o.visible = false; });
    peer.model = { obj };
    peer.group.add(obj);
  }

  // 描く時刻 t (ms) の位置と向きを、届いた列からなめらかに求める
  place(peer, t) {
    const b = peer.buf;
    if (!b.length || !peer.model) return;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].at > t) i--;
    const a = b[Math.max(0, i - 1)], c = b[i];
    const k = c.at > a.at ? THREE.MathUtils.clamp((t - a.at) / (c.at - a.at), 0, 1.2) : 1; // 少し先までは延ばして描く
    peer.group.position.lerpVectors(a.p, c.p, k);
    peer.group.position.z = this.selfZ;
    peer.model.obj.quaternion.slerpQuaternions(a.q, c.q, Math.min(1, k));
  }

  remove(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.scene.remove(peer.group);
    peer.label.material.map.dispose();
    peer.label.material.dispose();
    this.peers.delete(id);
  }

  clear() { for (const id of [...this.peers.keys()]) this.remove(id); }
}

// 名前の札 (いつもこちらを向く)
function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(text, 128, 32);
  g.fillStyle = '#7fe0ff';
  g.fillText(text, 128, 32);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  sp.scale.set(2, 0.5, 1);
  sp.renderOrder = 20;
  return sp;
}
