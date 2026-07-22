/* ============================================================
   Elfblade — game configuration & data-driven level design.
   All tuning (speeds, HP, damage, spawn tables) lives here so
   levels can be rebalanced without touching engine code.
   Logical resolution: 1280 x 720 (letterboxed to fit screen).
   ============================================================ */

const CFG = {
  W: 1280, H: 720,
  GROUND_Y: 610,           // top of the ground strip
  TIERS: [610, 445, 285],  // multi-tier floors: ground, mid ledge, high ledge
  GRAVITY: 3400,           // used for ragdolls/projectiles
  GRAVITY_UP: 2500,        // player: floatier rise…
  GRAVITY_DOWN: 4400,      // …snappier fall = weighty, controllable jumps
  JUMP_VEL: -1150,
  COYOTE: 0.12,            // grace period after running off an edge
  INPUT_BUFFER: 0.16,      // early presses are queued, not eaten
  SLIDE_TIME: 0.5,
  PLAYER: {
    hp: 100,
    x: 300,                // preferred screen-x (camera target, not a lock)
    moveSpeed: 460,        // free left/right movement speed
    attackDamage: 34,
    attackRange: 150,
    attackCooldown: 0.3,
    comboWindow: 0.85,     // time to chain the next swing
    heavyChargeTime: 0.55, // hold attack this long to unleash a heavy strike
    heavyDamageMult: 2.4,
    heavyRange: 205,
    invulnAfterHit: 1.0,
    powerPerHit: 9,
    powerPerKill: 16,
    powerMax: 100,
  },
  SPECIALS: {
    forceBolt:   { damage: 120, speed: 1500, name: 'Force Bolt'   },
    radiusBlast: { damage: 70,  radius: 330, name: 'Radius Blast' },
  },
  ENEMIES: {
    goblin:   { hp: 40,  dmg: 10, speed: 165, w: 74,  h: 96,  score: 50,
                windup: 0.5,  attackRange: 95, attackCd: 1.2 },
    troll:    { hp: 110, dmg: 18, speed: 100, w: 110, h: 150, score: 120,
                windup: 0.8,  attackRange: 125, attackCd: 1.8 },
    hog:      { hp: 90,  dmg: 20, speed: 125, w: 130, h: 88,  score: 150,
                windup: 0.85, chargeSpeed: 780, attackCd: 2.3 },
  },
  // Mini-bosses are scaled named variants of base enemies.
  MINIBOSSES: {
    goblinChief:  { base: 'goblin', name: 'GRUKKA, GOBLIN CHIEF',   scale: 1.75, hp: 300,  dmg: 14, tint: '#ffb02e' },
    trollWarlord: { base: 'troll',  name: 'MOGDUR, TROLL WARLORD',  scale: 1.45, hp: 480,  dmg: 22, tint: '#8f7bff' },
    frostmaw:     { base: 'hog',    name: 'FROSTMAW THE UNBROKEN',  scale: 1.6,  hp: 520,  dmg: 24, tint: '#7fd8ff' },
    ashbrand:     { base: 'troll',  name: 'ASHBRAND THE COLOSSUS',  scale: 1.7,  hp: 650,  dmg: 26, tint: '#ff5b3a' },
  },
  DRAGON: { hp: 1600, name: 'VARKHUL, TYRANT OF EMBERS',
            lungeDmg: 22, fireDmg: 26, meteorDmg: 16 },
};

/* ---------- spawn-script helpers (used only at config time) ----------
   Event types:
     goblin/troll/hog  enemies (optional tier: 0 ground, 1 mid, 2 high)
     rock              destructible boulder (jump it or smash it)
     bar               spiked barrier at head height — slide under it
     gap               crevice in the ground — jump it or cross above
     platform          small floating stepping-stone {y, w}
     ledge             long tier floor {w, tier} — a second/third storey
     heart             +25 hp pickup (optional tier)                       */
function _wave(x, type, n, gap, tier) { const ev = []; for (let i = 0; i < n; i++) ev.push({ x: x + i * gap, t: type, tier }); return ev; }
function _mix(...lists) { return [].concat(...lists).sort((a, b) => a.x - b.x); }
function _bar(x) { return { x, t: 'bar' }; }
function _ledge(x, w, tier) { return { x, t: 'ledge', w, tier }; }
function _heart(x, tier) { return { x, t: 'heart', tier }; }

/* Each level: name, subtitle, theme id (background renderer), music file,
   scroll speed (camera, px/s), level length in world px, and the script.
   Levels are hand-designed around routes: the tiers offer alternate paths
   with their own enemies, hazards and rewards. */
const LEVELS_V3 = [
  { // ---------------- LEVEL 1 — bright verdant daylight ----------------
    name: 'The Verdant Cliffs', sub: 'A realm of floating isles and waterfalls',
    theme: 'verdant',
    music: 'assets/music/level1_celtic_impulse.mp3',
    musicName: 'Celtic Impulse — Kevin MacLeod',
    speed: 118, length: 13500,
    miniboss: 'goblinChief',
    events: _mix(
      // opening: learn to fight
      _wave(1100, 'goblin', 2, 260),
      // learn to slide
      [_bar(2100)],
      _wave(2600, 'goblin', 2, 240),
      // learn to jump a crevice via a stepping stone
      [{ x: 3500, t: 'gap', w: 300 }, { x: 3650, t: 'platform', y: 470, w: 210 }],
      // first split route: high road has a heart guarded by a goblin,
      // low road squeezes you under a barrier into a fight
      [_ledge(4900, 1500, 1)],
      [{ x: 5150, t: 'goblin', tier: 1 }, _heart(5750, 1)],
      [_bar(5000), { x: 5500, t: 'goblin' }, { x: 5900, t: 'goblin' }],
      // stepping stones over a wide crevice
      [{ x: 7000, t: 'gap', w: 330 }, { x: 7100, t: 'platform', y: 460, w: 190 }],
      _wave(7700, 'goblin', 3, 240),
      // double slide gauntlet
      [_bar(8800), _bar(9150)],
      // the high road crosses the pit — the ground route needs a double jump
      [_ledge(9900, 1300, 1), { x: 10250, t: 'gap', w: 330 }],
      [{ x: 10100, t: 'goblin', tier: 1 }],
      [{ x: 10900, t: 'rock' }],
      _wave(11400, 'goblin', 3, 230),
      [_heart(12300)],
      _wave(12600, 'goblin', 2, 250),
    ),
  },
  { // ---------------- LEVEL 2 — moonlit night forest ----------------
    name: 'The Moonveil Woods', sub: 'Night falls — trolls wake beneath the twin moons',
    theme: 'night',
    music: 'assets/music/level2_lord_of_the_land.mp3',
    musicName: 'Lord of the Land — Kevin MacLeod',
    speed: 128, length: 15000,
    miniboss: 'trollWarlord',
    events: _mix(
      _wave(1100, 'goblin', 2, 250),
      [{ x: 2000, t: 'troll' }],
      [_bar(2900)],
      [{ x: 3400, t: 'gap', w: 320 }, { x: 3550, t: 'platform', y: 465, w: 200 }],
      // twin-tier woods: goblins hold the branch road, a troll blocks the floor
      [_ledge(4600, 1800, 1)],
      _wave(4850, 'goblin', 2, 420, 1),
      [{ x: 5000, t: 'troll' }, _bar(5700), _heart(6100, 1)],
      _wave(6800, 'goblin', 3, 230),
      // broken bridge: hop the stones or take the high branch
      [_ledge(7900, 1400, 1), { x: 8100, t: 'gap', w: 300 }, { x: 8700, t: 'gap', w: 300 }],
      [{ x: 8250, t: 'platform', y: 470, w: 180 }, { x: 8300, t: 'goblin', tier: 1 }],
      [{ x: 9600, t: 'troll' }, { x: 10000, t: 'goblin' }],
      [_bar(10700), _bar(11050)],
      // triple-storey climb to a moonlit heart
      [_ledge(11800, 1500, 1), _ledge(12250, 900, 2), _heart(12650, 2)],
      [{ x: 12000, t: 'goblin', tier: 1 }, { x: 12500, t: 'goblin', tier: 1 }, { x: 12100, t: 'troll' }],
      _wave(13600, 'goblin', 3, 230),
      [{ x: 14300, t: 'troll' }],
    ),
  },
  { // ---------------- LEVEL 3 — frozen mountain pass ----------------
    name: 'The Frostfang Peaks', sub: 'A frozen pass where war-hogs stampede',
    theme: 'frozen',
    music: 'assets/music/level3_five_armies.mp3',
    musicName: 'Five Armies — Kevin MacLeod',
    speed: 138, length: 16000,
    miniboss: 'frostmaw',
    events: _mix(
      _wave(1100, 'goblin', 2, 250),
      [{ x: 1900, t: 'hog' }],
      [_bar(2700), { x: 3100, t: 'troll' }],
      // icefall crossing
      [{ x: 3900, t: 'gap', w: 330 }, { x: 4050, t: 'platform', y: 460, w: 190 }],
      // hogs stampede the valley floor — the ice shelf above is safer but guarded
      [_ledge(4900, 2000, 1)],
      [{ x: 5200, t: 'goblin', tier: 1 }, { x: 5900, t: 'goblin', tier: 1 }, _heart(6500, 1)],
      [{ x: 5300, t: 'hog' }, { x: 6200, t: 'hog' }],
      [_bar(7300)],
      _wave(7800, 'goblin', 3, 230),
      [{ x: 8800, t: 'troll' }, { x: 9300, t: 'hog' }],
      // glacier chasm: stones below, shelf above, wind-blasted either way
      [_ledge(10100, 1600, 1), { x: 10300, t: 'gap', w: 330 }, { x: 10950, t: 'gap', w: 300 }],
      [{ x: 10450, t: 'platform', y: 470, w: 180 }, { x: 10500, t: 'goblin', tier: 1 }],
      [_bar(11900), { x: 12300, t: 'hog' }],
      // high twin shelves with a rich reward
      [_ledge(13000, 1400, 1), _ledge(13400, 800, 2), _heart(13750, 2)],
      [{ x: 13300, t: 'goblin', tier: 1 }, { x: 13600, t: 'goblin', tier: 2 }],
      [{ x: 13900, t: 'troll' }],
      _wave(14700, 'goblin', 3, 230),
      [{ x: 15400, t: 'hog' }],
    ),
  },
  { // ---------------- LEVEL 4 — stormy ashen wastes ----------------
    name: 'The Ashen Wastes', sub: 'Storm-scarred lands at the dragon’s doorstep',
    theme: 'storm',
    music: 'assets/music/level4_stormfront.mp3',
    musicName: 'Stormfront — Kevin MacLeod',
    speed: 148, length: 17000,
    miniboss: 'ashbrand',
    events: _mix(
      _wave(1000, 'goblin', 3, 230),
      [{ x: 1900, t: 'hog' }, { x: 2400, t: 'troll' }],
      [_bar(3100), _bar(3450)],
      [{ x: 4100, t: 'gap', w: 330 }, { x: 4250, t: 'platform', y: 465, w: 180 }],
      // war-camp: three storeys of fighting
      [_ledge(5100, 2200, 1), _ledge(5700, 1000, 2)],
      [{ x: 5400, t: 'goblin', tier: 1 }, { x: 6100, t: 'goblin', tier: 1 }, { x: 5950, t: 'goblin', tier: 2 }, _heart(6300, 2)],
      [{ x: 5500, t: 'troll' }, { x: 6400, t: 'hog' }],
      [_bar(7700)],
      _wave(8200, 'goblin', 4, 220),
      [{ x: 9400, t: 'hog' }, { x: 9900, t: 'troll' }],
      // shattered causeway
      [_ledge(10800, 1700, 1), { x: 11000, t: 'gap', w: 320 }, { x: 11650, t: 'gap', w: 320 }],
      [{ x: 11150, t: 'platform', y: 470, w: 170 }, { x: 11200, t: 'goblin', tier: 1 }, { x: 11900, t: 'goblin', tier: 1 }],
      [_bar(12800), { x: 13200, t: 'hog' }],
      [{ x: 13900, t: 'troll' }, { x: 14300, t: 'troll' }],
      [_ledge(14800, 1200, 1), _heart(15200, 1), { x: 15300, t: 'goblin', tier: 1 }],
      _wave(15700, 'goblin', 4, 210),
      [{ x: 16500, t: 'hog' }],
    ),
  },
  { // ---------------- LEVEL 5 — hellish dragon arena ----------------
    name: 'The Cinderthrone', sub: 'Face Varkhul, Tyrant of Embers',
    theme: 'hell',
    music: 'assets/music/level5_ritual.mp3',
    musicName: 'Ritual — Kevin MacLeod',
    speed: 150, length: 4600,           // short gauntlet run-in, then the arena
    miniboss: null, boss: true,
    events: _mix(
      _wave(900, 'goblin', 3, 220),
      [_bar(1800)],
      [{ x: 2300, t: 'gap', w: 320 }, { x: 2450, t: 'platform', y: 465, w: 190 }],
      [{ x: 3000, t: 'troll' }, { x: 3500, t: 'hog' }],
      [_heart(4000)],
    ),
  },
];

const LEVELS = LEVELS_V3;

/* legacy v2 straight-line scripts kept below for reference/tuning
const LEVELS_V2 = [
  { // ---------------- LEVEL 1 — bright verdant daylight ----------------
    name: 'The Verdant Cliffs', sub: 'A realm of floating isles and waterfalls',
    theme: 'verdant',
    music: 'assets/music/level1_celtic_impulse.mp3',
    musicName: 'Celtic Impulse — Kevin MacLeod',
    speed: 252, length: 24000,
    miniboss: 'goblinChief',
    events: _mix(
      _wave(1500, 'goblin', 2, 260),
      [{ x: 2600, t: 'rock' }],
      _wave(3300, 'goblin', 3, 240),
      [{ x: 4400, t: 'gap', w: 240 }],
      _wave(5200, 'goblin', 2, 300),
      [{ x: 6300, t: 'rock' }, { x: 7000, t: 'platform', y: 430, w: 300 }],
      _wave(7600, 'goblin', 3, 250),
      [{ x: 8800, t: 'gap', w: 270 }, { x: 9600, t: 'heart' }],
      _wave(10300, 'goblin', 4, 230),
      [{ x: 11600, t: 'rock' }, { x: 12200, t: 'gap', w: 250 }],
      _wave(13000, 'goblin', 3, 260),
      [{ x: 14200, t: 'platform', y: 410, w: 320 }, { x: 14900, t: 'gap', w: 300 }],
      _wave(15700, 'goblin', 4, 240),
      [{ x: 17100, t: 'rock' }, { x: 17800, t: 'heart' }],
      _wave(18600, 'goblin', 5, 220),
      [{ x: 20200, t: 'gap', w: 280 }],
      _wave(21000, 'goblin', 4, 240),
    ),
  },
  { // ---------------- LEVEL 2 — moonlit night forest ----------------
    name: 'The Moonveil Woods', sub: 'Night falls — trolls wake beneath the twin moons',
    theme: 'night',
    music: 'assets/music/level2_lord_of_the_land.mp3',
    musicName: 'Lord of the Land — Kevin MacLeod',
    speed: 272, length: 26000,
    miniboss: 'trollWarlord',
    events: _mix(
      _wave(1500, 'goblin', 3, 250),
      [{ x: 2700, t: 'troll' }],
      [{ x: 3600, t: 'gap', w: 260 }],
      _wave(4300, 'goblin', 3, 240),
      [{ x: 5500, t: 'rock' }, { x: 6100, t: 'troll' }],
      [{ x: 7200, t: 'platform', y: 420, w: 300 }, { x: 7350, t: 'gap', w: 420 }],
      _wave(8300, 'goblin', 4, 230),
      [{ x: 9700, t: 'troll' }, { x: 10300, t: 'heart' }],
      [{ x: 11000, t: 'gap', w: 280 }],
      _wave(11800, 'goblin', 3, 240), [{ x: 12700, t: 'troll' }],
      [{ x: 13800, t: 'rock' }, { x: 14400, t: 'gap', w: 300 }],
      _wave(15200, 'goblin', 5, 220),
      [{ x: 16800, t: 'troll' }, { x: 17400, t: 'troll' }],
      [{ x: 18400, t: 'platform', y: 400, w: 340 }, { x: 18550, t: 'gap', w: 440 }, { x: 19300, t: 'heart' }],
      _wave(20000, 'goblin', 4, 230),
      [{ x: 21400, t: 'troll' }],
      _wave(22300, 'goblin', 3, 240),
    ),
  },
  { // ---------------- LEVEL 3 — frozen mountain pass ----------------
    name: 'The Frostfang Peaks', sub: 'A frozen pass where war-hogs stampede',
    theme: 'frozen',
    music: 'assets/music/level3_five_armies.mp3',
    musicName: 'Five Armies — Kevin MacLeod',
    speed: 288, length: 28000,
    miniboss: 'frostmaw',
    events: _mix(
      _wave(1500, 'goblin', 3, 240),
      [{ x: 2700, t: 'hog' }],
      [{ x: 3800, t: 'gap', w: 280 }],
      [{ x: 4600, t: 'troll' }],
      _wave(5500, 'goblin', 3, 230),
      [{ x: 6700, t: 'hog' }, { x: 7500, t: 'rock' }],
      [{ x: 8300, t: 'platform', y: 420, w: 320 }, { x: 8450, t: 'gap', w: 460 }],
      [{ x: 9400, t: 'troll' }, { x: 10000, t: 'heart' }],
      _wave(10700, 'goblin', 4, 220),
      [{ x: 12100, t: 'hog' }],
      [{ x: 13100, t: 'gap', w: 300 }, { x: 13900, t: 'rock' }],
      [{ x: 14700, t: 'troll' }, { x: 15300, t: 'hog' }],
      _wave(16300, 'goblin', 4, 220),
      [{ x: 17800, t: 'platform', y: 400, w: 340 }, { x: 17950, t: 'gap', w: 480 }],
      [{ x: 18900, t: 'hog' }, { x: 19600, t: 'heart' }],
      _wave(20400, 'goblin', 5, 210),
      [{ x: 22000, t: 'troll' }, { x: 22700, t: 'hog' }],
      [{ x: 23800, t: 'gap', w: 300 }],
      _wave(24600, 'goblin', 3, 230),
    ),
  },
  { // ---------------- LEVEL 4 — stormy ashen wastes ----------------
    name: 'The Ashen Wastes', sub: 'Storm-scarred lands at the dragon’s doorstep',
    theme: 'storm',
    music: 'assets/music/level4_stormfront.mp3',
    musicName: 'Stormfront — Kevin MacLeod',
    speed: 300, length: 30000,
    miniboss: 'ashbrand',
    events: _mix(
      _wave(1400, 'goblin', 4, 220),
      [{ x: 2800, t: 'hog' }, { x: 3500, t: 'troll' }],
      [{ x: 4500, t: 'gap', w: 300 }],
      _wave(5300, 'goblin', 4, 210),
      [{ x: 6700, t: 'hog' }, { x: 7300, t: 'rock' }, { x: 7900, t: 'troll' }],
      [{ x: 9000, t: 'platform', y: 410, w: 330 }, { x: 9150, t: 'gap', w: 480 }],
      _wave(10100, 'goblin', 5, 205),
      [{ x: 11700, t: 'hog' }, { x: 12300, t: 'heart' }],
      [{ x: 13000, t: 'troll' }, { x: 13700, t: 'troll' }],
      [{ x: 14800, t: 'gap', w: 320 }, { x: 15600, t: 'rock' }],
      _wave(16400, 'goblin', 5, 200),
      [{ x: 18000, t: 'hog' }, { x: 18700, t: 'hog' }],
      [{ x: 19800, t: 'platform', y: 400, w: 350 }, { x: 19950, t: 'gap', w: 500 }],
      [{ x: 20900, t: 'troll' }, { x: 21500, t: 'heart' }],
      _wave(22300, 'goblin', 6, 195),
      [{ x: 24200, t: 'hog' }, { x: 24900, t: 'troll' }],
      [{ x: 26000, t: 'gap', w: 320 }],
      _wave(26800, 'goblin', 4, 210),
    ),
  },
  { // ---------------- LEVEL 5 — hellish dragon arena ----------------
    name: 'The Cinderthrone', sub: 'Face Varkhul, Tyrant of Embers',
    theme: 'hell',
    music: 'assets/music/level5_ritual.mp3',
    musicName: 'Ritual — Kevin MacLeod',
    speed: 312, length: 7200,           // short gauntlet run-in, then the arena
    miniboss: null, boss: true,
    events: _mix(
      _wave(1400, 'goblin', 4, 210),
      [{ x: 2800, t: 'gap', w: 300 }],
      [{ x: 3600, t: 'troll' }, { x: 4300, t: 'hog' }],
      [{ x: 5300, t: 'heart' }],
      _wave(5700, 'goblin', 3, 220),
    ),
  },
];
*/

const STORAGE_KEY = 'elfblade_save_v1';
