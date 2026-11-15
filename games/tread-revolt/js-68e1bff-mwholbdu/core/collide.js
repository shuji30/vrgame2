// 遮蔽物の当たり判定(箱と円柱)。格子で近くの物だけを調べる
const BUCKET = 16;

export class Obstacles {
  constructor(list, terrain) {
    this.list = [];
    this.grid = new Map();
    for (const o of list) this.add(o, terrain);
  }

  add(o, terrain) {
    o.id ??= this.list.length;
    o.y0 = o.y0 ?? (terrain ? terrain.height(o.x, o.z) - 0.4 : 0);
    o.top = o.y0 + o.h + 0.4;
    if (o.shape === 'box') {
      o.cos = Math.cos(o.rot || 0);
      o.sin = Math.sin(o.rot || 0);
      o.br = Math.hypot(o.w, o.d) / 2; // 外接円
    } else {
      o.br = o.r;
    }
    o.alive = true;
    this.list.push(o);
    const x0 = Math.floor((o.x - o.br) / BUCKET), x1 = Math.floor((o.x + o.br) / BUCKET);
    const z0 = Math.floor((o.z - o.br) / BUCKET), z1 = Math.floor((o.z + o.br) / BUCKET);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const k = i * 4096 + j;
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(o);
      }
    }
    return o;
  }

  near(x, z, r) {
    const out = new Set();
    const x0 = Math.floor((x - r) / BUCKET), x1 = Math.floor((x + r) / BUCKET);
    const z0 = Math.floor((z - r) / BUCKET), z1 = Math.floor((z + r) / BUCKET);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const b = this.grid.get(i * 4096 + j);
        if (b) for (const o of b) if (o.alive) out.add(o);
      }
    }
    return out;
  }

  // 円 (x,z,r) を遮蔽物の外へ押し出す。押し出した向きを返す(当たっていなければ null)
  pushOut(pos, r) {
    let hit = null;
    for (const o of this.near(pos.x, pos.z, r + 2)) {
      if (o.passable) continue;
      const n = circleVs(o, pos.x, pos.z, r);
      if (n) {
        pos.x += n.x * n.depth;
        pos.z += n.z * n.depth;
        hit = n;
      }
    }
    return hit;
  }

  // 点が遮蔽物の中か(弾の判定)
  pointHit(x, y, z) {
    for (const o of this.near(x, z, 1)) {
      if (y > o.top || y < o.y0 - 1) continue;
      if (inside(o, x, z, 0)) return o;
    }
    return null;
  }

  // 2点間の見通し(高さ y の線を遮る遮蔽物があるか)
  blocked(ax, ay, az, bx, by, bz, ignore = null) {
    const len = Math.hypot(bx - ax, bz - az);
    // 薄い壁(2m)や門(1.2m)をすり抜けないよう、0.9m おきに調べる
    const steps = Math.max(1, Math.ceil(len / 0.9));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      const o = this.pointHit(x, y, z);
      if (o && o !== ignore && !o.lowCover) return o;
    }
    return null;
  }

  // 半直線を進めて最初に当たる遮蔽物までの距離(照準の自動仰角用)
  rayDist(x, y, z, dx, dz, maxD) {
    for (let d = 2; d < maxD; d += 2) {
      const o = this.pointHit(x + dx * d, y, z + dz * d);
      if (o) return d;
    }
    return null;
  }
}

function inside(o, x, z, pad) {
  if (o.shape === 'box') {
    const lx = (x - o.x) * o.cos - (z - o.z) * o.sin;
    const lz = (x - o.x) * o.sin + (z - o.z) * o.cos;
    return Math.abs(lx) <= o.w / 2 + pad && Math.abs(lz) <= o.d / 2 + pad;
  }
  return (x - o.x) ** 2 + (z - o.z) ** 2 <= (o.r + pad) ** 2;
}

// three.js の rotation.y=rot の箱。ローカル→ワールド:x' = lx cos + lz sin, z' = -lx sin + lz cos
export function circleVs(o, x, z, r) {
  if (o.shape === 'box') {
    const lx = (x - o.x) * o.cos - (z - o.z) * o.sin;
    const lz = (x - o.x) * o.sin + (z - o.z) * o.cos;
    const hx = o.w / 2, hz = o.d / 2;
    const cx = Math.max(-hx, Math.min(hx, lx)), cz = Math.max(-hz, Math.min(hz, lz));
    let nx = lx - cx, nz = lz - cz;
    let d = Math.hypot(nx, nz);
    if (d >= r) return null;
    let depth;
    if (d < 1e-6) {
      // 中心が箱の中:一番近い面から出す
      const px = hx - Math.abs(lx), pz = hz - Math.abs(lz);
      if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; depth = px + r; } else { nx = 0; nz = Math.sign(lz) || 1; depth = pz + r; }
    } else {
      nx /= d; nz /= d; depth = r - d;
    }
    // ローカルの法線をワールドへ
    return { x: nx * o.cos + nz * o.sin, z: -nx * o.sin + nz * o.cos, depth, o };
  }
  const dx = x - o.x, dz = z - o.z;
  const d = Math.hypot(dx, dz);
  if (d >= o.r + r) return null;
  if (d < 1e-6) return { x: 1, z: 0, depth: o.r + r, o };
  return { x: dx / d, z: dz / d, depth: o.r + r - d, o };
}

export { inside };
