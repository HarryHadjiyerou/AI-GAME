// Per-bird flight characteristics. Aerodynamic coefficients are derived from a few intuitive numbers:
// best-glide speed, glide ratio, stall lift coefficient and terminal dive speed.

const RAW = {
  hawk: {
    name: 'Hawk', biome: 'forest', latin: 'Buteo jamaicensis',
    mass: 1.2, vBest: 24, glide: 11, clMax: 1.5, vDive: 88,
    pitchRate: 2.1, rollRate: 5.5, maxBank: 0.9, stability: 3.2,
    flapThrust: 0.95, flapLift: 1.35, flapHz: 4.2, boostHz: 9.5, boostThrust: 2.1,
    tuckArea: 0.28, stamina: 7,
    ceiling: 4000, cam: { fov: 72, fish: 0.075 },
    wing: { span: 1.25, chord: 0.36, color1: '#6b4a2e', color2: '#c9a27a', tip: '#2d2016', bars: true, fingers: 5, spread: 0.6 },
    head: { twitch: 1.0, glance: 1.0 },
  },
  seagull: {
    name: 'Seagull', biome: 'coast', latin: 'Larus argentatus',
    mass: 1.0, vBest: 18, glide: 16, clMax: 1.45, vDive: 55,
    pitchRate: 1.8, rollRate: 4.2, maxBank: 1.0, stability: 3.0,
    flapThrust: 0.8, flapLift: 1.3, flapHz: 3.1, boostHz: 7.5, boostThrust: 1.8,
    tuckArea: 0.35, stamina: 8,
    ceiling: 2500, cam: { fov: 74, fish: 0.08 },
    wing: { span: 1.4, chord: 0.3, color1: '#b9c0c8', color2: '#f2f4f6', tip: '#111111', bars: false, fingers: 3, spread: 0.25, spots: true },
    head: { twitch: 0.8, glance: 1.2 },
  },
  condor: {
    name: 'Condor', biome: 'mountains', latin: 'Vultur gryphus',
    mass: 11, vBest: 24, glide: 21, clMax: 1.35, vDive: 62,
    pitchRate: 1.05, rollRate: 1.7, maxBank: 0.8, stability: 2.2,
    flapThrust: 0.55, flapLift: 1.1, flapHz: 1.4, boostHz: 3.2, boostThrust: 1.5,
    tuckArea: 0.4, stamina: 6,
    ceiling: 6500, cam: { fov: 76, fish: 0.085 },
    wing: { span: 1.9, chord: 0.5, color1: '#15120f', color2: '#e8e2d6', tip: '#0b0a09', bars: false, fingers: 7, spread: 1.0, whitePatch: true },
    head: { twitch: 0.4, glance: 0.7 },
  },
  pigeon: {
    name: 'Pigeon', biome: 'city', latin: 'Columba livia',
    mass: 0.35, vBest: 19, glide: 7, clMax: 1.9, vDive: 45,
    pitchRate: 2.8, rollRate: 8.5, maxBank: 0.85, stability: 4.2,
    flapThrust: 1.35, flapLift: 1.6, flapHz: 6.5, boostHz: 12, boostThrust: 2.6,
    tuckArea: 0.35, stamina: 5,
    ceiling: 320, cam: { fov: 72, fish: 0.05 },
    wing: { span: 0.95, chord: 0.3, color1: '#6f7682', color2: '#9ba3ae', tip: '#353a42', bars: true, fingers: 0, spread: 0.1, iridescent: true },
    head: { twitch: 1.5, glance: 1.4 },
  },
};

const RHO = 1.225, G0 = 9.81, CL_OPT = 0.62;

function derive(b) {
  const q = 0.5 * RHO * b.vBest * b.vBest;
  const S = (b.mass * G0) / (q * CL_OPT);
  // At best glide, drag = weight / glide ratio, split equally between parasitic and induced drag.
  const dragBest = (b.mass * G0) / b.glide;
  const cdaOpen = dragBest / q / 2;
  const k = cdaOpen / (S * CL_OPT * CL_OPT);
  // Tucked parasitic drag sized for the terminal dive speed (always lower than open wings).
  const cdaTuck = Math.min((2 * b.mass * G0) / (RHO * b.vDive * b.vDive), cdaOpen * 0.6);
  const alphaSlope = 5.2; // lift slope per radian
  const alphaTrim = CL_OPT / alphaSlope;
  const vStall = Math.sqrt((2 * b.mass * G0) / (RHO * S * b.clMax));
  return { ...b, S, k, cdaOpen, cdaTuck, alphaSlope, alphaTrim, clOpt: CL_OPT, vStall, rho: RHO, g: G0 };
}

export const BIRDS = Object.fromEntries(Object.entries(RAW).map(([k, v]) => [k, { id: k, ...derive(v) }]));
