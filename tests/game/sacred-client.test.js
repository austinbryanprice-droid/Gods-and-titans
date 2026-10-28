// Sacred Sites on the client (DESIGN 5.11 and 9): the ViewState's rows and countdown, the HUD chip,
// the alerts, the placement ghost, the lobby toggle and the GameSetup it makes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AlertEngine } from '../../src/game/alerts.js';
import { ViewState } from '../../src/game/view-state.js';
import { checkPlacement } from '../../src/game/placement.js';
import { siteChip, sacredStartText, SITE_ICON } from '../../src/ui/hud-sites.js';
import { sacredOn, victoryLabel } from '../../src/ui/menu-model.js';
import { LobbyHost, LobbyClient, buildSetup, sanitizeLobbyState } from '../../src/net/lobby.js';
import { validateSetup } from '../../src/net/sanitize.js';
import { SITE_IN_WAY } from '../../src/sim/sacred.js';
import { SACRED_HOLD } from '../../src/config.js';
import { makeWorld } from '../sim/helpers.js';

const SITES = [{ x: 24.5, y: 16.5 }, { x: 24.5, y: 32.5 }];

function scene(opts = {}) {
  const world = makeWorld({ map: { width: 48, height: 48, sacred: SITES }, ...opts });
  const base = JSON.parse(JSON.stringify(world.getSnapshot()));
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  const out = [];
  new AlertEngine({ viewState: vs, notify: (a) => out.push(a), settings: () => ({ alerts: 'all', tabAlerts: 'title' }) }).attach();
  let seq = 0;
  const at = (time, { sites, sacred = null, events = [] } = {}) => {
    const snap = JSON.parse(JSON.stringify(base));
    snap.time = time;
    snap.tick = 1000 + ++seq;
    snap.events = events;
    for (const e of snap.entities) if (e.k === 'u' && e.o === 0) e.st = 'gather';
    if (sites) snap.sites = sites;
    snap.sacred = sacred;
    vs.pushSnapshot(snap, 50);
  };
  return { world, vs, at, take: () => out.splice(0) };
}

const row = (s, o, extra = {}) => ({ x: s.x, y: s.y, o, ...extra });

test('ViewState: the map\'s sites before the first snapshot, then the host\'s rows and the countdown', () => {
  const { vs, at } = scene({ sacredVictory: true });
  assert.deepEqual(vs.sites, SITES.map((s) => row(s, -1)));
  assert.ok(vs.sacredVictoryOn());
  at(10, { sites: [row(SITES[0], 0), row(SITES[1], 1, { p: 0.4, c: 0 })] });
  assert.equal(vs.sitesHeld(1), 1);
  assert.equal(vs.sitesHeld(2), 1);
  assert.equal(vs.sacredLeft(), 0);
  at(20, { sites: [row(SITES[0], 0), row(SITES[1], 0)], sacred: { tm: 1, end: 20 + SACRED_HOLD } });
  assert.equal(vs.sacredLeft(), SACRED_HOLD);
  const plain = scene();
  assert.equal(plain.vs.sacredVictoryOn(), false);
});

test('the HUD chip: sites my side holds, and the countdown in the colour of whoever runs it', () => {
  const { vs, at } = scene({ sacredVictory: true });
  at(5, { sites: [row(SITES[0], 0), row(SITES[1], -1)] });
  assert.deepEqual(siteChip(vs), { hidden: false, text: '1/2', cls: '' });
  at(6, { sites: [row(SITES[0], 0), row(SITES[1], 0)], sacred: { tm: 1, end: 6 + 125 } });
  assert.deepEqual(siteChip(vs), { hidden: false, text: '2/2 · 2:05', cls: 'is-ours' });
  at(7, { sites: [row(SITES[0], 1), row(SITES[1], 1)], sacred: { tm: 2, end: 7 + 60 } });
  assert.deepEqual(siteChip(vs), { hidden: false, text: '0/2 · 1:00', cls: 'is-theirs' });
  assert.match(sacredStartText(), /8 minutes/);
  const none = new ViewState({ setup: { players: [] }, mapData: { width: 8, height: 8, terrain: new Uint8Array(64) }, myIndex: 0 });
  assert.equal(siteChip(none).hidden, true);
});

test('alerts: my capture, a rival taking a site, losing one, and the Sacred Victory clock with its marks', () => {
  const { at, take } = scene({ sacredVictory: true });
  at(1);
  at(2);
  take();
  at(3, { sites: [row(SITES[0], 0), row(SITES[1], -1)], events: [{ type: 'siteCaptured', site: 0, player: 0 }] });
  let a = take();
  assert.deepEqual(a.map((x) => [x.id, x.kind, x.icon]), [['site_taken', 'good', SITE_ICON]]);
  assert.match(a[0].text, /faith/);
  at(4, { sites: [row(SITES[0], 0), row(SITES[1], 1)], events: [{ type: 'siteCaptured', site: 1, player: 1 }] });
  a = take();
  assert.equal(a[0].kind, 'alert');
  assert.deepEqual(a[0].jump, { x: SITES[1].x, y: SITES[1].y });
  at(5, { sites: [row(SITES[0], -1), row(SITES[1], 1)], events: [{ type: 'siteLost', site: 0, player: 0 }] });
  a = take();
  assert.deepEqual(a.map((x) => [x.id, x.kind]), [['site_lost', 'alert']]);
  assert.equal(a[0].attention, 'You have lost a sacred site!');
  // The rival holds both: their clock runs, with a line at each mark.
  const end = 6 + SACRED_HOLD;
  at(6, { sites: [row(SITES[0], 1), row(SITES[1], 1)], sacred: { tm: 2, end }, events: [{ type: 'sacredHold', team: 2, end }] });
  a = take();
  assert.deepEqual(a.map((x) => [x.id, x.kind, x.sound]), [['sacred', 'alert', 'gong']]);
  assert.match(a[0].text, /P1 holds every sacred site! Take one back within 8:00/);
  at(end - 125, { sites: [row(SITES[0], 1), row(SITES[1], 1)], sacred: { tm: 2, end } });
  assert.deepEqual(take(), []);
  at(end - 119, { sites: [row(SITES[0], 1), row(SITES[1], 1)], sacred: { tm: 2, end } });
  a = take();
  assert.deepEqual(a.map((x) => x.id), ['sacred']);
  assert.match(a[0].text, /in 2 minutes/);
  at(end - 100, { sites: [row(SITES[0], 0), row(SITES[1], 1)], events: [{ type: 'sacredBroken', team: 2 }] });
  a = take();
  assert.deepEqual(a.map((x) => [x.id, x.kind]), [['sacred', 'good']]);
});

test('the placement ghost refuses ground next to a sacred site with the sim\'s words', () => {
  const { world, vs, at } = scene();
  at(1);
  vs.explored.fill(1); // (fog would come first)
  const tx = Math.floor(SITES[0].x) + 1;
  const ty = Math.floor(SITES[0].y) - 1;
  const chk = checkPlacement(vs, 0, 'house', tx, ty);
  assert.equal(chk.valid, false);
  assert.equal(chk.message, SITE_IN_WAY);
  assert.equal(world.placementError(0, 'house', tx, ty), SITE_IN_WAY);
  assert.equal(checkPlacement(vs, 0, 'house', tx + 4, ty).message, world.placementError(0, 'house', tx + 4, ty));
});

test('lobby: the host switches Sacred Victory, clients see it, and the GameSetup carries it', async () => {
  const host = await LobbyHost.create({ transport: 'loopback', name: 'Austin' });
  assert.equal(host.state.sacred, false);
  const bob = await LobbyClient.join({ transport: 'loopback', roomCode: host.roomCode, name: 'Bob' });
  for (const bad of [1, 'yes', null, undefined]) assert.equal(host.setSacred(bad), false, String(bad));
  assert.equal(host.setSacred(false), false, 'already off');
  assert.ok(host.setSacred(true));
  const until = Date.now() + 2000;
  while (bob.state.sacred !== true && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
  assert.equal(bob.state.sacred, true);
  assert.ok(sacredOn(bob.state));
  assert.match(victoryLabel(bob.state), /Sacred Victory/);
  const res = host.start();
  assert.equal(res.setup.sacredVictory, true);
  assert.equal(validateSetup(res.setup, 0).setup.sacredVictory, true);
  assert.equal(host.setSacred(false), false, 'too late once the game started');
  for (const c of res.conns.values()) c.close();
  bob.leave?.();
  host.close?.();
});

test('a GameSetup without Sacred Victory keeps its old shape', () => {
  const state = {
    mapSize: 'small',
    slots: [
      { kind: 'host', name: 'A', pantheon: 'greek', team: 1, color: 0, difficulty: 'normal' },
      { kind: 'ai', name: '', pantheon: 'norse', team: 2, color: 1, difficulty: 'normal' },
      { kind: 'closed', name: '', pantheon: 'random', team: 3, color: 2, difficulty: 'normal' },
      { kind: 'closed', name: '', pantheon: 'random', team: 4, color: 3, difficulty: 'normal' },
    ],
  };
  assert.equal('sacredVictory' in buildSetup(state, 7).setup, false);
  assert.equal('sacredVictory' in buildSetup({ ...state, sacred: 'yes' }, 7).setup, false);
  assert.equal(buildSetup({ ...state, sacred: true }, 7).setup.sacredVictory, true);
  assert.equal(sanitizeLobbyState({ slots: state.slots, mapSize: 'small', sacred: true }).sacred, true);
  assert.equal(sanitizeLobbyState({ slots: state.slots, mapSize: 'small', sacred: 1 }).sacred, false);
  assert.equal(victoryLabel({}), 'Conquest: destroy every enemy building');
});
