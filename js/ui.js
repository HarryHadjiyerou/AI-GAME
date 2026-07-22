/* ============================================================
   Elfblade — UI: illustrated fantasy HUD + menu screens.
   Everything is drawn to canvas (no DOM widgets) with gold
   filigree panels so it matches the painterly art style.
   ============================================================ */

const UI = {
  bannerText: null, bannerSub: null, bannerT: 0,

  banner(text, sub, dur = 2.6) { this.bannerText = text; this.bannerSub = sub; this.bannerT = dur; },

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
    // portrait gem
    ctx.beginPath(); ctx.arc(64, 62, 34, 0, Math.PI * 2);
    const pg = ctx.createRadialGradient(56, 52, 4, 64, 62, 36);
    pg.addColorStop(0, '#9fd8a8'); pg.addColorStop(1, '#1e5a32');
    ctx.fillStyle = pg; ctx.fill();
    ctx.lineWidth = 3.5; ctx.strokeStyle = '#c9a24a'; ctx.stroke();
    ctx.fillStyle = '#0d2415';
    ctx.font = '900 30px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('❦', 64, 63);
    ctx.restore();
    this.ornateBar(ctx, 112, 34, 216, 20, Math.max(0, p.hp / CFG.PLAYER.hp), '#a01818', '#ff5c44', `${Math.ceil(p.hp)} / ${CFG.PLAYER.hp}`);
    const pf = p.power / CFG.PLAYER.powerMax;
    this.ornateBar(ctx, 112, 66, 216, 16, pf, '#155a8a', '#4fc0ff', pf >= 1 ? 'POWER READY!' : 'POWER');
    if (pf >= 1) {
      ctx.save();
      ctx.shadowColor = '#63ccff'; ctx.shadowBlur = 14 + Math.sin(performance.now() / 130) * 8;
      ctx.strokeStyle = 'rgba(120,210,255,0.9)'; ctx.lineWidth = 2;
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

    // pause + mute buttons
    this.button(ctx, 'pause', CFG.W - 106, 18, 40, 40, '❚❚', { size: 15 });
    this.button(ctx, 'mute', CFG.W - 58, 18, 40, 40, AudioMan.muted ? '✕' : '♪', { size: 19 });

    // touch controls (bottom corners)
    const bh = 86;
    this.button(ctx, 'jump', 24, CFG.H - bh - 20, 130, bh, 'JUMP ▲', { size: 24 });
    this.button(ctx, 'slide', 168, CFG.H - bh - 20, 120, bh, 'SLIDE ▼', { size: 22 });
    this.button(ctx, 'attack', CFG.W - 170, CFG.H - bh - 20, 146, bh, '⚔', { size: 44 });

    // special selector — appears only when the meter is full
    if (p.power >= CFG.PLAYER.powerMax) {
      const sy = CFG.H - bh - 130;
      this.button(ctx, 'special1', CFG.W - 316, sy, 140, 92, '🔵', { glow: '#55bbff', size: 34 });
      this.button(ctx, 'special2', CFG.W - 164, sy, 140, 92, '💥', { glow: '#ffb055', size: 34 });
      ctx.save();
      ctx.font = '700 15px Georgia'; ctx.textAlign = 'center'; ctx.fillStyle = '#cfe8ff';
      ctx.fillText('FORCE BOLT', CFG.W - 246, sy + 78);
      ctx.fillStyle = '#ffe0b8';
      ctx.fillText('RADIUS BLAST', CFG.W - 94, sy + 78);
      ctx.restore();
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
