// ドリフトの得点（ドリフト車）: 横滑りしながら走ると、角度と速さに応じて点がたまる。
// 滑りが止まって少したつとその回の点が確定し、続けてドリフトするとコンボの倍率が上がる。
// ドリフト中に壁に当たる・スピンすると、その回の点は消える
const MIN_ANGLE = 0.17; // ドリフトとみなす車体の横滑り角（約 10°）
const MIN_SPEED = 8; // 約 29 km/h
const SPIN = 1.75; // これを超えたらスピン（約 100°）
const SETTLE = 1.0; // 滑りが止まってから確定するまで（秒）
const CHAIN = 2.0; // 確定からこの秒数以内に次のドリフトを始めるとコンボ
const MAX_MULT = 5;

export class DriftScore {
  constructor() {
    this.reset();
  }

  reset() {
    this.total = 0;
    this.cur = 0; // いまのドリフトの点（倍率をかける前）
    this.mult = 1;
    this.angle = 0; // 度
    this.active = false;
    this.idle = 0; // 滑りが止まってからの時間
    this.sinceBank = Infinity; // 確定してからの時間
    this.best = 0; // 1 回のドリフトの最高点
    this.last = null; // 直前の結果 { points, mult, fail, t }
  }

  // kart: 物理の状態、events: このステップの出来事（壁に当たったなど）
  update(kart, dt, events = []) {
    const vF = kart.vx * Math.cos(kart.heading) + kart.vz * Math.sin(kart.heading);
    const vL = -kart.vx * Math.sin(kart.heading) + kart.vz * Math.cos(kart.heading);
    const speed = Math.hypot(vF, vL);
    const slip = Math.atan2(Math.abs(vL), Math.max(0.1, vF));
    this.angle = (slip * 180) / Math.PI;
    if (this.last) this.last.t += dt;
    this.sinceBank += dt;
    const onRoad = kart.surface !== 'grass' && kart.surface !== 'dirt';
    const crash = events.some((e) => e.type === 'wall' && e.strength > 2);
    if (this.cur > 0 && (crash || slip > SPIN)) {
      // 失敗: その回の点は消え、コンボも切れる
      this.last = { points: Math.round(this.cur * this.mult), mult: this.mult, fail: true, t: 0 };
      this.cur = 0;
      this.mult = 1;
      this.active = false;
      this.sinceBank = Infinity;
      return;
    }
    if (slip > MIN_ANGLE && slip <= SPIN && speed > MIN_SPEED && onRoad) {
      if (!this.active && this.cur === 0) {
        // 新しいドリフト: 直前の確定から間がなければコンボ
        this.mult = this.sinceBank < CHAIN ? Math.min(MAX_MULT, this.mult + 1) : 1;
      }
      this.active = true;
      this.idle = 0;
      // 角度（度）× 速さ（km/h）に比例してたまる。30° 80km/h で 1 秒あたり約 240 点
      this.cur += this.angle * speed * 3.6 * dt * 0.1;
    } else {
      this.active = false;
      if (this.cur > 0) {
        this.idle += dt;
        if (this.idle > SETTLE) this.bank();
      }
    }
  }

  bank() {
    const points = Math.round(this.cur * this.mult);
    this.total += points;
    this.best = Math.max(this.best, points);
    this.last = { points, mult: this.mult, fail: false, t: 0 };
    this.cur = 0;
    this.idle = 0;
    this.sinceBank = 0;
  }

  // いまのドリフトの点（倍率込み）
  get running() {
    return Math.round(this.cur * this.mult);
  }
}
