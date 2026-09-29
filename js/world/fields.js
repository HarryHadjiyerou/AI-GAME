// Procedural height / mask fields for each biome.
// Pure JS so the same code runs on the main thread (physics, placement) and in the terrain worker.
import { createNoise2D, fbm, ridged, clamp, lerp, smoothstep, hash2 } from '../core/noise.js';

export const TREE = { REDWOOD: 0, FIR: 1, PINE: 2, BROADLEAF: 3, PALM: 4 };

// City grid constants (shared by terrain shader, layout and collisions)
export const CITY = { PITCH: 110, ROAD: 22, RIVER_HALF: 70 };

// "The Wilds": lowland forests and rivers, 1 km-high red-rock tablelands cut by canyons down to
// river level (with oases on the canyon floors), and mountain ranges that rise to ~7 km.
function forestField(seed) {
  const nC = createNoise2D(seed + 1), nM = createNoise2D(seed + 2), nH = createNoise2D(seed + 3);
  const nR = createNoise2D(seed + 4), nW = createNoise2D(seed + 5), nF = createNoise2D(seed + 6);
  const nP = createNoise2D(seed + 7), nO = createNoise2D(seed + 8), nL = createNoise2D(seed + 9);

  function river(x, z) {
    const wx = fbm(nW, x / 1800, z / 1800, 2) * 700;
    const wz = fbm(nW, x / 1800 + 31.7, z / 1800 - 11.3, 2) * 700;
    return Math.abs(fbm(nL, (x + wx) / 5200, (z + wz) / 5200, 2));
  }
  function info(x, z) {
    const wx = fbm(nW, x / 6000, z / 6000, 3) * 1800, wz = fbm(nW, x / 6000 + 17.3, z / 6000 - 9.1, 3) * 1800;
    const c = fbm(nC, (x + wx * 0.5) / 26000, (z + wz * 0.5) / 26000, 3);
    const mMask = smoothstep(0.1, 0.42, c);
    const tMask = smoothstep(-0.12, -0.075, c); // sharp escarpment
    const lowland = 1 - tMask;
    // mountain ranges
    const rm = ridged(nM, (x + wx) / 11000, (z + wz) / 11000, 5);
    const peaks = (Math.pow(rm, 1.7) * 7000 + 500) * mMask;
    // lowland hills -> tableland
    const plat = 240 + tMask * (860 + fbm(nP, x / 5000, z / 5000, 4) * 220);
    let h = plat + fbm(nH, x / 900, z / 900, 4) * (70 - tMask * 30) + peaks;
    // canyons through the tableland
    const crMain = Math.abs(fbm(nR, (x + wx) / 15000, (z + wz) / 15000, 3));
    const crTrib = Math.abs(fbm(nO, (x + wx) / 5200 + 40, (z + wz) / 5200 - 20, 2)) * 1.9 + 0.012;
    const cr = Math.min(crMain, crTrib);
    const cStr = tMask * (1 - mMask * 0.92);
    let oasis = 0;
    if (cStr > 0.001) {
      const floorH = 22 + fbm(nO, x / 700, z / 700, 2) * 10;
      // erosion: spurs, alcoves and side gullies along the walls
      const crE = cr + fbm(nH, x / 420 + 11, z / 420 - 7, 3) * 0.011 + fbm(nP, x / 1300, z / 1300, 2) * 0.012;
      const prof = smoothstep(0.018, 0.08, Math.max(crE, cr * 0.5));
      // stepped walls: ledges and cliffs like layered sandstone
      const steps = 7 + Math.floor((fbm(nP, x / 3000 + 3, z / 3000, 2) * 0.5 + 0.5) * 4);
      let tp = prof * steps;
      const fl = Math.floor(tp);
      tp = (fl + smoothstep(0.5, 1.0, tp - fl)) / steps;
      const wall = lerp(prof, tp, 0.7);
      let hc = lerp(floorH, h, Math.pow(wall, 0.85));
      // gullies and buttresses on the faces
      const wallness = prof * (1 - prof) * 4;
      hc += fbm(nF, x / 110, z / 110, 3) * 45 * wallness;
      // river channel along the canyon floor
      hc = lerp(-6, hc, smoothstep(0.002, 0.005, cr));
      // oases where the canyon floor widens
      oasis = (1 - smoothstep(0.008, 0.024, cr)) * smoothstep(0.15, 0.4, fbm(nO, x / 1600 + 5, z / 1600, 2));
      if (oasis > 0.4 && nO(x / 180, z / 180) > 0.35) hc = Math.min(hc, lerp(hc, -4, smoothstep(0.35, 0.5, nO(x / 180, z / 180))));
      h = lerp(h, hc, cStr);
    }
    // lowland rivers
    if (lowland > 0.001) {
      const r = river(x, z);
      let hl = lerp(12, h, Math.pow(smoothstep(0.02, 0.3, r), 1.15));
      hl = lerp(-6, hl, smoothstep(0.012, 0.03, r));
      h = lerp(h, hl, lowland * (1 - mMask));
    }
    return { h, cStr, cr, oasis, mMask, tMask, lowland };
  }
  const height = (x, z) => info(x, z).h;
  function masks(x, z, h, ny, I = info(x, z)) {
    const f = clamp(fbm(nF, x / 650, z / 650, 3) * 1.5 + 0.85, 0, 1);
    const flat = smoothstep(0.5, 0.68, ny);
    const treeline = 1 - smoothstep(2600, 3300, h);
    const lowForest = I.lowland * f;
    const tableScrub = I.tMask * (1 - I.lowland) * 0.25 * f * smoothstep(300, 600, h);
    const oasisTrees = I.oasis * 0.95;
    const forest = clamp(lowForest + tableScrub + oasisTrees + I.mMask * f * 0.7, 0, 1) * flat * treeline * smoothstep(1.5, 5, h);
    const wet = clamp(Math.max(1 - smoothstep(0.5, 6, h), I.oasis), 0, 1);
    const snow = smoothstep(3600, 4300, h + nF(x / 600, z / 600) * 400) * smoothstep(0.5, 0.78, ny) + smoothstep(5500, 6200, h) * 0.7;
    const arid = clamp(I.tMask * (1 - I.mMask) * (1 - I.oasis) * (1 - wet), 0, 1);
    return [forest, wet, clamp(snow, 0, 1), arid];
  }
  function tree(x, z, h, ny, rnd) {
    const I = info(x, z);
    const [forest] = masks(x, z, h, ny, I);
    if (rnd > forest * 0.92) return -1;
    const t = hash2(x * 7 | 0, z * 7 | 0, 99);
    if (I.oasis > 0.3) return t < 0.55 ? TREE.PALM : TREE.BROADLEAF;
    if (h > 1800) return t < 0.6 ? TREE.FIR : TREE.PINE;
    if (I.tMask > 0.6) return TREE.PINE;
    return t < 0.3 ? TREE.REDWOOD : t < 0.75 ? TREE.FIR : TREE.PINE;
  }
  // Giant "titan" trees: one candidate per 1.4 km cell.
  function giant(ci, cj) {
    const C = 1400;
    if (hash2(ci, cj, 501) > 0.55) return null;
    const x = (ci + 0.2 + 0.6 * hash2(ci, cj, 502)) * C, z = (cj + 0.2 + 0.6 * hash2(ci, cj, 503)) * C;
    const I = info(x, z);
    if (I.h < 2 || I.h > 2400 || I.mMask > 0.6) return null;
    const e = 8;
    const nx = height(x - e, z) - height(x + e, z), nz = height(x, z - e) - height(x, z + e);
    if ((2 * e) / Math.hypot(nx, 2 * e, nz) < 0.8) return null;
    return { x, z, y: I.h, s: hash2(ci, cj, 504), oasis: I.oasis > 0.3 };
  }
  return { height, masks, tree, treeCell: 11, river, info, giant, giantCell: 1400, lightScale: 1 };
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
      const cliffTop = 140 + 260 * (fbm(nC, x / 1800, z / 1800, 3) * 0.5 + 0.5);
      const cliff = cliffTop * Math.pow(smoothstep(0, 90, s), 0.5);
      const beachP = Math.min(s * 0.03, 6) + smoothstep(200, 900, s) * cliffTop;
      h = lerp(cliff, beachP, beach);
      const inland = smoothstep(300, 2500, s);
      h += inland * (fbm(nH, x / 1600, z / 1600, 5) * 0.5 + 0.5) * 1100;
      h += fbm(nH, x / 140, z / 140, 3) * 4 * smoothstep(20, 80, s);
    } else {
      h = -1.5 + s * lerp(0.12, 0.02, beach);
      h = Math.max(h, -90);
      // Sea stacks close to the cliffs
      const st = nT(x / 70, z / 70);
      const near = smoothstep(-300, -60, s) * (1 - smoothstep(-40, -10, s)) * (1 - beach);
      // flat-topped sea stacks
      if (st > 0.7 && near > 0.3) h = Math.max(h, smoothstep(0.7, 0.78, st) * (110 + 90 * nT(x / 300, z / 300)) * near - 3);
    }
    // Offshore islands
    const iso = fbm(nI, x / 1500, z / 1500, 4);
    const off = smoothstep(-500, -1100, s);
    if (iso > 0.4 && off > 0) {
      const t = (iso - 0.4) / 0.6;
      const ih = Math.pow(smoothstep(0, 0.12, t), 0.5) * (90 + t * 900) - 3;
      h = Math.max(h, ih * off + h * (1 - off) * 0);
    }
    return h;
  }
  function masks(x, z, h, ny) {
    const s = z - shore(x);
    const beach = beachAmt(x);
    const sand = clamp((1 - smoothstep(3, 9, h)) * (beach * 0.8 + 0.4) + (h < 1.2 ? 1 : 0), 0, 1);
    const flat = smoothstep(0.7, 0.85, ny);
    const forest = clamp(fbm(nH, x / 500, z / 500, 2) * 1.6 - 0.1, 0, 1) * flat * smoothstep(12, 40, h) * smoothstep(60, 250, s) * 0.8 * (1 - smoothstep(700, 1000, h));
    return [forest, sand, smoothstep(950, 1150, h) * smoothstep(0.6, 0.8, ny), 0];
  }
  function tree(x, z, h, ny, rnd) {
    // palm groves on the low ground behind the beaches
    const bs = z - shore(x), ba = beachAmt(x);
    if (h > 2.5 && h < 30 && bs > 15 && bs < 260 && ny > 0.8 && ba > 0.35 && rnd < 0.4 * ba) return TREE.PALM;
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
    const wx = fbm(nW, x / 6000, z / 6000, 3) * 1200;
    const wz = fbm(nW, x / 6000 + 17, z / 6000 - 5, 3) * 1200;
    const m = ridged(nM, (x + wx) / 17000, (z + wz) / 17000, 4, 2.0, 0.42);
    const massif = fbm(nB, x / 11000, z / 11000, 3) * 0.5 + 0.5;
    let h = Math.pow(m, 1.5) * 4600 * (0.55 + massif * 0.7) + massif * 2200 - 300;
    h += fbm(nD, x / 1600, z / 1600, 5) * 260 * (0.3 + m);
    return h;
  }
  function masks(x, z, h, ny) {
    const flat = smoothstep(0.62, 0.82, ny);
    const forest = clamp(fbm(nF, x / 700, z / 700, 3) * 1.4 + 0.5, 0, 1) * flat * (1 - smoothstep(1400, 2200, h)) * smoothstep(2, 10, h);
    const snowLine = 3000 + nF(x / 900, z / 900) * 400;
    const snow = smoothstep(snowLine - 350, snowLine + 200, h) * smoothstep(0.42, 0.72, ny) + smoothstep(snowLine + 1500, snowLine + 2400, h) * 0.65;
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

// Ray-march the height field towards the sun (soft shadow, 0..1) and around the horizon
// (sky visibility, 0..1). Used for terrain, trees, titans and water.
const AO_DIRS = [0, 1, 2, 3, 4, 5].map((i) => [Math.cos(i * Math.PI / 3), Math.sin(i * Math.PI / 3)]);
export function lightAt(field, sun, x, z, h) {
  const sl = Math.hypot(sun.x, sun.z) || 1;
  const sx = sun.x / sl, sz = sun.z / sl, tanE = sun.y / sl;
  let shadow = 1;
  const y0 = Math.max(h, 0) + 2;
  let d = 12;
  for (let i = 0; i < 15 && shadow > 0.01; i++) {
    const th = field.height(x + sx * d, z + sz * d);
    const rayH = y0 + d * tanE;
    const pen = d * 0.035 + 4;
    shadow = Math.min(shadow, Math.min(1, Math.max(0, (rayH - th) / pen + 0.5)));
    if (rayH > 9000) break;
    d *= 1.62;
  }
  let occ = 0;
  for (const [dx, dz] of AO_DIRS) {
    let m = 0;
    for (const dist of [70, 350, 1500]) {
      const dh = field.height(x + dx * dist, z + dz * dist) - y0;
      if (dh > 0) m = Math.max(m, dh / Math.hypot(dist, dh));
    }
    occ += m;
  }
  return [shadow, 1 - (occ / AO_DIRS.length) * 0.92];
}
