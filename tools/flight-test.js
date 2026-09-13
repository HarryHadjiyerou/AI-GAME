/* Numerical check of the flight model. Not a unit test — a wind tunnel.
   Run with `npm test`. Every number printed here should be recognisable
   as something a real bird does. */

import { Flight } from '../src/flight/physics.js';
import { BIRDS, BIRD_ORDER } from '../src/config/birds.js';

const flat = {
  height: () => 0,
  wind: { x: 0, y: 0, z: 0 },
  thermals: false,
  ridgeLift: false,
};

const NEUTRAL = { roll: 0, pitch: 0, flap: false, tuck: 0 };
const kmh = (v) => (v * 3.6).toFixed(1);

/**
 * Fly for `seconds` and report the state, with `vario` and `airspeed` averaged
 * over the last third of the run. A gliding bird oscillates in a long phugoid,
 * so a single snapshot of vertical speed says almost nothing.
 */
function sim(bird, input, seconds, { alt = 3000, speed = null, dt = 1 / 120 } = {}) {
  const f = new Flight(BIRDS[bird], flat);
  f.spawn(0, alt, 0, 0, speed ?? BIRDS[bird].cruiseSpeed);
  const steps = Math.round(seconds / dt);
  const from = Math.round(steps * 0.66);
  let vSum = 0, sSum = 0, n = 0, yFrom = 0, tFrom = 0;
  for (let i = 0; i < steps; i++) {
    f.update(dt, { ...NEUTRAL, ...input });
    if (i === from) { yFrom = f.position.y; tFrom = i * dt; }
    if (i >= from) { vSum += f.vario; sSum += f.airspeed; n++; }
  }
  f.vario = n ? (f.position.y - yFrom) / Math.max(1e-3, steps * dt - tFrom) : f.vario;
  f.meanSpeed = n ? sSum / n : f.airspeed;
  f.airspeed = f.meanSpeed;
  void vSum;
  return f;
}

let fails = 0;
const check = (label, ok, detail) => {
  if (!ok) fails++;
  console.log(`   ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
};

console.log('\n════ AVES flight model ════\n');

for (const id of BIRD_ORDER) {
  const cfg = BIRDS[id];
  console.log(`── ${cfg.name} ──  ${cfg.mass} kg · ${cfg.wingArea} m² · AR ${cfg.aspectRatio}`);
  const loading = (cfg.mass * 9.81) / cfg.wingArea;
  console.log(`   wing loading      ${loading.toFixed(1)} N/m²`);

  // 1. Trimmed glide: released at cruise with hands off.
  const glide = sim(id, {}, 40);
  const sink = -glide.vario;
  const ratio = Math.hypot(glide.velocity.x, glide.velocity.z) / Math.max(0.01, sink);
  console.log(`   glide             ${kmh(glide.airspeed)} km/h, sink ${sink.toFixed(2)} m/s, L/D ${ratio.toFixed(1)}`);
  check('glides forward, not backwards', glide.velocity.length() > 4, `${kmh(glide.airspeed)} km/h`);
  check('sinks in a hands-off glide', sink > 0.15 && sink < 6, `${sink.toFixed(2)} m/s`);
  check('glide ratio is plausible', ratio > 3 && ratio < 30, `L/D ${ratio.toFixed(1)}`);

  // 2. Stoop: push over, then fold. Peak speed is what matters, not the
  //    speed at some arbitrary moment — a stoop is a manoeuvre, not a state.
  const stoop = new Flight(cfg, flat);
  stoop.spawn(0, 4000, 0, 0);
  let peak = 0, minY = 4000;
  for (let i = 0; i < 120 * 22; i++) {
    const t = i / 120;
    stoop.update(1 / 120, { roll: 0, pitch: t < 1.5 ? -1 : -0.12, flap: false, tuck: t < 0.6 ? t / 0.6 : 1 });
    peak = Math.max(peak, stoop.airspeed);
    minY = Math.min(minY, stoop.position.y);
  }
  console.log(`   stoop             peak ${kmh(peak)} km/h, lost ${(4000 - minY).toFixed(0)} m`);
  check('a stoop roughly doubles glide speed', peak > glide.airspeed * 1.8, `${kmh(peak)} vs ${kmh(glide.airspeed)}`);
  check('stoop speed stays under 320 km/h', peak * 3.6 < 320, `${kmh(peak)} km/h`);

  // 3. Powered flight, measured inside the stamina budget — a bird that has
  //    run out of stamina is gliding, and averaging over that says nothing.
  const window = Math.min(9, 0.55 / cfg.flapCost);
  const climb = sim(id, { flap: true }, window);
  console.log(`   powered flight    ${climb.vario >= 0 ? '+' : ''}${climb.vario.toFixed(2)} m/s at ${kmh(climb.airspeed)} km/h over ${window.toFixed(0)} s`);
  check('flapping out-climbs the glide', climb.vario > -sink * 0.5, `${climb.vario.toFixed(2)} vs glide ${(-sink).toFixed(2)} m/s`);
  check('powered climb stays believable', climb.vario < 8, `${climb.vario.toFixed(2)} m/s`);
  const endurance = 1 / cfg.flapCost;
  console.log(`   flap endurance    ${endurance.toFixed(0)} s of continuous beating`);
  check('flapping is a sprint, not a cruise', endurance > 5 && endurance < 40, `${endurance.toFixed(0)} s`);

  // 4. Sustained turn. Measure the heading rate by integrating the change in
  //    the horizontal velocity direction — heading itself wraps at ±π.
  const turn = new Flight(cfg, flat);
  turn.spawn(0, 4000, 0, 0);
  let swept = 0, prev = 0, samples = 0, speedSum = 0;
  for (let i = 0; i < 120 * 16; i++) {
    turn.update(1 / 120, { roll: 1, pitch: 0.35, flap: false, tuck: 0 });
    const a = Math.atan2(turn.velocity.x, turn.velocity.z);
    if (i > 120 * 10) {
      let d = a - prev;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      swept += Math.abs(d);
      speedSum += Math.hypot(turn.velocity.x, turn.velocity.z);
      samples++;
    }
    prev = a;
  }
  const omega = swept / (samples / 120);
  const radius = (speedSum / samples) / Math.max(1e-3, omega);
  const loadG = (turn.load).toFixed(1);
  console.log(`   hard turn         radius ${radius.toFixed(0)} m, bank ${(turn.bank * 57.3).toFixed(0)}°, ${loadG} g`);
  check('turn radius is a bird radius, not a jet radius', radius > 5 && radius < 300, `${radius.toFixed(0)} m`);
  check('bank reaches the limit', Math.abs(turn.bank) > cfg.maxBank * 0.6, `${(turn.bank * 57.3).toFixed(0)}°`);
  check('g-load in a hard turn is survivable', turn.load < 7, `${loadG} g`);

  // 5. Stall: hold full back-stick from slow.
  const stall = sim(id, { pitch: 1 }, 9, { speed: cfg.cruiseSpeed * 0.42 });
  console.log(`   stall probe       state ${stall.state}, α ${(stall._aEff * 57.3).toFixed(0)}°, ${kmh(stall.airspeed)} km/h`);
  check('over-pulling actually stalls', stall._stalled > 0.2 || stall.vario < -3,
        `stalled ${stall._stalled.toFixed(2)}, vario ${stall.vario.toFixed(1)}`);

  // 6. Stamina: flapping must be expensive, gliding must pay it back.
  const tired = sim(id, { flap: true }, 14);
  const rested = new Flight(cfg, flat);
  rested.spawn(0, 3000, 0, 0); rested.stamina = 0.1;
  for (let i = 0; i < 120 * 14; i++) rested.update(1 / 120, NEUTRAL);
  console.log(`   stamina           14 s flapping → ${tired.stamina.toFixed(2)} · 14 s gliding → ${rested.stamina.toFixed(2)}`);
  check('flapping drains', tired.stamina < 0.85, tired.stamina.toFixed(2));
  check('gliding recovers', rested.stamina > 0.15, rested.stamina.toFixed(2));

  // 7. Nothing may go non-finite, ever.
  const chaos = new Flight(cfg, flat);
  chaos.spawn(0, 2000, 0, 0);
  let seed = 1;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < 120 * 60; i++) {
    chaos.update(1 / 120, { roll: rand(), pitch: rand(), flap: rand() > 0, tuck: Math.abs(rand()) });
  }
  const finite = [chaos.position, chaos.velocity].every((v) => Number.isFinite(v.x + v.y + v.z))
    && Number.isFinite(chaos.heading + chaos.bank + chaos.alpha);
  check('survives 60 s of random input', finite,
        finite ? `${kmh(chaos.airspeed)} km/h at ${chaos.position.y.toFixed(0)} m` : 'NaN');
  console.log('');
}

/* ── thermals must actually lift you ─────────────────────── */
console.log('── thermals ──');
const thermalWorld = {
  height: () => 0, wind: { x: 4, y: 0, z: 0 },
  thermals: true, thermalStrength: 6, thermalCeiling: 2000, ridgeLift: false,
};
// Survey the lift field the way a soaring bird reads the ground: find the
// strong columns, then check that sitting in one actually pays.
const probe = new Flight(BIRDS.condor, thermalWorld);
const p = new (probe.position.constructor)();
const w = new (probe.position.constructor)();
let strong = 0, cells = 0, bestLift = 0, bestAt = [0, 0];
for (let i = 0; i < 70; i++) {
  for (let j = 0; j < 70; j++) {
    p.set(i * 240 - 8400, 700, j * 240 - 8400);
    probe.windAt(p, 0, w);
    cells++;
    if (w.y > 3) strong++;
    if (w.y > bestLift) { bestLift = w.y; bestAt = [p.x, p.z]; }
  }
}
const coverage = (strong / cells) * 100;
console.log(`   lift field        ${coverage.toFixed(0)}% of ground gives >3 m/s, best ${bestLift.toFixed(1)} m/s`);
check('thermals cover enough ground to find', coverage > 4 && coverage < 60, `${coverage.toFixed(0)}%`);

const inCore = new Flight(BIRDS.condor, thermalWorld);
inCore.spawn(bestAt[0], 700, bestAt[1], 0);
const y0 = inCore.position.y;
for (let i = 0; i < 120 * 60; i++) inCore.update(1 / 120, { roll: 0.55, pitch: 0.3, flap: false, tuck: 0 });
console.log(`   condor in a core  ${(inCore.position.y - y0 >= 0 ? '+' : '')}${(inCore.position.y - y0).toFixed(0)} m in 60 s`);
check('circling a good core climbs', inCore.position.y > y0 + 60, `${(inCore.position.y - y0).toFixed(0)} m`);

const dead = new Flight(BIRDS.condor, thermalWorld);
dead.spawn(bestAt[0] + 4000, 700, bestAt[1] + 4000, 0);
const y1 = dead.position.y;
for (let i = 0; i < 120 * 60; i++) dead.update(1 / 120, { roll: 0.55, pitch: 0.3, flap: false, tuck: 0 });
console.log(`   condor in dead air ${(dead.position.y - y1).toFixed(0)} m in 60 s`);
check('dead air costs you height', dead.position.y < y1, `${(dead.position.y - y1).toFixed(0)} m`);

console.log(`\n${fails === 0 ? '✓ all checks passed' : `✗ ${fails} check(s) failed`}\n`);
process.exit(fails === 0 ? 0 : 1);
