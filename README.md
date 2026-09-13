# AVES

A first-person bird flight prototype. You are not steering a bird from behind —
you are inside its head, looking out past your own wings.

Four birds, four worlds, one flight model:

| | | |
|---|---|---|
| 🦅 **Hawk** | The Forest | Redwoods, a river valley, and the stoop |
| 🕊️ **Seagull** | The Coast | Ridge lift off the cliffs, and dive-bombing the swell |
| 🦅 **Condor** | The High Range | Thermals above the snow line, clouds below you |
| 🐦 **Pigeon** | The City | Rooftops, glass canyons, and gaps you shouldn't fit through |

Pure HTML, CSS and JavaScript on top of [three.js](https://threejs.org). No build
step, no bundler, no framework. Open `index.html` from a local server and fly.

---

## Running it

The game uses ES modules and an import map, so it needs to be served over HTTP —
opening the file directly with `file://` will not work.

### Online

AVES is static files with no build step, so GitHub Pages serves it as-is:
**Settings → Pages → Deploy from a branch → `main` → `/ (root)`**. The site
appears at `https://<user>.github.io/AI-GAME/` a minute or so later.

This matters for phones. Tilt controls need a secure context — iOS will not
release the motion sensors over plain `http://`, so a phone pointed at a
laptop's LAN address silently falls back to drag. An HTTPS URL is what gets
you tilt.

`.github/workflows/pages.yml` is an optional alternative that redeploys on
every push; switch the Pages source to "GitHub Actions" to use it instead.

For a drag-and-drop host instead — Netlify Drop, Cloudflare Pages, Surge —
`tools/build-site.sh` packages just the files the browser needs:

```bash
./tools/build-site.sh          # → aves-site.zip, about 90 KB
```

`index.html` sits at the archive root, which is what these hosts look for; a
single wrapping folder is the usual reason such a deploy comes back 404.

### Locally

```bash
npx --yes http-server -p 8080 -c-1 .   # or: npm start
```

or anything equivalent — `python3 -m http.server 8080`, `npx serve .`. Then open
`http://localhost:8080`. No `npm install` needed; that is only for the tests.

---

## Controls

**Phone — two floating sticks.**

| | |
|---|---|
| Left stick | Steer. Push it over to bank; pull back to raise the nose. |
| Right stick | Look around, without changing course |
| FLAP | One wingbeat. Hold for several. |
| DIVE | Fold the wings and drop |

Both sticks are floating: they appear wherever your thumb lands and follow it if
you drag past the edge, so you never have to look down to find one. Tilt
controls are still there under **Settings → Tilt the phone to fly**, where they
replace the left stick — but they are no longer the default, because a stick you
can see beats a sensor you have to learn.

iOS only hands over the motion sensors after an explicit permission prompt, and
only from inside a user gesture, so AVES asks the moment you enable tilt.

**Desktop.** `A`/`D` or `←`/`→` bank, `W`/`S` or `↑`/`↓` pitch, `Space` flaps,
`Shift` tucks, mouse drag looks around. `Esc` returns to the menu, `P` hides the
interface for screenshots, `F` shows a performance readout. A gamepad works too:
left stick steers, right stick looks, `A` or the right trigger beats.

**Graphics.** Defaults to *Auto*, which picks a coarse tier from the device and
then watches the frame rate and adjusts. It gives up reflections before
resolution — a cliff missing from the sea costs less than every edge in the
frame — drops fast, climbs back slowly, and ratchets: it will not pump between
two settings. *Ultra* renders at 1.3× and downsamples, which is the only
anti-aliasing that survives a post-processing chain intact.

**Reflections** can be pinned separately, and pinning them also takes them away
from the adaptive controller. *Off* still reflects the sky, which is most of
what water is.

**Flight assistance.** Three levels in the settings, defaulting to *Balanced*:

| | |
|---|---|
| Serene | The bird flies itself between your inputs. It will not hit the ground. |
| Balanced | Holds a glide when you let go, and pulls up if you stop paying attention |
| Wild | Nothing between you and the air |

This is a controller, not a rail. It reads total energy — a surplus of speed may
be spent climbing, a deficit has to be repaid — looks four and a half seconds
down the projected flight path for terrain, feeds forward the extra lift a bank
needs so a turn does not sag, and rolls out of the bank while it recovers. At
*Wild* it does none of it.

---

## What is actually simulated

The flight model is a real, if simplified, aerodynamic one rather than an
arcade approximation. Every frame:

```
lift   = ½ρV²·S·CL(α)      perpendicular to the airflow, rolling with the body
drag   = ½ρV²·S·CD          along it, CD = CD₀ + CL²/πeAR
body   = ½ρV²·A_body·0.35   parasitic drag that folding the wings cannot remove
weight = mg
flap   = an impulse along the body axis, costing stamina
```

Three consequences follow from that, and they are what the game is made of:

**Banking turns you.** Lift acts perpendicular to the airflow *in the bird's own
frame*, so rolling tilts the lift vector and its horizontal component curves the
flight path. Nothing applies a yaw force. The nose then weathervanes into the
airflow. This is also why a hard turn bleeds height unless you pull.

**Pitch commands angle of attack, not attitude.** Pulling back asks the wing for
a bigger bite; a rate-limited servo rotates the body until the wing actually sees
it. Ask for more than the wing can give and it stalls — genuinely, with the lift
curve falling over into flat-plate behaviour and the buffet showing up in the
camera.

**Tucking is worth it.** Folding the wings removes most of the profile drag and
most of the area, and drops the trim angle of attack so the dive holds. Terminal
velocity is then set by the body's own drag, which is why a hawk stoops at
around 210 km/h and not 600.

Altitude and speed are freely convertible in both directions, so the loop
*climb → glide → dive → speed → pull up → altitude* is not scripted. It is just
what the equations do.

On top of that: thermals that drift downwind and are pinned to sunlit ground, so
you read the landscape to find them; ridge lift on windward slopes; stamina that
makes flapping a sprint and soaring the only way to travel far.

Run `npm test` to see the model measured:

```
── HAWK ──  1.05 kg · 0.145 m² · AR 6.4
   glide             52.3 km/h, sink 1.96 m/s, L/D 7.3
   stoop             peak 212.4 km/h, lost 358 m
   hard turn         radius 13 m, bank 68°, 2.8 g
   flap endurance    18 s of continuous beating
```

---

## What you see

**Bird vision, not a drone camera.** A bird's head is the most stabilised part
of it: the body rolls and bobs through a wingbeat while the head stays nearly
still. So the camera resists the body rather than being bolted to it. A 70° bank
shows as roughly 25° of horizon tilt — enough to read as a bank, not enough to
make anyone ill. The head lags through fast manoeuvres, tremors very slightly,
bobs out of phase with the wingbeat, and every few seconds flicks somewhere and
drifts back.

**Wings in the periphery.** Built procedurally as a three-segment arm carrying
secondaries and primaries, so they can flap on the real wingbeat phase, fold and
sweep when you tuck, flex under load, and swing asymmetrically when you bank.
The alula lifts when the wing is working hard and slow.

**A world that curves.** Everything is bent downwards by `d²/2R` around the
camera in the vertex shader, so the horizon visibly falls away and distant peaks
sink instead of marching off to infinity. The simulation still runs on a flat
plane — the bend is purely what you see, which is what makes the mini-planet
conceit work without a planet-sized world.

**Aerial perspective** with a height falloff and a forward-scattering lobe, so
haze thins as you climb and glows when you fly into the sun.

**Cloud shadows.** The ground under a cloud is in shade. The surface position is
projected up the sun direction onto the cloud deck, at the height and drifting on
the wind this world's clouds actually use, and sampled. It costs one noise lookup
per pixel and it is the difference between a landscape and a model of one.

---

## Water, and ray tracing

**There is no hardware ray tracing on the web.** WebGL 2 has no concept of it,
and it is not in WebGPU either: acceleration structures and ray queries would
need bindless resources and new API surface, and the working group has not
committed to shipping them — 2027 at the earliest, if ever. The browser path
tracers that do exist accumulate samples over seconds against a *static* scene,
which is the opposite of a bird at eighty kilometres an hour. Anyone who tells
you otherwise is describing something else.

What is available, and what AVES does, is cast real rays against the depth
buffer. Per pixel, marched, with binary refinement on the hit. Everything the
camera can see reflects correctly; anything behind the camera cannot, and falls
back to the sky — which is the same sky function the dome is painted with, so
the seam is invisible. The scene is drawn **once**. A planar reflection would be
the honest way to reflect off-screen geometry and it costs a second pass over
the whole world, which is not affordable on a phone.

Finding the water costs nothing extra: these surfaces are opaque, so the alpha
channel of the scene buffer is dead weight, and `src/core/style.js` writes a
surface id into it. See `src/core/screenspace.js`.

Two more effects ride in the same pass, because the depth reads are the
expensive part and they share them:

- **Shafts.** A march from each pixel towards the sun that accumulates only the
  steps the depth buffer says are sky. The beams are the gaps between the
  occluders.
- **Contact shadows.** A short march towards the sun asking whether anything is
  in the way. Not a shadow map and no substitute for one — it reaches metres,
  not kilometres — but metres is where a missing shadow shows most.

The water shading underneath all of it is built on Fresnel rather than on
painted colour. The ratio of sky to depth is computed per pixel from the angle
between the eye and the real wave normal, so the horizon goes to mirror and the
water under the bird goes to glass without either being authored. Under the
surface it is Beer-Lambert absorption per channel — water eats red first and
blue last, which is the entire reason shallow water is green over sand and deep
water is blue over nothing. Then refraction off the wave slope, glare shaped by
the wave normals so it breaks into a path rather than a hotspot, and foam on the
crests and along the depth contour.

The fine ripple fades out with distance on purpose. Past a few hundred metres one
pixel covers many ripples and a normal sampled from the middle of them is noise;
the average of a lot of ripples pointing every way is flat, so the sea converges
to a mirror as it recedes — which is also what a real one does.

---

## Architecture

```
index.html            menu, HUD, import map
styles/ui.css

src/
├── main.js               renderer, state machine, fixed-step loop, settings
├── config/birds.js       the four birds: mass, wing area, coefficients, feel
├── core/
│   ├── noise.js          simplex, fBm, ridged, domain warp  (no dependencies)
│   ├── assets.js         the three GLB birds, and the procedural sprites
│   ├── atmosphere.js     planet curvature + fog, injected into every material
│   ├── postfx.js         fisheye, peripheral blur, speed streak, vignette
│   ├── input.js          sticks / keyboard / gamepad / tilt, iOS permission flow
│   ├── style.js          the shading model every material in the game shares
│   ├── screenspace.js    ray-marched reflections, shafts, contact shadows
│   └── quality.js        watches the frame rate and moves the render scale
├── flight/
│   ├── physics.js        the flight model
│   ├── camera.js         head stabilisation, saccades, FOV
│   └── wings.js          procedural articulated wings
├── world/
│   ├── fields.js         the four height fields  (no three.js — pure functions)
│   ├── terrain.js        quadtree LOD mesh + four-layer splat shader
│   ├── water.js          Gerstner waves, depth ramp, shore foam
│   ├── sky.js            procedural sky dome, sun, cloud strata, palette IBL
│   ├── vegetation.js     instanced trees in tiles, with wind
│   ├── city.js           procedural blocks, facade shader, traffic
│   ├── flock.js          the GLB birds, as distant company
│   ├── palette.js        four times of day, as colour
│   ├── weather.js        six weather states, wind, gusts, rain, lightning
│   ├── spectacle.js      visible thermals, floating islands, waterfalls
│   └── worlds.js         assembles the four worlds
├── flight/
│   └── assist.js         energy controller, terrain look-ahead, bank compensation
└── ui/
    ├── menu.js           the mini planet
    ├── touch.js          floating dual sticks
    └── hud.js            gauges

tools/
├── flight-test.js        wind tunnel for the flight model      (npm test)
├── assist-test.js        does the assist actually stop you hitting the ground
├── quality-test.js       the adaptive-quality controller, against scripted frame rates
├── screenspace-test.js   where the sun lands on screen, and the surface ids
├── lint.js               module parse, GLSL reserved words, template literals
├── terrain-test.js       statistical checks on the height fields
└── smoke.mjs             headless browser: boots, launches each world, flies it
```

Each world is, at bottom, one function of `(x, z)`. The terrain mesh, the water
depth, where trees may grow, where a city block gets built and where the bird
hits the ground all read that same function, so nothing can disagree with
anything else. The fields are kept free of three.js precisely so they can be
tested on their own — see `tools/terrain-test.js`.

---

## Assets

Almost nothing is downloaded. The sky, the terrain, the water, the vegetation,
the city, the weather and the wings are all generated as the game runs, from
noise and a palette. The complete list of remote requests is three.js, and three
GLB bird models totalling about 300 KB that are used for distant flocks and are
optional.

An earlier version streamed roughly 8 MB of HDRI and PBR texture per world from
Poly Haven. It was removed — it cost the first ten seconds of every session and
it looked worse, because a photographed ground under a photographed sky over
generated terrain never resolves into one picture. See
[`docs/ASSETS.md`](docs/ASSETS.md) for the licences and the full reasoning.

---

## Tests

```bash
npm test                  # lint + flight model + assist + height fields
npm run test:flight       # glide ratios, stoops, turns, stalls, thermals
npm run test:terrain      # relief, water coverage, spawn safety, sampling cost
npm run test:assist       # the assist: recoveries, no ground contact, no oscillation
npm run test:quality      # adaptive quality: backs off, climbs back, never pumps
npm run test:screenspace  # sun projection and surface ids
npm run test:smoke        # headless Chromium: boots and flies all four worlds
node tools/smoke.mjs hawk # ... or just one
```

The smoke test needs Playwright and a Chromium build:

```bash
npm install && npx playwright install chromium
```

The smoke test runs against a software rasteriser, so it measures correctness —
no console errors, geometry actually drawn, nothing going non-finite — rather
than frame rate. Screenshots land in `tools/tmp/shots/`.

---

## Status

This is a prototype. It flies, it looks like somewhere, and the four birds feel
genuinely different from each other. What it does not yet have is a *game* —
there are no objectives, no scoring, nothing to chase. That is deliberate: the
flight had to be worth doing before anything was built on top of it.

Natural next steps, roughly in order of how much they would add:

- something to hunt, perch on, or fly through
- real GLB vegetation and city kits replacing the procedural stand-ins
- audio — wind that rises with airspeed, wingbeats, gulls, traffic
- a genuinely spherical world rather than a curvature shader
