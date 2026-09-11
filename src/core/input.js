/* ═══════════════════════════════════════════════════════════
   Controls.

   Tilt first. The phone *is* the bird:

     roll the phone left / right  → bank, and therefore turn
     tip it away from you         → nose down
     tip it back towards you      → nose up
     tap                          → flap
     hold                         → tuck

   iOS gates DeviceOrientationEvent behind a permission call that must
   happen inside a user gesture, so the game asks on the launch button,
   not on page load. Where orientation is unavailable — desktop, a
   locked-down browser, a refused prompt — dragging on the screen does
   the same job, and the keyboard is always live.

   The neutral point is calibrated on the first reading and can be
   re-zeroed at any time, because nobody holds a phone flat.
   ═══════════════════════════════════════════════════════════ */

import { clamp, damp } from './noise.js';

export const INPUT_MODE = { TILT: 'tilt', DRAG: 'drag', KEYS: 'keys' };

export class Controls {
  constructor(target, opts = {}) {
    this.target = target;
    this.sensitivity = opts.sensitivity ?? 1;
    this.invertPitch = opts.invertPitch ?? false;
    this.deadzone = opts.deadzone ?? 0.06;

    this.mode = INPUT_MODE.KEYS;
    this.hasOrientation = false;
    this.orientationDenied = false;

    // What the game reads.
    this.roll = 0;
    this.pitch = 0;
    this.flap = false;
    this.tuck = 0;
    this.lookX = 0;
    this.lookY = 0;

    // Raw, pre-smoothing.
    this._roll = 0;
    this._pitch = 0;
    this._tuckHeld = 0;
    this._flapQueue = 0;
    this._flapHeld = false;

    this.keys = new Set();
    this._calib = null;
    this._dragOrigin = null;
    this._dragVec = { x: 0, y: 0 };
    this._touches = new Map();
    this._pressT = 0;
    this._holdThreshold = opts.holdThreshold ?? 0.16;
    this._enabled = false;

    this._bind();
  }

  /* ── lifecycle ──────────────────────────────────────────── */

  enable() { this._enabled = true; this.keys.clear(); }
  disable() {
    this._enabled = false;
    this.keys.clear();
    this._roll = this._pitch = 0;
    this._tuckHeld = 0;
    this._flapHeld = false;
    this._dragOrigin = null;
    this._touches.clear();
  }

  /** Does this device even have an orientation sensor we are allowed to read? */
  static orientationSupported() {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  }

  /** Does it need the iOS permission dance? */
  static needsPermission() {
    return typeof DeviceOrientationEvent !== 'undefined'
        && typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  /**
   * Must be called from inside a user gesture on iOS.
   * @returns {Promise<boolean>} whether tilt is now available
   */
  async requestOrientation() {
    if (!Controls.orientationSupported()) return false;
    if (Controls.needsPermission()) {
      try {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') { this.orientationDenied = true; return false; }
      } catch (e) {
        this.orientationDenied = true;
        return false;
      }
    }
    window.addEventListener('deviceorientation', this._onOrient, { passive: true });
    // The event may simply never fire (desktop, or a sensor-less device), so
    // treat silence as "no tilt" rather than leaving the player stuck.
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(this.hasOrientation), 1200);
      this._orientResolve = () => { clearTimeout(t); resolve(true); };
    });
  }

  /** Take the current attitude as level. */
  calibrate() { this._calib = null; }

  /* ── event plumbing ─────────────────────────────────────── */

  _bind() {
    this._onOrient = (e) => {
      if (e.beta === null && e.gamma === null) return;
      if (!this.hasOrientation) {
        this.hasOrientation = true;
        this.mode = INPUT_MODE.TILT;
        this._orientResolve?.();
        this._orientResolve = null;
      }
      if (!this._enabled) return;

      // beta  = front-to-back tilt, gamma = left-to-right, in degrees.
      // Landscape swaps their roles, so resolve against the screen, not the
      // device: a phone held sideways must still bank when you roll it.
      const angle = (screen.orientation?.angle ?? window.orientation ?? 0) | 0;
      let lateral, longitudinal;
      if (angle === 90)       { lateral = -e.beta;  longitudinal = -e.gamma; }
      else if (angle === -90 || angle === 270) { lateral = e.beta; longitudinal = e.gamma; }
      else if (angle === 180) { lateral = -e.gamma; longitudinal = -e.beta; }
      else                    { lateral = e.gamma;  longitudinal = e.beta; }

      if (!this._calib) this._calib = { lateral, longitudinal };

      const dLat = this._wrap(lateral - this._calib.lateral);
      const dLon = this._wrap(longitudinal - this._calib.longitudinal);

      // 32° of tilt is full deflection — enough travel to be precise,
      // little enough that you can still see the screen.
      this._roll = this._shape(dLat / 32);
      this._pitch = this._shape(dLon / 30) * (this.invertPitch ? 1 : -1);
    };

    const el = this.target;

    el.addEventListener('pointerdown', (e) => {
      if (!this._enabled) return;
      el.setPointerCapture?.(e.pointerId);
      this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
      if (this._touches.size === 2) { this.calibrate(); return; }
      this._pressT = performance.now();
      this._flapHeld = true;
      if (this.mode !== INPUT_MODE.TILT) this._dragOrigin = { x: e.clientX, y: e.clientY };
    });

    el.addEventListener('pointermove', (e) => {
      if (!this._enabled || !this._touches.has(e.pointerId)) return;
      const t = this._touches.get(e.pointerId);
      t.x = e.clientX; t.y = e.clientY;
      if (this.mode === INPUT_MODE.TILT) {
        // With tilt driving the bird, dragging just moves the head.
        this.lookX += -e.movementX * 0.0016;
        this.lookY += -e.movementY * 0.0012;
        return;
      }
      if (!this._dragOrigin) return;
      const w = Math.min(window.innerWidth, window.innerHeight);
      this._dragVec.x = clamp((e.clientX - this._dragOrigin.x) / (w * 0.28), -1, 1);
      this._dragVec.y = clamp((e.clientY - this._dragOrigin.y) / (w * 0.28), -1, 1);
      this._roll = this._shape(this._dragVec.x);
      this._pitch = this._shape(this._dragVec.y) * (this.invertPitch ? -1 : 1);
      this.mode = INPUT_MODE.DRAG;
    });

    const up = (e) => {
      if (!this._touches.has(e.pointerId)) return;
      const held = (performance.now() - this._pressT) / 1000;
      this._touches.delete(e.pointerId);
      if (this._touches.size === 0) {
        // A tap is a flap; anything longer was a tuck, and should not also flap.
        if (held < this._holdThreshold) this._flapQueue = Math.max(this._flapQueue, 0.14);
        this._flapHeld = false;
        this._dragOrigin = null;
        this._dragVec.x = this._dragVec.y = 0;
        if (this.mode === INPUT_MODE.DRAG) { this._roll = 0; this._pitch = 0; }
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (!this._enabled) return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _wrap(d) {
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  }

  /** Dead zone plus a gentle expo curve: fine near centre, full at the edges. */
  _shape(v) {
    const s = clamp(v * this.sensitivity, -1, 1);
    const a = Math.abs(s);
    if (a < this.deadzone) return 0;
    const t = (a - this.deadzone) / (1 - this.deadzone);
    return Math.sign(s) * (t * t * 0.62 + t * 0.38);
  }

  /** Fold every source together. Call once per frame. */
  update(dt) {
    let roll = this._roll;
    let pitch = this._pitch;
    let tuck = 0;
    let flap = false;

    // Keyboard always overrides, so a desk-bound player is never stuck.
    const k = this.keys;
    let kx = 0, ky = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) kx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) kx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) ky -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) ky += 1;
    if (kx || ky) { roll = kx; pitch = ky; this.mode = INPUT_MODE.KEYS; }
    if (k.has('Space')) flap = true;
    if (k.has('ShiftLeft') || k.has('ShiftRight')) tuck = 1;

    // Touch: held = tuck, tap = one wingbeat.
    if (this._flapHeld) {
      const held = (performance.now() - this._pressT) / 1000;
      if (held > this._holdThreshold) tuck = Math.max(tuck, clamp((held - this._holdThreshold) / 0.3, 0, 1));
    }
    if (this._flapQueue > 0) { this._flapQueue -= dt; flap = true; }

    // Smooth the axes so a shaky hand does not translate into a shaky bird.
    const lag = this.mode === INPUT_MODE.TILT ? 0.075 : 0.045;
    this.roll = damp(this.roll, clamp(roll, -1, 1), lag, dt);
    this.pitch = damp(this.pitch, clamp(pitch, -1, 1), lag, dt);
    this.tuck = damp(this.tuck, tuck, 0.10, dt);
    this.flap = flap;

    const lx = this.lookX, ly = this.lookY;
    this.lookX = this.lookY = 0;
    return { roll: this.roll, pitch: this.pitch, flap: this.flap, tuck: this.tuck, lookX: lx, lookY: ly };
  }

  describe() {
    if (this.mode === INPUT_MODE.TILT) return 'TILT TO FLY';
    if (this.mode === INPUT_MODE.DRAG) return 'DRAG TO FLY';
    return 'WASD · SPACE TO FLAP';
  }
}
