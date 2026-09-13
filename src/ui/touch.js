/* ═══════════════════════════════════════════════════════════
   Touch controls.

   Two floating sticks and two buttons, built from DOM rather than
   drawn into the canvas — they stay crisp at any pixel ratio, they
   cost nothing per frame, and they can be styled in CSS.

   "Floating" matters more than it sounds: the stick appears wherever
   the thumb lands rather than at a fixed spot on the glass. A fixed
   stick means looking down to find it, and on a phone held in two
   hands your thumbs are never twice in the same place.

     left  — steer. Push to bank, pull back to raise the nose.
     right — look around without changing where you are going.
     FLAP  — a wingbeat. Hold for several.
     DIVE  — fold the wings and drop.
   ═══════════════════════════════════════════════════════════ */

import { clamp } from '../core/noise.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** One floating analogue stick bound to a half of the screen. */
class Stick {
  constructor(root, { side, label, radius = 62 }) {
    this.side = side;
    this.radius = radius;
    this.x = 0;
    this.y = 0;
    this.active = false;
    this.pointerId = null;

    this.el = document.createElement('div');
    this.el.className = `stick stick-${side}`;
    this.el.innerHTML = `
      <div class="stick-base"></div>
      <div class="stick-knob"></div>
      <div class="stick-label">${label}</div>
    `;
    this.el.style.display = 'none';
    root.appendChild(this.el);

    this.base = this.el.querySelector('.stick-base');
    this.knob = this.el.querySelector('.stick-knob');
  }

  begin(x, y, pointerId) {
    this.pointerId = pointerId;
    this.active = true;
    this.originX = x;
    this.originY = y;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    this.el.style.display = 'block';
    this.el.classList.add('on');
    this.move(x, y);
  }

  move(x, y) {
    let dx = x - this.originX;
    let dy = y - this.originY;
    const d = Math.hypot(dx, dy);
    if (d > this.radius) {
      // Past the edge, drag the whole stick along. Without this a thumb that
      // wanders mid-turn silently loses travel in the direction it wandered.
      const pull = d - this.radius;
      this.originX += (dx / d) * pull;
      this.originY += (dy / d) * pull;
      this.el.style.left = `${this.originX}px`;
      this.el.style.top = `${this.originY}px`;
      dx = (dx / d) * this.radius;
      dy = (dy / d) * this.radius;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    this.x = clamp(dx / this.radius, -1, 1);
    this.y = clamp(dy / this.radius, -1, 1);
  }

  end() {
    this.active = false;
    this.pointerId = null;
    this.x = this.y = 0;
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.el.classList.remove('on');
    this.el.style.display = 'none';
  }
}

/** A hold-to-act button that also reports the moment it was pressed. */
class Button {
  constructor(root, { id, label, glyph, hint }) {
    this.held = false;
    this.pressed = false;
    this.pointerId = null;

    this.el = document.createElement('button');
    this.el.className = `touch-btn touch-${id}`;
    this.el.type = 'button';
    this.el.innerHTML = `
      <span class="touch-glyph">${glyph}</span>
      <span class="touch-label">${label}</span>
      ${hint ? `<span class="touch-hint">${hint}</span>` : ''}
    `;
    root.appendChild(this.el);
  }

  begin(pointerId) {
    this.pointerId = pointerId;
    this.held = true;
    this.pressed = true;
    this.el.classList.add('on');
  }

  end() {
    this.held = false;
    this.pointerId = null;
    this.el.classList.remove('on');
  }

  /** True once per press. */
  takePressed() { const p = this.pressed; this.pressed = false; return p; }
}

export class TouchControls {
  constructor(root = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'touch-layer';
    this.root.style.display = 'none';
    root.appendChild(this.root);

    this.steer = new Stick(this.root, { side: 'left', label: 'STEER' });
    this.look = new Stick(this.root, { side: 'right', label: 'LOOK' });

    const pad = document.createElement('div');
    pad.className = 'touch-pad';
    this.root.appendChild(pad);
    this.flap = new Button(pad, { id: 'flap', label: 'FLAP', glyph: this._wingIcon(), hint: 'hold' });
    this.dive = new Button(pad, { id: 'dive', label: 'DIVE', glyph: this._diveIcon(), hint: 'tuck' });

    this.enabled = false;
    this.everTouched = false;
    this._bind();
  }

  _wingIcon() {
    return `<svg viewBox="0 0 24 24" width="22" height="22" xmlns="${SVG_NS}">
      <path d="M2 13c4-6 8-8 10-8s6 2 10 8c-4-2-7-2.5-10-2.5S6 11 2 13z"
            fill="currentColor" opacity=".9"/>
      <path d="M4 17c3.5-3.5 5.5-4.5 8-4.5s4.5 1 8 4.5c-3.5-1-5.5-1.4-8-1.4S7.5 16 4 17z"
            fill="currentColor" opacity=".55"/>
    </svg>`;
  }

  _diveIcon() {
    return `<svg viewBox="0 0 24 24" width="22" height="22" xmlns="${SVG_NS}">
      <path d="M12 3v13M12 20l-5-6M12 20l5-6" fill="none" stroke="currentColor"
            stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  show(on) {
    this.enabled = on;
    this.root.style.display = on ? 'block' : 'none';
    if (!on) { this.steer.end(); this.look.end(); this.flap.end(); this.dive.end(); }
  }

  _bind() {
    const onDown = (e) => {
      if (!this.enabled) return;
      this.everTouched = true;

      // Buttons claim the event themselves; the sticks take whatever is left.
      for (const b of [this.flap, this.dive]) {
        if (e.target.closest?.(`.touch-${b === this.flap ? 'flap' : 'dive'}`)) {
          b.begin(e.pointerId);
          e.preventDefault();
          return;
        }
      }

      const stick = e.clientX < innerWidth * 0.5 ? this.steer : this.look;
      if (stick.active) return;                    // one finger per stick
      stick.begin(e.clientX, e.clientY, e.pointerId);
      e.preventDefault();
    };

    const onMove = (e) => {
      if (!this.enabled) return;
      for (const s of [this.steer, this.look]) {
        if (s.active && s.pointerId === e.pointerId) { s.move(e.clientX, e.clientY); e.preventDefault(); }
      }
    };

    const onUp = (e) => {
      for (const s of [this.steer, this.look]) {
        if (s.pointerId === e.pointerId) s.end();
      }
      for (const b of [this.flap, this.dive]) {
        if (b.pointerId === e.pointerId) b.end();
      }
    };

    this.root.addEventListener('pointerdown', onDown);
    // Move and up go on the window: a thumb that slides off the stick, or off
    // the screen entirely, must not leave the bird locked in a turn.
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', () => {
      this.steer.end(); this.look.end(); this.flap.end(); this.dive.end();
    });
  }

  /** @returns {{steerX:number, steerY:number, lookX:number, lookY:number, flap:boolean, dive:number}} */
  read() {
    return {
      steerX: this.steer.x,
      steerY: this.steer.y,
      lookX: this.look.x,
      lookY: this.look.y,
      flap: this.flap.held,
      dive: this.dive.held ? 1 : 0,
    };
  }

  dispose() { this.root.remove(); }
}
