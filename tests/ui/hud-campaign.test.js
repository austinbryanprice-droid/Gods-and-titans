// A campaign mission on screen (src/ui/hud-campaign.js, hud.js, hud-overlays.js) and the chapter screen
// (src/ui/menu-campaign.js, menu.js). Fake DOM; a real HostSession for the HUD.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDom } from './fake-dom.js';
import { Hud } from '../../src/ui/hud.js';
import { Overlays } from '../../src/ui/hud-overlays.js';
import { objectiveProgress } from '../../src/ui/hud-campaign.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { HostSession } from '../../src/net/session.js';
import { createWorld } from '../../src/sim/world.js';
import { createAI } from '../../src/ai/ai.js';
import { campaignSetup } from '../../src/sim/campaign.js';
import { MISSIONS, MISSION_BY_ID } from '../../src/data/campaign.js';
import { recordMission, resetProgress } from '../../src/game/campaign-progress.js';
import { saveSettings } from '../../src/settings.js';

let menu;
before(async () => {
  installFakeDom();
  saveSettings({ tipsDismissed: false, narration: false });
  globalThis.Node = class {
    static [Symbol.hasInstance](x) {
      return !!x && (x.nodeType === 1 || x.nodeType === 3);
    }
  };
  const anything = () => new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : anything()), apply: () => anything() });
  FakeElement.prototype.getContext = function getContext() {
    this.ctxAny = this.ctxAny || anything();
    return this.ctxAny;
  };
  FakeElement.prototype.querySelectorAll = () => [];
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  menu = await import('../../src/ui/menu.js');
});

const cleanup = [];
after(() => {
  for (const fn of cleanup) fn();
  resetProgress();
});

function missionHud(id) {
  const session = new HostSession({ setup: campaignSetup(id, { name: 'Ada' }), myIndex: 0, createWorld, createAI, autoTick: false, useWorker: false });
  session.step(TICKS);
  const vs = session.viewState;
  const selection = new Selection(vs);
  const input = { mode: { kind: 'normal' }, cardMode: () => 'root' };
  const game = { viewState: vs, selection, session, input, renderer: null, tutorial: null, mission: vs.mission(), command() {}, sendChat() {} };
  const root = document.createElement('div');
  const hud = new Hud({ root, game });
  cleanup.push(() => {
    hud.dispose();
    session.stop();
  });
  return { session, vs, hud, root };
}
const TICKS = 25;

test('a mission shows its objectives where the checklist would be, hidden ones left out until revealed', () => {
  const { hud, root } = missionHud('shore');
  assert.ok(hud.missionView, 'the objective panel');
  assert.equal(hud.tips, null, 'no getting-started checklist in a mission');
  hud.missionView.update(10000, true);
  const text = root.textContent;
  assert.match(text, /Mission 1/);
  assert.match(text, /Ashes on the Shore/);
  assert.match(text, /Raise a Temple0\/1/);
  assert.doesNotMatch(text, /Drive off the raiding party/, 'the raid is not shown before it lands');
  assert.match(text, /Bonus: burn the raiders' camp/);
});

test('objective rows count up, down and out', () => {
  const vs = { time: 100 };
  assert.equal(objectiveProgress({ kind: 'build', state: 0, value: 2, count: 1 }, vs), '1/1');
  assert.equal(objectiveProgress({ kind: 'destroy', state: 0, value: 3 }, vs), '3 left');
  assert.equal(objectiveProgress({ kind: 'survive', state: 0, seconds: 600 }, vs), '8:20');
  assert.equal(objectiveProgress({ kind: 'hold', state: 0, value: 65, seconds: 120 }, vs), '1:05 of 2:00');
  assert.equal(objectiveProgress({ kind: 'hold', state: 0, value: 0, seconds: 120 }, vs), '');
  assert.equal(objectiveProgress({ kind: 'build', state: 1, value: 1, count: 1 }, vs), '', 'nothing once done');
});

test('a won mission offers the next one and says what opened; a lost one offers a retry', () => {
  const root = document.createElement('div');
  const calls = [];
  const game = {
    session: { isHost: true, clients: new Map() }, viewState: { myIndex: 0, myTeam: 1, time: 900, players: [] },
    quitToMenu: () => calls.push('menu'), rematch: () => calls.push('retry'), nextMission: () => calls.push('next'),
    canRematch: () => true, onNextMission: () => {}, setPaused: () => false,
  };
  const ov = new Overlays(root, game);
  ov.statsTable = () => null;
  const m = MISSION_BY_ID.shore;
  ov.showGameOver({ result: 'victory', winningTeam: 1, unlocked: null, how: 'campaign', mission: { m, record: { first: true, best: 400, previous: 0, chapterDone: false }, next: MISSIONS[1] } });
  assert.match(root.textContent, /Mission Complete/);
  assert.match(root.textContent, /The raiders broke on Thera's shore/);
  assert.match(root.textContent, /The next mission is open: Burn the Longhouses/);
  const buttons = root.all('button').map((b) => b.textContent);
  assert.ok(buttons.includes('Next Mission') && buttons.includes('Play It Again') && buttons.includes('Campaign'), buttons.join(','));
  root.all('button').find((b) => b.textContent === 'Next Mission').click();
  assert.deepEqual(calls, ['next']);
  const lost = document.createElement('div');
  const ov2 = new Overlays(lost, game);
  ov2.statsTable = () => null;
  ov2.showGameOver({ result: 'defeat', winningTeam: 2, how: 'campaign', mission: { m, record: null, next: null } });
  assert.match(lost.textContent, /Mission Failed/);
  assert.match(lost.textContent, /The raiders burned Thera/);
  assert.ok(lost.all('button').some((b) => b.textContent === 'Retry Mission'));
  assert.ok(!lost.all('button').some((b) => b.textContent === 'Next Mission'));
});

test('the title screen opens the chapter; a locked mission cannot start; Begin starts a solo mission', () => {
  resetProgress();
  saveSettings({ name: 'Ada' });
  const root = document.createElement('div');
  const launches = [];
  menu.createMenu({ root, onStart: (l) => launches.push(l) });
  menu.showMenu('title');
  const btn = root.all('button').find((b) => b.textContent.includes('Campaign'));
  assert.ok(btn, 'the Campaign button');
  assert.match(btn.textContent, /The Long Winter/);
  btn.click();
  assert.match(root.textContent, /Chapter I: The Long Winter/);
  assert.match(root.textContent, /Thera, a small island/, 'the first briefing');
  const missions = root.all('button').filter((b) => (b.className || '').includes('mw-mission'));
  assert.equal(missions.length, 5);
  const locked = (b) => b.disabled === true || (typeof b.getAttribute === 'function' && b.getAttribute('disabled') !== null && b.getAttribute('disabled') !== undefined);
  assert.equal(missions.filter(locked).length, 4, 'only the first is open');
  root.all('button').find((b) => b.textContent === 'Begin Mission').click();
  assert.equal(launches.length, 1);
  assert.equal(launches[0].setup.campaign, 'shore');
  assert.equal(launches[0].setup.players[0].name, 'Ada');
  assert.equal(launches[0].role, 'host');
  // Won the first: the screen opens on the second, which is open now.
  recordMission('shore', 300);
  menu.showMenu('campaign', { mission: 'longhouses' });
  assert.match(root.textContent, /three great longhouses/);
  assert.match(root.textContent, /5:00/, 'the best time of the first');
});

test('Begin Mission right away cancels the briefing that was about to be read', async () => {
  saveSettings({ narration: true, volume: 0.7 });
  const { campaignScreen } = await import('../../src/ui/menu-campaign.js');
  const said = [];
  const voice = () => ({ say: (t) => said.push(t), stop: () => {} });
  const open = () => {
    const scr = campaignScreen({ go: () => {}, onBegin: () => {}, makeVoice: voice });
    Object.defineProperty(scr.el, 'isConnected', { value: true });
    return scr;
  };
  open();
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(said.length, 1, 'left alone, the screen reads its briefing');
  said.length = 0;
  const scr = open();
  scr.el.all('button').find((b) => b.textContent === 'Begin Mission').click();
  await new Promise((r) => setTimeout(r, 450));
  assert.deepEqual(said, [], 'no briefing over the mission');
  saveSettings({ narration: false });
});
