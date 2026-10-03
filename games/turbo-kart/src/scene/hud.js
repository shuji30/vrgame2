// HUD: PC は HTML、VR はカートに付いたダッシュボード（Canvas）と前方の案内パネル
import * as THREE from 'three';
import { forwardSpeed, MAX_GEAR } from '../core/physics.js';
import { ITEMS } from '../core/items.js';

export function fmtTime(t) {
  if (t == null || !isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function gearLabel(g) {
  return g === -1 ? 'R' : g === 0 ? 'N' : String(g);
}

class CanvasPlane {
  constructor(w, h, px) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = px;
    this.canvas.height = Math.round((px * h) / w);
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, fog: false, toneMapped: false }),
    );
    this.mesh.renderOrder = 5;
  }

  commit() {
    this.tex.needsUpdate = true;
  }
}

// ミニマップ用にコースの外形を正規化しておく
function mapShape(track) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.N; i++) {
    minX = Math.min(minX, track.x[i]); maxX = Math.max(maxX, track.x[i]);
    minZ = Math.min(minZ, track.z[i]); maxZ = Math.max(maxZ, track.z[i]);
  }
  const span = Math.max(maxX - minX, maxZ - minZ);
  return { minX, minZ, span, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}

export function drawMinimap(ctx, track, shape, race, x, y, size) {
  const sc = (size * 0.9) / shape.span;
  const px = (wx) => x + size / 2 + (wx - shape.cx) * sc;
  const pz = (wz) => y + size / 2 + (wz - shape.cz) * sc;
  ctx.lineWidth = Math.max(3, size * 0.035);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  for (let i = 0; i <= track.N; i += 4) {
    const k = i % track.N;
    if (i === 0) ctx.moveTo(px(track.x[k]), pz(track.z[k]));
    else ctx.lineTo(px(track.x[k]), pz(track.z[k]));
  }
  ctx.closePath();
  ctx.stroke();
  for (const e of [...race.karts].reverse()) {
    const me = e.type === 'player';
    ctx.fillStyle = '#' + new THREE.Color(e.color).getHexString();
    ctx.beginPath();
    ctx.arc(px(e.kart.x), pz(e.kart.z), me ? size * 0.045 : size * 0.028, 0, Math.PI * 2);
    ctx.fill();
    if (me) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
  }
}

export class Hud {
  constructor(root) {
    this.root = root;
    this.el = {
      pos: root.querySelector('[data-hud=pos]'),
      lap: root.querySelector('[data-hud=lap]'),
      time: root.querySelector('[data-hud=time]'),
      best: root.querySelector('[data-hud=best]'),
      speed: root.querySelector('[data-hud=speed]'),
      gear: root.querySelector('[data-hud=gear]'),
      rpm: root.querySelector('[data-hud=rpm]'),
      center: root.querySelector('[data-hud=center]'),
      map: root.querySelector('[data-hud=map]'),
      board: root.querySelector('[data-hud=board]'),
      coins: root.querySelector('[data-hud=coins]'),
      pop: root.querySelector('[data-hud=pop]'),
      item: root.querySelector('[data-hud=item]'),
    };
    this.rouletteT = 0;
    this.lastPos = null;
    this.mapCtx = this.el.map.getContext('2d');
    // VR 用
    this.dash = new CanvasPlane(0.42, 0.2, 512);
    this.banner = new CanvasPlane(2.4, 0.9, 1024);
    this.lastDash = 0;
    this.bannerText = null;
  }

  setTrack(track) {
    this.track = track;
    this.shape = mapShape(track);
  }

  centerText(race, me) {
    if (race.state === 'countdown') {
      const n = Math.ceil(-race.time);
      return n > 0 ? String(n) : 'GO!';
    }
    if (race.time < 1) return 'GO!';
    if (me?.finished) return `FINISH!  ${me.position}位`;
    if (me?.lapFlash > 0) return me.lap === race.laps ? 'FINAL LAP' : `LAP ${me.lap}`;
    return '';
  }

  // 順位が変わったら「+1」「-1」を弾ませる（パーティーモード）
  popPosition(race, me) {
    const el = this.el.pop;
    if (race.state !== 'racing' || race.time < 3 || me.finished) {
      this.lastPos = me.position;
      return 0;
    }
    const d = this.lastPos == null ? 0 : this.lastPos - me.position;
    this.lastPos = me.position;
    if (!d) return 0;
    el.textContent = d > 0 ? `+${d}` : `${d}`;
    el.classList.toggle('down', d < 0);
    el.classList.remove('show');
    void el.offsetWidth; // アニメーションをやり直す
    el.classList.add('show');
    return d;
  }

  // アイテム枠に出す絵文字（ルーレット中は次々に変わる）と個数
  itemIcon(me, dt) {
    if (me.roulette > 0) {
      this.rouletteT += dt;
      const keys = Object.keys(ITEMS);
      return { icon: ITEMS[keys[Math.floor(this.rouletteT * 14) % keys.length]].emoji, count: '', spin: true };
    }
    if (me.item) return { icon: ITEMS[me.item].emoji, count: me.item === 'mushroom3' ? `×${me.itemCount}` : '', spin: false };
    return { icon: '', count: '', spin: false };
  }

  update(race, me, { vr = false, manual = false, dt = 0, party = false } = {}) {
    const k = me.kart;
    this.el.coins.hidden = !party || vr;
    if (party) this.el.coins.textContent = `🪙 ${me.coins || 0}`;
    const withItems = !!race.items;
    this.el.item.hidden = !withItems || vr;
    if (withItems) {
      const it = this.itemIcon(me, dt);
      this.item = it;
      this.el.item.firstElementChild.textContent = it.icon;
      this.el.item.lastElementChild.textContent = it.count;
      this.el.item.classList.toggle('spin', it.spin);
    } else {
      this.item = null;
    }
    const kmh = Math.round(Math.abs(forwardSpeed(k)) * 3.6);
    const lapTime = me.started && !me.finished ? race.time - me.lapStart : null;
    const center = this.centerText(race, me);
    if (!vr) {
      this.root.hidden = false;
      this.el.pos.innerHTML = `${me.position}<small>/${race.karts.length}</small>`;
      this.el.lap.textContent = `LAP ${Math.max(1, Math.min(race.laps, me.lap))}/${race.laps}`;
      this.el.time.textContent = fmtTime(Math.max(0, race.time));
      this.el.best.textContent = `LAP ${fmtTime(lapTime)}  BEST ${fmtTime(me.bestLap)}`;
      this.el.speed.textContent = kmh;
      this.el.gear.textContent = `${gearLabel(k.gear)}${manual ? '' : ' AT'}`;
      this.el.rpm.style.width = `${Math.min(100, k.rpm * 100)}%`;
      this.el.rpm.classList.toggle('red', k.rpm > 0.92);
      this.el.center.textContent = center;
      this.el.center.classList.toggle('big', /^\d$|GO/.test(center));
      const ctx = this.mapCtx;
      const S = this.el.map.width;
      ctx.clearRect(0, 0, S, S);
      drawMinimap(ctx, this.track, this.shape, race, 0, 0, S);
    } else {
      this.root.hidden = true;
    }
    this.lastDash += dt;
    if ((vr || this.dash.mesh.visible) && this.lastDash > 1 / 20) {
      this.lastDash = 0;
      this.drawDash(race, me, kmh, manual);
    }
    if (vr && center !== this.bannerText) {
      this.bannerText = center;
      this.drawBanner(center);
    }
  }

  drawDash(race, me, kmh, manual) {
    const { ctx, canvas } = this.dash;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,12,20,0.88)';
    ctx.beginPath();
    ctx.roundRect(2, 2, W - 4, H - 4, 22);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 84px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(String(kmh), 200, 92);
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText('km/h', 200, 150);
    ctx.textAlign = 'center';
    ctx.font = 'bold 72px system-ui, sans-serif';
    ctx.fillStyle = me.kart.rpm > 0.92 ? '#ff4040' : '#ffd84a';
    ctx.fillText(gearLabel(me.kart.gear), 262, 92);
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(manual ? 'MT' : 'AT', 262, 150);
    // 回転計
    const segs = 12;
    for (let i = 0; i < segs; i++) {
      const on = me.kart.rpm * segs > i;
      ctx.fillStyle = on ? (i >= segs - 2 ? '#ff3b3b' : i >= segs - 5 ? '#ffd84a' : '#4cff7a') : 'rgba(255,255,255,0.12)';
      ctx.fillRect(24 + i * 23, 196, 19, 22);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.fillText(`${me.position}/${race.karts.length}`, 316, 50);
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillText(`LAP ${Math.max(1, Math.min(race.laps, me.lap))}/${race.laps}`, 316, 100);
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText(fmtTime(Math.max(0, race.time)), 316, 140);
    drawMinimap(ctx, this.track, this.shape, race, 400, 150, 100);
    // アイテム（VR ではハンドルの計器に表示）
    if (this.item?.icon) {
      ctx.textAlign = 'center';
      ctx.font = '52px system-ui, sans-serif';
      ctx.fillText(this.item.icon, 462, 58);
      if (this.item.count) {
        ctx.font = 'bold 22px system-ui, sans-serif';
        ctx.fillText(this.item.count, 492, 96);
      }
    }
    this.dash.commit();
  }

  drawBanner(text) {
    const { ctx, canvas } = this.banner;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (text) {
      ctx.font = `900 ${/^\d$/.test(text) ? 300 : 150}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 14;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
      ctx.fillStyle = text.startsWith('GO') ? '#4cff7a' : text.startsWith('FIN') ? '#ffd84a' : '#ffffff';
      ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    }
    this.banner.commit();
  }

  // ゴール後の順位表（PC は HTML、VR はバナーの下に）
  showBoard(race, html) {
    this.el.board.hidden = !html;
    this.el.board.innerHTML = html || '';
  }

  hide() {
    this.root.hidden = true;
    this.el.board.hidden = true;
  }
}

export { MAX_GEAR };
