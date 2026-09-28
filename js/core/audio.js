// Procedural WebAudio: wind, wing beats, variometer, splashes and biome ambience. No audio files needed.
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.vario = true;
  }

  start(biome) {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.6 + b * 3; }

    const loop = (filterType, freq, q = 0.7) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(0, Math.random() * 2);
      return { src, f, g };
    };
    this.wind = loop('bandpass', 500, 0.5);
    this.rumble = loop('lowpass', 180, 0.5);
    this.amb = loop('lowpass', biome === 'coast' ? 600 : biome === 'city' ? 260 : 900, 0.6);
    this.biome = biome;
    this.varioOsc = ctx.createOscillator();
    this.varioOsc.type = 'sine';
    this.varioGain = ctx.createGain(); this.varioGain.gain.value = 0;
    this.varioOsc.connect(this.varioGain); this.varioGain.connect(this.master);
    this.varioOsc.start();
    this.lastFlap = 0;
    this.chirpT = 2;
    this.varioT = 0;
  }

  burst(freq, dur, vol, type = 'lowpass', sweepTo) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }

  tone(f0, f1, dur, vol, type = 'sine') {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  splash() { this.burst(2500, 0.6, 0.5, 'lowpass', 300); this.burst(300, 0.4, 0.4, 'lowpass', 80); }
  thump(v = 0.5) { this.tone(120, 40, 0.35, v, 'sine'); this.burst(800, 0.2, v * 0.5); }
  thunder(delay) { setTimeout(() => { this.burst(200, 3.5, 0.6, 'lowpass', 40); this.burst(900, 0.6, 0.25, 'lowpass', 100); }, delay * 1000); }
  whoosh() { this.burst(1800, 0.5, 0.25, 'bandpass', 400); }

  update(dt, s) {
    if (!this.ctx || !this.enabled) { if (this.master) this.master.gain.value = 0; return; }
    this.master.gain.value = 0.8;
    const t = this.ctx.currentTime;
    const v = s.speed;
    const w = Math.min(1, v / 70);
    this.wind.g.gain.setTargetAtTime(0.02 + w * w * 0.7 * (s.under ? 0.1 : 1), t, 0.1);
    this.wind.f.frequency.setTargetAtTime(300 + v * 22, t, 0.1);
    this.rumble.g.gain.setTargetAtTime(w * 0.5, t, 0.2);
    const ambVol = { coast: 0.35 * (0.6 + 0.4 * Math.sin(t * 0.5)), city: 0.22, forest: 0.08, mountains: 0.05 }[this.biome] || 0.1;
    const alt = Math.max(0, s.agl);
    this.amb.g.gain.setTargetAtTime(ambVol * Math.max(0.1, 1 - alt / 400), t, 0.3);
    // wing beats: one whoomph per downstroke
    const cyc = Math.floor(s.flapPhase / (Math.PI * 2));
    if (cyc !== this.lastFlap && s.flapAmt > 0.3) {
      this.lastFlap = cyc;
      this.burst(s.boost ? 1100 : 700, s.boost ? 0.1 : 0.16, 0.22 * s.flapAmt * s.flapVol, 'lowpass', 150);
    }
    // variometer beeps when climbing
    this.varioT -= dt;
    if (this.vario && s.climb > 0.7 && !s.perched) {
      if (this.varioT < 0) {
        this.varioT = Math.max(0.12, 0.5 - s.climb * 0.06);
        this.varioOsc.frequency.setValueAtTime(520 + s.climb * 70, t);
        this.varioGain.gain.setValueAtTime(0.0001, t);
        this.varioGain.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
        this.varioGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      }
    }
    // forest birdsong
    if (this.biome === 'forest' || (this.biome === 'city' && Math.random() < 0.3)) {
      this.chirpT -= dt;
      if (this.chirpT < 0 && alt < 300) {
        this.chirpT = 1.5 + Math.random() * 4;
        const f = 2200 + Math.random() * 1800;
        for (let i = 0; i < 2 + Math.random() * 4; i++) setTimeout(() => this.tone(f, f * (0.7 + Math.random() * 0.6), 0.08, 0.025), i * 110);
      }
    }
  }
}
