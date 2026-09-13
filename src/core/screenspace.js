/* ═══════════════════════════════════════════════════════════
   Screen-space lighting: reflections, shafts and contact shadows.

   There is no hardware ray tracing on the web. WebGL 2 has no
   concept of it, and it is not in WebGPU either — acceleration
   structures and ray queries would need bindless resources and a new
   API surface, and the working group has not committed to shipping
   them. The browser path tracers that do exist (three-gpu-pathtracer
   and friends) accumulate samples over seconds against a static
   scene, which is the opposite of a bird at eighty kilometres an hour.

   So this does the part that is actually available, and it is not a
   fake: it casts a real ray per pixel and marches it until it hits
   something. What it is allowed to hit is the depth buffer — the
   geometry the camera can already see — rather than a BVH over the
   whole world. Everything on screen reflects correctly; a cliff
   behind the camera cannot, and the reflection falls back to the
   analytic sky, which is the same sky function the dome and the water
   already use, so the seam is invisible.

   The trade the whole design turns on: the scene is drawn ONCE, into
   a colour+depth buffer, and the reflection is recovered from it
   afterwards. A planar reflection would mean drawing the world twice
   — the honest way to reflect off-screen geometry, and unaffordable
   on a phone.

   Finding the water costs nothing extra either. These surfaces are
   opaque, so the alpha channel of the scene buffer is never read by
   blending, and core/style.js writes a surface id into it. No second
   render target, and no converting every shader in the game to GLSL 3
   to get one.

   Two more effects live in this same pass, for one reason: they are
   all marches over the same depth buffer, and the buffer is the
   expensive thing to read, not the arithmetic between reads.

     • Shafts. Light through cloud and over a ridge, done as a march
       from each pixel towards the sun accumulating only what the
       depth buffer says is sky. It is what makes a low sun over a
       mountain read as a low sun over a mountain.
     • Contact shadows. A short march towards the sun asking whether
       anything in the depth buffer is in the way. It is not a shadow
       map and does not pretend to be one — it reaches metres, not
       kilometres — but metres is exactly the range where a missing
       shadow is most obvious: the dark under a tree, the seam where a
       wall meets the ground.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const P_DEFAULT = { steps: 40, refine: 5, dist: 900, stride: 1.6 };

const _dv = new THREE.Vector3();

/**
 * Where a direction lands on screen.
 *
 * Pulled out and exported because getting it wrong is silent: the shafts
 * simply never appear, and nothing anywhere reports an error. The first
 * version projected a point a hundred kilometres along the sun direction,
 * which is past the far plane of every camera in this game, so the projected
 * depth came back greater than one and the sun read as behind the camera at
 * all times. Projecting the DIRECTION — a vector with w = 0 — is the same
 * arithmetic with no position to fall off the end of the frustum.
 *
 * @param {THREE.Vector3} dir     unit direction in world space
 * @param {THREE.Camera}  camera
 * @param {{uv: THREE.Vector2, view: THREE.Vector3}} out
 * @returns {number} 1 while the direction is comfortably in frame, falling to
 *                   0 as it leaves it, and 0 outright when it is behind
 */
export function directionToScreen(dir, camera, out) {
  const dv = _dv.copy(dir).transformDirection(camera.matrixWorldInverse);
  if (out.view) out.view.copy(dv);

  const e = camera.projectionMatrix.elements;
  const w = e[3] * dv.x + e[7] * dv.y + e[11] * dv.z;
  // View space looks down -z, so w = -z is positive only in front.
  if (w <= 1e-6) { out.uv.set(0.5, 0.5); return 0; }

  const x = (e[0] * dv.x + e[4] * dv.y + e[8] * dv.z) / w * 0.5 + 0.5;
  const y = (e[1] * dv.x + e[5] * dv.y + e[9] * dv.z) / w * 0.5 + 0.5;
  out.uv.set(x, y);

  // Fade rather than switch: beams have to die as the sun leaves the frame,
  // not vanish between two frames when it crosses the edge.
  const outside = Math.max(Math.abs(x - 0.5), Math.abs(y - 0.5)) * 2;
  return Math.max(0, 1 - Math.max(0, outside - 1) / 0.6);
}

/* Surface ids, written into the spare alpha of the scene buffer.
 *
 * Quarters, because a half float stores them exactly and the shader can tell
 * them apart with a wide tolerance.
 *
 * These exist instead of a depth test, and the reason is worth recording. The
 * obvious way to ask "is this pixel sky" is to check whether its depth is at
 * the far plane. With this camera — a near plane at 0.12 m so a wing does not
 * clip, and a far plane at 42 km so a mountain range does not vanish — the
 * depth buffer has so little precision left past a kilometre that everything
 * beyond about 1100 m reads as the far plane. That is most of the sea. The
 * reflection pass ran correctly on the nearest tenth of the water and skipped
 * the rest, and nothing anywhere reported a problem. */
export const SURFACE = {
  /** Not tagged: transparent surfaces, which need their real alpha. */
  NONE: 0,
  /** The first-person wings, drawn through their own much wider camera. */
  OVERLAY: 0.25,
  WATER: 0.5,
  /** Everything opaque in the world: ground, trees, buildings, birds. */
  WORLD: 0.75,
  /** The sky dome, which writes a solid alpha of its own. */
  SKY: 1.0,
};

/** In the shader: anything at or above this is sky. */
const SKY_CUTOFF = 0.88;

const REFLECT_FRAG = /* glsl */`
  precision highp float;

  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform float uNear, uFar;
  uniform mat4  uProj, uInvProj, uView, uInvView;
  uniform float uIntensity, uRipple, uTime, uMaxDistance;
  uniform float uThickness, uStride;
  uniform int   uSteps, uRefine;

  // Shafts
  uniform vec2  uSunUv;          // where the sun is on screen
  uniform float uSunOnScreen;    // 0 when it is behind the camera
  uniform vec3  uShaftColor;
  uniform float uShaftStrength, uShaftDecay, uShaftSpread;
  uniform int   uShaftSteps;

  // Contact shadows
  uniform vec3  uSunView;        // sun direction in view space
  uniform float uContact, uContactLength;
  uniform int   uContactSteps;

  /* Debug views. Nothing here is visible in a build; it is the only way to
     see what a screen-space pass thinks it is doing, and every one of these
     answered a question that cost an hour to ask any other way.
       1 — surfaces the pass recognises (blue: water, green: the wings)
       2 — where the march found a hit (red), and where it gave up (blue)
       3 — the shaft term alone
       4 — the contact shadow term alone                                   */
  uniform int uDebug;

  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  /* Interleaved gradient noise.
   *
   * Used instead of a hash for the march offsets. A hash is white noise: over
   * a few dozen samples its average wanders, and the result is a sky full of
   * fine streaks pointing at the sun. This is high frequency but evenly
   * distributed across every small neighbourhood, so neighbouring pixels take
   * complementary samples and the average is right almost immediately. */
  float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
  }

  /** Depth buffer value to a positive distance along the view axis. */
  float linearDepth(float d) {
    float z = d * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  }

  /** Screen pixel and depth to a point in view space. */
  vec3 viewPosition(vec2 uv, float d) {
    vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec4 view = uInvProj * clip;
    return view.xyz / view.w;
  }

  /* ── shafts ─────────────────────────────────────────────
   *
   * March from this pixel towards the sun's position on screen, adding up
   * only the steps where the depth buffer says there is nothing — those are
   * the ones where light actually reaches the camera. The steps blocked by a
   * ridge or a wing contribute nothing, which is what carves the beams.
   *
   * Weighted down with distance so the glow sits around the sun rather than
   * washing the whole frame, and faded out as the sun leaves the screen so a
   * turn does not switch the beams off in one frame.
   */
  vec3 shafts(vec2 uv) {
    if (uShaftStrength < 0.001 || uSunOnScreen < 0.001) return vec3(0.0);

    vec2 delta = (uSunUv - uv);
    float reach = length(delta);
    // Nothing useful comes from marching a quarter of the screen per step.
    if (reach > uShaftSpread) return vec3(0.0);

    float steps = float(uShaftSteps);
    delta /= steps;
    // Dither the start so the march does not band into concentric rings.
    float jitter = ign(gl_FragCoord.xy);
    vec2 p = uv + delta * jitter;

    float weight = 1.0;
    float sum = 0.0;
    for (int i = 0; i < 40; i++) {
      if (i >= uShaftSteps) break;
      /* Only sky contributes. Everything else is an occluder, which is the
         whole mechanism — the beams are the gaps between the occluders. Read
         from the surface id rather than from depth: see SURFACE above for why
         the depth buffer cannot answer this question past a kilometre. */
      float sky = step(${SKY_CUTOFF.toFixed(2)}, texture2D(tScene, p).a);
      sum += sky * weight;
      weight *= uShaftDecay;
      p += delta;
    }
    sum /= steps;
    /* Raised to a power on purpose.
     *
     * Linear, a pixel whose path to the sun is completely open and one whose
     * path is half blocked differ by a factor of two, and the effect reads as
     * a warm wash over the entire frame rather than as light coming through
     * gaps. The gamma pushes the partly-blocked half down towards nothing and
     * leaves the fully open sky bright, which is what separates a beam from
     * its surroundings. */
    sum = pow(sum, 2.2);

    // Strongest looking into the sun, and gone as it slides off frame.
    float aim = 1.0 - smoothstep(0.0, uShaftSpread, reach);
    return uShaftColor * sum * aim * aim * uShaftStrength * uSunOnScreen;
  }

  /* ── contact shadows ────────────────────────────────────
   *
   * The world has no shadow maps. This is not a substitute for one and the
   * reach is deliberately short — a handful of metres — because that is the
   * range where the eye actually misses a shadow: where a thing meets the
   * thing it is standing on. Marched towards the sun in view space; if the
   * depth buffer has anything in the way, this pixel is in its shade.
   */
  float contactShadow(vec3 P, float sceneDepth) {
    if (uContact < 0.001) return 1.0;

    float steps = float(uContactSteps);
    float stride = uContactLength / steps;
    // Jitter, or the shadow terminator turns into a staircase.
    float jitter = ign(gl_FragCoord.xy + 23.7);
    vec3 p = P + uSunView * stride * (0.4 + jitter * 0.8);
    float occluded = 0.0;

    for (int i = 0; i < 24; i++) {
      if (i >= uContactSteps) break;
      vec4 clip = uProj * vec4(p, 1.0);
      vec2 uv = (clip.xy / clip.w) * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;

      float z = linearDepth(texture2D(tDepth, uv).x);
      float diff = -p.z - z;
      // In front of the ray by a plausible amount: a real occluder. Far in
      // front: a different object entirely, seen past the edge of this one.
      if (diff > 0.03 && diff < uContactLength * 1.2) {
        occluded = 1.0;
        break;
      }
      p += uSunView * stride;
    }

    // Fade the whole effect out with distance: at a kilometre a pixel covers
    // more ground than the shadow is long.
    float near = 1.0 - smoothstep(140.0, 600.0, sceneDepth);
    return 1.0 - occluded * uContact * near;
  }

  void main() {
    vec4 scene = texture2D(tScene, vUv);
    float d = texture2D(tDepth, vUv).x;
    vec3 col = scene.rgb;

    /* The wings are exempt from all of this.
     *
     * They are drawn into the same buffer through a much wider camera, so the
     * depth they leave behind is in a different projection from everything
     * else in it. Reading it as though it were the world's depth puts a
     * shadow across the near wing from geometry half a kilometre away. They
     * are tagged on the way in, and the tag is what keeps them out. */
    bool overlay = abs(scene.a - ${SURFACE.OVERLAY.toFixed(3)}) < 0.06;

    if (uDebug == 1) {
      bool isWater = abs(scene.a - ${SURFACE.WATER.toFixed(3)}) < 0.06;
      bool isWing = abs(scene.a - ${SURFACE.OVERLAY.toFixed(3)}) < 0.06;
      gl_FragColor = vec4(isWing ? 0.1 : 0.0, isWing ? 0.9 : 0.0,
                          isWater ? 0.9 : 0.0, 1.0);
      return;
    }
    if (uDebug == 3) {
      gl_FragColor = vec4(shafts(vUv) * 3.0, 1.0);
      return;
    }
    if (uDebug == 4) {
      float sh = 1.0;
      if (scene.a < ${SKY_CUTOFF.toFixed(2)}) { vec3 Pd = viewPosition(vUv, d); sh = contactShadow(Pd, -Pd.z); }
      gl_FragColor = vec4(vec3(sh), 1.0);
      return;
    }

    // Contact shadows first: they darken the surface, and the reflection
    // below is of the sky, which is not something a twig can shade.
    if (!overlay && scene.a < ${SKY_CUTOFF.toFixed(2)} && uContact > 0.001) {
      vec3 Pc = viewPosition(vUv, d);
      col *= contactShadow(Pc, -Pc.z);
    }
    if (overlay) { gl_FragColor = vec4(col + shafts(vUv), 1.0); return; }

    // The surface id lives in alpha. Anything that is not water skips the
    // march and goes straight to the shafts.
    if (abs(scene.a - ${SURFACE.WATER.toFixed(3)}) > 0.06 || uIntensity < 0.001) {
      gl_FragColor = vec4(col + shafts(vUv), 1.0);
      return;
    }
    scene.rgb = col;

    vec3 P = viewPosition(vUv, d);            // the point on the water
    vec3 V = normalize(P);                    // eye towards it, in view space

    /* The surface normal.
     *
     * Reflecting about the true wave normal would need it stored per pixel,
     * and there is nowhere left to put it without a second render target. So
     * the ray is reflected about the water PLANE — which is flat, and whose
     * normal is therefore known everywhere without storing anything — and the
     * ripple is applied as a perturbation. For a reflection of distant
     * geometry the difference is a wobble, which is what a wave does to a
     * reflection anyway. The sharp, normal-accurate part of the reflection is
     * the sky, and the water shader already does that exactly.
     */
    vec3 planeN = normalize((uView * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    vec3 world = (uInvView * vec4(P, 1.0)).xyz;
    vec2 rp = world.xz;
    vec2 wob = vec2(noise(rp * 0.36 + vec2(uTime * 0.9, uTime * 0.4)) - 0.5,
                    noise(rp * 0.95 - vec2(uTime * 1.5, uTime * 0.7)) - 0.5);
    // Perturb in world space, then bring it back — otherwise the ripple turns
    // with the head and the sea appears to swirl when you look around.
    /* The perturbation has to die off with distance for the same reason the
       water shader's does: out at the horizon one pixel covers many ripples,
       and a ray bent by a randomly chosen one of them hits something its
       neighbour misses. That is what speckles a reflection. */
    float rip = uRipple * (1.0 - smoothstep(70.0, 520.0, -P.z));
    vec3 wN = normalize(vec3(wob.x * rip, 1.0, wob.y * rip));
    vec3 N = normalize((uView * vec4(wN, 0.0)).xyz);
    N = normalize(mix(planeN, N, 0.85));

    vec3 R = normalize(reflect(V, N));
    // A ray heading into the water has nothing to find up here.
    if (dot(R, planeN) <= 0.0) { gl_FragColor = vec4(scene.rgb + shafts(vUv), 1.0); return; }

    /* ── the march ──────────────────────────────────────────
     *
     * Marched in view space and projected each step, rather than stepped
     * along the screen-space line. It costs one matrix multiply per step and
     * buys correct behaviour near the camera, where a screen-space line
     * covers wildly different amounts of world per pixel.
     *
     * The stride grows with distance: near the surface the reflection needs
     * precision, far away it needs reach, and a constant stride gives you
     * only one of the two. */
    float travelled = 0.0;
    float stride = uStride;
    bool  hit = false;
    vec2  hitUv = vec2(0.0);

    for (int i = 0; i < 64; i++) {
      if (i >= uSteps) break;

      travelled += stride;
      stride *= 1.16;
      if (travelled > uMaxDistance) break;

      vec3 Q = P + R * travelled;
      if (Q.z > -uNear) break;                 // stepped behind the eye

      vec4 clip = uProj * vec4(Q, 1.0);
      vec2 uv = (clip.xy / clip.w) * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;

      float sceneZ = linearDepth(texture2D(tDepth, uv).x);
      float rayZ = -Q.z;
      float delta = rayZ - sceneZ;

      // delta > 0 means the ray is now behind whatever the camera can see at
      // that pixel, so it passed through a surface between here and the last
      // step. uThickness rejects the case where it went behind something thin
      // and came out the far side — a ray that is a kilometre behind a tree
      // did not hit that tree.
      if (delta > 0.0 && delta < uThickness + stride) {
        /* Binary refinement. The march overshoots by design — big steps are
           what make the reach affordable — so the crossing is bracketed and
           then halved a few times to find where it actually happened. */
        float lo = travelled - stride / 1.16;
        float hi = travelled;
        for (int k = 0; k < 8; k++) {
          if (k >= uRefine) break;
          float mid = (lo + hi) * 0.5;
          vec3 M = P + R * mid;
          vec4 mc = uProj * vec4(M, 1.0);
          vec2 muv = (mc.xy / mc.w) * 0.5 + 0.5;
          float mz = linearDepth(texture2D(tDepth, muv).x);
          if (-M.z - mz > 0.0) hi = mid; else lo = mid;
        }
        vec3 H = P + R * hi;
        vec4 hc = uProj * vec4(H, 1.0);
        hitUv = (hc.xy / hc.w) * 0.5 + 0.5;
        hit = true;
        break;
      }
    }

    if (uDebug == 2) {
      gl_FragColor = hit ? vec4(1.0, 0.1, 0.1, 1.0) : vec4(0.0, 0.1, 0.6, 1.0);
      return;
    }
    if (!hit) { gl_FragColor = vec4(scene.rgb + shafts(vUv), 1.0); return; }

    vec4 reflected = texture2D(tScene, hitUv);
    // Never reflect the water back into itself: it produces a smeared copy of
    // the sea laid over the sea, which reads as grease on the lens.
    if (abs(reflected.a - ${SURFACE.WATER.toFixed(3)}) < 0.06) {
      gl_FragColor = vec4(scene.rgb + shafts(vUv), 1.0);
      return;
    }

    /* ── how much to believe it ─────────────────────────────
     *
     * Screen-space reflection is only ever as good as what is on screen, and
     * the honest thing to do at the edges of that is to fade back to the sky
     * the water shader already computed, rather than to smear the last valid
     * pixel. Three fades, all of them hiding the same failure. */
    vec2 edge = abs(hitUv - 0.5) * 2.0;
    float edgeFade = (1.0 - smoothstep(0.72, 1.0, edge.x))
                   * (1.0 - smoothstep(0.80, 1.0, edge.y));
    // Reflections of things a long way off are the least reliable and the
    // least missed.
    float rangeFade = 1.0 - smoothstep(uMaxDistance * 0.55, uMaxDistance, travelled);
    /* Rays that leave almost along the surface are the smeary ones — and they
     * are also the only ones that hit anything.
     *
     * A ray leaving the water steeply goes straight up into the sky and finds
     * nothing; every reflection of a cliff or a building arrives at a shallow
     * angle. The first version faded these out to avoid the smearing and the
     * result was a reflection pass that changed five pixels in a frame. So
     * this now only rejects rays within a couple of degrees of the surface,
     * where the hit really is a single stretched pixel. */
    float grazeFade = smoothstep(0.004, 0.030, dot(R, planeN));

    /* Fresnel again, computed here so the reflection arrives at exactly the
     * strength the water shader gave the sky it is replacing. */
    float cosTheta = clamp(dot(N, -V), 0.0, 1.0);
    float m = 1.0 - cosTheta;
    float fres = 0.02 + 0.98 * (m * m * m * m * m);

    float w = edgeFade * rangeFade * grazeFade * fres * uIntensity;
    vec3 out3 = mix(scene.rgb, reflected.rgb, clamp(w, 0.0, 1.0));
    gl_FragColor = vec4(out3 + shafts(vUv), 1.0);
  }
`;

const REFLECT_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Renders the scene into its own colour+depth buffer, then marches
 * reflections out of it and writes the result into the composer.
 *
 * It replaces the composer's RenderPass rather than sitting after one,
 * because the depth has to survive the pass that produced it and
 * EffectComposer's ping-pong buffers do not carry a depth texture.
 */
export class ScreenSpacePass extends Pass {
  constructor(scene, camera, { width = 1, height = 1, quality = 'high',
                               renderScale = 1 } = {}) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = true;
    this.clear = true;
    this.renderScale = renderScale;

    /** The extra scene drawn over the world — the first-person wings. */
    this.overlay = null;

    const depth = new THREE.DepthTexture(width, height);
    depth.type = THREE.UnsignedIntType;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;

    this.sceneRT = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthTexture: depth,
      depthBuffer: true,
      stencilBuffer: false,
    });

    this.uniforms = {
      tScene: { value: this.sceneRT.texture },
      tDepth: { value: depth },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uProj: { value: new THREE.Matrix4() },
      uInvProj: { value: new THREE.Matrix4() },
      uView: { value: new THREE.Matrix4() },
      uInvView: { value: new THREE.Matrix4() },
      uIntensity: { value: 1 },
      uRipple: { value: 0.13 },
      uTime: { value: 0 },
      uMaxDistance: { value: 900 },
      uThickness: { value: 14 },
      uStride: { value: 1.6 },
      uSteps: { value: 40 },
      uRefine: { value: 5 },

      uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
      uSunOnScreen: { value: 0 },
      uShaftColor: { value: new THREE.Color('#ffd9a8') },
      uShaftStrength: { value: 0.55 },
      // Per-step falloff. Below about 0.96 the beams stop before they have
      // travelled far enough to look like beams.
      uShaftDecay: { value: 0.975 },
      // How far across the frame a beam may reach, in UV. Beyond this the
      // march is sampling a different part of the sky than it started in.
      uShaftSpread: { value: 0.42 },
      uShaftSteps: { value: 28 },

      uSunView: { value: new THREE.Vector3(0, 1, 0) },
      uContact: { value: 0.55 },
      uContactLength: { value: 3.4 },
      uContactSteps: { value: 12 },
      uDebug: { value: 0 },
    };

    /** World-space direction towards the sun. */
    this.sunDir = new THREE.Vector3(0.4, 0.5, 0.7).normalize();

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: REFLECT_VERT,
      fragmentShader: REFLECT_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this._quad = new FullScreenQuad(this.material);
    /* Kept separately from the uniforms so a tier change cannot forget the
       art direction: the tier decides how many steps, these decide how much. */
    this.shaftStrength = 0.55;
    this.contactStrength = 0.55;
    this.setQuality(quality);
  }

  /**
   * Step count and reach, by tier.
   *
   * The march is the only thing here whose cost scales with anything, and it
   * scales with steps alone, so this is the whole quality story: how far a
   * ray is allowed to look before the sky takes over.
   */
  setQuality(tier) {
    const P = {
      off:    { steps: 0,  refine: 0, dist: 0,    stride: 2.0, shaft: 0,  contact: 0,  clen: 0 },
      low:    { steps: 16, refine: 3, dist: 260,  stride: 2.8, shaft: 14, contact: 0,  clen: 0 },
      medium: { steps: 26, refine: 4, dist: 520,  stride: 2.2, shaft: 20, contact: 8,  clen: 2.6 },
      high:   { steps: 40, refine: 5, dist: 900,  stride: 1.6, shaft: 28, contact: 12, clen: 3.4 },
      ultra:  { steps: 56, refine: 6, dist: 1600, stride: 1.2, shaft: 36, contact: 18, clen: 4.5 },
    }[tier] ?? P_DEFAULT;
    const u = this.uniforms;
    u.uSteps.value = P.steps;
    u.uRefine.value = P.refine;
    u.uMaxDistance.value = P.dist;
    u.uStride.value = P.stride;
    u.uShaftSteps.value = P.shaft;
    u.uShaftStrength.value = P.shaft > 0 ? this.shaftStrength : 0;
    u.uContactSteps.value = P.contact;
    u.uContact.value = P.contact > 0 ? this.contactStrength : 0;
    u.uContactLength.value = P.clen;
    this.tier = tier;
    return P;
  }

  /**
   * EffectComposer calls this with the canvas size, not the render size, and
   * it calls it after anything else has had a go — so the scale has to be
   * applied here rather than passed in, or the scene quietly gets drawn at
   * full resolution however low the quality setting is.
   */
  /**
   * The sun: where the shafts come from and what colour they are.
   * Direction points towards it, in world space.
   */
  /** See uDebug in the shader. 0 in anything anyone plays. */
  setDebug(mode) { this.uniforms.uDebug.value = mode | 0; }

  setSun(dir, color) {
    if (dir) this.sunDir.copy(dir).normalize();
    if (color) this.uniforms.uShaftColor.value.copy(color);
  }

  setSize(width, height) {
    const w = Math.max(1, Math.floor(width * this.renderScale));
    const h = Math.max(1, Math.floor(height * this.renderScale));
    if (w === this.sceneRT.width && h === this.sceneRT.height) return;
    this.sceneRT.setSize(w, h);
  }

  render(renderer, writeBuffer, readBuffer, deltaTime) {
    const cam = this.camera;

    /* autoClear has to be off for the whole of this.
     *
     * It defaults to on, and with it on the second render — the wings — wipes
     * the colour buffer the world was just drawn into and the frame comes back
     * with nothing in it but a pair of wings on black. three's own RenderPass
     * turns it off for exactly this reason; taking RenderPass out of the chain
     * took that with it. Saved and restored because the menu planet shares
     * this renderer and does want its clear. */
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;

    // ── draw the world once, keeping its depth ──
    renderer.setRenderTarget(this.sceneRT);
    renderer.clear(true, true, true);
    renderer.render(this.scene, cam);

    // The wings, over the finished world through their own much wider cone.
    // Depth is cleared first so they are never occluded by terrain half a
    // kilometre away; colour is not, so the world shows through.
    if (this.overlay) {
      renderer.clearDepth();
      renderer.render(this.overlay.scene, this.overlay.camera);
    }
    renderer.autoClear = autoClear;

    // ── recover the lighting ──
    const u = this.uniforms;
    u.uTime.value += deltaTime ?? 0.016;
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
    u.uProj.value.copy(cam.projectionMatrix);
    u.uInvProj.value.copy(cam.projectionMatrixInverse);
    u.uView.value.copy(cam.matrixWorldInverse);
    u.uInvView.value.copy(cam.matrixWorld);

    // Where the sun is, on screen and in view space.
    u.uSunOnScreen.value = directionToScreen(this.sunDir, cam, {
      uv: u.uSunUv.value,
      view: u.uSunView.value,
    });

    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this._quad.render(renderer);
    void readBuffer;
  }

  dispose() {
    this.sceneRT.dispose();
    this.sceneRT.depthTexture?.dispose();
    this.material.dispose();
    this._quad.dispose();
  }
}
