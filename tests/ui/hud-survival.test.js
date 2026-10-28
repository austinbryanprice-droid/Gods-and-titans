// Trial of the Titans on the client (DESIGN 5.13, 9): the wave chip in the top bar, the opening line,
// the "coming in 10 s" warning, the end screen, the lobby's mode label and the best-wave record.
// Fake DOM, a real ViewState fed snapshots of a real World.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../../src/ui/hud.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { ViewState } from '../../src/game/view-state.js';
import { saveSettings } from '../../src/settings.js';
import { survivalMode, gameModeLabel, startBlockReason } from '../../src/ui/menu-model.js';
import { getCareer, recordMatch, resetCareer, careerSummary } from '../../src/game/career.js';
import { ACHIEVEMENT_BY_ID } from '../../src/data/achievements.js';
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

test('a finished trial raises the best wave in the career, counts as a game but not as a win or a loss, and unlocks the wave achievements', () => {
  resetCareer();
  const m = { pantheon: 'norse', time: 1500, kills: 40, gathered: 9000, enemies: [], teamSize: 2 };
  recordMatch({ ...m, result: 'victory' });
  let got = recordMatch({ ...m, result: 'survival', wave: 12 });
  let c = getCareer();
  assert.equal(c.best.wave, 12);
  assert.equal(c.games, 2);
  assert.deepEqual([c.wins, c.losses, c.draws], [1, 0, 0]);
  assert.equal(careerSummary(c).winRate, 1, 'the trial is left out of the win rate');
  assert.equal(c.history[0].r, 'survival');
  assert.ok(got.some((a) => a.id === 'hold_the_line'));
  assert.ok(!Object.hasOwn(c.unlocked, 'titans_bane'));
  assert.deepEqual(ACHIEVEMENT_BY_ID.titans_bane.progress(c), [12, 20]);
  got = recordMatch({ ...m, result: 'survival', wave: 7 });
  c = getCareer();
  assert.equal(c.best.wave, 12, 'a worse trial keeps the best');
  got = recordMatch({ ...m, result: 'survival', wave: 21 });
  assert.ok(got.some((a) => a.id === 'titans_bane'));
  resetCareer();
});
