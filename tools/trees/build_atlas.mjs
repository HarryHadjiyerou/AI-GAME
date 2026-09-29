// Stage 3: pack the Blender outputs into game assets (assets/trees/).
//   node tools/trees/build_atlas.mjs [build_dir]
// - foliage atlas: 4 cards (fir, pine, leaves, palm) side by side, 2048x1024, albedo+alpha and normal,
//   with colour dilated into the transparent texels so mip-maps don't pick up dark fringes.
// - bark textures resized to 1024 (tiling), JPG.
// - GLBs copied as-is, collision/metadata JSON rounded.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const BUILD = process.argv[2] || 'build';
const OUT = 'assets/trees';
fs.mkdirSync(OUT, { recursive: true });
const CARDS = ['fir', 'pine', 'leaves', 'palm'];
const CW = 512, CH = 1024, W = CW * CARDS.length, H = CH;

// Fill transparent texels with the average of their opaque neighbours, growing outwards.
function dilate(px, w, h, passes, alphaSrc) {
  const known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) known[i] = alphaSrc[i] > 8 ? 1 : 0;
  for (let p = 0; p < passes; p++) {
    const add = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (known[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (!known[j]) continue;
        r += px[j * 4]; g += px[j * 4 + 1]; b += px[j * 4 + 2]; n++;
      }
      if (n) add.push(i, r / n, g / n, b / n);
    }
    if (!add.length) break;
    for (let k = 0; k < add.length; k += 4) {
      const i = add[k];
      px[i * 4] = add[k + 1]; px[i * 4 + 1] = add[k + 2]; px[i * 4 + 2] = add[k + 3];
      known[i] = 1;
    }
  }
  // anything still unknown: the mean colour
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < w * h; i++) if (known[i]) { r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2]; n++; }
  for (let i = 0; i < w * h; i++) if (!known[i]) { px[i * 4] = r / n; px[i * 4 + 1] = g / n; px[i * 4 + 2] = b / n; }
}

async function raw(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== CW || info.height !== CH) throw new Error(`${file}: expected ${CW}x${CH}`);
  return data;
}

const albedo = Buffer.alloc(W * H * 4), normal = Buffer.alloc(W * H * 4);
for (let c = 0; c < CARDS.length; c++) {
  const a = await raw(path.join(BUILD, 'tree-cards', `card_${CARDS[c]}_albedo.png`));
  const n = await raw(path.join(BUILD, 'tree-cards', `card_${CARDS[c]}_normal.png`));
  const alpha = new Uint8Array(CW * CH);
  for (let i = 0; i < CW * CH; i++) alpha[i] = a[i * 4 + 3];
  dilate(a, CW, CH, 24, alpha);
  dilate(n, CW, CH, 24, alpha);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const s = (y * CW + x) * 4, d = (y * W + c * CW + x) * 4;
    for (let k = 0; k < 4; k++) { albedo[d + k] = a[s + k]; normal[d + k] = n[s + k]; }
    normal[d + 3] = 255;
  }
}
await sharp(albedo, { raw: { width: W, height: H, channels: 4 } }).webp({ quality: 90, alphaQuality: 100, effort: 6, exact: true }).toFile(`${OUT}/foliage_albedo.webp`);
await sharp(normal, { raw: { width: W, height: H, channels: 4 } }).removeAlpha().webp({ quality: 90, effort: 6 }).toFile(`${OUT}/foliage_normal.webp`);

// Bark: Poly Haven sources (CC0)
const BARK = {
  cedar: ['japanese_cedar_bark__Diffuse.png', 'japanese_cedar_bark__nor_gl.png'],
  fir: ['fir_tree_01__bark_diff.png', 'fir_tree_01__bark_nor_gl.png'],
  pine: ['pine_tree_01__bark_diff.png', 'pine_tree_01__bark_nor_gl.png'],
  island: ['island_tree_01__branches_diff.png', 'island_tree_01__branches_nor_gl.png'],
};
for (const [k, [d, n]] of Object.entries(BARK)) {
  await sharp(path.join(BUILD, 'tree-src', d)).resize({ width: 1024 }).jpeg({ quality: 86, mozjpeg: true }).toFile(`${OUT}/bark_${k}_diff.jpg`);
  await sharp(path.join(BUILD, 'tree-src', n)).resize({ width: 512 }).jpeg({ quality: 85, mozjpeg: true }).toFile(`${OUT}/bark_${k}_nor.jpg`);
}

// Models + metadata
const meta = JSON.parse(fs.readFileSync(path.join(BUILD, 'tree-out', 'trees.json'), 'utf8'));
const r4 = (v) => Math.round(v * 1e4) / 1e4;
for (const [name, m] of Object.entries(meta)) {
  fs.copyFileSync(path.join(BUILD, 'tree-out', m.file), `${OUT}/${m.file}`);
  m.radius = r4(m.radius);
  if (m.caps) m.caps = m.caps.map((c) => c.map(r4));
  if (m.spheres) m.spheres = m.spheres.map((c) => c.map(r4));
}
fs.writeFileSync(`${OUT}/trees.json`, JSON.stringify(meta));
for (const f of fs.readdirSync(OUT)) console.log(f.padEnd(28), (fs.statSync(`${OUT}/${f}`).size / 1024).toFixed(0), 'KB');
