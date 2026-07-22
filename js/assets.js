/* ============================================================
   Elfblade — sprite asset pipeline.
   Every character / enemy / key prop is an image file under
   assets/sprites/ and can be swapped for final art by replacing
   the file (same name, any of svg/png). If a file is missing the
   game keeps working with a clearly-labelled placeholder box.
   ============================================================ */

const SPRITES = {
  elf:         'assets/sprites/elf.svg',
  sword:       'assets/sprites/sword.svg',
  goblin:      'assets/sprites/goblin.svg',
  troll:       'assets/sprites/troll.svg',
  hog:         'assets/sprites/hog.svg',
  dragonBody:  'assets/sprites/dragon_body.svg',
  dragonWing:  'assets/sprites/dragon_wing.svg',
  rock:        'assets/sprites/rock.svg',
  platform:    'assets/sprites/platform.svg',
  heart:       'assets/sprites/heart.svg',
};

const Assets = {
  img: {},          // name -> HTMLImageElement or placeholder canvas
  loaded: false,

  load() {
    const jobs = Object.entries(SPRITES).map(([name, url]) =>
      new Promise(resolve => {
        const im = new Image();
        im.onload = () => { this.img[name] = im; resolve(); };
        im.onerror = () => { this.img[name] = this._placeholder(name); resolve(); };
        im.src = url;
      })
    );
    return Promise.all(jobs).then(() => { this.loaded = true; });
  },

  // Clearly-labelled placeholder so missing art is obvious but not game-breaking.
  _placeholder(name) {
    const c = document.createElement('canvas');
    c.width = 120; c.height = 140;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,0,200,0.55)';
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    g.fillRect(0, 0, 120, 140);
    g.strokeRect(2, 2, 116, 136);
    g.fillStyle = '#fff';
    g.font = 'bold 16px sans-serif';
    g.textAlign = 'center';
    g.fillText('MISSING', 60, 60);
    g.fillText(name, 60, 84);
    return c;
  },
};
