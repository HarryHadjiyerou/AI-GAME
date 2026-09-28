// HDR post-processing: bloom, bird-eye fisheye, peripheral + speed blur, tonemapping and grading.
import * as THREE from 'three';

export function hdrType(renderer) {
  const e = renderer.extensions;
  return e.has('EXT_color_buffer_float') || e.has('EXT_color_buffer_half_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
}

const QUAD_VS = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class Post {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.quality = quality;
    const type = hdrType(renderer);
    this.hdr = type === THREE.HalfFloatType;
    const samples = quality === 'high' ? 4 : 0;
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { type, samples, depthBuffer: true });
    this.rtA = new THREE.WebGLRenderTarget(4, 4, { type });
    this.rtB = new THREE.WebGLRenderTarget(4, 4, { type });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene();
    this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.1 } },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
                 + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
          c *= 0.25;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c *= smoothstep(uThreshold, uThreshold * 2.5, l);
          gl_FragColor = vec4(min(c, vec3(30.0)), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tSrc, vUv).rgb * 0.227;
          c += (texture2D(tSrc, vUv + uDir * 1.38).rgb + texture2D(tSrc, vUv - uDir * 1.38).rgb) * 0.316;
          c += (texture2D(tSrc, vUv + uDir * 3.23).rgb + texture2D(tSrc, vUv - uDir * 3.23).rgb) * 0.070;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.finalMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tBloom: { value: null },
        uAspect: { value: 1 }, uFish: { value: 0.07 }, uSpeed: { value: 0 }, uBlur: { value: 0.5 },
        uExposure: { value: 1 }, uSat: { value: 1.15 }, uContrast: { value: 1.05 },
        uUnder: { value: 0 }, uUnderColor: { value: new THREE.Color(0.05, 0.25, 0.3) },
        uCloud: { value: 0 }, uCloudColor: { value: new THREE.Color(0.9, 0.92, 0.95) },
        uFlash: { value: 0 }, uDamage: { value: 0 }, uTime: { value: 0 }, uBloom: { value: 0.35 },
        uTint: { value: new THREE.Color(1, 1, 1) }, uLdr: { value: this.hdr ? 0 : 1 },
      },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene, tBloom;
        uniform float uAspect, uFish, uSpeed, uBlur, uExposure, uSat, uContrast, uUnder, uCloud, uFlash, uDamage, uTime, uBloom, uLdr;
        uniform vec3 uUnderColor, uCloudColor, uTint;
        varying vec2 vUv;
        vec2 fish(vec2 uv, float k) {
          vec2 p = uv * 2.0 - 1.0;
          p.x *= uAspect;
          float r2 = dot(p, p);
          float norm = 1.0 + k * (uAspect * uAspect);
          p *= (1.0 + k * r2) / norm;
          p.x /= uAspect;
          return p * 0.5 + 0.5;
        }
        vec3 aces(vec3 x) {
          const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 uv = vUv;
          if (uUnder > 0.01) uv += vec2(sin(uv.y * 24.0 + uTime * 3.0), cos(uv.x * 19.0 + uTime * 2.3)) * 0.004 * uUnder;
          float k = uFish + uSpeed * 0.06;
          vec2 c = uv * 2.0 - 1.0;
          c.x *= uAspect;
          float r = length(c) / uAspect;
          vec2 suv = fish(uv, k);
          // peripheral + speed radial blur (towards the centre)
          float amt = smoothstep(0.35, 1.1, r) * (uBlur * 0.012 + uSpeed * 0.05);
          vec2 dir = (suv - 0.5);
          float ab = 0.0015 + uSpeed * 0.004;
          vec3 col = vec3(0.0);
          float wsum = 0.0;
          for (int i = 0; i < 6; i++) {
            float t = float(i) / 5.0;
            vec2 o = suv - dir * amt * t;
            float w = 1.0 - t * 0.6;
            vec3 s;
            s.r = texture2D(tScene, o + dir * ab * r).r;
            s.g = texture2D(tScene, o).g;
            s.b = texture2D(tScene, o - dir * ab * r).b;
            col += s * w; wsum += w;
          }
          col /= wsum;
          col += texture2D(tBloom, suv).rgb * uBloom;
          col *= uTint;
          // Clouds and underwater murk
          col = mix(col, uCloudColor, uCloud * 0.85);
          col = mix(col, uUnderColor * (0.6 + 0.4 * uv.y), uUnder * 0.75);
          col += uFlash;
          vec3 m = uLdr > 0.5 ? col : aces(col * uExposure);
          float l = dot(m, vec3(0.2126, 0.7152, 0.0722));
          m = mix(vec3(l), m, uSat);
          m = clamp((m - 0.5) * uContrast + 0.5, 0.0, 1.0);
          float vig = smoothstep(1.35, 0.45, r);
          m *= mix(0.55, 1.0, vig);
          m = mix(m, vec3(0.6, 0.02, 0.02), uDamage * (1.0 - vig) * 0.8);
          m = pow(m, vec3(1.0 / 2.2));
          m += (hash(vUv * 1000.0 + uTime) - 0.5) / 255.0;
          gl_FragColor = vec4(m, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.params = this.finalMat.uniforms;
  }

  setSize(w, h, pr) {
    const W = Math.max(2, Math.floor(w * pr)), H = Math.max(2, Math.floor(h * pr));
    this.rtScene.setSize(W, H);
    const bw = Math.max(2, W >> 2), bh = Math.max(2, H >> 2);
    this.rtA.setSize(bw, bh);
    this.rtB.setSize(bw, bh);
    this.brightMat.uniforms.uTexel.value.set(1 / W, 1 / H);
    this.params.uAspect.value = w / h;
    this.bw = bw; this.bh = bh;
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qScene, this.qCam);
  }

  render(scene, camera, overlayScene, overlayCam) {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);
    if (overlayScene) {
      r.autoClear = false;
      r.clearDepth();
      r.render(overlayScene, overlayCam);
      r.autoClear = true;
    }
    this.brightMat.uniforms.tSrc.value = this.rtScene.texture;
    this.pass(this.brightMat, this.rtA);
    this.blurMat.uniforms.tSrc.value = this.rtA.texture;
    this.blurMat.uniforms.uDir.value.set(1 / this.bw, 0);
    this.pass(this.blurMat, this.rtB);
    this.blurMat.uniforms.tSrc.value = this.rtB.texture;
    this.blurMat.uniforms.uDir.value.set(0, 1 / this.bh);
    this.pass(this.blurMat, this.rtA);
    this.params.tScene.value = this.rtScene.texture;
    this.params.tBloom.value = this.rtA.texture;
    this.pass(this.finalMat, null);
  }
}
