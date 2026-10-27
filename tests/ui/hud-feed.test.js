// The message feed at the bottom left of the HUD (src/ui/hud.js message / chat / card, hud-data.js
// messageIcon / messageDwell): every line is a card with an emblem, a colour by kind and its dwell;
// the same line again counts instead of stacking; the feed keeps six cards. Fake DOM, mocked timers.
import { test, mock, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../../src/ui/hud.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { MESSAGE_ICONS, RESOURCE_ICONS, messageIcon, messageDwell, peaceStartText } from '../../src/ui/hud-data.js';
import { PANTHEON_EMBLEMS } from '../../src/ui/menu-model.js';
import { ViewState } from '../../src/game/view-state.js';
import { saveSettings } from '../../src/settings.js';
import { makeWorld } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(() => {
  installFakeDom();
  saveSettings({ tipsDismissed: true });
});

const huds = [];
afterEach(() => mock.timers.reset());
after(() => {
  for (const h of huds) h.dispose();
});

/** A HUD on a fresh world (options go to makeWorld); the lines it has shown are in hud.msgs. */
function setup(opts = {}) {
  const world = makeWorld(opts);
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  vs.pushSnapshot(world.getSnapshot(), 50);
  const root = document.createElement('div');
  const game = { viewState: vs, selection: new Selection(vs), session: null, input: null, renderer: null, command() {}, sendChat() {} };
  const hud = new Hud({ root, game });
  huds.push(hud);
  const cards = () => hud.msgs.children;
  const words = () => cards().map((c) => c.textContent);
  return { hud, vs, world, cards, words };
}

// ---------------------------------------------------------------- the data

test('messageIcon: the sender\'s own emblem when it is a short string, else the kind\'s', () => {
  assert.equal(messageIcon('info', '⛩️'), '⛩️');
  assert.equal(messageIcon('alert', RESOURCE_ICONS.gold), '💰');
  assert.equal(messageIcon('alert'), MESSAGE_ICONS.alert);
  assert.equal(messageIcon('good', null), MESSAGE_ICONS.good);
  assert.equal(messageIcon('good', ''), MESSAGE_ICONS.good);
  assert.equal(messageIcon('good', 42), MESSAGE_ICONS.good, 'not a string');
  assert.equal(messageIcon('good', { toString: () => 'x' }), MESSAGE_ICONS.good);
  assert.equal(messageIcon('good', 'a long string is words, not an emblem'), MESSAGE_ICONS.good);
  assert.equal(messageIcon('nonsense', undefined), MESSAGE_ICONS.info, 'an unknown kind reads as a note');
  assert.equal(messageIcon('constructor', undefined), MESSAGE_ICONS.info, 'nothing from the prototype');
  for (const kind of ['info', 'good', 'alert', 'system', 'chat']) assert.ok(MESSAGE_ICONS[kind], kind);
  assert.equal(RESOURCE_ICONS.constructor, Object, 'the table is a plain object: a host\'s odd resource name finds no own emblem');
  assert.equal(messageIcon('good', RESOURCE_ICONS.constructor), MESSAGE_ICONS.good, 'and a function is no emblem');
});

test('messageDwell: 10 to 16 s by length, a warning 2.5 s longer, a key marker counts as its key name', () => {
  assert.equal(messageDwell('Temple completed.', 'info'), 10000, 'a short note: the least');
  assert.equal(messageDwell('x'.repeat(100), 'info'), 8500 + 100 * 45);
  assert.equal(messageDwell('x'.repeat(5000), 'good'), 16000, 'a very long one: the most');
  assert.equal(messageDwell('Temple completed.', 'alert'), 12500);
  assert.equal(messageDwell('x'.repeat(5000), 'alert'), 18500);
  assert.equal(messageDwell('Press [[Space]].', 'info'), messageDwell('Press Space.', 'info'));
  assert.equal(messageDwell('x'.repeat(100) + ' [[Space]]', 'info'), 8500 + 106 * 45);
  assert.equal(messageDwell(undefined, 'info'), 10000);
  assert.ok(messageDwell('Hello there', 'info') > 8000, 'longer than the 8 s a line stayed before');
});

// ---------------------------------------------------------------- the card

test('a message is a card: the words as text, an emblem for the stylesheet, a class for its kind', () => {
  const { hud, cards, words } = setup();
  const line = hud.message('Temple completed.', 'info', { icon: '⛩️' });
  assert.equal(cards().length, 1);
  assert.equal(cards()[0], line);
  assert.equal(line.className, 'hud-msg is-info');
  assert.equal(line.dataset.icon, '⛩️');
  assert.deepEqual(words(), ['Temple completed.']);
  assert.equal(line.find('hud-msg-text').textContent, 'Temple completed.');
  assert.equal(hud.msgs.getAttribute('role'), 'log', 'a log for screen readers');
  assert.equal(hud.msgs.getAttribute('aria-live'), 'polite');
});

test('a card without an emblem of its own wears its kind\'s', () => {
  const { hud } = setup();
  for (const kind of ['info', 'good', 'alert', 'system']) {
    const line = hud.message(`A ${kind} line.`, kind);
    assert.equal(line.dataset.icon, MESSAGE_ICONS[kind], kind);
    assert.equal(line.className, `hud-msg is-${kind}`);
  }
  const odd = hud.message('An odd emblem.', 'info', { icon: 'this is far too long to be an emblem' });
  assert.equal(odd.dataset.icon, MESSAGE_ICONS.info);
});

test('[[Key]] markers are drawn as key caps; everything else stays text, never HTML', () => {
  const { hud } = setup();
  const line = hud.message('Your base is under attack!  [[Space]]', 'alert');
  assert.equal(line.textContent, 'Your base is under attack!  Space');
  assert.deepEqual(line.all('kbd').map((k) => k.textContent), ['Space']);
  const two = hud.message('Build Houses to grow ([[B]], then [[H]]).', 'info');
  assert.deepEqual(two.all('kbd').map((k) => k.textContent), ['B', 'H']);
  assert.equal(two.textContent, 'Build Houses to grow (B, then H).');
  const evil = hud.message('<img src=x onerror=alert(1)> and <b>bold</b>', 'info');
  assert.equal(evil.all('img').length, 0);
  assert.equal(evil.all('b').length, 0);
  assert.equal(evil.textContent, '<img src=x onerror=alert(1)> and <b>bold</b>');
});

test('a very long line is cut, an empty one is ignored, and an error goes to the middle of the screen, not the feed', () => {
  const { hud, cards } = setup();
  const long = hud.message('word '.repeat(200), 'info');
  assert.ok(long.textContent.length <= 240 && long.textContent.endsWith('…'));
  assert.equal(hud.message('', 'info'), null);
  assert.equal(hud.message(null, 'info'), null);
  assert.equal(cards().length, 1);
  assert.equal(hud.message('Not enough gold.', 'error'), hud.errorEl);
  assert.equal(hud.errorEl.textContent, 'Not enough gold.');
  assert.equal(cards().length, 1, 'the feed holds notes, not refusals');
});

// ---------------------------------------------------------------- how long a card stays

test('a card stays for its dwell (10 s and up, a warning 2.5 s more), then fades and leaves', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { hud, cards } = setup();
  const note = hud.message('Temple completed.', 'info');
  const warning = hud.message('Your base is under attack!  [[Space]]', 'alert');
  mock.timers.tick(9900);
  assert.equal(cards().length, 2);
  assert.equal(note.classList.contains('is-fading'), false);
  mock.timers.tick(200); // 10.1 s
  assert.equal(note.classList.contains('is-fading'), true, 'the note starts to fade');
  assert.equal(warning.classList.contains('is-fading'), false, 'the warning is still there');
  mock.timers.tick(600);
  assert.deepEqual(cards(), [warning], 'the note is gone');
  mock.timers.tick(1800); // 12.7 s
  assert.equal(warning.classList.contains('is-fading'), true);
  mock.timers.tick(600);
  assert.equal(cards().length, 0);
});

test('a longer line stays longer, up to 16 s', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { hud, cards } = setup();
  const long = hud.message(peaceStartText(1800), 'good'); // some 150 letters
  assert.ok(long.textContent.length > 120);
  const dwell = messageDwell(peaceStartText(1800), 'good');
  assert.ok(dwell > 13000 && dwell <= 16000, `${dwell}`);
  mock.timers.tick(dwell - 100);
  assert.equal(long.classList.contains('is-fading'), false);
  mock.timers.tick(200);
  assert.equal(long.classList.contains('is-fading'), true);
  mock.timers.tick(600);
  assert.equal(cards().length, 0);
});

// ---------------------------------------------------------------- the same line again

test('the same line again does not stack: its card counts ×2, ×3, comes back to the bottom and stays a full dwell more', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { hud, cards, words } = setup();
  const first = hud.message('House completed.', 'info', { icon: '🏠' });
  assert.equal(first.dataset.count, undefined, 'a single card shows no count');
  hud.message('Your forces are under attack!  [[Space]]', 'alert');
  mock.timers.tick(6000);
  const again = hud.message('House completed.', 'info', { icon: '🏠' });
  assert.equal(again, first, 'the card already up');
  assert.equal(again.dataset.count, '2');
  assert.deepEqual(words(), ['Your forces are under attack!  Space', 'House completed.'], 'back at the bottom');
  hud.message('House completed.', 'info');
  assert.equal(first.dataset.count, '3');
  assert.equal(cards().length, 2);
  // The stay starts over: 6 s on, it would have gone at 10 s; now it lasts to 16 s.
  mock.timers.tick(4500);
  assert.equal(first.classList.contains('is-fading'), false, 'not at 10.5 s');
  mock.timers.tick(5600);
  assert.equal(first.classList.contains('is-fading'), true, 'at 16.1 s');
});

test('only the very same line counts: another kind, other words, or a card already fading start a card of their own', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { hud, cards } = setup();
  const a = hud.message('Barracks completed.', 'info');
  const b = hud.message('Barracks completed.', 'good');
  const c = hud.message('Temple completed.', 'info');
  assert.equal(new Set([a, b, c]).size, 3);
  assert.equal(cards().length, 3);
  mock.timers.tick(10100); // every card begins to fade
  assert.equal(a.classList.contains('is-fading'), true);
  const d = hud.message('Barracks completed.', 'info');
  assert.notEqual(d, a, 'a fading card is on its way out');
  assert.equal(d.dataset.count, undefined);
  mock.timers.tick(600);
  assert.deepEqual(cards(), [d]);
});

test('a line that is only its key cap differs by the key: the count keys on the words as written', () => {
  const { hud, cards } = setup();
  hud.message('Go on.  [[Space]]', 'info');
  hud.message('Go on.  [[Home]]', 'info');
  assert.equal(cards().length, 2);
});

// ---------------------------------------------------------------- how many cards

test('the feed keeps six cards: a seventh line pushes the oldest out', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { hud, cards, words } = setup();
  for (let i = 1; i <= 7; i++) hud.message(`Line ${i}.`, 'info');
  assert.deepEqual(words(), ['Line 2.', 'Line 3.', 'Line 4.', 'Line 5.', 'Line 6.', 'Line 7.']);
  mock.timers.tick(11000);
  mock.timers.tick(700);
  assert.equal(cards().length, 0, 'the dropped card\'s timer does not trip over a card that is gone');
});

// ---------------------------------------------------------------- chat

test('a chat line is a card too: the sender\'s colour on its edge and name, the words as text', () => {
  const { hud, vs, cards } = setup();
  vs.players[1].color = '#33aa66';
  hud.chat({ from: 1, name: 'Freyja', text: 'On my way. <b>now</b>' });
  const card = cards()[0];
  assert.equal(card.className, 'hud-msg is-chat');
  assert.equal(card.dataset.icon, MESSAGE_ICONS.chat);
  assert.equal(card.style.getPropertyValue('--msg-accent'), '#33aa66');
  const who = card.find('hud-chat-from');
  assert.equal(who.textContent, 'Freyja:');
  assert.equal(who.style.color, '#33aa66');
  assert.equal(card.textContent, 'Freyja: On my way. <b>now</b>');
  assert.equal(card.all('b').filter((b) => b.className !== 'hud-chat-from').length, 0, 'no markup from the text');
});

test('a chat sender\'s colour is checked before it reaches a style', () => {
  const { hud, vs, cards } = setup();
  vs.players[1].color = 'red; background: url(http://evil/x)';
  hud.chat({ from: 1, name: 'Mallory', text: 'hello' });
  const card = cards()[0];
  assert.equal(card.style.getPropertyValue('--msg-accent'), '#f1e8d4', 'the plain fallback');
  assert.equal(card.find('hud-chat-from').style.color, '#f1e8d4');
  hud.chat({ from: 7, name: 'Ghost', text: 'from nobody' });
  assert.equal(cards()[1].style.getPropertyValue('--msg-accent'), '', 'no known sender: the stylesheet\'s own colour');
});

test('a system line from the lobby is a system card; chat lines are never merged, and stay 14 s', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { hud, cards } = setup();
  hud.chat({ system: true, text: 'Freyja has joined.' });
  hud.chat({ from: 1, name: 'Freyja', text: 'gg' });
  hud.chat({ from: 1, name: 'Freyja', text: 'gg' });
  assert.equal(cards().length, 3);
  assert.equal(cards()[0].className, 'hud-msg is-system');
  assert.equal(cards()[0].dataset.icon, MESSAGE_ICONS.system);
  mock.timers.tick(13900);
  assert.equal(cards()[1].classList.contains('is-fading'), false);
  mock.timers.tick(200);
  assert.equal(cards()[1].classList.contains('is-fading'), true);
});

// ---------------------------------------------------------------- the HUD's own lines

test('the opening lines wear emblems: the pantheon\'s, and the dove of the Decade of Peace', () => {
  const { hud, cards, words } = setup({ pantheons: ['norse', 'greek'], peaceMinutes: 30 });
  hud.update(1000);
  assert.ok(words().some((w) => /You lead the Norse pantheon/.test(w)));
  const lead = cards().find((c) => /You lead/.test(c.textContent));
  assert.equal(lead.dataset.icon, PANTHEON_EMBLEMS.norse);
  assert.equal(lead.className, 'hud-msg is-good');
  const peace = cards().find((c) => /Decade of Peace/.test(c.textContent));
  assert.equal(peace.dataset.icon, '🕊️');
});

test('a Decade of Peace reminder is a warning card with the dove', () => {
  const { hud, vs, world, cards } = setup({ peaceMinutes: 30 });
  hud.update(1000);
  const before = cards().length;
  const snap = world.getSnapshot();
  vs.pushSnapshot({ ...snap, tick: snap.tick + 20 * 1510, time: 1510 }, 50); // 4:50 left of 30:00
  hud.update(1500);
  const warn = cards()[before];
  assert.ok(warn, 'a reminder at the 5:00 mark');
  assert.match(warn.textContent, /ends in 5 minutes/);
  assert.equal(warn.dataset.icon, '🕊️');
  assert.equal(warn.className, 'hud-msg is-alert');
});
