/* ============================================================
   Elfblade — input. Touch-first (on-screen buttons + swipe up
   to jump / swipe down to slide) mirrored on keyboard & mouse.
   UI code registers tappable "zones" each frame; anything else
   is treated as a gameplay gesture.
   ============================================================ */

const Input = {
  zones: [],            // {id, x, y, w, h} in logical canvas coords, refreshed each frame
  _handler: null,       // Game callback: (actionId, x, y)
  _canvas: null,
  _touches: {},         // id -> {x0, y0, t0, consumed}
  keysDown: {},

  init(canvas, handler) {
    this._canvas = canvas;
    this._handler = handler;

    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keysDown[e.code] = true;
      const map = {
        Space: 'jump', ArrowUp: 'jump', KeyW: 'jump',
        ArrowDown: 'slide', KeyS: 'slide',
        KeyJ: 'attack', KeyX: 'attack', KeyF: 'attack', Enter: 'attack',
        Digit1: 'special1', Digit2: 'special2',
        Escape: 'pause', KeyP: 'pause', KeyM: 'mute',
      };
      const a = map[e.code];
      if (a) { e.preventDefault(); this._emit(a); }
    });
    window.addEventListener('keyup', e => { this.keysDown[e.code] = false; });

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
    // UI zones win over gameplay gestures
    for (const z of this.zones) {
      if (p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h) {
        this._touches[id] = { consumed: true };
        this._emit(z.id, p.x, p.y);
        return;
      }
    }
    this._touches[id] = { x0: p.x, y0: p.y, t0: performance.now(), consumed: false };
    // Immediate response: left half = jump, right half = attack.
    // A fast downward swipe (detected in _move) converts to slide.
    this._touches[id].pending = (p.x < CFG.W * 0.42) ? 'jump' : 'attack';
    this._touches[id].timer = setTimeout(() => {
      const t = this._touches[id];
      if (t && !t.consumed) { t.consumed = true; this._emit(t.pending, p.x, p.y); }
    }, 55); // tiny window to let a swipe override the tap
  },

  _move(id, cx, cy) {
    const t = this._touches[id];
    if (!t || t.consumed) return;
    const p = this._logical(cx, cy);
    const dy = p.y - t.y0, dx = p.x - t.x0;
    if (Math.abs(dy) > 34 && Math.abs(dy) > Math.abs(dx)) {
      t.consumed = true; clearTimeout(t.timer);
      this._emit(dy < 0 ? 'jump' : 'slide', p.x, p.y);
    }
  },

  _up(id) {
    const t = this._touches[id];
    if (t && !t.consumed) { clearTimeout(t.timer); this._emit(t.pending || 'tap'); }
    delete this._touches[id];
  },
};
