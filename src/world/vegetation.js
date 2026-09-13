/* ═══════════════════════════════════════════════════════════
   Vegetation.

   The first version made trees out of alpha-tested photo cards. From
   the air they read as grey-green smudges, they cost two draw calls
   each, and alpha testing is one of the more expensive things you can
   ask a phone GPU to do.

   These are solid low-poly instead: stacked cones for the conifers,
   clustered blobs for the broadleaves, flat-shaded and lit by the same
   banded model as the terrain. One merged mesh per species per tile,
   one material, no transparency at all. They read cleanly from two
   kilometres up, they are roughly four times cheaper, and — the part
   that actually matters — a hillside of them looks like something
   somebody drew rather than something nobody finished.

   Each instance gets its own colour jitter, so a forest is a hundred
   related greens rather than one repeated swatch.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, clamp, lerp } from '../core/noise.js';

/* ── wind, in the vertex shader ─────────────────────────── */

const WIND_PARS = /* glsl */`
  uniform float uWindTime, uWindStrength, uGustiness;
  uniform vec3  uWindDir;
`;

const WIND_HOOK = /* glsl */`
    // Sway grows with height up the trunk, so the base stays planted and the
    // crown moves. Every instance gets its own phase from its world position,
    // because a forest swaying in unison looks like a screensaver.
    #ifdef USE_INSTANCING
      vec3 anchor = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    #else
      vec3 anchor = vec3(0.0);
    #endif
    float phase = anchor.x * 0.07 + anchor.z * 0.11;
    float up = clamp(pos.y / 26.0, 0.0, 1.4);
    float amp = up * up * uWindStrength;
    // A slow sway with a faster gust riding on it.
    float sway = sin(uWindTime * 1.15 + phase) + sin(uWindTime * 2.7 + phase * 1.7) * uGustiness;
    pos.xz += uWindDir.xz * sway * amp;
`;

const FOLIAGE_PARS = /* glsl */`
  uniform vec3 uTrunk, uLeafLow, uLeafHigh;
  uniform float uJitter;
`;

/*
 * The geometry carries its own material id in the UV channel: u<0.5 is bark,
 * u>=0.5 is canopy. That is what lets trunk and crown live in one merged mesh
 * and still be shaded differently — one draw call instead of two.
 */
const FOLIAGE_ALBEDO = /* glsl */`
  float isLeaf = step(0.5, vUv.x);

  // Each tree picks a point on the canopy ramp, from its own position.
  float pick = fract(sin(dot(floor(vWorld.xz * 0.31), vec2(12.99, 78.23))) * 43758.55);
  vec3 leaf = mix(uLeafLow, uLeafHigh, pick);

  // Crowns are lighter at the top, darker underneath — the cheapest possible
  // stand-in for self-shadowing, and it does most of the work.
  leaf *= 0.74 + 0.34 * clamp(vUv.y, 0.0, 1.0);

  albedo = mix(uTrunk, leaf, isLeaf);
  albedo *= 1.0 + (pick - 0.5) * uJitter;

  // The underside of a canopy is in its own shade.
  ao = mix(1.0, 0.68, isLeaf * (1.0 - clamp(N.y * 0.5 + 0.5, 0.0, 1.0)));
`;

/* ── geometry builders ──────────────────────────────────── */

/**
 * Tag a geometry as bark (0) or canopy (1) via the UV channel, and drop the
 * index while we are here.
 *
 * Two reasons for un-indexing. Merging needs every part to agree about
 * whether it has an index at all — cones and cylinders are indexed,
 * icosahedra are not — and un-indexed geometry gives flat faceted normals
 * for free, which is the look.
 */
function tag(geo, isLeaf, vTop = 1) {
  if (geo.index) geo = geo.toNonIndexed();
  const n = geo.attributes.position.count;
  const uv = new Float32Array(n * 2);
  const pos = geo.attributes.position;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const y = pos.getY(i); lo = Math.min(lo, y); hi = Math.max(hi, y); }
  const span = Math.max(1e-3, hi - lo);
  for (let i = 0; i < n; i++) {
    uv[i * 2] = isLeaf ? 0.75 : 0.25;
    uv[i * 2 + 1] = ((pos.getY(i) - lo) / span) * vTop;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** A conifer: a tapered trunk with a stack of cones on it. */
function conifer(h, r, tiers, seed) {
  const rnd = rng(seed);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(r * 0.45, r, h * 0.42, 5, 1);
  trunk.translate(0, h * 0.21, 0);
  parts.push(tag(trunk, false));

  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1 || 1);
    const cy = h * lerp(0.26, 0.94, t);
    const cr = h * lerp(0.20, 0.055, Math.pow(t, 0.8)) * (0.9 + rnd() * 0.2);
    const ch = h * lerp(0.30, 0.16, t);
    const cone = new THREE.ConeGeometry(cr, ch, 6, 1);
    cone.translate((rnd() - 0.5) * cr * 0.12, cy + ch * 0.5, (rnd() - 0.5) * cr * 0.12);
    cone.rotateY(rnd() * 1.2);
    parts.push(tag(cone, true, lerp(0.4, 1.0, t)));
  }
  return mergeGeometries(parts, false);
}

/** A broadleaf: a short trunk under a cluster of overlapping blobs. */
function broadleaf(h, r, blobs, seed) {
  const rnd = rng(seed);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(r * 0.5, r, h * 0.55, 5, 1);
  trunk.translate(0, h * 0.275, 0);
  parts.push(tag(trunk, false));

  for (let i = 0; i < blobs; i++) {
    const br = h * (0.20 + rnd() * 0.16);
    const blob = new THREE.IcosahedronGeometry(br, 0);
    const a = (i / blobs) * Math.PI * 2 + rnd();
    const rad = i === 0 ? 0 : h * (0.08 + rnd() * 0.14);
    blob.scale(1, 0.82, 1);
    blob.translate(Math.cos(a) * rad, h * (0.60 + rnd() * 0.26), Math.sin(a) * rad);
    parts.push(tag(blob, true));
  }
  return mergeGeometries(parts, false);
}

/** A palm: a leaning trunk with a crown of angled fronds. */
function palm(h, r, fronds, seed) {
  const rnd = rng(seed);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(r * 0.55, r, h * 0.88, 5, 3);
  trunk.translate(0, h * 0.44, 0);
  // Bend it: palms are never straight.
  const pos = trunk.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / (h * 0.88);
    pos.setX(i, pos.getX(i) + t * t * h * 0.10);
  }
  parts.push(tag(trunk, false));

  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rnd() * 0.4;
    const len = h * (0.34 + rnd() * 0.14);
    const frond = new THREE.ConeGeometry(h * 0.045, len, 3, 1);
    frond.rotateZ(Math.PI * 0.5);
    frond.translate(len * 0.42, 0, 0);
    frond.rotateZ(-0.55 - rnd() * 0.35);
    frond.rotateY(a);
    frond.translate(h * 0.10, h * 0.86, 0);
    parts.push(tag(frond, true));
  }
  return mergeGeometries(parts, false);
}

/** Scrub: a squat cluster, no trunk worth speaking of. */
function scrub(h, seed) {
  const rnd = rng(seed);
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const br = h * (0.34 + rnd() * 0.22);
    const blob = new THREE.IcosahedronGeometry(br, 0);
    blob.scale(1.1, 0.7, 1.1);
    blob.translate((rnd() - 0.5) * h * 0.5, h * (0.28 + rnd() * 0.2), (rnd() - 0.5) * h * 0.5);
    parts.push(tag(blob, true));
  }
  return mergeGeometries(parts, false);
}

/* ═══════════════════════════════════════════════════════════ */

export class Vegetation {
  constructor(style, opts = {}) {
    this.style = style;
    this.height = opts.height;
    this.density = opts.density ?? (() => 0.5);
    this.tile = opts.tile ?? 420;
    this.radius = opts.radius ?? 2200;
    this.perTile = opts.perTile ?? 120;
    this.seed = opts.seed ?? 4242;
    this.scaleRange = opts.scaleRange ?? [0.7, 1.5];
    this.budget = opts.budget ?? 2;

    this.group = new THREE.Group();
    this.tiles = new Map();
    this.queue = [];
    this.wanted = new Set();
    this._last = new THREE.Vector3(1e9, 0, 1e9);

    this.windUniforms = {
      uWindTime: { value: 0 },
      uWindStrength: { value: opts.wind ?? 0.5 },
      uGustiness: { value: 0.25 },
      uWindDir: { value: new THREE.Vector3(1, 0, 0.3).normalize() },
    };

    this.prototypes = (opts.prototypes ?? []).map((def, i) => this._prototype(def, i, opts));
    this.stats = { tiles: 0, trees: 0, draws: 0 };
  }

  _prototype(def, index, opts) {
    const p = opts.palette;
    const seed = (def.seed ?? 3) + index * 17;
    let geo;
    switch (def.shape) {
      case 'conifer': geo = conifer(def.height, def.radius, def.tiers ?? 5, seed); break;
      case 'palm': geo = palm(def.height, def.radius, def.fronds ?? 7, seed); break;
      case 'scrub': geo = scrub(def.height, seed); break;
      default: geo = broadleaf(def.height, def.radius, def.blobs ?? 4, seed);
    }
    geo.computeVertexNormals();

    const material = this.style.make({
      name: `foliage-${def.name}`,
      pars: FOLIAGE_PARS + '\n varying vec2 vUv;',
      vertexPars: WIND_PARS + '\n varying vec2 vUv;',
      vertexHook: WIND_HOOK + '\n vUv = uv;',
      albedo: FOLIAGE_ALBEDO,
      extra: {
        ...this.windUniforms,
        uTrunk: { value: new THREE.Color(def.trunk ?? '#3a2c24') },
        uLeafLow: { value: new THREE.Color(def.leafLow ?? p.ground[1]) },
        uLeafHigh: { value: new THREE.Color(def.leafHigh ?? p.ground[2]) },
        uJitter: { value: def.jitter ?? 0.14 },
      },
    });

    return { geo, material, height: def.height, name: def.name };
  }

  update(camPos, dt) {
    this.windUniforms.uWindTime.value += dt;
    if (camPos.distanceToSquared(this._last) > this.tile * this.tile * 0.25) {
      this._last.copy(camPos);
      this._select(camPos);
    }
    this._drain();
  }

  setWind(dir, strength, gustiness) {
    this.windUniforms.uWindDir.value.copy(dir).normalize();
    this.windUniforms.uWindStrength.value = strength;
    this.windUniforms.uGustiness.value = gustiness;
  }

  _select(camPos) {
    this.wanted.clear();
    this.queue.length = 0;
    const t = this.tile;
    const span = Math.ceil(this.radius / t);
    const cx = Math.floor(camPos.x / t), cz = Math.floor(camPos.z / t);
    for (let j = -span; j <= span; j++) {
      for (let i = -span; i <= span; i++) {
        const gx = cx + i, gz = cz + j;
        const d = Math.hypot((gx + 0.5) * t - camPos.x, (gz + 0.5) * t - camPos.z);
        if (d > this.radius) continue;
        const key = `${gx}:${gz}`;
        this.wanted.add(key);
        if (!this.tiles.has(key)) this.queue.push({ key, gx, gz, d });
      }
    }
    for (const [key, tile] of this.tiles) {
      if (!this.wanted.has(key)) { this._destroyTile(tile); this.tiles.delete(key); }
    }
    this.stats.tiles = this.tiles.size;
  }

  _drain() {
    if (!this.queue.length || !this.prototypes.length) return;
    this.queue.sort((a, b) => a.d - b.d);
    for (let n = 0; n < this.budget && this.queue.length; n++) {
      const job = this.queue.shift();
      if (!this.wanted.has(job.key) || this.tiles.has(job.key)) continue;
      this.tiles.set(job.key, this._buildTile(job.gx, job.gz));
    }
  }

  _buildTile(gx, gz) {
    const t = this.tile;
    const r = rng(this.seed + gx * 73856093 ^ (gz * 19349663));
    const H = this.height, D = this.density;
    const [sLo, sHi] = this.scaleRange;

    const buckets = this.prototypes.map(() => []);
    const dummy = new THREE.Object3D();

    for (let k = 0; k < this.perTile; k++) {
      const x = gx * t + r() * t;
      const z = gz * t + r() * t;
      if (r() > D(x, z)) continue;
      const pi = Math.min(this.prototypes.length - 1, (r() * this.prototypes.length) | 0);
      buckets[pi].push([x, H(x, z), z, sLo + (sHi - sLo) * r(), r() * Math.PI * 2]);
    }

    const meshes = [];
    for (let pi = 0; pi < this.prototypes.length; pi++) {
      const list = buckets[pi];
      if (!list.length) continue;
      const proto = this.prototypes[pi];

      const im = new THREE.InstancedMesh(proto.geo, proto.material, list.length);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < list.length; i++) {
        const [x, y, z, s, rot] = list[i];
        dummy.position.set(x, y - 0.3, z);
        dummy.rotation.set(0, rot, 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        lo = Math.min(lo, y);
        hi = Math.max(hi, y + proto.height * s);
      }
      im.instanceMatrix.needsUpdate = true;

      const c = new THREE.Vector3((gx + 0.5) * t, (lo + hi) / 2, (gz + 0.5) * t);
      im.boundingSphere = new THREE.Sphere(c, Math.hypot(t * 0.71, (hi - lo) / 2) * 1.2);
      im.computeBoundingSphere = () => {};

      this.group.add(im);
      meshes.push(im);
      this.stats.trees += list.length;
      this.stats.draws++;
    }
    return meshes;
  }

  _destroyTile(meshes) {
    for (const m of meshes) {
      this.group.remove(m);
      m.dispose();
      this.stats.trees -= m.count;
      this.stats.draws--;
    }
  }

  dispose() {
    for (const tile of this.tiles.values()) this._destroyTile(tile);
    this.tiles.clear();
    for (const p of this.prototypes) p.geo.dispose();
  }
}

/* ── species ────────────────────────────────────────────── */

export const TREE_PRESETS = {
  redwood:   { name: 'redwood', shape: 'conifer', height: 58, radius: 1.7, tiers: 7, seed: 7,
               trunk: '#4a2f26', jitter: 0.16 },
  pine:      { name: 'pine', shape: 'conifer', height: 30, radius: 0.8, tiers: 5, seed: 13,
               trunk: '#412e22', jitter: 0.18 },
  fir:       { name: 'fir', shape: 'conifer', height: 20, radius: 0.6, tiers: 4, seed: 29,
               trunk: '#3b2a20', jitter: 0.2 },
  broadleaf: { name: 'broadleaf', shape: 'broadleaf', height: 21, radius: 0.75, blobs: 5, seed: 21,
               trunk: '#4b3a2c', jitter: 0.16 },
  scrub:     { name: 'scrub', shape: 'scrub', height: 5.5, radius: 0.3, seed: 31,
               trunk: '#4a4030', jitter: 0.22 },
  palm:      { name: 'palm', shape: 'palm', height: 16, radius: 0.4, fronds: 8, seed: 37,
               trunk: '#6a563c', jitter: 0.12 },
  cityTree:  { name: 'cityTree', shape: 'broadleaf', height: 12, radius: 0.4, blobs: 4, seed: 43,
               trunk: '#3a3128', jitter: 0.14 },
};

export { clamp };
