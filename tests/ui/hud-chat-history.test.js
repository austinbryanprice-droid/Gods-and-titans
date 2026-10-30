// The chat history (DESIGN 9, "The message feed"): the HUD keeps the last 50 chat and system lines (sender,
// colour, team tag, game time) and shows them above the chat box while it is open, over the game-over panel
// too; a full feed drops alerts before a player's chat card. Pure helpers, then the real Hud on the fake DOM.
import { test, mock, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Hud } from '../../src/ui/hud.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { InputController } from '../../src/ui/input.js';
import { CHAT_HISTORY_MAX, pushHistory, evictIndex } from '../../src/ui/hud-data.js';
import { ViewState } from '../../src/game/view-state.js';
import { saveSettings } from '../../src/settings.js';
import { makeWorld } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(() => {
  installFakeDom();
  saveSettings({ tipsDismissed: true });
});

const live = [];
afterEach(() => mock.timers.reset());
after(() => {
  for (const x of live) x.dispose();
});

/** A HUD for player 0 on a world with `teams`; `online` games get an InputController and can chat over the panel. */
function setup({ teams = [1, 1, 2], online = false } = {}) {
  const world = makeWorld({ players: teams.length, teams });
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  vs.pushSnapshot(world.getSnapshot(), 50);
  const sent = [];
  const root = document.createElement('div');
  const game = { viewState: vs, selection: new Selection(vs), session: null, input: null, renderer: null, online, ended: false, command() {}, setShowAllBars() {}, sendChat: (...a) => sent.push(a) };
  const hud = new Hud({ root, game });
  game.hud = hud;
  live.push(hud);
  const rows = () => hud.chatLog.findAll('hud-chatlog-line');
  const words = () => hud.msgs.children.map((c) => c.textContent);
  return { hud, vs, game, root, sent, rows, words };
}

// ---------------------------------------------------------------- the pure helpers

test('pushHistory keeps the newest lines, up to its cap (50 by default)', () => {
  assert.equal(CHAT_HISTORY_MAX, 50);
  const h = [];
  for (let i = 1; i <= 53; i++) pushHistory(h, { text: String(i) });
  assert.equal(h.length, 50);
  assert.equal(h[0].text, '4');
  assert.equal(h[49].text, '53');
  const small = [];
  for (let i = 1; i <= 4; i++) pushHistory(small, i, 3);
  assert.deepEqual(small, [2, 3, 4]);
});

test('evictIndex: the oldest card that is not chat, else the oldest; never the card just added while another can go', () => {
  const chat = () => ({ _chat: true });
  const alert = () => ({});
  const c0 = chat(), a1 = alert(), c2 = chat(), a3 = alert();
  assert.equal(evictIndex([c0, a1, c2, a3]), 1);
  assert.equal(evictIndex([c0, c2]), 0, 'all chat: the oldest');
  const fresh = alert();
  assert.equal(evictIndex([c0, c2, fresh], fresh), 0, 'a new alert over a feed of chat pushes the oldest chat, not itself');
  assert.equal(evictIndex([a1, fresh], fresh), 0);
  assert.equal(evictIndex([]), -1);
});

// ---------------------------------------------------------------- the feed

test('a full feed drops the oldest alert before a friend\'s chat card', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { hud, words } = setup();
  hud.chat({ from: 1, name: 'Freyja', text: 'Coming to help.' });
  for (let i = 1; i <= 8; i++) hud.message(`Enemies at the gate ${i}.`, 'alert');
  const w = words();
  assert.equal(w.length, 6);
  assert.equal(w[0], 'Freyja: Coming to help.', 'the chat card outlives a burst of alerts');
  assert.deepEqual(w.slice(1), [4, 5, 6, 7, 8].map((i) => `Enemies at the gate ${i}.`));
});

test('a feed full of chat drops the oldest chat line for a new alert, and still keeps six', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { hud, words } = setup();
  for (let i = 1; i <= 6; i++) hud.chat({ from: 1, name: 'Freyja', text: `line ${i}` });
  hud.message('Your Temple is under attack!', 'alert');
  assert.deepEqual(words(), ['Freyja: line 2', 'Freyja: line 3', 'Freyja: line 4', 'Freyja: line 5', 'Freyja: line 6', 'Your Temple is under attack!']);
});

// ---------------------------------------------------------------- the history

test('every chat and system line goes to the history with its sender, colour, team tag and game time; alerts do not', () => {
  const { hud, vs } = setup();
  vs.players[1].color = '#33aa66';
  vs.time = 75;
  hud.chat({ from: 1, name: 'Freyja', text: 'On my way.' });
  vs.time = 130;
  hud.chat({ from: 2, name: 'Loki', text: 'flank', team: true });
  hud.chat({ from: -1, name: '', text: 'Cleo left the game.', system: true });
  hud.message('Enemies near your base!', 'alert');
  assert.equal(hud.chatHistory.length, 3);
  assert.deepEqual(hud.chatHistory[0], { kind: 'chat', name: 'Freyja', color: '#33aa66', team: false, text: 'On my way.', time: 75 });
  assert.equal(hud.chatHistory[1].team, true);
  assert.equal(hud.chatHistory[1].time, 130);
  assert.equal(hud.chatHistory[2].kind, 'system');
});

test('the history keeps the last 50 lines, long after their cards left the feed', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { hud, rows } = setup();
  for (let i = 1; i <= 60; i++) hud.chat({ from: 1, name: 'Freyja', text: `line ${i}` });
  mock.timers.tick(20000);
  mock.timers.tick(700);
  assert.equal(hud.msgs.children.length, 0, 'the feed has cleared');
  hud.openChat();
  const r = rows();
  assert.equal(r.length, 50);
  assert.match(r[0].textContent, /Freyja: line 11$/);
  assert.match(r[49].textContent, /Freyja: line 60$/, 'newest at the bottom');
});

test('opening the chat box shows the history above it; closing (Esc or Enter) hides it', () => {
  const { hud, vs, rows, sent } = setup();
  assert.equal(hud.chatLog.hidden, true);
  hud.openChat();
  assert.equal(hud.chatLog.hidden, false);
  assert.equal(hud.chatLog.find('hud-chatlog-empty').textContent, 'No messages yet.');
  hud.chatInput.fire('keydown', { key: 'Escape' });
  assert.equal(hud.chatOpen, false);
  assert.equal(hud.chatLog.hidden, true);

  vs.time = 65;
  hud.chat({ from: 1, name: 'Freyja', text: 'rush at 5' });
  hud.openChat();
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].textContent, '1:05 Freyja: rush at 5');
  assert.equal(hud.msgs.classList.contains('is-chatting'), true, 'the feed steps aside for the panel');
  hud.chatInput.value = 'ok';
  hud.chatInput.fire('keydown', { key: 'Enter' });
  assert.deepEqual(sent.pop(), ['ok'], 'Enter still sends');
  assert.equal(hud.chatLog.hidden, true);
  assert.equal(hud.msgs.classList.contains('is-chatting'), false);
});

test('a line that arrives while the box is open shows in the history at once; a team line carries [Allies] and the sender\'s colour', () => {
  const { hud, vs, rows } = setup();
  vs.players[2].color = '#3366ff';
  hud.openChat();
  hud.chat({ from: 2, name: 'Loki', text: 'flank left', team: true });
  hud.chat({ from: -1, name: '', text: 'An AI plays for Cleo.', system: true });
  const [team, sys] = rows();
  assert.ok(team.classList.contains('is-team'));
  assert.equal(team.find('hud-chat-team').textContent, '[Allies]');
  assert.equal(team.find('hud-chat-from').style.color, '#3366ff');
  assert.match(team.textContent, /\[Allies\] Loki: flank left$/);
  assert.ok(sys.className.includes('is-system'));
  assert.match(sys.textContent, /An AI plays for Cleo\.$/);
  assert.equal(sys.find('hud-chat-from'), null, 'a system line has no sender');
});

test('the history is text nodes only: markup in a line is shown, never parsed', () => {
  const { hud, rows } = setup();
  hud.chat({ from: 1, name: '<i>x</i>', text: '<img src=x onerror=alert(1)>' });
  hud.openChat();
  const text = rows()[0].find('hud-chatlog-text');
  assert.equal(text.childNodes.length, 1);
  assert.equal(text.childNodes[0].nodeType, 3);
  assert.equal(text.textContent, '<img src=x onerror=alert(1)>');
});

test('the Tab switch and the "/t " prefix still work with the history up', () => {
  const { hud, sent } = setup();
  hud.openChat();
  hud.chatInput.fire('keydown', { key: 'Tab' });
  assert.equal(hud.chatAllies, true);
  hud.chatInput.value = '/all gg';
  hud.chatInput.fire('keydown', { key: 'Enter' });
  assert.deepEqual(sent.pop(), ['gg']);
  hud.openChat();
  hud.chatInput.value = '/t towers';
  hud.chatInput.fire('keydown', { key: 'Enter' });
  assert.deepEqual(sent.pop(), ['towers', { team: true }]);
});

test('online, over the game-over panel: Enter opens the box with the history, raised over the overlay layer', () => {
  const { hud, game, root, rows } = setup({ online: true });
  const input = new InputController({ game, canvas: document.createElement('canvas'), overlayRoot: hud.overlayRoot });
  game.input = input;
  live.push(input);
  hud.chat({ from: 1, name: 'Freyja', text: 'well played' });
  hud.overlays.showGameOver({ result: 'victory', winningTeam: 1 });
  input.onKeyDown({ key: 'Enter', code: '', preventDefault() {}, target: document.body });
  assert.equal(hud.chatOpen, true);
  assert.equal(hud.chatLog.hidden, false);
  assert.equal(root.classList.contains('is-panel-chat'), true);
  assert.match(rows()[0].textContent, /Freyja: well played$/);
  hud.chat({ from: 1, name: 'Freyja', text: 'rematch?' });
  assert.equal(rows().length, 2);
  hud.chatInput.fire('keydown', { key: 'Escape' });
  assert.equal(hud.chatLog.hidden, true);
  assert.equal(hud.overlays.name, 'gameover', 'Esc closes the box only');
});

test('the stylesheet: the history scrolls, lifts over the end panel with the box, and the feed steps aside while chatting', async () => {
  const css = await readFile(new URL('../../src/ui/hud.css', import.meta.url), 'utf8');
  const rule = /^\.hud-chatlog \{([^}]*)\}/m.exec(css);
  assert.ok(rule, 'a .hud-chatlog rule');
  assert.match(rule[1], /overflow-y: auto/);
  assert.match(rule[1], /max-height/);
  assert.match(css, /\.hud\.is-panel-chat [^{]*\.hud-chatlog[^{]*\{ z-index: 11; \}/);
  assert.match(css, /\.hud-msgs\.is-chatting \{ visibility: hidden; \}/);
});
