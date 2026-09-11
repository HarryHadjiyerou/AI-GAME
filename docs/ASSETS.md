# Assets

Everything third-party is **streamed at runtime from its own CDN**. Nothing is
copied into this repository, so there is no redistribution to license and the
repo stays small. Every remote load has a procedural fallback, so the game still
runs offline — it just looks different.

All the hosts below serve `Access-Control-Allow-Origin: *`, which is what makes
this possible from a browser at all.

---

## Poly Haven — CC0

<https://polyhaven.com> · [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)

**HDRI skies.** One per world, at 1k, loaded through `RGBELoader` and run
through `PMREMGenerator`. Each is both the visible backdrop and the image-based
light, which is why a bird's pale underside picks up the colour of the water
beneath it without anything being authored for it.

| World | HDRI |
|---|---|
| Forest | `kloofendal_28d_misty_puresky` |
| Coast | `blouberg_sunrise_2` |
| High range | `drakensberg_solitary_mountain_puresky` |
| City | `potsdamer_platz` |

**PBR surfaces.** Diffuse, OpenGL-convention normal, and the packed `arm` map
(red = ambient occlusion, green = roughness, blue = metalness) — a packing that
happens to match exactly what three.js wants, so one file feeds three material
slots.

`forest_ground_04` · `aerial_grass_rock` · `rock_face_03` · `rocks_ground_02` ·
`snow_02` · `coast_sand_01` · `bark_willow_02` · `brown_mud_leaves_01` ·
`asphalt_02` · `concrete_wall_008`

Roughly 8 MB per world at 1k. Turning off **Stream photoreal assets** in the
settings swaps all of it for procedurally generated tiling textures.

---

## three.js example models — CC-BY

<https://github.com/mrdoob/three.js> · models under `examples/models/gltf/`

`Flamingo.glb` · `Parrot.glb` · `Stork.glb`

**Where they are used, and why not elsewhere.** These three are morph-target
animated: they carry one baked wingbeat and no skeleton. That makes them very
good at what this project asks of them — a readable silhouette with a convincing
flap, seen at a distance — and structurally incapable of being the wings you fly
behind, because there are no bones to fold, sweep or bank independently.

So they circle the planet in the menu and fly as distant flocks in every world
(`src/world/flock.js`), and the first-person wings are built from scratch in
`src/flight/wings.js` as a three-segment arm carrying individually posed
feathers. That is not a fallback; it is the right tool. A first-person wing has
to respond to wingbeat phase, tuck, bank and g-load independently, and no baked
morph sequence can do that.

---

## three.js — MIT

<https://threejs.org> · pinned to `0.180.0` via the import map in `index.html`.

Renderer, loaders, and the `EffectComposer` post-processing stack.

---

## Made in-engine

No asset, no download, no licence:

- All four height fields, and therefore all terrain, rivers, coastline,
  mountains and the city's ground plane
- The four-layer terrain splat, the water surface, the cloudscape and the
  facade shader
- Trees: trunk geometry, canopy cards, and the alpha-masked foliage sprites,
  drawn to a canvas at load
- The first-person wings, including the feather texture
- The menu planet
- All flight physics

---

## Assets considered and not used

Two CC0 libraries were obvious candidates for the vegetation and the city:

- **Quaternius Ultimate Nature Pack** and **Downtown City MegaKit** —
  <https://quaternius.com>, CC0
- **Kenney Nature Kit** and **City Kit** — <https://kenney.nl>, CC0

Both are genuinely good and both are worth doing. They are not wired in here for
one practical reason: neither is served from a CORS-enabled CDN. Quaternius
distributes through Google Drive and Kenney through a download endpoint on his
own site, so in both cases the files would have to be downloaded by hand,
committed into this repository, and redistributed — a different decision from
everything else above, and one better made deliberately than by accident.

The loader is ready for them. `Assets.birdModel()` already wraps `GLTFLoader`,
and `Vegetation` takes prototypes as data, so dropping real GLB trees in means
adding a manifest and a loader branch rather than restructuring anything.
