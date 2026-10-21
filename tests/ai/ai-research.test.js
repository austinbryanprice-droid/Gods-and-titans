// AI research planning (src/ai/production.js planResearch): the list is valid, and the
// Worshipper work and health lines are researched level by level as the settlement grows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planResearch, RESEARCH_ORDER } from '../../src/ai/production.js';
import { UPGRADES } from '../../src/data/upgrades.js';

const WORK = ['tc_work_songs', 'tc_master_craftsmen', 'tc_tireless_devotion'];
const HEALTH = ['tc_hearty_meals', 'tc_healing_herbs', 'tc_blessed_vigor'];

test('the research list names real upgrades once each, the levels of a line in order', () => {
  assert.equal(new Set(RESEARCH_ORDER).size, RESEARCH_ORDER.length, 'no repeats');
  for (const id of RESEARCH_ORDER) assert.ok(UPGRADES[id], `${id} exists`);
  for (const ids of [WORK, HEALTH]) {
    const at = ids.map((id) => RESEARCH_ORDER.indexOf(id));
    assert.ok(at.every((i) => i >= 0), `${ids.join(', ')} are all on the list`);
    assert.deepEqual([...at].sort((a, b) => a - b), at, 'level 1 before level 2 before level 3');
  }
});

/** What the AI wants to research next with a Town Center that is free, a full bank and nothing threatening. */
function nextResearch(upgrades, tier) {
  const p = { gold: 3000, wood: 3000, faith: 500, tier, upgrades: Object.fromEntries(upgrades.map((id) => [id, true])) };
  const done = new Map([['town_center', [{ id: 1, queue: [] }]]]);
  const wants = [];
  planResearch({ threat: false, issue: () => {} }, { p, t: 900, done }, wants);
  return wants.length ? wants[0].label.replace('research:', '') : null;
}

test('at a free Town Center the AI works up both Worshipper lines as its settlement grows', () => {
  const owned = [];
  const step = (tier) => {
    const id = nextResearch(owned, tier);
    if (id) owned.push(id);
    return id;
  };
  assert.equal(step(1), 'tc_iron_picks');
  assert.equal(step(1), 'tc_work_songs');
  assert.equal(step(1), 'tc_hearty_meals');
  assert.equal(step(1), null, 'level 2 waits for a Town');
  assert.equal(step(2), 'tc_master_craftsmen');
  assert.equal(step(2), 'tc_healing_herbs');
  assert.equal(step(2), 'tc_palisade');
  assert.equal(step(2), null, 'level 3 waits for a City');
  assert.equal(step(3), 'tc_tireless_devotion');
  assert.equal(step(3), 'tc_blessed_vigor');
  assert.equal(step(3), null);
});

test('the AI never asks for a level before the one it follows', () => {
  // Rich and in a City, but only Hearty Meals so far: Healing Herbs comes before Blessed Vigor.
  assert.equal(nextResearch(['tc_iron_picks', 'tc_work_songs', 'tc_master_craftsmen', 'tc_tireless_devotion', 'tc_palisade', 'tc_hearty_meals'], 3), 'tc_healing_herbs');
});
