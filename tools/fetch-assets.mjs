// Downloads and optimises the third-party assets used by AVES.
// Run from repo root:  npm i sharp three && node tools/fetch-assets.mjs
// All Poly Haven assets are CC0. three.js files are MIT.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const OUT = path.resolve('assets');
const PH = 'https://dl.polyhaven.org/file/ph-assets';
const TJS = 'https://raw.githubusercontent.com/mrdoob/three.js/r170/examples';

const HDRIS = {
  forest: 'rustig_koppie_puresky',
  coast: 'table_mountain_1_puresky',
  mountains: 'kloofendal_48d_partly_cloudy_puresky',
  city: 'industrial_sunset_02_puresky',
};
const TEXTURES = {
  grass: 'aerial_grass_rock',
  forestfloor: 'forest_leaves_04',
  rock: 'rocky_terrain_02',
  cliff: 'aerial_rocks_02',
  snow: 'snow_field_aerial',
  sand: 'aerial_beach_01',
  bark: 'knotted_pine_bark',
  asphalt: 'aerial_asphalt_01',
};
const MODELS = ['Stork', 'Parrot'];

async function get(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status + ' ' + url);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((res) => setTimeout(res, 2000 * 2 ** i));
    }
  }
}
function save(rel, buf) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
  console.log('wrote', rel, (buf.length / 1024).toFixed(0) + 'KB');
}

for (const [biome, id] of Object.entries(HDRIS)) {
  // 1k HDR: image based lighting (PMREM). Tonemapped JPG: sharp sky backdrop.
  save(`hdri/${biome}_1k.hdr`, await get(`${PH}/HDRIs/hdr/1k/${id}_1k.hdr`));
  const jpg = await get(`${PH}/HDRIs/extra/Tonemapped%20JPG/${id}.jpg`);
  save(`hdri/${biome}_sky.jpg`, await sharp(jpg).resize(4096, 2048).jpeg({ quality: 84, mozjpeg: true }).toBuffer());
}
for (const [name, id] of Object.entries(TEXTURES)) {
  for (const kind of ['diff', 'nor']) {
    const files = JSON.parse((await get(`https://api.polyhaven.com/files/${id}`)).toString());
    const key = kind === 'diff' ? 'Diffuse' : 'nor_gl';
    const buf = await get(files[key]['1k'].jpg.url);
    save(`textures/${name}_${kind}.jpg`, await sharp(buf).jpeg({ quality: 86, mozjpeg: true }).toBuffer());
  }
}
save('textures/waternormals.jpg', await get(`${TJS}/textures/waternormals.jpg`));
for (const m of MODELS) save(`models/${m.toLowerCase()}.glb`, await get(`${TJS}/models/gltf/${m}.glb`));
