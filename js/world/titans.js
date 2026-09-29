// Titan trees: 150-380 m giants with real branch geometry you can fly under, between and through.
// Two Blender-built species (tools/trees): a broad-crowned giant, and a banyan for the canyon oases with
// prop roots dropping to the ground. Collision uses capsules (trunk, limbs, roots) and spheres (leaf clumps).
import * as THREE from 'three';
import { foliageMaterial, barkMaterial } from './treeAssets.js';
import { lightAt } from './fields.js';

const V3 = THREE.Vector3;
const LOD_DIST = 1600; // beyond this the titans use their thinned LOD1 meshes

export class Titans {
  constructor(scene, field, assets, quality, sunDir) {
    this.field = field;
    this.sun = sunDir;
    this.radius = { low: 5000, medium: 8000, high: 14000 }[quality];
    const cap = 120;
    const A = assets.trees;
    this.species = ['titan_giant', 'titan_banyan'].map((name) => {
      const sp = A.species[name];
      const bm = barkMaterial(A, name, 'bark_' + name);
      const lm = foliageMaterial(A, name, null, 'fol_' + name, 0.35);
      const mk = (geo, mat) => {
        const m = new THREE.InstancedMesh(geo, mat, cap);
        m.count = 0; m.visible = false; m.frustumCulled = false; m.layers.enable(1); m.castShadow = quality === 'high';
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        scene.add(m);
        return m;
      };
      // collision: capsules (x0,y0,z0,x1,y1,z1,r) and leaf-clump spheres (x,y,z,r) in unit-height tree space
      return { caps: sp.meta.caps, spheres: sp.meta.spheres, lod: [[mk(sp.bark0, bm), mk(sp.fol0, lm)], [mk(sp.bark1, bm), mk(sp.fol1, lm)]] };
    });
    this.list = [];
    this.lastCell = '';
    this.lastLod = new V3(1e9, 0, 0);
    this.lightCache = new Map();
  }

  update(cam) {
    const C = this.field.giantCell;
    const key = Math.floor(cam.x / C) + ':' + Math.floor(cam.z / C);
    if (key === this.lastCell && cam.distanceTo(this.lastLod) < 150) return;
    if (key !== this.lastCell) this.collect(cam, key);
    this.lastLod.copy(cam);
    const counts = [[0, 0], [0, 0]];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new V3(), col = new THREE.Color(), up = new V3(0, 1, 0);
    for (const t of this.list) {
      const L = Math.hypot(t.x - cam.x, t.z - cam.z) < LOD_DIST + t.H * 2 ? 0 : 1;
      const S = this.species[t.sp];
      const k = counts[L][t.sp];
      if (k >= S.lod[L][0].instanceMatrix.count) continue;
      q.setFromAxisAngle(up, t.rot);
      sc.set(t.H, t.H, t.H);
      m.compose(new V3(t.x, t.y, t.z), q, sc);
      const v = 0.25 + 0.75 * (0.6 * t.lit[0] + 0.4 * t.lit[1]);
      col.setRGB(v, v, v);
      for (const mesh of S.lod[L]) { mesh.setMatrixAt(k, m); mesh.setColorAt(k, col); }
      counts[L][t.sp]++;
    }
    this.species.forEach((S, i) => S.lod.forEach((pair, L) => pair.forEach((mesh) => {
      mesh.count = counts[L][i];
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    })));
  }

  collect(cam, key) {
    this.lastCell = key;
    const C = this.field.giantCell;
    const n = Math.ceil(this.radius / C);
    const ci = Math.floor(cam.x / C), cj = Math.floor(cam.z / C);
    this.list = [];
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      const g = this.field.giant(ci + i, cj + j);
      if (!g || Math.hypot(g.x - cam.x, g.z - cam.z) > this.radius) continue;
      const sp = g.oasis ? 1 : 0;
      const H = g.oasis ? 150 + g.s * 70 : 190 + g.s * 190;
      const rot = g.s * 40;
      const lk = (ci + i) + ':' + (cj + j);
      let lit = this.lightCache.get(lk);
      if (!lit) { lit = lightAt(this.field, this.sun, g.x, g.z, g.y + H * 0.5); this.lightCache.set(lk, lit); }
      this.list.push({ x: g.x, y: g.y - 2, z: g.z, H, rot, sp, lit, cos: Math.cos(rot), sin: Math.sin(rot) });
    }
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
