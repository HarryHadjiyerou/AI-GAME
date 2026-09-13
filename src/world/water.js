/* ═══════════════════════════════════════════════════════════
   Water.

   A radial disc that follows the bird — dense underfoot, coarse at the
   horizon — displaced by a sum of Gerstner waves with an analytically
   derived normal.

   The first version of this shaded water without reflecting anything,
   on the theory that a stylised sea wants flat banded colour and a
   glitter path, not a mirror. Half of that was right, and half of it
   was why the sea looked like painted tin.

   What it missed is that reflection is not a finish applied to water,
   it is most of what water IS. Look along a sea at a shallow angle and
   you are looking at the sky; look straight down into it and you are
   looking at the bottom. Nearly everything people recognise about
   water falls out of that one fact, so it is what this is built on:

     • Fresnel. The ratio of sky to depth is computed per pixel from
       the angle between the eye and the real wave normal, at water's
       own reflectance. Grazing angles go to mirror, steep angles go to
       glass, and the transition happens by itself.
     • The reflection is the real sky, evaluated along the reflected
       ray by the same function that paints the dome (see sky.js), so
       the sea carries the sun's halo, the cloud deck and the horizon
       band — and when weather drags the sky to leaden the sea follows
       on the same frame.
     • Beer-Lambert absorption. Water eats red first and blue last, so
       the body colour is the exponential of depth per channel rather
       than a gradient between two hand-picked colours.
     • Refraction: the bottom is displaced by the wave slope, so the
       shallows wobble.
     • Glare shaped by the wave normals, which is what turns a
       specular highlight into a broken path running towards you.
     • Foam on the crests and along the depth contour, animated so it
       runs up the sand instead of sitting on it.

   The banding is still here, because flat stepped colour is what keeps
   this in the same picture as the rest of the game. It is just applied
   to the light coming out of the water now, rather than instead of it.

   Depth comes from the terrain field, sampled onto a per-vertex
   attribute whenever the disc re-centres.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { clamp } from '../core/noise.js';
import { SKY_PARS_EMBED } from './sky.js';
import { SURFACE } from '../core/screenspace.js';

const WAVE_PARS = /* glsl */`
  uniform vec4  uWaveA, uWaveB, uWaveC, uWaveD;
  uniform float uWaveScale, uWaveTime;
  attribute float aDepth;
  varying float vWDepth;

  // One Gerstner contribution, accumulating the partial derivatives so the
  // normal is exact rather than sampled.
  vec3 gerstner(vec4 w, vec3 p, float atten, inout vec3 tangent, inout vec3 binormal) {
    float steep = w.w * atten;
    float k = 6.28318530718 / w.z;
    float c = sqrt(9.81 / k);
    vec2 d = normalize(w.xy);
    float f = k * (dot(d, p.xz) - c * uWaveTime);
    float a = steep / k;
    tangent  += vec3(-d.x * d.x * steep * sin(f), d.x * steep * cos(f), -d.x * d.y * steep * sin(f));
    binormal += vec3(-d.x * d.y * steep * sin(f), d.y * steep * cos(f), -d.y * d.y * steep * sin(f));
    return vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
  }
`;

const WAVE_HOOK = /* glsl */`
    vec3 wp0 = (modelMatrix * vec4(pos, 1.0)).xyz;
    vWDepth = aDepth;

    // Waves die as the bottom comes up and stop entirely on dry land.
    float atten = smoothstep(0.0, 9.0, aDepth) * uWaveScale;

    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);
    vec3 disp = gerstner(uWaveA, wp0, atten, tangent, binormal)
              + gerstner(uWaveB, wp0, atten, tangent, binormal)
              + gerstner(uWaveC, wp0, atten, tangent, binormal)
              + gerstner(uWaveD, wp0, atten, tangent, binormal);
    pos += disp;
    nrm = normalize(cross(binormal, tangent));
`;

const WATER_PARS = /* glsl */`
  uniform vec3  uDeep, uShallow, uFoam, uGlitter;
  uniform vec3  uAbsorb, uScatter;
  uniform float uFoamWidth, uWaterTime, uBandCount, uGlitterAmount;
  uniform float uReflection, uRipple, uRefraction, uClarity;
  varying float vWDepth;

  ${SKY_PARS_EMBED}

  /* Schlick, with water's reflectance head-on.
   *
   * Two percent is why you can see the bottom of a pool when you stand over
   * it; the same curve climbs to one at the grazing angles you get looking
   * out to sea, which is why the same pool is a mirror from the far end.
   * This one line is doing most of the work in this shader. */
  float waterFresnel(float cosTheta) {
    float m = clamp(1.0 - cosTheta, 0.0, 1.0);
    float m2 = m * m;
    return 0.02 + 0.98 * (m2 * m2 * m);
  }
`;

const WATER_ALBEDO = /* glsl */`
  if (vWDepth < -0.15) discard;    // the disc covers dry land too
  float d = max(vWDepth, 0.0);

  /* ── the surface normal, at two scales ──────────────────
   *
   * The Gerstner normal is exact, but it only carries the four swell
   * components the vertex shader integrates, and a mesh that is metres
   * between vertices out at the horizon cannot hold anything finer. All the
   * detail that makes water read — the chop, the wind ripple, the texture
   * that breaks a reflection into something moving — lives below that, so it
   * is added here per pixel and never touches the geometry. */
  vec2 rp = vWorld.xz;
  float rt = uWaterTime;
  // Three layers crossing at different angles and speeds. Crossing matters:
  // one layer is a corrugated sheet, three is a sea.
  vec2 ripple = vec2(0.0);
  ripple += vec2(sNoise(rp * 0.36 + vec2(rt * 0.9, rt * 0.4)) - 0.5,
                 sNoise(rp * 0.36 + vec2(11.0 - rt * 0.4, rt * 0.9)) - 0.5) * 1.00;
  ripple += vec2(sNoise(rp * 0.95 - vec2(rt * 1.5, rt * 0.7)) - 0.5,
                 sNoise(rp * 0.95 + vec2(rt * 0.7, 23.0 - rt * 1.5)) - 0.5) * 0.55;
  ripple += vec2(sNoise(rp * 2.40 + vec2(rt * 2.2, 5.0)) - 0.5,
                 sNoise(rp * 2.40 - vec2(3.0, rt * 2.2)) - 0.5) * 0.28;

  /* Fade the fine detail out with distance.
   *
   * This is not an optimisation, it is the difference between a sea and a
   * field of static. Past a few hundred metres one pixel covers many ripples,
   * and a normal sampled from the middle of them is noise — it changes
   * completely between neighbouring pixels and again on the next frame. The
   * correct answer at that range is the average, and the average of a lot of
   * ripples pointing every way is flat. So the surface converges to a mirror
   * as it recedes, which is also what a real sea does to look at. */
  float ripFade = 1.0 - smoothstep(70.0, 520.0, vDepth);
  // And out in the shallows, where there is not enough water to move.
  ripFade *= smoothstep(0.0, 1.2, d);
  N = normalize(N + vec3(ripple.x, 0.0, ripple.y) * uRipple * ripFade);

  vec3 Vw = normalize(uCamPos - vWorld);     // surface towards the eye
  float ndv = clamp(dot(N, Vw), 0.0, 1.0);

  /* ── what is under the water ────────────────────────────
   *
   * Beer-Lambert: light entering the water is absorbed exponentially with
   * the distance it travels, and at a different rate per channel. Red is
   * gone within a couple of metres, green survives several, blue goes a long
   * way — which is the whole reason deep water is blue and why it goes green
   * over sand before it goes blue over nothing.
   *
   * The path length is not the depth: light goes down and comes back, and at
   * a shallow viewing angle it takes a longer slant on the way out. */
  float slant = 1.0 / max(0.18, ndv);
  float path = d * (1.0 + 0.85 * slant);
  vec3 transmit = exp(-uAbsorb * path);

  // The bottom, refracted. The wave slope bends the line of sight, so what
  // you see through the surface slides about — strongest in the shallows,
  // gone by the time absorption has taken over anyway.
  float bend = dot(ripple, vec2(0.7, 0.7)) * uRefraction * ripFade;
  float dShift = clamp(d + bend * 1.4, 0.0, 1e4);
  // Sand shows through where the water is thin; the colour of the bottom is
  // the shallow colour, lit and then eaten by the water above it.
  vec3 bottom = uShallow * (0.55 + 0.45 * exp(-dShift * 0.25));

  // And the water body itself, which is not clear: it scatters light back
  // out. That is what you are looking at once the bottom has gone.
  float scatterAmt = 1.0 - exp(-d * 0.13);
  vec3 body = mix(bottom * transmit, uScatter, scatterAmt * uClarity);

  // The stepped depth bands, kept from the painted version, applied to the
  // light coming out of the water rather than replacing it. This is what
  // holds the sea in the same picture as the banded terrain behind it.
  float deepT = 1.0 - exp(-d / 9.0);
  float stepped = floor(deepT * uBandCount) / uBandCount;
  body = mix(body, mix(body, uDeep, 0.55), mix(deepT, stepped, 0.72) * 0.55);

  /* ── what is above it ───────────────────────────────────
   *
   * The reflected ray, and the real sky along it. Clamped just above the
   * horizontal: a wave steep enough to reflect downwards would otherwise
   * sample the ground half of the gradient and put a band of dirt across the
   * sea. */
  vec3 R = reflect(-Vw, N);
  R.y = max(R.y, 0.012);
  R = normalize(R);
  // Two octaves of cloud: the wave normals scatter the reflection before the
  // eye ever resolves the third.
  vec3 skyRefl = avesSky(R, uStars * 0.55, 0.35, 2);

  /* The sun in the reflection, done as a reflected disc rather than as a
   * Blinn-Phong highlight.
   *
   * These are the same thing mathematically, but written this way the glare
   * inherits the wave normals for free, which is what breaks it into the
   * shifting path across the swell instead of one round hotspot. Two lobes:
   * a tight core for the disc, and a wide one for the haze around it. */
  float rsun = max(dot(R, uSunDir), 0.0);
  float core = pow(rsun, 900.0);
  float halo = pow(rsun, 42.0);
  /* The sparkle is only allowed where the sun is actually being reflected.
   *
   * Multiplied in on its own it covered the whole sea in speckle, because the
   * ripple perturbs the reflected ray far enough that some fraction of every
   * pixel anywhere catches the sun. Gating it on the broad lobe confines it to
   * the glitter path, which is where it belongs and the only place it reads as
   * anything but noise — and fading it with distance keeps it from aliasing
   * into television snow at the horizon. */
  float sparkle = smoothstep(0.62, 0.97, sNoise(rp * 1.25 + rt * 1.1))
                * smoothstep(0.04, 0.35, halo) * ripFade;
  vec3 glare = uGlitter * (core * 3.0 + sparkle * 2.6 + halo * halo * 0.45)
             * uGlitterAmount;

  /* ── mix them ───────────────────────────────────────────
   *
   * Fresnel decides. Nothing else in this shader has to know about viewing
   * angle: the horizon turning to mirror and the water under the bird
   * turning to glass both come out of this one number. */
  float fres = waterFresnel(ndv) * uReflection;
  albedo = mix(body, skyRefl, fres);
  emissive += glare * mix(0.35, 1.0, fres);

  /* ── foam ───────────────────────────────────────────────
   *
   * Foam is the one part of water that is not reflective or transmissive —
   * it is a diffuse white solid — so it goes on last, over everything. */
  float band = 1.0 - smoothstep(0.0, uFoamWidth, d);
  float churn = sNoise(vWorld.xz * 0.09 + vec2(rt * 0.35, rt * 0.21));
  float churn2 = sNoise(vWorld.xz * 0.31 - vec2(rt * 0.6, 0.0));
  float foam = smoothstep(0.35, 0.92, band * (0.55 + 0.75 * churn) + churn2 * 0.18 * band);

  // Whitecaps break where the swell is steepest, which the normal already
  // knows: a crest about to topple is the part of the wave leaning hardest
  // away from vertical.
  float steepness = 1.0 - clamp(N.y, 0.0, 1.0);
  vec2 cw = vWorld.xz * vec2(0.012, 0.055) + vec2(rt * 0.05, 0.0);
  float crest = smoothstep(0.78, 0.98, sNoise(cw) + steepness * 0.5)
              * smoothstep(3.0, 9.0, d)
              // Whitecaps are the tops of waves, and the tops of waves stop
              // being resolvable long before the sea does. Letting them run to
              // the horizon turns the far water into a white sheet.
              * (0.25 + 0.75 * ripFade);

  float white = clamp(foam + crest * 0.65, 0.0, 1.0);
  albedo = mix(albedo, uFoam, white);
  emissive *= 1.0 - white * 0.8;

  // Crests catch the light; troughs sit in shade.
  ao = 0.88 + 0.12 * clamp(N.y, 0.0, 1.0);
`;

export class Water {
  constructor(style, opts = {}) {
    this.style = style;
    this.level = opts.level ?? 0;
    this.height = opts.height ?? (() => -1000);
    this.radius = opts.radius ?? 9000;
    this.rings = opts.rings ?? 96;
    this.segments = opts.segments ?? 160;
    this._snap = new THREE.Vector3(1e9, 0, 1e9);
    this._snapStep = opts.snapStep ?? 24;

    this.geometry = this._disc();
    this.material = this._material(opts);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.position.y = this.level;
  }

  _disc() {
    const { rings, segments, radius } = this;
    const count = 1 + rings * segments;
    const pos = new Float32Array(count * 3);
    const nrm = new Float32Array(count * 3);
    const depth = new Float32Array(count);
    const uv = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) nrm[i * 3 + 1] = 1;

    let p = 3;
    for (let r = 1; r <= rings; r++) {
      const rr = radius * Math.pow(r / rings, 2.0);
      for (let s = 0; s < segments; s++) {
        const a = (s / segments) * Math.PI * 2;
        pos[p] = Math.cos(a) * rr; pos[p + 1] = 0; pos[p + 2] = Math.sin(a) * rr;
        p += 3;
      }
    }

    // Winding matters: the ring vertices run clockwise seen from above, so
    // the naive order faces the surface down into the sea bed and back-face
    // culling quietly deletes the entire ocean.
    const idx = [];
    for (let s = 0; s < segments; s++) idx.push(0, 1 + ((s + 1) % segments), 1 + s);
    for (let r = 0; r < rings - 1; r++) {
      const a0 = 1 + r * segments, b0 = 1 + (r + 1) * segments;
      for (let s = 0; s < segments; s++) {
        const s1 = (s + 1) % segments;
        idx.push(a0 + s, a0 + s1, b0 + s);
        idx.push(a0 + s1, b0 + s1, b0 + s);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.depthAttr = new THREE.BufferAttribute(depth, 1);
    this.depthAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aDepth', this.depthAttr);
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.2);
    return geo;
  }

  _material(opts) {
    const p = opts.palette;
    this.waterUniforms = {
      uWaveTime: { value: 0 },
      uWaterTime: { value: 0 },
      uWaveA: { value: new THREE.Vector4(1.0, 0.32, 210, 0.070) },
      uWaveB: { value: new THREE.Vector4(0.76, 1.0, 95, 0.060) },
      uWaveC: { value: new THREE.Vector4(-0.4, 0.9, 44, 0.050) },
      uWaveD: { value: new THREE.Vector4(1.0, -0.25, 19, 0.040) },
      uWaveScale: { value: opts.waveScale ?? 1.0 },
      uDeep: { value: (opts.deep ?? p.waterDeep).clone() },
      uShallow: { value: (opts.shallow ?? p.waterShallow).clone() },
      uFoam: { value: (opts.foam ?? p.foam).clone() },
      uGlitter: { value: (opts.glitter ?? p.sunColor).clone() },
      uGlitterAmount: { value: opts.glitterAmount ?? 1 },
      uFoamWidth: { value: opts.foamWidth ?? 2.6 },
      uBandCount: { value: opts.bands ?? 5 },

      /* Absorption, per metre, per channel.
       *
       * Roughly the shape of the real thing — seawater takes red out within a
       * couple of metres and blue survives tens — steepened a little so the
       * transition happens over the ten or twenty metres you can actually see
       * from a bird rather than over a hundred. This is the reason shallow
       * water goes green over sand and deep water goes blue over nothing,
       * without either colour being authored anywhere. */
      uAbsorb: { value: (opts.absorb ?? new THREE.Vector3(0.34, 0.105, 0.052)).clone() },
      // What the body of the water scatters back once the bottom is gone.
      uScatter: { value: (opts.scatter
        ?? (opts.deep ?? p.waterDeep).clone().lerp(opts.shallow ?? p.waterShallow, 0.34)).clone() },

      uReflection: { value: opts.reflection ?? 1 },
      // Per-pixel ripple, in normal units. The swell is geometry; this is the
      // chop below the size of a vertex.
      uRipple: { value: opts.ripple ?? 0.075 },
      uRefraction: { value: opts.refraction ?? 1.6 },
      uClarity: { value: opts.clarity ?? 1 },
    };

    return this.style.make({
      name: 'water',
      // Marks every water pixel in the scene buffer's spare alpha channel, so
      // the reflection pass can find the sea without a second render target.
      surfaceId: SURFACE.WATER,
      pars: WATER_PARS,
      vertexPars: WAVE_PARS,
      vertexHook: WAVE_HOOK,
      albedo: WATER_ALBEDO,
      // The sky's own uniform objects, by reference, so the reflection is
      // always the sky that is actually overhead — weather included.
      extra: { ...this.waterUniforms, ...(opts.skyUniforms ?? {}) },
    });
  }

  update(camPos, dt) {
    this.waterUniforms.uWaveTime.value += dt;
    this.waterUniforms.uWaterTime.value += dt;

    const sx = Math.round(camPos.x / this._snapStep) * this._snapStep;
    const sz = Math.round(camPos.z / this._snapStep) * this._snapStep;
    if (sx === this._snap.x && sz === this._snap.z) return;
    this._snap.set(sx, 0, sz);
    this.mesh.position.set(sx, this.level, sz);
    this.mesh.updateMatrix();
    this.mesh.updateMatrixWorld(true);

    const pos = this.geometry.attributes.position.array;
    const dep = this.depthAttr.array;
    const H = this.height, lvl = this.level;
    for (let i = 0, n = dep.length; i < n; i++) {
      dep[i] = lvl - H(sx + pos[i * 3], sz + pos[i * 3 + 2]);
    }
    this.depthAttr.needsUpdate = true;
  }

  setChoppiness(v) { this.waterUniforms.uWaveScale.value = v; }
  contains(p) { return p.y < this.level; }
  dispose() { this.geometry.dispose(); }
}

export { clamp };
