// Billboard cumulus clouds (lit per puff), an optional cloud deck, and an offshore storm cell.
import * as THREE from 'three';
import { G, CURVE_VERT_PARS, FOG_FRAG_PARS } from '../core/shaderPatch.js';
import { hash2, mulberry32 } from '../core/noise.js';

function makePuffAtlas() {
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rand = mulberry32(42);
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * S / 2, oy = Math.floor(v / 2) * S / 2, R = S / 4;
    for (let k = 0; k < 26; k++) {
      const a = rand() * Math.PI * 2, d = Math.pow(rand(), 0.7) * R * 0.5;
      const x = ox + R + Math.cos(a) * d, y = oy + R + Math.sin(a) * d * 0.8;
      const r = R * (0.25 + rand() * 0.3);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.35)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.15)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(ox, oy, S / 2, S / 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class Clouds {
  constructor(scene, assets, cfg, quality) {
    this.cfg = cfg;
    this.max = Math.round((quality === 'low' ? 500 : 1100) * (cfg.amount ?? 1));
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    this.iData = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4), 4); // size, lit, variant, dark
    this.iPos.setUsage(THREE.DynamicDrawUsage);
    this.iData.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.iPos);
    geo.setAttribute('iData', this.iData);
    geo.instanceCount = 0;
    this.geo = geo;
    this.uniforms = {
      ...G,
      tPuff: { value: makePuffAtlas() },
      uAmbient: { value: assets.skyInfo.zenith.clone().multiplyScalar(0.9) },
      uDrift: { value: new THREE.Vector2() },
      uFlash: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: /* glsl */ `
        ${CURVE_VERT_PARS}
        attribute vec3 iPos;
        attribute vec4 iData;
        uniform vec2 uDrift;
        varying vec2 vUv;
        varying float vLit, vDark, vFade;
        void main() {
          vec3 c = iPos + vec3(uDrift.x, 0.0, uDrift.y);
          vFogWorld = c;
          vec4 cw = curveWorld(vec4(c, 1.0));
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float s = iData.x;
          cw.xyz += (right * position.x + up * position.y) * s;
          float v = iData.z;
          vUv = uv * 0.5 + vec2(mod(v, 2.0), floor(v / 2.0)) * 0.5;
          vLit = iData.y; vDark = iData.w;
          float d = distance(cameraPosition, c);
          vFade = smoothstep(s * 0.25, s * 0.9, d);
          gl_Position = projectionMatrix * viewMatrix * cw;
        }`,
      fragmentShader: /* glsl */ `
        ${FOG_FRAG_PARS}
        uniform sampler2D tPuff;
        uniform vec3 uSunColor, uAmbient;
        uniform float uFlash;
        varying vec2 vUv;
        varying float vLit, vDark, vFade;
        void main() {
          vec4 t = texture2D(tPuff, vUv);
          float a = t.a * vFade;
          if (a < 0.004) discard;
          float lit = clamp(vLit * 0.8 + (fract(vUv.y * 2.0) - 0.4) * 0.5, 0.0, 1.0);
          vec3 shadow = uAmbient * 0.75 + uFogColor * 0.2;
          vec3 col = mix(shadow, uSunColor * 1.35 + uAmbient * 0.3, lit);
          col = mix(col, vec3(0.16, 0.17, 0.2), vDark);
          col += vec3(0.8, 0.85, 1.0) * uFlash * vDark * 2.0;
          col = applyFog(col, vFogWorld);
          gl_FragColor = vec4(col * a, a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this.puffs = [];
    this.lastCell = '';
    this.sortTimer = 0;
    this.inside = 0;

    if (cfg.deck) this.deck = this.makeDeck(scene, assets, cfg.deck);
  }

  makeDeck(scene, assets, deck) {
    const g = new THREE.PlaneGeometry(60000, 60000, 64, 64);
    g.rotateX(-Math.PI / 2);
    const u = { ...G, tNoise: { value: assets.tex.noise }, uHeight: { value: deck.height }, uCover: { value: deck.cover }, uAmbient: this.uniforms.uAmbient };
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        ${CURVE_VERT_PARS}
        uniform float uHeight;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          w.y = uHeight;
          vFogWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * curveWorld(w);
        }`,
      fragmentShader: /* glsl */ `
        ${FOG_FRAG_PARS}
        uniform sampler2D tNoise;
        uniform float uTime, uCover, uHeight;
        uniform vec3 uSunColor, uAmbient;
        void main() {
          vec2 p = vFogWorld.xz;
          float n = texture2D(tNoise, p / 5200.0 + uTime * 0.0015).r * 0.55
                  + texture2D(tNoise, p / 1500.0 - uTime * 0.002).g * 0.3
                  + texture2D(tNoise, p / 380.0 + uTime * 0.004).b * 0.15;
          float d = smoothstep(1.0 - uCover, 1.0 - uCover + 0.22, n);
          if (d < 0.01) discard;
          float nx = texture2D(tNoise, (p + vec2(40.0, 0.0)) / 1500.0 - uTime * 0.002).g - texture2D(tNoise, p / 1500.0 - uTime * 0.002).g;
          float lit = clamp(0.65 + nx * 6.0 * uSunDir.x + d * 0.3, 0.0, 1.2);
          bool below = cameraPosition.y < uHeight;
          vec3 col = below ? uAmbient * 0.7 + uFogColor * 0.3 : mix(uAmbient * 0.8, uSunColor * 1.3, lit);
          float fadeNear = smoothstep(10.0, 120.0, abs(cameraPosition.y - uHeight));
          gl_FragColor = vec4(applyFog(col, vFogWorld), d * fadeNear * (below ? 0.9 : 0.97));
        }`,
    });
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    m.renderOrder = 4;
    scene.add(m);
    return m;
  }

  rebuild(cam) {
    const cfg = this.cfg;
    const C = cfg.cell || 1700;
    const R = cfg.radius || 9000;
    const drift = this.uniforms.uDrift.value;
    const px = cam.x - drift.x, pz = cam.z - drift.y;
    const ci = Math.floor(px / C), cj = Math.floor(pz / C);
    const n = Math.ceil(R / C);
    const sun = G.uSunDir.value;
    this.puffs.length = 0;
    const add = (x, y, z, s, lit, dark) => { if (this.puffs.length < this.max) this.puffs.push([x, y, z, s, lit, (this.puffs.length * 7) % 4, dark]); };
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      const a = ci + i, b = cj + j;
      if (hash2(a, b, 71) > (cfg.coverage ?? 0.5)) continue;
      const x = (a + hash2(a, b, 72)) * C, z = (b + hash2(a, b, 73)) * C;
      if (Math.hypot(x - px, z - pz) > R) continue;
      const scale = 0.6 + hash2(a, b, 74) * 0.9;
      const y = cfg.base + hash2(a, b, 75) * (cfg.spread || 300);
      const rx = 380 * scale, ry = 170 * scale;
      const count = 8 + Math.floor(hash2(a, b, 76) * 14);
      const rnd = mulberry32(a * 9173 + b * 131);
      for (let k = 0; k < count; k++) {
        const ang = rnd() * Math.PI * 2, rr = Math.sqrt(rnd());
        const ox = Math.cos(ang) * rr * rx, oz = Math.sin(ang) * rr * rx * 0.8;
        const oy = rnd() * ry * (1 - rr * 0.6);
        const s = (140 + rnd() * 160) * scale * (1 - rr * 0.35);
        const nl = Math.hypot(ox, oy * 1.8 + 40, oz);
        const lit = 0.5 + 0.5 * ((ox * sun.x + (oy * 1.8 + 40) * sun.y + oz * sun.z) / nl);
        add(x + ox, y + oy, z + oz, s, lit * (0.55 + 0.45 * Math.min(1, oy / ry + 0.3)), 0);
      }
    }
    if (cfg.storm) {
      const st = cfg.storm;
      const rnd = mulberry32(777);
      for (let k = 0; k < 150; k++) {
        const ang = rnd() * Math.PI * 2, rr = Math.sqrt(rnd());
        add(st.x + Math.cos(ang) * rr * st.r, st.y + rnd() * 900 * (1 - rr * 0.5), st.z + Math.sin(ang) * rr * st.r * 0.7, 300 + rnd() * 380, 0.3 + rnd() * 0.3, 0.75 + rnd() * 0.25);
      }
    }
    this.sort(cam);
  }

  sort(cam) {
    const d = this.uniforms.uDrift.value;
    this.puffs.sort((p, q) => ((q[0] + d.x - cam.x) ** 2 + (q[1] - cam.y) ** 2 + (q[2] + d.y - cam.z) ** 2) - ((p[0] + d.x - cam.x) ** 2 + (p[1] - cam.y) ** 2 + (p[2] + d.y - cam.z) ** 2));
    const P = this.iPos.array, D = this.iData.array;
    this.puffs.forEach((p, i) => {
      P[i * 3] = p[0]; P[i * 3 + 1] = p[1]; P[i * 3 + 2] = p[2];
      D[i * 4] = p[3]; D[i * 4 + 1] = p[4]; D[i * 4 + 2] = p[5]; D[i * 4 + 3] = p[6];
    });
    this.iPos.needsUpdate = true;
    this.iData.needsUpdate = true;
    this.geo.instanceCount = this.puffs.length;
  }

  update(cam, dt, wind) {
    const drift = this.uniforms.uDrift.value;
    drift.x += wind.x * dt * 0.5;
    drift.y += wind.z * dt * 0.5;
    const C = this.cfg.cell || 1700;
    const key = Math.floor((cam.x - drift.x) / C) + ':' + Math.floor((cam.z - drift.y) / C);
    if (key !== this.lastCell) { this.lastCell = key; this.rebuild(cam); }
    this.sortTimer -= dt;
    if (this.sortTimer < 0) { this.sortTimer = 0.4; this.sort(cam); }
    // How deep inside a cloud is the camera?
    let inside = 0;
    for (let i = this.puffs.length - 1; i >= Math.max(0, this.puffs.length - 40); i--) {
      const p = this.puffs[i];
      const dd = Math.hypot(p[0] + drift.x - cam.x, p[1] - cam.y, p[2] + drift.y - cam.z) / (p[3] * 0.5);
      if (dd < 1) inside = Math.max(inside, (1 - dd) * (1 - p[6] * 0.3));
    }
    if (this.deck) {
      this.deck.position.set(cam.x, 0, cam.z);
      const dh = Math.abs(cam.y - this.cfg.deck.height);
      if (dh < 60) inside = Math.max(inside, 1 - dh / 60);
    }
    this.inside += (inside - this.inside) * Math.min(1, dt * 4);
  }
}
