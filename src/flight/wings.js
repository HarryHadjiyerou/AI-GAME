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
import { clamp, lerp, damp, smooth } from '../core/noise.js';

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
  const segs = 3;
  const pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = width * (1 - t * taper);
    const x = side * length * t;
    // A feather is not straight: it bows aft towards the tip.
    const z = length * curve * t * t;
    pos.push(x, 0, z - w * 0.35, x, 0, z + w * 0.65);
    nrm.push(0, 1, 0, 0, 1, 0);
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
  constructor(atmo, assets, cfg, opts = {}) {
    this.cfg = cfg;
    this.span = cfg.wingSpan ?? 1.2;
    this.enabled = true;

    // A private scene so the world's background, fog and terrain never enter
    // this pass, and the wing pass never clears what is already drawn.
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(opts.fov ?? 118, 1, 0.02, 12);
    this.scene.add(this.camera);

    this.sun = new THREE.DirectionalLight(0xfff2df, 2.1);
    this.sun.position.set(0.4, 1, 0.3);
    this.scene.add(this.sun);
    this.fill = new THREE.HemisphereLight(0xbcd4ec, 0x4a4438, 0.9);
    this.scene.add(this.fill);

    const feather = assets.feather();

    // One texture, two jobs: its RGB shades the feather, its alpha cuts the
    // outline. Both come through `map`, which multiplies the whole RGBA — an
    // `alphaMap` would be wrong here, because three reads that from the GREEN
    // channel, which in this texture is the shading, not the coverage.
    // Alpha-tested rather than blended so the wing sorts correctly against
    // itself without any per-frame ordering work.
    this.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(opts.color ?? '#6d5a48'),
      map: feather,
      transparent: false,
      alphaTest: 0.45,
      depthWrite: true,
      roughness: 0.74,
      metalness: 0.0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.9,
    });
    void atmo;   // wings are lit by their own scene, not the world's atmosphere

    this.tipMaterial = this.material.clone();
    this.tipMaterial.color = new THREE.Color(opts.tipColor ?? '#3b3229');

    // The arm panels are skin and covert feathers, not flight feathers, so
    // they take the colour but not the cut-out.
    this.skinMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(opts.color ?? '#6d5a48').clone().multiplyScalar(0.88),
      roughness: 0.82, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.85,
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
    // Below and behind the eye, roughly where a shoulder is. The shoulder
    // itself stays off-screen; what comes into frame is the outer wing.
    shoulder.position.set(side * S * 0.26, -S * 0.56, S * 0.25);
    // Kept so the per-frame bank shift offsets from the rest pose rather than
    // quietly redefining it.
    const home = shoulder.position.clone();

    // A short arm and long primaries: the arm is what sits off-frame, the
    // primaries are what the player actually sees.
    const L1 = S * 0.34, L2 = S * 0.30;          // humerus, forearm
    const C0 = S * 0.34, C1 = S * 0.30, C2 = S * 0.23;   // chords

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
    const humerusCoverts = coverts(humerus, L1, C0, C1, 2, 5, 0.50, S * 0.012);

    const elbow = new THREE.Group();
    elbow.position.set(side * L1, 0, 0);
    humerus.add(elbow);

    const forearm = new THREE.Group();
    elbow.add(forearm);
    forearm.add(panel(this.skinMaterial, side, L2, C1, C2));
    const forearmCoverts = coverts(forearm, L2, C1, C2, 2, 5, 0.48, S * 0.010);

    // Secondaries: short feathers off the forearm's trailing edge, which is
    // what gives the inner wing its soft, ragged back edge.
    const secondaries = [];
    const nSec = 8;
    for (let i = 0; i < nSec; i++) {
      const t = i / (nSec - 1);
      const f = feather(this.material, side, S * lerp(0.30, 0.24, t), S * 0.19,
                        { taper: 0.30, curve: 0.22 });
      f.position.set(side * L2 * t, 0, lerp(C1, C2, t) * 0.42);
      f.rotation.y = side * lerp(-1.02, -1.16, t);     // rake aft
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
      const len = S * lerp(0.46, 0.66, Math.sin(t * Math.PI * 0.58));
      const mat = t > 0.55 ? this.tipMaterial : this.material;
      const f = feather(mat, side, len, S * lerp(0.20, 0.14, t), { taper: 0.42, curve: 0.20 });
      f.position.set(side * S * 0.05 * (1 - t), 0, C2 * 0.35 * t);
      f.userData.fan = lerp(-0.06, -0.50, t);     // splay aft when extended
      f.userData.sweep = lerp(0.10, 0.62, t);     // and rake hard when tucked
      f.rotation.y = side * f.userData.fan;
      hand.add(f);
      primaries.push(f);
    }

    // Alula — the little thumb feather that pops on a hard, slow pull.
    const alula = feather(this.material, side, S * 0.13, S * 0.06, { taper: 0.5, curve: 0.1 });
    alula.position.set(side * S * 0.01, 0, -C2 * 0.34);
    alula.rotation.y = side * 0.28;
    hand.add(alula);

    void opts;
    return { side, shoulder, home, humerus, elbow, forearm, wrist, hand,
             primaries, secondaries, alula, S,
             coverts: humerusCoverts.concat(forearmCoverts) };
  }

  setVisible(v) { this.enabled = v; this.root.visible = v; }

  /** Neutral pose: wings out, no beat, no load. Used for calibration. */
  _restPose() {
    this.update({
      wingExtension: () => 1, wingStroke: () => 0,
      tuck: 0, load: 1, airspeed: this.cfg.cruiseSpeed, bank: 0,
      flapping: false, _aEff: 0.06, _stalled: 0,
    }, 1);
    this.root.updateMatrixWorld(true);
  }

  /**
   * Put the wings where they belong in frame, by measurement rather than by
   * arithmetic.
   *
   * Every bird has a different span, and the transform chain from shoulder to
   * wingtip runs through five rotations, so solving for a root offset on paper
   * is both fiddly and fragile. Instead: pick a landmark on the wing, decide
   * where it should sit on screen, and numerically walk the shoulder until it
   * does. Four iterations of a finite-difference Newton step is plenty, it
   * costs nothing (it happens once, at spawn), and it keeps working when the
   * geometry or the field of view changes.
   *
   * @param {[number,number]} target  where the landmark should land, in NDC
   */
  calibrate(target = [0.80, -0.44]) {
    const probe = this.right.primaries[Math.floor(this.right.primaries.length / 2)];
    if (!probe) return this;
    const camera = this.camera;
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    // The landmark is the far corner of that feather.
    const pos = probe.geometry.attributes.position;
    let far = 0, farD = -1;
    for (let i = 0; i < pos.count; i++) {
      const d = pos.getX(i) ** 2 + pos.getY(i) ** 2 + pos.getZ(i) ** 2;
      if (d > farD) { farD = d; far = i; }
    }

    const v = new THREE.Vector3();
    const measure = () => {
      this._restPose();
      v.fromBufferAttribute(pos, far).applyMatrix4(probe.matrixWorld).project(camera);
      // Behind the camera projects to nonsense; report it as far off-frame in
      // the direction that pushes the solver back towards sensible values.
      if (v.z > 1 || v.z < -1) return [3, -3];
      return [v.x, v.y];
    };

    const home = { y: this.right.home.y, z: this.right.home.z };
    const apply = (h) => {
      for (const w of [this.left, this.right]) { w.home.y = h.y; w.home.z = h.z; }
    };

    const S = this.span * 0.5;
    const eps = S * 0.02;
    for (let iter = 0; iter < 6; iter++) {
      apply(home);
      const f0 = measure();
      const ex = f0[0] - target[0], ey = f0[1] - target[1];
      if (Math.abs(ex) < 0.02 && Math.abs(ey) < 0.02) break;

      apply({ y: home.y, z: home.z + eps });
      const fz = measure();
      apply({ y: home.y + eps, z: home.z });
      const fy = measure();

      // Numeric Jacobian of (ndc.x, ndc.y) with respect to (z, y).
      const a = (fz[0] - f0[0]) / eps, b = (fy[0] - f0[0]) / eps;
      const c = (fz[1] - f0[1]) / eps, d = (fy[1] - f0[1]) / eps;
      const det = a * d - b * c;
      if (!Number.isFinite(det) || Math.abs(det) < 1e-6) break;

      // Damped step: the projection is strongly non-linear near the edge of
      // frame, and a full Newton stride will happily jump behind the camera.
      const dz = -(d * ex - b * ey) / det * 0.6;
      const dy = -(-c * ex + a * ey) / det * 0.6;
      home.z = clamp(home.z + clamp(dz, -S * 0.3, S * 0.3), -S * 0.1, S * 1.4);
      home.y = clamp(home.y + clamp(dy, -S * 0.3, S * 0.3), -S * 1.6, -S * 0.05);
    }
    apply(home);
    this._restPose();
    this.calibration = { ...home, landmark: measure() };
    return this;
  }

  /** Match the world camera, and take the world's light so the wings belong. */
  sync(worldCamera, environment, sunDir, sunColor) {
    this.camera.aspect = worldCamera.aspect;
    this.camera.updateProjectionMatrix();
    this.scene.environment = environment ?? null;
    if (sunDir) this.sun.position.copy(sunDir);
    if (sunColor) this.sun.color.set(sunColor);
  }

  update(flight, dt) {
    if (!this.enabled) return;

    const ext = flight.wingExtension();          // 1 out, ~0.12 folded
    const stroke = flight.wingStroke();          // -1 .. 1
    const tuck = flight.tuck;
    const load = clamp(flight.load, -1, 5);

    // Wings bend under load and whip back at speed.
    const flexTarget = (load - 1) * 0.12 + clamp(flight.airspeed / 60, 0, 1) * 0.14;
    this._flex = damp(this._flex, flexTarget, 0.10, dt);

    // In a bank, the low wing swings out of frame and the high one fills it.
    this._bankShift = damp(this._bankShift, Math.sin(flight.bank), 0.12, dt);

    const sweepBase = this.cfg.wingSweep ?? 0.66;
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
    this.material.dispose();
    this.tipMaterial.dispose();
    this.skinMaterial.dispose();
    this.sun.dispose(); this.fill.dispose();
  }
}
