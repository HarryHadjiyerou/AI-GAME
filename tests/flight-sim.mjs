// Headless flight-model check: node tests/flight-sim.mjs
import * as THREE from 'three';
import { BIRDS } from '../js/flight/birds.js';
import { BirdBody } from '../js/flight/physics.js';

const env = { wind: () => new THREE.Vector3(), altitude: 100 };
function run(cfg, input, secs, init) {
  const b = new BirdBody(cfg);
  b.pos.set(0, 3000, 0);
  b.setHeading(0, init?.pitch || 0);
  b.vel.set(0, 0, -(init?.v ?? cfg.vBest));
  if (init?.takeoff) b.takeOff();
  let maxV = 0;
  const p0 = b.pos.clone();
  const avg = new THREE.Vector3(); let na = 0;
  for (let t = 0; t < secs; t += 1 / 60) {
    b.step(1 / 60, typeof input === 'function' ? input(t) : input, env);
    if (t > secs - 10) { avg.add(b.vel); na++; }
    maxV = Math.max(maxV, b.vel.length());
    if (b.stamina <= 0) b.stamina = 1;
  }
  return { b, maxV, p0, avg: avg.divideScalar(Math.max(na, 1)) };
}
const none = { pitch: 0, roll: 0, flap: false, boost: false, dive: false };
for (const [id, c] of Object.entries(BIRDS)) {
  const g = run(c, none, 40);
  const v = g.avg; const hs = Math.hypot(v.x, v.z);
  const d = run(c, { ...none, dive: true }, 25, { pitch: -1.3 });
  const du = run(c, { ...none, pitch: -0.4 }, 25, { pitch: -1.3 });
  const f = run(c, { ...none, flap: true }, 20);
  const bo = run(c, { ...none, boost: true }, 12);
  const tk = run(c, { ...none, flap: true }, 4, { v: 0, takeoff: true });
  const turn = run(c, { ...none, roll: 1 }, 12);
  const tv = turn.b.vel; const tr = Math.hypot(tv.x, tv.z) ** 2 / (9.81 * Math.tan(Math.abs(turn.b.bank)));
  console.log(`${id.padEnd(8)} S=${c.S.toFixed(3)} vStall=${c.vStall.toFixed(1)} | glide: v=${hs.toFixed(1)} sink=${(-v.y).toFixed(2)} L/D=${(hs / -v.y).toFixed(1)} a=${(g.b.alpha * 57.3).toFixed(1)}deg`
    + ` | dive tuck max=${d.maxV.toFixed(0)} open max=${du.maxV.toFixed(0)} | flap v=${f.b.vel.length().toFixed(1)} vs=${f.b.vel.y.toFixed(2)} | boost v=${bo.b.vel.length().toFixed(1)} vs=${bo.b.vel.y.toFixed(1)}`
    + ` | takeoff dy=${(tk.b.pos.y - 3000).toFixed(1)} v=${tk.b.vel.length().toFixed(1)} | turn bank=${(turn.b.bank * 57.3).toFixed(0)} r~${tr.toFixed(0)}m vs=${tv.y.toFixed(1)}`);
}
