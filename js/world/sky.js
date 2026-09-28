// Sky dome: Poly Haven sky photo + HDR sun disc, blended into fog colour at and below the horizon.
import * as THREE from 'three';
import { G } from '../core/shaderPatch.js';

export function createSky(skyTex, skyBoost = 1.0) {
  const geo = new THREE.SphereGeometry(1, 48, 24);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tSky: { value: skyTex },
      uBoost: { value: skyBoost },
      uSunDir: G.uSunDir,
      uSunColor: G.uSunColor,
      uFogColor: G.uFogColor,
      uFogSunColor: G.uFogSunColor,
      uHorizonDrop: { value: 0 },
      uStorm: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSky;
      uniform float uBoost, uHorizonDrop, uStorm;
      uniform vec3 uSunDir, uSunColor, uFogColor, uFogSunColor;
      varying vec3 vDir;
      #define PI 3.141592653589793
      void main() {
        vec3 d = normalize(vDir);
        // horizon sinks as we climb on the mini-planet
        float y = d.y + uHorizonDrop;
        vec3 sd = normalize(vec3(d.x, max(abs(y), 0.002), d.z));
        vec2 uv = vec2(atan(sd.z, sd.x) / (2.0 * PI) + 0.5, asin(clamp(sd.y, -1.0, 1.0)) / PI + 0.5);
        vec3 c = texture2D(tSky, uv).rgb * uBoost;
        // Recover some HDR range from the tonemapped photo.
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c *= 1.0 + smoothstep(0.6, 1.0, l) * 1.5;
        float s = max(dot(d, uSunDir), 0.0);
        c += uSunColor * (pow(s, 2200.0) * 60.0 + pow(s, 90.0) * 0.8 + pow(s, 8.0) * 0.12);
        float s2 = pow(s, 6.0);
        vec3 fogc = mix(uFogColor, uFogSunColor, s2 * 0.8);
        float hz = smoothstep(0.09, -0.02, y);
        c = mix(c, fogc, hz);
        c = mix(c, vec3(dot(c, vec3(0.3))) * 0.35, uStorm);
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthWrite: false,
    depthTest: false,
    side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}
