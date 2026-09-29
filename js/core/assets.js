// Asset loading: Poly Haven HDRIs/textures, GLB birds and generated textures.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mulberry32 } from './noise.js';
import { loadTreeAssets } from '../world/treeAssets.js';

// Blender tree species needed per biome (see tools/trees)
const TREE_SPECIES = {
  forest: ['redwood', 'fir', 'pine', 'broadleaf', 'palm', 'titan_giant', 'titan_banyan'],
  coast: ['pine', 'broadleaf', 'palm'],
  mountains: ['fir', 'pine'],
  city: ['broadleaf'],
};

const TEX_NAMES = ['grass', 'forestfloor', 'rock', 'cliff', 'snow', 'sand', 'bark', 'asphalt'];

export async function loadAssets(renderer, biome, onProgress, birdId) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (url, loaded, total) => onProgress?.(loaded / total);
  const texLoader = new THREE.TextureLoader(manager);
  const hdrLoader = new HDRLoader(manager);
  const gltfLoader = new GLTFLoader(manager);
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const tex = {};
  const jobs = [];
  for (const n of TEX_NAMES) {
    for (const k of ['diff', 'nor']) {
      jobs.push(texLoader.loadAsync(`assets/textures/${n}_${k}.jpg`).then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = maxAniso;
        if (k === 'diff') t.colorSpace = THREE.SRGBColorSpace;
        tex[`${n}_${k}`] = t;
      }));
    }
  }
  jobs.push(texLoader.loadAsync('assets/textures/waternormals.jpg').then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    tex.waterNormals = t;
  }));
  let hdr, sky;
  jobs.push(hdrLoader.loadAsync(`assets/hdri/${biome}_1k.hdr`).then((t) => { hdr = t; }));
  jobs.push(texLoader.loadAsync(`assets/hdri/${biome}_sky.jpg`).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    sky = t;
  }));
  const models = {};
  const modelList = ['stork', 'parrot', 'hawk_lo'];
  if (birdId === 'hawk') modelList.push('hawk_hi');
  for (const m of modelList) {
    jobs.push(gltfLoader.loadAsync(`assets/models/${m}.glb`).then((g) => { models[m] = g; }).catch((e) => console.warn('model failed', m, e)));
  }
  let trees = null;
  jobs.push(loadTreeAssets(renderer, TREE_SPECIES[biome] || [], manager).then((t) => { trees = t; }));
  await Promise.all(jobs);

  tex.noise = makeNoiseTexture(256, 7);

  // Image based lighting
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromEquirectangular(hdr).texture;
  pmrem.dispose();

  const sunDir = findSun(hdr);
  const skyInfo = analyseSky(sky.image, sunDir);
  hdr.dispose();

  return { tex, envMap, sky, sunDir, sunColor: sunDir.color, skyInfo, models, trees };
}

// Brightest texel of the HDR gives the sun direction.
function findSun(hdr) {
  const { data, width, height } = hdr.image;
  const half = data instanceof Uint16Array;
  const f = (i) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < height / 2; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const l = f(i) * 0.2126 + f(i + 1) * 0.7152 + f(i + 2) * 0.0722;
      if (l > best) { best = l; bx = x; by = y; }
    }
  }
  const u = (bx + 0.5) / width;
  const v = hdr.flipY ? 1 - (by + 0.5) / height : (by + 0.5) / height;
  // colour of the sun disc (average around the peak), normalised to max channel = 1
  const c = [0, 0, 0];
  for (let y = Math.max(0, by - 2); y <= Math.min(height - 1, by + 2); y++) for (let x = bx - 2; x <= bx + 2; x++) {
    const i = (y * width + ((x + width) % width)) * 4;
    c[0] += f(i); c[1] += f(i + 1); c[2] += f(i + 2);
  }
  const m = Math.max(c[0], c[1], c[2], 1e-6);
  const dir = dirFromEquirect(u, v);
  dir.color = new THREE.Color(c[0] / m, c[1] / m, c[2] / m);
  return dir;
}

export function dirFromEquirect(u, v) {
  const lat = (v - 0.5) * Math.PI;
  const phi = (u - 0.5) * Math.PI * 2;
  return new THREE.Vector3(Math.cos(phi) * Math.cos(lat), Math.sin(lat), Math.sin(phi) * Math.cos(lat)).normalize();
}

// Average horizon / zenith colours from the sky image so fog matches the backdrop.
function analyseSky(img, sunDir) {
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const avgRow = (y0, y1, x0 = 0, x1 = W) => {
    const s = [0, 0, 0]; let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const xi = ((x % W) + W) % W;
      const i = (y * W + xi) * 4;
      s[0] += lin(d[i]); s[1] += lin(d[i + 1]); s[2] += lin(d[i + 2]); n++;
    }
    return new THREE.Color(s[0] / n, s[1] / n, s[2] / n);
  };
  // Image row 0 is the top (zenith). Horizon is the middle row.
  const horizon = avgRow(H / 2 - 6, H / 2 - 1);
  const zenith = avgRow(2, 14);
  const u = Math.atan2(sunDir.z, sunDir.x) / (Math.PI * 2) + 0.5;
  const sx = Math.round(u * W);
  const sunHorizon = avgRow(H / 2 - 10, H / 2 - 1, sx - 16, sx + 16);
  return { horizon, zenith, sunHorizon };
}

// Tileable multi-octave value noise in 4 independent channels.
export function makeNoiseTexture(size, seed) {
  const data = new Uint8Array(size * size * 4);
  for (let ch = 0; ch < 4; ch++) {
    const rand = mulberry32(seed * 31 + ch * 977);
    const periods = [4, 8, 16, 32, 64];
    const lattices = periods.map((p) => { const a = new Float32Array(p * p); for (let i = 0; i < a.length; i++) a[i] = rand(); return a; });
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = 0, amp = 0.5, norm = 0;
        periods.forEach((p, o) => {
          const fx = (x / size) * p, fy = (y / size) * p;
          const x0 = Math.floor(fx), y0 = Math.floor(fy);
          const tx = fx - x0, ty = fy - y0;
          const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
          const L = lattices[o];
          const g = (i, j) => L[((j % p) + p) % p * p + (((i % p) + p) % p)];
          const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
          v += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
          norm += amp;
          amp *= 0.5;
        });
        data[(y * size + x) * 4 + ch] = Math.max(0, Math.min(255, ((v / norm - 0.5) * 1.9 + 0.5) * 255));
      }
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
