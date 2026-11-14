// 画面に重ねる表示(デスクトップ)。計器は車内に置くので、ここは最小限:
// 無線の字幕、大きなお知らせ、被弾の向き、ボスの体力、視点が車外のときの簡易計器
export class Hud {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-radio" hidden><b></b><span></span></div>
      <div class="hud-msg"></div>
      <div class="hud-boss" hidden><div class="name"></div><div class="bar"><i></i></div></div>
      <div class="hud-mini">
        <div class="time"></div>
        <div class="row"><span>装甲</span><div class="bar hp"><i></i></div></div>
        <div class="row"><span>装填</span><div class="bar rl"><i></i></div></div>
        <div class="row small"><span class="gear"></span><span class="still"></span><span class="obj"></span></div>
      </div>
      <div class="hud-tracks"><div class="tk l"><i></i></div><div class="tk r"><i></i></div></div>
      <div class="hud-dir">
        <svg viewBox="-40 -40 80 80" width="76" height="76" aria-hidden="true">
          <circle r="36" class="ring"/>
          <g class="hull"><rect x="-13" y="-20" width="26" height="40" rx="3"/><rect x="-17" y="-21" width="5" height="42" class="trk"/><rect x="12" y="-21" width="5" height="42" class="trk"/><path d="M-8 -14 L0 -27 L8 -14 Z" class="front"/></g>
          <line x1="0" y1="0" x2="0" y2="-33" class="gun"/><circle r="7" class="tur"/>
        </svg>
        <span class="lbl"></span>
      </div>
      <div class="hud-hit"></div>
      <div class="hud-pop"></div>
      <div class="hud-center"></div>`;
    this.$ = (s) => root.querySelector(s);
    this.msgT = 0;
    this.radioT = 0;
    this.hitT = 0;
  }

  reset() {
    this.$('.hud-radio').hidden = true;
    this.$('.hud-msg').textContent = '';
    this.$('.hud-boss').hidden = true;
    this.$('.hud-pop').innerHTML = '';
  }

  show(on) {
    this.root.hidden = !on;
  }

  radio(who, text, dur) {
    const r = this.$('.hud-radio');
    r.hidden = false;
    r.querySelector('b').textContent = who ? `${who}:` : '';
    r.querySelector('span').textContent = text;
    this.radioT = dur;
    this.lastRadio = { who, text };
  }

  message(text, sec, big) {
    const m = this.$('.hud-msg');
    m.textContent = text || '';
    m.className = 'hud-msg' + (big ? ' big' : '');
    this.msgT = sec;
    this.lastMsg = text;
  }

  hitDir(rel) {
    // rel: 視線の向きから見た被弾の方位(左が +)
    const h = this.$('.hud-hit');
    h.style.setProperty('--a', `${-rel}rad`);
    h.classList.add('on');
    this.hitT = 0.8;
  }

  // 短い表示(弾かれた・命中など)。同じ表示は重ねない
  pop(text, cls = '') {
    const box = this.$('.hud-pop');
    for (const q of box.children) if (q.textContent === text) q.remove();
    const p = document.createElement('div');
    p.textContent = text;
    p.className = cls;
    box.appendChild(p);
    setTimeout(() => p.remove(), 700);
  }

  killPop(type, score) {
    const p = document.createElement('div');
    p.textContent = type === 'bonus' ? `BONUS +${score}` : '撃破';
    p.className = type === 'bonus' ? 'bonus' : '';
    this.$('.hud-pop').appendChild(p);
    setTimeout(() => p.remove(), 1200);
  }

  update(s) {
    const dt = 1 / 60;
    this.msgT -= dt;
    if (this.msgT <= 0) this.$('.hud-msg').textContent = '';
    this.radioT -= dt;
    if (this.radioT <= 0) this.$('.hud-radio').hidden = true;
    this.hitT -= dt;
    if (this.hitT <= 0) this.$('.hud-hit').classList.remove('on');
    const b = this.$('.hud-boss');
    b.hidden = !s.boss;
    if (s.boss) {
      b.querySelector('.name').textContent = s.boss.name;
      b.querySelector('i').style.width = `${s.boss.hp * 100}%`;
    }
    // 車外の視点のときは簡易計器を出す(コックピットでは車内の計器を見る)
    const mini = this.$('.hud-mini');
    mini.classList.toggle('dim', s.view === 'cockpit');
    this.$('.time').textContent = s.timeText || '';
    this.$('.hp i').style.width = `${Math.max(0, s.hp01) * 100}%`;
    this.$('.rl i').style.width = `${Math.min(1, Math.max(0, s.reload01)) * 100}%`;
    this.$('.rl').classList.toggle('ready', s.reload01 >= 1);
    this.$('.gear').textContent = `ギア ${s.gear}`;
    this.$('.still').textContent = s.still ? '停車射撃' : '';
    this.$('.obj').textContent = s.objText || '';
    // 左右の履帯(画面の端に細く)
    const tk = (sel, v, broken) => {
      const el = this.$(sel);
      el.classList.toggle('broken', broken);
      const i = el.querySelector('i');
      const h = Math.min(1, Math.abs(v)) * 50;
      i.style.height = `${h}%`;
      i.style.bottom = v >= 0 ? '50%' : `${50 - h}%`;
      i.style.background = v >= 0 ? '#6cff8a' : '#ffb33a';
    };
    tk('.tk.l', s.tl, s.brokenL);
    tk('.tk.r', s.tr, s.brokenR);
    // 車体と砲塔の向き:画面の上が砲塔(照準)の向き。砲塔が左を向くと、車体は右へ傾いて見える。
    // 前へ走ったときに画面の中で進む向きが分かるように(ずれているほど目立たせる)
    const dir = this.$('.hud-dir');
    // ジオラマ視点は盤面が北を上に固定で、画面の上が砲塔の向きではないので出さない(自機そのものが見えている)
    dir.hidden = s.view === 'diorama';
    const deg = ((s.turret || 0) * 180) / Math.PI;
    dir.querySelector('.hull').setAttribute('transform', `rotate(${deg.toFixed(1)})`);
    const off = Math.abs(deg);
    dir.classList.toggle('off', off >= 8);
    dir.querySelector('.lbl').textContent = off >= 8 ? `車体 ${deg > 0 ? '右' : '左'}${Math.round(off)}°` : '';
    const c = this.$('.hud-center');
    if (s.respawn > 0) c.textContent = `再出撃まで ${Math.ceil(s.respawn)}`;
    else if (s.lob) c.textContent = `逆立ち曲射 ${Math.round(s.lob)}m ― 主砲で発射`;
    else c.textContent = '';
  }
}
