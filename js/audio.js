/* ============================================================
   Elfblade — audio: streamed music per level + procedural SFX.
   Music: CC-BY tracks (Kevin MacLeod, incompetech.com), chosen
   so intensity & drums escalate from level 1 to the boss.
   SFX: generated with WebAudio (no files needed).
   ============================================================ */

const AudioMan = {
  ctx: null,
  music: null,          // current HTMLAudioElement
  musicVol: 0.55,
  sfxVol: 0.9,
  muted: false,
  _fade: null,
  _noiseBuf: null,
  _unlocked: false,

  // Must be called from a user gesture (browser autoplay policy).
  unlock() {
    if (this._unlocked) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Pre-render 1s of white noise for percussion/whoosh SFX.
      const sr = this.ctx.sampleRate;
      this._noiseBuf = this.ctx.createBuffer(1, sr, sr);
      const d = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < sr; i++) d[i] = Math.random() * 2 - 1;
      this._unlocked = true;
    } catch (e) { /* audio unavailable; game runs silent */ }
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.music) this.music.volume = this.muted ? 0 : this.musicVol;
    return this.muted;
  },

  playMusic(src) {
    if (this.music && this.music._src === src && !this.music.paused) return;
    this.stopMusic();
    const a = new Audio((window.INLINE_ASSETS && window.INLINE_ASSETS[src]) || src);
    a._src = src;
    a.loop = true;
    a.volume = 0;
    a.play().catch(() => {});
    this.music = a;
    // fade in
    const target = this.muted ? 0 : this.musicVol;
    clearInterval(this._fade);
    this._fade = setInterval(() => {
      if (!this.music) return clearInterval(this._fade);
      this.music.volume = Math.min(target, this.music.volume + 0.045);
      if (this.music.volume >= target) clearInterval(this._fade);
    }, 90);
  },

  stopMusic() {
    if (!this.music) return;
    const m = this.music;
    this.music = null;
    clearInterval(this._fade);
    const out = setInterval(() => {
      m.volume = Math.max(0, m.volume - 0.08);
      if (m.volume <= 0) { m.pause(); clearInterval(out); }
    }, 60);
  },

  duckMusic(mult, ms) {  // brief volume dip for big moments
    if (!this.music || this.muted) return;
    const m = this.music, base = this.musicVol;
    m.volume = base * mult;
    setTimeout(() => { if (this.music === m && !this.muted) m.volume = base; }, ms);
  },

  /* ---------------- procedural SFX ---------------- */
  _out(gainVal, t0, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal * this.sfxVol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    g.connect(this.ctx.destination);
    return g;
  },

  _noise(t0, dur, filterType, f0, f1, gain) {
    if (!this.ctx || this.muted) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true;
    const flt = this.ctx.createBiquadFilter();
    flt.type = filterType;
    flt.frequency.setValueAtTime(f0, t0);
    flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
    flt.Q.value = 1.1;
    src.connect(flt).connect(this._out(gain, t0, dur));
    src.start(t0); src.stop(t0 + dur + 0.02);
  },

  _tone(t0, dur, type, f0, f1, gain) {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    o.connect(this._out(gain, t0, dur));
    o.start(t0); o.stop(t0 + dur + 0.02);
  },

  sfx(name) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'swing':   this._noise(t, 0.16, 'bandpass', 900, 3600, 0.5); break;
      case 'swing2':  this._noise(t, 0.18, 'bandpass', 1400, 500, 0.5); break;
      case 'hit':
        this._noise(t, 0.12, 'lowpass', 2400, 300, 0.9);
        this._tone(t, 0.1, 'square', 220, 90, 0.5); break;
      case 'clang':
        this._tone(t, 0.22, 'triangle', 1150, 640, 0.55);
        this._noise(t, 0.1, 'highpass', 3000, 5000, 0.4); break;
      case 'kill':
        this._noise(t, 0.3, 'lowpass', 1800, 120, 0.9);
        this._tone(t, 0.28, 'sawtooth', 300, 60, 0.5); break;
      case 'hurt':
        this._tone(t, 0.25, 'sawtooth', 520, 130, 0.7);
        this._noise(t, 0.18, 'lowpass', 1500, 200, 0.6); break;
      case 'jump':    this._tone(t, 0.22, 'sine', 300, 640, 0.45); break;
      case 'land':    this._noise(t, 0.1, 'lowpass', 700, 150, 0.5); break;
      case 'slide':   this._noise(t, 0.3, 'highpass', 1200, 2600, 0.3); break;
      case 'bolt':
        this._tone(t, 0.5, 'sawtooth', 180, 950, 0.6);
        this._noise(t, 0.45, 'bandpass', 800, 4200, 0.55); break;
      case 'blast':
        this._noise(t, 0.6, 'lowpass', 3000, 80, 1.0);
        this._tone(t, 0.5, 'sine', 220, 45, 0.9); break;
      case 'powerReady':
        this._tone(t, 0.14, 'sine', 660, 660, 0.4);
        this._tone(t + 0.13, 0.22, 'sine', 880, 880, 0.4); break;
      case 'heart':
        this._tone(t, 0.13, 'sine', 620, 620, 0.4);
        this._tone(t + 0.11, 0.2, 'sine', 930, 930, 0.4); break;
      case 'roar':
        this._noise(t, 0.9, 'lowpass', 900, 90, 1.1);
        this._tone(t, 0.85, 'sawtooth', 150, 45, 0.85); break;
      case 'fire':    this._noise(t, 0.8, 'lowpass', 2200, 500, 0.75); break;
      case 'ui':      this._tone(t, 0.09, 'sine', 750, 500, 0.3); break;
      case 'win':
        [440, 554, 659, 880].forEach((f, i) => this._tone(t + i * 0.13, 0.32, 'triangle', f, f, 0.4)); break;
      case 'lose':
        [330, 262, 208, 155].forEach((f, i) => this._tone(t + i * 0.17, 0.38, 'triangle', f, f, 0.45)); break;
    }
  },
};
