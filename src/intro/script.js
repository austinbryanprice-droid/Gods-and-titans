// The intro film's script (DESIGN 11.1): which shot is on at each second, where the camera is, what
// the sky is doing, which line of text is up, how dark the screen is. Pure data and arithmetic, no
// DOM, no three.js and no simulation, so it runs in Node and the tests can walk it frame by frame.
//
// A camera spec names a point to look at (an anchor of the set, an actor such as the god, or
// the crowd of soldiers) and an orbit round it: `dist`, `pitch` degrees below the horizon, `yaw`
// degrees round from due south, `lift` above the ground, `fov`. A shot moves the camera from
// its first spec to its last (`ease` shapes the move); the film resolves the names to map
// positions each frame, so a camera that follows the fight follows the real one.

/** Film seconds from the first frame to the hand-over to the title screen. */
export const FILM_LENGTH = 47;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (x) => x * x * (3 - 2 * x);

export const EASE = {
  linear: (x) => x,
  inOut: smooth,
  out: (x) => 1 - (1 - x) * (1 - x),
  in: (x) => x * x,
};

/**
 * The shots, in order. `from`/`to` are film seconds; a shot's camera runs from `cam[0]` to
 * `cam[cam.length - 1]` (more specs bend the path); `cut` is how the screen changes into this shot:
 * 'hard' (a plain cut) or 'dip' (a quick dip to black).
 */
export const SHOTS = Object.freeze([
  {
    id: 'dawn',
    from: 0,
    to: 8.6,
    ease: 'inOut',
    hours: [6.9, 8],
    cam: [
      { at: 'village', dx: 14, dy: 9, dist: 74, pitch: 26, yaw: 62, lift: 0, fov: 38 },
      { at: 'village', dx: 2, dy: 5, dist: 27, pitch: 30, yaw: 28, lift: 0, fov: 40 },
    ],
  },
  {
    id: 'prayer',
    from: 8.6,
    to: 15,
    cut: 'hard',
    ease: 'inOut',
    hours: [8, 8.8],
    cam: [
      { at: 'temple', dx: -6, dy: -1, dist: 15, pitch: 20, yaw: -50, lift: 1.6, fov: 42 },
      { at: 'zeus', dx: 0, dy: 0, dist: 12, pitch: 15, yaw: -40, lift: 2.2, fov: 42 },
    ],
  },
  {
    id: 'god',
    from: 15,
    to: 19,
    cut: 'hard',
    ease: 'linear',
    hours: [8.8, 9.2],
    cam: [
      { at: 'zeus', dx: 0, dy: 0, dist: 7.5, pitch: 16, yaw: -72, lift: 2.1, fov: 40 },
      { at: 'zeus', dx: 0, dy: 0, dist: 10, pitch: 15, yaw: -52, lift: 2.4, fov: 40 },
    ],
  },
  {
    id: 'war',
    from: 19,
    to: 25,
    cut: 'dip',
    ease: 'inOut',
    hours: [9.8, 11.6],
    cam: [
      { at: 'field', dx: 0, dy: 0, dist: 26, pitch: 17, yaw: 172, lift: 0.8, fov: 40 },
      { at: 'crowd', dx: 0, dy: 0, dist: 20, pitch: 16, yaw: 158, lift: 0.8, fov: 40 },
    ],
  },
  {
    id: 'melee',
    from: 25,
    to: 30,
    cut: 'hard',
    ease: 'linear',
    hours: [11.6, 14.4],
    cam: [
      { at: 'crowd', dx: 0, dy: 0, dist: 13, pitch: 14, yaw: 110, lift: 1.2, fov: 40 },
      { at: 'crowd', dx: 0, dy: 0, dist: 10, pitch: 16, yaw: 165, lift: 1.4, fov: 40 },
    ],
  },
  {
    id: 'titans',
    from: 30,
    to: 36,
    cut: 'hard',
    ease: 'out',
    hours: [14.4, 17.2],
    cam: [
      { at: 'kronos', dx: 0, dy: 0, dist: 15, pitch: 7, yaw: -30, lift: 3.2, fov: 46 },
      { at: 'kronos', dx: 0, dy: 0, dist: 26, pitch: 12, yaw: 25, lift: 3.6, fov: 44 },
    ],
  },
  {
    id: 'lineup',
    from: 36,
    to: FILM_LENGTH,
    cut: 'dip',
    ease: 'inOut',
    hours: [18.6, 20.3],
    // the ten pillars of light go up along the line, then the camera comes in on the gods standing in it
    cam: [
      { at: 'lineup', dx: 0, dy: 0, dist: 22, pitch: 9, yaw: -6, lift: 2.2, fov: 36 },
      { at: 'lineup', dx: 2, dy: 1, dist: 12, pitch: 4, yaw: 4, lift: 1.5, fov: 36 },
    ],
  },
]);

/** The lines of text, each fading in and out over `fade` seconds. */
export const CAPTIONS = Object.freeze([
  { from: 1.4, to: 7.6, text: 'Raise a city of the faithful' },
  { from: 9.6, to: 14.2, text: 'Pray. Summon the gods.' },
  { from: 20, to: 28.6, text: 'Lead them to war' },
  { from: 31, to: 35.4, text: 'Unleash the titans' },
  { from: 38.6, to: 45.8, text: 'Ten mythologies. One war.' },
]);
export const CAPTION_FADE = 0.7;

/**
 * Sounds under the picture, from the game's own synthesized set (src/audio/sfx.js). The page only
 * unlocks audio after a click or a key, so on a first visit these are silent; they play when it is open.
 */
export const AUDIO_CUES = Object.freeze([
  { at: 0.6, name: 'horn', volume: 0.6 },
  { at: 11.6, name: 'summon_god', volume: 0.9 },
  { at: 19.2, name: 'horn', volume: 0.9 },
  { at: 25.4, name: 'lightning', volume: 0.8 },
  { at: 29.7, name: 'summon_titan', volume: 1 },
  { at: 36.5, name: 'horn', volume: 0.8 },
  { at: 36.8, name: 'summon_god', volume: 0.8 }, // the engine drops a summon_god closer than a second to the last
  { at: 37.9, name: 'summon_god', volume: 0.8 },
  { at: 39, name: 'summon_god', volume: 0.8 },
  { at: 41.4, name: 'victory', volume: 0.7 },
]);

/** The shot on screen at film second t. */
export function shotAt(t) {
  let shot = SHOTS[0];
  for (const s of SHOTS) if (t >= s.from) shot = s;
  return shot;
}

/** The hour of the day (0..24) at film second t: each shot runs its own stretch of the day (the sun sweeps from dawn to the blue hour over the film). */
export function hourAt(t) {
  const shot = shotAt(t);
  const [h0, h1] = shot.hours;
  return lerp(h0, h1, clamp01((t - shot.from) / (shot.to - shot.from)));
}

/** Darkness over the picture (0 clear .. 1 black): the fade in, the dips at cuts, the fade out. */
export function fadeAt(t) {
  let f = 1 - clamp01(t / 1.1); // in from black
  const out = clamp01((t - (FILM_LENGTH - 1.3)) / 1.3);
  f = Math.max(f, smooth(out));
  for (const s of SHOTS) {
    if (s.cut !== 'dip') continue;
    const d = Math.abs(t - s.from);
    const dip = t < s.from ? clamp01(1 - d / 0.22) : clamp01(1 - d / 0.4);
    f = Math.max(f, dip);
  }
  return clamp01(f);
}

/** How far the letterbox bars have closed (0 open .. 1 closed): they slide in at the start and out at the end. */
export function barsAt(t) {
  return smooth(clamp01(t / 1.4)) * (1 - smooth(clamp01((t - (FILM_LENGTH - 1.2)) / 1.2)));
}

/** The caption showing at film second t: { text, alpha } or null. */
export function captionAt(t) {
  for (const c of CAPTIONS) {
    if (t < c.from || t > c.to) continue;
    const a = Math.min(clamp01((t - c.from) / CAPTION_FADE), clamp01((c.to - t) / CAPTION_FADE));
    return { text: c.text, alpha: smooth(a) };
  }
  return null;
}

const FIELDS = ['dx', 'dy', 'dist', 'pitch', 'yaw', 'lift', 'fov'];

/**
 * The camera at film second t, written into `out` (x, y, dist, pitch, yaw, lift, fov).
 * @param {number} t
 * @param {(name: string) => ({ x: number, y: number } | null)} locate where a named point of the set is now
 * @param {object} [out]
 */
export function cameraAt(t, locate, out = {}) {
  const shot = shotAt(t);
  const k = EASE[shot.ease || 'inOut'](clamp01((t - shot.from) / (shot.to - shot.from)));
  const specs = shot.cam;
  const f = k * (specs.length - 1);
  const i = Math.min(specs.length - 2, Math.floor(f));
  const a = specs[i];
  const b = specs[i + 1];
  const u = f - i;
  const pa = locate(a.at) || locate('village');
  const pb = locate(b.at) || pa;
  out.x = lerp(pa.x + a.dx, pb.x + b.dx, u);
  out.y = lerp(pa.y + a.dy, pb.y + b.dy, u);
  for (const key of FIELDS) {
    if (key === 'dx' || key === 'dy') continue;
    out[key] = lerp(a[key], b[key], u);
  }
  return out;
}
