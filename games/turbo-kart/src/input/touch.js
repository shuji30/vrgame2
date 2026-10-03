// スマートフォン用のタッチ操作（AT のみ）: 左下のスティックでハンドル、右下のアクセル・ブレーキ、アイテム、ポーズ。
// タッチ操作の端末で、レース中（HUD 表示中）だけ見える。複数の指を同時に使える（Pointer Events）
export function isTouchDevice() {
  return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
}

export class TouchControls {
  constructor(parent) {
    this.state = { steer: 0, throttle: 0, brake: 0, item: false, itemBack: false, pause: false };
    this.active = false;
    const root = (this.root = document.createElement('div'));
    root.className = 'touch';
    root.innerHTML = `
      <div class="t-stick" data-t="stick"><div class="t-knob"></div><span>◀ ハンドル ▶</span></div>
      <button class="t-btn t-pause" data-t="pause">⏸</button>
      <button class="t-btn t-item" data-t="item">アイテム</button>
      <button class="t-btn t-brake" data-t="brake">ブレーキ</button>
      <button class="t-btn t-accel" data-t="throttle">アクセル</button>`;
    parent.appendChild(root);
    document.body.classList.add('touch-ui');

    // スティック: 触れた位置を中心に、左右へ 70px でフルロック
    const stick = root.querySelector('[data-t=stick]');
    const knob = stick.querySelector('.t-knob');
    let sid = null, x0 = 0;
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sid = e.pointerId;
      x0 = e.clientX;
      stick.setPointerCapture(sid);
      this.active = true;
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== sid) return;
      const dx = Math.max(-70, Math.min(70, e.clientX - x0));
      this.state.steer = dx / 70;
      knob.style.transform = `translateX(${dx}px)`;
    });
    const release = (e) => {
      if (e.pointerId !== sid) return;
      sid = null;
      this.state.steer = 0;
      knob.style.transform = '';
    };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);

    // ボタン: 押している間だけ（アイテム・ポーズは押した瞬間）
    for (const b of root.querySelectorAll('.t-btn')) {
      const key = b.dataset.t;
      const on = (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add('on');
        this.active = true;
        if (key === 'throttle' || key === 'brake') this.state[key] = 1;
        else this.state[key] = true;
      };
      const off = () => {
        b.classList.remove('on');
        if (key === 'throttle' || key === 'brake') this.state[key] = 0;
      };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
    }
    // 長押しのメニューや拡大を出さない
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // 押した瞬間の操作（アイテム・ポーズ）は一度読んだら消す
  read() {
    const s = { ...this.state };
    this.state.item = this.state.itemBack = this.state.pause = false;
    return s;
  }
}
