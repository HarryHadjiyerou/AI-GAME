// Procedural instanced trees with runtime-baked impostors for the distance.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial, G, CURVE_VERT_PARS, FOG_FRAG_PARS } from '../core/shaderPatch.js';
import { mulberry32 } from '../core/noise.js';
import { TREE } from './fields.js';
import { hdrType } from '../core/post.js';

const TILE = 256;

// ---------- textures ----------
function needleTexture() {
  // A dense conifer frond: solid tapered silhouette (survives mip-mapping) with needle detail on top.
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry32(3);
  const frond = (x0, y0, len, ang, wid, shade) => {
    g.save();
    g.translate(x0, y0); g.rotate(ang);
    g.beginPath();
    g.moveTo(0, 0);
    const n = 14;
    for (let i = 0; i <= n; i++) { const t = i / n; g.lineTo(t * len, -wid * Math.sin(Math.PI * Math.pow(t, 0.8)) * (0.8 + r() * 0.35)); }
    for (let i = n; i >= 0; i--) { const t = i / n; g.lineTo(t * len, wid * Math.sin(Math.PI * Math.pow(t, 0.8)) * (0.8 + r() * 0.35)); }
    g.closePath();
    g.fillStyle = `rgb(${40 * shade | 0},${86 * shade | 0},${44 * shade | 0})`;
    g.fill();
    g.lineCap = 'round';
    for (let i = 0; i < len / 2; i++) {
      const t = i / (len / 2), px = t * len;
      const w = wid * Math.sin(Math.PI * Math.pow(t, 0.8));
      for (const sgn of [-1, 1]) {
        const l = w * (0.7 + r() * 0.5);
        const v = 0.7 + r() * 0.6;
        g.strokeStyle = `rgb(${52 * v * shade | 0},${118 * v * shade | 0},${60 * v * shade | 0})`;
        g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(px, 0); g.lineTo(px + l * 0.45, sgn * l); g.stroke();
      }
    }
    g.strokeStyle = '#4a3322'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(len * 0.9, 0); g.stroke();
    g.restore();
  };
  frond(2, S / 2, S * 0.96, 0, S * 0.2, 1.0);
  for (let k = 0; k < 6; k++) {
    const t = 0.18 + k * 0.13;
    frond(S * t, S / 2, S * (0.5 - k * 0.05), (k % 2 ? 0.55 : -0.55), S * 0.1, 0.9 + r() * 0.3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function leafTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry32(8);
  for (let i = 0; i < 520; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * S * 0.46;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
    const s = 5 + r() * 7;
    const sh = 70 + r() * 110;
    g.fillStyle = `rgb(${sh * 0.45 | 0},${sh | 0},${sh * 0.3 | 0})`;
    g.save(); g.translate(x, y); g.rotate(r() * Math.PI);
    g.beginPath(); g.ellipse(0, 0, s, s * 0.45, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- geometry ----------
function quad(p0, p1, p2, p3, n, uvs) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...p0, ...p1, ...p2, ...p3], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([...n[0], ...n[1], ...n[2], ...n[3]], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs || [0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

function trunkGeometry(bare, r0, r1, top = 1) {
  const g = new THREE.CylinderGeometry(r1, r0, top, 7, 4, true);
  g.translate(0, top / 2, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 10);
  return g;
}

function coniferFoliage(o) {
  const r = mulberry32(o.seed);
  const parts = [];
  const cy = o.bare + (1 - o.bare) * 0.45;
  for (let i = 0; i < o.layers; i++) {
    const t = i / (o.layers - 1);
    const y = o.bare + (1 - o.bare) * Math.pow(t, 0.92);
    const rad = (o.radius * Math.pow(1 - t, o.shape) * (0.85 + r() * 0.3)) + 0.02;
    const K = Math.max(4, Math.round(o.cards * (1 - t * 0.5)));
    for (let k = 0; k < K; k++) {
      const a = (k / K) * Math.PI * 2 + i * 0.9 + r() * 0.4;
      const dir = [Math.cos(a), 0, Math.sin(a)];
      const tan = [-Math.sin(a), 0, Math.cos(a)];
      const tilt = (k % 2 ? 1 : -1) * (0.35 + r() * 0.3);
      const w = rad * 0.8 + 0.02;
      const droop = o.droop * rad;
      const base = [0, y, 0];
      const tip = [dir[0] * rad, y - droop, dir[2] * rad];
      const off = (s, p) => [p[0] + tan[0] * w * s, p[1] + w * s * tilt, p[2] + tan[2] * w * s];
      const p0 = off(-0.35, base), p1 = off(-1, tip), p2 = off(1, tip), p3 = off(0.35, base);
      const nrm = (p) => { const v = new THREE.Vector3(p[0], (p[1] - cy) * 0.6 + 0.25, p[2]).normalize(); return [v.x, v.y, v.z]; };
      parts.push(quad(p0, p1, p2, p3, [nrm(p0), nrm(p1), nrm(p2), nrm(p3)], [0, 0, 1, 0, 1, 1, 0, 1].map((v, idx) => (idx % 2 ? (v ? 0.95 : 0.05) : v))));
    }
  }
  // leader
  const top = 1.0, lw = o.radius * 0.18;
  for (const a of [0, Math.PI / 2]) {
    const dx = Math.cos(a) * lw, dz = Math.sin(a) * lw;
    parts.push(quad([-dx, top - 0.12, -dz], [dx, top - 0.12, dz], [dx * 0.2, top + 0.02, dz * 0.2], [-dx * 0.2, top + 0.02, -dz * 0.2], [[0, 0.5, 1], [0, 0.5, 1], [0, 1, 0], [0, 1, 0]], [0.3, 0.2, 0.3, 0.8, 1, 0.8, 1, 0.2]));
  }
  return mergeGeometries(parts);
}

function broadleafFoliage(seed) {
  const r = mulberry32(seed);
  const parts = [];
  const C = new THREE.Vector3(0, 0.64, 0);
  for (let i = 0; i < 26; i++) {
    const v = new THREE.Vector3(r() * 2 - 1, r() * 1.6 - 0.6, r() * 2 - 1).normalize();
    const p = C.clone().add(new THREE.Vector3(v.x * 0.3, v.y * 0.24, v.z * 0.3).multiplyScalar(0.55 + r() * 0.5));
    const s = 0.2 + r() * 0.12;
    const a = new THREE.Vector3().crossVectors(v, new THREE.Vector3(r() - 0.5, 1, r() - 0.5)).normalize().multiplyScalar(s);
    const b = new THREE.Vector3().crossVectors(v, a).normalize().multiplyScalar(s);
    const P = [p.clone().sub(a).sub(b), p.clone().add(a).sub(b), p.clone().add(a).add(b), p.clone().sub(a).add(b)];
    const n = P.map((q) => { const d = q.clone().sub(C).normalize(); d.y += 0.3; d.normalize(); return [d.x, d.y, d.z]; });
    parts.push(quad(...P.map((q) => [q.x, q.y, q.z]), n));
  }
  return mergeGeometries(parts);
}

const SPECS = [
  // redwood: huge, long bare trunk, narrow crown
  { type: TREE.REDWOOD, trunk: [0.45, 0.028, 0.004], foliage: { bare: 0.38, radius: 0.15, layers: 16, cards: 10, droop: 0.3, shape: 0.8, seed: 1 }, bark: 0xb07560, leaf: 0x9ac08a, h: [48, 82], width: 0.3 },
  { type: TREE.FIR, trunk: [0.1, 0.02, 0.003], foliage: { bare: 0.08, radius: 0.26, layers: 14, cards: 11, droop: 0.4, shape: 1.0, seed: 2 }, bark: 0x8a7a70, leaf: 0x8cb884, h: [24, 42], width: 0.5 },
  { type: TREE.PINE, trunk: [0.55, 0.02, 0.005], foliage: { bare: 0.5, radius: 0.24, layers: 8, cards: 11, droop: 0.12, shape: 0.55, seed: 3 }, bark: 0x9a7058, leaf: 0xa8c888, h: [18, 34], width: 0.48 },
  { type: TREE.BROADLEAF, trunk: [0.5, 0.03, 0.012, 0.7], broad: true, bark: 0x857565, leaf: 0x8ab05a, h: [10, 19], width: 0.72 },
];

export class Trees {
  constructor(scene, renderer, assets, pool, field, biome, quality) {
    this.scene = scene;
    this.pool = pool;
    this.field = field;
    this.biome = biome;
    const q = { low: [240, 1100, 2500], medium: [380, 1800, 5000], high: [520, 2600, 8000] }[quality];
    this.r3d = q[0]; this.rImp = q[1]; this.cap = q[2];
    this.tiles = new Map();
    this.inflight = 0;
    this.last3d = new THREE.Vector3(1e9, 0, 0);
    this.lastImp = new THREE.Vector3(1e9, 0, 0);
    this.lastReq = new THREE.Vector3(1e9, 0, 0);
    this.leafTint = new THREE.Color(biome.treeTint || 0xffffff);

    const needles = needleTexture(), leaves = leafTexture();
    const bark = assets.tex.bark_diff, barkN = assets.tex.bark_nor;
    this.types = SPECS.map((s) => {
      const tg = trunkGeometry(...s.trunk);
      const fg = s.broad ? broadleafFoliage(9) : coniferFoliage(s.foliage);
      const tm = patchMaterial(new THREE.MeshStandardMaterial({ map: bark, normalMap: barkN, color: s.bark, roughness: 0.95 }), null, 'trunk');
      const fm = new THREE.MeshStandardMaterial({ map: s.broad ? leaves : needles, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.85, color: new THREE.Color(s.leaf).multiply(this.leafTint) });
      patchMaterial(fm, (sh) => {
        sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float sway = sin(uTimeW * 1.1 + ip.x * 0.05 + ip.z * 0.07) * 0.012 + sin(uTimeW * 2.7 + ip.x * 0.3) * 0.004;
          transformed.x += sway * position.y * position.y;
          transformed.z += sway * 0.6 * position.y * position.y;
          #endif`).replace('#include <common>', '#include <common>\nuniform float uTimeW;');
        sh.uniforms.uTimeW = G.uTime;
        // soft translucency: foliage lit from behind glows a little
        sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * 0.06;`);
      }, 'foliage');
      const trunk = new THREE.InstancedMesh(tg, tm, this.cap);
      const fol = new THREE.InstancedMesh(fg, fm, this.cap);
      for (const m of [trunk, fol]) { m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
      fol.castShadow = trunk.castShadow = quality === 'high';
      fol.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
      return { spec: s, trunk, fol, tg, fg, tm, fm };
    });
    this.bakeImpostors(renderer, assets);
    this.buildImpostorMesh();
  }

  bakeImpostors(renderer, assets) {
    // 4 columns (types) x 2 rows (side view, top view) rendered once with neutral lighting.
    const W = 256, H = 512;
    const rt = new THREE.WebGLRenderTarget(W * 4, H * 2, { type: hdrType(renderer), samples: 4 });
    const scene = new THREE.Scene();
    scene.environment = assets.envMap;
    scene.environmentIntensity = 0.55;
    const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
    sun.position.set(0.4, 1, 0.6);
    scene.add(sun, new THREE.AmbientLight(0xffffff, 0.25));
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    const saveTime = G.uTime.value;
    G.uTime.value = 0;
    this.types.forEach((t, i) => {
      const w = t.spec.width * 1.1;
      const trunk = new THREE.Mesh(t.tg, t.tm), fol = new THREE.Mesh(t.fg, t.fm);
      scene.add(trunk, fol);
      const side = new THREE.OrthographicCamera(-w / 2, w / 2, 1.04, -0.02, -5, 5);
      side.position.set(0, 0, 2); side.lookAt(0, 0, 0);
      renderer.setViewport(i * W, H, W, H);
      renderer.setScissor(i * W, H, W, H);
      renderer.setScissorTest(true);
      renderer.render(scene, side);
      const top = new THREE.OrthographicCamera(-w / 2, w / 2, w / 2, -w / 2, -5, 5);
      top.position.set(0, 2, 0); top.up.set(0, 0, -1); top.lookAt(0, 0, 0);
      renderer.setViewport(i * W, 0 + (H - W) / 2, W, W);
      renderer.setScissor(i * W, 0, W, H);
      renderer.render(scene, top);
      scene.remove(trunk, fol);
    });
    G.uTime.value = saveTime;
    renderer.setScissorTest(false);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    this.impostorTex = rt.texture;
  }

  buildImpostorMesh() {
    const max = 60000;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    this.impPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); // x,y,z,height
    this.impData = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2); // type, tint
    geo.setAttribute('iPos', this.impPos);
    geo.setAttribute('iData', this.impData);
    geo.instanceCount = 0;
    this.impMax = max;
    const widths = SPECS.map((s) => s.width * 1.1);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...G, tImp: { value: this.impostorTex }, uLeaf: { value: this.leafTint } },
      vertexShader: /* glsl */ `
        ${CURVE_VERT_PARS}
        attribute vec4 iPos;
        attribute vec2 iData;
        varying vec2 vUv;
        varying float vTop, vTint;
        const float W[4] = float[4](${widths.map((w) => w.toFixed(3)).join(',')});
        void main() {
          int ty = int(iData.x + 0.5);
          float h = iPos.w, w = W[ty] * h;
          vec3 base = iPos.xyz;
          vec3 toCam = cameraPosition - (base + vec3(0.0, h * 0.5, 0.0));
          float dist = length(toCam);
          vec3 v = toCam / dist;
          vTop = smoothstep(0.45, 0.85, v.y);
          vec3 right = normalize(vec3(v.z, 0.0, -v.x));
          vec3 up = normalize(cross(v, right));
          up = normalize(mix(vec3(0.0, 1.0, 0.0), up, vTop));
          vec3 c = base + vec3(0.0, h * mix(0.5, 0.75, vTop), 0.0);
          float hh = mix(h * 1.06, w, vTop);
          vec3 p = c + right * position.x * w - up * position.y * -hh;
          vFogWorld = p;
          vUv = vec2((float(ty) + uv.x) * 0.25, uv.y);
          vTint = iData.y;
          gl_Position = projectionMatrix * viewMatrix * curveWorld(vec4(p, 1.0));
        }`,
      fragmentShader: /* glsl */ `
        ${FOG_FRAG_PARS}
        uniform sampler2D tImp;
        uniform vec3 uSunColor;
        varying vec2 vUv;
        varying float vTop, vTint;
        void main() {
          vec2 sideUv = vec2(vUv.x, 0.5 + vUv.y * 0.5);
          vec2 topUv = vec2(vUv.x, 0.125 + vUv.y * 0.25);
          vec4 s = texture2D(tImp, sideUv);
          vec4 t = texture2D(tImp, topUv);
          vec4 c = mix(s, t, vTop);
          if (c.a < 0.5) discard;
          vec3 col = c.rgb / max(c.a, 0.001) * (0.85 + 0.3 * vTint) * (0.55 + 0.5 * max(uSunDir.y, 0.0)) * uSunColor;
          gl_FragColor = vec4(applyFog(col, vFogWorld), 1.0);
        }`,
    });
    this.impMesh = new THREE.Mesh(geo, mat);
    this.impMesh.frustumCulled = false;
    this.scene.add(this.impMesh);
  }

  tileKey(i, j) { return i + ':' + j; }

  update(cam) {
    // Request tiles around the player
    if (cam.distanceTo(this.lastReq) > 60 || this.inflight === 0) {
      this.lastReq.copy(cam);
      const n = Math.ceil(this.rImp / TILE);
      const ci = Math.floor(cam.x / TILE), cj = Math.floor(cam.z / TILE);
      const want = [];
      for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
        const cx = (ci + i + 0.5) * TILE, cz = (cj + j + 0.5) * TILE;
        const d = Math.hypot(cx - cam.x, cz - cam.z);
        if (d > this.rImp + TILE) continue;
        const k = this.tileKey(ci + i, cj + j);
        if (!this.tiles.has(k)) want.push([d, ci + i, cj + j, k]);
      }
      want.sort((a, b) => a[0] - b[0]);
      for (const [, i, j, k] of want) {
        if (this.inflight >= 4) break;
        this.tiles.set(k, { state: 'loading', data: null, i, j });
        this.inflight++;
        this.pool.request({ type: 'trees', key: 'tr:' + k, x0: i * TILE, z0: j * TILE, size: TILE }, (m) => {
          this.inflight--;
          const t = this.tiles.get(k);
          if (!t) return;
          t.state = 'ready'; t.data = m.data;
          this.dirty3d = true; this.dirtyImp = true;
        });
      }
      // drop far tiles
      for (const [k, t] of this.tiles) {
        const d = Math.hypot((t.i + 0.5) * TILE - cam.x, (t.j + 0.5) * TILE - cam.z);
        if (d > this.rImp + TILE * 3 && t.state === 'ready') this.tiles.delete(k);
      }
    }
    if (this.dirty3d || cam.distanceTo(this.last3d) > 25) { this.dirty3d = false; this.last3d.copy(cam); this.rebuild3d(cam); }
    const now = performance.now();
    if ((this.dirtyImp && now - (this.impTime || 0) > 700) || cam.distanceTo(this.lastImp) > 120) { this.dirtyImp = false; this.impTime = now; this.lastImp.copy(cam); this.rebuildImp(cam); }
  }

  forEachTree(cx, cz, r, fn) {
    const i0 = Math.floor((cx - r) / TILE), i1 = Math.floor((cx + r) / TILE);
    const j0 = Math.floor((cz - r) / TILE), j1 = Math.floor((cz + r) / TILE);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const t = this.tiles.get(this.tileKey(i, j));
      if (!t || !t.data) continue;
      const d = t.data;
      for (let k = 0; k < d.length; k += 6) fn(d[k], d[k + 1], d[k + 2], d[k + 3], d[k + 4], d[k + 5]);
    }
  }

  treeHeight(type, s) { const h = SPECS[type].h; return h[0] + (h[1] - h[0]) * s; }
  treeRadius(type) { return SPECS[type].width * 0.5; }

  rebuild3d(cam) {
    const counts = [0, 0, 0, 0];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const r2 = this.r3d * this.r3d;
    this.forEachTree(cam.x, cam.z, this.r3d, (x, y, z, s, rot, type) => {
      const dx = x - cam.x, dz = z - cam.z;
      if (dx * dx + dz * dz > r2) return;
      const T = this.types[type];
      const c = counts[type];
      if (c >= this.cap) return;
      const h = this.treeHeight(type, s);
      q.setFromAxisAngle(up, rot);
      sc.set(h * (0.9 + s * 0.2), h, h * (0.9 + s * 0.2));
      p.set(x, y - 0.5, z);
      m4.compose(p, q, sc);
      T.trunk.setMatrixAt(c, m4);
      T.fol.setMatrixAt(c, m4);
      const v = 0.8 + (rot * 1.7 % 1) * 0.4;
      col.setRGB(v * (0.95 + s * 0.1), v, v * (0.9 + (1 - s) * 0.15));
      T.fol.setColorAt(c, col);
      counts[type]++;
    });
    this.types.forEach((T, i) => {
      T.trunk.count = T.fol.count = counts[i];
      T.trunk.instanceMatrix.needsUpdate = T.fol.instanceMatrix.needsUpdate = true;
      if (T.fol.instanceColor) T.fol.instanceColor.needsUpdate = true;
    });
  }

  rebuildImp(cam) {
    const P = this.impPos.array, D = this.impData.array;
    let n = 0;
    const r3 = this.r3d * this.r3d, ri = this.rImp * this.rImp;
    this.forEachTree(cam.x, cam.z, this.rImp, (x, y, z, s, rot, type) => {
      const dx = x - cam.x, dz = z - cam.z, d2 = dx * dx + dz * dz;
      if (d2 <= r3 || d2 > ri || n >= this.impMax) return;
      // thin out far away, keeping the tall ones
      if (d2 > ri * 0.35 && (rot * 3.1) % 1 > 0.55 + s * 0.4) return;
      P[n * 4] = x; P[n * 4 + 1] = y - 0.5; P[n * 4 + 2] = z; P[n * 4 + 3] = this.treeHeight(type, s);
      D[n * 2] = type; D[n * 2 + 1] = (rot * 1.7) % 1;
      n++;
    });
    this.impMesh.geometry.instanceCount = n;
    this.impPos.needsUpdate = true;
    this.impData.needsUpdate = true;
  }
}
