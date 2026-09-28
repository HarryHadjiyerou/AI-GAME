# AVES

A first-person bird flight game for the browser (built for iPhone in landscape, and it also runs on desktop). You pick one of four birds and each one starts in its own world:

| Bird | World | How it flies |
|---|---|---|
| Hawk | Forest: redwoods, rivers, waterfalls, valley mist | Fast, strong tucked dive, quick to manoeuvre |
| Seagull | Coast: cliffs, islands, sea stacks, boats, a lighthouse, a storm offshore | Long glides, strong wind and ridge lift, can plunge into the sea |
| Condor | Mountains: snow peaks, frozen lakes, a sea of cloud | Slow wingbeats, very long glides, big thermals, wide turns |
| Pigeon | City: towers, a river with bridges, construction frames and cranes, traffic | Very agile, quick bursts, low height ceiling |

All four are playable in V1. The hawk and forest got the most tuning.

## Run it

It's a static site with no build step, but it needs an HTTP server because ES modules and web workers won't load from `file://`.

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

**On an iPhone:** serve the folder from a computer on the same Wi-Fi and open `http://<computer-ip>:8000` in Safari, or host it on GitHub Pages (Settings → Pages → deploy from branch). For full screen, use Share → *Add to Home Screen* and launch it from the icon. As far as I know, Safari on iPhone does not let web pages go full screen themselves, so the Home Screen route is the workaround. The Rotate prompt appears in portrait.

Deep links for testing: `index.html#hawk`, `#seagull`, `#condor`, `#pigeon`.

## Controls

| | Touch (landscape) | Keyboard | Gamepad |
|---|---|---|---|
| Steer (bank / pitch) | Left thumb, a joystick that appears wherever you touch | WASD / arrows | Left stick |
| Flap (take off, climb) | FLAP | Space | A |
| Boost (fast wingbeats, drains stamina ring) | BOOST | Shift | RT / RB |
| Tuck wings (dive) | DIVE | E / Q | LT / B |
| Pause | ❚❚ | P / Esc | |

Pitch follows the flight-sim convention: push forward to dive, pull back to climb or flare. You can flip it with *Invert pitch* on the menu.

Gameplay notes: glide in slowly to land on rooftops, cliffs and the ground. When you're perched, steer turns you on the spot and FLAP launches. Circling birds mark thermals. The thermal beeper sounds when you're climbing. Close passes, skimming, gaps, big dives and seagull plunges all score points and build a combo.

## How it works

```
index.html / css/style.css     menu, loading screen, HUD, touch controls
js/main.js                     UI flow, options, render loop
js/game.js                     one play session: spawn, collisions/landing/water, scoring, per-frame update
js/flight/
  birds.js                     per-bird numbers → aerodynamic coefficients
  physics.js                   lift (angle of attack), parasitic + induced drag, gravity, flapping, tuck, auto-trim
  head.js                      bird-eye camera: head stabilisation, glances, twitches, flap bob, speed FOV
  wings.js                     procedural feathered wings (3-bone arm driving ~60 feather quads per wing)
  input.js                     virtual joystick + buttons, keyboard, gamepad
js/world/
  fields.js                    procedural height/mask functions per biome (shared by main thread and worker)
  terrainWorker.js             builds terrain chunks, tree tiles and height maps off the main thread
  terrain.js                   quadtree LOD streaming + splat shader (Poly Haven textures, cliffs, snow, city streets)
  water.js                     Gerstner waves, sky reflections, depth colour, shore foam, frozen lakes
  sky.js / clouds.js           HDRI sky dome, lit billboard cumulus, cloud deck, storm cell
  trees.js                     instanced procedural trees + impostors baked at runtime for distance
  city.js                      towers with shader-drawn windows, bridges, frames, cranes, billboards, shader-driven traffic
  extras.js                    thermals, GLB bird flocks, particles, boats, lighthouse, lightning, waterfalls
js/core/
  shaderPatch.js               "mini planet" curvature + height fog injected into every material
  post.js                      HDR pipeline: bloom, fisheye, peripheral/speed blur, chromatic aberration, ACES, grading
  assets.js / audio.js / workers.js
```

- **Mini planet:** every vertex is lowered by `d²/2R` relative to the camera, so the horizon curves. When you climb, the sky's horizon dips to match. R is 18 to 34 km depending on the biome.
- **Flight model:** see the notes at the top of `physics.js`. `node tests/flight-sim.mjs` runs the model without a browser and prints, for each bird, glide speed and glide ratio, top dive speed wings tucked vs open, climb rate while flapping, boost speed, take-off, and turning.

  Current results:

  | Bird | Glide ratio | Top dive (tucked / open) | Tightest level turn |
  |---|---|---|---|
  | Hawk | about 11:1 | ~106 / ~54 m/s | |
  | Seagull | about 16–18:1 | | ~30 m radius |
  | Condor | about 17–21:1 (it slowly bobs up and down in a glide, so the figure depends on when it's measured) | | ~70 m radius |
  | Pigeon | 7:1 | | |

  The pigeon can't hold its tightest turn without flapping, which is deliberate.
- **Quality:** Auto chooses Medium on phones and High on desktop. High adds sun shadows and 4× MSAA. Resolution also scales itself up and down to keep the frame rate steady.

## Third-party assets

The download and conversion script is `tools/fetch-assets.mjs`, so every downloaded file can be traced to its source.

| Asset | Source | Licence |
|---|---|---|
| HDRI skies: `rustig_koppie_puresky` (forest), `table_mountain_1_puresky` (coast), `kloofendal_48d_partly_cloudy_puresky` (mountains), `industrial_sunset_02_puresky` (city) | [Poly Haven](https://polyhaven.com) | CC0 |
| PBR textures: `aerial_grass_rock`, `forest_leaves_04`, `rocky_terrain_02`, `aerial_rocks_02`, `snow_field_aerial`, `aerial_beach_01`, `knotted_pine_bark`, `aerial_asphalt_01` | Poly Haven | CC0 |
| `waternormals.jpg` | three.js examples | MIT (three.js repo) |
| `stork.glb`, `flamingo.glb`, `parrot.glb` (used for ambient flocks) | three.js examples (originally from the RO.ME project) | They ship in the MIT-licensed three.js repo, but I have **not verified** separate licence terms for the models. Replace them before any commercial release. |
| three.js r186 (vendored in `vendor/three`) | [three.js](https://threejs.org) | MIT |

The Poly Haven HDRIs load in two forms. A 1k `.hdr` provides image-based lighting and the sun direction and colour. A 4k tonemapped JPG provides the visible sky.

## Known limitations of V1

- **Not tested on a real iPhone.** All testing so far used headless Chromium with software WebGL: screenshots of every biome, scripted landing, take-off and plunge checks, and touch emulation at 844×390. At the spawn point on Medium, one frame measured about 185 draw calls in the forest, 200 at the coast, 100 in the mountains and 385 in the city (0.75–1.9 million triangles). Real device frame rate is unmeasured.
- **Wings are procedural, not GLB.** The free bird GLBs I found are low-poly, animated with morph targets, and can't be posed as a wing seen up close from the eye. The feather rig is procedural so gliding, flapping, tucking and banking poses can be driven directly.
- **Trees are procedural.** Poly Haven's tree models are 2–17 million polygons each, far too heavy to draw in real time on a phone. They're replaced with instanced branch-card trees plus impostors baked when the game loads. Quaternius and Kenney packs weren't used because their low-poly style clashes with the photoreal look, and I didn't verify their download routes.
- **Fog and clouds are approximations.** The "volumetric" fog is analytic height fog with sun in-scattering, not raymarched. Clouds are lit billboards plus a cloud-deck shader, not volumetric.
- **Physics shortcuts.** Rivers and lakes all sit at one water level. Underwater diving is faked (tint, buoyancy, a random fish). Collisions use the height field, tree cylinders and cones, and building boxes.
