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

/* Keyed to the in-flight palettes rather than to an atlas: the planet is the
   first thing anyone sees, and if its greens and sands do not belong to the
   same picture as the worlds behind the TAKE FLIGHT button, nothing that
   follows looks deliberate. */
const BIOME_COLOR = {
  forest:   new THREE.Color('#2f5138'),
  coast:    new THREE.Color('#d9bb85'),
  mountain: new THREE.Color('#6b5f6e'),
  city:     new THREE.Color('#6d6474'),
};
const SNOW = new THREE.Color('#efe8f4');
const SEA_DEEP = new THREE.Color('#0d2f4a');
const SEA_SHELF = new THREE.Color('#2a93a6');

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

    /* One warm sun, high and to the right, and a cold bounce from the far
       side. The gap between them is the terminator, which is the only thing
       that makes a sphere read as a planet rather than a ball. */
    const key = new THREE.DirectionalLight(0xffd9a8, 3.4);
    key.position.set(3.4, 2.0, 2.6);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6f8fd8, 1.1);
    rim.position.set(-4, -0.8, -1.6);
    this.scene.add(rim);
    this.scene.add(new THREE.AmbientLight(0x1b2436, 1.2));
    this.sun = key.position.clone().normalize();

    this.stars = this._stars();
    this.scene.add(this.stars);

    this.planet = this._planet();
    this.scene.add(this.planet);

    this.clouds = this._clouds();
    this.scene.add(this.clouds);

    this.halo = this._halo(2.30, 3.6, 1.0);
    this.glow = this._halo(2.90, 2.1, 0.30);
    this.scene.add(this.halo, this.glow);
    for (const h of [this.halo, this.glow]) h.material.uniforms.uSun.value.copy(this.sun);
    this.clouds.material.uniforms.uSun.value.copy(this.sun);

    this.birds = new THREE.Group();
    this.scene.add(this.birds);
    this.mixers = [];

    this.selected = 0;
    this.spin = 0;
    this.targetSpin = 0;
    this._drift = 0;
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
        // Snow on the summits and the caps only. The first pass whited out
        // the whole mountain quarter, which from this distance made a third
        // of the planet a featureless sheet.
        const snow = smooth(0.74, 1.04, h) * (biome === 'mountain' ? 1 : 0.35)
                   + smooth(0.90, 1.02, Math.abs(lat) / 1.5708) * 0.85;
        c.lerp(SNOW, clamp(snow, 0, 1));
        c.offsetHSL(0, 0, (n.simplex3(u.x * 9, u.y * 9, u.z * 9)) * 0.05);
      } else {
        c.copy(SEA_DEEP).lerp(SEA_SHELF, clamp(1 + h * 3.4, 0, 1));
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

  /**
   * The atmosphere.
   *
   * A flat blue shell was the giveaway that this was a ball with a glow round
   * it. Real air scatters by angle: it goes hot and orange where you are
   * looking through it towards the sun and deep blue on the far limb, and it
   * is brightest where the line of sight is longest. So the shell is tinted
   * by the sun angle, and a second, much wider and fainter shell sits outside
   * it to give the whole thing somewhere to fade out to.
   */
  _halo(radius = 2.42, power = 3.4, strength = 0.9) {
    const mat = new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uCool: { value: new THREE.Color('#4f8ff0') },
        uWarm: { value: new THREE.Color('#ffb877') },
        uSun: { value: new THREE.Vector3(0.74, 0.44, 0.57) },
        uPower: { value: power },
        uStrength: { value: strength },
      },
      vertexShader: /* glsl */`
        varying vec3 vN; varying vec3 vP; varying vec3 vW;
        void main(){
          vN = normalize(normalMatrix * normal);
          vW = normalize(mat3(modelMatrix) * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0); vP = mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uCool, uWarm, uSun;
        uniform float uPower, uStrength;
        varying vec3 vN; varying vec3 vP; varying vec3 vW;
        void main(){
          float limb = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(-vP))), 0.0, 1.0), uPower);
          float lit = clamp(dot(normalize(vW), normalize(uSun)) * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(uCool, uWarm, pow(lit, 2.2));
          // The night side keeps a thread of air rather than vanishing.
          gl_FragColor = vec4(col, limb * uStrength * (0.22 + lit * 0.95));
        }`,
    });
    return new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), mat);
  }

  /** A thin, slowly counter-turning shell of cloud. */
  _clouds() {
    const n = new Noise(4211);
    const geo = new THREE.IcosahedronGeometry(2.075, 40);
    const pos = geo.attributes.position;
    const alpha = new Float32Array(pos.count);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      // Banded fBm: weather on a planet organises into latitudes.
      let f = n.simplex3(v.x * 2.4, v.y * 4.6, v.z * 2.4) * 0.6
            + n.simplex3(v.x * 5.3, v.y * 9.1, v.z * 5.3) * 0.28
            + n.simplex3(v.x * 11.0, v.y * 17.0, v.z * 11.0) * 0.12;
      // Broken cloud, not overcast: the point of the planet is that you can
      // see four biomes on it, and weather that hides them defeats it.
      alpha[i] = clamp((f - 0.30) * 1.7, 0, 1);
    }
    geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.FrontSide,
      uniforms: { uSun: { value: new THREE.Vector3(0.74, 0.44, 0.57) } },
      vertexShader: /* glsl */`
        attribute float alpha;
        varying float vA; varying vec3 vW;
        void main(){
          vA = alpha;
          vW = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSun; varying float vA; varying vec3 vW;
        void main(){
          if (vA <= 0.01) discard;
          float lit = clamp(dot(normalize(vW), normalize(uSun)), 0.0, 1.0);
          vec3 col = mix(vec3(0.24, 0.29, 0.42), vec3(1.0, 0.95, 0.88), pow(lit, 0.7));
          gl_FragColor = vec4(col, vA * (0.30 + lit * 0.62));
        }`,
    });
    return new THREE.Mesh(geo, mat);
  }

  /** Stars, so the planet has something to hang in. */
  _stars() {
    const N = 420;
    const pos = new Float32Array(N * 3);
    const size = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      // Rejection-free spherical sampling, pushed out beyond the planet.
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u), R = 26 + Math.random() * 8;
      pos[i * 3] = Math.cos(th) * r * R;
      pos[i * 3 + 1] = u * R;
      pos[i * 3 + 2] = Math.sin(th) * r * R;
      size[i] = 0.6 + Math.pow(Math.random(), 3) * 2.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float size; varying float vTw;
        uniform float uTime;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vTw = 0.65 + 0.35 * sin(uTime * 1.6 + position.x * 3.1 + position.y * 1.7);
          // Clamped: without it the handful of stars nearest the camera blow
          // up into soft white discs the size of moons.
          gl_PointSize = clamp(size * (86.0 / -mv.z), 0.8, 3.4);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vTw;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.06, d);
          gl_FragColor = vec4(vec3(0.86, 0.91, 1.0), a * vTw);
        }`,
    });
    return new THREE.Points(geo, mat);
  }

  /** Drop in whichever GLB birds loaded; the planet works without them. */
  addBirds(models) {
    let i = 0;
    for (const m of models) {
      if (!m?.scene) { i++; continue; }
      const obj = m.scene.clone(true);
      /* The three.js sample birds are a flamingo, a parrot and a stork: hot
         pink, primary red and white. Against this palette they read as three
         mistakes orbiting a planet. They are only here for the silhouette and
         the wingbeat, so they get taken down to near-silhouette — dark, warm
         and desaturated — and the eye takes them for birds. */
      const tone = new THREE.Color('#2a2331');
      obj.traverse((o) => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        o.material.roughness = 0.85;
        o.material.metalness = 0;
        o.material.color?.lerp(tone, 0.9);
        if (o.material.emissive) o.material.emissive.setHex(0x000000);
        o.material.map = null;
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
    /* Far enough back that the outer glow shell clears the top and bottom of
       the canvas. Closer than this and the atmosphere gets sliced off square,
       which reads as a rendering fault rather than as a crop. */
    const fit = 2.98 / Math.tan((this.camera.fov * Math.PI) / 360);
    this.camera.position.z = fit * lerp(1.12, 1.0, clamp((w / h - 0.5) / 1.4, 0, 1));
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
    // The weather turns a little faster than the ground under it, which is
    // the cheapest way to make a small sphere feel like it has an atmosphere
    // rather than a painted-on texture.
    this._drift += dt * 0.013;
    this.clouds.rotation.copy(this.planet.rotation);
    this.clouds.rotation.y += this._drift;
    this.stars.rotation.y -= dt * 0.004;
    this.stars.material.uniforms.uTime.value += dt;

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
