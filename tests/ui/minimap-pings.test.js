// The minimap's alert pings and team marks never ask the canvas for a negative radius. A ping is stamped
// with performance.now() when the alert fires, which can be later than the frame's timestamp the minimap
// draws with (most of all when frames are slow, late in a big game); the canvas throws on a negative arc
// radius, and the throw cut the rest of that frame's HUD update short.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { TeamMarks } from '../../src/game/team-marks.js';
import { Minimap } from '../../src/ui/minimap.js';
import { ViewState } from '../../src/game/view-state.js';
import { saveSettings } from '../../src/settings.js';
import { makeWorld } from '../sim/helpers.js';

before(() => {
  installFakeDom();
  saveSettings({ tipsDismissed: true });
});

function setup(marks = null) {
  const world = makeWorld();
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  const canvas = document.createElement('canvas');
  canvas.isConnected = true;
  const ctx = canvas.getContext('2d');
  const radii = [];
  ctx.arc = (x, y, r) => {
    radii.push(r);
    if (r < 0) throw new RangeError(`negative radius ${r}`);
  };
  globalThis.window.addEventListener = () => {};
  const minimap = new Minimap({ canvas, viewState: vs, getCamera: () => null, onPointer: () => {}, marks });
  return { minimap, radii };
}

test('a ping newer than the frame being drawn starts at its smallest ring', () => {
  const { minimap, radii } = setup();
  const frame = performance.now();
  minimap.ping(10, 10);
  minimap.pings[0].t0 = frame + 400; // raised 400 ms after the frame's timestamp (a slow frame)
  assert.doesNotThrow(() => minimap.update(frame));
  assert.ok(radii.length > 0 && radii.every((r) => r >= 0), `radii ${radii.map((r) => r.toFixed(2)).join(', ')}`);
});

test('a team mark newer than the frame being drawn does too', () => {
  const marks = new TeamMarks();
  const { minimap, radii } = setup(marks);
  marks.add({ from: 1, kind: 'attack', x: 10, y: 12 }, 2600); // a second ahead of the frame
  assert.doesNotThrow(() => minimap.update(1600));
  assert.ok(radii.length > 0 && radii.every((r) => r >= 0));
});
