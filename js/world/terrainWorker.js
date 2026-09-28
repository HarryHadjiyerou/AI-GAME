// Module worker: builds terrain chunk vertex data, tree tiles and height maps off the main thread.
import { createField, lightAt as lightAtField } from './fields.js';
import { hash2 } from '../core/noise.js';

let field = null;
let sun = { x: 0.5, y: 0.6, z: 0.4 };

const lightAt = (x, z, h) => lightAtField(field, sun, x, z, h);

function buildChunk({ key, cx, cz, size, N, skirt }) {
  const step = size / N;
  const G = N + 3; // sample grid with a 1-vertex ring for normals
  const hs = new Float32Array(G * G);
  const x0 = cx - size / 2 - step, z0 = cz - size / 2 - step;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) hs[j * G + i] = field.height(x0 + i * step, z0 + j * step);

  const V = (N + 1) * (N + 1);
  const S = 4 * (N + 1); // skirt vertices
  const pos = new Float32Array((V + S) * 3);
  const nor = new Float32Array((V + S) * 3);
  const msk = new Uint8Array((V + S) * 4);
  let minY = Infinity, maxY = -Infinity;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const gi = i + 1, gj = j + 1;
      const h = hs[gj * G + gi];
      const v = j * (N + 1) + i;
      const lx = -size / 2 + i * step, lz = -size / 2 + j * step;
      pos[v * 3] = lx; pos[v * 3 + 1] = h; pos[v * 3 + 2] = lz;
      let nx = hs[gj * G + gi - 1] - hs[gj * G + gi + 1];
      let ny = 2 * step;
      let nz = hs[(gj - 1) * G + gi] - hs[(gj + 1) * G + gi];
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
      const m = field.masks(cx + lx, cz + lz, h, ny);
      msk[v * 4] = m[0] * 255; msk[v * 4 + 1] = m[1] * 255; msk[v * 4 + 2] = m[2] * 255; msk[v * 4 + 3] = m[3] * 255;
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
    }
  }
  // Baked lighting on a coarse grid, bilinearly interpolated to the vertices.
  const L = 16, ls = size / L;
  const lg = new Float32Array((L + 1) * (L + 1) * 2);
  for (let j = 0; j <= L; j++) for (let i = 0; i <= L; i++) {
    const gx = Math.round((i * ls) / step) + 1, gz = Math.round((j * ls) / step) + 1;
    const r = lightAt(cx - size / 2 + i * ls, cz - size / 2 + j * ls, hs[gz * G + gx]);
    lg[(j * (L + 1) + i) * 2] = r[0]; lg[(j * (L + 1) + i) * 2 + 1] = r[1];
  }
  const lit = new Uint8Array((V + S) * 2);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const fx = (i / N) * L, fz = (j / N) * L;
    const i0 = Math.min(L - 1, Math.floor(fx)), j0 = Math.min(L - 1, Math.floor(fz));
    const tx = fx - i0, tz = fz - j0;
    const v = j * (N + 1) + i;
    for (let c = 0; c < 2; c++) {
      const a = lg[(j0 * (L + 1) + i0) * 2 + c], b = lg[(j0 * (L + 1) + i0 + 1) * 2 + c];
      const cc = lg[((j0 + 1) * (L + 1) + i0) * 2 + c], dd = lg[((j0 + 1) * (L + 1) + i0 + 1) * 2 + c];
      lit[v * 2 + c] = ((a + (b - a) * tx) * (1 - tz) + (cc + (dd - cc) * tx) * tz) * 255;
    }
  }
  // Skirts: copy edge rings (bottom, right, top, left order matches index builder) and drop them.
  const edge = [];
  for (let i = 0; i <= N; i++) edge.push(i);
  for (let j = 0; j <= N; j++) edge.push(j * (N + 1) + N);
  for (let i = N; i >= 0; i--) edge.push(N * (N + 1) + i);
  for (let j = N; j >= 0; j--) edge.push(j * (N + 1));
  for (let k = 0; k < S; k++) {
    const src = edge[k], dst = V + k;
    pos[dst * 3] = pos[src * 3]; pos[dst * 3 + 1] = pos[src * 3 + 1] - skirt; pos[dst * 3 + 2] = pos[src * 3 + 2];
    for (let c = 0; c < 3; c++) nor[dst * 3 + c] = nor[src * 3 + c];
    for (let c = 0; c < 4; c++) msk[dst * 4 + c] = msk[src * 4 + c];
    lit[dst * 2] = lit[src * 2]; lit[dst * 2 + 1] = lit[src * 2 + 1];
  }
  postMessage({ type: 'chunk', key, pos, nor, msk, lit, minY, maxY }, [pos.buffer, nor.buffer, msk.buffer, lit.buffer]);
}

function buildTrees({ key, x0, z0, size }) {
  const cell = field.treeCell;
  const out = [];
  const n = Math.ceil(size / cell);
  const ci0 = Math.floor(x0 / cell), cj0 = Math.floor(z0 / cell);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const ci = ci0 + i, cj = cj0 + j;
      const x = (ci + 0.15 + 0.7 * hash2(ci, cj, 11)) * cell;
      const z = (cj + 0.15 + 0.7 * hash2(ci, cj, 12)) * cell;
      const rnd = hash2(ci, cj, 13);
      const h = field.height(x, z);
      if (h < 0.5) continue;
      const e = 3;
      const nx = field.height(x - e, z) - field.height(x + e, z);
      const nz = field.height(x, z - e) - field.height(x, z + e);
      const ny = (2 * e) / Math.hypot(nx, 2 * e, nz);
      const type = field.tree(x, z, h, ny, rnd);
      if (type < 0) continue;
      const s = hash2(ci, cj, 14);
      const [sh, sk] = lightAt(x, z, h + 10);
      out.push(x, h, z, s, hash2(ci, cj, 15) * Math.PI * 2, type, sh, sk);
    }
  }
  const data = new Float32Array(out);
  postMessage({ type: 'trees', key, data }, [data.buffer]);
}

function buildHeightmap({ key, cx, cz, size, res }) {
  const data = new Float32Array(res * res);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    data[j * res + i] = field.height(cx - size / 2 + (i + 0.5) * size / res, cz - size / 2 + (j + 0.5) * size / res);
  }
  // coarse light map for water / traffic shading
  const LR = 48, light = new Uint8Array(LR * LR * 4);
  for (let j = 0; j < LR; j++) for (let i = 0; i < LR; i++) {
    const x = cx - size / 2 + (i + 0.5) * size / LR, z = cz - size / 2 + (j + 0.5) * size / LR;
    const [sh, sk] = lightAt(x, z, field.height(x, z));
    light[(j * LR + i) * 4] = sh * 255; light[(j * LR + i) * 4 + 1] = sk * 255; light[(j * LR + i) * 4 + 3] = 255;
  }
  postMessage({ type: 'heightmap', key, data, light, lres: LR, cx, cz, size, res }, [data.buffer, light.buffer]);
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { field = createField(m.biome, m.seed); if (m.sun) sun = m.sun; }
  else if (m.type === 'chunk') buildChunk(m);
  else if (m.type === 'trees') buildTrees(m);
  else if (m.type === 'heightmap') buildHeightmap(m);
};
