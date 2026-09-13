/* ═══════════════════════════════════════════════════════════
   The city.

   Blocks on a street grid, built in tiles around the bird the same
   way the forest is. Buildings are instanced boxes; everything that
   makes them read as buildings — window grids, ledges, roof clutter,
   lit interiors — happens in the fragment shader from world-space
   position and face normal, so a 40-storey tower and a corner shop
   share one draw call and still have windows the same size.

   Streets are carved as gaps in the grid, filled with an asphalt
   strip and a trickle of instanced traffic.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { Noise, rng, clamp } from '../core/noise.js';

/* ── facades, generated in the shader ──────────────────────
   Every window on every tower comes from world position and face
   normal: no textures, no UV layout, no per-building work. A forty
   storey tower and a corner shop share one draw call and still get
   windows the same size, because the grid is in metres.

   At blue hour this is the whole look — dark massing, warm grid,
   and the rim light picking out the edges of the towers against the
   sky. The lights coming on is the thing that makes a city feel
   like somewhere people live rather than a heightfield of boxes. */

const FACADE_PARS = /* glsl */`
  uniform float uNight, uWinW, uWinH;
  uniform vec3  uWindowLit, uGlassDay, uConcrete, uRoof;
  varying vec3  vTint;

  float fHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

const FACADE_ALBEDO = /* glsl */`
  vec3 wp = vWorld;
  vec3 tint = vTint;

  if (abs(N.y) > 0.5) {
    // ── roof: gravel and plant rooms, seen from above more than anything
    //    else in this world, so it gets more than a flat colour ──
    vec2 cell = floor(wp.xz / 2.4);
    float grit = fHash(cell * 1.7) * 0.16 + fHash(wp.xz * 0.7) * 0.08;
    vec3 roof = uRoof * (0.8 + grit);
    vec2 big = floor(wp.xz / 11.0);
    roof = mix(roof, uRoof * 1.5, step(0.86, fHash(big * 2.3)));
    albedo = roof * (0.65 + tint.g * 0.6);
    ao = 0.9;
  } else {
    // ── facade: pick the axis this wall faces and lay a window grid on it ──
    float u = abs(N.x) > abs(N.z) ? wp.z : wp.x;
    float v = wp.y;
    vec2 cell = vec2(floor(u / uWinW), floor(v / uWinH));
    vec2 f = vec2(fract(u / uWinW), fract(v / uWinH));

    float glassX = smoothstep(0.15, 0.23, f.x) * (1.0 - smoothstep(0.77, 0.85, f.x));
    float glassY = smoothstep(0.20, 0.29, f.y) * (1.0 - smoothstep(0.75, 0.83, f.y));
    float glass = glassX * glassY;

    // Ground floors are shopfronts: full-height glazing, no grid.
    float street = 1.0 - smoothstep(4.0, 9.0, wp.y);
    glass = mix(glass, glassX, street);

    float lit = step(1.0 - uNight * 0.62, fHash(cell + vec2(N.x * 7.0, N.z * 13.0)));
    float warmth = 0.55 + 0.45 * fHash(cell * 3.1 + 5.0);

    vec3 wall = uConcrete * tint * (0.82 + 0.18 * fHash(cell * 0.31));
    // Floor slabs, so the storeys read from a long way off.
    wall *= 1.0 - smoothstep(0.93, 1.0, f.y) * 0.38;

    // Unlit glass is dark: at dusk most of a facade is black mirror, and the
    // contrast against the few lit windows is the entire effect.
    vec3 glassCol = mix(uGlassDay, uWindowLit * warmth * 0.5, lit * uNight);
    albedo = mix(wall, glassCol * 0.5, glass);

    // Lit windows are their own light source — but a restrained one. Bloom
    // multiplies whatever it is given, and a city where every window is at
    // full emissive stops being a city and becomes a wall of light with
    // buildings somewhere behind it.
    emissive += uWindowLit * warmth * glass * lit * uNight * 0.42;

    // Streets are in shadow long before the tops of the towers are.
    ao = mix(0.55, 1.0, smoothstep(0.0, 60.0, wp.y));
  }
`;

export class City {
  /**
   * @param {object} opts
   * @param {(x,z)=>number} opts.height        ground field
   * @param {number} opts.block                block pitch including street
   * @param {number} opts.street               street width
   * @param {(x,z)=>number} opts.skyline       0..1 height multiplier field
   * @param {(x,z)=>boolean} opts.isPark       blocks to leave green
   * @param {(x,z)=>boolean} opts.isWater      blocks to leave empty
   */
  constructor(style, opts = {}) {
    this.style = style;
    this.height = opts.height;
    this.block = opts.block ?? 96;
    this.street = opts.street ?? 26;
    this.tileBlocks = opts.tileBlocks ?? 4;
    this.tile = this.block * this.tileBlocks;
    this.radius = opts.radius ?? 1500;
    this.seed = opts.seed ?? 9090;
    this.budget = opts.budget ?? 1;
    this.maxHeight = opts.maxHeight ?? 210;
    this.skyline = opts.skyline ?? (() => 0.5);
    this.isPark = opts.isPark ?? (() => false);
    this.isWater = opts.isWater ?? (() => false);
    this.noise = new Noise(this.seed);

    this.group = new THREE.Group();
    this.tiles = new Map();
    this.queue = [];
    this.wanted = new Set();
    this._last = new THREE.Vector3(1e9, 0, 1e9);

    this.uniforms = {
      uNight:     { value: opts.night ?? 0.25 },
      uWinW:      { value: opts.windowW ?? 3.4 },
      uWinH:      { value: opts.windowH ?? 3.9 },
      uWindowLit: { value: new THREE.Color(opts.windowLit ?? '#ffd9a0') },
      uGlassDay:  { value: new THREE.Color(opts.glassDay ?? '#8fa8bd') },
    };

    this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.boxGeo.translate(0, 0.5, 0);           // pivot at the base
    this.facadeMat = this._facadeMaterial(opts);
    this.roadMat = this._roadMaterial(opts);
    this.carMat = this._carMaterial();
    this.carGeo = new THREE.BoxGeometry(1.9, 1.5, 4.4);
    this.carGeo.translate(0, 0.75, 0);

    this.cars = null;
    this._carState = [];
    this.stats = { tiles: 0, buildings: 0 };
  }

  _facadeMaterial(opts) {
    const p = opts.palette;
    this.facadeUniforms = {
      uNight: { value: opts.night ?? p.night ?? 0.55 },
      uWinW: { value: opts.windowW ?? 3.4 },
      uWinH: { value: opts.windowH ?? 3.9 },
      uWindowLit: { value: new THREE.Color(opts.windowLit ?? '#ffc275') },
      uGlassDay: { value: new THREE.Color(opts.glassDay ?? '#243449') },
      uConcrete: { value: new THREE.Color(opts.concrete ?? '#4c5162') },
      uRoof: { value: new THREE.Color(opts.roof ?? '#2b2f3c') },
    };
    return this.style.make({
      name: 'facade',
      pars: FACADE_PARS,
      vertexPars: 'varying vec3 vTint;',
      vertexHook: `
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #else
          vTint = vec3(1.0);
        #endif
      `,
      albedo: FACADE_ALBEDO,
      extra: this.facadeUniforms,
    });
  }

  _roadMaterial(opts) {
    return this.style.make({
      name: 'road',
      pars: 'uniform vec3 uAsphalt, uPaint;\nuniform float uBlock;',
      albedo: `
        float grit = sNoise(vWorld.xz * 1.4) * 0.12;
        albedo = uAsphalt * (0.9 + grit);
        // Lane markings, laid on the same grid the blocks were built on.
        vec2 g = abs(fract(vWorld.xz / uBlock + 0.5) - 0.5);
        float line = smoothstep(0.492, 0.5, max(g.x, g.y));
        albedo = mix(albedo, uPaint, line * 0.30);
        ao = 0.7;
      `,
      extra: {
        uAsphalt: { value: new THREE.Color(opts.asphalt ?? '#20242e') },
        uPaint: { value: new THREE.Color(opts.paint ?? '#6a6350') },
        uBlock: { value: opts.block ?? 96 },
      },
    });
  }

  _carMaterial() {
    return this.style.make({
      name: 'car',
      pars: 'varying vec3 vTint;',
      vertexPars: 'varying vec3 vTint;',
      vertexHook: `
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #else
          vTint = vec3(0.8);
        #endif
      `,
      albedo: `
        albedo = vTint * 0.5;
        // Headlights and tail lights: at dusk this is most of what you see
        // of the traffic from three hundred metres up.
        float front = smoothstep(0.2, 0.9, -N.z);
        float back = smoothstep(0.2, 0.9, N.z);
        emissive += vec3(1.0, 0.93, 0.78) * front * 1.6;
        emissive += vec3(1.0, 0.18, 0.10) * back * 0.9;
      `,
    });
  }

  /* ── tiles ──────────────────────────────────────────────── */

  update(camPos, dt) {
    if (camPos.distanceToSquared(this._last) > this.tile * this.tile * 0.15) {
      this._last.copy(camPos);
      this._select(camPos);
    }
    this._drain();
    this._driveTraffic(camPos, dt);
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
      if (!this.wanted.has(key)) { this._destroy(tile); this.tiles.delete(key); }
    }
    this.stats.tiles = this.tiles.size;
  }

  _drain() {
    if (!this.queue.length) return;
    this.queue.sort((a, b) => a.d - b.d);
    for (let n = 0; n < this.budget && this.queue.length; n++) {
      const job = this.queue.shift();
      if (!this.wanted.has(job.key) || this.tiles.has(job.key)) continue;
      this.tiles.set(job.key, this._buildTile(job.gx, job.gz));
    }
  }

  _buildTile(gx, gz) {
    const B = this.block, S = this.street, nb = this.tileBlocks;
    const r = rng(this.seed ^ (gx * 374761393) ^ (gz * 668265263));
    const H = this.height;
    const usable = B - S;

    const boxes = [];       // [mat4, color]
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    let lo = Infinity, hi = -Infinity;

    for (let bj = 0; bj < nb; bj++) {
      for (let bi = 0; bi < nb; bi++) {
        const bx = (gx * nb + bi) * B, bz = (gz * nb + bj) * B;
        const cx = bx + B / 2, cz = bz + B / 2;
        if (this.isWater(cx, cz)) continue;
        if (this.isPark(cx, cz)) continue;

        const ground = H(cx, cz);
        const tall = this.skyline(cx, cz);

        // Split the block into 1–4 lots so towers sit beside low-rise.
        const lots = r() < 0.42 ? 1 : (r() < 0.7 ? 2 : 4);
        const grid = lots === 1 ? 1 : 2;
        for (let lj = 0; lj < grid; lj++) {
          for (let li = 0; li < grid; li++) {
            if (lots === 2 && (li + lj) % 2 === 1) continue;
            const lw = usable / grid, ld = usable / grid;
            const inset = 1.2 + r() * 2.6;
            const w = Math.max(6, lw - inset * 2);
            const d = Math.max(6, ld - inset * 2);
            const x = bx + S / 2 + li * lw + lw / 2;
            const z = bz + S / 2 + lj * ld + ld / 2;

            // Height: skyline field × lot lottery, with a floor-count quantum
            // so the window grid always lands on a whole storey.
            const base = 9 + Math.pow(r(), 2.4) * this.maxHeight * (0.25 + tall * 1.15);
            const storeys = Math.max(2, Math.round(base / this.uniforms.uWinH.value));
            const h = storeys * this.uniforms.uWinH.value;

            dummy.position.set(x, ground - 1.5, z);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(w, h, d);
            dummy.updateMatrix();

            // Real cities are not one colour. Most buildings are pale stone or
            // concrete, a minority are brick, glass or painted, and the spread
            // is what stops a skyline reading as a bar chart.
            const roll = r();
            let g, hue, sat;
            if (roll < 0.5)      { g = 0.30 + r() * 0.26; hue = 0.09; sat = 0.05 + r() * 0.05; }
            else if (roll < 0.7) { g = 0.16 + r() * 0.14; hue = 0.04; sat = 0.26 + r() * 0.18; }
            else if (roll < 0.86){ g = 0.20 + r() * 0.18; hue = 0.56; sat = 0.10 + r() * 0.12; }
            else                 { g = 0.12 + r() * 0.12; hue = 0.10; sat = 0.03 + r() * 0.04; }
            col.setHSL(hue, sat, g);
            boxes.push([dummy.matrix.clone(), col.clone()]);

            // Setback cap on the tallest towers.
            if (h > 90 && r() < 0.55) {
              const cw = w * (0.55 + r() * 0.2), cd = d * (0.55 + r() * 0.2);
              const ch = 6 + r() * 22;
              dummy.position.set(x, ground - 1.5 + h, z);
              dummy.scale.set(cw, ch, cd);
              dummy.updateMatrix();
              boxes.push([dummy.matrix.clone(), col.clone()]);
            }

            if (ground < lo) lo = ground;
            if (ground + h > hi) hi = ground + h;
          }
        }
      }
    }

    const meshes = [];
    if (boxes.length) {
      const im = new THREE.InstancedMesh(this.boxGeo, this.facadeMat, boxes.length);
      for (let i = 0; i < boxes.length; i++) {
        im.setMatrixAt(i, boxes[i][0]);
        im.setColorAt(i, boxes[i][1]);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      const c = new THREE.Vector3((gx + 0.5) * this.tile, (lo + hi) / 2, (gz + 0.5) * this.tile);
      im.boundingSphere = new THREE.Sphere(c, Math.hypot(this.tile * 0.71, (hi - lo) / 2) * 1.2);
      im.computeBoundingSphere = () => {};
      im.castShadow = true;
      this.group.add(im);
      meshes.push(im);
      this.stats.buildings += boxes.length;
    }

    // Street surface: one slab per tile, sunk just under the building bases.
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(this.tile, this.tile, 1, 1),
      this.roadMat
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set((gx + 0.5) * this.tile, H((gx + 0.5) * this.tile, (gz + 0.5) * this.tile) - 1.55, (gz + 0.5) * this.tile);
    road.receiveShadow = true;
    road.updateMatrix();
    road.matrixAutoUpdate = false;
    this.group.add(road);
    meshes.push(road);

    return meshes;
  }

  /* ── traffic ────────────────────────────────────────────── */

  /** One pooled InstancedMesh of cars, recycled around the bird. */
  initTraffic(count = 140, opts = {}) {
    this.cars = new THREE.InstancedMesh(this.carGeo, this.carMat, count);
    this.cars.frustumCulled = false;
    this.cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.Color();
    const r = rng(this.seed + 5);
    this._carState = [];
    for (let i = 0; i < count; i++) {
      this._carState.push({
        axis: r() < 0.5 ? 'x' : 'z',
        lane: 0, along: 0, speed: 9 + r() * 13, dir: r() < 0.5 ? -1 : 1, live: false,
      });
      const hue = r();
      col.setHSL(hue < 0.7 ? 0.0 : hue, hue < 0.7 ? 0.0 : 0.5, 0.15 + r() * 0.6);
      this.cars.setColorAt(i, col);
    }
    if (this.cars.instanceColor) this.cars.instanceColor.needsUpdate = true;
    this.carRange = opts.range ?? 420;
    this.group.add(this.cars);
    return this.cars;
  }

  _driveTraffic(camPos, dt) {
    if (!this.cars) return;
    const B = this.block, R = this.carRange;
    const dummy = new THREE.Object3D();
    const H = this.height;
    for (let i = 0; i < this._carState.length; i++) {
      const c = this._carState[i];
      if (!c.live) {
        // Spawn on a street line somewhere in the ring around the bird.
        const a = Math.random() * Math.PI * 2;
        const rad = R * (0.35 + Math.random() * 0.65);
        const px = camPos.x + Math.cos(a) * rad;
        const pz = camPos.z + Math.sin(a) * rad;
        if (c.axis === 'x') { c.lane = Math.round(pz / B) * B; c.along = px; }
        else                { c.lane = Math.round(px / B) * B; c.along = pz; }
        c.live = true;
      }
      c.along += c.speed * c.dir * dt;

      const x = c.axis === 'x' ? c.along : c.lane + (c.dir > 0 ? 4 : -4);
      const z = c.axis === 'x' ? c.lane + (c.dir > 0 ? -4 : 4) : c.along;
      if (Math.hypot(x - camPos.x, z - camPos.z) > R * 1.25) { c.live = false; }

      dummy.position.set(x, H(x, z) - 1.4, z);
      dummy.rotation.set(0, c.axis === 'x' ? (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (c.dir > 0 ? 0 : Math.PI), 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      this.cars.setMatrixAt(i, dummy.matrix);
    }
    this.cars.instanceMatrix.needsUpdate = true;
  }

  _destroy(meshes) {
    for (const m of meshes) {
      this.group.remove(m);
      if (m.isInstancedMesh) { m.dispose(); this.stats.buildings -= m.count; }
      else m.geometry.dispose();
    }
  }

  dispose() {
    for (const t of this.tiles.values()) this._destroy(t);
    this.tiles.clear();
    this.boxGeo.dispose(); this.carGeo.dispose();
    this.facadeMat.dispose(); this.roadMat.dispose(); this.carMat.dispose();
    this.cars?.dispose();
  }
}

export { clamp };
