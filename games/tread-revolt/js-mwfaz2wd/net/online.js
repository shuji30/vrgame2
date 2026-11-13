// オンライン(ルームコード):あとで中継方式を決めて実装する
export class Online {
  constructor(ctx) {
    this.ctx = ctx;
  }

  render(el) {
    el.innerHTML = `<h2>オンライン</h2><p class="note">準備中です。</p><div class="row"><button data-go="title">◀ 戻る</button></div>`;
  }
}
