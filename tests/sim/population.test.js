// Population limit (DESIGN 5.1): a Town Center and Houses raise a player's cap, POP_MAX is the ceiling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS } from '../../src/data/index.js';
import { UPGRADES } from '../../src/data/upgrades.js';
import { POP_MAX } from '../../src/config.js';
import { makeWorld, place, spawn, runUntil, clearUnits, errorsOf, runCollect } from './helpers.js';

const TC_POP = BUILDINGS.town_center.popProvided;
const HOUSE_POP = BUILDINGS.house.popProvided;

/** A roomy world so two dozen Houses fit around the first player's Town Center. */
const bigWorld = () => makeWorld({ map: { width: 64, height: 64, starts: [{ x: 6, y: 6 }, { x: 50, y: 50 }] } });

/** Build one more completed House near the Town Center. */
function addHouse(w) {
  const spot = w.findPlacement(0, 'house', 18, 18, 30);
  assert.ok(spot, 'room for another House');
  return place(w, 0, 'house', spot.tx, spot.ty);
}

test('the population limit is 200', () => {
  assert.equal(POP_MAX, 200);
});

test('a Town Center and 24 Houses supply exactly the limit, and more Houses add nothing', () => {
  const w = bigWorld();
  assert.equal(w.players[0].popCap, TC_POP);
  const caps = [];
  for (let n = 1; n <= 26; n++) {
    addHouse(w);
    caps.push(w.players[0].popCap);
  }
  assert.equal(caps[0], TC_POP + HOUSE_POP);
  assert.equal(caps[22], TC_POP + 23 * HOUSE_POP, '23 Houses: 196');
  assert.equal(caps[22], 196);
  assert.equal(caps[23], POP_MAX, '24 Houses reach the limit');
  assert.equal(caps[25], POP_MAX, 'two more Houses do not raise it');
  assert.equal(w.getSnapshot().players[0].popCap, POP_MAX);
  // Losing Houses brings the cap back down only once fewer than 24 are left.
  const houses = w.buildingList.filter((b) => b.owner === 0 && b.type === 'house');
  for (const b of houses.slice(0, 2)) w.killEntity(b);
  w.cleanup();
  assert.equal(w.players[0].popCap, POP_MAX, '24 Houses are left');
  w.killEntity(houses[2]);
  w.cleanup();
  assert.equal(w.players[0].popCap, TC_POP + 23 * HOUSE_POP, '23 Houses are left: 196');
});

test('Large Families brings the limit within reach of 19 Houses', () => {
  const w = bigWorld();
  Object.assign(w.players[0], { gold: 9000, wood: 9000, tier: 2 });
  let house = null;
  for (let n = 1; n <= 18; n++) house = addHouse(w);
  assert.equal(w.players[0].popCap, TC_POP + 18 * HOUSE_POP, '18 Houses: 156');
  w.issueCommand(0, { type: 'research', building: house.id, upgrade: 'house_large_families' });
  assert.ok(runUntil(w, () => w.players[0].upgrades.house_large_families, UPGRADES.house_large_families.time + 2) > 0);
  const per = HOUSE_POP + 2;
  assert.equal(w.players[0].popCap, TC_POP + 18 * per, '18 bigger Houses: 192, just short of the limit');
  assert.ok(TC_POP + 18 * per < POP_MAX);
  addHouse(w);
  assert.equal(w.players[0].popCap, POP_MAX, 'the 19th House reaches 200');
});

test('training fills the population up to the limit, then says the limit is reached', () => {
  const w = bigWorld();
  for (let n = 1; n <= 24; n++) addHouse(w);
  clearUnits(w, 0);
  Object.assign(w.players[0], { gold: 99999, wood: 99999 });
  const barracks = place(w, 0, 'barracks', 24, 12);
  for (let i = 0; i < 99; i++) spawn(w, 0, 'warrior', 10 + (i % 20) * 0.9, 30 + Math.floor(i / 20) * 0.9);
  assert.equal(w.players[0].popUsed, 198);
  const train = () => {
    w.issueCommand(0, { type: 'train', building: barracks.id, unit: 'warrior' });
    return errorsOf(runCollect(w, 0.1));
  };
  assert.deepEqual(train(), [], 'the last 2 pop fit');
  assert.equal(w.players[0].popUsed, POP_MAX);
  assert.deepEqual(train(), [`Population limit reached (${POP_MAX}).`]);
  assert.equal(w.players[0].popUsed, POP_MAX);
});

test('below the limit the message still sends the player to build Houses', () => {
  const w = bigWorld();
  for (let n = 1; n <= 10; n++) addHouse(w);
  clearUnits(w, 0);
  Object.assign(w.players[0], { gold: 99999, wood: 99999 });
  const barracks = place(w, 0, 'barracks', 24, 12);
  const cap = w.players[0].popCap;
  assert.ok(cap < POP_MAX);
  for (let i = 0; i < cap / 2; i++) spawn(w, 0, 'warrior', 10 + (i % 20) * 0.9, 30 + Math.floor(i / 20) * 0.9);
  w.issueCommand(0, { type: 'train', building: barracks.id, unit: 'warrior' });
  assert.deepEqual(errorsOf(runCollect(w, 0.1)), ['Not enough population. Build more Houses.']);
});
