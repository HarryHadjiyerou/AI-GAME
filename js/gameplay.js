// Gameplay layer: trick detection and the optional flight-ring chain.
import * as THREE from 'three';
import { patchMaterial } from './core/shaderPatch.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------------------------------------
// Tricks: barrel rolls, free-fall, low pull-outs, big dives, updraft rides and thermals.
// ---------------------------------------------------------------------------------------------
export class Tricks {
  constructor(game) {
    this.game = game;
    this.lastRollEnd = -10;
    this.ff = 0;
    this.diveMax = 0;
    this.pull = null;
    this.liftStart = null;
    this.liftKind = '';
    this.time = 0;
  }

  update(dt, s) {
    const g = this.game, b = s.body, cfg = b.cfg;
    this.time += dt;
    // barrel rolls (a second roll soon after the first is a double)
    if (b.rollDone) {
      if (this.time - this.lastRollEnd < 1.0) g.award('DOUBLE ROLL', 160);
      else g.award('BARREL ROLL', 60);
      this.lastRollEnd = this.time;
    }
    // free-fall: tucked, nose near vertical
    const fwdY = s.fwd.y;
    if (b.tuck > 0.55 && fwdY < -0.8) this.ff += dt;
    else {
      if (this.ff > 1.4) g.award(`FREE FALL ${this.ff.toFixed(1)}s`, Math.round(40 * this.ff));
      this.ff = 0;
    }
    // big dive speed
    if (b.tuck > 0.5 && b.vel.y < -10) this.diveMax = Math.max(this.diveMax, s.speed);
    // pull-out: track the lowest point of the swoop after a fast dive
    if (b.pullout > 0.5 && !this.pull && s.speed > cfg.vBest * 1.6) this.pull = { minAgl: s.agl, speed: s.speed };
    if (this.pull) {
      this.pull.minAgl = Math.min(this.pull.minAgl, s.agl);
      if (g.stun > 0 || b.mode !== 'flying') this.pull = null;
      else if (b.vel.y > 0.5) {
        const low = this.pull.minAgl;
        if (low < 45) g.award(low < 12 ? 'DEATH-DEFYING PULL-OUT' : 'PULL-OUT', Math.round(120 + (45 - low) * 8));
        if (this.diveMax > cfg.vBest * 1.9) g.award(`DIVE ${Math.round(this.diveMax * 3.6)} km/h`, Math.round(this.diveMax));
        this.diveMax = 0;
        this.pull = null;
      }
    } else if (b.tuck < 0.2 && this.diveMax > 0 && b.vel.y > -2) {
      if (this.diveMax > cfg.vBest * 1.9) g.award(`DIVE ${Math.round(this.diveMax * 3.6)} km/h`, Math.round(this.diveMax));
      this.diveMax = 0;
    }
    // riding lift: ridge updraft or thermal
    const kind = s.ridge > 1.2 ? 'UPDRAFT' : s.thermal > 0.8 ? 'THERMAL' : '';
    if (kind && s.climb > 0.6) {
      if (this.liftStart === null || this.liftKind !== kind) { this.liftStart = b.pos.y; this.liftKind = kind; }
      if (b.pos.y - this.liftStart > 120) { g.award(kind, 70); this.liftStart = b.pos.y; }
    } else if (!kind) this.liftStart = null;
  }
}

// ---------------------------------------------------------------------------------------------
// Flight rings: a chain of glowing gates routed through the most fun terrain nearby:
// low along canyons and rivers, under titan branches, down city streets.
// ---------------------------------------------------------------------------------------------
const RING_R = 11;

export class Rings {
  constructor(scene, game) {
    this.game = game;
    this.enabled = true;
    this.count = 7;
    const geo = new THREE.TorusGeometry(RING_R, 0.55, 8, 48);
    const mat = patchMaterial(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }), null, 'ring');
    this.mesh = new THREE.InstancedMesh(geo, mat, this.count);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.count * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.count = 0;
    scene.add(this.mesh);
    // inner shimmer disc on the next ring
    const disc = new THREE.Mesh(new THREE.CircleGeometry(RING_R - 0.6, 40), patchMaterial(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.9, 0.4), transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), null, 'ringdisc'));
    disc.frustumCulled = false;
    this.disc = disc;
    scene.add(disc);
    this.route = [];
    this.chain = 0;
    this.best = 0;
    this.t = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this.prevPos = new THREE.Vector3();
  }

  reset(pos, fwd) {
    this.route = [];
    this.chain = 0;
    const dir = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
    let prev = { p: pos.clone().addScaledVector(dir, 60), dir };
    for (let i = 0; i < this.count; i++) { prev = this.next(prev, i === 0 ? 230 : null); this.route.push(prev); }
    this.prevPos.copy(pos);
  }

  groundAt(x, z) { return Math.max(this.game.field.height(x, z), 0); }

  targetAgl(x, z) {
    const g = this.game, id = g.biome.id;
    if (id === 'forest' && g.field.info) {
      const I = g.field.info(x, z);
      if (I.cStr > 0.7 && I.cr < 0.05) return 70; // inside a canyon
      return 45;
    }
    return { coast: 22, mountains: 140, city: 42 }[id] ?? 40;
  }

  next(prev, forceDist) {
    const g = this.game;
    const base = Math.atan2(prev.dir.x, prev.dir.z);
    let best = null;
    for (let k = -5; k <= 5; k++) {
      const ang = base + k * 0.16;
      const d = forceDist || 260 + Math.random() * 90;
      const dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
      const x = prev.p.x + dir.x * d, z = prev.p.z + dir.z * d;
      const ground = this.groundAt(x, z);
      let y = ground + this.targetAgl(x, z);
      y = clamp(y, prev.p.y - 90, prev.p.y + 70);
      // clearance along the leg
      let clear = Infinity;
      for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        const px = prev.p.x + dir.x * d * t, pz = prev.p.z + dir.z * d * t;
        clear = Math.min(clear, prev.p.y + (y - prev.p.y) * t - this.groundAt(px, pz));
      }
      if (y - ground < 12) y = ground + 12 + Math.random() * 10;
      let blocked = 0;
      if (g.city) for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        const px = prev.p.x + dir.x * d * t, pz = prev.p.z + dir.z * d * t, py = prev.p.y + (y - prev.p.y) * t;
        g.city.forEachBox(px, pz, 14, (bx) => { if (py > bx[1] - 14 && py < bx[4] + 14) blocked++; });
      }
      // prefer: staying low (thrilling), straight-ish, clear legs; titans nearby are a bonus
      let score = -blocked * 60 - Math.abs(k) * 6 - Math.max(0, 15 - clear) * 8 - (y - ground) * 0.4 + Math.random() * 10;
      if (g.titans) for (const t of g.titans.list) {
        const dd = Math.hypot(t.x - x, t.z - z);
        if (dd < 350) score += 25;
      }
      if (g.biome.id === 'forest' && g.field.info) { const I = g.field.info(x, z); if (I.cStr > 0.7 && I.cr < 0.03) score += 30; }
      if (!best || score > best.score) best = { score, p: new THREE.Vector3(x, y, z), dir };
    }
    // thread titans: if one is right on the path, go under its limbs beside the trunk
    if (g.titans) for (const t of g.titans.list) {
      const dd = Math.hypot(t.x - best.p.x, t.z - best.p.z);
      if (dd < 160) {
        const side = new THREE.Vector3(-best.dir.z, 0, best.dir.x);
        const keep = best.p.clone();
        // try either side of the trunk, and a bit further out, until the ring is clear of roots and limbs
        let ok = false;
        for (const [sg, k] of [[1, 0.16], [-1, 0.16], [1, 0.24], [-1, 0.24]]) {
          best.p.set(t.x + side.x * t.H * k * sg, t.y + t.H * 0.26, t.z + side.z * t.H * k * sg);
          if (!g.titans.collide(best.p, 12).hit) { ok = true; break; }
        }
        if (!ok) { best.p.copy(keep); break; }
        best.titan = true;
        break;
      }
    }
    const n = best.p.clone().sub(prev.p).normalize();
    return { p: best.p, dir: best.dir, n, passed: false };
  }

  update(dt, bird, cam) {
    this.t += dt;
    if (!this.enabled) { this.mesh.count = 0; this.disc.visible = false; return; }
    if (!this.route.length) this.reset(bird.pos, bird.axes().fwd);
    const next = this.route[0];
    // pass / miss detection against the ring plane
    const a = this.prevPos.clone().sub(next.p).dot(next.n);
    const bdist = bird.pos.clone().sub(next.p).dot(next.n);
    if (a < 0 && bdist >= 0) {
      const t = a / (a - bdist);
      const hit = this.prevPos.clone().lerp(bird.pos, t);
      if (hit.distanceTo(next.p) < RING_R + 1.5) this.pass(bird);
      else this.miss();
    } else if (bdist > 80 || bird.pos.distanceTo(next.p) > 2500) this.miss(bird.pos.distanceTo(next.p) > 2500);
    this.prevPos.copy(bird.pos);
    const rr = this.route;
    if (!rr.length) return;
    // visuals
    const up = new THREE.Vector3(0, 0, 1);
    rr.forEach((ring, i) => {
      this._q.setFromUnitVectors(up, ring.n);
      const pulse = i === 0 ? 1 + Math.sin(this.t * 6) * 0.06 : 1;
      this._m.compose(ring.p, this._q, new THREE.Vector3(pulse, pulse, pulse));
      this.mesh.setMatrixAt(i, this._m);
      const f = i === 0 ? 1 : Math.max(0.15, 0.7 - i * 0.1);
      const c = i === 0 ? [2.6, 1.9, 0.7] : [1.2 * f, 1.4 * f, 1.8 * f];
      this.mesh.setColorAt(i, new THREE.Color(...c));
    });
    this.mesh.count = rr.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.disc.visible = true;
    this.disc.position.copy(rr[0].p);
    this.disc.quaternion.setFromUnitVectors(up, rr[0].n);
    // off-screen arrow
    const v = rr[0].p.clone().project(cam);
    const behind = rr[0].p.clone().sub(cam.position).dot(new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)) < 0;
    this.arrow = { x: behind ? -v.x : v.x, y: behind ? -v.y : v.y, off: behind || Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.9, dist: bird.pos.distanceTo(rr[0].p) };
  }

  pass(bird) {
    const g = this.game;
    this.chain++;
    this.best = Math.max(this.best, this.chain);
    const ring = this.route.shift();
    g.award(ring.titan ? `RING ×${this.chain} · TITAN` : `RING ×${this.chain}`, 25 + Math.min(this.chain, 20) * 10 + (ring.titan ? 60 : 0));
    // reward: a shove of speed and some stamina
    const { fwd } = bird.axes();
    if (bird.vel.length() < bird.cfg.vBest * 2.6) bird.vel.addScaledVector(fwd, 5);
    bird.stamina = Math.min(1, bird.stamina + 0.25);
    g.head.fovKick = 5;
    g.audio.chime(this.chain);
    this.route.push(this.next(this.route[this.route.length - 1]));
  }

  miss(far) {
    if (this.chain > 2) this.game.toast('CHAIN BROKEN', `best ×${this.best}`);
    this.chain = 0;
    const b = this.game.body;
    if (far) { this.route = []; return; }
    // re-route the remaining chain from the bird
    this.route = [];
    const { fwd } = b.axes();
    this.reset(b.pos, fwd);
  }
}
