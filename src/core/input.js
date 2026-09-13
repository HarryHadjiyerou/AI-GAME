/* ═══════════════════════════════════════════════════════════
   Controls.

   Four sources, one output. Whichever the player last used wins, so
   nobody has to choose a control scheme in a menu before they have
   flown anything:

     touch     two floating sticks and two buttons  (ui/touch.js)
     keyboard  WASD or arrows, space, shift
     gamepad   left stick steers, right stick looks, A/RT beats
     tilt      opt-in, because it is lovely and not for everyone

   The output is a stick position, not a control surface demand. What
   the wing actually does with it is flight/assist.js's problem — which
   is the whole point, because a thumb on glass has no idea how much
   back pressure a 60° turn needs.
   ═══════════════════════════════════════════════════════════ */

import { clamp, damp } from './noise.js';

export const INPUT_MODE = {
  TOUCH: 'touch',
  KEYS: 'keys',
  PAD: 'gamepad',
  TILT: 'tilt',
};

const MODE_LABEL = {
  [INPUT_MODE.TOUCH]: 'STICKS TO FLY',
  [INPUT_MODE.KEYS]: 'WASD · SPACE TO BEAT',
  [INPUT_MODE.PAD]: 'CONTROLLER',
  [INPUT_MODE.TILT]: 'TILT TO FLY',
};

export class Controls {
  constructor(target, opts = {}) {
    this.target = target;
    this.touch = opts.touch ?? null;
    this.sensitivity = opts.sensitivity ?? 1;
    this.invertPitch = opts.invertPitch ?? false;
    this.tiltEnabled = false;
    this.hasOrientation = false;
    this.mode = INPUT_MODE.KEYS;

    // Smoothed stick position, which is what the game reads.
    this.x = 0;
    this.y = 0;
    this.lookX = 0;
    this.lookY = 0;
    this.flap = false;
    this.dive = 0;

    this._tilt = { x: 0, y: 0 };
    this._calib = null;
    this._keys = new Set();
    this._enabled = false;
    this._mouse = { down: false, x: 0, y: 0, dx: 0, dy: 0 };

    this._bind();
  }

  enable() { this._enabled = true; this._keys.clear(); this.touch?.show(this._wantsTouch()); }
  disable() {
    this._enabled = false;
    this._keys.clear();
    this.x = this.y = this.lookX = this.lookY = 0;
    this.flap = false; this.dive = 0;
    this.touch?.show(false);
  }

  _wantsTouch() {
    // Coarse pointer means a finger. Desktops with a touchscreen still get
    // the sticks if they have used them, which is what `everTouched` is for.
    return matchMedia?.('(pointer: coarse)').matches || this.touch?.everTouched || false;
  }

  /* ── tilt, opt-in ───────────────────────────────────────── */

  static orientationSupported() {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  }

  static needsPermission() {
    return typeof DeviceOrientationEvent !== 'undefined'
        && typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  async requestOrientation() {
    if (!Controls.orientationSupported()) return false;
    if (Controls.needsPermission()) {
      try {
        if (await DeviceOrientationEvent.requestPermission() !== 'granted') return false;
      } catch (e) { return false; }
    }
    window.addEventListener('deviceorientation', this._onOrient, { passive: true });
    this.tiltEnabled = true;
    return new Promise((res) => {
      const t = setTimeout(() => res(this.hasOrientation), 1200);
      this._orientResolve = () => { clearTimeout(t); res(true); };
    });
  }

  calibrate() { this._calib = null; }

  /* ── plumbing ───────────────────────────────────────────── */

  _bind() {
    this._onOrient = (e) => {
      if (e.beta === null && e.gamma === null) return;
      if (!this.hasOrientation) { this.hasOrientation = true; this._orientResolve?.(); }
      if (!this._enabled || !this.tiltEnabled) return;

      // Resolve against the screen, not the device: a phone held sideways
      // must still bank when you roll it.
      const angle = (screen.orientation?.angle ?? window.orientation ?? 0) | 0;
      let lat, lon;
      if (angle === 90) { lat = -e.beta; lon = -e.gamma; }
      else if (angle === -90 || angle === 270) { lat = e.beta; lon = e.gamma; }
      else if (angle === 180) { lat = -e.gamma; lon = -e.beta; }
      else { lat = e.gamma; lon = e.beta; }

      if (!this._calib) this._calib = { lat, lon };
      const wrap = (d) => { while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
      this._tilt.x = clamp(wrap(lat - this._calib.lat) / 30, -1, 1);
      this._tilt.y = clamp(wrap(lon - this._calib.lon) / 28, -1, 1);
      this.mode = INPUT_MODE.TILT;
    };

    addEventListener('keydown', (e) => {
      if (!this._enabled) return;
      this._keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this._keys.delete(e.code));
    addEventListener('blur', () => { this._keys.clear(); this._mouse.down = false; });

    // Mouse drag looks around on desktop, which is the one thing the keyboard
    // cannot do and the thing you most want while gliding.
    const el = this.target;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      this._mouse.down = true; this._mouse.x = e.clientX; this._mouse.y = e.clientY;
    });
    addEventListener('pointermove', (e) => {
      if (!this._mouse.down || e.pointerType === 'touch') return;
      this._mouse.dx += (e.clientX - this._mouse.x) * -0.0022;
      this._mouse.dy += (e.clientY - this._mouse.y) * -0.0016;
      this._mouse.x = e.clientX; this._mouse.y = e.clientY;
    });
    addEventListener('pointerup', () => { this._mouse.down = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _gamepad() {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p) continue;
      const dead = (v) => (Math.abs(v) < 0.12 ? 0 : v);
      const ax = p.axes ?? [];
      const btn = (i) => !!p.buttons?.[i]?.pressed;
      const analog = (i) => p.buttons?.[i]?.value ?? 0;
      const active = ax.some((v) => Math.abs(v) > 0.15)
                  || p.buttons?.some((b) => b.pressed);
      if (!active) continue;
      return {
        x: dead(ax[0] ?? 0), y: dead(ax[1] ?? 0),
        lookX: -dead(ax[2] ?? 0) * 0.04, lookY: -dead(ax[3] ?? 0) * 0.03,
        flap: btn(0) || analog(7) > 0.35,
        dive: Math.max(btn(1) ? 1 : 0, analog(6)),
      };
    }
    return null;
  }

  /** @returns {{x,y,flap,dive,lookX,lookY}} raw stick, unsmoothed by the caller */
  update(dt) {
    let src = null;
    let mode = this.mode;

    // Touch first: if a thumb is on the glass, nothing else gets a say.
    if (this.touch?.enabled) {
      const t = this.touch.read();
      if (this.touch.steer.active || this.touch.look.active || t.flap || t.dive) {
        src = { x: t.steerX, y: t.steerY, lookX: -t.lookX * 0.045, lookY: -t.lookY * 0.032,
                flap: t.flap, dive: t.dive };
        mode = INPUT_MODE.TOUCH;
      }
    }

    if (!src) {
      const pad = this._gamepad();
      if (pad) { src = pad; mode = INPUT_MODE.PAD; }
    }

    if (!src) {
      const k = this._keys;
      let kx = 0, ky = 0;
      if (k.has('KeyA') || k.has('ArrowLeft')) kx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) kx += 1;
      if (k.has('KeyW') || k.has('ArrowUp')) ky += 1;      // nose down
      if (k.has('KeyS') || k.has('ArrowDown')) ky -= 1;    // nose up
      const flap = k.has('Space');
      const dive = (k.has('ShiftLeft') || k.has('ShiftRight')) ? 1 : 0;
      if (kx || ky || flap || dive) {
        src = { x: kx, y: ky, lookX: 0, lookY: 0, flap, dive };
        mode = INPUT_MODE.KEYS;
      }
    }

    if (!src && this.tiltEnabled && this.hasOrientation) {
      src = { x: this._tilt.x, y: this._tilt.y, lookX: 0, lookY: 0, flap: false, dive: 0 };
      mode = INPUT_MODE.TILT;
    }

    if (!src) src = { x: 0, y: 0, lookX: 0, lookY: 0, flap: false, dive: 0 };
    this.mode = mode;

    // Mouse look is additive on top of whatever is steering.
    const mlx = this._mouse.dx, mly = this._mouse.dy;
    this._mouse.dx = this._mouse.dy = 0;

    const sens = this.sensitivity;
    const yRaw = clamp(src.y * sens, -1, 1) * (this.invertPitch ? -1 : 1);

    // Light smoothing only. The assist layer does the real shaping, and
    // double-smoothing makes the bird feel like it is underwater.
    this.x = damp(this.x, clamp(src.x * sens, -1, 1), 0.05, dt);
    this.y = damp(this.y, yRaw, 0.05, dt);
    this.flap = !!src.flap;
    this.dive = clamp(src.dive ?? 0, 0, 1);
    this.lookX = (src.lookX ?? 0) + mlx;
    this.lookY = (src.lookY ?? 0) + mly;

    return this;
  }

  describe() { return MODE_LABEL[this.mode] ?? 'FLY'; }
}
