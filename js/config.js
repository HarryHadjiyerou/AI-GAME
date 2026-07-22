/* ============================================================
   Elfblade — game configuration & data-driven level design.
   All tuning (speeds, HP, damage, spawn tables) lives here so
   levels can be rebalanced without touching engine code.
   Logical resolution: 1280 x 720 (letterboxed to fit screen).
   ============================================================ */

const CFG = {
  W: 1280, H: 720,
  GROUND_Y: 610,           // top of the ground strip
  GRAVITY: 3400,
  JUMP_VEL: -1180,
  SLIDE_TIME: 0.52,
  PLAYER: {
    hp: 100,
    x: 300,                // fixed screen-x while running
    attackDamage: 34,
    attackRange: 150,
    attackCooldown: 0.32,
    comboWindow: 0.85,     // time to chain the next swing
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
    goblin:   { hp: 40,  dmg: 10, speed: 90,  w: 74,  h: 96,  score: 50,
                windup: 0.55, attackRange: 95, attackCd: 1.4 },
    troll:    { hp: 110, dmg: 18, speed: 55,  w: 110, h: 150, score: 120,
                windup: 0.85, attackRange: 125, attackCd: 2.0 },
    hog:      { hp: 90,  dmg: 20, speed: 70,  w: 130, h: 88,  score: 150,
                windup: 0.9,  chargeSpeed: 720, attackCd: 2.6 },
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

/* ---------- spawn-script helpers (used only at config time) ---------- */
function _wave(x, type, n, gap) { const ev = []; for (let i = 0; i < n; i++) ev.push({ x: x + i * gap, t: type }); return ev; }
function _mix(...lists) { return [].concat(...lists).sort((a, b) => a.x - b.x); }

/* Each level: name, subtitle, theme id (background renderer), music file,
   run speed, level length in world px, and the spawn/obstacle script. */
const LEVELS = [
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

const STORAGE_KEY = 'elfblade_save_v1';
