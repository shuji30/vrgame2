// スマホ・タブレットのタッチ操作。画面の上に、左右の履帯のパッドとボタンを重ねる
// 標準(左右の履帯を別々に):左パッドの上下 = 左の履帯、右パッドの上下 = 右の履帯、右パッドの左右 = 砲塔
// 簡易操作:左パッドで前後と旋回、右パッドの左右で砲塔
// 画面の中ほどを左右になぞっても砲塔が回る。値は InputManager.poll で共通アクションにまとめる

import { arcadeToTracks } from '../core/tankmap.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dz = (v, d = 0.12) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));

export const isTouchDevice = () => typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);

const CSS = `
#touch { position: fixed; inset: 0; z-index: 4; pointer-events: none; touch-action: none; user-select: none; -webkit-user-select: none; }
#touch .zone { position: absolute; pointer-events: auto; touch-action: none; }
#touch .pad { bottom: 0; width: 34vw; height: 62vh; }
#touch .pad.l { left: 0; } #touch .pad.r { right: 0; }
#touch .swipe { left: 34vw; right: 34vw; top: 14vh; bottom: 0; }
#touch .base, #touch .knob { position: absolute; border-radius: 50%; pointer-events: none; transform: translate(-50%, -50%); }
#touch .base { width: 130px; height: 130px; border: 2px solid rgba(255, 220, 160, 0.35); background: rgba(20, 16, 10, 0.25); }
#touch .knob { width: 58px; height: 58px; background: rgba(255, 160, 60, 0.55); border: 2px solid rgba(255, 220, 160, 0.7); }
#touch .hint { position: absolute; bottom: 10px; font: 700 12px system-ui, sans-serif; color: rgba(244, 234, 216, 0.6); pointer-events: none; }
#touch .pad.l .hint { left: 14px; } #touch .pad.r .hint { right: 14px; }
#touch .btn { position: absolute; pointer-events: auto; touch-action: none; display: grid; place-items: center; border-radius: 50%;
  font: 800 14px system-ui, sans-serif; color: #f4ead8; background: rgba(40, 30, 18, 0.55); border: 2px solid rgba(255, 220, 160, 0.45); }
#touch .btn.on { background: rgba(255, 140, 40, 0.75); }
#touch .fire { right: 3vw; bottom: 64vh; width: 84px; height: 84px; background: rgba(200, 70, 20, 0.6); font-size: 16px; }
#touch .sub { right: calc(3vw + 94px); bottom: 64vh; width: 62px; height: 62px; }
#touch .lob { left: 3vw; bottom: 64vh; width: 66px; height: 66px; }
#touch .gear { left: calc(3vw + 76px); bottom: 64vh; width: 54px; height: 54px; font-size: 12px; }
#touch .view { right: 12px; top: 12px; width: 48px; height: 48px; font-size: 12px; border-radius: 10px; }
#touch .pause { right: 68px; top: 12px; width: 48px; height: 48px; font-size: 16px; border-radius: 10px; }
`;

export class TouchControls {
  constructor() {
    this.scheme = 'tracks';
    this.state = { lx: 0, ly: 0, rx: 0, ry: 0, swipe: 0 };
    this.held = {};
    this.edges = {};
    this.gear = 2;
    this.visible = false;
    if (typeof document === 'undefined') return;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.hidden = true;
    root.innerHTML = `
      <div class="zone pad l"><span class="hint">左の履帯</span></div>
      <div class="zone pad r"><span class="hint">右の履帯 / 左右で砲塔</span></div>
      <div class="zone swipe"></div>
      <div class="btn fire" data-b="fire">主砲</div>
      <div class="btn sub" data-b="sub">副武装</div>
      <div class="btn lob" data-b="lob">曲射</div>
      <div class="btn gear" data-b="gear">ギア 2</div>
      <div class="btn view" data-b="view">視点</div>
      <div class="btn pause" data-b="pause">Ⅱ</div>`;
    document.body.appendChild(root);
    this._stick(root.querySelector('.pad.l'), 'l');
    this._stick(root.querySelector('.pad.r'), 'r');
    this._stick(root.querySelector('.swipe'), 's');
    for (const b of root.querySelectorAll('.btn')) this._button(b);
    // 長押しのメニューや、ダブルタップの拡大を出さない
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setScheme(s) {
    this.scheme = s === 'easy' ? 'easy' : 'tracks';
    if (!this.root) return;
    this.root.querySelector('.pad.l .hint').textContent = this.scheme === 'easy' ? '前後・旋回' : '左の履帯';
    this.root.querySelector('.pad.r .hint').textContent = this.scheme === 'easy' ? '左右で砲塔' : '右の履帯 / 左右で砲塔';
  }

  setVisible(v) {
    v = !!v;
    if (v === this.visible || !this.root) return;
    this.visible = v;
    this.root.hidden = !v;
    if (!v) this._reset();
  }

  _reset() {
    this.state = { lx: 0, ly: 0, rx: 0, ry: 0, swipe: 0 };
    this.held = {};
    for (const b of this.root.querySelectorAll('.btn')) b.classList.remove('on');
    for (const el of this.root.querySelectorAll('.base, .knob')) el.remove();
  }

  // 触った場所を中心に、指を動かした分だけ倒すスティック
  _stick(zone, key) {
    const R = 60;
    let id = null, ox = 0, oy = 0, base = null, knob = null;
    const set = (x, y) => {
      if (key === 's') { this.state.swipe = clamp(-(x - ox) / (R * 1.5), -1, 1); return; }
      const dx = clamp((x - ox) / R, -1, 1), dy = clamp((y - oy) / R, -1, 1);
      this.state[key + 'x'] = dz(dx);
      this.state[key + 'y'] = dz(-dy);
      if (knob) { knob.style.left = `${ox + dx * R}px`; knob.style.top = `${oy + dy * R}px`; }
    };
    zone.addEventListener('pointerdown', (e) => {
      if (id != null) return;
      e.preventDefault();
      id = e.pointerId;
      zone.setPointerCapture?.(id);
      ox = e.clientX; oy = e.clientY;
      if (key !== 's') {
        base = Object.assign(document.createElement('div'), { className: 'base' });
        knob = Object.assign(document.createElement('div'), { className: 'knob' });
        base.style.left = knob.style.left = `${ox}px`;
        base.style.top = knob.style.top = `${oy}px`;
        this.root.append(base, knob);
      }
      set(ox, oy);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === id) { e.preventDefault(); set(e.clientX, e.clientY); } });
    const up = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      if (key === 's') this.state.swipe = 0;
      else { this.state[key + 'x'] = 0; this.state[key + 'y'] = 0; }
      base?.remove(); knob?.remove(); base = knob = null;
    };
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
  }

  _button(el) {
    const name = el.dataset.b;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      this.held[name] = true;
      this.edges[name] = true;
      el.classList.add('on');
      if (name === 'gear') {
        this.gear = this.gear === 3 ? 'R' : this.gear === 'R' ? 1 : this.gear + 1;
        el.textContent = `ギア ${this.gear}`;
      }
    });
    const up = () => { this.held[name] = false; el.classList.remove('on'); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // 共通アクションの一部を返す(押した瞬間の値は一度だけ返す)
  poll() {
    const s = this.state, e = this.edges;
    let left, right, turret;
    if (this.scheme === 'easy') {
      const t = arcadeToTracks(s.ly, -s.lx * 0.8);
      left = t.left; right = t.right;
      turret = -s.rx;
    } else {
      left = s.ly;
      right = s.ry;
      turret = Math.abs(s.rx) > 0.35 ? -s.rx : 0; // 上下に動かすときに砲塔が回らないよう、はっきり横へ倒したときだけ
    }
    if (Math.abs(s.swipe) > Math.abs(turret)) turret = s.swipe;
    const out = {
      left, right, turret: clamp(turret, -1, 1),
      fire: !!e.fire, sub: !!this.held.sub, subPress: !!e.sub, lob: !!this.held.lob,
      view: !!e.view, pause: !!e.pause, gear: this.gear,
      activity: Object.values(s).some((v) => v !== 0) || Object.values(this.held).some(Boolean),
    };
    this.edges = {};
    return out;
  }
}
