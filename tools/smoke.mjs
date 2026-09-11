/* Headless smoke test: serve the game, load it in Chromium with WebGL,
   walk the menu, launch a world, fly it, and fail on any console error.
   Screenshots land in tools/tmp/shots. */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'tools/tmp/shots');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('nope');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const port = await new Promise((r) => server.listen(0, () => r(server.address().port)));
const base = `http://127.0.0.1:${port}`;

const world = process.argv[2] ?? null;          // optional: bird id
const headless = true;

const browser = await chromium.launch({
  headless,
  executablePath: process.env.AVES_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    // SwiftShader: no GPU in this container, but a real WebGL 2 implementation.
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl',
    '--no-sandbox', '--disable-dev-shm-usage',
    // Keep the browser off the network except for what the page asks for.
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--disable-default-apps', '--no-first-run', '--no-default-browser-check',
    '--disable-features=Translate,OptimizationHints,MediaRouter',
  ],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

/* ── CDN bridge ──────────────────────────────────────────────
   The browser in this container has no direct route out, and the
   point of the test is to exercise the real streaming path rather
   than a stubbed one. So every off-site request is fetched by node
   and handed back to the page, cached on disk so four worlds' worth
   of HDRIs and textures are only pulled once. */

const CACHE = path.join(ROOT, 'tools/tmp/netcache');
fs.mkdirSync(CACHE, { recursive: true });
const cacheKey = (u) => path.join(CACHE, Buffer.from(u).toString('base64url').slice(0, 180));
let served = 0, fetched = 0;

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();

  const key = cacheKey(url);
  try {
    if (fs.existsSync(key) && fs.existsSync(`${key}.type`)) {
      served++;
      return route.fulfill({
        status: 200,
        headers: { 'content-type': fs.readFileSync(`${key}.type`, 'utf8'), 'access-control-allow-origin': '*' },
        body: fs.readFileSync(key),
      });
    }
    const res = await fetch(url);
    const body = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') ?? 'application/octet-stream';
    if (res.ok) { fs.writeFileSync(key, body); fs.writeFileSync(`${key}.type`, type); fetched++; }
    return route.fulfill({
      status: res.status,
      headers: { 'content-type': type, 'access-control-allow-origin': '*' },
      body,
    });
  } catch (e) {
    return route.fulfill({ status: 502, body: `bridge failed: ${e.message}` });
  }
});

const errors = [];
const warnings = [];
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error') errors.push(m.text());
  else if (t === 'warning') warnings.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => {
  const u = r.url();
  if (u.startsWith(base)) errors.push(`local request failed: ${u}`);
  else warnings.push(`remote request failed: ${u}`);
});

const log = (...a) => console.log('  ', ...a);
let failed = 0;
const expect = (label, ok, detail = '') => {
  console.log(`   ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failed++;
};

console.log('\n════ AVES smoke test ════\n');
console.log('── boot ──');
await page.goto(base, { waitUntil: 'load' });

// The menu appears once the boot sequence finishes.
await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
expect('menu appears', true);

const glInfo = await page.evaluate(() => {
  const g = window.AVES?.renderer?.getContext();
  return {
    webgl2: !!window.AVES?.renderer?.capabilities?.isWebGL2,
    planet: !!window.AVES?.planet?.ok,
    renderer: g ? g.getParameter(g.VERSION) : null,
  };
});
log('gl:', glInfo.renderer);
expect('WebGL 2 context', glInfo.webgl2);
expect('menu planet renders', glInfo.planet);

const cards = await page.$$eval('.bird-card', (els) => els.map((e) => e.dataset.bird));
expect('four birds on the rail', cards.length === 4, cards.join(', '));
await page.screenshot({ path: path.join(SHOTS, '01-menu.png') });

// Cycle through the cards and confirm the detail panel follows.
for (const id of cards) {
  await page.click(`.bird-card[data-bird="${id}"]`);
  await page.waitForTimeout(120);
  const name = await page.textContent('#d-name');
  expect(`selecting ${id} updates the panel`, name.toLowerCase() === id.replace('seagull', 'seagull'), name);
}

const targets = world ? [world] : cards;

for (const id of targets) {
  console.log(`\n── ${id} ──`);
  const before = errors.length;
  await page.click(`.bird-card[data-bird="${id}"]`);
  await page.waitForTimeout(100);
  await page.click('#launch');

  await page.waitForFunction(() => window.AVES?.state === 'flying', null, { timeout: 180000 })
    .catch(() => {});
  const state = await page.evaluate(() => window.AVES?.state);
  expect('reaches flight', state === 'flying', state);
  if (state !== 'flying') {
    const msg = await page.textContent('#fatal-msg').catch(() => '');
    if (msg) log('fatal:', msg);
    break;
  }

  // Fly for a few seconds with a live input so the physics, streaming and
  // shaders all get exercised, not just the first frame.
  await page.evaluate(() => {
    const g = window.AVES;
    g._testT = 0;
    const orig = g.controls.update.bind(g.controls);
    g.controls.update = (dt) => {
      g._testT += dt;
      const t = g._testT;
      const out = orig(dt);
      out.roll = Math.sin(t * 0.7) * 0.8;
      out.pitch = Math.sin(t * 0.41) * 0.5;
      out.flap = (t % 2) < 0.8;
      out.tuck = t > 6 && t < 8 ? 1 : 0;
      return out;
    };
  });

  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, `10-${id}-a.png`) });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(SHOTS, `11-${id}-b.png`) });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(SHOTS, `12-${id}-c.png`) });

  const snap = await page.evaluate(() => {
    const g = window.AVES, f = g.flight, s = g.world.stats();
    return {
      pos: [f.position.x, f.position.y, f.position.z].map((v) => Math.round(v)),
      speed: Math.round(f.airspeed * 3.6),
      alt: Math.round(f.position.y - g.world.height(f.position.x, f.position.z)),
      state: f.state,
      stamina: +f.stamina.toFixed(2),
      finite: [f.position, f.velocity].every((v) => Number.isFinite(v.x + v.y + v.z)),
      fps: Math.round(g.fps),
      calls: g.renderer.info.render.calls,
      tris: g.renderer.info.render.triangles,
      patches: s.patches, trees: s.trees, buildings: s.buildings,
      assetFailures: g.assets.failures.slice(),
      distance: Math.round(f.distance),
      simTime: f.time,
    };
  });
  log(`pos ${snap.pos.join(', ')} · ${snap.speed} km/h · ${snap.alt} m agl · ${snap.state} · ${snap.fps} fps (software rasteriser)`);
  log(`${snap.calls} draw calls · ${(snap.tris / 1000).toFixed(0)}k tris · ${snap.patches} patches · ${snap.trees} trees · ${snap.buildings} buildings`);
  if (snap.assetFailures.length) log('asset failures:', snap.assetFailures.join(', '));

  expect('nothing went non-finite', snap.finite);
  // SwiftShader runs at a few frames a second and the physics loop caps how
  // much it will catch up in one frame, so only a second or two of flight
  // actually simulates in ten seconds of wall clock. What matters here is that
  // it moved and stayed sane, not how far.
  expect('the bird actually travelled', snap.distance > 8,
         `${snap.distance} m in ${snap.simTime.toFixed(1)} s of simulated flight`);
  expect('stayed above the ground', snap.alt > -5, `${snap.alt} m`);
  expect('geometry is being drawn', snap.tris > 20000, `${(snap.tris / 1000).toFixed(0)}k tris`);
  expect('terrain streamed in', snap.patches > 10, `${snap.patches} patches`);
  expect('no new console errors', errors.length === before,
        errors.slice(before).map((e) => e.slice(0, 160)).join(' | '));
  if (id === 'hawk' || id === 'condor') {
    expect('vegetation placed', snap.trees > 50, `${snap.trees} trees`);
  }
  if (id === 'pigeon') {
    expect('city built', snap.buildings > 100, `${snap.buildings} buildings`);
  }

  await page.evaluate(() => window.AVES.toMenu());
  await page.waitForTimeout(600);
}

console.log('\n── network ──');
console.log(`   ${fetched} fetched from upstream, ${served} served from the local cache`);

console.log('\n── console ──');
if (errors.length) {
  for (const e of [...new Set(errors)].slice(0, 25)) console.log('   ✗', e.slice(0, 300));
} else console.log('   ✓ no errors');
const notable = [...new Set(warnings)].filter((w) => !/deprecat|Multiple instances/i.test(w));
if (notable.length) for (const w of notable.slice(0, 12)) console.log('   ! ', w.slice(0, 220));

await browser.close();
server.close();

console.log(`\n${failed === 0 && errors.length === 0 ? '✓ smoke test passed' : `✗ ${failed} check(s) failed, ${errors.length} console error(s)`}\n`);
process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
