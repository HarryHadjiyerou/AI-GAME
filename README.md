# ⚔️ Elfblade: Trial of the Five Realms

A hand-crafted HTML5 side-scrolling **runner-brawler**. You are an elf warrior
auto-running through five fantasy realms, cutting down goblins, trolls and
armored war-hogs, dodging hazards, and building a power meter toward two
selectable special attacks — ending in a multi-phase dragon boss fight.

**Play it:** open `index.html` from any static web server (or GitHub Pages).
Works on desktop and mobile browsers; touch-first controls with full
keyboard mirroring. No build step, no dependencies.

```bash
# quickest way to run locally
python3 -m http.server 8000     # then open http://localhost:8000
```

## Controls

| Action | Touch | Keyboard |
|---|---|---|
| Jump | **JUMP** button, tap left half, or swipe up | `Space` / `W` / `↑` |
| Slide / dodge | **SLIDE** button or swipe down | `S` / `↓` |
| Sword attack (3-hit combo) | **⚔** button or tap right half | `J` / `X` / `F` / `Enter` |
| Force Bolt / Radius Blast | tap the glowing icons (only when the power meter is full) | `1` / `2` |
| Pause / mute | corner buttons | `P` or `Esc` / `M` |

## The five realms — each visually distinct

1. **The Verdant Cliffs** — bright daylight, floating islands with waterfalls, drifting leaves.
2. **The Moonveil Woods** — night: twin moons, starfield, silhouetted pines, fireflies.
3. **The Frostfang Peaks** — frozen mountains, glacier shards, falling snow.
4. **The Ashen Wastes** — storm-scarred dusk, lightning strikes, wind-blown ash, ember horizon.
5. **The Cinderthrone** — hellish finale: erupting volcanoes, lava veins, rising embers,
   pulsing lava-cracked ground — the arena for **Varkhul, Tyrant of Embers**.

Each background is a layered parallax illustration (sky + 3 depth layers +
ambient particle system + themed ground), pre-rendered to tiles for smooth 60fps.

## Combat feel ("juice")

Weapon hits are the core of the game's feel, so they get the full treatment:
sword swings are eased rotational arcs with motion-ghosting and layered glowing
slash trails; landing a hit triggers **hit-stop** (impact frames), directional
spark sprays, floating damage numbers, knockback and screen shake scaled to the
blow; the third combo hit is a bigger golden roundhouse. Kills launch ragdoll
spins. Dragon fireballs can be **deflected with a well-timed swing**.

## Music (free sources, escalating intensity)

All tracks by **Kevin MacLeod (incompetech.com)**, licensed under
[Creative Commons: By Attribution 4.0](http://creativecommons.org/licenses/by/4.0/),
chosen so drums and intensity build as you progress:

| Stage | Track | Feel |
|---|---|---|
| 1 | *Celtic Impulse* | bright celtic adventure |
| 2 | *Lord of the Land* | brooding medieval night |
| 3 | *Five Armies* | epic orchestral — war drums arrive |
| 4 | *Stormfront* | aggressive, heavier percussion |
| 5 | *Ritual* | dark, relentless heavy drums for the boss |

Sound effects (slashes, impacts, roars, UI) are generated procedurally with
WebAudio — no audio files needed.

## Project structure

```
index.html
css/style.css          page shell + letterboxing
js/config.js           ALL tuning + data-driven level spawn scripts
js/assets.js           sprite pipeline (swappable image assets + fallback)
js/audio.js            music manager + procedural SFX
js/input.js            touch gestures, buttons, keyboard
js/effects.js          particles, slash trails, hit-stop, shake, damage text
js/background.js       the 5 parallax background painters
js/entities.js         player, enemies, mini-bosses, dragon, projectiles, props
js/ui.js               fantasy-styled HUD + all menu screens
js/game.js             state machine, level flow, collision, main loop
assets/sprites/*.svg   character & prop art — swap any file to reskin
assets/music/*.mp3     CC-BY soundtrack
```

**Swappable art:** every character/enemy/prop is an image file in
`assets/sprites/`. Replace a file (same name) to drop in final art — no code
changes. Missing files render as clearly-labelled placeholders instead of
breaking the game.

**Data-driven levels:** every enemy wave, rock, gap, floating platform and
heart pickup is an entry in `LEVELS[n].events` in `js/config.js`, so all five
levels can be rebalanced without touching engine code.

## Design decisions made (per the brief's "use your judgment" mandate)

- **Retry on death → boss-gate checkpoint.** Dying mid-run restarts the level;
  dying to a mini-boss/boss restarts *at* that fight ("Rise again at the gate").
  Full level-restart felt punishing on mobile; a free boss retry keeps the
  difficulty in the fight itself.
- **Special selection:** two large glowing icons appear only when the meter is
  full; tap them (or press 1/2) to fire. The meter resets after either.
- **Falling into a gap** costs 15 HP and respawns you past the gap (with brief
  invulnerability) rather than killing instantly — keeps the run flowing.
- **Rocks** shatter if you run into them (8 HP penalty) instead of hard-blocking
  the auto-runner; attack them ahead of time or jump for a clean pass.
- **Mini-boss = arena moment:** the run halts and a named, scaled-up variant
  with an aura and boss bar closes in (Grukka, Mogdur, Frostmaw, Ashbrand).
- **Dragon fight** is arena-style with telegraphed patterns: swoops (jump),
  grounded fire breath (slide under), lobbed fireballs (dodge or deflect),
  phase-3 meteors (slide = dodge-roll i-frames), with clear "STRIKE NOW!"
  vulnerability windows — airborne damage is reduced so the windows matter.
- **Progression** saves to `localStorage` (unlocked stages + best scores);
  realm select on the title screen.

## Phase 2 (iOS via Capacitor)

The game is a static bundle with touch-first input and letterboxed 16:9
rendering, so it can be wrapped as-is with Capacitor (`npx cap add ios`,
point `webDir` at the repo root).
