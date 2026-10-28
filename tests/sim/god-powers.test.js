import test from 'node:test';
import assert from 'node:assert/strict';
import { GOD_POWERS, POWERS, powersFor, isHarmfulPower, powerRadius } from '../../src/data/powers.js';
import { PANTHEON_LIST, validateData } from '../../src/data/index.js';
import { boonPct, teamSees } from '../../src/sim/powers.js';
import { normalizeCommand } from '../../src/sim/commands.js';
import { sanitizeCommand } from '../../src/net/sanitize.js';
import { makeWorld, run, runCollect, spawn, clearUnits, eventsOf, errorsOf } from './helpers.js';

function arena(pantheons = ['greek', 'norse'], extra = {}) {
  const w = makeWorld({ width: 64, height: 64, map: { width: 64, height: 64 }, pantheons, ...extra });
  clearUnits(w, 0);
  clearUnits(w, 1);
  w.events.length = 0;
  return w;
}

function dummy(w, owner, x, y, type = 'warrior') {
  const u = spawn(w, owner, type, x, y);
  w.setOrder(u, { type: 'hold', target: 0 });
  return u;
}

function power(w, player, slot, x, y) {
  const pw = powersFor(w.players[player].pantheon)[slot];
  const cmd = { type: 'godPower', power: pw.id };
  if (x !== undefined) Object.assign(cmd, { x, y });
  w.issueCommand(player, cmd);
  return pw;
}

test('every pantheon has a Village blessing, a Town strike and a City cataclysm, and the data validates', () => {
  assert.deepEqual(validateData(), []);
  for (const p of PANTHEON_LIST) {
    const list = GOD_POWERS[p.id];
    assert.equal(list.length, 3, p.id);
    assert.deepEqual(list.map((pw) => pw.tier), [1, 2, 3]);
    assert.equal(isHarmfulPower(list[0]), false, `${p.id} blessing`);
    assert.ok(isHarmfulPower(list[1]) && isHarmfulPower(list[2]), `${p.id} strike and cataclysm`);
    assert.ok(powerRadius(list[2]) >= powerRadius(list[1]), `${p.id}: the cataclysm covers at least the strike's area`);
  }
  assert.equal(Object.keys(POWERS).length, 30);
});

test('the commands are cleaned on the host and in the sim', () => {
  const id = GOD_POWERS.greek[1].id;
  assert.deepEqual(sanitizeCommand({ type: 'godPower', power: id, x: 5, y: 900 }, { width: 64, height: 64 }), { type: 'godPower', power: id, x: 5, y: 64 });
  assert.equal(sanitizeCommand({ type: 'godPower', power: 'nope' }, { width: 64, height: 64 }), null);
  assert.equal(normalizeCommand({ type: 'godPower', power: id, x: 3, y: 4 }, { width: 64, height: 64 }).power, id);
});

test('a strike damages enemies in sight, credits the caster, and works only once', () => {
  const w = arena();
  const p = w.players[0];
  p.tier = 2;
  dummy(w, 0, 20, 20, 'archer'); // eyes on the spot
  const foes = [dummy(w, 1, 24, 20), dummy(w, 1, 25, 21), dummy(w, 1, 23, 19)];
  const hp0 = foes.reduce((s, u) => s + u.hp, 0);
  power(w, 0, 1, 24, 20);
  const evs = runCollect(w, 5);
  assert.equal(eventsOf(evs, 'godPower').length, 1);
  assert.ok(eventsOf(evs, 'effect').length >= 12, 'one visual per bolt');
  const hp1 = foes.reduce((s, u) => s + (u.dead ? 0 : u.hp), 0);
  assert.ok(hp1 < hp0 - 300, `lightning storm hurt the warriors (${hp0} → ${hp1})`);
  assert.equal(p.powers.used, 2);
  power(w, 0, 1, 24, 20);
  const again = runCollect(w, 0.2);
  assert.deepEqual(errorsOf(again), ["Zeus's Lightning Storm has already been used."]);
});

test('strikes need the tier, a target in sight, and wait out the Decade of Peace', () => {
  const w = arena();
  const p = w.players[0];
  dummy(w, 1, 50, 50);
  power(w, 0, 1, 50, 50);
  assert.deepEqual(errorsOf(runCollect(w, 0.1)), ['Requires Town.']);
  p.tier = 3;
  power(w, 0, 2, 50, 50);
  assert.deepEqual(errorsOf(runCollect(w, 0.1)), ['You must be able to see the target.']);
  assert.equal(p.powers.used, 0, 'a refused power is not spent');
  assert.ok(!teamSees(w, 0, 50, 50));

  const pw = arena(['greek', 'norse'], { peaceMinutes: 30 });
  pw.players[0].tier = 2;
  dummy(pw, 0, 20, 20);
  power(pw, 0, 1, 22, 20);
  assert.match(errorsOf(runCollect(pw, 0.1))[0], /^The Decade of Peace holds for another .*: no god powers against other players yet\.$/);
  power(pw, 0, 0); // a blessing is fine
  assert.deepEqual(errorsOf(runCollect(pw, 0.1)), []);
  assert.equal(pw.players[0].powers.used, 1);
});

test('a gather boon speeds mining for its duration, then ends', () => {
  const w = arena();
  const p = w.players[0];
  power(w, 0, 0); // Demeter's Bounty
  run(w, 0.1);
  assert.equal(boonPct(p, 'gather'), 0.5);
  const snap = w.getSnapshot();
  assert.equal(snap.players[0].gp, 1);
  assert.deepEqual(snap.players[0].gb, [['gather', 0.5, 60]]);
  // Two workers on the mine: with the boon each load counts half again.
  const mine = w.mineList[0];
  const ws = [spawn(w, 0, 'worshipper', mine.x - 2, mine.y), spawn(w, 0, 'worshipper', mine.x - 2, mine.y + 1)];
  w.issueCommand(0, { type: 'gather', units: ws.map((u) => u.id), target: mine.id });
  const g0 = p.stats.gathered;
  run(w, 20);
  const boosted = p.stats.gathered - g0;
  run(w, 40); // the boon runs out
  assert.equal(boonPct(p, 'gather'), 0);
  assert.equal(w.getSnapshot().players[0].gb, undefined);
  const g1 = p.stats.gathered;
  run(w, 20);
  const plain = p.stats.gathered - g1;
  assert.ok(boosted > plain * 1.35, `boosted ${boosted} vs plain ${plain} gold`);
});

test('a faith boon doubles prayer, a heal rain heals allies, a caravan pays at once', () => {
  const eg = arena(['egyptian', 'norse']);
  power(eg, 0, 0);
  run(eg, 0.1);
  assert.equal(boonPct(eg.players[0], 'faith'), 1);

  const no = arena(['norse', 'greek']);
  const a = dummy(no, 0, 20, 20);
  a.hp = 100;
  power(no, 0, 0, 20, 20);
  run(no, 5);
  assert.ok(a.hp > 300, `healed to ${a.hp}`);
  const foe = dummy(no, 1, 25.5, 20);
  foe.hp = 100;
  run(no, 2);
  assert.equal(Math.round(foe.hp), 100, 'enemies are not healed');

  const wa = arena(['west_african', 'norse']);
  const g = wa.players[0].gold;
  power(wa, 0, 0);
  run(wa, 0.1);
  assert.equal(wa.players[0].gold, g + 300);
});

test('a cataclysm hurts buildings and kills count for the caster', () => {
  const w = arena(['aztec', 'norse']);
  const p = w.players[0];
  p.tier = 3;
  dummy(w, 0, 30, 30, 'archer');
  const weak = [dummy(w, 1, 33, 30, 'worshipper'), dummy(w, 1, 34, 31, 'worshipper')];
  const tc = w.buildingList.find((b) => b.owner === 1);
  const tcHp = tc.hp;
  power(w, 0, 2, 33, 30);
  run(w, 12);
  assert.ok(weak.every((u) => u.dead), 'Nahui Ollin kills worshippers in it');
  assert.ok(p.stats.kills >= 2);
  assert.equal(tc.hp, tcHp, 'the far Town Center is out of the quake');
});

test('summoning powers raise temporary minions for the caster', () => {
  const w = arena(['celtic', 'norse']);
  w.players[0].tier = 2;
  dummy(w, 0, 20, 20);
  dummy(w, 1, 23, 20);
  power(w, 0, 1, 23, 20);
  run(w, 0.2);
  const crows = w.unitList.filter((u) => u.owner === 0 && u.type === 'celtic_battle_crow' && !u.dead);
  assert.equal(crows.length, 4);
  run(w, 41);
  assert.equal(w.unitList.filter((u) => u.owner === 0 && u.type === 'celtic_battle_crow' && !u.dead).length, 0);
});

test("the sim's sight check is the clients' fog grid, tile for tile", async () => {
  const { computeVisibility } = await import('../../src/sim/visibility.js');
  const w = arena();
  const archer = dummy(w, 0, 20, 20, 'archer');
  const grid = computeVisibility(64, 64, [{ x: archer.x, y: archer.y, r: archer.def.sight }]);
  for (let ty = 0; ty < 64; ty++) {
    for (let tx = 0; tx < 64; tx++) {
      if (Math.hypot(tx - 20, ty - 20) > 30) continue; // far from both the archer and the Town Center
      if (Math.hypot(tx - 8, ty - 8) < 16) continue; // the Town Center's own sight
      assert.equal(teamSees(w, 0, tx + 0.9, ty + 0.1), grid[ty * 64 + tx] === 1, `tile ${tx},${ty}`);
    }
  }
});
