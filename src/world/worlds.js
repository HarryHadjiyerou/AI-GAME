/* ═══════════════════════════════════════════════════════════
   The four worlds.

   Each one is a height field plus a dressing. The field is the single
   source of truth — the terrain mesh, the water depth, where trees are
   allowed to grow, where a city block gets built and where the bird
   crashes all read the same function, so nothing can disagree with
   anything else.

   Fields are kept to five or six octaves. They are evaluated tens of
   thousands of times a second and a seventh octave buys detail nobody
   flying at 60 km/h will ever see.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { Noise, clamp, smooth } from '../core/noise.js';
import { Terrain } from './terrain.js';
import { FIELDS, FIELD_META } from './fields.js';
import { Water } from './water.js';
import { Clouds, SkyLight } from './sky.js';
import { Vegetation, TREE_PRESETS } from './vegetation.js';
import { City } from './city.js';
import { Flock } from './flock.js';
import { HDRI, TEX } from '../core/assets.js';

/* ═══════════════════ world definitions ═══════════════════ */

const WORLD_DEFS = {
  forest: {
    hdri: HDRI.forest,
    planetRadius: 70000,    // horizon ~6.5 km at 300 m
    sunDir: new THREE.Vector3(0.36, 0.42, 0.83),
    sunColor: '#ffeccf', sunIntensity: 3.5, hemiIntensity: 0.26,
    skyColor: '#b9d0e4', groundColor: '#3d4230',
    fog: {
      fogColor: '#b9c9d2', fogSunColor: '#ffdcae',
      fogDensity: 1 / 5000, fogPower: 1.5,
      fogHeightBase: 150, fogHeightFalloff: 700, fogHeightMix: 0.85, fogMax: 0.86,
    },
    water: { deep: '#1b3d33', shallow: '#4f7f63', foam: '#e6f0e8', foamWidth: 1.6, waveScale: 0.16, radius: 6000 },
    wind: new THREE.Vector3(3.2, 0, 1.4),
    thermalStrength: 5.0, thermalCeiling: 1500, ridgeStrength: 1.15,
    clouds: { count: 760, altitude: [1050, 1750], tile: 8000, size: [230, 520], shade: '#93a6bd', opacity: 0.95 },
    flock: 'stork',
    surfaces: [
      [TEX.forestFloor, 0.055, ['#3c4a2e', '#6e7a52']],
      [TEX.rock,        0.035, ['#6b6257', '#8e857a']],
      [TEX.grassRock,   0.030, ['#5b6b46', '#8f9a72']],
      [TEX.mudLeaves,   0.090, ['#4a3d2c', '#7a6a52']],
    ],
    splat: {
      layerScale: [0.055, 0.035, 0.030, 0.090],
      slopeRange: [0.30, 0.60], snowRange: [1500, 1900], shoreRange: [152, 176],
      tints: ['#8a9c72', '#9a9088', '#84956a', '#a09073'],
      macroScale: 0.0009, macroStrength: 0.26,
    },
  },

  coast: {
    hdri: HDRI.coast,
    planetRadius: 110000,   // horizon ~5.1 km at 120 m
    sunDir: new THREE.Vector3(-0.62, 0.28, 0.74),
    sunColor: '#ffd2a1', sunIntensity: 3.6, hemiIntensity: 0.30,
    skyColor: '#a8c6e2', groundColor: '#514a3c',
    fog: {
      fogColor: '#c3cfd8', fogSunColor: '#ffc98c',
      fogDensity: 1 / 6000, fogPower: 1.5,
      fogHeightBase: 0, fogHeightFalloff: 1000, fogHeightMix: 0.65, fogMax: 0.84,
    },
    water: { deep: '#06283d', shallow: '#3f97a3', foam: '#f2fbfd', foamWidth: 3.4, waveScale: 1.15, radius: 11000, roughness: 0.06 },
    wind: new THREE.Vector3(6.5, 0, -2.2),
    thermalStrength: 3.2, thermalCeiling: 900, ridgeStrength: 2.1,
    clouds: { count: 900, altitude: [620, 1500], tile: 11000, size: [300, 720], shade: '#7e8ea8', lit: '#fff3e2' },
    flock: 'flamingo',
    surfaces: [
      [TEX.sand,      0.075, ['#c9b38c', '#e4d6b6']],
      [TEX.rock,      0.030, ['#7a7269', '#a09789']],
      [TEX.grassRock, 0.028, ['#57683f', '#8a9468']],
      [TEX.sand,      0.130, ['#d6c19a', '#efe3c6']],
    ],
    splat: {
      layerScale: [0.075, 0.030, 0.028, 0.130],
      slopeRange: [0.26, 0.55], snowRange: [2400, 2800], shoreRange: [2, 17],
      tints: ['#7f9057', '#a49a8e', '#7d8f5e', '#e0cda4'],
      macroScale: 0.0011, macroStrength: 0.20,
    },
  },

  mountain: {
    hdri: HDRI.mountain,
    planetRadius: 45000,    // horizon ~15 km at 2.5 km
    sunDir: new THREE.Vector3(0.52, 0.50, -0.69),
    sunColor: '#fff4e2', sunIntensity: 4.0, hemiIntensity: 0.34,
    skyColor: '#9dc0e8', groundColor: '#6c6f74',
    fog: {
      fogColor: '#cdd9e6', fogSunColor: '#ffe7c4',
      fogDensity: 1 / 13000, fogPower: 1.5,
      fogHeightBase: 1100, fogHeightFalloff: 1700, fogHeightMix: 0.75, fogMax: 0.84,
    },
    water: { deep: '#123a52', shallow: '#5aa8bd', foam: '#f4fbff', foamWidth: 2.0, waveScale: 0.12, radius: 7000, roughness: 0.045 },
    wind: new THREE.Vector3(4.0, 0, 3.2),
    thermalStrength: 7.5, thermalCeiling: 3400, ridgeStrength: 1.9,
    clouds: { count: 1050, altitude: [1900, 2700], tile: 13000, size: [420, 980], shade: '#8a9ab4', opacity: 1.0 },
    flock: 'stork',
    surfaces: [
      [TEX.rocksGround, 0.030, ['#5f6b4c', '#8d9472']],
      [TEX.rock,  0.026, ['#6e6a64', '#98928a']],
      [TEX.snow,  0.040, ['#dfe8f2', '#ffffff']],
      [TEX.rock,  0.070, ['#5d5a55', '#857f77']],
    ],
    splat: {
      layerScale: [0.030, 0.026, 0.040, 0.070],
      slopeRange: [0.34, 0.66], snowRange: [1750, 2350], shoreRange: [1184, 1215],
      tints: ['#8c9472', '#9c968e', '#f2f7ff', '#8a8680'],
      macroScale: 0.0007, macroStrength: 0.22,
    },
  },

  city: {
    hdri: HDRI.city,
    planetRadius: 75000,    // horizon ~5.0 km at 165 m
    sunDir: new THREE.Vector3(-0.44, 0.36, 0.82),
    sunColor: '#ffe2bd', sunIntensity: 3.3, hemiIntensity: 0.30,
    skyColor: '#b6c7dc', groundColor: '#55504a',
    fog: {
      fogColor: '#c6c8cc', fogSunColor: '#ffd9a6',
      fogDensity: 1 / 3600, fogPower: 1.45,
      fogHeightBase: 30, fogHeightFalloff: 500, fogHeightMix: 0.8, fogMax: 0.88,
    },
    water: { deep: '#1d2a2c', shallow: '#41585a', foam: '#dfe6e4', foamWidth: 1.2, waveScale: 0.10, radius: 5000, roughness: 0.10 },
    wind: new THREE.Vector3(2.4, 0, 1.0),
    thermalStrength: 3.4, thermalCeiling: 620, ridgeStrength: 0.5,
    clouds: { count: 520, altitude: [700, 1250], tile: 7000, size: [240, 560], shade: '#9aa2ae' },
    flock: 'parrot',
    surfaces: [
      [TEX.asphalt,   0.060, ['#3f4145', '#5d6066']],
      [TEX.concrete,  0.040, ['#6c6a67', '#93908c']],
      [TEX.grassRock, 0.035, ['#4d6b3c', '#7f9464']],
      [TEX.sand,      0.090, ['#9a8d73', '#c2b69a']],
    ],
    splat: {
      layerScale: [0.060, 0.040, 0.035, 0.090],
      slopeRange: [0.38, 0.72], snowRange: [2600, 3000], shoreRange: [18, 34],
      tints: ['#6f7a63', '#9a968f', '#77905c', '#a99c82'],
      macroScale: 0.0014, macroStrength: 0.18,
    },
  },
};

/* ═══════════════════ construction ════════════════════════ */

/**
 * Build a world. Loads what it needs, reporting progress, and returns a live
 * object the game loop drives.
 */
export async function buildWorld(name, ctx) {
  const def = WORLD_DEFS[name];
  if (!def) throw new Error(`unknown world "${name}"`);
  const { scene, atmosphere, assets, quality } = ctx;

  const meta = FIELD_META[name];
  const height = FIELDS[name]();
  const waterLevel = meta.waterLevel;
  const noise = new Noise(name.length * 991 + 7);

  // 1 sky + 4 surfaces + 1 bark + 1 flock model
  assets.expect(7);

  const env = await assets.environment(def.hdri);
  scene.background = env.background;
  scene.environment = env.env;
  scene.backgroundIntensity = def.backgroundIntensity ?? 1;

  atmosphere.configure({ planetRadius: def.planetRadius, sunDir: def.sunDir, ...def.fog });

  const surfaces = [];
  for (const [slug, repeat, fallback] of def.surfaces) {
    surfaces.push(await assets.surface(slug, { repeat: 1, fallback }));
    void repeat;
  }
  const bark = await assets.surface(TEX.bark, { fallback: ['#5a4636', '#8a7358'] });

  const light = new SkyLight(scene, atmosphere, {
    sunDir: def.sunDir, sunColor: def.sunColor, sunIntensity: def.sunIntensity,
    skyColor: def.skyColor, groundColor: def.groundColor, hemiIntensity: def.hemiIntensity,
    shadows: quality.shadows, shadowSize: quality.shadowSize,
    shadowRange: name === 'city' ? 320 : 260,
  });

  const terrain = new Terrain(atmosphere, {
    height,
    // 65 km across. The finest patch is still 256 m — the extra depth buys
    // range, not detail — so a bird that flies in a straight line for ten
    // minutes does not reach the edge of the map.
    worldSize: def.worldSize ?? 65536,
    maxDepth: name === 'city' ? 10 : 9,
    lodBias: quality.scale < 0.8 ? 2.2 : 3.0,
    budget: quality.scale < 0.8 ? 1 : 2,
    textures: { base: surfaces[0], slope: surfaces[1], alt: surfaces[2], shore: surfaces[3] },
    ...def.splat,
  });
  scene.add(terrain.group);

  const water = new Water(atmosphere, {
    height, level: waterLevel,
    rings: quality.scale < 0.8 ? 64 : 96,
    segments: quality.scale < 0.8 ? 112 : 160,
    ...def.water,
  });
  scene.add(water.mesh);

  const clouds = new Clouds(atmosphere, assets.puff(), {
    seed: name.length * 31 + 5,
    count: Math.round((def.clouds.count ?? 800) * (quality.scale < 0.8 ? 0.5 : 1)),
    drift: [def.wind.x * 0.8, 0, def.wind.z * 0.8],
    ...def.clouds,
  });
  scene.add(clouds.mesh);

  /* ── dressing, per world ─────────────────────────────── */

  let vegetation = null, city = null;
  const vegScale = quality.scale < 0.8 ? 0.55 : 1;

  if (name === 'forest') {
    // Trees like the valley sides, not the river and not the bare summits.
    const density = (x, z) => {
      const h = height(x, z);
      const alt = 1 - smooth(900, 1500, h);
      const wet = smooth(waterLevel + 2, waterLevel + 26, h);
      const patch = 0.45 + 0.55 * (noise.fbm(x * 0.00055, z * 0.00055, 3) * 0.5 + 0.5);
      return clamp(alt * wet * patch, 0, 1);
    };
    vegetation = new Vegetation(atmosphere, assets, {
      height, density, barkTexture: bark,
      tile: 460, radius: Math.round(2400 * vegScale), perTile: Math.round(150 * vegScale),
      scaleRange: [0.75, 1.55], wind: 0.5, budget: 2, seed: 4242,
      prototypes: [TREE_PRESETS.redwood, TREE_PRESETS.pine, TREE_PRESETS.pine, TREE_PRESETS.broadleaf],
    });
    scene.add(vegetation.group);
  }

  if (name === 'coast') {
    const density = (x, z) => {
      const h = height(x, z);
      const above = smooth(24, 70, h);
      const notTooHigh = 1 - smooth(280, 420, h);
      const patch = 0.3 + 0.7 * (noise.fbm(x * 0.0007, z * 0.0007, 3) * 0.5 + 0.5);
      return clamp(above * notTooHigh * patch, 0, 1) * 0.75;
    };
    vegetation = new Vegetation(atmosphere, assets, {
      height, density, barkTexture: bark,
      tile: 460, radius: Math.round(1900 * vegScale), perTile: Math.round(80 * vegScale),
      scaleRange: [0.6, 1.2], wind: 0.95, budget: 2, seed: 515,
      prototypes: [TREE_PRESETS.scrub, TREE_PRESETS.scrub, TREE_PRESETS.palm, TREE_PRESETS.broadleaf],
    });
    scene.add(vegetation.group);
  }

  if (name === 'mountain') {
    const density = (x, z) => {
      const h = height(x, z);
      // A treeline, which is the clearest possible read on your own altitude.
      const band = smooth(1200, 1400, h) * (1 - smooth(1900, 2150, h));
      const patch = 0.35 + 0.65 * (noise.fbm(x * 0.0006, z * 0.0006, 3) * 0.5 + 0.5);
      return clamp(band * patch, 0, 1) * 0.8;
    };
    vegetation = new Vegetation(atmosphere, assets, {
      height, density, barkTexture: bark,
      tile: 460, radius: Math.round(2100 * vegScale), perTile: Math.round(90 * vegScale),
      scaleRange: [0.55, 1.15], wind: 0.7, budget: 2, seed: 9001,
      prototypes: [TREE_PRESETS.pine, TREE_PRESETS.pine, TREE_PRESETS.scrub],
    });
    scene.add(vegetation.group);
  }

  if (name === 'city') {
    const riverDist = height.river;
    const parkNoise = new Noise(1234);
    const isWater = (x, z) => riverDist(x, z) < 150 || height(x, z) < waterLevel + 3;
    const isPark = (x, z) => parkNoise.fbm(x * 0.0009, z * 0.0009, 3) > 0.34;
    const skyline = (x, z) => {
      // A downtown core, falling away to low-rise, with a second cluster.
      const d = Math.hypot(x - 200, z - 150);
      const core = 1 - smooth(300, 2600, d);
      const d2 = Math.hypot(x + 2100, z - 1800);
      const second = (1 - smooth(200, 1500, d2)) * 0.7;
      const grain = parkNoise.fbm(x * 0.0006 + 11, z * 0.0006 - 4, 3) * 0.5 + 0.5;
      return clamp(Math.max(core, second) * 0.85 + grain * 0.35, 0, 1);
    };

    city = new City(atmosphere, assets, {
      height, isWater, isPark, skyline,
      block: 104, street: 28, tileBlocks: 4,
      radius: Math.round(1450 * (quality.scale < 0.8 ? 0.7 : 1)),
      maxHeight: 230, night: 0.30, seed: 9090,
      concreteTexture: surfaces[1], asphaltTexture: surfaces[0],
      budget: 1,
    });
    scene.add(city.group);
    city.initTraffic(quality.scale < 0.8 ? 70 : 150, { range: 420 });

    // Street trees only in the parks.
    vegetation = new Vegetation(atmosphere, assets, {
      height, barkTexture: bark,
      density: (x, z) => (isPark(x, z) && !isWater(x, z) ? 0.9 : 0.04),
      tile: 300, radius: Math.round(1200 * vegScale), perTile: Math.round(60 * vegScale),
      scaleRange: [0.8, 1.25], wind: 0.4, budget: 2, seed: 777,
      prototypes: [TREE_PRESETS.cityTree, TREE_PRESETS.broadleaf],
    });
    scene.add(vegetation.group);
  }

  const flockModel = await assets.birdModel(def.flock);
  const flock = new Flock(atmosphere, flockModel, {
    height, count: quality.scale < 0.8 ? 5 : 10,
    altitude: name === 'mountain' ? [200, 900] : (name === 'city' ? [40, 220] : [80, 400]),
    radius: 1100, seed: 808, scale: name === 'mountain' ? 1.6 : 1,
  });
  scene.add(flock.group);

  /* ── the interface the game talks to ─────────────────── */

  const world = {
    name,
    height,
    waterLevel,
    wind: def.wind,
    thermals: true,
    thermalStrength: def.thermalStrength,
    thermalCeiling: def.thermalCeiling,
    ridgeStrength: def.ridgeStrength,
    spawn: meta.spawn,
    planetRadius: def.planetRadius,
    terrain, water, clouds, light, vegetation, city, flock,
    env,

    update(camPos, dt) {
      terrain.update(camPos, dt);
      water.update(camPos, dt);
      clouds.update(dt);
      light.update(camPos);
      vegetation?.update(camPos, dt);
      city?.update(camPos, dt);
      flock.update(camPos, dt);
    },

    stats() {
      return {
        patches: terrain.stats.patches,
        trees: vegetation?.stats.trees ?? 0,
        buildings: city?.stats.buildings ?? 0,
      };
    },

    dispose() {
      scene.remove(terrain.group, water.mesh, clouds.mesh, flock.group);
      if (vegetation) scene.remove(vegetation.group);
      if (city) scene.remove(city.group);
      terrain.dispose(); water.dispose(); clouds.dispose();
      vegetation?.dispose(); city?.dispose(); flock.dispose(); light.dispose();
      scene.background = null;
      scene.environment = null;
    },
  };

  return world;
}

export { WORLD_DEFS };
