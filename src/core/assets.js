/* ═══════════════════════════════════════════════════════════
   Assets.

   Almost nothing is fetched. The look is generated: skies, terrain,
   water, vegetation, cloud, weather and the first-person wings are
   all built at runtime from noise and a palette (see core/style.js
   and world/palette.js), so the whole game is a few hundred kilobytes
   of source with no texture payload behind it.

   That was not the original plan. The first version streamed 1k HDRI
   skies and ten PBR texture sets per world from Poly Haven — about
   eight megabytes a world — and the result was a photograph of a
   forest floor stretched over hand-built terrain under a photograph
   of somebody else's sky. It never resolved into one picture, and it
   cost the first ten seconds of every session. The stylised renderer
   replaced it outright, and the streaming code came out with it.

   What is left is the three.js sample birds, loaded from a CDN that
   serves `Access-Control-Allow-Origin: *`:

     • three.js repo (CC-BY on the models) — GLB birds

   They are optional. If the network is gone the flocks and the menu
   simply have no birds in them, and everything else is unaffected.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Noise, clamp, lerp } from './noise.js';

const THREE_MODELS = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf';

export const BIRD_GLB = {
  stork:    `${THREE_MODELS}/Stork.glb`,
  parrot:   `${THREE_MODELS}/Parrot.glb`,
  flamingo: `${THREE_MODELS}/Flamingo.glb`,
};

/* ── tiny canvas helpers for the procedural fallbacks ─────── */

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function toTexture(cv, { srgb = false, repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Seamless tiling noise texture — the stand-in for a real albedo map. */
function proceduralSurface(size, base, spec, seed) {
  const [cv, g] = canvas(size);
  const n = new Noise(seed);
  const img = g.createImageData(size, size);
  const d = img.data;
  const s = 6 / size;                       // frequency; wraps because we
  const TAU = Math.PI * 2;                  // sample a torus, not a plane
  const c0 = new THREE.Color(base), c1 = new THREE.Color(spec);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Map the pixel onto a torus so the tile is genuinely seamless.
      const a = (x / size) * TAU, b = (y / size) * TAU;
      const nx = Math.cos(a) * 2, ny = Math.sin(a) * 2;
      const nz = Math.cos(b) * 2, nw = Math.sin(b) * 2;
      let v = 0.5 + 0.5 * n.simplex3(nx * 1.4, ny * 1.4, nz * 1.4 + nw * 0.6);
      v = v * 0.62 + 0.38 * (0.5 + 0.5 * n.simplex3(nx * 5, ny * 5, nz * 5 + nw * 2));
      const i = (y * size + x) * 4;
      d[i]     = (lerp(c0.r, c1.r, v) * 255) | 0;
      d[i + 1] = (lerp(c0.g, c1.g, v) * 255) | 0;
      d[i + 2] = (lerp(c0.b, c1.b, v) * 255) | 0;
      d[i + 3] = 255;
      void s;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/**
 * Foliage sprite for a canopy card. The card is a rectangle, and what matters
 * is its silhouette — a conifer has to taper to a point and droop, a broadleaf
 * has to be a ragged ball. Painted so that v=0 is the bottom of the card.
 */
export function foliageSprite(size = 256, tint = '#3f6b2e', seed = 3, needles = false) {
  const [cv, g] = canvas(size);
  const n = new Noise(seed);
  g.clearRect(0, 0, size, size);
  const base = new THREE.Color(tint);

  const put = (x, y, w, h, ang, l, a) => {
    const c = base.clone();
    c.offsetHSL(n.simplex2(x * 0.03, y * 0.03) * 0.035, 0, l);
    g.fillStyle = `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},${a.toFixed(3)})`;
    g.save(); g.translate(x, y); g.rotate(ang); g.fillRect(-w / 2, -h / 2, w, h); g.restore();
  };

  if (needles) {
    // A conifer: a stack of drooping sprays, widest at the bottom, tapering
    // to a leader at the top.
    const tiers = 9;
    for (let t = 0; t < tiers; t++) {
      const v = t / (tiers - 1);                 // 0 bottom, 1 top
      const y = size * (0.94 - v * 0.88);
      const halfW = size * 0.47 * Math.pow(1 - v, 0.78);
      const sprays = Math.max(4, Math.round(26 * (1 - v * 0.55)));
      for (let i = 0; i < sprays; i++) {
        const u = (i / (sprays - 1)) * 2 - 1;
        const jitter = n.simplex2(t * 3.1, i * 1.7);
        const x = size * 0.5 + u * halfW * (0.85 + jitter * 0.22);
        const len = halfW * (0.42 + Math.abs(jitter) * 0.3) + size * 0.02;
        const droop = 0.42 + Math.abs(u) * 0.5 + jitter * 0.12;
        const shade = -0.10 + (1 - Math.abs(u)) * 0.06 + v * 0.10 + jitter * 0.05;
        // A spray is a few needles fanned off a shoot.
        for (let k = 0; k < 5; k++) {
          const kf = k / 4;
          put(x + u * len * kf * 0.5, y + len * kf * 0.42,
              size * 0.012, len * 0.45, Math.sign(u || 1) * droop + jitter * 0.3,
              shade, 0.72 + 0.28 * (1 - kf));
        }
      }
    }
    // Leader.
    put(size * 0.5, size * 0.07, size * 0.018, size * 0.12, 0, 0.04, 0.95);
  } else {
    // A broadleaf: a ragged, lumpy ball with the mass low and the light on top.
    const clumps = 26;
    for (let c = 0; c < clumps; c++) {
      const a = (c / clumps) * Math.PI * 2 + n.simplex2(c * 0.9, 1) * 0.6;
      const rad = size * (0.10 + Math.abs(n.simplex2(0, c * 0.53)) * 0.32);
      const cx2 = size * 0.5 + Math.cos(a) * rad;
      const cy2 = size * 0.48 + Math.sin(a) * rad * 0.86;
      const lift = 1 - cy2 / size;
      for (let i = 0; i < 22; i++) {
        const la = n.simplex2(c * 2.3, i * 0.7) * Math.PI * 2;
        const lr = Math.abs(n.simplex2(i * 0.4, c * 1.1)) * size * 0.085;
        const w = size * (0.020 + 0.016 * Math.abs(n.simplex2(i * 1.3, c)));
        put(cx2 + Math.cos(la) * lr, cy2 + Math.sin(la) * lr,
            w, w * 1.7, la, -0.12 + lift * 0.22, 0.80);
      }
    }
  }
  return cv;
}

/**
 * A feather. RGB carries the shading, alpha the outline, so the same texture
 * serves as both albedo and alpha mask — a shaded feather rather than a
 * ragged translucent one.
 *
 * Painted root-at-the-bottom, because textures are sampled with v=0 at the
 * bottom of the image and the geometry pivots at the quill.
 */
export function featherSprite(size = 128, seed = 11) {
  const [cv, g] = canvas(size);
  const n = new Noise(seed);
  const img = g.createImageData(size, size);
  const d = img.data;
  const cx = size * 0.42;                  // rachis sits off-centre

  for (let y = 0; y < size; y++) {
    const t = 1 - y / (size - 1);          // 0 at the root, 1 at the tip
    // Narrow at the quill, full through the middle, rounded off at the tip.
    const env = Math.pow(Math.sin(Math.PI * Math.pow(clamp(t * 1.06, 0, 1), 0.55)), 0.75);
    const lead = env * size * 0.17;        // narrow leading vane
    const trail = env * size * 0.33;       // broad trailing vane

    for (let x = 0; x < size; x++) {
      const u = x - cx;
      const inside = u < 0 ? u > -lead : u < trail;
      const i = (y * size + x) * 4;
      if (!inside || env < 0.02) { d[i + 3] = 0; continue; }

      const half = u < 0 ? lead : trail;
      const edge = 1 - Math.pow(Math.abs(u) / half, 6);
      // Barbs run out from the rachis at an angle; the gaps between them are
      // what stop a feather reading as a painted lozenge.
      const barb = 0.82 + 0.18 * Math.sin((y * 0.85 + Math.abs(u) * 2.1) * 1.35);
      const grain = 0.90 + 0.10 * n.simplex2(x * 0.10, y * 0.055);
      // Darker towards the tip, lighter along the shaft.
      const shade = (0.50 + 0.40 * Math.pow(1 - t, 0.7)) * barb * grain;
      const shaft = 1 - Math.min(1, Math.abs(u) / (size * 0.022));

      const l = clamp(shade + shaft * 0.35, 0, 1);
      d[i] = d[i + 1] = d[i + 2] = (l * 255) | 0;
      // Feathers fray at the trailing edge near the tip.
      const fray = u > 0 && t > 0.45
        ? clamp(1 - Math.max(0, Math.abs(u) / half - 0.72) * 3 * (0.5 + 0.5 * n.simplex2(y * 0.4, 7)), 0, 1)
        : 1;
      d[i + 3] = (clamp(edge, 0, 1) * fray * 255) | 0;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/** Soft round puff used for billboard clouds and spray. */
export function puffSprite(size = 256, seed = 5) {
  const [cv, g] = canvas(size);
  const n = new Noise(seed);
  const img = g.createImageData(size, size);
  const d = img.data;
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c, dy = (y - c) / c;
      const r = Math.sqrt(dx * dx + dy * dy);
      let a = clamp(1 - r, 0, 1);
      a = Math.pow(a, 1.5);
      const lumps = 0.62 + 0.38 * (0.5 + 0.5 * n.simplex2(x * 0.022, y * 0.022));
      a *= lumps;
      // brighter at the top: cheap approximation of light entering from above
      const l = clamp(0.72 + 0.28 * (1 - y / size) + 0.10 * n.simplex2(x * 0.05, y * 0.05), 0, 1);
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = (l * 255) | 0;
      d[i + 3] = (clamp(a, 0, 1) * 255) | 0;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/* ═══════════════════════════════════════════════════════════ */

export class Assets {
  constructor(renderer, { stream = true } = {}) {
    this.renderer = renderer;
    this.stream = stream;
    this.cache = new Map();
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
    this.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.failures = [];
    this._onProgress = null;
    this._total = 0;
    this._done = 0;
  }

  onProgress(fn) { this._onProgress = fn; return this; }

  _tick(label) {
    this._done++;
    if (this._onProgress) {
      this._onProgress(this._total ? clamp(this._done / this._total, 0, 1) : 1, label);
    }
  }

  /** Declare how many loads this batch contains, so the bar is honest. */
  expect(n) { this._total = n; this._done = 0; return this; }

  /* ── GLB birds ──────────────────────────────────────────── */

  /**
   * The three.js sample birds are morph-target animated (no skeleton), which
   * makes them ideal as whole silhouettes at a distance and useless for
   * articulating a first-person wing. So they fly *around* you, not on you.
   */
  async birdModel(name) {
    const key = `glb:${name}`;
    if (this.cache.has(key)) return this.cache.get(key);
    if (!this.stream || !BIRD_GLB[name]) { this._tick(`bird · ${name}`); return null; }
    let out = null;
    try {
      const gltf = await new GLTFLoader().loadAsync(BIRD_GLB[name]);
      const mesh = gltf.scene.getObjectByProperty('type', 'Mesh')
                || gltf.scene.children[0];
      out = { scene: gltf.scene, animations: gltf.animations, mesh };
    } catch (e) {
      this.failures.push(`model ${name}`);
    }
    this.cache.set(key, out);
    this._tick(`bird · ${name}`);
    return out;
  }

  /* ── procedural textures shared between worlds ──────────── */

  foliage(tint, seed, needles) {
    const key = `fol:${tint}:${seed}:${needles}`;
    if (!this.cache.has(key)) {
      const t = toTexture(foliageSprite(256, tint, seed, needles), { srgb: true });
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      this.cache.set(key, t);
    }
    return this.cache.get(key);
  }

  feather() {
    if (!this.cache.has('feather')) {
      const t = toTexture(featherSprite(160, 11), { srgb: true });
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      this.cache.set('feather', t);
    }
    return this.cache.get('feather');
  }

  puff() {
    if (!this.cache.has('puff')) {
      const t = toTexture(puffSprite(256, 5), { srgb: true });
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      this.cache.set('puff', t);
    }
    return this.cache.get('puff');
  }

  dispose() {
    for (const v of this.cache.values()) {
      if (!v) continue;
      if (v.isTexture) v.dispose();
      else if (v.env) { v.env.dispose?.(); v.background?.dispose?.(); }
      else if (v.map) { v.map.dispose?.(); v.normalMap?.dispose?.(); v.armMap?.dispose?.(); }
    }
    this.cache.clear();
    this.pmrem.dispose();
  }
}
