// Team chat in the HUD (DESIGN 7, "Team chat"): the chat box's "To all / To allies" switch (a click or Tab),
// Shift+Enter, the "/t " and "/all " prefixes (chatTarget), the "[Allies]" tag on a team line, and a game
// with no teammates, where the switch is disabled and every line goes to everyone. Fake DOM.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../../src/ui/hud.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { InputController } from '../../src/ui/input.js';
import { chatTarget, hasAllies } from '../../src/ui/hud-data.js';
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

/** A HUD for player 0; `teams` sets the setup's teams. Sent lines are in `sent` as [text, opts]. */
function setup(teams) {
  const world = makeWorld({ players: teams.length, teams });
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  vs.pushSnapshot(world.getSnapshot(), 50);
  const sent = [];
  const root = document.createElement('div');
  const game = { viewState: vs, selection: new Selection(vs), session: null, input: null, renderer: null, command() {}, sendChat: (...a) => sent.push(a) };
  const hud = new Hud({ root, game });
  huds.push(hud);
  const type = (text, key = 'Enter', extra = {}) => {
    hud.chatInput.value = text;
    hud.chatInput.fire('input');
    hud.chatInput.fire('keydown', { key, ...extra });
  };
  return { hud, vs, game, sent, type };
}

// ---------------------------------------------------------------- the pure helpers

test('chatTarget: the switch decides, a "/t " or "/team " prefix sends to the allies, "/a " or "/all " to everyone', () => {
  const can = { canAllies: true };
  assert.deepEqual(chatTarget('hello', can), { text: 'hello', team: false });
  assert.deepEqual(chatTarget('hello', { ...can, allies: true }), { text: 'hello', team: true });
  assert.deepEqual(chatTarget('/t rush now', can), { text: 'rush now', team: true });
  assert.deepEqual(chatTarget('/team  rush now ', can), { text: 'rush now', team: true });
  assert.deepEqual(chatTarget('/T Rush', can), { text: 'Rush', team: true }, 'any case');
  assert.deepEqual(chatTarget('/all gg', { ...can, allies: true }), { text: 'gg', team: false });
  assert.deepEqual(chatTarget('/a gg', { ...can, allies: true }), { text: 'gg', team: false });
  assert.deepEqual(chatTarget('/t', can), { text: '', team: true }, 'a bare prefix leaves nothing to send');
  assert.deepEqual(chatTarget('/tea time', can), { text: '/tea time', team: false }, 'only the whole word counts');
  assert.deepEqual(chatTarget('/teammate', can), { text: '/teammate', team: false });
  assert.deepEqual(chatTarget('a/t b', can), { text: 'a/t b', team: false }, 'only at the start');
  assert.deepEqual(chatTarget(null, can), { text: '', team: false });
});

test('chatTarget without allies: every line goes to everyone, the prefix still taken off', () => {
  assert.deepEqual(chatTarget('hi', { allies: true, canAllies: false }), { text: 'hi', team: false });
  assert.deepEqual(chatTarget('/t hi', { canAllies: false }), { text: 'hi', team: false });
  assert.deepEqual(chatTarget('/t hi'), { text: 'hi', team: false }, 'the default is no allies');
});

test('hasAllies: anyone else on my team in the setup', () => {
  const setup = { players: [{ team: 1 }, { team: 2 }, { team: 1 }] };
  assert.equal(hasAllies(setup, 0), true);
  assert.equal(hasAllies(setup, 1), false);
  assert.equal(hasAllies(setup, -1), false, 'a spectator has none');
  assert.equal(hasAllies({ players: [{ team: 1 }, { team: 2 }] }, 0), false);
  assert.equal(hasAllies({ players: [{}, {}] }, 0), false, 'no team numbers, no allies');
  assert.equal(hasAllies(null, 0), false);
});

// ---------------------------------------------------------------- the chat box

test('with an ally: Enter sends to all, the switch (click or Tab) and Shift+Enter send to the allies', () => {
  const { hud, sent, type } = setup([1, 1, 2]);
  hud.openChat();
  assert.equal(hud.chatTo.disabled, false);
  assert.equal(hud.chatTo.textContent, 'To all:');
  type('hello all');
  assert.deepEqual(sent.pop(), ['hello all']);
  assert.equal(hud.chatOpen, false);

  hud.openChat();
  hud.chatTo.click();
  assert.equal(hud.chatTo.textContent, 'To allies:');
  assert.ok(hud.chatBox.classList.contains('is-team'));
  type('flank left');
  assert.deepEqual(sent.pop(), ['flank left', { team: true }]);

  hud.openChat();
  assert.equal(hud.chatTo.textContent, 'To all:', 'each opening starts on everyone');
  hud.chatInput.fire('keydown', { key: 'Tab' });
  assert.equal(hud.chatAllies, true);
  hud.chatInput.fire('keydown', { key: 'Tab' });
  assert.equal(hud.chatAllies, false);
  type('just us', 'Enter', { shiftKey: true });
  assert.deepEqual(sent.pop(), ['just us', { team: true }]);

  hud.openChat({ allies: true });
  assert.equal(hud.chatTo.textContent, 'To allies:', 'Shift+Enter in the game opens it on the allies');
  type('/all gg');
  assert.deepEqual(sent.pop(), ['gg'], '"/all " overrides the switch');
});

test('with an ally: a typed "/t " turns the box to the allies as it is typed, and sends there', () => {
  const { hud, sent, type } = setup([1, 2, 1]);
  hud.openChat();
  hud.chatInput.value = '/t ';
  hud.chatInput.fire('input');
  assert.equal(hud.chatTo.textContent, 'To allies:');
  type('/team towers at 12');
  assert.deepEqual(sent.pop(), ['towers at 12', { team: true }]);
  hud.openChat();
  type('/t');
  assert.equal(sent.length, 0, 'nothing after the prefix: nothing sent');
});

test('without allies (1v1): the switch is disabled and every line, Shift+Enter and "/t " too, goes to all', () => {
  const { hud, sent, type } = setup([1, 2]);
  hud.openChat({ allies: true });
  assert.equal(hud.chatTo.disabled, true);
  assert.equal(hud.chatTo.textContent, 'To all:');
  hud.chatTo.click();
  hud.chatInput.fire('keydown', { key: 'Tab' });
  assert.equal(hud.chatAllies, false);
  type('hi', 'Enter', { shiftKey: true });
  assert.deepEqual(sent.pop(), ['hi']);
  hud.openChat();
  type('/t gg');
  assert.deepEqual(sent.pop(), ['gg']);
});

test('a team line shows "[Allies]" before the name; an all-chat line does not', () => {
  const { hud } = setup([1, 1]);
  hud.chat({ from: 1, name: 'P1', text: 'need wood', system: false, team: true });
  hud.chat({ from: 1, name: 'P1', text: 'gl', system: false });
  const [teamCard, allCard] = hud.msgs.children;
  assert.match(teamCard.textContent, /\[Allies\] P1: need wood/);
  assert.ok(teamCard.classList.contains('is-team'));
  assert.ok(teamCard.find('hud-chat-team'));
  assert.doesNotMatch(allCard.textContent, /Allies/);
  assert.ok(!allCard.classList.contains('is-team'));
});

test('in the game, Enter opens the chat on everyone and Shift+Enter on the allies', () => {
  const world = makeWorld({ players: 2, teams: [1, 1] });
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  vs.pushSnapshot(world.getSnapshot(), 50);
  const opened = [];
  const game = { viewState: vs, selection: new Selection(vs), renderer: { pickEntity: () => null, screenToWorld: (x, y) => ({ x, y }), hidePlacement() {}, setSelection() {}, camera: { centerOn() {} } }, command() {} };
  const input = new InputController({ game, canvas: document.createElement('canvas'), overlayRoot: document.createElement('div') });
  game.input = input;
  game.hud = { message() {}, refreshCard() {}, overlays: { open: false }, chatOpen: false, openChat: (o) => opened.push(o) };
  input.onKeyDown({ key: 'Enter', code: 'Enter', preventDefault() {}, target: document.body });
  input.onKeyDown({ key: 'Enter', code: 'Enter', shiftKey: true, preventDefault() {}, target: document.body });
  assert.deepEqual(opened, [{ allies: false }, { allies: true }]);
  input.dispose && input.dispose();
});
