// Blender-built tree species (tools/trees/*): GLB meshes with two LODs, a photographic foliage atlas
// (Poly Haven fir/pine twigs, island-tree leaves, palm frond) and Poly Haven bark textures.
// Shared by the instanced forest (trees.js) and the titans (titans.js).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { patchMaterial, G } from '../core/shaderPatch.js';

const DIR = 'assets/trees/';
// species -> bark texture set
const BARK = { redwood: 'cedar', fir: 'fir', pine: 'pine', broadleaf: 'island', palm: 'pine', titan_giant: 'cedar', titan_banyan: 'island' };
// per-species tint on top of the photographic textures (linear multipliers)
const LEAF = { redwood: 0xa8c098, fir: 0xb0c8a4, pine: 0xa8b890, broadleaf: 0xd0dcb8, palm: 0xffffe0, titan_giant: 0xc4d8b0, titan_banyan: 0xccdcb4 };
const BARKTINT = { redwood: 0xf0c8b0, fir: 0xe8e0d8, pine: 0xf0e0d0, broadleaf: 0xe8e4e0, palm: 0xd8c8b0, titan_giant: 0xf4c8a8, titan_banyan: 0xe0dcd4 };

let metaPromise = null;
const fetchMeta = () => (metaPromise ||= fetch(DIR + 'trees.json').then((r) => r.json()));

export async function loadTreeAssets(renderer, species, manager) {
  const meta = await fetchMeta();
  const loader = new GLTFLoader(manager), tl = new THREE.TextureLoader(manager);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = (f, srgb, repeat) => tl.loadAsync(DIR + f).then((t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    return t;
  });
  const barkSets = [...new Set(species.map((s) => BARK[s]))];
  const [albedo, normal, ...rest] = await Promise.all([
    tex('foliage_albedo.webp', true), tex('foliage_normal.webp', false),
    ...barkSets.flatMap((b) => [tex(`bark_${b}_diff.jpg`, true, true), tex(`bark_${b}_nor.jpg`, false, true)]),
    ...species.map((s) => loader.loadAsync(DIR + meta[s].file)),
  ]);
  const bark = {};
  barkSets.forEach((b, i) => { bark[b] = { map: rest[i * 2], normalMap: rest[i * 2 + 1] }; });
  const gltfs = rest.slice(barkSets.length * 2);
  const out = { albedo, normal, bark, species: {} };
  species.forEach((s, i) => {
    const geo = {};
    // Blender suffixes repeated object names (bark.001 -> "bark001" after three's name sanitising)
    gltfs[i].scene.traverse((o) => {
      const m = o.isMesh && /^(bark|foliage)(_lod1)?/.exec(o.name);
      if (m) geo[m[1] + (m[2] || '')] = o.geometry;
    });
    for (const k of ['bark', 'foliage', 'bark_lod1', 'foliage_lod1']) if (!geo[k]) throw new Error(`tree ${s}: mesh "${k}" missing`);
    out.species[s] = { name: s, meta: meta[s], bark0: geo.bark, fol0: geo.foliage, bark1: geo.bark_lod1, fol1: geo.foliage_lod1 };
  });
  return out;
}

// Foliage: alpha-tested atlas cards with baked crown AO (vertex colour), volumetric normals and wind sway.
// `sway` scales the bending (unit-height trees bend more at the top).
export function foliageMaterial(A, species, tint, tag, sway = 1) {
  const m = new THREE.MeshStandardMaterial({
    map: A.albedo, normalMap: A.normal, normalScale: new THREE.Vector2(0.6, 0.6), alphaTest: 0.5, side: THREE.DoubleSide,
    vertexColors: true, roughness: 0.9, envMapIntensity: 0.6, color: new THREE.Color(LEAF[species]).multiply(tint || new THREE.Color(1, 1, 1)).multiplyScalar(species === 'palm' ? 1.5 : 1),
  });
  patchMaterial(m, (sh) => {
    sh.uniforms.uTimeW = G.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTimeW;').replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
      vec3 ip = instanceMatrix[3].xyz;
      float ph = ip.x * 0.05 + ip.z * 0.07;
      float sw = (sin(uTimeW * 1.1 + ph) * 0.010 + sin(uTimeW * 2.7 + ip.x * 0.3) * 0.003) * ${sway.toFixed(2)};
      float hy = position.y * position.y;
      // leaf flutter: small per-vertex jitter
      float fl = sin(uTimeW * 6.0 + dot(position, vec3(40.0, 23.0, 31.0))) * 0.0015 * ${sway.toFixed(2)};
      transformed.x += sw * hy + fl;
      transformed.z += sw * 0.6 * hy - fl;
      #endif`);
    sh.fragmentShader = sh.fragmentShader
      // keep alpha coverage at distance: mip-mapped alpha averages out thin needles, so boost it with the mip level
      .replace('#include <alphatest_fragment>', `
        {
          vec2 tdx = dFdx(vMapUv * vec2(2048.0, 1024.0)), tdy = dFdy(vMapUv * vec2(2048.0, 1024.0));
          float mip = max(0.0, 0.5 * log2(max(dot(tdx, tdx), dot(tdy, tdy))));
          diffuseColor.a *= 1.0 + mip * 0.28;
        }
        #include <alphatest_fragment>`)
      // the volumetric normals point out of the crown on both faces of a card
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'))
      // leaves are waxy but not glossy at this scale: cut the specular so sunlit crowns don't wash out
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularColor *= 0.3; material.specularF90 = 0.3;')
      // soft translucency: foliage lit from behind glows a little
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * ${species === 'palm' ? '0.3' : '0.07'};`);
  }, tag);
  return m;
}

export function barkMaterial(A, species, tag) {
  const b = A.bark[BARK[species]];
  return patchMaterial(new THREE.MeshStandardMaterial({
    map: b.map, normalMap: b.normalMap, vertexColors: true, roughness: 0.95, color: new THREE.Color(BARKTINT[species]).multiplyScalar(1.25),
  }), null, tag);
}
