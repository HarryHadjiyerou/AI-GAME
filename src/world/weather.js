/* ═══════════════════════════════════════════════════════════
   Weather.

   Weather here is not decoration — it is the thing that makes two
   flights over the same valley different. It moves three dials at
   once and every one of them is felt as well as seen:

     WIND       a slow-turning base vector with gusts riding on it.
                The flight model already takes wind, so a gust really
                does shove you; the trees lean the same way at the
                same moment, which is what makes it read as air rather
                than as a screen effect.

     COVER      how much cloud the sky dome paints, and how hard the
                haze is. Overcast is not merely darker — it flattens
                the light, which changes what the landscape looks like
                more than any amount of rain on the lens.

     RAIN       streaks, and with them the sky goes leaden, the sun
                goes out, and the whole palette cools. A storm adds
                lightning, which is the one moment this game is loud.

   It changes while you fly. A front takes about half a minute to
   arrive, so you can watch it coming across the valley before it
   reaches you — which is most of the pleasure of weather.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { rng, clamp, lerp, damp, Noise } from '../core/noise.js';

/**
 * Each preset is a destination the sky moves towards, not a state it
 * snaps to. `weight` is how often it comes round.
 */
export const WEATHER = {
  clear:    { label: 'CLEAR',    weight: 3, cover: 0.22, rain: 0, fog: 0.85, wind: 0.7,
              gust: 0.25, dark: 0.00, choppy: 0.7 },
  fair:     { label: 'FAIR',     weight: 4, cover: 0.45, rain: 0, fog: 1.00, wind: 1.0,
              gust: 0.35, dark: 0.04, choppy: 1.0 },
  mist:     { label: 'MIST',     weight: 2, cover: 0.55, rain: 0, fog: 1.90, wind: 0.4,
              gust: 0.15, dark: 0.10, choppy: 0.5 },
  brooding: { label: 'BROODING', weight: 2, cover: 0.82, rain: 0, fog: 1.35, wind: 1.5,
              gust: 0.65, dark: 0.26, choppy: 1.5 },
  rain:     { label: 'RAIN',     weight: 2, cover: 0.92, rain: 0.6, fog: 1.70, wind: 1.7,
              gust: 0.7, dark: 0.40, choppy: 1.7 },
  storm:    { label: 'STORM',    weight: 1, cover: 0.99, rain: 1.0, fog: 2.10, wind: 2.6,
              gust: 1.0, dark: 0.55, choppy: 2.3, lightning: true },
};

/* ── rain ───────────────────────────────────────────────── */

const RAIN_VERT = /* glsl */`
  precision highp float;
  uniform vec3  uCamPos, uFall;
  uniform vec3  uBox;
  uniform float uTime, uAmount, uStretch;
  attribute vec3 iPos;
  attribute float iSeed;
  varying float vAlpha;

  void main() {
    // Every drop lives in a box that follows the bird, wrapped so it is
    // endless without ever moving a single instance on the CPU.
    vec3 p = iPos + uFall * (uTime + iSeed * 37.0);
    vec3 rel = mod(p - uCamPos + uBox * 0.5, uBox) - uBox * 0.5;
    vec3 world = uCamPos + rel;

    float d = length(rel);
    vAlpha = uAmount * smoothstep(uBox.x * 0.5, uBox.x * 0.18, d)
                     * step(0.0001, uAmount)
                     * step(iSeed, uAmount);

    // Billboard, stretched along the fall direction so a drop is a streak.
    vec4 mv = viewMatrix * vec4(world, 1.0);
    // Same trap as the clouds: a view-space billboard behind the eye projects
    // inside out and fills the screen. A drop that close is not visible anyway.
    if (mv.z > -0.5 || vAlpha < 0.002) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec3 fallView = normalize((viewMatrix * vec4(uFall, 0.0)).xyz);
    vec2 along = normalize(fallView.xy + vec2(0.0001, 0.0));
    vec2 across = vec2(-along.y, along.x);
    mv.xy += across * position.x * 0.055 + along * position.y * uStretch;

    gl_Position = projectionMatrix * mv;
  }
`;

const RAIN_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    if (vAlpha < 0.01) discard;
    gl_FragColor = vec4(uColor, vAlpha * 0.5);
  }
`;

class Rain {
  constructor(palette, opts = {}) {
    const count = opts.count ?? 2600;
    const box = new THREE.Vector3(90, 70, 90);
    const r = rng(11);

    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.instanceCount = count;

    const iPos = new Float32Array(count * 3);
    const iSeed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      iPos[i * 3] = (r() - 0.5) * box.x;
      iPos[i * 3 + 1] = (r() - 0.5) * box.y;
      iPos[i * 3 + 2] = (r() - 0.5) * box.z;
      // Used both as a time offset and as the threshold that decides which
      // drops exist at a given rain intensity — so rain fades in smoothly
      // rather than switching on.
      iSeed[i] = r();
    }
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
    geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(iSeed, 1));

    this.uniforms = {
      uCamPos: { value: new THREE.Vector3() },
      uFall: { value: new THREE.Vector3(2, -26, 1) },
      uBox: { value: box },
      uTime: { value: 0 },
      uAmount: { value: 0 },
      uStretch: { value: 1.1 },
      uColor: { value: palette.foam.clone().lerp(palette.sky, 0.45) },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    base.dispose();
  }

  update(camPos, dt, amount, wind) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uCamPos.value.copy(camPos);
    this.uniforms.uAmount.value = amount;
    this.uniforms.uFall.value.set(wind.x * 0.8, -24 - amount * 14, wind.z * 0.8);
    this.mesh.visible = amount > 0.01;
  }

  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}

/* ═══════════════════════════════════════════════════════════ */

export class Weather {
  constructor(style, sky, palette, opts = {}) {
    this.style = style;
    this.sky = sky;
    this.palette = palette;
    this.noise = new Noise(4242);
    this.group = new THREE.Group();

    this.baseWind = (opts.wind ?? new THREE.Vector3(3, 0, 1)).clone();
    this.wind = this.baseWind.clone();
    this.intensity = 0;
    this.gustiness = 0.3;

    // Remember where the palette started, so weather can pull it towards
    // leaden and then let it spring back.
    this._base = {
      fogDensity: style.u.uFogDensity.value,
      sunStrength: style.u.uSunStrength.value,
      ambStrength: style.u.uAmbStrength.value,
      rimStrength: style.u.uRimStrength.value,
      haze: palette.haze.clone(),
      sky: palette.sky.clone(),
      zenith: palette.zenith.clone(),
      horizon: palette.horizon.clone(),
      sunColor: palette.sunColor.clone(),
      cloudAmount: sky.uniforms.uCloudAmount.value,
      cloudShadow: style.u.uCloudShadow.value,
      cloudLit: sky.uniforms.uCloudLit.value.clone(),
      cloudShade: sky.uniforms.uCloudShade.value.clone(),
    };
    /* What "leaden" has to be.
     *
     * The first version of this was the palette's own shadow mixed with its
     * haze, which at golden hour is two warm colours and averages to a third
     * warm colour. Pulling a storm towards it made the sky a slightly duller
     * orange. A storm is not a dim version of the evening — it is a different
     * light: desaturated, cool, and coming from everywhere at once. So the
     * palette gets a vote on the hue, and then most of it is taken away. */
    this._leaden = palette.shadow.clone()
      .lerp(palette.haze, 0.25)
      .lerp(new THREE.Color('#464b58'), 0.62)
      .multiplyScalar(0.82);

    this.rain = new Rain(palette, { count: opts.quality?.rain ?? 2600 });
    this.group.add(this.rain.mesh);

    this._current = { ...WEATHER[opts.preset ?? 'fair'] };
    this._target = { ...this._current };
    this.label = this._current.label;
    this._blend = 1;
    this._timer = 40 + Math.random() * 90;
    this._flash = 0;
    this._nextBolt = 4 + Math.random() * 8;
    this._t = 0;

    this._tmp = new THREE.Color();
  }

  /** Force a particular sky, for a menu or a photograph. */
  set(name, immediate = false) {
    const w = WEATHER[name];
    if (!w) return this;
    this._target = { ...w };
    this._blend = immediate ? 1 : 0;
    if (immediate) this._current = { ...w };
    this.label = w.label;
    return this;
  }

  _roll() {
    const keys = Object.keys(WEATHER);
    const total = keys.reduce((a, k) => a + WEATHER[k].weight, 0);
    let pick = Math.random() * total;
    for (const k of keys) {
      pick -= WEATHER[k].weight;
      if (pick <= 0) return k;
    }
    return 'fair';
  }

  update(camPos, dt, flight) {
    this._t += dt;

    /* ── fronts arrive, slowly ──────────────────────────── */
    this._timer -= dt;
    if (this._timer <= 0) {
      this._timer = 70 + Math.random() * 140;
      const next = this._roll();
      if (next !== this.label.toLowerCase()) this.set(next);
    }
    if (this._blend < 1) {
      // Half a minute for a front to cross, so you see it coming.
      this._blend = clamp(this._blend + dt / 30, 0, 1);
      for (const k of ['cover', 'rain', 'fog', 'wind', 'gust', 'dark', 'choppy']) {
        this._current[k] = lerp(this._current[k] ?? 0, this._target[k] ?? 0, dt / 30 * 3);
      }
      this._current.lightning = this._target.lightning;
    }
    const w = this._current;

    /* ── wind ───────────────────────────────────────────── */

    // A slowly turning base direction, with gusts on top. The flight model
    // reads this every step, so a gust genuinely moves the bird.
    const turn = this.noise.simplex2(this._t * 0.012, 3.1) * 0.5;
    const cs = Math.cos(turn), sn = Math.sin(turn);
    const bx = this.baseWind.x * cs - this.baseWind.z * sn;
    const bz = this.baseWind.x * sn + this.baseWind.z * cs;

    const gustN = this.noise.simplex2(this._t * 0.35, 7.7);
    const gust = 1 + Math.max(0, gustN) * w.gust * 2.2;
    const strength = w.wind * gust;

    this.wind.set(bx * strength, this.noise.simplex2(this._t * 0.5, 13.3) * w.gust * 2.2, bz * strength);
    this.intensity = clamp(w.rain, 0, 1);
    this.gustiness = w.gust;

    /* ── light and air ──────────────────────────────────── */

    const dark = w.dark;
    const u = this.style.u;
    u.uFogDensity.value = damp(u.uFogDensity.value, this._base.fogDensity * w.fog, 0.6, dt);
    u.uSunStrength.value = damp(u.uSunStrength.value, this._base.sunStrength * (1 - dark * 0.85), 0.6, dt);
    u.uAmbStrength.value = damp(u.uAmbStrength.value, this._base.ambStrength * (1 + dark * 0.55), 0.6, dt);
    u.uRimStrength.value = damp(u.uRimStrength.value, this._base.rimStrength * (1 - dark * 0.55), 0.6, dt);

    // Everything creeps towards a leaden grey-blue rather than simply darker.
    this._tmp.copy(this._base.haze).lerp(this._leaden, Math.min(1, dark * 1.25));
    u.uHaze.value.lerp(this._tmp, 1 - Math.exp(-dt / 0.8));

    // The shadows on the ground thicken with the deck overhead — and thin out
    // again under a storm, because by then there is no direct sun left to
    // block and a second layer of darkness just turns the world to mud.
    u.uCloudCover.value = damp(u.uCloudCover.value, w.cover, 0.8, dt);
    u.uCloudShadow.value = damp(u.uCloudShadow.value,
      this._base.cloudShadow * (1 - dark * 1.3), 0.8, dt);

    const sk = this.sky.uniforms;
    sk.uCloudAmount.value = damp(sk.uCloudAmount.value, w.cover, 0.8, dt);
    sk.uStorm.value = damp(sk.uStorm.value, Math.min(1, dark * 1.35), 0.8, dt);
    this._tmp.copy(this._base.sky).lerp(this._leaden, Math.min(1, dark * 1.2));
    sk.uSky.value.lerp(this._tmp, 1 - Math.exp(-dt / 0.8));
    this._tmp.copy(this._base.horizon).lerp(this._leaden, Math.min(1, dark * 1.05));
    sk.uHorizon.value.lerp(this._tmp, 1 - Math.exp(-dt / 0.8));
    sk.uHaze.value = u.uHaze.value;

    /* The cloud deck has to go with it.
     *
     * Pulling the sky and the horizon towards leaden and leaving the cloud
     * colours alone was why a storm still looked like a summer evening: the
     * cover went to 97%, and 97% of the frame was then filled with clouds
     * still painted in the palette's golden-hour lit and shade colours. The
     * deck is the sky in this weather, so it is the thing that has to darken. */
    const k = 1 - Math.exp(-dt / 0.8);
    this._tmp.copy(this._base.zenith).lerp(this._leaden, Math.min(1, dark * 1.3));
    sk.uZenith.value.lerp(this._tmp, k);
    this._tmp.copy(this._base.cloudLit).lerp(this._leaden, Math.min(1, dark * 1.3));
    sk.uCloudLit.value.lerp(this._tmp, k);
    this._tmp.copy(this._base.cloudShade).lerp(this._leaden, Math.min(1, dark * 1.1));
    sk.uCloudShade.value.lerp(this._tmp, k);

    /* ── rain and lightning ─────────────────────────────── */

    this.rain.update(camPos, dt, w.rain, this.wind);

    this.flash = 0;
    if (w.lightning && w.rain > 0.5) {
      this._nextBolt -= dt;
      if (this._nextBolt <= 0) {
        this._nextBolt = 3 + Math.random() * 11;
        this._flash = 1;
      }
    }
    if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - dt * 3.2);
      // Two quick pulses, because one is a camera flash and two is lightning.
      const f = this._flash * (0.6 + 0.4 * Math.sin(this._flash * 34));
      this.flash = f;
      sk.uSky.value.lerp(this._base.sunColor, f * 0.55);
      sk.uHorizon.value.lerp(this._base.sunColor, f * 0.4);
      u.uSunStrength.value += f * 1.6;
      u.uAmbStrength.value += f * 0.9;
    }

    void flight;
  }

  dispose() { this.rain.dispose(); this.group.removeFromParent(); }
}
