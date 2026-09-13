/* ═══════════════════════════════════════════════════════════
   Sky, light and cloud.

   Entirely procedural. There is no HDRI here any more, and losing it
   fixed two problems at once: the download went away, and so did the
   grey. A photograph of a sky is a photograph of one particular
   afternoon, and it brings that afternoon's washed-out horizon with
   it whether you want it or not.

   What is here instead:

     • a sky dome painted from the world's palette — zenith, mid-sky,
       a hot band at the horizon, a sun with a real halo, cloud strata
       projected onto a plane so they have proper perspective, and
       stars wherever the sky is dark enough to show them
     • image-based light generated from the same palette, so the light
       on a wing always agrees with the sky behind it
     • billboard cumulus you can fly through

   All of it comes up instantly and none of it touches the network.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { Noise, rng, clamp } from '../core/noise.js';

/* ═══════════════════ the dome ═══════════════════════════ */

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    // Sits at the camera, always. The dome is a backdrop, not an object in
    // the world, so it ignores depth entirely and draws first.
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w;      // pin to the far plane
  }
`;

const SKY_FRAG = /* glsl */`
  precision highp float;

  uniform vec3  uZenith, uSky, uHorizon, uHaze;
  uniform vec3  uSunDir, uSunColor, uSunGlow;
  uniform float uSunSize;
  uniform vec3  uCloudLit, uCloudShade;
  uniform float uCloudAmount, uCloudSpeed, uTime;
  uniform float uStars;
  uniform float uStorm;

  varying vec3 vDir;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++){ v += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;

    /* ── the gradient ── */
    //
    // The exponents matter more than the colours. A linear ramp between three
    // stops puts a visible ring in the sky wherever two of them meet; raising
    // the blend to a power spreads each transition over a much wider arc, and
    // the ring goes away.
    float up = pow(clamp(h, 0.0, 1.0), 0.55);
    vec3 col = mix(uHorizon, uSky, pow(smoothstep(-0.06, 0.42, h), 0.75));
    col = mix(col, uZenith, pow(smoothstep(0.05, 1.0, up), 1.35));
    // Below the horizon the sky becomes the haze the land dissolves into, so
    // there is never a seam where the world stops.
    col = mix(col, uHaze, smoothstep(0.03, -0.26, h));

    // A little dither, because an 8-bit gradient across a whole sky bands
    // no matter how smooth the maths is.
    col += (hash(gl_FragCoord.xy * 0.71) - 0.5) * 0.006;

    /* ── the sun ── */
    float sd = max(dot(dir, uSunDir), 0.0);
    // Three falloffs stacked: the tight core, the bloom around it, and a
    // wide wash across that whole quarter of the sky.
    float glow = pow(sd, 2200.0) * 3.0 + pow(sd, 60.0) * 0.55
               + pow(sd, 8.0) * 0.22 + pow(sd, 1.8) * 0.10;
    col += uSunGlow * glow * (1.0 - uStorm * 0.8);
    float disc = smoothstep(cos(uSunSize * 1.5), cos(uSunSize * 0.55), sd);
    col = mix(col, uSunColor * 2.4, disc * (1.0 - uStorm * 0.85));

    /* ── stars, where it is dark enough for them ── */
    if (uStars > 0.001 && h > -0.02) {
      vec3 sp = dir * 220.0;
      float tw = hash(floor(sp.xz) + floor(sp.y) * 37.0);
      float star = smoothstep(0.9975, 0.99975, tw);
      float twinkle = 0.6 + 0.4 * sin(uTime * 2.4 + tw * 90.0);
      // Fade them out near the sun and near the bright horizon.
      float room = smoothstep(0.05, 0.55, h) * (1.0 - smoothstep(0.2, 0.9, sd));
      col += vec3(star * twinkle * room * uStars);
    }

    /* ── cloud strata ── */
    if (h > 0.005) {
      // Project onto a plane high overhead: this is what gives distant cloud
      // its perspective, streaking towards the horizon instead of tiling
      // evenly across the dome like wallpaper.
      vec2 cuv = dir.xz / max(0.045, h) * 0.30;
      vec2 drift = vec2(uTime * uCloudSpeed, uTime * uCloudSpeed * 0.38);

      float low = fbm(cuv * 0.55 + drift);
      float high = fbm(cuv * 0.22 - drift * 0.45 + 31.0);

      float mask = smoothstep(0.02, 0.16, h);            // nothing at the rim
      float cover = uCloudAmount;
      float lowC = smoothstep(0.62 - cover * 0.55, 0.86 - cover * 0.35, low) * mask;
      float highC = smoothstep(0.58 - cover * 0.40, 0.80 - cover * 0.25, high) * mask * 0.55;

      // Lit from the sun's side, shadowed away from it — the only shading a
      // flat cloud layer needs to read as three-dimensional.
      float lit = clamp(0.35 + 0.65 * pow(sd, 1.6) + (low - 0.5) * 0.9, 0.0, 1.0);
      // Under a storm the light stops coming from one direction: the deck is
      // thick enough that every part of its underside is equally starved, so
      // the sun-side shading flattens out and the whole thing goes to shade.
      lit = mix(lit, lit * 0.30, uStorm);
      vec3 cloud = mix(uCloudShade, uCloudLit, lit);
      // Rim: the edge facing the sun burns out. Not through a storm deck.
      cloud += uSunGlow * pow(sd, 6.0) * 0.45 * lowC * (1.0 - uStorm * 0.9);

      // An overcast is opaque. Broken cloud lets the sky through; a storm
      // ceiling does not, and leaving 4% of a golden sky showing through was
      // the reason a storm still read as a summer evening.
      float ceiling = mix(0.96, 1.0, clamp(uStorm, 0.0, 1.0));
      col = mix(col, cloud, clamp(lowC + highC, 0.0, ceiling));
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class SkyDome {
  constructor(palette, opts = {}) {
    this.uniforms = {
      uZenith: { value: palette.zenith.clone() },
      uSky: { value: palette.sky.clone() },
      uHorizon: { value: palette.horizon.clone() },
      uHaze: { value: palette.haze.clone() },
      uSunDir: { value: palette.sunDir.clone().normalize() },
      uSunColor: { value: palette.sunColor.clone() },
      uSunGlow: { value: palette.sunGlow.clone() },
      uSunSize: { value: palette.sunSize ?? 0.035 },
      uCloudLit: { value: palette.cloudLit.clone() },
      uCloudShade: { value: palette.cloudShade.clone() },
      uCloudAmount: { value: opts.cloudAmount ?? 0.42 },
      uCloudSpeed: { value: opts.cloudSpeed ?? 0.0035 },
      uStars: { value: opts.stars ?? 0 },
      uStorm: { value: 0 },
      uTime: { value: 0 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    // Rides with the camera so it can never be flown out of.
    this.mesh.onBeforeRender = (r, scene, camera) => {
      this.mesh.position.setFromMatrixPosition(camera.matrixWorld);
      this.mesh.updateMatrixWorld(true);
    };
  }

  update(dt) { this.uniforms.uTime.value += dt; }
  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}

/* ═══════════════ image-based light ══════════════════════ */

/**
 * Build an environment map from the palette rather than from a photograph.
 *
 * It is a crude equirectangular gradient with a sun blob in it, run through
 * PMREM — which is all image-based lighting needs to be. What it buys is that
 * a white wing lit from below picks up the colour of the sea, and the same
 * wing against the sunset picks up the sunset. Those two things are most of
 * what makes stylised shading look expensive.
 */
export function environmentFromPalette(renderer, palette, { size = 128 } = {}) {
  const w = size, h = size / 2;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;

  const sun = palette.sunDir.clone().normalize();
  const tmp = new THREE.Color();

  for (let y = 0; y < h; y++) {
    // Equirectangular: rows are latitude from +90° down to −90°.
    const theta = (y / (h - 1)) * Math.PI;
    const cy = Math.cos(theta);
    const sy = Math.sin(theta);
    for (let x = 0; x < w; x++) {
      const phi = (x / w) * Math.PI * 2 - Math.PI;
      const dx = sy * Math.sin(phi), dz = sy * Math.cos(phi);

      let t = clamp((cy + 0.02) / 0.36, 0, 1);
      tmp.copy(palette.horizon).lerp(palette.sky, t * t * (3 - 2 * t));
      const t2 = clamp((cy - 0.20) / 0.72, 0, 1);
      tmp.lerp(palette.zenith, t2 * t2 * (3 - 2 * t2));
      if (cy < 0.02) {
        // Everything below the horizon is the colour the ground dissolves
        // into, which is what bounces back up onto a bird's underside.
        tmp.lerp(palette.haze, clamp(-(cy - 0.02) / 0.24, 0, 1) * 0.9);
      }

      const sd = Math.max(0, dx * sun.x + cy * sun.y + dz * sun.z);
      const glow = Math.pow(sd, 40) * 2.6 + Math.pow(sd, 5) * 0.35;
      tmp.r += palette.sunGlow.r * glow;
      tmp.g += palette.sunGlow.g * glow;
      tmp.b += palette.sunGlow.b * glow;

      const i = (y * w + x) * 4;
      d[i] = clamp(tmp.r, 0, 1) * 255;
      d[i + 1] = clamp(tmp.g, 0, 1) * 255;
      d[i + 2] = clamp(tmp.b, 0, 1) * 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(tex);
  pmrem.dispose();
  tex.dispose();
  return target.texture;
}

/* ═══════════════ sun and fill ═══════════════════════════ */

export class SkyLight {
  constructor(scene, style, palette, opts = {}) {
    this.scene = scene;
    this.style = style;

    this.sun = new THREE.DirectionalLight(palette.sunColor.clone(), opts.sunIntensity ?? 3.1);
    this.sun.position.copy(palette.sunDir).multiplyScalar(1000);
    this.sunTarget = new THREE.Object3D();
    scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;
    scene.add(this.sun);

    // Sky above, haze below — the bounce light, and the reason nothing in
    // shadow is ever grey.
    this.hemi = new THREE.HemisphereLight(
      palette.sky.clone(), palette.haze.clone(), opts.hemiIntensity ?? 0.55
    );
    scene.add(this.hemi);

    this.shadowRange = opts.shadowRange ?? 300;
    this.setShadows(opts.shadows ?? false, opts.shadowSize ?? 1024);
  }

  setShadows(on, size = 1024) {
    this.sun.castShadow = !!on;
    if (!on) return;
    const s = this.shadowRange;
    const c = this.sun.shadow.camera;
    c.left = -s; c.right = s; c.top = s; c.bottom = -s;
    c.near = 1; c.far = s * 6;
    c.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.7;
  }

  update(camPos) {
    this.sunTarget.position.copy(camPos);
    this.sunTarget.updateMatrixWorld();
    this.sun.position.copy(camPos).addScaledVector(this.style.u.uSunDir.value, this.shadowRange * 3);
    this.sun.updateMatrixWorld();
  }

  dispose() {
    this.scene.remove(this.sun, this.hemi, this.sunTarget);
    this.sun.dispose(); this.hemi.dispose();
  }
}

/* ═══════════════ billboard cumulus ══════════════════════ */

const CLOUD_VERT = /* glsl */`
  precision highp float;
  uniform vec3  uCamPos;
  uniform float uPlanetRadius, uTime, uFade;
  uniform vec2  uTile;
  uniform vec3  uDrift;

  attribute vec3  iPos;
  attribute vec2  iScale;
  attribute float iRot, iSeed, iOpacity;

  varying vec2  vUv;
  varying float vAlpha, vSeed, vDepth;
  varying vec3  vWorld;

  void main() {
    vec3 p = iPos + uDrift * uTime;
    vec2 rel = mod(p.xz - uCamPos.xz + uTile * 0.5, uTile) - uTile * 0.5;
    vec3 world = vec3(uCamPos.x + rel.x, p.y, uCamPos.z + rel.y);

    float dist = length(world - uCamPos);
    /* Fade a puff out before the camera can get inside it.
     *
     * A billboard is offset in VIEW space, so its centre is the only thing
     * with a depth. Let the camera approach a 700 m puff and that one quad
     * covers the entire frame at full opacity — which in a storm, with the
     * shade colour nearly black, blacks out the whole screen for as long as
     * it takes to fly past. Fading over the puff's own size, rather than over
     * a fixed eighty metres, means a big cloud starts getting out of the way
     * sooner than a small one. */
    float own = max(iScale.x, iScale.y);
    vAlpha = iOpacity * smoothstep(uFade, uFade * 0.5, dist)
                      * smoothstep(own * 0.45, own * 1.05, dist);

    vec2 d = world.xz - uCamPos.xz;
    world.y -= dot(d, d) / (2.0 * uPlanetRadius);
    vWorld = world;

    vec4 mv = viewMatrix * vec4(world, 1.0);
    // Behind the eye there is no valid projection for a billboard: w goes
    // negative, the quad turns inside out and fills the frame. Drop it.
    if (mv.z > -1.0 || vAlpha < 0.002) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vUv = uv; vSeed = iSeed; vDepth = 0.0;
      return;
    }
    float c = cos(iRot), s = sin(iRot);
    mv.xy += vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iScale;

    vUv = uv; vSeed = iSeed; vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const CLOUD_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uMap;
  uniform vec3 uSunDir, uLit, uShade, uCamPos, uHaze, uSunGlow;
  uniform float uFogDensity, uFogPower, uFogMax;
  varying vec2 vUv;
  varying float vAlpha, vSeed, vDepth;
  varying vec3 vWorld;

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float a = tex.a * vAlpha;
    if (a < 0.004) discard;

    vec3 vdir = normalize(vWorld - uCamPos);
    float toSun = max(dot(vdir, uSunDir), 0.0);

    // Thin edges facing the sun light up — the silver lining, which is most
    // of what makes a cloud look like it has a sun behind it.
    float rim = pow(toSun, 5.0) * pow(1.0 - tex.a, 1.4);
    vec3 col = mix(uShade, uLit, clamp(tex.r * 0.9 + rim * 0.8, 0.0, 1.0));
    col += uSunGlow * rim * 0.9;

    float f = clamp(1.0 - exp(-pow(max(vDepth, 0.0) * uFogDensity, uFogPower)), 0.0, uFogMax);
    col = mix(col, uHaze, f * 0.92);

    gl_FragColor = vec4(col, a);
  }
`;

export class Clouds {
  constructor(style, puffTexture, palette, opts = {}) {
    const count = opts.count ?? 800;
    const tile = opts.tile ?? 9000;
    const [altLo, altHi] = opts.altitude ?? [700, 1500];
    const clusters = opts.clusters ?? Math.max(8, Math.round(count / 20));
    const puffSize = opts.size ?? [260, 520];
    const r = rng(opts.seed ?? 99);
    const noise = new Noise(opts.seed ?? 99);

    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    geo.instanceCount = count;

    const iPos = new Float32Array(count * 3);
    const iScale = new Float32Array(count * 2);
    const iRot = new Float32Array(count);
    const iSeed = new Float32Array(count);
    const iOpacity = new Float32Array(count);

    const perCluster = Math.ceil(count / clusters);
    let n = 0;
    for (let c = 0; c < clusters && n < count; c++) {
      const cx = (r() - 0.5) * tile, cz = (r() - 0.5) * tile;
      const cy = altLo + (altHi - altLo) * r();
      const spreadX = 260 + r() * 980;
      const spreadY = 50 + r() * 170;
      const density = 0.55 + 0.45 * (0.5 + 0.5 * noise.simplex2(cx * 0.001, cz * 0.001));
      for (let k = 0; k < perCluster && n < count; k++, n++) {
        const ang = r() * Math.PI * 2;
        const rad = Math.pow(r(), 0.6);
        iPos[n * 3] = cx + Math.cos(ang) * rad * spreadX;
        iPos[n * 3 + 1] = cy + (r() - 0.5) * spreadY * (1 - rad * 0.6);
        iPos[n * 3 + 2] = cz + Math.sin(ang) * rad * spreadX * 0.8;
        const s = puffSize[0] + (puffSize[1] - puffSize[0]) * (1 - rad * 0.55) * (0.6 + 0.7 * r());
        iScale[n * 2] = s;
        iScale[n * 2 + 1] = s * (0.5 + 0.3 * r());
        iRot[n] = r() * Math.PI * 2;
        iSeed[n] = r() * 100;
        iOpacity[n] = clamp((0.3 + 0.55 * (1 - rad)) * density, 0, 1) * (opts.opacity ?? 1);
      }
    }

    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
    geo.setAttribute('iScale', new THREE.InstancedBufferAttribute(iScale, 2));
    geo.setAttribute('iRot', new THREE.InstancedBufferAttribute(iRot, 1));
    geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(iSeed, 1));
    geo.setAttribute('iOpacity', new THREE.InstancedBufferAttribute(iOpacity, 1));

    this.uniforms = {
      uMap: { value: puffTexture },
      uTime: { value: 0 },
      uTile: { value: new THREE.Vector2(tile, tile) },
      uDrift: { value: new THREE.Vector3(...(opts.drift ?? [3.5, 0, 1.2])) },
      uFade: { value: opts.fade ?? 11000 },
      uLit: { value: palette.cloudLit.clone() },
      uShade: { value: palette.cloudShade.clone() },
      uHaze: { value: palette.haze.clone() },
      uSunGlow: { value: palette.sunGlow.clone() },
      // Shared with every other stylised material, so weather moves all of
      // it together.
      uCamPos: style.u.uCamPos,
      uPlanetRadius: style.u.uPlanetRadius,
      uSunDir: style.u.uSunDir,
      uFogDensity: style.u.uFogDensity,
      uFogPower: style.u.uFogPower,
      uFogMax: style.u.uFogMax,
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    base.dispose();
  }

  update(dt) { this.uniforms.uTime.value += dt; }
  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}
