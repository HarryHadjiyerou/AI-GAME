/* ═══════════════════════════════════════════════════════════
   Other birds.

   This is where the downloaded GLB models earn their keep. Flamingo,
   Parrot and Stork from the three.js sample set are morph-target
   animated whole birds — no skeleton to pose, but a clean baked
   wingbeat and a readable silhouette, which is exactly what you want
   for something 200 metres away and slightly below you.

   Each bird gets its own mixer (morph influences cannot be shared) and
   flies a lazy circuit that wraps around the player, so the sky is
   never empty and you always have something to judge your own speed
   and scale against.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { rng, clamp, damp } from '../core/noise.js';

export class Flock {
  /**
   * @param {object} model  { scene, animations } from Assets.birdModel()
   */
  constructor(atmo, model, opts = {}) {
    this.group = new THREE.Group();
    this.birds = [];
    this.mixers = [];
    this.height = opts.height ?? (() => 0);
    this.radius = opts.radius ?? 900;
    this.altitude = opts.altitude ?? [60, 340];
    this.scale = opts.scale ?? 1;
    if (!model?.scene) return;

    const r = rng(opts.seed ?? 808);
    const count = opts.count ?? 9;

    for (let i = 0; i < count; i++) {
      const obj = model.scene.clone(true);
      obj.traverse((o) => {
        if (!o.isMesh) return;
        const m = o.material.clone();
        m.color?.multiplyScalar(opts.tint ?? 1);
        m.roughness = 0.85;
        m.metalness = 0;
        atmo.patch(m, { tag: 'flock' });
        o.material = m;
        o.frustumCulled = false;
        // The sample models are built at roughly 100× life size.
        o.castShadow = false;
      });
      const s = this.scale * (0.75 + r() * 0.6) * 0.012;
      obj.scale.setScalar(s);

      const mixer = new THREE.AnimationMixer(obj);
      if (model.animations?.length) {
        const act = mixer.clipAction(model.animations[0]);
        act.play();
        act.time = r() * 3;
        mixer.timeScale = 0.75 + r() * 0.7;
      }
      this.mixers.push(mixer);

      this.birds.push({
        obj,
        // A slow drifting circuit, each bird on its own circle.
        cx: (r() - 0.5) * this.radius * 2,
        cz: (r() - 0.5) * this.radius * 2,
        rad: 90 + r() * 420,
        phase: r() * Math.PI * 2,
        speed: (0.12 + r() * 0.22) * (r() < 0.5 ? -1 : 1),
        alt: this.altitude[0] + r() * (this.altitude[1] - this.altitude[0]),
        bob: r() * 6.28,
        y: 0,
      });
      this.group.add(obj);
    }
  }

  update(camPos, dt) {
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      this.mixers[i].update(dt);
      b.phase += b.speed * dt;

      // Wrap the whole circuit around the player so they are always about.
      const tile = this.radius * 2;
      let ox = b.cx - camPos.x, oz = b.cz - camPos.z;
      ox = ((ox + tile * 1.5) % tile + tile) % tile - tile * 0.5;
      oz = ((oz + tile * 1.5) % tile + tile) % tile - tile * 0.5;

      const x = camPos.x + ox + Math.cos(b.phase) * b.rad;
      const z = camPos.z + oz + Math.sin(b.phase) * b.rad;
      const ground = this.height(x, z);
      const want = ground + b.alt + Math.sin(b.bob + b.phase * 3.1) * 12;
      b.y = b.y === 0 ? want : damp(b.y, want, 0.8, dt);

      b.obj.position.set(x, b.y, z);
      // Face along the tangent of the circle, and bank into it.
      b.obj.rotation.set(0, -b.phase + (b.speed > 0 ? -Math.PI / 2 : Math.PI / 2), 0);
      b.obj.rotation.z = clamp(b.speed * 1.6, -0.5, 0.5);
    }
  }

  dispose() {
    this.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    this.group.removeFromParent();
  }
}
