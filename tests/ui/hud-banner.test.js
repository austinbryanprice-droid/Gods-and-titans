// Two HUD lines that come from the session / setup (src/ui/hud.js, hud-data.js): the
// "Connection problem" banner while the host is silent (ClientSession.stalled), and the
// one-off "You lead the Norse pantheon." message at game start. Fake DOM, fake game.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../../src/ui/hud.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { leadText, stallText } from '../../src/ui/hud-data.js';
import { ViewState } from '../../src/game/view-state.js';
import { saveSettings } from '../../src/settings.js';
import { STALL_NOTICE_MS } from '../../src/net/protocol.js';
import { makeWorld } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(() => {
  installFakeDom();
  saveSettings({ tipsDismissed: true }); // no tips panel in these tests
});

function viewOf(world, me = 0) {
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: me });
  vs.pushSnapshot(world.getSnapshot(), 50);
  return vs;
}

const huds = [];
after(() => {
  for (const h of huds) h.dispose(); // clears the message timers so the test process can exit at once
});

function setup({ session, me = 0, pantheon } = {}) {
  const world = makeWorld();
  if (pantheon) world.setup.players[0].pantheon = pantheon;
  const vs = viewOf(world, me);
  const root = document.createElement('div');
  const game = { viewState: vs, selection: new Selection(vs), session, input: null, renderer: null, command() {}, sendChat() {} };
  const hud = new Hud({ root, game });
  huds.push(hud);
  return { hud, root, game, vs };
}

const clientSession = (props) => ({ isHost: false, pingMs: 40, stalled: false, stalledMs: 0, ...props });

test('stallText: only a stalled client session gets a line, with the seconds so far', () => {
  assert.equal(stallText(null), '');
  assert.equal(stallText({ isHost: true }), '', 'a HostSession has no stalled property');
  assert.equal(stallText(clientSession()), '');
  assert.equal(stallText(clientSession({ stalled: true, stalledMs: STALL_NOTICE_MS + 400 })), 'Connection problem: waiting for the host… (3s)');
  assert.equal(stallText(clientSession({ stalled: true, stalledMs: 12999 })), 'Connection problem: waiting for the host… (12s)');
  assert.equal(stallText(clientSession({ stalled: true, stalledMs: undefined })), 'Connection problem: waiting for the host… (0s)');
});

test('the banner appears while the host is silent, counts up, and clears when frames flow again', () => {
  const session = clientSession();
  const { hud } = setup({ session });
  hud.update(1000);
  assert.equal(hud.stall.hidden, true);
  assert.equal(hud.ping.classList.contains('is-bad'), false);
  assert.equal(hud.ping.textContent, '📶 40 ms');

  Object.assign(session, { stalled: true, stalledMs: STALL_NOTICE_MS, pingMs: null });
  hud.update(1100);
  assert.equal(hud.stall.hidden, false);
  assert.equal(hud.stall.textContent, 'Connection problem: waiting for the host… (3s)');
  assert.equal(hud.ping.textContent, '📶 …');
  assert.equal(hud.ping.classList.contains('is-bad'), true, 'no ping figure while stalled is a bad link');
  session.stalledMs = 7200;
  hud.update(1200);
  assert.equal(hud.stall.textContent, 'Connection problem: waiting for the host… (7s)');

  Object.assign(session, { stalled: false, stalledMs: 0, pingMs: 55 });
  hud.update(1300);
  assert.equal(hud.stall.hidden, true);
  assert.equal(hud.ping.classList.contains('is-bad'), false);
  assert.equal(hud.ping.textContent, '📶 55 ms');
});

test('a host, or no session at all, never shows the banner or the ping chip', () => {
  for (const session of [{ isHost: true, pingMs: 0 }, undefined]) {
    const { hud } = setup({ session });
    hud.update(1000);
    assert.equal(hud.stall.hidden, true);
    assert.equal(hud.ping.hidden, true);
  }
});

test('a slow link (over 250 ms) still marks the ping chip bad without any banner', () => {
  const { hud } = setup({ session: clientSession({ pingMs: 400 }) });
  hud.update(1000);
  assert.equal(hud.ping.classList.contains('is-bad'), true);
  assert.equal(hud.stall.hidden, true);
});

test('leadText names the pantheon of the setup (Random is already drawn there), nothing for spectators', () => {
  const world = makeWorld();
  world.setup.players[0].pantheon = 'norse';
  assert.equal(leadText(viewOf(world, 0)), 'You lead the Norse pantheon.');
  world.setup.players[0].pantheon = 'west_african';
  assert.equal(leadText(viewOf(world, 0)), 'You lead the West African pantheon.');
  assert.equal(leadText(viewOf(world, -1)), '', 'spectator');
  world.setup.players[0].pantheon = 'random';
  assert.equal(leadText(viewOf(world, 0)), '', 'an unresolved pantheon says nothing rather than something wrong');
  assert.equal(leadText(null), '');
});

test('the HUD says which pantheon you lead once, at the first update', () => {
  const { hud } = setup({ session: clientSession(), pantheon: 'norse' });
  assert.equal(hud.msgs.children.length, 0);
  hud.update(1000);
  const lines = hud.msgs.children.map((c) => c.textContent);
  assert.deepEqual(lines, ['You lead the Norse pantheon.']);
  assert.ok(hud.msgs.children[0].className.includes('is-good'));
  hud.update(1200);
  hud.update(1400);
  assert.equal(hud.msgs.children.length, 1, 'only once');
});

test('a spectator gets no "You lead" line', () => {
  const { hud } = setup({ session: clientSession(), me: -1 });
  hud.update(1000);
  assert.equal(hud.msgs.children.length, 0);
});
