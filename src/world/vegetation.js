/* ═══════════════════════════════════════════════════════════
   Vegetation.

   Trees are built once as a small library of prototypes and then
   drawn as instanced meshes in tiles around the bird. Each tile is
   populated from the same noise field that shaped the terrain, so
   forests grow where forests should — off the ridgelines, out of
   the river, below the snow line.

   Two draw calls per prototype: trunks (opaque) and foliage
   (alpha-tested cross-planes). Distant tiles drop to a single
   billboard card per tree.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { rng, clamp, smooth } from '../core/noise.js';

/** One instanced prototype: a trunk mesh and a foliage mesh sharing a transform. */
class Prototype {
  constructor(trunkGeo, foliageGeo, trunkMat, foliageMat, height) {
    this.trunkGeo = trunkGeo;
    this.foliageGeo = foliageGeo;
    this.trunkMat = trunkMat;
    this.foliageMat = foliageMat;
    this.height = height;
  }
}

/* ── geometry builders ──────────────────────────────────── */

/** Tapered trunk with a slight lean and a bend, merged from stacked rings. */
function trunkGeometry(h, r0, r1, lean, seed) {
  const r = rng(seed);
  const segments = 5, radial = 6;
  const pos = [], nrm = [], uv = [], idx = [];
  const bendX = (r() - 0.5) * lean, bendZ = (r() - 0.5) * lean;

  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const y = t * h;
    const rad = r0 + (r1 - r0) * Math.pow(t, 0.75);
    const ox = bendX * t * t * h, oz = bendZ * t * t * h;
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const cx = Math.cos(a), cz = Math.sin(a);
      pos.push(ox + cx * rad, y, oz + cz * rad);
      nrm.push(cx, 0.12, cz);
      uv.push(i / radial, t * h * 0.12);
    }
  }
  for (let s = 0; s < segments; s++) {
    for (let i = 0; i < radial; i++) {
      const a = s * (radial + 1) + i, b = a + 1;
      const c = a + radial + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.normalizeNormals?.();
  return g;
}

/** Foliage as intersecting quads — the cheapest thing that still reads as a canopy. */
function crossPlanes(cards, seed) {
  const r = rng(seed);
  const pos = [], nrm = [], uv = [], idx = [];
  let v = 0;
  for (const c of cards) {
    const { y, w, h, count = 3, jitter = 0 } = c;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI + r() * 0.4;
      const ca = Math.cos(a), sa = Math.sin(a);
      const jx = (r() - 0.5) * jitter, jz = (r() - 0.5) * jitter;
      const hw = w / 2;
      const corners = [
        [-hw, -h / 2], [hw, -h / 2], [hw, h / 2], [-hw, h / 2],
      ];
      for (let i = 0; i < 4; i++) {
        const [lx, ly] = corners[i];
        pos.push(jx + lx * ca, y + ly, jz + lx * sa);
        // Normals splayed outward give the canopy a rounded response to light
        // instead of the flat cardboard look of a plain billboard.
        nrm.push(ca * 0.5 + (lx / hw) * 0.55, 0.55, sa * 0.5 + (lx / hw) * 0.2);
        uv.push(i === 0 || i === 3 ? 0 : 1, i < 2 ? 0 : 1);
      }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      idx.push(v, v + 2, v + 1, v, v + 3, v + 2);   // double-sided by index
      v += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/* ── the wind shader, shared by every foliage material ───── */

const WIND_VERT = /* glsl */`
  // Sway increases with height up the tree and with the instance's own phase,
  // so a forest never breathes in unison.
  float avesPhase = float(gl_InstanceID) * 1.7;
  float avesH = clamp(transformed.y / max(1.0, uTreeHeight), 0.0, 1.0);
  float avesAmp = pow(avesH, 2.0) * uWindStrength;
  transformed.x += sin(uWindTime * 1.3 + avesPhase) * avesAmp;
  transformed.z += cos(uWindTime * 1.05 + avesPhase * 1.31) * avesAmp * 0.75;
`;

export class Vegetation {
  /**
   * @param {object} opts
   * @param {(x,z)=>number} opts.height          terrain field
   * @param {(x,z)=>number} opts.density         0..1 chance of a tree
   * @param {number} opts.tile                   tile edge in metres
   * @param {number} opts.radius                 tiles are kept within this range
   */
  constructor(atmo, assets, opts = {}) {
    this.atmo = atmo;
    this.assets = assets;
    this.height = opts.height;
    this.density = opts.density ?? (() => 0.5);
    this.tile = opts.tile ?? 320;
    this.radius = opts.radius ?? 1700;
    this.perTile = opts.perTile ?? 46;
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
      uWindStrength: { value: opts.wind ?? 0.55 },
    };

    this.prototypes = (opts.prototypes ?? []).map((p) => this._prototype(p, opts));
    this.stats = { tiles: 0, trees: 0 };
  }

  _prototype(def, opts) {
    const bark = opts.barkTexture;
    const trunkMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(def.barkTint ?? '#6b5842'),
      roughness: 0.95,
      metalness: 0,
      map: bark?.map ?? null,
      normalMap: bark?.normalMap ?? null,
    });
    if (trunkMat.map) {
      trunkMat.map = trunkMat.map.clone();
      trunkMat.map.needsUpdate = true;
      trunkMat.map.repeat.set(1, 1);
    }
    this.atmo.patch(trunkMat, { tag: 'trunk' });

    const foliageMat = new THREE.MeshStandardMaterial({
      map: this.assets.foliage(def.leafTint ?? '#3f6b2e', def.seed ?? 3, !!def.needles),
      color: new THREE.Color(def.leafColor ?? '#ffffff'),
      roughness: 0.82,
      metalness: 0,
      transparent: false,
      alphaTest: def.alphaTest ?? 0.42,
      side: THREE.DoubleSide,
      depthWrite: true,
    });

    const treeHeight = def.height ?? 30;
    this.atmo.patch(foliageMat, {
      tag: `foliage-${def.name ?? 'x'}`,
      onShader: (shader) => {
        shader.uniforms.uWindTime = this.windUniforms.uWindTime;
        shader.uniforms.uWindStrength = this.windUniforms.uWindStrength;
        shader.uniforms.uTreeHeight = { value: treeHeight };
        shader.vertexShader =
          'uniform float uWindTime;\nuniform float uWindStrength;\nuniform float uTreeHeight;\n' +
          shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n' + WIND_VERT
        );
      },
    });

    const trunk = trunkGeometry(
      treeHeight * (def.trunkFraction ?? 0.62),
      def.radius ?? 0.9,
      (def.radius ?? 0.9) * 0.3,
      def.lean ?? 0.05,
      def.seed ?? 3
    );
    const foliage = crossPlanes(def.cards ?? [
      { y: treeHeight * 0.62, w: treeHeight * 0.7, h: treeHeight * 0.55, count: 3, jitter: 1.4 },
    ], (def.seed ?? 3) + 17);

    return new Prototype(trunk, foliage, trunkMat, foliageMat, treeHeight);
  }

  update(camPos, dt) {
    this.windUniforms.uWindTime.value += dt;
    if (camPos.distanceToSquared(this._last) > this.tile * this.tile * 0.25) {
      this._last.copy(camPos);
      this._select(camPos);
    }
    this._drain();
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
        const wx = (gx + 0.5) * t, wz = (gz + 0.5) * t;
        const d = Math.hypot(wx - camPos.x, wz - camPos.z);
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
    this.stats.queued = this.queue.length;
  }

  _buildTile(gx, gz) {
    const t = this.tile;
    const r = rng(this.seed + gx * 73856093 ^ (gz * 19349663));
    const H = this.height, D = this.density;
    const [sLo, sHi] = this.scaleRange;

    // Bucket candidate positions by prototype, then emit one InstancedMesh each.
    const buckets = this.prototypes.map(() => []);
    const dummy = new THREE.Object3D();

    for (let k = 0; k < this.perTile; k++) {
      const x = gx * t + r() * t;
      const z = gz * t + r() * t;
      const d = D(x, z);
      if (r() > d) continue;
      const y = H(x, z);
      const pi = Math.min(this.prototypes.length - 1, (r() * this.prototypes.length) | 0);
      buckets[pi].push([x, y, z, sLo + (sHi - sLo) * r(), r() * Math.PI * 2]);
    }

    const meshes = [];
    for (let pi = 0; pi < this.prototypes.length; pi++) {
      const list = buckets[pi];
      if (!list.length) continue;
      const proto = this.prototypes[pi];

      const trunk = new THREE.InstancedMesh(proto.trunkGeo, proto.trunkMat, list.length);
      const foliage = new THREE.InstancedMesh(proto.foliageGeo, proto.foliageMat, list.length);
      trunk.castShadow = foliage.castShadow = false;
      trunk.receiveShadow = foliage.receiveShadow = false;

      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < list.length; i++) {
        const [x, y, z, s, rot] = list[i];
        dummy.position.set(x, y - 0.4, z);
        dummy.rotation.set(0, rot, 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        trunk.setMatrixAt(i, dummy.matrix);
        foliage.setMatrixAt(i, dummy.matrix);
        if (y < lo) lo = y;
        if (y + proto.height * s > hi) hi = y + proto.height * s;
      }
      trunk.instanceMatrix.needsUpdate = true;
      foliage.instanceMatrix.needsUpdate = true;

      // Hand-built bounds: three would otherwise walk every instance.
      const c = new THREE.Vector3((gx + 0.5) * t, (lo + hi) / 2, (gz + 0.5) * t);
      const rad = Math.hypot(t * 0.71, (hi - lo) / 2) * 1.2;
      trunk.boundingSphere = foliage.boundingSphere = new THREE.Sphere(c, rad);
      trunk.computeBoundingSphere = foliage.computeBoundingSphere = () => {};

      this.group.add(trunk, foliage);
      meshes.push(trunk, foliage);
      this.stats.trees += list.length;
    }
    return meshes;
  }

  _destroyTile(meshes) {
    for (const m of meshes) {
      this.group.remove(m);
      m.dispose();
      this.stats.trees -= m.count;
    }
  }

  dispose() {
    for (const tile of this.tiles.values()) this._destroyTile(tile);
    this.tiles.clear();
    for (const p of this.prototypes) {
      p.trunkGeo.dispose(); p.foliageGeo.dispose();
      p.trunkMat.dispose(); p.foliageMat.dispose();
    }
  }
}

/* ── prototype presets ──────────────────────────────────── */

export const TREE_PRESETS = {
  redwood: {
    name: 'redwood', height: 64, radius: 2.1, trunkFraction: 0.46, lean: 0.012, seed: 7,
    needles: true, leafTint: '#33512a', barkTint: '#4a3327', alphaTest: 0.32,
    cards: [
      { y: 34, w: 30, h: 34, count: 3, jitter: 1.4 },
      { y: 47, w: 23, h: 27, count: 3, jitter: 1.1 },
      { y: 57, w: 15, h: 19, count: 2, jitter: 0.8 },
      { y: 64, w: 8,  h: 11, count: 2, jitter: 0.4 },
    ],
  },
  pine: {
    name: 'pine', height: 34, radius: 0.75, trunkFraction: 0.48, lean: 0.03, seed: 13,
    needles: true, leafTint: '#38562e', barkTint: '#463527', alphaTest: 0.32,
    cards: [
      { y: 16, w: 18, h: 19, count: 3, jitter: 0.9 },
      { y: 25, w: 13, h: 15, count: 3, jitter: 0.7 },
      { y: 32, w: 8,  h: 10, count: 2, jitter: 0.4 },
    ],
  },
  broadleaf: {
    name: 'broadleaf', height: 22, radius: 0.7, trunkFraction: 0.55, lean: 0.09, seed: 21,
    needles: false, leafTint: '#4f7c36', barkTint: '#544636',
    cards: [
      { y: 15, w: 23, h: 18, count: 4, jitter: 2.2 },
      { y: 20, w: 15, h: 12, count: 2, jitter: 1.5 },
    ],
  },
  scrub: {
    name: 'scrub', height: 6, radius: 0.22, trunkFraction: 0.35, lean: 0.16, seed: 31,
    needles: false, leafTint: '#5d6b3a', barkTint: '#564b3b',
    cards: [{ y: 3.2, w: 5.5, h: 4.2, count: 3, jitter: 0.9 }],
  },
  palm: {
    name: 'palm', height: 17, radius: 0.42, trunkFraction: 0.82, lean: 0.22, seed: 37,
    needles: true, leafTint: '#5a7f35', barkTint: '#6d6049', alphaTest: 0.30,
    cards: [{ y: 14.5, w: 13, h: 7, count: 4, jitter: 0.8 }],
  },
  cityTree: {
    name: 'cityTree', height: 13, radius: 0.4, trunkFraction: 0.5, lean: 0.05, seed: 43,
    needles: false, leafTint: '#466d31', barkTint: '#4d4339',
    cards: [{ y: 9, w: 9.5, h: 8, count: 3, jitter: 1.1 }],
  },
};

export { clamp, smooth };
