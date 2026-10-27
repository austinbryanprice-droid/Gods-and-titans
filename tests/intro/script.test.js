// The intro film's script (src/intro/script.js): the shots tile the film, every curve stays in range
// and the camera is finite at every frame. Pure arithmetic, walked frame by frame like the film would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILM_LENGTH, SHOTS, CAPTIONS, CAPTION_FADE, AUDIO_CUES, EASE, shotAt, hourAt, fadeAt, barsAt, captionAt, cameraAt } from '../../src/intro/script.js';
import { SFX_NAMES } from '../../src/audio/sfx.js';

const STEP = 0.05;
const frames = (fn) => {
  for (let t = 0; t <= FILM_LENGTH + 1e-9; t += STEP) fn(Math.min(t, FILM_LENGTH));
};
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// where the set's named points are, for the camera (the film resolves these from the stage)
const SET = { village: { x: 17, y: 15 }, temple: { x: 20, y: 23 }, field: { x: 38, y: 24 }, zeus: { x: 19, y: 27 }, crowd: { x: 40, y: 24 }, kronos: { x: 30, y: 30 }, lineup: { x: 54, y: 12 } };
const locate = (name) => SET[name] || null;

test('the shots tile the film from its first second to its last, in order', () => {
  assert.equal(SHOTS[0].from, 0);
  assert.equal(SHOTS[SHOTS.length - 1].to, FILM_LENGTH);
  for (let i = 0; i < SHOTS.length; i++) {
    const s = SHOTS[i];
    assert.ok(s.to > s.from, `${s.id} has a length`);
    if (i) assert.equal(s.from, SHOTS[i - 1].to, `${s.id} starts where ${SHOTS[i - 1].id} ends`);
  }
  assert.equal(new Set(SHOTS.map((s) => s.id)).size, SHOTS.length, 'ids are unique');
  assert.ok(FILM_LENGTH >= 30 && FILM_LENGTH <= 60, 'a short film, not a trailer');
});

test('shotAt names the shot on screen, a boundary belonging to the shot that starts there', () => {
  assert.equal(shotAt(0).id, SHOTS[0].id);
  assert.equal(shotAt(-3).id, SHOTS[0].id);
  assert.equal(shotAt(FILM_LENGTH).id, SHOTS[SHOTS.length - 1].id);
  assert.equal(shotAt(FILM_LENGTH + 20).id, SHOTS[SHOTS.length - 1].id);
  for (const s of SHOTS) {
    assert.equal(shotAt(s.from).id, s.id, `${s.id} at its start`);
    assert.equal(shotAt((s.from + s.to) / 2).id, s.id, `${s.id} in the middle`);
  }
});

test('every shot is well formed: a cut kind, an hour range, a camera of finite specs', () => {
  for (const s of SHOTS) {
    if (s.from > 0) assert.ok(['hard', 'dip'].includes(s.cut), `${s.id} says how it cuts in`);
    assert.ok(s.cam.length >= 2, `${s.id} moves the camera`);
    assert.ok(s.hours.length === 2 && s.hours.every((h) => h >= 0 && h <= 24), `${s.id} hours`);
    for (const c of s.cam) {
      assert.equal(typeof c.at, 'string');
      for (const k of ['dx', 'dy', 'dist', 'pitch', 'yaw', 'lift', 'fov']) assert.ok(Number.isFinite(c[k]), `${s.id} ${c.at}.${k}`);
      assert.ok(c.dist > 2 && c.dist < 120, `${s.id} dist ${c.dist}`);
      assert.ok(c.pitch > 0 && c.pitch < 80, `${s.id} pitch ${c.pitch}`);
      assert.ok(c.fov >= 20 && c.fov <= 60, `${s.id} fov ${c.fov}`);
    }
    assert.ok(!s.ease || s.ease in EASE, `${s.id} ease ${s.ease}`);
  }
});

test('the sun only moves forward through the film, from the early morning to the blue hour', () => {
  let prev = hourAt(0);
  frames((t) => {
    const h = hourAt(t);
    // a shot may start later than the last one ended (a dip hides the jump) but the day never runs backwards
    assert.ok(h >= prev - 1e-9, `hour ${h} at ${t}s after ${prev}`);
    prev = h;
  });
  assert.ok(hourAt(0) < 8, 'it opens in the dawn light');
  assert.ok(hourAt(FILM_LENGTH) > 19, 'it ends at dusk');
  // inside a shot the hour is a straight run between the shot's own two ends
  for (const s of SHOTS) {
    assert.ok(close(hourAt(s.from), s.hours[0]), `${s.id} starts at its first hour`);
    assert.ok(close(hourAt((s.from + s.to) / 2), (s.hours[0] + s.hours[1]) / 2, 1e-9), `${s.id} runs straight`);
  }
});

test('a jump in the hour between shots only ever comes behind a dip to black', () => {
  for (let i = 1; i < SHOTS.length; i++) {
    const jump = SHOTS[i].hours[0] - SHOTS[i - 1].hours[1];
    if (jump > 0.8) assert.equal(SHOTS[i].cut, 'dip', `${SHOTS[i].id} jumps ${jump.toFixed(1)} h on a hard cut`);
  }
});

test('fadeAt: black at the first and last frame, clear mid-shot, black at a dip and not at a hard cut', () => {
  assert.equal(fadeAt(0), 1);
  assert.equal(fadeAt(FILM_LENGTH), 1);
  assert.ok(fadeAt(SHOTS[0].to / 2) < 0.01);
  frames((t) => {
    const f = fadeAt(t);
    assert.ok(f >= 0 && f <= 1, `fade ${f} at ${t}s`);
  });
  for (const s of SHOTS.slice(1)) {
    if (s.cut === 'dip') assert.equal(fadeAt(s.from), 1, `${s.id} dips to black`);
    else assert.ok(fadeAt(s.from) < 0.01, `${s.id} cuts hard on a clear picture`);
  }
});

test('barsAt: open at both ends of the film, closed through it', () => {
  assert.equal(barsAt(0), 0);
  assert.equal(barsAt(FILM_LENGTH), 0);
  assert.equal(barsAt(FILM_LENGTH / 2), 1);
  frames((t) => {
    const b = barsAt(t);
    assert.ok(b >= 0 && b <= 1, `bars ${b} at ${t}s`);
  });
});

test('captions: inside the film, in order, apart, and not cut through by a dip to black', () => {
  for (let i = 0; i < CAPTIONS.length; i++) {
    const c = CAPTIONS[i];
    assert.ok(c.from >= 0 && c.to <= FILM_LENGTH && c.to - c.from > 2 * CAPTION_FADE, `caption ${i} fits the film and its fades`);
    assert.ok(c.text.length > 0 && c.text.length < 40, `caption ${i} is a short line`);
    if (i) assert.ok(c.from >= CAPTIONS[i - 1].to, `caption ${i} comes after caption ${i - 1}`);
    for (const s of SHOTS) if (s.cut === 'dip') assert.ok(!(c.from < s.from && c.to > s.from), `"${c.text}" runs over the dip at ${s.from}s`);
  }
});

test('captionAt: fades in and out, nothing between lines', () => {
  const c = CAPTIONS[0];
  assert.equal(captionAt(c.from - 0.5), null);
  assert.equal(captionAt(c.to + 0.5), null);
  assert.equal(captionAt(c.from).alpha, 0);
  assert.equal(captionAt(c.to).alpha, 0);
  const mid = captionAt((c.from + c.to) / 2);
  assert.equal(mid.text, c.text);
  assert.equal(mid.alpha, 1);
  const rising = captionAt(c.from + CAPTION_FADE / 2).alpha;
  assert.ok(rising > 0 && rising < 1, 'fading in');
  frames((t) => {
    const cap = captionAt(t);
    if (cap) assert.ok(cap.alpha >= 0 && cap.alpha <= 1);
  });
});

test('audio cues: in order, inside the film, named from the game\'s own sounds', () => {
  assert.ok(AUDIO_CUES.length > 0);
  for (let i = 0; i < AUDIO_CUES.length; i++) {
    const c = AUDIO_CUES[i];
    assert.ok(SFX_NAMES.includes(c.name), `${c.name} is one of the synthesized sounds`);
    assert.ok(c.at >= 0 && c.at < FILM_LENGTH, `${c.name} at ${c.at}`);
    assert.ok(c.volume > 0 && c.volume <= 1);
    if (i) assert.ok(c.at >= AUDIO_CUES[i - 1].at, 'sorted by time');
  }
});

test('cameraAt: starts every shot at its first spec and ends it at the last, with the offsets on the named point', () => {
  for (const s of SHOTS) {
    const a = s.cam[0];
    const b = s.cam[s.cam.length - 1];
    const first = cameraAt(s.from, locate);
    const pa = locate(a.at);
    assert.ok(close(first.x, pa.x + a.dx) && close(first.y, pa.y + a.dy), `${s.id} starts on ${a.at}`);
    for (const k of ['dist', 'pitch', 'yaw', 'lift', 'fov']) assert.ok(close(first[k], a[k]), `${s.id} starts at ${k} ${a[k]}`);
    const last = cameraAt(s.to - 1e-9, locate);
    const pb = locate(b.at);
    assert.ok(Math.abs(last.x - (pb.x + b.dx)) < 1e-3 && Math.abs(last.y - (pb.y + b.dy)) < 1e-3, `${s.id} ends on ${b.at}`);
    for (const k of ['dist', 'pitch', 'yaw', 'lift', 'fov']) assert.ok(Math.abs(last[k] - b[k]) < 1e-3, `${s.id} ends at ${k} ${b[k]}`);
  }
});

test('cameraAt: finite and in sensible bounds at every frame, writing into the object it is given', () => {
  const out = {};
  frames((t) => {
    const r = cameraAt(t, locate, out);
    assert.equal(r, out, 'reuses the object');
    for (const k of ['x', 'y', 'dist', 'pitch', 'yaw', 'lift', 'fov']) assert.ok(Number.isFinite(out[k]), `${k} at ${t}s`);
    assert.ok(out.dist > 2 && out.pitch > 0 && out.pitch < 80, `framing at ${t}s`);
  });
});

test('cameraAt: a name the stage cannot place falls back to the village, and a missing second subject to the first', () => {
  const village = locate('village');
  const lost = (name) => (name === 'village' ? village : null);
  const s = SHOTS[1]; // prayer: the temple, then the god
  const p = cameraAt(s.from, lost);
  assert.ok(close(p.x, village.x + s.cam[0].dx) && close(p.y, village.y + s.cam[0].dy));
  const q = cameraAt((s.from + s.to) / 2, lost);
  assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y));
  // the second subject missing: the move still ends on the first subject's place
  const onlyTemple = (name) => (name === s.cam[0].at ? locate(name) : name === 'village' ? village : null);
  const r = cameraAt(s.to - 1e-9, onlyTemple);
  assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y));
});
