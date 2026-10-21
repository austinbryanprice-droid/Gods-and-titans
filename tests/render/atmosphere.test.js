// The time of day (src/render/atmosphere.js): the match clock maps to an hour,
// the hour to a look. Checks the clock and its pacing, the sun / moon arc and the
// key light that changes hands at the blue hour without a jump, that the night
// stays lit (moonlit blue, not black), that every client resolves the same sky
// from the same sim time, and the setting values the menus offer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Map the browser import map ('three') onto the vendored copy.
const VENDOR = new URL('../../vendor/three/', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(`${VENDOR}three.module.js`)}, shortCircuit: true };
  return next(spec, ctx);
}`)}`);

const A = await import('../../src/render/atmosphere.js');
const { TIME_OF_DAY_MODES } = await import('../../src/settings.js');
const { TIME_OF_DAY_OPTIONS } = await import('../../src/ui/time-of-day-options.js');

const { Atmosphere, DAY_SECONDS, START_HOUR, TIME_PRESETS, TIME_MODES, MIN_KEY_ELEVATION, EVENING_SWAP, MORNING_SWAP, hourAt, resolveHour, createState, luminance, formatHour } = A;
const MIN_Y = Math.sin((MIN_KEY_ELEVATION * Math.PI) / 180);
const deg = (r) => (r * 180) / Math.PI;

test('the match opens on the golden morning and the day starts over every DAY_SECONDS', () => {
  assert.equal(hourAt(0), START_HOUR);
  assert.equal(START_HOUR, TIME_PRESETS.golden);
  assert.ok(Math.abs(hourAt(DAY_SECONDS) - START_HOUR) < 1e-9);
  assert.ok(Math.abs(hourAt(DAY_SECONDS * 3 + 123) - hourAt(123)) < 1e-9);
  assert.equal(hourAt(NaN), START_HOUR, 'a bad clock reads as the start');
  assert.ok(Math.abs(hourAt(-DAY_SECONDS / 2) - hourAt(DAY_SECONDS / 2)) < 1e-9, 'a negative clock wraps');
});

test('the hour only moves forward through the day, and the night passes faster than the day', () => {
  let prev = -Infinity;
  let unwrapped = START_HOUR;
  let last = hourAt(0);
  for (let s = 0; s <= DAY_SECONDS; s += 1) {
    const h = hourAt(s);
    let step = h - last;
    if (step < -12) step += 24;
    assert.ok(step >= -1e-9, `hour never runs backward at ${s} s`);
    unwrapped += step;
    last = h;
    assert.ok(unwrapped >= prev);
    prev = unwrapped;
  }
  assert.ok(Math.abs(unwrapped - (START_HOUR + 24)) < 0.05, 'a full day is 24 hours');
  // seconds spent between the evening and the morning key-light swaps vs. the rest
  let night = 0;
  for (let s = 0; s < DAY_SECONDS; s += 0.5) if (A.keyIsMoonAt(hourAt(s))) night += 0.5;
  assert.ok(night > 0.2 * DAY_SECONDS && night < 0.35 * DAY_SECONDS, `the moon is the key light for ${night} s of ${DAY_SECONDS}`);
});

test('modes: the cycle, the five held times of day, an hour; junk is ignored', () => {
  const a = new Atmosphere();
  assert.equal(a.mode, 'cycle');
  assert.ok(a.running);
  for (const [name, hour] of Object.entries(TIME_PRESETS)) {
    assert.ok(a.setMode(name) || a.mode === name);
    assert.equal(a.mode, name);
    assert.equal(a.hour, hour);
    assert.ok(!a.running);
  }
  a.setMode('cycle');
  assert.equal(a.setMode('teatime'), false);
  assert.equal(a.setMode(NaN), false);
  assert.equal(a.setMode(null), false);
  assert.equal(a.mode, 'cycle', 'junk leaves the mode alone');
  a.setMode(18.5);
  assert.equal(a.mode, 'hour');
  assert.equal(a.hour, 18.5);
  a.setMode('6.25');
  assert.equal(a.hour, 6.25);
  a.setMode(25);
  assert.equal(a.hour, 1, 'hours wrap');
  // a held time ignores the match clock
  a.setMode('night');
  const before = a.update(0).keyColor.getHex();
  assert.equal(a.update(500).keyColor.getHex(), before);
  // and the cycle follows it
  a.setMode('cycle');
  const s0 = a.update(0).hour;
  assert.notEqual(a.update(300).hour, s0);
});

test('the settings values, the menu options and the renderer modes are the same list', () => {
  assert.deepEqual([...TIME_OF_DAY_MODES], [...TIME_MODES]);
  assert.deepEqual(TIME_OF_DAY_OPTIONS.map((o) => o[0]), [...TIME_MODES]);
  for (const [, label, note] of TIME_OF_DAY_OPTIONS) assert.ok(label && note.length > 10);
});

test('every client resolves the same sky from the same sim time', () => {
  const a = new Atmosphere();
  const b = new Atmosphere();
  for (const t of [0, 31.7, 200, 468, 522, 700, 760, 899.9, 1234.5]) {
    const x = a.update(t);
    const y = b.update(t);
    assert.equal(x.hour, y.hour);
    assert.deepEqual(x.keyDir.toArray(), y.keyDir.toArray());
    assert.deepEqual(x.keyColor.toArray(), y.keyColor.toArray());
    assert.deepEqual(x.haze.toArray(), y.haze.toArray());
    assert.equal(x.exposure, y.exposure);
  }
});

test('the key light is the sun by day and the moon at night, and never grazes', () => {
  const s = createState();
  let swaps = 0;
  let wasMoon = null;
  for (let h = 0; h < 24; h += 0.01) {
    resolveHour(s, h);
    assert.ok(Math.abs(s.keyDir.length() - 1) < 1e-9, 'unit vector');
    assert.ok(s.keyDir.y >= MIN_Y - 1e-9, `key light above ${MIN_KEY_ELEVATION} degrees at ${formatHour(h)}`);
    assert.ok(Math.abs(s.sunDir.length() - 1) < 1e-9 && Math.abs(s.moonDir.length() - 1) < 1e-9);
    if (wasMoon !== null && wasMoon !== s.keyIsMoon) swaps++;
    wasMoon = s.keyIsMoon;
  }
  assert.equal(swaps, 2, 'the key light changes hands once each evening and morning');
  resolveHour(s, 12.5);
  assert.ok(!s.keyIsMoon);
  assert.ok(s.sunElevation > 50 && s.moonElevation < 0, 'noon: the sun high, the moon below');
  resolveHour(s, 23);
  assert.ok(s.keyIsMoon);
  assert.ok(s.moonElevation > 20 && s.sunElevation < 0, 'night: the moon up, the sun below');
  assert.ok(s.moonColor.b > 0 && luminance(s.moonColor) > 0.5, 'the moon lights the night');
  resolveHour(s, 12.5);
  assert.equal(luminance(s.moonColor), 0, 'no moonlight by day');
});

test('the sun climbs a low golden morning to a high noon and sets in the west', () => {
  const s = createState();
  resolveHour(s, 8);
  assert.ok(s.sunElevation > 22 && s.sunElevation < 38, `golden morning: ${s.sunElevation}`);
  assert.ok(s.sunDir.x > 0.5, 'the morning sun is in the east (+x)');
  assert.ok(s.keyDir.z > 0, 'and behind the camera (+z) so faces toward it are lit');
  resolveHour(s, 12.5);
  assert.ok(s.sunElevation > 52, `noon: ${s.sunElevation}`);
  assert.ok(Math.abs(s.sunDir.x) < 0.05, 'noon: due south, over the camera');
  resolveHour(s, 17);
  assert.ok(s.sunDir.x < -0.5, 'the afternoon sun is in the west (-x)');
  resolveHour(s, 19);
  assert.ok(s.sunElevation > 0 && s.sunElevation < 12, `dusk: ${s.sunElevation}`);
});

test('the key light changes hands at the blue hour with no light to jump', () => {
  const s = createState();
  for (const h of [EVENING_SWAP, MORNING_SWAP]) {
    resolveHour(s, h);
    assert.ok(s.keyIntensity < 0.02, `no direct light at ${formatHour(h)}`);
    resolveHour(s, h - 0.05);
    const before = s.keyIntensity;
    resolveHour(s, h + 0.05);
    const after = s.keyIntensity;
    assert.ok(before < 0.35 && after < 0.35, `light is faint on both sides of ${formatHour(h)} (${before.toFixed(3)}, ${after.toFixed(3)})`);
  }
});

test('the look never jumps: hour by hour, intensities and colors change in small steps', () => {
  const a = createState();
  const b = createState();
  let worst = { name: '', d: 0 };
  const note = (name, d, h) => {
    if (d > worst.d) worst = { name: `${name} at ${formatHour(h)}`, d };
  };
  for (let h = 0; h < 24; h += 0.01) {
    resolveHour(a, h);
    resolveHour(b, h + 0.01);
    note('keyIntensity', Math.abs(a.keyIntensity - b.keyIntensity), h);
    note('exposure', Math.abs(a.exposure - b.exposure), h);
    note('hemi', Math.abs(a.hemiIntensity - b.hemiIntensity), h);
    for (const k of ['haze', 'skyZenith', 'skyHorizon', 'hemiSky', 'hemiGround', 'ambientSky', 'rimColor']) {
      note(k, Math.max(Math.abs(a[k].r - b[k].r), Math.abs(a[k].g - b[k].g), Math.abs(a[k].b - b[k].b)), h);
    }
    note('night', Math.abs(a.night - b.night), h);
    note('lamp', Math.abs(a.lamp - b.lamp), h);
    // the direction may only jump where there is no direct light
    const dot = a.keyDir.dot(b.keyDir);
    if (dot < Math.cos((1.2 * Math.PI) / 180)) assert.ok(a.keyIntensity < 0.03 && b.keyIntensity < 0.03, `key direction jumps ${deg(Math.acos(dot)).toFixed(1)} degrees with light on at ${formatHour(h)}`);
  }
  assert.ok(worst.d < 0.08, `largest step per 0.01 h: ${worst.name} ${worst.d.toFixed(4)}`);
});

test('night is moonlit blue, never black, and the lamps are lit', () => {
  const s = createState();
  for (const h of [20, 20.5, 21, 22.5, 0, 2, 3.5, 4.5, 4.7]) {
    resolveHour(s, h);
    const ambient = luminance(s.ambientSky) + luminance(s.ambientGround);
    assert.ok(ambient > 0.2, `ambient light at ${formatHour(h)}: ${ambient.toFixed(3)}`);
    assert.ok(s.exposure >= 1.2, `exposure lifted at night ${formatHour(h)}`);
    assert.ok(s.lamp > 0.85, `lamps lit at ${formatHour(h)}`);
    assert.ok(s.hemiSky.b > s.hemiSky.r * 1.4, 'the night sky light is blue');
  }
  resolveHour(s, 22.5);
  assert.equal(s.night, 1);
  assert.ok(s.keyIsMoon && s.keyIntensity > 0.9 && s.keyColor.b > s.keyColor.r, 'a cool moonlit key');
  assert.ok(s.cloudScale < 1, 'fewer cloud shadows by moonlight');
  resolveHour(s, 12.5);
  assert.ok(s.night === 0 && s.lamp === 0, 'no lamps at noon');
});

test('the presets look like the panels: warm gold, white day, magenta dusk, cool night, rose dawn', () => {
  const s = createState();
  resolveHour(s, TIME_PRESETS.golden);
  assert.ok(s.keyHue.r > s.keyHue.g && s.keyHue.g > s.keyHue.b * 2, 'golden morning: orange light');
  assert.ok(s.shadowTint[2] > s.shadowTint[0] && s.highlightTint[0] > s.highlightTint[2], 'cool shadows, warm highlights');
  resolveHour(s, TIME_PRESETS.day);
  assert.ok(s.keyHue.r > 0.9 && s.keyHue.b > 0.55, 'bright day: nearly white sun');
  assert.ok(s.skyZenith.b > s.skyZenith.r * 1.5, 'a blue sky');
  resolveHour(s, TIME_PRESETS.dusk);
  assert.ok(s.keyHue.r > s.keyHue.b && s.keyHue.b > s.keyHue.g, 'magenta dusk: pink light (blue above green)');
  assert.ok(s.haze.r > s.haze.g && s.haze.b > s.haze.g, 'a magenta haze');
  resolveHour(s, TIME_PRESETS.night);
  assert.ok(s.keyHue.b > s.keyHue.r * 1.4, 'moonlight is blue');
  assert.ok(s.haze.b > s.haze.r * 2, 'a blue haze');
  resolveHour(s, TIME_PRESETS.dawn);
  assert.ok(s.keyHue.r > s.keyHue.g && s.keyHue.g > s.keyHue.b, 'dawn: peach light');
  assert.ok(s.haze.r > s.haze.b, 'a rose haze');
});

test('the state is rewritten in place: references stay valid', () => {
  const a = new Atmosphere();
  const dir = a.state.keyDir;
  const color = a.state.keyColor;
  const tint = a.state.shadowTint;
  a.update(0);
  a.setMode('night');
  a.update(100);
  assert.equal(a.state.keyDir, dir);
  assert.equal(a.state.keyColor, color);
  assert.equal(a.state.shadowTint, tint);
});

test('formatHour writes a clock face', () => {
  assert.equal(formatHour(8), '08:00');
  assert.equal(formatHour(18.5), '18:30');
  assert.equal(formatHour(25.25), '01:15');
  assert.equal(formatHour(-1), '23:00');
});
