// The selection panel with the Worshipper upgrade lines: a Worshipper's health bar and
// "Work" stat, the Town Center's list of researched levels, and the gold mine's rule line
// quoting the viewer's own mining trip. Real World + ViewState, a tiny fake DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ViewState } from '../../src/game/view-state.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { InfoView } from '../../src/ui/hud-info.js';
import { MORTALS } from '../../src/data/index.js';
import { makeWorld, spawn } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(installFakeDom);

let clock = 0;

function panel(world, me = 0) {
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: me });
  const push = () => vs.pushSnapshot(world.getSnapshot(), (clock += 50));
  push();
  const sel = new Selection(vs);
  const root = document.createElement('div');
  const view = new InfoView(root, { selection: sel, viewState: vs, onSelectOnly() {}, onRemove() {}, onSelectType() {}, onCancelQueue() {}, onPortrait() {} });
  const read = () => {
    push();
    view.update();
    const text = (cls) => (root.find(cls) ? root.find(cls).textContent : null);
    return {
      hp: text('hi-hp-text'),
      stats: root.findAll('hi-stat').map((n) => n.textContent),
      notes: root.findAll('hi-note').map((n) => n.textContent),
    };
  };
  return { sel, read };
}

const worker = (world, p = 0) => world.unitsOf(p).find((u) => u.type === 'worshipper');

test('a Worshipper shows its Work stat and boosted health', () => {
  const world = makeWorld();
  const { sel, read } = panel(world);
  sel.set([worker(world).id]);
  let r = read();
  assert.equal(r.hp, `${MORTALS.worshipper.hp} / ${MORTALS.worshipper.hp}`);
  assert.ok(r.stats.some((t) => /Work\s*Normal$/.test(t)), r.stats.join(' | '));
  world.completeResearch(0, 'tc_work_songs');
  world.completeResearch(0, 'tc_hearty_meals');
  r = read();
  assert.equal(r.hp, `${Math.round(MORTALS.worshipper.hp * 1.2)} / ${Math.round(MORTALS.worshipper.hp * 1.2)}`);
  assert.ok(r.stats.some((t) => /Work\s*\+15%$/.test(t)), r.stats.join(' | '));
  assert.equal(r.stats.filter((t) => /Work/.test(t)).length, 1);
});

test('soldiers have no Work stat', () => {
  const world = makeWorld();
  const warrior = spawn(world, 0, 'warrior', 20, 20);
  const { sel, read } = panel(world);
  sel.set([warrior.id]);
  assert.ok(!read().stats.some((t) => /Work/.test(t)));
});

test('the Town Center lists only the top level of each line it has researched', () => {
  const world = makeWorld();
  const { sel, read } = panel(world);
  const tc = world.buildingsOf(0).find((b) => b.type === 'town_center');
  sel.set([tc.id]);
  for (const id of ['tc_iron_picks', 'tc_work_songs', 'tc_master_craftsmen', 'tc_hearty_meals']) world.completeResearch(0, id);
  const line = read().notes.find((t) => t.startsWith('Upgrades:'));
  assert.equal(line, 'Upgrades: ⛏️ Iron Picks, ⚒️ Master Craftsmen, 🍲 Hearty Meals');
});

test('the Gold Mine quotes the viewer\'s own mining trip', () => {
  const world = makeWorld();
  const { sel, read } = panel(world);
  sel.set([world.mineList[0].id]);
  const rule = () => read().notes.find((t) => t.startsWith('Up to'));
  assert.equal(rule(), 'Up to 2 Worshippers mine at once, 1.5 s per 10 gold; the others wait their turn.');
  for (const id of ['tc_work_songs', 'tc_master_craftsmen', 'tc_tireless_devotion', 'tc_iron_picks']) world.completeResearch(0, id);
  assert.equal(rule(), 'Up to 2 Worshippers mine at once, 1 s per 12 gold; the others wait their turn.');
});
