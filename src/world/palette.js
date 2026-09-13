/* ═══════════════════════════════════════════════════════════
   Palettes.

   The first pass at this game was photoreal, and photoreal at a
   distance is grey. Real air is full of dust and water and it eats
   colour; an HDRI photographed at midday hands you a washed-out
   olive hillside under a white sky, and no amount of tuning makes
   that exciting to fly over.

   So: none of this is lit by a photograph any more. Every world is a
   hand-picked set of colours and a sun placed where it flatters them,
   and distance dissolves towards a *colour* rather than towards grey.
   That last part is the single biggest change — a ridge eight
   kilometres away going violet is the oldest trick in landscape
   painting and it does more for depth than any amount of fog density.

   Each world is pinned to the hour that suits it rather than running a
   full day cycle: the forest at first light, the coast at golden hour,
   the mountains at alpenglow, the city at dusk with the lights coming
   on. A world that is beautiful for twenty minutes of its cycle and
   drab for the rest is a worse world than one that is always its best
   hour.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';

const C = (hex) => new THREE.Color(hex);

/**
 * @typedef {object} Palette
 * @property {THREE.Color} zenith      sky straight up
 * @property {THREE.Color} sky         sky at mid-height
 * @property {THREE.Color} horizon     the band at eye level
 * @property {THREE.Color} haze        what distance dissolves into
 * @property {THREE.Color} sunColor
 * @property {THREE.Color} sunGlow     the halo around it
 * @property {THREE.Vector3} sunDir
 * @property {THREE.Color[]} ground    the terrain ramp, low to high
 * @property {THREE.Color} shadow      colour of unlit faces — never grey
 * @property {THREE.Color} rim         light wrapping the silhouette
 * @property {THREE.Color} waterDeep
 * @property {THREE.Color} waterShallow
 * @property {THREE.Color} foam
 * @property {THREE.Color} cloudLit
 * @property {THREE.Color} cloudShade
 */

export const PALETTES = {
  /* ── first light in a redwood valley ────────────────────
     Cold blue in the shadows, low amber sun cutting across the
     ridgelines, mist pooling in the bottom of the valley. */
  forest: {
    name: 'FIRST LIGHT',
    zenith: C('#1b3a6b'),
    sky: C('#4d7fb8'),
    horizon: C('#ffc78a'),
    haze: C('#c98f8a'),
    sunDir: new THREE.Vector3(0.42, 0.16, 0.89).normalize(),
    sunColor: C('#ffd9a0'),
    sunGlow: C('#ff9b5e'),
    sunSize: 0.028,
    ground: [C('#1d3a2e'), C('#2f5c39'), C('#5c7a3a'), C('#9aa367')],
    rock: C('#6b5f63'),
    snow: C('#e8eef6'),
    shadow: C('#16304f'),
    rim: C('#ffb877'),
    waterDeep: C('#0e2f42'),
    waterShallow: C('#3d7f7a'),
    foam: C('#e8f6f2'),
    cloudLit: C('#ffd9b0'),
    cloudShade: C('#5a6b96'),
    fogDensity: 1 / 4200,
    fogPower: 1.45,
    exposure: 1.08,
    bloom: 0.42,
    grade: { lift: C('#0d1626'), gain: C('#fff0dd'), saturation: 1.18, contrast: 1.06 },
  },

  /* ── golden hour over a turquoise sea ───────────────────
     The loud one. Huge low sun, water the colour of a swimming
     pool, cliffs going coral. */
  coast: {
    name: 'GOLDEN HOUR',
    zenith: C('#12518f'),
    sky: C('#4fa3d1'),
    horizon: C('#ffcf7d'),
    haze: C('#ffa46b'),
    sunDir: new THREE.Vector3(-0.86, 0.10, 0.50).normalize(),
    sunColor: C('#fff1c4'),
    sunGlow: C('#ff7b42'),
    sunSize: 0.045,
    ground: [C('#e8c98f'), C('#c8a86a'), C('#7d8a4e'), C('#4f6b3f')],
    rock: C('#8a6a5e'),
    snow: C('#fff2e2'),
    shadow: C('#2a4a72'),
    rim: C('#ffca73'),
    waterDeep: C('#06496e'),
    waterShallow: C('#31c5c0'),
    foam: C('#fdfefe'),
    cloudLit: C('#ffd0a0'),
    cloudShade: C('#7e76a8'),
    fogDensity: 1 / 6500,
    fogPower: 1.5,
    exposure: 1.12,
    bloom: 0.60,
    grade: { lift: C('#101c2e'), gain: C('#fff3e4'), saturation: 1.28, contrast: 1.08 },
  },

  /* ── alpenglow, above the clouds ────────────────────────
     The quiet one. Violet snow, deep blue shadow, a cloud deck
     underneath and nothing above but colour. */
  mountain: {
    name: 'ALPENGLOW',
    zenith: C('#0a1a4a'),
    sky: C('#3a5fa8'),
    horizon: C('#ffb0a0'),
    haze: C('#b98fc4'),
    sunDir: new THREE.Vector3(0.72, 0.09, -0.69).normalize(),
    sunColor: C('#ffe0c0'),
    sunGlow: C('#ff6f8c'),
    sunSize: 0.034,
    ground: [C('#3c4a63'), C('#5b6480'), C('#9d93ad'), C('#d8cfe0')],
    rock: C('#5a5570'),
    snow: C('#fbe9f2'),
    shadow: C('#1a2456'),
    rim: C('#ffa8bb'),
    waterDeep: C('#132a56'),
    waterShallow: C('#4fa8c8'),
    foam: C('#f4f0ff'),
    cloudLit: C('#ffc6cd'),
    cloudShade: C('#6a6698'),
    fogDensity: 1 / 9000,
    fogPower: 1.5,
    exposure: 1.05,
    bloom: 0.55,
    grade: { lift: C('#131a3a'), gain: C('#fff0f2'), saturation: 1.22, contrast: 1.04 },
  },

  /* ── dusk, lights coming on ─────────────────────────────
     Sodium orange against a deep blue that has not gone dark
     yet — the ten minutes when a city looks best. */
  city: {
    name: 'BLUE HOUR',
    zenith: C('#0c1740'),
    sky: C('#2a4a86'),
    horizon: C('#ff9d5c'),
    haze: C('#8f6f9e'),
    sunDir: new THREE.Vector3(-0.60, 0.07, 0.80).normalize(),
    sunColor: C('#ffd39a'),
    sunGlow: C('#ff5f3c'),
    sunSize: 0.038,
    ground: [C('#2a2f3e'), C('#3b4152'), C('#4d5464'), C('#666d7d')],
    rock: C('#454b5c'),
    snow: C('#dfe6f2'),
    shadow: C('#111a3c'),
    rim: C('#ffab6e'),
    waterDeep: C('#0a1428'),
    waterShallow: C('#26506b'),
    foam: C('#cfe0ea'),
    cloudLit: C('#ffb37e'),
    cloudShade: C('#3f4472'),
    fogDensity: 1 / 3400,
    fogPower: 1.4,
    exposure: 0.98,
    bloom: 0.40,
    grade: { lift: C('#0a1030'), gain: C('#ffeede'), saturation: 1.20, contrast: 1.12 },
    night: 0.52,            // how many windows are lit
  },
};

/** Deep-copy a palette so a world can tint it without touching the source. */
export function clonePalette(name) {
  const src = PALETTES[name];
  if (!src) throw new Error(`unknown palette "${name}"`);
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (v instanceof THREE.Color) out[k] = v.clone();
    else if (v instanceof THREE.Vector3) out[k] = v.clone();
    else if (Array.isArray(v)) out[k] = v.map((c) => (c instanceof THREE.Color ? c.clone() : c));
    else if (v && typeof v === 'object') {
      out[k] = {};
      for (const [k2, v2] of Object.entries(v)) {
        out[k][k2] = v2 instanceof THREE.Color ? v2.clone() : v2;
      }
    } else out[k] = v;
  }
  return out;
}
