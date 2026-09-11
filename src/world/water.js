/* ═══════════════════════════════════════════════════════════
   Water.

   A radial disc that follows the bird — dense near the eye, coarse
   at the horizon — displaced by a sum of Gerstner waves with an
   analytically derived normal. It is a MeshStandardMaterial under
   the injections, so it takes real reflections from the HDRI
   environment, real sun specular, and the same curvature and fog
   as everything else.

   Depth comes from the terrain field, sampled onto a per-vertex
   attribute whenever the disc re-centres. That one number drives
   the shallow/deep colour ramp, the shore foam band, and the way
   waves flatten as they run aground.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';

const WAVE_PARS = /* glsl */`
  uniform float uTime;
  uniform vec4  uWaveA;   // xy = direction, z = wavelength, w = steepness
  uniform vec4  uWaveB;
  uniform vec4  uWaveC;
  uniform vec4  uWaveD;
  uniform float uWaveScale;
  attribute float aDepth;         // metres of water; negative = dry land
  varying float vDepth;
  varying vec3  vWaterWorld;

  // One Gerstner contribution. Returns the offset and accumulates the
  // partial derivatives so the normal is exact rather than sampled.
  vec3 gerstner(vec4 w, vec3 p, float atten, inout vec3 tangent, inout vec3 binormal) {
    float steep = w.w * atten;
    float k = 6.28318530718 / w.z;
    float c = sqrt(9.81 / k);
    vec2 d = normalize(w.xy);
    float f = k * (dot(d, p.xz) - c * uTime);
    float a = steep / k;

    tangent  += vec3(-d.x * d.x * steep * sin(f), d.x * steep * cos(f), -d.x * d.y * steep * sin(f));
    binormal += vec3(-d.x * d.y * steep * sin(f), d.y * steep * cos(f), -d.y * d.y * steep * sin(f));

    return vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
  }
`;

const WAVE_VERTEX = /* glsl */`
  vec3 avesWorld0 = (modelMatrix * vec4(position, 1.0)).xyz;
  vWaterWorld = avesWorld0;
  vDepth = aDepth;

  // Waves die as the bottom comes up, and stop entirely on dry land.
  float shoal = smoothstep(0.0, 9.0, aDepth);
  float atten = shoal * uWaveScale;

  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  vec3 disp = vec3(0.0);
  disp += gerstner(uWaveA, avesWorld0, atten, tangent, binormal);
  disp += gerstner(uWaveB, avesWorld0, atten, tangent, binormal);
  disp += gerstner(uWaveC, avesWorld0, atten, tangent, binormal);
  disp += gerstner(uWaveD, avesWorld0, atten, tangent, binormal);

  vec3 avesDisp = disp;
  vec3 objectNormal = normalize(cross(binormal, tangent));
`;

const WATER_PARS_FRAG = /* glsl */`
  uniform vec3  uDeep;
  uniform vec3  uShallow;
  uniform vec3  uFoam;
  uniform float uTime;
  uniform float uFoamWidth;
  varying float vDepth;
  varying vec3  vWaterWorld;

  float wHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float wNoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1,0)), f.x),
               mix(wHash(i + vec2(0,1)), wHash(i + vec2(1,1)), f.x), f.y);
  }
`;

const WATER_MAP_FRAG = /* glsl */`
  // The disc is a full circle around the bird and most of it is over dry
  // land. Without this the sea shows up as bands lying across the hills.
  if (vDepth < -0.15) discard;

  float d = max(vDepth, 0.0);

  // Colour ramp: sea bed showing through, to open-ocean blue.
  float deepT = 1.0 - exp(-d / 11.0);
  vec3 base = mix(uShallow, uDeep, deepT);

  // Shore foam: a band that follows the depth contour, broken up by noise
  // and animated so it looks like it is running up the sand.
  float band = 1.0 - smoothstep(0.0, uFoamWidth, d);
  float churn = wNoise(vWaterWorld.xz * 0.09 + vec2(uTime * 0.35, uTime * 0.21));
  float churn2 = wNoise(vWaterWorld.xz * 0.31 - vec2(uTime * 0.6, 0.0));
  float foam = smoothstep(0.35, 0.95, band * (0.55 + 0.75 * churn) + churn2 * 0.18 * band);

  // Whitecaps out at sea: stretched along the swell direction so they read as
  // breaking crests rather than as litter floating on the surface.
  vec2 cw = vWaterWorld.xz * vec2(0.012, 0.055) + vec2(uTime * 0.05, 0.0);
  float crest = smoothstep(0.72, 0.97, wNoise(cw)) * 0.55;

  diffuseColor.rgb *= mix(base, uFoam, clamp(foam + crest * smoothstep(3.0, 9.0, d), 0.0, 1.0));
`;

const WATER_ROUGH_FRAG = /* glsl */`
  float roughnessFactor = roughness;
  float streak = wNoise(vWaterWorld.xz * 0.013 + vec2(uTime * 0.02, 0.0));
  roughnessFactor = clamp(roughnessFactor + streak * 0.10, 0.02, 1.0);
  float d2 = max(vDepth, 0.0);
  float band2 = 1.0 - smoothstep(0.0, uFoamWidth, d2);
  roughnessFactor = mix(roughnessFactor, 0.85, band2 * 0.8);   // foam is matte
`;

export class Water {
  /**
   * @param {Atmosphere} atmo
   * @param {object} opts
   * @param {(x,z)=>number} opts.height  terrain field, for depth
   * @param {number} opts.level          water plane height
   */
  constructor(atmo, opts = {}) {
    this.atmo = atmo;
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
    this.mesh.frustumCulled = false;         // it is always underfoot
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

    let p = 3;                                // vertex 0 is the centre
    for (let r = 1; r <= rings; r++) {
      // Quadratic ring spacing: metre-scale detail underfoot, kilometres out.
      const rr = radius * Math.pow(r / rings, 2.35);
      for (let s = 0; s < segments; s++) {
        const a = (s / segments) * Math.PI * 2;
        pos[p] = Math.cos(a) * rr;
        pos[p + 1] = 0;
        pos[p + 2] = Math.sin(a) * rr;
        p += 3;
      }
    }

    // Winding matters: vertices run anticlockwise in the XZ plane, which is
    // CLOCKWISE seen from above, so the naive index order gives a surface
    // facing down into the sea bed and back-face culling deletes the entire
    // ocean. Hence the reversed order here.
    const idx = [];
    for (let s = 0; s < segments; s++) {          // centre fan
      idx.push(0, 1 + ((s + 1) % segments), 1 + s);
    }
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
    this.uniforms = {
      uTime:      { value: 0 },
      // direction.xy, wavelength, steepness. Amplitude is steepness·λ/2π, so
      // a long wave with the same steepness is a much bigger wave — these are
      // chosen to give roughly a 4 m swell, and the shortest wavelength is
      // kept well above the mesh spacing at the distance it is still visible,
      // because an undersampled Gerstner wave looks like crumpled foil.
      uWaveA:     { value: new THREE.Vector4(1.0,  0.32, 210, 0.070) },
      uWaveB:     { value: new THREE.Vector4(0.76, 1.0,   95, 0.060) },
      uWaveC:     { value: new THREE.Vector4(-0.4, 0.9,   44, 0.050) },
      uWaveD:     { value: new THREE.Vector4(1.0, -0.25,  19, 0.040) },
      uWaveScale: { value: opts.waveScale ?? 1.0 },
      uDeep:      { value: new THREE.Color(opts.deep ?? '#0b2b3e') },
      uShallow:   { value: new THREE.Color(opts.shallow ?? '#3f8f96') },
      uFoam:      { value: new THREE.Color(opts.foam ?? '#e9f4f6') },
      uFoamWidth: { value: opts.foamWidth ?? 2.6 },
    };

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: opts.roughness ?? 0.075,
      metalness: opts.metalness ?? 0.02,
      envMapIntensity: opts.envIntensity ?? 1.25,
      dithering: true,
    });

    this.atmo.patch(mat, {
      tag: 'water',
      onShader: (shader) => {
        Object.assign(shader.uniforms, this.uniforms);

        shader.vertexShader = WAVE_PARS + shader.vertexShader;
        shader.vertexShader = shader.vertexShader
          .replace('#include <beginnormal_vertex>', WAVE_VERTEX)
          .replace('#include <begin_vertex>', 'vec3 transformed = position + avesDisp;');

        shader.fragmentShader = WATER_PARS_FRAG + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <map_fragment>', WATER_MAP_FRAG)
          .replace('#include <roughnessmap_fragment>', WATER_ROUGH_FRAG);
      },
    });
    return mat;
  }

  /** Re-centre on the bird and refresh the depth attribute if it moved far enough. */
  update(camPos, dt) {
    this.uniforms.uTime.value += dt;

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

  /** True if a world-space point is under the surface (waves ignored). */
  contains(p) { return p.y < this.level; }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
