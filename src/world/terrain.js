/* ═══════════════════════════════════════════════════════════
   Terrain — quadtree-LOD heightfield.

   A single field function defines each world; the mesh around it is
   a quadtree that subdivides towards the camera, so a 32 km world
   costs roughly the same as a 2 km one. Patches are built on a
   frame budget and cached, and each carries a skirt so LOD seams
   never show as cracks of sky.

   Shading is a four-layer rule-based splat (base / slope / altitude /
   shore) injected into a MeshStandardMaterial, so it keeps real PBR
   lighting from the HDRI environment.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { clamp, smooth } from '../core/noise.js';

const GRID = 24;                    // quads per patch edge

let _white = null;
/** 1×1 white texture used to keep unused sampler slots legal. */
function whiteTexture() {
  if (!_white) {
    _white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    _white.needsUpdate = true;
  }
  return _white;
}

/* ── the splat shader, injected into MeshStandardMaterial ─── */

const SPLAT_PARS = /* glsl */`
  uniform sampler2D uTex0, uTex1, uTex2, uTex3;
  uniform sampler2D uNrm0, uNrm1, uNrm2, uNrm3;
  uniform sampler2D uArm0, uArm1, uArm2, uArm3;
  uniform vec4  uScale;          // world-uv scale per layer
  uniform vec2  uSlopeRange;     // slope 0..1 fade into layer 1
  uniform vec2  uSnowRange;      // world height fade into layer 2
  uniform vec2  uShoreRange;     // world height fade into layer 3
  uniform vec3  uTint0, uTint1, uTint2, uTint3;
  uniform float uMacroScale;
  uniform float uMacroStrength;
  varying vec3  vAvesNormalW;

  // cheap value noise for macro variation / threshold jitter
  float avesHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float avesVnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(avesHash(i), avesHash(i + vec2(1,0)), f.x),
               mix(avesHash(i + vec2(0,1)), avesHash(i + vec2(1,1)), f.x), f.y);
  }
  float avesFbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++){ v += a * avesVnoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  // Blend two octaves of the same tile to hide the repeat.
  vec4 avesTile(sampler2D t, vec2 uv){
    return mix(texture2D(t, uv), texture2D(t, uv * 0.2413 + 0.37), 0.35);
  }

  vec4 avesWeights(vec3 wp, vec3 n){
    float slope = 1.0 - clamp(n.y, 0.0, 1.0);
    float jitter = (avesFbm(wp.xz * 0.0055) - 0.5);

    float wRock  = smoothstep(uSlopeRange.x + jitter * 0.10, uSlopeRange.y + jitter * 0.10, slope);
    float wSnow  = smoothstep(uSnowRange.x  + jitter * 90.0, uSnowRange.y  + jitter * 90.0, wp.y);
    float wShore = 1.0 - smoothstep(uShoreRange.x + jitter * 5.0, uShoreRange.y + jitter * 5.0, wp.y);

    wSnow  *= 1.0 - wRock * 0.55;      // exposed crags stay bare
    wShore *= 1.0 - wRock * 0.85;
    float wBase = max(0.0, 1.0 - wRock - wSnow - wShore);
    vec4 w = vec4(wBase, wRock, wSnow, wShore);
    return w / max(1e-4, w.x + w.y + w.z + w.w);
  }
`;

const SPLAT_MAP = /* glsl */`
  vec3 wp = vAvesWorld;
  vec3 wn = normalize(vAvesNormalW);
  vec4 w = avesWeights(wp, wn);

  vec4 c0 = avesTile(uTex0, wp.xz * uScale.x) * vec4(uTint0, 1.0);
  vec4 c1 = avesTile(uTex1, wp.xz * uScale.y) * vec4(uTint1, 1.0);
  vec4 c2 = avesTile(uTex2, wp.xz * uScale.z) * vec4(uTint2, 1.0);
  vec4 c3 = avesTile(uTex3, wp.xz * uScale.w) * vec4(uTint3, 1.0);

  vec4 splat = c0 * w.x + c1 * w.y + c2 * w.z + c3 * w.w;

  float macro = avesFbm(wp.xz * uMacroScale);
  splat.rgb *= mix(1.0 - uMacroStrength, 1.0 + uMacroStrength, macro);

  diffuseColor *= splat;
`;

const SPLAT_ROUGH = /* glsl */`
  vec4 a0 = texture2D(uArm0, wp.xz * uScale.x);
  vec4 a1 = texture2D(uArm1, wp.xz * uScale.y);
  vec4 a2 = texture2D(uArm2, wp.xz * uScale.z);
  vec4 a3 = texture2D(uArm3, wp.xz * uScale.w);
  vec4 arm = a0 * w.x + a1 * w.y + a2 * w.z + a3 * w.w;
  float roughnessFactor = roughness * clamp(arm.g * 1.15, 0.25, 1.0);
  diffuseColor.rgb *= mix(1.0, arm.r, 0.55);       // baked cavity AO
`;

const SPLAT_ROUGH_FLAT = /* glsl */`
  float roughnessFactor = roughness;
`;

const SPLAT_NORMAL = /* glsl */`
  vec3 n0 = texture2D(uNrm0, wp.xz * uScale.x).xyz * 2.0 - 1.0;
  vec3 n1 = texture2D(uNrm1, wp.xz * uScale.y).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uNrm2, wp.xz * uScale.z).xyz * 2.0 - 1.0;
  vec3 n3 = texture2D(uNrm3, wp.xz * uScale.w).xyz * 2.0 - 1.0;
  vec3 mapN = normalize(n0 * w.x + n1 * w.y + n2 * w.z + n3 * w.w);
  // Every layer UV is a scalar multiple of world.xz, so one derivative frame
  // serves all of them once the result is renormalised. three has already
  // built its own tangent frame from the geometry UVs, which for terrain are
  // all zero, so this replaces that frame rather than reusing it.
  mat3 avesTbn = getTangentFrame( - vViewPosition, normal, wp.xz * uScale.x );
  mapN.xy *= 0.85;
  normal = normalize( avesTbn * mapN );
`;

/* ═══════════════════════════════════════════════════════════ */

export class Terrain {
  /**
   * @param {object} opts
   * @param {(x:number,z:number)=>number} opts.height  world height field
   * @param {number} opts.worldSize   edge length of the quadtree root
   * @param {number} opts.maxDepth    subdivision limit
   * @param {number} opts.lodBias     higher = more detail nearer
   */
  constructor(atmosphere, opts) {
    this.atmo = atmosphere;
    this.height = opts.height;
    this.worldSize = opts.worldSize ?? 32768;
    this.maxDepth = opts.maxDepth ?? 7;
    this.lodBias = opts.lodBias ?? 2.4;
    this.budget = opts.budget ?? 3;          // patches built per frame

    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.nodes = new Map();                  // key -> mesh
    this.queue = [];
    this.wanted = new Set();
    this._lastRebuild = new THREE.Vector3(1e9, 1e9, 1e9);
    this.material = this._material(opts);
    this.stats = { patches: 0, queued: 0 };
  }

  _material(opts) {
    const t = opts.textures;               // { base, slope, alt, shore }
    const white = whiteTexture();
    const pick = (s, k) => (s?.[k] ?? null);

    // Streaming can fail per-texture; only take the normal/ARM path when every
    // layer actually has maps, otherwise the shader would sample white noise.
    const hasNormals = [t.base, t.slope, t.alt, t.shore]
      .every((l) => l && l.normalMap && l.armMap);

    this.splatUniforms = {
      uTex0: { value: t.base.map },  uTex1: { value: t.slope.map },
      uTex2: { value: t.alt.map },   uTex3: { value: t.shore.map },
      uNrm0: { value: pick(t.base, 'normalMap') || white },
      uNrm1: { value: pick(t.slope, 'normalMap') || white },
      uNrm2: { value: pick(t.alt, 'normalMap') || white },
      uNrm3: { value: pick(t.shore, 'normalMap') || white },
      uArm0: { value: pick(t.base, 'armMap') || white },
      uArm1: { value: pick(t.slope, 'armMap') || white },
      uArm2: { value: pick(t.alt, 'armMap') || white },
      uArm3: { value: pick(t.shore, 'armMap') || white },
      uScale: { value: new THREE.Vector4(...(opts.layerScale ?? [0.06, 0.05, 0.04, 0.08])) },
      uSlopeRange: { value: new THREE.Vector2(...(opts.slopeRange ?? [0.32, 0.62])) },
      uSnowRange:  { value: new THREE.Vector2(...(opts.snowRange ?? [9e5, 9e5 + 1])) },
      uShoreRange: { value: new THREE.Vector2(...(opts.shoreRange ?? [-9e5, -9e5 + 1])) },
      uTint0: { value: new THREE.Color(opts.tints?.[0] ?? '#ffffff') },
      uTint1: { value: new THREE.Color(opts.tints?.[1] ?? '#ffffff') },
      uTint2: { value: new THREE.Color(opts.tints?.[2] ?? '#ffffff') },
      uTint3: { value: new THREE.Color(opts.tints?.[3] ?? '#ffffff') },
      uMacroScale:    { value: opts.macroScale ?? 0.0012 },
      uMacroStrength: { value: opts.macroStrength ?? 0.22 },
    };

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1.0,
      metalness: 0.0,
      envMapIntensity: opts.envIntensity ?? 1.0,
      dithering: true,
    });
    // Assigning these switches on USE_MAP / USE_NORMALMAP_TANGENTSPACE, which is
    // what makes `<map_fragment>` and `getTangentFrame()` exist for us to use.
    // The textures themselves are never sampled through the stock code path.
    mat.map = t.base.map;
    if (hasNormals) {
      mat.normalMap = t.base.normalMap;
      mat.normalScale = new THREE.Vector2(1, 1);
    }

    this.atmo.patch(mat, {
      tag: `terrain${hasNormals ? '-pbr' : '-flat'}`,
      onShader: (shader) => {
        Object.assign(shader.uniforms, this.splatUniforms);

        shader.vertexShader = 'varying vec3 vAvesNormalW;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n  vAvesNormalW = normalize( mat3( modelMatrix ) * normal );'
        );

        shader.fragmentShader = SPLAT_PARS + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <map_fragment>', SPLAT_MAP)
          .replace('#include <roughnessmap_fragment>', hasNormals ? SPLAT_ROUGH : SPLAT_ROUGH_FLAT);
        if (hasNormals) {
          shader.fragmentShader =
            shader.fragmentShader.replace('#include <normal_fragment_maps>', SPLAT_NORMAL);
        }
      },
    });
    return mat;
  }

  /* ── quadtree selection ─────────────────────────────────── */

  update(camPos, dt) {
    if (camPos.distanceToSquared(this._lastRebuild) > 60 * 60) {
      this._lastRebuild.copy(camPos);
      this._select(camPos);
    }
    this._drain();
  }

  _select(camPos) {
    this.wanted.clear();
    this.queue.length = 0;
    const half = this.worldSize / 2;
    this._recurse(-half, -half, this.worldSize, 0, camPos);

    // Retire patches that fell out of the selection.
    for (const [key, mesh] of this.nodes) {
      if (!this.wanted.has(key)) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        this.nodes.delete(key);
      }
    }
    this.stats.patches = this.nodes.size;
    this.stats.queued = this.queue.length;
  }

  _recurse(x, z, size, depth, camPos) {
    const cx = x + size / 2, cz = z + size / 2;
    const dx = camPos.x - cx, dz = camPos.z - cz;
    const dist = Math.max(1, Math.sqrt(dx * dx + dz * dz) - size * 0.5);

    if (depth < this.maxDepth && size / dist > this.lodBias) {
      const h = size / 2;
      this._recurse(x,     z,     h, depth + 1, camPos);
      this._recurse(x + h, z,     h, depth + 1, camPos);
      this._recurse(x,     z + h, h, depth + 1, camPos);
      this._recurse(x + h, z + h, h, depth + 1, camPos);
      return;
    }

    const key = `${depth}:${Math.round(x)}:${Math.round(z)}`;
    this.wanted.add(key);
    if (!this.nodes.has(key)) this.queue.push({ key, x, z, size, dist });
  }

  _drain() {
    if (!this.queue.length) return;
    this.queue.sort((a, b) => a.dist - b.dist);
    const n = Math.min(this.budget, this.queue.length);
    for (let i = 0; i < n; i++) {
      const job = this.queue.shift();
      if (!this.wanted.has(job.key) || this.nodes.has(job.key)) continue;
      const mesh = new THREE.Mesh(this._buildPatch(job.x, job.z, job.size), this.material);
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.receiveShadow = true;
      this.nodes.set(job.key, mesh);
      this.group.add(mesh);
    }
    this.stats.patches = this.nodes.size;
    this.stats.queued = this.queue.length;
  }

  /* ── patch construction ─────────────────────────────────── */

  _buildPatch(ox, oz, size) {
    const n = GRID + 1;
    const step = size / GRID;
    const total = n * n + n * 4;                   // grid + skirt ring
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);

    const H = this.height;
    const e = Math.max(0.75, step * 0.5);          // normal sampling step

    let p = 0;
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < n; j++) {
      const z = oz + j * step;
      for (let i = 0; i < n; i++) {
        const x = ox + i * step;
        const y = H(x, z);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
        pos[p] = x; pos[p + 1] = y; pos[p + 2] = z;

        const hL = H(x - e, z), hR = H(x + e, z);
        const hD = H(x, z - e), hU = H(x, z + e);
        let nx = hL - hR, ny = 2 * e, nz = hD - hU;
        const inv = 1 / Math.hypot(nx, ny, nz);
        nrm[p] = nx * inv; nrm[p + 1] = ny * inv; nrm[p + 2] = nz * inv;
        p += 3;
      }
    }

    // Skirt: duplicate the border ring, pushed down. Hides LOD cracks without
    // any neighbour-aware stitching. Capped, because on a coarse distant patch
    // an uncapped skirt is a several-hundred-metre wall that you can see.
    const drop = clamp(step * 1.6, 4, 70);
    const skirtStart = n * n;
    let s = skirtStart * 3;
    const edges = [];
    for (let i = 0; i < n; i++) edges.push(i);                       // z-
    for (let i = 0; i < n; i++) edges.push((n - 1) * n + i);         // z+
    for (let j = 0; j < n; j++) edges.push(j * n);                   // x-
    for (let j = 0; j < n; j++) edges.push(j * n + (n - 1));         // x+
    for (const src of edges) {
      pos[s] = pos[src * 3]; pos[s + 1] = pos[src * 3 + 1] - drop; pos[s + 2] = pos[src * 3 + 2];
      nrm[s] = nrm[src * 3]; nrm[s + 1] = nrm[src * 3 + 1]; nrm[s + 2] = nrm[src * 3 + 2];
      s += 3;
    }

    const quadCount = GRID * GRID + GRID * 4;
    const idx = new (total > 65535 ? Uint32Array : Uint16Array)(quadCount * 6);
    let k = 0;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    }
    const addSkirt = (ringOffset, gridIndexAt, flip) => {
      for (let i = 0; i < GRID; i++) {
        const g0 = gridIndexAt(i), g1 = gridIndexAt(i + 1);
        const s0 = skirtStart + ringOffset + i, s1 = s0 + 1;
        if (flip) { idx[k++] = g0; idx[k++] = s0; idx[k++] = g1;
                    idx[k++] = g1; idx[k++] = s0; idx[k++] = s1; }
        else      { idx[k++] = g0; idx[k++] = g1; idx[k++] = s0;
                    idx[k++] = g1; idx[k++] = s1; idx[k++] = s0; }
      }
    };
    addSkirt(0,      (i) => i,                     false);
    addSkirt(n,      (i) => (n - 1) * n + i,       true);
    addSkirt(n * 2,  (i) => i * n,                 true);
    addSkirt(n * 3,  (i) => i * n + (n - 1),       false);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(total * 2), 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));

    // Bounding sphere by hand — cheaper than computing it from positions,
    // and padded so curvature-displaced patches are not culled early.
    const cx = ox + size / 2, cz = oz + size / 2, cy = (lo + hi) / 2;
    const r = Math.hypot(size * 0.71, (hi - lo) / 2 + drop) * 1.35;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), r);
    geo.boundingBox = new THREE.Box3(
      new THREE.Vector3(ox, lo - drop, oz),
      new THREE.Vector3(ox + size, hi, oz + size)
    );
    return geo;
  }

  dispose() {
    for (const m of this.nodes.values()) { this.group.remove(m); m.geometry.dispose(); }
    this.nodes.clear();
    this.material.dispose();
  }
}

export { smin, riverDistance } from './terrain-field.js';
export { smooth, clamp };
