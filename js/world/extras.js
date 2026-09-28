// Thermals, GLB bird flocks, particles and biome set pieces (boats, lighthouse, storm, waterfalls).
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { patchMaterial, patchObject, G, CURVE_VERT_PARS, FOG_FRAG_PARS } from '../core/shaderPatch.js';
import { hash2, mulberry32 } from '../core/noise.js';
import { normalAt } from './fields.js';
import { waveHeight } from './water.js';

// ---------------- thermals ----------------
export class Thermals {
  constructor(cfg, field, wind) {
    this.cfg = cfg; this.field = field; this.wind = wind;
  }
  // Thermal columns sit on a jittered grid and drift with the wind.
  near(x, z, r, fn) {
    const C = this.cfg.cell;
    const i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C);
    const j0 = Math.floor((z - r) / C), j1 = Math.floor((z + r) / C);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (hash2(i, j, 401) > this.cfg.chance) continue;
      const tx = (i + 0.2 + 0.6 * hash2(i, j, 402)) * C, tz = (j + 0.2 + 0.6 * hash2(i, j, 403)) * C;
      const s = 0.6 + hash2(i, j, 404) * 0.8;
      fn(tx, tz, this.cfg.radius * (0.7 + s * 0.6), this.cfg.strength * s, i, j);
    }
  }
  updraft(pos, groundH) {
    let up = 0;
    const agl = pos.y - groundH;
    const top = this.cfg.top;
    this.near(pos.x, pos.z, this.cfg.radius * 2.5, (tx, tz, rad, str) => {
      // column leans downwind with height
      const lean = Math.max(0, agl) * 0.25;
      const dx = pos.x - (tx + this.wind.x * lean * 0.1), dz = pos.z - (tz + this.wind.z * lean * 0.1);
      const d2 = (dx * dx + dz * dz) / (rad * rad);
      if (d2 > 4) return;
      const core = Math.exp(-d2 * 1.6) * 1.25 - 0.15 * Math.exp(-((d2 - 1.6) ** 2) * 3); // sink ring around core
      const vert = Math.min(1, Math.max(0, agl + 30) / 80) * (1 - smooth01((pos.y - top * 0.75) / (top * 0.35)));
      up += core * str * vert;
    });
    return up;
  }
}
const smooth01 = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

// ---------------- GLB flocks ----------------
export class Flocks {
  constructor(scene, assets, biome, thermals, field) {
    this.scene = scene;
    this.thermals = thermals;
    this.field = field;
    this.birds = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    let pick = { forest: 'hawk_lo', coast: 'stork', mountains: 'stork', city: 'parrot' }[biome.id];
    if (!assets.models[pick]) pick = 'stork';
    const src = assets.models[pick];
    this.rigid = pick === 'hawk_lo'; // the hawk scan is a static soaring pose
    if (!src) return;
    const tint = { forest: 0x5a4030, coast: 0xffffff, mountains: 0x222222, city: 0x8890a0 }[biome.id];
    const span = { forest: 3.0, coast: 1.3, mountains: 3.0, city: 0.7 }[biome.id];
    const box = new THREE.Box3().setFromObject(src.scene);
    const size = box.getSize(new THREE.Vector3());
    const scale = span / Math.max(size.x, size.z);
    const count = { forest: 12, coast: 22, mountains: 12, city: 26 }[biome.id];
    this.clip = src.animations[0];
    for (let i = 0; i < count; i++) {
      const o = skeletonClone(src.scene);
      o.traverse((m) => {
        if (m.isMesh && !this.rigid) {
          m.material = m.material.clone();
          m.material.color = new THREE.Color(tint);
          m.frustumCulled = false;
        } else if (m.isMesh) {
          m.frustumCulled = false;
        }
      });
      patchObject(o);
      o.scale.setScalar(scale);
      const mixer = new THREE.AnimationMixer(o);
      if (this.clip && !this.rigid) { const a = mixer.clipAction(this.clip); a.play(); a.time = Math.random() * this.clip.duration; a.timeScale = 0.8 + Math.random() * 0.5; }
      this.group.add(o);
      this.birds.push({ o, mixer, flock: Math.floor(i / 4), phase: Math.random() * Math.PI * 2, r: 30 + Math.random() * 50, hOff: Math.random() * 60, speed: 0.25 + Math.random() * 0.2 });
    }
    this.centres = [];
    this.retarget = 0;
    this.biome = biome;
  }

  update(dt, cam, t) {
    if (!this.birds.length) return;
    this.retarget -= dt;
    if (this.retarget < 0) {
      this.retarget = 3;
      // gather nearby thermals as circling centres (birds mark thermals for the player)
      const list = [];
      this.thermals.near(cam.x, cam.z, 1600, (x, z, r, s) => list.push([x, z, r, s, Math.hypot(x - cam.x, z - cam.z)]));
      list.sort((a, b) => a[4] - b[4]);
      this.centres = list.slice(0, 6);
      if (this.biome.id === 'city') this.centres = [[cam.x + 120, cam.z - 80, 60, 1], [cam.x - 200, cam.z + 150, 60, 1], [cam.x + 300, cam.z + 300, 60, 1], [cam.x - 50, cam.z - 350, 60, 1], [cam.x + 400, cam.z - 200, 60, 1], [cam.x - 380, cam.z - 100, 60, 1], [cam.x, cam.z + 400, 60, 1]].map((c) => [Math.round(c[0] / 200) * 200, Math.round(c[1] / 200) * 200, c[2], c[3]]);
    }
    for (const b of this.birds) {
      const c = this.centres[b.flock % Math.max(1, this.centres.length)];
      if (!c) { b.o.visible = false; continue; }
      b.o.visible = true;
      b.phase += dt * b.speed * (40 / b.r);
      const ground = this.field.height(c[0], c[1]);
      const baseH = this.biome.id === 'city' ? 60 : Math.max(ground, 0) + 120;
      const x = c[0] + Math.cos(b.phase) * b.r, z = c[1] + Math.sin(b.phase) * b.r;
      const y = baseH + b.hOff + ((t * 3 + b.phase * 10) % 400) * (this.biome.id === 'city' ? 0 : 0.5) + Math.sin(t * 0.5 + b.phase) * 4;
      b.o.position.set(x, y, z);
      if (this.rigid) { b.o.rotation.set(0, -b.phase, 0, 'YXZ'); b.o.rotation.z = -0.4 + Math.sin(t * 0.7 + b.phase) * 0.08; }
      else b.o.rotation.set(0, -b.phase + Math.PI, 0.35);
      b.mixer.update(dt);
    }
  }
}

// ---------------- particles ----------------
export class Particles {
  constructor(scene, max = 1500) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...G, uScale: { value: 600 } },
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */ `
        ${CURVE_VERT_PARS}
        uniform float uScale;
        attribute vec4 aCol; attribute float aSize;
        varying vec4 vCol;
        void main() {
          vCol = aCol;
          vec4 w = vec4(position, 1.0);
          vFogWorld = w.xyz;
          vec4 mv = viewMatrix * curveWorld(w);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * uScale / -mv.z, 0.0, 256.0);
        }`,
      fragmentShader: /* glsl */ `
        ${FOG_FRAG_PARS}
        varying vec4 vCol;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.1, length(d)) * vCol.a;
          if (a < 0.01) discard;
          gl_FragColor = vec4(applyFog(vCol.rgb, vFogWorld), a);
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
    this.cursor = 0;
    this.size.fill(0);
  }
  emit(p, v, color, alpha, size, life, grav = 9.8, drag = 0.5, spread = 1) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x + (Math.random() - 0.5) * spread; this.vel[i * 3 + 1] = v.y + (Math.random() - 0.5) * spread; this.vel[i * 3 + 2] = v.z + (Math.random() - 0.5) * spread;
    this.col[i * 4] = color.r; this.col[i * 4 + 1] = color.g; this.col[i * 4 + 2] = color.b; this.col[i * 4 + 3] = alpha;
    this.size[i] = size; this.life[i] = life; this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.size[i]) { this.size[i] = 0; } continue; }
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.life[i] < 0.5) this.col[i * 4 + 3] *= Math.exp(-dt * 6);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aCol.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}

// ---------------- coast set pieces ----------------
function boatMesh(r) {
  const g = new THREE.Group();
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-1.6, 0); hullShape.lineTo(1.6, 0); hullShape.lineTo(2.2, 1.6); hullShape.lineTo(-2.2, 1.6); hullShape.closePath();
  const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(hullShape, { depth: 11, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: [0xb33a2a, 0x2a4f7a, 0x2f6b4f, 0xe8e2d0][Math.floor(r() * 4)], roughness: 0.6 }));
  hull.position.set(0, -0.6, -5.5);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 3.4), new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.5 }));
  cabin.position.set(0, 2.1, -1.5);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 7), new THREE.MeshStandardMaterial({ color: 0x444444 }));
  mast.position.set(0, 4.5, 1.8);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6), new THREE.MeshStandardMaterial({ color: 0x444444 }));
  boom.rotation.x = 1.0; boom.position.set(0, 4, 4);
  g.add(hull, cabin, mast, boom);
  patchObject(g);
  return g;
}

export class CoastSet {
  constructor(scene, field, assets, water, particles, audio) {
    this.scene = scene; this.field = field; this.water = water; this.particles = particles; this.audio = audio;
    this.boats = [];
    const r = mulberry32(99);
    for (let i = 0; i < 14; i++) {
      const b = boatMesh(r);
      const x = (r() - 0.5) * 5000;
      const z = field.shore(x) - 250 - r() * 2200;
      b.userData = { x, z, heading: r() * Math.PI * 2, speed: 1 + r() * 3, turn: (r() - 0.5) * 0.02 };
      scene.add(b);
      this.boats.push(b);
    }
    // lighthouse on the nearest cliff to the spawn
    this.lighthouse = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.6, 26, 16), new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.6 }));
    tower.position.y = 13;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.25, 5, 16), new THREE.MeshStandardMaterial({ color: 0xc0302a }));
    band.position.y = 14;
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 3, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe6a0, emissiveIntensity: 4 }));
    lamp.position.y = 27.5;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.8, 2.5, 12), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    roof.position.y = 30.2;
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(14, 220, 16, 1, true).rotateZ(Math.PI / 2).translate(110, 0, 0), beamMat);
    this.beam.position.y = 27.5;
    this.lighthouse.add(tower, band, lamp, roof, this.beam);
    patchObject(this.lighthouse);
    scene.add(this.lighthouse);

    // storm: rain curtains + lightning bolt
    const st = { x: 1500, y: 1100, z: -6500, r: 2600 };
    this.storm = st;
    const rainTex = (() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 256;
      const g = c.getContext('2d');
      for (let i = 0; i < 120; i++) { g.strokeStyle = `rgba(200,210,225,${0.2 + Math.random() * 0.4})`; g.beginPath(); const x = Math.random() * 64, y = Math.random() * 256; g.moveTo(x, y); g.lineTo(x - 2, y + 20 + Math.random() * 20); g.stroke(); }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
    })();
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: { ...G, tRain: { value: rainTex } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `${CURVE_VERT_PARS}\nvarying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vFogWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * curveWorld(w); }`,
      fragmentShader: `${FOG_FRAG_PARS}\nuniform sampler2D tRain; uniform float uTime; varying vec2 vUv; void main(){ vec4 t = texture2D(tRain, vec2(vUv.x * 30.0, vUv.y * 4.0 + uTime * 2.5)); float a = t.a * 0.55 * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.7, vUv.y); gl_FragColor = vec4(applyFog(vec3(0.45, 0.48, 0.55), vFogWorld), a); }`,
    });
    this.rain = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(st.r * (0.5 + i * 0.08), st.r * (0.55 + i * 0.08), st.y + 50, 32, 1, true), this.rainMat);
      m.position.set(st.x + (i - 3) * 200, st.y / 2 - 20, st.z + (i % 2) * 300);
      this.rain.add(m);
    }
    scene.add(this.rain);
    this.bolt = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xeef4ff }));
    this.bolt.visible = false;
    this.bolt.frustumCulled = false;
    scene.add(this.bolt);
    this.nextBolt = 4;
    this.flash = 0;
  }

  placeLighthouse(x, z) {
    // search along the cliff tops near (x, z)
    let best = null;
    for (let i = -40; i <= 40; i++) {
      const px = x + i * 25;
      for (let s = 30; s < 200; s += 15) {
        const pz = this.field.shore(px) + s;
        const h = this.field.height(px, pz);
        if (h > 40 && (!best || h > best[2])) best = [px, pz, h];
      }
    }
    if (best) this.lighthouse.position.set(best[0], best[2] - 1, best[1]);
  }

  update(dt, t, cam) {
    for (const b of this.boats) {
      const u = b.userData;
      u.heading += u.turn * dt;
      u.x += Math.sin(u.heading) * u.speed * dt; u.z += Math.cos(u.heading) * u.speed * dt;
      if (this.field.height(u.x + Math.sin(u.heading) * 60, u.z + Math.cos(u.heading) * 60) > -4) u.heading += Math.PI * dt;
      const y = waveHeight(u.x, u.z, t, this.water.uniforms.uWave.value);
      const yf = waveHeight(u.x + Math.sin(u.heading) * 5, u.z + Math.cos(u.heading) * 5, t, this.water.uniforms.uWave.value);
      b.position.set(u.x, y, u.z);
      b.rotation.set(Math.atan2(y - yf, 5) * 0.8, u.heading, Math.sin(t * 0.9 + u.x) * 0.06);
    }
    this.beam.rotation.y = t * 0.8;
    this.nextBolt -= dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    if (this.nextBolt < 0) {
      this.nextBolt = 5 + Math.random() * 10;
      const st = this.storm;
      const pts = [];
      let x = st.x + (Math.random() - 0.5) * st.r, z = st.z + (Math.random() - 0.5) * st.r * 0.6, y = st.y;
      while (y > 0) { pts.push(new THREE.Vector3(x, y, z)); x += (Math.random() - 0.5) * 80; z += (Math.random() - 0.5) * 80; y -= 40 + Math.random() * 60; }
      pts.push(new THREE.Vector3(x, 0, z));
      this.bolt.geometry.dispose();
      this.bolt.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      this.bolt.visible = true;
      this.boltT = 0.18;
      this.flash = 1;
      const d = Math.hypot(cam.x - st.x, cam.z - st.z);
      this.audio?.thunder(d / 343);
    }
    if (this.boltT > 0) { this.boltT -= dt; if (this.boltT <= 0) this.bolt.visible = false; }
  }
}

// ---------------- forest waterfalls ----------------
export class Waterfalls {
  constructor(scene, field, assets, particles, cx, cz) {
    this.particles = particles;
    this.falls = [];
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...G, tNoise: { value: assets.tex.noise } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `${CURVE_VERT_PARS}\nvarying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vFogWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * curveWorld(w); }`,
      fragmentShader: `${FOG_FRAG_PARS}\nuniform sampler2D tNoise; uniform float uTime; uniform vec3 uSunColor; varying vec2 vUv;
        void main(){
          float n = texture2D(tNoise, vec2(vUv.x * 2.0, vUv.y * 0.6 + uTime * 0.9)).r * 0.6 + texture2D(tNoise, vec2(vUv.x * 5.0, vUv.y * 1.6 + uTime * 1.7)).g * 0.4;
          float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
          float a = smoothstep(0.3, 0.7, n) * edge * 0.9;
          vec3 c = mix(vec3(0.55, 0.7, 0.72), vec3(1.0), n) * (0.6 + 0.6 * uSunColor);
          gl_FragColor = vec4(applyFog(c, vFogWorld), a);
        }`,
    });
    // Trace steep downhill paths that end in water near the spawn.
    const r = mulberry32(7);
    const tried = new Set();
    for (let k = 0; k < 400 && this.falls.length < 6; k++) {
      const x = cx + (r() - 0.5) * 5000, z = cz + (r() - 0.5) * 5000;
      const key = Math.round(x / 300) + ':' + Math.round(z / 300);
      if (tried.has(key)) continue;
      tried.add(key);
      const h = field.height(x, z);
      if (h < 60 || h > 700) continue;
      const n = normalAt(field, x, z, 6);
      if (n[1] > 0.7) continue;
      const pts = [];
      let px = x, pz = z, ph = h;
      for (let s = 0; s < 120 && ph > 0.5; s++) {
        pts.push(new THREE.Vector3(px, ph + 1.2, pz));
        const nn = normalAt(field, px, pz, 5);
        const l = Math.hypot(nn[0], nn[2]) || 1;
        px += (nn[0] / l) * 6; pz += (nn[2] / l) * 6;
        const nh = field.height(px, pz);
        if (nh > ph + 0.5) break;
        ph = nh;
      }
      if (ph > 0.5 || pts.length < 12) continue;
      const drop = pts[0].y - pts[pts.length - 1].y;
      if (drop < 50) continue;
      pts.push(new THREE.Vector3(px, 0.3, pz));
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = this.ribbon(curve, 8 + r() * 10, pts.length * 2);
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = 3;
      scene.add(m);
      this.falls.push({ base: pts[pts.length - 1], top: pts[0], mesh: m });
    }
  }
  ribbon(curve, width, seg) {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const p = curve.getPoint(t), d = curve.getTangent(t);
      const side = new THREE.Vector3(-d.z, 0, d.x).normalize().multiplyScalar(width / 2);
      pos.push(p.x - side.x, p.y + 0.3, p.z - side.z, p.x + side.x, p.y + 0.3, p.z + side.z);
      uv.push(0, t * seg * 0.1, 1, t * seg * 0.1);
      if (i < seg) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  update(dt, cam) {
    const white = new THREE.Color(0.9, 0.95, 1.0);
    for (const f of this.falls) {
      if (f.base.distanceTo(cam) > 1500) continue;
      for (let i = 0; i < 3; i++) this.particles.emit(f.base, new THREE.Vector3(0, 3 + Math.random() * 3, 0), white, 0.35, 10 + Math.random() * 12, 2.5, -0.5, 0.6, 5);
    }
  }
}
