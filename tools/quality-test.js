/* Adaptive quality, simulated.

   The controller is all hysteresis and ratchets, which is exactly the kind of
   logic that looks right and oscillates in the field. So it gets driven here
   against scripted frame rates instead of against a GPU. */

import { AutoQuality } from '../src/core/quality.js';

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`   ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failed++;
};

/** Run `seconds` of frames at `fps`, at a 20 Hz sampling step. */
function run(q, fps, seconds) {
  const dt = 0.05;
  for (let t = 0; t < seconds; t += dt) q.update(dt, fps);
}

const make = (ceiling = 1.0, reflect = 'ultra') => {
  const state = { scale: ceiling, bloom: true, reflect };
  const q = new AutoQuality({
    ceiling, reflect,
    onScale: (s) => { state.scale = s; },
    onBloom: (b) => { state.bloom = b; },
    onReflect: (r) => { state.reflect = r; },
  });
  state.scale = q.scale;
  return [q, state];
};

console.log('\n════ adaptive quality ════\n');

console.log('── it leaves a healthy device alone ──');
{
  const [q, s] = make(1.0);
  run(q, 60, 60);
  check('no changes at 60 fps', q.changes === 0, `${q.changes} changes`);
  check('stays at full resolution', s.scale === 1.0, `${s.scale}`);
}

console.log('\n── it backs off a struggling one ──');
{
  const [q, s] = make(1.0);
  run(q, 34, 40);
  check('resolution came down', s.scale < 0.75, `${s.scale}`);
  check('it did not fall straight to the floor', q.changes < 8, `${q.changes} changes`);
}

console.log('\n── reflections go before resolution ──');
{
  const [q, s] = make(1.0);
  run(q, 40, 8);
  check('the sea lost its reflections', q.reflect !== 'ultra', q.reflect);
  check('the picture kept its pixels', s.scale === 1.0, `${s.scale}`);
}

console.log('\n── a collapse is handled faster than a sag ──');
{
  // Total degradation, not just the scale: a controller that is still walking
  // down the reflection ladder has not stopped responding, it is responding
  // with the cheapest thing first.
  const level = (q) => q.index + q.reflectIndex;
  const [fast] = make(1.0); run(fast, 12, 12);
  const [slow] = make(1.0); run(slow, 40, 12);
  check('12 fps gives up more than 40 fps in the same time',
        level(fast) < level(slow), `${level(fast)} vs ${level(slow)}`);
  check('a drowning device drops reflections outright', fast.reflect === 'off',
        fast.reflect);
}

console.log('\n── the floor holds ──');
{
  const [q, s] = make(1.0);
  run(q, 8, 180);
  check('never goes below the lowest scale', s.scale >= 0.5, `${s.scale}`);
  check('reflections went first', s.reflect === 'off', s.reflect);
  check('bloom is given up at the floor', s.bloom === false);
  check('it stops thrashing once there is nothing left', q.changes < 12, `${q.changes} changes`);
}

console.log('\n── it does not pump ──');
{
  // The pathological case: a device that runs well at low resolution and badly
  // at high, which a naive controller will happily oscillate between forever.
  const [q, s] = make(1.0);
  let t = 0;
  const dt = 0.05;
  const seen = new Set();
  while (t < 600) { q.update(dt, s.scale > 0.72 ? 30 : 60); seen.add(s.scale); t += dt; }
  check('settles instead of cycling', q.changes <= 8, `${q.changes} changes over 10 minutes`);
  check('settles somewhere it can hold', s.scale <= 0.72, `${s.scale}`);
}

console.log('\n── it respects the tier ceiling ──');
{
  const [q, s] = make(0.62);
  check('starts on a rung at or below the ceiling', s.scale <= 0.62, `${s.scale}`);
  run(q, 60, 300);
  check('never climbs past the ceiling', s.scale <= 0.62, `${s.scale}`);
}

console.log('\n── switching tier re-aims the ladder ──');
{
  const [q, s] = make(0.62);
  run(q, 20, 30);
  const scale = q.setCeiling(1.0);
  check('a raised ceiling lands on full resolution', scale === 1.0, `${scale}`);
  check('the old failure is forgotten', q._blocked > q.index);
  void s;
}

console.log(failed ? `\n✗ ${failed} failed\n` : '\n✓ all checks passed\n');
process.exit(failed ? 1 : 0);
