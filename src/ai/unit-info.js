// Data-driven knowledge for the AI: unit roles, combat strength and ability
// profiles, derived once per type from the pantheon data (works for every
// pantheon without per-pantheon code).
import { getUnitType, godsFor, creaturesFor, titanFor } from '../data/index.js';
import { GOD_LEVEL_HP, GOD_LEVEL_DAMAGE } from '../config.js';

const HARMFUL = new Set(['damage', 'stun', 'slow', 'dot', 'chain', 'line', 'knockback', 'pull', 'dash']);
const infoCache = new Map();
const abilityCache = new Map();

/** Cost of a type in "gold equivalents" (faith is the scarcer currency). */
export function costValue(cost) {
  if (!cost) return 0;
  return (cost.gold || 0) + (cost.wood || 0) * 1.1 + (cost.faith || 0) * 1.3;
}

/**
 * Static info for a unit type id (cached).
 * @returns {{id, def, cls, hp, dps, range, melee, air, hitsAir, buildingsOnly, pop, value, str, tier, abilityMult}|null}
 */
export function unitInfo(typeId) {
  let inf = infoCache.get(typeId);
  if (inf) return inf;
  const def = getUnitType(typeId);
  if (!def) return null;
  const atk = def.attack;
  const dps = atk ? atk.damage / Math.max(0.2, atk.cooldown) : 0;
  const range = atk ? atk.range : 0;
  // Abilities and passives make heroes and casters punch above their auto-attack.
  let abilityMult = 1;
  if (def.class === 'god') abilityMult = 1.7;
  else if (def.class === 'titan') abilityMult = 1.35;
  else if (def.abilities.length) abilityMult = 1.15;
  if (atk && atk.splash > 0) abilityMult *= 1 + Math.min(0.5, atk.splash * 0.2);
  for (const p of def.passives || []) {
    if (p.type === 'aura') abilityMult *= 1.08;
    else if (p.type === 'cleave') abilityMult *= 1 + (p.pct || 0) * 0.6;
    else if (p.type === 'critical') abilityMult *= 1 + (p.chance || 0) * ((p.mult || 1) - 1);
    else if (p.type === 'lifesteal' || p.type === 'regen' || p.type === 'evasion') abilityMult *= 1.06;
  }
  inf = {
    id: typeId,
    def,
    cls: def.class,
    hp: def.hp,
    armor: def.armor || 0,
    dps,
    range,
    melee: !!atk && range <= 1.5,
    air: !!def.air,
    hitsAir: !!(atk && atk.canHitAir && !atk.buildingsOnly),
    buildingsOnly: !!(atk && atk.buildingsOnly),
    pop: def.pop || 0,
    value: costValue(def.cost),
    str: Math.sqrt(def.hp * dps * abilityMult),
    tier: def.tier || 1,
    abilityMult,
  };
  infoCache.set(typeId, inf);
  return inf;
}

/** Armor damage reduction (WC3 formula), used to weigh effective hp. */
function armorFactor(a) {
  return a >= 0 ? 1 + 0.06 * a : 1 / (2 - Math.pow(0.94, -a));
}

/**
 * Current combat numbers of a live unit: effective hp and dps against ground
 * and air targets. Writes into `out` to avoid allocation.
 */
export function liveCombat(u, out) {
  const inf = unitInfo(u.type);
  if (!inf) {
    out.hp = 0;
    out.dpsG = 0;
    out.dpsA = 0;
    return out;
  }
  const lvlMult = inf.cls === 'god' ? 1 + GOD_LEVEL_DAMAGE * ((u.level || 1) - 1) : 1;
  const dps = inf.dps * lvlMult * (u.dmgMult || 1) * (u.atkSpeedMult || 1) * inf.abilityMult;
  out.hp = (u.hp + (u.shield || 0)) * armorFactor(u.armorNow ?? inf.armor);
  if (inf.buildingsOnly) {
    out.dpsG = 0;
    out.dpsA = 0;
  } else {
    out.dpsG = dps;
    out.dpsA = inf.hitsAir ? dps : 0;
  }
  return out;
}

/** Strength accumulator for a group of units (Lanchester-style: Σhp × Σdps). */
export function newForce() {
  return { hp: 0, dpsG: 0, dpsA: 0, airHp: 0, n: 0, value: 0, pop: 0 };
}

const tmpC = { hp: 0, dpsG: 0, dpsA: 0 };
export function addToForce(f, u) {
  liveCombat(u, tmpC);
  f.hp += tmpC.hp;
  f.dpsG += tmpC.dpsG;
  f.dpsA += tmpC.dpsA;
  if (u.air) f.airHp += tmpC.hp;
  f.n++;
  const inf = unitInfo(u.type);
  if (inf) {
    f.value += inf.value;
    f.pop += inf.pop;
  }
  return f;
}

/** Add a not-yet-spawned unit of a type at full health (e.g. a Titan being summoned). */
export function addTypeToForce(f, typeId) {
  const inf = unitInfo(typeId);
  if (!inf) return f;
  const hp = inf.hp * armorFactor(inf.armor);
  const dps = inf.buildingsOnly ? 0 : inf.dps * inf.abilityMult;
  f.hp += hp;
  f.dpsG += dps;
  f.dpsA += inf.hitsAir ? dps : 0;
  if (inf.air) f.airHp += hp;
  f.n++;
  f.value += inf.value;
  f.pop += inf.pop;
  return f;
}

/** Add a building's defensive value (towers shoot; others only soak). */
export function addBuildingToForce(f, b, soak = 0.15) {
  if (b.def.attack) {
    const dps = b.def.attack.damage / b.def.attack.cooldown;
    f.hp += b.hp * armorFactor(b.armor);
    f.dpsG += dps;
    f.dpsA += b.def.attack.canHitAir ? dps : 0;
  } else if (soak > 0) {
    f.hp += b.hp * soak;
  }
  return f;
}

/** Effective dps of force a against force b (anti-air matters vs flyers). */
function effDps(a, b) {
  if (b.hp <= 0) return a.dpsG;
  const airFrac = Math.min(1, b.airHp / b.hp);
  return a.dpsG * (1 - airFrac) + a.dpsA * airFrac;
}

/**
 * Fight ratio of a vs b: > 1 means a should win (sqrt of Lanchester strengths).
 * Infinity when b is empty.
 */
export function fightRatio(a, b) {
  const sb = b.hp * effDps(b, a);
  if (sb <= 0) return a.hp > 0 ? Infinity : 1;
  const sa = a.hp * effDps(a, b);
  return Math.sqrt(sa / sb);
}

/** Scalar strength of a force (for thresholds), in "warrior" units. */
export function forcePower(f) {
  return Math.sqrt(Math.max(0, f.hp) * Math.max(0, f.dpsG)) / 80;
}

// ------------------------------------------------------------- abilities

/**
 * Static profile of an ability (cached): what it does, where it lands and
 * how big it is. Used by the casting logic to score candidate targets.
 */
export function abilityProfile(ab) {
  let p = abilityCache.get(ab.id);
  if (p) return p;
  const effs = ab.effects || [];
  const has = (t) => effs.some((e) => e.type === t);
  const moves = has('blink') ? 'blink' : has('dash') ? 'dash' : null;
  let radius = 0;
  let lineLen = 0;
  let lineWidth = 0;
  let harmful = false;
  let helpful = false;
  let friendlyFire = false;
  for (const e of effs) {
    const harm = HARMFUL.has(e.type) || (e.type === 'buff' && e.amount < 0) || (e.type === 'field' && (e.dps > 0 || e.slowPct > 0));
    if (harm) harmful = true;
    if (!harm && e.type !== 'blink' && e.type !== 'reveal') helpful = true;
    if (harm && e.affects === 'all') friendlyFire = true;
    if (e.type === 'line') {
      lineLen = Math.max(lineLen, e.length || ab.range || 6);
      lineWidth = Math.max(lineWidth, e.width || 1.5);
    } else if (e.type === 'dash') {
      lineWidth = Math.max(lineWidth, e.width || 1.5);
    } else {
      radius = Math.max(radius, e.radius || 0);
    }
  }
  p = {
    id: ab.id,
    ab,
    use: (ab.ai && ab.ai.use) || (has('heal') ? 'heal' : has('summon') ? 'summon' : harmful ? 'damage' : 'buff'),
    target: ab.target,
    range: ab.range || 0,
    cooldown: ab.cooldown || 0,
    unlock: ab.unlockLevel || 1,
    moves,
    radius,
    lineLen,
    lineWidth,
    harmful,
    helpful,
    friendlyFire,
    ultimate: (ab.cooldown || 0) >= 55,
    effects: effs,
  };
  abilityCache.set(ab.id, p);
  return p;
}

// ------------------------------------------------------------- god roles

/** Scores of a god type for the roles the AI wants to fill. */
export function godRoles(def) {
  let damage = 0;
  let heal = 0;
  let support = 0;
  let summon = 0;
  for (const ab of def.abilities) {
    for (const e of ab.effects) {
      const r = Math.max(1, e.radius || 0);
      switch (e.type) {
        case 'damage': damage += (e.amount || 0) * (e.radius > 0 ? 1 + r * 0.35 : 0.8); break;
        case 'chain': damage += (e.amount || 0) * (1 + (e.bounces || 3) * 0.6); break;
        case 'line': damage += (e.amount || 0) * 1.9; break;
        case 'dash': damage += (e.amount || 0) * 1.2; break;
        case 'dot': damage += (e.dps || 0) * (e.duration || 0) * (1 + r * 0.3); break;
        case 'field': damage += (e.dps || 0) * (e.duration || 0) * 0.9; heal += (e.hps || 0) * (e.duration || 0) * 1.5; break;
        case 'heal': heal += (e.amount || 0) * (e.radius > 0 ? 1 + r * 0.3 : 1); break;
        case 'shield': support += (e.amount || 0) * (e.affects === 'self' ? 0.4 : 1); break;
        case 'buff': if (e.amount > 0 && e.affects !== 'self') support += 120; break;
        case 'invulnerable': support += 150; break;
        case 'summon': {
          // Summoned fighters deal damage too (worth their strength for their lifetime).
          const inf = unitInfo(e.unit);
          summon += (e.count || 1) * (inf ? inf.str : 40) * (Math.min(e.duration || 30, 40) / 30) * 1.5;
          break;
        }
        default: break;
      }
    }
  }
  for (const p of def.passives || []) {
    if (p.type !== 'aura' || p.affects === 'enemies' || !(p.amount > 0)) continue;
    const per = p.stat === 'armor' ? 40 : p.stat === 'regen' ? 30 : p.stat === 'speed' ? 300 : 1000; // damage / attackSpeed
    support += p.amount * per;
  }
  const atk = def.attack;
  const dps = atk ? atk.damage / atk.cooldown : 0;
  const ranged = !!atk && atk.range > 1.5;
  return {
    damage: damage + summon + dps * 6 + (ranged ? 60 : 0),
    heal: heal + support * 0.6,
    tank: def.hp * 0.25 + (def.armor || 0) * 30 + (ranged ? 0 : 80),
    summon,
    ranged,
  };
}

/** Lists of a pantheon's producible types, sorted, for production planning. */
export function pantheonRoster(pantheonId) {
  return {
    gods: godsFor(pantheonId).map((g) => g.id),
    creatures: creaturesFor(pantheonId).slice().sort((a, b) => a.tier - b.tier).map((c) => c.id),
    titan: titanFor(pantheonId) ? titanFor(pantheonId).id : null,
  };
}
