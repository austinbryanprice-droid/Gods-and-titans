// Fog of war in the client UI: snapshots carry the whole world (DESIGN 7), so
// the selection, the info panel, picking, orders and messages must only use
// what the local player knows. A remembered (fogged) enemy building shows its
// remembered state, stays selected after it is destroyed out of sight, and an
// attack order on its ghost still does something; a fogged gold mine shows its
// gold as last seen; only explored mines announce their collapse; trees felled
// in the fog still stand on the minimap, for the placement ghost and for tree
// orders until seen. Real World + ViewState, a tiny fake DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ViewState } from '../../src/game/view-state.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { InfoView } from '../../src/ui/hud-info.js';
import { InputController } from '../../src/ui/input.js';
import { Game } from '../../src/game/game.js';
import { MINE_SLOTS, TERRAIN } from '../../src/config.js';
import { Minimap } from '../../src/ui/minimap.js';
import { checkPlacement } from '../../src/game/placement.js';
import { makeWorld, spawn } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(installFakeDom);

// ---------------------------------------------------------------- helpers

let clock = 0;
const push = (world, vs) => vs.pushSnapshot(world.getSnapshot(), (clock += 50));
const tcOf = (world, p) => world.buildingsOf(p).find((b) => b.type === 'town_center');

/** Player 0's view with a scout of mine standing next to the enemy Town Center. */
function scouted() {
  const world = makeWorld();
  const tc = tcOf(world, 1);
  const scout = spawn(world, 0, 'worshipper', tc.x - 4, tc.y + 3);
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  push(world, vs);
  assert.ok(vs.isEntityVisible(vs.entities.get(tc.id)), 'the scout sees the enemy Town Center');
  const leave = () => {
    const home = tcOf(world, 0);
    scout.x = home.x + 3;
    scout.y = home.y + 3;
    push(world, vs);
    assert.equal(vs.isEntityVisible(vs.entities.get(tc.id)), false, 'the Town Center is in the fog now');
  };
  const comeBack = () => {
    scout.x = tc.x - 4;
    scout.y = tc.y + 3;
    push(world, vs);
  };
  return { world, vs, tc, scout, leave, comeBack };
}

function infoPanel(vs, sel) {
  const root = document.createElement('div');
  const view = new InfoView(root, { selection: sel, viewState: vs, onSelectOnly() {}, onRemove() {}, onSelectType() {}, onCancelQueue() {}, onPortrait() {} });
  const read = () => {
    view.update();
    const t = (cls) => (root.find(cls) ? root.find(cls).textContent : null);
    return { hp: t('hi-hp-text'), name: t('hi-name'), sub: t('hi-sub'), stats: root.findAll('hi-stat-v').map((n) => n.textContent), note: t('hi-note') };
  };
  return read;
}

// ---------------------------------------------------------------- tests

test('knownEntity: live while seen, the remembered copy in the fog, null for unseen units', () => {
  const { world, vs, tc, leave } = scouted();
  assert.equal(vs.knownEntity(tc.id), vs.entities.get(tc.id));
  const enemyWorker = world.unitsOf(1)[0];
  leave();
  assert.equal(vs.knownEntity(tc.id), vs.lastSeen.get(tc.id));
  assert.notEqual(vs.knownEntity(tc.id), vs.entities.get(tc.id));
  assert.equal(vs.knownEntity(enemyWorker.id), null, 'an enemy unit in the fog is unknown');
  const own = world.unitsOf(0)[0];
  assert.equal(vs.knownEntity(own.id), vs.entities.get(own.id));
});

test('a selected enemy building in the fog shows its remembered hp, tier and name', () => {
  const { world, vs, tc, leave, comeBack } = scouted();
  const sel = new Selection(vs);
  const read = infoPanel(vs, sel);
  sel.set([tc.id]);
  const seen = read();
  assert.equal(seen.hp, `${tc.maxHp.toLocaleString('en-US')} / ${tc.maxHp.toLocaleString('en-US')}`);
  leave();
  // Out of sight it is damaged and grows into a Town.
  tc.hp = Math.round(tc.maxHp * 0.3);
  tc.tier = 2;
  push(world, vs);
  sel.prune();
  assert.deepEqual(sel.ids, [tc.id], 'still selected');
  const fogged = read();
  assert.deepEqual(fogged, seen, 'nothing about it changed for me');
  // Seen again: the panel catches up.
  comeBack();
  sel.prune();
  const again = read();
  assert.equal(again.hp, `${Math.ceil(tc.hp).toLocaleString('en-US')} / ${tc.maxHp.toLocaleString('en-US')}`);
  assert.notEqual(again.name, seen.name, 'the new tier name shows once seen');
});

test('an enemy building destroyed in the fog stays selected until its spot is seen again', () => {
  const { world, vs, tc, leave, comeBack } = scouted();
  const sel = new Selection(vs);
  const read = infoPanel(vs, sel);
  sel.set([tc.id]);
  leave();
  const before = read();
  world.killEntity(tc, null);
  push(world, vs);
  assert.equal(vs.entities.has(tc.id), false);
  sel.prune();
  assert.deepEqual(sel.ids, [tc.id], 'the selection does not tell me it died');
  assert.deepEqual(read(), before);
  // A fresh click on the ghost selects it too.
  sel.clear();
  sel.set([tc.id]);
  assert.deepEqual(sel.ids, [tc.id]);
  comeBack();
  sel.prune();
  assert.deepEqual(sel.ids, [], 'seen gone: dropped');
});

/** An InputController over a fake renderer that "picks" a fixed id. */
function controller(vs, sel, pickId) {
  const sent = [];
  const renderer = {
    pickEntity: () => pickId(),
    screenToWorld: (x, y) => ({ x, y }),
    showCommandMarker() {},
    hidePlacement() {},
    showPlacement() {},
    setSelection() {},
    setHover() {},
    camera: { centerOn() {} },
  };
  const hud = { message() {}, refreshCard() {}, overlays: { open: false }, chatOpen: false };
  const game = { viewState: vs, selection: sel, renderer, hud, command: (c) => sent.push(c), setShowAllBars() {} };
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 720 });
  const input = new InputController({ game, canvas, overlayRoot: document.createElement('div') });
  return { input, sent };
}

test('picking a fogged enemy building gives its remembered copy; A-click on its ghost still moves the army', () => {
  const { world, vs, tc, leave } = scouted();
  const sel = new Selection(vs);
  const army = world.unitsOf(0).filter((u) => u.type === 'worshipper').map((u) => u.id);
  sel.set(army);
  const { input, sent } = controller(vs, sel, () => tc.id);
  leave();
  assert.equal(input.pick(10, 10), vs.lastSeen.get(tc.id));
  world.killEntity(tc, null);
  push(world, vs);
  assert.equal(input.pick(10, 10), vs.lastSeen.get(tc.id), 'the ghost of a building destroyed in the fog is still pickable');
  input.setMode({ kind: 'target', order: 'attack' });
  input.confirmTarget(10, 10, null, false);
  assert.equal(sent.length, 1);
  const cmd = sent[0];
  // 'attack' on a dead target does nothing in the sim; a smart order with the ghost's spot walks there.
  assert.equal(cmd.type, 'smart');
  assert.equal(cmd.target, tc.id);
  assert.ok(Math.hypot(cmd.x - tc.x, cmd.y - tc.y) < 0.01, JSON.stringify(cmd));
  // the sim takes it as a move to the ghost (the target is gone)
  world.issueCommand(0, cmd);
  world.tick();
  const u = world.entities.get(army[0]);
  assert.equal(u.order && u.order.type, 'move');
  input.dispose();
});

test('A-click on a visible enemy building is still a plain attack order', () => {
  const { world, vs, tc } = scouted();
  const sel = new Selection(vs);
  sel.set(world.unitsOf(0).map((u) => u.id));
  const { input, sent } = controller(vs, sel, () => tc.id);
  input.setMode({ kind: 'target', order: 'attack' });
  input.confirmTarget(10, 10, null, false);
  assert.deepEqual(sent.map((c) => [c.type, c.target]), [['attack', tc.id]]);
  input.dispose();
});

/** The gold mine nearest to player p's Town Center. */
function mineNear(world, p) {
  const tc = tcOf(world, p);
  return [...world.mineList].sort((a, b) => Math.hypot(a.x - tc.x, a.y - tc.y) - Math.hypot(b.x - tc.x, b.y - tc.y))[0];
}

test('a fogged gold mine shows its gold as last seen and no miner count; seen again it is live', () => {
  const world = makeWorld();
  const mine = mineNear(world, 1);
  const scout = spawn(world, 0, 'worshipper', mine.x, mine.y + 3);
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  push(world, vs);
  assert.ok(vs.mineInSight(vs.entities.get(mine.id)));
  const sel = new Selection(vs);
  const read = infoPanel(vs, sel);
  sel.set([mine.id]);
  const seenAmt = mine.amount;
  assert.deepEqual(read().stats, [seenAmt.toLocaleString('en-US'), `0/${MINE_SLOTS}`]);
  // My scout leaves; the enemy mines it out of my sight.
  scout.x = 8;
  scout.y = 14;
  push(world, vs);
  const view = vs.entities.get(mine.id);
  assert.equal(vs.mineInSight(view), false);
  assert.ok(vs.isEntityVisible(view), 'explored mines stay drawn and selectable');
  world.issueCommand(1, { type: 'gather', units: world.unitsOf(1).map((u) => u.id), target: mine.id });
  for (let i = 0; i < 20 * 40; i++) {
    world.tick();
    if (i % 4 === 0) push(world, vs);
  }
  push(world, vs);
  sel.prune();
  assert.deepEqual(sel.ids, [mine.id]);
  assert.ok(mine.amount < seenAmt, `the enemy mined (${mine.amount})`);
  assert.ok(vs.entities.get(mine.id).mn > 0, 'and is mining right now');
  const fogged = read();
  assert.deepEqual(fogged.stats, [seenAmt.toLocaleString('en-US'), '?'], 'as last seen, miners unknown');
  assert.match(fogged.note, /last seen/);
  assert.equal(vs.mineGold(vs.entities.get(mine.id)), seenAmt);
  // Seen again: live numbers.
  scout.x = mine.x;
  scout.y = mine.y + 3;
  push(world, vs);
  const again = read();
  assert.equal(again.stats[0], mine.amount.toLocaleString('en-US'));
  assert.notEqual(again.stats[1], '?');
});

test('a never-seen mine starts at the map\'s starting gold, not its live amount', () => {
  const world = makeWorld();
  const mine = mineNear(world, 1);
  const start = mine.amount;
  mine.amount -= 500; // mined before my first snapshot arrived
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  push(world, vs);
  assert.equal(vs.mineGold(vs.entities.get(mine.id)), start);
});

test('"A gold mine has collapsed." only for mines I have explored', () => {
  const world = makeWorld();
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  const messages = [];
  const game = { disposed: false, viewState: vs, hud: { message: (text) => messages.push(text) } };
  vs.on('*', (ev) => Game.prototype.onEvent.call(game, ev));
  push(world, vs);
  const theirs = mineNear(world, 1);
  const mine = mineNear(world, 0);
  assert.equal(vs.isExplored(theirs.x, theirs.y), false);
  assert.equal(vs.isExplored(mine.x, mine.y), true);
  world.depleteMine(theirs);
  push(world, vs);
  assert.equal(vs.entities.has(theirs.id), false, 'it collapsed');
  assert.deepEqual(messages, [], 'no word of a mine I never saw');
  world.depleteMine(mine);
  push(world, vs);
  assert.deepEqual(messages, ['A gold mine has collapsed.']);
});

test('trees felled in the fog still stand for me (minimap, placement, tree orders) until I see the spot', () => {
  const world = makeWorld({ map: { forest: [{ x: 30, y: 20, w: 4, h: 4 }] } });
  const scout = spawn(world, 0, 'worshipper', 31.5, 26.5);
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  push(world, vs);
  const tiles = [];
  for (let ty = 20; ty < 24; ty++) for (let tx = 30; tx < 34; tx++) tiles.push([tx, ty]);
  assert.ok(tiles.every(([tx, ty]) => vs.isVisibleAt(tx + 0.5, ty + 0.5)), 'the scout sees the grove');
  const canvas = document.createElement('canvas');
  canvas.isConnected = true;
  const mm = new Minimap({ canvas, viewState: vs });
  const pixel = ([tx, ty]) => {
    const d = mm.terrain.image.data;
    const i = (ty * vs.width + tx) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  };
  const forestPx = tiles.map(pixel);
  // The scout leaves; the whole grove is cut down out of my sight.
  scout.x = 8;
  scout.y = 14;
  push(world, vs);
  const v0 = vs.seenVersion;
  for (const [tx, ty] of tiles) {
    world.map.takeWood(tx, ty, 100000);
    world.onTreeFelled(tx, ty);
  }
  push(world, vs);
  assert.ok(tiles.every(([tx, ty]) => vs.map.terrain[ty * vs.width + tx] === TERRAIN.GRASS), 'the map knows (for the sim mirror)');
  assert.ok(tiles.every(([tx, ty]) => vs.seenTerrain[ty * vs.width + tx] === TERRAIN.FOREST), 'but I still see forest');
  assert.equal(vs.seenVersion, v0);
  assert.equal(mm.terrainVersion, vs.seenVersion, 'no minimap repaint due');
  mm.paintTerrain();
  assert.deepEqual(tiles.map(pixel), forestPx, 'the minimap still shows the grove');
  assert.equal(checkPlacement(vs, 0, 'house', 31, 21).valid, false, 'the ghost stays red on it');
  const { input } = controller(vs, new Selection(vs), () => null);
  assert.deepEqual(input.treeNear(31.5, 21.5), { tx: 31, ty: 21 }, 'a gather order there is not refused');
  input.dispose();
  // Seen again: the clearing shows.
  scout.x = 31.5;
  scout.y = 26.5;
  push(world, vs);
  assert.ok(vs.seenVersion > v0);
  assert.ok(tiles.every(([tx, ty]) => vs.seenTerrain[ty * vs.width + tx] === TERRAIN.GRASS));
  assert.notEqual(mm.terrainVersion, vs.seenVersion, 'a minimap repaint is due');
  mm.paintTerrain();
  assert.notDeepEqual(tiles.map(pixel), forestPx, 'repainted as grass');
  assert.equal(checkPlacement(vs, 0, 'house', 31, 21).valid, true);
  mm.dispose();
});

test('trees felled in sight fall at once; a resync\'s felledAll at once too (as the 3D view does)', () => {
  const world = makeWorld({ map: { forest: [{ x: 6, y: 14, w: 1, h: 1 }, { x: 40, y: 20, w: 1, h: 1 }] } });
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  push(world, vs);
  const i = (tx, ty) => ty * vs.width + tx;
  assert.ok(vs.isVisibleAt(6.5, 14.5));
  world.map.takeWood(6, 14, 100000);
  world.onTreeFelled(6, 14);
  push(world, vs);
  assert.equal(vs.seenTerrain[i(6, 14)], TERRAIN.GRASS);
  vs.pushSnapshot(world.getSnapshot(), (clock += 50), { felledAll: [[40, 20]] });
  assert.equal(vs.seenTerrain[i(40, 20)], TERRAIN.GRASS);
  assert.equal(vs.unseenFells.size, 0);
});
