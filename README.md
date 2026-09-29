# AVES

A first-person bird flight game for the browser (built for iPhone in landscape, and it also runs on desktop). You pick one of four birds and each one starts in its own world:

| Bird | World | How it flies |
|---|---|---|
| Hawk | The Wilds: lowland redwood forests and rivers, 1 km-high red-rock tablelands cut by canyons down to river level (oases, waterfalls, slot canyons), 7 km mountain ranges piercing a cloud layer, and titan trees 150–380 m tall | Fast, strong tucked dive, quick to manoeuvre |
| Seagull | Coast: 140–400 m sea cliffs, islands, sea stacks, boats, a lighthouse, a storm offshore | Long glides, strong wind and ridge lift, can plunge into the sea |
| Condor | Mountains: peaks to ~6 km above a sea of cloud, frozen lakes | Slow wingbeats, very long glides, big thermals, wide turns |
| Pigeon | City: towers, a river with bridges, construction frames and cranes, traffic | Very agile, quick bursts, low height ceiling |

All four are playable. The hawk and The Wilds got the most work.

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
| Steer: bank, gentle pitch | **Right thumb**: a joystick appears wherever you touch the right half | WASD / arrows | Left stick |
| Flap (take off, **climb**) | FLAP (left thumb) | Space | A |
| Dive (tuck and **plunge**; release to swoop back up) | DIVE (left thumb) | C / F / Ctrl | LT / B |
| Boost (fast wingbeats, drains the stamina ring) | BOOST (left thumb) | Shift | RT |
| Barrel roll | Flick the stick hard left or right and let go | Q / E | LB / RB |
| Pause | ❚❚ | P / Esc | |

The vertical stick axis is deliberately soft (45% of full authority, with a smoothing curve), so the stick is mainly for steering. Climbing is done with FLAP and descending with DIVE. Pitch follows the flight-sim convention (push forward to nose down); you can flip it with *Invert pitch*. Stick input is smoothed over ~0.1 s so small thumb jitters don't reach the bird.

## Gameplay

- **Dive and swoop:** hold DIVE and the bird tucks and steers its nose down towards a ~70° plunge. The hawk reaches ~200 km/h in 5 s and over 350 km/h in a long dive. Let go and the wings open and pull out automatically (up to ~4 g), converting the speed back into height. Push the stick to override the pull-out.
- **Ride updrafts:** wind hitting the windward side of cliffs, canyon walls and ridges is deflected upwards (up to 10 m/s). A HUD arrow shows the wind direction, rising motes appear in lift, "▲ LIFT" lights up and the thermal beeper sounds. Circle or glide along a face to climb, then fold into a free-fall. Thermals (marked by circling birds) work the same way.
- **Fly low:** skimming the ground or water, threading between trunks and titan limbs, flying through gaps between buildings and brushing through canopies all score. The closer and faster you go, the stronger the speed effects.
- **Flight rings (optional, on by default):** a chain of glowing rings routed through the most fun terrain nearby: down canyons, low over rivers, under titan branches, along city streets. Each ring gives a burst of speed, some stamina and a rising chime; missing one breaks the chain. An arrow at the screen edge points to the next ring. Turn it off on the menu for free flight.
- **Tricks and combo:** barrel roll, double roll, free-fall (tucked and near vertical for 1.4 s+), low pull-out (death-defying below 12 m), dive speed, updraft and thermal rides, skim, thread, gap, canopy, landing and the seagull's plunge. Chaining them raises the multiplier (up to ×8).
- **Sense of speed:** air motes streaming past, dust, leaves and spray kicked up when low and fast, peripheral speed streaks, speed-dependent motion blur, and FOV that widens with speed and even more close to the ground. Wind noise rises with speed and a whoosh follows banks and rolls.

## How it works

```
index.html / css/style.css     menu, loading screen, HUD, touch controls
js/main.js                     UI flow, options, render loop
js/game.js                     one play session: spawn, wind/ridge lift, collisions/landing/water, speed effects, per-frame update
js/gameplay.js                 trick detection and the flight-ring chain
js/flight/
  birds.js                     per-bird numbers → aerodynamic coefficients
  physics.js                   lift (angle of attack), parasitic + induced drag, gravity, flapping, tuck, auto-trim
  head.js                      bird-eye camera: head stabilisation, glances, twitches, flap bob, speed FOV
  wings.js                     hawk: wings cut from the photogrammetry scan, bent in a vertex shader; other birds: procedural feather rig
  input.js                     right-hand virtual joystick (smoothed, soft pitch, flick-to-roll) + buttons, keyboard, gamepad
js/world/
  fields.js                    procedural height/mask functions per biome (shared by main thread and worker)
  terrainWorker.js             builds terrain chunks, tree tiles, height/light maps off the main thread (incl. baked ray-marched lighting)
  terrain.js                   quadtree LOD streaming + splat shader (Poly Haven textures, cliffs, snow, city streets)
  water.js                     Gerstner waves, planar scene reflections, depth colour, shore foam, frozen lakes
  sky.js / clouds.js           HDRI sky dome, lit billboard cumulus, cloud deck, storm cell
  treeAssets.js                loads the Blender-built tree GLBs, foliage atlas and bark; shared foliage/bark materials
  trees.js                     instanced trees (two LODs) + impostors baked at runtime for distance
  titans.js                    titan trees (Blender-built), capsule/sphere collision
  city.js                      towers with shader-drawn windows, bridges, frames, cranes, billboards, shader-driven traffic
  extras.js                    thermals, GLB bird flocks, particles, boats, lighthouse, lightning, waterfalls
js/core/
  shaderPatch.js               "mini planet" curvature + height fog injected into every material
  post.js                      HDR pipeline: bloom, god rays, fisheye, peripheral/speed blur, chromatic aberration, ACES, grading
  assets.js / audio.js / workers.js
```

- **Mini planet:** every vertex is lowered by `d²/2R` relative to the camera, so the horizon curves. When you climb, the sky's horizon dips to match. R is 30 to 120 km depending on the biome (large enough that 7 km peaks stay visible from 30 km away).
- **"Ray-traced" lighting (what it actually is):** WebGL on a phone can't do hardware ray tracing, so the look is built from cheaper techniques. The terrain worker ray-marches the height field from every terrain point towards the sun (soft shadows cast by mountains and canyon rims across kilometres) and around the horizon (sky visibility, so canyon floors really go dark). The result is baked into each terrain chunk, tree and titan as it streams in. Water uses a real planar reflection render of the scene. Post-processing adds HDR bloom and screen-space god rays. Depth uses a reversed-Z buffer where supported, plus a near plane that moves with altitude, for 50 km views.
- **Flight model:** see the notes at the top of `physics.js`. `node tests/flight-sim.mjs` runs the model without a browser and prints, for each bird, glide speed and glide ratio, top dive speed wings tucked vs open, climb rate while flapping, boost speed, take-off, and turning.

  Current results:

  | Bird | Glide ratio | Top dive (tucked / open) | Tightest level turn |
  |---|---|---|---|
  | Hawk | about 11:1 | ~106 / ~54 m/s | |
  | Seagull | about 16–18:1 | | ~30 m radius |
  | Condor | about 17–21:1 (it slowly bobs up and down in a glide, so the figure depends on when it's measured) | | ~70 m radius |
  | Pigeon | 7:1 | | |

  The pigeon can't hold its tightest turn without flapping, which is deliberate.
- **Quality:** Auto chooses Medium on phones and High on desktop. High adds real-time sun shadows, 4× MSAA, full-rate half-resolution reflections and longer view/tree/titan distances. Medium renders reflections at one-third resolution every other frame. Low turns reflections off. Resolution also scales itself up and down to keep the frame rate steady.

## Third-party assets

The download and conversion script is `tools/fetch-assets.mjs`, so every downloaded file can be traced to its source.

| Asset | Source | Licence |
|---|---|---|
| HDRI skies: `rustig_koppie_puresky` (forest), `table_mountain_1_puresky` (coast), `kloofendal_48d_partly_cloudy_puresky` (mountains), `industrial_sunset_02_puresky` (city) | [Poly Haven](https://polyhaven.com) | CC0 |
| PBR textures: `aerial_grass_rock`, `forest_leaves_04`, `rocky_terrain_02`, `aerial_rocks_02`, `snow_field_aerial`, `aerial_beach_01`, `knotted_pine_bark`, `aerial_asphalt_01` | Poly Haven | CC0 |
| Tree textures (foliage cards and bark): `fir_tree_01` (twig, bark), `pine_tree_01` (twig, bark), `island_tree_01` (leaves, branches), `japanese_cedar_bark`. Downloaded by `tools/trees/fetch-sources.mjs` and rendered into foliage cards in Blender. The palm frond card is assembled in Blender from the island-tree leaves | Poly Haven | CC0 |
| `waternormals.jpg` | three.js examples | MIT (three.js repo) |
| **Hawk In Full Wingspan** by [restore50](https://sketchfab.com/restore50) — [Sketchfab](https://sketchfab.com/3d-models/hawk-in-full-wingspan-160aa78ceba04adeb0794266cd74257c) (supplied by you). Optimised by `tools/optimize-hawk.mjs` into `hawk_hi.glb` (88k tris, first-person wings) and `hawk_lo.glb` (13k tris, soaring hawks + menu) | Sketchfab | CC-BY-4.0: attribution required (this line) |
| `stork.glb`, `parrot.glb` (ambient flocks on the coast, mountains and city) | three.js examples (originally from the RO.ME project) | They ship in the MIT-licensed three.js repo, but I have **not verified** separate licence terms for the models. Replace them before any commercial release. |
| three.js r186 (vendored in `vendor/three`) | [three.js](https://threejs.org) | MIT |

### Music and sound effects

All from Wikimedia Commons. I checked each licence against the file page's metadata; none are NonCommercial or NoDerivatives. Every file was trimmed, loudness-normalised and transcoded to AAC `.m4a` (music 128 kb/s stereo, effects 96 kb/s mono; ambiences cut into 30–36 s crossfaded loops). `assets/audio/credits.json` has the full details, and the same credits appear in the pause menu under *Credits & licences*.

| File | Recording | Licence |
|---|---|---|
| `music_forest.m4a` | Ride of the Valkyries (Die Walküre, Act 3 prelude) — Richard Wagner (1813–1883); Conducted by Philip Milman (pmmusic.pro); per the file page, funded by Ludwig and Schlatt | [CC BY 3.0](https://commons.wikimedia.org/wiki/File:Ride_of_the_Valkyries.ogg) |
| `music_mountains.m4a` | In the Hall of the Mountain King (Peer Gynt Suite No. 1, Op. 46) — Edvard Grieg (1843–1907); Czech National Symphony Orchestra, performing as the Musopen Symphony Orchestra (Musopen Kickstarter project) | [Public domain](https://commons.wikimedia.org/wiki/File:Musopen_-_In_the_Hall_Of_The_Mountain_King.ogg) |
| `music_coast.m4a` | The Hebrides (Fingal's Cave) Overture, Op. 26 — Felix Mendelssohn (1809–1847); Musopen Symphony Orchestra (Musopen) | [Public domain](https://commons.wikimedia.org/wiki/File:Mendelssohn_-_Hebrides_Overture,_Op._26_(Musopen_Symphony).flac) |
| `music_city.m4a` | Flight of the Bumblebee (The Tale of Tsar Saltan, Op. 57) — Nikolai Rimsky-Korsakov (1844–1908); Concert Band of the United States Air Force Band of the Rockies (from "Hands Across the Sea", 2007) | [Public domain](https://commons.wikimedia.org/wiki/File:Flight_of_the_Bumblebee_-_Concert_Band_-_United_States_Air_Force_Band_of_the_Rockies.mp3) |
| `music_menu.m4a` | Symphony No. 9 in E minor "From the New World", Op. 95 – IV. Allegro con fuoco — Antonín Dvořák (1841–1904); Musopen recording (orchestra not named on the file page) | [Public domain](https://commons.wikimedia.org/wiki/File:Antonin_Dvorak_-_symphony_no._9_in_e_minor_%27from_the_new_world%27,_op._95_-_iv._allegro_con_fuoco.ogg) |
| `call_hawk_1.m4a` | Red-tailed Hawk (Buteo jamaicensis) call, XC71575; Jonathon Jongsma (via xeno-canto) | [CC BY-SA 3.0](https://commons.wikimedia.org/wiki/File:Buteo_jamaicensis_-_Red-tailed_Hawk_XC71575.mp3) |
| `call_hawk_2.m4a` | Screaming Hawk; PsychoBird (via Soundbible) | [CC BY 3.0](https://commons.wikimedia.org/wiki/File:Screaming_Hawk.wav) |
| `call_hawk_3.m4a` | Red-shouldered Hawk (Buteo lineatus), Gainesville FL; G. McGrane | [Public domain](https://commons.wikimedia.org/wiki/File:Red-shouldered_Hawk.ogg) |
| `call_gull_1.m4a` | Gull 1 – Herring Gull (Larus argentatus), Long Island USA 1999; avphillips (PDSounds) | [Public domain](https://commons.wikimedia.org/wiki/File:Gull_1.ogg) |
| `call_gull_2.m4a` | Gull 2 – Herring Gull (Larus argentatus), Damariscotta Falls, Maine 1998; avphillips (PDSounds) | [Public domain](https://commons.wikimedia.org/wiki/File:Gull_2.ogg) |
| `call_gull_3.m4a` | Western Gull, Golden Gate National Recreation Area; National Park Service | [Public domain](https://commons.wikimedia.org/wiki/File:Western_Gull_Golden_Gate_National_Recreation_Area.ogg) |
| `call_pigeon_1.m4a` | Rock Dove (Columba livia) call, XC539061, Paris; Marie-Lan Taÿ Pamart (via xeno-canto) | [CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:Columba_livia_-_Rock_Dove_XC539061.mp3) |
| `call_pigeon_2.m4a` | Rock Dove (Columba livia) call, XC541143, Paris; Marie-Lan Taÿ Pamart (via xeno-canto) | [CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:Columba_livia_-_Rock_Dove_XC541143.mp3) |
| `call_raven_1.m4a` | Common Raven, Grand Teton National Park; National Park Service | [Public domain](https://commons.wikimedia.org/wiki/File:Common_Raven_Grand_Teton_National_Park.ogg) |
| `flap_pigeon.m4a` | Aleteo de aves (bird wing flapping), Isla Anapia, Puno, Peru; Vega16 (Susurros del Lago project) | [CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:Wiki_Aleteo_de_aves.wav) |
| `amb_forest.m4a` | forest ambience (20090610_0); nille (PDSounds) | [Public domain](https://commons.wikimedia.org/wiki/File:20090610_0_ambience.ogg) |
| `amb_waves.m4a` | Oceanwavescrushing (waves on the shore of Kalundborg Fjord, Røsnæs); Luftrum (freesound.org/people/Luftrum/sounds/48412/) | [CC BY 3.0](https://commons.wikimedia.org/wiki/File:Oceanwavescrushing.ogg) |
| `amb_wind.m4a` | Wind in Swedish pine forest at 25 m/s; W.carter | [CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:Wind_in_Swedish_pine_forest_at_25_mps.ogg) |

Caveats: the *Ride of the Valkyries* licence relies on the uploader's statement, which I couldn't verify upstream, and it may be a sample-library rendition rather than a live orchestra. The three Musopen recordings are public domain by Musopen's release. `flap_pigeon.m4a` is a generic bird wing-flap, not a pigeon specifically. *Flight of the Bumblebee* is a concert-band arrangement, 1:15 long, so it loops often. The CC BY-SA clips stay under BY-SA as derivatives.

The Poly Haven HDRIs load in two forms. A 1k `.hdr` provides image-based lighting and the sun direction and colour. A 4k tonemapped JPG provides the visible sky.

## Audio

Each world has its own orchestral piece, streamed so long tracks don't sit in memory. It swells and brightens as you speed up, dive or boost, and is muffled underwater. The menu plays Dvořák's *New World* finale once you first touch the screen (iOS only allows audio after a user gesture). Wind is procedural and layered: a low roar, a stereo rush that pans as you bank, and a whistle through the feathers in fast dives. There are gusts, a whoosh on banks, rolls and dives, wing beats, the climb beeper, real bird calls every 15–40 s (hawks and ravens in The Wilds, gulls on the coast, pigeons in the city) and biome ambience loops that fade with height.

## Known limitations of V1

- **Not tested on a real iPhone.** All testing so far used headless Chromium with software WebGL: screenshots of every biome, scripted landing, take-off and plunge checks, and touch emulation at 844×390. At the spawn point on Medium, one frame measured about 200 draw calls in The Wilds, 215 at the coast, 130 in the mountains and 400 in the city (1–2.3 million triangles), not counting the reflection pass. The bigger world, titans, baked lighting and reflections all cost more than V1. The Blender trees are heavier than the old procedural ones. Over dense Wilds forest on Medium, the 3D trees alone come to about 1.2 million triangles: roughly 250 trees at full detail within 85–110 m and about 2,900 at LOD1 out to 380 m. Real device frame rate is unmeasured, and Low quality may be needed on older iPhones.
- **Wings:** the hawk uses the real scan. It has no skeleton, so flapping and folding are approximated by bending the wing geometry in a shader (outer wing lags, fold sweeps back); it won't match a properly rigged wing up close. The seagull, condor and pigeon still use the procedural feather rig.
- **Trees are Blender-generated, not scanned.** Poly Haven's tree models are 2–17 million polygons each, far too heavy to draw in real time on a phone. Instead, `tools/trees/` runs headless Blender:
  - It renders Poly Haven twig and leaf textures into photographic foliage cards.
  - It builds seven species (redwood, fir, pine, broadleaf, palm and two titans) from bark tubes and those cards, with baked crown occlusion.
  - Each species is exported as a GLB at two levels of detail, roughly 300–2,100 triangles for normal trees and 2,000–4,900 for titans.

  Impostors are still baked at load time for the distance. Up close the cards are visible as flat planes, and the pine card carries some dry orange needles from the source texture. To rebuild the trees, run these in order:
  1. `node tools/trees/fetch-sources.mjs`
  2. `blender -b -P tools/trees/build_cards.py -- build/tree-src build/tree-cards`
  3. `blender -b -P tools/trees/build_trees.py -- build/tree-out [build/tree-previews]`
  4. `node tools/trees/build_atlas.mjs`
- **Fog and clouds are approximations.** The "volumetric" fog is analytic height fog with sun in-scattering, not raymarched. Clouds are lit billboards plus a cloud-deck shader, not volumetric.
- **Mountain faces** can look streaky ("curtain" shading) at distance where the height-field grid is coarse on very steep slopes.
- **Physics shortcuts.** Rivers and lakes all sit at one water level. Underwater diving is faked (tint, buoyancy, a random fish). Collisions use the height field, tree cylinders and cones, and building boxes.
