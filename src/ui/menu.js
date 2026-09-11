/* ═══════════════════════════════════════════════════════════
   The menu planet.

   A small world with all four biomes on it, turning slowly, with the
   GLB birds circling. It runs in its own renderer so that choosing a
   bird costs nothing and the main context can be built fresh for the
   world you actually picked — and torn down completely the moment you
   take flight.

   The sphere is displaced by the same noise the real terrain uses, and
   coloured by which quarter of the planet you are on, which is the
   whole mini-planet conceit in one object: forest, coast, high range
   and city, all visibly on the same small rock.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { Noise, clamp, lerp, smooth } from '../core/noise.js';
import { BIRDS, BIRD_ORDER } from '../config/birds.js';

const BIOME_COLOR = {
  forest:   new THREE.Color('#37552b'),
  coast:    new THREE.Color('#c7b189'),
  mountain: new THREE.Color('#e8eef5'),
  city:     new THREE.Color('#6a6a70'),
};
const SEA = new THREE.Color('#17384f');

export class MenuPlanet {
  constructor(canvas) {
    this.canvas = canvas;
    this.ok = false;
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas, antialias: true, alpha: true, powerPreference: 'low-power',
      });
    } catch (e) {
      return;                              // no WebGL: the menu still works
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.camera.position.set(0, 0.6, 6.4);
    this.camera.lookAt(0, 0, 0);

    const key = new THREE.DirectionalLight(0xfff0dc, 3.1);
    key.position.set(3, 2.2, 3.4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88b4e8, 1.5);
    rim.position.set(-4, -0.6, -2);
    this.scene.add(rim);
    this.scene.add(new THREE.AmbientLight(0x24303f, 1.4));

    this.planet = this._planet();
    this.scene.add(this.planet);

    this.halo = this._halo();
    this.scene.add(this.halo);

    this.birds = new THREE.Group();
    this.scene.add(this.birds);
    this.mixers = [];

    this.selected = 0;
    this.spin = 0;
    this.targetSpin = 0;
    this.running = false;
    this.ok = true;
    this._clock = new THREE.Clock();
  }

  /* ── the sphere ─────────────────────────────────────────── */

  _planet() {
    const n = new Noise(1789);
    const geo = new THREE.IcosahedronGeometry(2, 48);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const u = v.clone().normalize();

      // Which biome: split the planet into four broad territories, softened
      // by noise so the borders are not four clean orange segments.
      const lon = Math.atan2(u.x, u.z);
      const lat = Math.asin(clamp(u.y, -1, 1));
      const jitter = n.simplex3(u.x * 2.2, u.y * 2.2, u.z * 2.2) * 0.55;
      const q = (lon + Math.PI) / (Math.PI * 2) * 4 + jitter;
      const which = BIRD_ORDER[((Math.floor(q) % 4) + 4) % 4];
      const biome = BIRDS[which].world;

      // Continents.
      let h = n.simplex3(u.x * 1.35, u.y * 1.35, u.z * 1.35) * 0.6
            + n.simplex3(u.x * 3.1, u.y * 3.1, u.z * 3.1) * 0.26
            + n.simplex3(u.x * 7.4, u.y * 7.4, u.z * 7.4) * 0.10;

      // The mountain quarter stands proud; the coast quarter is mostly sea.
      if (biome === 'mountain') h = h * 1.35 + 0.16;
      if (biome === 'coast') h -= 0.20;
      if (biome === 'city') h = h * 0.40 + 0.04;
      if (biome === 'forest') h = h * 0.85 + 0.08;

      const land = h > 0;
      const r = 2 + (land ? Math.pow(h, 1.25) * 0.30 : -0.012);
      v.copy(u).multiplyScalar(r);
      pos.setXYZ(i, v.x, v.y, v.z);

      if (land) {
        c.copy(BIOME_COLOR[biome]);
        // Snow on the genuinely high ground and at the poles, not everywhere.
        const snow = smooth(0.52, 0.86, h) * (biome === 'mountain' ? 1 : 0.45)
                   + smooth(0.80, 0.99, Math.abs(lat) / 1.5708) * 0.9;
        c.lerp(BIOME_COLOR.mountain, clamp(snow, 0, 1));
        c.offsetHSL(0, 0, (n.simplex3(u.x * 9, u.y * 9, u.z * 9)) * 0.05);
      } else {
        c.copy(SEA).lerp(new THREE.Color('#2f7f96'), clamp(1 + h * 3.4, 0, 1));
      }
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.92, metalness: 0.0, flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.z = 0.28;
    return mesh;
  }

  /** A thin shell of backside-lit blue, standing in for an atmosphere. */
  _halo() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color('#78b6ff') } },
      vertexShader: `
        varying vec3 vN; varying vec3 vP;
        void main(){ vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position,1.0); vP = mv.xyz;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform vec3 uColor; varying vec3 vN; varying vec3 vP;
        void main(){
          float f = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(-vP))), 0.0, 1.0), 3.4);
          gl_FragColor = vec4(uColor, f * 0.85);
        }`,
    });
    return new THREE.Mesh(new THREE.SphereGeometry(2.42, 48, 32), mat);
  }

  /** Drop in whichever GLB birds loaded; the planet works without them. */
  addBirds(models) {
    let i = 0;
    for (const m of models) {
      if (!m?.scene) { i++; continue; }
      const obj = m.scene.clone(true);
      obj.traverse((o) => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        o.material.roughness = 0.8;
        o.material.metalness = 0;
        o.frustumCulled = false;
      });
      obj.scale.setScalar(0.0042);
      const mixer = new THREE.AnimationMixer(obj);
      if (m.animations?.length) {
        const a = mixer.clipAction(m.animations[0]);
        a.play(); a.time = i * 0.7;
        mixer.timeScale = 0.85 + i * 0.14;
      }
      this.mixers.push(mixer);
      this.birds.add(obj);
      obj.userData.orbit = {
        radius: 2.85 + (i % 3) * 0.32,
        tilt: -0.5 + i * 0.34,
        phase: i * 1.9,
        speed: 0.26 + (i % 3) * 0.07,
      };
      i++;
    }
  }

  select(index) { this.selected = index; this.targetSpin = -index * (Math.PI / 2); }

  resize() {
    if (!this.ok) return;
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width | 0), h = Math.max(1, r.height | 0);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Pull back on narrow screens so the planet never gets cropped.
    this.camera.position.z = lerp(7.4, 6.0, clamp((w / h - 0.5) / 1.4, 0, 1));
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (!this.ok || this.running) return;
    this.running = true;
    this.resize();
    this._clock.start();
    const loop = () => {
      if (!this.running) return;
      this._frame = requestAnimationFrame(loop);
      const dt = Math.min(this._clock.getDelta(), 0.1);
      this._tick(dt);
    };
    loop();
  }

  stop() {
    this.running = false;
    if (this._frame) cancelAnimationFrame(this._frame);
  }

  _tick(dt) {
    this.spin = lerp(this.spin, this.targetSpin, 1 - Math.exp(-dt / 0.45));
    this.planet.rotation.y = this.spin + performance.now() * 0.000022;
    this.halo.rotation.y = this.planet.rotation.y;

    for (let i = 0; i < this.birds.children.length; i++) {
      const o = this.birds.children[i];
      const t = o.userData.orbit;
      t.phase += t.speed * dt;
      const x = Math.cos(t.phase) * t.radius;
      const z = Math.sin(t.phase) * t.radius;
      o.position.set(x, Math.sin(t.phase * 0.7) * 0.5 + Math.sin(t.tilt) * 0.9, z);
      o.rotation.set(0, -t.phase - Math.PI / 2, 0.22);
      this.mixers[i]?.update(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.stop();
    if (!this.ok) return;
    this.scene.traverse((o) => { o.geometry?.dispose(); 
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material?.dispose?.(); });
    this.renderer.dispose();
    this.ok = false;
  }
}
