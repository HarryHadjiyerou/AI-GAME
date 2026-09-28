// Streaming quadtree terrain. Chunks are built in workers and textured with a splat shader.
import * as THREE from 'three';
import { patchMaterial, G } from '../core/shaderPatch.js';
import { CITY } from './fields.js';

const N = 64; // segments per chunk
const MIN_SIZE = 256;
const ROOT = 16384;
const LOD_K = 1.0;

function buildIndex(N) {
  const idx = [];
  const W = N + 1;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * W + i, b = (j + 1) * W + i, c = j * W + i + 1, d = (j + 1) * W + i + 1;
    idx.push(a, b, c, c, b, d);
  }
  const V = W * W, S = 4 * W;
  for (let k = 0; k < S - 1; k++) {
    // Edge ring order is built in the worker; emit both windings so skirts are visible from any side.
    const e0 = edgeIndex(k, N), e1 = edgeIndex(k + 1, N);
    const s0 = V + k, s1 = V + k + 1;
    idx.push(e0, s0, e1, e1, s0, s1, e0, e1, s0, e1, s1, s0);
  }
  return new THREE.BufferAttribute(new Uint16Array(idx), 1);
}
function edgeIndex(k, N) {
  const W = N + 1;
  if (k < W) return k;
  k -= W; if (k < W) return k * W + N;
  k -= W; if (k < W) return N * W + (N - k);
  k -= W; return (N - k) * W;
}

// Linear albedo normalisation per Poly Haven texture (measured averages -> plausible real albedos).
const GAIN = { grass: 1.55, forestfloor: 1.15, rock: 3.2, cliff: 1.8, snow: 3.1, sand: 1.55, asphalt: 1.2 };

export function createTerrainMaterial(tex, biome) {
  const L = biome.layers;
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, envMapIntensity: 0.7 });
  const uniforms = {
    tBaseD: { value: tex[L.base + '_diff'] }, tBaseN: { value: tex[L.base + '_nor'] },
    tSecD: { value: tex[L.sec + '_diff'] }, tSecN: { value: tex[L.sec + '_nor'] },
    tRockD: { value: tex[L.rock + '_diff'] }, tRockN: { value: tex[L.rock + '_nor'] },
    tTopD: { value: tex[L.top + '_diff'] }, tTopN: { value: tex[L.top + '_nor'] },
    tNoise: { value: tex.noise },
    uScales: { value: new THREE.Vector4(...L.scales) },
    uTints: { value: L.tints.map((c, i) => new THREE.Color(c).multiplyScalar(GAIN[[L.base, L.sec, L.rock, L.top][i]] || 1)) },
    uSecSel: { value: new THREE.Vector4(...L.secSel) },
    uWetSel: { value: new THREE.Vector4(...L.wetSel) },
    uCanopy: { value: new THREE.Color(L.canopy) },
    uCanopyAmt: { value: L.canopyAmt },
    uRockSlope: { value: new THREE.Vector2(...L.rockSlope) },
    uCity: { value: biome.id === 'city' ? 1 : 0 },
    uCityGrid: { value: new THREE.Vector2(CITY.PITCH, CITY.ROAD) },
    tAsphalt: { value: tex.asphalt_diff },
    uWaterLevel: { value: 0 },
    uStrata: { value: biome.id === 'forest' ? 1 : 0 },
    uDebug: { value: 0 },
    uBounce: { value: new THREE.Color(biome.bounce || 0x6a5040) },
  };
  patchMaterial(mat, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 masks;\nattribute vec2 light;\nvarying vec4 vMasks;\nvarying vec3 vWN;\nvarying vec2 vLight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMasks = masks;\nvWN = normal;\nvLight = light;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TERRAIN_PARS)
      .replace('#include <map_fragment>', TERRAIN_MAP)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = splatRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(splatN, 0.0)).xyz);')
      .replace('#include <aomap_fragment>', TERRAIN_LIGHT);
  }, 'terrain');
  mat.userData.uniforms = uniforms;
  return mat;
}

const TERRAIN_PARS = /* glsl */ `
uniform sampler2D tBaseD, tBaseN, tSecD, tSecN, tRockD, tRockN, tTopD, tTopN, tNoise, tAsphalt;
uniform vec4 uScales;
uniform vec3 uTints[4];
uniform vec4 uSecSel, uWetSel;
uniform vec3 uCanopy;
uniform float uCanopyAmt, uCity, uWaterLevel, uStrata, uDebug;
uniform vec3 uBounce;
varying vec2 vLight;
uniform vec2 uRockSlope, uCityGrid;
varying vec4 vMasks;
varying vec3 vWN;

vec3 unpackN(vec4 t) { return t.xyz * 2.0 - 1.0; }
// Two-scale sampling to break tiling.
vec3 sampleD(sampler2D t, vec2 uv, float blend) {
  vec3 a = texture2D(t, uv).rgb;
  vec3 b = texture2D(t, uv * 0.21 + 0.37).rgb;
  return mix(a, b, blend);
}
`;

const TERRAIN_MAP = /* glsl */ `
vec3 wp = vFogWorld;
vec3 wn = normalize(vWN);
float dist = length(wp - cameraPosition);
vec4 nz = texture2D(tNoise, wp.xz / 1800.0);
vec4 nz2 = texture2D(tNoise, wp.xz / 230.0);
float far = smoothstep(150.0, 900.0, dist);
float slope = 1.0 - wn.y;
float wRock = smoothstep(uRockSlope.x, uRockSlope.y, slope + (nz2.r - 0.5) * 0.12);
float wTop = clamp(vMasks.z * (1.0 - wRock * 0.8), 0.0, 1.0);
float wSec = clamp(dot(vMasks, uSecSel) + (nz.g - 0.5) * 0.35, 0.0, 1.0);
float wet = clamp(dot(vMasks, uWetSel), 0.0, 1.0);

vec2 uvB = wp.xz / uScales.x;
vec2 uvS = wp.xz / uScales.y;
vec2 uvT = wp.xz / uScales.w;
float mixFar = mix(0.35, 0.8, far);
vec3 cBase = sampleD(tBaseD, uvB, mixFar) * uTints[0];
vec3 nBase = unpackN(texture2D(tBaseN, uvB));
vec3 cSec = sampleD(tSecD, uvS, mixFar) * uTints[1];
vec3 nSec = unpackN(texture2D(tSecN, uvS));
vec3 col = mix(cBase, cSec, wSec);
vec3 tn = mix(nBase, nSec, wSec);
vec3 splatNW = normalize(wn + vec3(tn.x, 0.0, -tn.y) * 0.9);

if (wTop > 0.01) {
  vec3 cT = sampleD(tTopD, uvT, mixFar) * uTints[3];
  vec3 nT = unpackN(texture2D(tTopN, uvT));
  col = mix(col, cT, wTop);
  splatNW = normalize(mix(splatNW, normalize(wn + vec3(nT.x, 0.0, -nT.y) * 0.6), wTop));
}
if (wRock > 0.01) {
  // Biplanar projection for cliffs.
  vec3 an = abs(wn);
  vec2 uvX = wp.zy / uScales.z, uvZ = wp.xy / uScales.z, uvY = wp.xz / uScales.z;
  vec3 wts = pow(an, vec3(4.0)); wts /= (wts.x + wts.y + wts.z);
  vec3 cR = sampleD(tRockD, uvX, 0.3) * wts.x + sampleD(tRockD, uvZ, 0.3) * wts.z + sampleD(tRockD, uvY, 0.3) * wts.y;
  cR = mix(cR, vec3(dot(cR, vec3(0.2126, 0.7152, 0.0722))), 0.6); // the scans are yellowish; bias towards grey stone
  vec3 nX = unpackN(texture2D(tRockN, uvX));
  vec3 nZ = unpackN(texture2D(tRockN, uvZ));
  vec3 rN = normalize(wn + (vec3(0.0, nX.y, nX.x) * sign(wn.x) * wts.x + vec3(nZ.x, nZ.y, 0.0) * sign(wn.z) * wts.z) * 1.2);
  cR *= uTints[2];
  // Snow settles on the rock too at high altitude
  cR = mix(cR, cR * 0.4 + vec3(0.75), vMasks.z * 0.5);
  col = mix(col, cR, wRock);
  splatNW = normalize(mix(splatNW, rN, wRock));
}

// City streets drawn procedurally from the block grid
if (uCity > 0.5 && vMasks.z < 0.5) {
  vec2 lp = mod(wp.xz, uCityGrid.x);
  vec2 dr = min(lp, uCityGrid.x - lp);
  float hw = uCityGrid.y * 0.5;
  float road = 1.0 - step(hw, min(dr.x, dr.y));
  float walk = (1.0 - step(hw + 4.0, min(dr.x, dr.y))) * (1.0 - road);
  vec3 asph = texture2D(tAsphalt, wp.xz / 14.0).rgb * vec3(0.55, 0.55, 0.58);
  // lane markings
  float centre = (1.0 - step(0.18, min(dr.x, dr.y))) * step(0.5, fract((dr.x < dr.y ? wp.z : wp.x) / 9.0));
  asph = mix(asph, vec3(0.85, 0.75, 0.35), centre * road);
  vec3 plaza = vec3(0.55, 0.53, 0.5) * (0.85 + 0.3 * nz2.b);
  vec3 cityCol = mix(plaza, col, vMasks.x); // park = natural ground
  cityCol = mix(cityCol, vec3(0.68, 0.66, 0.62) * (0.9 + 0.2 * nz2.a), walk);
  cityCol = mix(cityCol, asph, road);
  col = mix(col, cityCol, 1.0 - wRock);
}

// Layered sandstone (canyon walls, mesas) on arid ground
if (uStrata > 0.5 && vMasks.w > 0.02) {
  float hb = wp.y / 120.0 + (nz.g - 0.5) * 0.9 + nz2.r * 0.25;
  float band = fract(hb);
  vec3 s1 = vec3(0.60, 0.26, 0.15), s2 = vec3(0.80, 0.47, 0.27), s3 = vec3(0.90, 0.74, 0.55), s4 = vec3(0.47, 0.22, 0.16);
  vec3 strata = band < 0.25 ? mix(s1, s2, band * 4.0) : band < 0.5 ? mix(s2, s3, (band - 0.25) * 4.0) : band < 0.75 ? mix(s3, s4, (band - 0.5) * 4.0) : mix(s4, s1, (band - 0.75) * 4.0);
  float lum = dot(col, vec3(0.3, 0.55, 0.15));
  // desert varnish: dark vertical streaks down the cliff faces
  vec2 tng = normalize(vec2(-wn.z, wn.x) + 1e-4);
  float along = dot(wp.xz, tng);
  float streak = texture2D(tNoise, vec2(along / 70.0, wp.y / 900.0)).b;
  vec3 rockA = strata * (0.5 + lum * 1.2) * mix(1.0, 0.55 + 0.45 * smoothstep(0.25, 0.65, streak), wRock);
  // ledges catch light, undercuts are darker
  rockA *= 0.85 + 0.3 * smoothstep(0.6, 0.95, wn.y);
  vec3 dirt = vec3(0.58, 0.3, 0.17) * (0.55 + lum * 0.9);
  vec3 arid = mix(dirt, rockA, max(wRock, 0.25));
  col = mix(col, arid, vMasks.w * (1.0 - wTop));
}
// Far forest canopy tint (trees become texture at distance)
float canopy = vMasks.x * uCanopyAmt * smoothstep(250.0, 1300.0, dist);
vec3 canCol = uCanopy * (0.55 + 0.9 * nz2.r * nz.b);
col = mix(col, canCol, canopy);
splatNW = normalize(mix(splatNW, normalize(wn + (nz2.rgb - 0.5) * vec3(0.8, 0.0, 0.8)), canopy));

// Macro colour variation: brightness, lush/dry hue drift, darker hollows
col *= 0.72 + 0.56 * nz.r;
col = mix(col, col * vec3(1.12, 1.0, 0.7), smoothstep(0.55, 0.85, nz.a) * (1.0 - wRock) * 0.6);
col = mix(col, col * vec3(0.7, 0.95, 0.8), smoothstep(0.5, 0.2, nz.b) * (1.0 - wRock) * 0.5);
col *= mix(0.8, 1.0, smoothstep(0.35, 0.9, wn.y));
// Wet banks
col = mix(col, col * vec3(0.55, 0.6, 0.62), wet * (1.0 - wTop));
// Underwater absorption (seen through the water surface)
float depth = uWaterLevel - wp.y;
if (depth > 0.0) col *= exp(-depth * vec3(0.35, 0.12, 0.08));

vec3 splatN = splatNW;
float splatRough = mix(0.95, 0.6, wet) - wTop * 0.25;
diffuseColor.rgb *= col;
if (uDebug > 0.5) diffuseColor.rgb = uDebug < 1.5 ? vec3(wRock, vLight.x, vLight.y) : wn * 0.5 + 0.5;
`;

const TERRAIN_LIGHT = /* glsl */ `
#include <aomap_fragment>
// Baked height-field ray-march: sun shadow + sky visibility (x, y)
float sunVis = smoothstep(0.0, 1.0, vLight.x);
float skyVis = vLight.y;
reflectedLight.directDiffuse *= sunVis;
reflectedLight.directSpecular *= sunVis;
float amb = mix(0.18, 1.0, skyVis * skyVis);
reflectedLight.indirectDiffuse *= amb;
reflectedLight.indirectSpecular *= amb;
// warm light bouncing off sunlit canyon walls into the shadows
reflectedLight.indirectDiffuse += diffuseColor.rgb * uBounce * (1.0 - skyVis) * 0.25 * (1.0 - sunVis * 0.5);
if (uDebug > 0.5) { reflectedLight.directDiffuse = vec3(0.0); reflectedLight.directSpecular = vec3(0.0); reflectedLight.indirectSpecular = vec3(0.0); reflectedLight.indirectDiffuse = diffuseColor.rgb; }
`;

export class Terrain {
  constructor(scene, pool, material, opts = {}) {
    this.scene = scene;
    this.pool = pool;
    this.material = material;
    this.index = buildIndex(N);
    this.chunks = new Map(); // key -> {mesh, x, z, size, state}
    this.group = new THREE.Group();
    scene.add(this.group);
    this.viewDist = opts.viewDist || 22000;
    this.lastPlan = new THREE.Vector3(1e9, 0, 0);
    this.desired = [];
    this.inflight = 0;
    this.maxInflight = opts.maxInflight || 6;
    this.ready = false;
  }

  plan(cam) {
    const leaves = [];
    const r0x = Math.floor(cam.x / ROOT), r0z = Math.floor(cam.z / ROOT);
    const reach = Math.ceil(this.viewDist / ROOT);
    const alt = Math.max(0, cam.y);
    const visit = (x, z, size) => {
      const cx = x + size / 2, cz = z + size / 2;
      const dx = Math.max(Math.abs(cam.x - cx) - size / 2, 0);
      const dz = Math.max(Math.abs(cam.z - cz) - size / 2, 0);
      const d = Math.hypot(dx, dz, alt * 0.6);
      if (Math.hypot(dx, dz) > this.viewDist) return;
      if (size > MIN_SIZE && d < size * LOD_K) {
        const h = size / 2;
        visit(x, z, h); visit(x + h, z, h); visit(x, z + h, h); visit(x + h, z + h, h);
      } else {
        leaves.push({ key: `${size}:${x}:${z}`, x, z, size, d });
      }
    };
    for (let j = -reach; j <= reach; j++) for (let i = -reach; i <= reach; i++) visit((r0x + i) * ROOT, (r0z + j) * ROOT, ROOT);
    leaves.sort((a, b) => a.d - b.d);
    return leaves;
  }

  update(cam) {
    if (cam.distanceTo(this.lastPlan) > 40) {
      this.lastPlan.copy(cam);
      this.desired = this.plan(cam);
      this.desiredSet = new Set(this.desired.map((l) => l.key));
    }
    // Request missing chunks, nearest first.
    for (const l of this.desired) {
      if (this.inflight >= this.maxInflight) break;
      if (this.chunks.has(l.key)) continue;
      const rec = { x: l.x, z: l.z, size: l.size, mesh: null, state: 'loading' };
      this.chunks.set(l.key, rec);
      this.inflight++;
      this.pool.request({ type: 'chunk', key: l.key, cx: l.x + l.size / 2, cz: l.z + l.size / 2, size: l.size, N, skirt: l.size / N * 4 + 8 }, (m) => {
        this.inflight--;
        if (rec.state === 'dead') return;
        this.onChunk(rec, m);
      });
    }
    this.cull();
    this.ready = this.desired.length > 0 && this.desired.every((l) => this.chunks.get(l.key)?.state === 'ready');
  }

  onChunk(rec, m) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.nor, 3));
    g.setAttribute('masks', new THREE.BufferAttribute(m.msk, 4, true));
    g.setAttribute('light', new THREE.BufferAttribute(m.lit, 2, true));
    g.setIndex(this.index);
    const mesh = new THREE.Mesh(g, this.material);
    mesh.position.set(rec.x + rec.size / 2, 0, rec.z + rec.size / 2);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.receiveShadow = true;
    mesh.layers.enable(1);
    rec.mesh = mesh;
    rec.state = 'ready';
    this.group.add(mesh);
  }

  cull() {
    if (!this.desiredSet) return;
    // Remove chunks no longer desired once their area is fully covered by ready replacements.
    for (const [key, rec] of this.chunks) {
      if (this.desiredSet.has(key)) continue;
      if (rec.state === 'loading') { rec.state = 'dead'; this.chunks.delete(key); continue; }
      let covered = true;
      for (const l of this.desired) {
        if (l.x < rec.x + rec.size && l.x + l.size > rec.x && l.z < rec.z + rec.size && l.z + l.size > rec.z) {
          if (this.chunks.get(l.key)?.state !== 'ready') { covered = false; break; }
        }
      }
      if (covered) {
        this.group.remove(rec.mesh);
        rec.mesh.geometry.dispose();
        this.chunks.delete(key);
      }
    }
  }

  dispose() {
    for (const rec of this.chunks.values()) if (rec.mesh) rec.mesh.geometry.dispose();
    this.scene.remove(this.group);
    this.chunks.clear();
  }
}
