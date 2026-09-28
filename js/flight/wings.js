// First-person feathered wings. A 3-bone arm (humerus, forearm, hand) drives ~60 feathers per wing:
// primaries fan from the hand, secondaries/tertials trail the forearm, coverts layer over the top.
import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';

const V3 = THREE.Vector3;

function featherAtlas(w) {
  // 4 columns: primary, secondary, covert, marginal.  Feather length runs along +x (u).
  const W = 1024, H = 256, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const rand = mulberry32(5);
  const draw = (col, kind) => {
    const x0 = col * 256, cy = H / 2;
    g.save();
    g.beginPath();
    // vane outline: narrow leading vane, wider trailing vane, rounded / pointed tip
    const L = 250, wLead = kind === 0 ? 40 : 52, wTrail = kind === 0 ? 84 : 76;
    g.moveTo(x0 + 3, cy);
    g.bezierCurveTo(x0 + L * 0.3, cy - wLead, x0 + L * 0.85, cy - wLead * 1.05, x0 + L, cy - 2);
    g.bezierCurveTo(x0 + L * 0.9, cy + wTrail * 1.1, x0 + L * 0.3, cy + wTrail, x0 + 3, cy + 6);
    g.closePath();
    g.clip();
    // base colour gradient base -> tip
    const grd = g.createLinearGradient(x0, 0, x0 + L, 0);
    const baseC = kind >= 2 ? w.color1 : kind === 1 ? w.color2 : w.color1;
    grd.addColorStop(0, w.color2);
    grd.addColorStop(0.35, baseC);
    grd.addColorStop(kind === 0 ? 0.7 : 0.85, baseC);
    grd.addColorStop(1, kind === 0 || (kind === 1 && w.spots) ? w.tip : baseC);
    g.fillStyle = grd;
    g.fillRect(x0, 0, 256, H);
    if (w.whitePatch && kind === 1) { g.fillStyle = 'rgba(235,230,220,0.92)'; g.fillRect(x0 + 40, 0, 200, H); }
    if (w.whitePatch && kind === 2) { g.fillStyle = 'rgba(235,230,220,0.85)'; g.fillRect(x0 + 60, 0, 200, H); }
    if (w.spots && kind === 0) { g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.ellipse(x0 + L * 0.9, cy + 8, 14, 10, 0, 0, 7); g.fill(); }
    // bars (hawk barring, pigeon wing bars)
    if (w.bars) {
      g.fillStyle = 'rgba(20,14,10,0.45)';
      const n = kind === 0 ? 6 : kind === 1 ? 5 : 2;
      for (let i = 0; i < n; i++) g.fillRect(x0 + 40 + i * (200 / n), 0, 9 + rand() * 5, H);
    }
    // barbs
    g.globalAlpha = 0.22;
    for (let i = 0; i < 90; i++) {
      const bx = x0 + 10 + i * 2.7;
      g.strokeStyle = i % 2 ? '#000' : '#fff';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(bx, cy); g.lineTo(bx + 22, cy - 90); g.stroke();
      g.beginPath(); g.moveTo(bx, cy); g.lineTo(bx + 30, cy + 110); g.stroke();
    }
    g.globalAlpha = 1;
    // iridescent sheen for pigeon coverts
    if (w.iridescent && kind === 3) { const ig = g.createLinearGradient(x0, 0, x0 + 256, H); ig.addColorStop(0, 'rgba(90,160,120,0.35)'); ig.addColorStop(1, 'rgba(140,90,170,0.35)'); g.fillStyle = ig; g.fillRect(x0, 0, 256, H); }
    g.restore();
    // rachis (shaft)
    g.strokeStyle = 'rgba(240,235,225,0.75)';
    g.lineWidth = kind === 0 ? 3 : 2;
    g.beginPath(); g.moveTo(x0 + 2, cy + 2); g.quadraticCurveTo(x0 + 130, cy - 6, x0 + 248, cy - 2); g.stroke();
  };
  for (let k = 0; k < 4; k++) draw(k, k);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function featherGeometry() {
  // Slightly cambered quad: base at x=0, tip at x=1, width along z. Normal +y.
  const g = new THREE.PlaneGeometry(1, 1, 4, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0.5, 0, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, Math.sin(x * Math.PI) * 0.03 - z * z * 0.08);
  }
  g.computeVertexNormals();
  return g;
}

export class Wings {
  constructor(cfg, envMap) {
    this.cfg = cfg;
    const w = cfg.wing;
    this.scene = new THREE.Scene();
    this.scene.environment = envMap;
    this.scene.environmentIntensity = 0.9;
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.scene.add(this.sun, this.sun.target, new THREE.HemisphereLight(0xbfd8ff, 0x3a3020, 0.5));
    this.root = new THREE.Group();
    this.scene.add(this.root);

    const tex = featherAtlas(w);
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aCol;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nfloat fl = step(3.5, aCol);\nvMapUv = vec2((uv.x + aCol - 4.0 * fl) * 0.25, mix(uv.y, 1.0 - uv.y, fl));\n#endif');
    };
    this.mat = mat;
    const S = 0.95 + 0.3 * w.span; // visible size grows gently with real wingspan
    // bone lengths (metres, one wing)
    this.bones = { hum: 0.16 * S, fore: 0.2 * S, hand: 0.14 * S };
    this.side = [];
    for (const s of [-1, 1]) {
      const list = this.layout(s);
      const geo = featherGeometry();
      const aCol = new Float32Array(list.length);
      list.forEach((f, i) => { aCol[i] = f.col + (s < 0 ? 4 : 0); });
      geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(aCol, 1));
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(mesh);
      // arm (leading edge) as a tapered tube
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1), new THREE.MeshStandardMaterial({ color: w.color1, roughness: 0.9 }));
      const arm2 = arm.clone();
      this.root.add(arm, arm2);
      this.side.push({ s, list, mesh, arm, arm2 });
    }
    this.t = 0;
    this._m = new THREE.Matrix4();
  }

  layout(s) {
    const w = this.cfg.wing;
    const b = this.bones;
    const chord = w.chord * w.span * 0.5;
    const out = [];
    const rand = mulberry32(s > 0 ? 11 : 12);
    // primaries on the hand: fan from wrist, outermost longest-ish, slotted fingers
    const nP = 10;
    for (let i = 0; i < nP; i++) {
      const t = i / (nP - 1); // 0 = inner (near wrist), 1 = outer tip
      const finger = w.fingers > 0 && i >= nP - w.fingers;
      out.push({ bone: 'hand', t: 0.15 + t * 0.85, fan: (1 - t) * 0.95 + (finger ? (i - (nP - w.fingers)) * -0.05 * w.spread : 0) + 0.05,
        len: chord * (1.25 + t * 0.6) * (finger ? 1.05 : 1), width: finger ? 0.2 : 0.3, col: 0, layer: 0.002 * (nP - i), finger, jitter: rand() });
    }
    // secondaries along the forearm pointing back
    const nS = 14;
    for (let i = 0; i < nS; i++) {
      const t = i / (nS - 1);
      out.push({ bone: 'fore', t: 1 - t, fan: Math.PI / 2 - 0.08 + t * 0.12, len: chord * (1.0 + 0.06 * Math.sin(t * 3)), width: 0.48, col: 1, layer: 0.0015 * i, jitter: rand() });
    }
    // tertials along humerus
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      out.push({ bone: 'hum', t: 1 - t * 0.9, fan: Math.PI / 2 + t * 0.2, len: chord * (0.9 - t * 0.25), width: 0.4, col: 1, layer: 0.001 * i, jitter: rand() });
    }
    // greater coverts (over the secondaries), primary coverts, median + marginal coverts
    const rows = [
      { bone: 'fore', n: 12, len: 0.52, col: 2, lift: 0.012 },
      { bone: 'hand', n: 7, len: 0.45, col: 2, lift: 0.012, fan0: 0.9 },
      { bone: 'hum', n: 5, len: 0.55, col: 2, lift: 0.012 },
      { bone: 'fore', n: 12, len: 0.3, col: 3, lift: 0.02 },
      { bone: 'hum', n: 6, len: 0.32, col: 3, lift: 0.02 },
      { bone: 'hand', n: 6, len: 0.26, col: 3, lift: 0.02, fan0: 0.6 },
    ];
    for (const r of rows) for (let i = 0; i < r.n; i++) {
      const t = (i + 0.5) / r.n;
      out.push({ bone: r.bone, t, fan: r.fan0 !== undefined ? r.fan0 * (1 - t) + 0.35 : Math.PI / 2 - 0.15, len: chord * r.len, width: 0.62, col: r.col, layer: r.lift + i * 0.0006, jitter: rand(), covert: true });
    }
    return out;
  }

  // pose: {flap (rad, + up), fold 0..1, sweep, twist, spread}
  update(dt, body, cam, sunDir) {
    const cfg = this.cfg, w = cfg.wing;
    this.t += dt;
    this.root.position.copy(cam.position);
    this.root.quaternion.copy(body.quat);
    this.sun.position.copy(cam.position).addScaledVector(sunDir, 10);
    this.sun.target.position.copy(cam.position);

    const perched = body.mode === 'perched' || body.mode === 'water';
    this.root.visible = !perched;
    const flapping = body.flapAmt;
    const amp = (body.boosting ? 0.6 : 0.5) * flapping;
    const ph = body.flapPhase;
    const baseDihedral = w.spread > 0.8 ? 0.14 : 0.07;
    // Glide: small dihedral; flapping: big strokes; dive: tucked back; perched: folded
    let flap = baseDihedral * (1 - flapping) + Math.sin(ph) * amp + 0.08 * flapping;
    let fold = Math.max(body.tuck * 0.45, perched ? 0.97 : 0);
    fold = Math.max(fold, flapping * 0.4 * Math.max(0, Math.cos(ph))); // flex on upstroke
    // wings flex upward under load
    const load = Math.min(Math.max(body.gLoad - 1, -0.5), 2.5);
    const flutter = Math.min(body.airspeed / 60, 1.4);
    const bankAsym = body.bank;
    const offset = new V3(0, -0.1 * w.span * 0.6, 0.02);

    for (const S of this.side) {
      const s = S.s;
      // inner wing in a turn lifts and flexes slightly
      const inner = Math.max(0, s * bankAsym) * 0.25;
      const f = Math.min(1, fold + inner * 0.3);
      const flapS = flap + inner * 0.2;
      // joint frames in body space (x right, y up, -z forward)
      const shoulder = new V3(s * 0.07, -0.16, -0.1);
      const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s * (0.5 - f * 1.8), s * flapS, 'YZX'));
      const dirH = new V3(s, 0, 0).applyQuaternion(q0);
      const elbow = shoulder.clone().addScaledVector(dirH, this.bones.hum);
      const q1 = q0.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s * (0.1 - f * 2.5), s * (w.spots ? 0.1 : 0.03), 'YZX')));
      const dirF = new V3(s, 0, 0).applyQuaternion(q1);
      const wrist = elbow.clone().addScaledVector(dirF, this.bones.fore);
      const handFlap = Math.sin(ph - 0.5) * amp * 0.35 + (w.spots ? -0.12 : 0) * (1 - flapping) + load * 0.05;
      const q2 = q1.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s * (-0.35 + f * 2.8), s * handFlap, 'YZX')));
      const dirHand = new V3(s, 0, 0).applyQuaternion(q2);
      const tip = wrist.clone().addScaledVector(dirHand, this.bones.hand);
      const bones = { hum: [shoulder, elbow, q0], fore: [elbow, wrist, q1], hand: [wrist, tip, q2] };

      const m = this._m, pos = new V3(), q = new THREE.Quaternion(), sc = new V3();
      S.list.forEach((fe, i) => {
        const [a, b, qb] = bones[fe.bone];
        pos.lerpVectors(a, b, fe.t);
        // feather direction in bone-local space: rotate from bone axis towards the trailing edge (+z)
        let fan = fe.fan * (1 - f * 0.55);
        if (fe.finger) fan -= f * 0.3;
        const tw = fe.finger ? (-0.12 - load * 0.06) * (1 - f) : 0;
        const vib = fe.bone === 'hand' && !fe.covert ? Math.sin(this.t * 40 + fe.jitter * 30) * 0.02 * flutter : 0;
        const lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(tw + vib, -s * fan, fe.finger ? s * (0.06 + load * 0.04) * (1 - f) : 0, 'XYZ'));
        // local feather x axis should point outward (s) for fan=0; mirror for the left wing
        const mirror = new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), s > 0 ? 0 : Math.PI);
        q.copy(qb).multiply(mirror).multiply(lq);
        const up = new V3(0, 1, 0).applyQuaternion(qb);
        pos.addScaledVector(up, fe.layer);
        sc.set(fe.len * (1 - f * 0.1), 1, fe.len * fe.width);
        m.compose(pos, q, sc);
        S.mesh.setMatrixAt(i, m);
      });
      S.mesh.instanceMatrix.needsUpdate = true;
      // arm tubes
      const setTube = (mesh, a, b, r) => {
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const d = b.clone().sub(a);
        mesh.position.copy(mid);
        mesh.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.clone().normalize());
        mesh.scale.set(r, d.length(), r * 0.7);
      };
      setTube(S.arm, shoulder, elbow, 0.009 * w.span);
      setTube(S.arm2, elbow, wrist, 0.007 * w.span);
    }
  }
}
