/* ═══════════════════════════════════════════════════════════
   Sky, light and cloudscape.

   The HDRI does the heavy lifting — it is both the backdrop and the
   image-based light, so a bird's white underside picks up the colour
   of the water beneath it for free. On top of that:

     • a matched directional sun for shadows and specular
     • a drifting field of billboard cumulus that wraps endlessly
       around the bird in the vertex shader (no CPU cost per puff)
     • an optional cloud deck the condor can climb through
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { Noise, rng, clamp } from '../core/noise.js';

const CLOUD_VERT = /* glsl */`
  precision highp float;

  uniform vec3  uCamPos;
  uniform float uPlanetRadius;
  uniform float uTime;
  uniform vec2  uTile;        // wrap period in x / z
  uniform vec3  uDrift;       // wind
  uniform float uFade;        // distance at which puffs dissolve

  attribute vec3  iPos;
  attribute vec2  iScale;
  attribute float iRot;
  attribute float iSeed;
  attribute float iOpacity;

  varying vec2  vUv;
  varying float vAlpha;
  varying vec3  vWorld;
  varying float vSeed;
  varying float vDepth;

  void main() {
    // Endless field: fold each instance into the tile centred on the bird.
    vec3 p = iPos + uDrift * uTime;
    vec2 rel = p.xz - uCamPos.xz;
    rel = mod(rel + uTile * 0.5, uTile) - uTile * 0.5;
    vec3 world = vec3(uCamPos.x + rel.x, p.y, uCamPos.z + rel.y);

    float dist = length(world - uCamPos);
    vAlpha = iOpacity * smoothstep(uFade, uFade * 0.55, dist)
                      * smoothstep(12.0, 90.0, dist);   // don't slap the camera

    // Planet curvature, same bend as the terrain uses.
    vec2 d = world.xz - uCamPos.xz;
    world.y -= dot(d, d) / (2.0 * uPlanetRadius);
    vWorld = world;

    vec4 mv = viewMatrix * vec4(world, 1.0);
    float c = cos(iRot), s = sin(iRot);
    vec2 corner = vec2(
      position.x * c - position.y * s,
      position.x * s + position.y * c
    ) * iScale;
    mv.xy += corner;

    vUv = uv;
    vSeed = iSeed;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const CLOUD_FRAG = /* glsl */`
  precision highp float;

  uniform sampler2D uMap;
  uniform vec3  uSunDir;
  uniform vec3  uLit;
  uniform vec3  uShade;
  uniform vec3  uCamPos;
  uniform vec3  uFogColor;
  uniform vec3  uFogSunColor;
  uniform float uFogDensity;
  uniform float uFogPower;
  uniform float uFogMax;

  varying vec2  vUv;
  varying float vAlpha;
  varying vec3  vWorld;
  varying float vSeed;
  varying float vDepth;

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float a = tex.a * vAlpha;
    if (a < 0.004) discard;

    vec3 vdir = normalize(vWorld - uCamPos);

    // Fake single-scatter: the sun-facing side of the puff is bright, the
    // rim glows when you look towards the sun through it.
    float toSun = max(dot(vdir, uSunDir), 0.0);
    float rim = pow(toSun, 6.0) * pow(1.0 - tex.a, 1.6);
    float body = tex.r;                       // baked top-lighting in the sprite

    vec3 col = mix(uShade, uLit, clamp(body * 0.85 + rim * 0.9, 0.0, 1.0));
    col += uFogSunColor * rim * 0.55;

    // Match the terrain's aerial perspective so the far cloud bank sits
    // in the same air as the far mountains.
    float f = clamp(1.0 - exp(-pow(max(vDepth, 0.0) * uFogDensity, uFogPower)), 0.0, uFogMax);
    vec3 fogCol = mix(uFogColor, uFogSunColor, pow(toSun, 6.0) * 0.85);
    col = mix(col, fogCol, f * 0.9);

    // Linear output: the composer's float target is tone-mapped once, at the
    // end of the chain, by OutputPass.
    gl_FragColor = vec4(col, a);
  }
`;

export class Clouds {
  /**
   * @param {object} opts
   * @param {number} opts.count      puff instances
   * @param {[number,number]} opts.altitude   base height range
   * @param {number} opts.tile       wrap period in metres
   */
  constructor(atmo, puffTexture, opts = {}) {
    this.atmo = atmo;
    const count = opts.count ?? 900;
    const tile = opts.tile ?? 9000;
    const [altLo, altHi] = opts.altitude ?? [700, 1500];
    const clusters = opts.clusters ?? Math.max(8, Math.round(count / 22));
    const puffSize = opts.size ?? [260, 520];
    const r = rng(opts.seed ?? 99);
    const noise = new Noise(opts.seed ?? 99);

    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    geo.instanceCount = count;

    const iPos = new Float32Array(count * 3);
    const iScale = new Float32Array(count * 2);
    const iRot = new Float32Array(count);
    const iSeed = new Float32Array(count);
    const iOpacity = new Float32Array(count);

    // Puffs are grouped into clusters so they read as individual clouds
    // rather than an even fog of sprites.
    const perCluster = Math.ceil(count / clusters);
    let n = 0;
    for (let c = 0; c < clusters && n < count; c++) {
      const cxPos = (r() - 0.5) * tile;
      const czPos = (r() - 0.5) * tile;
      const cy = altLo + (altHi - altLo) * r();
      const spreadX = 220 + r() * 900;
      const spreadY = 60 + r() * 190;
      const density = 0.55 + 0.45 * (0.5 + 0.5 * noise.simplex2(cxPos * 0.001, czPos * 0.001));
      for (let k = 0; k < perCluster && n < count; k++, n++) {
        const t = k / perCluster;
        const ang = r() * Math.PI * 2;
        const rad = Math.pow(r(), 0.6);
        iPos[n * 3]     = cxPos + Math.cos(ang) * rad * spreadX;
        iPos[n * 3 + 1] = cy + (r() - 0.5) * spreadY * (1 - rad * 0.6);
        iPos[n * 3 + 2] = czPos + Math.sin(ang) * rad * spreadX * 0.8;
        const s = puffSize[0] + (puffSize[1] - puffSize[0]) * (1 - rad * 0.55) * (0.6 + 0.7 * r());
        iScale[n * 2]     = s;
        iScale[n * 2 + 1] = s * (0.52 + 0.30 * r());
        iRot[n] = r() * Math.PI * 2;
        iSeed[n] = r() * 100;
        iOpacity[n] = clamp((0.30 + 0.55 * (1 - rad)) * density, 0, 1) * (opts.opacity ?? 1);
        void t;
      }
    }

    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
    geo.setAttribute('iScale', new THREE.InstancedBufferAttribute(iScale, 2));
    geo.setAttribute('iRot', new THREE.InstancedBufferAttribute(iRot, 1));
    geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(iSeed, 1));
    geo.setAttribute('iOpacity', new THREE.InstancedBufferAttribute(iOpacity, 1));

    this.uniforms = {
      uMap:   { value: puffTexture },
      uTime:  { value: 0 },
      uTile:  { value: new THREE.Vector2(tile, tile) },
      uDrift: { value: new THREE.Vector3(...(opts.drift ?? [3.5, 0, 1.2])) },
      uFade:  { value: opts.fade ?? 11000 },
      uLit:   { value: new THREE.Color(opts.lit ?? '#ffffff') },
      uShade: { value: new THREE.Color(opts.shade ?? '#8d9cb4') },
      uCamPos: atmo.u.uCamPos,
      uPlanetRadius: atmo.u.uPlanetRadius,
      uSunDir: atmo.u.uSunDir,
      uFogColor: atmo.u.uFogColor,
      uFogSunColor: atmo.u.uFogSunColor,
      uFogDensity: atmo.u.uFogDensity,
      uFogPower: atmo.u.uFogPower,
      uFogMax: atmo.u.uFogMax,
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    base.dispose();
  }

  update(dt) { this.uniforms.uTime.value += dt; }
  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}

/* ═══════════════════════════════════════════════════════════ */

/**
 * Sun + fill light matched to the HDRI. The direction is taken from the
 * world definition rather than analysed from the image — cheaper, and it
 * lets each world be art-directed.
 */
export class SkyLight {
  constructor(scene, atmo, opts = {}) {
    this.scene = scene;
    this.atmo = atmo;

    this.sun = new THREE.DirectionalLight(
      new THREE.Color(opts.sunColor ?? '#fff2df'),
      opts.sunIntensity ?? 2.6
    );
    this.sun.position.copy(opts.sunDir ?? new THREE.Vector3(0.5, 0.6, 0.4)).multiplyScalar(1000);
    this.sunTarget = new THREE.Object3D();
    scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;
    scene.add(this.sun);

    this.hemi = new THREE.HemisphereLight(
      new THREE.Color(opts.skyColor ?? '#a9c8e8'),
      new THREE.Color(opts.groundColor ?? '#3a3427'),
      opts.hemiIntensity ?? 0.35
    );
    scene.add(this.hemi);

    this.shadowRange = opts.shadowRange ?? 260;
    this.setShadows(opts.shadows ?? false, opts.shadowSize ?? 1024);
  }

  setShadows(on, size = 1024) {
    this.sun.castShadow = !!on;
    if (!on) return;
    const s = this.shadowRange;
    const c = this.sun.shadow.camera;
    c.left = -s; c.right = s; c.top = s; c.bottom = -s;
    c.near = 1; c.far = s * 6;
    c.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.6;
  }

  /** Keep the shadow frustum wrapped around the bird. */
  update(camPos) {
    this.sunTarget.position.copy(camPos);
    this.sunTarget.updateMatrixWorld();
    this.sun.position.copy(camPos).addScaledVector(this.atmo.u.uSunDir.value, this.shadowRange * 3);
    this.sun.updateMatrixWorld();
  }

  dispose() {
    this.scene.remove(this.sun, this.hemi, this.sunTarget);
    this.sun.dispose(); this.hemi.dispose();
  }
}
