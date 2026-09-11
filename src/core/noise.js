/* ═══════════════════════════════════════════════════════════
   Deterministic noise — the whole world is derived from this.
   Simplex 2D/3D (Gustavson/Ashima formulation, seeded permutation)
   plus the fBm / ridged / domain-warp helpers the terrain uses.
   ═══════════════════════════════════════════════════════════ */

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

const GRAD3 = new Float32Array([
  1,1,0, -1,1,0, 1,-1,0, -1,-1,0,
  1,0,1, -1,0,1, 1,0,-1, -1,0,-1,
  0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1
]);

/** xorshift32 — small, fast, reproducible. */
export function rng(seed) {
  let s = (seed | 0) || 0x9e3779b9;
  return function () {
    s ^= s << 13; s |= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s |= 0;
    return (s >>> 0) / 4294967296;
  };
}

export class Noise {
  constructor(seed = 1337) {
    const r = rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (r() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  simplex2(xin, yin) {
    const perm = this.perm, permMod12 = this.permMod12;
    let n0 = 0, n1 = 0, n2 = 0;

    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);

    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2,     y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2,  y2 = y0 - 1 + 2 * G2;

    const ii = i & 255, jj = j & 255;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const gi0 = permMod12[ii + perm[jj]] * 3;
      t0 *= t0; n0 = t0 * t0 * (GRAD3[gi0] * x0 + GRAD3[gi0 + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const gi1 = permMod12[ii + i1 + perm[jj + j1]] * 3;
      t1 *= t1; n1 = t1 * t1 * (GRAD3[gi1] * x1 + GRAD3[gi1 + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const gi2 = permMod12[ii + 1 + perm[jj + 1]] * 3;
      t2 *= t2; n2 = t2 * t2 * (GRAD3[gi2] * x2 + GRAD3[gi2 + 1] * y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  simplex3(xin, yin, zin) {
    const perm = this.perm, permMod12 = this.permMod12;
    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;

    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);

    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0)      { i1=1;j1=0;k1=0; i2=1;j2=1;k2=0; }
      else if (x0 >= z0) { i1=1;j1=0;k1=0; i2=1;j2=0;k2=1; }
      else               { i1=0;j1=0;k1=1; i2=1;j2=0;k2=1; }
    } else {
      if (y0 < z0)       { i1=0;j1=0;k1=1; i2=0;j2=1;k2=1; }
      else if (x0 < z0)  { i1=0;j1=1;k1=0; i2=0;j2=1;k2=1; }
      else               { i1=0;j1=1;k1=0; i2=1;j2=1;k2=0; }
    }

    const x1=x0-i1+G3,       y1=y0-j1+G3,       z1=z0-k1+G3;
    const x2=x0-i2+2*G3,     y2=y0-j2+2*G3,     z2=z0-k2+2*G3;
    const x3=x0-1+3*G3,      y3=y0-1+3*G3,      z3=z0-1+3*G3;

    const ii=i&255, jj=j&255, kk=k&255;

    let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
    if (t0 > 0) { const g=permMod12[ii+perm[jj+perm[kk]]]*3; t0*=t0;
      n0 = t0*t0*(GRAD3[g]*x0 + GRAD3[g+1]*y0 + GRAD3[g+2]*z0); }
    let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
    if (t1 > 0) { const g=permMod12[ii+i1+perm[jj+j1+perm[kk+k1]]]*3; t1*=t1;
      n1 = t1*t1*(GRAD3[g]*x1 + GRAD3[g+1]*y1 + GRAD3[g+2]*z1); }
    let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
    if (t2 > 0) { const g=permMod12[ii+i2+perm[jj+j2+perm[kk+k2]]]*3; t2*=t2;
      n2 = t2*t2*(GRAD3[g]*x2 + GRAD3[g+1]*y2 + GRAD3[g+2]*z2); }
    let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
    if (t3 > 0) { const g=permMod12[ii+1+perm[jj+1+perm[kk+1]]]*3; t3*=t3;
      n3 = t3*t3*(GRAD3[g]*x3 + GRAD3[g+1]*y3 + GRAD3[g+2]*z3); }

    return 32 * (n0 + n1 + n2 + n3);
  }

  /** Classic fractional Brownian motion. Returns roughly [-1,1]. */
  fbm(x, y, octaves = 5, lacunarity = 2.02, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, fx = x, fy = y;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.simplex2(fx, fy);
      norm += amp;
      amp *= gain;
      fx *= lacunarity; fy *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal — the one that makes mountains look like mountains. */
  ridged(x, y, octaves = 5, lacunarity = 2.03, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, fx = x, fy = y, prev = 1;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(this.simplex2(fx, fy));
      n *= n;
      n *= prev;            // feed previous octave forward: sharpens crests
      prev = n;
      sum += amp * n;
      norm += amp;
      amp *= gain;
      fx *= lacunarity; fy *= lacunarity;
    }
    return (sum / norm) * 2 - 1;
  }

  /** Billowy noise — good for rolling hills and cloud bodies. */
  billow(x, y, octaves = 4, lacunarity = 2.01, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, fx = x, fy = y;
    for (let o = 0; o < octaves; o++) {
      sum += amp * (Math.abs(this.simplex2(fx, fy)) * 2 - 1);
      norm += amp; amp *= gain;
      fx *= lacunarity; fy *= lacunarity;
    }
    return sum / norm;
  }

  /** Domain-warped fbm — kills the grid-aligned look of plain fbm. */
  warped(x, y, warp = 0.6, octaves = 5) {
    const wx = this.simplex2(x * 0.5 + 13.7, y * 0.5 - 4.2);
    const wy = this.simplex2(x * 0.5 - 8.1,  y * 0.5 + 21.3);
    return this.fbm(x + wx * warp, y + wy * warp, octaves);
  }
}

/* ── small maths helpers used all over the engine ─────────── */
export const clamp  = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp   = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
/** Frame-rate independent exponential approach. `rate` = 1/e time in seconds. */
export const damp   = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-dt / Math.max(1e-4, rate)));
