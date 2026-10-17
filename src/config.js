/**
 * FIVE SECONDS — central tunables.
 * Every number that shapes the feel of the experience lives here.
 * See README "Tuning guide" for what each group does.
 */

const params = new URLSearchParams(window.location.search);

export const DEBUG = params.has('debug');

export const REDUCED_MOTION =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const IS_TOUCH =
  typeof window.matchMedia === 'function' &&
  (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);

export const CONFIG = {
  // ---------------------------------------------------------------- TIME
  time: {
    freezeDuration: 5.0, // seconds of REAL time spent fully frozen
    freezeInDuration: 0.6, // RUNNING -> FROZEN ease (exponential ease-out)
    resumeDuration: 0.35, // FROZEN -> RUNNING ease (back/overshoot)
    resumeOvershoot: 2.2, // easeOutBack strength (peak timeScale ~1.15)
    cooldown: 8.0, // seconds after resume before power is ready again
    maxDelta: 0.1, // clamp for real frame delta (tab switches, hitches)
    microDrift: true, // "held" freeze: tiny residual motion + particle shimmer
    microDriftScale: 0.004, // timeScale while frozen when microDrift is on
  },

  // -------------------------------------------------------------- CAMERA
  camera: {
    fov: 58,
    near: 0.1,
    far: 420,
    eyeHeight: 1.68,
    walkSpeed: 3.2,
    runSpeed: 6.5,
    flySpeed: 7.0,
    flySlowSpeed: 1.2,
    verticalSpeed: 4.0,
    lookSensitivity: 0.0021,
    touchLookSensitivity: 0.0055,
    lookDamping: 18,
    moveDamping: 6.5,
    headBob: 0.028,
    returnDamping: 2.6, // how fast the camera glides back to eye height after resume
    start: { x: 1.6, z: 15.5, yaw: 0.05, pitch: -0.03 },
    bounds: { minX: -10.4, maxX: 10.4, minY: 0.3, maxY: 26, minZ: -105, maxZ: 105 },
    orbitMinRadius: 2.5,
    orbitMaxRadius: 30,
  },

  // ---------------------------------------------------- CINEMATIC FX
  fx: {
    exposure: 1.08,
    bloom: { strength: 0.85, radius: 0.6, threshold: 0.92 },
    fovKick: 15, // degrees added at freeze onset (dolly-zoom)
    fovKickIn: 0.28,
    fovKickOut: 1.1,
    dollyMax: 4.5, // metres the camera pushes in to hold subject size
    letterboxAspect: 2.39,
    letterboxMin: 0.055, // bar fraction kept on ultra-wide screens
    letterboxSpeed: 5.5,
    chromaticBase: 0.0012,
    chromaticFrozen: 0.0035,
    chromaticSpike: 0.028,
    vignetteBase: 0.38,
    vignetteFrozen: 0.78,
    grain: 0.055,
    streakBase: 0.32,
    streakFrozen: 0.55,
    streakThreshold: 1.35,
    dof: { maxBlurFraction: 0.008, response: 1.7 },
    shockwave: { duration: 1.15, strength: 0.055, width: 0.11 },
    shake: { maxOffset: 0.16, maxRoll: 0.018, decay: 1.6 },
  },

  // ------------------------------------------------------------ COLORS
  colors: {
    pink: 0xff2bd6,
    cyan: 0x19e6ff,
    amber: 0xffb627,
    violet: 0x8a5cff,
    red: 0xff3044,
    fog: 0x0a0e1b,
    skyTop: 0x020309,
    skyHorizon: 0x1b1030,
    lamp: 0xffc387,
  },

  // ------------------------------------------------------------- WORLD
  world: {
    roadHalfWidth: 7,
    sidewalkWidth: 4,
    streetHalfLength: 135,
    fogDensity: 0.021,
    rainMax: 10000,
    rainArea: { x: 44, y: 26, z: 44 },
    rainSpeed: 21,
    wind: { x: -1.4, z: 0.5 },
    pedestrians: 18,
    trafficCars: 6,
    trash: 48,
    lanes: [4.6, -4.6], // x positions; + lane drives away (-z), - lane drives toward camera (+z)
  },

  // ------------------------------------------------------ HERO MOMENT
  hero: {
    position: [-0.3, 0, -1.0],
    yaw: 0.52,
    period: 7.0, // world seconds per explosion cycle
    // "Director's sync": if time-stop is triggered late in the cycle, a new
    // detonation is cued under the freeze flash so the freeze always lands
    // on the money shot. Set false for a fully honest simulation.
    syncOnFreeze: true,
    syncThreshold: 2.4,
    syncTime: 0.55,
    focusOffsetY: 1.0,
    characterStart: [1.7, 0, 0.4],
    characterEnd: [3.3, 0, 3.4],
  },

  // -------------------------------------------------------- PARTICLES
  particles: {
    fireBurst: 700,
    fireLoop: 360,
    smoke: 240,
    sparksBurst: 900,
    sparksLoop: 260,
    embers: 320,
    glass: 260,
    debris: 130,
    steamPerVent: 90,
  },

  // ---------------------------------------------------------- QUALITY
  quality: {
    // pixelRatio is a multiplier on min(devicePixelRatio, 2)
    levels: [
      { name: 'ultra', pixelRatio: 1.0, rain: 1.0, particles: 1.0, reflection: 0.5, bloom: true, dofSamples: 32, streak: true },
      { name: 'high', pixelRatio: 0.85, rain: 0.75, particles: 1.0, reflection: 0.42, bloom: true, dofSamples: 24, streak: true },
      { name: 'medium', pixelRatio: 0.7, rain: 0.5, particles: 0.7, reflection: 0.32, bloom: true, dofSamples: 16, streak: false },
      { name: 'low', pixelRatio: 0.55, rain: 0.25, particles: 0.45, reflection: 0.22, bloom: false, dofSamples: 10, streak: false },
    ],
    startLevel: IS_TOUCH ? 2 : 1,
    downgradeFps: 45,
    upgradeFps: 58,
    sampleWindow: 2.0, // seconds of frames averaged per decision
    upgradeAfter: 8.0, // seconds of sustained high fps before stepping up
    settleTime: 3.0, // ignore fps right after start / quality change
    maxDpr: 2,
    msaa: IS_TOUCH ? 0 : 4,
  },

  // ------------------------------------------------------------- AUDIO
  audio: {
    master: 0.85,
    frozenCutoff: 300,
    openCutoff: 19000,
    frozenWorldGain: 0.32,
  },
};
