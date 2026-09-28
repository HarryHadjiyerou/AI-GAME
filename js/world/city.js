// Procedural metropolis: towers with shader-drawn facades, construction frames with cranes,
// rooftop billboards, bridges over the river and shader-animated traffic.
import * as THREE from 'three';
import { patchMaterial, G, CURVE_VERT_PARS, FOG_FRAG_PARS } from '../core/shaderPatch.js';
import { mulberry32, hash2 } from '../core/noise.js';
import { CITY } from './fields.js';

const CH = 4; // blocks per chunk side
const CHS = CH * CITY.PITCH;

function adTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  const ads = [
    ['#ff3d6e', '#ffb13d', 'FLY', 'higher'],
    ['#1fd1c1', '#2f6bff', 'COO', 'coffee'],
    ['#8a3dff', '#ff3dd8', 'AVES', 'the city is yours'],
    ['#ffd23d', '#ff6a1f', 'CRUMBS', 'since 1887'],
  ];
  ads.forEach(([a, b, t1, t2], i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 256;
    const gr = g.createLinearGradient(x, y, x + 512, y + 256);
    gr.addColorStop(0, a); gr.addColorStop(1, b);
    g.fillStyle = gr; g.fillRect(x, y, 512, 256);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.font = 'bold 130px Helvetica, Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText(t1, x + 256, y + 150);
    g.font = '36px Helvetica, Arial, sans-serif';
    g.fillText(t2, x + 256, y + 210);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class City {
  constructor(scene, field, assets, water, quality) {
    this.scene = scene;
    this.field = field;
    this.water = water;
    this.chunks = new Map();
    this.radius = quality === 'low' ? 1200 : quality === 'medium' ? 1600 : 2400;
    this.group = new THREE.Group();
    scene.add(this.group);

    // --- building material with procedural windows ---
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.0, envMapIntensity: 1.0 });
    const uni = { tNoise: { value: assets.tex.noise }, tRoof: { value: assets.tex.asphalt_diff } };
    patchMaterial(mat, (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aStyle;\nattribute vec3 aBCol;\nvarying float vStyle;\nvarying vec3 vWN;\nvarying vec3 vBCol;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStyle = aStyle;\nvWN = normal;\nvBCol = aBCol;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tNoise, tRoof;\nvarying float vStyle;\nvarying vec3 vWN;\nvarying vec3 vBCol;\nfloat h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }')
        .replace('#include <map_fragment>', /* glsl */ `
          vec3 wp = vFogWorld;
          vec3 wn = normalize(vWN);
          float bRough = 0.85, bMetal = 0.0;
          vec3 bEmit = vec3(0.0);
          vec3 base = vBCol;
          if (vStyle > 2.5) {
            // plain painted metal / concrete (cranes, frames, rooftop plant, bridges)
            diffuseColor.rgb = base * (0.85 + 0.3 * texture2D(tNoise, (wp.xz + wp.y) / 25.0).g);
            bRough = 0.55; bMetal = vStyle > 3.5 ? 0.35 : 0.1;
          } else if (wn.y > 0.5) {
            vec3 r = texture2D(tRoof, wp.xz / 9.0).rgb;
            diffuseColor.rgb = r * vec3(0.55, 0.55, 0.57) * (0.8 + 0.4 * texture2D(tNoise, wp.xz / 40.0).r);
          } else if (wn.y < -0.5) {
            diffuseColor.rgb = base * 0.4;
          } else {
            vec2 tng = normalize(vec2(-wn.z, wn.x));
            float u = dot(wp.xz, tng);
            float v = wp.y;
            float style = floor(vStyle + 0.5);
            float floorH = style == 2.0 ? 3.1 : 3.8;
            float colW = style == 0.0 ? 2.0 : style == 1.0 ? 3.0 : 3.4;
            vec2 cell = vec2(floor(u / colW), floor(v / floorH));
            vec2 f = vec2(fract(u / colW), fract(v / floorH));
            float seed = h1(cell + floor(wp.xz / 60.0));
            float win;
            if (style == 0.0) win = step(0.06, f.x) * step(0.08, f.y);
            else if (style == 1.0) win = step(0.08, f.x) * step(0.34, f.y) * step(f.y, 0.94);
            else win = step(0.28, f.x) * step(f.x, 0.72) * step(0.25, f.y) * step(f.y, 0.8);
            bool ground = v < 5.2 + wp.y * 0.0;
            vec3 glass = style == 0.0 ? vec3(0.08, 0.14, 0.17) : vec3(0.06, 0.08, 0.1);
            glass *= 0.7 + 0.6 * seed;
            vec3 wall = base * (0.85 + 0.25 * texture2D(tNoise, vec2(u, v) / 30.0).g);
            diffuseColor.rgb = mix(wall, glass, win);
            bRough = mix(0.9, style == 0.0 ? 0.05 : 0.12, win);
            bMetal = mix(0.0, style == 0.0 ? 0.85 : 0.5, win);
            // lit windows (warm) scattered through the building
            float lit = step(0.95, h1(cell * 1.37 + 3.1)) * win;
            bEmit = vec3(1.0, 0.7, 0.4) * lit * (0.25 + seed * 0.6);
            if (v < 4.8) { // shopfronts
              float shop = step(0.1, fract(u / 7.0)) * step(0.6, v) * step(v, 3.8);
              diffuseColor.rgb = mix(base * 0.35, vec3(0.05), shop);
              bEmit += vec3(1.0, 0.85, 0.6) * shop * 0.9 * step(0.4, h1(vec2(floor(u / 7.0), 1.0)));
              bRough = mix(0.8, 0.1, shop); bMetal = mix(0.0, 0.4, shop);
            }
          }`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = bRough;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = bMetal;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += bEmit;');
    }, 'building');
    this.buildingMat = mat;
    const adTex = adTexture();
    this.adMat = patchMaterial(new THREE.MeshStandardMaterial({ map: adTex, emissiveMap: adTex, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.4, side: THREE.DoubleSide }), null, 'ad');
    this.adGeos = [0, 1, 2, 3].map((i) => {
      const g = new THREE.PlaneGeometry(1, 1);
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (uv.getX(k) + (i % 2)) * 0.5, (uv.getY(k) + (1 - Math.floor(i / 2))) * 0.5);
      return g;
    });
    this.makeTraffic(assets);
    this.lastTraffic = new THREE.Vector3(1e9, 0, 0);
    this.queue = [];
  }

  // ---------- layout ----------
  blockBuildings(bx, bz) {
    const b = this.field.block(bx, bz);
    const out = { buildings: [], frames: null, type: b.type, cx: b.cx, cz: b.cz };
    if (b.type !== 'build' && b.type !== 'construction') return out;
    const r = mulberry32(bx * 73856093 ^ bz * 19349663);
    const inner = CITY.PITCH - CITY.ROAD - 8;
    const x0 = bx * CITY.PITCH + CITY.ROAD / 2 + 4, z0 = bz * CITY.PITCH + CITY.ROAD / 2 + 4;
    const d = Math.hypot(b.cx, b.cz);
    const down = Math.exp(-((d / 1500) ** 2)) + 0.35 * Math.exp(-(((d - 2600) / 500) ** 2));
    if (b.type === 'construction') {
      out.frames = { x: x0 + 8, z: z0 + 8, w: inner - 16, d: inner - 16, floors: 6 + Math.floor(r() * 12) };
      return out;
    }
    // split into lots
    const lots = [];
    const split = r();
    if (split < 0.3) lots.push([0, 0, inner, inner]);
    else if (split < 0.6) { const s = 0.35 + r() * 0.3; lots.push([0, 0, inner * s, inner], [inner * s, 0, inner * (1 - s), inner]); }
    else { const s = 0.4 + r() * 0.2, t = 0.4 + r() * 0.2; lots.push([0, 0, inner * s, inner * t], [inner * s, 0, inner * (1 - s), inner * t], [0, inner * t, inner * s, inner * (1 - t)], [inner * s, inner * t, inner * (1 - s), inner * (1 - t)]); }
    const base = this.field.base(b.cx, b.cz);
    for (const [lx, lz, lw, ld] of lots) {
      const m = 1 + r() * 2.5;
      const w = lw - m * 2, dd = ld - m * 2;
      if (w < 8 || dd < 8) continue;
      let h = 10 + Math.pow(r(), 2.2) * (30 + 270 * down);
      if (r() < 0.04 * down) h += 120; // landmark towers
      const style = h > 90 ? (r() < 0.8 ? 0 : 1) : h > 35 ? (r() < 0.6 ? 1 : 0) : (r() < 0.7 ? 2 : 1);
      const palette = style === 0 ? [[0.55, 0.6, 0.63], [0.4, 0.45, 0.5], [0.7, 0.68, 0.62]] : style === 1 ? [[0.72, 0.7, 0.66], [0.55, 0.55, 0.56], [0.78, 0.74, 0.68]] : [[0.55, 0.3, 0.22], [0.62, 0.42, 0.3], [0.7, 0.6, 0.5], [0.45, 0.38, 0.34]];
      const col = palette[Math.floor(r() * palette.length)];
      const tiers = [];
      let cx = x0 + lx + m + w / 2, cz = z0 + lz + m + dd / 2, tw = w, td = dd, y = base - 1, remaining = h;
      const nT = h > 110 ? 3 : h > 60 ? 2 : 1;
      for (let t = 0; t < nT; t++) {
        const th = t === nT - 1 ? remaining : remaining * (0.45 + r() * 0.2);
        tiers.push([cx - tw / 2, y, cz - td / 2, cx + tw / 2, y + th, cz + td / 2]);
        y += th; remaining -= th;
        tw *= 0.65 + r() * 0.2; td *= 0.65 + r() * 0.2;
      }
      out.buildings.push({ tiers, style, col, h, top: y, billboard: h > 18 && h < 70 && r() < 0.18, rnd: r() });
    }
    return out;
  }

  buildChunk(ci, cj) {
    const pos = [], nor = [], col = [], sty = [];
    const boxes = [];
    const pushBox = (b, c, s) => {
      const [x0, y0, z0, x1, y1, z1] = b;
      const faces = [
        [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]],
        [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]],
        [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]],
        [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]],
        [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]],
      ];
      for (const [a, b2, c2, d, n] of faces) {
        for (const p of [a, b2, c2, a, c2, d]) { pos.push(...p); nor.push(...n); col.push(...c); sty.push(s); }
      }
    };
    const steel = [], yellow = [], grey = [], ads = [[], [], [], []];
    const group = new THREE.Group();
    for (let j = 0; j < CH; j++) for (let i = 0; i < CH; i++) {
      const bx = ci * CH + i, bz = cj * CH + j;
      const L = this.blockBuildings(bx, bz);
      for (const b of L.buildings) {
        b.tiers.forEach((t) => { pushBox(t, b.col, b.style); boxes.push(t); });
        const top = b.tiers[b.tiers.length - 1];
        // rooftop clutter: AC units / water tower
        const r = mulberry32(Math.floor(b.rnd * 1e6));
        const n = 1 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
          const w = 2 + r() * 4, h = 1.5 + r() * 3;
          const x = top[0] + 2 + r() * Math.max(0, top[3] - top[0] - 4 - w), z = top[2] + 2 + r() * Math.max(0, top[5] - top[2] - 4 - w);
          const bb = [x, top[4], z, x + w, top[4] + h, z + w];
          grey.push(bb); boxes.push(bb);
        }
        if (b.billboard) {
          const w = Math.min(18, (top[3] - top[0]) * 0.8), hh = w * 0.4;
          const zc = top[2] + 1.5, x = (top[0] + top[3]) / 2;
          ads[Math.floor(r() * 4)].push([x, top[4] + 4 + hh / 2, zc, w, hh]);
          const leg = [x - w / 2, top[4], zc + 0.4, x + w / 2, top[4] + 4 + hh, zc + 1.0];
          grey.push([x - w / 2 + 1, top[4], zc + 0.5, x - w / 2 + 1.6, top[4] + 4, zc + 1.1], [x + w / 2 - 1.6, top[4], zc + 0.5, x + w / 2 - 1, top[4] + 4, zc + 1.1]);
          boxes.push(leg);
        }
      }
      if (L.frames) this.buildFrames(L.frames, steel, yellow, boxes);
      if (L.type === 'river') this.buildBridge(bx, bz, grey, boxes);
    }
    grey.forEach((b) => pushBox(b, [0.55, 0.56, 0.57], 3));
    steel.forEach((b) => pushBox(b, [0.75, 0.28, 0.14], 4));
    yellow.forEach((b) => pushBox(b, [0.92, 0.66, 0.05], 5));
    let mesh = null;
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('aBCol', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('aStyle', new THREE.Float32BufferAttribute(sty, 1));
      mesh = new THREE.Mesh(g, this.buildingMat);
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    // merged into the single building mesh below via plain styles (3 = concrete, 4 = steel, 5 = crane yellow)
    ads.forEach((list, i) => list.forEach(([x, y, z, w, h]) => {
      const m = new THREE.Mesh(this.adGeos[i], this.adMat);
      m.position.set(x, y, z); m.scale.set(w, h, 1); m.rotation.y = Math.PI;
      m.frustumCulled = false;
      group.add(m);
      boxes.push([x - w / 2, y - h / 2, z - 0.2, x + w / 2, y + h / 2, z + 0.5]);
    }));
    this.group.add(group);
    return { group, boxes, mesh };
  }

  buildFrames(f, steel, yellow, boxes) {
    const col = 8, fh = 4.2;
    const nx = Math.max(2, Math.floor(f.w / col)), nz = Math.max(2, Math.floor(f.d / col));
    const base = this.field.base(f.x, f.z) - 0.5;
    const s = 0.6;
    for (let i = 0; i <= nx; i++) for (let k = 0; k <= nz; k++) {
      const x = f.x + i * col, z = f.z + k * col;
      const b = [x - s / 2, base, z - s / 2, x + s / 2, base + f.floors * fh, z + s / 2];
      steel.push(b); boxes.push(b);
    }
    for (let fl = 1; fl <= f.floors; fl++) {
      const y = base + fl * fh;
      for (let i = 0; i <= nx; i++) {
        if (fl % 2 && i % 2 && i > 0 && i < nx) continue; // leave gaps to fly through
        const x = f.x + i * col;
        const b = [x - s / 2, y - s, f.z, x + s / 2, y, f.z + nz * col];
        steel.push(b); boxes.push(b);
      }
      for (let k = 0; k <= nz; k++) {
        if (fl % 3 === 0 && k > 0 && k < nz) continue;
        const z = f.z + k * col;
        const b = [f.x, y - s, z - s / 2, f.x + nx * col, y, z + s / 2];
        steel.push(b); boxes.push(b);
      }
    }
    // tower crane
    const cx = f.x + nx * col + 5, cz = f.z + 4, top = base + f.floors * fh + 30;
    const mast = [cx - 1.2, base, cz - 1.2, cx + 1.2, top, cz + 1.2];
    yellow.push(mast); boxes.push(mast);
    const jib = [cx - 16, top, cz - 0.8, cx + 55, top + 2.2, cz + 0.8];
    yellow.push(jib); boxes.push(jib);
    yellow.push([cx - 1.5, top + 2.2, cz - 1.5, cx + 1.5, top + 8, cz + 1.5]);
    const cw = [cx - 16, top - 3, cz - 2, cx - 10, top, cz + 2];
    steel.push(cw); boxes.push(cw);
    const hook = [cx + 38, top - 22, cz - 0.1, cx + 38.2, top, cz + 0.1];
    steel.push(hook);
  }

  buildBridge(bx, bz, grey, boxes) {
    // Roads run along block edges: the E-W road at z = bz * PITCH crosses the river here.
    const z = bz * CITY.PITCH;
    const x0 = bx * CITY.PITCH, x1 = x0 + CITY.PITCH;
    const rx = this.field.riverX(z);
    if (rx < x0 - CITY.PITCH * 0.5 || rx > x1 + CITY.PITCH * 0.5) return;
    if (Math.abs((rx - x0) - CITY.PITCH / 2) > CITY.PITCH / 2) return;
    const span = CITY.RIVER_HALF + 26;
    const y = Math.max(this.field.base(rx - span, z), this.field.base(rx + span, z)) + 0.5;
    const deck = [rx - span, y - 1.6, z - CITY.ROAD / 2, rx + span, y, z + CITY.ROAD / 2];
    grey.push(deck); boxes.push(deck);
    grey.push([rx - span, y, z - CITY.ROAD / 2, rx + span, y + 1.1, z - CITY.ROAD / 2 + 0.4], [rx - span, y, z + CITY.ROAD / 2 - 0.4, rx + span, y + 1.1, z + CITY.ROAD / 2]);
    if (hash2(bx, bz, 5) < 0.4) {
      // suspension towers + cable segments
      for (const sx of [-0.55, 0.55]) {
        const tx = rx + sx * span;
        for (const sz of [-1, 1]) {
          const t = [tx - 1.5, y - 8, z + sz * (CITY.ROAD / 2 + 1) - 1.5, tx + 1.5, y + 48, z + sz * (CITY.ROAD / 2 + 1) + 1.5];
          grey.push(t); boxes.push(t);
        }
        grey.push([tx - 1.5, y + 40, z - CITY.ROAD / 2 - 2, tx + 1.5, y + 43, z + CITY.ROAD / 2 + 2]);
      }
      for (const sz of [-1, 1]) {
        const zz = z + sz * (CITY.ROAD / 2 + 1);
        for (let k = 0; k < 24; k++) {
          const a = k / 24, b = (k + 1) / 24;
          const xa = rx + (a - 0.5) * span * 1.1 * 2 * 0.55 * 1.82, xb = rx + (b - 0.5) * span * 1.1 * 2 * 0.55 * 1.82;
          const ya = y + 46 - 42 * (1 - Math.pow(2 * a - 1, 2)), yb = y + 46 - 42 * (1 - Math.pow(2 * b - 1, 2));
          grey.push([Math.min(xa, xb), Math.min(ya, yb) - 0.3, zz - 0.3, Math.max(xa, xb), Math.max(ya, yb) + 0.3, zz + 0.3]);
        }
      }
    }
  }

  // ---------- traffic ----------
  makeTraffic(assets) {
    const max = 700;
    const body = new THREE.BoxGeometry(1.9, 1.3, 4.4).translate(0, 0.9, 0);
    const cab = new THREE.BoxGeometry(1.7, 0.8, 2.2).translate(0, 1.9, 0.2);
    const car = new THREE.BufferGeometry();
    const merged = [body, cab];
    const pos = [], nor = [], part = [];
    merged.forEach((g, pi) => {
      const gi = g.toNonIndexed();
      pos.push(...gi.attributes.position.array); nor.push(...gi.attributes.normal.array);
      for (let i = 0; i < gi.attributes.position.count; i++) part.push(pi);
    });
    car.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    car.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    car.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
    const geo = new THREE.InstancedBufferGeometry().copy(car);
    this.carA = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); // axis, line, dir, speed
    this.carB = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); // offset, segStart, segLen, colourIdx
    geo.setAttribute('aCarA', this.carA);
    geo.setAttribute('aCarB', this.carB);
    geo.instanceCount = 0;
    this.carMax = max;
    const u = { ...G, tHeight: this.water.uniforms.tHeight, uHm: this.water.uniforms.uHm, uRiverHalf: { value: CITY.RIVER_HALF } };
    this.carUniforms = u;
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: /* glsl */ `
        ${CURVE_VERT_PARS}
        uniform float uTime, uRiverHalf;
        uniform sampler2D tHeight;
        uniform vec4 uHm;
        attribute vec4 aCarA, aCarB;
        attribute float aPart;
        varying vec3 vN, vCol;
        varying float vPart, vFront;
        float riverX(float z) { return 700.0 * sin(z / 2100.0 + 0.6) + 180.0 * sin(z / 640.0 + 1.3) + 500.0; }
        void main() {
          float along = mod(aCarB.x + uTime * aCarA.w, aCarB.z) + aCarB.y;
          float dir = aCarA.z;
          vec3 p = position;
          vec3 n = normal;
          if (dir < 0.0) { p.xz = -p.xz; n.xz = -n.xz; }
          vec3 w;
          if (aCarA.x < 0.5) { // road along z at x = line
            w = vec3(aCarA.y + dir * 3.2 + p.x, p.y, (dir > 0.0 ? along : -along) + p.z);
          } else { // road along x at z = line
            w = vec3((dir > 0.0 ? along : -along) + p.z, p.y, aCarA.y - dir * 3.2 - p.x);
            n = vec3(n.z, n.y, -n.x);
          }
          vec2 hmUv = (w.xz - uHm.xy) / uHm.z + 0.5;
          float gy = texture2D(tHeight, hmUv).r;
          bool river = abs(w.x - riverX(w.z)) < uRiverHalf + 6.0;
          if (river) gy = max(gy, 6.0);
          if (river && aCarA.x < 0.5) w.y -= 100.0;
          w.y += gy;
          vN = n;
          vPart = aPart;
          vFront = position.z;
          float ci = aCarB.w;
          vCol = ci < 1.0 ? vec3(0.8, 0.1, 0.08) : ci < 2.0 ? vec3(0.9, 0.9, 0.92) : ci < 3.0 ? vec3(0.05, 0.06, 0.08) : ci < 4.0 ? vec3(0.95, 0.75, 0.1) : vec3(0.2, 0.35, 0.7);
          vFogWorld = w;
          gl_Position = projectionMatrix * viewMatrix * curveWorld(vec4(w, 1.0));
        }`,
      fragmentShader: /* glsl */ `
        ${FOG_FRAG_PARS}
        uniform vec3 uSunColor;
        varying vec3 vN, vCol;
        varying float vPart, vFront;
        void main() {
          vec3 n = normalize(vN);
          float d = max(dot(n, uSunDir), 0.0);
          vec3 c = vPart > 0.5 ? vec3(0.1, 0.12, 0.15) : vCol;
          vec3 col = c * (d * uSunColor * 0.9 + 0.35);
          if (vPart < 0.5 && abs(vFront) > 2.15) col += vFront > 0.0 ? vec3(2.0, 0.2, 0.1) : vec3(2.5, 2.3, 1.8);
          gl_FragColor = vec4(applyFog(col, vFogWorld), 1.0);
        }`,
    });
    this.traffic = new THREE.Mesh(geo, mat);
    this.traffic.frustumCulled = false;
    this.scene.add(this.traffic);
  }

  rebuildTraffic(cam) {
    const P = CITY.PITCH, A = this.carA.array, B = this.carB.array;
    let n = 0;
    const R = 1300;
    const i0 = Math.round((cam.x - R) / P), i1 = Math.round((cam.x + R) / P);
    const j0 = Math.round((cam.z - R) / P), j1 = Math.round((cam.z + R) / P);
    const r = mulberry32(Math.floor(cam.x / 500) * 31 + Math.floor(cam.z / 500));
    const add = (axis, line, segStart, segLen) => {
      const cars = Math.floor(segLen / 90);
      for (let k = 0; k < cars && n < this.carMax; k++) {
        const dir = r() < 0.5 ? 1 : -1;
        A[n * 4] = axis; A[n * 4 + 1] = line; A[n * 4 + 2] = dir; A[n * 4 + 3] = 9 + r() * 7;
        B[n * 4] = r() * segLen; B[n * 4 + 1] = dir > 0 ? segStart : -(segStart + segLen); B[n * 4 + 2] = segLen; B[n * 4 + 3] = Math.floor(r() * 5);
        n++;
      }
    };
    for (let i = i0; i <= i1; i++) add(0, i * P, cam.z - R, 2 * R);
    for (let j = j0; j <= j1; j++) add(1, j * P, cam.x - R, 2 * R);
    this.traffic.geometry.instanceCount = n;
    this.carA.needsUpdate = this.carB.needsUpdate = true;
  }

  update(cam) {
    const ci = Math.floor(cam.x / CHS), cj = Math.floor(cam.z / CHS);
    const n = Math.ceil(this.radius / CHS);
    const want = [];
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      const cx = (ci + i + 0.5) * CHS, cz = (cj + j + 0.5) * CHS;
      const d = Math.hypot(cx - cam.x, cz - cam.z);
      if (d > this.radius + CHS) continue;
      const k = (ci + i) + ':' + (cj + j);
      if (!this.chunks.has(k)) want.push([d, ci + i, cj + j, k]);
    }
    want.sort((a, b) => a[0] - b[0]);
    const t0 = performance.now();
    for (const [, i, j, k] of want) {
      if (performance.now() - t0 > 6) break;
      this.chunks.set(k, { ...this.buildChunk(i, j), i, j });
    }
    for (const [k, c] of this.chunks) {
      const d = Math.hypot((c.i + 0.5) * CHS - cam.x, (c.j + 0.5) * CHS - cam.z);
      if (d > this.radius + CHS * 2.5) {
        this.group.remove(c.group);
        c.group.traverse((o) => { if (o.geometry && !this.adGeos.includes(o.geometry)) o.geometry.dispose(); });
        this.chunks.delete(k);
      }
    }
    if (cam.distanceTo(this.lastTraffic) > 400) { this.lastTraffic.copy(cam); this.rebuildTraffic(cam); }
  }

  // Collision boxes near a point
  forEachBox(x, z, r, fn) {
    const i0 = Math.floor((x - r) / CHS), i1 = Math.floor((x + r) / CHS);
    const j0 = Math.floor((z - r) / CHS), j1 = Math.floor((z + r) / CHS);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = this.chunks.get(i + ':' + j);
      if (!c) continue;
      for (const b of c.boxes) if (x + r > b[0] && x - r < b[3] && z + r > b[2] && z - r < b[5]) fn(b);
    }
  }

  // Tallest roof near a point, for spawning
  findRooftop(x, z) {
    this.update(new THREE.Vector3(x, 100, z));
    let best = null;
    this.forEachBox(x, z, 400, (b) => {
      const h = b[4];
      const w = Math.min(b[3] - b[0], b[5] - b[2]);
      if (w > 14 && h > 40 && h < 140 && (!best || Math.abs(h - 80) < Math.abs(best[4] - 80))) best = b;
    });
    return best;
  }
}
