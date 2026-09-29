// Downloads the CC0 Poly Haven source textures used to build the tree assets in Blender.
// Output: build/tree-src/ (not committed). Run: node tools/trees/fetch-sources.mjs
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('build/tree-src');
fs.mkdirSync(OUT, { recursive: true });
const WANT = {
  fir_tree_01: ['twig_diff', 'twig_alpha', 'twig_nor_gl', 'bark_diff', 'bark_nor_gl'],
  pine_tree_01: ['twig_diff', 'twig_alpha', 'twig_nor_gl', 'bark_diff', 'bark_nor_gl'],
  island_tree_01: ['leaves_diff', 'leaves_alpha', 'leaves_nor_gl', 'branches_diff', 'branches_nor_gl'],
  japanese_cedar_bark: ['Diffuse', 'nor_gl'],
};
for (const [asset, maps] of Object.entries(WANT)) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${asset}`)).json();
  for (const m of maps) {
    const entry = files[m]?.['2k'];
    const f = entry?.png || entry?.jpg;
    if (!f) { console.warn('missing', asset, m); continue; }
    const ext = entry.png ? 'png' : 'jpg';
    const buf = Buffer.from(await (await fetch(f.url)).arrayBuffer());
    const name = `${asset}__${m}.${ext}`;
    fs.writeFileSync(path.join(OUT, name), buf);
    console.log(name, (buf.length / 1024).toFixed(0) + 'KB');
  }
}
