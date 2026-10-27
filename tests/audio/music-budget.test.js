// The music's cost, as numbers a test can hold: every note is a handful of audio nodes that the
// browser's audio thread runs for as long as they live, so the score is kept inside a budget of
// sources playing at once and nodes created per second. The limits sit a little above what the
// themes measure today (a live browser's audio-thread load tracks these two numbers closely:
// DESIGN 9, "Music"); a voice recipe or a pattern that makes the score much heavier fails here
// instead of on a player's laptop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext } from './fake-audio.js';
import { sfx } from '../../src/audio/sfx.js';
import { MusicEngine, MUSIC_THEME_IDS } from '../../src/audio/music.js';

const SECONDS = 70; // of music, played into a fake clock
const FROM = 15; // measure after the first bars (the opening is lighter than the groove)

/** Play a theme at a steady intensity and report how many sources sound at once and how many nodes it makes. */
function measure(theme, level) {
  const ctx = new FakeAudioContext({ state: 'running', sampleRate: 8000 });
  sfx.init({ context: ctx });
  const engine = new MusicEngine();
  engine._startTimer = () => {};
  engine.init({ volume: 0.5 });
  engine.setIntensity(level);
  engine.play(theme, { seed: 7 });
  for (let t = 0; t < SECONDS; t += 0.25) {
    ctx.currentTime = t + 0.25;
    engine.tick();
  }
  let sum = 0;
  let max = 0;
  let n = 0;
  for (let t = FROM; t < SECONDS - 5; t += 0.1) {
    let live = 0;
    for (const s of ctx.sources) if (s.started !== null && s.started <= t && (s.stopped ?? Infinity) > t) live++;
    sum += live;
    max = Math.max(max, live);
    n++;
  }
  return { mean: sum / n, max, nodesPerSecond: ctx.nodes.length / SECONDS };
}

const LIMITS = [
  // intensity, mean sources playing at once, most at once, nodes created per second
  [0.1, 42, 62, 32],
  [0.9, 60, 100, 185],
];

for (const [level, meanLimit, maxLimit, createLimit] of LIMITS) {
  test(`every theme at intensity ${level} stays inside the voice budget`, () => {
    for (const id of MUSIC_THEME_IDS) {
      const m = measure(id, level);
      assert.ok(m.mean <= meanLimit, `${id}: ${m.mean.toFixed(1)} sources playing on average (limit ${meanLimit})`);
      assert.ok(m.max <= maxLimit, `${id}: ${m.max} sources at the busiest moment (limit ${maxLimit})`);
      assert.ok(m.nodesPerSecond <= createLimit, `${id}: ${m.nodesPerSecond.toFixed(0)} nodes created a second (limit ${createLimit})`);
    }
  });
}

test('a busier score costs more than a calm one, but not by orders of magnitude', () => {
  for (const id of MUSIC_THEME_IDS) {
    const calm = measure(id, 0.1);
    const battle = measure(id, 0.9);
    assert.ok(battle.mean > calm.mean, `${id}: the battle has more voices than the calm`);
    assert.ok(battle.mean < calm.mean * 3, `${id}: ${battle.mean.toFixed(0)} against ${calm.mean.toFixed(0)}`);
  }
});
