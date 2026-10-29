// The pause bar of an online game (DESIGN 7): who paused it, or that a new host waits, and when it goes on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pauseText } from '../../src/ui/hud-data.js';

test('pause bar: names who paused and counts down to the end', () => {
  const name = (i) => ['Ann', 'Ben'][i];
  assert.equal(pauseText(null, name, 0), '');
  assert.equal(pauseText({ by: 1, reason: 'player', endsAt: 120000 }, name, 0), 'Paused by Ben · goes on in 2:00');
  assert.equal(pauseText({ by: 0, reason: 'player', endsAt: 5000 }, name, 4100), 'Paused by Ann · goes on in 0:01');
  assert.equal(pauseText({ by: 0, reason: 'player', endsAt: 5000 }, name, 9000), 'Paused by Ann · goes on in 0:00');
  assert.equal(pauseText({ by: -1, reason: 'handoff', endsAt: 30000 }, name, 0), 'The new host waits for the players to reconnect · goes on in 0:30');
});
