/* ============================================================
   Elfblade — main game: state machine, level flow, camera,
   ground/gap/platform collision and the render loop.
   ============================================================ */

const Game = {
  state: 'loading',       // loading | title | select | play | pause | death | victory | finalVictory
  canvas: null, ctx: null,
  levelIdx: 0,
  player: null, enemies: [], obstacles: [], projectiles: [],
  dragon: null,
  bg: null, menuBg: null,
  camX: 0,
  speed: 0,
  score: 0,
  pending: [],            // level events not yet activated
  gaps: [],
  arenaMode: false,
  bossSpawned: false,
  checkpoint: false,      // died at the boss → retry from the boss gate
  winT: 0,
  save: { unlocked: 0, best: {} },
  _last: 0,
  ts: 1, tsT: 0,          // slow-motion time scale on big kills
  streak: 0, streakT: 0,  // kill streak
  _grain: null,

  /* ---------------- boot ---------------- */
  init() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this._resize();
    window.addEventListener('resize', () => this._resize());
    try { const s = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (s) this.save = s; } catch (e) {}
    Input.init(this.canvas, (a, x, y) => this.onAction(a, x, y));
    Assets.load().then(() => {
      this.menuBg = new LevelBackground('verdant');
      this.state = 'title';
    });
    requestAnimationFrame(t => this._frame(t));
  },

  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ww = window.innerWidth, wh = window.innerHeight;
    const scale = Math.min(ww / CFG.W, wh / CFG.H);
    this.canvas.style.width = CFG.W * scale + 'px';
    this.canvas.style.height = CFG.H * scale + 'px';
    this.canvas.width = CFG.W * dpr;
    this.canvas.height = CFG.H * dpr;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  _saveGame() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.save)); } catch (e) {} },

  /* ---------------- level lifecycle ---------------- */
  startLevel(idx, fromCheckpoint) {
    const lv = LEVELS[idx];
    this.levelIdx = idx;
    this.speed = lv.speed;
    this.bg = new LevelBackground(lv.theme);
    this.player = new Player();
    this.enemies = []; this.obstacles = []; this.projectiles = [];
    this.dragon = null;
    this.arenaMode = false;
    this.bossSpawned = false;
    this.winT = 0;
    if (!fromCheckpoint) { this.score = 0; this.checkpoint = false; }
    FX.reset();

    const startX = fromCheckpoint ? lv.length - 320 : 0;
    this.player.worldX = 300 + startX;
    this.camX = startX;

    this.pending = lv.events.filter(e => e.t !== 'gap' && e.x > startX);
    // gaps are clamped to a width a double jump always clears
    this.gaps = lv.events.filter(e => e.t === 'gap' && e.x > startX).map(e => ({ x: e.x, w: Math.min(e.w, 330) }));

    this.state = 'play';
    AudioMan.playMusic(lv.music);
    UI.banner(`Stage ${idx + 1} — ${lv.name}`, lv.sub);
    if (fromCheckpoint) setTimeout(() => { if (this.state === 'play') this._spawnBoss(); }, 600);
  },

  _spawnBoss() {
    if (this.bossSpawned) return;
    this.bossSpawned = true;
    this.arenaMode = true;
    this.checkpoint = true;
    const lv = LEVELS[this.levelIdx];
    if (lv.boss) {
      this.dragon = new Dragon(this.camX);
      UI.banner(CFG.DRAGON.name, '— FINAL BOSS —', 3.2);
      AudioMan.sfx('roar');
      FX.shake(10, 0.5);
    } else {
      const m = CFG.MINIBOSSES[lv.miniboss];
      const e = new Enemy(m.base, this.camX + CFG.W + 60, lv.miniboss);
      e.maxHp = e.hp;
      this.enemies.push(e);
      UI.banner(m.name, '— MINI-BOSS —', 2.8);
      AudioMan.sfx('roar');
      FX.shake(8, 0.4);
    }
  },

  slowMo(scale, dur) { this.ts = Math.min(this.ts, scale); this.tsT = Math.max(this.tsT, dur); },

  onKill(e) {
    this.score += e.mini ? 500 : e.def.score;
    this.player.gainPower(CFG.PLAYER.powerPerKill * (e.mini ? 2 : 1));
    // the payoff: time dips, camera bites in
    FX.zoomPunch(e.mini ? 2.2 : 1.2);
    this.slowMo(e.mini ? 0.25 : 0.45, e.mini ? 0.5 : 0.13);
    this.streak++;
    this.streakT = 2.2;
    if (this.streak >= 2)
      FX.dmgText(this.player.worldX + 40, this.player.y - 200, `${this.streak}× STREAK`, '#ffd44f', this.streak >= 4);
    if (e.mini) this.winT = 1.6;          // savour the kill, then victory
  },

  onPlayerDeath() { setTimeout(() => { if (this.player.state === 'dead') this.state = 'death'; }, 1400); },

  _winLevel() {
    const final = !!LEVELS[this.levelIdx].boss;
    this.save.unlocked = Math.max(this.save.unlocked, Math.min(4, this.levelIdx + 1));
    this.save.best[this.levelIdx] = Math.max(this.save.best[this.levelIdx] || 0, this.score);
    this._saveGame();
    AudioMan.sfx('win');
    AudioMan.stopMusic();
    this.state = final ? 'finalVictory' : 'victory';
  },

  /* ---------------- terrain queries ---------------- */
  overGap(x) { return this.gaps.some(g => x > g.x && x < g.x + g.w); },

  supportYAt(x, curY) {
    let best = Infinity;
    if (!this.overGap(x) && curY <= CFG.GROUND_Y + 50) best = CFG.GROUND_Y;
    for (const o of this.obstacles) {
      if (o.t !== 'platform' || o.dead) continue;
      const top = o.drawY !== undefined ? o.drawY : o.y;
      if (Math.abs(x - o.x) < o.w / 2 + 14 && curY <= top + 26) best = Math.min(best, top);
    }
    return best === Infinity ? CFG.H + 200 : best;
  },

  nextSolidGround(x) {
    for (const g of this.gaps) if (x >= g.x - 10 && x <= g.x + g.w + 10) return g.x + g.w + 30;
    return x;
  },

  get progress() {
    const lv = LEVELS[this.levelIdx];
    return Math.min(1, this.player ? (this.player.worldX - 300) / lv.length : 0);
  },

  /* ---------------- input routing ---------------- */
  onAction(a) {
    UI.press(a);                        // tactile flash on whichever button fired
    if (a === 'mute') { AudioMan.toggleMute(); return; }

    if (this.state === 'title') {
      if (a === 'play') { AudioMan.sfx('ui'); this.startLevel(Math.min(this.save.unlocked, 4)); }
      else if (a === 'levels') { AudioMan.sfx('ui'); this.state = 'select'; }
      return;
    }
    if (this.state === 'select') {
      if (a === 'back') { AudioMan.sfx('ui'); this.state = 'title'; }
      else if (a.startsWith('lvl')) { AudioMan.sfx('ui'); this.startLevel(parseInt(a.slice(3), 10)); }
      return;
    }
    if (this.state === 'play') {
      if (a === 'jump') this.player.jump();      // double-tap = double jump
      else if (a === 'slide') this.player.slide();
      else if (a === 'attack') this.player.attack(this);
      else if (a === 'special1') this._special('forceBolt');
      else if (a === 'special2') this._special('radiusBlast');
      else if (a === 'pause') { this.state = 'pause'; if (AudioMan.music) AudioMan.music.pause(); }
      return;
    }
    if (this.state === 'pause') {
      if (a === 'resume') { this.state = 'play'; if (AudioMan.music) AudioMan.music.play().catch(() => {}); }
      else if (a === 'retry') { AudioMan.sfx('ui'); this.startLevel(this.levelIdx, this.checkpoint); }
      else if (a === 'quit') { AudioMan.sfx('ui'); AudioMan.stopMusic(); this.state = 'select'; }
      return;
    }
    if (this.state === 'death') {
      if (a === 'retry') { AudioMan.sfx('ui'); this.startLevel(this.levelIdx, this.checkpoint); }
      else if (a === 'quit') { AudioMan.sfx('ui'); AudioMan.stopMusic(); this.state = 'select'; }
      return;
    }
    if (this.state === 'victory') {
      if (a === 'next') { AudioMan.sfx('ui'); this.startLevel(Math.min(4, this.levelIdx + 1)); }
      else if (a === 'quit') { AudioMan.sfx('ui'); this.state = 'select'; }
      return;
    }
    if (this.state === 'finalVictory') {
      if (a === 'quit') { AudioMan.sfx('ui'); this.state = 'title'; }
      return;
    }
  },

  _special(kind) {
    const p = this.player;
    if (p.power < CFG.PLAYER.powerMax || p.state === 'dead') return;
    p.power = 0;
    if (kind === 'forceBolt') {
      AudioMan.sfx('bolt');
      this.projectiles.push(new ForceBolt(p.worldX + 50, p.y - p.h * 0.55));
      FX.shake(7, 0.2);
      FX.screenFlash('#7ac0ff', 0.2);
    } else {
      AudioMan.sfx('blast');
      const R = CFG.SPECIALS.radiusBlast.radius;
      FX.ring(p.worldX, p.y - 60, '#ffca7a', R, 0.45, 30);
      FX.ring(p.worldX, p.y - 60, '#fff0c0', R * 0.7, 0.35, 18);
      FX.burst(p.worldX, p.y - 70, '#ffd970', 30, 620, 0.6);
      FX.screenFlash('#ffca7a', 0.35);
      FX.shake(13, 0.35);
      FX.stop(0.1);
      for (const e of this.enemies) {
        if (!e.dead && Math.abs(e.worldX - p.worldX) < R) e.hurt(CFG.SPECIALS.radiusBlast.damage, this, true);
      }
      for (const o of this.obstacles) {
        if (o.t === 'rock' && !o.dead && Math.abs(o.x - p.worldX) < R) o.hurt(999, this);
      }
      for (const pr of this.projectiles) if (pr.hostile && !pr.dead && Math.abs(pr.x - p.worldX) < R) pr.deflect ? pr.deflect() : (pr.dead = true);
      if (this.dragon && !this.dragon.dead && Math.abs(this.dragon.worldX - p.worldX) < R + 160)
        this.dragon.hurt(CFG.SPECIALS.radiusBlast.damage, this);
    }
  },

  /* ---------------- per-frame ---------------- */
  _frame(t) {
    requestAnimationFrame(tt => this._frame(tt));
    let dt = Math.min(0.033, (t - this._last) / 1000 || 0.016);
    this._last = t;
    Input.zones = [];
    const ctx = this.ctx;

    if (this.state === 'loading') {
      ctx.fillStyle = '#0b0910'; ctx.fillRect(0, 0, CFG.W, CFG.H);
      ctx.fillStyle = '#e8ddb8'; ctx.font = '28px Georgia'; ctx.textAlign = 'center';
      ctx.fillText('Sharpening the blade…', CFG.W / 2, CFG.H / 2);
      return;
    }

    if (this.state === 'title' || this.state === 'select') {
      this.menuBg.update(dt);
      if (this.state === 'title') UI.drawTitle(ctx, this, this.menuBg);
      else UI.drawLevelSelect(ctx, this, this.menuBg);
      return;
    }

    // gameplay states all render the world underneath
    if (this.state === 'play') {
      // slow-motion recovery
      if (this.tsT > 0) { this.tsT -= dt; if (this.tsT <= 0) this.ts = 1; }
      const sdt = dt * this.ts;
      if (FX.hitStop > 0) FX.hitStop -= dt;   // impact frames: world freezes, feels crunchy
      else this._update(sdt);
      FX.update(sdt);
      this.bg.update(sdt);
      if (this.streakT > 0) { this.streakT -= dt; if (this.streakT <= 0) this.streak = 0; }
    }
    this._render(ctx, dt);

    if (this.state === 'pause') UI.drawPause(ctx);
    else if (this.state === 'death') UI.drawDeath(ctx, this);
    else if (this.state === 'victory') UI.drawVictory(ctx, this, false);
    else if (this.state === 'finalVictory') UI.drawVictory(ctx, this, true);
  },

  _update(dt) {
    const lv = LEVELS[this.levelIdx];
    const p = this.player;

    p.update(dt, this);
    if (!this.arenaMode) this.camX = p.worldX - CFG.PLAYER.x;

    // activate pending events as they scroll into view
    const spawnEdge = this.camX + CFG.W + 240;
    this.pending = this.pending.filter(ev => {
      if (ev.x > spawnEdge) return true;
      if (ev.t === 'goblin' || ev.t === 'troll' || ev.t === 'hog') this.enemies.push(new Enemy(ev.t, ev.x));
      else if (ev.t !== 'gap') this.obstacles.push(new Obstacle(ev));
      return false;
    });

    // reaching the end of the gauntlet triggers the boss
    if (!this.bossSpawned && p.worldX - 300 >= lv.length) this._spawnBoss();

    for (const e of this.enemies) e.update(dt, this);
    this.enemies = this.enemies.filter(e => !(e.gone || (e.dead && e.deathT > 1.3) || e.worldX < this.camX - 500));
    for (const o of this.obstacles) o.update(dt, this);
    this.obstacles = this.obstacles.filter(o => !(o.dead && o.t !== 'platform') && o.x > this.camX - 400);
    for (const pr of this.projectiles) pr.update(dt, this);
    this.projectiles = this.projectiles.filter(pr => !pr.dead);
    if (this.dragon) {
      this.dragon.update(dt, this);
      if (this.dragon.dead && this.dragon.deathT > 3.2 && this.winT === 0) this.winT = 0.8;
    }

    if (this.winT > 0) {
      this.winT -= dt;
      if (this.winT <= 0) this._winLevel();
    }

    // distance score trickle
    if (!this.arenaMode) this.score += Math.round(dt * 10);
  },

  _render(ctx, dt) {
    const shk = FX.camOffset();
    ctx.save();
    // camera punch: zoom bites toward the action on heavy hits
    if (FX.punch > 0) {
      const z = 1 + FX.punch * 0.045;
      ctx.translate(CFG.W * 0.32, CFG.H * 0.62);
      ctx.scale(z, z);
      ctx.translate(-CFG.W * 0.32, -CFG.H * 0.62);
    }
    ctx.translate(shk.x, shk.y);
    const camX = this.camX;

    this.bg.draw(ctx, camX);

    // ground with gaps
    const x0 = camX - 60, x1 = camX + CFG.W + 60;
    let segs = [[x0, x1]];
    for (const g of this.gaps) {
      const out = [];
      for (const [a, b] of segs) {
        if (g.x > b || g.x + g.w < a) { out.push([a, b]); continue; }
        if (g.x > a) out.push([a, g.x]);
        if (g.x + g.w < b) out.push([g.x + g.w, b]);
      }
      segs = out;
    }
    for (const [a, b] of segs) this.bg.drawGroundSlice(ctx, a - camX, b - a, this.bg.t);

    for (const o of this.obstacles) o.draw(ctx, camX, this.bg.theme);
    for (const e of this.enemies) e.draw(ctx, camX);
    if (this.dragon) this.dragon.draw(ctx, camX);
    this.player.draw(ctx, camX);
    for (const pr of this.projectiles) pr.draw(ctx, camX);
    FX.draw(ctx, camX);
    ctx.restore();

    FX.drawFlash(ctx);
    // subtle film grain kills the "flat vector" look
    if (!this._grain) {
      const g = document.createElement('canvas');
      g.width = 160; g.height = 160;
      const gc = g.getContext('2d');
      const id = gc.createImageData(160, 160);
      for (let i = 0; i < id.data.length; i += 4) {
        const v = 100 + Math.random() * 90 | 0;
        id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
        id.data[i + 3] = 255;
      }
      gc.putImageData(id, 0, 0);
      this._grain = ctx.createPattern(g, 'repeat');
    }
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = this._grain;
    ctx.fillRect(0, 0, CFG.W, CFG.H);
    ctx.restore();
    UI.vignette(ctx, this.bg.theme === 'hell' ? 0.55 : 0.3);
    if (this.state === 'play' || this.state === 'pause') UI.drawHUD(ctx, this);
    UI.drawBanner(ctx, dt);
  },
};

window.addEventListener('DOMContentLoaded', () => Game.init());
