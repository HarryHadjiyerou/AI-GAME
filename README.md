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

```bash
npm start              # serves on http://localhost:8080
```

or anything equivalent:

```bash
python3 -m http.server 8080
npx serve .
```

Then open `http://localhost:8080`. On a phone, put the phone and the computer on
the same network and browse to the machine's LAN address.

---

## Controls

**Phone — tilt.** The phone *is* the bird.

| | |
|---|---|
| Roll the phone left / right | Bank, and therefore turn |
| Tip it away from you | Nose down |
| Tip it back towards you | Nose up |
| Tap | One wingbeat |
| Hold | Tuck the wings — dive |
| Two-finger tap | Re-zero the tilt neutral point |

iOS only hands over the motion sensors after an explicit permission prompt, and
only from inside a user gesture, so AVES asks on the **Take flight** button. If
you decline, or the device has no sensor, dragging on the screen does the same
job.

**Desktop.** `A`/`D` or `←`/`→` bank, `W`/`S` or `↑`/`↓` pitch, `Space` flaps,
`Shift` tucks, mouse drag looks around. `Esc` returns to the menu, `P` hides the
interface for screenshots, `F` shows a performance readout.

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
│   ├── assets.js         CDN streaming + procedural fallbacks for everything
│   ├── atmosphere.js     planet curvature + fog, injected into every material
│   ├── postfx.js         fisheye, peripheral blur, speed streak, vignette
│   └── input.js          tilt / drag / keyboard, iOS permission flow
├── flight/
│   ├── physics.js        the flight model
│   ├── camera.js         head stabilisation, saccades, FOV
│   └── wings.js          procedural articulated wings
├── world/
│   ├── fields.js         the four height fields  (no three.js — pure functions)
│   ├── terrain.js        quadtree LOD mesh + four-layer splat shader
│   ├── water.js          Gerstner waves, depth ramp, shore foam
│   ├── sky.js            HDRI environment, sun, wrapping billboard cloudscape
│   ├── vegetation.js     instanced trees in tiles, with wind
│   ├── city.js           procedural blocks, facade shader, traffic
│   ├── flock.js          the GLB birds, as distant company
│   └── worlds.js         assembles the four worlds
└── ui/
    ├── menu.js           the mini planet
    └── hud.js            gauges

tools/
├── flight-test.js        wind tunnel for the flight model      (npm test)
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

Everything third-party is streamed live from its own CDN at runtime and is CC0
or otherwise free to use. Nothing is redistributed in this repository. See
[`docs/ASSETS.md`](docs/ASSETS.md) for the full list, the licences, and why the
downloaded bird models are used where they are.

If the network is unavailable, or you turn streaming off in the settings, the
game still flies — it just looks hand-painted instead of photographed. Every
remote load has a procedural fallback.

---

## Tests

```bash
npm test                  # flight model + height fields
npm run test:flight       # glide ratios, stoops, turns, stalls, thermals
npm run test:terrain      # relief, water coverage, spawn safety, sampling cost
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
