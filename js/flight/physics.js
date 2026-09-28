// Simplified bird aerodynamics: lift from angle of attack, parasitic + induced drag, gravity,
// flapping thrust, wing tuck for dives, and weathervane stability. Units: metres, seconds, kg.
import * as THREE from 'three';

const _air = new THREE.Vector3(), _fwd = new THREE.Vector3(), _up = new THREE.Vector3(), _right = new THREE.Vector3();
const _f = new THREE.Vector3(), _tmp = new THREE.Vector3(), _dq = new THREE.Quaternion(), _axis = new THREE.Vector3();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class BirdBody {
  constructor(cfg) {
    this.cfg = cfg;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.mode = 'flying';
    this.tuck = 0;
    this.flapPhase = 0;
    this.flapRate = 0; // Hz currently applied
    this.flapAmt = 0; // 0..1 how hard we're flapping
    this.stamina = 1;
    this.takeoffTimer = 0;
    this.alpha = 0; this.beta = 0; this.bank = 0; this.airspeed = 0; this.gLoad = 1; this.stall = 0;
    this.lastForce = new THREE.Vector3();
    this.boosting = false;
    this.trickRoll = 0; this.rollT = 0; this.rollDir = 0; this.rollDone = 0;
    this.pullout = 0; // 0..1, how hard the auto swoop is pulling out of a dive
    this.wasDiving = false;
    this._vq = new THREE.Quaternion();
  }

  // Orientation including the cosmetic barrel-roll offset (for camera and wings).
  get visualQuat() {
    if (!this.trickRoll) return this.quat;
    return this._vq.copy(this.quat).multiply(_dq.setFromAxisAngle(_axis.set(0, 0, 1), -this.trickRoll));
  }

  startRoll(dir) {
    if (this.rollDir || this.mode !== 'flying') return false;
    this.rollDir = dir; this.rollT = 0;
    this.rollDur = this.cfg.rollDur || 0.8;
    return true;
  }

  axes() {
    _fwd.set(0, 0, -1).applyQuaternion(this.quat);
    _up.set(0, 1, 0).applyQuaternion(this.quat);
    _right.set(1, 0, 0).applyQuaternion(this.quat);
    return { fwd: _fwd, up: _up, right: _right };
  }

  // Face a horizontal heading (radians, 0 = -Z) with an optional pitch.
  setHeading(yaw, pitch = 0) {
    this.quat.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  }

  takeOff() {
    const c = this.cfg;
    const { fwd } = this.axes();
    const flat = _tmp.set(fwd.x, 0, fwd.z).normalize();
    this.mode = 'flying';
    this.vel.copy(flat).multiplyScalar(c.vStall * 0.45).add(new THREE.Vector3(0, 3.2, 0));
    this.setHeading(Math.atan2(-flat.x, -flat.z), 0.25);
    this.takeoffTimer = 2.2;
    this.flapAmt = 1;
    this.flapRate = this.cfg.flapHz;
  }

  step(dt, input, env) {
    // barrel roll: a full 360 deg roll about the flight path; flight forces stay wings-level meanwhile
    this.rollDone = 0;
    if (this.rollDir) {
      this.rollT += dt;
      const t = Math.min(1, this.rollT / this.rollDur);
      this.trickRoll = this.rollDir * Math.PI * 2 * (t * t * (3 - 2 * t));
      if (t >= 1) { this.rollDone = this.rollDir; this.rollDir = 0; this.trickRoll = 0; }
    }
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.substep(h, input, env);
  }

  substep(dt, input, env) {
    const c = this.cfg;
    if (this.mode !== 'flying' && this.mode !== 'underwater') return;
    const { fwd, up, right } = this.axes();
    const wind = env.wind(this.pos);
    _air.copy(this.vel).sub(wind);
    const V = Math.max(_air.length(), 0.01);
    const vf = _air.dot(fwd), vu = _air.dot(up), vr = _air.dot(right);
    this.alpha = Math.atan2(-vu, Math.max(vf, 0.01));
    this.beta = Math.atan2(vr, Math.max(vf, 0.01));
    this.airspeed = V;

    // --- controls / wing state ---
    this.takeoffTimer = Math.max(0, this.takeoffTimer - dt);
    const wantBoost = input.boost && this.stamina > 0.02;
    this.boosting = wantBoost;
    const wantFlap = input.flap || wantBoost || this.takeoffTimer > 0;
    const tuckTarget = input.dive ? 1 : wantFlap ? 0 : clamp(-input.pitch - 0.6, 0, 1) * 0.5;
    this.tuck += (tuckTarget - this.tuck) * Math.min(1, dt * 6);
    const targetRate = wantBoost ? c.boostHz : wantFlap ? c.flapHz : 0;
    this.flapRate += (targetRate - this.flapRate) * Math.min(1, dt * 5);
    this.flapAmt += ((wantFlap ? 1 : 0) - this.flapAmt) * Math.min(1, dt * 6);
    if (this.flapAmt > 0.02) this.flapPhase += this.flapRate * dt * Math.PI * 2;
    else this.flapPhase += (Math.round(this.flapPhase / (Math.PI * 2)) * Math.PI * 2 - this.flapPhase) * Math.min(1, dt * 4);
    if (wantBoost) this.stamina = Math.max(0, this.stamina - dt / c.stamina);
    else this.stamina = Math.min(1, this.stamina + dt / (c.stamina * (wantFlap ? 3.5 : 1.6)));

    // --- aerodynamics ---
    const rhoF = env.altitude > c.ceiling ? Math.exp(-(env.altitude - c.ceiling) / 120) : 1;
    const q = 0.5 * c.rho * rhoF * V * V;
    const S = c.S * (1 + (c.tuckArea - 1) * this.tuck);
    const aStall = c.clMax / c.alphaSlope;
    const aa = Math.abs(this.alpha);
    let cl = c.alphaSlope * this.alpha;
    if (aa > aStall) cl = Math.sign(this.alpha) * c.clMax * (1 - 0.55 * smooth(aStall, aStall * 2.2, aa));
    this.stall = smooth(aStall * 0.95, aStall * 1.6, aa);
    const L = q * S * cl;
    // parasitic drag, with an overspeed penalty for open wings so diving pays to tuck
    const vb = V / c.vBest, vd = V / c.vDive;
    const cdaOpen = c.cdaOpen * (1 + Math.max(0, vb - 1.5) ** 2 * 6);
    const cdaTuck = c.cdaTuck * (1 + Math.max(0, vd - 1) ** 2 * 20);
    const cda = cdaOpen + (cdaTuck - cdaOpen) * this.tuck;
    const D = q * (cda + S * c.k * cl * cl) * (1 + this.flapAmt * 0.15);
    const m = c.mass;

    // lift direction: perpendicular to airflow, in the body's vertical plane
    const airDir = _tmp.copy(_air).divideScalar(V);
    _f.crossVectors(right, airDir).normalize().multiplyScalar(L);
    _f.addScaledVector(airDir, -D);
    _f.y -= m * c.g;

    // flapping: thrust fading with speed + extra lift at low speed (take-off / hovering)
    if (this.flapAmt > 0.01) {
      const power = wantBoost ? c.boostThrust : c.flapThrust;
      const stroke = 0.65 + 0.35 * Math.sin(this.flapPhase);
      const thrust = m * c.g * power * this.flapAmt * stroke * clamp(1 - V / (c.vBest * (wantBoost ? 3.4 : 2.3)), 0, 1);
      _f.addScaledVector(fwd, thrust * (1 - this.tuck * 0.7));
      const lowSpeed = 1 - smooth(c.vStall * 0.5, c.vStall * 1.45, V);
      const lift = m * c.g * c.flapLift * this.flapAmt * lowSpeed * stroke * rhoF * (this.takeoffTimer > 0 ? 1.35 : 1);
      _f.x += up.x * lift * 0.4; _f.y += lift * (0.6 + 0.4 * up.y); _f.z += up.z * lift * 0.4;
    }
    if (this.mode === 'underwater') {
      _f.copy(this.vel).multiplyScalar(-m * 3.5);
      _f.y += m * c.g * 1.6; // buoyancy
    }
    this.lastForce.copy(_f);
    this.gLoad = L / (m * c.g);
    this.vel.addScaledVector(_f, dt / m);
    this.pos.addScaledVector(this.vel, dt);

    // --- rotation ---
    const vfac = clamp(V / c.vBest, 0.15, 2.0);
    const authority = 0.35 + 0.65 * smooth(0, c.vStall, V);
    // Auto-trim: aim for the lift needed to hold the current turn (1 g when level), never beyond best-glide AoA.
    const bank0 = Math.asin(clamp(-right.y, -1, 1));
    const sb = Math.abs(Math.sin(bank0));
    const overspeed = clamp((V - c.vBest) / c.vBest, 0, 1);
    let wantLift = m * c.g / Math.max(Math.cos(bank0), 0.4) * (0.97 + 0.03 * (1 - sb) + 0.45 * overspeed * (1 - this.flapAmt));
    if (this.flapAmt > 0.05) {
      // Flapping: steer the flight path towards a gentle climb (a shallower one when boosting for speed).
      const gamma = Math.asin(clamp(this.vel.y / Math.max(this.vel.length(), 0.1), -1, 1));
      const gT = wantBoost ? 0.12 : 0.3;
      const pathLift = m * (c.g * Math.cos(gamma) + (gT - gamma) * 2.2 * Math.max(V, 4)) / Math.max(Math.cos(bank0), 0.4);
      wantLift += (clamp(pathLift, 0.3 * m * c.g, 2.2 * m * c.g) - wantLift) * this.flapAmt;
    }
    // swoop: after releasing DIVE at speed the bird pulls out, converting speed into height
    if (input.dive) this.pullout = 0;
    else if (this.wasDiving && V > c.vBest * 1.15) this.pullout = 1;
    if (this.pullout > 0) {
      const pathDown = Math.max(0, -this.vel.y / Math.max(this.vel.length(), 1));
      wantLift += m * c.g * (1.2 + 1.8 * pathDown) * this.pullout * (1 - Math.min(1, Math.abs(input.pitch) * 2.5));
      this.pullout = Math.max(0, this.pullout - dt * (pathDown < 0.05 ? 1.2 : 0.15));
    }
    this.wasDiving = input.dive || (this.wasDiving && this.tuck > 0.3);
    const alphaHold = wantLift / Math.max(q * S * c.alphaSlope, 1e-3);
    const alphaCap = Math.min(c.alphaTrim * (1 + 1.8 * sb + 0.5 * this.flapAmt + 2.5 * this.pullout), (c.clMax * 0.85) / c.alphaSlope);
    const alphaTarget = Math.min(alphaHold, alphaCap) * (1 - this.tuck);
    let pitchRate = input.pitch * c.pitchRate * authority - (this.alpha - alphaTarget) * c.stability * 2 * vfac;
    // DIVE: tuck and steer the nose down towards a steep plunge (~70 deg)
    if (input.dive && this.mode === 'flying') {
      const noseErr = Math.asin(clamp(fwd.y, -1, 1)) + 1.2;
      pitchRate -= clamp(noseErr, 0, 1) * 1.8 * (1 - Math.max(0, input.pitch) * 0.8);
    }
    // at very low speed gravity pulls the nose down
    pitchRate -= (1 - smooth(c.vStall * 0.3, c.vStall, V)) * Math.max(0, fwd.y + 0.2) * 1.2 * (this.takeoffTimer > 0 ? 0.15 : 1);
    const bank = Math.asin(clamp(-right.y, -1, 1));
    this.bank = bank;
    const targetBank = input.roll * c.maxBank * (1 - this.tuck * 0.5);
    const rollRate = clamp((targetBank - bank) * c.rollRate, -c.rollRate * 0.8, c.rollRate * 0.8);
    let yawRate = -this.beta * c.stability * 1.5 * vfac;
    // Feed-forward: rotate the body with the flight path so AoA/sideslip don't lag in turns.
    const Vg = Math.max(this.vel.length(), 1);
    pitchRate += (_f.dot(up) / m) / Vg * smooth(c.vStall * 0.3, c.vStall * 0.8, V);
    yawRate -= (_f.dot(right) / m) / Vg * smooth(c.vStall * 0.3, c.vStall * 0.8, V);
    // keep the nose from going past vertical when pitching hard
    if (Math.abs(fwd.y) > 0.97) pitchRate *= 0.3;
    this.rotateLocal(1, 0, 0, pitchRate * dt);
    this.rotateLocal(0, 1, 0, yawRate * dt);
    this.rotateLocal(0, 0, 1, -rollRate * dt);
    this.quat.normalize();
  }

  rotateLocal(x, y, z, angle) {
    if (angle === 0) return;
    _dq.setFromAxisAngle(_axis.set(x, y, z), angle);
    this.quat.multiply(_dq);
  }
}
