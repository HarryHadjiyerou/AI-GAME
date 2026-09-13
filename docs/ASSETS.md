# Assets

**Almost nothing is fetched.** The look is generated at runtime: skies,
terrain, water, vegetation, cloud, weather, the city and the first-person wings
are all built from noise and a palette. There is no texture payload behind this
game — the whole thing is a few hundred kilobytes of source plus three.js.

The one exception is three GLB bird models, used as distant silhouettes, and
they are optional.

---

## What the game loads over the network

| What | Where from | Size | If it fails |
|---|---|---|---|
| `three` + `three/addons` | jsDelivr, pinned to 0.180.0 | ~700 KB gzipped | nothing runs — this is the engine |
| `Stork.glb`, `Parrot.glb`, `Flamingo.glb` | jsDelivr, from the three.js repo at r160 | ~300 KB total | flocks and the menu simply have no birds; everything else is unaffected |

That is the complete list. Turning off **Load bird models from CDN** in the
settings drops the second row, and the game then makes exactly one third-party
request per session.

---

## three.js example models — CC-BY

<https://github.com/mrdoob/three.js> · models under `examples/models/gltf/`

`Flamingo.glb` · `Parrot.glb` · `Stork.glb`

**Where they are used, and why not elsewhere.** These three are morph-target
animated: they carry one baked wingbeat and no skeleton. That makes them very
good at what this project asks of them — a readable silhouette with a convincing
flap, seen at a distance — and structurally incapable of being the wings you fly
behind, because there are no bones to fold, sweep or bank independently.

So they circle the planet in the menu (recoloured to near-silhouette, because a
hot pink flamingo does not belong in this palette) and fly as distant flocks in
every world (`src/world/flock.js`). The first-person wings are built from
scratch in `src/flight/wings.js`: a three-segment arm carrying individually
posed coverts, secondaries and primaries. That is not a fallback, it is the
right tool — a first-person wing has to answer to wingbeat phase, tuck, bank and
g-load independently, and no baked morph sequence can do that.

---

## What used to be here

The first version streamed, per world, a 1k HDRI sky from Poly Haven and about
ten PBR texture sets — roughly 8 MB — and used the HDRI as both backdrop and
image-based light.

It was removed, and this is the honest reason: it did not look good. A
photograph of a forest floor stretched over generated terrain, under a
photograph of somebody else's sky, never resolved into a single picture. The
sky did not agree with the ground, the ground did not agree with the water, and
nothing agreed with the bird. It also cost the first ten seconds of every
session, on a game whose entire pitch is that you open a URL on a phone and
fly.

The replacement is a stylised renderer (`src/core/style.js`) driven by four
hand-authored palettes (`src/world/palette.js`): a banded sun term, a coloured
shadow taken from the hemisphere, a rim light, and aerial perspective that
dissolves distance into the palette's own horizon colour. Everything in the
world — terrain, trees, water, buildings, wings, flocks — is shaded by that one
model, which is why it all belongs to the same image. The environment map that
lights the reflective surfaces is generated from the palette itself
(`environmentFromPalette` in `src/world/sky.js`), so even the bounce light
agrees with the sky it came from.

Load time went from roughly ten seconds to under two, the look got better, and
the licensing page got shorter. No part of that trade was a compromise.

---

## Generated in-repo

Everything else is authored in code and has no licence to carry:

- Terrain height fields, erosion and biome masks (`src/world/terrain.js`)
- Sky dome, cloud strata and the palette environment map (`src/world/sky.js`)
- Gerstner-wave water with depth-shaded shallows (`src/world/water.js`)
- Trees, scrub and grass, instanced from procedural sprites (`src/world/vegetation.js`)
- The city, its traffic and its windows (`src/world/city.js`)
- Weather: wind, gusts, rain, lightning (`src/world/weather.js`)
- Thermal motes, floating islands and waterfalls (`src/world/spectacle.js`)
- The first-person wings, feathers and all (`src/flight/wings.js`)
- The menu planet, its clouds, atmosphere and stars (`src/ui/menu.js`)
