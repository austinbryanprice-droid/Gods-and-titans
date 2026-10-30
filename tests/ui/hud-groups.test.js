// The control-group bar (src/ui/hud-groups.js): a chip per saved group in digit order with the
// leading unit's icon and the count, red while a member fights or was just hurt, lit while
// selected, gone when the group is empty; a click picks the group. Fake DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { GroupBar, groupChips, FIGHT_MS } from '../../src/ui/hud-groups.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { installFakeDom } from './fake-dom.js';

before(installFakeDom);

function world() {
  const entities = new Map();
  const add = (id, t, extra = {}) => entities.set(id, { id, k: 'u', t, o: 0, x: 0, y: 0, hp: 100, mhp: 100, st: 'idle', ...extra });
  add(1, 'worshipper');
  add(2, 'worshipper');
  add(3, 'greek_hoplite');
  add(4, 'greek_zeus');
  add(5, 'greek_hoplite');
  const vs = { myIndex: 0, entities, knownEntity: (id) => entities.get(id) };
  return { vs, entities, sel: new Selection(vs) };
}

test('chips in digit order, led by the highest-ranked type, with counts', () => {
  const { vs, sel } = world();
  sel.set([1, 2]);
  sel.saveGroup(4);
  sel.set([3, 4, 5]);
  sel.saveGroup(1);
  const chips = groupChips(sel, vs, new Map(), 0);
  assert.deepEqual(chips.map((c) => [c.n, c.count, c.type]), [[1, 3, 'greek_zeus'], [4, 2, 'worshipper']]);
  assert.equal(chips[0].active, true, 'group 1 is the selection');
  assert.equal(chips[1].active, false);
});

test('a group fights while a member attacks or for a while after it was hurt', () => {
  const { vs, sel, entities } = world();
  sel.set([3, 5]);
  sel.saveGroup(2);
  const seen = new Map();
  assert.equal(groupChips(sel, vs, seen, 0)[0].fighting, false);
  entities.get(3).hp = 80;
  assert.equal(groupChips(sel, vs, seen, 100)[0].fighting, true);
  assert.equal(groupChips(sel, vs, seen, 100 + FIGHT_MS + 1)[0].fighting, false);
  entities.get(5).st = 'attack';
  assert.equal(groupChips(sel, vs, seen, 100 + FIGHT_MS + 2)[0].fighting, true);
});

test('the bar draws, clicks, and drops an emptied group', () => {
  const { vs, sel, entities } = world();
  const picked = [];
  const bar = new GroupBar({ selection: sel, viewState: vs, onPick: (n) => picked.push(n) });
  bar.update(0);
  assert.equal(bar.root.hidden, true, 'no groups yet');
  sel.set([3]);
  sel.saveGroup(5);
  sel.set([1, 2]);
  sel.saveGroup(3);
  bar.update(1000);
  const chips = bar.root.findAll('hud-group');
  assert.deepEqual(chips.map((c) => c.dataset.group), ['3', '5']);
  assert.match(chips[0].textContent, /3.*2/);
  chips[1].click();
  assert.deepEqual(picked, [5]);
  entities.delete(3);
  bar.update(2000);
  assert.deepEqual(bar.root.findAll('hud-group').map((c) => c.dataset.group), ['3']);
});
