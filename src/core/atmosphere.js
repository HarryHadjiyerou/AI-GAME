/* ═══════════════════════════════════════════════════════════
   Atmosphere & planet curvature.

   Two effects, injected into every material in the scene so that
   terrain, trees, buildings, water and clouds all agree with each
   other:

   1. CURVATURE — the world is bent downwards by d²/2R around the
      camera, where d is horizontal distance and R the planet radius.
      This is a rendering trick, not a physics change: the simulation
      still runs on a flat plane. What it buys is the thing that makes
      the mini-planet read — a horizon that visibly falls away, and
      distant peaks that sink instead of marching to infinity.

   2. AERIAL PERSPECTIVE — exponential fog with a height falloff and
      a forward-scattering lobe, so haze thins as you climb and glows
      when you fly into the sun. Cheap, and it does most of the work
      of selling scale.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';

export const ATMO_UNIFORMS_GLSL = /* glsl */`
  uniform vec3  uCamPos;
  uniform float uPlanetRadius;
  uniform vec3  uSunDir;
  uniform vec3  uFogColor;
  uniform vec3  uFogSunColor;
  uniform float uFogDensity;
  uniform float uFogPower;
  uniform float uFogHeightBase;
  uniform float uFogHeightFalloff;
  uniform float uFogHeightMix;
  uniform float uFogMax;
`;

/** Bend a world-space position down around the camera. */
export const CURVE_GLSL = /* glsl */`
  vec3 avesCurve(vec3 worldPos, vec3 camPos, float R) {
    vec2 d = worldPos.xz - camPos.xz;
    float d2 = dot(d, d);
    worldPos.y -= d2 / (2.0 * R);
    return worldPos;
  }
`;

/** Apply fog to a linear-space colour. */
export const FOG_GLSL = /* glsl */`
  vec3 avesFog(vec3 color, vec3 worldPos, float viewDepth) {
    float f = 1.0 - exp(-pow(max(viewDepth, 0.0) * uFogDensity, uFogPower));
    float h = exp(-max(0.0, worldPos.y - uFogHeightBase) / uFogHeightFalloff);
    f *= mix(1.0, h, uFogHeightMix);
    f = clamp(f, 0.0, uFogMax);
    vec3 vdir = normalize(worldPos - uCamPos);
    float sun = pow(max(dot(vdir, uSunDir), 0.0), 6.0);
    vec3 fogCol = mix(uFogColor, uFogSunColor, sun * 0.85);
    return mix(color, fogCol, f);
  }
`;

/**
 * Shared uniform objects. Every patched material references the *same*
 * uniform instances, so updating the atmosphere is one assignment, not
 * a walk over the scene graph.
 */
export class Atmosphere {
  constructor(scene) {
    this.scene = scene;
    this.u = {
      uCamPos:           { value: new THREE.Vector3() },
      uPlanetRadius:     { value: 14000 },
      uSunDir:           { value: new THREE.Vector3(0.4, 0.5, 0.6).normalize() },
      uFogColor:         { value: new THREE.Color('#9db6c8') },
      uFogSunColor:      { value: new THREE.Color('#ffd9a8') },
      uFogDensity:       { value: 1 / 4200 },
      uFogPower:         { value: 1.6 },
      uFogHeightBase:    { value: 0 },
      uFogHeightFalloff: { value: 900 },
      uFogHeightMix:     { value: 0.85 },
      uFogMax:           { value: 1.0 },
      uTime:             { value: 0 },
    };
    // three needs *a* fog on the scene for USE_FOG to be defined; the real
    // computation is ours, this only switches the define on.
    scene.fog = new THREE.FogExp2(0x9db6c8, 0.0001);
    this._patched = new WeakSet();
  }

  configure(cfg = {}) {
    const u = this.u;
    if (cfg.planetRadius !== undefined) u.uPlanetRadius.value = cfg.planetRadius;
    if (cfg.sunDir)       u.uSunDir.value.copy(cfg.sunDir).normalize();
    if (cfg.fogColor)     { u.uFogColor.value.set(cfg.fogColor); this.scene.fog.color.set(cfg.fogColor); }
    if (cfg.fogSunColor)  u.uFogSunColor.value.set(cfg.fogSunColor);
    if (cfg.fogDensity !== undefined)   u.uFogDensity.value = cfg.fogDensity;
    if (cfg.fogPower !== undefined)     u.uFogPower.value = cfg.fogPower;
    if (cfg.fogHeightBase !== undefined) u.uFogHeightBase.value = cfg.fogHeightBase;
    if (cfg.fogHeightFalloff !== undefined) u.uFogHeightFalloff.value = cfg.fogHeightFalloff;
    if (cfg.fogHeightMix !== undefined) u.uFogHeightMix.value = cfg.fogHeightMix;
    if (cfg.fogMax !== undefined)       u.uFogMax.value = cfg.fogMax;
    return this;
  }

  update(camera, dt) {
    this.u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    this.u.uTime.value += dt;
  }

  /** Merge the shared atmosphere uniforms into a custom ShaderMaterial's set. */
  uniformsFor(extra = {}) {
    return Object.assign({}, this.u, extra);
  }

  /**
   * Patch a stock three.js material (Standard/Physical/Lambert/Basic) so it
   * curves with the planet and takes our fog.
   */
  patch(material, { curve = true, fog = true, tag = '', onShader = null } = {}) {
    if (!material || this._patched.has(material)) return material;
    this._patched.add(material);
    material.fog = true;

    const u = this.u;
    const prev = material.onBeforeCompile;

    material.onBeforeCompile = (shader, renderer) => {
      Object.assign(shader.uniforms, u);

      shader.vertexShader = `
        ${ATMO_UNIFORMS_GLSL}
        ${CURVE_GLSL}
        varying vec3 vAvesWorld;
      ` + shader.vertexShader;

      // Replace project_vertex wholesale: we need the world position before
      // the view transform so the bend happens around world-up, not view-up
      // (the bird rolls; the planet does not).
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        /* glsl */`
        vec4 avesLocal = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          avesLocal = instanceMatrix * avesLocal;
        #endif
        vec4 avesWorld = modelMatrix * avesLocal;
        vAvesWorld = avesWorld.xyz;
        ${curve ? 'avesWorld.xyz = avesCurve(avesWorld.xyz, uCamPos, uPlanetRadius);' : ''}
        vec4 mvPosition = viewMatrix * avesWorld;
        gl_Position = projectionMatrix * mvPosition;
        `
      );

      if (fog) {
        shader.fragmentShader = `
          ${ATMO_UNIFORMS_GLSL}
          ${FOG_GLSL}
          varying vec3 vAvesWorld;
        ` + shader.fragmentShader;

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <fog_fragment>',
          'gl_FragColor.rgb = avesFog( gl_FragColor.rgb, vAvesWorld, vFogDepth );'
        );
      } else {
        shader.fragmentShader = 'varying vec3 vAvesWorld;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', '');
      }

      if (onShader) onShader(shader, renderer);
      material.userData.shader = shader;
      if (prev) prev.call(material, shader, renderer);
    };

    // Distinct cache key or three will hand us a program compiled without the patch.
    material.customProgramCacheKey = () => `aves|${curve ? 'c' : ''}${fog ? 'f' : ''}|${tag}`;
    material.needsUpdate = true;
    return material;
  }

  /** Patch every material found under an object. */
  patchTree(root, opts) {
    root.traverse((o) => {
      if (!o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => this.patch(m, opts));
    });
    return root;
  }
}
