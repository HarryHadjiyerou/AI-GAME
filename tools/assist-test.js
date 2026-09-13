/* Does it still fly itself into the ground?

   That was the complaint, so it gets its own test. Every case here is flown
   over the real terrain fields, at the real physics rate, for long enough
   that a slow sag into a hillside would show up. */

import { Flight } from '../src/flight/physics.js';
import { FlightAssist, ASSIST_ORDER } from '../src/flight/assist.js';
import { BIRDS, BIRD_ORDER } from '../src/config/birds.js';
import { FIELDS, FIELD_META } from '../src/world/fields.js';

const DT = 1 / 120;
let fails = 0;
const check = (l, ok, d) => { if (!ok) fails++; console.log(`   ${ok ? '✓' : '✗'} ${l}${d ? `  — ${d}` : ''}`); };
const kmh = (v) => (v * 3.6).toFixed(0);

function makeWorld(birdId) {
  const cfg = BIRDS[birdId];
  const meta = FIELD_META[cfg.world];
  const height = FIELDS[cfg.world]();
  return {
    cfg, meta, height,
    world: {
      height,
      waterLevel: meta.waterLevel,
      wind: { x: 3, y: 0, z: 1.5 },
      thermals: true, thermalStrength: 5, thermalCeiling: 1600, ridgeStrength: 1.2,
    },
  };
}

/**
 * Fly for `seconds`, driving the stick with `pilot(t)`.
 * Returns the flight plus the worst moment it had.
 */
function fly(birdId, level, seconds, pilot) {
  const { cfg, meta, height, world } = makeWorld(birdId);
  const f = new Flight(cfg, world);
  const a = new FlightAssist(cfg, level);
  const sp = meta.spawn;
  const surface = Math.max(height(sp.x, sp.z), meta.waterLevel);
  f.spawn(sp.x, surface + sp.alt, sp.z, sp.heading);

  let minAgl = Infinity, crashes = 0, hard = 0, minSpeed = Infinity, stallTime = 0;
  let floatTime = 0;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    const stick = pilot(t, f);
    f.update(DT, a.update(f, stick, DT));
    if (i > 120) {                        // ignore the first second of settling
      minAgl = Math.min(minAgl, f.surfaceClearance);
      // Settling onto the sea is a legitimate way to end a glide, so speed
      // while floating does not count against "did it keep flying speed".
      if (f.state === 'FLOAT' || f.state === 'WATER') floatTime += DT;
      // Only judge airspeed while genuinely airborne. A bird that has landed
      // or settled on the sea is not failing to fly, it has stopped.
      else if (f.surfaceClearance > 5) minSpeed = Math.min(minSpeed, f.airspeed);
      if (f._stalled > 0.5) stallTime += DT;
    }
    for (const e of f.events) {
      if (e === 'crash') { crashes++; hard++; }
      else if (e === 'scuff') crashes++;
    }
    f.events.length = 0;
  }
  return { f, a, minAgl, crashes, hard, minSpeed, stallTime, floatTime, surface, spawnAlt: sp.alt };
}

const HANDS_OFF = () => ({ x: 0, y: 0, flap: false, dive: 0 });

console.log('\n════ AVES flight assistance ════\n');

/* ── 1. hands off ────────────────────────────────────────── */
console.log('── hands off for three minutes ──');
for (const level of ASSIST_ORDER) {
  for (const bird of BIRD_ORDER) {
    const r = fly(bird, level, 180, HANDS_OFF);
    const label = `${level}/${bird}`.padEnd(18);
    const water = r.floatTime > 1 ? ` · ${r.floatTime.toFixed(0)} s afloat` : '';
    console.log(`   ${label} min AGL ${r.minAgl.toFixed(0).padStart(5)} m · ${kmh(r.f.airspeed).padStart(3)} km/h · ${r.crashes} contacts${water}`);
    if (level === 'serene') {
      check(`${label} is still flying after three minutes`, r.crashes === 0 && r.minAgl > 5,
            `min AGL ${r.minAgl.toFixed(0)} m`);
    } else {
      // Lower assist levels sink by design — that is what makes finding lift
      // the game. Coming down gently and landing is fine; arriving hard is not.
      check(`${label} does not arrive hard`, r.hard === 0, `${r.hard} hard impacts`);
    }
    check(`${label} keeps flying speed while airborne`,
          !Number.isFinite(r.minSpeed) || r.minSpeed > 4, `${kmh(r.minSpeed)} km/h`);
  }
}

/* ── 2. a hard turn held ─────────────────────────────────── */
console.log('\n── full bank held for 60 s ──');
for (const level of ASSIST_ORDER) {
  const r = fly('hawk', level, 60, () => ({ x: 1, y: 0, flap: false, dive: 0 }));
  const lost = r.spawnAlt - r.f.groundClearance;
  console.log(`   ${level.padEnd(9)} bank ${(r.f.bank * 57.3).toFixed(0).padStart(3)}° · lost ${lost.toFixed(0).padStart(4)} m · ${kmh(r.f.airspeed)} km/h · ${r.crashes} contacts`);
  check(`${level}: a held turn does not cost the whole flight`,
        level === 'wild' ? r.crashes === 0 || lost < 400 : lost < 260, `${lost.toFixed(0)} m in 60 s`);
}

/* ── 3. deliberately flying at the ground ────────────────── */
console.log('\n── nose down, full dive, straight at the terrain ──');
for (const level of ASSIST_ORDER) {
  const r = fly('hawk', level, 45, () => ({ x: 0, y: 1, flap: false, dive: 1 }));
  console.log(`   ${level.padEnd(9)} min AGL ${r.minAgl.toFixed(0).padStart(4)} m · ${r.crashes} contacts · ${kmh(r.f.airspeed)} km/h`);
  if (level === 'serene') {
    // Water is allowed — a hawk putting itself into the river is a feature.
    // Hitting a hillside is not.
    check('serene: refuses to let you hit the ground', r.crashes === 0, `${r.crashes} contacts`);
  }
  if (level === 'wild') {
    check('wild: lets you crash if you insist', r.crashes > 0 || r.minAgl < 30, `min AGL ${r.minAgl.toFixed(0)} m`);
  }
}

/* ── 4. a distracted player ──────────────────────────────── */
console.log('\n── two minutes of erratic input ──');
for (const bird of BIRD_ORDER) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pilot = (t) => ({
    x: Math.sin(t * 0.37) * 0.9 + (rnd() - 0.5) * 0.2,
    y: Math.sin(t * 0.21) * 0.7,
    flap: (t % 5) < 1.2,
    dive: (t % 17) > 15 ? 1 : 0,
  });
  const r = fly(bird, 'serene', 120, pilot);
  console.log(`   ${bird.padEnd(9)} min AGL ${r.minAgl.toFixed(0).padStart(4)} m · ${r.crashes} contacts (${r.hard} hard) · stalled ${r.stallTime.toFixed(1)} s`);
  check(`${bird}: survives a distracted pilot on serene`, r.hard === 0, `${r.hard} hard impacts`);
}

/* ── 4b. a water landing is a pause, not an ending ───────── */
console.log('\n── taking off again after settling on the sea ──');
{
  const { cfg, meta, height, world } = makeWorld('seagull');
  const f = new Flight(cfg, world);
  const a = new FlightAssist(cfg, 'balanced');
  // Put the gull on the water, stationary, as if it had just landed.
  f.spawn(-1000, meta.waterLevel + 0.2, -800, 0, 1);
  f.velocity.set(0, 0, 0);
  for (let i = 0; i < 120 * 3; i++) f.update(DT, a.update(f, HANDS_OFF(), DT));
  const settled = f.position.y;
  let best = settled;
  let airborneAt = null, airborneTime = 0, topSpeed = 0;
  for (let i = 0; i < 120 * 20; i++) {
    f.update(DT, a.update(f, { x: 0, y: -0.6, flap: true, dive: 0 }, DT));
    best = Math.max(best, f.position.y);
    topSpeed = Math.max(topSpeed, f.airspeed);
    if (f.position.y > meta.waterLevel + 1.0 && f.airspeed > a.stallSpeed) airborneTime += DT;
    // Airborne means clear of the surface and above stall speed — not
    // climbing away. A gull that has just left the water skims it at a metre
    // or two for a long while, because at barely over stall there is no
    // energy left to climb with. That is the real behaviour, not a failure.
    if (airborneAt === null && f.position.y > meta.waterLevel + 1.2
        && f.airspeed > a.stallSpeed) airborneAt = i / 120;
  }
  console.log(`   settled at ${settled.toFixed(1)} m · first airborne ${airborneAt === null ? '—' : airborneAt.toFixed(1) + ' s'} · ${airborneTime.toFixed(1)} s flying · top ${kmh(topSpeed)} km/h`);
  check('a gull on the water can beat its way off again',
        airborneAt !== null && airborneAt < 12 && airborneTime > 3,
        `off at ${airborneAt === null ? 'never' : airborneAt.toFixed(1) + ' s'}, ${airborneTime.toFixed(1)} s airborne`);
}

/* ── 5. does neutral stick actually feel like gliding? ───── */
console.log('\n── what neutral stick settles at ──');
for (const bird of BIRD_ORDER) {
  const { cfg } = makeWorld(bird);
  const a = new FlightAssist(cfg, 'balanced');
  const r = fly(bird, 'balanced', 90, HANDS_OFF);
  console.log(`   ${bird.padEnd(9)} ${kmh(r.f.airspeed).padStart(3)} km/h (stall ${kmh(a.stallSpeed)}, aiming ${kmh(a.refSpeed)}) · vario ${r.f.vario.toFixed(2).padStart(6)} m/s`);
  check(`${bird}: settles above stall speed`, r.f.airspeed > a.stallSpeed * 1.05,
        `${kmh(r.f.airspeed)} vs stall ${kmh(a.stallSpeed)}`);
  check(`${bird}: hands-off sink is gentle`, Math.abs(r.f.vario) < 3.5, `${r.f.vario.toFixed(2)} m/s`);
}

console.log(`\n${fails === 0 ? '✓ all checks passed' : `✗ ${fails} check(s) failed`}\n`);
process.exit(fails === 0 ? 0 : 1);
