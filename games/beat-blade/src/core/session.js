// 1 プレイ分の進行（出現・移動・切断・ミス・爆弾・壁）を管理する。描画には関与せず、
// 発生した出来事を events として返すので、ゲーム本体はそれを見て演出する。
import { LOOKAHEAD, NOTE_HALF, BOMB_HALF, CUT_MIN_Z, MISS_Z, HEAD_RADIUS } from './config.js';
import { notePose, testContact, judgeCut, wallBox, headInWall } from './judge.js';
import { ScoreKeeper } from './scoring.js';

export class PlaySession {
  constructor(map, { heightOffset = 0, noFail = false } = {}) {
    this.map = map;
    this.njs = map.njs;
    this.h = heightOffset;
    this.score = new ScoreKeeper(map.notes.length, { noFail });
    this.noteIdx = 0;
    this.bombIdx = 0;
    this.wallIdx = 0;
    this.notes = []; // { obj, pose, prevPose }
    this.bombs = [];
    this.walls = []; // { obj, box }
    this.inWall = false;
    this.lastT = null;
  }

  get done() {
    return this.noteIdx >= this.map.notes.length && this.notes.length === 0;
  }

  // sabers: [{ color, anyColor, prevHilt, prevTip, hilt, tip, dt }]（無効な刀は渡さない）
  // head: 頭の位置 {x,y,z} または null
  step(t, sabers, head) {
    const events = [];
    const { map, njs, h, score } = this;
    const dt = this.lastT == null ? 0 : Math.max(0, t - this.lastT);
    this.lastT = t;

    while (this.noteIdx < map.notes.length && map.notes[this.noteIdx].time - LOOKAHEAD <= t) {
      const obj = map.notes[this.noteIdx++];
      const pose = notePose(obj, t, njs, h);
      const a = { obj, pose, prevPose: pose };
      this.notes.push(a);
      events.push({ type: 'spawn', kind: 'note', item: a });
    }
    while (this.bombIdx < map.bombs.length && map.bombs[this.bombIdx].time - LOOKAHEAD <= t) {
      const obj = map.bombs[this.bombIdx++];
      const pose = notePose(obj, t, njs, h);
      const a = { obj, pose, prevPose: pose };
      this.bombs.push(a);
      events.push({ type: 'spawn', kind: 'bomb', item: a });
    }
    while (this.wallIdx < map.walls.length && map.walls[this.wallIdx].time - LOOKAHEAD - 1 / njs <= t) {
      const obj = map.walls[this.wallIdx++];
      const a = { obj, box: wallBox(obj, t, njs) };
      this.walls.push(a);
      events.push({ type: 'spawn', kind: 'wall', item: a });
    }

    // ノーツ
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const a = this.notes[i];
      a.prevPose = a.pose;
      a.pose = notePose(a.obj, t, njs, h);
      let resolved = false;
      if (a.pose.z > CUT_MIN_Z) {
        for (const s of sabers) {
          const c = testContact(s, a.prevPose, a.pose, NOTE_HALF);
          if (!c) continue;
          const j = judgeCut(a.obj, s, c, a.pose);
          if (j.type === 'none') continue;
          if (j.type === 'good') score.good(j.score.total);
          else score.bad();
          events.push({ type: 'cut', good: j.type === 'good', item: a, judge: j, saber: s, contact: c });
          resolved = true;
          break;
        }
      }
      if (!resolved && a.pose.z > MISS_Z) {
        score.miss();
        events.push({ type: 'miss', item: a });
        resolved = true;
      }
      if (resolved) this.notes.splice(i, 1);
    }

    // 爆弾（速度に関係なく触れたら爆発）
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const a = this.bombs[i];
      a.prevPose = a.pose;
      a.pose = notePose(a.obj, t, njs, h);
      let gone = false;
      if (a.pose.z > CUT_MIN_Z) {
        for (const s of sabers) {
          if (testContact(s, a.prevPose, a.pose, BOMB_HALF)) {
            score.bomb();
            events.push({ type: 'bomb', item: a, saber: s });
            gone = true;
            break;
          }
        }
      }
      if (!gone && a.pose.z > MISS_Z) {
        events.push({ type: 'despawn', kind: 'bomb', item: a });
        gone = true;
      }
      if (gone) this.bombs.splice(i, 1);
    }

    // 壁
    let inside = false;
    for (let i = this.walls.length - 1; i >= 0; i--) {
      const a = this.walls[i];
      a.box = wallBox(a.obj, t, njs);
      if (head && headInWall(head, a.box, HEAD_RADIUS)) inside = true;
      if (a.box.z0 > 1.5) {
        events.push({ type: 'despawn', kind: 'wall', item: a });
        this.walls.splice(i, 1);
      }
    }
    if (inside) {
      if (!this.inWall) {
        score.wallEnter();
        events.push({ type: 'wallEnter' });
      }
      score.wallTick(dt);
    } else if (this.inWall) {
      events.push({ type: 'wallExit' });
    }
    this.inWall = inside;

    return events;
  }
}
