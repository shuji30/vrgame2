// スマートフォン向けのタッチ操作: 左半分は仮想スティック (指を置いた所が中心)、右下に射撃・ミサイル、右上に視点・ポーズ
export const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

const STICK_R = 60; // スティックを倒しきる距離 (px)

export class TouchControls {
  constructor(root) {
    this.root = root;
    this.move = { x: 0, y: 0 };
    this.fire = false;
    this.edges = new Set(); // 押した瞬間: 'missile' | 'view' | 'pause'
    this.used = false;      // 一度でもタッチで操作したか
    this.stickId = null;
    this.stickBase = root.querySelector('.stick-base');
    this.stickKnob = root.querySelector('.stick-knob');
    this.origin = { x: 0, y: 0 };

    // 左半分: 仮想スティック
    const pad = root.querySelector('.stick-area');
    pad.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      this.origin = { x: e.clientX, y: e.clientY };
      this.stickBase.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.stickBase.hidden = false;
      this.setKnob(0, 0);
      this.used = true;
      e.preventDefault();
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      let dx = e.clientX - this.origin.x, dy = e.clientY - this.origin.y;
      const len = Math.hypot(dx, dy);
      if (len > STICK_R) { dx *= STICK_R / len; dy *= STICK_R / len; }
      this.move.x = dx / STICK_R;
      this.move.y = -dy / STICK_R; // 上が +
      this.setKnob(dx, dy);
    });
    const endStick = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.move.x = this.move.y = 0;
      this.stickBase.hidden = true;
    };
    pad.addEventListener('pointerup', endStick);
    pad.addEventListener('pointercancel', endStick);

    // ボタン: 押している間 (射撃) と、押した瞬間 (ミサイル・視点・ポーズ)
    for (const btn of root.querySelectorAll('[data-hold], [data-tap]')) {
      btn.addEventListener('pointerdown', (e) => {
        btn.setPointerCapture(e.pointerId);
        btn.classList.add('on');
        this.used = true;
        if (btn.dataset.tap) this.edges.add(btn.dataset.tap);
        if (btn.dataset.hold === 'fire') this.fire = true;
        if (navigator.vibrate) navigator.vibrate(10);
        e.preventDefault();
      });
      const up = () => {
        btn.classList.remove('on');
        if (btn.dataset.hold === 'fire') this.fire = false;
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
    }
    // 画面を長押ししたときのメニューや、ダブルタップの拡大を防ぐ
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setKnob(dx, dy) {
    this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  // 押した瞬間の入力を読み出して消す
  takeEdge(name) {
    const had = this.edges.has(name);
    this.edges.delete(name);
    return had;
  }

  show(on) {
    this.root.hidden = !on;
    if (!on) {
      this.fire = false;
      this.move.x = this.move.y = 0;
      this.stickId = null;
      this.stickBase.hidden = true;
    }
  }
}
