// スマホ・タブレットのタッチ操作。画面の左右の端に履帯のゲージを置き、ゲージを直接触って動かす
// 標準(左右の履帯を別々に):左ゲージ = 左の履帯、右ゲージ = 右の履帯。触った高さがそのまま出力(中央 0、上 = 前進、下 = 後退)
// 簡易操作:左ゲージ = 前後、右ゲージ(横向き)= 旋回
// 砲塔は画面の中ほどを左右になぞる。指を離すと履帯は 0 に戻る。値は InputManager.poll で共通アクションにまとめる
//
// 指が離れた知らせ(pointerup)が届かないと、そのゲージやボタンが効かなくなる。
// そうならないよう、lostpointercapture・画面を隠したとき・アプリの切り替え・ポーズでも必ず状態を戻す

import { arcadeToTracks } from '../core/tankmap.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dz = (v, d = 0.08) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));

export const isTouchDevice = () => typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);

const GW = 'max(84px, 15vw)'; // ゲージの触れる幅

const CSS = `
#touch { position: fixed; inset: 0; z-index: 4; pointer-events: none; touch-action: none; user-select: none; -webkit-user-select: none; }
#touch .zone { position: absolute; pointer-events: auto; touch-action: none; }
#touch .gauge { top: 16vh; bottom: 2vh; width: ${GW}; }
#touch .gauge.l { left: 0; } #touch .gauge.r { right: 0; }
#touch .swipe { left: ${GW}; right: ${GW}; top: 16vh; bottom: 0; }
#touch .bar { position: absolute; left: 50%; top: 6px; bottom: 26px; width: 46px; transform: translateX(-50%); pointer-events: none;
  border-radius: 10px; border: 2px solid rgba(255, 220, 160, 0.4); background: rgba(20, 16, 10, 0.35); overflow: hidden; }
#touch .mid { position: absolute; left: 0; right: 0; top: 50%; height: 2px; margin-top: -1px; background: rgba(255, 220, 160, 0.6); }
#touch .fill { position: absolute; left: 0; right: 0; height: 0; background: rgba(255, 150, 50, 0.7); }
#touch .fill.rev { background: rgba(90, 170, 255, 0.7); }
#touch .gauge.on .bar { border-color: rgba(255, 220, 160, 0.85); }
#touch .lbl { position: absolute; left: 0; right: 0; bottom: 4px; text-align: center; font: 700 12px system-ui, sans-serif; color: rgba(244, 234, 216, 0.7); pointer-events: none; }
/* 簡易操作の右ゲージは横向き(旋回) */
#touch.easy .gauge.r { top: auto; bottom: 2vh; height: 22vh; width: 34vw; }
#touch.easy .gauge.r .bar { left: 8px; right: 8px; top: 8px; bottom: 26px; width: auto; transform: none; }
#touch.easy .gauge.r .mid { top: 0; bottom: 0; left: 50%; right: auto; width: 2px; height: auto; margin: 0 0 0 -1px; }
#touch.easy .gauge.r .fill { top: 0; bottom: 0; height: auto; width: 0; }
#touch.easy .swipe { right: 34vw; }
#touch .btn { position: absolute; pointer-events: auto; touch-action: none; display: grid; place-items: center; border-radius: 50%;
  font: 800 14px system-ui, sans-serif; color: #f4ead8; background: rgba(40, 30, 18, 0.55); border: 2px solid rgba(255, 220, 160, 0.45); }
#touch .btn.on { background: rgba(255, 140, 40, 0.75); }
#touch .fire { right: calc(${GW} + 14px); bottom: 8vh; width: 84px; height: 84px; background: rgba(200, 70, 20, 0.6); font-size: 16px; }
#touch .sub { right: calc(${GW} + 14px); bottom: calc(8vh + 96px); width: 62px; height: 62px; }
#touch .lob { left: calc(${GW} + 14px); bottom: 8vh; width: 66px; height: 66px; }
#touch .gear { left: calc(${GW} + 14px); bottom: calc(8vh + 78px); width: 54px; height: 54px; font-size: 12px; }
#touch.easy .fire, #touch.easy .sub { right: calc(34vw + 14px); }
#touch .view { right: 12px; top: 12px; width: 48px; height: 48px; font-size: 12px; border-radius: 10px; }
#touch .pause { right: 68px; top: 12px; width: 48px; height: 48px; font-size: 16px; border-radius: 10px; }
`;

export class TouchControls {
  constructor() {
    this.scheme = 'tracks';
    this.state = { l: 0, r: 0, swipe: 0 };
    this.held = {};
    this.edges = {};
    this.gear = 2;
    this.visible = false;
    this.releasers = []; // 各ゲージ・ボタンの「指を離した状態に戻す」処理
    if (typeof document === 'undefined') return;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.hidden = true;
    root.innerHTML = `
      <div class="zone swipe"></div>
      <div class="zone gauge l"><div class="bar"><div class="mid"></div><div class="fill"></div></div><span class="lbl">左の履帯</span></div>
      <div class="zone gauge r"><div class="bar"><div class="mid"></div><div class="fill"></div></div><span class="lbl">右の履帯</span></div>
      <div class="btn fire" data-b="fire">主砲</div>
      <div class="btn sub" data-b="sub">副武装</div>
      <div class="btn lob" data-b="lob">曲射</div>
      <div class="btn gear" data-b="gear">ギア 2</div>
      <div class="btn view" data-b="view">視点</div>
      <div class="btn pause" data-b="pause">Ⅱ</div>`;
    document.body.appendChild(root);
    this._gauge(root.querySelector('.gauge.l'), 'l');
    this._gauge(root.querySelector('.gauge.r'), 'r');
    this._swipe(root.querySelector('.swipe'));
    for (const b of root.querySelectorAll('.btn')) this._button(b);
    // 長押しのメニューや、ダブルタップの拡大を出さない
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    // アプリの切り替えや通知で指の知らせが途切れても、戻ったときに効くようにする
    window.addEventListener('blur', () => this._reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this._reset(); });
  }

  setScheme(s) {
    this.scheme = s === 'easy' ? 'easy' : 'tracks';
    if (!this.root) return;
    this.root.classList.toggle('easy', this.scheme === 'easy');
    this.root.querySelector('.gauge.l .lbl').textContent = this.scheme === 'easy' ? '前後' : '左の履帯';
    this.root.querySelector('.gauge.r .lbl').textContent = this.scheme === 'easy' ? '旋回' : '右の履帯';
    this._reset();
  }

  setVisible(v) {
    v = !!v;
    if (v === this.visible || !this.root) return;
    this.visible = v;
    this.root.hidden = !v;
    this._reset();
  }

  // すべてを指を離した状態に戻す(ポーズ・非表示・アプリの切り替え)
  _reset() {
    for (const release of this.releasers) release();
    this.state = { l: 0, r: 0, swipe: 0 };
    this.held = {};
    this.edges = {};
  }

  // 1 本の指だけを追う。古い指の知らせが途切れていたら、新しい指で上書きする
  _track(el, { down, move, up }) {
    let id = null;
    const release = () => {
      if (id == null) return;
      const old = id;
      id = null;
      try { if (el.hasPointerCapture?.(old)) el.releasePointerCapture(old); } catch (_) { /* もう離れている */ }
      up();
    };
    this.releasers.push(release);
    el.addEventListener('pointerdown', (e) => {
      if (id != null && e.pointerId !== id) {
        // 前の指がまだ触れているなら無視。捕まえていない(知らせが途切れた)なら、前の指を捨てる
        if (el.hasPointerCapture?.(id)) return;
        release();
      }
      e.preventDefault();
      id = e.pointerId;
      try { el.setPointerCapture?.(id); } catch (_) { /* 捕まえられなくても動かす */ }
      down(e);
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) { e.preventDefault(); move(e); } });
    const end = (e) => { if (e.pointerId === id) release(); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  // 履帯のゲージ:触った位置がそのまま出力。指を離すと 0
  _gauge(zone, key) {
    const bar = zone.querySelector('.bar');
    const fill = zone.querySelector('.fill');
    const show = (v) => {
      const horizontal = this.scheme === 'easy' && key === 'r';
      fill.classList.toggle('rev', v < 0);
      const pct = `${Math.abs(v) * 50}%`;
      if (horizontal) {
        fill.style.top = fill.style.bottom = fill.style.height = '';
        fill.style.width = pct;
        fill.style.left = v >= 0 ? '50%' : `${50 - Math.abs(v) * 50}%`;
      } else {
        fill.style.left = fill.style.width = '';
        fill.style.height = pct;
        fill.style.top = v >= 0 ? `${50 - v * 50}%` : '50%';
      }
    };
    const set = (e) => {
      const rc = bar.getBoundingClientRect();
      const horizontal = this.scheme === 'easy' && key === 'r';
      // バーの端より少し手前で最大になるようにする(端まで指を運ばなくてよい)
      const raw = horizontal
        ? (e.clientX - (rc.left + rc.width / 2)) / (rc.width / 2 * 0.85)
        : ((rc.top + rc.height / 2) - e.clientY) / (rc.height / 2 * 0.85);
      const v = dz(clamp(raw, -1, 1));
      this.state[key] = v;
      show(v);
    };
    this._track(zone, {
      down: (e) => { zone.classList.add('on'); set(e); },
      move: set,
      up: () => { zone.classList.remove('on'); this.state[key] = 0; show(0); },
    });
  }

  // 画面の中ほどを左右になぞって砲塔を回す
  _swipe(zone) {
    const R = 90;
    let ox = 0;
    this._track(zone, {
      down: (e) => { ox = e.clientX; this.state.swipe = 0; },
      move: (e) => { this.state.swipe = clamp(-(e.clientX - ox) / R, -1, 1); },
      up: () => { this.state.swipe = 0; },
    });
  }

  _button(el) {
    const name = el.dataset.b;
    this._track(el, {
      down: () => {
        this.held[name] = true;
        this.edges[name] = true;
        el.classList.add('on');
        if (name === 'gear') {
          this.gear = this.gear === 3 ? 'R' : this.gear === 'R' ? 1 : this.gear + 1;
          el.textContent = `ギア ${this.gear}`;
        }
      },
      move: () => {},
      up: () => { this.held[name] = false; el.classList.remove('on'); },
    });
  }

  // 共通アクションの一部を返す(押した瞬間の値は一度だけ返す)
  poll() {
    const s = this.state, e = this.edges;
    let left, right;
    if (this.scheme === 'easy') {
      const t = arcadeToTracks(s.l, -s.r * 0.8);
      left = t.left; right = t.right;
    } else {
      left = s.l;
      right = s.r;
    }
    const out = {
      left, right, turret: clamp(s.swipe, -1, 1),
      fire: !!e.fire, sub: !!this.held.sub, subPress: !!e.sub, lob: !!this.held.lob,
      view: !!e.view, pause: !!e.pause, gear: this.gear,
      activity: Object.values(s).some((v) => v !== 0) || Object.values(this.held).some(Boolean),
    };
    this.edges = {};
    return out;
  }
}
