/* ═══════════════════════════════════════════════════════════
   Things worth looking at.

   Two of them, and the first is the more important.

   MOTES — the air is full of drifting specks, and where there is
   rising air they spiral upward in a visible column. This is the one
   change that turns soaring from guesswork into a game. The lift field
   was always there; you simply could not see it, so finding a thermal
   meant flying in circles hoping the altimeter would tick up. Now the
   lift is drawn: you spot a column of motes turning over a sunlit
   slope from half a kilometre away, and you go to it.

   The columns are not decoration placed near where lift happens to be.
   Every second or so the game sweeps the real lift field around the
   bird, takes the strongest few points, and puts the columns exactly
   there — so what you can see and what will actually carry you are the
   same thing by construction.

   LANDMARKS — floating islands, arches and stacks, hung in the air at
   fixed points in each world. Partly because they look extraordinary,
   and partly because an open world with nothing in it gives you no
   reason to choose one direction over another.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, clamp, lerp } from '../core/noise.js';

/** Merging needs every part to agree about having an index; flat shading
    wants none of them to. Both problems, one call. */
const flat = (g) => (g.index ? g.toNonIndexed() : g);

/* ═══════════════════ motes ══════════════════════════════ */

const MOTE_VERT = /* glsl */`
  precision highp float;
  uniform vec3  uCamPos;
  uniform vec3  uBox;
  uniform float uTime, uDrift;
  uniform vec4  uCols[4];        // xz = centre, z = strength, w = radius
  uniform vec3  uWind;

  attribute vec3 iPos;
  attribute float iSeed;
  varying float vAlpha;
  varying float vLift;

  void main() {
    // Endless field, wrapped around the bird.
    vec3 p = iPos;
    p.xz += uWind.xz * uTime * 0.25;
    p.y += sin(uTime * 0.3 + iSeed * 21.0) * 2.0 + uTime * uDrift * (0.3 + iSeed);

    vec3 rel = mod(p - uCamPos + uBox * 0.5, uBox) - uBox * 0.5;
    vec3 world = uCamPos + rel;

    // Which column, if any, has hold of this mote.
    float best = 0.0;
    vec2 bestCentre = vec2(0.0);
    for (int i = 0; i < 4; i++) {
      vec2 c = uCols[i].xy;
      float strength = uCols[i].z;
      float radius = max(1.0, uCols[i].w);
      float d = length(world.xz - c);
      float infl = strength * (1.0 - smoothstep(radius * 0.25, radius, d));
      if (infl > best) { best = infl; bestCentre = c; }
    }
    vLift = best;

    if (best > 0.01) {
      // Inside a column the mote climbs and turns. The swirl is what makes
      // it read as a thermal rather than as a fountain.
      vec2 toC = world.xz - bestCentre;
      float d = max(2.0, length(toC));
      vec2 tangent = vec2(-toC.y, toC.x) / d;
      float rise = mod(uTime * (6.0 + best * 9.0) + iSeed * 160.0, uBox.y);
      world.y += rise * best - uBox.y * 0.5 * best;
      world.xz += tangent * best * 9.0 * sin(uTime * 0.6 + iSeed * 12.0)
                - normalize(toC) * best * 3.0;
    }

    float dist = length(world - uCamPos);
    vAlpha = smoothstep(uBox.x * 0.5, uBox.x * 0.22, dist) * smoothstep(3.0, 14.0, dist);

    vec4 mv = viewMatrix * vec4(world, 1.0);
    float size = mix(0.16, 0.5, best) * (0.6 + iSeed * 0.8);
    mv.xy += position.xy * size;
    gl_Position = projectionMatrix * mv;
  }
`;

const MOTE_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uDrab, uGlow;
  varying float vAlpha, vLift;
  void main() {
    if (vAlpha < 0.02) discard;
    // Motes caught in lift glow; the rest are barely there.
    vec3 col = mix(uDrab, uGlow, clamp(vLift * 1.6, 0.0, 1.0));
    float a = vAlpha * mix(0.30, 0.95, clamp(vLift * 2.0, 0.0, 1.0));
    gl_FragColor = vec4(col, a);
  }
`;

export class Motes {
  constructor(style, palette, opts = {}) {
    const count = opts.count ?? 900;
    const box = new THREE.Vector3(560, 320, 560);
    const r = rng(opts.seed ?? 5);
    this.group = new THREE.Group();

    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.instanceCount = count;

    const iPos = new Float32Array(count * 3);
    const iSeed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      iPos[i * 3] = (r() - 0.5) * box.x;
      iPos[i * 3 + 1] = (r() - 0.5) * box.y;
      iPos[i * 3 + 2] = (r() - 0.5) * box.z;
      iSeed[i] = r();
    }
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
    geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(iSeed, 1));

    this.uniforms = {
      uCamPos: { value: new THREE.Vector3() },
      uBox: { value: box },
      uTime: { value: 0 },
      uDrift: { value: 0.4 },
      uWind: { value: new THREE.Vector3(2, 0, 1) },
      uCols: { value: [
        new THREE.Vector4(), new THREE.Vector4(),
        new THREE.Vector4(), new THREE.Vector4(),
      ] },
      uDrab: { value: palette.haze.clone().lerp(palette.foam, 0.35) },
      uGlow: { value: palette.sunColor.clone().lerp(palette.rim, 0.4) },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.group.add(this.mesh);
    base.dispose();

    this._scan = 0;
    this._probe = new THREE.Vector3();
    this._out = new THREE.Vector3();
    this.columns = [];
    this.thermalStrength = opts.thermalStrength ?? 5;
    base.dispose?.();
  }

  /**
   * Sweep the real lift field and put the visible columns where the strongest
   * lift actually is. Cheap enough to do every second: a 9×9 grid is 81
   * samples of a function the terrain already calls tens of thousands of
   * times a frame.
   */
  _findColumns(flight, camPos) {
    if (!flight?.windAt) return;
    const RANGE = 900, N = 9;
    const found = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = camPos.x + ((i / (N - 1)) - 0.5) * 2 * RANGE;
        const z = camPos.z + ((j / (N - 1)) - 0.5) * 2 * RANGE;
        this._probe.set(x, camPos.y, z);
        flight.windAt(this._probe, flight.time, this._out);
        if (this._out.y > 1.2) found.push({ x, z, lift: this._out.y });
      }
    }
    found.sort((a, b) => b.lift - a.lift);

    // Keep them apart, or all four land on the same core.
    const picked = [];
    for (const c of found) {
      if (picked.every((p) => Math.hypot(p.x - c.x, p.z - c.z) > 320)) picked.push(c);
      if (picked.length === 4) break;
    }
    this.columns = picked;

    const cols = this.uniforms.uCols.value;
    for (let i = 0; i < 4; i++) {
      const c = picked[i];
      if (c) cols[i].set(c.x, c.z, clamp(c.lift / this.thermalStrength, 0, 1), 190);
      else cols[i].set(0, 0, 0, 1);
    }
  }

  update(camPos, dt, flight) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uCamPos.value.copy(camPos);
    this._scan -= dt;
    if (this._scan <= 0) { this._scan = 1.1; this._findColumns(flight, camPos); }
  }

  setWind(w) { this.uniforms.uWind.value.copy(w); }

  /** Nearest column, for the HUD's "lift over there" cue. */
  nearest(camPos) {
    let best = null, bd = Infinity;
    for (const c of this.columns) {
      const d = Math.hypot(c.x - camPos.x, c.z - camPos.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best ? { ...best, distance: bd } : null;
  }

  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); this.group.removeFromParent(); }
}

/* ═══════════════════ landmarks ══════════════════════════ */

/** A floating islet: a tapered rock underside with a flat top. */
function islet(radius, depth, seed) {
  const r = rng(seed);
  const geo = new THREE.IcosahedronGeometry(radius, 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const up = v.y / radius;
    // Flatten the top into a plateau, and draw the underside down into a
    // ragged point — the silhouette that says "this should not be up here".
    if (up > 0.05) {
      v.y = radius * 0.05 + (v.y - radius * 0.05) * 0.18;
      v.x *= 1.06; v.z *= 1.06;
    } else {
      const t = -up;
      v.y = -t * depth * (0.6 + 0.7 * t);
      const pinch = 1 - t * 0.82;
      v.x *= pinch; v.z *= pinch;
      const jag = 1 + (r() - 0.5) * 0.34 * t;
      v.x *= jag; v.z *= jag; v.y *= jag;
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return flat(geo);
}

const LANDMARK_ALBEDO = /* glsl */`
  // Grass on anything flat enough, rock everywhere else — the whole read of
  // a floating island in one line.
  // Not called 'flat': that is a reserved interpolation qualifier in
  // GLSL ES 3.00 and the shader will not compile with it.
  float flatness = smoothstep(0.45, 0.85, N.y);
  float band = smoothstep(-1.0, 6.0, vWorld.y - uTopY);
  albedo = mix(uRock, uGrass, flatness * band);

  float grain = sNoise(vWorld.xz * 0.35 + vWorld.y * 0.2) - 0.5;
  albedo *= 1.0 + grain * 0.16;

  // Strata in the exposed rock underneath.
  float strata = sin(vWorld.y * 0.42);
  albedo *= 1.0 - smoothstep(0.72, 1.0, abs(strata)) * 0.14 * (1.0 - flatness);

  ao = mix(0.62, 1.0, smoothstep(-28.0, 4.0, vWorld.y - uTopY));
`;

const FALL_ALBEDO = /* glsl */`
  // A waterfall is a scrolling column that thins and frays as it falls, and
  // then simply stops existing — there is nothing below to catch it.
  float down = clamp((uTopY - vWorld.y) / uFallLength, 0.0, 1.0);
  float streak = sNoise(vec2(vWorld.x * 2.2 + vWorld.z * 1.7, vWorld.y * 0.30 - uTime * 5.5));
  float thread = smoothstep(0.34, 0.75, streak);

  albedo = mix(uWater, uFoam, thread * 0.8 + 0.2);
  emissive += uFoam * thread * 0.35 * (1.0 - down);
  alpha = (1.0 - down * down) * mix(0.22, 0.85, thread);
  ao = 1.0;
`;

export class Landmarks {
  constructor(style, palette, opts = {}) {
    this.group = new THREE.Group();
    this.items = [];
    const world = opts.world;
    const height = opts.height;
    const r = rng(opts.seed ?? 99);

    const spec = {
      forest:   { count: 5, radius: [42, 95], alt: [520, 1000], trees: true, falls: true },
      coast:    { count: 4, radius: [34, 72], alt: [180, 430], trees: true, falls: true },
      mountain: { count: 6, radius: [50, 120], alt: [2200, 3100], trees: false, falls: false },
      city:     { count: 3, radius: [30, 58], alt: [380, 560], trees: true, falls: false },
    }[world] ?? { count: 4, radius: [40, 80], alt: [400, 800], trees: true, falls: true };

    const rockMat = style.make({
      name: 'islet',
      pars: 'uniform vec3 uRock, uGrass; uniform float uTopY;',
      albedo: LANDMARK_ALBEDO,
      extra: {
        uRock: { value: palette.rock.clone().multiplyScalar(0.88) },
        uGrass: { value: palette.ground[1].clone() },
        uTopY: { value: 0 },
      },
    });

    const fallMat = style.make({
      name: 'waterfall',
      pars: 'uniform vec3 uWater, uFoam; uniform float uTopY, uFallLength;',
      albedo: FALL_ALBEDO,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      extra: {
        uWater: { value: palette.waterShallow.clone() },
        uFoam: { value: palette.foam.clone() },
        uTopY: { value: 0 },
        uFallLength: { value: 150 },
      },
    });
    this.fallMat = fallMat;
    this.rockMat = rockMat;

    for (let i = 0; i < spec.count; i++) {
      // Ring them round the spawn at varying bearings so there is always one
      // in view and always another somewhere else.
      const ang = (i / spec.count) * Math.PI * 2 + r() * 0.7;
      const dist = 900 + r() * 2600;
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      const ground = height ? height(x, z) : 0;
      const y = Math.max(ground, opts.waterLevel ?? 0)
              + lerp(spec.alt[0], spec.alt[1], r()) * 0.35 + 120;

      const radius = lerp(spec.radius[0], spec.radius[1], r());
      const parts = [islet(radius, radius * (1.6 + r() * 1.4), (opts.seed ?? 99) + i * 13)];

      if (spec.trees) {
        // A few cones on the plateau. Not the vegetation system — these are
        // decoration on a fixed object, not a streamed field.
        const n = 3 + Math.floor(r() * 5);
        for (let t = 0; t < n; t++) {
          const ta = r() * Math.PI * 2;
          const tr = r() * radius * 0.62;
          const th = radius * (0.28 + r() * 0.3);
          const cone = new THREE.ConeGeometry(th * 0.32, th, 6, 1);
          cone.translate(Math.cos(ta) * tr, radius * 0.05 + th * 0.5, Math.sin(ta) * tr);
          parts.push(flat(cone));
        }
      }

      const geo = mergeGeometries(parts, false);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, rockMat);
      mesh.position.set(x, y, z);
      mesh.frustumCulled = true;
      this.group.add(mesh);

      if (spec.falls && r() < 0.8) {
        const fallLen = 110 + r() * 190;
        const fg = new THREE.PlaneGeometry(radius * (0.22 + r() * 0.2), fallLen, 1, 6);
        fg.translate(0, -fallLen * 0.5, 0);
        const fall = new THREE.Mesh(fg, fallMat);
        const fa = r() * Math.PI * 2;
        fall.position.set(x + Math.cos(fa) * radius * 0.7, y + radius * 0.04, z + Math.sin(fa) * radius * 0.7);
        fall.rotation.y = fa;
        this.group.add(fall);
      }

      this.items.push({ x, y, z, radius });
    }

    // The shaders need one shared plateau height; the islands sit close
    // enough in altitude that a single value reads correctly on all of them.
    const avgTop = this.items.reduce((a, it) => a + it.y, 0) / Math.max(1, this.items.length);
    rockMat.uniforms.uTopY.value = avgTop;
    fallMat.uniforms.uTopY.value = avgTop;
  }

  update() { /* static by design — they are landmarks */ }

  /** The nearest island, for navigation cues. */
  nearest(p) {
    let best = null, bd = Infinity;
    for (const it of this.items) {
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      if (d < bd) { bd = d; best = it; }
    }
    return best ? { ...best, distance: bd } : null;
  }

  dispose() {
    this.group.traverse((o) => o.geometry?.dispose());
    this.group.removeFromParent();
  }
}
