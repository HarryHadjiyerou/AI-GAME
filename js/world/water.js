// Water surface: Gerstner waves, sky reflections, depth-based colour and shore foam.
import * as THREE from 'three';
import { G, CURVE_VERT_PARS, FOG_FRAG_PARS } from '../core/shaderPatch.js';
import { hdrType } from '../core/post.js';

// Shared wave set (xz direction, wavelength, amplitude). Mirrored in JS for physics.
export const WAVES = [
  [1.0, 0.3, 62, 0.95],
  [0.55, 1.0, 33, 0.5],
  [-0.45, 0.9, 17, 0.28],
  [0.9, -0.45, 9.5, 0.15],
];

export function waveHeight(x, z, t, scale) {
  if (scale <= 0) return 0;
  let h = 0;
  for (const [dx, dz, L, A] of WAVES) {
    const l = Math.hypot(dx, dz);
    const k = (2 * Math.PI) / L;
    const c = Math.sqrt(9.8 / k);
    h += A * Math.sin(k * ((dx * x + dz * z) / l - c * t));
  }
  return h * scale;
}

export class Water {
  constructor(scene, assets, biome, pool) {
    this.pool = pool;
    this.biome = biome;
    const W = biome.water;
    const seg = 180;
    const g = new THREE.PlaneGeometry(2, 2, seg, seg);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    const a = 200, R = 70000;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i), v = p.getZ(i);
      p.setX(i, u * a + Math.sign(u) * Math.pow(Math.abs(u), 3) * (R - a));
      p.setZ(i, v * a + Math.sign(v) * Math.pow(Math.abs(v), 3) * (R - a));
    }
    g.computeBoundingSphere();

    this.hm = { data: null, cx: 0, cz: 0, size: 1, res: 1, pending: false };
    const hmTex = new THREE.DataTexture(new Uint16Array([THREE.DataUtils.toHalfFloat(-100)]), 1, 1, THREE.RedFormat, THREE.HalfFloatType);
    hmTex.needsUpdate = true;

    this.uniforms = {
      ...G,
      tNormals: { value: assets.tex.waterNormals },
      tSky: { value: assets.sky },
      tNoise: { value: assets.tex.noise },
      tHeight: { value: hmTex },
      tLight: { value: new THREE.DataTexture(new Uint8Array([255, 255, 0, 255]), 1, 1) },
      uHm: { value: new THREE.Vector4(0, 0, 1, 0) },
      uWave: { value: W.wave },
      uDeep: { value: new THREE.Color(W.deep) },
      uShallow: { value: new THREE.Color(W.shallow) },
      uIce: { value: W.ice ? 1 : 0 },
      uMurk: { value: W.murk || 0 },
      uFlow: { value: new THREE.Vector2(...(W.flow || [0.02, 0.01])) },
      uSkyBoost: { value: biome.skyBoost || 1 },
      uLevel: { value: 0 },
      uLightning: { value: 0 },
      tRefl: { value: null },
      uReflMat: { value: new THREE.Matrix4() },
      uHasRefl: { value: 0 },
    };
    const waveGLSL = WAVES.map((w) => `wave(p, vec2(${w[0].toFixed(3)}, ${w[1].toFixed(3)}), ${w[2].toFixed(2)}, ${w[3].toFixed(3)} * amp, t, pos, tang, bin);`).join('\n');

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        ${CURVE_VERT_PARS}
        uniform float uTime, uWave, uLevel;
        uniform sampler2D tHeight;
        uniform vec4 uHm;
        varying vec3 vN;
        varying float vDepth;
        varying float vCrest;
        uniform mat4 uReflMat;
        varying vec4 vRefl;
        void wave(vec2 p, vec2 d, float L, float A, float t, inout vec3 pos, inout vec3 tang, inout vec3 bin) {
          d = normalize(d);
          float k = 6.2831853 / L;
          float c = sqrt(9.8 / k);
          float f = k * (dot(d, p) - c * t);
          float Q = 0.55 / (k * max(A, 1e-4) * 4.0);
          float qa = Q * A;
          pos.x += qa * d.x * cos(f);
          pos.z += qa * d.y * cos(f);
          pos.y += A * sin(f);
          float wa = k * A;
          tang += vec3(-Q * d.x * d.x * wa * sin(f), d.x * wa * cos(f), -Q * d.x * d.y * wa * sin(f));
          bin += vec3(-Q * d.x * d.y * wa * sin(f), d.y * wa * cos(f), -Q * d.y * d.y * wa * sin(f));
        }
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vec2 hmUv = (w.xz - uHm.xy) / uHm.z + 0.5;
          float th = texture2D(tHeight, hmUv).r;
          float inside = step(0.0, hmUv.x) * step(hmUv.x, 1.0) * step(0.0, hmUv.y) * step(hmUv.y, 1.0);
          float depth = mix(60.0, uLevel - th, inside);
          vDepth = depth;
          float dist = length(w.xz - cameraPosition.xz);
          float amp = uWave * smoothstep(0.0, 9.0, depth) * (1.0 - smoothstep(1200.0, 5000.0, dist));
          vec3 pos = vec3(w.x, uLevel, w.z);
          vec3 tang = vec3(1.0, 0.0, 0.0), bin = vec3(0.0, 0.0, 1.0);
          vec2 p = w.xz; float t = uTime;
          ${waveGLSL}
          vN = normalize(cross(bin, tang));
          vCrest = (pos.y - uLevel) / max(uWave * 1.9, 0.01);
          vec4 cw = vec4(pos, 1.0);
          vFogWorld = cw.xyz;
          cw = curveWorld(cw);
          vRefl = uReflMat * vec4(cw.xyz - vec3(0.0, pos.y - uLevel, 0.0), 1.0);
          gl_Position = projectionMatrix * viewMatrix * cw;
        }`,
      fragmentShader: /* glsl */ `
        ${FOG_FRAG_PARS}
        uniform sampler2D tNormals, tSky, tNoise, tLight, tRefl;
        uniform vec4 uHm;
        uniform float uHasRefl;
        varying vec4 vRefl;
        uniform float uTime, uIce, uMurk, uSkyBoost, uWave, uLevel, uLightning;
        uniform vec3 uDeep, uShallow, uSunColor;
        uniform vec2 uFlow;
        varying vec3 vN;
        varying float vDepth;
        varying float vCrest;
        #define PI 3.141592653589793
        vec3 skyLookup(vec3 r) {
          r.y = max(r.y, 0.015);
          r = normalize(r);
          vec2 uv = vec2(atan(r.z, r.x) / (2.0 * PI) + 0.5, asin(r.y) / PI + 0.5);
          return texture2D(tSky, uv).rgb * uSkyBoost;
        }
        void main() {
          vec3 wp = vFogWorld;
          vec3 V = normalize(cameraPosition - wp);
          float dist = length(cameraPosition - wp);
          bool below = cameraPosition.y < wp.y - 0.05;
          vec2 uv1 = wp.xz / 38.0 + uFlow * uTime;
          vec2 uv2 = wp.xz / 11.0 - uFlow.yx * uTime * 1.7;
          vec3 n1 = texture2D(tNormals, uv1).xzy * 2.0 - 1.0;
          vec3 n2 = texture2D(tNormals, uv2).xzy * 2.0 - 1.0;
          float detail = mix(0.55, 0.12, smoothstep(40.0, 1500.0, dist));
          vec3 N = normalize(vN + vec3(n1.x + n2.x, 0.0, n1.z + n2.z) * detail);
          if (below) N = -N;
          vec4 nz = texture2D(tNoise, wp.xz / 90.0 + uTime * 0.004);
          float depth = max(vDepth, 0.0);
          vec2 luv = (wp.xz - uHm.xy) / uHm.z + 0.5;
          vec2 lit = (luv.x > 0.0 && luv.x < 1.0 && luv.y > 0.0 && luv.y < 1.0) ? texture2D(tLight, luv).rg : vec2(1.0);

          if (uIce > 0.5) {
            // Frozen lake: rough blue-white ice with cracks and snow drifts.
            vec4 n3 = texture2D(tNoise, wp.xz / 25.0);
            float crack = smoothstep(0.02, 0.0, abs(n3.r - 0.5)) + smoothstep(0.015, 0.0, abs(n3.g - 0.5)) * 0.6;
            vec3 ice = mix(vec3(0.45, 0.68, 0.8), vec3(0.85, 0.92, 0.97), nz.r);
            ice = mix(ice, vec3(0.95), smoothstep(0.55, 0.8, n3.b));
            ice *= 1.0 - crack * 0.35;
            vec3 Ni = normalize(vec3(0.0, 1.0, 0.0) + (n1 * 0.08));
            float fr = 0.03 + 0.97 * pow(1.0 - max(dot(Ni, V), 0.0), 5.0);
            vec3 refl = skyLookup(reflect(-V, Ni));
            float diff = max(dot(Ni, uSunDir), 0.0) * 0.8 + 0.35;
            vec3 col = mix(ice * diff * uSunColor, refl, fr * 0.6);
            col += uSunColor * pow(max(dot(reflect(-V, Ni), uSunDir), 0.0), 300.0) * 3.0;
            gl_FragColor = vec4(applyFog(col, wp), 1.0);
            return;
          }

          float fr = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 R = reflect(-V, N);
          vec3 refl = skyLookup(R) * (1.0 + uLightning * 3.0);
          float l = dot(refl, vec3(0.2126, 0.7152, 0.0722));
          refl *= 1.0 + smoothstep(0.6, 1.0, l) * 1.5;
          if (uHasRefl > 0.5 && !below) {
            // planar reflection of the real scene (mountains, canyon walls, trees, clouds)
            vec2 ruv = vRefl.xy / vRefl.w + N.xz * mix(0.035, 0.008, smoothstep(50.0, 2000.0, dist));
            vec3 scene = texture2D(tRefl, clamp(ruv, 0.001, 0.999)).rgb;
            refl = scene * (1.0 + uLightning * 3.0);
          }
          vec3 spec = uSunColor * (pow(max(dot(R, uSunDir), 0.0), 900.0) * 40.0 + pow(max(dot(R, uSunDir), 0.0), 80.0) * 0.6) * lit.x;
          refl *= mix(0.2, 1.0, lit.y);
          float absorb = 1.0 - exp(-depth * mix(0.12, 0.5, uMurk));
          vec3 body = mix(uShallow, uDeep, absorb);
          // light scattering through wave crests
          float sss = pow(max(dot(V, -uSunDir) * 0.5 + 0.5, 0.0), 3.0) * clamp(vCrest, 0.0, 1.0);
          body += uShallow * sss * 0.6 * uSunColor;
          body *= (0.35 + 0.65 * max(uSunDir.y, 0.1)) * mix(0.25, 1.0, 0.5 * lit.x + 0.5 * lit.y) + uLightning;
          vec3 col = mix(body, refl, fr) + spec;
          // Foam: shoreline and wave crests
          float shore = 1.0 - smoothstep(0.0, 2.2 + uWave * 1.5, depth);
          float foamN = texture2D(tNoise, wp.xz / 7.0 + vec2(uTime * 0.03, 0.0)).g;
          float surf = shore * smoothstep(0.35, 0.7, foamN + 0.35 * sin(depth * 2.5 - uTime * 1.8));
          float crest = smoothstep(0.75, 1.05, vCrest + (foamN - 0.5) * 0.4) * step(0.3, uWave);
          float foam = clamp(surf + crest * 0.55, 0.0, 1.0) * (1.0 - smoothstep(300.0, 1500.0, dist) * 0.7);
          col = mix(col, vec3(0.9, 0.94, 0.96) * (0.5 + 0.6 * max(uSunDir.y, 0.2)), foam);
          float alpha = mix(mix(0.55, 0.95, uMurk), 1.0, smoothstep(0.0, 5.0, depth));
          alpha = max(alpha, foam);
          if (below) { col = mix(uDeep * 0.6, uShallow, 0.3) + spec * 0.2; alpha = 0.9; }
          gl_FragColor = vec4(applyFog(col, wp), alpha);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.level = 0;
  }

  setupReflection(renderer, quality) {
    if (quality === 'low') return;
    this.refl = {
      rt: new THREE.WebGLRenderTarget(4, 4, { type: hdrType(renderer) }),
      cam: new THREE.PerspectiveCamera(),
      scale: quality === 'high' ? 0.5 : 0.34,
      plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.level + 0.5),
      bias: new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1),
      frame: 0,
      every: quality === 'high' ? 1 : 2,
    };
    this.refl.cam.layers.set(1);
    this.uniforms.tRefl.value = this.refl.rt.texture;
  }

  // Mirror the camera in the water plane and render the reflect-layer into a texture.
  renderReflection(renderer, scene, camera, w, h) {
    const R = this.refl;
    if (!R) return;
    if (camera.position.y - this.level > 9000) { this.uniforms.uHasRefl.value = 0; return; }
    if (R.frame++ % R.every) return;
    const W = Math.max(2, Math.floor(w * R.scale)), H = Math.max(2, Math.floor(h * R.scale));
    if (R.rt.width !== W || R.rt.height !== H) R.rt.setSize(W, H);
    const c = R.cam, L = this.level;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    c.position.set(camera.position.x, 2 * L - camera.position.y, camera.position.z);
    f.y = -f.y; u.y = -u.y;
    c.up.copy(u);
    c.lookAt(c.position.clone().add(f));
    c.projectionMatrix.copy(camera.projectionMatrix);
    c.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    c.updateMatrixWorld();
    this.uniforms.uReflMat.value.copy(R.bias).multiply(c.projectionMatrix).multiply(c.matrixWorldInverse);
    const prevClip = renderer.clippingPlanes;
    renderer.clippingPlanes = [R.plane];
    renderer.setRenderTarget(R.rt);
    renderer.clear();
    renderer.render(scene, c);
    renderer.clippingPlanes = prevClip;
    renderer.setRenderTarget(null);
    this.uniforms.uHasRefl.value = 1;
  }

  update(cam, t) {
    const s = 8;
    this.mesh.position.set(Math.round(cam.x / s) * s, 0, Math.round(cam.z / s) * s);
    const hm = this.hm;
    const size = 2400, res = 160;
    if (!hm.pending && (!hm.data || Math.hypot(cam.x - hm.cx, cam.z - hm.cz) > size * 0.25)) {
      hm.pending = true;
      const cx = Math.round(cam.x / 100) * 100, cz = Math.round(cam.z / 100) * 100;
      this.pool.request({ type: 'heightmap', key: 'hm:' + cx + ':' + cz + ':' + t.toFixed(2), cx, cz, size, res }, (m) => {
        hm.pending = false;
        hm.data = m.data; hm.cx = m.cx; hm.cz = m.cz; hm.size = m.size; hm.res = m.res;
        const half = new Uint16Array(m.data.length);
        for (let i = 0; i < m.data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.max(-200, Math.min(4000, m.data[i])));
        const tex = new THREE.DataTexture(half, m.res, m.res, THREE.RedFormat, THREE.HalfFloatType);
        tex.magFilter = tex.minFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        this.uniforms.tHeight.value.dispose();
        this.uniforms.tHeight.value = tex;
        this.uniforms.uHm.value.set(m.cx, m.cz, m.size, 1);
        const lt = new THREE.DataTexture(m.light, m.lres, m.lres);
        lt.magFilter = lt.minFilter = THREE.LinearFilter;
        lt.needsUpdate = true;
        this.uniforms.tLight.value.dispose();
        this.uniforms.tLight.value = lt;
      });
    }
  }

  surfaceAt(x, z, t) {
    return this.level + waveHeight(x, z, t, this.uniforms.uWave.value);
  }
}
