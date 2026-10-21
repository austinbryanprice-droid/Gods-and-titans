// Pantheon identity data (DESIGN 4.10): every pantheon has a tagline, a playstyle, two blessings,
// an elite Barracks soldier and its own look for the shared mortals, and no two are alike.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PANTHEON_LIST, PANTHEONS, UNITS, MORTALS, BUILDINGS, eliteFor, producibleAt, validateData } from '../../src/data/index.js';
import { PERK_STATS, validatePantheon } from '../../src/data/schema.js';

const unitIds = new Set(Object.keys(UNITS));
const errorsOf = (p) => {
  const errors = [];
  validatePantheon(p, errors, unitIds);
  return errors;
};
/** A deep copy of a pantheon with `edit` applied, for checking that the validators object. */
function broken(id, edit) {
  const copy = structuredClone(PANTHEONS[id]);
  edit(copy);
  return copy;
}

test('every pantheon has an identity: tagline, playstyle and two blessings with effects the sim understands', () => {
  assert.deepEqual(validateData(), []);
  for (const p of PANTHEON_LIST) {
    const { tagline, playstyle, blessings } = p.identity;
    assert.ok(tagline.length >= 8 && tagline.length <= 40, `${p.id}: tagline "${tagline}"`);
    assert.ok(playstyle.length >= 60 && playstyle.length <= 220, `${p.id}: playstyle is a sentence or two`);
    assert.equal(blessings.length, 2, p.id);
    for (const b of blessings) {
      assert.ok(b.id.startsWith(`${p.id}_`), b.id);
      assert.ok(b.description.endsWith('.'), `${b.id}: description is a sentence`);
      assert.ok(b.effects.length >= 1);
    }
  }
});

test('no two pantheons share a tagline, a blessing, a blessing effect or an elite soldier', () => {
  const seen = (list) => new Set(list).size === list.length;
  assert.ok(seen(PANTHEON_LIST.map((p) => p.identity.tagline)), 'taglines');
  const blessings = PANTHEON_LIST.flatMap((p) => p.identity.blessings);
  assert.equal(blessings.length, 20);
  assert.ok(seen(blessings.map((b) => b.id)), 'blessing ids');
  assert.ok(seen(blessings.map((b) => b.name)), 'blessing names');
  assert.ok(seen(blessings.map((b) => JSON.stringify(b.effects))), 'blessing effects');
  const elites = PANTHEON_LIST.map((p) => p.elite);
  assert.ok(seen(elites.map((e) => e.id)), 'elite ids');
  assert.ok(seen(elites.map((e) => e.name)), 'elite names');
  assert.ok(seen(elites.map((e) => e.icon)), 'elite icons');
  assert.ok(seen(elites.map((e) => JSON.stringify([e.class, e.hp, e.armor, e.speed, e.attack.damage, e.attack.range, e.attack.cooldown]))), 'elite stat lines');
  // within a pantheon the two blessings do different jobs
  for (const p of PANTHEON_LIST) {
    const [a, b] = p.identity.blessings;
    assert.notEqual(a.icon, b.icon, p.id);
  }
});

test('the blessings between them cover every perk and most kinds of effect, so the pantheons play differently', () => {
  const perks = new Set();
  const kinds = new Set();
  for (const p of PANTHEON_LIST) {
    for (const b of p.identity.blessings) {
      for (const e of b.effects) {
        kinds.add(e.type);
        if (e.type === 'perk') perks.add(e.stat);
      }
    }
  }
  assert.deepEqual([...perks].sort(), [...PERK_STATS].sort(), 'every perk is some pantheon\'s trait');
  for (const kind of ['perk', 'building', 'unit', 'carry', 'chop', 'godLevel']) assert.ok(kinds.has(kind), kind);
});

test('elite soldiers: a Town unit at the Barracks, the same room as their kin, stronger and dearer', () => {
  const power = (u) => Math.sqrt((u.hp / (1 - (0.06 * u.armor) / (1 + 0.06 * u.armor))) * (u.attack.damage / u.attack.cooldown));
  const price = (u) => u.cost.gold + u.cost.wood;
  const classes = new Set();
  for (const p of PANTHEON_LIST) {
    const e = p.elite;
    const kin = MORTALS[e.kin];
    classes.add(e.class);
    assert.equal(eliteFor(p.id), e);
    assert.equal(e.tier, 2, e.id);
    assert.equal(e.producedAt, 'barracks');
    assert.equal(e.pop, kin.pop, `${e.id}: takes the room of a ${kin.name}`);
    assert.ok(e.buildTime >= kin.buildTime, `${e.id}: trains no faster than a ${kin.name}`);
    const dearer = price(e) / price(kin);
    assert.ok(dearer >= 1.25 && dearer <= 1.8, `${e.id}: costs ${dearer.toFixed(2)}x a ${kin.name}`);
    const stronger = power(e) / power(kin);
    assert.ok(stronger >= 0.9 && stronger <= 1.5, `${e.id}: ${stronger.toFixed(2)}x the raw power of a ${kin.name}`);
    assert.equal(e.class === 'infantry', e.attack.range < 1, `${e.id}: infantry fight in melee, ranged elites shoot`);
    if (e.class === 'ranged') assert.ok(e.attack.projectile && e.attack.range > 4, e.id);
    assert.ok(!e.air && e.abilities.length === 0);
    // where the soldier shows up
    assert.ok(producibleAt('barracks', p.id).includes(e.id));
    for (const other of PANTHEON_LIST) if (other !== p) assert.ok(!producibleAt('barracks', other.id).includes(e.id), `${other.id} cannot train ${e.id}`);
  }
  assert.deepEqual([...classes].sort(), ['infantry', 'ranged'], 'both melee and ranged elites exist');
  assert.equal(PANTHEON_LIST.filter((p) => p.elite.class === 'ranged').length, 4);
  assert.deepEqual(producibleAt('barracks', null), BUILDINGS.barracks.produces, 'no pantheon, no elite');
  assert.equal(eliteFor('nope'), null);
});

test('every pantheon dresses every shared mortal its own way, and the soldiers differ from their kin', () => {
  for (const id of Object.keys(MORTALS)) {
    const looks = PANTHEON_LIST.map((p) => JSON.stringify(p.looks[id]));
    assert.ok(looks.every(Boolean), `${id}: every pantheon has a look`);
    assert.equal(new Set(looks).size, PANTHEON_LIST.length, `${id}: ten different looks`);
  }
  for (const p of PANTHEON_LIST) {
    const kin = { ...MORTALS[p.elite.kin].visual, ...p.looks[p.elite.kin] };
    const v = p.elite.visual;
    const shape = (x) => JSON.stringify([x.scale, x.headgear, x.weapon, x.offhand, [...x.extras].sort()]);
    assert.notEqual(shape(kin), shape(v), `${p.elite.id} must read differently from the ${p.elite.kin} of its pantheon`);
  }
});

test('the validators object to a broken identity, elite or look', () => {
  assert.deepEqual(errorsOf(PANTHEONS.greek), []);
  const has = (p, text) => assert.ok(errorsOf(p).some((e) => e.includes(text)), `${text} in ${JSON.stringify(errorsOf(p))}`);
  has(broken('greek', (p) => { delete p.identity; }), 'needs an identity');
  has(broken('greek', (p) => { p.identity.tagline = ''; }), 'identity needs tagline');
  has(broken('greek', (p) => { p.identity.blessings.pop(); }), '2 or 3 blessings');
  has(broken('greek', (p) => { p.identity.blessings[0].id = 'norse_x'; }), 'id must start with greek_');
  has(broken('greek', (p) => { p.identity.blessings[0].effects = [{ type: 'perk', stat: 'nonsense', amount: 1 }]; }), 'bad perk stat nonsense');
  has(broken('greek', (p) => { p.identity.blessings[0].effects = [{ type: 'building', building: 'palace', stat: 'hp', amount: 1 }]; }), 'unknown building palace');
  has(broken('greek', (p) => { p.identity.blessings[0].effects = [{ type: 'unit', units: ['nobody'], stat: 'hp', amount: 1 }]; }), 'unknown unit nobody');
  has(broken('greek', (p) => { delete p.elite; }), 'elite: missing');
  has(broken('greek', (p) => { p.elite.tier = 3; }), 'must be tier 2');
  has(broken('greek', (p) => { p.elite.producedAt = 'shrine'; }), 'produced at the barracks');
  has(broken('greek', (p) => { p.elite.kin = 'archer'; }), 'kin of the warrior');
  has(broken('greek', (p) => { p.elite.class = 'god'; }), 'class must be infantry or ranged');
  has(broken('greek', (p) => { p.elite.mortal = false; }), 'flagged mortal');
  has(broken('greek', (p) => { p.elite.abilities = [{ id: 'x' }]; }), 'no abilities');
  has(broken('greek', (p) => { p.looks.nobody = {}; }), 'not a mortal unit');
  has(broken('greek', (p) => { p.looks.warrior.scale = 2; }), 'cannot restyle scale');
  has(broken('greek', (p) => { p.looks.warrior.headgear = 'fez'; }), 'bad headgear fez');
  has(broken('greek', (p) => { p.looks.warrior.colors = { primary: 'red' }; }), 'colors must be #rrggbb');
  has(broken('greek', (p) => { p.looks.warrior.extras = ['wings-of-doom']; }), 'bad extras');
});
