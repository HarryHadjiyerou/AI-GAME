/* ═══════════════════════════════════════════════════════════
   The lens.

   One pass does the work of a bird's eye:

     • barrel distortion — a wide, slightly fish-eyed view, so you get
       the peripheral sweep without the tunnel-vision of a plain wide FOV
     • peripheral softening — sharp where a bird's fovea is, soft at the
       edges, which is both true and a cheap way to sell speed
     • radial streak — the blur pulls outward from the centre as speed
       builds, and hard in a stoop
     • chromatic fringing at the rim, a touch of vignette, and a faint
       grain so the sky does not band

   All of it is one texture fetch loop, so it costs almost nothing.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { clamp, damp } from './noise.js';

const BirdVisionShader = {
  name: 'BirdVisionShader',
  uniforms: {
    tDiffuse:    { value: null },
    uAspect:     { value: 1 },
    uFisheye:    { value: 0.30 },
    uSpeed:      { value: 0 },
    uBlur:       { value: 0.55 },
    uVignette:   { value: 0.42 },
    uAberration: { value: 0.55 },
    uGrain:      { value: 0.035 },
    uTime:       { value: 0 },
    uWater:      { value: 0 },
    uWaterTint:  { value: new THREE.Color('#2d6b7a') },
    uFade:       { value: 0 },
    uLift:       { value: new THREE.Color('#0d1626') },
    uGain:       { value: new THREE.Color('#fff0dd') },
    uSaturation: { value: 1.18 },
    uContrast:   { value: 1.06 },
    uFlash:      { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uAspect, uFisheye, uSpeed, uBlur, uVignette, uAberration, uGrain, uTime, uWater, uFade;
    uniform float uSaturation, uContrast, uFlash;
    uniform vec3  uWaterTint, uLift, uGain;
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    // Barrel distortion about the centre of frame.
    //
    // Normalised so the corner of the output maps exactly to the corner of the
    // input. Without that, the distortion asks for pixels from beyond the edge
    // of the rendered frame, the sampler clamps, and the whole rim smears into
    // horizontal streaks of whatever happened to be at the border.
    vec2 fish(vec2 uv, float k) {
      vec2 c = uv - 0.5;
      c.x *= uAspect;
      float r2 = dot(c, c);
      float rMax2 = 0.25 * (uAspect * uAspect + 1.0);
      float norm = 1.0 + k * rMax2 + k * 0.32 * rMax2 * rMax2;
      c *= (1.0 + k * r2 + k * 0.32 * r2 * r2) / norm;
      c.x /= uAspect;
      return c + 0.5;
    }

    void main() {
      vec2 d = vUv - 0.5;
      float r = length(vec2(d.x * uAspect, d.y));

      // Underwater gets a slow lateral wobble on top of everything else.
      vec2 uv0 = vUv;
      if (uWater > 0.001) {
        uv0 += vec2(sin(vUv.y * 24.0 + uTime * 2.6), cos(vUv.x * 19.0 + uTime * 2.1))
             * 0.0045 * uWater;
      }

      float k = uFisheye * 0.55;
      vec2 uvR = fish(uv0, k * (1.0 + uAberration * 0.012));
      vec2 uvG = fish(uv0, k);
      vec2 uvB = fish(uv0, k * (1.0 - uAberration * 0.012));

      // How far to smear: soft at the rim always, plus a radial pull with speed.
      float periph = smoothstep(0.22, 0.95, r) * uBlur;
      float streak = uSpeed * (0.35 + r * 1.5);
      float amount = (periph * 0.010 + streak * 0.028);

      vec3 col = vec3(0.0);
      float wsum = 0.0;
      // Six taps marching back towards the centre — one loop covers both the
      // peripheral softening and the speed streak.
      for (int i = 0; i < 6; i++) {
        float t = float(i) / 5.0;
        float w = 1.0 - t * 0.62;
        // Taps march back towards the centre, never outwards past the frame.
        vec2 off = -normalize(d + 1e-6) * amount * t;
        col.r += texture2D(tDiffuse, uvR + off).r * w;
        col.g += texture2D(tDiffuse, uvG + off).g * w;
        col.b += texture2D(tDiffuse, uvB + off).b * w;
        wsum += w;
      }
      col /= wsum;

      if (uWater > 0.001) {
        // Light goes green-blue fast underwater, and contrast collapses.
        col = mix(col, uWaterTint * (0.35 + 0.65 * dot(col, vec3(0.299, 0.587, 0.114))), uWater * 0.72);
      }

      // ── colour grade ──
      //
      // Lift, gain, saturation, contrast — the four dials a colourist
      // reaches for, and between them they do more for how a frame feels
      // than any amount of extra geometry. Each world carries its own set,
      // which is what makes the coast warm and the mountains cold when the
      // underlying renderer is identical.
      col = uLift + col * (uGain - uLift);
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      col += uFlash;                      // lightning
      col = max(col, vec3(0.0));

      float vig = 1.0 - uVignette * smoothstep(0.38, 1.28, r);
      col *= vig;

      // Grain, scaled down in the bright areas where it would look like noise.
      float g = (hash(vUv * 1024.0 + fract(uTime) * 91.7) - 0.5) * uGrain;
      col += g * (1.0 - smoothstep(0.4, 1.0, dot(col, vec3(0.33))));

      col *= (1.0 - uFade);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/**
 * Quality tiers.
 *
 * Bloom is on at every level, including the lowest. It is not a luxury in
 * this art direction — the sun, the glitter on the water and the lit windows
 * all depend on it, and without it the whole thing looks like it is behind
 * glass. What scales instead is render resolution and how much world gets
 * streamed, which is where the frames actually go.
 */
export const QUALITY = {
  low: {
    scale: 0.62, bloom: true, samples: 0,
    terrainLod: 2.1, terrainBudget: 1, waterRings: 56, waterSegments: 96,
    cloudScale: 0.45, vegScale: 0.5, cityScale: 0.6, traffic: 50,
    motes: 320, rain: 900, flock: 5,
  },
  medium: {
    scale: 0.82, bloom: true, samples: 0,
    terrainLod: 2.6, terrainBudget: 2, waterRings: 76, waterSegments: 128,
    cloudScale: 0.75, vegScale: 0.8, cityScale: 0.85, traffic: 110,
    motes: 650, rain: 1800, flock: 8,
  },
  high: {
    scale: 1.00, bloom: true, samples: 0,
    terrainLod: 3.0, terrainBudget: 2, waterRings: 96, waterSegments: 160,
    cloudScale: 1.0, vegScale: 1.0, cityScale: 1.0, traffic: 150,
    motes: 900, rain: 2600, flock: 10,
  },
  ultra: {
    scale: 1.00, bloom: true, samples: 4,
    terrainLod: 3.6, terrainBudget: 3, waterRings: 112, waterSegments: 192,
    cloudScale: 1.3, vegScale: 1.25, cityScale: 1.2, traffic: 220,
    motes: 1400, rain: 3400, flock: 14,
  },
};

export class BirdVision {
  constructor(renderer, scene, camera, quality = 'medium') {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.overlay = null;          // { scene, camera } drawn over the world
    this.quality = QUALITY[quality] ? quality : 'medium';
    // The tier's own scale is the starting point; AutoQuality moves this at
    // runtime without rebuilding anything.
    this.scale = QUALITY[this.quality].scale;

    this._build();
    this.speed = 0;
    this.water = 0;
    this.fade = 0;
    this.time = 0;
  }

  _build() {
    const q = QUALITY[this.quality];
    const size = this.renderer.getSize(new THREE.Vector2());

    const target = new THREE.WebGLRenderTarget(
      Math.max(1, Math.floor(size.x * this.scale)),
      Math.max(1, Math.floor(size.y * this.scale)),
      {
        type: THREE.HalfFloatType,
        colorSpace: THREE.LinearSRGBColorSpace,
        samples: q.samples,
      }
    );

    this.composer?.dispose();
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.setPixelRatio(1);
    this.composer.setSize(size.x, size.y);

    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // The wings, drawn over the finished world through their own much wider
    // camera. Depth is cleared first so they are never occluded by terrain
    // half a kilometre away; colour is not, so the world shows through.
    this.overlayPass = new RenderPass(new THREE.Scene(), this.camera);
    this.overlayPass.clear = false;
    this.overlayPass.clearDepth = true;
    this.overlayPass.enabled = false;
    this.composer.addPass(this.overlayPass);

    if (q.bloom) {
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        this._palette?.bloom ?? 0.5,   // strength
        0.85,                          // radius
        0.72                           // threshold — low, so sky and water bloom
      );
      this.composer.addPass(this.bloom);
    } else {
      this.bloom = null;
    }

    this.vision = new ShaderPass(BirdVisionShader);
    this.vision.uniforms.uAspect.value = size.x / Math.max(1, size.y);
    this.composer.addPass(this.vision);

    this.composer.addPass(new OutputPass());
  }

  setQuality(name) {
    if (!QUALITY[name] || name === this.quality) return QUALITY[this.quality];
    this.quality = name;
    this.scale = QUALITY[name].scale;
    const o = this.overlay;
    this._build();
    if (o) this.setOverlay(o.scene, o.camera);
    return QUALITY[name];
  }

  setFisheye(v) { this.vision.uniforms.uFisheye.value = v; }

  /** Apply a world's grade and bloom. */
  setGrade(palette) {
    const u = this.vision.uniforms;
    const g = palette.grade ?? {};
    if (g.lift) u.uLift.value.copy(g.lift);
    if (g.gain) u.uGain.value.copy(g.gain);
    if (g.saturation !== undefined) u.uSaturation.value = g.saturation;
    if (g.contrast !== undefined) u.uContrast.value = g.contrast;
    if (this.bloom && palette.bloom !== undefined) this.bloom.strength = palette.bloom;
    this.renderer.toneMappingExposure = palette.exposure ?? 1;
    this._palette = palette;
  }

  /** Hand the wing pass its scene and camera, or null to switch it off. */
  setOverlay(scene, camera) {
    this.overlay = scene ? { scene, camera } : null;
    this.overlayPass.scene = scene ?? this.overlayPass.scene;
    this.overlayPass.camera = camera ?? this.overlayPass.camera;
    this.overlayPass.enabled = !!scene;
  }

  setSize(w, h) {
    this._w = w; this._h = h;
    this.composer.setSize(w, h);
    const rw = Math.max(1, Math.floor(w * this.scale));
    const rh = Math.max(1, Math.floor(h * this.scale));
    this.composer.renderTarget1.setSize(rw, rh);
    this.composer.renderTarget2.setSize(rw, rh);
    this.vision.uniforms.uAspect.value = w / Math.max(1, h);
    this.bloom?.setSize(w, h);
  }

  /**
   * Change the resolution the scene is rendered at, without a rebuild.
   * This is the lever AutoQuality pulls; the composer keeps presenting at the
   * full canvas size, so all that changes is how many pixels get shaded.
   */
  setRenderScale(scale) {
    const s = Math.max(0.35, Math.min(1, scale));
    if (Math.abs(s - this.scale) < 0.005) return;
    this.scale = s;
    const size = this.renderer.getSize(new THREE.Vector2());
    this.setSize(this._w ?? size.x, this._h ?? size.y);
  }

  /** Bloom is the one pass cheap enough to keep and expensive enough to drop. */
  setBloom(on) { if (this.bloom) this.bloom.enabled = on; }

  render(dt, { speed = 0, water = 0, fade = 0, flash = 0 } = {}) {
    this.time += dt;
    const u = this.vision.uniforms;
    this.speed = damp(this.speed, clamp(speed, 0, 1), 0.25, dt);
    this.water = damp(this.water, clamp(water, 0, 1), 0.18, dt);
    u.uSpeed.value = this.speed;
    u.uWater.value = this.water;
    u.uTime.value = this.time;
    u.uFade.value = fade;
    u.uFlash.value = flash;
    this.composer.render(dt);
  }

  dispose() { this.composer?.dispose(); }
}
