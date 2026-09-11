/* Pure field helpers shared by the height fields and the terrain mesh.
   No three.js here on purpose — the fields must stay testable in isolation. */

import { clamp } from '../core/noise.js';

/** Smooth minimum — carves a valley into a surface without leaving a crease. */
export function smin(a, b, k) {
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return b * (1 - h) + a * h - k * h * (1 - h);
}

/**
 * Distance from (x, z) to the centreline of a meandering river.
 * The centreline is itself noise, so the river wanders the way a real one
 * does rather than running down a ruler.
 */
export function riverDistance(noise, x, z, { amp = 900, freq = 0.00035, axis = 'z' } = {}) {
  if (axis === 'z') {
    const cx = noise.fbm(z * freq, 11.3, 3) * amp + noise.fbm(z * freq * 3.1, 5.7, 2) * amp * 0.3;
    return Math.abs(x - cx);
  }
  const cz = noise.fbm(x * freq, 3.9, 3) * amp + noise.fbm(x * freq * 3.1, 8.2, 2) * amp * 0.3;
  return Math.abs(z - cz);
}
