/* ═══════════════════════════════════════════════════════════
   First-person wings.

   The three.js sample birds (Flamingo, Parrot, Stork) are morph-target
   animated with no skeleton, so there is nothing in them to articulate
   — you get one baked flap and no way to fold, sweep or bank a wing
   independently. They are excellent whole silhouettes at a distance,
   which is where this project uses them (see world/flock.js), and
   useless for a wing you are sitting behind.

   So the wings you fly with are built here: a three-segment arm
   (humerus → forearm → hand) carrying secondaries and primaries cut
   from an alpha-masked feather sprite. That buys the things the camera
   actually needs to show:

     • flap amplitude and rate driven by the real wingbeat phase
     • tuck — the whole arm folds back and the primaries sweep
     • bank — the inside wing drops out of frame, the outside rises
     • flex — the wingtips bend under load, and whip in a stoop
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { StyleSystem } from '../core/style.js';
import { SURFACE } from '../core/screenspace.js';
import { clamp, lerp, damp, smooth } from '../core/noise.js';

const _invQ = new THREE.Quaternion();

/*
 * Everything below is built in the wing's own frame: +X runs outboard, +Z runs
 * aft, +Y is up, and `side` mirrors the whole thing for the left wing. That
 * matters — build a wing in the XY plane and rotate it outboard and you get a
 * vertical ribbon that disappears edge-on the moment you look along it.
 */

/** A quad lying flat in the wing plane, chord along Z, span along X. */
function panel(material, side, len, rootChord, tipChord, { rootLead = 0.42, tipLead = 0.5 } = {}) {
  const g = new THREE.BufferGeometry();
  const x1 = side * len;
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0,  0, -rootChord * rootLead,
    0,  0,  rootChord * (1 - rootLead),
    x1, 0, -tipChord * tipLead,
    x1, 0,  tipChord * (1 - tipLead),
  ], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(
    [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0, 1, 1], 2));
  g.setIndex(side > 0 ? [0, 1, 2, 2, 1, 3] : [0, 2, 1, 2, 3, 1]);
  const m = new THREE.Mesh(g, material);
  m.frustumCulled = false;
  return m;
}

/**
 * A feather: a long quad lying in the wing plane, pivoting about its quill so
 * it can fan and rake. Length runs outboard-and-aft from the pivot.
 */
function feather(material, side, length, width, { taper = 0.55, curve = 0.16 } = {}) {
  const segs = 5;
  const pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // Round the tip rather than cutting it square.
    const w = width * (1 - t * taper) * Math.sin(Math.min(1, (1 - t) * 6.5 + 0.12) * Math.PI * 0.5);
    const x = side * length * t;
    // A feather is not straight: it bows aft towards the tip.
    const z = length * curve * t * t;
    pos.push(x, 0, z - w * 0.42, x, 0, z + w * 0.58);
    nrm.push(0, 1, 0, 0, 1, 0);
    // u runs across the vane with the shaft at 0.42; v runs root to tip.
    uv.push(0, t, 1, t);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    if (side > 0) idx.push(a, b, c, c, b, d);
    else idx.push(a, c, b, c, d, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, material);
  m.frustumCulled = false;
  return m;
}

export class Wings {
  /**
   * Wings live in their own scene, drawn by their own very wide camera and
   * composited over the world.
   *
   * The reason is geometric. A bird sees through roughly 300°; the game runs
   * at about 130° horizontally, and at that angle a wing rooted where a real
   * shoulder sits falls entirely outside the frame. Pushing the wings forward
   * until they fit would put them in front of the bird's face. So the world is
   * rendered at the player's field of view and the wings at 165°, which is
   * what peripheral vision actually is: the same eye, a much wider cone, and
   * nothing in the middle of the frame affected either way.
   *
   * @param {object} cfg   bird config
   */
  constructor(palette, cfg, opts = {}) {
    this.cfg = cfg;
    this.span = cfg.wingSpan ?? 1.2;
    this.enabled = true;

    // A private scene so the world's sky, fog and terrain never enter this
    // pass, and the wing pass never clears what is already drawn.
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(opts.fov ?? 118, 1, 0.02, 12);
    this.scene.add(this.camera);

    // Wings get their own instance of the same shading model the world uses,
    // so they are lit by the same banded sun and the same rim — painted
    // wings in a painted world, rather than a photoreal bird pasted onto an
    // illustration. The camera sits at the origin of this scene, and there is
    // no fog at half a metre.
    // Lit for contrast, not for exposure. The first pass flooded the wings
    // with ambient so they would not go black against a bright sky, and what
    // came back was a flat orange slab that read as a sand dune in the corner
    // of the frame. A wing this close to the eye is nearly always backlit, so
    // it is drawn the way a backlit wing actually looks: a dark, banded body
    // with a hot rim along every edge the sky gets behind. That is also the
    // thing that separates one feather from the next.
    this.style = new StyleSystem(palette, {
      bands: 5, bandMix: 0.72,
      sunStrength: 1.10, ambStrength: 0.62,
      rimStrength: 2.10, rimPower: 2.6,
      fogMax: 0,
      // The wings live in their own scene at the origin, so a world-space
      // cloud shadow lookup would sample the same spot forever and flicker
      // the whole wing on and off as the deck drifted over that one point.
      cloudShadow: 0,
    });
    this.style.u.uCamPos.value.set(0, 0, 0);

    // Feather shape comes from the geometry now, not from an alpha mask. The
    // barbs are painted procedurally along the quad — cheaper than a texture
    // fetch, and it lets the vanes darken towards the tip in a way that reads
    // at the size these actually appear on screen.
    const featherAlbedo = /* glsl */`
      vec2 f = vUv;
      float alongTip = clamp(f.y, 0.0, 1.0);
      // Barbs, angled out from the shaft.
      float barb = 0.84 + 0.16 * sin((f.y * 74.0 + abs(f.x - 0.42) * 26.0));
      float shaft = 1.0 - smoothstep(0.012, 0.05, abs(f.x - 0.42));
      albedo = mix(uBase, uTip, alongTip * alongTip);
      albedo *= barb;
      albedo = mix(albedo, uBase * 1.6, shaft * 0.5);
      // Feathers overlap, so the near edge of each one throws a line of shade
      // onto the one beneath. Without this the whole hand fuses into a single
      // smooth blade and stops reading as feathers at all.
      float margin = smoothstep(0.34, 0.02, f.x) + smoothstep(0.72, 0.99, f.x);
      albedo *= 1.0 - margin * 0.42;
      ao = mix(1.0, 0.82, alongTip) * (1.0 - margin * 0.25);
    `;

    const makeFeather = (base, tip) => this.style.make({
      name: 'feather',
      // Tagged so the screen-space passes leave the wings alone; see
      // core/screenspace.js for why they have to.
      surfaceId: SURFACE.OVERLAY,
      pars: 'uniform vec3 uBase, uTip; varying vec2 vUv;',
      vertexPars: 'varying vec2 vUv;',
      vertexHook: 'vUv = uv;',
      albedo: featherAlbedo,
      side: THREE.DoubleSide,
      extra: {
        uBase: { value: new THREE.Color(base) },
        uTip: { value: new THREE.Color(tip) },
      },
    });

    /* Darker than the bird's nominal plumage on purpose.
     *
     * The grade in postfx lifts blacks towards the palette's shadow colour,
     * which at golden hour is a warm orange. Feed it a mid-brown wing and the
     * whole thing comes back the same orange as the hillside behind it, and
     * the player sees two slabs of sand in the corners of the frame. Sent in
     * dark, the wing lands in the bottom of the grade where the lift is doing
     * the colouring, and reads as a silhouette with the sky behind it —
     * which is what a wing seen from the cockpit of a bird actually is. */
    const deepen = (hex, k) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;
    const plumage = opts.color ?? '#6d5a48';
    const tipHue = opts.tipColor ?? '#3b3229';
    this.material = makeFeather(deepen(plumage, 0.52), deepen(tipHue, 0.55));
    this.tipMaterial = makeFeather(deepen(tipHue, 0.55), deepen(tipHue, 0.28));

    // The arm panels are skin and coverts, not flight feathers.
    this.skinMaterial = this.style.make({
      name: 'wing-skin',
      surfaceId: SURFACE.OVERLAY,
      pars: 'uniform vec3 uBase; varying vec2 vUv;',
      vertexPars: 'varying vec2 vUv;',
      vertexHook: 'vUv = uv;',
      albedo: `
        albedo = uBase;
        // Coverts lie in rows across the arm.
        float rows = 0.9 + 0.1 * sin(vUv.x * 34.0 + vUv.y * 9.0);
        albedo *= rows;
        // The leading edge catches the light; everything aft of it falls away
        // into the shadow of the feathers lying over it. That gradient across
        // the chord is most of what stops the arm reading as a flat plank.
        albedo *= mix(1.45, 0.55, smoothstep(0.0, 0.8, vUv.y));
        ao = 0.92 * mix(1.0, 0.78, vUv.y);
      `,
      side: THREE.DoubleSide,
      extra: { uBase: { value: new THREE.Color(plumage).multiplyScalar(0.42) } },
    });

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.left = this._buildWing(-1, opts);
    this.right = this._buildWing(1, opts);
    this.root.add(this.left.shoulder, this.right.shoulder);

    this._flex = 0;
    this._bankShift = 0;
  }

  _buildWing(side, opts) {
    const S = this.span * 0.5;

    const shoulder = new THREE.Group();
    // See Wings.ROOT: below and *ahead* of the eye. Ahead matters — a root
    // behind the near plane turns the wing inside out and blacks out the
    // frame. The shoulder itself stays off-screen; what comes into frame is
    // the outer wing.
    const R = Wings.ROOT;
    shoulder.position.set(side * S * R.x, S * R.y, S * R.z);
    // Kept so the per-frame bank shift offsets from the rest pose rather than
    // quietly redefining it.
    const home = shoulder.position.clone();

    /* Proportions.
     *
     * The first pass got these badly wrong and the wing came out a paddle:
     * the arm panels carried a chord of a third of the half-span and the
     * secondaries added as much again behind them, which is an aspect ratio
     * near two. Nothing posed on top of that reads as a wing.
     *
     * A buteo's wing is about aspect ratio six. So the arm is long and its
     * panel is narrow, and the secondaries are not extra chord bolted on
     * behind — they ARE the back half of the chord, overlapping the panel's
     * trailing edge. Shoulder to wrist is a little over half the wing; the
     * primaries are the rest. */
    const L1 = S * 0.28, L2 = S * 0.30;          // humerus, forearm
    const C0 = S * 0.17, C1 = S * 0.15, C2 = S * 0.115;  // panel chords

    const humerus = new THREE.Group();
    shoulder.add(humerus);
    humerus.add(panel(this.skinMaterial, side, L1, C0, C1));

    /** Rows of small feathers lying over an arm panel, root to tip. */
    const coverts = (parent, len, c0, c1, rows, perRow, scale, lift) => {
      const out = [];
      for (let r = 0; r < rows; r++) {
        const rv = rows === 1 ? 0 : r / (rows - 1);
        for (let i = 0; i < perRow; i++) {
          const t = i / (perRow - 1);
          const chord = lerp(c0, c1, t);
          const f = feather(this.material, side, chord * scale * (1 - rv * 0.3),
                            chord * 0.30, { taper: 0.45, curve: 0.26 });
          // Rows stack from the leading edge back, each one overlapping the last.
          f.position.set(side * len * t, lift * (1 - rv) * 0.6,
                         lerp(-chord * 0.34, chord * 0.30, rv));
          f.rotation.y = side * (-1.45 + rv * 0.18);      // lie aft along the chord
          f.rotation.z = side * 0.06;
          parent.add(f);
          out.push(f);
        }
      }
      return out;
    };
    const humerusCoverts = coverts(humerus, L1, C0, C1, 2, 5, 0.62, S * 0.010);

    const elbow = new THREE.Group();
    elbow.position.set(side * L1, 0, 0);
    humerus.add(elbow);

    const forearm = new THREE.Group();
    elbow.add(forearm);
    forearm.add(panel(this.skinMaterial, side, L2, C1, C2));
    const forearmCoverts = coverts(forearm, L2, C1, C2, 2, 5, 0.60, S * 0.009);

    // Secondaries: short feathers off the forearm's trailing edge, which is
    // what gives the inner wing its soft, ragged back edge.
    const secondaries = [];
    const nSec = 8;
    for (let i = 0; i < nSec; i++) {
      const t = i / (nSec - 1);
      const f = feather(this.material, side, S * lerp(0.24, 0.185, t), S * 0.085,
                        { taper: 0.34, curve: 0.20 });
      f.position.set(side * L2 * t, 0, lerp(C1, C2, t) * 0.30);
      f.rotation.y = side * lerp(-1.16, -1.28, t);     // rake aft
      forearm.add(f);
      secondaries.push(f);
    }

    const wrist = new THREE.Group();
    wrist.position.set(side * L2, 0, 0);
    forearm.add(wrist);

    const hand = new THREE.Group();
    wrist.add(hand);

    // Primaries: the long ones. These carry the silhouette, so they get the
    // fan, the rake and the slotted tips.
    const primaries = [];
    const nPri = 9;
    for (let i = 0; i < nPri; i++) {
      const t = i / (nPri - 1);
      // Longest around the eighth primary, shorter again at the very tip —
      // that fall-off is what rounds a buteo's hand and opens the slots.
      const len = S * (0.27 + 0.19 * Math.sin(t * Math.PI * 0.80));
      // Only the outermost few primaries are the dark ones.
      const mat = t > 0.72 ? this.tipMaterial : this.material;
      const f = feather(mat, side, len, S * lerp(0.115, 0.08, t), { taper: 0.42, curve: 0.20 });
      f.position.set(side * S * 0.05 * (1 - t), 0, C2 * 0.35 * t);
      f.userData.fan = lerp(-0.06, -0.50, t);     // splay aft when extended
      f.userData.sweep = lerp(0.10, 0.62, t);     // and rake hard when tucked
      f.rotation.y = side * f.userData.fan;
      hand.add(f);
      primaries.push(f);
    }

    // Alula — the little thumb feather that pops on a hard, slow pull.
    const alula = feather(this.material, side, S * 0.11, S * 0.045, { taper: 0.5, curve: 0.1 });
    alula.position.set(side * S * 0.01, 0, -C2 * 0.34);
    alula.rotation.y = side * 0.28;
    hand.add(alula);

    void opts;
    return { side, shoulder, home, humerus, elbow, forearm, wrist, hand,
             primaries, secondaries, alula, S,
             coverts: humerusCoverts.concat(forearmCoverts) };
  }

  setVisible(v) { this.enabled = v; this.root.visible = v; }

  /** Take the world's sun, so the wings are lit by the same sky. */
  sync(worldCamera, sunDir, sunColor) {
    this.camera.aspect = worldCamera.aspect;
    this.camera.updateProjectionMatrix();
    if (sunDir) {
      this._worldSun = (this._worldSun ?? new THREE.Vector3()).copy(sunDir).normalize();
      this.style.u.uSunDir.value.copy(this._worldSun);
    }
    if (sunColor) this.style.u.uSunColor.value.copy(sunColor);
  }

  /**
   * Where the wing root sits, in span units.
   *
   * This was a numeric solver once — measure the wing on screen, walk the
   * root until a landmark hit a target. It was worse than useless: the
   * projection is violently non-linear at the edge of a 118° cone, the
   * solver would happily push the root in front of the bird's face to satisfy
   * the constraint, and the result changed for every species.
   *
   * These are derived instead, once, from the geometry that actually matters:
   *
   *   a point L out along the wing, swept forward by φ from a root at
   *   (rx, ry, rz), sits at an angle atan2(rx + L·cosφ, L·sinφ − rz) from
   *   the view axis, and it is visible while that stays under the camera's
   *   half-angle.
   *
   * There is one hard constraint underneath all of it, and missing it cost
   * most of an afternoon: EVERY vertex of the wing must sit in front of the
   * near plane. A wing rooted behind the eye has triangles straddling it,
   * those project inside-out, and a single one of them fills the screen with
   * a black sheet that looks nothing like a bug in a wing. The root therefore
   * sits forward of the eye by more than the deepest chord, and the wing
   * reaches outward rather than forward from there.
   *
   * The numbers themselves came out of a sweep: every combination of root
   * height, root distance and sweep angle was posed, projected, and scored on
   * where seven points along the wing landed on screen. This is the one that
   * puts all seven in frame with their average at 74% of the way out and 58%
   * of the way down, and the outermost primary grazing the edge.
   *
   * In span units, so every species frames the same way.
   */
  static ROOT = { x: 0.32, y: -0.66, z: -0.26 };

  update(flight, dt, headQuat) {
    if (!this.enabled) return;
    this.style.u.uTime.value += dt;

    // The wings are posed in the head's frame, so the world sun has to be
    // brought into that frame or the light would swing with the bird instead
    // of staying put in the sky.
    if (headQuat && this._worldSun) {
      this.style.u.uSunDir.value.copy(this._worldSun)
        .applyQuaternion(_invQ.copy(headQuat).invert());
    }

    const ext = flight.wingExtension();          // 1 out, ~0.12 folded
    const stroke = flight.wingStroke();          // -1 .. 1
    const tuck = flight.tuck;
    const load = clamp(flight.load, -1, 5);

    // Wings bend under load and whip back at speed.
    const flexTarget = (load - 1) * 0.12 + clamp(flight.airspeed / 60, 0, 1) * 0.14;
    this._flex = damp(this._flex, flexTarget, 0.10, dt);

    // In a bank, the low wing swings out of frame and the high one fills it.
    this._bankShift = damp(this._bankShift, Math.sin(flight.bank), 0.12, dt);

    const sweepBase = this.cfg.wingSweep ?? 0.10;
    const ruffle = flight._stalled ?? 0;
    const beat = flight.flapping ? stroke : stroke * 0.25;
    const fold = 1 - ext;

    for (const w of [this.left, this.right]) {
      const s = w.side;
      const inside = s * Math.sign(this._bankShift || 1) > 0 ? 1 : -1;

      // ── shoulder: the wingbeat itself ──
      const dihedral = lerp(0.20, 0.02, tuck);   // resting droop when folded
      w.humerus.rotation.z = s * (beat * 0.62 * ext + dihedral);
      // Wings carry a standing forward sweep. Anatomically a bird's wing does
      // reach ahead of the shoulder; practically it is the only way a wing
      // rooted behind the eye ever crosses the front of the head, and it puts
      // the outer third of it exactly at the edge of frame.
      const sweepFwd = sweepBase * (1 - tuck * 0.55);
      w.humerus.rotation.y = s * (sweepFwd + beat * 0.16 * ext - tuck * 0.42);
      // Twist: the wing pitches nose-down through the downstroke, which is
      // where its thrust comes from and what makes a beat read as a beat.
      w.humerus.rotation.x = -beat * 0.22 * ext;

      // ── elbow and wrist: extension and tuck ──
      w.forearm.rotation.y = s * (sweepBase * 0.22 - fold * 1.25);
      w.forearm.rotation.z = s * (this._flex * 0.55 + beat * 0.18 * ext);
      w.forearm.rotation.x = -beat * 0.14 * ext;
      w.hand.rotation.y = -s * (fold * 1.45);
      w.hand.rotation.z = s * (this._flex + beat * 0.30 * ext);
      w.hand.rotation.x = -beat * 0.20 * ext;

      // ── feathers ──
      for (const f of w.primaries) {
        f.rotation.y = s * (f.userData.fan * ext - f.userData.sweep * tuck * 1.5);
        // Slotted tips: the primaries separate and twist as the wing loads up.
        f.rotation.z = s * this._flex * (0.35 + f.userData.sweep) * 1.4;
        f.rotation.x = this._flex * 0.30;
      }
      for (const f of w.secondaries) {
        f.rotation.z = s * (this._flex * 0.28 + beat * 0.08 * ext);
        f.rotation.x = this._flex * 0.16;
      }
      for (let i = 0; i < w.coverts.length; i++) {
        // Coverts lift a touch in the buffet, which is the visual tell that
        // the wing is near its limit.
        w.coverts[i].rotation.z = s * (this._flex * 0.10 + ruffle * ((i % 3) - 1) * 0.09);
      }
      // The alula only lifts when the wing is working hard and slow.
      const alulaUp = smooth(0.16, 0.34, flight._aEff) * (1 - tuck);
      w.alula.rotation.z = s * alulaUp * 0.9;
      w.alula.visible = alulaUp > 0.02;

      // Slide the whole wing slightly with the bank so one fills more frame.
      w.shoulder.position.x = w.home.x + this._bankShift * w.S * 0.06 * inside;
      w.shoulder.position.y = w.home.y - Math.abs(this._bankShift) * w.S * 0.03;
      w.shoulder.position.z = w.home.z;
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.root.traverse((o) => o.geometry?.dispose());
    this.style.dispose();
  }
}
