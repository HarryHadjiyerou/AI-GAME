// Touch joystick + buttons (iPhone landscape), keyboard and gamepad.
export class Input {
  constructor(root) {
    this.state = { pitch: 0, roll: 0, flap: false, boost: false, dive: false };
    this.invert = false;
    this.keys = new Set();
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.buttons = { flap: false, boost: false, dive: false };
    this.touchIds = new Map();
    this.onPause = null;
    this.onAnyInput = null;

    const zone = root.querySelector('#stickZone');
    const base = root.querySelector('#stickBase');
    const knob = root.querySelector('#stickKnob');
    this.base = base; this.knob = knob;
    const R = () => Math.min(70, window.innerHeight * 0.16);

    const startStick = (t) => {
      const s = this.stick;
      s.id = t.identifier; s.ox = t.clientX; s.oy = t.clientY; s.x = 0; s.y = 0;
      base.style.left = s.ox + 'px'; base.style.top = s.oy + 'px';
      base.classList.add('active');
      knob.style.transform = 'translate(-50%,-50%)';
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
    // mouse fallback for the stick (desktop testing)
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
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); Object.keys(this.buttons).forEach((k) => (this.buttons[k] = false)); });
  }

  update() {
    const k = this.keys;
    let sx = this.stick.x, sy = this.stick.y;
    if (k.has('KeyA') || k.has('ArrowLeft')) sx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) sx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) sy += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) sy -= 1;
    let flap = this.buttons.flap || k.has('Space');
    let boost = this.buttons.boost || k.has('ShiftLeft') || k.has('ShiftRight');
    let dive = this.buttons.dive || k.has('KeyE') || k.has('KeyQ') || k.has('ControlLeft');
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (Math.abs(ax) > 0.12) sx += ax;
      if (Math.abs(ay) > 0.12) sy -= ay;
      flap = flap || p.buttons[0]?.pressed;
      boost = boost || p.buttons[7]?.pressed || p.buttons[5]?.pressed;
      dive = dive || p.buttons[6]?.pressed || p.buttons[1]?.pressed;
    }
    const curve = (v) => { v = Math.max(-1, Math.min(1, v)); const a = Math.abs(v); return a < 0.06 ? 0 : Math.sign(v) * Math.pow((a - 0.06) / 0.94, 1.35); };
    sx = curve(sx); sy = curve(sy);
    // Flight-sim convention by default: push forward (up) to dive.
    this.state.pitch = this.invert ? sy : -sy;
    this.state.roll = sx;
    this.state.flap = flap; this.state.boost = boost; this.state.dive = dive;
    return this.state;
  }
}
