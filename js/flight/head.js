// Bird-eye camera. The head is stabilised relative to the body (birds hold their heads level),
// with occasional glances, micro twitches and a gentle bob synced to the wing beat.
import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

class Spring {
  constructor(k = 60, d = 12) { this.x = 0; this.v = 0; this.t = 0; this.k = k; this.d = d; }
  update(dt) { const a = (this.t - this.x) * this.k - this.v * this.d; this.v += a * dt; this.x += this.v * dt; return this.x; }
}

export class Head {
  constructor(camera, cfg) {
    this.camera = camera;
    this.cfg = cfg;
    this.yaw = new Spring(90, 16); // glance offsets
    this.pitch = new Spring(90, 16);
    this.tilt = new Spring(140, 14); // twitch roll
    this.look = new Spring(8, 5); // look into turns
    this.nextGlance = 2 + Math.random() * 4;
    this.glanceHold = 0;
    this.nextTwitch = 1 + Math.random() * 3;
    this.smoothQ = new THREE.Quaternion();
    this.init = false;
    this.shake = 0;
    this.fovKick = 0;
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this.lookInput = new THREE.Vector2(); // manual look (desktop mouse/right stick), -1..1
  }

  update(dt, body, state) {
    const cfg = this.cfg;
    const cam = this.camera;
    const perched = body.mode === 'perched' || body.mode === 'water';
    // --- glances: quick saccade, hold, return ---
    this.nextGlance -= dt;
    if (this.nextGlance < 0) {
      const busy = state.speed > body.cfg.vBest * 1.8 || body.tuck > 0.5;
      if (!busy) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.yaw.t = side * (0.18 + Math.random() * (perched ? 0.9 : 0.35)) * cfg.head.glance;
        this.pitch.t = (Math.random() - 0.6) * (perched ? 0.4 : 0.15);
        this.glanceHold = 0.35 + Math.random() * (perched ? 1.6 : 0.7);
      }
      this.nextGlance = (perched ? 1.5 : 3.5) + Math.random() * (perched ? 3 : 6) / cfg.head.glance;
    }
    if (this.glanceHold > 0) {
      this.glanceHold -= dt;
      if (this.glanceHold <= 0) { this.yaw.t = 0; this.pitch.t = 0; }
    }
    // --- twitches: tiny fast head tilts ---
    this.nextTwitch -= dt;
    if (this.nextTwitch < 0) {
      this.tilt.v += (Math.random() - 0.5) * 2.2 * cfg.head.twitch;
      this.pitch.v += (Math.random() - 0.5) * 0.9 * cfg.head.twitch;
      this.nextTwitch = 0.8 + Math.random() * 3.5 / cfg.head.twitch;
    }
    const gy = this.yaw.update(dt), gp = this.pitch.update(dt), tw = this.tilt.update(dt);
    this.tilt.t = 0;

    // --- body -> head orientation with stabilisation ---
    const { fwd } = body.axes();
    const vel = body.vel;
    const sp = vel.length();
    // blend heading between body nose and flight path (heads look where they're going)
    const dir = this._v.copy(fwd);
    if (sp > 3 && !perched) dir.lerp(vel.clone().normalize(), 0.35).normalize();
    const yawB = Math.atan2(-dir.x, -dir.z);
    const pitchB = Math.asin(clamp(dir.y, -1, 1));
    // head roll is only a fraction of the body's bank
    const roll = -body.bank * 0.42;
    this.look.t = body.bank * 0.22; // look into the turn
    const lk = this.look.update(dt);
    const flapBob = Math.sin(body.flapPhase) * body.flapAmt * (0.006 + 0.004 * (body.boosting ? 1 : 0));
    const turb = state.speed * state.speed * 0.0000035 + this.shake;
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const t = performance.now() * 0.001;
    const n1 = (Math.sin(t * 17.3) + Math.sin(t * 23.1 + 1.3)) * turb;
    const n2 = (Math.sin(t * 19.7 + 0.7) + Math.sin(t * 29.3)) * turb;

    this._e.set(
      pitchB + gp + flapBob * 2 + n1 + this.lookInput.y * 0.7,
      yawB + gy - lk + n2 + this.lookInput.x * 1.4,
      roll + tw * 0.08 + n2 * 0.5,
      'YXZ',
    );
    this._q.setFromEuler(this._e);
    if (!this.init) { this.smoothQ.copy(this._q); this.init = true; }
    // Head stabilisation: slerp towards target (filters body wobble but tracks manoeuvres)
    this.smoothQ.slerp(this._q, 1 - Math.exp(-dt * (perched ? 6 : 14)));
    cam.quaternion.copy(this.smoothQ);
    cam.position.copy(body.pos);
    cam.position.y += 0.06 + Math.sin(body.flapPhase + 1.2) * body.flapAmt * 0.02;

    // FOV widens with speed and boost
    const base = cfg.cam.fov;
    const target = base + clamp((sp - body.cfg.vBest) * 0.22, -4, 14) + (body.boosting ? 6 : 0) + this.fovKick;
    this.fovKick *= Math.exp(-dt * 3);
    cam.fov += (target - cam.fov) * Math.min(1, dt * 3);
    cam.updateProjectionMatrix();
  }
}
