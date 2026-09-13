/* ═══════════════════════════════════════════════════════════
   Terrain — quadtree-LOD heightfield.

   A single field function defines each world; the mesh around it is
   a quadtree that subdivides towards the camera, so a 32 km world
   costs roughly the same as a 2 km one. Patches are built on a
   frame budget and cached, and each carries a skirt so LOD seams
   never show as cracks of sky.

   Shading is stylised rather than physical — an altitude ramp from the
   world's palette, banded sunlight and a coloured rim, with no image
   textures and no shadow maps. See core/style.js for why.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { clamp } from '../core/noise.js';

const GRID = 24;                    // quads per patch edge

/* ── stylised terrain surface ──────────────────────────────
   Colour comes from the world's palette rather than from photographs:
   a four-stop ramp by altitude, rock wherever it is steep enough that
   soil would not stay, snow above a line, and a band of shore at the
   waterline. Then a little large-scale noise so no two hillsides are
   the same flat swatch of green.

   Contour banding is the one deliberate artifice — a faint darkening
   every few dozen metres of altitude, like a painted relief map. It
   costs one sine and it makes height legible from the air, which
   matters when height is the resource you are managing. */

const TERRAIN_PARS = /* glsl */`
  uniform vec3  uLow, uMid, uHigh, uPeak;
  uniform vec3  uRock, uSnow, uShore;
  uniform vec2  uSlopeRange, uSnowRange, uShoreRange;
  uniform vec2  uHeightRange;
  uniform float uMacroScale, uMacroStrength;
  uniform float uContour, uContourSpacing;
  uniform float uGrain;
`;

const TERRAIN_ALBEDO = /* glsl */`
  vec3 wp = vWorld;
  float slope = 1.0 - clamp(N.y, 0.0, 1.0);

  // Break every threshold with noise, or the snow line and the rock line
  // become two hard contours running across the landscape.
  float jitter = sFbm(wp.xz * 0.0035) - 0.5;

  float hNorm = clamp((wp.y - uHeightRange.x) / max(1.0, uHeightRange.y - uHeightRange.x), 0.0, 1.0);
  hNorm = clamp(hNorm + jitter * 0.10, 0.0, 1.0);

  // Altitude ramp, four stops.
  vec3 ground = mix(uLow, uMid, smoothstep(0.0, 0.38, hNorm));
  ground = mix(ground, uHigh, smoothstep(0.32, 0.68, hNorm));
  ground = mix(ground, uPeak, smoothstep(0.62, 0.95, hNorm));

  float rockW = smoothstep(uSlopeRange.x + jitter * 0.12, uSlopeRange.y + jitter * 0.12, slope);
  float snowW = smoothstep(uSnowRange.x + jitter * 140.0, uSnowRange.y + jitter * 140.0, wp.y)
              * (1.0 - rockW * 0.55);
  float shoreW = (1.0 - smoothstep(uShoreRange.x + jitter * 6.0, uShoreRange.y + jitter * 6.0, wp.y))
               * (1.0 - rockW * 0.8);

  albedo = ground;
  albedo = mix(albedo, uRock, rockW);
  albedo = mix(albedo, uSnow, snowW);
  albedo = mix(albedo, uShore, clamp(shoreW, 0.0, 1.0));

  // Large-scale variation so a hillside is not one swatch.
  float macro = sFbm(wp.xz * uMacroScale);
  albedo *= mix(1.0 - uMacroStrength, 1.0 + uMacroStrength, macro);

  // Fine grain, fading out with distance so it never aliases into noise.
  float grain = sNoise(wp.xz * 0.9) - 0.5;
  albedo *= 1.0 + grain * uGrain * (1.0 - smoothstep(150.0, 900.0, vDepth));

  // Painted contour lines.
  float band = sin(wp.y * 6.2831853 / uContourSpacing);
  albedo *= 1.0 - smoothstep(0.86, 1.0, abs(band)) * uContour;

  // Valleys sit in their own shade; ridges catch the light.
  ao = mix(1.0, 0.72, smoothstep(0.25, 0.9, slope) * 0.6);
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
  constructor(opts) {
    this.style = opts.style;
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
    const p = opts.palette;
    const ramp = p.ground;
    this.terrainUniforms = {
      uLow: { value: ramp[0].clone() },
      uMid: { value: ramp[1].clone() },
      uHigh: { value: ramp[2].clone() },
      uPeak: { value: ramp[3].clone() },
      uRock: { value: (opts.rock ?? p.rock).clone() },
      uSnow: { value: (opts.snow ?? p.snow).clone() },
      uShore: { value: (opts.shore ?? ramp[0]).clone() },
      uSlopeRange: { value: new THREE.Vector2(...(opts.slopeRange ?? [0.30, 0.62])) },
      uSnowRange: { value: new THREE.Vector2(...(opts.snowRange ?? [9e5, 9e5 + 1])) },
      uShoreRange: { value: new THREE.Vector2(...(opts.shoreRange ?? [-9e5, -9e5 + 1])) },
      uHeightRange: { value: new THREE.Vector2(...(opts.heightRange ?? [0, 1000])) },
      uMacroScale: { value: opts.macroScale ?? 0.0011 },
      uMacroStrength: { value: opts.macroStrength ?? 0.16 },
      uContour: { value: opts.contour ?? 0.055 },
      uContourSpacing: { value: opts.contourSpacing ?? 46 },
      uGrain: { value: opts.grain ?? 0.10 },
    };

    return opts.style.make({
      name: 'terrain',
      pars: TERRAIN_PARS,
      albedo: TERRAIN_ALBEDO,
      extra: this.terrainUniforms,
    });
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
export { clamp };
