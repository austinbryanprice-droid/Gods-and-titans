// A campaign mission on screen (src/ui/hud-campaign.js, hud.js, hud-overlays.js) and the chapter screen
// (src/ui/menu-campaign.js, menu.js). Fake DOM; a real HostSession for the HUD.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDom } from './fake-dom.js';
import { Hud } from '../../src/ui/hud.js';
import { Overlays } from '../../src/ui/hud-overlays.js';
import { objectiveProgress, waitingRows } from '../../src/ui/hud-campaign.js';
import { TICK_RATE } from '../../src/config.js';
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

/** Jump a world's clock ahead (World.tick derives the time from the tick count). */
function skipTo(w, seconds) {
  w.tickCount = seconds * TICK_RATE;
  w.time = seconds;
}

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

test('Ragnarök: while the mission waits for Loki the panel says he is coming, with the clock; his reveal replaces it', () => {
  const { session, hud, root } = missionHud('vigrid');
  hud.missionView.update(10000, true);
  assert.match(root.textContent, /Loki comes at the world's end12:5\d/, 'the story beat still to come, and its clock');
  assert.doesNotMatch(root.textContent, /Slay Loki/);
  assert.equal(root.all('li').filter((li) => (li.className || '').includes('is-waiting')).length, 1);
  // Loki's host broken early: the row still says what the mission waits for.
  const w = session.world;
  for (const b of w.buildingList.filter((x) => x.owner === 1 || x.owner === 3)) w.killEntity(b, null);
  session.step(2 * TICK_RATE);
  skipTo(w, 778);
  session.step(TICK_RATE);
  hud.missionView.update(20000, true);
  assert.equal(session.viewState.gameOver, null);
  assert.match(root.textContent, /Loki comes at the world's end0:01/);
  session.step(2 * TICK_RATE);
  hud.missionView.update(30000, true);
  assert.doesNotMatch(root.textContent, /Loki comes at the world's end/, 'gone once Loki walks');
  assert.match(root.textContent, /Slay Loki, the trickster/);
  assert.equal(root.all('li').filter((li) => (li.className || '').includes('is-waiting')).length, 0);
});

test('The Burning Bridge already shows its hold with the clock left, and nothing more is added; the clock goes once the horn sounds', () => {
  const { session, hud, root } = missionHud('bifrost');
  hud.missionView.update(10000, true);
  assert.match(root.textContent, /Hold until Heimdall's horn sounds8:5\d/);
  assert.deepEqual(waitingRows(session.viewState.campaign(), session.viewState), [], 'no extra row for a shown beat');
  skipTo(session.world, 538);
  session.step(4 * TICK_RATE);
  hud.missionView.update(20000, true);
  const c = session.viewState.campaign();
  assert.equal(c.objectives.find((o) => o.id === 'hold').state, 1);
  assert.doesNotMatch(root.textContent, /Hold until Heimdall's horn sounds\d/, 'no clock once the hold is over');
});

test('waiting rows: only a hidden, open waitFor objective with words; the clock runs to the event that reveals it', () => {
  const m = MISSION_BY_ID.vigrid;
  const objs = (shown, state = 0) => m.objectives.map((o) => ({ ...o, state: o.id === 'loki' ? state : 0, value: 0, shown: o.id === 'loki' ? shown : !o.hidden }));
  assert.deepEqual(waitingRows({ mission: m, objectives: objs(false) }, { time: 646 }), [{ id: 'wait:loki', icon: '🐍', text: 'Loki comes at the world\'s end', progress: '2:14' }]);
  assert.deepEqual(waitingRows({ mission: m, objectives: objs(false) }, { time: 900 }).map((r) => r.progress), ['0:00']);
  assert.deepEqual(waitingRows({ mission: m, objectives: objs(true) }, { time: 790 }), []);
  assert.deepEqual(waitingRows({ mission: m, objectives: objs(true, 1) }, { time: 900 }), []);
  assert.deepEqual(waitingRows({ mission: MISSION_BY_ID.shore, objectives: [] }, { time: 0 }), []);
  assert.deepEqual(waitingRows(null, null), []);
});

test('objective rows count up, down and out', () => {
  const vs = { time: 100 };
  assert.equal(objectiveProgress({ kind: 'build', state: 0, value: 2, count: 1 }, vs), '1/1');
  assert.equal(objectiveProgress({ kind: 'destroy', state: 0, value: 3 }, vs), '3 left');
  assert.equal(objectiveProgress({ kind: 'survive', state: 0, seconds: 600 }, vs), '8:20');
  assert.equal(objectiveProgress({ kind: 'hold', state: 0, value: 65, seconds: 120 }, vs), '1:05 of 2:00');
  assert.equal(objectiveProgress({ kind: 'hold', state: 0, value: 0, seconds: 120 }, vs), '');
  assert.equal(objectiveProgress({ kind: 'build', state: 1, value: 1, count: 1 }, vs), '', 'nothing once done');
  assert.equal(objectiveProgress({ kind: 'destroy', state: 0, value: 2, limit: 900 }, vs), '2 left · 13:20', 'a deadline shows the clock left');
  assert.equal(objectiveProgress({ kind: 'destroy', state: 0, value: 0, limit: 60 }, vs), '0:00');
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

test('the last mission of Chapter I says the chapter is done and opens Chapter II', () => {
  const root = document.createElement('div');
  const calls = [];
  const game = {
    session: { isHost: true, clients: new Map() }, viewState: { myIndex: 0, myTeam: 1, time: 900, players: [] },
    quitToMenu: () => {}, rematch: () => {}, nextMission: () => calls.push('next'),
    canRematch: () => true, onNextMission: () => {}, setPaused: () => false,
  };
  const ov = new Overlays(root, game);
  ov.statsTable = () => null;
  ov.showGameOver({ result: 'victory', winningTeam: 1, unlocked: null, how: 'campaign', mission: { m: MISSION_BY_ID.twilight, record: { first: true, best: 1400, previous: 0, chapterDone: true }, next: MISSION_BY_ID.hordaland } });
  assert.match(root.textContent, /Chapter I complete! The Long Winter is told\. Chapter II is open: The Wolf Age\./);
  root.all('button').find((b) => b.textContent === 'Begin Chapter II').click();
  assert.deepEqual(calls, ['next']);
  const end = document.createElement('div');
  const ov2 = new Overlays(end, game);
  ov2.statsTable = () => null;
  ov2.showGameOver({ result: 'victory', winningTeam: 1, unlocked: null, how: 'campaign', mission: { m: MISSION_BY_ID.vigrid, record: { first: true, best: 1600, previous: 0, chapterDone: true }, next: null } });
  assert.match(end.textContent, /Chapter II complete! The Wolf Age is told\.$|Chapter II complete! The Wolf Age is told\./);
  assert.ok(!end.all('button').some((b) => /Next Mission|Begin Chapter/.test(b.textContent)));
});

test('Chapter II stays locked until Chapter I is won, then the title screen and the chapter screen open on it', () => {
  resetProgress();
  const root = document.createElement('div');
  menu.createMenu({ root, onStart: () => {} });
  menu.showMenu('campaign');
  const tab = () => root.all('button').find((b) => (b.className || '').includes('mw-chapter-tab') && b.textContent.includes('The Wolf Age'));
  const locked = (b) => b.disabled === true || (typeof b.getAttribute === 'function' && b.getAttribute('disabled') !== null && b.getAttribute('disabled') !== undefined);
  assert.ok(locked(tab()), 'Chapter II is locked at first');
  for (const m of MISSIONS.slice(0, 5)) recordMission(m.id, 900);
  menu.showMenu('title');
  const btn = root.all('button').find((b) => b.textContent.includes('Campaign'));
  assert.match(btn.textContent, /Chapter II: The Wolf Age/);
  btn.click();
  assert.match(root.textContent, /Chapter II: The Wolf Age/);
  assert.match(root.textContent, /Hordaland, in the fjords of the north/, 'the first briefing of Chapter II');
  assert.ok(!locked(tab()));
  const missions = root.all('button').filter((b) => (b.className || '').includes('mw-mission'));
  assert.equal(missions.length, 5);
  assert.equal(missions.filter(locked).length, 4);
  // Back to Chapter I by its tab: its five won missions, each with a best time.
  root.all('button').find((b) => (b.className || '').includes('mw-chapter-tab') && b.textContent.includes('The Long Winter')).click();
  assert.match(root.textContent, /Chapter I: The Long Winter/);
  assert.match(root.textContent, /5 of 5 won/);
  resetProgress();
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
