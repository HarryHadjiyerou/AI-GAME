// Titan trees: 150-380 m giants with real branch geometry you can fly under, between and through.
// Two species: a sequoia-like giant with a crown of limbs, and a banyan for the canyon oases with
// aerial roots hanging to the ground. Collision uses capsules (trunk, limbs, roots) and spheres (leaf clumps).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial, G } from '../core/shaderPatch.js';
import { mulberry32 } from '../core/noise.js';
import { leafTexture } from './trees.js';
import { lightAt } from './fields.js';

const V3 = THREE.Vector3;

function tube(points, r0, r1, radial = 8, seg = 8, uvScale = 1) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  // taper: rescale each ring around the curve
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const c = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      pos.setXYZ(k, c.x + nor.getX(k) * r, c.y + nor.getY(k) * r, c.z + nor.getZ(k) * r);
      uv.setXY(k, uv.getX(k) * 2, t * curve.getLength() * uvScale);
    }
  }
  return { geo: g, curve };
}

function leafClump(center, rx, ry, cards, rand, out) {
  for (let i = 0; i < cards; i++) {
    const v = new V3(rand() * 2 - 1, rand() * 1.4 - 0.5, rand() * 2 - 1).normalize();
    // lumpy clump: a few sub-lobes rather than one sphere
    const lobe = new V3(Math.sin(i * 2.1) * rx * 0.45, Math.cos(i * 1.3) * ry * 0.3, Math.cos(i * 2.9) * rx * 0.45);
    const p = center.clone().add(lobe).add(new V3(v.x * rx, v.y * ry, v.z * rx).multiplyScalar(0.3 + rand() * 0.5));
    const s = rx * (0.3 + rand() * 0.28);
    const a = new V3().crossVectors(v, new V3(rand() - 0.5, 1, rand() - 0.5)).normalize().multiplyScalar(s);
    const b = new V3().crossVectors(v, a).normalize().multiplyScalar(s);
    const P = [p.clone().sub(a).sub(b), p.clone().add(a).sub(b), p.clone().add(a).add(b), p.clone().sub(a).add(b)];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P.flatMap((q) => [q.x, q.y, q.z]), 3));
    const n = P.map((q) => { const d = q.clone().sub(center).normalize(); d.y += 0.5; return d.normalize(); });
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n.flatMap((d) => [d.x, d.y, d.z]), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    // darker underneath and in the core of the clump (cheap ambient occlusion)
    const hue = 0.85 + rand() * 0.3;
    const col = P.map((q) => { const up = (q.y - center.y) / ry; const o = q.distanceTo(center) / rx; const c = 0.18 + 0.42 * THREE.MathUtils.clamp(up * 0.5 + 0.5, 0, 1) + 0.4 * Math.min(1, o) ** 2; return [c * hue, c, c * (2 - hue) * 0.8]; });
    g.setAttribute('color', new THREE.Float32BufferAttribute(col.flat(), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    out.push(g);
  }
}

// Builds one species in unit height (H = 1). Returns bark + leaf geometry and collision primitives.
function buildSpecies(kind, seed) {
  const rand = mulberry32(seed);
  const bark = [], leaves = [], caps = [], spheres = [];
  const addCap = (a, b, r) => caps.push([a.x, a.y, a.z, b.x, b.y, b.z, r]);
  const banyan = kind === 'banyan';
  // trunk with flared roots
  const top = banyan ? 0.62 : 0.93;
  const tPts = [new V3(0, -0.02, 0), new V3(0.004, 0.2, 0), new V3(-0.006, 0.45, 0.004), new V3(0.004, top, 0)];
  const r0 = banyan ? 0.075 : 0.055, r1 = banyan ? 0.03 : 0.012;
  const trunk = tube(tPts, r0, r1, 18, 14, 18);
  // flare the base
  const tp = trunk.geo.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i), f = 1 + 1.6 * Math.exp(-y * 28) * (0.8 + 0.4 * Math.sin(Math.atan2(tp.getZ(i), tp.getX(i)) * 5));
    tp.setX(i, tp.getX(i) * f); tp.setZ(i, tp.getZ(i) * f);
  }
  bark.push(trunk.geo);
  for (let i = 0; i < 4; i++) { const a = tPts[Math.min(i, 3)], b = tPts[Math.min(i + 1, 3)]; if (a !== b) addCap(a, b, r0 + (r1 - r0) * (i / 3)); }
  addCap(new V3(0, 0, 0), new V3(0, 0.06, 0), r0 * 2.2);

  const limbs = banyan ? 9 : 8;
  for (let i = 0; i < limbs; i++) {
    const ang = (i / limbs) * Math.PI * 2 + rand() * 0.5;
    const y0 = banyan ? 0.42 + rand() * 0.18 : 0.38 + (i / limbs) * 0.42 + rand() * 0.05;
    const len = banyan ? 0.5 + rand() * 0.2 : (0.34 + rand() * 0.14) * (1.1 - (y0 - 0.38));
    const rise = banyan ? 0.12 + rand() * 0.1 : 0.25 + rand() * 0.2;
    const dir = new V3(Math.cos(ang), 0, Math.sin(ang));
    const a = new V3(0, y0, 0);
    const m = a.clone().addScaledVector(dir, len * 0.5).add(new V3(0, rise * 0.6, 0));
    const b = a.clone().addScaledVector(dir, len).add(new V3(0, rise, 0));
    const lr = banyan ? 0.02 : 0.016;
    bark.push(tube([a, m, b], lr, lr * 0.35, 8, 8, 18).geo);
    addCap(a, m, lr); addCap(m, b, lr * 0.6);
    // sub-branches ending in leaf clumps
    const subs = 3 + Math.floor(rand() * 2);
    for (let k = 0; k < subs; k++) {
      const t = 0.45 + (k / subs) * 0.55;
      const o = a.clone().lerp(b, t);
      const sa = ang + (rand() - 0.5) * 1.6;
      const sl = len * (0.3 + rand() * 0.25);
      const sd = new V3(Math.cos(sa), 0.45 + rand() * 0.5, Math.sin(sa)).normalize();
      const e = o.clone().addScaledVector(sd, sl);
      bark.push(tube([o, o.clone().lerp(e, 0.5).add(new V3(0, sl * 0.08, 0)), e], lr * 0.45, lr * 0.12, 6, 5, 18).geo);
      addCap(o, e, lr * 0.35);
      const rx = (banyan ? 0.13 : 0.1) * (0.8 + rand() * 0.4), ry = rx * 0.55;
      const c = e.clone().add(new V3(0, ry * 0.3, 0));
      leafClump(c, rx, ry, 56, rand, leaves);
      spheres.push([c.x, c.y, c.z, rx * 0.9]);
    }
    // banyan aerial roots dropping to the ground
    if (banyan) for (let k = 0; k < 3; k++) {
      const o = a.clone().lerp(b, 0.35 + k * 0.25);
      const g0 = new V3(o.x + (rand() - 0.5) * 0.02, -0.02, o.z + (rand() - 0.5) * 0.02);
      bark.push(tube([o, o.clone().lerp(g0, 0.5).add(new V3((rand() - 0.5) * 0.01, 0, 0)), g0], 0.004, 0.007, 6, 6, 18).geo);
      addCap(o, g0, 0.006);
    }
  }
  // crown top
  if (!banyan) {
    const c = new V3(0, 0.96, 0);
    leafClump(c, 0.09, 0.08, 60, rand, leaves);
    spheres.push([c.x, c.y, c.z, 0.08]);
  }
  return { bark: mergeGeometries(bark), leaves: mergeGeometries(leaves), caps, spheres };
}

export class Titans {
  constructor(scene, field, assets, quality, sunDir) {
    this.field = field;
    this.sun = sunDir;
    this.radius = { low: 5000, medium: 8000, high: 14000 }[quality];
    const cap = 120;
    const barkMat = patchMaterial(new THREE.MeshStandardMaterial({ map: assets.tex.bark_diff, normalMap: assets.tex.bark_nor, color: new THREE.Color(0xa87a62).multiplyScalar(2.4), roughness: 0.95 }), null, 'titanbark');
    const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.4, side: THREE.DoubleSide, vertexColors: true, roughness: 0.8, color: 0x5c7c46 });
    patchMaterial(leafMat, (sh) => {
      sh.uniforms.uTimeW = G.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTimeW;').replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
        vec3 ip = instanceMatrix[3].xyz;
        transformed.x += sin(uTimeW * 0.6 + ip.x * 0.01 + position.y * 3.0) * 0.004 * position.y;
        #endif`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.05;');
    }, 'titanleaf');
    this.species = ['giant', 'banyan'].map((k, i) => {
      const sp = buildSpecies(k, 17 + i * 31);
      const b = new THREE.InstancedMesh(sp.bark, barkMat, cap);
      const l = new THREE.InstancedMesh(sp.leaves, leafMat, cap);
      for (const m of [b, l]) { m.count = 0; m.frustumCulled = false; m.layers.enable(1); m.castShadow = quality === 'high'; scene.add(m); }
      b.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      l.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      return { ...sp, bark: b, leaves: l };
    });
    this.list = [];
    this.lastCell = '';
    this.lightCache = new Map();
  }

  update(cam) {
    const C = this.field.giantCell;
    const key = Math.floor(cam.x / C) + ':' + Math.floor(cam.z / C);
    if (key === this.lastCell) return;
    this.lastCell = key;
    const n = Math.ceil(this.radius / C);
    const ci = Math.floor(cam.x / C), cj = Math.floor(cam.z / C);
    this.list = [];
    const counts = [0, 0];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new V3(), col = new THREE.Color();
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      const g = this.field.giant(ci + i, cj + j);
      if (!g || Math.hypot(g.x - cam.x, g.z - cam.z) > this.radius) continue;
      const sp = g.oasis ? 1 : 0;
      const H = g.oasis ? 150 + g.s * 70 : 190 + g.s * 190;
      const rot = g.s * 40;
      const lk = (ci + i) + ':' + (cj + j);
      let lit = this.lightCache.get(lk);
      if (!lit) { lit = lightAt(this.field, this.sun, g.x, g.z, g.y + H * 0.5); this.lightCache.set(lk, lit); }
      const t = { x: g.x, y: g.y - 2, z: g.z, H, rot, sp, cos: Math.cos(rot), sin: Math.sin(rot) };
      this.list.push(t);
      const S = this.species[sp];
      const k = counts[sp]++;
      if (k >= S.bark.instanceMatrix.count) continue;
      q.setFromAxisAngle(new V3(0, 1, 0), rot);
      sc.set(H, H, H);
      m.compose(new V3(t.x, t.y, t.z), q, sc);
      S.bark.setMatrixAt(k, m); S.leaves.setMatrixAt(k, m);
      const v = 0.25 + 0.75 * (0.6 * lit[0] + 0.4 * lit[1]);
      col.setRGB(v, v, v);
      S.bark.setColorAt(k, col); S.leaves.setColorAt(k, col);
    }
    this.species.forEach((S, i) => {
      S.bark.count = S.leaves.count = Math.min(counts[i], S.bark.instanceMatrix.count);
      S.bark.instanceMatrix.needsUpdate = S.leaves.instanceMatrix.needsUpdate = true;
      S.bark.instanceColor.needsUpdate = S.leaves.instanceColor.needsUpdate = true;
    });
  }

  // Returns { hit: {n, push, landY} | null, brush: 0..1, near: distance to nearest wood (m) }
  collide(p, r) {
    let hit = null, brush = 0, near = Infinity;
    const a = new V3(), b = new V3(), lp = new V3(), cp = new V3();
    for (const t of this.list) {
      const dx = p.x - t.x, dz = p.z - t.z;
      if (dx * dx + dz * dz > (t.H * 0.8) ** 2 || p.y < t.y - 5 || p.y > t.y + t.H * 1.1) continue;
      // bird position in the tree's unit space
      lp.set((dx * t.cos - dz * t.sin) / t.H, (p.y - t.y) / t.H, (dx * t.sin + dz * t.cos) / t.H);
      const rr = r / t.H;
      const S = this.species[t.sp];
      for (const c of S.caps) {
        a.set(c[0], c[1], c[2]); b.set(c[3], c[4], c[5]);
        const ab = b.clone().sub(a);
        const tt = THREE.MathUtils.clamp(lp.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
        cp.copy(a).addScaledVector(ab, tt);
        const d = lp.distanceTo(cp);
        near = Math.min(near, (d - c[6]) * t.H);
        if (d < c[6] + rr) {
          const nl = lp.clone().sub(cp).normalize();
          // back to world space
          const n = new V3(nl.x * t.cos + nl.z * t.sin, nl.y, -nl.x * t.sin + nl.z * t.cos).normalize();
          const pen = (c[6] + rr - d) * t.H;
          const push = p.clone().addScaledVector(n, pen + 0.05);
          hit = { n, push, landY: n.y > 0.6 ? push.y : null };
        }
      }
      for (const s of S.spheres) {
        const d = Math.hypot(lp.x - s[0], lp.y - s[1], lp.z - s[2]);
        if (d < s[3]) brush = Math.max(brush, 1 - d / s[3]);
      }
    }
    return { hit, brush, near };
  }
}
