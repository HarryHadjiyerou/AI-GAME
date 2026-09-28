// Global shader uniforms + material patching for the "mini planet" curvature and height fog.
import * as THREE from 'three';

export const G = {
  uCurve: { value: 1 / (2 * 20000) },
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.6, 0.4).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
  uFogColor: { value: new THREE.Color(0.6, 0.7, 0.8) },
  uFogSunColor: { value: new THREE.Color(1.0, 0.85, 0.6) },
  uFogDensity: { value: 0.00012 }, // ground level density (height fog)
  uFogFalloff: { value: 0.0012 }, // exponential falloff with altitude
  uFogBase: { value: 0 },
  uHaze: { value: 0.00002 }, // uniform aerial perspective
  uMist: { value: 0 }, // extra low-lying mist density
  uMistTop: { value: 60 },
  uCamPos: { value: new THREE.Vector3() },
};

export const CURVE_VERT_PARS = /* glsl */ `
uniform float uCurve;
varying vec3 vFogWorld;
vec4 curveWorld(vec4 w) {
  vec2 d = w.xz - cameraPosition.xz;
  w.y -= dot(d, d) * uCurve;
  return w;
}
`;

const PROJECT_VERTEX = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
vec4 aWorld = modelMatrix * mvPosition;
vFogWorld = aWorld.xyz;
aWorld = curveWorld(aWorld);
mvPosition = viewMatrix * aWorld;
gl_Position = projectionMatrix * mvPosition;
`;

export const FOG_FRAG_PARS = /* glsl */ `
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform vec3 uSunDir;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform float uFogBase;
uniform float uHaze;
uniform float uMist;
uniform float uMistTop;
varying vec3 vFogWorld;

float heightFogIntegral(vec3 ro, vec3 rd, float L, float a, float b, float base) {
  // Optical depth of density a*exp(-b*(h-base)) along the ray. Written as a difference of two
  // exponentials of absolute heights so long downward rays cannot overflow to Inf/NaN.
  if (a <= 0.0) return 0.0;
  float h0 = max(ro.y - base, -60.0);
  float h1 = max(ro.y + rd.y * L - base, -60.0);
  float e0 = exp(-b * h0);
  if (abs(rd.y) < 1e-3) return a * e0 * L;
  float e1 = exp(-b * h1);
  return max(a * (e0 - e1) / (b * rd.y), 0.0);
}

vec3 applyFog(vec3 col, vec3 wpos) {
  vec3 ro = cameraPosition;
  vec3 dv = wpos - ro;
  float L = length(dv);
  vec3 rd = dv / max(L, 1e-3);
  float od = heightFogIntegral(ro, rd, L, uFogDensity, uFogFalloff, uFogBase);
  od += heightFogIntegral(ro, rd, L, uMist, 1.0 / max(uMistTop, 1.0) * 2.3, uFogBase);
  od += uHaze * L;
  float T = exp(-od);
  float s = max(dot(rd, uSunDir), 0.0);
  vec3 fc = mix(uFogColor, uFogSunColor, pow(s, 6.0) * 0.8);
  return mix(fc, col, T);
}
`;

// Patch a built-in three.js material. `extra` lets callers compose further changes.
export function patchMaterial(mat, extra, cacheKey = '') {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, G);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + CURVE_VERT_PARS)
      .replace('#include <project_vertex>', PROJECT_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FOG_FRAG_PARS)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vFogWorld);');
    if (prev) prev(shader, renderer);
    if (extra) extra(shader, renderer);
  };
  mat.customProgramCacheKey = () => 'aves|' + cacheKey;
  return mat;
}

export function patchObject(obj) {
  obj.traverse((o) => {
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (!m.userData.avesPatched) { patchMaterial(m); m.userData.avesPatched = true; } });
    }
  });
}
