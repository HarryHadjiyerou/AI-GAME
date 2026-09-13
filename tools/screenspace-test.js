/* The parts of the screen-space pass that are arithmetic rather than pixels.

   Everything else in core/screenspace.js is GLSL and has to be looked at to be
   judged. This is the piece that cannot be: where the sun lands on screen is a
   number, it is wrong in a way that produces no error and no warning — the
   shafts just never appear — and it has been wrong once already. */

import * as THREE from 'three';
import { directionToScreen, SURFACE } from '../src/core/screenspace.js';

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`   ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failed++;
};
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

/** A camera at the origin looking down -z, like every camera in three.js. */
function camera({ far = 12000, fov = 104, aspect = 16 / 9, yaw = 0 } = {}) {
  const c = new THREE.PerspectiveCamera(fov, aspect, 0.1, far);
  c.rotation.set(0, yaw, 0);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return c;
}
const probe = () => ({ uv: new THREE.Vector2(), view: new THREE.Vector3() });
const dir = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

console.log('\n════ screen-space pass ════\n');

console.log('── the sun on screen ──');
{
  const c = camera(), p = probe();
  const on = directionToScreen(dir(0, 0, -1), c, p);
  check('dead ahead is the centre of the frame',
        near(p.uv.x, 0.5) && near(p.uv.y, 0.5), `${p.uv.x.toFixed(3)}, ${p.uv.y.toFixed(3)}`);
  check('and fully on screen', on === 1, String(on));
}
{
  const c = camera(), p = probe();
  const on = directionToScreen(dir(0, 0, 1), c, p);
  check('directly behind is off', on === 0, String(on));
}
{
  const c = camera(), p = probe();
  directionToScreen(dir(0.4, 0, -1), c, p);
  check('to the right lands right of centre', p.uv.x > 0.5, p.uv.x.toFixed(3));
  directionToScreen(dir(0, 0.4, -1), c, p);
  check('above lands above centre', p.uv.y > 0.5, p.uv.y.toFixed(3));
}

console.log('\n── the regression ──');
{
  /* The bug: the sun was located by projecting a point 100 km along it. Every
     camera here has a far plane far closer than that, so the point projected
     past it, and the "is it in front" test — which read the projected depth —
     said no, every frame, in every world. */
  const p = probe();
  for (const far of [800, 5000, 12000, 60000]) {
    const on = directionToScreen(dir(0, 0.2, -1), camera({ far }), p);
    check(`a ${far} m far plane does not hide the sun`, on === 1, `onScreen ${on}`);
  }
}

console.log('\n── leaving the frame ──');
{
  const c = camera({ fov: 104, aspect: 16 / 9 }), p = probe();
  // Sweep the sun from straight ahead round to behind, and watch the answer.
  let last = 1, monotonic = true, everPartial = false;
  for (let a = 0; a <= 175; a += 5) {
    const r = (a * Math.PI) / 180;
    const on = directionToScreen(dir(Math.sin(r), 0, -Math.cos(r)), c, p);
    if (on > last + 1e-6) monotonic = false;
    if (on > 0.001 && on < 0.999) everPartial = true;
    last = on;
  }
  check('it only ever fades out, never back in', monotonic);
  check('it fades rather than switching', everPartial);
  check('and is gone by the time the sun is behind', last === 0, String(last));
}

console.log('\n── surface ids ──');
{
  // Written into a half-float alpha and compared in the shader with a
  // tolerance of 0.06, so they have to be exactly representable and further
  // apart than that.
  const ids = Object.entries(SURFACE);
  check('every id is exact in a half float',
        ids.every(([, v]) => v * 4 === Math.round(v * 4)),
        ids.map(([k, v]) => `${k}=${v}`).join(' '));
  let closest = Infinity;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      closest = Math.min(closest, Math.abs(ids[i][1] - ids[j][1]));
    }
  }
  check('and no two are within the shader tolerance', closest > 0.12, `closest ${closest}`);
}

console.log(failed ? `\n✗ ${failed} failed\n` : '\n✓ all checks passed\n');
process.exit(failed ? 1 : 0);
