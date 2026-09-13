/* Statistical sanity check on the four height fields. A world that reads
   badly in these numbers will read badly in the air: water above the hills,
   a river that never reaches the sea, cliffs that are secretly ramps. */

import { FIELD_TESTS } from './field-harness.js';

let fails = 0;
const check = (l, ok, d) => { if (!ok) fails++; console.log(`   ${ok ? '✓' : '✗'} ${l}${d ? `  — ${d}` : ''}`); };

console.log('\n════ AVES terrain fields ════\n');

for (const { name, height, waterLevel, span, expect } of FIELD_TESTS) {
  console.log(`── ${name} ──`);
  const N = 160;
  let lo = Infinity, hi = -Infinity, sum = 0, below = 0, n = 0;
  let maxSlope = 0, slopeSum = 0, bad = null;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = (i / (N - 1) - 0.5) * span, z = (j / (N - 1) - 0.5) * span;
      const h = height(x, z);
      if (!Number.isFinite(h)) { bad = `${x.toFixed(0)},${z.toFixed(0)}`; continue; }
      lo = Math.min(lo, h); hi = Math.max(hi, h); sum += h; n++;
      if (h < waterLevel) below++;
      const e = span / N;
      const g = Math.hypot(height(x + e, z) - h, height(x, z + e) - h) / e;
      maxSlope = Math.max(maxSlope, g); slopeSum += g;
    }
  }
  const water = (below / n) * 100;
  console.log(`   range             ${lo.toFixed(0)} … ${hi.toFixed(0)} m  (mean ${(sum / n).toFixed(0)})`);
  console.log(`   under water       ${water.toFixed(1)}% of the sampled area`);
  console.log(`   mean slope        ${(slopeSum / n).toFixed(2)}  (max ${maxSlope.toFixed(1)})`);

  check('field is finite everywhere', !bad && Number.isFinite(lo + hi), bad ? `NaN at ${bad}` : '');
  check('relief is worth flying over', hi - lo > expect.relief, `${(hi - lo).toFixed(0)} m`);
  check(`water covers ${expect.water[0]}–${expect.water[1]}%`,
        water >= expect.water[0] && water <= expect.water[1], `${water.toFixed(1)}%`);
  check('nothing is a vertical wall', maxSlope < 14, `max gradient ${maxSlope.toFixed(1)}`);
  check('you spawn in clear air', expect.spawnClear > 30, `${expect.spawnClear.toFixed(0)} m above the surface`);
  check('you do not spawn facing a cliff', expect.aheadClear > 20,
        `${expect.aheadClear.toFixed(0)} m of clearance 900 m ahead`);
  console.log('');
}

// Sampling cost matters: this function is called for every terrain vertex,
// every water vertex and every tree placement.
console.log('── cost ──');
for (const { name, height } of FIELD_TESTS) {
  const t0 = performance.now();
  let acc = 0;
  for (let i = 0; i < 200000; i++) acc += height(i * 3.7, i * 1.9);
  const ms = performance.now() - t0;
  // A 24×24 patch is 25×25 vertices, each needing its own height plus four
  // more for the normal.
  const perPatch = (ms / 200000) * 625 * 5;
  console.log(`   ${name.padEnd(9)} ${(200 / ms).toFixed(0)} samples/µs · ${ms.toFixed(0)} ms for 200k · ≈${perPatch.toFixed(1)} ms to build one terrain patch`);
  check(`${name} patch build stays inside a frame`, perPatch < 8, `${perPatch.toFixed(1)} ms`);
  void acc;
}

console.log(`\n${fails === 0 ? '✓ all checks passed' : `✗ ${fails} check(s) failed`}\n`);
process.exit(fails === 0 ? 0 : 1);