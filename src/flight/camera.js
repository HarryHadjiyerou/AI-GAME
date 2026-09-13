/* ═══════════════════════════════════════════════════════════
   Bird vision.

   The camera is not bolted to the body. A bird's head is the most
   stabilised part of it — the body rolls, pitches and bobs through a
   wingbeat while the head stays almost still in space, which is why
   footage from a bird looks calm even when the animal clearly is not.

   So: the body does the flying, and the head resists it.

     • roll is heavily damped — a 70° bank shows as maybe 25° of
       horizon tilt, which reads as a bank without turning the
       player's stomach over
     • the head lags the body through fast manoeuvres and catches up
     • it bobs very slightly against the wingbeat, out of phase
     • every few seconds it flicks somewhere and comes back, the way
       a real one checks its flanks

   Field of view opens up with speed, which is the oldest trick there
   is for making 40 km/h feel like 40 km/h.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { Noise, clamp, lerp, damp, smooth } from '../core/noise.js';

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();

export class BirdCamera {
  constructor(camera, cfg = {}) {
    this.camera = camera;
    this.noise = new Noise(cfg.seed ?? 505);

    // How much of the body's roll survives into the view. Birds counter-roll
    // almost completely; we keep a little so banking still reads.
    this.rollFollow = cfg.rollFollow ?? 0.34;
    this.pitchFollow = cfg.pitchFollow ?? 0.82;
    this.headLag = cfg.headLag ?? 0.085;
    this.motion = 1;                    // player-facing intensity multiplier

    this.baseFov = cfg.fov ?? 104;
    this.fovSpeedGain = cfg.fovSpeedGain ?? 26;
    this.eyeOffset = new THREE.Vector3(0, cfg.eyeHeight ?? 0.10, cfg.eyeForward ?? -0.16);

    this.headQuat = new THREE.Quaternion();
    this.smoothPos = new THREE.Vector3();
    this._init = false;

    // Saccades: a quick glance, then a slower return.
    this.glance = { active: false, t: 0, dur: 0, yaw: 0, pitch: 0, next: 2 + Math.random() * 4 };
    this.tremor = new THREE.Vector2();
    this.bob = 0;
    this.shake = 0;
    this.lookOffset = new THREE.Vector2();   // player free-look, radians
  }

  reset(flight) {
    this.headQuat.copy(flight.quaternion);
    this.smoothPos.copy(flight.position);
    this._init = true;
  }

  /** Nudge the view without changing where the bird is going. */
  freeLook(dx, dy) {
    this.lookOffset.x = clamp(this.lookOffset.x + dx, -1.1, 1.1);
    this.lookOffset.y = clamp(this.lookOffset.y + dy, -0.6, 0.6);
  }

  update(flight, dt, opts = {}) {
    if (!this._init) this.reset(flight);
    const m = this.motion;

    /* ── where the head sits ─────────────────────────────── */

    _v.copy(this.eyeOffset).applyQuaternion(flight.quaternion);
    _v.add(flight.position);
    // A touch of positional lag: the head is on a neck, not a bracket.
    this.smoothPos.x = damp(this.smoothPos.x, _v.x, 0.018, dt);
    this.smoothPos.y = damp(this.smoothPos.y, _v.y, 0.024, dt);
    this.smoothPos.z = damp(this.smoothPos.z, _v.z, 0.018, dt);

    /* ── what the head is looking at ─────────────────────── */

    // Rebuild the body attitude with the roll mostly taken out. Working in
    // YXZ Euler here is safe: this is a view transform, not the simulation.
    _e.setFromQuaternion(flight.quaternion, 'YXZ');
    const bodyBank = flight.bank;
    _e.z = bodyBank * this.rollFollow * m;
    _e.x = _e.x * this.pitchFollow;
    // Look a little into the turn, the way a bird leads its own bank.
    _e.y += -Math.sin(bodyBank) * 0.16 * m;
    _q.setFromEuler(_e);

    // The head catches up to the body rather than being welded to it.
    this.headQuat.slerp(_q, 1 - Math.exp(-dt / Math.max(1e-3, this.headLag)));

    /* ── procedural life ─────────────────────────────────── */

    const t = flight.time;

    // Micro-tremor: never still, never distracting.
    const tremorAmp = 0.0045 * m * (0.6 + 0.4 * clamp(flight.airspeed / 30, 0, 1.6));
    this.tremor.set(
      this.noise.simplex2(t * 3.1, 0) * tremorAmp,
      this.noise.simplex2(0, t * 2.7) * tremorAmp * 0.7
    );

    // Wingbeat bob, deliberately out of phase with the stroke: the body goes
    // up on the downstroke, the head mostly does not.
    const stroke = flight.wingStroke();
    this.bob = damp(this.bob, -stroke * 0.016 * m * (flight.flapping ? 1 : 0.25), 0.05, dt);

    // Saccades.
    const g = this.glance;
    g.next -= dt;
    if (!g.active && g.next <= 0) {
      g.active = true; g.t = 0;
      g.dur = 0.55 + Math.random() * 0.85;
      const side = Math.random() < 0.5 ? -1 : 1;
      g.yaw = side * (0.22 + Math.random() * 0.48);
      g.pitch = (Math.random() - 0.5) * 0.22;
      // Flick more often when there is something to look at below.
      g.next = 2.4 + Math.random() * 5.5;
    }
    let glanceYaw = 0, glancePitch = 0;
    if (g.active) {
      g.t += dt;
      const u = clamp(g.t / g.dur, 0, 1);
      // Fast out (a flick), slow back (a drift) — that asymmetry is the tell.
      const shape = u < 0.18 ? smooth(0, 0.18, u) : 1 - smooth(0.18, 1, u);
      glanceYaw = g.yaw * shape * m;
      glancePitch = g.pitch * shape * m;
      if (u >= 1) g.active = false;
    }

    // Airframe shake: buffeting in a stall, rush in a stoop, thump on impact.
    const buffet = flight._stalled * 0.02 + clamp((flight.airspeed - 40) / 60, 0, 1) * 0.006;
    this.shake = damp(this.shake, buffet * m, 0.08, dt);
    const shakeX = this.noise.simplex2(t * 22, 3) * this.shake;
    const shakeY = this.noise.simplex2(4, t * 19) * this.shake;

    /* ── assemble ────────────────────────────────────────── */

    _e.set(
      this.tremor.y + glancePitch + shakeY + this.lookOffset.y,
      this.tremor.x + glanceYaw + shakeX + this.lookOffset.x,
      0, 'YXZ'
    );
    _q2.setFromEuler(_e);

    this.camera.quaternion.copy(this.headQuat).multiply(_q2);
    this.camera.position.copy(this.smoothPos);
    this.camera.position.y += this.bob;

    /* ── field of view ───────────────────────────────────── */

    const fast = clamp((flight.airspeed - flight.cfg.cruiseSpeed) /
                       (flight.cfg.cruiseSpeed * 2.2), 0, 1);
    const targetFov = this.baseFov + fast * this.fovSpeedGain * m;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = damp(this.camera.fov, targetFov, 0.35, dt);
      this.camera.updateProjectionMatrix();
    }

    // Free-look springs back on its own.
    this.lookOffset.multiplyScalar(Math.exp(-dt / 0.8));

    // Values the post stack and the wings want.
    this.speedBlur = fast;
    this.bankReadout = bodyBank;
    void opts;
    return this.camera;
  }

  setFov(deg) {
    this.baseFov = deg;
    this.camera.fov = deg;
    this.camera.updateProjectionMatrix();
  }
}

export { lerp };
