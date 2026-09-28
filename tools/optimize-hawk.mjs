// Optimises the Sketchfab "Hawk In Full Wingspan" scan (restore50, CC-BY-4.0) for real-time use.
// Usage: node tools/optimize-hawk.mjs <source.glb>
// Outputs assets/models/hawk_hi.glb (first-person wings) and assets/models/hawk_lo.glb (flocks / menu).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, quantize, textureCompress, flatten, join } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const src = process.argv[2];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

async function build(out, ratio, texSize, error) {
  const doc = await io.read(src);
  const root = doc.getRoot();
  for (const mat of root.listMaterials()) {
    // emissive map is empty in the scan; drop it. Point every map at UV set 0 (all sets are identical).
    mat.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
    for (const info of [mat.getBaseColorTextureInfo(), mat.getNormalTextureInfo(), mat.getMetallicRoughnessTextureInfo()]) info?.setTexCoord(0);
  }
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
    for (const s of ['TEXCOORD_1', 'TEXCOORD_2', 'TEXCOORD_3', 'TEXCOORD_4', 'TANGENT']) prim.setAttribute(s, null);
  }
  await doc.transform(
    dedup(), flatten(), join(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error }),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [texSize, texSize], quality: 86 }),
    quantize(),
  );
  await io.write(out, doc);
  let tris = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
  console.log(out, Math.round(tris), 'tris');
}
await build('assets/models/hawk_hi.glb', 0.45, 2048, 0.0008);
await build('assets/models/hawk_lo.glb', 0.03, 512, 0.02);
