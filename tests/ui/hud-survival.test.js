// Trial of the Titans on the client (DESIGN 5.11, 9): the wave chip in the top bar, the opening line,
// the "coming in 10 s" warning, the end screen, the lobby's mode label and the best-wave record.
// Fake DOM, a real ViewState fed snapshots of a real World.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../../src/ui/hud.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { ViewState } from '../../src/game/view-state.js';
import { saveSettings } from '../../src/settings.js';
import { survivalMode, gameModeLabel, startBlockReason } from '../../src/ui/menu-model.js';
import { SURVIVAL_KEY, bestSurvivalWave, recordSurvivalWave, survivalRecord } from '../../src/game/survival-record.js';
import { waveTime } from '../../src/sim/survival.js';
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

function setup(opts = {}) {
  const world = makeWorld({ map: { width: 64, height: 64 }, ...opts });
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  /** Run the world to `time` (jumping its clock) and show the snapshot. */
  const push = (time) => {
    if (time > world.time) {
      world.tickCount = Math.round(time * 20);
      world.time = world.tickCount / 20;
      world.tick();
    }
    const snap = world.getSnapshot();
    vs.pushSnapshot({ ...snap, time }, 50);
  };
  push(opts.at ?? 0);
  const root = document.createElement('div');
  const game = { viewState: vs, selection: new Selection(vs), session: null, input: null, renderer: null, command() {}, sendChat() {}, quitToMenu() {} };
  const hud = new Hud({ root, game });
  huds.push(hud);
  let now = 1000;
  const tick = () => hud.update((now += 500));
  const lines = () => hud.msgs.children.map((c) => c.textContent);
  return { world, hud, vs, push, tick, lines };
}

test('a normal game has no wave chip', () => {
  const { hud, vs, tick } = setup();
  tick();
  assert.equal(vs.survival(), null);
  assert.equal(hud.waveChip.hidden, true);
});

test('the chip counts down to the first wave, then shows the wave, the monsters left and the next clock', () => {
  const { hud, vs, push, tick, lines } = setup({ survival: true });
  tick();
  assert.equal(hud.waveChip.hidden, false);
  assert.equal(hud.waveText.textContent, 'Wave 1 in 2:00');
  assert.ok(lines().some((l) => /Trial of the Titans: build your defences\. The first wave of monsters comes in 2:00\./.test(l)), 'the opening line');
  push(waveTime(1) - 9);
  tick();
  assert.ok(lines().some((l) => /Wave 1 comes in 9 s\./.test(l)), 'the warning');
  assert.equal(hud.waveChip.classList.contains('is-ending'), true);
  tick();
  assert.equal(lines().filter((l) => /Wave 1 comes in/.test(l)).length, 1, 'said once');
  push(waveTime(1));
  tick();
  const sv = vs.survival();
  assert.equal(sv.wave, 1);
  assert.ok(sv.alive > 0);
  assert.equal(hud.waveText.textContent, `Wave 1 · ${sv.alive} left · next 1:30`);
  push(waveTime(5) - 8);
  tick();
  assert.equal(hud.waveChip.classList.contains('is-boss'), true, 'a Titan leads the next one');
  assert.ok(lines().some((l) => /Wave 5 comes in 8 s, and a Titan leads it!/.test(l)));
});

test('the end screen names the wave reached and the best', () => {
  const { hud } = setup({ survival: true });
  hud.overlays.showGameOver({ result: 'survival', winningTeam: null, wave: 7, record: { best: 9, previous: 9, isNew: false } });
  let text = hud.overlays.current.el.textContent;
  assert.match(text, /Wave 7/);
  assert.match(text, /held out to wave 7/);
  assert.match(text, /Your best: wave 9\./);
  hud.overlays.showGameOver({ result: 'survival', winningTeam: null, wave: 12, record: { best: 12, previous: 9, isNew: true } });
  text = hud.overlays.current.el.textContent;
  assert.match(text, /A new best! Your old best was wave 9\./);
});

test('the lobby names the mode and lets a lone player start it', () => {
  const lone = { slots: [{ kind: 'host', team: 1, name: 'A' }, { kind: 'closed' }], survival: true };
  assert.equal(survivalMode(lone), true);
  assert.match(gameModeLabel(lone), /Trial of the Titans/);
  assert.equal(startBlockReason(lone), null);
  assert.match(startBlockReason({ ...lone, survival: false }), /opponent/);
  assert.equal(survivalMode({ ...lone, peace: 30 }), false, 'a peace wins');
});

test('the best wave is remembered in localStorage and survives bad data', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  try {
    assert.equal(bestSurvivalWave(), 0);
    assert.deepEqual(recordSurvivalWave(6, { players: 2, pantheon: 'norse' }), { best: 6, previous: 0, isNew: true });
    assert.deepEqual(recordSurvivalWave(4), { best: 6, previous: 6, isNew: false });
    assert.equal(bestSurvivalWave(), 6);
    const rec = survivalRecord();
    assert.equal(rec.games, 2);
    assert.equal(rec.last.wave, 4);
    store.set(SURVIVAL_KEY, '{not json');
    assert.ok(bestSurvivalWave() >= 0, 'unreadable data does not throw');
    store.set(SURVIVAL_KEY, JSON.stringify({ best: -3, games: 'x' }));
    assert.deepEqual(survivalRecord(), { best: 0, games: 0, last: null });
  } finally {
    delete globalThis.localStorage;
  }
});
