/* Bridges the pure height fields into the terrain test. */
import { forestField, coastField, mountainField, cityField, FIELD_META } from '../src/world/fields.js';

const make = (name, field, span, expect) => {
  const height = field();
  const m = FIELD_META[name];
  const { x, z, alt, heading } = m.spawn;
  const surface = Math.max(height(x, z), m.waterLevel);
  const y = surface + alt;

  // Look along the launch heading and find the worst thing in the way.
  let aheadClear = Infinity;
  for (let d = 100; d <= 900; d += 50) {
    const px = x - Math.sin(heading) * d;
    const pz = z - Math.cos(heading) * d;
    aheadClear = Math.min(aheadClear, y - Math.max(height(px, pz), m.waterLevel));
  }

  return {
    name, height, span,
    waterLevel: m.waterLevel,
    expect: { ...expect, spawnClear: y - surface, aheadClear },
  };
};

export const FIELD_TESTS = [
  make('forest',   forestField,   16000, { relief: 600,  water: [0.2, 22] }),
  make('coast',    coastField,    16000, { relief: 400,  water: [18, 72] }),
  make('mountain', mountainField, 16000, { relief: 1200, water: [0.1, 30] }),
  make('city',     cityField,     14000, { relief: 150,  water: [0.2, 22] }),
];
