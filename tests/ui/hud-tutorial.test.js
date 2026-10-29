// The guided first match on screen (src/ui/hud-tutorial.js, hud.js, hud-overlays.js, menu.js) and in
// the career (src/game/career.js): the objective panel inside a real HUD, the pin at the objective,
// the lit command-card buttons, the medal on the game-over screen, the medal achievements and the
// title screen's Learn to Play. Fake DOM; a real HostSession for the HUD.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { Hud } from '../../src/ui/hud.js';
import { Overlays } from '../../src/ui/hud-overlays.js';
import { GuidePointer, lightCard } from '../../src/ui/hud-tutorial.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { TutorialDirector, TUTORIAL_STEPS, MEDALS } from '../../src/game/tutorial.js';
import { HostSession } from '../../src/net/session.js';
import { createWorld } from '../../src/sim/world.js';
import { createAI } from '../../src/ai/ai.js';
import { tutorialSetup } from '../../src/sim/tutorial.js';
import { getCareer, recordTutorial, resetCareer } from '../../src/game/career.js';
import { medalLabel } from '../../src/data/medals.js';
import { saveSettings } from '../../src/settings.js';

before(() => {
  installFakeDom();
  saveSettings({ tipsDismissed: false });
});

const cleanup = [];
after(() => {
  for (const fn of cleanup) fn();
  resetCareer({});
});

function tutorialHud() {
  const session = new HostSession({ setup: tutorialSetup({ name: 'Ada' }), myIndex: 0, createWorld, createAI, autoTick: false, useWorker: false });
  session.step(2);
  const vs = session.viewState;
  const selection = new Selection(vs);
  const director = new TutorialDirector({ viewState: vs, getSelection: () => selection.ids });
  const input = { mode: { kind: 'normal' }, cardMode: () => 'root' };
  const game = { viewState: vs, selection, session, input, renderer: null, tutorial: director, command() {}, sendChat() {} };
  const root = document.createElement('div');
  const hud = new Hud({ root, game });
  cleanup.push(() => {
    hud.dispose();
    session.stop();
  });
  return { session, vs, selection, director, hud, root };
}

test('in the guided first match the HUD shows the objective panel instead of the getting-started checklist', () => {
  const { hud, root, selection, session } = tutorialHud();
  assert.ok(hud.tutorial, 'objective panel');
  assert.equal(hud.tips, null, 'no checklist');
  assert.ok(hud.guidePointer, 'a pin at the objective');
  hud.update(1000);
  assert.match(root.textContent, /Learn to Play/);
  assert.match(root.textContent, /1\/11/);
  assert.match(root.textContent, /Choose your Worshippers/);
  // Selecting the Worshippers finishes the first step; the panel moves on.
  selection.set(session.world.unitList.filter((u) => u.owner === 0).map((u) => u.id));
  hud.update(2000);
  assert.match(root.textContent, /2\/11/);
  assert.match(root.textContent, /Mine gold/);
  assert.match(root.textContent, /0\/3/);
  assert.equal(hud.tutorial.el.classList.contains('is-done-flash'), true, 'a finished step glows');
});

test('a normal match keeps the checklist and has no objective panel', () => {
  const session = new HostSession({ setup: { ...tutorialSetup(), tutorial: false }, myIndex: 0, createWorld, autoTick: false, useWorker: false });
  session.step(1);
  const vs = session.viewState;
  const game = { viewState: vs, selection: new Selection(vs), session, input: { mode: { kind: 'normal' }, cardMode: () => 'root' }, renderer: null, command() {}, sendChat() {} };
  const hud = new Hud({ root: document.createElement('div'), game });
  cleanup.push(() => {
    hud.dispose();
    session.stop();
  });
  assert.equal(hud.tutorial, null);
  assert.equal(hud.guidePointer, null);
  assert.ok(hud.tips, 'checklist');
});

test('the command-card buttons the step asks for glow, and only those', () => {
  const slots = Array.from({ length: 4 }, () => ({ btn: document.createElement('button') }));
  const card = [{ id: 'build' }, { id: 'build:house' }, null, { id: 'move' }];
  lightCard({ slots, card }, ['build:house']);
  assert.deepEqual(slots.map((s) => s.btn.classList.contains('is-guide')), [false, true, false, false]);
  lightCard({ slots, card }, []);
  assert.deepEqual(slots.map((s) => s.btn.classList.contains('is-guide')), [false, false, false, false]);
});

test('the pin stands over the objective, or rides the edge toward it, and takes the camera there', () => {
  const root = document.createElement('div');
  root.clientWidth = 1280;
  root.clientHeight = 720;
  const centered = [];
  const renderer = {
    worldToScreen: (x, y) => ({ sx: x * 20, sy: y * 10, onScreen: x * 20 <= 1280 && y * 10 <= 720 }),
    camera: { target: { x: 32, y: 36 }, pitch: 1, centerOn: (x, y) => centered.push([x, y]) },
  };
  let target = { x: 30, y: 30 };
  const director = { finished: false, current: TUTORIAL_STEPS[1], target: () => target };
  const pointer = new GuidePointer({ root, director, viewState: { players: [], setup: null }, getRenderer: () => renderer, getInsets: () => ({ top: 30, bottom: 120 }) });
  pointer.update(0);
  const pins = () => pointer.layer.findAll('hud-mark');
  assert.equal(pins().length, 1);
  assert.match(pins()[0].textContent, /Here/);
  assert.match(pins()[0].textContent, /⛏️/);
  assert.equal(pins()[0].classList.contains('is-edge'), false);
  assert.equal(pins()[0].classList.contains('is-below'), false, 'room above the spot: the pin stands over it');
  target = { x: 30, y: 4 }; // 10 px under the top bar: a standing pin would reach under the bar
  pointer.update(500);
  assert.equal(pins()[0].classList.contains('is-edge'), false);
  assert.equal(pins()[0].classList.contains('is-below'), true, 'just under the top bar the pin hangs below its spot');
  target = { x: 200, y: 30 };
  pointer.update(1000);
  assert.equal(pins()[0].classList.contains('is-edge'), true, 'out of view: an arrow at the edge');
  pins()[0].click();
  assert.deepEqual(centered, [[200, 30]]);
  director.finished = true;
  pointer.update(2000);
  assert.equal(pins().length, 0, 'gone when the lesson is over');
  pointer.dispose();
});

test('the game-over screen of the lesson shows its medal and what the next medal takes', () => {
  const root = document.createElement('div');
  const game = { session: { isHost: true, clients: new Map() }, viewState: { myIndex: 0, myTeam: 1, time: 900, players: [] }, quitToMenu() {}, setPaused: () => false };
  const ov = new Overlays(root, game);
  ov.statsTable = () => null;
  ov.showGameOver({ result: 'victory', winningTeam: 1, unlocked: [], medal: MEDALS[1], tutorial: true });
  assert.match(root.textContent, /Lesson Complete/);
  assert.match(root.textContent, /Silver medal/);
  assert.match(root.textContent, /Win within 12:00 for gold/);
  const second = document.createElement('div');
  const ov2 = new Overlays(second, game);
  ov2.statsTable = () => null;
  ov2.showGameOver({ result: 'victory', winningTeam: 1, unlocked: [] });
  assert.doesNotMatch(second.textContent, /medal/);
  assert.match(second.textContent, /Victory/);
});

test('a medal is kept as the best, is not a game of the career, and unlocks the lesson achievements', () => {
  resetCareer({});
  const first = recordTutorial(1).map((a) => a.id);
  assert.deepEqual(first, ['first_lessons']);
  let c = getCareer();
  assert.equal(c.best.medal, 1);
  assert.equal(c.games, 0, 'the lesson is not counted as a game');
  assert.deepEqual(recordTutorial(3).map((a) => a.id), ['top_of_the_class']);
  assert.deepEqual(recordTutorial(2), [], 'a worse medal keeps the best');
  c = getCareer();
  assert.equal(c.best.medal, 3);
  assert.equal(medalLabel(3), '🥇 Gold medal');
  assert.equal(medalLabel(0), '');
  resetCareer({ best: { medal: 9 } });
  assert.equal(getCareer().best.medal, 9, 'stored as a number (the label ignores a nonsense rank)');
  assert.equal(medalLabel(9), '');
  resetCareer({});
});
