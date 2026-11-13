// 試験場の手引き:整備士が無線で順番に課題を出す。できたら次へ
import { isStill } from './core/ballistics.js';

const STEPS = [
  { text: 'まずは左右の履帯を両方前へ。まっすぐ20m進んでみろ。', check: (g, s) => s.dist > 20 },
  { text: '次は片側だけ。左だけ前に出すと右へ曲がる。ぐるっと回ってみろ。', check: (g, s) => s.turned > 3.2 },
  { text: '左右を逆に!左を前、右を後ろ。その場で回る、超信地旋回だ。', check: (g, s) => s.pivot > 2 },
  { text: '砲塔を回せ。車体と砲塔は別々に動く。', check: (g, s) => s.turret > 2.5 },
  { text: '止まって撃て。停車射撃は弾がまっすぐ飛ぶ。的に当ててみろ。', check: (g, s) => s.stillKills > 0 },
  { text: '今度は走りながら撃て。弾がばらつくのが分かるはずだ。', check: (g, s) => s.movingShots > 2 },
  { text: '壁の向こうの的は直接撃てん。逆立ちして曲射だ!立てたまま主砲で撃て。', check: (g, s) => s.lobs > 0 },
  { text: '副武装も試せ。機銃は押している間撃ち続ける。切り替えるとスモークだ。', check: (g, s) => s.mg > 8 },
  { text: '視点も切り替えてみろ。ハッチから身を乗り出すと遠くまで見えるが、撃たれやすい。', check: (g, s) => s.views > 1 },
  { text: '右奥の青い台はエレベーターだ。乗ると跳び上がって、高い所から盤面が見える。', check: (g, s) => s.elev > 0 },
  { text: 'ひと通りできたな。あとは好きなだけ撃ってくれ。ポーズからメニューへ戻れる。', check: () => false },
];

export class Tutorial {
  constructor() {
    this.i = -1;
    this.s = { dist: 0, turned: 0, pivot: 0, turret: 0, stillKills: 0, movingShots: 0, lobs: 0, mg: 0, views: 0, elev: 0 };
    this.wait = 3;
    this.lastView = null;
  }

  update(game, dt) {
    const me = game.me, s = this.s;
    if (!me.alive) return;
    s.dist += Math.abs(me.v) * dt;
    s.turned += Math.abs(me.w) * dt;
    if (me.tl * me.tr < -1) s.pivot += Math.abs(me.w) * dt;
    s.turret += Math.abs(me.turretRate || 0) * me.spec.turret * dt;
    if (game.view !== this.lastView) { if (this.lastView) s.views++; this.lastView = game.view; }
    // シミュレーションの出来事から数える
    for (const ev of game.tutorialEvents || []) {
      if (ev.t === 'fire' && ev.id === me.id && ev.kind === 'cannon' && !ev.still) s.movingShots++;
      if (ev.t === 'fire' && ev.id === me.id && ev.kind === 'lob') s.lobs++;
      if (ev.t === 'fire' && ev.id === me.id && ev.kind === 'mg') s.mg++;
      if (ev.t === 'kill' && ev.by === me.id && isStill(me.v, me.w)) s.stillKills++;
      if (ev.t === 'elevator' && ev.id === me.id) s.elev++;
    }
    game.tutorialEvents = [];
    this.wait -= dt;
    if (this.wait > 0) return;
    if (this.i < 0 || (this.i < STEPS.length && STEPS[this.i].check(game, s))) {
      this.i++;
      if (this.i < STEPS.length) {
        if (this.i > 0) game.app.audio.play('objective');
        game.radioQ.push({ who: 'mech', text: STEPS[this.i].text });
        this.wait = 2;
      }
    }
  }
}
