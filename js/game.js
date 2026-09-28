// Game session: builds a biome, spawns the bird and runs the simulation + render loop.
import * as THREE from 'three';
import { G } from './core/shaderPatch.js';
import { loadAssets } from './core/assets.js';
import { WorkerPool } from './core/workers.js';
import { Post } from './core/post.js';
import { BIOMES } from './world/biomes.js';
import { createField, normalAt, TREE } from './world/fields.js';
import { Terrain, createTerrainMaterial } from './world/terrain.js';
import { Water } from './world/water.js';
import { createSky } from './world/sky.js';
import { Clouds } from './world/clouds.js';
import { Trees } from './world/trees.js';
import { City } from './world/city.js';
import { Thermals, Flocks, Particles, CoastSet, Waterfalls } from './world/extras.js';
import { Titans } from './world/titans.js';
import { Tricks, Rings } from './gameplay.js';
import { BIRDS } from './flight/birds.js';
import { BirdBody } from './flight/physics.js';
import { Head } from './flight/head.js';
import { Wings } from './flight/wings.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Game {
  constructor(renderer, ui, input, audio) {
    this.renderer = renderer;
    this.ui = ui;
    this.input = input;
    this.audio = audio;
    this.running = false;
    this.paused = false;
  }

  async start(birdId, quality, onProgress) {
    const cfg = BIRDS[birdId];
    const biome = BIOMES[cfg.biome];
    this.cfg = cfg; this.biome = biome; this.quality = quality;
    const renderer = this.renderer;
    const scene = (this.scene = new THREE.Scene());
    const camera = (this.camera = new THREE.PerspectiveCamera(cfg.cam.fov, innerWidth / innerHeight, 0.5, 150000));

    const assets = (this.assets = await loadAssets(renderer, biome.id, (p) => onProgress(p * 0.7), birdId));
    onProgress(0.72);

    // ---- lighting / atmosphere ----
    const sunDir = assets.sunDir.clone();
    if (sunDir.y < 0.08) { sunDir.y = 0.08; sunDir.normalize(); }
    G.uSunDir.value.copy(sunDir);
    const sunColor = new THREE.Color(1, 0.97, 0.92).lerp(assets.sunColor || new THREE.Color(1, 1, 1), 0.7);
    G.uSunColor.value.copy(sunColor).multiplyScalar(1.1);
    const ft = biome.fogTint;
    const hz = assets.skyInfo.horizon.clone();
    const hl = hz.r * 0.2126 + hz.g * 0.7152 + hz.b * 0.0722;
    G.uFogColor.value.copy(hz).lerp(new THREE.Color(hl, hl, hl), 0.3).multiply(new THREE.Color(ft[0], ft[1], ft[2]));
    G.uFogSunColor.value.copy(assets.skyInfo.sunHorizon).multiplyScalar(1.1);
    G.uFogDensity.value = biome.fog.density;
    G.uFogFalloff.value = biome.fog.falloff;
    G.uHaze.value = biome.fog.haze;
    G.uMist.value = biome.fog.mist;
    G.uMistTop.value = biome.fog.mistTop;
    G.uFogBase.value = 0;
    G.uCurve.value = 1 / (2 * biome.curvatureR);

    scene.environment = assets.envMap;
    scene.environmentIntensity = biome.envIntensity;
    const sun = (this.sun = new THREE.DirectionalLight(sunColor, biome.sunIntensity));
    sun.position.copy(sunDir).multiplyScalar(1000);
    scene.add(sun, sun.target);
    // sky fill: lifts shaded faces (the baked sky-visibility term still darkens canyons and hollows)
    const zen = assets.skyInfo.zenith.clone(); const zl = Math.max(zen.r, zen.g, zen.b, 1e-3);
    this.hemi = new THREE.HemisphereLight(new THREE.Color(zen.r / zl, zen.g / zl, zen.b / zl).lerp(new THREE.Color(1, 1, 1), 0.35), new THREE.Color(biome.bounce || 0x665544), biome.hemi ?? 0.9);
    scene.add(this.hemi);
    if (quality === 'high') {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const s = sun.shadow.camera;
      s.left = -160; s.right = 160; s.top = 160; s.bottom = -160; s.near = 1; s.far = 3000;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.6;
    } else {
      renderer.shadowMap.enabled = false;
    }

    this.sky = createSky(assets.sky, biome.skyBoost);
    this.sky.layers.enable(1);
    this.sky.scale.setScalar(100000);
    scene.add(this.sky);

    // ---- world ----
    const field = (this.field = createField(biome.id));
    this.pool = new WorkerPool(quality === 'low' ? 2 : 3, biome.id, 1337, sunDir);
    this.terrain = new Terrain(scene, this.pool, createTerrainMaterial(assets.tex, biome), { viewDist: (quality === 'low' ? 22000 : quality === 'medium' ? 34000 : 48000) * (biome.id === 'city' ? 0.4 : 1) });
    this.water = new Water(scene, assets, biome, this.pool);
    if (biome.id !== 'mountains') this.water.setupReflection(renderer, quality);
    this.clouds = new Clouds(scene, assets, biome.clouds, quality);
    this.trees = new Trees(scene, renderer, assets, this.pool, field, biome, quality);
    this.particles = new Particles(scene);
    this.wind = new THREE.Vector3(...biome.wind);
    this.thermals = new Thermals(biome.thermals, field, this.wind);
    this.flocks = new Flocks(scene, assets, biome, this.thermals, field);
    if (biome.id === 'city') this.city = new City(scene, field, assets, this.water, quality);
    if (field.giant) this.titans = new Titans(scene, field, assets, quality, sunDir);

    // ---- bird ----
    this.body = new BirdBody(cfg);
    this.head = new Head(camera, cfg);
    this.wings = new Wings(cfg, assets.envMap, assets.models.hawk_hi);
    this.wingCam = new THREE.PerspectiveCamera(cfg.cam.fov, innerWidth / innerHeight, 0.03, 60); // wings get their own near plane
    this.spawn();
    if (biome.id === 'coast') { this.coast = new CoastSet(scene, field, assets, this.water, this.particles, this.audio); this.coast.placeLighthouse(this.body.pos.x, this.body.pos.z); }
    if (biome.id === 'forest') this.falls = new Waterfalls(scene, field, assets, this.particles, this.body.pos.x, this.body.pos.z);

    this.post = new Post(renderer, quality);
    const pp = this.post.params;
    pp.uExposure.value = biome.exposure;
    pp.uSat.value = biome.sat;
    pp.uContrast.value = biome.contrast;
    pp.uFish.value = cfg.cam.fish;
    pp.uCloudColor.value.copy(G.uFogColor.value).lerp(new THREE.Color(1, 1, 1), 0.5);
    this.resScale = { low: 0.7, medium: 0.85, high: 1 }[quality];
    this.maxPR = { low: 1.0, medium: 1.5, high: 2 }[quality];
    this.resize();

    // Pre-warm streaming around the spawn so the first frame isn't empty.
    const cam = this.body.pos;
    const t0 = performance.now();
    while (performance.now() - t0 < 12000) {
      this.terrain.update(cam);
      this.trees.update(cam);
      this.titans?.update(cam);
      this.water.update(cam, 0);
      this.city?.update(cam);
      const p = this.terrain.desired.length ? this.terrain.desired.filter((l) => this.terrain.chunks.get(l.key)?.state === 'ready').length / this.terrain.desired.length : 0;
      onProgress(0.72 + p * 0.26);
      if (this.terrain.ready && this.water.hm.data) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    // compile shaders up front
    this.head.update(0.016, this.body, this.state());
    renderer.compile(scene, camera);
    onProgress(1);

    this.tricks = new Tricks(this);
    this.rings = new Rings(this.scene, this);
    this.rings.enabled = this.ringsEnabled !== false;
    this.score = 0; this.combo = 1; this.comboT = 0;
    this.diveMax = 0; this.thermalGain = 0; this.thermalStart = null;
    this.time = 0;
    this.stun = 0;
    this.underT = 0;
    this.nearCooldown = 0;
    this.lastSafe = this.body.pos.clone();
    this.frames = 0; this.fpsAcc = 0;
    this.running = true;
    this.clock = new THREE.Timer();
    this.ui.hint(this.body.mode === 'perched' ? 'Tap FLAP to take off' : 'Steer with the left stick · FLAP to climb · DIVE to tuck', 6);
  }

  // ---------------- spawn ----------------
  spawn() {
    const f = this.field, b = this.body, id = this.biome.id;
    let x = 0, z = 0, yaw = 0, y = 0, fly = false;
    if (id === 'city') {
      // perch on the street-side edge of a rooftop, looking out over the street
      const roof = this.city.findRooftop(80, 80);
      if (roof) { x = (roof[0] + roof[3]) / 2; z = roof[5] - 0.6; y = roof[4]; yaw = Math.PI; }
      else { x = 60; z = 60; y = 80; fly = true; }
    } else if (id === 'coast') {
      // a cliff edge above the sea, facing south (-z) over the drop
      let best = null;
      for (let i = -40; i <= 40; i++) {
        const px = i * 30;
        const sh = f.shore(px);
        for (let s = 5; s <= 160; s += 3) {
          const pz = sh + s, h = f.height(px, pz);
          const ahead = f.height(px, pz - 25);
          if (h > 120 && h - ahead > 30) {
            const score = h - Math.abs(px) * 0.03;
            if (!best || score > best[3]) best = [px, pz, h, score];
            break;
          }
        }
      }
      if (best) { [x, z, y] = best; } else { x = 0; z = f.shore(0) + 60; y = f.height(x, z); }
      yaw = 0;
    } else if (id === 'forest') {
      // start inside a great canyon, flying along it below the rim
      let best = null;
      for (let k = 0; k < 3000 && !best; k++) {
        const a = k * 2.399, r = 100 + k * 12;
        const px = Math.cos(a) * r, pz = Math.sin(a) * r;
        const I = f.info(px, pz);
        if (I.cStr > 0.9 && I.cr < 0.006 && I.h > 0 && I.mMask < 0.2) best = { x: px, z: pz, h: I.h };
      }
      if (!best) best = { x: 0, z: 0, h: f.height(0, 0) };
      x = best.x; z = best.z; y = Math.max(best.h, 0) + 520;
      // fly along the canyon: pick the heading that stays deepest and clearest over the next 1.5 km
      let bestS = -1e9;
      for (let d = 0; d < 24; d++) {
        const ang = (d / 24) * Math.PI * 2;
        let score = 0;
        for (let dist = 150; dist <= 1500; dist += 150) {
          const px = x + Math.sin(ang) * dist, pz = z - Math.cos(ang) * dist;
          score -= f.info(px, pz).cr * 4000 + Math.max(0, f.height(px, pz) - (y - 120)) * 2;
        }
        if (score > bestS) { bestS = score; yaw = -ang; }
      }
      fly = true;
    } else {
      // mountains: start airborne over open terrain
      const alt = id === 'mountains' ? 1400 : 140;
      let best = null;
      for (let k = 0; k < 600; k++) {
        const a = k * 2.399, r = 50 + k * 8;
        const px = Math.cos(a) * r, pz = Math.sin(a) * r;
        const h = f.height(px, pz);
        const score = id === 'mountains' ? -Math.abs(h - 1600) - r * 0.05 : (h < 3 ? 400 : 0) - r * 0.08 + (h < 60 ? 100 : 0);
        if (!best || score > best.s) best = { s: score, x: px, z: pz, h };
      }
      x = best.x; z = best.z;
      y = Math.max(best.h, 0) + alt;
      if (id === 'mountains') y = Math.max(y, 2600);
      // face the most open flight path (lowest terrain over the next ~1.5 km), preferring a big view beyond
      let bestDir = 0, bestScore = -1e9;
      for (let d = 0; d < 24; d++) {
        const ang = (d / 24) * Math.PI * 2;
        let near = -1e9, far = -1e9;
        for (let dist = 100; dist <= 1500; dist += 100) near = Math.max(near, f.height(x + Math.sin(ang) * dist, z - Math.cos(ang) * dist));
        for (const dist of [2500, 3500, 5000]) far = Math.max(far, f.height(x + Math.sin(ang) * dist, z - Math.cos(ang) * dist));
        const score = -Math.max(0, near - (y - 60)) * 5 - near * 0.5 + far * 0.2;
        if (score > bestScore) { bestScore = score; bestDir = ang; }
      }
      yaw = -bestDir;
      fly = true;
    }
    b.setHeading(yaw, 0);
    this.perchYaw = yaw;
    if (fly) {
      b.pos.set(x, y, z);
      const { fwd } = b.axes();
      b.vel.copy(fwd).multiplyScalar(this.cfg.vBest);
      b.mode = 'flying';
    } else {
      b.pos.set(x, y + 0.3, z);
      b.vel.set(0, 0, 0);
      b.mode = 'perched';
    }
  }

  // ---------------- environment for physics ----------------
  state() {
    const b = this.body;
    const g = this.groundH ?? 0;
    return { speed: b.vel.length(), agl: b.pos.y - g };
  }

  computeWind(dt) {
    const b = this.body, t = this.time;
    const f = this.field;
    const gh = f.height(b.pos.x, b.pos.z);
    this.groundH = gh;
    const gust = 1 + 0.35 * Math.sin(t * 0.37) * Math.sin(t * 1.13 + 1.7);
    const w = this.wind.clone().multiplyScalar(gust);
    const agl = b.pos.y - Math.max(gh, 0);
    w.multiplyScalar(clamp(0.3 + agl / 60, 0.3, 1));
    // ridge lift: wind deflected upwards by rising ground just downwind of the bird (in front of a
    // windward face) or directly under it (over the slope). Strong below the crest, fading above it.
    const ws = Math.hypot(this.wind.x, this.wind.z) * gust;
    const wdx = this.wind.x / (ws || 1) * gust, wdz = this.wind.z / (ws || 1) * gust;
    const h0 = Math.max(gh, 0);
    const hd1 = f.height(b.pos.x + wdx * 90, b.pos.z + wdz * 90), hd2 = f.height(b.pos.x + wdx * 240, b.pos.z + wdz * 240);
    const crest = Math.max(h0, hd1, hd2);
    const rise = Math.max(0, (Math.max(hd1, hd2) - h0) / 240);
    const n = normalAt(f, b.pos.x, b.pos.z, 20);
    const over = Math.max(0, -(wdx * n[0] + wdz * n[2])); // windward steepness under the bird
    const hf = 1 - THREE.MathUtils.smoothstep(b.pos.y, crest - 20, crest + 260);
    let ridge = ws * Math.min(1.6, Math.max(rise * 1.7, over * 1.3)) * this.biome.ridgeLift * hf;
    // gentle sink in the lee of ridges
    const lee = Math.max(0, (wdx * n[0] + wdz * n[2])) * ws * 0.25 * Math.exp(-agl / 200);
    ridge = Math.min(10, ridge) - lee;
    let up = ridge;
    this.ridge = Math.max(0, ridge);
    // thermals
    this.thermal = this.thermals.updraft(b.pos, Math.max(gh, 0));
    up += this.thermal;
    w.y += up;
    this.updraft = up;
    return w;
  }

  // ---------------- collisions ----------------
  surfaceHeight(x, z) {
    const g = this.field.height(x, z);
    return g;
  }

  handleContacts(dt) {
    const b = this.body, cfg = this.cfg;
    const p = b.pos;
    if (b.mode !== 'flying' && b.mode !== 'underwater') return;
    const gh = this.field.height(p.x, p.z);
    const waterY = this.water.surfaceAt(p.x, p.z, this.time);
    const hasWater = gh < 0.3;
    const speed = b.vel.length();

    // ----- water -----
    if (b.mode === 'underwater') {
      this.underT -= dt;
      if (this.underT <= 0 || p.y > waterY) {
        b.mode = 'flying';
        p.y = waterY + 0.5;
        b.vel.set(b.vel.x * 0.5, 7.5, b.vel.z * 0.5);
        b.takeoffTimer = 1.2; b.flapAmt = 1;
        this.surfaceCool = 1.5;
        this.splash(p, 1.4);
        if (Math.random() < 0.65) this.award('FISH!', 150);
      } else if (Math.random() < 0.5) {
        this.particles.emit(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, -0.5, (Math.random() - 0.5) * 1.5)), new THREE.Vector3(0, 2, 0), new THREE.Color(0.8, 0.95, 1), 0.6, 0.15, 1.2, -3, 1, 0.3);
      }
      return;
    }
    this.surfaceCool = Math.max(0, (this.surfaceCool || 0) - dt);
    if (hasWater && p.y < waterY + 0.15 && this.surfaceCool > 0) {
      // just surfaced: ride up off the water instead of plunging straight back in
      p.y = waterY + 0.15;
      if (b.vel.y < 1.5) b.vel.y = 1.5;
      return;
    }
    if (hasWater && p.y < waterY + 0.15) {
      const steep = b.vel.y < -4 && (b.tuck > 0.4 || b.vel.y < -9);
      if (cfg.id === 'seagull' && steep) {
        b.mode = 'underwater';
        this.underT = 1.3;
        this.splash(p, 2.2);
        this.head.shake = 0.08;
        this.award('PLUNGE', Math.round(speed * 4));
        return;
      }
      if (speed < cfg.vStall * 1.6 || cfg.id === 'seagull') {
        this.settle('water', waterY);
        this.splash(p, 0.6);
        return;
      }
      // skip off the surface
      this.splash(p, 1);
      p.y = waterY + 0.2;
      b.vel.y = Math.abs(b.vel.y) * 0.3 + 1;
      b.vel.multiplyScalar(0.6);
      this.hurt(0.4);
      return;
    }

    // ----- terrain -----
    const clearance = 0.25;
    if (p.y < gh + clearance) {
      const n = normalAt(this.field, p.x, p.z, 1.5);
      this.contactSurface(new THREE.Vector3(n[0], n[1], n[2]), gh + clearance, speed);
      return;
    }

    // ----- trees -----
    if (this.trees) {
      let brush = 0;
      this.trees.forEachTree(p.x, p.z, 26, (tx, ty, tz, s, rot, type) => {
        const h = this.trees.treeHeight(type, s);
        const rel = p.y - ty;
        if (rel < 0 || rel > h) return;
        const dx = p.x - tx, dz = p.z - tz;
        const d = Math.hypot(dx, dz);
        const trunkR = h * 0.02 + 0.3;
        if (d < trunkR && rel < h * 0.92) {
          const n = new THREE.Vector3(dx, 0, dz).normalize();
          this.contactSurface(n, null, speed, new THREE.Vector3(tx + n.x * (trunkR + 0.3), p.y, tz + n.z * (trunkR + 0.3)));
          return;
        }
        // crown volume
        const spec = { 0: [0.4, 0.13], 1: [0.1, 0.24], 2: [0.55, 0.22], 3: [0.45, 0.3] }[type];
        const t = (rel / h - spec[0]) / (1 - spec[0]);
        if (t < 0 || t > 1) return;
        const cr = type === TREE.BROADLEAF ? spec[1] * h * Math.sin(Math.PI * t) : spec[1] * h * (1 - t);
        if (d < cr) brush = Math.max(brush, 1 - d / cr);
        else if (d < cr + 3 && speed > 15) this.nearMiss('THREAD', 0.6);
      });
      if (brush > 0) {
        b.vel.multiplyScalar(Math.exp(-dt * (2 + brush * 5)));
        this.head.shake = Math.max(this.head.shake, 0.012 * brush);
        if (Math.random() < 0.6) this.particles.emit(p.clone().add(b.vel.clone().multiplyScalar(0.05)), b.vel.clone().multiplyScalar(-0.2), new THREE.Color(0.25, 0.4, 0.18), 0.9, 0.12, 1.5, 2, 1.2, 2);
      }
    }

    // ----- titan trees: fly under and between the limbs, brush through the leaf clumps -----
    if (this.titans) {
      const T = this.titans.collide(p, 0.35);
      if (T.hit) { this.contactSurface(T.hit.n, T.hit.landY, speed, T.hit.push); return; }
      if (T.brush > 0) {
        b.vel.multiplyScalar(Math.exp(-dt * (1.5 + T.brush * 4)));
        this.head.shake = Math.max(this.head.shake, 0.015 * T.brush);
        for (let i = 0; i < 2; i++) this.particles.emit(p.clone().add(b.vel.clone().multiplyScalar(0.06)), b.vel.clone().multiplyScalar(-0.15), new THREE.Color(0.3, 0.45, 0.15), 0.9, 0.18, 2, 1.5, 1.2, 3);
        if (T.brush > 0.2 && speed > 14) this.nearMiss('THROUGH THE CANOPY', 1.5);
      } else if (T.near < 7 && speed > 15) this.nearMiss('THREAD', 1.2);
    }

    // ----- buildings -----
    if (this.city) {
      const r = 0.35;
      let near = 0, sides = 0;
      this.city.forEachBox(p.x, p.z, 8, (bx) => {
        const inX = p.x > bx[0] - r && p.x < bx[3] + r, inZ = p.z > bx[2] - r && p.z < bx[5] + r, inY = p.y > bx[1] - r && p.y < bx[4] + r;
        if (inX && inY && inZ) {
          // push out along the axis of least penetration
          const pen = [p.x - (bx[0] - r), bx[3] + r - p.x, p.y - (bx[1] - r), bx[4] + r - p.y, p.z - (bx[2] - r), bx[5] + r - p.z];
          let k = 0; for (let i = 1; i < 6; i++) if (pen[i] < pen[k]) k = i;
          const n = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]][k];
          const target = p.clone();
          if (k === 0) target.x = bx[0] - r; if (k === 1) target.x = bx[3] + r; if (k === 2) target.y = bx[1] - r;
          if (k === 3) target.y = bx[4] + r; if (k === 4) target.z = bx[2] - r; if (k === 5) target.z = bx[5] + r;
          this.contactSurface(new THREE.Vector3(...n), k === 3 ? bx[4] + 0.05 : null, speed, target);
        } else {
          // distance to box for near-miss scoring
          const dx = Math.max(bx[0] - p.x, 0, p.x - bx[3]), dy = Math.max(bx[1] - p.y, 0, p.y - bx[4]), dz = Math.max(bx[2] - p.z, 0, p.z - bx[5]);
          const d = Math.hypot(dx, dy, dz);
          if (d < 5 && speed > 14) { near++; if (dx > 0 && dy === 0) sides |= p.x < bx[0] ? 1 : 2; if (dz > 0 && dy === 0) sides |= p.z < bx[2] ? 4 : 8; }
        }
      });
      if (near && speed > 14) {
        const gap = (sides & 3) === 3 || (sides & 12) === 12;
        this.nearMiss(gap ? 'GAP!' : 'CLOSE CALL', gap ? 2 : 1);
      }
    }
    // skimming the ground / water
    const agl = p.y - Math.max(gh, hasWater ? waterY : gh);
    if (agl < 5 && speed > 16 && b.vel.y > -6) {
      this.score += dt * speed * 0.5 * this.combo;
      this.comboT = Math.max(this.comboT, 1.2);
      if (hasWater && Math.random() < speed / 60 && agl < 3) this.particles.emit(new THREE.Vector3(p.x, waterY + 0.1, p.z), new THREE.Vector3(b.vel.x * 0.3, 2 + Math.random() * 2, b.vel.z * 0.3), new THREE.Color(0.9, 0.95, 1), 0.7, 0.25, 0.9, 9.8, 0.5, 2);
      if (!this.skimShown) { this.skimShown = true; this.toast('SKIM'); }
    } else if (agl > 12) this.skimShown = false;
  }

  contactSurface(n, landY, speed, pushTo) {
    const b = this.body, cfg = this.cfg;
    const vn = b.vel.dot(n);
    const gentle = speed < cfg.vStall * 1.6 && vn > -6 && n.y > 0.45 && !(this.surfaceCool > 0);
    if (gentle && landY !== null) {
      this.settle('perched', landY);
      this.toast('LANDED', 'nice');
      this.award(null, 40);
      return;
    }
    // bounce: remove the into-surface velocity (+ a little restitution), light friction on impact
    if (pushTo) b.pos.copy(pushTo); else if (landY !== null) b.pos.y = landY;
    if (vn < 0) {
      b.vel.addScaledVector(n, -vn * 1.3);
      if (vn < -1) b.vel.multiplyScalar(0.8);
    }
    const hard = -vn;
    if (hard > 6) {
      this.hurt(Math.min(1, hard / 25));
      this.feathers(b.pos, Math.min(30, hard * 1.5));
      this.audio.thump(Math.min(0.8, hard / 30));
      if (hard > 18) { this.stun = 1.0; this.toast('OOF'); this.combo = 1; }
    }
    // came to rest against the ground: sit down instead of scraping along
    if (landY !== null && b.vel.length() < cfg.vStall * 0.7 && b.takeoffTimer <= 0 && !(this.surfaceCool > 0)) this.settle('perched', landY);
  }

  settle(mode, y) {
    const b = this.body;
    b.mode = mode;
    b.pos.y = y + (mode === 'water' ? 0.05 : 0.3);
    const { fwd } = b.axes();
    this.perchYaw = Math.atan2(-fwd.x, -fwd.z);
    b.vel.set(0, 0, 0);
    b.flapAmt = 0; b.tuck = 0;
    b.setHeading(this.perchYaw, 0);
    this.ui.hint('Tap FLAP to take off', 3);
  }

  // Sense of speed: air motes streaming past, dust/leaf/spray kicked up when low and fast, and
  // rising motes when riding lift so updrafts are visible.
  speedEffects(dt, speed, agl) {
    const b = this.body, P = this.particles;
    if (b.mode !== 'flying') return;
    const { fwd } = b.axes();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x).normalize();
    const mote = new THREE.Color(1, 1, 1);
    const n = speed * dt * 1.4;
    for (let i = 0; i < n; i++) {
      const p = b.pos.clone().addScaledVector(fwd, 12 + Math.random() * 60).addScaledVector(right, (Math.random() - 0.5) * 50).add(new THREE.Vector3(0, (Math.random() - 0.5) * 30, 0));
      P.emit(p, new THREE.Vector3(), mote, 0.25, 0.1 + Math.random() * 0.1, 2.5, 0, 0, 0);
    }
    // kicked-up dust / leaves / spray near the surface
    if (agl < 22 && speed > 18) {
      const k = (1 - agl / 22) * speed * dt * 0.8;
      const gh = this.field.height(b.pos.x, b.pos.z);
      const water = gh < 0.3;
      const col = water ? new THREE.Color(0.9, 0.95, 1) : this.biome.id === 'forest' ? new THREE.Color(0.35, 0.3, 0.18) : new THREE.Color(0.6, 0.55, 0.45);
      for (let i = 0; i < k; i++) {
        const p = new THREE.Vector3(b.pos.x + (Math.random() - 0.5) * 6, (water ? this.water.surfaceAt(b.pos.x, b.pos.z, this.time) : gh) + 0.3, b.pos.z + (Math.random() - 0.5) * 6);
        P.emit(p, new THREE.Vector3(b.vel.x * 0.25, 2 + Math.random() * 3, b.vel.z * 0.25), col, water ? 0.7 : 0.45, water ? 0.25 : 0.18, 1.2, water ? 9.8 : 2, 1.5, 2);
      }
    }
    // visible lift
    const lift = Math.max(this.ridge || 0, this.thermal || 0);
    if (lift > 1) {
      const c = this.biome.id === 'forest' ? new THREE.Color(1, 0.95, 0.75) : new THREE.Color(0.95, 0.97, 1);
      for (let i = 0; i < lift * dt * 6; i++) {
        const p = b.pos.clone().addScaledVector(fwd, 10 + Math.random() * 50).addScaledVector(right, (Math.random() - 0.5) * 60).add(new THREE.Vector3(0, -20 + Math.random() * 30, 0));
        P.emit(p, new THREE.Vector3(0, lift * 1.4, 0), c, 0.5, 0.12, 3, 0, 0, 0.5);
      }
    }
  }

  hurt(a) { this.post.params.uDamage.value = Math.max(this.post.params.uDamage.value, a); this.head.shake = Math.max(this.head.shake, 0.04 * a); navigator.vibrate?.(30); }
  splash(p, s) {
    const c = new THREE.Color(0.92, 0.97, 1);
    for (let i = 0; i < 40 * s; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 3 * s;
      this.particles.emit(new THREE.Vector3(p.x + Math.cos(a) * r * 0.3, this.water.surfaceAt(p.x, p.z, this.time) + 0.1, p.z + Math.sin(a) * r * 0.3), new THREE.Vector3(Math.cos(a) * r, 3 + Math.random() * 6 * s, Math.sin(a) * r), c, 0.8, 0.3 + Math.random() * 0.4, 1.4, 9.8, 0.4, 1);
    }
    this.audio.splash();
  }
  feathers(p, n) {
    const col = new THREE.Color(this.cfg.wing.color2);
    for (let i = 0; i < n; i++) this.particles.emit(p, new THREE.Vector3(0, 1, 0), col, 0.9, 0.12, 3, 0.8, 2.5, 5);
  }

  // ---------------- scoring ----------------
  toast(text, sub) { this.ui.toast(text, sub); }
  award(label, pts) {
    this.score += pts * this.combo;
    if (label) this.toast(label, '+' + Math.round(pts * this.combo));
    this.combo = Math.min(8, this.combo + 0.5);
    this.comboT = 4;
  }
  nearMiss(label, w) {
    if (this.nearCooldown > 0) return;
    this.nearCooldown = 0.9;
    this.award(label, Math.round(25 * w));
  }

  // ---------------- per-frame ----------------
  resize() {
    const w = innerWidth, h = innerHeight;
    const pr = Math.min(devicePixelRatio || 1, this.maxPR || 1.5) * (this.resScale || 1);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post?.setSize(w, h, pr);
    this.particles && (this.particles.mat.uniforms.uScale.value = h * pr * 0.9);
  }

  frame() {
    if (!this.running) return;
    this.clock.update();
    const dtRaw = this.clock.getDelta();
    const dt = Math.min(dtRaw, 1 / 20);
    if (this.paused) { this.post.render(this.scene, this.camera, this.wings.scene, this.wingCam); return; }
    this.time += dt;
    G.uTime.value = this.time;
    const b = this.body, cfg = this.cfg;
    const inp = this.input.update();

    // ----- simulation -----
    if (this.stun > 0) {
      this.stun -= dt;
      inp.pitch = 0; inp.roll = 0; inp.flap = false; inp.boost = false; inp.dive = false;
    }
    if (b.mode === 'perched' || b.mode === 'water') {
      // turn on the spot; flap to take off
      this.perchYaw -= inp.roll * dt * 1.6;
      b.setHeading(this.perchYaw, 0);
      if (b.mode === 'water') b.pos.y = this.water.surfaceAt(b.pos.x, b.pos.z, this.time) + 0.05;
      if (inp.flap || inp.boost) {
        const fromWater = b.mode === 'water';
        b.takeOff();
        this.surfaceCool = fromWater ? 0.8 : 0.3;
        if (fromWater) b.vel.y += 2.5;
        if (b.mode === 'flying' && this.groundH !== undefined && b.pos.y - this.field.height(b.pos.x, b.pos.z) < 1) b.vel.y += 1.5;
        this.ui.hint('', 0);
        this.audio.takeoff(this.cfg.id);
      }
    }
    if (inp.rollTrick && b.mode === 'flying' && this.stun <= 0 && b.startRoll(inp.rollTrick)) this.audio.whoosh(inp.rollTrick * 0.6);
    if (b.rollDir) inp.roll = 0;
    const wind = this.computeWind(dt);
    const env = { wind: () => wind, altitude: b.pos.y - Math.max(this.groundH, 0) };
    const prevY = b.pos.y;
    b.step(dt, inp, env);
    this.handleContacts(dt);
    if (b.mode === 'flying' && b.pos.y > Math.max(this.groundH, 0) + 8) this.lastSafe.copy(b.pos);

    // stats: dive + thermal scoring
    const speed = b.vel.length();
    const climb = (b.pos.y - prevY) / Math.max(dt, 1e-3);
    this.climbF = (this.climbF || 0) + (climb - (this.climbF || 0)) * Math.min(1, dt * 2);
    const aglNow = b.pos.y - Math.max(this.groundH, 0);
    if (b.mode === 'flying') this.tricks.update(dt, { body: b, fwd: b.axes().fwd.clone(), speed, agl: aglNow, climb: this.climbF, ridge: this.ridge, thermal: this.thermal });
    if (b.mode === 'flying') this.rings.update(dt, b, this.camera);
    this.speedEffects(dt, speed, aglNow);
    this.nearCooldown -= dt;
    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = Math.max(1, this.combo - dt * 2);
    if (b.boosting && !this.wasBoost) { this.head.fovKick = 6; this.audio.whoosh(); }
    if (b.tuck > 0.5 && !this.wasTuck) this.audio.whoosh();
    this.wasTuck = b.tuck > 0.5;
    this.wasBoost = b.boosting;
    // safety: fell through the world or flew far off
    if (!(b.pos.y > -200) || !Number.isFinite(b.pos.x)) { b.pos.copy(this.lastSafe); b.vel.set(0, 0, 0); b.mode = 'flying'; }

    // ----- camera + wings -----
    const st = { speed, agl: b.pos.y - Math.max(this.groundH, 0) };
    this.head.update(dt, b, st);
    this.wings.update(dt, b, this.camera, G.uSunDir.value);
    const cam = this.camera.position;
    G.uCamPos.value.copy(cam);
    // push the near plane out with height above ground: keeps depth precision for 50 km vistas
    const near = clamp(st.agl * 0.02, 0.35, 25);
    if (Math.abs(near - this.camera.near) > 0.05) { this.camera.near = near; this.camera.updateProjectionMatrix(); }

    // ----- world streaming -----
    this.terrain.update(cam);
    this.trees.update(cam);
    this.titans?.update(cam);
    this.water.update(cam, this.time);
    this.clouds.update(cam, dt, this.wind);
    this.city?.update(cam);
    this.flocks.update(dt, cam, this.time);
    this.coast?.update(dt, this.time, cam);
    this.falls?.update(dt, cam);
    this.particles.update(dt);
    this.sun.position.copy(cam).addScaledVector(G.uSunDir.value, 1000);
    this.sun.target.position.copy(cam);
    const alt = Math.max(0, cam.y - (this.biome.seaBase || 0));
    this.sky.material.uniforms.uHorizonDrop.value = Math.sqrt((2 * alt) / this.biome.curvatureR);
    this.sky.position.copy(cam);

    // ----- post fx -----
    const pp = this.post.params;
    const boost = b.boosting ? 1 : 0;
    this.speedFx = (this.speedFx || 0) + ((clamp((speed - cfg.vBest * 1.3) / (cfg.vBest * 2.5), 0, 1) * 0.6 + boost * 0.55) - (this.speedFx || 0)) * Math.min(1, dt * 3);
    pp.uSpeed.value = this.speedFx;
    const aglFx = Math.max(0, st.agl);
    const prox = clamp((40 - aglFx) / 40, 0, 1) * clamp((speed - 18) / 30, 0, 1);
    pp.uStreak.value += (clamp(this.speedFx * 1.2 + prox * 0.7, 0, 1) - pp.uStreak.value) * Math.min(1, dt * 4);
    this.head.proximity = prox;
    pp.uBlur.value = 0.5 + b.tuck * 0.5;
    pp.uUnder.value += ((b.mode === 'underwater' ? 1 : 0) - pp.uUnder.value) * Math.min(1, dt * 8);
    pp.uCloud.value = this.clouds.inside;
    pp.uDamage.value = Math.max(0, pp.uDamage.value - dt * 1.5);
    pp.uFlash.value = this.coast ? this.coast.flash * 0.25 * Math.max(0, 1 - Math.hypot(cam.x - 1500, cam.z + 6500) / 15000) : 0;
    this.water.uniforms.uLightning.value = pp.uFlash.value;
    this.clouds.uniforms.uFlash.value = this.coast ? this.coast.flash : 0;
    pp.uTime.value = this.time;

    // god rays: sun position on screen, faded when it is behind us or far off-screen
    {
      const sp = this._sunV || (this._sunV = new THREE.Vector3());
      sp.copy(this.camera.position).addScaledVector(G.uSunDir.value, 1000).project(this.camera);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const facing = fwd.dot(G.uSunDir.value);
      const off = Math.max(Math.abs(sp.x), Math.abs(sp.y));
      this.post.rays.sun.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
      const want = facing > 0 ? (1 - THREE.MathUtils.smoothstep(off, 1.0, 2.2)) * THREE.MathUtils.smoothstep(facing, 0.0, 0.35) : 0;
      this.post.rays.strength += ((want * (this.biome.rays ?? 0.45)) * (1 - this.clouds.inside) - this.post.rays.strength) * Math.min(1, dt * 3);
    }
    this.water.renderReflection(this.renderer, this.scene, this.camera, innerWidth, innerHeight);
    const wc = this.wingCam;
    wc.position.copy(this.camera.position); wc.quaternion.copy(this.camera.quaternion);
    if (wc.fov !== this.camera.fov || wc.aspect !== this.camera.aspect) { wc.fov = this.camera.fov; wc.aspect = this.camera.aspect; wc.updateProjectionMatrix(); }
    this.post.render(this.scene, this.camera, this.wings.scene, wc);

    // ----- audio + HUD -----
    const rollRate = (b.bank - (this.prevBank ?? b.bank)) / Math.max(dt, 1e-3);
    this.prevBank = b.bank;
    this.audio.update(dt, { speed, agl: st.agl, turn: b.bank, rollRate, tuck: b.tuck, flapPhase: b.flapPhase, flapAmt: b.flapAmt, flapVol: cfg.id === 'condor' ? 1.6 : cfg.id === 'pigeon' ? 0.7 : 1, boost: b.boosting, climb: this.climbF, perched: b.mode !== 'flying', under: b.mode === 'underwater' });
    const { fwd: hf } = b.axes();
    const windRel = Math.atan2(this.wind.x, this.wind.z) - Math.atan2(hf.x, hf.z);
    this.ui.hud({ speed, agl: st.agl, climb: this.climbF, stamina: b.stamina, score: this.score, combo: this.combo, ring: this.rings.enabled ? this.rings.arrow : null, chain: this.rings.chain, windRel, lift: Math.max(this.ridge || 0, this.thermal || 0) });

    // ----- dynamic resolution -----
    this.frames++; this.fpsAcc += dtRaw;
    if (this.fpsAcc > 1.5) {
      const ms = (this.fpsAcc / this.frames) * 1000;
      const before = this.resScale;
      if (ms > 21 && this.resScale > 0.5) this.resScale = Math.max(0.5, this.resScale - 0.08);
      else if (ms < 14 && this.resScale < 1) this.resScale = Math.min(1, this.resScale + 0.05);
      if (before !== this.resScale) this.resize();
      this.frames = 0; this.fpsAcc = 0;
    }
  }

  dispose() {
    this.running = false;
    this.pool?.dispose();
    this.terrain?.dispose();
    this.scene?.traverse((o) => {
      o.geometry?.dispose?.();
      const m = o.material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
    });
    this.post?.rtScene.dispose(); this.post?.rtA.dispose(); this.post?.rtB.dispose();
    this.assets?.envMap.dispose();
    Object.values(this.assets?.tex || {}).forEach((t) => t.dispose?.());
    this.renderer.renderLists.dispose();
  }
}
