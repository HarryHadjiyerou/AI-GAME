// Procedural height / mask fields for each biome.
// Pure JS so the same code runs on the main thread (physics, placement) and in the terrain worker.
import { createNoise2D, fbm, ridged, clamp, lerp, smoothstep, hash2 } from '../core/noise.js';

export const TREE = { REDWOOD: 0, FIR: 1, PINE: 2, BROADLEAF: 3 };

// City grid constants (shared by terrain shader, layout and collisions)
export const CITY = { PITCH: 110, ROAD: 22, RIVER_HALF: 70 };

function forestField(seed) {
  const nC = createNoise2D(seed + 1), nM = createNoise2D(seed + 2), nH = createNoise2D(seed + 3);
  const nR = createNoise2D(seed + 4), nW = createNoise2D(seed + 5), nF = createNoise2D(seed + 6);

  function river(x, z) {
    const wx = fbm(nW, x / 1800, z / 1800, 2) * 700;
    const wz = fbm(nW, x / 1800 + 31.7, z / 1800 - 11.3, 2) * 700;
    return Math.abs(fbm(nR, (x + wx) / 5200, (z + wz) / 5200, 2));
  }
  function height(x, z) {
    const c = fbm(nC, x / 7000, z / 7000, 3);
    const mMask = smoothstep(-0.4, 0.25, c);
    const m = ridged(nM, x / 2300, z / 2300, 6);
    const mountains = Math.pow(m, 1.35) * 1900 * mMask;
    const hills = 150 + fbm(nH, x / 850, z / 850, 5) * 110;
    let h = hills + mountains;
    const r = river(x, z);
    const valley = smoothstep(0.02, 0.3, r);
    h = lerp(10 + hills * 0.05, h, Math.pow(valley, 1.15));
    const channel = smoothstep(0.012, 0.03, r);
    h = lerp(-6, h, channel);
    return h;
  }
  function masks(x, z, h, ny) {
    const f = clamp(fbm(nF, x / 650, z / 650, 3) * 1.5 + 0.85, 0, 1);
    const flat = smoothstep(0.5, 0.68, ny);
    const treeline = 1 - smoothstep(1050, 1350, h);
    const forest = f * flat * treeline * smoothstep(1.5, 5, h);
    const wet = 1 - smoothstep(0.5, 6, h);
    const snow = smoothstep(1150, 1450, h + nF(x / 300, z / 300) * 150) * smoothstep(0.55, 0.8, ny);
    const meadow = clamp(nH(x / 400 + 9, z / 400) * 0.5 + 0.5, 0, 1);
    return [forest, wet, snow, meadow];
  }
  function tree(x, z, h, ny, rnd) {
    const [forest] = masks(x, z, h, ny);
    if (rnd > forest * 0.92) return -1;
    const t = hash2(x * 7 | 0, z * 7 | 0, 99);
    return t < 0.3 ? TREE.REDWOOD : t < 0.75 ? TREE.FIR : TREE.PINE;
  }
  return { height, masks, tree, treeCell: 11, river };
}

function coastField(seed) {
  const nS = createNoise2D(seed + 11), nS2 = createNoise2D(seed + 12), nC = createNoise2D(seed + 13);
  const nB = createNoise2D(seed + 14), nI = createNoise2D(seed + 15), nH = createNoise2D(seed + 16);
  const nT = createNoise2D(seed + 17);

  const shore = (x) => fbm(nS, x / 2600, 7.3, 4) * 900 + fbm(nS2, x / 520, 1.1, 3) * 140;
  const beachAmt = (x) => smoothstep(0.15, 0.45, fbm(nB, x / 1600, 3.3, 2));

  function height(x, z) {
    const s = z - shore(x);
    const beach = beachAmt(x);
    let h;
    if (s > 0) {
      const cliffTop = 55 + 70 * (fbm(nC, x / 1400, z / 1400, 3) * 0.5 + 0.5);
      const cliff = cliffTop * Math.pow(smoothstep(0, 55, s), 0.55);
      const beachP = Math.min(s * 0.03, 6) + smoothstep(150, 600, s) * cliffTop;
      h = lerp(cliff, beachP, beach);
      const inland = smoothstep(300, 2500, s);
      h += inland * (fbm(nH, x / 1100, z / 1100, 5) * 0.5 + 0.5) * 380;
      h += fbm(nH, x / 140, z / 140, 3) * 4 * smoothstep(20, 80, s);
    } else {
      h = -1.5 + s * lerp(0.12, 0.02, beach);
      h = Math.max(h, -90);
      // Sea stacks close to the cliffs
      const st = nT(x / 70, z / 70);
      const near = smoothstep(-300, -60, s) * (1 - smoothstep(-40, -10, s)) * (1 - beach);
      // flat-topped sea stacks
      if (st > 0.7 && near > 0.3) h = Math.max(h, smoothstep(0.7, 0.78, st) * (40 + 40 * nT(x / 300, z / 300)) * near - 3);
    }
    // Offshore islands
    const iso = fbm(nI, x / 1500, z / 1500, 4);
    const off = smoothstep(-500, -1100, s);
    if (iso > 0.4 && off > 0) {
      const t = (iso - 0.4) / 0.6;
      const ih = Math.pow(smoothstep(0, 0.12, t), 0.6) * (40 + t * 420) - 3;
      h = Math.max(h, ih * off + h * (1 - off) * 0);
    }
    return h;
  }
  function masks(x, z, h, ny) {
    const s = z - shore(x);
    const beach = beachAmt(x);
    const sand = clamp((1 - smoothstep(3, 9, h)) * (beach * 0.8 + 0.4) + (h < 1.2 ? 1 : 0), 0, 1);
    const flat = smoothstep(0.7, 0.85, ny);
    const forest = clamp(fbm(nH, x / 500, z / 500, 2) * 1.6 - 0.1, 0, 1) * flat * smoothstep(12, 40, h) * smoothstep(60, 250, s) * 0.8;
    return [forest, sand, 0, clamp(nC(x / 300, z / 300) * 0.5 + 0.5, 0, 1)];
  }
  function tree(x, z, h, ny, rnd) {
    const [forest] = masks(x, z, h, ny);
    if (rnd > forest * 0.8) return -1;
    return hash2(x | 0, z | 0, 5) < 0.7 ? TREE.PINE : TREE.BROADLEAF;
  }
  return { height, masks, tree, treeCell: 16, shore };
}

function mountainField(seed) {
  const nM = createNoise2D(seed + 21), nW = createNoise2D(seed + 22), nD = createNoise2D(seed + 23);
  const nF = createNoise2D(seed + 24), nB = createNoise2D(seed + 25);
  function height(x, z) {
    const wx = fbm(nW, x / 3000, z / 3000, 3) * 900;
    const wz = fbm(nW, x / 3000 + 17, z / 3000 - 5, 3) * 900;
    const m = ridged(nM, (x + wx) / 8000, (z + wz) / 8000, 4);
    const massif = fbm(nB, x / 11000, z / 11000, 3) * 0.5 + 0.5;
    let h = Math.pow(m, 1.2) * 2400 * (0.55 + massif * 0.7) + massif * 1400 - 300;
    h += fbm(nD, x / 1100, z / 1100, 5) * 260 * (0.4 + m);
    return h;
  }
  function masks(x, z, h, ny) {
    const flat = smoothstep(0.62, 0.82, ny);
    const forest = clamp(fbm(nF, x / 700, z / 700, 3) * 1.4 + 0.5, 0, 1) * flat * (1 - smoothstep(650, 1050, h)) * smoothstep(2, 10, h);
    const snowLine = 1500 + nF(x / 900, z / 900) * 250;
    const snow = smoothstep(snowLine - 250, snowLine + 150, h) * smoothstep(0.45, 0.75, ny) + smoothstep(snowLine + 900, snowLine + 1400, h) * 0.6;
    const wet = 1 - smoothstep(0.5, 6, h);
    return [forest, wet, clamp(snow, 0, 1), clamp(nD(x / 350, z / 350) * 0.5 + 0.5, 0, 1)];
  }
  function tree(x, z, h, ny, rnd) {
    const [forest] = masks(x, z, h, ny);
    if (rnd > forest * 0.85) return -1;
    return hash2(x | 0, z | 0, 3) < 0.6 ? TREE.FIR : TREE.PINE;
  }
  return { height, masks, tree, treeCell: 13 };
}

function cityField(seed) {
  const nH = createNoise2D(seed + 31), nP = createNoise2D(seed + 32);
  const riverX = (z) => 700 * Math.sin(z / 2100 + 0.6) + 180 * Math.sin(z / 640 + 1.3) + 500;
  function base(x, z) { return 4 + (fbm(nH, x / 3200, z / 3200, 3) * 0.5 + 0.5) * 10; }
  function height(x, z) {
    const d = Math.abs(x - riverX(z));
    const g = base(x, z);
    return lerp(-7, g, smoothstep(CITY.RIVER_HALF - 12, CITY.RIVER_HALF + 2, d));
  }
  function block(bx, bz) {
    const cx = (bx + 0.5) * CITY.PITCH, cz = (bz + 0.5) * CITY.PITCH;
    const riverD = Math.abs(cx - riverX(cz));
    const r = hash2(bx, bz, seed);
    let type = 'build';
    if (riverD < CITY.RIVER_HALF + CITY.PITCH * 0.55) type = 'river';
    else if (r < 0.07 || nP(bx / 6, bz / 6) > 0.62) type = 'park';
    else if (r < 0.1) type = 'construction';
    else if (r < 0.13) type = 'plaza';
    return { type, cx, cz, r };
  }
  function masks(x, z, h) {
    const bx = Math.floor(x / CITY.PITCH), bz = Math.floor(z / CITY.PITCH);
    const b = block(bx, bz);
    const park = b.type === 'park' ? 1 : 0;
    const wet = 1 - smoothstep(0.5, 5, h);
    const river = b.type === 'river' ? 1 : 0;
    return [park, wet, river, clamp(nH(x / 200, z / 200) * 0.5 + 0.5, 0, 1)];
  }
  function tree(x, z, h, ny, rnd) {
    const bx = Math.floor(x / CITY.PITCH), bz = Math.floor(z / CITY.PITCH);
    const lx = x - bx * CITY.PITCH, lz = z - bz * CITY.PITCH;
    const inner = lx > CITY.ROAD * 0.5 + 4 && lx < CITY.PITCH - CITY.ROAD * 0.5 - 4 && lz > CITY.ROAD * 0.5 + 4 && lz < CITY.PITCH - CITY.ROAD * 0.5 - 4;
    const b = block(bx, bz);
    if (b.type === 'park' && inner && h > 1 && rnd < 0.55) return TREE.BROADLEAF;
    if (b.type === 'river' && h > 1.5 && rnd < 0.25) return TREE.BROADLEAF;
    return -1;
  }
  return { height, masks, tree, treeCell: 12, block, riverX, base };
}

export function createField(biome, seed = 1337) {
  switch (biome) {
    case 'forest': return forestField(seed);
    case 'coast': return coastField(seed);
    case 'mountains': return mountainField(seed);
    case 'city': return cityField(seed);
  }
  throw new Error('unknown biome ' + biome);
}

// Surface normal via central differences.
export function normalAt(field, x, z, e = 2) {
  const hL = field.height(x - e, z), hR = field.height(x + e, z);
  const hD = field.height(x, z - e), hU = field.height(x, z + e);
  let nx = hL - hR, ny = 2 * e, nz = hD - hU;
  const l = Math.hypot(nx, ny, nz);
  return [nx / l, ny / l, nz / l];
}
