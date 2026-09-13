/* ═══════════════════════════════════════════════════════════
   Stylised shading.

   This replaces the physically-based path completely. Not because PBR
   is wrong, but because PBR is *honest*, and honest light on a
   hillside eight kilometres away is grey. Every trick below is a
   landscape painter's, not a photographer's:

     • BANDED SUN — the sun term is quantised into three or four steps
       with a soft terminator, which is what makes a hillside read as
       shape rather than as a smooth gradient.

     • COLOURED SHADOW — nothing unlit is ever grey or black. Shadow
       takes the colour of the sky above it, which is what your eye
       actually sees outdoors and what a grey shadow always gets wrong.

     • RIM LIGHT — a bright edge wherever a surface turns away from
       you, tinted warm. It separates one ridge from the next without
       any need for shadow maps, and it is why nothing here casts one.

     • DISSOLVE TO COLOUR — distance fades towards a chosen hue, not
       towards white. A far ridge going violet is the oldest depth cue
       there is.

   No shadow maps, no image textures, no environment probes on the
   terrain. It runs fast on a phone because there is almost nothing in
   it, and it looks better than the version that had all three.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';

/* Shared declarations and helpers, prepended to every stylised shader. */
export const STYLE_PARS = /* glsl */`
  uniform vec3  uCamPos;
  uniform float uPlanetRadius;
  uniform vec3  uSunDir, uSunColor, uRimColor;
  uniform vec3  uSkyColor, uBounceColor;
  uniform vec3  uHaze, uSunGlow;
  uniform float uSunStrength, uAmbStrength, uRimStrength, uRimPower;
  uniform float uBands, uBandMix;
  uniform float uFogDensity, uFogPower, uFogHeightBase, uFogHeightFalloff, uFogHeightMix, uFogMax;
  uniform float uTime;

  float sHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float sNoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(sHash(i), sHash(i + vec2(1,0)), f.x),
               mix(sHash(i + vec2(0,1)), sHash(i + vec2(1,1)), f.x), f.y);
  }
  float sFbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++){ v += a * sNoise(p); p = p * 2.03 + 11.0; a *= 0.5; }
    return v;
  }
`;

/** Bend a world position down around the camera — the mini-planet horizon. */
export const CURVE_GLSL = /* glsl */`
  vec3 avesCurve(vec3 wp, vec3 cam, float R) {
    vec2 d = wp.xz - cam.xz;
    wp.y -= dot(d, d) / (2.0 * R);
    return wp;
  }
`;

/** The whole lighting model, in one function. */
export const SHADE_GLSL = /* glsl */`
  vec3 avesShade(vec3 albedo, vec3 N, vec3 wpos, float ao) {
    vec3 V = normalize(uCamPos - wpos);
    float ndl = dot(N, uSunDir);

    // Wrapped, then quantised. Wrapping first means the terminator sits in
    // the middle of the range instead of at zero, so the bands land where
    // the form actually turns.
    float w = ndl * 0.5 + 0.5;
    float q = floor(w * uBands) / max(1.0, uBands - 1.0);
    float lit = mix(w, clamp(q, 0.0, 1.0), uBandMix);

    // Sky above, bounce from the ground below. This is the whole reason
    // nothing in shadow goes grey.
    vec3 ambient = mix(uBounceColor, uSkyColor, N.y * 0.5 + 0.5);

    vec3 col = albedo * (uSunColor * lit * uSunStrength + ambient * uAmbStrength);
    col *= mix(1.0, ao, 0.85);

    // Rim: brightest where the surface turns away, and only on the lit side,
    // otherwise every silhouette glows including the ones facing away.
    float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), uRimPower);
    col += uRimColor * rim * uRimStrength * smoothstep(-0.45, 0.35, ndl);

    return col;
  }
`;

/** Aerial perspective — towards a colour, with a height falloff. */
export const FOG_GLSL = /* glsl */`
  vec3 avesFog(vec3 color, vec3 wpos, float viewDepth) {
    float f = 1.0 - exp(-pow(max(viewDepth, 0.0) * uFogDensity, uFogPower));
    float hf = exp(-max(0.0, wpos.y - uFogHeightBase) / uFogHeightFalloff);
    f *= mix(1.0, hf, uFogHeightMix);
    f = clamp(f, 0.0, uFogMax);

    // Looking into the sun, the haze lights up. Looking away it stays cool.
    vec3 vdir = normalize(wpos - uCamPos);
    float sun = pow(max(dot(vdir, uSunDir), 0.0), 4.0);
    vec3 hz = mix(uHaze, uHaze + uSunGlow * 0.7, sun * 0.85);

    return mix(color, hz, f);
  }
`;

/**
 * The vertex body every stylised material shares. `hook` is GLSL spliced in
 * with `pos` and `nrm` in scope, which is how wind, waves and wing flex get in.
 */
const vertexCore = (hook = '') => /* glsl */`
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vDepth;

  void main() {
    vec3 pos = position;
    vec3 nrm = normal;
    ${hook}

    vec4 local = vec4(pos, 1.0);
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
      nrm = mat3(instanceMatrix) * nrm;
    #endif

    vec4 world = modelMatrix * local;
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * nrm);

    world.xyz = avesCurve(world.xyz, uCamPos, uPlanetRadius);
    vec4 mv = viewMatrix * world;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

/**
 * Build the shared uniform block. Every stylised material references the same
 * objects, so restyling the world is one assignment rather than a scene walk.
 */
export function styleUniforms(palette, opts = {}) {
  return {
    uCamPos: { value: new THREE.Vector3() },
    uPlanetRadius: { value: opts.planetRadius ?? 70000 },
    uSunDir: { value: palette.sunDir.clone().normalize() },
    uSunColor: { value: palette.sunColor.clone() },
    uRimColor: { value: palette.rim.clone() },
    uSkyColor: { value: palette.sky.clone() },
    uBounceColor: { value: palette.shadow.clone() },
    uHaze: { value: palette.haze.clone() },
    uSunGlow: { value: palette.sunGlow.clone() },
    uSunStrength: { value: opts.sunStrength ?? 1.05 },
    uAmbStrength: { value: opts.ambStrength ?? 0.62 },
    uRimStrength: { value: opts.rimStrength ?? 0.40 },
    uRimPower: { value: opts.rimPower ?? 3.2 },
    uBands: { value: opts.bands ?? 4 },
    uBandMix: { value: opts.bandMix ?? 0.72 },
    uFogDensity: { value: palette.fogDensity ?? 1 / 5000 },
    uFogPower: { value: palette.fogPower ?? 1.45 },
    uFogHeightBase: { value: opts.fogHeightBase ?? 0 },
    uFogHeightFalloff: { value: opts.fogHeightFalloff ?? 1200 },
    uFogHeightMix: { value: opts.fogHeightMix ?? 0.55 },
    uFogMax: { value: opts.fogMax ?? 0.94 },
    uTime: { value: 0 },
  };
}

/**
 * Assemble a stylised material.
 *
 * `albedo` is a GLSL snippet run in the fragment shader with `vWorld`,
 * `vNormalW` and `vDepth` in scope. It must assign `albedo`, and may assign
 * `alpha`, `ao`, `N` and `emissive`.
 */
export function stylisedMaterial({
  uniforms, albedo, vertexHook = null, pars = '', vertexPars = '',
  transparent = false, alphaTest = 0, side = THREE.FrontSide,
  depthWrite = true, name = 'aves',
}) {
  const vertexShader = `
    ${STYLE_PARS}
    ${CURVE_GLSL}
    ${vertexPars}
    ${vertexCore(vertexHook ?? '')}
  `;

  const fragmentShader = `
    precision highp float;
    ${STYLE_PARS}
    ${SHADE_GLSL}
    ${FOG_GLSL}
    ${pars}
    varying vec3 vWorld;
    varying vec3 vNormalW;
    varying float vDepth;

    void main() {
      vec3 N = normalize(vNormalW);
      vec3 albedo = vec3(0.5);
      float alpha = 1.0;
      float ao = 1.0;
      vec3 emissive = vec3(0.0);

      ${albedo}

      #ifdef AVES_ALPHATEST
        if (alpha < AVES_ALPHATEST) discard;
      #endif

      vec3 col = avesShade(albedo, N, vWorld, ao) + emissive;
      col = avesFog(col, vWorld, vDepth);
      gl_FragColor = vec4(col, alpha);
    }
  `;

  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent, side, depthWrite,
    defines: alphaTest > 0 ? { AVES_ALPHATEST: alphaTest.toFixed(3) } : {},
  });
  mat.name = name;
  return mat;
}

/**
 * Keeps every stylised material pointed at the same sun, the same haze and
 * the same camera, and lets weather move all of it at once.
 */
export class StyleSystem {
  constructor(palette, opts = {}) {
    this.palette = palette;
    this.u = styleUniforms(palette, opts);
    this.materials = new Set();
  }

  /** Register a material so it follows palette and weather changes. */
  track(mat) { this.materials.add(mat); return mat; }

  make(spec) {
    return this.track(stylisedMaterial({ ...spec, uniforms: { ...this.u, ...(spec.extra ?? {}) } }));
  }

  update(camera, dt) {
    this.u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    this.u.uTime.value += dt;
  }

  dispose() {
    for (const m of this.materials) m.dispose();
    this.materials.clear();
  }
}
