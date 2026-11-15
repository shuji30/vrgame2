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
      <div class="hud-radar"><canvas width="256" height="256"></canvas><span class="lbl"></span></div>
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

  // 画面のレーダー。src は車内のレーダーの絵(256×256、上が視線の向き)。
  // hull・gun は視線の向きから見た車体と砲身の向き(左が +)。真ん中に車体と砲塔を描き、ずれていれば角度を出す
  radar(src, hull, gun) {
    const cv = this.$('.hud-radar canvas');
    const g = cv.getContext('2d');
    const R = 128;
    g.clearRect(0, 0, 256, 256);
    g.save();
    g.beginPath(); g.arc(R, R, R - 2, 0, 7); g.clip();
    g.drawImage(src, 0, 0, 256, 256);
    g.restore();
    g.strokeStyle = 'rgba(120,255,160,0.55)';
    g.lineWidth = 4;
    g.beginPath(); g.arc(R, R, R - 3, 0, 7); g.stroke();
    // 車体(前に印)
    g.save();
    g.translate(R, R);
    g.rotate(-hull);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(-17, -26, 34, 52);
    g.fillStyle = Math.abs(hull - gun) > 0.14 ? '#d9a43c' : '#b7a57a';
    g.fillRect(-14, -23, 28, 46);
    g.fillStyle = '#f4ead8';
    g.beginPath(); g.moveTo(-9, -17); g.lineTo(0, -33); g.lineTo(9, -17); g.fill();
    g.restore();
    // 砲身と砲塔
    g.save();
    g.translate(R, R);
    g.rotate(-gun);
    g.strokeStyle = '#ffc24a';
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -46); g.stroke();
    g.fillStyle = '#ffc24a';
    g.beginPath(); g.arc(0, 0, 10, 0, 7); g.fill();
    g.restore();
    // 車体が砲塔からずれている角度(前へ走ると、画面の中でその向きへ進む)
    const off = Math.round(Math.abs(((hull - gun) * 180) / Math.PI));
    this.$('.hud-radar .lbl').textContent = off >= 8 ? `車体 ${hull < gun ? '右' : '左'}${off}°` : '';
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
    // 簡易計器(車内の計器は画面の下で小さく見づらいので、どの視点でもはっきり出す)
    const mini = this.$('.hud-mini');
    this.$('.time').textContent = s.timeText || '';
    this.$('.hp i').style.width = `${Math.max(0, s.hp01) * 100}%`;
    this.$('.rl i').style.width = `${Math.min(1, Math.max(0, s.reload01)) * 100}%`;
    this.$('.rl').classList.toggle('ready', s.reload01 >= 1);
    // 戦車は真ん中(1 発ぶん)に目盛り。半分を超えたら撃てる色に
    this.$('.rl').classList.toggle('twin', !!s.twin);
    this.$('.rl').classList.toggle('half', !!s.twin && s.reload01 >= 0.5 && s.reload01 < 1);
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
    const c = this.$('.hud-center');
    if (s.respawn > 0) c.textContent = `再出撃まで ${Math.ceil(s.respawn)}`;
    else if (s.lob) c.textContent = `逆立ち曲射 ${Math.round(s.lob)}m ― 主砲で発射`;
    else c.textContent = '';
  }
}
