// Entry point: menu, loading, HUD and the render loop.
import * as THREE from 'three';
import { Game } from './game.js';
import { Input } from './flight/input.js';
import { Audio } from './core/audio.js';
import { BIRDS } from './flight/birds.js';
import { BIOMES } from './world/biomes.js';

const $ = (s) => document.querySelector(s);
const screens = ['menu', 'loading', 'hud', 'pause'];
function show(...ids) { screens.forEach((s) => $('#' + s).classList.toggle('visible', ids.includes(s))); }

function fail(e) {
  console.error(e);
  $('#errorText').textContent = (e && (e.stack || e.message)) || String(e);
  $('#error').classList.add('visible');
}
window.addEventListener('error', (e) => fail(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => fail(e.reason));

const canvas = $('#gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
} catch (e) {
  fail(new Error('WebGL2 is not available on this device/browser.'));
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setClearColor(0x000000, 1);

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
function autoQuality() {
  if (isMobile) return 'medium';
  return 'high';
}

// persisted options
const opts = (() => { try { return JSON.parse(localStorage.getItem('aves-opts')) || {}; } catch { return {}; } })();
const saveOpts = () => { try { localStorage.setItem('aves-opts', JSON.stringify(opts)); } catch { /* private mode */ } };
$('#optQuality').value = opts.quality || 'auto';
$('#optInvert').checked = !!opts.invert;
$('#optSound').checked = opts.sound !== false;
$('#optVario').checked = opts.vario !== false;
for (const id of ['optQuality', 'optInvert', 'optSound', 'optVario']) $('#' + id).addEventListener('change', () => {
  opts.quality = $('#optQuality').value; opts.invert = $('#optInvert').checked; opts.sound = $('#optSound').checked; opts.vario = $('#optVario').checked;
  saveOpts();
});

const input = new Input(document.body);
const audio = new Audio();
let game = null;

// ---------- HUD helpers ----------
let hintTimer = 0;
const ui = {
  hint(text, secs) {
    const el = $('#hint');
    el.textContent = text;
    el.classList.toggle('show', !!text);
    clearTimeout(hintTimer);
    if (text && secs) hintTimer = setTimeout(() => el.classList.remove('show'), secs * 1000);
  },
  toast(text, sub) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => el.remove(), 1700);
  },
  hud(s) {
    $('#hudSpeed').textContent = Math.round(s.speed * 3.6);
    $('#hudAlt').textContent = Math.max(0, Math.round(s.agl));
    const v = Math.max(-6, Math.min(6, s.climb));
    const bar = $('#hudVario');
    bar.style.height = Math.abs(v) * 2.8 + 'px';
    bar.classList.toggle('sink', v < 0);
    $('#hudVarioTxt').textContent = (v >= 0 ? '+' : '') + v.toFixed(1);
    $('#hudScore').textContent = Math.round(s.score).toLocaleString();
    $('#hudCombo').textContent = s.combo > 1.05 ? `x${s.combo.toFixed(1)}` : '';
    $('#staminaRing').style.strokeDashoffset = String(289 * (1 - s.stamina));
  },
};

// ---------- flow ----------
async function startGame(bird) {
  const cfg = BIRDS[bird];
  const q = opts.quality && opts.quality !== 'auto' ? opts.quality : autoQuality();
  input.invert = !!opts.invert;
  audio.enabled = opts.sound !== false;
  audio.vario = opts.vario !== false;
  audio.start(cfg.biome);
  $('#loadTitle').textContent = BIOMES[cfg.biome].title;
  $('#loadBar').style.width = '0%';
  $('#hudBird').textContent = cfg.name;
  $('#hudBiome').textContent = BIOMES[cfg.biome].title;
  show('loading');
  // Try to lock orientation where supported (Android / installed PWA). iOS Safari ignores this.
  try { await screen.orientation?.lock?.('landscape'); } catch { /* unsupported */ }
  if (game) { game.dispose(); game = null; }
  game = new Game(renderer, ui, input, audio);
  await game.start(bird, q, (p) => { $('#loadBar').style.width = Math.round(p * 100) + '%'; });
  show('hud');
}

document.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => {
  startGame(c.dataset.bird).catch(fail);
}));
function pause(on) {
  if (!game || !game.running) return;
  game.paused = on;
  show(on ? 'pause' : 'hud');
  if (on) audio.ctx?.suspend(); else audio.ctx?.resume();
}
input.onPause = () => pause(!game?.paused);
$('#btnResume').addEventListener('click', () => pause(false));
$('#btnMenu').addEventListener('click', () => {
  if (game) { game.dispose(); game = null; }
  audio.ctx?.suspend();
  show('menu');
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });

window.addEventListener('resize', () => game?.resize());
$('#rotate').classList.add('armed');

// Allow deep-linking a bird for quick testing: index.html#hawk
const deep = location.hash.slice(1);
if (BIRDS[deep]) startGame(deep).catch(fail);

renderer.setAnimationLoop(() => {
  if (game && game.running) {
    try { game.frame(); } catch (e) { game.running = false; fail(e); }
  }
});

// expose for debugging
window.AVES = {
  get game() { return game; }, THREE,
  // debug: place the bird at a height above ground, e.g. AVES.pose(0, 300, 0, 0, -0.2, 'flying')
  pose(x, agl, z, yaw = 0, pitch = 0, mode = 'flying') {
    const b = game.body; b.pos.set(x, Math.max(game.field.height(x, z), 0) + agl, z); b.setHeading(yaw, pitch); b.mode = mode;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(b.quat); b.vel.copy(f).multiplyScalar(mode === 'flying' ? b.cfg.vBest : 0);
  },
};
