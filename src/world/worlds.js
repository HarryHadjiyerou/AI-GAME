/* ═══════════════════════════════════════════════════════════
   The four worlds.

   Each is a height field, a palette, and a list of things to scatter
   over it. The field is the single source of truth — the terrain mesh,
   the water depth, where trees may grow, where a city block gets built
   and where the bird hits the ground all read the same function, so
   nothing can disagree with anything else.

   Nothing here downloads anything. The first version streamed eight
   megabytes of HDRI and PBR texture per world and then looked grey
   anyway; all of that is now generated from the palette in a few
   milliseconds, which is both faster to start and considerably
   better-looking. See world/palette.js for the reasoning.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { Noise, clamp, smooth } from '../core/noise.js';
import { StyleSystem } from '../core/style.js';
import { Terrain } from './terrain.js';
import { Water } from './water.js';
import { SkyDome, SkyLight, Clouds, environmentFromPalette } from './sky.js';
import { Vegetation, TREE_PRESETS } from './vegetation.js';
import { City } from './city.js';
import { Flock } from './flock.js';
import { Weather } from './weather.js';
import { Motes, Landmarks } from './spectacle.js';
import { FIELDS, FIELD_META } from './fields.js';
import { clonePalette } from './palette.js';

const WORLD_DEFS = {
  forest: {
    palette: 'forest',
    planetRadius: 70000,
    heightRange: [110, 1150],
    terrain: {
      slopeRange: [0.30, 0.60],
      snowRange: [980, 1250],
      shoreRange: [150, 182],
      contour: 0.055, contourSpacing: 44,
      macroScale: 0.0009, macroStrength: 0.20,
    },
    water: { waveScale: 0.16, foamWidth: 1.6, radius: 6000, bands: 4, glitterAmount: 0.7 },
    wind: new THREE.Vector3(3.2, 0, 1.4),
    thermalStrength: 5.2, thermalCeiling: 1500, ridgeStrength: 1.2,
    clouds: { count: 620, altitude: [1050, 1750], tile: 8000, size: [240, 540] },
    sky: { cloudAmount: 0.40, cloudSpeed: 0.0032, stars: 0.35 },
    flock: 'stork',
    style: { bands: 4, bandMix: 0.70, rimStrength: 0.42, ambStrength: 0.60,
             fogHeightBase: 150, fogHeightFalloff: 900, fogHeightMix: 0.62 },
    weather: 'mist',
  },

  coast: {
    palette: 'coast',
    planetRadius: 110000,
    heightRange: [-40, 520],
    terrain: {
      slopeRange: [0.26, 0.55],
      snowRange: [9e5, 9e5 + 1],
      shoreRange: [1.5, 16],
      contour: 0.035, contourSpacing: 36,
      macroScale: 0.0011, macroStrength: 0.16,
    },
    water: { waveScale: 1.15, foamWidth: 3.4, radius: 11000, bands: 5, glitterAmount: 1.5 },
    wind: new THREE.Vector3(6.5, 0, -2.2),
    thermalStrength: 3.4, thermalCeiling: 900, ridgeStrength: 2.2,
    clouds: { count: 760, altitude: [620, 1500], tile: 11000, size: [300, 720] },
    sky: { cloudAmount: 0.34, cloudSpeed: 0.005, stars: 0.1 },
    flock: 'flamingo',
    style: { bands: 4, bandMix: 0.66, rimStrength: 0.55, ambStrength: 0.66,
             fogHeightBase: 0, fogHeightFalloff: 1100, fogHeightMix: 0.5 },
    weather: 'clear',
  },

  mountain: {
    palette: 'mountain',
    planetRadius: 45000,
    heightRange: [1000, 3300],
    terrain: {
      slopeRange: [0.34, 0.64],
      snowRange: [1700, 2200],
      shoreRange: [1182, 1212],
      contour: 0.07, contourSpacing: 70,
      macroScale: 0.0007, macroStrength: 0.18,
    },
    water: { waveScale: 0.12, foamWidth: 2.0, radius: 7000, bands: 4, glitterAmount: 1.0 },
    wind: new THREE.Vector3(4.0, 0, 3.2),
    thermalStrength: 8.0, thermalCeiling: 3600, ridgeStrength: 2.0,
    clouds: { count: 880, altitude: [1900, 2500], tile: 13000, size: [420, 980] },
    sky: { cloudAmount: 0.30, cloudSpeed: 0.002, stars: 0.85 },
    flock: 'stork',
    style: { bands: 5, bandMix: 0.74, rimStrength: 0.62, ambStrength: 0.70,
             fogHeightBase: 1100, fogHeightFalloff: 1800, fogHeightMix: 0.45 },
    weather: 'clear',
  },

  city: {
    palette: 'city',
    planetRadius: 75000,
    heightRange: [0, 300],
    terrain: {
      slopeRange: [0.38, 0.70],
      snowRange: [9e5, 9e5 + 1],
      shoreRange: [17, 32],
      contour: 0.02, contourSpacing: 30,
      macroScale: 0.0014, macroStrength: 0.12,
    },
    water: { waveScale: 0.10, foamWidth: 1.2, radius: 5000, bands: 4, glitterAmount: 1.8 },
    wind: new THREE.Vector3(2.4, 0, 1.0),
    thermalStrength: 3.6, thermalCeiling: 700, ridgeStrength: 0.6,
    clouds: { count: 420, altitude: [700, 1250], tile: 7000, size: [240, 560] },
    sky: { cloudAmount: 0.45, cloudSpeed: 0.004, stars: 0.95 },
    flock: 'parrot',
    style: { bands: 3, bandMix: 0.60, rimStrength: 0.70, ambStrength: 0.55,
             fogHeightBase: 30, fogHeightFalloff: 600, fogHeightMix: 0.55 },
    weather: 'clear',
  },
};

/* ═══════════════════════════════════════════════════════════ */

export async function buildWorld(name, ctx) {
  const def = WORLD_DEFS[name];
  if (!def) throw new Error(`unknown world "${name}"`);
  const { scene, renderer, assets, quality, progress } = ctx;

  const meta = FIELD_META[name];
  const height = FIELDS[name]();
  const waterLevel = meta.waterLevel;
  const palette = clonePalette(def.palette);
  const noise = new Noise(name.length * 991 + 7);

  const step = (p, label) => progress?.(p, label);

  /* ── light and air ───────────────────────────────────── */
  step(0.08, 'mixing the palette');

  const style = new StyleSystem(palette, {
    planetRadius: def.planetRadius,
    ...def.style,
  });

  const sky = new SkyDome(palette, def.sky);
  scene.add(sky.mesh);
  scene.background = null;

  // Image-based light generated from the same palette, so a wing never
  // disagrees with the sky behind it.
  scene.environment = environmentFromPalette(renderer, palette);

  const light = new SkyLight(scene, style, palette, {
    sunIntensity: 3.0, hemiIntensity: 0.5, shadows: false,
  });

  step(0.22, 'raising the ground');

  /* ── ground and water ────────────────────────────────── */

  const terrain = new Terrain({
    style, height, palette,
    worldSize: 65536,
    maxDepth: name === 'city' ? 10 : 9,
    lodBias: quality.terrainLod ?? 3.0,
    budget: quality.terrainBudget ?? 2,
    heightRange: def.heightRange,
    ...def.terrain,
  });
  scene.add(terrain.group);

  const water = new Water(style, {
    height, level: waterLevel, palette,
    rings: quality.waterRings ?? 96,
    segments: quality.waterSegments ?? 160,
    ...def.water,
  });
  scene.add(water.mesh);

  step(0.42, 'hanging the clouds');

  const clouds = new Clouds(style, assets.puff(), palette, {
    seed: name.length * 31 + 5,
    count: Math.round((def.clouds.count ?? 700) * (quality.cloudScale ?? 1)),
    drift: [def.wind.x * 0.8, 0, def.wind.z * 0.8],
    ...def.clouds,
  });
  scene.add(clouds.mesh);

  /* ── dressing ────────────────────────────────────────── */
  step(0.58, 'planting');

  const vegScale = quality.vegScale ?? 1;
  let vegetation = null, city = null;

  if (name === 'forest') {
    const density = (x, z) => {
      const h = height(x, z);
      const alt = 1 - smooth(880, 1180, h);
      const wet = smooth(waterLevel + 2, waterLevel + 26, h);
      const patch = 0.42 + 0.58 * (noise.fbm(x * 0.00055, z * 0.00055, 3) * 0.5 + 0.5);
      return clamp(alt * wet * patch, 0, 1);
    };
    vegetation = new Vegetation(style, {
      height, density, palette,
      tile: 460, radius: Math.round(2600 * vegScale), perTile: Math.round(170 * vegScale),
      scaleRange: [0.7, 1.6], wind: 0.5, budget: 2, seed: 4242,
      prototypes: [
        { ...TREE_PRESETS.redwood, leafLow: '#12301f', leafHigh: '#2e5a33' },
        { ...TREE_PRESETS.pine, leafLow: '#183a24', leafHigh: '#3a6b3a' },
        { ...TREE_PRESETS.fir, leafLow: '#14352a', leafHigh: '#356045' },
        { ...TREE_PRESETS.broadleaf, leafLow: '#3d6b2c', leafHigh: '#77913f' },
      ],
    });
    scene.add(vegetation.group);
  }

  if (name === 'coast') {
    const density = (x, z) => {
      const h = height(x, z);
      const above = smooth(22, 64, h);
      const notTooHigh = 1 - smooth(320, 470, h);
      const patch = 0.3 + 0.7 * (noise.fbm(x * 0.0007, z * 0.0007, 3) * 0.5 + 0.5);
      return clamp(above * notTooHigh * patch, 0, 1) * 0.8;
    };
    vegetation = new Vegetation(style, {
      height, density, palette,
      tile: 460, radius: Math.round(2100 * vegScale), perTile: Math.round(110 * vegScale),
      scaleRange: [0.6, 1.3], wind: 0.95, budget: 2, seed: 515,
      prototypes: [
        { ...TREE_PRESETS.scrub, leafLow: '#4f5f2e', leafHigh: '#8a9350' },
        { ...TREE_PRESETS.palm, leafLow: '#3f6b2c', leafHigh: '#7fa03e' },
        { ...TREE_PRESETS.broadleaf, leafLow: '#41692f', leafHigh: '#86994a' },
      ],
    });
    scene.add(vegetation.group);
  }

  if (name === 'mountain') {
    const density = (x, z) => {
      // A treeline, which is the clearest possible read on your own altitude.
      const h = height(x, z);
      const band = smooth(1200, 1400, h) * (1 - smooth(1820, 2050, h));
      const patch = 0.35 + 0.65 * (noise.fbm(x * 0.0006, z * 0.0006, 3) * 0.5 + 0.5);
      return clamp(band * patch, 0, 1) * 0.85;
    };
    vegetation = new Vegetation(style, {
      height, density, palette,
      tile: 460, radius: Math.round(2300 * vegScale), perTile: Math.round(130 * vegScale),
      scaleRange: [0.5, 1.1], wind: 0.7, budget: 2, seed: 9001,
      prototypes: [
        { ...TREE_PRESETS.fir, leafLow: '#22314a', leafHigh: '#41567a' },
        { ...TREE_PRESETS.pine, leafLow: '#1d2b42', leafHigh: '#3a4d70' },
        { ...TREE_PRESETS.scrub, leafLow: '#3d4560', leafHigh: '#6b6f8c' },
      ],
    });
    scene.add(vegetation.group);
  }

  if (name === 'city') {
    const riverDist = height.river;
    const parkNoise = new Noise(1234);
    const isWater = (x, z) => riverDist(x, z) < 150 || height(x, z) < waterLevel + 3;
    const isPark = (x, z) => parkNoise.fbm(x * 0.0009, z * 0.0009, 3) > 0.34;
    const skyline = (x, z) => {
      const d = Math.hypot(x - 200, z - 150);
      const core = 1 - smooth(300, 2600, d);
      const d2 = Math.hypot(x + 2100, z - 1800);
      const second = (1 - smooth(200, 1500, d2)) * 0.7;
      const grain = parkNoise.fbm(x * 0.0006 + 11, z * 0.0006 - 4, 3) * 0.5 + 0.5;
      return clamp(Math.max(core, second) * 0.85 + grain * 0.35, 0, 1);
    };

    city = new City(style, {
      height, isWater, isPark, skyline, palette,
      block: 104, street: 28, tileBlocks: 4,
      radius: Math.round(1700 * (quality.cityScale ?? 1)),
      maxHeight: 240, seed: 9090, budget: 1,
    });
    scene.add(city.group);
    city.initTraffic(quality.traffic ?? 150, { range: 460 });

    vegetation = new Vegetation(style, {
      height, palette,
      density: (x, z) => (isPark(x, z) && !isWater(x, z) ? 0.95 : 0.03),
      tile: 320, radius: Math.round(1400 * vegScale), perTile: Math.round(80 * vegScale),
      scaleRange: [0.8, 1.3], wind: 0.4, budget: 2, seed: 777,
      prototypes: [
        { ...TREE_PRESETS.cityTree, leafLow: '#20331f', leafHigh: '#3d5a2c' },
        { ...TREE_PRESETS.broadleaf, leafLow: '#1c2d1c', leafHigh: '#375227' },
      ],
    });
    scene.add(vegetation.group);
  }

  step(0.76, 'letting the wind in');

  /* ── atmosphere, life and landmarks ──────────────────── */

  const weather = new Weather(style, sky, palette, {
    preset: def.weather,
    wind: def.wind,
    quality,
  });
  scene.add(weather.group);

  const motes = new Motes(style, palette, {
    count: quality.motes ?? 900,
    thermalStrength: def.thermalStrength,
    seed: name.length * 17,
  });
  scene.add(motes.group);

  const landmarks = new Landmarks(style, palette, {
    world: name, height, waterLevel, seed: 3300 + name.length,
    quality,
  });
  scene.add(landmarks.group);

  step(0.9, 'calling the flock');

  const flockModel = await assets.birdModel(def.flock);
  const flock = new Flock(style, flockModel, {
    height, count: quality.flock ?? 10,
    altitude: name === 'mountain' ? [200, 900] : (name === 'city' ? [40, 220] : [80, 400]),
    radius: 1100, seed: 808, scale: name === 'mountain' ? 1.6 : 1,
    body: palette.shadow.clone().lerp(new THREE.Color('#000000'), 0.35),
  });
  scene.add(flock.group);

  /* ── the interface the game talks to ─────────────────── */

  const world = {
    name, height, palette, style, waterLevel,
    wind: def.wind,
    thermals: true,
    thermalStrength: def.thermalStrength,
    thermalCeiling: def.thermalCeiling,
    ridgeStrength: def.ridgeStrength,
    spawn: meta.spawn,
    planetRadius: def.planetRadius,
    terrain, water, clouds, sky, light, vegetation, city, flock, weather, motes, landmarks,

    update(camPos, dt, flight) {
      style.update(ctx.camera, dt);
      sky.update(dt);
      terrain.update(camPos, dt);
      water.update(camPos, dt);
      clouds.update(dt);
      light.update(camPos);
      vegetation?.update(camPos, dt);
      city?.update(camPos, dt);
      flock.update(camPos, dt);
      weather.update(camPos, dt, flight);
      motes.update(camPos, dt, flight);
      landmarks.update(camPos, dt);

      // Weather drives the wind the flight model feels, and the wind drives
      // how hard the trees are moving — one number, everywhere.
      this.wind.copy(weather.wind);
      vegetation?.setWind(weather.wind, 0.35 + weather.intensity * 1.3,
                          0.2 + weather.gustiness * 0.9);
      water.setChoppiness((def.water.waveScale ?? 1) * (0.7 + weather.intensity * 1.1));
    },

    stats() {
      return {
        patches: terrain.stats.patches,
        trees: vegetation?.stats.trees ?? 0,
        buildings: city?.stats.buildings ?? 0,
        weather: weather.label,
      };
    },

    dispose() {
      scene.remove(terrain.group, water.mesh, clouds.mesh, flock.group,
                   sky.mesh, weather.group, motes.group, landmarks.group);
      if (vegetation) scene.remove(vegetation.group);
      if (city) scene.remove(city.group);
      terrain.dispose(); water.dispose(); clouds.dispose(); sky.dispose();
      vegetation?.dispose(); city?.dispose(); flock.dispose(); light.dispose();
      weather.dispose(); motes.dispose(); landmarks.dispose();
      style.dispose();
      scene.environment?.dispose?.();
      scene.environment = null;
      scene.background = null;
    },
  };

  step(1, 'go');
  return world;
}

export { WORLD_DEFS };
