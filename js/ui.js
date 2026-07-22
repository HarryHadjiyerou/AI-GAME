/* ============================================================
   Elfblade — UI: illustrated fantasy HUD + menu screens.
   Everything is drawn to canvas (no DOM widgets) with gold
   filigree panels so it matches the painterly art style.
   ============================================================ */

const UI = {
  bannerText: null, bannerSub: null, bannerT: 0,
  pressT: {},                 // button id -> time of last press (for tactile feedback)

  banner(text, sub, dur = 2.6) { this.bannerText = text; this.bannerSub = sub; this.bannerT = dur; },
  press(id) { this.pressT[id] = performance.now(); },

  /* Ornate circular "gem" button in the style of the reference art:
     bronze bezel, gold rim, deep radial gem face, glossy highlight,
     pulsing glow, and a squash-flash when pressed. */
  gemButton(ctx, id, cx, cy, r, opts = {}) {
    const now = performance.now();
    const t = now / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.6 + (opts.phase || 0));
    const pk = Math.max(0, 1 - (now - (this.pressT[id] || -1e9)) / 180);   // press anim 0..1
    const R = r * (1 - pk * 0.1);
    const glow = opts.glow || '#ffcf5e';

    ctx.save();
    ctx.translate(cx, cy);

    // drop shadow grounds the button
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(0, R * 0.16, R * 1.04, R * 1.02, 0, 0, Math.PI * 2); ctx.fill();

    // ambient glow halo (breathes; flares when ready/pressed)
    const halo = (opts.ready ? 0.85 : 0.35) + pulse * 0.25 + pk * 0.6;
    const hg = ctx.createRadialGradient(0, 0, R * 0.6, 0, 0, R * 1.75);
    hg.addColorStop(0, glow + '00');
    hg.addColorStop(0.55, glow + Math.round(halo * 60).toString(16).padStart(2, '0'));
    hg.addColorStop(1, glow + '00');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.75, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // bronze bezel
    let g = ctx.createLinearGradient(0, -R, 0, R);
    g.addColorStop(0, '#8a6a30'); g.addColorStop(0.5, '#4a3312'); g.addColorStop(1, '#241708');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();

    // gold rim
    g = ctx.createLinearGradient(0, -R, 0, R);
    g.addColorStop(0, '#ffe9a4'); g.addColorStop(0.35, '#d8ab4e'); g.addColorStop(0.7, '#8a5c1c'); g.addColorStop(1, '#e8c265');
    ctx.strokeStyle = g;
    ctx.lineWidth = R * 0.13;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.9, 0, Math.PI * 2); ctx.stroke();

    // gem face
    const base = opts.base || '#1d3a24';
    g = ctx.createRadialGradient(-R * 0.28, -R * 0.32, R * 0.1, 0, 0, R * 0.82);
    g.addColorStop(0, opts.baseHi || '#3f7048');
    g.addColorStop(0.72, base);
    g.addColorStop(1, '#0a0d08');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.8, 0, Math.PI * 2); ctx.fill();

    // inner lit rim (animates with the pulse)
    ctx.strokeStyle = glow;
    ctx.globalAlpha = 0.35 + pulse * 0.4 + pk * 0.3 + (opts.ready ? 0.25 : 0);
    ctx.shadowColor = glow; ctx.shadowBlur = 10 + pulse * 10 + pk * 16;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.72, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // icon, glowing
    if (opts.icon) {
      ctx.save();
      ctx.shadowColor = glow;
      ctx.shadowBlur = 12 + pulse * 12 + pk * 18;
      opts.icon(ctx, R, pulse);
      ctx.restore();
    }

    // glossy top highlight
    g = ctx.createLinearGradient(0, -R * 0.75, 0, -R * 0.1);
    g.addColorStop(0, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, -R * 0.42, R * 0.55, R * 0.3, 0, 0, Math.PI * 2); ctx.fill();

    // press flash ring
    if (pk > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${pk * 0.8})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, R * (1.05 + (1 - pk) * 0.35), 0, Math.PI * 2); ctx.stroke();
    }

    // caption under the button
    if (opts.label) {
      ctx.font = `700 ${Math.max(12, R * 0.26)}px Georgia`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(15,8,2,0.85)';
      ctx.strokeText(opts.label, 0, R * 1.12);
      ctx.fillStyle = '#f6e6b8';
      ctx.fillText(opts.label, 0, R * 1.12);
    }
    ctx.restore();

    Input.zones.push({ id, x: cx - r * 1.15, y: cy - r * 1.15, w: r * 2.3, h: r * 2.3 });
  },

  /* ---------- glowing icon painters ---------- */
  iconJump(ctx, R) {
    ctx.fillStyle = '#ffe9a4';
    ctx.strokeStyle = '#ffe9a4';
    ctx.lineWidth = R * 0.13; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-R * 0.32, R * 0.1); ctx.lineTo(0, -R * 0.34); ctx.lineTo(R * 0.32, R * 0.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-R * 0.32, R * 0.42); ctx.lineTo(0, -0.02 * R); ctx.lineTo(R * 0.32, R * 0.42);
    ctx.stroke();
  },
  iconSlide(ctx, R) {
    ctx.strokeStyle = '#bfe4ff';
    ctx.lineWidth = R * 0.13; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-R * 0.32, -R * 0.34); ctx.lineTo(0, R * 0.1); ctx.lineTo(R * 0.32, -R * 0.34);
    ctx.stroke();
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(-R * 0.32, 0.02 * R); ctx.lineTo(0, R * 0.44); ctx.lineTo(R * 0.32, 0.02 * R);
    ctx.stroke();
    ctx.globalAlpha = 1;
  },
  iconSword(ctx, R) {
    ctx.save();
    ctx.rotate(-0.7);
    // blade
    let g = ctx.createLinearGradient(-R * 0.07, 0, R * 0.07, 0);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#dce9f4'); g.addColorStop(1, '#9fb6c8');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.56);
    ctx.lineTo(R * 0.09, -R * 0.4); ctx.lineTo(R * 0.07, R * 0.16);
    ctx.lineTo(0, R * 0.23); ctx.lineTo(-R * 0.07, R * 0.16); ctx.lineTo(-R * 0.09, -R * 0.4);
    ctx.closePath(); ctx.fill();
    // guard + grip + pommel
    ctx.fillStyle = '#ffd76e';
    ctx.beginPath(); ctx.roundRect(-R * 0.22, R * 0.2, R * 0.44, R * 0.09, R * 0.05); ctx.fill();
    ctx.fillStyle = '#7a4c22';
    ctx.beginPath(); ctx.roundRect(-R * 0.05, R * 0.28, R * 0.1, R * 0.24, R * 0.04); ctx.fill();
    ctx.fillStyle = '#ffd76e';
    ctx.beginPath(); ctx.arc(0, R * 0.58, R * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
  iconBolt(ctx, R, pulse) {
    const g = ctx.createRadialGradient(0, 0, R * 0.05, 0, 0, R * 0.5);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, '#8fd4ff'); g.addColorStop(1, 'rgba(60,130,255,0.05)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(200,236,255,0.9)';
    ctx.lineWidth = R * 0.06;
    ctx.beginPath(); ctx.ellipse(0, 0, R * 0.52, R * 0.2, -0.6 + pulse * 0.15, 0, Math.PI * 2); ctx.stroke();
  },
  iconBlast(ctx, R, pulse) {
    ctx.fillStyle = '#ffdf9a';
    const spikes = 8;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = i * Math.PI / spikes - pulse * 0.2;
      const rr = (i % 2 ? R * 0.24 : R * 0.52);
      ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff9040';
    ctx.beginPath(); ctx.arc(0, 0, R * 0.18, 0, Math.PI * 2); ctx.fill();
  },
  iconPause(ctx, R) {
    ctx.fillStyle = '#f6e6b8';
    ctx.beginPath(); ctx.roundRect(-R * 0.26, -R * 0.3, R * 0.18, R * 0.6, R * 0.06); ctx.fill();
    ctx.beginPath(); ctx.roundRect(R * 0.08, -R * 0.3, R * 0.18, R * 0.6, R * 0.06); ctx.fill();
  },
  iconNote(ctx, R) {
    ctx.fillStyle = '#f6e6b8';
    ctx.strokeStyle = '#f6e6b8';
    ctx.lineWidth = R * 0.09; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(R * 0.12, -R * 0.34); ctx.lineTo(R * 0.12, R * 0.16); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-0.02 * R, R * 0.2, R * 0.17, R * 0.12, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(R * 0.12, -R * 0.34); ctx.quadraticCurveTo(R * 0.36, -R * 0.26, R * 0.34, -R * 0.05); ctx.lineWidth = R * 0.07; ctx.stroke();
    if (AudioMan.muted) {
      ctx.strokeStyle = '#ff6a4a'; ctx.lineWidth = R * 0.1;
      ctx.beginPath(); ctx.moveTo(-R * 0.34, -R * 0.34); ctx.lineTo(R * 0.38, R * 0.38); ctx.stroke();
    }
  },

  /* ---------- shared drawing helpers ---------- */
  panel(ctx, x, y, w, h, r = 18) {
    ctx.save();
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, 'rgba(46,32,18,0.92)');
    g.addColorStop(1, 'rgba(24,15,8,0.94)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
    ctx.strokeStyle = '#b8913f'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(x + 1.5, y + 1.5, w - 3, h - 3, r); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,222,140,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x + 5, y + 5, w - 10, h - 10, r - 4); ctx.stroke();
    ctx.restore();
  },

  button(ctx, id, x, y, w, h, label, opts = {}) {
    this.panel(ctx, x, y, w, h, h / 2 - 4);
    ctx.save();
    if (opts.glow) {
      ctx.shadowColor = opts.glow; ctx.shadowBlur = 18 + Math.sin(performance.now() / 160) * 8;
      ctx.strokeStyle = opts.glow; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.roundRect(x + 2, y + 2, w - 4, h - 4, h / 2 - 5); ctx.stroke();
    }
    ctx.fillStyle = opts.color || '#f3e3ba';
    ctx.font = `${opts.weight || 700} ${opts.size || 26}px Georgia, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 2);
    ctx.restore();
    Input.zones.push({ id, x, y, w, h });
  },

  ornateBar(ctx, x, y, w, h, frac, c1, c2, label) {
    // carved trough
    ctx.save();
    ctx.fillStyle = 'rgba(15,9,4,0.85)';
    ctx.beginPath(); ctx.roundRect(x - 3, y - 3, w + 6, h + 6, h); ctx.fill();
    ctx.strokeStyle = '#a07f36'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.roundRect(x - 3, y - 3, w + 6, h + 6, h); ctx.stroke();
    if (frac > 0) {
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, c1); g.addColorStop(0.5, c2); g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(x, y, Math.max(h, w * frac), h, h / 2); ctx.fill();
      // gloss
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.roundRect(x + 2, y + 1.5, Math.max(h, w * frac) - 4, h * 0.36, h / 3); ctx.fill();
    }
    if (label) {
      ctx.font = '700 15px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(label, x + w / 2, y + h / 2 + 1);
      ctx.fillStyle = '#fff'; ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    }
    ctx.restore();
  },

  vignette(ctx, strength = 0.5) {
    const g = ctx.createRadialGradient(CFG.W / 2, CFG.H / 2, CFG.H * 0.42, CFG.W / 2, CFG.H / 2, CFG.H * 0.95);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(10,4,2,${strength})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, CFG.W, CFG.H);
  },

  title(ctx, text, y, size = 68, color = '#ffe9b0') {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${size}px Georgia, serif`;
    ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 16;
    ctx.lineWidth = size / 9; ctx.strokeStyle = '#3a2408';
    ctx.strokeText(text, CFG.W / 2, y);
    const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    g.addColorStop(0, '#fff4d0'); g.addColorStop(0.5, color); g.addColorStop(1, '#c8963c');
    ctx.fillStyle = g;
    ctx.fillText(text, CFG.W / 2, y);
    ctx.restore();
  },

  /* ---------- in-game HUD ---------- */
  drawHUD(ctx, game) {
    const p = game.player;

    // health + power panel
    this.panel(ctx, 18, 16, 330, 92);
    ctx.save();
    // ornate circular portrait: layered gold rings around an elf cameo
    const px0 = 64, py0 = 62;
    let prg = ctx.createLinearGradient(px0, py0 - 40, px0, py0 + 40);
    prg.addColorStop(0, '#ffe9a4'); prg.addColorStop(0.5, '#c9982e'); prg.addColorStop(1, '#7a5116');
    ctx.strokeStyle = prg; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(px0, py0, 36, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#3a2708'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px0, py0, 40, 0, Math.PI * 2); ctx.stroke();
    const pg = ctx.createRadialGradient(px0 - 10, py0 - 12, 4, px0, py0, 36);
    pg.addColorStop(0, '#6aa8d8'); pg.addColorStop(1, '#173450');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(px0, py0, 33, 0, Math.PI * 2); ctx.fill();
    // elf cameo: hair, face, ear
    ctx.save();
    ctx.beginPath(); ctx.arc(px0, py0, 33, 0, Math.PI * 2); ctx.clip();
    // face
    ctx.fillStyle = '#f2cba2';
    ctx.beginPath(); ctx.ellipse(px0 + 3, py0 + 5, 14, 16, 0, 0, Math.PI * 2); ctx.fill();
    // pointed ear poking left
    ctx.fillStyle = '#eec19a';
    ctx.beginPath(); ctx.moveTo(px0 - 9, py0 + 4); ctx.lineTo(px0 - 23, py0 - 1); ctx.lineTo(px0 - 8, py0 - 3); ctx.closePath(); ctx.fill();
    // hair: crescent cap above the brow, swept back
    ctx.fillStyle = '#f4e4a8';
    ctx.beginPath();
    ctx.moveTo(px0 + 17, py0 - 2);
    ctx.quadraticCurveTo(px0 + 15, py0 - 20, px0 - 2, py0 - 19);
    ctx.quadraticCurveTo(px0 - 19, py0 - 18, px0 - 20, py0 - 2);
    ctx.quadraticCurveTo(px0 - 12, py0 - 10, px0 - 2, py0 - 9);
    ctx.quadraticCurveTo(px0 + 10, py0 - 9, px0 + 17, py0 - 2);
    ctx.closePath(); ctx.fill();
    // eyes + mouth
    ctx.fillStyle = '#274a70';
    ctx.beginPath(); ctx.arc(px0 - 2, py0 + 3, 2, 0, Math.PI * 2); ctx.arc(px0 + 9, py0 + 3, 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#c08a5e'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(px0 + 1, py0 + 12); ctx.quadraticCurveTo(px0 + 4, py0 + 14, px0 + 7, py0 + 12); ctx.stroke();
    // green collar at the base
    ctx.fillStyle = '#2e6338';
    ctx.beginPath(); ctx.ellipse(px0 + 2, py0 + 30, 22, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // glass gleam
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.ellipse(px0 - 10, py0 - 14, 14, 8, -0.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    this.ornateBar(ctx, 112, 34, 216, 20, Math.max(0, p.hp / CFG.PLAYER.hp), '#b81c14', '#ff6e50', `${Math.ceil(p.hp)} / ${CFG.PLAYER.hp}`);
    const pf = p.power / CFG.PLAYER.powerMax;
    this.ornateBar(ctx, 112, 66, 216, 16, pf, '#1a6aa8', '#5fd0ff', pf >= 1 ? 'POWER READY!' : 'POWER');
    // shimmer sweep races along the power bar while charged
    if (pf >= 1) {
      ctx.save();
      ctx.beginPath(); ctx.roundRect(112, 66, 216, 16, 8); ctx.clip();
      const sx = 112 + ((performance.now() / 6) % 260) - 30;
      const sg = ctx.createLinearGradient(sx - 22, 0, sx + 22, 0);
      sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.75)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(sx - 22, 62, 44, 24);
      ctx.restore();
      ctx.save();
      ctx.shadowColor = '#63ccff'; ctx.shadowBlur = 16 + Math.sin(performance.now() / 130) * 9;
      ctx.strokeStyle = 'rgba(140,220,255,0.95)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.roundRect(108, 62, 224, 24, 12); ctx.stroke();
      ctx.restore();
    }

    // level name + progress to boss
    const lv = LEVELS[game.levelIdx];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '700 22px Georgia';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(20,10,2,0.8)';
    ctx.strokeText(`Stage ${game.levelIdx + 1} — ${lv.name}`, CFG.W / 2, 36);
    ctx.fillStyle = '#ffe9b0';
    ctx.fillText(`Stage ${game.levelIdx + 1} — ${lv.name}`, CFG.W / 2, 36);
    ctx.restore();
    // progress bar with skull marker at the end
    const bw = 320, bx = CFG.W / 2 - bw / 2, by = 52;
    ctx.save();
    ctx.strokeStyle = 'rgba(20,10,2,0.75)'; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + bw, by); ctx.stroke();
    ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + bw * Math.min(1, game.progress), by); ctx.stroke();
    ctx.fillStyle = '#ffe9b0';
    ctx.beginPath(); ctx.arc(bx + bw * Math.min(1, game.progress), by, 7, 0, Math.PI * 2); ctx.fill();
    ctx.font = '900 20px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('☠', bx + bw + 20, by);
    ctx.restore();

    // score
    ctx.save();
    ctx.font = '700 22px Georgia'; ctx.textAlign = 'right';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(20,10,2,0.8)';
    ctx.strokeText(`✦ ${game.score}`, CFG.W - 130, 40);
    ctx.fillStyle = '#ffd968'; ctx.fillText(`✦ ${game.score}`, CFG.W - 130, 40);
    ctx.restore();

    // pause + mute — small round gems, top-right
    this.gemButton(ctx, 'pause', CFG.W - 100, 42, 26, { base: '#31230e', baseHi: '#5c4520', glow: '#ffcf5e', icon: this.iconPause.bind(this), phase: 1 });
    this.gemButton(ctx, 'mute', CFG.W - 42, 42, 26, { base: '#31230e', baseHi: '#5c4520', glow: '#ffcf5e', icon: this.iconNote.bind(this), phase: 2 });

    // touch controls — glowing gem buttons like the reference art
    this.gemButton(ctx, 'jump', 96, CFG.H - 104, 58, {
      base: '#4a3208', baseHi: '#8a6a20', glow: '#ffb02e',
      icon: this.iconJump.bind(this), label: 'JUMP', phase: 0,
    });
    this.gemButton(ctx, 'slide', 232, CFG.H - 88, 46, {
      base: '#12304a', baseHi: '#2c5a80', glow: '#4fa8ff',
      icon: this.iconSlide.bind(this), label: 'SLIDE', phase: 0.9,
    });
    this.gemButton(ctx, 'attack', CFG.W - 112, CFG.H - 108, 66, {
      base: '#173420', baseHi: '#2e6338', glow: '#8fe842',
      icon: this.iconSword.bind(this), label: 'ATTACK', phase: 1.7,
    });

    // special selector — two charged orbs fan out when the meter is full
    if (p.power >= CFG.PLAYER.powerMax) {
      this.gemButton(ctx, 'special1', CFG.W - 96, CFG.H - 252, 46, {
        base: '#0e2846', baseHi: '#1c4a7c', glow: '#55bbff', ready: true,
        icon: this.iconBolt.bind(this), label: 'BOLT', phase: 0.4,
      });
      this.gemButton(ctx, 'special2', CFG.W - 236, CFG.H - 208, 46, {
        base: '#4a1c08', baseHi: '#843414', glow: '#ff9040', ready: true,
        icon: this.iconBlast.bind(this), label: 'BLAST', phase: 1.2,
      });
    }

    // boss health bar
    const boss = game.dragon || game.enemies.find(e => e.mini && !e.dead);
    if (boss && (boss.name || CFG.DRAGON.name)) {
      const name = boss.name || CFG.DRAGON.name;
      const w2 = 560, x2 = CFG.W / 2 - w2 / 2, y2 = CFG.H - 46;
      ctx.save();
      ctx.font = '700 19px Georgia'; ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(15,5,2,0.85)';
      ctx.strokeText(name, CFG.W / 2, y2 - 14);
      ctx.fillStyle = '#ffb9a0'; ctx.fillText(name, CFG.W / 2, y2 - 14);
      ctx.restore();
      this.ornateBar(ctx, x2, y2, w2, 16, Math.max(0, boss.hp / boss.maxHp), '#6a0f96', '#c33bff', null);
    }
  },

  drawBanner(ctx, dt) {
    if (this.bannerT <= 0) return;
    this.bannerT -= dt;
    const k = Math.min(1, (2.6 - this.bannerT) * 3);
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.bannerT * 1.6) * k;
    ctx.fillStyle = 'rgba(12,6,2,0.55)';
    ctx.fillRect(0, CFG.H * 0.3, CFG.W, 150);
    ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(CFG.W * 0.2, CFG.H * 0.3); ctx.lineTo(CFG.W * 0.8, CFG.H * 0.3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(CFG.W * 0.2, CFG.H * 0.3 + 150); ctx.lineTo(CFG.W * 0.8, CFG.H * 0.3 + 150); ctx.stroke();
    this.title(ctx, this.bannerText, CFG.H * 0.3 + 62, 46);
    if (this.bannerSub) {
      ctx.font = 'italic 400 23px Georgia';
      ctx.textAlign = 'center'; ctx.fillStyle = '#e8d8b0';
      ctx.fillText(this.bannerSub, CFG.W / 2, CFG.H * 0.3 + 112);
    }
    ctx.restore();
  },

  /* ---------- full screens ---------- */
  drawTitle(ctx, game, bg) {
    bg.draw(ctx, performance.now() / 22);
    this.vignette(ctx, 0.65);
    this.title(ctx, 'ELFBLADE', CFG.H * 0.3, 96);
    ctx.save();
    ctx.font = 'italic 400 28px Georgia'; ctx.textAlign = 'center'; ctx.fillStyle = '#e8d8b0';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 8;
    ctx.fillText('Trial of the Five Realms', CFG.W / 2, CFG.H * 0.3 + 66);
    ctx.restore();
    this.button(ctx, 'play', CFG.W / 2 - 150, CFG.H * 0.58, 300, 74, 'BEGIN THE TRIAL', { glow: '#ffd44f', size: 28 });
    this.button(ctx, 'levels', CFG.W / 2 - 150, CFG.H * 0.58 + 92, 300, 58, 'Choose Realm', { size: 22 });
    ctx.save();
    ctx.font = '400 15px Georgia'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(232,216,176,0.75)';
    ctx.fillText('▲ jump · ▼ slide · ⚔ attack — swipe or use W/S + J', CFG.W / 2, CFG.H - 54);
    ctx.fillText('Music: Kevin MacLeod (incompetech.com), CC-BY 4.0', CFG.W / 2, CFG.H - 28);
    ctx.restore();
  },

  drawLevelSelect(ctx, game, bg) {
    bg.draw(ctx, performance.now() / 22);
    this.vignette(ctx, 0.7);
    this.title(ctx, 'Choose Your Realm', 96, 52);
    const themes = ['☀', '☾', '❄', '⚡', '🔥'];
    const unlocked = game.save.unlocked;
    for (let i = 0; i < 5; i++) {
      const x = 90 + i * 230, y = CFG.H * 0.36, w = 200, h = 260;
      const open = i <= unlocked;
      this.panel(ctx, x, y, w, h);
      ctx.save();
      ctx.globalAlpha = open ? 1 : 0.45;
      ctx.font = '400 54px Georgia'; ctx.textAlign = 'center';
      ctx.fillStyle = '#ffe9b0';
      ctx.fillText(open ? themes[i] : '🔒', x + w / 2, y + 86);
      ctx.font = '700 21px Georgia';
      ctx.fillText(`Stage ${i + 1}`, x + w / 2, y + 138);
      ctx.font = '400 16px Georgia';
      ctx.fillStyle = '#d8c8a0';
      const words = LEVELS[i].name.split(' ');
      ctx.fillText(words.slice(0, 2).join(' '), x + w / 2, y + 168);
      ctx.fillText(words.slice(2).join(' '), x + w / 2, y + 190);
      if (game.save.best[i]) {
        ctx.fillStyle = '#ffd968';
        ctx.fillText(`✦ best ${game.save.best[i]}`, x + w / 2, y + 224);
      }
      ctx.restore();
      if (open) Input.zones.push({ id: 'lvl' + i, x, y, w, h });
    }
    this.button(ctx, 'back', 24, 24, 120, 52, '← Back', { size: 20 });
  },

  drawPause(ctx) {
    ctx.fillStyle = 'rgba(8,4,2,0.72)';
    ctx.fillRect(0, 0, CFG.W, CFG.H);
    this.title(ctx, 'PAUSED', CFG.H * 0.3, 64);
    this.button(ctx, 'resume', CFG.W / 2 - 140, CFG.H * 0.46, 280, 66, 'Resume', { glow: '#ffd44f' });
    this.button(ctx, 'retry', CFG.W / 2 - 140, CFG.H * 0.46 + 86, 280, 58, 'Restart Level', { size: 22 });
    this.button(ctx, 'quit', CFG.W / 2 - 140, CFG.H * 0.46 + 162, 280, 58, 'Abandon Quest', { size: 22 });
    this.button(ctx, 'mute', CFG.W - 76, 24, 52, 52, AudioMan.muted ? '✕' : '♪', { size: 22 });
  },

  drawDeath(ctx, game) {
    ctx.fillStyle = 'rgba(30,4,4,0.66)';
    ctx.fillRect(0, 0, CFG.W, CFG.H);
    this.vignette(ctx, 0.8);
    this.title(ctx, 'YOU HAVE FALLEN', CFG.H * 0.3, 62, '#ff9a80');
    ctx.save();
    ctx.font = 'italic 400 24px Georgia'; ctx.textAlign = 'center'; ctx.fillStyle = '#e8c8b0';
    ctx.fillText(game.checkpoint ? 'The blade remembers — rise again at the gate.' : 'The realm still needs its champion.', CFG.W / 2, CFG.H * 0.3 + 58);
    ctx.restore();
    this.button(ctx, 'retry', CFG.W / 2 - 150, CFG.H * 0.52, 300, 70, game.checkpoint ? 'RISE AGAIN ⚑' : 'TRY AGAIN', { glow: '#ff7a5a' });
    this.button(ctx, 'quit', CFG.W / 2 - 150, CFG.H * 0.52 + 90, 300, 58, 'Realm Select', { size: 22 });
  },

  drawVictory(ctx, game, final) {
    ctx.fillStyle = final ? 'rgba(40,16,4,0.6)' : 'rgba(6,18,8,0.6)';
    ctx.fillRect(0, 0, CFG.W, CFG.H);
    this.vignette(ctx, 0.7);
    if (final) {
      this.title(ctx, 'THE TYRANT FALLS', CFG.H * 0.24, 66);
      ctx.save();
      ctx.font = 'italic 400 26px Georgia'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe8c8';
      ctx.fillText('Varkhul is slain. The five realms are free.', CFG.W / 2, CFG.H * 0.24 + 62);
      ctx.fillText(`Final score: ✦ ${game.score}`, CFG.W / 2, CFG.H * 0.24 + 104);
      ctx.restore();
      this.button(ctx, 'quit', CFG.W / 2 - 150, CFG.H * 0.62, 300, 70, 'Return Home', { glow: '#ffd44f' });
    } else {
      this.title(ctx, 'STAGE CLEARED', CFG.H * 0.28, 62);
      ctx.save();
      ctx.font = '400 26px Georgia'; ctx.textAlign = 'center'; ctx.fillStyle = '#d8f0c8';
      ctx.fillText(`✦ ${game.score}`, CFG.W / 2, CFG.H * 0.28 + 60);
      ctx.restore();
      this.button(ctx, 'next', CFG.W / 2 - 150, CFG.H * 0.5, 300, 70, 'NEXT REALM →', { glow: '#8dff70' });
      this.button(ctx, 'quit', CFG.W / 2 - 150, CFG.H * 0.5 + 90, 300, 58, 'Realm Select', { size: 22 });
    }
  },
};
