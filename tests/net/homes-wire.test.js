// Four Houses become a Manor in place (sim/homes.js): the command passes the host's whitelist, and the
// change (four buildings gone, one of another type on their ground, each House carrying the upgrade for a
// while) has to reach a client through the delta stream and its ViewState, or the other players of an
// online game would keep seeing four Houses. DESIGN 5.3 and 7.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../../src/sim/world.js';
import { generateMap } from '../../src/sim/mapgen.js';
import { ViewState } from '../../src/game/view-state.js';
import { encode, apply } from '../../src/net/delta.js';
import { sanitizeCommand, COMMAND_TYPES } from '../../src/net/sanitize.js';
import { mergeRule } from '../../src/data/houses.js';

const json = (v) => JSON.parse(JSON.stringify(v));

test('sanitizeCommand: upgradeHouses is whitelisted with a list of ids, and nothing else', () => {
  const b = { width: 96, height: 96 };
  assert.ok(COMMAND_TYPES.includes('upgradeHouses'));
  assert.deepEqual(sanitizeCommand({ type: 'upgradeHouses', houses: [3, 3, -1, '7', 8, 2.5], evil: { a: 1 }, player: 1 }, b), { type: 'upgradeHouses', houses: [3, 8] });
  assert.deepEqual(sanitizeCommand({ type: 'upgradeHouses', houses: [] }, b), { type: 'upgradeHouses', houses: [] });
  assert.equal(sanitizeCommand({ type: 'upgradeHouses', houses: 'all' }, b), null);
  assert.equal(sanitizeCommand({ type: 'upgradeHouses', houses: { 0: 1 } }, b), null);
  assert.equal(sanitizeCommand({ type: 'upgradeHouses' }, b), null, 'the Houses are required');
});

test('four Houses combined into a Manor reach a client through deltas and its ViewState', () => {
  const setup = {
    version: '0.1.0', seed: 99, mapSize: 'small',
    players: [
      { index: 0, name: 'A', team: 1, pantheon: 'greek', color: '#d63a3a', kind: 'human', difficulty: null },
      { index: 1, name: 'B', team: 2, pantheon: 'norse', color: '#3a78d6', kind: 'human', difficulty: null },
    ],
  };
  const world = createWorld(setup);
  const vs = new ViewState({ setup, mapData: generateMap({ seed: setup.seed, mapSize: setup.mapSize, playerCount: 2 }), myIndex: 0 });
  const tc = world.buildingsOf(0).find((b) => b.type === 'town_center');
  tc.tier = 2;
  world.recomputeTier(0, true);
  Object.assign(world.players[0], { gold: 2000, wood: 2000 });
  const spot = world.findPlacement(0, 'manor', tc.x + 8, tc.y + 8, 30);
  assert.ok(spot, 'room for a Manor near the Town Center');
  const s = 2;
  const houses = [[0, 0], [s, 0], [0, s], [s, s]].map(([dx, dy]) => world.createBuilding(0, 'house', spot.tx + dx, spot.ty + dy, true, true));
  world.recomputePopCap(0);
  const capBefore = world.players[0].popCap;
  let prev = world.getSnapshot();
  let client = json(prev);
  vs.pushSnapshot(client, 0);
  const views = (type) => [...vs.entities.values()].filter((e) => e.k === 'b' && e.o === 0 && e.t === type);
  world.issueCommand(0, { type: 'upgradeHouses', houses: houses.map((h) => h.id) });
  let sawQueue = false;
  let manorAt = 0;
  for (let t = 1; t <= 20 * (mergeRule().time + 5) && !manorAt; t++) {
    world.tick();
    const next = world.getSnapshot();
    client = apply(client, JSON.parse(JSON.stringify(encode(prev, next))));
    assert.deepStrictEqual(client, json(next), `tick ${next.tick}`);
    vs.pushSnapshot(client, t * 50);
    if (views('house').length === 4 && views('house').every((h) => h.q.length === 1 && h.q[0].u === 'manor')) sawQueue = true;
    if (views('manor').length === 1) manorAt = next.tick;
    prev = next;
  }
  assert.ok(sawQueue, 'while it runs, the client sees the upgrade on every House');
  assert.ok(manorAt > 0, 'the client sees the Manor');
  assert.equal(views('house').length, 0, 'and none of the four Houses any more');
  const manor = views('manor')[0];
  assert.deepEqual([manor.tx, manor.ty], [spot.tx, spot.ty]);
  assert.equal(manor.hp, manor.mhp);
  assert.equal(client.players[0].popCap, capBefore + 16, 'the population limit grew by the Manor\'s share over the Houses');
});
