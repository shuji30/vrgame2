// HUD: PC は HTML、VR はカートに付いたダッシュボード（Canvas）と前方の案内パネル
import * as THREE from 'three';
import { forwardSpeed, MAX_GEAR } from '../core/physics.js';
import { ITEMS } from '../core/items.js';
import { COIN_BONUS } from '../core/coins.js';
import { fmtMs } from '../net/laps.js';
import { fastestLap, timingRows } from '../core/timing.js';

export { fastestLap, timingRows };

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// PC の画面右上のタイミング表
// ドリフトの得点の表示用の値（数は 3 桁区切り）
function driftView(drift) {
  const n = (v) => v.toLocaleString();
  const last = drift.last;
  const show = last && last.t < 2 && drift.running === 0;
  return {
    now: drift.running > 0 ? n(drift.running) : '',
    mult: drift.mult,
    angle: Math.round(drift.angle),
    pop: show ? (last.fail ? 'ドリフト失敗' : `+${n(last.points)}${last.mult > 1 ? ` (×${last.mult})` : ''}`) : '',
    fail: show && last.fail,
    total: n(drift.total),
  };
}

export function timingHtml({ rows, fastest }, rec) {
  const head = `<div class="tm-rec">🏁 最速ラップ <b>${fastest ? fmtTime(fastest.time) : '--:--.--'}</b> ${fastest ? escHtml(fastest.name) : ''}</div>`
    + `<div class="tm-rec gold">🏆 コースレコード <b>${rec ? fmtTime(rec.ms / 1000) : '--:--.--'}</b> ${rec ? escHtml(rec.name) : ''}</div>`;
  const body = rows.map((r) => `<tr class="${r.me ? 'me' : r.npc ? 'npc' : ''}"><td>${r.pos}</td><td><i style="background:#${new THREE.Color(r.color).getHexString()}"></i>${escHtml(r.name)}</td>`
    + `<td>${fmtTime(r.last)}</td><td class="${fastest && r.best === fastest.time ? 'purple' : ''}">${fmtTime(r.best)}</td></tr>`).join('');
  return `${head}<table><tr><th>#</th><th>DRIVER</th><th>LAST</th><th>BEST</th></tr>${body}</table>`;
}


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
  // onTop: 車体などに隠されず、常に手前に描く（VR の案内・リザルト・タイミング表）
  constructor(w, h, px, { onTop = false } = {}) {
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
    if (onTop) {
      this.mesh.material.depthTest = false;
      this.mesh.renderOrder = 30;
    }
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
      fastest: root.querySelector('[data-hud=fastest]'),
      record: root.querySelector('[data-hud=record]'),
      pb: root.querySelector('[data-hud=pb]'),
      draft: root.querySelector('[data-hud=draft]'),
      speed: root.querySelector('[data-hud=speed]'),
      gear: root.querySelector('[data-hud=gear]'),
      rpm: root.querySelector('[data-hud=rpm]'),
      center: root.querySelector('[data-hud=center]'),
      map: root.querySelector('[data-hud=map]'),
      board: root.querySelector('[data-hud=board]'),
      coins: root.querySelector('[data-hud=coins]'),
      pop: root.querySelector('[data-hud=pop]'),
      item: root.querySelector('[data-hud=item]'),
      itemHint: root.querySelector('[data-hud=itemhint]'),
      timing: root.querySelector('[data-hud=timing]'),
      drift: root.querySelector('[data-hud=drift]'),
    };
    this.rouletteT = 0;
    this.lastPos = null;
    this.mapCtx = this.el.map.getContext('2d');
    // VR 用
    // 下の帯に「最速 / 記録 / 自己ベスト」を出すため少し縦長
    this.dash = new CanvasPlane(0.42, 0.25, 512);
    this.banner = new CanvasPlane(2.4, 0.9, 1024, { onTop: true });
    // VR のリザルト（ゴール後に目の前に出す）。左にレースの順位、右にベストラップのランキング（10 位まで）
    this.results = new CanvasPlane(2.5, 1.45, 1536, { onTop: true });
    this.timing = new CanvasPlane(0.9, 0.8, 600, { onTop: true });
    // ドリフトの得点（VR）
    this.driftPanel = new CanvasPlane(1.0, 0.36, 512, { onTop: true });
    this.driftAt = 0;
    this.timingAt = 0;
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
    // ルーレット中は真ん中に大きく
    if (this.item?.spin) return `🎰 ${this.item.icon}`;
    // アイテムを使った・当たったときの短いメッセージ
    if (me?.msg?.t > 0 && !(me.itemFlash > 0)) return me.msg.text;
    // アイテムを取った直後は名前を大きく出す
    if (me?.itemFlash > 0 && me.item && ITEMS[me.item]) return `${ITEMS[me.item].emoji} ${ITEMS[me.item].name} ゲット！`;
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
      // スロットのように、だんだんゆっくりになる（約 1.6 秒で止まる）
      this.rouletteT += dt;
      const t = Math.min(this.rouletteT, 1.6);
      this.rouletteIdx = Math.floor(18 * t - 4.5 * t * t);
      const keys = Object.keys(ITEMS).filter((k) => k !== 'mushroom3');
      return { icon: ITEMS[keys[this.rouletteIdx % keys.length]].emoji, count: '', spin: true };
    }
    this.rouletteT = 0;
    if (me.item) return { icon: ITEMS[me.item].emoji, count: me.item === 'mushroom3' ? `×${me.itemCount}` : '', spin: false };
    return { icon: '', count: '', spin: false };
  }

  update(race, me, { vr = false, manual = false, dt = 0, party = false, timing = false, drift = null } = {}) {
    const k = me.kart;
    this.party = party;
    this.coinFlash = Math.max(0, (this.coinFlash || 0) - dt);
    this.el.coins.hidden = !party || vr;
    // コイン 1 枚で最高速 +0.6%（10 枚まで）
    if (party) this.el.coins.innerHTML = `🪙 ${me.coins || 0} <small>最高速 +${((me.coins || 0) * COIN_BONUS * 100).toFixed(1)}%</small>`;
    this.el.draft.textContent = (me.kart.draft || 0) > 0.25 ? `💨 スリップストリーム ${'▮'.repeat(Math.ceil(me.kart.draft * 4))}` : '';
    const withItems = !!race.items;
    this.el.item.hidden = !withItems || vr;
    if (withItems) {
      const it = this.itemIcon(me, dt);
      this.item = it;
      this.el.item.firstElementChild.textContent = it.icon;
      this.el.item.lastElementChild.textContent = it.count;
      // 使うボタンの案内
      this.el.itemHint.textContent = me.item && !it.spin ? (this.itemKey === '自動' ? '自動で使います' : `${this.itemKey || 'Shift'} で使う`) : '';
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
      this.el.best.innerHTML = `LAP ${fmtTime(lapTime)}<br>LAST ${fmtTime(me.lastLap)}　<b style="color:#7cff6a">BEST ${fmtTime(me.bestLap)}</b>`;
      // このレースの最速ラップ（全員の中で）と、ランキング 1 位のコースレコード
      const f = fastestLap(race);
      this.el.fastest.textContent = f ? `🏁 最速ラップ ${fmtTime(f.time)}  ${f.name}` : '';
      const rec = this.courseRecord;
      this.el.record.textContent = rec ? `🏆 コースレコード ${fmtTime(rec.ms / 1000)}  ${rec.name}` : '';
      // 自分の最速ラップ（このコース・車種・モードでの過去最高。今回更新したら 🆕）
      this.el.pb.textContent = this.personalBest ? `👤 自己ベスト ${fmtTime(this.personalBest)}${this.pbNew ? '  🆕' : ''}` : '👤 自己ベスト --:--.--';
      this.el.speed.textContent = kmh;
      this.el.gear.textContent = `${gearLabel(k.gear)}${manual ? '' : ' AT'}`;
      this.el.rpm.style.width = `${Math.min(100, k.rpm * 100)}%`;
      this.el.rpm.classList.toggle('red', k.rpm > 0.92);
      this.el.center.textContent = center;
      this.el.center.classList.toggle('big', /^\d$|GO/.test(center));
      this.el.center.classList.toggle('small', center.includes('ゲット') || !!(me.msg?.t > 0 && center === me.msg.text));
      this.el.center.classList.toggle('roul', center.startsWith('🎰'));
      const ctx = this.mapCtx;
      const S = this.el.map.width;
      ctx.clearRect(0, 0, S, S);
      drawMinimap(ctx, this.track, this.shape, race, 0, 0, S);
    } else {
      this.root.hidden = true;
    }
    // ドリフトの得点（ドリフト車）。PC は画面の上中央、VR は前方のパネル（0.1 秒ごとに書き換え）
    this.el.drift.hidden = !drift || vr;
    this.driftPanel.mesh.visible = !!drift && vr;
    this.driftAt += dt;
    if (drift && this.driftAt > 0.1) {
      this.driftAt = 0;
      const d = driftView(drift);
      if (vr) this.drawDrift(d);
      else {
        this.el.drift.innerHTML = (d.now ? `<div class="dr-now">DRIFT ${d.now}<small>×${d.mult}</small></div><div class="dr-ang">${d.angle}°</div>` : '')
          + (d.pop ? `<div class="dr-pop${d.fail ? ' fail' : ''}">${d.pop}</div>` : '')
          + `<div class="dr-total">ドリフト得点 ${d.total}</div>`;
      }
    }
    // 全員のラップタイムと最速ラップ（0.25 秒ごとに書き換え）
    this.timingAt += dt;
    this.el.timing.hidden = !timing || vr;
    this.timing.mesh.visible = timing && vr;
    if (timing && this.timingAt > 0.25) {
      this.timingAt = 0;
      const t = timingRows(race);
      if (vr) this.drawTiming(t, race);
      else this.el.timing.innerHTML = timingHtml(t, this.courseRecord);
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
    // 自分の直前のラップとベストラップ
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`LAST ${fmtTime(me.lastLap)}`, 316, 180);
    ctx.fillStyle = '#7cff6a';
    ctx.fillText(`BEST ${fmtTime(me.bestLap)}`, 316, 212);
    // コイン（パーティー）: 枚数と最高速の上乗せ。拾った直後は金色に光る
    if (this.party) {
      const flash = this.coinFlash > 0;
      ctx.textAlign = 'left';
      ctx.font = `bold ${flash ? 30 : 24}px system-ui, sans-serif`;
      ctx.fillStyle = flash ? '#ffe14a' : '#ffd23f';
      ctx.fillText(`🪙 ${me.coins || 0}  +${((me.coins || 0) * COIN_BONUS * 100).toFixed(1)}%`, 24, 30);
    }
    // 下の帯: このレースの最速ラップ / コースレコード / 自己ベスト
    const f = fastestLap(race);
    const rec = this.courseRecord;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(14, 258, W - 28, 40);
    ctx.textAlign = 'left';
    ctx.font = 'bold 21px system-ui, sans-serif';
    const cols = [
      ['🏁', f ? fmtTime(f.time) : '--:--.--', '#ffffff'],
      ['🏆', rec ? fmtTime(rec.ms / 1000) : '--:--.--', '#ffd23f'],
      ['👤', this.personalBest ? fmtTime(this.personalBest) + (this.pbNew ? '🆕' : '') : '--:--.--', '#7cff6a'],
    ];
    cols.forEach(([icon, txt, color], i) => {
      ctx.fillStyle = color;
      ctx.fillText(`${icon} ${txt}`, 24 + i * 162, 279);
    });
    ctx.fillStyle = '#fff';
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

  // VR のリザルト: 順位表・ランキング・操作の案内。extra: { rankText, board: { top, rank, me } | null, online }
  drawResults(race, me, extra = {}) {
    const { ctx, canvas } = this.results;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,12,24,0.92)';
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, 36);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd23f';
    ctx.font = 'italic 900 64px system-ui, sans-serif';
    ctx.fillText(`RESULT — ${me.position} 位`, 512, 70);
    if (extra.drift) {
      ctx.font = 'bold 28px system-ui, sans-serif';
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(`💨 ドリフト得点 ${extra.drift.total.toLocaleString()}（最高 ${extra.drift.best.toLocaleString()}）`, 512, 112);
    }
    const rows = race.standings();
    const leader = rows[0];
    const rowH = Math.min(52, 500 / rows.length);
    ctx.font = `bold ${Math.round(rowH * 0.62)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.textAlign = 'left';
    const y0 = 140;
    ctx.fillText('#', 60, y0);
    ctx.fillText('DRIVER', 130, y0);
    ctx.fillText('TIME', 560, y0);
    ctx.fillText('BEST LAP', 780, y0);
    rows.forEach((e, i) => {
      const y = y0 + (i + 1) * rowH;
      if (e === me) {
        ctx.fillStyle = 'rgba(255,210,63,0.18)';
        ctx.fillRect(40, y - rowH / 2, W - 80, rowH);
      }
      ctx.fillStyle = e === me ? '#ffd23f' : '#ffffff';
      ctx.fillText(String(e.position), 60, y);
      ctx.fillStyle = '#' + new THREE.Color(e.color).getHexString();
      ctx.fillRect(130, y - rowH * 0.25, rowH * 0.5, rowH * 0.5);
      ctx.fillStyle = e === me ? '#ffd23f' : '#ffffff';
      ctx.fillText(e.name, 130 + rowH * 0.7, y);
      const t = e.finished ? (e === leader ? fmtTime(e.finishTime) : `+${(e.finishTime - leader.finishTime).toFixed(2)}`) : `LAP ${Math.max(1, e.lap)}`;
      ctx.fillText(t, 560, y);
      ctx.fillText(fmtTime(e.bestLap), 780, y);
    });
    this.drawRanking(ctx, 1030, W - 40, extra);
    ctx.textAlign = 'center';
    if (extra.online) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.fillText('決定 / ポーズ: ロビーへ戻る', W / 2, H - 70);
    } else {
      // 3 つの選択肢（ハンドルで選んでアクセルで決める）
      const labels = [`▶ 次のコース`, '↻ もう一度', '✕ やめる'];
      const bw = 290, gap = 24, x0 = (W - (bw * 3 + gap * 2)) / 2, by = H - 108;
      labels.forEach((l, i) => {
        const on = i === (extra.sel || 0);
        ctx.fillStyle = on ? '#ff8a1f' : 'rgba(255,255,255,0.1)';
        ctx.beginPath();
        ctx.roundRect(x0 + i * (bw + gap), by, bw, 64, 16);
        ctx.fill();
        if (on) { ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 5; ctx.stroke(); }
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 32px system-ui, sans-serif';
        ctx.fillText(l, x0 + i * (bw + gap) + bw / 2, by + 33);
      });
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '24px system-ui, sans-serif';
      ctx.fillText(`ハンドルで選んで、アクセルを踏み込むと決定${extra.next ? `（次は ${extra.next}）` : ''}`, W / 2, H - 22);
    }
    this.results.commit();
  }

  // VR: ドリフトの得点
  drawDrift(d) {
    const { ctx, canvas } = this.driftPanel;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    if (d.now) {
      ctx.font = 'italic 900 64px system-ui, sans-serif';
      ctx.strokeText(`DRIFT ${d.now}  ×${d.mult}`, W / 2, 50);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`DRIFT ${d.now}  ×${d.mult}`, W / 2, 50);
      ctx.font = 'italic 900 34px system-ui, sans-serif';
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(`${d.angle}°`, W / 2, 102);
    } else if (d.pop) {
      ctx.font = 'italic 900 56px system-ui, sans-serif';
      ctx.strokeText(d.pop, W / 2, 60);
      ctx.fillStyle = d.fail ? '#ff5a4a' : '#7cff6a';
      ctx.fillText(d.pop, W / 2, 60);
    }
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.strokeText(`ドリフト得点 ${d.total}`, W / 2, 150);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(`ドリフト得点 ${d.total}`, W / 2, 150);
    this.driftPanel.commit();
  }

  // VR: タイミング表（全員）
  drawTiming({ rows, fastest }) {
    const { ctx, canvas } = this.timing;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,12,24,0.8)';
    ctx.beginPath();
    ctx.roundRect(2, 2, W - 4, H - 4, 22);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillStyle = '#c58aff';
    ctx.textAlign = 'left';
    ctx.fillText(`🏁 最速ラップ ${fastest ? `${fmtTime(fastest.time)}  ${fastest.name}` : '--:--.--'}`, 20, 32);
    const rec = this.courseRecord;
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(`🏆 コースレコード ${rec ? `${fmtTime(rec.ms / 1000)}  ${rec.name}` : '--:--.--'}`, 20, 66);
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('#', 20, 104);
    ctx.fillText('DRIVER', 52, 104);
    ctx.textAlign = 'right';
    ctx.fillText('LAST', 450, 104);
    ctx.fillText('BEST', W - 20, 104);
    const rowH = Math.min(40, (H - 130) / Math.max(1, rows.length));
    ctx.font = `bold ${Math.round(rowH * 0.6)}px system-ui, sans-serif`;
    rows.forEach((r, i) => {
      const y = 134 + i * rowH;
      if (r.me) {
        ctx.fillStyle = 'rgba(255,210,63,0.18)';
        ctx.fillRect(12, y - rowH / 2, W - 24, rowH);
      }
      ctx.fillStyle = r.me ? '#ffd23f' : r.npc ? 'rgba(255,255,255,0.6)' : '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(String(r.pos), 20, y);
      ctx.fillStyle = '#' + new THREE.Color(r.color).getHexString();
      ctx.fillRect(52, y - rowH * 0.22, rowH * 0.44, rowH * 0.44);
      ctx.fillStyle = r.me ? '#ffd23f' : r.npc ? 'rgba(255,255,255,0.6)' : '#fff';
      let name = r.name;
      while (name.length > 1 && ctx.measureText(name).width > 220) name = name.slice(0, -1);
      ctx.fillText(name, 52 + rowH * 0.6, y);
      ctx.textAlign = 'right';
      ctx.fillText(fmtTime(r.last), 450, y);
      // 全員の中の最速ラップは紫（モータースポーツの表示と同じ）
      ctx.fillStyle = fastest && r.best === fastest.time ? '#c58aff' : r.me ? '#ffd23f' : r.npc ? 'rgba(255,255,255,0.6)' : '#fff';
      ctx.fillText(fmtTime(r.best), W - 20, y);
    });
    this.timing.commit();
  }

  // VR のリザルトの右側: ベストラップ ランキング（上位 10 人）
  drawRanking(ctx, x0, x1, extra) {
    const b = extra.board;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.roundRect(x0, 30, x1 - x0, 690, 24);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd23f';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillText('🏆 ベストラップ ランキング', (x0 + x1) / 2, 72);
    ctx.font = 'bold 26px system-ui, sans-serif';
    if (!b) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(extra.rankText || 'ランキングに登録しています…', (x0 + x1) / 2, 360);
      return;
    }
    if (!b.top) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('ランキングのサーバーにつながりません', (x0 + x1) / 2, 360);
    } else if (!b.top.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('まだ記録がありません', (x0 + x1) / 2, 360);
    }
    const rowH = 52, y0 = 140;
    (b.top || []).slice(0, 10).forEach((r, i) => {
      const y = y0 + i * rowH;
      const mine = r.name === b.me;
      if (mine) {
        ctx.fillStyle = 'rgba(255,210,63,0.18)';
        ctx.fillRect(x0 + 10, y - rowH / 2 + 2, x1 - x0 - 20, rowH - 4);
      }
      ctx.fillStyle = i === 0 ? '#ffd23f' : i === 1 ? '#d8e2ee' : i === 2 ? '#e0a46a' : mine ? '#ffd23f' : '#ffffff';
      ctx.textAlign = 'right';
      ctx.fillText(String(i + 1), x0 + 58, y);
      ctx.fillStyle = mine ? '#ffd23f' : '#ffffff';
      ctx.textAlign = 'left';
      let name = r.name;
      // 長い名前は枠に収まるように縮める
      while (name.length > 1 && ctx.measureText(name).width > x1 - x0 - 250) name = name.slice(0, -1);
      ctx.fillText(name === r.name ? name : name + '…', x0 + 76, y);
      ctx.textAlign = 'right';
      ctx.fillText(fmtMs(r.ms), x1 - 24, y);
    });
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7cff6a';
    ctx.font = 'bold 28px system-ui, sans-serif';
    if (extra.rankText) ctx.fillText(extra.rankText, (x0 + x1) / 2, 690);
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
    // 中身が変わったときだけ書き換える（毎フレーム作り直すとボタンが押せない）
    if (html !== this.boardHtml) {
      this.boardHtml = html;
      this.el.board.innerHTML = html || '';
    }
  }

  hide() {
    this.root.hidden = true;
    this.el.board.hidden = true;
    this.timing.mesh.visible = false;
    this.driftPanel.mesh.visible = false;
  }
}

export { MAX_GEAR };
