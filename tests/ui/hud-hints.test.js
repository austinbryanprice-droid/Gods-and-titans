// Gameplay tips: the catalog (src/ui/hint-data.js), when one is shown and how often
// (HintScheduler), the card itself (HintsView) and its place in the HUD (src/ui/hud-hints.js, hud.js).
// Fake DOM, a real ViewState fed snapshots at chosen game times, mocked timers.
import { test, mock, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { HINTS, hintContext, hintParts, hintText, loadingHint, pickHint } from '../../src/ui/hint-data.js';
import { HintScheduler, HintsView, hintStore } from '../../src/ui/hud-hints.js';
import { Hud } from '../../src/ui/hud.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { ViewState } from '../../src/game/view-state.js';
import { BUILDINGS, eliteFor } from '../../src/data/index.js';
import { MINE_SLOTS, SPELL_VS_BUILDING, TRADE_TAX_PCT, PEACE_NAME } from '../../src/config.js';
import { getSettings, saveSettings } from '../../src/settings.js';
import { sfx } from '../../src/audio/sfx.js';
import { makeWorld } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(() => {
  installFakeDom();
  saveSettings({ tipsDismissed: true, hints: true, alerts: 'all' });
});

const toDispose = [];
afterEach(() => {
  mock.timers.reset();
  saveSettings({ hints: true, alerts: 'all' });
});
after(() => {
  for (const d of toDispose) d.dispose();
});

/** A ViewState for player 0 on a fresh world, shown at game time `time`; edit(snapshot) changes the snapshot first. */
function viewOf({ time = 0, edit, world = makeWorld(), me = 0 } = {}) {
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: me });
  const snap = JSON.parse(JSON.stringify(world.getSnapshot()));
  snap.time = time;
  if (edit) edit(snap);
  vs.pushSnapshot(snap, 50);
  return { vs, world, push: (t, e) => {
    const next = JSON.parse(JSON.stringify(world.getSnapshot()));
    next.time = t;
    next.tick = snap.tick + Math.round(t * 20) + 1;
    if (e) e(next);
    vs.pushSnapshot(next, 50);
  } };
}

// ---------------------------------------------------------------- the catalog

test('every tip is well formed: unique id, words, balanced key markers, a boolean condition', () => {
  const idsSeen = new Set();
  const ctx = hintContext(viewOf().vs);
  for (const h of HINTS) {
    assert.match(h.id, /^[a-z][a-z0-9-]*$/, h.id);
    assert.ok(!idsSeen.has(h.id), `duplicate id ${h.id}`);
    idsSeen.add(h.id);
    const text = hintText(h, { ...ctx, pantheon: 'greek' });
    assert.equal(typeof text, 'string', h.id);
    assert.ok(text.length > 20 && text.length < 260, `${h.id}: ${text.length} letters`);
    assert.equal((text.match(/\[\[/g) || []).length, (text.match(/\]\]/g) || []).length, `${h.id}: unbalanced [[ ]]`);
    assert.doesNotMatch(text, /[<>]/, `${h.id}: markup`);
    if (h.when) assert.equal(typeof h.when(ctx), 'boolean', h.id);
  }
  assert.ok(HINTS.length >= 30);
});

test('every key a tip names is a real key', () => {
  const NAMED = new Set(['Shift', 'Ctrl', 'Alt', 'Tab', 'Space', 'Backspace', 'F1', 'F2', 'F3', '.', '`']);
  for (const h of HINTS) {
    for (const part of hintParts(hintText(h, { pantheon: 'greek' }))) {
      if (typeof part === 'string') continue;
      assert.ok(NAMED.has(part.key) || /^[A-Z1-9]$/.test(part.key), `${h.id}: [[${part.key}]]`);
    }
  }
});

test('tips that quote a build hotkey or a game number say what the data says', () => {
  const text = (id) => hintText(HINTS.find((h) => h.id === id), { pantheon: 'greek' });
  const build = (id, building) => assert.match(text(id), new RegExp(`\\[\\[B\\]\\], then \\[\\[${BUILDINGS[building].hotkey}\\]\\]`), id);
  build('storehouse', 'storehouse');
  build('titan', 'titan_gate');
  assert.match(text('walls'), new RegExp(`\\[\\[B\\]\\], then \\[\\[${BUILDINGS.wooden_wall.hotkey}\\]\\]`));
  assert.match(text('mine-slots'), new RegExp(`Only ${MINE_SLOTS} Worshippers`));
  assert.match(text('market'), new RegExp(`keeps ${TRADE_TAX_PCT}%`));
  assert.match(text('spells-buildings'), new RegExp(`only ${Math.round(SPELL_VS_BUILDING * 100)}% to buildings`));
  assert.match(text('peace'), new RegExp(PEACE_NAME));
  assert.match(text('elite'), new RegExp(eliteFor('greek').name));
  assert.match(text('temple'), /half the price/);
});

test('hintParts turns [[Key]] markers into key parts and keeps the words around them', () => {
  assert.deepEqual(hintParts('Press [[Space]] to go.'), ['Press ', { key: 'Space' }, ' to go.']);
  assert.deepEqual(hintParts('[[Ctrl]] + [[1]]'), [{ key: 'Ctrl' }, ' + ', { key: '1' }]);
  assert.deepEqual(hintParts('no keys'), ['no keys']);
  assert.deepEqual(hintParts(''), []);
  assert.deepEqual(hintParts('Press [[`]], then [[.]]'), ['Press ', { key: '`' }, ', then ', { key: '.' }]);
});

test('pickHint: tips seen least first, a tip that fits the match before a general one, nothing twice past maxSeen', () => {
  const hints = [
    { id: 'a', text: 'General one aaaaaaaaaaaaaaaa' },
    { id: 'b', text: 'General two bbbbbbbbbbbbbbbb' },
    { id: 'c', text: 'Fits workers cccccccccccccccc', when: (c) => c.workers > 2 },
    { id: 'd', text: 'Fits armies dddddddddddddddd', when: (c) => c.army > 2 },
  ];
  const first = (o) => pickHint({ hints, rng: () => 0, ...o });
  assert.equal(first({ ctx: { workers: 5, army: 0 }, seen: {} }).id, 'c', 'the fitting one beats the general ones');
  assert.equal(first({ ctx: { workers: 0, army: 0 }, seen: {} }).id, 'a', 'with nothing fitting, a general one');
  assert.equal(first({ ctx: { workers: 5, army: 0 }, seen: { c: 1 } }).id, 'a', 'least seen first, even over a fitting one');
  assert.equal(first({ ctx: { workers: 5, army: 5 }, seen: { a: 1, b: 1, c: 1 } }).id, 'd');
  assert.equal(first({ ctx: { workers: 5, army: 0 }, seen: { a: 2, b: 2, c: 2, d: 2 }, maxSeen: 2 }), null, 'all told twice');
  assert.equal(first({ ctx: { workers: 5, army: 0 }, seen: { a: 2 }, maxSeen: 2 }).id, 'c');
  assert.equal(first({ ctx: { workers: 5, army: 0 }, seen: {}, skip: ['c'] }).id, 'a');
  assert.equal(pickHint({ hints, ctx: { workers: 0, army: 0 }, seen: {}, rng: () => 0.99 }).id, 'b', 'rng chooses among equals');
});

test('pickHint survives a condition or a text that throws', () => {
  const hints = [
    { id: 'bad-when', text: 'Never fits xxxxxxxxxxxxxxxxxxx', when: () => { throw new Error('boom'); } },
    { id: 'bad-text', text: () => { throw new Error('boom'); } },
    { id: 'empty', text: '' },
    { id: 'fine', text: (c) => `Fine for ${c.who} yyyyyyyyyyyyyy` },
  ];
  assert.deepEqual(pickHint({ hints, ctx: { who: 'you' }, rng: () => 0 }), { id: 'fine', text: 'Fine for you yyyyyyyyyyyyyy' });
  assert.equal(pickHint({ hints: [], ctx: {} }), null);
});

test('hintContext counts what the player has, and the tips that depend on it fit', () => {
  const fresh = hintContext(viewOf().vs);
  assert.equal(fresh.workers, 5);
  assert.equal(fresh.army, 0);
  assert.equal(fresh.tier, 1);
  assert.equal(fresh.pantheon, 'greek');
  assert.equal(fresh.has.town_center, 1);
  assert.equal(fresh.ally, false);
  assert.equal(fresh.peace, false);
  assert.equal(fresh.damaged, false);

  const { vs } = viewOf({
    time: 400,
    edit: (snap) => {
      const worker = snap.entities.find((e) => e.k === 'u' && e.o === 0);
      const town = snap.entities.find((e) => e.k === 'b' && e.o === 0);
      for (let i = 0; i < 7; i++) snap.entities.push({ ...worker, id: 800 + i, t: 'warrior' });
      snap.entities.push({ ...town, id: 850, t: 'barracks', tx: 20, ty: 20, hp: 100, mhp: 1000 });
      snap.entities.push({ ...town, id: 851, t: 'wooden_wall', tx: 25, ty: 25, hp: 100, mhp: 100 });
      snap.players[0].tier = 2;
    },
  });
  const c = hintContext(vs);
  assert.equal(c.army, 7);
  assert.equal(c.workers, 5);
  assert.equal(c.has.barracks, 1);
  assert.equal(c.walls, 1, 'a wall counts as a wall, not as a building');
  assert.equal(c.has.wooden_wall, undefined);
  assert.equal(c.damaged, true);
  const fits = (id) => HINTS.find((h) => h.id === id).when(c);
  assert.equal(fits('rams'), true);
  assert.equal(fits('priests'), false, 'it takes 8 soldiers');
  assert.equal(fits('walls-gap'), true);
  assert.equal(fits('walls'), false, 'walls are already up');
  assert.equal(fits('repair'), true);
  assert.equal(fits('peace'), false);
});

test('the Decade of Peace tips fit only a peace; the team Market tip only a team', () => {
  const peace = hintContext(viewOf({ world: makeWorld({ peaceMinutes: 30 }) }).vs);
  const fits = (c, id) => HINTS.find((h) => h.id === id).when(c);
  assert.equal(peace.peace, true);
  assert.equal(fits(peace, 'peace'), true);
  assert.equal(fits(hintContext(viewOf().vs), 'peace'), false);
  const team = hintContext(viewOf({ world: makeWorld({ players: 3, teams: [1, 1, 2] }) }).vs);
  assert.equal(team.ally, true);
  assert.equal(fits(team, 'market'), true);
  assert.equal(fits(hintContext(viewOf().vs), 'market'), false);
});

test('the loading screen gets a tip that is true in any match', () => {
  for (let i = 0; i < 50; i++) {
    const tip = loadingHint(() => i / 50);
    assert.ok(tip && tip.text.length > 20);
    assert.equal(HINTS.find((h) => h.id === tip.id).when, undefined, tip.id);
  }
});

// ---------------------------------------------------------------- how often a tip was shown

class FakeStorage {
  constructor(initial = {}) {
    this.map = new Map(Object.entries(initial));
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
}

test('the store counts per tip, remembers across pages, and shrugs off bad storage', () => {
  const storage = new FakeStorage();
  const a = hintStore(storage);
  assert.deepEqual(a.counts(), {});
  a.bump('zoom');
  a.bump('zoom');
  a.bump('groups');
  assert.deepEqual(a.counts(), { zoom: 2, groups: 1 });
  assert.deepEqual(hintStore(storage).counts(), { zoom: 2, groups: 1 }, 'a new page remembers');
  const copy = a.counts();
  copy.zoom = 99;
  assert.equal(a.counts().zoom, 2, 'counts() hands out a copy');

  const hostile = hintStore(new FakeStorage({ 'mythicwar-hints': JSON.stringify({ zoom: 3, groups: -1, rally: 1.5, minimap: 'lots', nope: 4, __proto__: 5, constructor: 6, toString: 7 }) }));
  assert.deepEqual(hostile.counts(), { zoom: 3 }, 'only known tips with whole counts');
  assert.deepEqual(hintStore(new FakeStorage({ 'mythicwar-hints': '{not json' })).counts(), {});
  assert.deepEqual(hintStore(new FakeStorage({ 'mythicwar-hints': '[1,2]' })).counts(), {});
  assert.deepEqual(hintStore(new FakeStorage({ 'mythicwar-hints': 'null' })).counts(), {});

  const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  const s = hintStore(full);
  assert.doesNotThrow(() => s.bump('zoom'));
  assert.equal(s.counts().zoom, 1, 'kept in memory for this page');
  const none = hintStore(null);
  none.bump('zoom');
  assert.equal(none.counts().zoom, 1);
  assert.equal(hintStore({ getItem: () => { throw new Error('blocked'); } }).counts().zoom, undefined);
  a.bump('zoom');
  a.bump('zoom');
  assert.equal(a.counts().zoom, 4);
  assert.equal(JSON.parse(storage.getItem('mythicwar-hints')).zoom, 4);
});

// ---------------------------------------------------------------- the scheduler

/** A scheduler on a real ViewState, collecting what it shows; at(t) moves the game clock. */
function timed({ settings = {}, world, me = 0, rng = () => 0 } = {}) {
  const view = viewOf({ world, me });
  const shown = [];
  let hides = 0;
  const prefs = { hints: true, ...settings };
  const store = hintStore(new FakeStorage());
  const sch = new HintScheduler({ viewState: view.vs, show: (h) => shown.push(h), hide: () => hides++, settings: () => prefs, store, rng }).attach();
  toDispose.push(sch);
  return { ...view, sch, shown, prefs, store, hides: () => hides, at: (t, edit) => { view.push(t, edit); sch.update(); } };
}

test('the first tip comes after 90 s of game time, then one every 150 s', () => {
  const t = timed();
  t.sch.update();
  t.at(60);
  t.at(89);
  assert.equal(t.shown.length, 0);
  t.at(91);
  assert.equal(t.shown.length, 1);
  t.at(100);
  t.at(240);
  assert.equal(t.shown.length, 1);
  t.at(242);
  assert.equal(t.shown.length, 2);
  assert.notEqual(t.shown[0].id, t.shown[1].id, 'a different tip');
  assert.equal(t.store.counts()[t.shown[0].id], 1, 'and the store knows');
});

test('a match joined part-way waits 30 s first; a paused match (a clock that stands still) shows none', () => {
  const t = timed();
  t.at(1000);
  assert.equal(t.shown.length, 0);
  t.at(1029);
  assert.equal(t.shown.length, 0);
  t.at(1031);
  assert.equal(t.shown.length, 1);
  const p = timed();
  for (let i = 0; i < 50; i++) p.sch.update();
  assert.equal(p.shown.length, 0);
});

test('hold() clears the card and keeps tips away for the time asked; an attack on me does the same', () => {
  const t = timed();
  t.at(1);
  t.at(100);
  assert.equal(t.shown.length, 1);
  const before = t.hides();
  t.sch.hold(60); // until 160
  assert.equal(t.hides(), before + 1);
  t.at(260); // the next tip was due at 250, and the hold is long over
  assert.equal(t.shown.length, 2);
  t.sch.hold(200); // until 460
  t.at(420); // the next one was due at 410
  assert.equal(t.shown.length, 2, 'held');
  t.at(461);
  assert.equal(t.shown.length, 3);

  const u = timed();
  u.at(1);
  u.vs.emit('underAttack', { type: 'underAttack', player: 1, x: 1, y: 1, id: 3 });
  u.at(100);
  assert.equal(u.shown.length, 1, 'an attack on somebody else does not hold tips');

  const v = timed();
  v.at(1);
  v.at(85);
  v.vs.emit('underAttack', { type: 'underAttack', player: 0, x: 1, y: 1, id: 3 });
  v.at(95);
  assert.equal(v.shown.length, 0, 'held for 30 s after the attack, though a tip was due at 90');
  v.at(116);
  assert.equal(v.shown.length, 1);
});

test('the hints setting stops the tips and clears the one on show; turned back on, they resume', () => {
  const t = timed({ settings: { hints: false } });
  t.at(1);
  t.at(500);
  assert.equal(t.shown.length, 0);
  assert.ok(t.hides() > 0);
  t.prefs.hints = true;
  t.at(501);
  assert.equal(t.shown.length, 0, 'not at once: the first tip waits 30 s, as in a match joined late');
  t.at(532);
  assert.equal(t.shown.length, 1);

  const u = timed();
  u.at(1);
  u.at(100);
  assert.equal(u.shown.length, 1);
  u.prefs.hints = false;
  u.at(300);
  assert.equal(u.shown.length, 1);
  assert.equal(u.hides() > 0, true, 'the card on show is cleared');
});

test('a spectator, a defeated player and a finished match see no tips', () => {
  const spec = timed({ me: -1 });
  spec.at(1);
  spec.at(500);
  assert.equal(spec.shown.length, 0);
  const lost = timed();
  lost.at(1);
  lost.at(500, (snap) => { snap.players[0].defeated = true; });
  assert.equal(lost.shown.length, 0);
  const over = timed();
  over.at(1);
  over.at(500, (snap) => { snap.gameOver = { winningTeam: 1 }; });
  assert.equal(over.shown.length, 0);
});

test('a tip is told twice at most, across matches; then there is none to show', () => {
  const storage = new FakeStorage();
  const counts = {};
  for (let match = 0; match < 40; match++) {
    const view = viewOf();
    const shown = [];
    const sch = new HintScheduler({ viewState: view.vs, show: (h) => shown.push(h), settings: () => ({ hints: true }), store: hintStore(storage), rng: Math.random });
    for (let t = 1; t < 3000; t += 10) {
      view.push(t);
      sch.update();
    }
    for (const h of shown) counts[h.id] = (counts[h.id] || 0) + 1;
    sch.dispose();
  }
  for (const [id, n] of Object.entries(counts)) assert.ok(n <= 2, `${id} told ${n} times`);
  assert.ok(Object.keys(counts).length >= 15, `${Object.keys(counts).length} different tips over 40 matches`);
});

test('a tip chosen from the match: Worshippers and a Barracks bring up what fits them', () => {
  const t = timed();
  t.at(1);
  t.at(100, (snap) => {
    const town = snap.entities.find((e) => e.k === 'b' && e.o === 0);
    snap.entities.push({ ...town, id: 850, t: 'barracks', tx: 20, ty: 20 });
  });
  const hint = HINTS.find((h) => h.id === t.shown[0].id);
  assert.ok(hint.when, 'a fitting tip, not a general one');
});

// ---------------------------------------------------------------- the card

function makeCard(extra = {}) {
  const root = document.createElement('div');
  const turnedOff = [];
  const view = new HintsView(root, { onTurnOff: () => turnedOff.push(1), ...extra });
  toDispose.push(view);
  return { view, root, turnedOff };
}

test('the card shows a tip with its keys as key caps, and hides again', () => {
  const { view, root } = makeCard();
  assert.equal(view.el.hidden, true);
  view.show({ id: 'space-key', text: 'Press [[Space]] and then [[Shift]] + [[1]].' });
  assert.equal(view.el.hidden, false);
  assert.equal(view.text.textContent, 'Press Space and then Shift + 1.');
  assert.deepEqual(view.text.all('kbd').map((k) => k.textContent), ['Space', 'Shift', '1']);
  assert.equal(view.el.getAttribute('role'), 'status');
  assert.equal(view.el.dataset.hint, 'space-key');
  assert.ok(root.children.includes(view.el));
  view.show({ id: 'zoom', text: 'A second tip replaces the first one.' });
  assert.equal(view.text.textContent, 'A second tip replaces the first one.');
  assert.equal(view.text.all('kbd').length, 0);
  view.hide();
  assert.equal(view.el.hidden, true);
  view.show(null);
  view.show({ id: 'x', text: '' });
  assert.equal(view.el.hidden, true, 'nothing to show');
});

test('a tip is put in the markup as text, never as HTML', () => {
  const { view } = makeCard();
  view.show({ id: 'x', text: '<img src=x onerror=alert(1)> [[<b>]]' });
  assert.equal(view.text.all('img').length, 0);
  assert.equal(view.text.textContent, '<img src=x onerror=alert(1)> <b>');
});

test('the card fades after a few seconds, and stays while the pointer rests on it', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { view } = makeCard();
  view.show({ id: 'zoom', text: 'Short tip, short stay.' }); // 9 s + 60 ms a letter = 10.3 s
  mock.timers.tick(10000);
  assert.equal(view.el.hidden, false);
  assert.equal(view.el.classList.contains('is-leaving'), false);
  mock.timers.tick(400);
  assert.equal(view.el.classList.contains('is-leaving'), true, 'fading');
  mock.timers.tick(500);
  assert.equal(view.el.hidden, true);

  view.show({ id: 'zoom', text: 'Read me slowly, please, with the pointer on the card.' });
  view.el.fire('mouseenter');
  mock.timers.tick(60000);
  assert.equal(view.el.hidden, false, 'held while hovered');
  view.el.fire('mouseleave');
  mock.timers.tick(3900);
  assert.equal(view.el.hidden, false);
  mock.timers.tick(1000);
  mock.timers.tick(500);
  assert.equal(view.el.hidden, true, 'gone a few seconds after the pointer leaves');

  view.show({ id: 'long', text: 'x'.repeat(2000) });
  mock.timers.tick(18000);
  assert.equal(view.el.classList.contains('is-leaving'), true, 'even a very long tip leaves after 18 s');
});

test('✕ closes the card; "Turn tips off" closes it and tells the HUD', () => {
  const { view, turnedOff } = makeCard();
  view.show({ id: 'zoom', text: 'A tip worth closing, I suppose.' });
  view.el.find('hud-hint-close').click();
  assert.equal(view.el.hidden, true);
  assert.equal(turnedOff.length, 0);
  view.show({ id: 'zoom', text: 'A tip worth turning off, I suppose.' });
  view.el.find('hud-hint-off').click();
  assert.equal(view.el.hidden, true);
  assert.deepEqual(turnedOff, [1]);
});

test('the card sits under the getting-started checklist while that is up, in the corner otherwise', () => {
  const checklist = document.createElement('div');
  checklist.offsetTop = 40;
  checklist.offsetHeight = 180;
  let anchor = checklist;
  const { view } = makeCard({ anchor: () => anchor });
  view.show({ id: 'zoom', text: 'Where does this card go? Under the list.' });
  assert.equal(view.el.style.top, 'calc(220px + 0.5em)');
  anchor = null;
  view.show({ id: 'zoom', text: 'Where does this card go? The corner.' });
  assert.equal(view.el.style.top, '');
  checklist.hidden = true;
  anchor = checklist;
  view.show({ id: 'zoom', text: 'Where does this card go? A hidden list is no anchor.' });
  assert.equal(view.el.style.top, '');
});

// ---------------------------------------------------------------- in the HUD

function hudAt(time, { me = 0, session = null } = {}) {
  const view = viewOf({ time, me });
  const game = { viewState: view.vs, selection: new Selection(view.vs), session, input: null, renderer: null, command() {}, sendChat() {} };
  const hud = new Hud({ root: document.createElement('div'), game });
  toDispose.push(hud);
  return { hud, ...view };
}

test('the HUD shows a tip once the match is 90 s old, with a soft chime, and not before', () => {
  const calls = [];
  sfx.play = (name, opts) => {
    calls.push([name, opts]);
    return true;
  };
  try {
    const { hud, push } = hudAt(1);
    hud.update(1000);
    assert.equal(hud.hints.el.hidden, true);
    push(95);
    hud.update(1100);
    assert.equal(hud.hints.el.hidden, false);
    assert.ok(hud.hints.text.textContent.length > 20);
    assert.deepEqual(calls.map((c) => c[0]), ['tip']);
    assert.equal(calls[0][1].volume, 0.6);
    assert.equal(hud.root.children.includes(hud.hints.el), true);
  } finally {
    delete sfx.play;
  }
});

test('the chime follows the alerts setting: silent for warnings only; the tip still shows', () => {
  const calls = [];
  sfx.play = (name) => {
    calls.push(name);
    return true;
  };
  try {
    saveSettings({ alerts: 'important' });
    const { hud, push } = hudAt(1);
    hud.update(900);
    push(95);
    hud.update(1000);
    assert.equal(hud.hints.el.hidden, false);
    assert.deepEqual(calls, []);
  } finally {
    delete sfx.play;
  }
});

test('holdHints clears the card; Turn tips off saves the setting; the setting off keeps the card away', () => {
  const { hud, push } = hudAt(1);
  hud.update(900);
  push(95);
  hud.update(1000);
  assert.equal(hud.hints.el.hidden, false);
  hud.holdHints();
  assert.equal(hud.hints.el.hidden, true);
  push(400);
  hud.update(1100);
  assert.equal(hud.hints.el.hidden, false, 'later, once the hold is over');
  hud.hints.el.find('hud-hint-off').click();
  assert.equal(getSettings().hints, false);
  assert.equal(hud.hints.el.hidden, true);
  push(900);
  hud.update(1200);
  assert.equal(hud.hints.el.hidden, true, 'turned off');
});

test('a HUD for a spectator or a game with a checklist still builds and updates', () => {
  const spec = hudAt(1, { me: -1 });
  spec.push(500);
  spec.hud.update(1000);
  assert.equal(spec.hud.hints.el.hidden, true);
  saveSettings({ tipsDismissed: false });
  try {
    const { hud, push } = hudAt(1);
    hud.update(900);
    push(95);
    hud.update(1000);
    assert.ok(hud.tips, 'the checklist is up');
    assert.equal(hud.hints.el.hidden, false, 'and so is a tip, under it');
  } finally {
    saveSettings({ tipsDismissed: true });
  }
});
