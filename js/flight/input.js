// Touch controls (iPhone landscape: steering stick on the right thumb, FLAP / DIVE / BOOST on the left),
// keyboard and gamepad. Input is smoothed and the vertical axis is deliberately soft: climbing is done
// mainly with FLAP and descending with DIVE, the stick is for steering and fine pitch.
const PITCH_SCALE = 0.45; // vertical stick authority relative to roll
const SMOOTH = 0.09; // seconds, input low-pass
const FLICK_TIME = 0.2; // a full sideways flick within this time triggers a barrel roll

export class Input {
  constructor(root) {
    this.state = { pitch: 0, roll: 0, flap: false, boost: false, dive: false, rollTrick: 0 };
    this.invert = false;
    this.keys = new Set();
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.buttons = { flap: false, boost: false, dive: false };
    this.smooth = { x: 0, y: 0 };
    this.flick = { outT: 0, dir: 0, centreT: 0 };
    this.pendingRoll = 0;
    this.onPause = null;
    this.onAnyInput = null;
    this.lastT = performance.now();

    const zone = root.querySelector('#stickZone');
    const base = root.querySelector('#stickBase');
    const knob = root.querySelector('#stickKnob');
    const R = () => Math.min(72, window.innerHeight * 0.17);

    const startStick = (t) => {
      const s = this.stick;
      s.id = t.identifier; s.ox = t.clientX; s.oy = t.clientY; s.x = 0; s.y = 0;
      base.style.left = s.ox + 'px'; base.style.top = s.oy + 'px';
      base.classList.add('active');
      knob.style.transform = 'translate(-50%,-50%)';
      this.flick.centreT = performance.now();
    };
    const moveStick = (t) => {
      const s = this.stick, r = R();
      let dx = t.clientX - s.ox, dy = t.clientY - s.oy;
      const l = Math.hypot(dx, dy);
      if (l > r) { dx *= r / l; dy *= r / l; }
      s.x = dx / r; s.y = -dy / r;
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    };
    const endStick = () => {
      const s = this.stick;
      s.id = null; s.x = 0; s.y = 0;
      base.classList.remove('active');
      knob.style.transform = 'translate(-50%,-50%)';
    };
    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.onAnyInput?.();
      for (const t of e.changedTouches) if (this.stick.id === null) startStick(t);
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === this.stick.id) moveStick(t);
    }, { passive: false });
    const end = (e) => { for (const t of e.changedTouches) if (t.identifier === this.stick.id) endStick(); };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);
    zone.addEventListener('mousedown', (e) => { startStick({ identifier: 'm', clientX: e.clientX, clientY: e.clientY }); this.onAnyInput?.(); });
    window.addEventListener('mousemove', (e) => { if (this.stick.id === 'm') moveStick({ clientX: e.clientX, clientY: e.clientY }); });
    window.addEventListener('mouseup', () => { if (this.stick.id === 'm') endStick(); });

    for (const name of ['flap', 'boost', 'dive']) {
      const el = root.querySelector('#btn' + name[0].toUpperCase() + name.slice(1));
      const on = (e) => { e.preventDefault(); this.buttons[name] = true; el.classList.add('down'); this.onAnyInput?.(); navigator.vibrate?.(8); };
      const off = (e) => { e.preventDefault(); this.buttons[name] = false; el.classList.remove('down'); };
      el.addEventListener('touchstart', on, { passive: false });
      el.addEventListener('touchend', off, { passive: false });
      el.addEventListener('touchcancel', off, { passive: false });
      el.addEventListener('mousedown', on);
      el.addEventListener('mouseup', off);
      el.addEventListener('mouseleave', off);
    }
    root.querySelector('#btnPause')?.addEventListener('click', () => this.onPause?.());

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.onAnyInput?.();
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause?.();
      if (e.code === 'KeyQ') this.pendingRoll = -1;
      if (e.code === 'KeyE') this.pendingRoll = 1;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); Object.keys(this.buttons).forEach((k) => (this.buttons[k] = false)); });
    this.padPrev = {};
  }

  update() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    const k = this.keys;
    let sx = this.stick.x, sy = this.stick.y;
    if (k.has('KeyA') || k.has('ArrowLeft')) sx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) sx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) sy += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) sy -= 1;
    let flap = this.buttons.flap || k.has('Space');
    let boost = this.buttons.boost || k.has('ShiftLeft') || k.has('ShiftRight');
    let dive = this.buttons.dive || k.has('KeyC') || k.has('KeyF') || k.has('ControlLeft');
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (Math.abs(ax) > 0.12) sx += ax;
      if (Math.abs(ay) > 0.12) sy -= ay;
      flap = flap || p.buttons[0]?.pressed;
      boost = boost || p.buttons[7]?.pressed;
      dive = dive || p.buttons[6]?.pressed || p.buttons[1]?.pressed;
      for (const [bi, dir] of [[4, -1], [5, 1]]) {
        const pr = !!p.buttons[bi]?.pressed;
        if (pr && !this.padPrev[bi]) this.pendingRoll = dir;
        this.padPrev[bi] = pr;
      }
    }
    sx = Math.max(-1, Math.min(1, sx)); sy = Math.max(-1, Math.min(1, sy));
    // barrel roll gesture: a quick sideways flick OUT and BACK (holding a hard bank never triggers it)
    const f = this.flick;
    const ax = Math.abs(sx);
    if (ax > 0.93 && Math.abs(sy) < 0.6) {
      if (!f.outT && now - f.centreT < FLICK_TIME * 1000) { f.outT = now; f.dir = Math.sign(sx); }
    }
    if (ax < 0.3) {
      if (f.outT && now - f.outT < 280) this.pendingRoll = f.dir;
      f.outT = 0;
      f.centreT = now;
    } else if (f.outT && now - f.outT > 280) f.outT = 0;
    // smoothing (critically damped feel, no twitch)
    const a = 1 - Math.exp(-dt / SMOOTH);
    this.smooth.x += (sx - this.smooth.x) * a;
    this.smooth.y += (sy - this.smooth.y) * a;
    const curve = (v, dz, e) => { const m = Math.abs(v); return m < dz ? 0 : Math.sign(v) * Math.pow((m - dz) / (1 - dz), e); };
    const rx = curve(this.smooth.x, 0.07, 1.5);
    const ry = curve(this.smooth.y, 0.12, 1.8) * PITCH_SCALE;
    this.state.pitch = this.invert ? ry : -ry; // flight-sim default: push forward to pitch down
    this.state.roll = rx;
    this.state.flap = flap; this.state.boost = boost; this.state.dive = dive;
    this.state.rollTrick = this.pendingRoll;
    this.pendingRoll = 0;
    return this.state;
  }
}
