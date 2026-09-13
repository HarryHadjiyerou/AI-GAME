/* ═══════════════════════════════════════════════════════════
   Water.

   A radial disc that follows the bird — dense underfoot, coarse at the
   horizon — displaced by a sum of Gerstner waves with an analytically
   derived normal.

   The shading is painted rather than simulated. Real water is a mirror
   and rendering it as one, at this distance, gives you a grey sheet.
   What sells water in a stylised world is four things, and none of
   them are reflections:

     • flat bands of colour stepped by depth, so the shallows read
     • a hard, bright sun glitter that breaks into a path across the
       swell when you fly towards the light
     • foam that follows the depth contour, animated so it runs up the
       sand rather than sitting on it
     • crests that catch the rim light like everything else does

   Depth comes from the terrain field, sampled onto a per-vertex
   attribute whenever the disc re-centres.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { clamp } from '../core/noise.js';

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
  uniform float uFoamWidth, uWaterTime, uBandCount, uGlitterAmount;
  varying float vWDepth;
`;

const WATER_ALBEDO = /* glsl */`
  if (vWDepth < -0.15) discard;    // the disc covers dry land too
  float d = max(vWDepth, 0.0);

  // Depth ramp, stepped. The banding is the point: it reads as water in a
  // way a smooth gradient does not.
  float deepT = 1.0 - exp(-d / 9.0);
  float stepped = floor(deepT * uBandCount) / uBandCount;
  vec3 base = mix(uShallow, uDeep, mix(deepT, stepped, 0.55));

  // Shore foam: a band following the depth contour, broken up and animated
  // so it runs up the sand instead of sitting on it.
  float band = 1.0 - smoothstep(0.0, uFoamWidth, d);
  float churn = sNoise(vWorld.xz * 0.09 + vec2(uWaterTime * 0.35, uWaterTime * 0.21));
  float churn2 = sNoise(vWorld.xz * 0.31 - vec2(uWaterTime * 0.6, 0.0));
  float foam = smoothstep(0.35, 0.92, band * (0.55 + 0.75 * churn) + churn2 * 0.18 * band);

  // Whitecaps out at sea, stretched along the swell.
  vec2 cw = vWorld.xz * vec2(0.012, 0.055) + vec2(uWaterTime * 0.05, 0.0);
  float crest = smoothstep(0.74, 0.97, sNoise(cw)) * smoothstep(3.0, 9.0, d);

  albedo = mix(base, uFoam, clamp(foam + crest * 0.5, 0.0, 1.0));

  // Sun glitter. A hard, high-power specular that breaks into a path across
  // the swell — the single most recognisable thing about water with a low
  // sun on it, and free, because the wave normals are already exact.
  vec3 Vw = normalize(uCamPos - vWorld);
  vec3 Hh = normalize(uSunDir + Vw);
  float spec = pow(clamp(dot(N, Hh), 0.0, 1.0), 220.0);
  float sparkle = smoothstep(0.55, 0.95, sNoise(vWorld.xz * 1.7 + uWaterTime * 1.4));
  emissive += uGlitter * (spec * 2.4 + spec * sparkle * 4.0) * uGlitterAmount;

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
    };

    return this.style.make({
      name: 'water',
      pars: WATER_PARS,
      vertexPars: WAVE_PARS,
      vertexHook: WAVE_HOOK,
      albedo: WATER_ALBEDO,
      extra: this.waterUniforms,
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
