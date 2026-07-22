/* ============================================================
   Elfblade — input. Touch-first: a virtual joystick (left/right
   to move, push down to slide) with a jump gem above it, and an
   attack gem on the right (tap = light, hold = heavy). All of it
   mirrored on keyboard: A/D or ←/→ move, W/space jump, S/↓ slide,
   J/X hold-able attack. UI code registers tappable "zones" each
   frame; the joystick region and free-screen gestures handle the
   rest.
   ============================================================ */

const Input = {
  zones: [],            // {id, x, y, w, h} in logical canvas coords, refreshed each frame
  _handler: null,       // Game callback: (actionId, x, y)
  _canvas: null,
  _touches: {},         // pointerId -> gesture state
  keysDown: {},

  // virtual joystick state (read by Game each frame)
  stick: { active: false, id: null, dx: 0, dy: 0, slideArmed: true },
  stickCenter: { x: 132, y: CFG.H - 118, r: 92 },   // matches the UI drawing

  // current horizontal move direction in [-1, 1] combining stick + keys
  moveDir() {
    if (this.stick.active && Math.abs(this.stick.dx) > 0.22) return Math.max(-1, Math.min(1, this.stick.dx));
    let d = 0;
    if (this.keysDown.KeyA || this.keysDown.ArrowLeft) d -= 1;
    if (this.keysDown.KeyD || this.keysDown.ArrowRight) d += 1;
    return d;
  },

  init(canvas, handler) {
    this._canvas = canvas;
    this._handler = handler;

    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keysDown[e.code] = true;
      const map = {
        Space: 'jump', ArrowUp: 'jump', KeyW: 'jump',
        ArrowDown: 'slide', KeyS: 'slide',
        KeyJ: 'attackDown', KeyX: 'attackDown', KeyF: 'attackDown', Enter: 'attackDown',
        Digit1: 'special1', Digit2: 'special2',
        Escape: 'pause', KeyP: 'pause', KeyM: 'mute',
      };
      const a = map[e.code];
      if (a) { e.preventDefault(); this._emit(a); }
    });
    window.addEventListener('keyup', e => {
      this.keysDown[e.code] = false;
      if (['KeyJ', 'KeyX', 'KeyF', 'Enter'].includes(e.code)) this._emit('attackUp');
    });

    const opts = { passive: false };
    canvas.addEventListener('pointerdown', e => { e.preventDefault(); this._down(e.pointerId, e.clientX, e.clientY); }, opts);
    canvas.addEventListener('pointermove', e => { this._move(e.pointerId, e.clientX, e.clientY); }, opts);
    canvas.addEventListener('pointerup',   e => { this._up(e.pointerId); }, opts);
    canvas.addEventListener('pointercancel', e => { this._up(e.pointerId); }, opts);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  },

  // client px -> logical canvas coords
  _logical(cx, cy) {
    const r = this._canvas.getBoundingClientRect();
    return { x: (cx - r.left) / r.width * CFG.W, y: (cy - r.top) / r.height * CFG.H };
  },

  _emit(action, x, y) { if (this._handler) this._handler(action, x, y); },

  _down(id, cx, cy) {
    AudioMan.unlock();
    const p = this._logical(cx, cy);

    // UI zones win over everything
    for (const z of this.zones) {
      if (p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h) {
        if (z.id === 'attack') {
          this._touches[id] = { kind: 'attackHold' };
          this._emit('attackDown', p.x, p.y);
        } else {
          this._touches[id] = { kind: 'zone' };
          this._emit(z.id, p.x, p.y);
        }
        return;
      }
    }

    // joystick capture (in-game only; menus don't register it)
    const sc = this.stickCenter;
    if (this.joystickEnabled && Math.hypot(p.x - sc.x, p.y - sc.y) < sc.r * 1.5) {
      this.stick.active = true;
      this.stick.id = id;
      this.stick.dx = (p.x - sc.x) / 46;
      this.stick.dy = (p.y - sc.y) / 46;
      this.stick.slideArmed = true;
      this._touches[id] = { kind: 'stick' };
      this._maybeStickSlide();
      return;
    }

    // free-screen gestures: swipe up = jump, swipe down = slide,
    // otherwise right half = attack (hold-able), left half = jump
    this._touches[id] = { x0: p.x, y0: p.y, kind: 'gesture', consumed: false };
    this._touches[id].timer = setTimeout(() => {
      const t = this._touches[id];
      if (t && !t.consumed) {
        t.consumed = true;
        if (p.x >= CFG.W * 0.42) { t.kind = 'attackHold'; this._emit('attackDown', p.x, p.y); }
        else this._emit('jump', p.x, p.y);
      }
    }, 55);
  },

  _maybeStickSlide() {
    const s = this.stick;
    if (s.slideArmed && s.dy > 0.75 && Math.abs(s.dy) > Math.abs(s.dx)) {
      s.slideArmed = false;
      this._emit('slide');
    }
    if (s.dy < 0.3) s.slideArmed = true;
  },

  _move(id, cx, cy) {
    const t = this._touches[id];
    if (!t) return;
    const p = this._logical(cx, cy);

    if (t.kind === 'stick') {
      const sc = this.stickCenter;
      this.stick.dx = (p.x - sc.x) / 46;
      this.stick.dy = (p.y - sc.y) / 46;
      this._maybeStickSlide();
      return;
    }
    if (t.kind === 'gesture' && !t.consumed) {
      const dy = p.y - t.y0, dx = p.x - t.x0;
      if (Math.abs(dy) > 34 && Math.abs(dy) > Math.abs(dx)) {
        t.consumed = true; clearTimeout(t.timer);
        this._emit(dy < 0 ? 'jump' : 'slide', p.x, p.y);
      }
    }
  },

  _up(id) {
    const t = this._touches[id];
    if (!t) return;
    if (t.kind === 'stick') {
      this.stick.active = false;
      this.stick.id = null;
      this.stick.dx = this.stick.dy = 0;
    } else if (t.kind === 'attackHold') {
      this._emit('attackUp');
    } else if (t.kind === 'gesture' && !t.consumed) {
      clearTimeout(t.timer);
      if (t.x0 >= CFG.W * 0.42) { this._emit('attackDown'); this._emit('attackUp'); }
      else this._emit('jump');
    }
    delete this._touches[id];
  },
};
