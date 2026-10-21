// Time of day for the game view (DESIGN 8): one clock, one look.
//
// The match clock (the sim seconds in every snapshot, so all clients agree
// without any protocol change) is mapped to an hour of the day, and the hour
// to a "look": the colors, intensities and grade of the light, haze and post
// processing, blended between hand-tuned keyframes. The sun and the moon share
// one arc across the sky; the light that shades the scene (the "key" light) is
// the sun by day and the moon at night, swapped at the blue hour, where both
// are at zero, so shadows never jump.
//
//   const atmo = new Atmosphere();       // the game view keeps one
//   atmo.setMode('cycle');                // or 'golden' | 'day' | 'dusk' | 'night' | 'dawn' | an hour (0..24)
//   atmo.update(simSeconds);              // once per frame (in the cycle the hour follows the sim clock)
//   atmo.state                            // the resolved look: live objects, rewritten in place
//
// Pure math on three.js value types (Color, Vector3): runs in Node, nothing
// here touches the GPU. shading.js copies the state into the shared uniforms.
import * as THREE from 'three';

/** Sim seconds one full day lasts. */
export const DAY_SECONDS = 900;
/** The hour a match opens at: the golden morning. */
export const START_HOUR = 8;
/** The settings values: the running cycle, or one time of day held for the whole match. */
export const TIME_MODES = ['cycle', 'golden', 'day', 'dusk', 'night', 'dawn'];
/** The hour each held time of day freezes the clock at. */
export const TIME_PRESETS = { golden: 8, day: 12.5, dusk: 19, night: 22.5, dawn: 5.75 };

export const SUNRISE = 5.5;
export const SUNSET = 19.5;
/** The key light's lowest elevation (degrees): below it the light only dims, so shadows never turn grazing. */
export const MIN_KEY_ELEVATION = 14;
/** Hour the key light changes from sun to moon (evening) and back (morning): both are at zero there. */
export const EVENING_SWAP = 20;
export const MORNING_SWAP = 4.7;

const SUN_PEAK = 58; // noon elevation, degrees
const MOON_PEAK = 52;
const BELOW = 38; // how deep the sun (moon) sinks at its lowest, degrees
const AZIMUTH_SPAN = 100; // sunrise (moonrise) lies this far east of south, sunset this far west
const DEG = Math.PI / 180;

/**
 * Pacing: [fraction of the day, hour] knots, piecewise linear. The golden morning
 * runs into a long day, dusk and the blue hour take their time, the dark of the
 * night passes quickly, and the dawn is slow again.
 */
const PACE = [
  [0, 8],
  [0.18, 12.5],
  [0.42, 17],
  [0.52, 19],
  [0.58, 20],
  [0.78, 28],
  [0.88, 29.75],
  [1, 32],
];

/** The hour (0..24) a sim clock reading falls on. */
export function hourAt(simSeconds, daySeconds = DAY_SECONDS) {
  const s = Number.isFinite(simSeconds) ? simSeconds : 0;
  const p = (((s / daySeconds) % 1) + 1) % 1;
  let i = 1;
  while (i < PACE.length - 1 && p > PACE[i][0]) i++;
  const [p0, h0] = PACE[i - 1];
  const [p1, h1] = PACE[i];
  return (h0 + ((h1 - h0) * (p - p0)) / (p1 - p0)) % 24;
}

// ---------------------------------------------------------------------------
// the looks
// ---------------------------------------------------------------------------

// Field kinds: 'c' an sRGB color (blended in linear light), 'n' a number, 'v' a
// triple of linear multipliers.
const FIELDS = [
  ['key', 'c'], // key light hue (the sun by day, the moon at night)
  ['keyI', 'n'], // key light intensity (linear; about 3 lights a white surface fully)
  ['hemiSky', 'c'], // hemisphere (sky fill / ground bounce) colors and intensity
  ['hemiGround', 'c'],
  ['hemiI', 'n'],
  ['envI', 'n'], // image-based lighting intensity
  ['zenith', 'c'], // the sky: overhead, at the horizon, and the ground it meets
  ['horizon', 'c'],
  ['ground', 'c'],
  ['haze', 'c'], // distance haze color, and where it starts / is complete: world units beyond the point the camera looks at
  ['hazeNear', 'n'],
  ['hazeFar', 'n'],
  ['exposure', 'n'],
  ['bloom', 'n'], // strength, threshold, knee, radius
  ['bloomThr', 'n'],
  ['bloomKnee', 'n'],
  ['bloomRad', 'n'],
  ['contrast', 'n'],
  ['saturation', 'n'],
  ['shadowTint', 'v'], // the grade: cool shadows, warm highlights (multiplied in)
  ['highlightTint', 'v'],
  ['vignette', 'n'],
  ['glow', 'n'], // sunlit-haze veil over the far half of the picture
  ['cloud', 'n'], // multiplier on the cloud shadows' strength
  ['rim', 'c'], // silhouette light color
  ['shaft', 'n'], // light-shaft strength
  ['lamp', 'n'], // 0..1: lanterns, windows and braziers glow
  ['night', 'n'], // 0..1: how far into the night
];

const OFFSETS = {};
let SIZE = 0;
for (const [name, kind] of FIELDS) {
  OFFSETS[name] = SIZE;
  SIZE += kind === 'n' ? 1 : 3;
}

/** One keyframe: hour (unwrapped: 8 .. 32), then the look. Written for readability, parsed once. */
const LOOKS = [
  {
    // the first morning: a low golden sun, warm haze, cool blue shadows, a glow over everything lit
    name: 'golden', hour: 8,
    key: '#ffe0b4', keyI: 6.5,
    hemiSky: '#7f9cff', hemiGround: '#c08a48', hemiI: 1.3,
    envI: 0.5,
    zenith: '#4a62c0', horizon: '#ffc080', ground: '#5a3a22',
    haze: '#ffcc88', hazeNear: -11, hazeFar: 85,
    exposure: 1.0,
    bloom: 0.7, bloomThr: 0.3, bloomKnee: 0.5, bloomRad: 1.0,
    contrast: 1.2, saturation: 1.14,
    shadowTint: [0.8, 0.95, 1.25], highlightTint: [1.06, 1.0, 0.92],
    vignette: 0.36, glow: 0.22, cloud: 1.1, rim: '#ffc98f', shaft: 0.8, lamp: 0, night: 0,
  },
  {
    // bright day: the studio look the game started with (a soft white sun, clear sky fill), a touch more vivid
    name: 'day', hour: 12.5,
    key: '#fff4e0', keyI: 3.4,
    hemiSky: '#a8c8ff', hemiGround: '#4c4230', hemiI: 0.9,
    envI: 0.5,
    zenith: '#5d8fd0', horizon: '#cfdbe6', ground: '#4a4a32',
    haze: '#b8cce0', hazeNear: 3, hazeFar: 125,
    exposure: 1.0,
    bloom: 0.55, bloomThr: 0.92, bloomKnee: 0.45, bloomRad: 0.82,
    contrast: 1.15, saturation: 1.2,
    shadowTint: [0.88, 0.97, 1.14], highlightTint: [1.02, 1.01, 0.97],
    vignette: 0.34, glow: 0.1, cloud: 1.0, rim: '#a8c4f0', shaft: 0.25, lamp: 0, night: 0,
  },
  {
    // late afternoon: richer and redder than the morning
    name: 'afternoon', hour: 17,
    key: '#ffd29e', keyI: 6.8,
    hemiSky: '#8aa4ff', hemiGround: '#c08040', hemiI: 1.25,
    envI: 0.5,
    zenith: '#4a62c0', horizon: '#ff9a5e', ground: '#5a3820',
    haze: '#ffbe80', hazeNear: -11, hazeFar: 80,
    exposure: 1.02,
    bloom: 0.7, bloomThr: 0.3, bloomKnee: 0.5, bloomRad: 1.0,
    contrast: 1.18, saturation: 1.14,
    shadowTint: [0.82, 0.94, 1.22], highlightTint: [1.08, 0.99, 0.9],
    vignette: 0.38, glow: 0.24, cloud: 1.1, rim: '#ffb87a', shaft: 0.8, lamp: 0.06, night: 0.05,
  },
  {
    // dusk: pink light over lilac, long shadows, the lamps come on
    name: 'dusk', hour: 19,
    key: '#ffaeb8', keyI: 9.0,
    hemiSky: '#b8a0ff', hemiGround: '#a0607a', hemiI: 1.8,
    envI: 0.55,
    zenith: '#3d2a96', horizon: '#ff8fb0', ground: '#3e2038',
    haze: '#d8a0d0', hazeNear: -15, hazeFar: 75,
    exposure: 1.2,
    bloom: 0.9, bloomThr: 0.4, bloomKnee: 0.55, bloomRad: 1.0,
    contrast: 1.12, saturation: 1.1,
    shadowTint: [0.88, 0.9, 1.15], highlightTint: [1.08, 0.98, 1.0],
    vignette: 0.42, glow: 0.4, cloud: 0.9, rim: '#ff8cb0', shaft: 0.55, lamp: 0.75, night: 0.4,
  },
  {
    // the blue hour: no direct light at all, just the sky; the key light changes hands here
    name: 'blue', hour: EVENING_SWAP,
    key: '#7a74e8', keyI: 0,
    hemiSky: '#9ca4f8', hemiGround: '#7a6aa8', hemiI: 3.6,
    envI: 0.6,
    zenith: '#1c1f66', horizon: '#6a58b0', ground: '#1c1636',
    haze: '#8a70c0', hazeNear: -15, hazeFar: 70,
    exposure: 1.2,
    bloom: 0.95, bloomThr: 0.4, bloomKnee: 0.5, bloomRad: 1.0,
    contrast: 1.12, saturation: 1.1,
    shadowTint: [0.85, 0.9, 1.22], highlightTint: [1.0, 0.97, 1.1],
    vignette: 0.55, glow: 0.2, cloud: 0.6, rim: '#9fa4ff', shaft: 0, lamp: 1, night: 0.85,
  },
  {
    // moonlit night: cool blue-green, never black; the lamps and fires carry the colour
    name: 'night', hour: 21,
    key: '#98c4ff', keyI: 3.6,
    hemiSky: '#4a70d8', hemiGround: '#1f3f66', hemiI: 0.8,
    envI: 0.4,
    zenith: '#0a1442', horizon: '#1c3a78', ground: '#0c1830',
    haze: '#1a3a70', hazeNear: -15, hazeFar: 65,
    exposure: 1.15,
    bloom: 1.0, bloomThr: 0.4, bloomKnee: 0.5, bloomRad: 1.0,
    contrast: 1.22, saturation: 1.0,
    shadowTint: [0.84, 0.95, 1.25], highlightTint: [0.94, 1.04, 1.14],
    vignette: 0.5, glow: 0.1, cloud: 0.5, rim: '#7fd8ff', shaft: 0, lamp: 1, night: 1,
  },
  {
    // before dawn: the sky again, a first pink at the horizon; the key light passes back to the sun
    name: 'predawn', hour: 24 + MORNING_SWAP,
    key: '#9aa0ff', keyI: 0,
    hemiSky: '#9ca4f8', hemiGround: '#8a6aa0', hemiI: 3.4,
    envI: 0.55,
    zenith: '#1c2470', horizon: '#8a68b8', ground: '#241c40',
    haze: '#9a78c0', hazeNear: -15, hazeFar: 70,
    exposure: 1.2,
    bloom: 0.95, bloomThr: 0.4, bloomKnee: 0.5, bloomRad: 1.0,
    contrast: 1.12, saturation: 1.1,
    shadowTint: [0.86, 0.9, 1.2], highlightTint: [1.02, 0.97, 1.08],
    vignette: 0.52, glow: 0.25, cloud: 0.6, rim: '#b0a4ff', shaft: 0, lamp: 0.9, night: 0.8,
  },
  {
    // dawn: peach and rose over violet, long soft shadows
    name: 'dawn', hour: 29.75,
    key: '#ffc090', keyI: 8.0,
    hemiSky: '#a090f0', hemiGround: '#c8806a', hemiI: 1.5,
    envI: 0.45,
    zenith: '#5a58c4', horizon: '#ffbc90', ground: '#583a3a',
    haze: '#ffc0a8', hazeNear: -13, hazeFar: 75,
    exposure: 1.15,
    bloom: 0.7, bloomThr: 0.3, bloomKnee: 0.5, bloomRad: 1.0,
    contrast: 1.15, saturation: 1.12,
    shadowTint: [0.86, 0.94, 1.2], highlightTint: [1.08, 0.98, 0.94],
    vignette: 0.4, glow: 0.28, cloud: 0.9, rim: '#ffb0a0', shaft: 0.7, lamp: 0.4, night: 0.25,
  },
];
// the night holds until 03:30 and the day starts over: copies of the looks they repeat
LOOKS.splice(LOOKS.findIndex((l) => l.name === 'predawn'), 0, { ...LOOKS.find((l) => l.name === 'night'), hour: 27.5 });
LOOKS.push({ ...LOOKS[0], hour: LOOKS[0].hour + 24 });

const _pack = new THREE.Color();

/** A look written for readability, as one packed vector (colors in linear light). */
function pack(look) {
  const v = new Float64Array(SIZE);
  for (const [name, kind] of FIELDS) {
    const val = look[name];
    const o = OFFSETS[name];
    if (kind === 'n') v[o] = val;
    else if (kind === 'c') {
      _pack.set(val);
      v[o] = _pack.r;
      v[o + 1] = _pack.g;
      v[o + 2] = _pack.b;
    } else {
      v[o] = val[0];
      v[o + 1] = val[1];
      v[o + 2] = val[2];
    }
  }
  return v;
}

const KEYS = LOOKS.map((look) => ({ name: look.name, hour: look.hour, v: pack(look) }));

/**
 * Re-tune a keyframe at run time, by name ('golden', 'day', 'afternoon', 'dusk', 'blue',
 * 'night', 'predawn', 'dawn'; the repeats of a look follow it). For tools that try looks
 * live; the game never calls it.
 * @param {string} name
 * @param {Record<string, any>} patch fields as written in the table: { key: '#ffbe78', keyI: 3.5, shadowTint: [1, 1, 1] }
 * @returns {boolean} whether a keyframe of that name exists
 */
export function tuneLook(name, patch) {
  let found = false;
  LOOKS.forEach((look, i) => {
    if (look.name !== name) return;
    found = true;
    Object.assign(look, patch);
    KEYS[i].v = pack(look);
  });
  return found;
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

/**
 * The resolved look. Every object is allocated once and rewritten in place, so
 * anything may keep a reference to it. Colors are linear.
 * @typedef {ReturnType<typeof createState>} AtmosphereState
 */
export function createState() {
  return {
    hour: START_HOUR,
    /** True while the key light is the moon. */
    keyIsMoon: false,
    /** Unit vector toward the key light (elevation never below MIN_KEY_ELEVATION). */
    keyDir: new THREE.Vector3(0, 1, 0),
    /** Key light radiance (hue × intensity) and its intensity alone. */
    keyColor: new THREE.Color(),
    keyHue: new THREE.Color(),
    keyIntensity: 0,
    /** The sun and the moon as they really stand (either may be below the horizon), degrees of elevation. */
    sunDir: new THREE.Vector3(0, 1, 0),
    sunElevation: 0,
    moonDir: new THREE.Vector3(0, 1, 0),
    moonElevation: 0,
    /** The moon's light as it reaches the ground (black unless the moon is the key light). */
    moonColor: new THREE.Color(),
    skyZenith: new THREE.Color(),
    skyHorizon: new THREE.Color(),
    skyGround: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 0,
    /** What the hemisphere light adds (color × intensity). */
    ambientSky: new THREE.Color(),
    ambientGround: new THREE.Color(),
    haze: new THREE.Color(),
    hazeNear: -10,
    hazeFar: 90,
    /** Clear color: the haze, darkened. */
    background: new THREE.Color(),
    envIntensity: 0.5,
    exposure: 1,
    bloom: 0.5,
    bloomThreshold: 0.9,
    bloomKnee: 0.45,
    bloomRadius: 0.8,
    contrast: 1.1,
    saturation: 1.05,
    shadowTint: [1, 1, 1],
    highlightTint: [1, 1, 1],
    vignette: 0.3,
    glow: 0,
    cloudScale: 1,
    rimColor: new THREE.Color(),
    shaft: 0,
    lamp: 0,
    night: 0,
  };
}

function ease(t) {
  const s = t * t * (3 - 2 * t);
  return t + (s - t) * 0.6; // mostly smoothstep, with enough speed left at the keyframes not to look stalled
}

/** Direction (unit) for an azimuth (degrees from south toward east) and an elevation (degrees). */
function fromAzEl(out, az, el) {
  const a = az * DEG;
  const e = el * DEG;
  const c = Math.cos(e);
  return out.set(c * Math.sin(a), Math.sin(e), c * Math.cos(a));
}

/**
 * Where the sun and the moon stand at an hour. They share one arc: up for the
 * half of the day (night) they own, then below the horizon for the other half.
 * Returns elevations in degrees; writes directions into the given vectors.
 */
function celestial(hour, sunOut, moonOut) {
  const dayLen = SUNSET - SUNRISE;
  const nightLen = 24 - dayLen;
  // below the horizon a body goes back from the west to the east round the north
  const under = (u) => -AZIMUTH_SPAN - (360 - 2 * AZIMUTH_SPAN) * u;
  const h = ((hour % 24) + 24) % 24;
  let sunEl;
  let sunAz;
  let moonEl;
  let moonAz;
  if (h >= SUNRISE && h <= SUNSET) {
    const u = (h - SUNRISE) / dayLen;
    sunEl = SUN_PEAK * Math.sin(Math.PI * u);
    sunAz = AZIMUTH_SPAN * (1 - 2 * u);
    moonEl = -BELOW * Math.sin(Math.PI * u);
    moonAz = under(u);
  } else {
    const v = ((((h - SUNSET) % 24) + 24) % 24) / nightLen;
    moonEl = MOON_PEAK * Math.sin(Math.PI * v);
    moonAz = AZIMUTH_SPAN * (1 - 2 * v);
    sunEl = -BELOW * Math.sin(Math.PI * v);
    sunAz = under(v);
  }
  fromAzEl(sunOut, sunAz, sunEl);
  fromAzEl(moonOut, moonAz, moonEl);
  return [sunEl, moonEl, sunAz, moonAz];
}

/** The key light's direction: the sun or moon, lifted to at least MIN_KEY_ELEVATION. */
function keyDirection(out, az, el) {
  return fromAzEl(out, az, Math.max(el, MIN_KEY_ELEVATION));
}

/** Is the moon the key light at this hour? */
export function keyIsMoonAt(hour) {
  const h = ((hour % 24) + 24) % 24;
  return h >= EVENING_SWAP || h < MORNING_SWAP;
}

const _v = new Float64Array(SIZE);

/** Blend the keyframes at an hour (0..24) into a packed look vector. */
function blendLooks(hour, out) {
  const h = hour < START_HOUR ? hour + 24 : hour;
  let i = 1;
  while (i < KEYS.length - 1 && h > KEYS[i].hour) i++;
  const a = KEYS[i - 1];
  const b = KEYS[i];
  const t = ease(Math.min(1, Math.max(0, (h - a.hour) / (b.hour - a.hour))));
  for (let k = 0; k < SIZE; k++) out[k] = a.v[k] + (b.v[k] - a.v[k]) * t;
  return out;
}

/**
 * Resolve an hour into a state (in place). `elevation` of the real sun / moon
 * is kept alongside the lifted key direction.
 * @param {AtmosphereState} s
 * @param {number} hour 0..24
 */
export function resolveHour(s, hour) {
  const h = ((hour % 24) + 24) % 24;
  const v = blendLooks(h, _v);
  s.hour = h;
  const [sunEl, moonEl, sunAz, moonAz] = celestial(h, s.sunDir, s.moonDir);
  s.sunElevation = sunEl;
  s.moonElevation = moonEl;
  const isMoon = keyIsMoonAt(h);
  s.keyIsMoon = isMoon;
  if (isMoon) keyDirection(s.keyDir, moonAz, moonEl);
  else keyDirection(s.keyDir, sunAz, sunEl);

  const col = (name, out) => out.setRGB(v[OFFSETS[name]], v[OFFSETS[name] + 1], v[OFFSETS[name] + 2]);
  col('key', s.keyHue);
  s.keyIntensity = Math.max(0, v[OFFSETS.keyI]);
  s.keyColor.copy(s.keyHue).multiplyScalar(s.keyIntensity);
  if (isMoon) s.moonColor.copy(s.keyColor);
  else s.moonColor.setRGB(0, 0, 0);
  col('zenith', s.skyZenith);
  col('horizon', s.skyHorizon);
  col('ground', s.skyGround);
  col('hemiSky', s.hemiSky);
  col('hemiGround', s.hemiGround);
  s.hemiIntensity = v[OFFSETS.hemiI];
  s.ambientSky.copy(s.hemiSky).multiplyScalar(s.hemiIntensity);
  s.ambientGround.copy(s.hemiGround).multiplyScalar(s.hemiIntensity);
  col('haze', s.haze);
  s.hazeNear = v[OFFSETS.hazeNear];
  s.hazeFar = v[OFFSETS.hazeFar];
  s.background.copy(s.haze).multiplyScalar(0.06);
  s.envIntensity = v[OFFSETS.envI];
  s.exposure = v[OFFSETS.exposure];
  s.bloom = v[OFFSETS.bloom];
  s.bloomThreshold = v[OFFSETS.bloomThr];
  s.bloomKnee = v[OFFSETS.bloomKnee];
  s.bloomRadius = v[OFFSETS.bloomRad];
  s.contrast = v[OFFSETS.contrast];
  s.saturation = v[OFFSETS.saturation];
  for (let k = 0; k < 3; k++) {
    s.shadowTint[k] = v[OFFSETS.shadowTint + k];
    s.highlightTint[k] = v[OFFSETS.highlightTint + k];
  }
  s.vignette = v[OFFSETS.vignette];
  s.glow = v[OFFSETS.glow];
  s.cloudScale = v[OFFSETS.cloud];
  col('rim', s.rimColor);
  s.shaft = Math.max(0, v[OFFSETS.shaft]);
  s.lamp = Math.min(1, Math.max(0, v[OFFSETS.lamp]));
  s.night = Math.min(1, Math.max(0, v[OFFSETS.night]));
  return s;
}

/** The looks' keyframe hours (for tests and tools). */
export const KEYFRAME_HOURS = KEYS.map((k) => k.hour);

export class Atmosphere {
  /**
   * @param {object} [o]
   * @param {string|number} [o.mode] 'cycle', a TIME_MODES name, or an hour 0..24
   * @param {number} [o.daySeconds] sim seconds per day
   */
  constructor({ mode = 'cycle', daySeconds = DAY_SECONDS } = {}) {
    this.daySeconds = daySeconds;
    this.state = createState();
    this.mode = 'cycle';
    this.heldHour = START_HOUR;
    this.simTime = 0;
    /** Bumped whenever the mode changes, for things that want to react at once. */
    this.version = 0;
    this.setMode(mode);
  }

  /**
   * 'cycle' follows the match clock; a TIME_MODES name or an hour (0..24) holds that time.
   * Unknown values are ignored.
   * @returns {boolean} whether the mode changed
   */
  setMode(mode) {
    let held = null;
    let name = 'cycle';
    if (typeof mode === 'number' && Number.isFinite(mode)) {
      held = ((mode % 24) + 24) % 24;
      name = 'hour';
    } else if (mode === 'cycle') name = 'cycle';
    else if (typeof mode === 'string' && Object.prototype.hasOwnProperty.call(TIME_PRESETS, mode)) {
      held = TIME_PRESETS[mode];
      name = mode;
    } else if (typeof mode === 'string' && mode.trim() !== '' && Number.isFinite(Number(mode))) {
      held = ((Number(mode) % 24) + 24) % 24;
      name = 'hour';
    } else return false;
    const changed = name !== this.mode || (held !== null && held !== this.heldHour);
    this.mode = name;
    if (held !== null) this.heldHour = held;
    this.version++;
    this.refresh();
    return changed;
  }

  /** The hour now showing (0..24). */
  get hour() {
    return this.mode === 'cycle' ? hourAt(this.simTime, this.daySeconds) : this.heldHour;
  }

  /** True while the clock runs (the cycle); false when a time of day is held. */
  get running() {
    return this.mode === 'cycle';
  }

  /**
   * Advance to a sim clock reading (seconds). Holds ignore it.
   * @returns {AtmosphereState}
   */
  update(simSeconds) {
    if (Number.isFinite(simSeconds)) this.simTime = simSeconds;
    return this.refresh();
  }

  refresh() {
    return resolveHour(this.state, this.hour);
  }
}

/** The "hh:mm" clock face of an hour. */
export function formatHour(hour) {
  const h = ((hour % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Linear luminance of a color (for tests and tools). */
export function luminance(c) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

