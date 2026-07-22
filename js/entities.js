/* ============================================================
   Elfblade — entities: player, enemies, mini-bosses, dragon
   boss, obstacles, pickups and special-attack projectiles.
   Coordinates: worldX = horizontal world position (center),
   y = feet position (CFG.GROUND_Y when standing on ground).
   ============================================================ */

/* draw a sprite image centred at (x, y-bottom anchored), height h, optional flip/rot */
function drawSprite(ctx, img, x, footY, h, opts = {}) {
  const iw = img.width || 100, ih = img.height || 140;
  const scale = h / ih, w = iw * scale;
  ctx.save();
  ctx.translate(x, footY);
  if (opts.rot) ctx.rotate(opts.rot);
  if (opts.flip) ctx.scale(-1, 1);
  if (opts.sq) ctx.scale(opts.sq.x, opts.sq.y);
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  if (opts.tint) { ctx.shadowColor = opts.tint; ctx.shadowBlur = 26; }
  ctx.drawImage(img, -w / 2, -h, w, h);
  if (opts.tint) { ctx.globalCompositeOperation = 'source-atop'; }
  ctx.restore();
}

/* ============================ PLAYER ============================ */
class Player {
  constructor() {
    this.worldX = 0;
    this.y = CFG.GROUND_Y;
    this.vy = 0;
    this.grounded = true;
    this.hp = CFG.PLAYER.hp;
    this.power = 0;
    this.h = 128;
    this.state = 'run';            // run | jump | slide | dead
    this.slideT = 0;
    this.attackT = 0;              // >0 while a swing is playing
    this.attackCd = 0;
    this.combo = 0;
    this.comboT = 0;
    this.invuln = 0;
    this.runT = 0;
    this.squash = { x: 1, y: 1 };
    this.onPlatform = null;
    this.jumpsLeft = 1;            // air jumps remaining (double jump)
    this.coyote = 0;               // grace time after leaving an edge
    this.bufJump = 0;              // buffered inputs
    this.bufAtk = 0;
    this.spinT = 0;                // double-jump flip animation
    this.lungeT = 0;               // forward step during a swing
    this.face = 1;                 // 1 = right, -1 = left
    this.vx = 0;                   // free horizontal movement
    this.attackHeld = false;       // hold attack to charge a heavy strike
    this.heavyT = 0;               // charge progress
    this.attackDur = 0.24;         // current swing duration
    this.heavy = false;            // current swing is a heavy
  }

  get hitTop() { return this.state === 'slide' ? this.y - 52 : this.y - this.h * 0.92; }
  get swordX() { return this.worldX + 60 * this.face; }
  get swordY() { return this.y - this.h * 0.55; }

  jump() {
    if (this.state === 'dead') return;
    if (this.grounded || this.coyote > 0) {
      this.vy = CFG.JUMP_VEL;
      this.grounded = false;
      this.coyote = 0;
      this.onPlatform = null;
      this.jumpsLeft = 1;
      this.state = 'jump';
      this.squash = { x: 0.82, y: 1.2 };
      AudioMan.sfx('jump');
      FX.puff(this.worldX, this.y, 'rgba(210,210,190,0.6)', 5);
    } else if (this.jumpsLeft > 0) {
      // double jump — flip with a burst of wind
      this.jumpsLeft--;
      this.vy = CFG.JUMP_VEL * 0.94;
      this.spinT = 0.4;
      this.state = 'jump';
      AudioMan.sfx('jump');
      FX.ring(this.worldX, this.y - 40, 'rgba(220,240,255,0.9)', 70, 0.28, 10);
      FX.puff(this.worldX, this.y - 30, 'rgba(230,240,250,0.5)', 6, 140);
    } else {
      this.bufJump = CFG.INPUT_BUFFER;   // queue it — fires the moment we land
    }
  }

  slide() {
    if (this.state === 'dead' || !this.grounded) return;
    this.state = 'slide';
    this.slideT = CFG.SLIDE_TIME;
    this.squash = { x: 1.25, y: 0.7 };
    AudioMan.sfx('slide');
    FX.puff(this.worldX + 20, this.y, 'rgba(210,210,190,0.5)', 6);
  }

  /* attack input: press = instant light slash; keep holding to charge,
     and a heavy strike unleashes itself when the charge completes */
  attackDown(game) {
    if (this.state === 'dead') return;
    this.attackHeld = true;
    this.heavyT = 0;
    this._swing(game, false);
  }
  attackUp() { this.attackHeld = false; this.heavyT = 0; }
  attack(game) { this._swing(game, false); }     // kept for buffered inputs

  _swing(game, heavy) {
    if (this.state === 'dead') return;
    if (this.attackCd > 0) { if (!heavy) this.bufAtk = CFG.INPUT_BUFFER; return; }
    const P = CFG.PLAYER;
    this.heavy = heavy;
    if (heavy) {
      this.combo = 2;
      this.attackDur = 0.34;                     // slower, bigger
      this.attackCd = 0.55;
    } else {
      this.combo = (this.comboT > 0) ? (this.combo + 1) % 3 : 0;
      if (this.combo === 2) this.combo = 0;      // the roundhouse now belongs to heavies
      this.attackDur = 0.24;
      this.attackCd = P.attackCooldown;
    }
    this.comboT = P.comboWindow;
    this.attackT = this.attackDur;
    this.lungeT = heavy ? 0.2 : 0.14;            // step INTO the blow
    const up = !heavy && this.combo === 1;
    AudioMan.sfx(heavy ? 'heavy' : up ? 'swing2' : 'swing');

    // slash visual — light burns red-gold, heavy burns blue
    const trailCol = heavy ? '#6ec8ff' : '#ffb060';
    FX.slash(this.worldX + 24 * this.face, this.swordY, up ? -0.7 : -2.4, heavy ? 195 : 136, up, trailCol, this.face);
    if (heavy) {
      FX.ring(this.worldX + 40 * this.face, this.swordY, '#9fdcff', 170, 0.32, 18);
      FX.screenFlash('#8fd4ff', 0.18);
    }

    const range = heavy ? P.heavyRange : P.attackRange;
    const dmg = P.attackDamage * (heavy ? P.heavyDamageMult : 1);
    const sparkCol = heavy ? '#6ec8ff' : '#ff5a2e';       // red flames / blue flames
    const sparkCol2 = heavy ? '#c8ecff' : '#ffb02e';
    let hitSomething = false;

    const inArc = (wx, wy, extraW = 0, yTolUp = 220, yTolDown = 150) => {
      const dx = (wx - this.worldX) * this.face;
      return dx > -46 && dx < range + extraW && (this.y - wy < yTolDown && wy - this.y < yTolUp);
    };

    for (const e of game.enemies) {
      if (e.dead) continue;
      if (inArc(e.worldX, e.y, e.def.w * 0.4)) {
        e.hurt(dmg, game, heavy, sparkCol, sparkCol2);
        hitSomething = true;
      }
    }
    for (const o of game.obstacles) {
      if (o.t === 'rock' && !o.dead && inArc(o.x, CFG.GROUND_Y, 50)) { o.hurt(dmg, game); hitSomething = true; }
    }
    // deflect dragon fireballs with a well-timed swing
    for (const p of game.projectiles) {
      if (p.hostile && !p.dead && Math.abs(p.x - this.swordX) < range && Math.abs(p.y - this.swordY) < 140) {
        p.deflect();
        hitSomething = true;
      }
    }
    if (game.dragon && !game.dragon.dead) {
      const d = game.dragon;
      if (Math.abs(d.headX - this.worldX) < range + 80 && d.headY > this.y - 280) {
        d.hurt(dmg, game);
        hitSomething = true;
      }
    }

    if (hitSomething) {
      FX.stop(heavy ? 0.15 : 0.06);         // impact frames
      FX.shake(heavy ? 16 : 7, heavy ? 0.26 : 0.18);
      FX.zoomPunch(heavy ? 2.2 : 0.7);      // camera bites into the hit
      if (heavy) game.slowMo(0.4, 0.16);
      this.gainPower(P.powerPerHit * (heavy ? 1.6 : 1));
    } else {
      FX.shake(heavy ? 4 : 1.5, 0.06);      // even a whiff moves air
    }
  }

  gainPower(n) {
    const was = this.power;
    this.power = Math.min(CFG.PLAYER.powerMax, this.power + n);
    if (was < CFG.PLAYER.powerMax && this.power >= CFG.PLAYER.powerMax) AudioMan.sfx('powerReady');
  }

  takeDamage(n, game, src) {
    if (this.invuln > 0 || this.state === 'dead') return;
    this.hp -= n;
    this.invuln = CFG.PLAYER.invulnAfterHit;
    FX.shake(11, 0.3);
    FX.stop(0.06);
    FX.screenFlash('#ff2a2a', 0.35);
    FX.burst(this.worldX, this.y - 70, '#ff5949', 14, 380);
    FX.dmgText(this.worldX, this.y - this.h - 14, '-' + Math.round(n), '#ff6a5a');
    AudioMan.sfx('hurt');
    if (this.hp <= 0) { this.hp = 0; this.die(game); }
  }

  die(game) {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.vy = -700;
    this.grounded = false;
    AudioMan.sfx('lose');
    AudioMan.duckMusic(0.25, 2400);
    game.onPlayerDeath();
  }

  update(dt, game) {
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.attackT > 0) this.attackT -= dt;
    if (this.comboT > 0) this.comboT -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.coyote > 0) this.coyote -= dt;
    if (this.spinT > 0) this.spinT -= dt;
    if (this.bufJump > 0) this.bufJump -= dt;
    if (this.bufAtk > 0) this.bufAtk -= dt;
    this.squash.x += (1 - this.squash.x) * dt * 10;
    this.squash.y += (1 - this.squash.y) * dt * 10;

    if (this.state === 'dead') {
      this.vy += CFG.GRAVITY * dt;
      this.y += this.vy * dt;
      return;
    }

    // consume buffered inputs the moment they become legal
    if (this.bufJump > 0 && (this.grounded || this.coyote > 0 || this.jumpsLeft > 0)) { this.bufJump = 0; this.jump(); }
    if (this.bufAtk > 0 && this.attackCd <= 0) { this.bufAtk = 0; this.attack(game); }

    // free movement — the level scrolls, but the hero is yours to steer
    const dir = Input.moveDir();
    const targetVx = dir * CFG.PLAYER.moveSpeed * (this.state === 'slide' ? 0.8 : 1);
    this.vx += (targetVx - this.vx) * Math.min(1, dt * 12);
    if (dir !== 0) this.face = dir > 0 ? 1 : -1;
    this.worldX += this.vx * dt;

    // heavy charge: keep the button held and the big one unleashes itself
    if (this.attackHeld && this.state !== 'dead') {
      this.heavyT += dt;
      if (this.heavyT >= CFG.PLAYER.heavyChargeTime && this.attackCd <= 0) {
        this._swing(game, true);
        this.heavyT = -0.45;               // brief rest before the next heavy
      }
    }

    // attack lunge adds a step of weight in the facing direction
    if (this.lungeT > 0) {
      this.lungeT -= dt;
      this.worldX += 300 * dt * this.face;
    }

    // stay inside the camera frame
    this.worldX = Math.max(game.camX + 46, Math.min(game.camX + CFG.W - 80, this.worldX));

    this.runT += dt * Math.abs(this.vx) / 300;

    // slide timer
    if (this.state === 'slide') {
      this.slideT -= dt;
      if (this.slideT <= 0) this.state = this.grounded ? 'run' : 'jump';
      FX.puff(this.worldX - 30, this.y, 'rgba(200,200,185,0.35)', 1, 60);
    }

    // gravity & landing — floaty rise, heavy fall
    const support = game.supportYAt(this.worldX, this.y);
    if (!this.grounded) {
      this.vy += (this.vy < 0 ? CFG.GRAVITY_UP : CFG.GRAVITY_DOWN) * dt;
      this.vy = Math.min(this.vy, 1650);
      this.y += this.vy * dt;
      if (this.vy > 0 && this.y >= support - 2 && support < CFG.H + 60) {
        this.y = support;
        this.vy = 0;
        this.grounded = true;
        this.jumpsLeft = 1;
        this.spinT = 0;
        if (this.state === 'jump') this.state = 'run';
        this.squash = { x: 1.24, y: 0.78 };
        AudioMan.sfx('land');
        FX.puff(this.worldX, this.y, 'rgba(210,210,190,0.6)', 7);
      }
    } else {
      // walked off an edge (gap or platform end) — coyote grace kicks in
      if (support > this.y + 4) { this.grounded = false; this.vy = 0; this.state = 'jump'; this.coyote = CFG.COYOTE; }
      else this.y = support;
    }

    // fell into a gap
    if (this.y > CFG.H + 80) {
      this.takeDamage(15, game, 'fall');
      if (this.state !== 'dead') {
        this.worldX = game.nextSolidGround(this.worldX) + 40;
        this.y = CFG.GROUND_Y;
        this.vy = 0; this.grounded = true; this.state = 'run';
        this.invuln = Math.max(this.invuln, 1.2);
      }
    }

    // run dust
    if (this.grounded && this.state === 'run' && Math.random() < dt * 9) {
      FX.puff(this.worldX - 34, this.y, 'rgba(205,205,190,0.4)', 1, 80);
    }
  }

  draw(ctx, camX) {
    const x = this.worldX - camX;
    // warm rim-light so the hero reads clearly on dark stages
    const th = Game.bg && Game.bg.theme;
    if (th === 'night' || th === 'storm' || th === 'hell') {
      const g = ctx.createRadialGradient(x, this.y - 66, 8, x, this.y - 66, 120);
      g.addColorStop(0, 'rgba(255,224,150,0.30)');
      g.addColorStop(1, 'rgba(255,224,150,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, this.y - 66, 120, 0, Math.PI * 2); ctx.fill();
    }
    // contact shadow (fades with altitude — sells the jump arc)
    if (this.state !== 'dead') {
      const alt = Math.max(0, CFG.GROUND_Y - this.y);
      ctx.save();
      ctx.globalAlpha = Math.max(0.06, 0.28 - alt / 900);
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(x, CFG.GROUND_Y + 6, Math.max(16, 34 - alt * 0.05), 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (this.invuln > 0 && Math.floor(this.invuln * 14) % 2 === 0 && this.state !== 'dead') ctx.globalAlpha = 0.45;

    ctx.save();
    ctx.translate(x, this.y);
    ctx.scale(this.face, 1);               // face the way we're moving
    paintElf(ctx, {
      runT: this.runT,
      time: performance.now() / 1000,
      speedK: 1 + Math.abs(this.vx) / 600,
      moving: Math.abs(this.vx) > 50,
      state: this.state,
      grounded: this.grounded,
      vy: this.vy,
      attackT: this.attackT,
      attackDur: this.attackDur,
      heavy: this.heavy,
      charge: this.attackHeld ? Math.min(1, Math.max(0, this.heavyT / CFG.PLAYER.heavyChargeTime)) : 0,
      combo: this.combo,
      spinT: this.spinT,
      squash: this.squash,
    });
    ctx.restore();

    ctx.globalAlpha = 1;
  }
}

/* ============================ ENEMIES ============================ */
class Enemy {
  constructor(type, worldX, mini, tier) {
    this.type = type;
    this.def = { ...CFG.ENEMIES[type] };
    this.mini = mini || null;                 // miniboss config
    this.scale = 1;
    if (mini) {
      const m = CFG.MINIBOSSES[mini];
      this.scale = m.scale;
      this.def.hp = m.hp; this.def.dmg = m.dmg;
      this.tint = m.tint; this.name = m.name;
    }
    this.tier = tier || 0;                    // which storey this enemy fights on
    this.face = -1;                           // -1 = facing left (toward start)
    this.worldX = worldX;
    this.y = CFG.TIERS[this.tier];
    this.baseY = this.y;
    this.hp = this.def.hp;
    this.maxHp = this.def.hp;
    this.dead = false;
    this.state = 'walk';           // walk | windup | strike | charge | dying
    this.stateT = 0;
    this.attackCd = 0;
    this.flash = 0;
    this.t = Math.random() * 10;
    this.vx = 0; this.vy = 0; this.rot = 0;
    this.deathT = 0;
    this.knock = 0;
  }

  get h() { return this.def.h * this.scale; }
  get w() { return this.def.w * this.scale; }

  hurt(dmg, game, big, sparkCol, sparkCol2) {
    if (this.dead) return;
    this.hp -= dmg;
    this.flash = 0.12;
    this.hitSquash = 1;                        // visible crunch on the body
    const kdir = game.player ? Math.sign(this.worldX - game.player.worldX) || 1 : 1;
    this.knock = (big ? 260 : 160) * kdir;
    const sparkY = this.y - this.h * 0.55;
    const ichor = this.type === 'goblin' ? '#8fce5a' : this.type === 'troll' ? '#9fb36a' : '#5c5c68';
    // flame sparks: red for light hits, blue for heavies (per art direction)
    FX.spray(this.worldX - this.w * 0.3 * kdir, sparkY, kdir > 0 ? -0.5 : Math.PI + 0.5, 1.6, sparkCol || '#ff5a2e', big ? 24 : 13);
    FX.spray(this.worldX, sparkY, kdir > 0 ? -0.9 : Math.PI + 0.9, 2.2, sparkCol2 || '#ffb02e', big ? 16 : 9, 420);
    FX.burst(this.worldX, sparkY, ichor, 6, 300, 0.4);
    FX.dmgText(this.worldX, this.y - this.h - 10, Math.round(dmg), big ? '#8fd4ff' : '#fff1c9', big);
    AudioMan.sfx(this.type === 'hog' ? 'clang' : 'hit');
    if (this.hp <= 0) this.die(game);
  }

  die(game) {
    this.dead = true;
    this.state = 'dying';
    const kdir = game.player ? Math.sign(this.worldX - game.player.worldX) || 1 : 1;
    this.vx = (340 + Math.random() * 220) * kdir;
    this.vy = -620 - Math.random() * 240;
    this.rot = 0;
    AudioMan.sfx('kill');
    FX.stop(this.mini ? 0.16 : 0.09);
    FX.shake(this.mini ? 16 : 9, 0.28);
    const ichor = this.type === 'goblin' ? '#8fce5a' : this.type === 'troll' ? '#9fb36a' : '#5c5c68';
    FX.burst(this.worldX, this.y - this.h * 0.5, '#ffd970', this.mini ? 34 : 16, 520, 0.6);
    FX.burst(this.worldX, this.y - this.h * 0.5, ichor, this.mini ? 22 : 12, 460, 0.7);
    FX.ring(this.worldX, this.y - this.h * 0.5, '#fff2c8', this.mini ? 200 : 120, 0.3, 14);
    game.onKill(this);
  }

  update(dt, game) {
    this.t += dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.hitSquash > 0) this.hitSquash = Math.max(0, this.hitSquash - dt * 7);

    if (this.dead) {
      this.deathT += dt;
      this.worldX += this.vx * dt;
      this.vy += CFG.GRAVITY * 0.8 * dt;
      this.y += this.vy * dt;
      this.rot += 4.5 * dt;
      return;
    }

    if (this.knock !== 0) {
      this.worldX += this.knock * dt * 3;
      const s = Math.sign(this.knock);
      this.knock -= s * dt * 600;
      if (Math.sign(this.knock) !== s) this.knock = 0;
    }

    const p = game.player;
    const dist = this.worldX - p.worldX;               // signed; + = enemy to the right
    const adist = Math.abs(dist);
    const dir = -Math.sign(dist) || -1;                // direction toward the player
    const sameTier = Math.abs(this.y - p.y) < 90;
    if (this.state !== 'charge') this.face = dir;
    if (this.attackCd > 0) this.attackCd -= dt;

    // step toward the player, respecting ledge edges and crevices
    const stepToward = (v) => {
      const nx = this.worldX + dir * v * dt;
      if (this.tier > 0) {
        if (this.ledge && (nx < this.ledge.x0 || nx > this.ledge.x1)) return;   // hold the ledge
      } else if (game.overGap(nx)) return;                                       // don't walk into pits
      this.worldX = nx;
    };

    if (this.type === 'hog') {
      /* hog: telegraphed charge toward wherever you are */
      if (this.state === 'walk') {
        if (adist > 120) stepToward(this.def.speed);
        if (adist < 660 && adist > 180 && sameTier && this.attackCd <= 0) { this.state = 'windup'; this.stateT = this.def.windup; this.chargeDir = dir; }
      } else if (this.state === 'windup') {
        this.stateT -= dt;
        this.chargeDir = dir;                            // tracks you until it commits
        if (Math.random() < dt * 22) FX.puff(this.worldX - 30 * this.chargeDir, this.y, 'rgba(200,190,180,0.7)', 2, 140);
        if (this.stateT <= 0) { this.state = 'charge'; this.face = this.chargeDir; AudioMan.sfx('roar'); }
      } else if (this.state === 'charge') {
        this.worldX += this.chargeDir * this.def.chargeSpeed * this.scale * dt;
        if (Math.random() < dt * 30) FX.puff(this.worldX - this.w * 0.5 * this.chargeDir, this.y, 'rgba(200,190,180,0.6)', 2, 160);
        // contact damage while charging
        if (adist < this.w * 0.5 + 30 && sameTier && p.y > this.y - this.h - 10) p.takeDamage(this.def.dmg, game, this);
        if (Math.abs(this.worldX - p.worldX) > 780 || game.overGap(this.worldX)) {
          if (this.mini) { this.state = 'walk'; this.attackCd = 1.0; this.worldX = game.nextSolidGround(this.worldX); }
          else if (this.worldX < game.camX - 200 || this.worldX > game.camX + CFG.W + 200) this.gone = true;
          else { this.state = 'walk'; this.attackCd = this.def.attackCd; }
        }
      }
    } else {
      /* goblin / troll: approach + telegraphed melee strike */
      if (this.state === 'walk') {
        if (adist > this.def.attackRange * this.scale) stepToward(this.def.speed);
        if (adist <= this.def.attackRange * this.scale + 24 && sameTier && this.attackCd <= 0) { this.state = 'windup'; this.stateT = this.def.windup; }
      } else if (this.state === 'windup') {
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.state = 'strike'; this.stateT = 0.18;
          // the blow itself has presence, whether it lands or not
          if (this.type === 'troll') {
            FX.shake(6, 0.2);
            FX.puff(this.worldX - this.w * 0.5, CFG.GROUND_Y, 'rgba(160,140,110,0.7)', 8, 200);
            AudioMan.sfx('land');
          }
          if (Math.abs(this.worldX - p.worldX) < this.def.attackRange * this.scale + 40 && Math.abs(this.y - p.y) < 90 && p.grounded && p.state !== 'slide')
            p.takeDamage(this.def.dmg, game, this);
          else if (Math.abs(this.worldX - p.worldX) < this.def.attackRange * this.scale + 40 && Math.abs(this.y - p.y) < 90)
            FX.dmgText(p.worldX, p.y - 160, 'DODGED!', '#9fe8ff');
        }
      } else if (this.state === 'strike') {
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'walk'; this.attackCd = this.def.attackCd; }
      }
    }
  }

  draw(ctx, camX) {
    const x = this.worldX - camX;
    if (x < -300 || x > CFG.W + 400) return;

    // miniboss aura
    if (this.mini && !this.dead) {
      const g = ctx.createRadialGradient(x, this.y - this.h * 0.45, 10, x, this.y - this.h * 0.45, this.h * 0.8);
      g.addColorStop(0, this.tint + '44'); g.addColorStop(1, this.tint + '00');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, this.y - this.h * 0.45, this.h * 0.8, 0, Math.PI * 2); ctx.fill();
    }

    // contact shadow grounds the character on its own storey
    if (!this.dead) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(x, this.baseY + 6, this.w * 0.42, 7 * this.scale, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(x, this.y);
    if (this.dead) { ctx.rotate(this.rot); ctx.globalAlpha = Math.max(0, 1 - this.deathT * 1.4); }
    // painters face left natively; flip when the prey is on the other side
    ctx.scale(this.scale * (this.face > 0 ? -1 : 1), this.scale);
    CHARACTER_PAINTERS[this.type](ctx, this);
    ctx.restore();

    // white hit-flash: hot glow at the point of impact
    if (this.flash > 0 && !this.dead) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const fa = this.flash / 0.12;
      const g = ctx.createRadialGradient(x, this.y - this.h * 0.5, 4, x, this.y - this.h * 0.5, this.h * 0.55);
      g.addColorStop(0, `rgba(255,246,220,${fa * 0.85})`);
      g.addColorStop(1, 'rgba(255,246,220,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, this.y - this.h * 0.5, this.h * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // windup exclamation for the hog charge
    if (this.state === 'windup' && this.type === 'hog') {
      ctx.save();
      ctx.font = '900 44px Georgia';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5a3a';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 6;
      const yy = this.y - this.h - 26 + Math.sin(this.t * 20) * 4;
      ctx.strokeText('!', x, yy); ctx.fillText('!', x, yy);
      ctx.restore();
    }

    // health bar
    if (!this.dead && this.hp < this.maxHp) {
      const bw = Math.max(64, this.w * 0.8), bx = x - bw / 2, by = this.y - this.h - 18;
      ctx.fillStyle = 'rgba(10,5,5,0.75)';
      ctx.beginPath(); ctx.roundRect(bx - 2, by - 2, bw + 4, 10, 5); ctx.fill();
      const g = ctx.createLinearGradient(bx, by, bx, by + 6);
      g.addColorStop(0, '#ff7a5c'); g.addColorStop(1, '#c92c1d');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(bx, by, bw * Math.max(0, this.hp / this.maxHp), 6, 3); ctx.fill();
    }
  }
}

/* ============================ DRAGON BOSS ============================ */
class Dragon {
  constructor(arenaX) {
    this.arenaX = arenaX;              // left edge of the arena (camX during fight)
    this.worldX = arenaX + CFG.W * 0.72;
    this.y = 330;                      // body center-ish (feet anchor for drawSprite)
    this.hp = CFG.DRAGON.hp;
    this.maxHp = CFG.DRAGON.hp;
    this.dead = false;
    this.t = 0;
    this.flap = 0;
    this.state = 'intro';              // intro | hover | swoop | land | fireballs | breath | meteor | vulnerable | dying
    this.stateT = 2.2;
    this.flash = 0;
    this.homeX = this.worldX;
    this.homeY = 330;
    this.vx = 0; this.vy = 0;
    this.breathOn = false;
    this.deathT = 0;
    this.introRoared = false;
  }

  get phase() { return this.hp > this.maxHp * 0.66 ? 1 : this.hp > this.maxHp * 0.33 ? 2 : 3; }
  get headX() { return this.worldX - 150; }
  get headY() { return this.y - 120; }
  get grounded() { return this.state === 'land' || this.state === 'vulnerable' || this.state === 'breath' || this.state === 'fireballs'; }

  hurt(dmg, game) {
    if (this.dead || this.state === 'intro') return;
    // airborne dragon takes reduced damage; grounded windows are the real openings
    const mult = this.grounded ? 1 : 0.35;
    this.hp -= dmg * mult;
    this.flash = 0.12;
    FX.spray(this.headX, this.headY, -0.6, 1.5, '#ffd970', 12);
    FX.dmgText(this.headX, this.headY - 60, Math.round(dmg * mult), this.grounded ? '#ffd44f' : '#c8c8c8', this.grounded);
    AudioMan.sfx('hit');
    if (this.hp <= 0) this.die(game);
  }

  die(game) {
    this.dead = true;
    this.state = 'dying';
    this.stateT = 3.2;
    this.breathOn = false;
    game.score += 2500;
    AudioMan.sfx('roar');
    AudioMan.duckMusic(0.2, 3000);
    FX.stop(0.25);
    FX.shake(22, 1.2);
    FX.screenFlash('#ffca7a', 0.5);
  }

  _enter(s, t) { this.state = s; this.stateT = t; }

  update(dt, game) {
    this.t += dt;
    this.flap += dt * (this.grounded ? 2.2 : (this.phase === 3 ? 9 : 6.5));
    if (this.flash > 0) this.flash -= dt;
    const p = game.player;
    const speedMul = this.phase === 3 ? 1.35 : this.phase === 2 ? 1.15 : 1;
    this.stateT -= dt * (this.state === 'intro' || this.state === 'dying' ? 1 : speedMul);

    if (this.dead) {
      this.deathT += dt;
      this.y += 60 * dt;
      if (Math.random() < dt * 20) {
        FX.burst(this.worldX + (Math.random() - .5) * 260, this.y - Math.random() * 260, '#ff9040', 6, 420, 0.7);
        FX.shake(6, 0.1);
      }
      return;
    }

    switch (this.state) {
      case 'intro':
        if (!this.introRoared && this.stateT < 1.6) { this.introRoared = true; AudioMan.sfx('roar'); FX.shake(16, 0.7); }
        this.y = this.homeY + Math.sin(this.t * 2) * 24;
        if (this.stateT <= 0) this._enter('hover', 1.6);
        break;

      case 'hover': {
        this.worldX += (this.homeX - this.worldX) * dt * 2.4;
        this.y += (this.homeY + Math.sin(this.t * 2) * 26 - this.y) * dt * 3;
        if (this.stateT <= 0) {
          // pick the next attack based on phase
          const roll = Math.random();
          if (this.phase === 1) this._start(roll < 0.55 ? 'swoop' : 'fireballs');
          else if (this.phase === 2) this._start(roll < 0.4 ? 'swoop' : roll < 0.7 ? 'breath' : 'fireballs');
          else this._start(roll < 0.3 ? 'swoop' : roll < 0.55 ? 'breath' : roll < 0.8 ? 'meteor' : 'fireballs');
        }
        break;
      }

      case 'swoop':
        // dive across the ground — jump over it
        this.vx += -2600 * dt;
        this.worldX += this.vx * dt;
        this.y += (CFG.GROUND_Y - 46 - this.y) * dt * 6;
        if (Math.random() < dt * 26) FX.puff(this.worldX + 130, this.y, 'rgba(120,60,40,0.5)', 2, 180);
        if (Math.abs(this.worldX - p.worldX) < 140 && p.y > CFG.GROUND_Y - 120) p.takeDamage(CFG.DRAGON.lungeDmg, game, this);
        if (this.worldX < this.arenaX - 260) {
          this.worldX = this.arenaX - 260;
          this._enter('rise', 1.0);
          this.vx = 0;
        }
        break;

      case 'rise':
        // climb back to the hover perch on the right
        this.worldX += (this.homeX - this.worldX) * dt * 2.2;
        this.y += (this.homeY - this.y) * dt * 2.6;
        if (this.stateT <= 0) this._enter(this.phase >= 2 && Math.random() < 0.5 ? 'hover' : 'land', 0.7);
        break;

      case 'land':
        this.y += (CFG.GROUND_Y - this.y) * dt * 7;
        this.worldX += (this.arenaX + CFG.W * 0.62 - this.worldX) * dt * 5;
        if (this.stateT <= 0) {
          this.y = CFG.GROUND_Y;
          FX.shake(12, 0.3); AudioMan.sfx('land');
          FX.puff(this.worldX, this.y, 'rgba(140,80,50,0.7)', 12, 220);
          this._enter('fireballs', 0.4);
        }
        break;

      case 'fireballs': {
        this.y = CFG.GROUND_Y;
        if (this.stateT <= 0 && !this._fired) {
          const n = this.phase === 3 ? 3 : 2;
          for (let i = 0; i < n; i++) {
            setTimeout(() => {
              if (this.dead || Game.state !== 'play') return;
              AudioMan.sfx('fire');
              Game.projectiles.push(new Fireball(this.headX, this.headY, p.worldX));
            }, i * (this.phase === 3 ? 380 : 520));
          }
          this._fired = true;
          this.stateT = (this.phase === 3 ? 1.5 : 1.8);
        } else if (this._fired && this.stateT <= 0) {
          this._fired = false;
          this._enter('vulnerable', this.phase === 3 ? 2.0 : 2.8);
          FX.dmgText(this.headX, this.headY - 90, 'STRIKE NOW!', '#7fe86a', true);
        }
        break;
      }

      case 'breath': {
        // grounded flame-thrower along the ground — slide under it
        this.y = CFG.GROUND_Y;
        this.worldX += (this.arenaX + CFG.W * 0.6 - this.worldX) * dt * 4;
        if (!this.breathOn && this.stateT < 1.6) { this.breathOn = true; AudioMan.sfx('fire'); }
        if (this.breathOn) {
          this._breathParticles(game);
          const bx0 = this.headX - 620, bx1 = this.headX - 40;
          if (p.worldX > bx0 && p.worldX < bx1 && p.state !== 'slide' && p.y > CFG.GROUND_Y - 140)
            p.takeDamage(CFG.DRAGON.fireDmg * dt * 4, game, this, true);
        }
        if (this.stateT <= 0) { this.breathOn = false; this._enter('vulnerable', this.phase === 3 ? 1.6 : 2.4); FX.dmgText(this.headX, this.headY - 90, 'STRIKE NOW!', '#7fe86a', true); }
        break;
      }

      case 'meteor': {
        this.y += (this.homeY - 60 - this.y) * dt * 3;
        if (!this._meteors) {
          this._meteors = true;
          AudioMan.sfx('roar');
          const n = 4;
          for (let i = 0; i < n; i++) {
            setTimeout(() => {
              if (this.dead || Game.state !== 'play') return;
              const tx = game.player.worldX + (i % 2 === 0 ? 0 : (Math.random() - 0.3) * 420);
              Game.projectiles.push(new Meteor(tx));
            }, 400 + i * 650);
          }
          this.stateT = 3.6;
        }
        if (this.stateT <= 0) { this._meteors = false; this._enter('land', 0.6); }
        break;
      }

      case 'vulnerable':
        this.y = CFG.GROUND_Y;
        if (this.stateT <= 0) {
          this._enter('takeoff', 0.8);
        }
        break;

      case 'takeoff':
        this.y += (this.homeY - this.y) * dt * 4;
        this.worldX += (this.homeX - this.worldX) * dt * 3;
        if (this.stateT <= 0) this._enter('hover', this.phase === 3 ? 0.8 : 1.4);
        break;
    }
  }

  _start(s) {
    this._fired = false;
    if (s === 'swoop') { this._enter('swoop', 4); this.vx = -60; AudioMan.sfx('roar'); FX.shake(6, 0.3); }
    else if (s === 'fireballs') this._enter('land', 0.7);
    else if (s === 'breath') { this._enter('breath', 2.6); }
    else if (s === 'meteor') this._enter('meteor', 4);
  }

  _breathParticles(game) {
    for (let i = 0; i < 5; i++) {
      const k = Math.random();
      FX.parts.push({
        x: this.headX - 30 - k * 600, y: CFG.GROUND_Y - 30 - Math.random() * 90 * (1 - k * 0.5),
        vx: -300 - Math.random() * 260, vy: (Math.random() - .5) * 120,
        life: 0.3 + Math.random() * 0.25, t: 0,
        color: ['#ffdd60', '#ff9030', '#ff5518'][Math.floor(Math.random() * 3)],
        grav: -220, r: 8 + Math.random() * 14, glow: true,
      });
    }
  }

  draw(ctx, camX) {
    const x = this.worldX - camX;
    const wingImg = Assets.img.dragonWing, bodyImg = Assets.img.dragonBody;
    const H = 360;
    const flapA = Math.sin(this.flap) * (this.grounded ? 0.18 : 0.55);
    const dying = this.dead;
    const alpha = dying ? Math.max(0, 1 - this.deathT / 3.4) : 1;
    const tint = this.phase === 3 && !dying ? '#ff3418' : null;

    ctx.save();
    if (dying) ctx.globalAlpha = alpha;

    // far wing
    ctx.save();
    ctx.translate(x + 40, this.y - H * 0.62);
    ctx.rotate(-flapA * 0.9 - 0.15);
    ctx.scale(0.92, 0.92);
    ctx.globalAlpha = alpha * 0.8;
    ctx.drawImage(wingImg, -20, -(wingImg.height || 220), wingImg.width || 300, wingImg.height || 220);
    ctx.restore();

    // body
    drawSprite(ctx, bodyImg, x, this.y, H, { rot: this.state === 'swoop' ? 0.16 : Math.sin(this.t * 1.8) * 0.03, tint });

    // near wing
    ctx.save();
    ctx.translate(x + 20, this.y - H * 0.66);
    ctx.rotate(flapA + 0.1);
    ctx.scale(-1.06, 1.06);
    ctx.drawImage(wingImg, -20, -(wingImg.height || 220), wingImg.width || 300, wingImg.height || 220);
    ctx.restore();

    // hit flash
    if (this.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.flash / 0.12 * 0.6;
      drawSprite(ctx, bodyImg, x, this.y, H, {});
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    // breath cone
    if (this.breathOn) {
      const hx = this.headX - camX, hy = CFG.GROUND_Y - 60;
      const g = ctx.createLinearGradient(hx, 0, hx - 640, 0);
      g.addColorStop(0, 'rgba(255,230,120,0.85)');
      g.addColorStop(0.4, 'rgba(255,140,40,0.65)');
      g.addColorStop(1, 'rgba(255,60,10,0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(hx, hy - 26);
      ctx.quadraticCurveTo(hx - 320, hy - 90 - Math.sin(this.t * 18) * 14, hx - 640, hy - 74);
      ctx.lineTo(hx - 640, CFG.GROUND_Y);
      ctx.lineTo(hx, CFG.GROUND_Y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // vulnerable indicator
    if (this.state === 'vulnerable') {
      ctx.save();
      const pulse = 0.6 + 0.4 * Math.sin(this.t * 10);
      ctx.globalAlpha = pulse;
      ctx.font = '900 30px Georgia';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#8dff70';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 6;
      const tx = this.headX - camX, ty = this.headY - 110;
      ctx.strokeText('▼', tx, ty); ctx.fillText('▼', tx, ty);
      ctx.restore();
    }
  }
}

/* ============================ PROJECTILES & PROPS ============================ */
class Fireball {
  constructor(x, y, targetX) {
    this.hostile = true;
    this.x = x; this.y = y;
    const dt = 0.9;
    this.vx = (targetX - x) / dt;
    this.vy = -(CFG.GROUND_Y - y) / dt * 0.4 - 260;
    this.dead = false;
    this.t = 0;
  }
  deflect() {
    if (this.deflected) return;
    this.deflected = true; this.hostile = false;
    this.vx = 600 + Math.random() * 300; this.vy = -800;
    AudioMan.sfx('clang');
    FX.stop(0.05); FX.shake(6, 0.15);
    FX.spray(this.x, this.y, -2.2, 1.2, '#9fd8ff', 14);
    Game.player.gainPower(6);
  }
  update(dt, game) {
    this.t += dt;
    this.vy += 1500 * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    FX.parts.push({ x: this.x, y: this.y, vx: (Math.random() - .5) * 60, vy: (Math.random() - .5) * 60, life: 0.3, t: 0, color: '#ff9030', grav: -120, r: 7 + Math.random() * 6, glow: true });
    const p = game.player;
    if (this.hostile && Math.abs(this.x - p.worldX) < 52 && this.y > p.hitTop && this.y < p.y + 8) {
      p.takeDamage(14, game, this);
      this.explode();
    }
    if (this.y >= CFG.GROUND_Y && this.vy > 0) this.explode();
    if (this.t > 4) this.dead = true;
  }
  explode() {
    if (this.dead) return;
    this.dead = true;
    FX.burst(this.x, Math.min(this.y, CFG.GROUND_Y), '#ff8030', 16, 380, 0.5);
    FX.ring(this.x, Math.min(this.y, CFG.GROUND_Y), '#ff9040', 130, 0.3, 16);
    FX.shake(5, 0.12);
  }
  draw(ctx, camX) {
    const g = ctx.createRadialGradient(this.x - camX, this.y, 2, this.x - camX, this.y, 26);
    g.addColorStop(0, '#fff3c0'); g.addColorStop(0.4, this.deflected ? '#9fd8ff' : '#ffa030'); g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(this.x - camX, this.y, 26, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

class Meteor {
  constructor(targetX) {
    this.hostile = true;
    this.targetX = targetX;
    this.warn = 0.85;                 // shadow telegraph before impact
    this.x = targetX + 260; this.y = -80;
    this.dead = false;
    this.falling = false;
  }
  update(dt, game) {
    if (this.warn > 0) { this.warn -= dt; return; }
    if (!this.falling) { this.falling = true; AudioMan.sfx('fire'); }
    this.x -= 900 * dt * 0.35;
    this.y += 1500 * dt;
    FX.parts.push({ x: this.x, y: this.y, vx: 0, vy: -80, life: 0.35, t: 0, color: '#ff7020', grav: 0, r: 9, glow: true });
    if (this.y >= CFG.GROUND_Y - 6) {
      this.dead = true;
      FX.burst(this.x, CFG.GROUND_Y, '#ff8030', 20, 480, 0.6);
      FX.ring(this.x, CFG.GROUND_Y, '#ff9040', 170, 0.35, 20);
      FX.shake(9, 0.2);
      AudioMan.sfx('blast');
      const p = game.player;
      // slide = dodge-roll i-frames against meteors
      if (Math.abs(this.x - p.worldX) < 130 && p.state !== 'slide' && p.grounded) p.takeDamage(CFG.DRAGON.meteorDmg, game, this);
    }
  }
  draw(ctx, camX) {
    if (this.warn > 0) {   // impact shadow telegraph
      const a = 0.35 + 0.4 * Math.sin(performance.now() / 60);
      ctx.save();
      ctx.globalAlpha = Math.max(0.15, a);
      ctx.fillStyle = '#ff4020';
      ctx.beginPath();
      ctx.ellipse(this.targetX - camX, CFG.GROUND_Y + 4, 90 * (1 + this.warn), 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    const g = ctx.createRadialGradient(this.x - camX, this.y, 3, this.x - camX, this.y, 34);
    g.addColorStop(0, '#fff3c0'); g.addColorStop(0.4, '#ff9030'); g.addColorStop(1, 'rgba(255,60,10,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(this.x - camX, this.y, 34, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

class ForceBolt {
  constructor(x, y, face = 1) {
    this.hostile = false;
    this.x = x; this.y = y;
    this.face = face;
    this.dead = false;
    this.t = 0;
    this.hit = new Set();
  }
  update(dt, game) {
    this.t += dt;
    this.x += CFG.SPECIALS.forceBolt.speed * dt * this.face;
    for (let i = 0; i < 3; i++)
      FX.parts.push({ x: this.x - i * 26 * this.face, y: this.y + (Math.random() - .5) * 26, vx: -160 * this.face, vy: (Math.random() - .5) * 130, life: 0.35, t: 0, color: i ? '#5fb8ff' : '#d8f2ff', grav: 0, r: 8 + Math.random() * 8, glow: true });
    for (const e of game.enemies) {
      if (!e.dead && !this.hit.has(e) && Math.abs(e.worldX - this.x) < 70) {
        this.hit.add(e);
        e.hurt(CFG.SPECIALS.forceBolt.damage, game, true);
      }
    }
    for (const o of game.obstacles) {
      if (o.t === 'rock' && !o.dead && !this.hit.has(o) && Math.abs(o.x - this.x) < 80) { this.hit.add(o); o.hurt(999, game); }
    }
    if (game.dragon && !game.dragon.dead && !this.hit.has(game.dragon) && Math.abs(game.dragon.headX - this.x) < 130) {
      this.hit.add(game.dragon);
      game.dragon.hurt(CFG.SPECIALS.forceBolt.damage, game);
    }
    if (this.x > game.camX + CFG.W + 200 || this.x < game.camX - 200 || this.t > 2.4) this.dead = true;
  }
  draw(ctx, camX) {
    const x = this.x - camX;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, this.y, 4, x, this.y, 44);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#8fd0ff'); g.addColorStop(1, 'rgba(60,120,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, this.y, 44, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(120,190,255,0.5)';
    ctx.beginPath(); ctx.ellipse(x - 60, this.y, 70, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

class Obstacle {
  constructor(ev) {
    this.t = ev.t;                   // rock | platform | heart | bar | ledge
    this.x = ev.x;
    this.w = ev.w || (ev.t === 'rock' ? 110 : ev.t === 'bar' ? 90 : 60);
    this.tier = ev.tier || 0;
    this.y = ev.y || (ev.tier ? CFG.TIERS[ev.tier] : CFG.GROUND_Y);   // top surface
    if (ev.t === 'ledge') this.drawY = this.y;
    this.hp = 60;
    this.dead = false;
    this.bobT = Math.random() * 7;
    this.hitCd = 0;                  // bar re-hit cooldown
  }
  hurt(dmg, game) {
    if (this.t !== 'rock' || this.dead) return;
    this.hp -= dmg;
    FX.burst(this.x, CFG.GROUND_Y - 50, '#a89880', 8, 320, 0.45);
    AudioMan.sfx('clang');
    if (this.hp <= 0) {
      this.dead = true;
      FX.burst(this.x, CFG.GROUND_Y - 50, '#b8a890', 18, 420, 0.6);
      FX.shake(6, 0.15);
      FX.stop(0.04);
      game.score += 10;
    }
  }
  update(dt, game) {
    this.bobT += dt;
    if (this.hitCd > 0) this.hitCd -= dt;
    const p = game.player;
    if (this.dead) return;
    if (this.t === 'bar') {
      // spiked barrier at head height: slide under it (or leap clean over)
      if (this.hitCd <= 0 && Math.abs(this.x - p.worldX) < 38 && p.state !== 'slide' &&
          p.y > CFG.GROUND_Y - 142) {
        this.hitCd = 0.6;
        p.takeDamage(8, game, this);
        FX.spray(this.x, CFG.GROUND_Y - 100, p.face > 0 ? -2.6 : -0.5, 1.4, '#c8b090', 10);
        AudioMan.sfx('clang');
      }
    } else if (this.t === 'rock') {
      // running into a rock: it shatters but stings
      if (Math.abs(this.x - p.worldX) < 52 && p.y > CFG.GROUND_Y - 74) {
        this.hurt(999, game);
        p.takeDamage(5, game, this);
      }
    } else if (this.t === 'heart') {
      if (Math.abs(this.x - p.worldX) < 66 && p.y > this.y - 150) {
        this.dead = true;
        p.hp = Math.min(CFG.PLAYER.hp, p.hp + 25);
        AudioMan.sfx('heart');
        FX.burst(this.x, this.y - 60, '#ff7a9a', 14, 300, 0.6, 200);
        FX.dmgText(p.worldX, p.y - 170, '+25', '#8dff8d', true);
      }
    }
  }
  draw(ctx, camX, theme) {
    if (this.dead) return;
    const x = this.x - camX;
    if (x < -250 || x > CFG.W + 250) return;
    if (this.t === 'rock') {
      drawSprite(ctx, Assets.img.rock, x, CFG.GROUND_Y + 4, 86, {});
    } else if (this.t === 'bar') {
      // thorn-wrapped spiked beam held between two gnarled posts —
      // the gap beneath it glows to say "slide through here"
      const gy = CFG.GROUND_Y, top = gy - 146, bot = gy - 78;
      ctx.save();
      // inviting under-glow in the crawl space
      const ug = ctx.createLinearGradient(0, bot, 0, gy);
      ug.addColorStop(0, 'rgba(120,220,255,0.30)');
      ug.addColorStop(1, 'rgba(120,220,255,0)');
      ctx.fillStyle = ug;
      ctx.fillRect(x - 46, bot + 6, 92, gy - bot - 6);
      ctx.strokeStyle = '#3c2a16'; ctx.lineWidth = 12; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - 54, gy); ctx.lineTo(x - 46, top + 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 54, gy); ctx.lineTo(x + 46, top + 8); ctx.stroke();
      const bg = ctx.createLinearGradient(0, top, 0, bot);
      bg.addColorStop(0, '#6e4a26'); bg.addColorStop(1, '#38230f');
      ctx.fillStyle = bg;
      ctx.strokeStyle = 'rgba(16,10,4,0.8)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(x - 52, top, 104, bot - top, 10); ctx.fill(); ctx.stroke();
      // thorns bristling downward and outward
      ctx.fillStyle = '#241708';
      for (let i = -4; i <= 4; i++) {
        const tx = x + i * 11;
        ctx.beginPath(); ctx.moveTo(tx - 4, bot - 2); ctx.lineTo(tx, bot + 16); ctx.lineTo(tx + 4, bot - 2); ctx.closePath(); ctx.fill();
        if (i % 2) { ctx.beginPath(); ctx.moveTo(tx - 4, top + 2); ctx.lineTo(tx, top - 12); ctx.lineTo(tx + 4, top + 2); ctx.closePath(); ctx.fill(); }
      }
      // warning rune glow so the read is instant
      const pulse = 0.5 + 0.5 * Math.sin(this.bobT * 4);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,120,40,${0.25 + pulse * 0.3})`;
      ctx.beginPath(); ctx.arc(x, (top + bot) / 2, 9, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.restore();
    } else if (this.t === 'ledge') {
      // thin enchanted stone causeway — a walkable storey that characters
      // can pass beneath without clipping through it
      const x0 = x - this.w / 2, x1 = x + this.w / 2, y0 = this.y;
      const th = Game.bg ? Game.bg.theme : 'verdant';
      const topCol = { verdant: '#5fae3e', night: '#2c4a72', frozen: '#eef7ff', storm: '#6a4a52', hell: '#3a1418' }[th];
      const topHi  = { verdant: '#8fd45e', night: '#4a72a8', frozen: '#ffffff', storm: '#8a6068', hell: '#5c2228' }[th];
      ctx.save();
      // drop shadow separates the storey from the scenery behind it
      const shg = ctx.createLinearGradient(0, y0 + 28, 0, y0 + 110);
      shg.addColorStop(0, 'rgba(8,10,14,0.35)');
      shg.addColorStop(1, 'rgba(8,10,14,0)');
      ctx.fillStyle = shg;
      ctx.fillRect(x0 + 14, y0 + 28, this.w - 28, 82);
      // stone body
      const bg = ctx.createLinearGradient(0, y0 - 6, 0, y0 + 26);
      bg.addColorStop(0, '#8a7a64'); bg.addColorStop(1, '#4c4034');
      ctx.fillStyle = bg;
      ctx.strokeStyle = 'rgba(18,12,6,0.85)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(x0, y0 - 6, this.w, 32, 12); ctx.fill(); ctx.stroke();
      // stone seams + hanging tufts
      ctx.strokeStyle = 'rgba(30,22,14,0.5)'; ctx.lineWidth = 2;
      for (let sx = x0 + 90; sx < x1 - 40; sx += 130) {
        ctx.beginPath(); ctx.moveTo(sx, y0 - 2); ctx.lineTo(sx + 8, y0 + 24); ctx.stroke();
      }
      // themed turf strip on top with a sunlit rim
      const tg = ctx.createLinearGradient(0, y0 - 12, 0, y0 + 2);
      tg.addColorStop(0, topHi); tg.addColorStop(1, topCol);
      ctx.fillStyle = tg;
      ctx.beginPath(); ctx.roundRect(x0 - 2, y0 - 12, this.w + 4, 14, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,248,210,0.5)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x0 + 8, y0 - 11); ctx.lineTo(x1 - 8, y0 - 11); ctx.stroke();
      // levitation runes glimmering along the underside
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let sx = x0 + 60; sx < x1 - 30; sx += 240) {
        const pulse = 0.5 + 0.5 * Math.sin(this.bobT * 2.2 + sx * 0.01);
        const rg = ctx.createRadialGradient(sx, y0 + 30, 1, sx, y0 + 30, 14);
        rg.addColorStop(0, `rgba(120,210,255,${0.5 + pulse * 0.4})`);
        rg.addColorStop(1, 'rgba(120,210,255,0)');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(sx, y0 + 30, 14, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      ctx.restore();
      this.drawY = y0;
    } else if (this.t === 'platform') {
      const img = Assets.img.platform;
      const bob = Math.sin(this.bobT * 1.4) * 6;
      const h = 90, scale = this.w / (img.width || 300);
      ctx.save();
      ctx.translate(x, this.y + bob);
      ctx.drawImage(img, -this.w / 2, -14, this.w, h);
      ctx.restore();
      this.drawY = this.y + bob;       // actual collision top this frame
    } else if (this.t === 'heart') {
      const bob = Math.sin(this.bobT * 3) * 8;
      const g = ctx.createRadialGradient(x, this.y - 60 + bob, 4, x, this.y - 60 + bob, 46);
      g.addColorStop(0, 'rgba(255,150,170,0.65)'); g.addColorStop(1, 'rgba(255,100,130,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, this.y - 60 + bob, 46, 0, Math.PI * 2); ctx.fill();
      drawSprite(ctx, Assets.img.heart, x, this.y - 34 + bob, 52, {});
    }
  }
}
