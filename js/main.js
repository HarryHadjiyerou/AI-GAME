// Entry point: menu, loading, HUD and the render loop.
import * as THREE from 'three';
import { Game } from './game.js';
import { Input } from './flight/input.js';
import { Audio } from './core/audio.js';
import { BIRDS } from './flight/birds.js';
import { BIOMES } from './world/biomes.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, reversedDepthBuffer: true });
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
$('#optMusic').checked = opts.music !== false;
for (const id of ['optQuality', 'optInvert', 'optSound', 'optVario', 'optMusic']) $('#' + id).addEventListener('change', () => {
  opts.quality = $('#optQuality').value; opts.invert = $('#optInvert').checked; opts.sound = $('#optSound').checked; opts.vario = $('#optVario').checked; opts.music = $('#optMusic').checked;
  saveOpts();
  applyAudioOpts();
});

// ---------- menu backdrop: the hawk scan gliding through a Poly Haven sky ----------
const menu3d = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 5000), hawk: null, t: 0 };
{
  const tex = new THREE.TextureLoader().load('assets/hdri/mountains_sky.jpg');
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  menu3d.scene.background = tex;
  menu3d.scene.backgroundIntensity = 0.9;
  menu3d.scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x6a5040, 1.6));
  const sunL = new THREE.DirectionalLight(0xfff2dd, 3.2); sunL.position.set(3, 5, 2); menu3d.scene.add(sunL);
  new GLTFLoader().load('assets/models/hawk_lo.glb', (g) => { menu3d.hawk = g.scene; menu3d.scene.add(g.scene); });
  menu3d.cam.position.set(0, 0.35, 3.2);
}
function renderMenu(dt) {
  menu3d.t += dt;
  const t = menu3d.t, h = menu3d.hawk;
  if (h) {
    h.position.set(0.1 + Math.sin(t * 0.21) * 0.4, 0.82 + Math.sin(t * 0.5) * 0.06, 0.3);
    h.rotation.set(0.12 + Math.sin(t * 0.37) * 0.05, Math.PI / 2 - 0.35 + Math.sin(t * 0.18) * 0.2, 0.55 + Math.sin(t * 0.3) * 0.15, 'YXZ');
  }
  menu3d.cam.aspect = innerWidth / innerHeight;
  menu3d.cam.rotation.set(0, Math.sin(t * 0.05) * 0.15, 0);
  menu3d.cam.updateProjectionMatrix();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.setRenderTarget(null);
  renderer.render(menu3d.scene, menu3d.cam);
  renderer.toneMapping = THREE.NoToneMapping;
}

const input = new Input(document.body);
const audio = new Audio();
function applyAudioOpts() {
  audio.enabled = opts.sound !== false;
  audio.vario = opts.vario !== false;
  const m = opts.music !== false;
  if (audio.musicOn !== m) { audio.musicOn = m; const k = audio.musicKey; audio.musicKey = null; if (audio.ctx && k) audio.playMusic(k); }
}
applyAudioOpts();
// Browsers (iOS especially) only allow audio after a user gesture: start the menu score on the first touch.
const firstGesture = () => { audio.unlock(); if (!game) audio.playMusic('menu'); window.removeEventListener('pointerdown', firstGesture); window.removeEventListener('keydown', firstGesture); };
window.addEventListener('pointerdown', firstGesture);
window.addEventListener('keydown', firstGesture);
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
  applyAudioOpts();
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
  audio.stopGame();
  audio.ctx?.resume();
  audio.playMusic('menu');
  show('menu');
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });

window.addEventListener('resize', () => game?.resize());
$('#rotate').classList.add('armed');

// Allow deep-linking a bird for quick testing: index.html#hawk
const deep = location.hash.slice(1);
if (BIRDS[deep]) startGame(deep).catch(fail);

let lastT = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (game && game.running) {
    try { game.frame(); } catch (e) { game.running = false; fail(e); }
  } else if ($('#menu').classList.contains('visible')) renderMenu(dt);
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
