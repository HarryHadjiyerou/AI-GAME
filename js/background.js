/* ============================================================
   Elfblade — parallax level backgrounds.
   Five hand-tuned painterly themes, each with its own palette,
   sky, 3 parallax silhouette layers, ambient particles and a
   themed ground strip:
     verdant — bright daylight, floating isles & waterfalls
     night   — moonlit forest, stars & fireflies
     frozen  — icy peaks, falling snow
     storm   — ashen wastes, lightning
     hell    — fire, lava and smoke for the dragon's arena
   Layers are pre-rendered to repeating tiles for 60fps scroll.
   ============================================================ */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

class LevelBackground {
  constructor(theme) {
    this.theme = theme;
    this.t = 0;
    this.parts = [];            // ambient particles
    this.lightning = 0;         // storm flash intensity
    this.nextBolt = 2 + Math.random() * 4;
    this.boltX = 0;
    this._buildTiles();
    this._seedParticles();
  }

  /* ---------------- tile construction ---------------- */
  _tile(w, h, painter, seed) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    painter(c.getContext('2d'), w, h, mulberry32(seed));
    return c;
  }

  _buildTiles() {
    const T = this.theme;
    // far / mid / near silhouette layers (speeds: 0.12 / 0.3 / 0.55)
    if (T === 'verdant') {
      this.far  = this._tile(2000, 720, (g, w, h, r) => this._paintMountains(g, w, h, r, 300, '#9db8d8', '#c8d9ec', true, '#eaf4fb'), 11);
      this.mid  = this._tile(1800, 720, (g, w, h, r) => this._paintHills(g, w, h, r, 430, '#5e9a58', '#7fb96b', 'castle'), 12);
      this.near = this._tile(1600, 720, (g, w, h, r) => this._paintHills(g, w, h, r, 520, '#3f7d42', '#579a4e', 'trees'), 13);
    } else if (T === 'night') {
      this.far  = this._tile(2000, 720, (g, w, h, r) => this._paintMountains(g, w, h, r, 320, '#141a3d', '#232b5e', false), 21);
      this.mid  = this._tile(1800, 720, (g, w, h, r) => this._paintPines(g, w, h, r, 440, '#0c1030', '#181d48'), 22);
      this.near = this._tile(1600, 720, (g, w, h, r) => this._paintPines(g, w, h, r, 530, '#070a20', '#101538', true), 23);
    } else if (T === 'frozen') {
      this.far  = this._tile(2000, 720, (g, w, h, r) => this._paintMountains(g, w, h, r, 280, '#b9d4ea', '#e6f2fb', true, '#ffffff'), 31);
      this.mid  = this._tile(1800, 720, (g, w, h, r) => this._paintIceSpires(g, w, h, r, 430), 32);
      this.near = this._tile(1600, 720, (g, w, h, r) => this._paintSnowDrifts(g, w, h, r, 520), 33);
    } else if (T === 'storm') {
      this.far  = this._tile(2000, 720, (g, w, h, r) => this._paintMesas(g, w, h, r, 330, '#1e1626', '#2c2133'), 41);
      this.mid  = this._tile(1800, 720, (g, w, h, r) => this._paintDeadLand(g, w, h, r, 450), 42);
      this.near = this._tile(1600, 720, (g, w, h, r) => this._paintDeadLand(g, w, h, r, 540, true), 43);
    } else { // hell
      this.far  = this._tile(2000, 720, (g, w, h, r) => this._paintVolcanoes(g, w, h, r, 300), 51);
      this.mid  = this._tile(1800, 720, (g, w, h, r) => this._paintObsidian(g, w, h, r, 440), 52);
      this.near = this._tile(1600, 720, (g, w, h, r) => this._paintObsidian(g, w, h, r, 540, true), 53);
    }
  }

  /* ---------- generic painterly helpers ---------- */
  _ridge(g, w, h, r, top, c1, c2, jag) {
    const grad = g.createLinearGradient(0, top - 150, 0, h);
    grad.addColorStop(0, c2); grad.addColorStop(1, c1);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, h);
    let y = top + r() * 60;
    g.lineTo(0, y);
    const step = jag ? 70 : 130;
    for (let x = 0; x <= w; x += step) {
      const ny = top + (r() - 0.35) * (jag ? 190 : 110);
      const cx = x - step / 2;
      if (jag) g.lineTo(x, ny); else g.quadraticCurveTo(cx, y - 40 * (r() - .5), x, ny);
      y = ny;
    }
    g.lineTo(w, h);
    g.closePath();
    g.fill();
  }

  _paintMountains(g, w, h, r, top, c1, c2, snowCaps, capColor) {
    this._ridge(g, w, h, r, top + 60, c1, c2, true);
    if (snowCaps) {
      // dab lighter caps along the upper ridge
      g.fillStyle = capColor || '#fff';
      for (let i = 0; i < 26; i++) {
        const x = r() * w, y = top + r() * 120;
        g.globalAlpha = 0.5 + r() * 0.4;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 26 + r() * 30, y + 40 + r() * 40);
        g.lineTo(x - 26 - r() * 30, y + 40 + r() * 40);
        g.closePath(); g.fill();
      }
      g.globalAlpha = 1;
    }
    // floating islands for the fantasy skyline (hazy, distant)
    for (let i = 0; i < 3; i++) this._island(g, 120 + r() * (w - 240), 110 + r() * 150, 34 + r() * 38, r, c1);
  }

  _island(g, x, y, s, r, tone) {
    g.save();
    g.translate(x, y);
    g.globalAlpha = 0.8;
    // craggy rocky underside
    const grad = g.createLinearGradient(0, -s * 0.3, 0, s);
    grad.addColorStop(0, tone); grad.addColorStop(1, 'rgba(40,40,62,0.85)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(-s, 0);
    g.lineTo(-s * 0.7, s * 0.42);
    g.lineTo(-s * 0.34, s * 0.5);
    g.lineTo(-s * 0.14, s * 0.92);
    g.lineTo(s * 0.2, s * 0.6);
    g.lineTo(s * 0.55, s * 0.46);
    g.lineTo(s, 0);
    g.closePath(); g.fill();
    // vegetation / snow top
    g.fillStyle = this.theme === 'verdant' ? '#6fae5e' : (this.theme === 'frozen' ? '#dcedf8' : tone);
    g.beginPath(); g.ellipse(0, -2, s, s * 0.26, 0, 0, Math.PI * 2); g.fill();
    if (this.theme === 'verdant') {  // thin waterfall streaming off the edge
      const wf = g.createLinearGradient(0, 0, 0, s * 0.9);
      wf.addColorStop(0, 'rgba(205,238,255,0.7)'); wf.addColorStop(1, 'rgba(205,238,255,0)');
      g.fillStyle = wf;
      g.fillRect(-s * 0.3, 2, 4.5, s * 0.9);
    }
    g.restore();
  }

  _paintHills(g, w, h, r, top, c1, c2, decor) {
    this._ridge(g, w, h, r, top, c1, c2, false);
    if (decor === 'castle') {
      // distant fairytale castle, hazy against the sky
      const x = w * (0.3 + r() * 0.4), y = top + 6;
      g.save();
      g.globalAlpha = 0.75;
      g.fillStyle = '#7d9cb4';
      const tower = (tx, tw, th) => {
        g.fillRect(tx, y - th, tw, th + 30);
        g.beginPath(); g.moveTo(tx - 2, y - th); g.lineTo(tx + tw / 2, y - th - tw * 1.1); g.lineTo(tx + tw + 2, y - th); g.fill();
      };
      tower(x, 13, 44); tower(x + 22, 17, 64); tower(x + 48, 13, 38);
      g.fillRect(x - 6, y - 18, 66, 30);       // keep wall
      g.restore();
    }
    if (decor === 'trees') {
      for (let i = 0; i < 24; i++) {
        const x = r() * w, y = top + 20 + r() * 80, s = 26 + r() * 34;
        g.fillStyle = i % 2 ? '#2e6337' : '#356e3c';
        g.beginPath(); g.arc(x, y - s, s * 0.62, 0, Math.PI * 2); g.fill();
        g.fillRect(x - 3, y - s, 7, s);
      }
    }
  }

  _paintPines(g, w, h, r, top, cBack, cFront, glow) {
    this._ridge(g, w, h, r, top + 40, cBack, cFront, false);
    for (let i = 0; i < 30; i++) {
      const x = r() * w, base = top + 40 + r() * 90, s = 60 + r() * 90;
      g.fillStyle = cFront;
      g.beginPath();
      g.moveTo(x, base - s);
      g.lineTo(x + s * 0.3, base);
      g.lineTo(x - s * 0.3, base);
      g.closePath(); g.fill();
    }
    if (glow) { // faint blue glow-mushroom clusters at the treeline
      for (let i = 0; i < 10; i++) {
        const x = r() * w, y = top + 120 + r() * 60;
        const gr = g.createRadialGradient(x, y, 0, x, y, 22);
        gr.addColorStop(0, 'rgba(110,190,255,0.8)'); gr.addColorStop(1, 'rgba(110,190,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, 22, 0, Math.PI * 2); g.fill();
      }
    }
  }

  _paintIceSpires(g, w, h, r, top) {
    this._ridge(g, w, h, r, top, '#8fb6d6', '#c3ddf0', true);
    for (let i = 0; i < 12; i++) {   // jutting glacier shards
      const x = r() * w, base = top + 60 + r() * 100, s = 70 + r() * 120;
      const grad = g.createLinearGradient(x, base - s, x, base);
      grad.addColorStop(0, '#eaf6ff'); grad.addColorStop(1, '#9cc3e0');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x, base - s);
      g.lineTo(x + 18 + r() * 22, base);
      g.lineTo(x - 18 - r() * 22, base);
      g.closePath(); g.fill();
    }
  }

  _paintSnowDrifts(g, w, h, r, top) {
    this._ridge(g, w, h, r, top, '#d5e8f5', '#f2f9ff', false);
    for (let i = 0; i < 14; i++) {   // frozen pines dusted with snow
      const x = r() * w, base = top + 30 + r() * 70, s = 50 + r() * 60;
      g.fillStyle = '#28405c';
      g.beginPath(); g.moveTo(x, base - s); g.lineTo(x + s * 0.28, base); g.lineTo(x - s * 0.28, base); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath(); g.moveTo(x, base - s); g.lineTo(x + s * 0.13, base - s * 0.55); g.lineTo(x - s * 0.13, base - s * 0.55); g.closePath(); g.fill();
    }
  }

  _paintMesas(g, w, h, r, top, c1, c2) {
    // flat-topped broken mesas
    const grad = g.createLinearGradient(0, top, 0, h);
    grad.addColorStop(0, c2); grad.addColorStop(1, c1);
    g.fillStyle = grad;
    let x = -50;
    while (x < w + 50) {
      const mw = 140 + r() * 220, mh = 120 + r() * 160;
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + mw * 0.12, top + 200 - mh);
      g.lineTo(x + mw * 0.85, top + 200 - mh + r() * 30);
      g.lineTo(x + mw, h);
      g.closePath(); g.fill();
      x += mw * (0.8 + r() * 0.6);
    }
  }

  _paintDeadLand(g, w, h, r, top, front) {
    this._ridge(g, w, h, r, top, front ? '#191320' : '#241b2e', front ? '#221a2c' : '#332740', false);
    for (let i = 0; i < (front ? 12 : 18); i++) {  // gnarled dead trees
      const x = r() * w, base = top + 30 + r() * 80, s = 40 + r() * (front ? 90 : 60);
      g.strokeStyle = front ? '#0d0a12' : '#181022';
      g.lineWidth = front ? 7 : 5;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, base);
      g.lineTo(x + (r() - .5) * 20, base - s);
      g.stroke();
      for (let b = 0; b < 3; b++) {
        g.lineWidth = (front ? 4 : 3) - b;
        g.beginPath();
        const by = base - s * (0.45 + r() * 0.4);
        g.moveTo(x + (r() - .5) * 10, by);
        g.lineTo(x + (r() - .5) * 90, by - 20 - r() * 40);
        g.stroke();
      }
    }
  }

  _paintVolcanoes(g, w, h, r, top) {
    // black volcano cones with glowing rims & lava veins
    for (let i = 0; i < 4; i++) {
      const x = w * (i / 4) + r() * 200, vw = 320 + r() * 200, vh = 220 + r() * 140;
      const peak = top + 120 - vh * 0.4;
      const grad = g.createLinearGradient(0, peak, 0, h);
      grad.addColorStop(0, '#2b1214'); grad.addColorStop(1, '#12070a');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x - vw / 2, h); g.lineTo(x - vw * 0.08, peak); g.lineTo(x + vw * 0.08, peak); g.lineTo(x + vw / 2, h);
      g.closePath(); g.fill();
      // crater glow
      const gl = g.createRadialGradient(x, peak, 4, x, peak, 90);
      gl.addColorStop(0, 'rgba(255,140,40,0.9)'); gl.addColorStop(1, 'rgba(255,80,20,0)');
      g.fillStyle = gl; g.beginPath(); g.arc(x, peak, 90, 0, Math.PI * 2); g.fill();
      // lava veins running down
      g.strokeStyle = 'rgba(255,120,30,0.8)';
      g.lineWidth = 3;
      for (let v = 0; v < 3; v++) {
        g.beginPath();
        let vx = x + (r() - .5) * 40, vy = peak + 10;
        g.moveTo(vx, vy);
        while (vy < h - 40) { vx += (r() - .5) * 46; vy += 40 + r() * 40; g.lineTo(vx, vy); }
        g.stroke();
      }
    }
  }

  _paintObsidian(g, w, h, r, top, front) {
    this._ridge(g, w, h, r, top, front ? '#0d0508' : '#1a0a10', front ? '#1c0c12' : '#2a1219', true);
    // jagged obsidian spikes with ember-lit edges
    for (let i = 0; i < (front ? 10 : 14); i++) {
      const x = r() * w, base = top + 50 + r() * 90, s = 60 + r() * (front ? 130 : 90);
      g.fillStyle = front ? '#0a0407' : '#160a0e';
      g.beginPath();
      g.moveTo(x, base - s);
      g.lineTo(x + 16 + r() * 26, base);
      g.lineTo(x - 16 - r() * 26, base);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,90,30,' + (0.25 + r() * 0.4) + ')';
      g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(x, base - s); g.lineTo(x + 10 + r() * 16, base); g.stroke();
    }
  }

  /* ---------------- ambient particles ---------------- */
  _seedParticles() {
    const T = this.theme, n = { verdant: 14, night: 26, frozen: 60, storm: 46, hell: 55 }[T];
    for (let i = 0; i < n; i++) this.parts.push(this._newPart(true));
  }

  _newPart(anywhere) {
    const T = this.theme;
    const x = anywhere ? Math.random() * CFG.W : (Math.random() < 0.5 ? -20 : CFG.W + 20);
    if (T === 'verdant') return { x: Math.random() * CFG.W, y: Math.random() * 500, vx: -30 - Math.random() * 50, vy: 14 + Math.random() * 24, r: 4 + Math.random() * 4, spin: Math.random() * 6, kind: 'leaf' };
    if (T === 'night')  return { x: Math.random() * CFG.W, y: 120 + Math.random() * 460, vx: (Math.random() - .5) * 26, vy: (Math.random() - .5) * 18, r: 2 + Math.random() * 2.5, ph: Math.random() * 7, kind: 'fly' };
    if (T === 'frozen') return { x: Math.random() * CFG.W, y: -10 + Math.random() * 720, vx: -40 - Math.random() * 60, vy: 55 + Math.random() * 70, r: 1.5 + Math.random() * 3.5, kind: 'snow' };
    if (T === 'storm')  return { x: Math.random() * CFG.W, y: Math.random() * 700, vx: -120 - Math.random() * 160, vy: (Math.random() - .5) * 40, r: 1.5 + Math.random() * 3, kind: 'ash' };
    return { x: Math.random() * CFG.W, y: 400 + Math.random() * 320, vx: (Math.random() - .5) * 30, vy: -40 - Math.random() * 80, r: 1.5 + Math.random() * 3.5, ph: Math.random() * 7, kind: 'ember' };
  }

  update(dt) {
    this.t += dt;
    for (const p of this.parts) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.ph !== undefined) p.ph += dt * 3;
      if (p.kind === 'fly') { p.vx += (Math.random() - .5) * 30 * dt * 10; p.vy += (Math.random() - .5) * 30 * dt * 10; p.vx = Math.max(-40, Math.min(40, p.vx)); p.vy = Math.max(-30, Math.min(30, p.vy)); }
      if (p.x < -30 || p.x > CFG.W + 30 || p.y > CFG.H + 20 || p.y < -30) Object.assign(p, this._newPart(false), { x: p.vx < 0 ? CFG.W + 20 : -20, y: p.kind === 'snow' || p.kind === 'ash' ? Math.random() * 400 - 20 : p.y });
      if (p.kind === 'ember' && p.y < -20) Object.assign(p, this._newPart(false), { y: CFG.H + 10, x: Math.random() * CFG.W });
    }
    if (this.theme === 'storm') {
      this.nextBolt -= dt;
      this.lightning = Math.max(0, this.lightning - dt * 3.2);
      if (this.nextBolt <= 0) { this.lightning = 1; this.boltX = 100 + Math.random() * (CFG.W - 200); this.nextBolt = 3 + Math.random() * 6; if (Game.state === 'play') AudioMan.sfx('fire'); }
    }
  }

  /* ---------------- drawing ---------------- */
  drawSky(ctx) {
    const T = this.theme, g = ctx.createLinearGradient(0, 0, 0, CFG.H);
    if (T === 'verdant') { g.addColorStop(0, '#4aa3e8'); g.addColorStop(0.55, '#8fd0f4'); g.addColorStop(1, '#eaf7d8'); }
    if (T === 'night')   { g.addColorStop(0, '#050718'); g.addColorStop(0.6, '#131a45'); g.addColorStop(1, '#2b2f66'); }
    if (T === 'frozen')  { g.addColorStop(0, '#8db8dd'); g.addColorStop(0.55, '#cfe6f5'); g.addColorStop(1, '#f4fafe'); }
    if (T === 'storm')   { g.addColorStop(0, '#1a1424'); g.addColorStop(0.6, '#41304a'); g.addColorStop(1, '#7a4a33'); }
    if (T === 'hell')    { g.addColorStop(0, '#0d0306'); g.addColorStop(0.5, '#3d0a0e'); g.addColorStop(1, '#a33414'); }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CFG.W, CFG.H);

    // celestial features
    if (T === 'verdant') {
      const s = ctx.createRadialGradient(1040, 120, 10, 1040, 120, 190);
      s.addColorStop(0, 'rgba(255,250,215,0.95)'); s.addColorStop(0.25, 'rgba(255,240,180,0.5)'); s.addColorStop(1, 'rgba(255,240,180,0)');
      ctx.fillStyle = s; ctx.fillRect(830, 0, 420, 330);
      this._clouds(ctx, 'rgba(255,255,255,0.85)');
    }
    if (T === 'night') {
      // starfield (deterministic)
      const r = mulberry32(99);
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 120; i++) {
        const x = r() * CFG.W, y = r() * 420, tw = 0.4 + 0.6 * Math.abs(Math.sin(this.t * (0.5 + r()) + i));
        ctx.globalAlpha = tw * 0.9;
        ctx.fillRect(x, y, 2, 2);
      }
      ctx.globalAlpha = 1;
      // big moon + small moon
      const m = ctx.createRadialGradient(980, 150, 20, 980, 150, 170);
      m.addColorStop(0, 'rgba(235,240,255,1)'); m.addColorStop(0.35, 'rgba(200,215,255,0.35)'); m.addColorStop(1, 'rgba(200,215,255,0)');
      ctx.fillStyle = m; ctx.beginPath(); ctx.arc(980, 150, 170, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8edff'; ctx.beginPath(); ctx.arc(980, 150, 62, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(190,200,235,0.7)';
      ctx.beginPath(); ctx.arc(960, 135, 12, 0, Math.PI * 2); ctx.arc(1000, 168, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c9d4f0'; ctx.beginPath(); ctx.arc(320, 90, 22, 0, Math.PI * 2); ctx.fill();
    }
    if (T === 'frozen') {
      const s = ctx.createRadialGradient(220, 130, 8, 220, 130, 150);
      s.addColorStop(0, 'rgba(255,255,255,0.95)'); s.addColorStop(1, 'rgba(230,245,255,0)');
      ctx.fillStyle = s; ctx.fillRect(50, 0, 360, 300);
      this._clouds(ctx, 'rgba(255,255,255,0.5)');
    }
    if (T === 'storm') {
      // smouldering ember glow along the horizon
      const hz = ctx.createLinearGradient(0, 300, 0, CFG.GROUND_Y);
      hz.addColorStop(0, 'rgba(255,120,50,0)');
      hz.addColorStop(1, `rgba(255,130,55,${0.42 + 0.1 * Math.sin(this.t * 1.3)})`);
      ctx.fillStyle = hz;
      ctx.fillRect(0, 300, CFG.W, CFG.GROUND_Y - 300);
      // heavy rolling cloud bands
      const r = mulberry32(77);
      for (let i = 0; i < 8; i++) {
        const y = 40 + i * 42 + Math.sin(this.t * 0.3 + i) * 8;
        ctx.fillStyle = `rgba(${18 + i * 6},${14 + i * 5},${26 + i * 6},0.55)`;
        ctx.beginPath();
        ctx.ellipse((r() * CFG.W + this.t * 12 * (i % 3 + 1)) % (CFG.W + 400) - 200, y, 260 + r() * 160, 34 + r() * 22, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (this.lightning > 0) {
        ctx.fillStyle = `rgba(220,225,255,${this.lightning * 0.28})`;
        ctx.fillRect(0, 0, CFG.W, CFG.H);
        if (this.lightning > 0.55) this._bolt(ctx, this.boltX);
      }
    }
    if (T === 'hell') {
      // smoke plumes lit from beneath + pulsing sky glow
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 1.7);
      const s = ctx.createRadialGradient(CFG.W / 2, 720, 100, CFG.W / 2, 720, 900);
      s.addColorStop(0, `rgba(255,110,30,${0.25 + pulse * 0.12})`); s.addColorStop(1, 'rgba(255,110,30,0)');
      ctx.fillStyle = s; ctx.fillRect(0, 0, CFG.W, CFG.H);
      const r = mulberry32(55);
      for (let i = 0; i < 7; i++) {
        const x = (r() * CFG.W + this.t * 10) % (CFG.W + 300) - 150, y = 60 + r() * 180;
        ctx.fillStyle = `rgba(30,8,10,0.6)`;
        ctx.beginPath(); ctx.ellipse(x, y, 200 + r() * 140, 46 + r() * 30, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,90,20,${0.05 + 0.05 * pulse})`;
        ctx.beginPath(); ctx.ellipse(x, y + 34, 190 + r() * 130, 26, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  _clouds(ctx, color) {
    const r = mulberry32(7);
    ctx.fillStyle = color;
    for (let i = 0; i < 6; i++) {
      const x = (r() * CFG.W + this.t * (6 + i * 2)) % (CFG.W + 360) - 180;
      const y = 60 + r() * 200, s = 40 + r() * 46;
      ctx.beginPath();
      ctx.ellipse(x, y, s * 2.2, s * 0.8, 0, 0, Math.PI * 2);
      ctx.ellipse(x - s, y + s * 0.28, s * 1.3, s * 0.6, 0, 0, Math.PI * 2);
      ctx.ellipse(x + s * 1.1, y + s * 0.3, s * 1.4, s * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _bolt(ctx, x) {
    ctx.save();
    ctx.strokeStyle = 'rgba(240,244,255,0.95)';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#aab8ff'; ctx.shadowBlur = 22;
    ctx.beginPath();
    let y = 0, bx = x;
    ctx.moveTo(bx, y);
    while (y < 560) { bx += (Math.random() - .5) * 90; y += 50 + Math.random() * 60; ctx.lineTo(bx, y); }
    ctx.stroke();
    ctx.restore();
  }

  _layer(ctx, tile, camX, speed) {
    const w = tile.width;
    let x = -((camX * speed) % w);
    if (x > 0) x -= w;
    for (; x < CFG.W; x += w) ctx.drawImage(tile, x, 0);
  }

  draw(ctx, camX) {
    this.drawSky(ctx);
    this._layer(ctx, this.far, camX, 0.12);
    // atmospheric haze between layers
    ctx.fillStyle = { verdant: 'rgba(220,240,255,0.16)', night: 'rgba(20,26,70,0.25)', frozen: 'rgba(240,250,255,0.22)', storm: 'rgba(60,42,60,0.22)', hell: 'rgba(60,10,8,0.28)' }[this.theme];
    ctx.fillRect(0, 0, CFG.W, CFG.H);
    this._layer(ctx, this.mid, camX, 0.3);
    this._layer(ctx, this.near, camX, 0.55);
    this.drawParticles(ctx);
  }

  drawParticles(ctx) {
    for (const p of this.parts) {
      ctx.save();
      if (p.kind === 'leaf') {
        ctx.translate(p.x, p.y); ctx.rotate(p.spin + this.t * 2);
        ctx.fillStyle = 'rgba(120,190,90,0.8)';
        ctx.beginPath(); ctx.ellipse(0, 0, p.r * 1.6, p.r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'fly') {
        const a = 0.35 + 0.65 * Math.abs(Math.sin(p.ph));
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        g.addColorStop(0, `rgba(190,255,140,${a})`); g.addColorStop(1, 'rgba(190,255,140,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'snow') {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'ash') {
        ctx.fillStyle = 'rgba(190,170,170,0.55)';
        ctx.fillRect(p.x, p.y, p.r * 2, p.r);
      } else { // ember
        const a = 0.4 + 0.6 * Math.abs(Math.sin(p.ph));
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
        g.addColorStop(0, `rgba(255,180,70,${a})`); g.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  /* Themed ground strip. Gaps are drawn by the level renderer. */
  drawGroundSlice(ctx, x, w, t) {
    const T = this.theme, gy = CFG.GROUND_Y;
    let top, body, detail;
    if (T === 'verdant') { top = '#4e9b3f'; body = '#5d4a33'; detail = '#6fb552'; }
    if (T === 'night')   { top = '#20355a'; body = '#131426'; detail = '#33507e'; }
    if (T === 'frozen')  { top = '#eef7ff'; body = '#9db8d0'; detail = '#ffffff'; }
    if (T === 'storm')   { top = '#4a3040'; body = '#241722'; detail = '#5d3e4c'; }
    if (T === 'hell')    { top = '#33131a'; body = '#150609'; detail = '#4a1c22'; }
    ctx.fillStyle = body; ctx.fillRect(x, gy + 14, w, CFG.H - gy - 14);
    ctx.fillStyle = top;  ctx.fillRect(x, gy, w, 18);
    // soft rounded lip
    ctx.fillStyle = detail;
    ctx.fillRect(x, gy, w, 5);
    if (T === 'hell') {
      // pulsing lava cracks
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255,120,30,${0.35 + 0.35 * pulse})`;
      ctx.lineWidth = 3;
      for (let cx = Math.floor(x / 90) * 90; cx < x + w; cx += 90) {
        ctx.beginPath();
        ctx.moveTo(cx, gy + 20); ctx.lineTo(cx + 24, gy + 52); ctx.lineTo(cx + 10, gy + 88);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (T === 'frozen') {
      ctx.fillStyle = 'rgba(140,190,225,0.5)';
      for (let cx = Math.floor(x / 120) * 120; cx < x + w; cx += 120) ctx.fillRect(cx, gy + 26, 44, 4);
    }
  }
}
