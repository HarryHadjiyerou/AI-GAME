/* Static checks that catch the mistakes this codebase actually makes.

   Two of them, both learned the hard way:

     • a backtick inside a /* glsl *​/ template literal silently ends the
       string, and the error surfaces as a JavaScript syntax error hundreds
       of lines away with no mention of shaders at all
     • GLSL ES 3.00 reserves words that read as perfectly ordinary variable
       names — `flat`, `sample`, `filter`, `input`, `output` — and the
       failure only appears when that one material first compiles, which may
       be in the fourth world the player visits

   Both are cheap to find and expensive to debug, so they get a linter. */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = execSync('find src tools -name "*.js" -o -name "*.mjs"', { cwd: ROOT })
  .toString().trim().split('\n').filter(Boolean);

let problems = 0;
const fail = (f, msg) => { console.log(`   ✗ ${f}: ${msg}`); problems++; };

console.log('\n════ AVES lint ════\n');

/* ── 1. every module must parse as ESM ──────────────────── */
console.log('── syntax ──');
const tmp = fs.mkdtempSync('/tmp/aves-lint-');
for (const f of files) {
  const dst = path.join(tmp, f.replace(/[\/]/g, '_').replace(/\.js$/, '.mjs'));
  fs.copyFileSync(path.join(ROOT, f), dst);
  try {
    execSync(`node --check ${JSON.stringify(dst)}`, { stdio: 'pipe' });
  } catch (e) {
    fail(f, (e.stderr?.toString() ?? '').split('\n').find((l) => l.includes('Error')) ?? 'parse error');
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
if (!problems) console.log('   ✓ all modules parse');

/* ── 2. GLSL hygiene ────────────────────────────────────── */
console.log('\n── shaders ──');
const RESERVED = [
  'flat', 'smooth', 'noperspective', 'sample', 'filter', 'active', 'input',
  'output', 'layout', 'precise', 'resource', 'patch', 'subroutine', 'common',
  'partition', 'buffer', 'shared', 'packed', 'row_major', 'attribute',
  'varying', 'texture', 'namespace', 'using', 'cast',
];
const TYPES = '(?:float|int|uint|bool|vec[234]|ivec[234]|bvec[234]|mat[234]|mat[234]x[234])';

let blocks = 0;
const before = problems;
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const re = /\/\* glsl \*\/`([\s\S]*?)`/g;
  let m;
  while ((m = re.exec(src))) {
    blocks++;
    const glsl = m[1];
    const line0 = src.slice(0, m.index).split('\n').length;

    for (const w of RESERVED) {
      const decl = new RegExp(`\\b${TYPES}\\s+${w}\\b`);
      if (decl.test(glsl)) {
        const off = glsl.split('\n').findIndex((l) => decl.test(l));
        fail(f, `line ~${line0 + off}: declares '${w}', which GLSL ES 3.00 reserves`);
      }
    }
  }

  // A stray backtick ends a template literal early; an odd count is the tell.
  // Only for engine source: this file's own prose is full of them, and the
  // syntax check above already proves whether a file is balanced.
  if (f.startsWith('src/')) {
    const ticks = (src.match(/`/g) || []).length;
    if (ticks % 2) fail(f, `odd number of backticks (${ticks}) — a template literal is unbalanced`);
  }
}
if (problems === before) console.log(`   ✓ ${blocks} shader blocks clean`);

console.log(`\n${problems === 0 ? '✓ lint passed' : `✗ ${problems} problem(s)`}\n`);
process.exit(problems === 0 ? 0 : 1);
