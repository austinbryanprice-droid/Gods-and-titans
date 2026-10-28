// Data registry: every unit, building and pantheon in one place.
import { MORTALS } from './mortals.js';
import { BUILDINGS, GOLD_MINE, BUILD_MENU } from './buildings.js';
import { UPGRADES } from './upgrades.js';
import { validatePantheon, validateUnit, validateUpgrade, validateUpgradeLines } from './schema.js';
import { PANTHEON_LIST, PANTHEONS } from './pantheon-list.js';
import { POWERS, validatePowers } from './powers.js';

export { BUILDINGS, GOLD_MINE, BUILD_MENU, MORTALS, UPGRADES, PANTHEON_LIST, PANTHEONS, POWERS };

/** Every unit type by id: mortals plus each pantheon's gods, titan, creatures, minions and elite soldier. */
export const UNITS = { ...MORTALS };
for (const p of PANTHEON_LIST) {
  for (const u of [...p.gods, p.titan, ...p.creatures, ...(p.minions || []), ...(p.elite ? [p.elite] : [])]) UNITS[u.id] = u;
}

/** Every ability by id (abilities are owned by units). */
export const ABILITIES = {};
for (const u of Object.values(UNITS)) for (const a of u.abilities) ABILITIES[a.id] = { ...a, ownerType: u.id };

export function getUnitType(id) {
  return UNITS[id] || null;
}
export function getBuildingType(id) {
  return BUILDINGS[id] || null;
}
export function getPantheon(id) {
  return PANTHEONS[id] || null;
}
export function godsFor(pantheonId) {
  return PANTHEONS[pantheonId]?.gods || [];
}
export function creaturesFor(pantheonId) {
  return PANTHEONS[pantheonId]?.creatures || [];
}
export function titanFor(pantheonId) {
  return PANTHEONS[pantheonId]?.titan || null;
}
/** The pantheon's own Barracks soldier (Hoplite, Berserker, Samurai ...), or null. */
export function eliteFor(pantheonId) {
  return PANTHEONS[pantheonId]?.elite || null;
}

/**
 * Unit type ids a building of `buildingId` can produce for a player of `pantheonId`.
 * Resolves the 'creatures' | 'gods' | 'titan' shorthands and adds the pantheon's elite soldier.
 */
export function producibleAt(buildingId, pantheonId) {
  const b = BUILDINGS[buildingId];
  if (!b) return [];
  if (Array.isArray(b.produces)) {
    const elite = eliteFor(pantheonId);
    return elite && elite.producedAt === buildingId ? [...b.produces, elite.id] : b.produces;
  }
  if (b.produces === 'creatures') return creaturesFor(pantheonId).map((u) => u.id);
  if (b.produces === 'gods') return godsFor(pantheonId).map((u) => u.id);
  if (b.produces === 'titan') return titanFor(pantheonId) ? [titanFor(pantheonId).id] : [];
  return [];
}

/** Experience granted to nearby enemy gods when a unit of this type dies. */
export function xpValue(unitType, level = 1) {
  if (unitType.class === 'god') return 100 * level;
  if (unitType.class === 'titan') return 400;
  return Math.round(10 * unitType.pop + unitType.hp / 40);
}

/** Validate all data. Returns an array of error strings (empty when valid). */
export function validateData() {
  const errors = [];
  const unitIds = new Set(Object.keys(UNITS));
  for (const u of Object.values(MORTALS)) validateUnit(u, errors, unitIds);
  const seen = new Set();
  for (const p of PANTHEON_LIST) {
    validatePantheon(p, errors, unitIds);
    for (const u of [...p.gods, p.titan, ...p.creatures, ...(p.minions || []), ...(p.elite ? [p.elite] : [])]) {
      if (seen.has(u.id)) errors.push(`duplicate unit id ${u.id}`);
      seen.add(u.id);
    }
  }
  const abilityIds = new Set();
  for (const u of Object.values(UNITS)) for (const a of u.abilities) {
    if (abilityIds.has(a.id)) errors.push(`duplicate ability id ${a.id}`);
    abilityIds.add(a.id);
  }
  const upgradeIds = new Set();
  for (const b of Object.values(BUILDINGS)) {
    for (const up of b.upgrades || []) {
      if (upgradeIds.has(up.id)) errors.push(`duplicate upgrade id ${up.id}`);
      upgradeIds.add(up.id);
      validateUpgrade(up, b.id, errors, unitIds);
    }
    validateUpgradeLines(b, errors);
  }
  errors.push(...validatePowers(PANTHEON_LIST.map((p) => p.id), unitIds));
  return errors;
}
