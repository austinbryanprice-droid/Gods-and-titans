// The Decade of Peace on the HUD (src/ui/hud.js, hud-data.js): the countdown chip in the top bar,
// one line as the game opens, one reminder at each mark, nothing in a normal game or once the peace is over.
// Fake DOM, a real ViewState fed snapshots at chosen times.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../../src/ui/hud.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { PEACE_WARNINGS, peaceStartText, peaceWarning } from '../../src/ui/hud-data.js';
import { ViewState } from '../../src/game/view-state.js';
import { saveSettings } from '../../src/settings.js';
import { makeWorld } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(() => {
  installFakeDom();
  saveSettings({ tipsDismissed: true });
});

const huds = [];
after(() => {
  for (const h of huds) h.dispose();
});

/** A HUD on a world with (or without) a peace; push(time) shows the next snapshot at that game time. */
function setup(opts = {}) {
  const world = makeWorld(opts);
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  const push = (time) => {
    const snap = world.getSnapshot();
    vs.pushSnapshot({ ...snap, tick: snap.tick + Math.round(time * 20) + 1, time }, 50);
  };
  push(opts.at ?? 0);
  const root = document.createElement('div');
  const game = { viewState: vs, selection: new Selection(vs), session: null, input: null, renderer: null, command() {}, sendChat() {} };
  const hud = new Hud({ root, game });
  huds.push(hud);
  let now = 1000;
  const tick = () => hud.update((now += 500));
  const lines = () => hud.msgs.children.map((c) => c.textContent);
  return { hud, vs, push, tick, lines };
}

test('a normal game has no peace chip, and no peace lines', () => {
  const { hud, vs, tick, lines } = setup();
  tick();
  assert.equal(vs.peaceActive(), false);
  assert.equal(hud.peaceChip.hidden, true);
  assert.ok(!lines().some((l) => /Decade of Peace/.test(l)));
});

test('the chip counts the peace down from the snapshots and says so as the game opens', () => {
  const { hud, vs, push, tick, lines } = setup({ peaceMinutes: 30 });
  tick();
  assert.equal(vs.peaceLeft(), 1800);
  assert.equal(hud.peaceChip.hidden, false);
  assert.equal(hud.peaceClock.textContent, '30:00');
  assert.equal(hud.peaceChip.classList.contains('is-ending'), false);
  assert.match(hud.peaceChip.title, /Decade of Peace/);
  assert.ok(lines().includes(peaceStartText(1800)), 'the opening line');
  assert.match(peaceStartText(1800), /for another 30:00/);
  push(123.4);
  tick();
  assert.equal(hud.peaceClock.textContent, '27:57', 'rounded up, like the sim\'s own clock');
  tick();
  assert.equal(lines().filter((l) => l === peaceStartText(1800)).length, 1, 'said once');
});

test('one reminder at 5:00, 1:00 and 0:10, the clock pulses for the last minute, and the chip goes when the peace ends', () => {
  const { hud, push, tick, lines } = setup({ peaceMinutes: 45 });
  tick();
  const said = () => lines().filter((l) => /ends in/.test(l));
  assert.deepEqual(PEACE_WARNINGS, [300, 60, 10]);
  push(45 * 60 - 301);
  tick();
  assert.equal(said().length, 0);
  push(45 * 60 - 300);
  tick();
  tick();
  assert.deepEqual(said(), [peaceWarning(300)]);
  assert.match(peaceWarning(300), /ends in 5 minutes/);
  assert.equal(hud.peaceChip.classList.contains('is-ending'), false);
  push(45 * 60 - 61);
  tick();
  assert.equal(hud.peaceChip.classList.contains('is-ending'), false);
  push(45 * 60 - 60);
  tick();
  assert.equal(said().length, 2);
  assert.match(peaceWarning(60), /ends in 1 minute\./);
  assert.equal(hud.peaceChip.classList.contains('is-ending'), true);
  push(45 * 60 - 10);
  tick();
  assert.equal(said().length, 3);
  assert.match(peaceWarning(10), /ends in 10 seconds/);
  assert.equal(hud.peaceClock.textContent, '0:10');
  push(45 * 60 - 0.2);
  tick();
  assert.equal(hud.peaceChip.hidden, false);
  assert.equal(hud.peaceClock.textContent, '0:01');
  push(45 * 60);
  tick();
  assert.equal(hud.peaceChip.hidden, true, 'gone with the peace');
  assert.equal(said().length, 3, 'no reminder repeats');
});

test('a HUD opened part-way through stays quiet about the marks already passed', () => {
  const { hud, push, tick, lines } = setup({ peaceMinutes: 30, at: 1760 });
  tick();
  assert.equal(hud.peaceChip.hidden, false);
  assert.equal(hud.peaceClock.textContent, '0:40');
  assert.equal(hud.peaceChip.classList.contains('is-ending'), true);
  assert.equal(lines().filter((l) => /ends in/.test(l)).length, 0);
  push(1790);
  tick();
  assert.equal(lines().filter((l) => /ends in/.test(l)).length, 1, 'but the 10 seconds still come');
});
