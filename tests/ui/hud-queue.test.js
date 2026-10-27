// The queue row of the selection panel (src/ui/hud-info.js) with up to MAX_QUEUE (50) items: repeats of one
// unit are one button with a count, the rows past QUEUE_CHIPS fold into "+N", a click takes one back and a
// Shift-click a whole run; the Hud turns the clicks into cancelTrain commands the sim refunds.
// Real World + ViewState + Hud, fake DOM.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../../src/ui/hud.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { queueRuns, QUEUE_CHIPS } from '../../src/ui/hud-info.js';
import { ViewState } from '../../src/game/view-state.js';
import { saveSettings } from '../../src/settings.js';
import { MAX_QUEUE, POP_MAX } from '../../src/config.js';
import { MORTALS } from '../../src/data/index.js';
import { makeWorld, place } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(() => {
  installFakeDom();
  saveSettings({ tipsDismissed: true });
});

const huds = [];
after(() => {
  for (const h of huds) h.dispose();
});

let clock = 0;

/** Player 0 with a Town Center and a Barracks, rich enough for any queue, and a Hud whose commands are collected. */
function scene() {
  const world = makeWorld();
  const tc = world.buildingsOf(0).find((b) => b.type === 'town_center');
  const barracks = place(world, 0, 'barracks', 20, 20);
  Object.assign(world.players[0], { gold: 99999, wood: 99999, popCap: POP_MAX });
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  const sent = [];
  const game = { viewState: vs, selection: new Selection(vs), session: null, input: null, renderer: null, command: (c) => sent.push(c), sendChat() {} };
  const hud = new Hud({ root: document.createElement('div'), game });
  huds.push(hud);
  const queue = (b, units) => {
    for (const unit of units) world.issueCommand(0, { type: 'train', building: b.id, unit });
    world.tick();
  };
  /** Select `b` and draw the panel from the world's current snapshot. */
  const show = (b) => {
    vs.pushSnapshot(world.getSnapshot(), (clock += 50));
    game.selection.set([b.id]);
    hud.update(clock);
    return hud.infoRoot;
  };
  /** Play the collected commands into the world, as the host does. */
  const apply = () => {
    for (const c of sent.splice(0)) world.issueCommand(0, c);
    world.tick();
  };
  return { world, tc, barracks, sent, queue, show, apply };
}

const times = (n, unit) => Array(n).fill(unit);

test('queueRuns: the rest of the queue as runs of the same item', () => {
  const q = (...us) => us.map((u) => ({ u, p: 0 }));
  assert.deepEqual(queueRuns(q()), []);
  assert.deepEqual(queueRuns(q('a')), [], 'the item in progress is not part of the rest');
  assert.deepEqual(queueRuns(q('a', 'a', 'a', 'b', 'a')), [{ u: 'a', at: 1, n: 2 }, { u: 'b', at: 3, n: 1 }, { u: 'a', at: 4, n: 1 }]);
  assert.deepEqual(queueRuns(q('a', 'a'), 0), [{ u: 'a', at: 0, n: 2 }]);
});

test('50 Worshippers are the one in progress and one button with a 49, not 49 buttons', () => {
  const { tc, queue, show } = scene();
  queue(tc, times(MAX_QUEUE, 'worshipper'));
  const info = show(tc);
  assert.equal(info.find('hi-q-label').textContent, 'Training Worshipper');
  assert.equal(info.find('hi-q-count').textContent, `${MAX_QUEUE} / ${MAX_QUEUE}`);
  const chips = info.findAll('hi-q-item');
  assert.equal(chips.length, 1);
  assert.equal(chips[0].find('hi-q-n').textContent, String(MAX_QUEUE - 1));
  assert.match(chips[0].title, new RegExp(`Worshipper ×${MAX_QUEUE - 1} — click to cancel one, Shift-click to cancel all ${MAX_QUEUE - 1}`));
  assert.match(info.find('hi-q-main').title, /Shift-click to cancel the whole queue/);
});

test('a short queue looks as before: no count for one item, a plain button for each different one', () => {
  const { tc, queue, show } = scene();
  queue(tc, ['worshipper']);
  let info = show(tc);
  assert.equal(info.find('hi-q-count'), null);
  assert.equal(info.findAll('hi-q-item').length, 0);
  assert.equal(info.find('hi-q-main').title, 'Click to cancel');
  queue(tc, ['worshipper']);
  info = show(tc);
  assert.equal(info.find('hi-q-count').textContent, `2 / ${MAX_QUEUE}`);
  const chips = info.findAll('hi-q-item');
  assert.equal(chips.length, 1);
  assert.equal(chips[0].find('hi-q-n'), null, 'a single unit has no count');
  assert.equal(chips[0].title, 'Worshipper — click to cancel');
});

test('a mixed queue is one button per run, in order, with counts on the runs of two or more', () => {
  const { barracks, queue, show } = scene();
  queue(barracks, ['warrior', 'warrior', 'warrior', 'archer', 'archer', 'warrior']);
  const info = show(barracks);
  assert.equal(info.find('hi-q-label').textContent, 'Training Warrior');
  const chips = info.findAll('hi-q-item');
  assert.deepEqual(chips.map((c) => c.title.split(' — ')[0]), ['Warrior ×2', 'Archer ×2', 'Warrior']);
  assert.deepEqual(chips.map((c) => (c.find('hi-q-n') ? c.find('hi-q-n').textContent : '')), ['2', '2', '']);
});

test('more runs than fit fold into one "+N" button after the first QUEUE_CHIPS - 1', () => {
  const { barracks, queue, show } = scene();
  const alternating = Array.from({ length: 40 }, (_, i) => (i % 2 ? 'archer' : 'warrior'));
  queue(barracks, alternating);
  const info = show(barracks);
  const chips = info.findAll('hi-q-item');
  assert.equal(chips.length, QUEUE_CHIPS);
  const more = chips[chips.length - 1];
  assert.ok(more.className.includes('is-more'));
  assert.equal(more.textContent, `+${40 - QUEUE_CHIPS}`, 'items 12 to 39 are folded');
  assert.ok(chips.slice(0, -1).every((c) => !c.className.includes('is-more')));
  assert.match(more.title, /28 more queued/);
});

test('a click takes one unit of the run back; Shift-click takes the whole run; the sim refunds it all', () => {
  const { world, tc, sent, queue, show, apply } = scene();
  const p = world.players[0];
  const start = p.gold;
  queue(tc, times(MAX_QUEUE, 'worshipper'));
  assert.equal(p.gold, start - MAX_QUEUE * MORTALS.worshipper.cost.gold);
  let info = show(tc);
  info.find('hi-q-item').click();
  assert.deepEqual(sent, [{ type: 'cancelTrain', building: tc.id, index: MAX_QUEUE - 1 }]);
  apply();
  assert.equal(tc.queue.length, MAX_QUEUE - 1);
  info = show(tc);
  assert.equal(info.find('hi-q-n').textContent, String(MAX_QUEUE - 2), 'the count follows the queue');
  info.find('hi-q-item').fire('click', { shiftKey: true });
  assert.deepEqual(sent, [{ type: 'cancelTrain', building: tc.id, index: 1, count: MAX_QUEUE - 2 }]);
  apply();
  assert.equal(tc.queue.length, 1, 'only the Worshipper in progress is left');
  assert.equal(p.gold, start - MORTALS.worshipper.cost.gold);
  info = show(tc);
  assert.equal(info.findAll('hi-q-item').length, 0);
});

test('the big button takes back the Worshipper in progress, Shift-click the whole queue', () => {
  const { world, tc, sent, queue, show, apply } = scene();
  const p = world.players[0];
  const start = p.gold;
  const pop = p.popUsed;
  queue(tc, times(30, 'worshipper'));
  let info = show(tc);
  info.find('hi-q-main').click();
  assert.deepEqual(sent, [{ type: 'cancelTrain', building: tc.id, index: 0 }]);
  apply();
  assert.equal(tc.queue.length, 29);
  info = show(tc);
  info.find('hi-q-main').fire('click', { shiftKey: true });
  assert.deepEqual(sent, [{ type: 'cancelTrain', building: tc.id, index: 0, count: 29 }]);
  apply();
  assert.equal(tc.queue.length, 0);
  assert.equal(p.gold, start, 'everything is paid back');
  assert.equal(p.popUsed, pop);
});

test('the "+N" button takes back the last item, Shift-click everything it folds', () => {
  const { barracks, sent, queue, show, apply } = scene();
  const alternating = Array.from({ length: 40 }, (_, i) => (i % 2 ? 'archer' : 'warrior'));
  queue(barracks, alternating);
  let info = show(barracks);
  const more = () => info.findAll('hi-q-item').pop();
  more().click();
  assert.deepEqual(sent, [{ type: 'cancelTrain', building: barracks.id, index: 39 }]);
  apply();
  info = show(barracks);
  assert.equal(more().textContent, `+${39 - QUEUE_CHIPS}`);
  more().fire('click', { shiftKey: true });
  assert.deepEqual(sent, [{ type: 'cancelTrain', building: barracks.id, index: QUEUE_CHIPS, count: 39 - QUEUE_CHIPS }]);
  apply();
  assert.deepEqual(barracks.queue.map((it) => it.u), alternating.slice(0, QUEUE_CHIPS), 'the first runs stay, in order');
});
