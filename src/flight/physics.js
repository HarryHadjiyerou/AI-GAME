/* ═══════════════════════════════════════════════════════════
   Flight.

   Not an aircraft with a throttle. The bird has momentum, and the
   only things the player really commands are how much the wings are
   biting the air (angle of attack), how far the bird is banked, and
   whether it is flapping or tucked.

   Everything else falls out of the forces:

     lift  = ½ρV²·S·CL(α)   perpendicular to the airflow
     drag  = ½ρV²·S·CD      against it
     weight= mg             always
     flap  = an impulse along the body axis that costs stamina

   Because lift acts perpendicular to the *airflow* and rolls with the
   body, banking tilts the lift vector sideways and the bird turns.
   Nothing fakes the turn — it is the horizontal component of lift,
   which is also why a hard turn bleeds height unless you pull.

   Climb → glide → dive → speed → pull up → height is therefore not a
   scripted loop, it is just what this system does.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { clamp, lerp, damp, smooth, Noise } from '../core/noise.js';

const RHO = 1.225;                 // air density at sea level, kg/m³
const G = 9.81;

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _lift = new THREE.Vector3();
const _drag = new THREE.Vector3();
const _side = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _vhat = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _tmpR = new THREE.Vector3();
const _tmpU = new THREE.Vector3();

export const FLIGHT_STATE = {
  GLIDE: 'GLIDE',
  FLAP: 'FLAP',
  DIVE: 'DIVE',
  SOAR: 'SOAR',
  STALL: 'STALL',
  WATER: 'WATER',
  RECOVER: 'RECOVER',
};

export class Flight {
  /**
   * @param {object} cfg  bird configuration (see config/birds.js)
   * @param {object} world { height(x,z), waterLevel, wind, thermal(x,z,t) }
   */
  constructor(cfg, world) {
    this.cfg = cfg;
    this.world = world;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();

    this.heading = 0;         // rad, 0 = -Z
    this.bank = 0;            // rad, positive = right wing down
    this.alpha = cfg.trimAlpha ?? 0.06;   // angle of attack the wing is holding
    this.alphaCmd = this.alpha;           // what the player is asking for
    this.sideslip = 0;
    this.pitchAngle = 0;      // body pitch, derived

    this.tuck = 0;            // 0 = wings out, 1 = folded
    this.flapPhase = 0;       // 0..1 through a wingbeat
    this.flapping = false;
    this.stamina = 1;
    this.state = FLIGHT_STATE.GLIDE;

    this.airspeed = 0;
    this.load = 1;            // g-load, for camera shake and wing bend
    this.vario = 0;           // vertical speed, m/s
    this.inThermal = 0;       // 0..1, for the HUD
    this.underwater = false;
    this._stalled = 0;        // 0..1 blend into post-stall behaviour
    this._aEff = 0;           // the angle of attack the air actually sees
    this.recoverTimer = 0;
    this.groundClearance = 0;
    this.distance = 0;
    this.time = 0;

    this._noise = new Noise(cfg.seed ?? 77);
    this._wind = new THREE.Vector3();
    this._lastFlap = -10;
    this.events = [];         // drained by the game each frame
  }

  spawn(x, y, z, headingRad = 0, speed = null) {
    this.position.set(x, y, z);
    this.heading = headingRad;
    this.bank = 0;
    this.alpha = this.alphaCmd = this.cfg.trimAlpha ?? 0.06;
    this.pitchAngle = 0;
    _e.set(0, headingRad, 0, 'YXZ');
    this.quaternion.setFromEuler(_e);
    const v = speed ?? this.cfg.cruiseSpeed;
    this.velocity.set(-Math.sin(headingRad) * v, -0.5, -Math.cos(headingRad) * v);
    this.stamina = 1;
    this.state = FLIGHT_STATE.GLIDE;
    this._sync();
  }

  /* ── the wind field ─────────────────────────────────────── */

  /**
   * Ambient wind plus thermals. Thermals are columns pinned to the terrain
   * — over sunlit rock and open ground, not over water — so hunting for lift
   * means reading the landscape, which is the whole sport.
   */
  windAt(p, t, out) {
    const w = this.world;
    out.copy(w.wind ?? _v.set(0, 0, 0));

    let thermal = 0;
    if (w.thermals !== false) {
      const n = this._noise;
      const s = this.cfg.thermalScale ?? 0.0016;
      // The whole field is advected downwind, so a bird that centres a core
      // stays in it and drifts with it — which is what soaring actually is.
      const wx = (w.wind?.x ?? 0), wz = (w.wind?.z ?? 0);
      const ax = p.x - wx * t, az = p.z - wz * t;
      // Two scales of column: broad areas of rising air with cores inside.
      const broad = n.simplex2(ax * s * 0.35, az * s * 0.35);
      const core = n.simplex2(ax * s + t * 0.0008, az * s - t * 0.0006);
      let lift = smooth(0.15, 0.72, broad * 0.5 + core * 0.75);

      const ground = w.height(p.x, p.z);
      // Thermals are born at the surface and die out with altitude.
      const above = p.y - ground;
      const ceiling = w.thermalCeiling ?? 1400;
      lift *= smooth(0, 120, above) * (1 - smooth(ceiling * 0.55, ceiling, above));
      if (w.waterLevel !== undefined && ground <= w.waterLevel + 1) lift *= 0.12;

      thermal = lift * (w.thermalStrength ?? 4.0);
      out.y += thermal;
    }

    // Ridge lift: air pushed up the windward face of a slope.
    if (w.ridgeLift !== false) {
      const e = 26;
      const hx = (w.height(p.x + e, p.z) - w.height(p.x - e, p.z)) / (2 * e);
      const hz = (w.height(p.x, p.z + e) - w.height(p.x, p.z - e)) / (2 * e);
      const above = p.y - w.height(p.x, p.z);
      const decay = Math.exp(-above / 220);
      const wind = w.wind ?? _v.set(0, 0, 0);
      const up = -(hx * wind.x + hz * wind.z);       // wind blowing uphill
      out.y += clamp(up, -6, 9) * decay * (w.ridgeStrength ?? 1.0);
    }

    this.inThermal = clamp(thermal / Math.max(0.1, (w.thermalStrength ?? 4) * 0.55), 0, 1);
    return out;
  }

  /* ── the step ───────────────────────────────────────────── */

  /**
   * @param {object} input { roll:-1..1, pitch:-1..1, flap:bool, tuck:0..1 }
   */
  update(dt, input) {
    dt = Math.min(dt, 1 / 25);                 // never let a stall spike the sim
    this.time += dt;
    const cfg = this.cfg;
    const w = this.world;

    /* ── read the air ────────────────────────────────────── */

    this.windAt(this.position, this.time, this._wind);
    _rel.copy(this.velocity).sub(this._wind);        // airflow over the wing
    const V = _rel.length();
    this.airspeed = this.velocity.length();

    // Body axes as they stand at the top of the frame.
    _f.set(0, 0, -1).applyQuaternion(this.quaternion);
    _u.set(0, 1, 0).applyQuaternion(this.quaternion);
    _r.set(1, 0, 0).applyQuaternion(this.quaternion);

    // Angle of attack and sideslip, measured in the body frame — which is the
    // only frame in which they mean anything. Deriving pitch from the world
    // vertical instead is what turns a banked glide into a sideways fall.
    let aEff = 0, beta = 0;
    if (V > 0.4) {
      _vhat.copy(_rel).multiplyScalar(1 / V);
      const fwdC = _vhat.dot(_f);
      aEff = Math.atan2(-_vhat.dot(_u), Math.max(0.08, fwdC));
      beta = Math.atan2(_vhat.dot(_r), Math.max(0.08, fwdC));
    }
    this._aEff = aEff;
    this.sideslip = beta;

    const speedFactor = clamp(V / cfg.cruiseSpeed, 0.2, 2.2);

    /* ── control integration, on body axes ───────────────── */

    // Bank read off the wings against the horizon, for the servo and the HUD.
    const bankAngle = Math.atan2(_r.y, _u.y === 0 ? 1e-6 : _u.y);
    this.bank = -Math.atan2(_r.y, Math.hypot(_u.y, 1e-6));
    void bankAngle;

    // Roll: the input asks for a bank ANGLE, and a rate-limited servo flies to
    // it. A rate command would send any sustained input straight to the stops,
    // which is wrong for a stick and disastrous for a tilted phone — half a
    // tilt has to mean half a bank.
    const wantBank = input.roll * cfg.maxBank;
    let p = clamp((wantBank - this.bank) * (cfg.rollServo ?? 3.2),
                  -cfg.rollRate, cfg.rollRate) * clamp(speedFactor, 0.12, 1.5);
    // Left alone, the wings come back level on their own.
    p += -this.bank * (1 / (cfg.rollCentre ?? 2.4)) * (1 - Math.min(1, Math.abs(input.roll)));

    // Pitch input commands an angle of attack, not an attitude. A servo then
    // rotates the body until the wing actually sees it. This is why pulling
    // back trades speed for height automatically, and why over-pulling stalls.
    this.alphaCmd += input.pitch * cfg.alphaRate * dt;
    // Folding the wings also drops the trim: a tucked bird rides at a low
    // angle of attack, which is what lets a stoop keep going down instead of
    // ballooning back out of it.
    const trim = cfg.trimAlpha + this.tuck * (cfg.tuckAlphaBias ?? -0.11);
    this.alphaCmd = damp(this.alphaCmd, trim, cfg.alphaCentre ?? 1.6,
                         dt * (1 - Math.min(1, Math.abs(input.pitch))));
    this.alphaCmd = clamp(this.alphaCmd, cfg.alphaMin, cfg.alphaMax);
    this.alpha = this.alphaCmd;

    const pitchGain = (cfg.pitchServo ?? 3.4) * clamp(speedFactor, 0.25, 1.4);
    const maxQ = (cfg.maxPitchRate ?? 1.2) * clamp(speedFactor, 0.3, 1.3);
    let qRate = clamp((this.alphaCmd - aEff) * pitchGain, -maxQ, maxQ);

    // Yaw: the bird weathervanes out of any sideslip, and gets a little help
    // from the tail so a flick of bank bites straight away.
    let rRate = -beta * (1 / (cfg.yawLag ?? 0.28));
    rRate += -Math.sin(this.bank) * (cfg.yawAssist ?? 0.5);

    // Tuck folds the wings: less area, far less drag, and less authority.
    this.tuck = damp(this.tuck, clamp(input.tuck, 0, 1), 0.22, dt);
    const authority = 1 - this.tuck * 0.45;
    p *= authority; qRate *= authority; rRate *= authority;

    // Apply the rates about the body axes.
    _q.setFromAxisAngle(_f, p * dt);        this.quaternion.premultiply(_q);
    _f.set(0, 0, -1).applyQuaternion(this.quaternion);
    _r.set(1, 0, 0).applyQuaternion(this.quaternion);
    _u.set(0, 1, 0).applyQuaternion(this.quaternion);
    _q.setFromAxisAngle(_r, qRate * dt);    this.quaternion.premultiply(_q);
    _u.set(0, 1, 0).applyQuaternion(this.quaternion);
    _q.setFromAxisAngle(_u, rRate * dt);    this.quaternion.premultiply(_q);
    this.quaternion.normalize();

    _f.set(0, 0, -1).applyQuaternion(this.quaternion);
    _u.set(0, 1, 0).applyQuaternion(this.quaternion);
    _r.set(1, 0, 0).applyQuaternion(this.quaternion);

    /* ── flapping ────────────────────────────────────────── */

    let flapForce = 0;
    const wantFlap = input.flap && this.stamina > 0.02 && this.tuck < 0.6 && !this.underwater;
    this.flapping = wantFlap;
    if (wantFlap) {
      this.flapPhase += dt / cfg.flapPeriod;
      if (this.flapPhase >= 1) {
        this.flapPhase -= 1;
        this._lastFlap = this.time;
        this.events.push('wingbeat');
      }
      // Thrust lives in the downstroke — the first half of the cycle.
      const stroke = Math.max(0, Math.sin(this.flapPhase * Math.PI * 2));
      // A flapping wing cannot push air backwards faster than it is already
      // moving through it, so thrust falls away as speed builds.
      const bite = clamp(1 - V / (cfg.flapSpeedLimit ?? cfg.cruiseSpeed * 3.0), 0.06, 1);
      flapForce = cfg.flapPower * stroke * (0.55 + 0.45 * this.stamina) * bite;
      this.stamina = clamp(this.stamina - cfg.flapCost * dt, 0, 1);
    } else {
      this.flapPhase = this.flapPhase > 0 ? (this.flapPhase + dt / cfg.flapPeriod) % 1 : 0;
      const rest = this.inThermal > 0.45 ? cfg.staminaSoar : cfg.staminaGlide;
      this.stamina = clamp(this.stamina + rest * dt, 0, 1);
    }

    /* ── forces ──────────────────────────────────────────── */

    const acc = _acc.set(0, 0, 0);

    if (V > 0.05) {
      const area = cfg.wingArea * (1 - this.tuck * (cfg.tuckAreaLoss ?? 0.62));
      const qDyn = 0.5 * RHO * V * V * area;

      // CL: linear until the wing gives up, then flat-plate behaviour.
      const aStall = cfg.stallAlpha;
      const linear = cfg.clAlpha * aEff + (cfg.cl0 ?? 0.12);
      const plate = 2 * Math.sin(aEff) * Math.cos(aEff);
      const stalled = smooth(aStall, aStall * 1.55, Math.abs(aEff));
      const CL = lerp(linear, plate, stalled) * (1 - this.tuck * 0.55);

      // CD: profile + induced. Tucking collapses the wing's profile drag,
      // which is exactly why a stoop works.
      const k = 1 / (Math.PI * (cfg.oswald ?? 0.85) * cfg.aspectRatio);
      const cd0 = lerp(cfg.cd0, cfg.cd0Tucked ?? cfg.cd0 * 0.35, this.tuck);
      const CD = cd0 + k * CL * CL + stalled * 0.55 + Math.abs(Math.sin(beta)) * 0.35;

      // The body keeps its drag whatever the wings do. Without this term a
      // folded bird has almost no drag area left and accelerates to speeds no
      // animal has ever reached — it is what sets terminal velocity.
      const bodyDrag = 0.5 * RHO * V * V * (cfg.bodyArea ?? cfg.wingArea * 0.05)
                     * (cfg.bodyCd ?? 0.35);

      // Lift acts perpendicular to the airflow, in the plane through the body's
      // up axis — so it rolls with the bird, and banking curves the flight path.
      _side.copy(_vhat).cross(_u);
      if (_side.lengthSq() < 1e-6) _side.copy(_r);
      _side.normalize();
      _lift.copy(_side).cross(_vhat).normalize().multiplyScalar(qDyn * CL);
      _drag.copy(_vhat).multiplyScalar(-(qDyn * CD + bodyDrag));

      acc.addScaledVector(_lift, 1 / cfg.mass);
      acc.addScaledVector(_drag, 1 / cfg.mass);

      this.load = _lift.length() / (cfg.mass * G);
      this._stalled = stalled;
      this._CL = CL;
    } else {
      this._stalled = 0;
      this.load = 0;
      this._CL = 0;
    }

    acc.y -= G;

    // Flap thrust. Once the bird is moving, a wingbeat is thrust — the lift
    // it makes is already accounted for by the wing term above, and adding it
    // twice just balloons the bird and bleeds its speed. The vertical share
    // only matters near a standstill, where it is the difference between
    // getting airborne and not.
    if (flapForce > 0) {
      acc.addScaledVector(_f, flapForce / cfg.mass);
      const upShare = clamp(1 - V / cfg.cruiseSpeed, 0, 1) * (cfg.flapLiftShare ?? 1.1);
      if (upShare > 0) acc.addScaledVector(_u, flapForce * upShare / cfg.mass);
    }

    this.velocity.addScaledVector(acc, dt);

    // Derived attitude, for the HUD, the camera and the wings.
    _e.setFromQuaternion(this.quaternion, 'YXZ');
    this.heading = _e.y;
    this.pitchAngle = _e.x;

    /* ── integrate and collide ───────────────────────────── */

    this.position.addScaledVector(this.velocity, dt);
    this.distance += this.airspeed * dt;
    this.vario = this.velocity.y;

    this._water(dt);
    this._ground(dt);
    this._sync();
    this._classify();

    return this;
  }

  _water(dt) {
    const w = this.world;
    if (w.waterLevel === undefined) { this.underwater = false; return; }
    const below = w.waterLevel - this.position.y;
    if (below <= 0) {
      if (this.underwater) { this.events.push('surface'); this.underwater = false; }
      return;
    }
    if (!this.underwater) {
      this.underwater = true;
      this.events.push(this.airspeed > 12 ? 'splash-hard' : 'splash');
    }
    // Water: heavy drag, buoyancy that grows with depth, and a shove back
    // towards the surface. Enough to make a dive-bomb read; not a swim sim.
    const depth = below;
    const drag = clamp(this.airspeed * 0.42, 0, 22);
    this.velocity.multiplyScalar(Math.max(0, 1 - drag * dt));
    this.velocity.y += (6.5 + clamp(depth, 0, 6) * 3.4) * dt;
    this.stamina = clamp(this.stamina - 0.22 * dt, 0, 1);
    if (depth > (this.cfg.maxDiveDepth ?? 7)) {
      this.position.y = w.waterLevel - (this.cfg.maxDiveDepth ?? 7);
      this.velocity.y = Math.max(this.velocity.y, 2.5);
    }
  }

  _ground(dt) {
    const w = this.world;
    const h = w.height(this.position.x, this.position.z);
    const clearance = this.cfg.groundClearance ?? 1.2;
    this.groundClearance = this.position.y - h;

    if (this.position.y > h + clearance) {
      if (this.recoverTimer > 0) this.recoverTimer = Math.max(0, this.recoverTimer - dt);
      return;
    }
    if (w.waterLevel !== undefined && h <= w.waterLevel) return;   // that is water, not rock

    // Contact. Not a death — a scuff, a stumble, and an automatic pull-up,
    // because dying to terrain every ten seconds is not the fantasy.
    const speed = this.velocity.length();
    this.position.y = h + clearance;
    if (this.recoverTimer <= 0) this.events.push(speed > 14 ? 'crash' : 'scuff');
    this.recoverTimer = speed > 14 ? 1.5 : 0.6;

    // Slide along the surface rather than sticking to it.
    const e = 3;
    const nx = (w.height(this.position.x - e, this.position.z) - w.height(this.position.x + e, this.position.z)) / (2 * e);
    const nz = (w.height(this.position.x, this.position.z - e) - w.height(this.position.x, this.position.z + e)) / (2 * e);
    _v.set(nx, 1, nz).normalize();
    const into = this.velocity.dot(_v);
    if (into < 0) this.velocity.addScaledVector(_v, -into * 1.25);
    this.velocity.multiplyScalar(speed > 14 ? 0.55 : 0.86);
    this.velocity.y = Math.max(this.velocity.y, 1.5);
    this.alpha = Math.min(this.cfg.alphaMax, this.alpha + 0.12);
    this.stamina = clamp(this.stamina - (speed > 14 ? 0.18 : 0.04), 0, 1);
  }

  _sync() {
    _e.setFromQuaternion(this.quaternion, 'YXZ');
    this.heading = _e.y;
    this.pitchAngle = _e.x;
    this.bank = -Math.atan2(
      new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion).y,
      Math.hypot(new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion).y, 1e-6)
    );
  }

  _classify() {
    if (this.recoverTimer > 0) this.state = FLIGHT_STATE.RECOVER;
    else if (this.underwater) this.state = FLIGHT_STATE.WATER;
    else if (this._stalled > 0.45) this.state = FLIGHT_STATE.STALL;
    else if (this.tuck > 0.45 || (this.vario < -7 && this.alpha < 0.05)) this.state = FLIGHT_STATE.DIVE;
    else if (this.flapping) this.state = FLIGHT_STATE.FLAP;
    else if (this.inThermal > 0.45 && this.vario > 0) this.state = FLIGHT_STATE.SOAR;
    else this.state = FLIGHT_STATE.GLIDE;
  }

  drainEvents() {
    if (!this.events.length) return null;
    const e = this.events.slice();
    this.events.length = 0;
    return e;
  }

  /** Wing pose for the renderer: 0 = folded, 1 = fully extended. */
  wingExtension() {
    return clamp(1 - this.tuck * 0.85, 0.12, 1);
  }

  /** Where in the wingbeat we are, 0 at the top of the upstroke. */
  wingStroke() {
    if (!this.flapping) {
      // Settle to a slight dihedral rather than a dead flat pose.
      return Math.sin(this.time * 0.9) * 0.035;
    }
    return Math.sin(this.flapPhase * Math.PI * 2);
  }
}
