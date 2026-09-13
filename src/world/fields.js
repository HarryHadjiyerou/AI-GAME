/* ═══════════════════════════════════════════════════════════
   Height fields.

   Each world is, at bottom, one function of (x, z). The terrain mesh,
   the water depth, where a tree is allowed to grow, where a city block
   gets built and where the bird hits the ground all read this same
   function, so nothing can disagree with anything else.

   Kept deliberately free of three.js: these are called tens of
   thousands of times a second, they are the easiest part of the engine
   to test in isolation, and keeping them pure makes both true.

   Budget is five or six octaves. A seventh buys detail nobody flying at
   60 km/h will ever see.
   ═══════════════════════════════════════════════════════════ */

import { Noise, clamp, lerp, smooth } from '../core/noise.js';
import { riverDistance } from './terrain-field.js';

export function forestField(seed = 2024) {
  const n = new Noise(seed);
  const VALLEY = 210;

  return function height(x, z) {
    const X = x * 0.00016, Z = z * 0.00016;

    // Ranges running roughly north–south, with a softer massif behind.
    const ridge = n.ridged(X, Z, 5) * 0.5 + 0.5;
    const massif = n.warped(X * 0.45, Z * 0.45, 0.5, 4) * 0.5 + 0.5;
    let h = VALLEY + Math.pow(ridge, 1.7) * 1150 * (0.35 + massif * 0.9);

    // Rolling ground detail and the coarse texture of tree-covered slopes.
    h += n.fbm(x * 0.0011, z * 0.0011, 4) * 44;
    h += n.fbm(x * 0.0075, z * 0.0075, 3) * 7.5;

    // The river: a wide floodplain with a channel cut into it.
    const d = riverDistance(n, x, z, { amp: 1500, freq: 0.00019, axis: 'z' });
    const plain = 1 - smooth(120, 900, d);
    h = lerp(h, VALLEY - 34 + n.fbm(z * 0.002, 7, 2) * 9, plain * 0.88);
    const channel = 1 - smooth(20, 130, d);
    h -= channel * 62;

    // Tributaries feeding in from the east side.
    const d2 = riverDistance(n, z * 0.8, x, { amp: 900, freq: 0.00031, axis: 'z' });
    h -= (1 - smooth(14, 90, d2)) * 26 * smooth(300, 1800, d);

    return h;
  };
}

export function coastField(seed = 3131) {
  const n = new Noise(seed);

  return function height(x, z) {
    // The shoreline runs along z, with the sea to the west (−x).
    const wander = n.fbm(z * 0.00022, 3.7, 4) * 900 + n.fbm(z * 0.0009, 9.1, 3) * 180;
    const inland = x - wander;                     // < 0 is offshore

    // Sea bed: shelves out, then drops away.
    let h = -8 - smooth(0, -2600, inland) * 120;
    h += n.fbm(x * 0.0009, z * 0.0009, 3) * 9 * smooth(200, -1400, inland);

    // Beach, then the cliff line and the downs behind it. The beach is kept
    // narrow on purpose: a kilometre of flat sand is not a coastline, it is a
    // car park, and the whole point of this world is the edge where the land
    // stops.
    const beach = smooth(-90, 130, inland);
    const cliffMask = smooth(0.30, 0.70, n.fbm(z * 0.00045, 21.3, 3) * 0.5 + 0.5);
    const cliffTop = 46 + cliffMask * 145;
    const rise = smooth(70, 260 - cliffMask * 190, inland);
    h = lerp(h, cliffTop, rise);

    const downs = smooth(180, 1900, inland);
    h += downs * (n.warped(x * 0.00034, z * 0.00034, 0.55, 4) * 0.5 + 0.5) * 430;
    h += downs * n.fbm(x * 0.0016, z * 0.0016, 3) * 26;
    h += beach * (1 - rise) * n.fbm(x * 0.006, z * 0.006, 2) * 2.2;

    // Stacks and islands out in the bay.
    // Stacks and small islands out in the bay. Kept rare and rounded: a hard
    // threshold on low-frequency noise produces flat-topped blocks that read
    // as tower blocks rather than rock.
    const isl = n.simplex2(x * 0.00052 + 4.1, z * 0.00052 - 2.7);
    if (inland < 0) {
      const island = Math.pow(clamp((isl - 0.32) / 0.68, 0, 1), 2.1);
      const crag = 0.65 + 0.35 * (n.ridged(x * 0.0016, z * 0.0016, 3) * 0.5 + 0.5);
      h += island * crag * 150 * smooth(-2400, -300, inland);
    }
    return h;
  };
}

export function mountainField(seed = 5150) {
  const n = new Noise(seed);
  const LAKE = 1180;

  return function height(x, z) {
    const X = x * 0.000105, Z = z * 0.000105;

    // Two crossing ridge systems give ranges rather than a field of bumps.
    const a = n.ridged(X, Z, 6);
    const b = n.ridged(Z * 0.72 + 31.1, X * 0.72 - 17.4, 5);
    let r = Math.max(a, b * 0.86) * 0.5 + 0.5;
    r = Math.pow(r, 1.55);

    const base = 900 + n.warped(X * 0.5, Z * 0.5, 0.6, 4) * 420;
    let h = base + r * 2650;

    // Glacial basins: flatten the floors so the lakes have something to sit in.
    const basin = smooth(0.52, 0.14, r) * smooth(1500, 900, h);
    h = lerp(h, LAKE - 26 + n.fbm(x * 0.0009, z * 0.0009, 3) * 16, basin * 0.8);

    h += n.fbm(x * 0.0013, z * 0.0013, 4) * 62;
    h += n.fbm(x * 0.0085, z * 0.0085, 3) * 9;

    // Knock the very tops into something more like real summits.
    h += smooth(2800, 3600, h) * n.ridged(x * 0.004, z * 0.004, 3) * 90;
    return h;
  };
}

export function cityField(seed = 7777) {
  const n = new Noise(seed);
  const PLAIN = 42;
  const RIVER = 16;

  const river = (x, z) => riverDistance(n, x, z, { amp: 1400, freq: 0.00023, axis: 'x' });

  const height = function height(x, z) {
    let h = PLAIN + n.fbm(x * 0.00035, z * 0.00035, 4) * 46;
    h += n.fbm(x * 0.0024, z * 0.0024, 2) * 3.5;

    // The river and its embankments.
    const d = river(x, z);
    const bank = 1 - smooth(70, 320, d);
    h = lerp(h, PLAIN - 14, bank * 0.9);
    h -= (1 - smooth(24, 110, d)) * 26;

    // Hills at the edge of town.
    const far = smooth(2600, 7000, Math.hypot(x, z));
    h += far * (n.warped(x * 0.00028, z * 0.00028, 0.5, 3) * 0.5 + 0.5) * 260;
    return h;
  };

  height.river = river;
  height.RIVER_LEVEL = RIVER;
  return height;
}

export const FIELDS = {
  forest: forestField,
  coast: coastField,
  mountain: mountainField,
  city: cityField,
};

/**
 * Where each world drops you in. `alt` is height above whatever is underneath
 * — ground or water — not an absolute altitude, so a spawn can never end up
 * buried inside a hill when the field is retuned.
 */
export const FIELD_META = {
  // Over the river, 330 m up, pointed down the valley.
  forest:   { waterLevel: 148,  spawn: { x: -200, z: 3200, alt: 330, heading: -2.8 } },
  // Out over the bay with the cliffs running down the starboard side.
  coast:    { waterLevel: 0,    spawn: { x: -1000, z: -800, alt: 120, heading: 0 } },
  mountain: { waterLevel: 1180, spawn: { x: -500, z: 400, alt: 900, heading: 2.1 } },
  city:     { waterLevel: 16,   spawn: { x: 180, z: 220, alt: 165, heading: -0.4 } },
};
