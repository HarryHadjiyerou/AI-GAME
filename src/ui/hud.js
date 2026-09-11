/* ═══════════════════════════════════════════════════════════
   HUD.

   Deliberately thin: altitude, airspeed, vario, stamina, and what the
   wings are doing. Everything is written straight to the DOM, throttled
   so a 120 Hz flight loop is not doing 120 Hz of layout.
   ═══════════════════════════════════════════════════════════ */

import { clamp } from '../core/noise.js';
import { FLIGHT_STATE } from '../flight/physics.js';

const STATE_LABEL = {
  [FLIGHT_STATE.GLIDE]: 'GLIDE',
  [FLIGHT_STATE.FLAP]: 'FLAP',
  [FLIGHT_STATE.DIVE]: 'STOOP',
  [FLIGHT_STATE.SOAR]: 'SOAR',
  [FLIGHT_STATE.STALL]: 'STALL',
  [FLIGHT_STATE.WATER]: 'SUBMERGED',
  [FLIGHT_STATE.RECOVER]: 'RECOVER',
};

export class Hud {
  constructor(root = document) {
    const $ = (id) => root.getElementById(id);
    this.el = {
      hud: $('hud'),
      bird: $('h-bird'), world: $('h-world'),
      alt: $('h-alt'), spd: $('h-spd'), vario: $('h-var'),
      stam: $('h-stam'), state: $('h-state'), thermal: $('h-thermal'),
      horizon: $('h-horizon'), toast: $('h-toast'), stall: $('h-stall'),
      perf: $('perf'),
    };
    this._acc = 0;
    this._toastT = 0;
    this._last = {};
    this.visible = true;
  }

  show(bird) {
    this.el.hud.classList.remove('hidden');
    this.el.bird.textContent = bird.name;
    this.el.world.textContent = bird.worldName;
    this.visible = true;
  }

  hide() { this.el.hud.classList.add('hidden'); this.visible = false; }

  setVisible(on) {
    this.visible = on;
    this.el.hud.classList.toggle('hidden', !on);
  }

  toast(text, seconds = 2.6) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('on');
    this._toastT = seconds;
  }

  /** @param {Flight} f */
  update(f, dt, extra = {}) {
    if (this._toastT > 0) {
      this._toastT -= dt;
      if (this._toastT <= 0) this.el.toast.classList.remove('on');
    }
    if (!this.visible) return;

    // The horizon line tracks the bank continuously — it is the one element
    // that would look wrong updated at 8 Hz.
    this.el.horizon.style.transform = `rotate(${(f.bank * 57.2958).toFixed(1)}deg)`;

    this._acc += dt;
    if (this._acc < 1 / 8) return;
    this._acc = 0;

    const set = (el, key, value) => {
      if (this._last[key] === value) return;
      this._last[key] = value;
      el.textContent = value;
    };

    const ground = extra.groundLevel ?? 0;
    set(this.el.alt, 'alt', Math.max(0, Math.round(f.position.y - ground)).toString());
    set(this.el.spd, 'spd', Math.round(f.airspeed * 3.6).toString());
    set(this.el.vario, 'var', (f.vario >= 0 ? '+' : '') + f.vario.toFixed(1));

    const stam = clamp(f.stamina, 0, 1);
    this.el.stam.style.width = `${(stam * 100).toFixed(0)}%`;
    this.el.stam.style.background = stam < 0.22 ? '#e2604a' : 'var(--accent)';

    set(this.el.state, 'state', STATE_LABEL[f.state] ?? f.state);
    this.el.thermal.classList.toggle('hidden', f.inThermal < 0.45);
    this.el.stall.classList.toggle('hidden', f.state !== FLIGHT_STATE.STALL);
  }

  perf(text) {
    if (!text) { this.el.perf.classList.add('hidden'); return; }
    this.el.perf.classList.remove('hidden');
    this.el.perf.textContent = text;
  }
}

/* ── bird-select cards and stat bars ────────────────────── */

export function buildBirdRail(rail, birds, order, onSelect) {
  rail.innerHTML = '';
  order.forEach((id, i) => {
    const b = birds[id];
    const card = document.createElement('button');
    card.className = 'bird-card' + (i === 0 ? ' on' : '');
    card.type = 'button';
    card.dataset.bird = id;
    card.innerHTML = `<span class="bird-glyph">${b.glyph}</span><b>${b.name}</b><small>${b.world}</small>`;
    card.addEventListener('click', () => onSelect(i, id));
    rail.appendChild(card);
  });
}

export function showBird(els, bird) {
  els.name.textContent = bird.name;
  els.world.textContent = bird.worldName;
  els.blurb.textContent = bird.blurb;
  els.stats.innerHTML = Object.entries(bird.stats)
    .map(([k, v]) => `<div class="stat"><span>${k}</span><i style="--v:${Math.round(v * 100)}%"></i></div>`)
    .join('');
}
