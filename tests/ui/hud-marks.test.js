// Team marks on the HUD (src/ui/hud-marks.js, minimap.js, hud.js): the pins over the battlefield and
// the arrows at its edge, the marker buttons beside the minimap, the minimap's rings and badges and
// its Alt+click / middle-click presses, and the hint line. Fake DOM; a real ViewState where one is needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { TeamMarks } from '../../src/game/team-marks.js';
import { MarksLayer, MarkPalette, teammateCount } from '../../src/ui/hud-marks.js';
import { Minimap } from '../../src/ui/minimap.js';
import { Hud } from '../../src/ui/hud.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { ViewState } from '../../src/game/view-state.js';
import { MARKS, MARK_KINDS } from '../../src/data/marks.js';
import { MAX_NAME_LENGTH } from '../../src/net/protocol.js';
import { saveSettings } from '../../src/settings.js';
import { makeWorld } from '../sim/helpers.js';

before(() => {
  installFakeDom();
  saveSettings({ tipsDismissed: true });
});

const huds = [];
after(() => {
  for (const h of huds) h.dispose();
});

// ---------------------------------------------------------------- the pins

const VIEW = { w: 1280, h: 720, top: 30, bottom: 120 };

/** A layer over a 1280×720 screen (20 px per tile across, 10 down) with a bar of 30 px on top and a console of 120 px below. */
function layerSetup(players) {
  const root = document.createElement('div');
  root.clientWidth = VIEW.w;
  root.clientHeight = VIEW.h;
  const marks = new TeamMarks();
  const centered = [];
  const renderer = {
    worldToScreen: (x, y) => {
      const sx = x * 20;
      const sy = y * 10;
      return { sx, sy, onScreen: sx >= 0 && sx <= VIEW.w && sy >= 0 && sy <= VIEW.h };
    },
    camera: { target: { x: 32, y: 36 }, pitch: Math.PI / 3, centerOn: (x, y) => centered.push([x, y]) },
  };
  const vs = { players: players || [{ name: 'Me', color: '#d63a3a' }, { name: 'Dana', color: '#3a8fd6' }], setup: null };
  const layer = new MarksLayer({ root, marks, viewState: vs, getRenderer: () => renderer, getInsets: () => ({ top: VIEW.top, bottom: VIEW.bottom }) });
  const items = () => layer.layer.findAll('hud-mark');
  const at = (item) => {
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(item.style.transform);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  };
  return { root, marks, renderer, layer, centered, vs, items, at };
}

test('a mark in view stands over its spot with the sender’s name, the icon, and their colours', () => {
  const { marks, layer, items, at } = layerSetup();
  marks.add({ from: 1, kind: 'attack', x: 30, y: 20 }, 0);
  layer.update(100);
  const [pin] = items();
  assert.ok(pin.className.split(' ').includes('is-attack'));
  assert.deepEqual(at(pin), { x: 600, y: 200 });
  assert.equal(pin.classList.contains('is-edge'), false);
  assert.equal(pin.find('hud-mark-who').textContent, 'Dana');
  assert.equal(pin.find('hud-mark-chip').textContent, MARKS.attack.icon);
  assert.equal(pin.title, 'Dana: Attack here! Click to go there.');
  assert.equal(pin.style.getPropertyValue('--c'), '#3a8fd6', 'the ring wears the sender’s colour');
  assert.equal(pin.style.getPropertyValue('--k'), MARKS.attack.color, 'the badge wears the kind’s');
  layer.update(200);
  assert.equal(items().length, 1, 'one element per mark, moved rather than rebuilt');
  assert.equal(items()[0], pin);
});

test('a pin follows the camera: the same mark lands elsewhere when the view moves', () => {
  const { marks, layer, renderer, items, at } = layerSetup();
  marks.add({ from: 1, kind: 'ping', x: 30, y: 20 }, 0);
  layer.update(100);
  assert.deepEqual(at(items()[0]), { x: 600, y: 200 });
  const was = renderer.worldToScreen;
  renderer.worldToScreen = (x, y) => was(x - 10, y + 5);
  layer.update(200);
  assert.deepEqual(at(items()[0]), { x: 400, y: 250 });
});

test('a mark out of view becomes an arrow on the edge of the play area, and a click takes the camera there', () => {
  const { marks, layer, centered, items, at } = layerSetup();
  marks.add({ from: 1, kind: 'help', x: 100, y: 36 }, 0); // far to the right, level with the middle of the screen
  layer.update(100);
  const [pin] = items();
  assert.equal(pin.classList.contains('is-edge'), true);
  const p = at(pin);
  const area = layer.playArea(100);
  assert.ok(p.x > VIEW.w - 80 && p.x < VIEW.w, `at the right edge, inside the screen (${p.x})`);
  assert.ok(p.y > area.top && p.y < area.bottom, 'not under a panel');
  assert.match(pin.find('hud-mark-arrow').style.transform, /^rotate\(-?[\d.]+rad\) translateX\([\d.]+em\)$/);
  assert.ok(Math.abs(Number(/rotate\((-?[\d.]+)rad/.exec(pin.find('hud-mark-arrow').style.transform)[1])) < 0.35, 'pointing right');
  pin.fire('click');
  assert.deepEqual(centered, [[100, 36]]);
});

test('the panels at the top and bottom count as out of view: a mark under the console gets an arrow above it', () => {
  const { marks, layer, items, at } = layerSetup();
  marks.add({ from: 1, kind: 'defend', x: 32, y: 66 }, 0); // on the screen (y 660), but under the 120 px console
  marks.add({ from: 1, kind: 'gather', x: 32, y: 1 }, 0); // under the 30 px top bar
  layer.update(100);
  const [below, above] = items();
  const area = layer.playArea(100);
  assert.equal(below.classList.contains('is-edge'), true);
  assert.equal(above.classList.contains('is-edge'), true);
  assert.ok(at(below).y <= area.bottom && at(below).y > area.bottom - 60, `just above the console (${at(below).y})`);
  assert.ok(at(above).y >= area.top && at(above).y < area.top + 60, `just under the top bar (${at(above).y})`);
  assert.match(below.find('hud-mark-arrow').style.transform, /rotate\(1\.5\d?rad\)/, 'pointing down');
  assert.match(above.find('hud-mark-arrow').style.transform, /rotate\(-1\.5\d?rad\)/, 'pointing up');
});

test('a spot behind the camera points by where it lies on the ground, not by its mirrored projection', () => {
  const { marks, layer, renderer, items, at } = layerSetup();
  renderer.worldToScreen = () => ({ sx: 640, sy: 700, onScreen: false }); // mirrored: it would point down
  marks.add({ from: 1, kind: 'ping', x: 32, y: 2 }, 0); // north of the camera target (32, 36)
  layer.update(100);
  const [pin] = items();
  assert.equal(pin.classList.contains('is-edge'), true);
  assert.ok(at(pin).y < 100, `the arrow is at the top (${at(pin).y})`);
});

test('a mark that has run out takes its element with it; a pin fades over its last moments', () => {
  const { marks, layer, items } = layerSetup();
  marks.add({ from: 1, kind: 'ping', x: 30, y: 20 }, 0);
  layer.update(1000);
  assert.equal(items()[0].style.opacity, '', 'solid while it stands');
  layer.update(MARKS.ping.life * 1000 - 400);
  assert.equal(items()[0].style.opacity, '0.5', 'half faded 400 ms before the end');
  layer.update(MARKS.ping.life * 1000);
  assert.equal(items().length, 0);
  assert.equal(layer.items.size, 0);
});

test('the sender’s name and colour come from the network and are cleaned before they reach the page', () => {
  const players = [
    { name: 'Me', color: '#d63a3a' },
    { name: `<img src=x onerror=alert(1)>‮\u0007${'x'.repeat(80)}`, color: 'red; background: url(//evil.example/x)' },
  ];
  const { marks, layer, items } = layerSetup(players);
  marks.add({ from: 1, kind: 'ping', x: 30, y: 20 }, 0);
  marks.add({ from: 7, kind: 'ping', x: 31, y: 20 }, 0); // a sender nobody knows
  layer.update(100);
  const [pin, stranger] = items();
  const who = pin.find('hud-mark-who');
  assert.equal(who.children.length, 0, 'text only');
  assert.ok(who.textContent.length <= MAX_NAME_LENGTH);
  assert.ok(!/[\u0000-\u001f‮]/.test(who.textContent));
  assert.equal(pin.style.getPropertyValue('--c'), '#f1e8d4', 'a colour that is not #rrggbb falls back');
  assert.equal(stranger.find('hud-mark-who').textContent, 'Teammate');
});

test('without a renderer yet the layer waits, and disposing it takes the pins off the page', () => {
  const root = document.createElement('div');
  const marks = new TeamMarks();
  let renderer = null;
  const layer = new MarksLayer({ root, marks, viewState: { players: [{ name: 'A' }, { name: 'B' }] }, getRenderer: () => renderer });
  marks.add({ from: 1, kind: 'ping', x: 1, y: 1 }, 0);
  layer.update(10);
  assert.equal(layer.layer.findAll('hud-mark').length, 0);
  renderer = { worldToScreen: () => ({ sx: 50, sy: 50, onScreen: true }), camera: { target: { x: 0, y: 0 }, pitch: 1, centerOn() {} } };
  layer.update(20);
  assert.equal(layer.layer.findAll('hud-mark').length, 1);
  assert.equal(root.find('hud-marks'), layer.layer);
  layer.dispose();
  assert.equal(root.find('hud-marks'), null);
  assert.equal(layer.items.size, 0);
});

// ---------------------------------------------------------------- the marker buttons

test('the marker buttons: one per kind in order, each picks its kind, and the armed one is lit', () => {
  const picked = [];
  const pad = new MarkPalette({ onPick: (k) => picked.push(k) });
  const buttons = pad.root.children;
  assert.deepEqual(buttons.map((b) => b.className.split(' ')[1]), MARK_KINDS.map((k) => `is-${k}`));
  assert.deepEqual(buttons.map((b) => b.textContent), MARK_KINDS.map((k) => MARKS[k].icon));
  for (const b of buttons) b.fire('click');
  assert.deepEqual(picked, MARK_KINDS);
  pad.setArmed('help');
  assert.deepEqual(buttons.filter((b) => b.classList.contains('is-armed')).map((b) => b.className.split(' ')[1]), ['is-help']);
  pad.setArmed('attack');
  assert.equal(buttons.filter((b) => b.classList.contains('is-armed')).length, 1);
  pad.setArmed(null);
  assert.equal(buttons.filter((b) => b.classList.contains('is-armed')).length, 0);
});

test('the tooltips say what the button does and who will see it', () => {
  const pad = new MarkPalette({ onPick() {} });
  const tip = (kind) => pad.buttons.get(kind).title;
  assert.match(tip('attack'), /Attack here!/);
  assert.match(tip('ping'), /Alt\+click or middle-click/);
  assert.match(tip('attack'), /no teammates in this match, so only you see it/);
  pad.setTeammates(1);
  assert.match(tip('help'), /Only your teammate sees it/);
  pad.setTeammates(3);
  assert.match(tip('help'), /Only your 3 teammates see it/);
  assert.match(tip('defend'), /Esc cancels/);
});

test('teammates are the other people on my team: computers have no screen, other teams are not counted', () => {
  const setup = (kinds) => ({ myIndex: 0, myTeam: 1, setup: { players: kinds.map(([team, kind]) => ({ team, kind })) } });
  assert.equal(teammateCount(setup([[1, 'human'], [1, 'human'], [1, 'ai'], [2, 'human'], [2, 'ai']])), 1);
  assert.equal(teammateCount(setup([[1, 'human'], [2, 'human']])), 0);
  assert.equal(teammateCount(setup([[1, 'human'], [1, 'human'], [1, 'human']])), 2);
  assert.equal(teammateCount({ myIndex: 0, myTeam: 1, players: [{ team: 1 }, { team: 1 }] }), 1, 'a snapshot’s players do when the setup is not there');
  assert.equal(teammateCount({ myIndex: 0, myTeam: 1 }), 0);
});

// ---------------------------------------------------------------- the minimap

/** A minimap over a small world whose 2D context records what it is asked to draw. */
function minimapSetup(marks) {
  const world = makeWorld();
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  const canvas = document.createElement('canvas');
  canvas.isConnected = true;
  const ctx = canvas.getContext('2d');
  const log = [];
  for (const m of ['arc', 'fillText', 'stroke']) {
    const real = ctx[m];
    ctx[m] = (...a) => {
      log.push([m, ...a]);
      return real.apply(ctx, a);
    };
  }
  const events = [];
  const handlers = {};
  globalThis.window.addEventListener = (type, fn) => (handlers[type] = handlers[type] || []).push(fn);
  const minimap = new Minimap({ canvas, viewState: vs, getCamera: () => null, onPointer: (info) => events.push(info), marks });
  const count = (name) => log.filter((c) => c[0] === name).length;
  return { minimap, canvas, vs, log, count, events, handlers, world };
}

test('the minimap draws a mark as rings and a badge with the icon, until it runs out', () => {
  const marks = new TeamMarks();
  const { minimap, count, log } = minimapSetup(marks);
  minimap.update(1000);
  assert.equal(count('fillText'), 0, 'nothing marked: no badges');
  marks.add({ from: 1, kind: 'attack', x: 10, y: 12 }, 1000);
  minimap.update(1100);
  assert.equal(count('fillText'), 1);
  const [, icon, x, y] = log.find((c) => c[0] === 'fillText');
  assert.equal(icon, MARKS.attack.icon);
  assert.ok(x > 0 && x < 150 && y > 0 && y < 150, 'on the map');
  minimap.update(1116);
  assert.equal(count('fillText'), 2, 'it animates, so it redraws every frame while up');
  minimap.update(1000 + MARKS.attack.life * 1000 + 50);
  const drawn = count('fillText');
  minimap.update(1000 + MARKS.attack.life * 1000 + 70);
  assert.equal(count('fillText'), drawn, 'a finished mark is not drawn');
  assert.equal(minimap.marksShown, false);
});

test('a mark at the very edge of the map keeps its badge inside the minimap', () => {
  const marks = new TeamMarks();
  const { minimap, log } = minimapSetup(marks);
  marks.add({ from: 1, kind: 'help', x: 0, y: 0 }, 0);
  marks.add({ from: 1, kind: 'gather', x: 47.99, y: 47.99 }, 0);
  minimap.update(100);
  for (const [, , x, y] of log.filter((c) => c[0] === 'fillText')) {
    assert.ok(x >= 0 && x <= 150 && y >= 0 && y <= 150, `(${x}, ${y})`);
  }
});

test('Alt+click and the middle button are single presses (no drag follows); the left and right buttons work as before', () => {
  const { canvas, events, handlers } = minimapSetup(new TeamMarks());
  const press = (button, extra = {}) => canvas.fire('mousedown', { button, clientX: 75, clientY: 30, shiftKey: false, ctrlKey: false, altKey: false, ...extra });
  const move = () => (handlers.mousemove || []).forEach((fn) => fn({ clientX: 80, clientY: 35, shiftKey: false }));
  const release = (button) => (handlers.mouseup || []).forEach((fn) => fn({ button, clientX: 80, clientY: 35, shiftKey: false }));
  const phases = () => events.splice(0).map((e) => `${e.button}${e.phase}${e.alt ? '+alt' : ''}`);

  press(0, { altKey: true });
  move();
  release(0);
  assert.deepEqual(phases(), ['0down+alt'], 'Alt+click: only the press');
  press(1);
  move();
  release(1);
  assert.deepEqual(phases(), ['1down'], 'middle: only the press');
  press(0);
  move();
  release(0);
  assert.deepEqual(phases(), ['0down', '0drag', '0up'], 'left: press, drag, release');
  press(2);
  release(2);
  assert.deepEqual(phases(), ['2down', '2up']);
  const spot = (press(0, { altKey: true }), events[0]);
  assert.ok(spot.x > 0 && spot.x < 48 && spot.y > 0 && spot.y < 48, 'in tile coordinates');
});

// ---------------------------------------------------------------- inside the HUD

/** A HUD for a game of three: me, a teammate (a person or a computer) and a rival. */
function hudSetup({ teammateIsHuman = false } = {}) {
  const world = makeWorld({ players: 3, teams: [1, 1, 2] });
  if (teammateIsHuman) world.setup.players[1].kind = 'human';
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  vs.pushSnapshot(world.getSnapshot(), 50);
  const marks = new TeamMarks();
  const armed = [];
  const input = { mode: { kind: 'normal' }, cardMode: () => 'root', armMark: (k) => armed.push(k) };
  const game = { viewState: vs, selection: new Selection(vs), session: null, input, renderer: null, marks, command() {}, sendChat() {} };
  const root = document.createElement('div');
  const hud = new Hud({ root, game });
  huds.push(hud);
  let now = 1000;
  const tick = () => hud.update((now += 500));
  const lines = () => hud.msgs.children.map((c) => c.textContent);
  return { hud, vs, game, input, marks, armed, root, tick, lines };
}

test('the marker buttons stand beside the minimap and press through to the input controller', () => {
  const { hud, armed } = hudSetup();
  const mini = hud.bottom.find('hud-bottom-mini');
  assert.ok(mini.find('hud-minimap'));
  const pad = mini.find('hud-markpad');
  assert.equal(pad, hud.markpad.root);
  assert.equal(pad.children.length, MARK_KINDS.length);
  pad.children[1].fire('click');
  pad.children[0].fire('click');
  assert.deepEqual(armed, [MARK_KINDS[1], MARK_KINDS[0]]);
  let prevented = 0;
  hud.bottom.fire('mousedown', { target: pad.children[0], preventDefault: () => prevented++ });
  assert.equal(prevented, 1, 'a click on the buttons does not reach the map behind');
});

test('the lit button follows the input mode: only an armed marker lights one', () => {
  const { hud, input, tick } = hudSetup();
  const lit = () => hud.markpad.root.children.filter((b) => b.classList.contains('is-armed')).map((b) => b.className.split(' ')[1]);
  tick();
  assert.deepEqual(lit(), []);
  input.mode = { kind: 'target', order: 'mark', mark: 'defend', target: 'point' };
  tick();
  assert.deepEqual(lit(), ['is-defend']);
  input.mode = { kind: 'target', order: 'attack', target: 'point' };
  tick();
  assert.deepEqual(lit(), [], 'attack-move is not a marker');
  input.mode = { kind: 'normal' };
  tick();
  assert.deepEqual(lit(), []);
});

test('the minimap and the pins read the game’s marks, and a mark makes a pin once there is a renderer', () => {
  const { hud, game, marks, root, tick } = hudSetup();
  assert.equal(hud.minimap.marks, marks);
  marks.add({ from: 1, kind: 'attack', x: 10, y: 10 }, performance.now());
  tick();
  assert.equal(root.findAll('hud-mark').length, 0, 'no renderer, no pins yet');
  game.renderer = { worldToScreen: () => ({ sx: 300, sy: 200, onScreen: true }), camera: { target: { x: 0, y: 0 }, pitch: 1, centerOn() {} } };
  tick();
  assert.equal(root.findAll('hud-mark').length, 1);
  hud.dispose();
  assert.equal(root.find('hud-marks'), null, 'taken down with the HUD');
});

test('the hint line comes once, when the match has a teammate to ping', () => {
  const alone = hudSetup();
  alone.tick();
  assert.ok(!alone.lines().some((l) => /Team ping/.test(l)), 'a computer teammate cannot see a ping');
  const together = hudSetup({ teammateIsHuman: true });
  together.tick();
  together.tick();
  const hint = together.lines().filter((l) => /Team ping/.test(l));
  assert.equal(hint.length, 1);
  assert.match(hint[0], /Alt\+click or middle-click/);
});
