/* ═══════════════════════════════════════════════════════════
   Flight assistance.

   The simulation underneath this file is honest, and honest is
   unflyable. A real glider left alone sinks; bank it over and it sinks
   three times faster; and nothing about a thumb on glass tells you to
   ease back as you roll in. The result is a bird that flies into the
   ground while the player is still admiring the view.

   So the stick no longer commands the wing directly. It commands an
   intention, and this layer works out what the wing has to do:

     • neutral stick means "carry on" — hold height where there is
       energy to hold it, and trade height for speed when there is not.
       That is a total-energy controller, which is how a sailplane is
       actually flown, and it is why gliding now feels like gliding
       rather than falling.

     • rolling into a turn automatically pulls the extra lift the turn
       needs (1/cos φ of it), so a hard bank costs speed instead of
       hundreds of metres.

     • the wing is not allowed past the stall unless the player insists.

     • and the ground has a soft ceiling on how fast you may approach
       it, scaled by how much help the player asked for.

   None of this fakes the physics. Every one of these is a pitch or roll
   demand handed to the same aerodynamics as before — it is an autopilot
   riding the stick, not a cheat riding the bird.
   ═══════════════════════════════════════════════════════════ */

import { clamp, lerp, damp, smooth } from '../core/noise.js';

/**
 * Three levels. The difference is not "how much fun" — it is how much
 * of the aeroplane the player is expected to fly themselves.
 */
export const ASSIST_LEVELS = {
  serene: {
    name: 'SERENE',
    blurb: 'Cannot be flown into the ground. For looking at the view.',
    energy: 1.0,          // how hard the total-energy controller works
    bankComp: 1.0,        // feed-forward pull when banked
    groundGuard: 1.0,     // strength of the pull-up near terrain
    groundWarn: 4.5,      // seconds-to-impact at which it starts helping
    hardFloor: 18,        // metres it will not let you below, ever
    stallGuard: 1.0,
    autoLevel: 0.85,      // wings-level tendency with no roll input
    neutralSink: -0.15,   // m/s the bird settles at, hands off
    autoFlap: true,       // beats for you if you get slow and low
    maxBankScale: 0.82,
  },
  balanced: {
    name: 'BALANCED',
    blurb: 'Helps you out of trouble. You can still make trouble.',
    energy: 0.78,
    bankComp: 0.9,
    groundGuard: 0.7,
    groundWarn: 3.0,
    hardFloor: 6,
    stallGuard: 0.8,
    autoLevel: 0.55,
    neutralSink: -0.7,
    autoFlap: false,
    maxBankScale: 0.94,
  },
  wild: {
    name: 'WILD',
    blurb: 'The wing, the air, and whatever you do about it.',
    energy: 0.30,
    bankComp: 0.45,
    groundGuard: 0.18,
    groundWarn: 1.4,
    hardFloor: 0,
    stallGuard: 0.25,
    autoLevel: 0.22,
    neutralSink: -1.6,
    autoFlap: false,
    maxBankScale: 1.0,
  },
};

export const ASSIST_ORDER = ['serene', 'balanced', 'wild'];

export class FlightAssist {
  constructor(cfg, level = 'balanced') {
    this.cfg = cfg;
    this.setLevel(level);

    this._pitch = 0;
    this._lastVario = 0;
    this._varioRate = 0;
    this._guard = 0;          // 0..1, how hard the ground guard is working
    this.clearance = 0;       // metres of room, looking ahead as well as down
    this._slow = 0;           // 0..1, how close to stalling speed
    this.warning = null;      // 'ground' | 'stall' | null
    this.assisting = 0;       // 0..1, for the HUD

    // Stall speed: the slowest the wing can fly straight and level.
    //   mg = ½ρV²·S·CLmax  →  V = sqrt( 2mg / (ρ·S·CLmax) )
    const CLmax = cfg.clAlpha * cfg.stallAlpha + (cfg.cl0 ?? 0.12);
    this.stallSpeed = Math.sqrt((2 * cfg.mass * 9.81) / (1.225 * cfg.wingArea * CLmax));
    // Fly comfortably above it. This is the speed neutral stick aims for.
    this.refSpeed = this.stallSpeed * 1.45;
  }

  setLevel(level) {
    this.levelName = ASSIST_LEVELS[level] ? level : 'balanced';
    this.level = ASSIST_LEVELS[this.levelName];
    return this;
  }

  /**
   * How much room is there, not just below but along the path?
   *
   * Looking straight down is what let the bird follow a slope at two metres
   * and then fly into the point where the slope stopped dropping. A real
   * terrain warning projects the flight path forward and measures against the
   * highest thing in the way — so the climb starts before the hill, not on it.
   */
  _lookAhead(f) {
    const w = f.world;
    const here = f.surfaceClearance ?? f.groundClearance;
    if (!w?.height) return here;

    const vx = f.velocity.x, vz = f.velocity.z;
    const ground = Math.hypot(vx, vz);
    if (ground < 1) return here;

    let worst = here;
    const HORIZON = 4.5;                      // seconds of look-ahead
    for (let i = 1; i <= 5; i++) {
      const t = (i / 5) * HORIZON;
      let surf = w.height(f.position.x + vx * t, f.position.z + vz * t);
      if (w.waterLevel !== undefined) surf = Math.max(surf, w.waterLevel);
      // Where this flight path puts us at that moment, if nothing changes.
      worst = Math.min(worst, (f.position.y + f.vario * t) - surf);
    }
    return worst;
  }

  /**
   * @param {Flight} f
   * @param {object} stick  { x:-1..1 bank, y:-1..1 (negative = nose up), flap, dive }
   * @returns {object} input for Flight.update
   */
  update(f, stick, dt) {
    const L = this.level;
    const cfg = this.cfg;

    /* ── roll ──────────────────────────────────────────────
       Straight through, scaled. The only help here is that letting go
       genuinely levels the wings instead of leaving you in a slow
       spiral you did not notice starting. */
    const roll = clamp(stick.x, -1, 1) * L.maxBankScale;
    const rollHeld = Math.abs(stick.x) > 0.08;

    /* ── how much energy is in the bird ──────────────────── */

    const v = f.airspeed;
    const speedError = v - this.refSpeed;
    // Rate of change of vertical speed, smoothed — the D term.
    const rawRate = (f.vario - this._lastVario) / Math.max(dt, 1e-4);
    this._varioRate = damp(this._varioRate, clamp(rawRate, -30, 30), 0.12, dt);
    this._lastVario = f.vario;

    /* ── what the player is asking for, in metres per second ── */

    // Asymmetric on purpose. Asking to climb is a request the wing may not be
    // able to grant; asking to descend always works, and a stoop that tops out
    // at walking pace down is not a stoop.
    const sy = clamp(stick.y, -1, 1);
    const demand = sy < 0 ? -sy * 5.5 : -sy * 26;

    // Hands off, aim for the level's idle sink. With energy to spare the
    // bird will hold it; without, the speed term below overrules.
    let targetVario = Math.abs(stick.y) > 0.06 ? demand : L.neutralSink;

    // Total energy: surplus speed may be spent climbing, a deficit must be
    // paid back by descending. This single term is what stops both the
    // gentle sag into the ground and the slow-flight stall spiral.
    const energyVario = clamp(speedError * 0.55, -7, 5) * L.energy;
    targetVario += energyVario;

    /* ── the ground ──────────────────────────────────────── */

    // Height above whatever is actually below — sea surface included — and
    // then the worst of that and what is coming up along the path.
    const agl = f.surfaceClearance ?? f.groundClearance;
    const ahead = this._lookAhead(f);
    this.clearance = Math.min(agl, ahead);
    // Water is a soft landing, so the guard argues less out there — and when
    // the player is actually holding DIVE it gets out of the way entirely,
    // because hitting the sea at speed is the point of being a gull.
    const wantsWater = (stick.dive ?? 0) > 0.5;
    const surfaceGuard = f.overWater ? (wantsWater ? 0.05 : 0.62) : 1;
    const descent = Math.max(0, -f.vario);
    // Time to impact against the worst point on the path, not the one
    // directly underneath.
    const ttl = this.clearance / Math.max(descent, 0.25);
    let guard = 0;

    if (L.groundGuard > 0) {
      // Ramp in over the warning window rather than snapping on, so the
      // help feels like the bird levelling out and not like a wall.
      guard = smooth(L.groundWarn, L.groundWarn * 0.25, ttl) * L.groundGuard * surfaceGuard;

      // A floor the bird simply will not go below. On SERENE this is what
      // makes it impossible to crash; lower levels set it near zero.
      if (L.hardFloor > 0) {
        const floorUrgency = smooth(L.hardFloor * 3, L.hardFloor, this.clearance);
        guard = Math.max(guard, floorUrgency * L.groundGuard * surfaceGuard);
        if (this.clearance < L.hardFloor) {
          // Below the floor the demand is no longer negotiable.
          targetVario = Math.max(targetVario, (L.hardFloor - this.clearance) * 0.6 + 1.5);
        }
        // And never ask for a descent steeper than the remaining room can
        // absorb: commanding a dive you cannot pull out of is the one thing
        // an assist must never do.
        const recoverable = -Math.max(0.5, this.clearance - L.hardFloor) * 0.85;
        targetVario = Math.max(targetVario, recoverable);
      }

      if (guard > 0.01) {
        // Blend the player's wish towards "climb away from this".
        const escape = clamp((L.groundWarn - ttl) * 1.6 + 1.5, 0, 7);
        targetVario = lerp(targetVario, Math.max(targetVario, escape), guard);
      }
    }
    this._guard = damp(this._guard, guard, 0.12, dt);

    /* ── pitch controller ────────────────────────────────── */

    const error = targetVario - f.vario;
    // PD on vertical speed. The D term is what stops it porpoising.
    let pitch = error * 0.16 - this._varioRate * 0.045;

    // Feed-forward for the turn: a banked wing needs 1/cos φ of the lift,
    // and waiting for the sink to show up before pulling is what made
    // every turn cost height.
    const bank = Math.abs(f.bank);
    const loadNeeded = 1 / Math.max(0.22, Math.cos(bank)) - 1;
    pitch += loadNeeded * 0.55 * L.bankComp;

    /* ── protections ─────────────────────────────────────── */

    // Never command past the stall — unless the player is holding full
    // back, which on lower assist levels is taken as "I meant that".
    const deliberate = stick.y < -0.92 ? (1 - L.stallGuard) : 0;
    const alphaRoom = (cfg.stallAlpha * 0.92 - f._aEff) / Math.max(0.05, cfg.stallAlpha);
    const stallLimit = clamp(alphaRoom * 3.2, -1, 1);
    if (L.stallGuard > 0) {
      pitch = Math.min(pitch, lerp(stallLimit, 1, deliberate));
    }

    // Too slow is a different failure from too high an angle, and it outranks
    // the ground guard: a wing below flying speed cannot climb away from
    // anything, and pulling harder only makes the arrival sooner. The nose has
    // to come down and buy the speed back. On the gentlest setting the bird
    // beats its way out instead (see autoFlap below).
    const afloat = f.state === 'FLOAT' || (f.underwater && (f._depth ?? 9) < 1.6);
    const slow = smooth(this.stallSpeed * 1.22, this.stallSpeed * 1.0, v);
    if (slow > 0 && !afloat) {
      pitch = lerp(pitch, -0.5, slow * Math.max(L.stallGuard, 0.55));
    }
    this._slow = slow;

    // On the water, "too slow" is the normal state and lowering the nose just
    // drives the thrust into the sea.
    //
    // The takeoff has two parts, and doing them in the wrong order is why the
    // bird kept wallowing back down: stay flat and accelerate along the
    // surface first, and only rotate once there is speed in hand. Pitching up
    // at the moment of leaving the water gets you airborne at exactly stall
    // speed with nothing left to fly with.
    if (afloat) pitch = v < this.stallSpeed * 1.3 ? 0.08 : 0.52;

    // A stoop should be flown, not governed: with the wings folded the
    // controller steps back and lets the stick and the air settle it. It steps
    // back in again well before the ground does, though — the hand-back has to
    // finish while there is still room to recover, not as the guard maxes out.
    // Measured in time, not height: at stoop speed the gap between "plenty of
    // room" and "none" is under a second, so a height threshold hands control
    // back far too late to do anything with it.
    const handBack = clamp(1 - this._guard * 2.6, 0, 1) * smooth(2.4, 6.0, ttl);
    const tucked = clamp(stick.dive ?? 0, 0, 1) * handBack;
    pitch = lerp(pitch, clamp(-sy, -1, 1), tucked * 0.75);

    this._pitch = damp(this._pitch, clamp(pitch, -1, 1), 0.055, dt);

    /* ── wings ───────────────────────────────────────────── */

    let flap = !!stick.flap;
    // Afloat and asked to go: beat, whatever the assist level.
    if (afloat && (stick.flap || L.autoFlap)) flap = f.stamina > 0.05;
    // On the gentlest setting the bird will beat rather than mush into a
    // hillside while the player is busy looking at the scenery.
    if (L.autoFlap && !flap && (slow > 0.2 || (this._guard > 0.35 && this.clearance < 120))
        && f.stamina > 0.12 && f.tuck < 0.3) {
      flap = true;
      this.assisting = 1;
    } else {
      this.assisting = damp(this.assisting, this._guard, 0.2, dt);
    }

    // Diving is always allowed, but the ground guard overrides the tuck so
    // that holding DIVE into a valley floor does not end the flight.
    const tuck = clamp(stick.dive ?? 0, 0, 1) * (1 - this._guard * 0.9);

    /* ── what to tell the player ─────────────────────────── */
    this.warning = this._guard > 0.45 ? 'ground'
                 : (f._stalled > 0.35 ? 'stall' : null);

    // Rolling out is half of a pull-up, and the half that was missing.
    //
    // Lift acts perpendicular to the wings, so at 60° of bank only half of it
    // is holding you up and the rest is turning you. Pulling harder in that
    // attitude does not climb — it tightens the turn and digs in. Every
    // terrain escape starts by levelling the wings, and without this the guard
    // could be at full strength, the stick hard back, and the bird still
    // descending into the hill at four metres a second.
    const rollOut = this._guard * 0.88;
    const finalRoll = roll * (1 - rollOut);

    void rollHeld;
    return {
      roll: finalRoll,
      pitch: this._pitch,
      flap,
      tuck,
      // Level the wings faster when escaping, too.
      autoLevel: lerp(L.autoLevel, 1.4, this._guard),
    };
  }
}
