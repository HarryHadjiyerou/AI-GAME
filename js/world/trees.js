// Instanced Blender-built trees (two LODs) with runtime-baked impostors for the distance.
import * as THREE from 'three';
import { patchMaterial, G, CURVE_VERT_PARS, FOG_FRAG_PARS } from '../core/shaderPatch.js';
import { foliageMaterial, barkMaterial } from './treeAssets.js';
import { TREE } from './fields.js';
import { hdrType } from '../core/post.js';

const TILE = 256;

// Tree types (index = TREE enum): Blender species, height range (m) and 3D LOD0 distance factor.
const SPECS = [
  { type: TREE.REDWOOD, name: 'redwood', h: [48, 82] },
  { type: TREE.FIR, name: 'fir', h: [24, 42] },
  { type: TREE.PINE, name: 'pine', h: [18, 34] },
  { type: TREE.BROADLEAF, name: 'broadleaf', h: [11, 21] },
  { type: TREE.PALM, name: 'palm', h: [12, 22] },
];
const NT = SPECS.length;

export class Trees {
  constructor(scene, renderer, assets, pool, field, biome, quality) {
    this.scene = scene;
    this.pool = pool;
    this.field = field;
    this.biome = biome;
    // [LOD0 radius, 3D radius, impostor radius, instance cap per type]
    const q = { low: [55, 240, 1100, 2500], medium: [85, 380, 1800, 5000], high: [140, 520, 2600, 8000] }[quality];
    this.r0 = q[0]; this.r3d = q[1]; this.rImp = q[2]; this.cap = q[3];
    this.tiles = new Map();
    this.inflight = 0;
    this.last3d = new THREE.Vector3(1e9, 0, 0);
    this.lastImp = new THREE.Vector3(1e9, 0, 0);
    this.lastReq = new THREE.Vector3(1e9, 0, 0);
    this.leafTint = new THREE.Color(biome.treeTint || 0xffffff);

    const A = assets.trees;
    this.widths = SPECS.map((s) => (A.species[s.name] ? A.species[s.name].meta.radius * 2.1 : 0.5));
    this.types = SPECS.map((s) => {
      const sp = A.species[s.name];
      if (!sp) return null;
      const tm = barkMaterial(A, s.name, 'bark_' + s.name);
      const fm = foliageMaterial(A, s.name, this.leafTint, 'fol_' + s.name);
      const mk = (geo, mat) => {
        const m = new THREE.InstancedMesh(geo, mat, this.cap);
        m.count = 0; m.visible = false; m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
        m.castShadow = quality === 'high';
        scene.add(m);
        return m;
      };
      // lod[0] = full detail near the camera, lod[1] = thinned cards / simpler wood out to r3d
      return { spec: s, sp, tm, fm, lod: [[mk(sp.bark0, tm), mk(sp.fol0, fm)], [mk(sp.bark1, tm), mk(sp.fol1, fm)]] };
    });
    this.bakeImpostors(renderer, assets);
    this.buildImpostorMesh();
  }

  bakeImpostors(renderer, assets) {
    // one column per type x 2 rows (side view, top view) rendered once with neutral lighting.
    const W = 256, H = 512;
    const rt = new THREE.WebGLRenderTarget(W * NT, H * 2, { type: hdrType(renderer), samples: 4 });
    const scene = new THREE.Scene();
    // same light rig as the game (game.js) so impostors match the 3D trees they replace
    const b = this.biome;
    scene.environment = assets.envMap;
    scene.environmentIntensity = b.envIntensity;
    const sun = new THREE.DirectionalLight(0xfff3e0, b.sunIntensity);
    sun.position.set(0.4, 1, 0.6);
    const zen = assets.skyInfo.zenith.clone(); const zl = Math.max(zen.r, zen.g, zen.b, 1e-3);
    scene.add(sun, new THREE.HemisphereLight(new THREE.Color(zen.r / zl, zen.g / zl, zen.b / zl).lerp(new THREE.Color(1, 1, 1), 0.35), new THREE.Color(b.bounce || 0x665544), b.hemi ?? 0.9));
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    const saveTime = G.uTime.value;
    G.uTime.value = 0;
    this.types.forEach((t, i) => {
      if (!t) return;
      const w = this.widths[i];
      const trunk = new THREE.Mesh(t.sp.bark0, t.tm), fol = new THREE.Mesh(t.sp.fol0, t.fm);
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
    this.impData = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); // type, tint, shadow, sky
    geo.setAttribute('iPos', this.impPos);
    geo.setAttribute('iData', this.impData);
    geo.instanceCount = 0;
    this.impMax = max;
    const widths = this.widths;
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...G, tImp: { value: this.impostorTex }, uLeaf: { value: this.leafTint } },
      vertexShader: /* glsl */ `
        ${CURVE_VERT_PARS}
        attribute vec4 iPos;
        attribute vec4 iData;
        varying vec2 vUv;
        varying float vTop, vTint;
        varying vec2 vLit;
        const float W[${NT}] = float[${NT}](${widths.map((w) => w.toFixed(3)).join(',')});
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
          vUv = vec2((float(ty) + uv.x) / ${NT}.0, uv.y);
          vTint = iData.y;
          vLit = iData.zw;
          gl_Position = projectionMatrix * viewMatrix * curveWorld(vec4(p, 1.0));
        }`,
      fragmentShader: /* glsl */ `
        ${FOG_FRAG_PARS}
        uniform sampler2D tImp;
        uniform vec3 uSunColor;
        varying vec2 vUv;
        varying float vTop, vTint;
        varying vec2 vLit;
        void main() {
          vec2 sideUv = vec2(vUv.x, 0.5 + vUv.y * 0.5);
          vec2 topUv = vec2(vUv.x, 0.125 + vUv.y * 0.25);
          vec4 s = texture2D(tImp, sideUv);
          vec4 t = texture2D(tImp, topUv);
          vec4 c = mix(s, t, vTop);
          if (c.a < 0.5) discard;
          vec3 col = c.rgb / max(c.a, 0.001) * (0.85 + 0.3 * vTint) * (0.55 + 0.5 * max(uSunDir.y, 0.0)) * uSunColor * (0.2 + 0.8 * (0.62 * vLit.x + 0.38 * vLit.y));
          gl_FragColor = vec4(applyFog(col, vFogWorld), 1.0);
        }`,
    });
    this.impMesh = new THREE.Mesh(geo, mat);
    this.impMesh.frustumCulled = false;
    this.impMesh.layers.enable(1);
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
      for (let k = 0; k < d.length; k += 8) fn(d[k], d[k + 1], d[k + 2], d[k + 3], d[k + 4], d[k + 5], d[k + 6], d[k + 7]);
    }
  }

  treeHeight(type, s) { const h = SPECS[type].h; return h[0] + (h[1] - h[0]) * s; }
  treeRadius(type) { return this.widths[type] * 0.5; }

  rebuild3d(cam) {
    const counts = [new Array(NT).fill(0), new Array(NT).fill(0)];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const r2 = this.r3d * this.r3d, r02 = this.r0 * this.r0;
    this.forEachTree(cam.x, cam.z, this.r3d, (x, y, z, s, rot, type, sh, sk) => {
      const dx = x - cam.x, dz = z - cam.z, d2 = dx * dx + dz * dz;
      if (d2 > r2) return;
      const T = this.types[type];
      if (!T) return;
      const h = this.treeHeight(type, s);
      // big trees switch to LOD1 a little later (up to 1.3x the distance)
      const L = d2 < r02 * Math.min(1.69, Math.max(1, (h / 30) ** 2)) ? 0 : 1;
      const c = counts[L][type];
      if (c >= this.cap) return;
      q.setFromAxisAngle(up, rot);
      sc.set(h * (0.9 + s * 0.2), h, h * (0.9 + s * 0.2));
      p.set(x, y - 0.5, z);
      m4.compose(p, q, sc);
      // baked terrain shadow / sky visibility darkens trees in canyons and mountain shadows
      const v = (0.8 + (rot * 1.7 % 1) * 0.4) * (0.22 + 0.78 * (0.62 * sh + 0.38 * sk));
      col.setRGB(v * (0.95 + s * 0.1), v, v * (0.9 + (1 - s) * 0.15));
      for (const m of T.lod[L]) { m.setMatrixAt(c, m4); m.setColorAt(c, col); }
      counts[L][type]++;
    });
    this.types.forEach((T, i) => {
      if (!T) return;
      T.lod.forEach((pair, L) => pair.forEach((m) => {
        m.count = counts[L][i];
        m.visible = m.count > 0;
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor.needsUpdate = true;
      }));
    });
  }

  rebuildImp(cam) {
    const P = this.impPos.array, D = this.impData.array;
    let n = 0;
    const r3 = this.r3d * this.r3d, ri = this.rImp * this.rImp;
    this.forEachTree(cam.x, cam.z, this.rImp, (x, y, z, s, rot, type, sh, sk) => {
      const dx = x - cam.x, dz = z - cam.z, d2 = dx * dx + dz * dz;
      if (d2 <= r3 || d2 > ri || n >= this.impMax) return;
      // thin out far away, keeping the tall ones
      if (d2 > ri * 0.35 && (rot * 3.1) % 1 > 0.55 + s * 0.4) return;
      P[n * 4] = x; P[n * 4 + 1] = y - 0.5; P[n * 4 + 2] = z; P[n * 4 + 3] = this.treeHeight(type, s);
      D[n * 4] = type; D[n * 4 + 1] = (rot * 1.7) % 1; D[n * 4 + 2] = sh; D[n * 4 + 3] = sk;
      n++;
    });
    this.impMesh.geometry.instanceCount = n;
    this.impPos.needsUpdate = true;
    this.impData.needsUpdate = true;
  }
}
