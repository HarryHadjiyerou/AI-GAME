// Audio: streamed orchestral score (adaptive intensity), layered procedural wind, banking whooshes,
// wing beats, a thermal variometer, bird calls and biome ambience.
const MUSIC = { forest: 'music_forest', coast: 'music_coast', mountains: 'music_mountains', city: 'music_city', menu: 'music_menu' };
const CALLS = { forest: ['call_hawk_1', 'call_hawk_2', 'call_hawk_3', 'call_raven_1'], coast: ['call_gull_1', 'call_gull_2', 'call_gull_3'], mountains: ['call_hawk_1', 'call_hawk_3', 'call_raven_1'], city: ['call_pigeon_1', 'call_pigeon_2'] };
const AMBIENCE = { forest: 'amb_forest', coast: 'amb_waves', mountains: 'amb_wind', city: 'amb_city' };

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.vario = true;
    this.musicOn = true;
    this.buffers = new Map();
  }

  // Must be called from a user gesture (iOS requirement).
  unlock() {
    if (!this.ctx) this.init();
    this.ctx?.resume();
  }

  init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0;
    this.musicFilter = ctx.createBiquadFilter(); this.musicFilter.type = 'lowpass'; this.musicFilter.frequency.value = 18000;
    this.musicBus.connect(this.musicFilter); this.musicFilter.connect(this.master);
    // pink-ish noise buffer shared by all procedural sounds
    const len = ctx.sampleRate * 3;
    this.noise = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = this.noise.getChannelData(c);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048;
        d[i] = (b0 + b1 + b2 + w * 0.02) * 1.4;
      }
    }
    const loop = (type, freq, q, pan = 0) => {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      src.connect(f); f.connect(g);
      if (p) { p.pan.value = pan; g.connect(p); p.connect(this.sfx); } else g.connect(this.sfx);
      src.start(0, Math.random() * 3);
      return { src, f, g, p };
    };
    // wind: low roar, mid rush (stereo pair), high whistle over the feathers
    this.roar = loop('lowpass', 250, 0.6);
    this.rushL = loop('bandpass', 700, 0.7, -0.6);
    this.rushR = loop('bandpass', 760, 0.7, 0.6);
    this.whistle = loop('bandpass', 3200, 6);
    this.bankSwoosh = loop('bandpass', 1100, 1.2);
    this.varioOsc = ctx.createOscillator(); this.varioOsc.type = 'sine';
    this.varioGain = ctx.createGain(); this.varioGain.gain.value = 0;
    this.varioOsc.connect(this.varioGain); this.varioGain.connect(this.sfx); this.varioOsc.start();
    this.lastFlap = 0; this.varioT = 0; this.callT = 8; this.gust = 0; this.gustT = 0;
  }

  // ---------- file-based sounds ----------
  async loadBuffer(name) {
    if (this.buffers.has(name)) return this.buffers.get(name);
    const p = fetch(`assets/audio/${name}.m4a`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
      .then((ab) => new Promise((res) => {
        // callback form for older Safari; the returned promise (newer browsers) is also caught
        const pr = this.ctx.decodeAudioData(ab, res, () => res(null));
        if (pr && pr.catch) pr.catch(() => res(null));
      })).catch(() => null);
    this.buffers.set(name, p);
    return p;
  }
  async playBuffer(name, { vol = 0.6, rate = 1, pan = 0, dest } = {}) {
    if (!this.ctx) return;
    const buf = await this.loadBuffer(name);
    if (!buf) return false;
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = vol;
    s.connect(g);
    if (this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(dest || this.sfx); } else g.connect(dest || this.sfx);
    s.start();
    return true;
  }
  // Streamed loop through an <audio> element (keeps memory low for long music on phones).
  stream(name, bus, loop = true) {
    const el = new window.Audio();
    el.src = `assets/audio/${name}.m4a`;
    el.loop = loop;
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    el.setAttribute('playsinline', '');
    const node = this.ctx.createMediaElementSource(el);
    const g = this.ctx.createGain(); g.gain.value = 1;
    node.connect(g); g.connect(bus);
    el.play().catch(() => {});
    return { el, g, node };
  }
  stopStream(s, fade = 1.2) {
    if (!s) return;
    const t = this.ctx.currentTime;
    s.g.gain.setTargetAtTime(0, t, fade / 3);
    setTimeout(() => { s.el.pause(); s.el.src = ''; s.node.disconnect(); }, fade * 1000 + 200);
  }

  playMusic(key) {
    if (!this.ctx) return;
    if (this.musicKey === key) return;
    this.musicKey = key;
    this.stopStream(this.music);
    this.music = this.musicOn ? this.stream(MUSIC[key], this.musicBus) : null;
    this.musicBus.gain.setTargetAtTime(this.musicOn ? (key === 'menu' ? 0.55 : 0.5) : 0, this.ctx.currentTime, 0.8);
  }

  start(biome) {
    this.unlock();
    if (!this.ctx) return;
    this.biome = biome;
    this.playMusic(biome);
    this.stopGame();
    this.ambGain = this.ctx.createGain(); this.ambGain.gain.value = 0; this.ambGain.connect(this.sfx);
    // ambience loops are short: decode and loop the buffer (seamless, unlike <audio loop>)
    const ambName = AMBIENCE[biome];
    this.loadBuffer(ambName).then((buf) => {
      if (!buf || this.biome !== biome || !this.ambGain) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      src.loopStart = 0.05; src.loopEnd = buf.duration - 0.05; // skip AAC priming at the edges
      src.connect(this.ambGain);
      src.start(0, 0.05);
      this.ambSrc = src;
    });
    CALLS[biome].forEach((c) => this.loadBuffer(c));
    this.callT = 5 + Math.random() * 6;
  }

  stopGame() {
    this.stopStream(this.ambStream); this.ambStream = null;
    try { this.ambSrc?.stop(); } catch { /* already stopped */ }
    this.ambSrc = null;
  }

  // ---------- procedural one-shots ----------
  burst(freq, dur, vol, type = 'lowpass', sweepTo, pan = 0) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g);
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(this.sfx); } else g.connect(this.sfx);
    src.start(t, Math.random() * 2); src.stop(t + dur + 0.05);
  }
  tone(f0, f1, dur, vol, type = 'sine') {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.02);
  }
  // Synthetic hawk scream fallback (descending, raspy).
  synthScream() {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(3200, t); o.frequency.exponentialRampToValueAtTime(1900, t + 0.9);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 38; const lg = ctx.createGain(); lg.gain.value = 180; lfo.connect(lg); lg.connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    o.connect(f); f.connect(g); g.connect(this.sfx); o.start(t); lfo.start(t); o.stop(t + 1.05); lfo.stop(t + 1.05);
  }
  // ring chime: rising pentatonic with the chain length
  chime(n) {
    if (!this.ctx) return;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    const f = 523.25 * Math.pow(2, scale[Math.min(n - 1, scale.length - 1)] / 12);
    this.tone(f, f * 1.002, 0.5, 0.07, 'triangle');
    this.tone(f * 2, f * 2, 0.3, 0.025, 'sine');
    setTimeout(() => this.tone(f * 1.5, f * 1.5, 0.4, 0.035, 'sine'), 70);
  }
  splash() { this.burst(2500, 0.7, 0.5, 'lowpass', 250); this.burst(300, 0.5, 0.45, 'lowpass', 70); }
  thump(v = 0.5) { this.tone(110, 38, 0.35, v, 'sine'); this.burst(900, 0.25, v * 0.5); }
  thunder(delay) { setTimeout(() => { this.burst(180, 4, 0.7, 'lowpass', 35); this.burst(900, 0.6, 0.25, 'lowpass', 100); }, delay * 1000); }
  takeoff(bird) {
    if (bird === 'pigeon') this.playBuffer('flap_pigeon', { vol: 0.5 }).then((ok) => { if (!ok) this.whoosh(); });
    else this.whoosh();
  }
  whoosh(pan = 0) { this.burst(2200, 0.55, 0.3, 'bandpass', 380, pan); }

  update(dt, s) {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.enabled ? 0.9 : 0, this.ctx.currentTime, 0.1);
    if (!this.enabled || !this.roar) return;
    const t = this.ctx.currentTime;
    const v = s.speed;
    const w = Math.min(1.3, v / 60);
    // gusts: slow random swells
    this.gustT -= dt;
    if (this.gustT < 0) { this.gustT = 2 + Math.random() * 5; this.gustTarget = 0.6 + Math.random() * 0.8; }
    this.gust += ((this.gustTarget || 1) - this.gust) * Math.min(1, dt * 0.8);
    const under = s.under ? 0.08 : 1;
    const base = 0.035 * this.gust; // there is always a little wind at altitude
    this.roar.g.gain.setTargetAtTime((base + w * w * 0.55) * under, t, 0.12);
    this.roar.f.frequency.setTargetAtTime(160 + v * 9, t, 0.15);
    const rush = (base * 0.8 + w * w * 0.35) * under;
    const pan = Math.max(-1, Math.min(1, s.turn * 0.6));
    this.rushL.g.gain.setTargetAtTime(rush * (1 + pan * 0.6), t, 0.1);
    this.rushR.g.gain.setTargetAtTime(rush * (1 - pan * 0.6), t, 0.1);
    this.rushL.f.frequency.setTargetAtTime(420 + v * 16, t, 0.1);
    this.rushR.f.frequency.setTargetAtTime(460 + v * 17, t, 0.1);
    // whistle through the primaries at high speed / dives
    this.whistle.g.gain.setTargetAtTime(Math.max(0, w - 0.55) * 0.12 * (0.6 + s.tuck * 0.8) * under, t, 0.15);
    this.whistle.f.frequency.setTargetAtTime(2600 + v * 20 + Math.sin(t * 3) * 150, t, 0.2);
    // banking whoosh: grows with roll rate x speed
    const bankE = Math.min(1, Math.abs(s.rollRate) * v / 90);
    this.bankSwoosh.g.gain.setTargetAtTime(bankE * 0.35 * under, t, 0.06);
    this.bankSwoosh.f.frequency.setTargetAtTime(600 + v * 20 + bankE * 800, t, 0.08);
    if (this.bankSwoosh.p) this.bankSwoosh.p.pan.setTargetAtTime(-Math.sign(s.rollRate) * 0.5, t, 0.1);

    // wing beats: soft whomp per downstroke
    const cyc = Math.floor(s.flapPhase / (Math.PI * 2));
    if (cyc !== this.lastFlap && s.flapAmt > 0.3) {
      this.lastFlap = cyc;
      this.burst(s.boost ? 950 : 620, s.boost ? 0.11 : 0.18, 0.2 * s.flapAmt * s.flapVol, 'lowpass', 120);
    }
    // variometer
    this.varioT -= dt;
    if (this.vario && s.climb > 0.7 && !s.perched && this.varioT < 0) {
      this.varioT = Math.max(0.12, 0.5 - s.climb * 0.06);
      this.varioOsc.frequency.setValueAtTime(520 + s.climb * 70, t);
      this.varioGain.gain.setValueAtTime(0.0001, t);
      this.varioGain.gain.exponentialRampToValueAtTime(0.045, t + 0.01);
      this.varioGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    }
    // occasional bird calls (distant, panned)
    this.callT -= dt;
    if (this.callT < 0 && !s.under) {
      this.callT = 14 + Math.random() * 28;
      const list = CALLS[this.biome] || [];
      const name = list[Math.floor(Math.random() * list.length)];
      const panC = Math.random() * 1.6 - 0.8;
      if (name) this.playBuffer(name, { vol: 0.22 + Math.random() * 0.2, rate: 0.95 + Math.random() * 0.1, pan: panC }).then((ok) => { if (ok === false && this.biome !== 'city') this.synthScream(); });
    }
    // ambience fades with height above ground
    if (this.ambGain) {
      const amb = { coast: 0.55, city: 0.4, forest: 0.35, mountains: 0.3 }[this.biome] ?? 0.3;
      const alt = Math.max(0, s.agl);
      const k = this.biome === 'mountains' ? 1 : Math.max(0.12, 1 - alt / 500);
      this.ambGain.gain.setTargetAtTime(amb * k * under, t, 0.4);
    }
    // adaptive music: fuller and brighter when fast, diving or boosting
    if (this.music) {
      const intensity = Math.min(1, Math.max(0, (v - 12) / 55) * 0.7 + (s.boost ? 0.3 : 0) + s.tuck * 0.25);
      this.musicBus.gain.setTargetAtTime(this.musicOn ? (s.under ? 0.2 : 0.38 + intensity * 0.35) : 0, t, 0.6);
      this.musicFilter.frequency.setTargetAtTime(s.under ? 600 : 2500 + intensity * 16000, t, 0.4);
    }
  }
}
