/* ═══════════════════════════════════════════════════════════
   Adaptive quality.

   A fixed quality tier is a guess about a device made before the
   device has rendered anything. It is wrong in both directions: a
   three-year-old phone picks "medium" from its user agent and then
   runs the coast at nineteen frames a second, and a desktop picks the
   same tier and leaves half its GPU idle.

   So the tier stays as the coarse, load-time decision — it is what
   sizes the terrain budget, the vegetation counts and the flock, none
   of which can be changed mid-flight without a hitch. On top of it
   this drives the two things that CAN move every frame and that
   between them dominate the frame time:

     • the resolution the scene is rendered at, before it is upscaled
     • whether bloom runs at all

   The rules are deliberately asymmetric. Dropping quality is fast and
   generous, because a player in a stutter wants it gone now. Raising
   it is slow, cautious and gives up permanently after a couple of
   failed attempts, because a resolution that visibly pumps up and
   down is worse than one that simply settled a little low.
   ═══════════════════════════════════════════════════════════ */

import { clamp } from './noise.js';

/**
 * Render scales, worst to best. Index 0 is the floor.
 *
 * The tiers' own scales (0.62, 0.82, 1.00) are members of this ladder on
 * purpose: a device that starts on Medium starts on a rung rather than
 * between two, so its first adjustment is a real step rather than a rounding.
 */
const STEPS = [0.50, 0.62, 0.72, 0.82, 0.91, 1.00];

/** The highest rung at or below `ceiling`. */
function rungFor(ceiling) {
  let i = 0;
  for (let k = 0; k < STEPS.length; k++) if (STEPS[k] <= ceiling + 1e-6) i = k;
  return i;
}

export class AutoQuality {
  /**
   * @param {object} opts
   * @param {(scale:number)=>void} opts.onScale   apply a render scale
   * @param {(on:boolean)=>void}  [opts.onBloom]  turn bloom on or off
   * @param {number} [opts.target]  frames per second to aim for
   * @param {number} [opts.ceiling] highest scale this device may use
   */
  constructor({ onScale, onBloom, target = 60, ceiling = 1.0 } = {}) {
    this.onScale = onScale;
    this.onBloom = onBloom;
    this.target = target;
    // A 60 Hz panel can never show more than 60, so "good enough" has to be
    // read relative to what the display can actually do.
    this.good = target * 0.92;
    this.poor = target * 0.72;
    this.bad = target * 0.46;

    this.enabled = true;
    this.ceiling = ceiling;
    this.index = rungFor(ceiling);
    this.bloom = true;

    this._blocked = STEPS.length;      // lowest index known to be too heavy
    this._promotions = 0;
    this._poorFor = 0;
    this._goodFor = 0;
    this._settle = 2.5;                // ignore the first seconds after a change
    this.changes = 0;
  }

  /**
   * Point the ladder at a new ceiling — the quality tier changed under us —
   * and land on the highest rung that ceiling allows.
   */
  setCeiling(ceiling) {
    this.ceiling = ceiling;
    this._blocked = STEPS.length;
    this._promotions = 0;
    this.index = rungFor(ceiling);
    return STEPS[this.index];
  }

  /** Called when the world changes under us, so old evidence is discarded. */
  reset(settle = 3.0) {
    this._poorFor = this._goodFor = 0;
    this._settle = settle;
  }

  get scale() { return STEPS[this.index]; }

  /**
   * @param {number} dt   seconds since the last frame
   * @param {number} fps  smoothed frame rate
   */
  update(dt, fps) {
    if (!this.enabled || !Number.isFinite(fps)) return;
    if (this._settle > 0) { this._settle -= dt; return; }

    if (fps < this.poor) { this._poorFor += dt; this._goodFor = 0; }
    else if (fps > this.good) { this._goodFor += dt; this._poorFor = 0; }
    else { this._poorFor = Math.max(0, this._poorFor - dt * 0.5); this._goodFor = 0; }

    // ── down ──
    // A really bad frame rate does not wait out the three second window.
    const urgent = fps < this.bad && this._poorFor > 0.6;
    if ((this._poorFor > 3.0 || urgent) && this.index > 0) {
      // Whatever we were running is now known to be too much for this device.
      this._blocked = Math.min(this._blocked, this.index);
      this._step(this.index - 1);
      return;
    }
    // At the floor there is one thing left to give up.
    if (this._poorFor > 4.0 && this.index === 0 && this.bloom) {
      this.bloom = false;
      this.onBloom?.(false);
      this._after();
    }

    // ── up ──
    if (this._goodFor > 8.0) {
      if (!this.bloom && this.index === 0) { this.bloom = true; this.onBloom?.(true); this._after(); return; }
      const next = this.index + 1;
      const cap = rungFor(this.ceiling);
      // Never climb back into a scale that has already proved too heavy, and
      // stop trying at all after two goes — a display that pumps between two
      // resolutions reads as a fault, not as quality.
      if (next <= cap && next < this._blocked && this._promotions < 2) {
        this._promotions++;
        this._step(next);
      } else {
        this._goodFor = 0;
      }
    }
  }

  _step(i) {
    this.index = clamp(i, 0, STEPS.length - 1);
    this.onScale?.(STEPS[this.index]);
    this._after();
  }

  _after() {
    this.changes++;
    this._poorFor = this._goodFor = 0;
    this._settle = 2.5;
  }
}
