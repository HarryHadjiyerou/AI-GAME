/* ============================================================
   Elfblade — combat juice: particles, sword slash trails,
   shockwaves, floating damage numbers, screen shake, hit-stop.
   These are what make weapon hits feel fluid and heavy.
   ============================================================ */

const FX = {
  parts: [],       // particles
  trails: [],      // sword slash arcs
  rings: [],       // shockwave rings
  texts: [],       // floating damage numbers
  shakeAmp: 0, shakeT: 0,
  hitStop: 0,      // seconds of frozen gameplay (impact frames)
  flash: 0, flashColor: '#fff',
  punch: 0,        // camera zoom impulse on big hits

  reset() { this.parts = []; this.trails = []; this.rings = []; this.texts = []; this.shakeAmp = 0; this.hitStop = 0; this.flash = 0; },

  shake(amp, dur) { this.shakeAmp = Math.max(this.shakeAmp, amp); this.shakeT = Math.max(this.shakeT, dur); },
  zoomPunch(a) { this.punch = Math.max(this.punch, a); },
  stop(sec) { this.hitStop = Math.max(this.hitStop, sec); },
  screenFlash(color, a) { this.flash = Math.max(this.flash, a); this.flashColor = color; },

  /* sparks / debris burst. worldX/Y, base color, count */
  burst(x, y, color, n, speed = 420, life = 0.5, grav = 900, size = 5) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.35 + Math.random() * 0.8);
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120,
        life: life * (0.6 + Math.random() * 0.7), t: 0, color, grav,
        r: size * (0.5 + Math.random()), glow: Math.random() < 0.4 });
    }
  },

  /* directional spray (for sword impacts — sparks fly away from the blade) */
  spray(x, y, angle, spread, color, n, speed = 560) {
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const v = speed * (0.4 + Math.random() * 0.9);
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0.28 + Math.random() * 0.3, t: 0, color, grav: 1500,
        r: 2.5 + Math.random() * 3.5, glow: true });
    }
  },

  /* soft ambient puff (dust, snow kicks) */
  puff(x, y, color, n = 6, speed = 120) {
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (Math.random() - 0.5) * 1.6;
      this.parts.push({ x, y, vx: Math.cos(a) * speed * Math.random(), vy: -40 - Math.random() * 80,
        life: 0.4 + Math.random() * 0.4, t: 0, color, grav: -60,
        r: 6 + Math.random() * 8, glow: false, fadeGrow: true });
    }
  },

  /* sword slash arc: drawn as a glowing crescent that sweeps & fades */
  slash(x, y, angle, radius, flip, color = '#ffe9a8', face = 1) {
    this.trails.push({ x, y, angle, radius, flip, t: 0, life: 0.22, color, face });
  },

  lines: 0,
  speedLines(dur) { this.lines = Math.max(this.lines, dur); },

  drawSpeedLines(ctx) {
    if (this.lines <= 0) return;
    const a = Math.min(1, this.lines * 3);
    ctx.save();
    ctx.translate(CFG.W / 2, CFG.H / 2);
    ctx.globalCompositeOperation = 'lighter';
    const n = 26, seed = Math.floor(performance.now() / 50);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + ((seed * 37 + i * 61) % 100) / 260;
      const inner = 190 + ((seed * 13 + i * 29) % 90);
      const len = 260 + ((seed * 7 + i * 43) % 240);
      const w = 6 + ((i * 17) % 12);
      ctx.globalAlpha = a * 0.3;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * inner, Math.sin(ang) * inner);
      ctx.lineTo(Math.cos(ang + 0.012) * (inner + len), Math.sin(ang + 0.012) * (inner + len) + w);
      ctx.lineTo(Math.cos(ang - 0.012) * (inner + len), Math.sin(ang - 0.012) * (inner + len) - w);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  },

  ring(x, y, color, maxR = 300, life = 0.4, width = 26) {
    this.rings.push({ x, y, t: 0, life, maxR, color, width });
  },

  dmgText(x, y, str, color = '#ffd45e', big = false) {
    this.texts.push({ x: x + (Math.random() - 0.5) * 30, y, str, color, t: 0, life: 0.8, big });
  },

  update(dt) {
    if (this.shakeT > 0) { this.shakeT -= dt; if (this.shakeT <= 0) this.shakeAmp = 0; }
    this.flash = Math.max(0, this.flash - dt * 2.6);
    this.punch = Math.max(0, this.punch - dt * 6);
    this.lines = Math.max(0, this.lines - dt);
    for (const p of this.parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.grav || 0) * dt; }
    this.parts = this.parts.filter(p => p.t < p.life);
    for (const s of this.trails) s.t += dt;
    this.trails = this.trails.filter(s => s.t < s.life);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter(r => r.t < r.life);
    for (const t of this.texts) { t.t += dt; t.y -= 70 * dt; }
    this.texts = this.texts.filter(t => t.t < t.life);
  },

  camOffset() {
    if (this.shakeAmp <= 0) return { x: 0, y: 0 };
    return { x: (Math.random() - 0.5) * 2 * this.shakeAmp, y: (Math.random() - 0.5) * 2 * this.shakeAmp };
  },

  draw(ctx, camX) {
    // slash trails — layered crescents for a fluid motion-blur look
    for (const s of this.trails) {
      const k = s.t / s.life;                       // 0..1
      const sweep = 2.4;                            // radians covered by the arc
      const start = s.angle - (s.flip ? -0.4 : sweep - 0.4) + (s.flip ? -1 : 1) * k * 0.9;
      ctx.save();
      ctx.translate(s.x - camX, s.y);
      if (s.face === -1) ctx.scale(-1, 1);     // mirror the arc when facing left
      ctx.globalAlpha = (1 - k);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const rr = s.radius - i * 15;
        const grad = ctx.createRadialGradient(0, 0, rr * 0.4, 0, 0, rr);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.75, s.color + (i === 0 ? 'ff' : '88'));
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 27 - i * 6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, 0, rr, start, start + sweep * (1 - k * 0.35), false);
        ctx.stroke();
      }
      // hot white leading edge
      ctx.strokeStyle = `rgba(255,255,255,${(1 - k) * 0.9})`;
      ctx.lineWidth = 7;
      const lead = start + sweep * (1 - k * 0.35);
      ctx.beginPath();
      ctx.arc(0, 0, s.radius - 8, lead - 0.5, lead, false);
      ctx.stroke();
      ctx.restore();
    }

    // shockwave rings
    for (const r of this.rings) {
      const k = r.t / r.life;
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.85;
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - k * 0.7);
      ctx.beginPath();
      ctx.arc(r.x - camX, r.y, 20 + (r.maxR - 20) * Math.pow(k, 0.6), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // particles
    for (const p of this.parts) {
      const k = p.t / p.life;
      ctx.save();
      ctx.globalAlpha = (1 - k) * (p.fadeGrow ? 0.35 : 0.95);
      if (p.glow) ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x - camX, p.y, p.r * (p.fadeGrow ? 1 + k * 1.6 : 1 - k * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // floating damage numbers
    for (const t of this.texts) {
      const k = t.t / t.life;
      ctx.save();
      ctx.globalAlpha = 1 - k * k;
      ctx.font = `${t.big ? 900 : 700} ${t.big ? 42 : 28}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(20,10,0,0.85)';
      ctx.strokeText(t.str, t.x - camX, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x - camX, t.y);
      ctx.restore();
    }
  },

  drawFlash(ctx) {
    if (this.flash <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(0.55, this.flash);
    ctx.fillStyle = this.flashColor;
    ctx.fillRect(0, 0, CFG.W, CFG.H);
    ctx.restore();
  },
};
