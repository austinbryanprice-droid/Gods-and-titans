// AI production planning: worshippers, tier upgrades, gods (by role, with
// revives), the Titan, a mixed army from the Barracks and Shrine, and building
// upgrades from a surplus.
import { BUILDINGS, UPGRADES, getUnitType } from '../data/index.js';
import { reviveMult } from '../data/upgrades.js';
import { MAX_GODS, GOD_SLOT_TIER, MAX_QUEUE, POP_MAX } from '../config.js';
import { countOf, doneOf } from './scan.js';
import { unitInfo, godRoles } from './unit-info.js';
import { workerNeed } from './economy.js';

/** What reviving a fallen god costs this player: the usual share of its price, less with Hindu Samsara. */
function reviveCost(cost, mods) {
  const m = reviveMult(mods);
  return {
    gold: Math.round((cost.gold || 0) * m),
    wood: Math.round((cost.wood || 0) * m),
    faith: Math.round((cost.faith || 0) * m),
  };
}

/** Order in which this AI wants its gods: damage dealer, then healer/support, then the rest. */
export function godPlan(ai) {
  if (ai._godPlan) return ai._godPlan;
  const gods = ai.roster.gods.map((id) => ({ id, r: godRoles(getUnitType(id)) }));
  const rng = ai.rng;
  const pickBy = (key, pool, jitter) => {
    let best = null;
    let bestV = -Infinity;
    for (const g of pool) {
      const v = g.r[key] * (1 + (rng.next() - 0.5) * jitter);
      if (v > bestV) {
        bestV = v;
        best = g;
      }
    }
    return best;
  };
  const pool = gods.slice();
  const take = (g) => pool.splice(pool.indexOf(g), 1);
  const jitter = ai.prof.godJitter;
  const first = pickBy('damage', pool, jitter);
  take(first);
  const second = pickBy('heal', pool, jitter);
  take(second);
  // Third: a tank if the first two are fragile, otherwise the strongest remaining.
  const third = pickBy(first.r.ranged && second.r.ranged ? 'tank' : 'damage', pool, jitter);
  take(third);
  ai._godPlan = [first.id, second.id, third.id, ...pool.map((g) => g.id)];
  return ai._godPlan;
}

/** Army roles currently fielded (pop-weighted), for picking what to train next. */
function armyMix(s) {
  const mix = { melee: 0, ranged: 0, aa: 0, support: 0, siege: 0, air: 0, total: 0 };
  const addType = (type, n) => {
    const inf = unitInfo(type);
    if (!inf || inf.cls === 'worker' || inf.cls === 'god' || inf.cls === 'titan') return;
    const w = inf.pop * n;
    mix.total += w;
    if (inf.cls === 'support') mix.support += w;
    else if (inf.cls === 'siege') mix.siege += n;
    else if (inf.melee) mix.melee += w;
    else mix.ranged += w;
    if (inf.hitsAir && !inf.melee) mix.aa += w;
    if (inf.air) mix.air += w;
  };
  for (const [type, n] of s.alive) addType(type, n);
  for (const [type, n] of s.queued) addType(type, n);
  return mix;
}

/** Enemy air share (pop) of the strongest / targeted enemy. */
function enemyAirShare(s) {
  let air = 0;
  let total = 0;
  for (const e of s.enemies) {
    if (e.defeated) continue;
    air += e.air;
    total += e.force.pop;
  }
  return total > 0 ? air / total : 0;
}

/** What the Barracks should train next. */
function barracksPick(ai, s, mix, tier) {
  const airShare = enemyAirShare(s);
  const enemyTowers = s.enemies.reduce((n, e) => n + (e.defeated ? 0 : e.towers), 0);
  if (tier >= 2) {
    const wantPriests = Math.min(4, Math.floor(mix.total / 14));
    if ((s.alive.get('priest') || 0) + (s.queued.get('priest') || 0) < wantPriests) return 'priest';
    // Rams only once the army is big and there is something worth breaking.
    let wantRams = 0;
    if (mix.total >= 24 && (s.t > 720 || enemyTowers >= 3)) wantRams = 1 + (enemyTowers >= 3 ? 1 : 0) + (s.t > 1200 ? 1 : 0);
    if (countOf(s, 'battering_ram') < wantRams) return 'battering_ram';
  }
  const rangedWant = 0.42 + airShare * 0.5;
  const rangedShare = mix.total > 0 ? mix.ranged / mix.total : 0;
  const needRanged = rangedShare < rangedWant;
  // The pantheon's own soldier takes up to 45% of the army when it fills the role being asked for.
  const elite = ai.roster.elite ? unitInfo(ai.roster.elite) : null;
  if (elite && tier >= elite.tier && elite.melee !== needRanged && countOf(s, elite.id) * elite.pop < mix.total * 0.45) return elite.id;
  return needRanged ? 'archer' : 'warrior';
}

/** What the Shrine should summon next (highest tier with a mix of lower ones). */
function shrinePick(ai, s, tier) {
  const cr = ai.roster.creatures.map((id) => getUnitType(id)).filter((d) => d && d.tier <= tier);
  if (!cr.length) return null;
  const airShare = enemyAirShare(s);
  // Weights: favour the top tier; vs air prefer creatures that hit air.
  let best = null;
  let bestScore = -Infinity;
  for (const d of cr) {
    const inf = unitInfo(d.id);
    const have = countOf(s, d.id);
    let w = d.tier === tier ? 3 : d.tier === tier - 1 ? 1.6 : 1;
    if (airShare > 0.25) w *= inf.hitsAir ? 1.6 : 0.5;
    const score = w / (1 + have * d.pop * 0.25) + ai.rng.next() * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = d.id;
    }
  }
  return best;
}

/**
 * Add training / summoning / tier-up wants for this think.
 */
export function planProduction(ai, s, wants) {
  const prof = ai.prof;
  const p = s.p;
  const t = s.t;
  const tier = p.tier;
  const underThreat = !!ai.threat;
  const workerWant = workerNeed(ai, s); // worshippers the mines, wood line and prayer slots can use

  // ---- Tier upgrades (queued behind the worshipper in training; the TC stops training while it grows)
  const mainTc = s.tcs.length ? s.tcs.reduce((a, b) => (b.tier > a.tier ? b : a)) : null;
  let growing = s.tierUp;
  if (mainTc && !s.tierUp && mainTc.queue.length < MAX_QUEUE) {
    const up = (BUILDINGS.town_center.tierUpgrades || [])[mainTc.tier];
    if (up && (up.requires || []).every((r) => doneOf(s, r))) {
      let ok = false;
      if (up.toTier === 2) ok = t >= prof.tier2At && s.workers.length >= Math.min(12, prof.workers - 2, workerWant) && doneOf(s, 'barracks') > 0;
      else if (up.toTier === 3) ok = t >= prof.tier3At && s.gods.length >= 1 && s.workers.length >= Math.min(16, prof.workers - 4, workerWant);
      if (ok && !underThreat) {
        growing = true;
        wants.push({
          prio: 83,
          cost: up.cost,
          reserve: true,
          label: `tier${up.toTier}`,
          run: () => {
            ai.issue({ type: 'upgradeTier', building: mainTc.id });
            return true;
          },
        });
      }
    }
  }

  // ---- Worshippers
  const workerCount = s.workers.length + (s.queued.get('worshipper') || 0);
  let workerTarget = workerWant;
  if (ai.pairs.length === 0 && !ai.woodSpot) workerTarget = Math.min(workerTarget, s.workers.length);
  for (const tc of s.tcs) {
    if (workerCount >= workerTarget) break;
    if (tc.queue.some((q) => q.u === 'tier_up') || (growing && tc === mainTc)) continue;
    const queued = tc.queue.length;
    if (queued >= prof.tcQueue) continue;
    const short = workerTarget - workerCount;
    for (let k = queued; k < Math.min(prof.tcQueue, queued + short); k++) {
      wants.push(trainWant(ai, s, workerCount < 10 ? 95 : underThreat ? 70 : 88, tc, 'worshipper', true));
    }
  }

  // ---- Gods (revive first, then new ones in plan order)
  const temples = (s.done.get('temple') || []).filter((b) => b.queue.length < MAX_QUEUE && !b.queue.some((q) => q.u));
  const temple = temples[0] || null;
  if (temple) {
    const godsNow = s.gods.length + s.queuedGods;
    const slotTier = GOD_SLOT_TIER[godsNow] || 99;
    if (godsNow < MAX_GODS && tier >= slotTier) {
      const fallen = Object.keys(p.fallen || {});
      let pick = null;
      let cost = null;
      if (fallen.length) {
        // Revive the highest level fallen god.
        fallen.sort((a, b) => (p.fallen[b].level || 1) - (p.fallen[a].level || 1) || (a < b ? -1 : 1));
        pick = fallen[0];
        cost = reviveCost(getUnitType(pick).cost, p.mods);
      } else {
        const plan = godPlan(ai);
        const have = new Set([...s.gods.map((g) => g.type), ...temple.queue.map((q) => q.u)]);
        for (const b of s.done.get('temple') || []) for (const q of b.queue) have.add(q.u);
        pick = plan.find((id) => !have.has(id)) || null;
        cost = pick ? getUnitType(pick).cost : null;
      }
      if (pick) {
        const def = getUnitType(pick);
        wants.push({
          prio: 81,
          cost,
          pop: def.pop,
          reserve: true,
          label: `god:${pick}`,
          run: () => {
            ai.issue({ type: 'train', building: temple.id, unit: pick });
            s.queuedGods++;
            return true;
          },
        });
      }
    }
  }

  // ---- Titan
  const gate = (s.done.get('titan_gate') || [])[0];
  if (gate && ai.roster.titan && countOf(s, ai.roster.titan) === 0 && gate.queue.length === 0) {
    const def = getUnitType(ai.roster.titan);
    wants.push({
      prio: 80,
      cost: def.cost,
      pop: def.pop,
      reserve: true,
      label: 'titan',
      run: () => {
        ai.issue({ type: 'train', building: gate.id, unit: def.id });
        return true;
      },
    });
  }

  // ---- Army (leaving population room for the gods and the Titan still to come)
  const heroes = s.gods.length + s.queuedGods;
  const titanHave = ai.roster.titan ? countOf(s, ai.roster.titan) : 1;
  const heroReserve = Math.max(0, MAX_GODS - heroes) * 5 + (tier >= 2 && !titanHave ? 10 : 0);
  let popRoom = POP_MAX - heroReserve - p.popUsed;
  if (s.armyPop < prof.armyCap && popRoom > 0) {
    const mix = armyMix(s);
    const prio = underThreat ? 87 : s.armyPop < 10 && t > 240 ? 72 : 60;
    const depth = prof.prodQueue + (p.gold > 900 ? 1 : 0);
    for (const b of s.done.get('barracks') || []) {
      for (let k = b.queue.length; k < depth; k++) {
        const pick = barracksPick(ai, s, mix, tier);
        if (!pick || (getUnitType(pick).tier || 1) > tier) continue;
        if (getUnitType(pick).pop > popRoom) continue;
        popRoom -= getUnitType(pick).pop;
        wants.push(trainWant(ai, s, prio, b, pick, false));
        const inf = unitInfo(pick);
        mix.total += inf.pop;
        if (inf.cls === 'support') mix.support += inf.pop;
        else if (inf.melee) mix.melee += inf.pop;
        else mix.ranged += inf.pop;
        s.queued.set(pick, (s.queued.get(pick) || 0) + 1);
      }
    }
    for (const b of s.done.get('shrine') || []) {
      for (let k = b.queue.length; k < depth; k++) {
        const pick = shrinePick(ai, s, tier);
        if (!pick || getUnitType(pick).pop > popRoom) continue;
        popRoom -= getUnitType(pick).pop;
        wants.push(trainWant(ai, s, prio + 1, b, pick, false));
        s.queued.set(pick, (s.queued.get(pick) || 0) + 1);
      }
    }
  }
}

// Building upgrades the AI researches, in order, one at a time and only from a surplus
// (they share the queues with the army).
export const RESEARCH_ORDER = [
  'tc_iron_picks', 'storehouse_sharp_axes', 'tc_work_songs', 'barracks_bronze_weapons', 'tower_burning_arrows',
  'shrine_sacred_chants', 'tc_hearty_meals', 'house_stone_walls', 'temple_incense', 'barracks_hoplite_shields',
  'storehouse_handcarts', 'tc_master_craftsmen', 'shrine_blessed_beasts', 'temple_divine_favor', 'tc_healing_herbs',
  'tc_palisade', 'house_large_families', 'barracks_drill_yard', 'tower_iron_bracing', 'tower_lookout',
  'tc_tireless_devotion', 'temple_rite_of_ascension', 'tc_blessed_vigor', 'titan_gate_primordial_bond', 'titan_gate_widened_rift',
];
const RESEARCH_FROM = { t: 300, gold: 500, wood: 300 };

/** Want the next building upgrade on the list when the bank is full and nothing threatens. */
export function planResearch(ai, s, wants) {
  const p = s.p;
  if (ai.threat || s.t < RESEARCH_FROM.t || p.gold < RESEARCH_FROM.gold || p.wood < RESEARCH_FROM.wood) return;
  for (const list of s.done.values()) {
    for (const b of list) if (b.queue.some((q) => Object.hasOwn(UPGRADES, q.u))) return;
  }
  for (const id of RESEARCH_ORDER) {
    const up = UPGRADES[id];
    if (!up || p.upgrades[id] || up.tier > p.tier || (up.after && !p.upgrades[up.after])) continue;
    const at = (s.done.get(up.building) || []).find((b) => b.queue.length === 0);
    if (!at) continue;
    wants.push({
      prio: 50,
      cost: up.cost,
      reserve: false,
      label: `research:${id}`,
      run: () => {
        ai.issue({ type: 'research', building: at.id, upgrade: id });
        return true;
      },
    });
    return;
  }
}

function trainWant(ai, s, prio, b, unit, reserve) {
  const def = getUnitType(unit);
  return {
    prio,
    cost: def.cost,
    pop: def.pop,
    reserve,
    label: unit,
    run: () => {
      ai.issue({ type: 'train', building: b.id, unit });
      return true;
    },
  };
}
