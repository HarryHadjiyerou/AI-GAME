/* ═══════════════════════════════════════════════════════════
   AVES — entry point.

   Owns the renderer, the state machine (boot → menu → loading →
   flying), the fixed-step flight loop and the settings. Everything
   else is a module it wires together.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { Assets, BIRD_GLB } from './core/assets.js';
import { BirdVision, QUALITY } from './core/postfx.js';
import { Controls } from './core/input.js';
import { TouchControls } from './ui/touch.js';
import { FlightAssist, ASSIST_LEVELS, ASSIST_ORDER } from './flight/assist.js';
import { clamp, damp } from './core/noise.js';
import { BIRDS, BIRD_ORDER } from './config/birds.js';
import { Flight, FLIGHT_STATE } from './flight/physics.js';
import { BirdCamera } from './flight/camera.js';
import { Wings } from './flight/wings.js';
import { AutoQuality } from './core/quality.js';
import { buildWorld } from './world/worlds.js';
import { MenuPlanet } from './ui/menu.js';
import { Hud, buildBirdRail, showBird } from './ui/hud.js';

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = 'aves.settings.v1';

const DEFAULTS = {
  assist: 'balanced',
  tilt: false,
  quality: 'auto',
  fov: 104,
  fisheye: 0.30,
  headMotion: 1,
  sensitivity: 1,
  invertPitch: false,
  wings: true,
  hud: true,
  stream: true,
};

/* ── fixed-step accumulator ─────────────────────────────── */
const PHYS_STEP = 1 / 120;
const MAX_STEPS = 6;

class Game {
  constructor() {
    this.settings = this._loadSettings();
    this.state = 'boot';
    this.bird = BIRD_ORDER[0];
    this.selected = 0;
    this.world = null;
    this.flight = null;
    this.wings = null;
    this.accumulator = 0;
    this.fade = 1;
    this.fps = 60;
    this.showPerf = false;
    this.paused = false;

    this.hud = new Hud(document);
    this._bindUi();
  }

  /* ══════════════ boot ══════════════ */

  async boot() {
    const canvas = $('scene');
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas, antialias: false, powerPreference: 'high-performance',
        stencil: false, depth: true,
      });
    } catch (e) {
      return this._fatal('This browser could not start WebGL. AVES needs hardware 3D to run.');
    }
    if (!this.renderer.capabilities.isWebGL2) {
      return this._fatal('AVES needs WebGL 2. Your browser reports WebGL 1 only.');
    }

    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // The composer renders several times per frame and three resets its
    // counters on each one, so accumulate them ourselves instead.
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.12, 42000);
    this.scene.add(this.camera);

    this.assets = new Assets(this.renderer, { stream: this.settings.stream });
    this.vision = new BirdVision(this.renderer, this.scene, this.camera, this._baseTier());

    /* Auto quality.
     *
     * The tier above is a guess from the hardware. This watches what the
     * device actually manages and moves the render resolution to match, so a
     * phone that cannot hold sixty gets a slightly softer picture instead of
     * a stutter, and a machine with headroom gets the pixels back. It only
     * runs when the player has left quality on Auto. */
    this.auto = new AutoQuality({
      target: Math.min(60, Math.round(screen?.refreshRate ?? 60)) || 60,
      ceiling: QUALITY[this._baseTier()].scale,
      onScale: (s) => this.vision?.setRenderScale(s),
      onBloom: (on) => this.vision?.setBloom(on),
    });
    this.auto.enabled = this.settings.quality === 'auto';
    if (this.auto.enabled) this.vision.setRenderScale(this.auto.scale);
    this.vision.setFisheye(this.settings.fisheye);

    this.birdCam = new BirdCamera(this.camera, { fov: this.settings.fov });
    this.birdCam.motion = this.settings.headMotion;

    this.touch = new TouchControls(document.body);
    this.controls = new Controls(canvas, {
      touch: this.touch,
      sensitivity: this.settings.sensitivity,
      invertPitch: this.settings.invertPitch,
    });

    addEventListener('resize', () => this._resize(), { passive: true });
    addEventListener('orientationchange', () => setTimeout(() => this._resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'flying') this.pause(true);
    });

    await this._buildMenu();
    this._setState('menu');
    this._loop();
  }

  _fatal(msg) {
    $('boot').classList.add('hidden');
    $('fatal-msg').textContent = msg;
    $('fatal').classList.remove('hidden');
  }

  /* ══════════════ menu ══════════════ */

  async _buildMenu() {
    this._progress(0.05, 'building the planet');
    this.planet = new MenuPlanet($('planet'));

    buildBirdRail($('bird-rail'), BIRDS, BIRD_ORDER, (i, id) => this._selectBird(i, id));
    this._selectBird(0, BIRD_ORDER[0]);

    // The menu birds are the same GLB files the worlds use, so loading them
    // now means they are already warm when a world asks for one.
    if (this.settings.stream) {
      this._progress(0.3, 'fetching the birds');
      const names = Object.keys(BIRD_GLB);
      const models = [];
      for (let i = 0; i < names.length; i++) {
        models.push(await this.assets.birdModel(names[i]));
        this._progress(0.3 + 0.6 * ((i + 1) / names.length), `fetching the birds`);
      }
      this.planet.addBirds(models.concat(models.slice(0, 3)));
    }

    this._progress(1, 'ready');
    await new Promise((r) => setTimeout(r, 260));
    $('boot').classList.add('hidden');
    $('menu').classList.remove('hidden');
    this.planet.start();
    this.planet.resize();
  }

  _selectBird(i, id) {
    this.selected = i;
    this.bird = id;
    for (const c of $('bird-rail').children) c.classList.toggle('on', c.dataset.bird === id);
    showBird({ name: $('d-name'), world: $('d-world'), blurb: $('d-blurb'), stats: $('d-stats') }, BIRDS[id]);
    this.planet?.select(i);
  }

  _progress(p, label) {
    $('boot-fill').style.width = `${clamp(p, 0, 1) * 100}%`;
    if (label) $('boot-status').textContent = label;
  }

  /* ══════════════ launching ══════════════ */

  async launch() {
    if (this.state === 'loading') return;
    this._setState('loading');
    $('menu').classList.add('hidden');
    $('boot').classList.remove('hidden');
    this._progress(0.02, 'asking for the sky');

    // Tilt is opt-in. iOS will only hand over the motion sensors from inside
    // a gesture, and this call is still within the click that got us here —
    // but nobody has to answer a permission prompt just to start playing.
    if (this.settings.tilt && Controls.orientationSupported() && !this.controls.hasOrientation) {
      await this.controls.requestOrientation();
    }

    this.planet?.stop();

    const cfg = BIRDS[this.bird];
    try {
      this.assets.stream = this.settings.stream;
      this.world = await buildWorld(cfg.world, {
        scene: this.scene,
        camera: this.camera,
        renderer: this.renderer,
        assets: this.assets,
        quality: QUALITY[this._baseTier()],
        progress: (p, label) => this._progress(0.05 + p * 0.9, label),
      });
      this.vision.setGrade(this.world.palette);
    } catch (e) {
      console.error(e);
      return this._fatal(`Could not build ${cfg.worldName.toLowerCase()}: ${e.message}`);
    }

    this._progress(0.97, 'growing feathers');

    this.flight = new Flight(cfg, this.world);
    this.assist = new FlightAssist(cfg, this.settings.assist);
    const sp = this.world.spawn;
    const surface = Math.max(this.world.height(sp.x, sp.z), this.world.waterLevel);
    this.flight.spawn(sp.x, surface + sp.alt, sp.z, sp.heading);

    this.wings?.dispose();
    this.wings = new Wings(this.world.palette, cfg, {
      color: cfg.wingColor,
      tipColor: cfg.wingTipColor,
      // Wide enough that the outer third of the wing sits at the frame edge;
      // see the note in wings.js on why this is a separate cone.
      fov: 132,
    });
    this.wings.sync(this.camera, this.world.style.u.uSunDir.value, this.world.palette.sunColor);
    this.wings.setVisible(this.settings.wings);
    this.vision.setOverlay(this.wings.scene, this.wings.camera);
    // A fresh world streams in for the first few seconds; judging the device
    // on those frames would drop the resolution for a cost that is about to
    // disappear on its own.
    this.auto.reset(6);

    this.birdCam.reset(this.flight);
    this.birdCam.setFov(this.settings.fov);
    this.birdCam.motion = this.settings.headMotion;

    // Prime the streaming systems so the first frame is not an empty world.
    for (let i = 0; i < 48; i++) this.world.update(this.flight.position, 1 / 60, this.flight);
    await this.renderer.compileAsync?.(this.scene, this.camera);

    this._progress(1, 'go');
    await new Promise((r) => setTimeout(r, 200));

    $('boot').classList.add('hidden');
    this.hud.show(cfg);
    this.hud.setVisible(this.settings.hud);
    this.controls.enable();
    this.controls.calibrate();
    this.hud.toast(this.controls.describe(), 3.4);
    this.fade = 1;
    this.accumulator = 0;
    this._setState('flying');
    if (this.assets.failures.length) {
      console.warn('AVES: some assets did not load —', this.assets.failures.join(', '));
    }
  }

  /* ══════════════ returning to the menu ══════════════ */

  toMenu() {
    if (this.state !== 'flying' && this.state !== 'paused') return;
    this.controls.disable();
    this.hud.hide();
    this.world?.dispose();
    this.world = null;
    this.flight = null;
    this.wings?.dispose();
    this.wings = null;
    this.assist = null;
    this.vision.setOverlay(null, null);
    this._setState('menu');
    $('menu').classList.remove('hidden');
    this.planet?.start();
    this.planet?.resize();
  }

  pause(on) {
    this.paused = on;
    if (on) this.controls.disable(); else this.controls.enable();
  }

  /**
   * The coarse tier the world is built at.
   *
   * 'auto' is not a tier — it is a promise to adjust afterwards — so it has to
   * resolve to something before a single patch of terrain is generated. The
   * signals available before the first frame are weak (there is no way to ask
   * a browser how fast its GPU is), so this stays conservative: a phone or a
   * machine with few cores starts a tier down and climbs if it can, which
   * costs a few seconds of softer image and avoids opening on a slideshow.
   */
  _baseTier() {
    const q = this.settings.quality;
    if (q !== 'auto') return QUALITY[q] ? q : 'medium';
    const coarse = navigator.hardwareConcurrency ?? 4;
    const touch = matchMedia?.('(pointer: coarse)')?.matches ?? false;
    const mem = navigator.deviceMemory ?? 4;
    if (touch && (coarse <= 6 || mem <= 4)) return 'low';
    if (touch || coarse <= 4) return 'medium';
    return coarse >= 12 && mem >= 8 ? 'high' : 'medium';
  }

  /* ══════════════ the loop ══════════════ */

  _loop() {
    let last = performance.now();
    const frame = (now) => {
      requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;
      this.fps = damp(this.fps, 1 / Math.max(dt, 1e-4), 0.5, dt);

      if (this.state === 'flying' && !this.paused) this.auto?.update(dt, this.fps);

      this.renderer?.info.reset();
      if (this.state === 'flying' && !this.paused) this._tick(dt);
      else if (this.state === 'flying') this._render(0);
    };
    requestAnimationFrame(frame);
  }

  _tick(dt) {
    const stick = this.controls.update(dt);
    if (stick.lookX || stick.lookY) this.birdCam.freeLook(stick.lookX, stick.lookY);

    // Flight runs at a fixed step so the aerodynamics behave identically at
    // 30 fps and at 144 — with a cap, so a long stall never spirals into a
    // death march of catch-up steps. The assist runs inside the same loop,
    // because a controller sampled at the frame rate behaves differently on a
    // phone than on a desktop, which is exactly what we are trying to avoid.
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= PHYS_STEP && steps < MAX_STEPS) {
      const demand = this.assist.update(this.flight, stick, PHYS_STEP);
      this.flight.update(PHYS_STEP, demand);
      this.accumulator -= PHYS_STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.accumulator = 0;

    const events = this.flight.drainEvents();
    if (events) this._onEvents(events);

    this.world.update(this.flight.position, dt, this.flight);
    this.birdCam.update(this.flight, dt);
    if (this.wings) {
      // Camera and wings both take the head's orientation, at the origin. The
      // wing scene's sun and environment stay in world orientation, so the
      // light on a wing swings correctly as the bird turns — while the wings
      // themselves stay locked to the eye, which is where they belong.
      this.wings.camera.quaternion.copy(this.camera.quaternion);
      this.wings.root.quaternion.copy(this.camera.quaternion);
      this.wings.update(this.flight, dt, this.camera.quaternion);
      this.wings.scene.updateMatrixWorld(true);
    }

    const ground = this.world.height(this.flight.position.x, this.flight.position.z);
    this.hud.update(this.flight, dt, {
      groundLevel: Math.max(ground, this.world.waterLevel),
      warning: this.assist.warning,
      clearance: this.assist.clearance,
      weather: this.world.weather.label,
      lift: this.world.motes.nearest(this.flight.position),
      heading: this.flight.heading,
    });

    if (this.showPerf) {
      const s = this.world.stats();
      this.hud.perf(
        `${this.fps.toFixed(0)} fps · ${this.renderer.info.render.calls} calls · ` +
        `${(this.renderer.info.render.triangles / 1000).toFixed(0)}k tris\n` +
        `${s.patches} patches · ${s.trees} trees · ${s.buildings} buildings · ${s.weather}`
      );
    }

    this._render(dt);
  }

  _render(dt) {
    this.fade = damp(this.fade, 0, 0.35, Math.max(dt, 1e-3));
    this.vision.render(Math.max(dt, 1e-3), {
      speed: this.birdCam.speedBlur ?? 0,
      water: this.flight?.underwater ? 1 : 0,
      fade: this.fade,
      flash: this.world?.weather?.flash ?? 0,
    });
  }

  _onEvents(events) {
    for (const e of events) {
      if (e === 'splash-hard') this.hud.toast('splashdown');
      else if (e === 'crash') this.hud.toast('recovering');
      else if (e === 'surface') this.hud.toast('up and out');
    }
  }

  /* ══════════════ settings & ui ══════════════ */

  _loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch (e) {
      return { ...DEFAULTS };
    }
  }

  _saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (e) { /* private mode */ }
  }

  _bindUi() {
    $('launch').addEventListener('click', () => this.launch());
    $('h-menu').addEventListener('click', () => this.toMenu());

    for (const id of ['settings', 'controls', 'credits']) {
      $(`open-${id}`).addEventListener('click', () => $(id).classList.remove('hidden'));
    }
    document.querySelectorAll('[data-close]').forEach((b) => {
      b.addEventListener('click', () => $(b.dataset.close).classList.add('hidden'));
    });

    const s = this.settings;
    const bindRange = (id, key, fmt, apply) => {
      const el = $(id), out = $(`${id}-v`);
      el.value = s[key];
      out.textContent = fmt(s[key]);
      el.addEventListener('input', () => {
        s[key] = parseFloat(el.value);
        out.textContent = fmt(s[key]);
        apply?.(s[key]);
        this._saveSettings();
      });
    };
    const bindCheck = (id, key, apply) => {
      const el = $(id);
      el.checked = !!s[key];
      el.addEventListener('change', () => { s[key] = el.checked; apply?.(el.checked); this._saveSettings(); });
    };

    bindRange('s-fov', 'fov', (v) => `${v | 0}°`, (v) => this.birdCam?.setFov(v));
    bindRange('s-fish', 'fisheye', (v) => v.toFixed(2), (v) => this.vision?.setFisheye(v));
    bindRange('s-head', 'headMotion', (v) => v.toFixed(2), (v) => { if (this.birdCam) this.birdCam.motion = v; });
    bindRange('s-sens', 'sensitivity', (v) => v.toFixed(2), (v) => { if (this.controls) this.controls.sensitivity = v; });

    bindCheck('s-invert', 'invertPitch', (v) => { if (this.controls) this.controls.invertPitch = v; });
    bindCheck('s-wings', 'wings', (v) => { this.wings?.setVisible(v); this.vision?.setOverlay(v && this.wings ? this.wings.scene : null, this.wings?.camera); });
    bindCheck('s-hud', 'hud', (v) => this.hud.setVisible(v));
    bindCheck('s-assets', 'stream', (v) => { if (this.assets) this.assets.stream = v; });
    bindCheck('s-tilt', 'tilt', async (v) => {
      if (v && Controls.orientationSupported() && !this.controls.hasOrientation) {
        const ok = await this.controls.requestOrientation();
        if (!ok) { s.tilt = false; $('s-tilt').checked = false; this._saveSettings(); }
      }
      this.controls.tiltEnabled = v && this.controls.hasOrientation;
    });

    const assistSel = $('s-assist');
    const describeAssist = () => { $('s-assist-note').textContent = ASSIST_LEVELS[s.assist].blurb; };
    assistSel.innerHTML = ASSIST_ORDER
      .map((k) => `<option value="${k}">${ASSIST_LEVELS[k].name}</option>`).join('');
    assistSel.value = s.assist;
    describeAssist();
    assistSel.addEventListener('change', () => {
      s.assist = assistSel.value;
      this.assist?.setLevel(s.assist);
      describeAssist();
      this._saveSettings();
    });

    const q = $('s-quality');
    q.value = s.quality;
    q.addEventListener('change', () => {
      s.quality = q.value;
      this.auto.enabled = q.value === 'auto';
      const tier = this._baseTier();
      this.vision?.setQuality(tier);
      const scale = this.auto.setCeiling(QUALITY[tier].scale);
      if (this.auto.enabled) this.vision?.setRenderScale(scale);
      this.auto.reset();
      this._resize();
      this._saveSettings();
    });

    addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.toMenu();
      if (e.code === 'KeyF') { this.showPerf = !this.showPerf; if (!this.showPerf) this.hud.perf(null); }
      if (e.code === 'KeyP' && this.state === 'flying') {
        this.hud.setVisible(!this.hud.visible);
        this.wings?.setVisible(this.hud.visible ? this.settings.wings : false);
      }
    });
  }

  _setState(s) {
    this.state = s;
    document.body.dataset.state = s;
  }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vision.setSize(w, h);
    this.wings?.sync(this.camera);
    this.planet?.resize();
  }
}

/* ── go ─────────────────────────────────────────────────── */

const game = new Game();
window.AVES = game;
game.boot().catch((e) => {
  console.error(e);
  $('boot').classList.add('hidden');
  $('fatal-msg').textContent = e?.message ?? String(e);
  $('fatal').classList.remove('hidden');
});

export { game, FLIGHT_STATE };
