/* ============================================================
   Elfblade — articulated character painters.
   Characters are drawn as jointed, animated bodies (2-segment
   limbs, run cycles, windups, follow-through) with painterly
   shading: dark outline, 2-tone gradient fill, highlight pass.
   This is what gives them life and weight.
   Painters draw a character standing at origin (0,0) = feet,
   facing RIGHT for the elf, LEFT for enemies.
   ============================================================ */

/* capsule limb with outline + gradient + highlight */
function limb(ctx, x1, y1, x2, y2, w, c1, c2, outline = 'rgba(20,12,8,0.85)') {
  ctx.lineCap = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = w + 4.5;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  const g = ctx.createLinearGradient(x1, y1, x2, y2);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.strokeStyle = g;
  ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

/* 2-segment leg/arm: joint bends toward `bend` side */
function limb2(ctx, x1, y1, x2, y2, bend, w, c1, c2, outline) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const jx = mx + nx * bend, jy = my + ny * bend;
  limb(ctx, x1, y1, jx, jy, w, c1, c1, outline);
  limb(ctx, jx, jy, x2, y2, w * 0.92, c1, c2, outline);
  return [jx, jy];
}

function blob(ctx, x, y, rx, ry, rot, c1, c2, outline = 'rgba(20,12,8,0.85)') {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot || 0);
  ctx.strokeStyle = outline; ctx.lineWidth = 4;
  const g = ctx.createLinearGradient(0, -ry, 0, ry);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

function shine(ctx, x, y, rx, ry, rot, alpha = 0.35) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot || 0);
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/* ======================= THE ELF ======================= */
const ELF = {
  skin: '#f2cba2', skinD: '#d8a87c',
  armor: '#3f8049', armorD: '#26512e',
  gold: '#e8c25e', goldD: '#b08a2e',
  hair: '#f4e4a8', hairD: '#cbaa5e',
  cape: '#2c6338', capeD: '#153422',
  boot: '#5c4327', bootD: '#38270f',
};

/* pose: { runT, time, speedK, moving, state, grounded, vy, attackT, attackDur,
           heavy, charge, combo, spinT, squash } */
function paintElf(ctx, p) {
  const P = ELF;
  const run = p.runT * 10.5;
  const tabs = p.time !== undefined ? p.time : p.runT;      // absolute time for flutter
  const sliding = p.state === 'slide';
  const dead = p.state === 'dead';
  const air = !p.grounded;
  const dur = p.attackDur || 0.24;
  const atkK = p.attackT > 0 ? 1 - p.attackT / dur : -1;    // 0..1 during a swing
  const heavy = !!p.heavy && atkK >= 0;
  const up = !heavy && p.combo === 1;
  const big = heavy || p.combo === 2;
  const idle = !p.moving && p.grounded && !sliding;

  ctx.save();
  if (p.squash) ctx.scale(p.squash.x, p.squash.y);
  if (dead) { ctx.rotate(-1.35); ctx.translate(0, 10); }

  // double-jump flip
  if (p.spinT > 0) ctx.rotate(-Math.PI * 2 * (1 - p.spinT / 0.4));

  // body lean: forward with speed, back when rising, forward when diving
  let lean = idle ? 0.02 : 0.1 + (p.speedK - 1) * 0.12;
  if (air) lean = p.vy < 0 ? -0.12 : 0.2;
  if (sliding) lean = -1.22;
  if (atkK >= 0) lean += (heavy ? 0.34 : 0.18) * Math.sin(atkK * Math.PI);
  if (p.charge > 0.2 && atkK < 0) lean -= 0.1 * p.charge;   // coiling up for the heavy
  ctx.rotate(lean);

  const hipY = sliding ? -34 : -56;
  const shY = sliding ? -52 : -96;      // shoulder
  const bob = p.grounded && !sliding ? Math.abs(Math.sin(run)) * 4.5 : 0;
  ctx.translate(0, -bob * 0.6);

  /* leg targets — feet lift while swinging FORWARD (cos > 0), plant coming back */
  let f1x, f1y, f2x, f2y, b1, b2;
  if (sliding) { f1x = 34; f1y = -4; f2x = -8; f2y = -2; b1 = 8; b2 = -10; }
  else if (air) {
    if (p.vy < -80) { f1x = 20; f1y = -26; f2x = -14; f2y = -8; b1 = 16; b2 = -14; }   // tuck
    else { f1x = 12; f1y = -6; f2x = -20; f2y = -16; b1 = 10; b2 = -16; }              // reach for ground
  } else if (idle) {
    f1x = 15; f1y = 0; f2x = -11; f2y = 0; b1 = 7; b2 = -7;                            // ready stance
  } else {
    const s1 = Math.sin(run), s2 = Math.sin(run + Math.PI);
    f1x = s1 * 21; f1y = -Math.max(0, Math.cos(run)) * 15;
    f2x = s2 * 21; f2y = -Math.max(0, Math.cos(run + Math.PI)) * 15;
    b1 = 9 + Math.max(0, -s1) * 9; b2 = 9 + Math.max(0, -s2) * 9;
  }

  /* cape (behind everything) — flowing tail with flutter */
  ctx.save();
  const fl = Math.sin(tabs * 12) * 6 + Math.sin(tabs * 7.3) * 4;
  const capeLift = air ? (p.vy < 0 ? 26 : -18) : (sliding ? 30 : 6);
  ctx.fillStyle = (() => { const g = ctx.createLinearGradient(0, shY, -46, -10); g.addColorStop(0, P.cape); g.addColorStop(1, P.capeD); return g; })();
  ctx.strokeStyle = 'rgba(10,20,12,0.8)'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(2, shY + 4);
  ctx.quadraticCurveTo(-26, shY + 26 + fl * 0.4, -38 - fl * 0.5, -30 - capeLift + fl);
  ctx.quadraticCurveTo(-46 - fl, -16 - capeLift * 0.5, -34, -8 - capeLift * 0.3);
  ctx.quadraticCurveTo(-18, hipY + 18, -4, hipY - 2);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();

  /* rear arm (pumps while running; both hands on sword for big swing) */
  const armSwing = Math.sin(run + Math.PI) * 0.9;
  if (atkK < 0 && !sliding) {
    const hx = -6 + Math.sin(armSwing) * 14, hy = shY + 30 + Math.abs(Math.cos(armSwing)) * 6;
    limb2(ctx, -3, shY + 5, hx, hy, -12, 9, P.armorD, P.skinD);
  }

  /* rear leg */
  limb2(ctx, -2, hipY, f2x, f2y, -b2, 11, P.bootD, P.bootD);
  blob(ctx, f2x + 4, f2y - 2, 9, 5.5, -0.2, P.boot, P.bootD);

  /* torso: layered armor */
  blob(ctx, 1, (hipY + shY) / 2, 15, (hipY - shY) / 2 + 12, 0.06, P.armor, P.armorD);
  // gold chest plate + belt
  blob(ctx, 4, shY + 16, 11, 9, 0.1, P.gold, P.goldD);
  shine(ctx, 6, shY + 13, 5, 3, -0.4);
  ctx.strokeStyle = P.goldD; ctx.lineWidth = 4.5;
  ctx.beginPath(); ctx.moveTo(-11, hipY - 5); ctx.lineTo(13, hipY - 7); ctx.stroke();
  blob(ctx, 1, hipY - 6, 3.5, 3.5, 0, P.gold, P.goldD);
  // pauldron
  blob(ctx, -2, shY + 3, 10, 7, -0.25, P.gold, P.goldD);
  shine(ctx, -4, shY + 1, 4.5, 2.5, -0.3);

  /* front leg */
  limb2(ctx, 4, hipY, f1x, f1y, b1, 11.5, P.boot, P.bootD);
  blob(ctx, f1x + 4, f1y - 2, 9.5, 6, -0.15, P.boot, P.bootD);

  /* head */
  const headX = 8 + (atkK >= 0 ? 3 : 0), headY = shY - 13;
  blob(ctx, headX, headY, 11.5, 12.5, 0.05, P.skin, P.skinD);
  // pointed ear
  ctx.fillStyle = P.skinD;
  ctx.beginPath(); ctx.moveTo(headX - 9, headY - 1); ctx.lineTo(headX - 19, headY - 6); ctx.lineTo(headX - 8, headY - 7); ctx.closePath(); ctx.fill();
  // hair: swept spikes that flutter
  ctx.fillStyle = (() => { const g = ctx.createLinearGradient(headX, headY - 14, headX - 20, headY); g.addColorStop(0, P.hair); g.addColorStop(1, P.hairD); return g; })();
  ctx.strokeStyle = 'rgba(60,40,10,0.6)'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(headX + 10, headY - 6);
  ctx.quadraticCurveTo(headX + 6, headY - 16, headX - 4, headY - 14);
  ctx.quadraticCurveTo(headX - 12, headY - 16 + fl * 0.3, headX - 22 - fl * 0.6, headY - 8 + fl * 0.5);
  ctx.quadraticCurveTo(headX - 26 - fl, headY + 2, headX - 16, headY + 3);
  ctx.quadraticCurveTo(headX - 12, headY - 4, headX - 6, headY - 4);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // eye + brow
  ctx.fillStyle = '#274a70';
  ctx.beginPath(); ctx.arc(headX + 5.5, headY - 1, 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = P.hairD; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(headX + 2, headY - 5.5); ctx.lineTo(headX + 9, headY - 6); ctx.stroke();

  /* front arm + sword */
  let ang;                       // sword angle: -up, 0 = forward
  if (atkK >= 0) {
    const from = up ? 2.0 : (heavy ? -3.1 : -2.7), to = up ? -1.35 : (heavy ? 1.3 : 0.95);
    const anticip = heavy ? 0.22 : 0.12;   // heavies wind up visibly before release
    const k = atkK < anticip ? -atkK / anticip * 0.25 : (() => { const e = (atkK - anticip) / (1 - anticip); return 1 - Math.pow(1 - e, 3); })();
    ang = from + (to - from) * Math.max(0, k) + (k < 0 ? k * (up ? -1 : 1) : 0);
  } else if (p.charge > 0.2) ang = -2.2 - p.charge * 0.5;   // sword raised, gathering power
  else if (sliding) ang = 1.15;
  else if (air) ang = -0.9;
  else if (idle) ang = -0.5 + Math.sin(tabs * 2.2) * 0.04;
  else ang = -0.62 + Math.sin(run) * 0.07;

  const shoX = 5, shoYY = shY + 6;
  const handDist = 26;
  const hx = shoX + Math.cos(ang + 0.35) * handDist, hy = shoYY + Math.sin(ang + 0.35) * handDist;
  limb2(ctx, shoX, shoYY, hx, hy, 10, 9.5, P.armor, P.skin);
  // gauntlet
  blob(ctx, hx, hy, 6, 5.5, ang, P.gold, P.goldD);

  // sword (from the swappable asset) rotates around the grip in the hand
  const sw = Assets.img.sword;
  const sh = 104, ssc = sh / (sw.height || 110), swd = (sw.width || 26) * ssc;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(ang + Math.PI / 2);   // asset points up; ang 0 = forward
  // charge glow: sapphire fire crawls up the blade while a heavy gathers
  if (p.charge > 0.2 && atkK < 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const cg = ctx.createLinearGradient(0, 0, 0, -sh);
    cg.addColorStop(0, 'rgba(80,160,255,0)');
    cg.addColorStop(1, `rgba(140,210,255,${p.charge * 0.85})`);
    ctx.fillStyle = cg;
    ctx.fillRect(-swd, -sh - 6, swd * 2, sh + 6);
    // sparks orbiting the blade
    for (let i = 0; i < 4; i++) {
      const sa = tabs * 9 + i * 1.9;
      ctx.fillStyle = `rgba(190,230,255,${p.charge * 0.8})`;
      ctx.beginPath();
      ctx.arc(Math.cos(sa) * 12, -sh * (0.3 + 0.16 * i) + Math.sin(sa) * 6, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  if (atkK >= 0.1 && atkK < 0.85) { // motion ghosts while swinging
    for (let gi = 1; gi <= (heavy ? 3 : 2); gi++) {
      ctx.save();
      ctx.rotate(-(heavy ? 0.42 : 0.3) * gi * (up ? -1 : 1));
      ctx.globalAlpha *= 0.5 - gi * 0.13;
      ctx.drawImage(sw, -swd / 2, -sh + 13, swd, sh);
      ctx.restore();
    }
  }
  // heavy swings burn blue along the blade itself
  if (heavy && atkK >= 0.15) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = '#6ec8ff'; ctx.shadowBlur = 24;
    ctx.globalAlpha *= 0.85;
    ctx.drawImage(sw, -swd / 2, -sh + 13, swd, sh);
    ctx.restore();
  }
  ctx.drawImage(sw, -swd / 2, -sh + 13, swd, sh);
  ctx.restore();

  ctx.restore();
}

/* ======================= GOBLIN ======================= */
const GOB = { skin: '#8fbb4c', skinD: '#5a7f2c', rag: '#7a4c33', ragD: '#4a2a1c', wood: '#6e4a26', steel: '#b8c4cc' };

function paintGoblin(ctx, e) {
  const G = GOB;
  const t = e.t, run = t * 8;
  const windup = e.state === 'windup', strike = e.state === 'strike';
  const wk = windup ? 1 - e.stateT / e.def.windup : 0;

  ctx.save();
  if (e.hitSquash) ctx.scale(1 + e.hitSquash * 0.25, 1 - e.hitSquash * 0.3);
  if (windup) ctx.translate(Math.sin(t * 42) * 1.5 * wk, 0);       // tremble
  let lean = e.state === 'walk' ? -0.06 + Math.sin(run) * 0.05 : 0;
  if (windup) lean = 0.3 * wk;               // rears back
  if (strike) lean = -0.28;                  // lunges in
  ctx.rotate(lean);

  const hipY = -40, shY = -62;
  const bob = e.state === 'walk' ? Math.abs(Math.sin(run)) * 3.5 : 0;
  ctx.translate(0, -bob);

  // legs (walking left → mirror phases)
  const s1 = Math.sin(run), s2 = Math.sin(run + Math.PI);
  const f1x = -s1 * 14, f1y = -Math.max(0, Math.cos(run)) * 9;
  const f2x = -s2 * 14, f2y = -Math.max(0, Math.cos(run + Math.PI)) * 9;
  limb2(ctx, 2, hipY, f2x - 2, f2y, 8, 10, G.skinD, G.skinD);
  limb2(ctx, -2, hipY, f1x + 2, f1y, -8, 10.5, G.skin, G.skinD);

  // spear: pulled back on windup, thrust on strike
  const thrust = strike ? -30 : (windup ? 20 * wk : 0);
  ctx.save();
  ctx.translate(-8 + thrust * -1 * 0 + thrust, shY + 14);
  ctx.rotate(windup ? -0.15 : 0.08);
  ctx.strokeStyle = G.wood; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-34 + thrust, 10 - thrust * 0.28); ctx.lineTo(30 + thrust * 0.4, -8); ctx.stroke();
  ctx.fillStyle = G.steel;
  ctx.save();
  ctx.translate(-34 + thrust, 10 - thrust * 0.28);
  ctx.rotate(Math.atan2(-18, -64));
  ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(6, -5); ctx.lineTo(6, 5); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.restore();

  // torso rag tunic — squat and chunky
  blob(ctx, 0, (hipY + shY) / 2 + 2, 17, 17, -0.08, G.rag, G.ragD);
  blob(ctx, -2, hipY - 14, 12, 8, 0, G.skin, G.skinD);   // pot belly peeking out
  ctx.strokeStyle = G.ragD; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-12, hipY - 8); ctx.lineTo(11, hipY - 12); ctx.stroke();

  // arms gripping spear
  const handX = -14 + thrust * 0.8, handY = shY + 10 - thrust * 0.2;
  limb2(ctx, 3, shY + 4, handX + 10, handY + 3, -8, 9, G.skinD, G.skinD);
  limb2(ctx, -3, shY + 4, handX, handY, 8, 9.5, G.skin, G.skinD);

  // big head with ears + underbite
  const hX = -4 + (strike ? -4 : 0), hY = shY - 12;
  blob(ctx, hX, hY, 14, 12, -0.05, G.skin, G.skinD);
  // ears (twitch)
  const tw = Math.sin(t * 6) * 0.15;
  ctx.fillStyle = G.skinD;
  ctx.save(); ctx.translate(hX + 11, hY - 4); ctx.rotate(0.5 + tw);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(16, -7); ctx.lineTo(4, 6); ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.save(); ctx.translate(hX - 9, hY - 5); ctx.rotate(-0.4 - tw);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-12, -4); ctx.lineTo(-2, 5); ctx.closePath(); ctx.fill(); ctx.restore();
  // snout + mouth + fangs
  ctx.fillStyle = G.skinD;
  ctx.beginPath(); ctx.moveTo(hX - 12, hY + 1); ctx.lineTo(hX - 19, hY + 5); ctx.lineTo(hX - 10, hY + 6); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#3a1a10'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(hX - 13, hY + 8); ctx.quadraticCurveTo(hX - 4, hY + 12, hX + 6, hY + 9); ctx.stroke();
  ctx.fillStyle = '#efe8cc';
  ctx.beginPath(); ctx.moveTo(hX - 9, hY + 9); ctx.lineTo(hX - 7, hY + 13); ctx.lineTo(hX - 5, hY + 9); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(hX + 1, hY + 10); ctx.lineTo(hX + 3, hY + 14); ctx.lineTo(hX + 5, hY + 10); ctx.closePath(); ctx.fill();
  // eye — glows red during windup
  ctx.fillStyle = '#ffd23e';
  ctx.beginPath(); ctx.arc(hX - 6, hY - 2, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = windup ? '#ff2812' : '#c92c12';
  ctx.beginPath(); ctx.arc(hX - 6.5, hY - 2, 1.9, 0, Math.PI * 2); ctx.fill();
  if (windup) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.5 * wk;
    ctx.fillStyle = '#ff4020';
    ctx.beginPath(); ctx.arc(hX - 6.5, hY - 2, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/* ======================= TROLL ======================= */
const TRL = { skin: '#7e9757', skinD: '#48602f', belly: '#b6c48c', hide: '#5c4a2e', club: '#5e4526', clubD: '#3a2810', steel: '#c5c9d2' };

function paintTroll(ctx, e) {
  const T = TRL;
  const t = e.t, run = t * 5;
  const windup = e.state === 'windup', strike = e.state === 'strike';
  const wk = windup ? 1 - e.stateT / e.def.windup : 0;

  ctx.save();
  if (e.hitSquash) ctx.scale(1 + e.hitSquash * 0.2, 1 - e.hitSquash * 0.25);
  let lean = -0.1 + (e.state === 'walk' ? Math.sin(run) * 0.06 : 0);
  if (windup) lean = 0.22 * wk;
  if (strike) lean = -0.3;
  ctx.rotate(lean);

  const hipY = -62, shY = -108;
  const stomp = e.state === 'walk' ? Math.abs(Math.sin(run)) * 6 : 0;
  ctx.translate(0, -stomp * 0.5);

  // club arm (behind) — rests over the shoulder, raised on windup, slammed on strike
  const clubAng = strike ? 1.5 : (windup ? -2.5 - wk * 0.4 : -2.1 + Math.sin(t * 2.2) * 0.06);
  ctx.save();
  ctx.translate(14, shY + 12);
  ctx.rotate(clubAng);
  limb(ctx, 0, 0, 0, 40, 15, T.skinD, T.skinD);
  // club held at arm end
  ctx.translate(0, 44);
  ctx.strokeStyle = 'rgba(20,12,8,0.85)'; ctx.lineWidth = 13;
  ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(0, 52); ctx.stroke();
  const cg = ctx.createLinearGradient(-10, 0, 12, 0); cg.addColorStop(0, T.club); cg.addColorStop(1, T.clubD);
  ctx.strokeStyle = cg; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(0, 52); ctx.stroke();
  blob(ctx, 0, 56, 16, 23, 0, T.club, T.clubD);
  // menacing metal spikes
  ctx.fillStyle = T.steel;
  for (const [sx, sy, sa] of [[-13, 46, -2.2], [-15, 62, -2.9], [0, 34, -1.57 - 0.9], [13, 46, -0.9], [15, 62, -0.3], [6, 76, 0.6]]) {
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(sa + 1.57);
    ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(0, -13); ctx.lineTo(4, 0); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // legs — massive stomping trunks
  const s1 = Math.sin(run), s2 = Math.sin(run + Math.PI);
  const f1x = -s1 * 15, f2x = -s2 * 15;
  limb2(ctx, 8, hipY, f2x + 4, -Math.max(0, Math.cos(run + Math.PI)) * 8, 12, 16, T.skinD, T.skinD);
  limb2(ctx, -6, hipY, f1x - 2, -Math.max(0, Math.cos(run)) * 8, -12, 17, T.skin, T.skinD);
  blob(ctx, f1x - 2, -3, 13, 7, 0, T.skinD, T.skinD);
  blob(ctx, f2x + 4, -3, 12, 6.5, 0, T.skinD, T.skinD);

  // hunched torso — narrow shoulders atop a heavy gut
  blob(ctx, 2, (hipY + shY) / 2 + 6, 27, (hipY - shY) / 2 + 16, -0.16, T.skin, T.skinD);
  blob(ctx, -4, hipY - 16, 18, 19, 0, T.belly, T.skinD);
  shine(ctx, -8, hipY - 24, 8, 5, -0.3, 0.2);
  // shoulder hide pelt
  blob(ctx, 12, shY + 10, 16, 9, -0.35, T.hide, '#3a2c18');

  // front arm hanging huge knuckle-dragger
  const swing = Math.sin(run) * 8;
  limb2(ctx, -14, shY + 14, -30 + swing * 0.4, -18, -14, 13, T.skin, T.skinD);
  blob(ctx, -31 + swing * 0.4, -16, 10, 8, 0.2, T.skinD, T.skinD);

  // head juts forward of the chest — clearly a brute, not a machine
  const hX = -27 + (strike ? -5 : 0), hY = shY + 2 + (windup ? -5 * wk : 0);
  blob(ctx, hX, hY, 15, 13, -0.1, T.skin, T.skinD);
  // jaw + tusks
  ctx.fillStyle = T.skinD;
  ctx.beginPath(); ctx.moveTo(hX - 14, hY + 4); ctx.quadraticCurveTo(hX - 2, hY + 14, hX + 10, hY + 8); ctx.lineTo(hX + 8, hY + 13); ctx.quadraticCurveTo(hX - 6, hY + 18, hX - 15, hY + 10); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e6dec2';
  ctx.beginPath(); ctx.moveTo(hX - 11, hY + 8); ctx.lineTo(hX - 13, hY - 1); ctx.lineTo(hX - 6, hY + 7); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(hX + 3, hY + 9); ctx.lineTo(hX + 6, hY + 1); ctx.lineTo(hX + 9, hY + 9); ctx.closePath(); ctx.fill();
  // angry little eye
  ctx.fillStyle = '#ffb63e';
  ctx.beginPath(); ctx.arc(hX - 5, hY - 4, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = windup ? '#ff2812' : '#7c1c0c';
  ctx.beginPath(); ctx.arc(hX - 5.5, hY - 4, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = T.skinD; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(hX - 11, hY - 8); ctx.lineTo(hX + 2, hY - 9); ctx.stroke();

  ctx.restore();
}

/* ======================= ARMORED HOG ======================= */
const HOG = { hide: '#4a3a30', hideD: '#291f18', plate: '#8e93a0', plateD: '#4c5058', cloth: '#a83226', clothD: '#661a12', tusk: '#e8dfc4', snout: '#c98a80' };

function paintHog(ctx, e) {
  const H = HOG;
  const t = e.t;
  const charging = e.state === 'charge';
  const windup = e.state === 'windup';
  const wk = windup ? 1 - e.stateT / e.def.windup : 0;
  const gallop = t * (charging ? 22 : 7);

  ctx.save();
  if (e.hitSquash) ctx.scale(1 + e.hitSquash * 0.2, 1 - e.hitSquash * 0.25);
  if (windup) ctx.translate(Math.sin(t * 46) * 2 * wk, 0);
  ctx.rotate(charging ? 0.05 : (windup ? -0.07 * wk : 0));
  const bodyY = -46 + (charging ? Math.abs(Math.sin(gallop)) * -4 : 0);

  // legs: 2-beat gallop
  const legPairs = [
    { x: -32, ph: 0 }, { x: -20, ph: 0.4 },   // hind
    { x: 22, ph: Math.PI }, { x: 34, ph: Math.PI + 0.4 }, // front
  ];
  for (const L of legPairs) {
    const sw = charging ? Math.sin(gallop + L.ph) * 16 : (windup && L.x > 0 ? Math.sin(t * 20) * 6 * wk : Math.sin(gallop + L.ph) * 8);
    const lift = charging ? Math.max(0, -Math.cos(gallop + L.ph)) * 10 : 0;
    limb(ctx, L.x, bodyY + 14, L.x - sw * 0.7 - 3, -lift, 12, L.ph > 2 ? H.hide : H.hideD, H.hideD);
    blob(ctx, L.x - sw * 0.7 - 3, -lift - 2, 8, 5, 0, '#191310', '#191310');
  }

  // massive body
  blob(ctx, 0, bodyY, 54, 30, 0.04, H.hide, H.hideD);
  // bristly fur ridge: filled scallops along the spine
  ctx.fillStyle = '#241a14';
  ctx.beginPath();
  ctx.moveTo(-46, bodyY - 16);
  for (let i = 0; i < 8; i++) {
    const bx = -46 + i * 12;
    ctx.lineTo(bx + 5, bodyY - 30 - (i % 2) * 5 - Math.max(0, 3 - Math.abs(i - 3)) * 4);
    ctx.lineTo(bx + 12, bodyY - 18 + Math.abs(i - 4));
  }
  ctx.lineTo(50, bodyY - 8);
  ctx.quadraticCurveTo(0, bodyY - 26, -46, bodyY - 16);
  ctx.closePath(); ctx.fill();
  // steel back-plate with rivets and spikes
  blob(ctx, 4, bodyY - 10, 40, 15, 0.06, H.plate, H.plateD);
  shine(ctx, -6, bodyY - 16, 16, 4, 0.06, 0.25);
  ctx.fillStyle = H.plateD;
  for (const sx of [-20, 0, 20]) {
    ctx.beginPath(); ctx.moveTo(sx - 6, bodyY - 20); ctx.lineTo(sx, bodyY - 40); ctx.lineTo(sx + 6, bodyY - 20); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#c9a24a';
  for (const rx of [-32, -12, 8, 28]) { ctx.beginPath(); ctx.arc(rx, bodyY - 6, 2.2, 0, Math.PI * 2); ctx.fill(); }
  // draped crimson war-cloth with gold trim
  ctx.fillStyle = (() => { const g = ctx.createLinearGradient(0, bodyY, 0, bodyY + 30); g.addColorStop(0, H.cloth); g.addColorStop(1, H.clothD); return g; })();
  ctx.strokeStyle = 'rgba(20,10,8,0.7)'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-16, bodyY + 2);
  ctx.lineTo(28, bodyY + 2);
  ctx.lineTo(25, bodyY + 20); ctx.lineTo(18, bodyY + 26); ctx.lineTo(10, bodyY + 20);
  ctx.lineTo(2, bodyY + 28); ctx.lineTo(-6, bodyY + 20); ctx.lineTo(-13, bodyY + 24);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(-14, bodyY + 6); ctx.lineTo(26, bodyY + 6); ctx.stroke();

  // armored head, lowered when charging
  const hX = -48, hY = bodyY + (charging ? 16 : (windup ? 12 * wk : 6));
  ctx.save();
  ctx.translate(hX, hY);
  ctx.rotate(charging ? 0.28 : windup ? 0.2 * wk : 0.08);
  blob(ctx, 0, 0, 21, 17, 0, H.plate, H.plateD);
  shine(ctx, -4, -7, 8, 3.5, 0, 0.3);
  // face-plate spikes
  ctx.fillStyle = H.plateD;
  ctx.beginPath(); ctx.moveTo(-6, -14); ctx.lineTo(-2, -26); ctx.lineTo(2, -14); ctx.closePath(); ctx.fill();
  // snout
  blob(ctx, -18, 6, 8, 6.5, 0, H.snout, '#96534a');
  ctx.fillStyle = '#5c2c24';
  ctx.beginPath(); ctx.arc(-20, 5, 1.7, 0, Math.PI * 2); ctx.arc(-15, 5, 1.7, 0, Math.PI * 2); ctx.fill();
  // tusks
  ctx.fillStyle = H.tusk;
  ctx.strokeStyle = 'rgba(40,26,10,0.5)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-12, 12); ctx.quadraticCurveTo(-22, 20, -13, 24); ctx.quadraticCurveTo(-8, 18, -8, 12); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(2, 13); ctx.quadraticCurveTo(-6, 23, 3, 26); ctx.quadraticCurveTo(8, 19, 7, 13); ctx.closePath(); ctx.fill(); ctx.stroke();
  // eye slit
  ctx.fillStyle = '#181008';
  ctx.beginPath(); ctx.roundRect(-4, -6, 14, 6, 3); ctx.fill();
  ctx.fillStyle = windup || charging ? '#ff5c1e' : '#ff8c2e';
  ctx.beginPath(); ctx.arc(2, -3, 2.4, 0, Math.PI * 2); ctx.fill();
  if (windup || charging) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.5;
    ctx.fillStyle = '#ff5c1e'; ctx.beginPath(); ctx.arc(2, -3, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // tail
  ctx.strokeStyle = H.hideD; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(50, bodyY - 8);
  ctx.quadraticCurveTo(60, bodyY - 16 + Math.sin(t * 9) * 4, 56, bodyY - 22 + Math.sin(t * 9) * 5);
  ctx.stroke();

  ctx.restore();
}

/* dispatch table used by Enemy.draw */
const CHARACTER_PAINTERS = { goblin: paintGoblin, troll: paintTroll, hog: paintHog };
