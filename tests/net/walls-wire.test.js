// A wooden wall turns to stone in place (world.changeBuildingType, the first building whose type
// changes): the change has to reach a client through the delta stream and its ViewState, or the
// other players of an online game would keep seeing wood. DESIGN 5.3 and 7.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../../src/sim/world.js';
import { generateMap } from '../../src/sim/mapgen.js';
import { ViewState } from '../../src/game/view-state.js';
import { encode, apply } from '../../src/net/delta.js';

const json = (v) => JSON.parse(JSON.stringify(v));

test('a wall built and upgraded to stone reaches a client through deltas and its ViewState', () => {
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
  world.players[0].wood = 2000;
  world.players[0].gold = 2000;
  const crew = world.unitsOf(0).filter((u) => u.type === 'worshipper').map((u) => u.id);
  let prev = world.getSnapshot();
  let client = json(prev);
  vs.pushSnapshot(client, 0);
  const tx = Math.floor(tc.x) - 4;
  const ty = Math.floor(tc.y) + 6;
  world.issueCommand(0, { type: 'build', units: crew, building: 'wooden_wall', tx, ty, tx2: tx + 7, ty2: ty });
  const wallViews = (type) => [...vs.entities.values()].filter((e) => e.k === 'b' && e.t === type);
  let upgraded = false;
  let stoneAt = 0;
  for (let t = 1; t <= 20 * 90 && !stoneAt; t++) {
    world.tick();
    const walls = world.buildingList.filter((b) => !b.dead && b.def.wall);
    if (!upgraded && walls.length === 8 && walls.every((b) => b.constructed)) {
      world.issueCommand(0, { type: 'upgradeWall', walls: walls.map((b) => b.id) });
      upgraded = true;
    }
    const next = world.getSnapshot();
    client = apply(client, JSON.parse(JSON.stringify(encode(prev, next))));
    assert.deepStrictEqual(client, json(next), `tick ${next.tick}`);
    vs.pushSnapshot(client, t * 50);
    if (upgraded && wallViews('stone_wall').length === 8) stoneAt = next.tick;
    prev = next;
  }
  assert.ok(upgraded, 'the eight segments got built');
  assert.ok(stoneAt > 0, 'the client sees all eight as stone');
  assert.equal(wallViews('wooden_wall').length, 0, 'and none as wood any more');
  const view = wallViews('stone_wall')[0];
  assert.equal(view.hp, 1000);
  assert.equal(view.mhp, 1000);
});
