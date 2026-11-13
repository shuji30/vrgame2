// 地形:高さ(格子に焼いて双線形補間)と、路面の種類(水・畑・道・金属床)
import { clamp, lerp } from './util.js';
import { makeRng } from './rng.js';

export const WATER_Y = -0.6; // 水面の高さ
const CELL = 2; // 格子の間隔(m)
export const MARGIN = 46; // 遊べる範囲の外側に描く土手の幅

function inRect(x, z, r, pad = 0) {
  if (r.rot) {
    const c = Math.cos(r.rot), s = Math.sin(r.rot);
    const lx = (x - r.x) * c - (z - r.z) * s;
    const lz = (x - r.x) * s + (z - r.z) * c;
    return Math.abs(lx) <= r.w / 2 + pad && Math.abs(lz) <= r.d / 2 + pad;
  }
  return Math.abs(x - r.x) <= r.w / 2 + pad && Math.abs(z - r.z) <= r.d / 2 + pad;
}

// 矩形(または円)の外側への距離(内側は負)
function rectDist(x, z, r) {
  if (r.r != null) return Math.hypot(x - r.x, z - r.z) - r.r;
  let lx = x - r.x, lz = z - r.z;
  if (r.rot) {
    const c = Math.cos(r.rot), s = Math.sin(r.rot);
    [lx, lz] = [lx * c - lz * s, lx * s + lz * c];
  }
  const dx = Math.abs(lx) - r.w / 2, dz = Math.abs(lz) - r.d / 2;
  const ox = Math.max(dx, 0), oz = Math.max(dz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(dx, dz), 0);
}

// 折れ線までの距離
function segDist(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const vx = bx - ax, vz = bz - az;
    const L = vx * vx + vz * vz || 1;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / L, 0, 1);
    best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
  }
  return best;
}

export class Terrain {
  constructor(stage) {
    this.stage = stage;
    this.hw = stage.size[0] / 2;
    this.hd = stage.size[1] / 2;
    this.indoor = !!stage.indoor;
    this.water = stage.water || [];
    this.fields = stage.fields || [];
    this.roads = stage.roads || [];
    this.mud = stage.mud || [];
    const rng = makeRng((stage.seed || 7) * 977);
    this.waves = [];
    for (let i = 0; i < 5; i++) {
      this.waves.push({ fx: rng.range(0.008, 0.03) * (rng.chance(0.5) ? 1 : -1), fz: rng.range(0.008, 0.03), ph: rng.range(0, 6.28), a: rng.range(0.4, 1) });
    }
    this.amp = stage.hills ?? 1.2;
    this.bumps = stage.bumps || [];
    this.flats = stage.flats || [];
    // 格子に焼く
    this.x0 = -this.hw - MARGIN;
    this.z0 = -this.hd - MARGIN;
    this.nx = Math.ceil((this.hw + MARGIN) * 2 / CELL) + 1;
    this.nz = Math.ceil((this.hd + MARGIN) * 2 / CELL) + 1;
    this.h = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        this.h[j * this.nx + i] = this.raw(this.x0 + i * CELL, this.z0 + j * CELL);
      }
    }
  }

  // 生の高さ(重いので格子を作るときだけ使う)
  raw(x, z) {
    if (this.indoor) {
      // 屋内は平らな金属床。外側は壁の向こうなので少し高くする
      const out = Math.max(Math.abs(x) - this.hw, Math.abs(z) - this.hd);
      return out > 0 ? Math.min(out * 0.4, 6) : 0;
    }
    let h = 0;
    for (const w of this.waves) h += Math.sin(x * w.fx + w.ph) * Math.cos(z * w.fz + w.ph * 0.7) * w.a;
    h *= this.amp;
    for (const b of this.bumps) {
      const d2 = (x - b.x) ** 2 + (z - b.z) ** 2;
      if (b.plateau) {
        // 台地:平らな頂上と斜面
        const d = Math.sqrt(d2);
        h += b.h * clamp((b.r - d) / (b.slope || 10), 0, 1);
      } else {
        h += b.h * Math.exp(-d2 / (b.r * b.r));
      }
    }
    // 平らにする場所(スタート地点や砲台の足元)
    for (const f of this.flats) {
      const d = Math.hypot(x - f.x, z - f.z);
      const t = clamp((d - f.r) / 8, 0, 1);
      h = lerp(f.h ?? 0, h, t);
    }
    // 道はなだらかに
    for (const r of this.roads) {
      const d = segDist(x, z, r.pts);
      const t = clamp((d - r.w / 2) / 6, 0, 1);
      h = lerp(h * 0.35, h, t);
    }
    // 水:岸から掘り下げる
    for (const w of this.water) {
      const d = rectDist(x, z, w);
      if (d < 4) h = lerp(-2.6, Math.max(h, 0.2), clamp((d + 1) / 5, 0, 1));
    }
    // 遊べる範囲の外は土手を上げる
    const out = Math.max(Math.abs(x) - this.hw, Math.abs(z) - this.hd);
    if (out > 0) h += out * out * 0.02 + out * 0.15;
    return h;
  }

  height(x, z) {
    const fx = clamp((x - this.x0) / CELL, 0, this.nx - 1.001);
    const fz = clamp((z - this.z0) / CELL, 0, this.nz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const n = this.nx;
    const a = this.h[j * n + i], b = this.h[j * n + i + 1];
    const c = this.h[(j + 1) * n + i], d = this.h[(j + 1) * n + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  // 地面の傾き(車体のピッチとロールの見た目に使う)
  slope(x, z, yaw, len = 2.5, wid = 1.5) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const lx = fz, lz = -fx; // 左
    const hf = this.height(x + fx * len, z + fz * len), hb = this.height(x - fx * len, z - fz * len);
    const hl = this.height(x + lx * wid, z + lz * wid), hr = this.height(x - lx * wid, z - lz * wid);
    return { pitch: Math.atan2(hf - hb, len * 2), roll: Math.atan2(hl - hr, wid * 2) };
  }

  isWater(x, z, pad = 0) {
    for (const w of this.water) if (rectDist(x, z, w) < pad) return true;
    return false;
  }

  // 路面:速度の倍率と振動(FFB)
  surface(x, z) {
    if (this.indoor) return { kind: 'metal', speed: 1, rough: 0.25, hz: 40 };
    for (const r of this.roads) if (segDist(x, z, r.pts) < r.w / 2) return { kind: 'road', speed: 1.08, rough: 0.12, hz: 25 };
    for (const f of this.fields) if (inRect(x, z, f)) return { kind: 'field', speed: 0.68, rough: 0.55, hz: 9 };
    for (const m of this.mud) if (rectDist(x, z, m) < 0) return { kind: 'mud', speed: 0.6, rough: 0.6, hz: 7 };
    return { kind: 'ground', speed: 1, rough: 0.3, hz: 14 };
  }

  inBounds(x, z, pad = 0) {
    return Math.abs(x) <= this.hw - pad && Math.abs(z) <= this.hd - pad;
  }

  // 頂点の色づけなど描画用に、格子の情報を返す
  grid() {
    return { x0: this.x0, z0: this.z0, nx: this.nx, nz: this.nz, cell: CELL, h: this.h };
  }
}

export { rectDist, segDist, inRect };
