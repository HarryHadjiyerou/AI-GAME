/* ═══════════════════════════════════════════════════════════
   The four birds.

   Masses and wing areas are in the right ballpark for the real
   animals; the coefficients are then tuned for how the thing should
   *feel* rather than for a wind tunnel. The numbers that matter most:

     mass / wingArea  → wing loading → how fast it must fly to stay up
     aspectRatio      → induced drag → how far it glides
     cd0 / cd0Tucked  → top speed, and how much a stoop buys
     rollRate         → how quickly it changes its mind
   ═══════════════════════════════════════════════════════════ */

export const BIRDS = {
  hawk: {
    id: 'hawk',
    name: 'HAWK',
    glyph: '🦅',
    world: 'forest',
    worldName: 'THE FOREST',
    blurb: 'Redwoods the size of cathedrals, a river cut deep into the valley, and mist that has not burned off yet. Fast, agile and built for the stoop — pick something out in the distance, fold up, and be there before it has finished turning round.',
    stats: { Speed: 0.82, Glide: 0.55, Agility: 0.86, Climb: 0.62, Stamina: 0.60 },

    mass: 1.05, wingArea: 0.145, aspectRatio: 6.4, oswald: 0.86,
    clAlpha: 5.1, cl0: 0.16, stallAlpha: 0.30,
    cd0: 0.042, cd0Tucked: 0.011, tuckAreaLoss: 0.66,

    cruiseSpeed: 20, trimAlpha: 0.075,
    alphaMin: -0.20, alphaMax: 0.54, alphaRate: 0.95, alphaCentre: 1.3,
    rollRate: 2.9, maxBank: 1.30, rollCentre: 2.2, yawLag: 0.24, yawAssist: 0.60,
    rollServo: 3.4,
    pitchServo: 3.6,
    maxPitchRate: 1.35,
    pitchLag: 0.075,

    flapPeriod: 0.42, flapPower: 13.5, flapCost: 0.055,
    staminaGlide: 0.050, staminaSoar: 0.13,
    bodyArea: 0.0065,
    groundClearance: 1.1, seed: 11,

    wingColor: '#6d5334', wingTipColor: '#33281c', wingSweep: 0.62,
    thermalScale: 0.0019, wingSpan: 1.2,
  },

  seagull: {
    id: 'seagull',
    name: 'SEAGULL',
    glyph: '🕊️',
    world: 'coast',
    worldName: 'THE COAST',
    blurb: 'Cliffs, a long tidal beach, and a swell coming in off a storm that has not arrived yet. Glides for miles on the ridge lift off the headland, and folds into the water without slowing down.',
    stats: { Speed: 0.58, Glide: 0.84, Agility: 0.66, Climb: 0.70, Stamina: 0.78 },

    mass: 1.10, wingArea: 0.21, aspectRatio: 9.2, oswald: 0.90,
    clAlpha: 5.4, cl0: 0.20, stallAlpha: 0.29,
    cd0: 0.030, cd0Tucked: 0.010, tuckAreaLoss: 0.70,

    cruiseSpeed: 16, trimAlpha: 0.085,
    alphaMin: -0.20, alphaMax: 0.52, alphaRate: 0.80, alphaCentre: 1.5,
    rollRate: 2.3, maxBank: 1.20, rollCentre: 2.6, yawLag: 0.28, yawAssist: 0.50,
    rollServo: 2.8,
    pitchServo: 3.2,
    maxPitchRate: 1.05,
    pitchLag: 0.085,

    flapPeriod: 0.52, flapPower: 10.0, flapCost: 0.042,
    staminaGlide: 0.055, staminaSoar: 0.14,
    bodyArea: 0.0100,
    groundClearance: 1.0, seed: 23,
    maxDiveDepth: 9,

    wingColor: '#e8e9ec', wingTipColor: '#26282c', wingSweep: 0.58,
    thermalScale: 0.0013, wingSpan: 1.35,
  },

  condor: {
    id: 'condor',
    name: 'CONDOR',
    glyph: '🦅',
    world: 'mountain',
    worldName: 'THE HIGH RANGE',
    blurb: 'Three metres of wing and almost no reason to use them. Find a column of warm air coming off a south face, lean into it, and go up for ten minutes without a single beat. The clouds are below you here.',
    stats: { Speed: 0.46, Glide: 1.00, Agility: 0.34, Climb: 0.92, Stamina: 1.00 },

    mass: 11.0, wingArea: 1.32, aspectRatio: 8.6, oswald: 0.92,
    clAlpha: 5.6, cl0: 0.24, stallAlpha: 0.31,
    cd0: 0.026, cd0Tucked: 0.011, tuckAreaLoss: 0.55,

    cruiseSpeed: 17, trimAlpha: 0.095,
    alphaMin: -0.16, alphaMax: 0.58, alphaRate: 0.52, alphaCentre: 2.2,
    rollRate: 1.35, maxBank: 1.05, rollCentre: 3.4, yawLag: 0.42, yawAssist: 0.34,
    rollServo: 1.9,
    pitchServo: 2.6,
    maxPitchRate: 0.62,
    pitchLag: 0.14,

    flapPeriod: 1.15, flapPower: 98, flapCost: 0.062,
    staminaGlide: 0.070, staminaSoar: 0.17,
    bodyArea: 0.0900,
    groundClearance: 1.6, seed: 31,

    wingColor: '#2e2a28', wingTipColor: '#141313', wingSweep: 0.52,
    thermalScale: 0.0010, wingSpan: 3.0,
  },

  pigeon: {
    id: 'pigeon',
    name: 'PIGEON',
    glyph: '🐦',
    world: 'city',
    worldName: 'THE CITY',
    blurb: 'Four hundred grams of attitude in a canyon of glass. Accelerates like nothing else here and turns inside its own wingspan — but it has no patience, no ceiling worth speaking of, and the gaps are getting narrower.',
    stats: { Speed: 0.70, Glide: 0.30, Agility: 1.00, Climb: 0.55, Stamina: 0.42 },

    mass: 0.40, wingArea: 0.054, aspectRatio: 5.0, oswald: 0.80,
    clAlpha: 4.7, cl0: 0.14, stallAlpha: 0.33,
    cd0: 0.055, cd0Tucked: 0.018, tuckAreaLoss: 0.60,

    cruiseSpeed: 19, trimAlpha: 0.070,
    alphaMin: -0.22, alphaMax: 0.58, alphaRate: 1.45, alphaCentre: 1.0,
    rollRate: 4.4, maxBank: 1.45, rollCentre: 1.7, yawLag: 0.17, yawAssist: 0.85,
    rollServo: 5.0,
    pitchServo: 4.4,
    maxPitchRate: 1.90,
    pitchLag: 0.055,

    flapPeriod: 0.25, flapPower: 8.0, flapCost: 0.110,
    staminaGlide: 0.065, staminaSoar: 0.10,
    bodyArea: 0.0045,
    groundClearance: 0.8, seed: 43,

    wingColor: '#7e858f', wingTipColor: '#3a3f47', wingSweep: 0.70,
    thermalScale: 0.0026, wingSpan: 0.66,
  },
};

export const BIRD_ORDER = ['hawk', 'seagull', 'condor', 'pigeon'];
