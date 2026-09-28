// Module worker: builds terrain chunk vertex data, tree tiles and height maps off the main thread.
import { createField } from './fields.js';
import { hash2 } from '../core/noise.js';

let field = null;

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
  }
  postMessage({ type: 'chunk', key, pos, nor, msk, minY, maxY }, [pos.buffer, nor.buffer, msk.buffer]);
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
      out.push(x, h, z, s, hash2(ci, cj, 15) * Math.PI * 2, type);
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
  postMessage({ type: 'heightmap', key, data, cx, cz, size, res }, [data.buffer]);
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') field = createField(m.biome, m.seed);
  else if (m.type === 'chunk') buildChunk(m);
  else if (m.type === 'trees') buildTrees(m);
  else if (m.type === 'heightmap') buildHeightmap(m);
};
