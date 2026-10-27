// Command card (DESIGN 9): the 4×3 grid of buttons for the current selection.
// Pure function of the selection, the ViewState and the card mode, so it can be
// unit-tested in Node and recomputed cheaply every HUD refresh.
//
//   getCommandCard(selection, viewState, mode) → Array(12) of Button | null
//
// selection: { ids: number[], activeType?: string } (or a plain id array).
// mode: 'root' | 'build' (worker build submenu) | 'target' | 'place'
//       (or an object with a `kind` field holding one of those).
//
// Button = {
//   slot, id, key ('M', 'Escape', …), keyLabel, icon, title, description,
//   enabled,            // true when clicking does something now
//   state,              // 'ready' | 'cooldown' | 'unaffordable' | 'locked' | 'disabled' | 'passive' | 'active'
//   reason,             // why it is not ready (error text), else null
//   cost,               // { gold, wood, faith, pop, time } or null
//   cooldown, cooldownLeft, // fraction 0..1 and seconds of the ability cooldown
//   queued,             // how many of this unit are queued in the selected buildings
//   autocast, level,    // ability extras: autocast on for the whole group, unlock level
//   toggle,             // right-click action (ability autocast on/off), else null
//   action,             // what input.js does: { kind: 'move' | 'stop' | … }
// }
import {
  MAX_QUEUE, MAX_GODS, MAX_TITANS, GOD_SLOT_TIER, CANCEL_BUILD_REFUND, ABILITY_LEVEL_SCALE,
  MINE_SLOTS, DROPOFF_MINE_GAP, REPAIR_COST, AUTO_REPAIR_RANGE, POP_MAX, WALL_REMOVE_REFUND,
} from '../config.js';
import { UNITS, BUILDINGS, BUILD_MENU, producibleAt, eliteFor } from '../data/index.js';
import { offeredUpgrades, lineOf, getUpgrade, reviveMult } from '../data/upgrades.js';
import { MANOR, MERGE_TEXT, mergeRule, planMerges } from '../data/houses.js';
import { selectionIds, subgroups, isComplete, isMergingEntity, ownBuildings, tierName, upgradesOf, modsOf, pantheonOf, mineTripText } from './hud-data.js';

export const CARD_SLOTS = 12;

const ABILITY_SLOT = { Q: 8, W: 9, E: 10, R: 11 };
const BARRACKS_KEYS = { warrior: 'W', archer: 'A', priest: 'P', battering_ram: 'R' };
const ELITE_KEY = 'E'; // the pantheon's own soldier, the fifth Barracks unit
const CREATURE_KEYS = ['Q', 'W', 'E'];
const GOD_KEYS = ['Q', 'W', 'E', 'R'];
const PASSIVE_ICONS = {
  aura: '🔆', regen: '💚', lifesteal: '🧛', cleave: '🔪', thorns: '🌵', evasion: '💨', critical: '💥', onHitSlow: '🐌', onHitDot: '☠️',
};
const TARGET_TEXT = { none: 'No target', point: 'Targets an area', unit: 'Targets a unit', ally: 'Targets an ally', enemy: 'Targets an enemy' };

/** The description without a sentence the red reason line already says ("Requires City."). */
function withoutReason(description, reason) {
  const d = description || '';
  if (!reason || !d.includes(reason)) return d;
  return d.replace(reason, '').replace(/\s{2,}/g, ' ').trim();
}

function button(slot, o) {
  return {
    slot,
    id: o.id,
    key: o.key || null,
    keyLabel: o.key === 'Escape' ? 'Esc' : o.key || '',
    icon: o.icon || '❔',
    title: o.title || '',
    description: withoutReason(o.description, o.reason),
    enabled: o.state === 'ready' || o.state === 'active' || o.state === undefined,
    state: o.state || 'ready',
    reason: o.reason || null,
    cost: o.cost || null,
    cooldown: o.cooldown || 0,
    cooldownLeft: o.cooldownLeft || 0,
    queued: o.queued || 0,
    autocast: !!o.autocast,
    toggle: o.toggle || null,
    level: o.level || 0,
    passive: !!o.passive,
    action: o.action || null,
  };
}

const emptyCard = () => new Array(CARD_SLOTS).fill(null);

function cancelButton(title = 'Cancel', description = 'Cancel this order.') {
  return button(11, { id: 'cancel', key: 'Escape', icon: '✖', title, description, action: { kind: 'cancel' } });
}

/** Error text when resources are short (same wording as the sim). */
export function affordReason(me, cost) {
  if (!me || !cost) return null;
  if ((me.gold ?? 0) < (cost.gold || 0)) return 'Not enough gold.';
  if ((me.wood ?? 0) < (cost.wood || 0)) return 'Not enough wood.';
  if ((me.faith ?? 0) < (cost.faith || 0)) return 'Not enough faith.';
  return null;
}

function popReason(me, pop) {
  if (!me || !(pop > 0) || me.pop + pop <= me.popCap) return null;
  return me.popCap >= POP_MAX ? `Population limit reached (${POP_MAX}).` : 'Not enough population. Build more Houses.';
}

function requiresText(typeId) {
  const b = BUILDINGS[typeId];
  return `Requires a ${b ? b.name : typeId}.`;
}

function tierReason(tier) {
  return tier >= 3 ? 'Requires City.' : 'Requires Town.';
}

function hasCompleted(vs, typeId) {
  return ownBuildings(vs, typeId, true).length > 0;
}

/** All own queue items (for god / titan counting). */
function ownQueueItems(vs) {
  const out = [];
  for (const b of ownBuildings(vs)) for (const q of b.q || []) out.push(q.u);
  return out;
}

/** Gods alive + queued for the local player. */
export function godCount(vs) {
  const me = vs.me;
  let n = me && me.gods ? me.gods.length : 0;
  for (const u of ownQueueItems(vs)) if (UNITS[u] && UNITS[u].class === 'god') n++;
  return n;
}

function titanCount(vs) {
  const me = vs.me;
  let n = me && me.titan ? 1 : 0;
  for (const u of ownQueueItems(vs)) if (UNITS[u] && UNITS[u].class === 'titan') n++;
  return n;
}

function hasGodAliveOrQueued(vs, typeId) {
  const me = vs.me;
  if (me && me.gods && me.gods.includes(typeId)) return true;
  return ownQueueItems(vs).includes(typeId);
}

function scaled(cost, mult) {
  return {
    gold: Math.round((cost.gold || 0) * mult),
    wood: Math.round((cost.wood || 0) * mult),
    faith: Math.round((cost.faith || 0) * mult),
  };
}

/**
 * Can the local player queue `unitId` at one of `buildings` right now?
 * @returns {{ state: string, reason: string|null, cost: object, revive: number|null }}
 */
export function trainCheck(vs, unitId, buildings) {
  const me = vs.me;
  const def = UNITS[unitId];
  const fallenLevel = def && def.class === 'god' && me && me.fallen ? me.fallen[unitId] : undefined;
  const revive = fallenLevel !== undefined && fallenLevel !== null ? fallenLevel : null;
  const reviveShare = reviveMult(modsOf(vs, vs.myIndex));
  const base = def ? (revive !== null ? scaled(def.cost, reviveShare) : { gold: def.cost.gold || 0, wood: def.cost.wood || 0, faith: def.cost.faith || 0 }) : {};
  const cost = { ...base, pop: def ? def.pop : 0, time: def ? def.buildTime * (revive !== null ? reviveShare : 1) : 0 };
  const out = (state, reason) => ({ state, reason, cost, revive });
  if (!def || !me) return out('disabled', null);
  const ready = buildings.filter((b) => isComplete(b));
  if (!ready.length) return out('disabled', null);
  const free = ready.filter((b) => !(b.q || []).some((q) => q.u === 'tier_up'));
  if (!free.length) return out('disabled', 'Your settlement is already growing.');
  if (free.every((b) => (b.q || []).length >= MAX_QUEUE)) return out('disabled', 'Production queue is full.');
  if (def.class === 'god') {
    if (hasGodAliveOrQueued(vs, unitId)) return out('locked', 'You already have that god.');
    const n = godCount(vs);
    if (n >= MAX_GODS) return out('locked', `You can only have ${MAX_GODS} gods.`);
    const need = GOD_SLOT_TIER[n] || 3;
    if ((me.tier || 1) < need) return out('locked', `Your next god requires ${need >= 3 ? 'City' : 'Town'}.`);
  } else if (def.class === 'titan') {
    if (titanCount(vs) >= MAX_TITANS) return out('locked', 'You already have a Titan.');
    if (def.tier > (me.tier || 1)) return out('locked', tierReason(def.tier));
  } else if (def.tier > (me.tier || 1)) {
    return out('locked', tierReason(def.tier));
  }
  const a = affordReason(me, cost);
  if (a) return out('unaffordable', a);
  const p = popReason(me, def.pop);
  if (p) return out('unaffordable', p);
  return out('ready', null);
}

/** The building of a group that should take the next train order (shortest queue). */
export function pickTrainBuilding(buildings) {
  let best = null;
  for (const b of buildings) {
    if (!isComplete(b)) continue;
    const q = b.q || [];
    if (q.some((it) => it.u === 'tier_up') || q.length >= MAX_QUEUE) continue;
    if (!best || q.length < (best.q || []).length) best = b;
  }
  return best;
}

/** Can the local player build `typeId` (ignoring placement)? */
export function buildCheck(vs, typeId) {
  const me = vs.me;
  const def = BUILDINGS[typeId];
  const cost = def ? { gold: def.cost.gold || 0, wood: def.cost.wood || 0, faith: def.cost.faith || 0, pop: 0, time: def.buildTime } : null;
  if (!def || !me) return { state: 'disabled', reason: null, cost };
  if (def.tier > (me.tier || 1)) return { state: 'locked', reason: tierReason(def.tier), cost };
  for (const req of def.requires || []) {
    if (!hasCompleted(vs, req)) return { state: 'locked', reason: requiresText(req), cost };
  }
  const a = affordReason(me, cost);
  if (a) return { state: 'unaffordable', reason: a, cost };
  return { state: 'ready', reason: null, cost };
}

/**
 * Can the local player research upgrade `up` at one of `buildings` now?
 * state 'passive' = already researched.
 * @returns {{ state: string, reason: string|null, cost: object, queued: number }}
 */
export function researchCheck(vs, up, buildings) {
  const me = vs.me;
  const cost = { gold: up.cost.gold || 0, wood: up.cost.wood || 0, faith: up.cost.faith || 0, pop: 0, time: up.time };
  let queued = 0;
  for (const b of ownBuildings(vs)) for (const q of b.q || []) if (q.u === up.id) queued++;
  const res = (state, reason) => ({ state, reason, cost, queued });
  if (!me) return res('disabled', null);
  const owned = upgradesOf(vs, vs.myIndex);
  if (owned.includes(up.id)) return res('passive', null);
  if (queued) return res('disabled', 'Already being researched.');
  if (up.after && !owned.includes(up.after)) return res('locked', `Requires ${getUpgrade(up.after).name}.`);
  if (up.tier > (me.tier || 1)) return res('locked', tierReason(up.tier));
  const ready = buildings.filter((b) => isComplete(b));
  if (!ready.length) return res('disabled', null);
  const free = ready.filter((b) => !(b.q || []).some((q) => q.u === 'tier_up'));
  if (!free.length) return res('disabled', 'Your settlement is already growing.');
  if (free.every(isMergingEntity)) return res('disabled', 'That House is being combined into a Manor.');
  if (free.every((b) => (b.q || []).length >= MAX_QUEUE)) return res('disabled', 'Production queue is full.');
  const a = affordReason(me, cost);
  if (a) return res('unaffordable', a);
  return res('ready', null);
}

/** Tier-up check for a Town Center view entity. */
export function tierUpCheck(vs, tc) {
  const up = (BUILDINGS.town_center.tierUpgrades || [])[tc.tr || 1];
  if (!up) return null;
  const cost = { gold: up.cost.gold || 0, wood: up.cost.wood || 0, faith: up.cost.faith || 0, pop: 0, time: up.time };
  const res = (state, reason) => ({ state, reason, cost, up });
  if (!isComplete(tc)) return res('disabled', null);
  const growing = ownBuildings(vs).some((b) => (b.q || []).some((q) => q.u === 'tier_up'));
  if (growing) return res('disabled', 'Your settlement is already growing.');
  for (const req of up.requires || []) {
    if (!hasCompleted(vs, req)) return res('locked', requiresText(req));
  }
  if ((tc.q || []).length >= MAX_QUEUE) return res('disabled', 'Production queue is full.');
  const a = affordReason(vs.me, cost);
  if (a) return res('unaffordable', a);
  return res('ready', null);
}

function describeUnit(def) {
  const parts = [];
  if (def.title) parts.push(def.title + '.');
  if (def.description) parts.push(def.description);
  return parts.join(' ');
}

/** Short text for a passive without a written description. */
export function describePassive(p) {
  const pct = (v) => `${Math.round((v || 0) * 100)}%`;
  switch (p.type) {
    case 'aura': {
      const stat = { damage: 'damage', armor: 'armor', speed: 'movement speed', attackSpeed: 'attack speed', regen: 'health regeneration' }[p.stat] || p.stat;
      const amount = p.stat === 'armor' || p.stat === 'regen' ? `${p.amount > 0 ? '+' : ''}${p.amount}` : `${p.amount > 0 ? '+' : ''}${pct(p.amount)}`;
      return `Aura: ${amount} ${stat} to ${p.affects === 'enemies' ? 'enemies' : 'allies'} within ${p.radius} tiles.`;
    }
    case 'regen': return `Regenerates ${p.hps} health per second.`;
    case 'lifesteal': return `Heals for ${pct(p.pct)} of attack damage dealt.`;
    case 'cleave': return `Attacks also hit enemies within ${p.radius} tiles of the target for ${pct(p.pct)} damage.`;
    case 'thorns': return `Reflects ${pct(p.pct)} of melee damage taken.`;
    case 'evasion': return `${pct(p.pct)} chance to dodge attacks.`;
    case 'critical': return `${pct(p.chance)} chance to deal ${p.mult}× damage.`;
    case 'onHitSlow': return `Attacks slow the target by ${pct(p.pct)} for ${p.duration} s.`;
    case 'onHitDot': return `Attacks deal ${p.dps} damage per second for ${p.duration} s.`;
    default: return '';
  }
}

const REPAIR_TEXT = `Mend a damaged building. A full repair costs ${Math.round(REPAIR_COST * 100)}% of the building's cost, paid as it heals; more Worshippers repair faster.`;
const AUTO_REPAIR_TEXT = `Idle Worshippers repair damaged buildings within ${AUTO_REPAIR_RANGE} tiles by themselves. Applies to all your Worshippers.`;

const gatherText = (mods) => `Mine gold from a gold mine or chop wood from a forest. Up to ${MINE_SLOTS} Worshippers mine one gold mine at a time (${mineTripText(mods)}); the others wait their turn, so about 5–6 per mine is plenty.`;

/** "Shrine 0.5/s, Temple 0.7/s per worshipper, 5 at a time" from the building data. */
function prayText() {
  const parts = ['shrine', 'temple'].map((id) => BUILDINGS[id]).filter((b) => b && b.faithRate > 0)
    .map((b) => `${b.name} ${b.faithRate}/s`);
  const slots = [...new Set(['shrine', 'temple'].map((id) => BUILDINGS[id] && BUILDINGS[id].prayerSlots).filter((n) => n > 0))];
  return `Kneel at a Shrine or Temple to earn Faith (${parts.join(', ')} per worshipper, ${slots.join(' or ')} at a time).`;
}
const PRAY_TEXT = prayText();

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th'];
const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth'];
/** "2nd needs Town, 3rd needs City" from GOD_SLOT_TIER. */
const GOD_SLOT_TEXT = GOD_SLOT_TIER.slice(0, MAX_GODS).map((t, i) => (t > 1 ? `${ORDINALS[i]} needs ${tierName(t)}` : null)).filter(Boolean).join(', ') || 'no tier needed';

function costShare(mult) {
  if (Math.abs(mult - 0.5) < 1e-9) return 'half';
  return `${Math.round(mult * 100)}% of`;
}

/** Building tooltip text: the data description plus the placement rule for drop-offs. */
export function buildingDescription(typeId) {
  const b = BUILDINGS[typeId];
  if (!b) return '';
  let text = b.description || '';
  if (b.dropOff) text += ` Must stay ${DROPOFF_MINE_GAP} tiles away from gold mines.`;
  return text;
}

/** What growing to `tier` unlocks, from the data (units, creatures, buildings, god slots). */
export function tierUnlocks(tier, pantheon = null) {
  const parts = [];
  const elite = pantheon ? eliteFor(pantheon) : null;
  const mortals = [...Object.values(UNITS).filter((u) => !u.pantheon && u.producedAt && u.tier === tier), ...(elite && elite.tier === tier ? [elite] : [])]
    .map((u) => u.plural || `${u.name}s`);
  if (mortals.length) parts.push(mortals.join(' and '));
  const blds = Object.values(BUILDINGS).filter((b) => b.tier === tier).map((b) => `the ${b.name}`);
  if (blds.length) parts.push(blds.join(' and '));
  const creatures = pantheon ? producibleAt('shrine', pantheon).map((id) => UNITS[id]).filter((u) => u && u.tier === tier) : [];
  if (creatures.length) parts.push(creatures.map((u) => `the ${u.name}`).join(' and '));
  else parts.push(`tier-${tier} creatures`);
  const slot = GOD_SLOT_TIER.slice(0, MAX_GODS).findIndex((t) => t === tier);
  if (slot >= 0) parts.push(`a ${ORDINAL_WORDS[slot] || ORDINALS[slot]} god`);
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// Effect amounts that grow with a god's level (sim/abilities.js multiplies these by abilityScale).
const SCALED = {
  damage: (e, k) => `${r0(e.amount * k)} damage`,
  heal: (e, k) => `${r0(e.amount * k)} healing`,
  dot: (e, k) => `${r0((e.dps || 0) * k)} damage/s`,
  field: (e, k) => [e.dps ? `${r0(e.dps * k)} damage/s` : null, e.hps ? `${r0(e.hps * k)} healing/s` : null].filter(Boolean).join(', '),
  chain: (e, k) => `${r0(e.amount * k)} chain damage`,
  line: (e, k) => `${r0(e.amount * k)} damage`,
  dash: (e, k) => (e.amount ? `${r0(e.amount * k)} dash damage` : ''),
  shield: (e, k) => `${r0((e.amount || 0) * k)} shield`,
};
function r0(v) {
  return String(Math.round(v));
}

/**
 * "At level 3 (+20%): 132 damage, 1 stun …" — the ability's level-scaled amounts as
 * the sim applies them (× (1 + ABILITY_LEVEL_SCALE × (level − 1))), or '' when nothing scales.
 */
export function abilityLevelText(ab, level) {
  if (!ab || !(level > 1)) return '';
  const k = 1 + ABILITY_LEVEL_SCALE * (level - 1);
  const seen = new Set();
  const parts = [];
  for (const e of ab.effects || []) {
    const f = SCALED[e.type];
    const t = f ? f(e, k) : '';
    if (t && !seen.has(t)) {
      seen.add(t);
      parts.push(t);
    }
  }
  if (!parts.length) return '';
  return `At level ${level} (+${Math.round((k - 1) * 100)}%): ${parts.join(', ')}.`;
}

const PASSIVE_TITLES = {
  aura: 'Aura', regen: 'Regeneration', lifesteal: 'Lifesteal', cleave: 'Cleave', thorns: 'Thorns', evasion: 'Evasion',
  critical: 'Critical Strike', onHitSlow: 'Crippling Blows', onHitDot: 'Venomous Blows',
};

function unitCard(card, vs, group, ownIds, mode) {
  const units = ownIds.map((id) => vs.entities.get(id)).filter((e) => e && e.k === 'u');
  const activeUnits = group.ids.map((id) => vs.entities.get(id)).filter(Boolean);
  const def = UNITS[group.type];
  const isWorker = def && def.class === 'worker';

  if (mode === 'build' && isWorker) {
    BUILD_MENU.forEach((typeId, i) => {
      const b = BUILDINGS[typeId];
      if (!b || i >= 11) return; // slot 11 is Back
      const chk = buildCheck(vs, typeId);
      card[i] = button(i, {
        id: `build:${typeId}`,
        key: b.hotkey,
        icon: b.icon,
        title: `Build ${b.name}`,
        description: buildingDescription(typeId),
        state: chk.state,
        reason: chk.reason,
        cost: chk.cost,
        action: { kind: 'place', building: typeId },
      });
    });
    card[11] = cancelButton('Back', 'Return to the worker commands.');
    card[11].id = 'back';
    card[11].icon = '↩️';
    card[11].action = { kind: 'back' };
    return card;
  }

  const anyAttack = units.some((u) => UNITS[u.t] && UNITS[u.t].attack);
  card[0] = button(0, { id: 'move', key: 'M', icon: '👣', title: 'Move', description: 'Move to a location or follow a unit, ignoring enemies on the way.', action: { kind: 'target', order: 'move', target: 'point' } });
  card[1] = button(1, { id: 'stop', key: 'S', icon: '✋', title: 'Stop', description: 'Stop the current order.', action: { kind: 'stop' } });
  card[2] = button(2, { id: 'hold', key: 'H', icon: '🛡️', title: 'Hold Position', description: 'Stand still and attack only enemies in range.', action: { kind: 'hold' } });
  if (anyAttack) {
    card[3] = button(3, { id: 'attack', key: 'A', icon: '⚔️', title: 'Attack', description: 'Attack a target, or attack-move: walk to a spot and fight every enemy met on the way.', action: { kind: 'target', order: 'attack', target: 'point' } });
  }

  if (isWorker) {
    const workers = units.filter((u) => UNITS[u.t] && UNITS[u.t].class === 'worker');
    card[4] = button(4, { id: 'gather', key: 'G', icon: '⛏️', title: 'Gather', description: gatherText(modsOf(vs, vs.myIndex)), action: { kind: 'target', order: 'gather', target: 'resource' } });
    const carrying = workers.some((u) => u.c);
    card[5] = button(5, {
      id: 'return', key: 'C', icon: '📥', title: 'Return Resources', description: 'Bring the carried gold or wood to the nearest Town Center or Storehouse.',
      state: carrying ? 'ready' : 'disabled', reason: carrying ? null : 'Not carrying any resources.', action: { kind: 'return' },
    });
    const canPray = hasCompleted(vs, 'shrine') || hasCompleted(vs, 'temple');
    card[6] = button(6, {
      id: 'pray', key: 'P', icon: '🙏', title: 'Pray', description: PRAY_TEXT,
      state: canPray ? 'ready' : 'locked', reason: canPray ? null : 'Requires a Shrine.', action: { kind: 'target', order: 'pray', target: 'prayer' },
    });
    card[7] = button(7, { id: 'repair', key: 'R', icon: '🔧', title: 'Repair', description: REPAIR_TEXT, action: { kind: 'target', order: 'repair', target: 'repair' } });
    card[8] = button(8, { id: 'build', key: 'B', icon: '🔨', title: 'Build', description: 'Open the list of buildings this worshipper can raise.', action: { kind: 'submenu', menu: 'build' } });
    const auto = !!(vs.me && vs.me.ar);
    card[9] = button(9, {
      id: 'auto-repair', key: 'T', icon: '🛠️', title: `Auto-Repair: ${auto ? 'On' : 'Off'}`,
      description: `${AUTO_REPAIR_TEXT} Click to turn it ${auto ? 'off' : 'on'}.`,
      state: auto ? 'active' : 'ready', action: { kind: 'autoRepair', on: !auto },
    });
    return card;
  }

  // Abilities of the active subgroup (bottom row), passives in the middle row.
  if (def) {
    for (const ab of def.abilities || []) {
      const slot = ABILITY_SLOT[ab.key];
      if (slot === undefined) continue;
      let unlockedUnits = activeUnits;
      if (def.class === 'god') unlockedUnits = activeUnits.filter((u) => (u.lv || 1) >= (ab.unlockLevel || 1));
      let left = Infinity;
      for (const u of unlockedUnits) left = Math.min(left, (u.cd && u.cd[ab.id]) || 0);
      if (!Number.isFinite(left)) left = 0;
      let state = 'ready';
      let reason = null;
      if (!unlockedUnits.length) {
        state = 'locked';
        reason = def.class === 'god' && (ab.unlockLevel || 1) > 1 ? `Unlocks at level ${ab.unlockLevel}.` : 'Not unlocked yet.';
      } else if (left > 0) {
        state = 'cooldown';
        reason = 'That ability is not ready.';
      }
      // A selected god that already has the ability does not need its unlock level repeated.
      const lockText = def.class === 'god' && (ab.unlockLevel || 1) > 1 && unlockedUnits.length < activeUnits.length && unlockedUnits.length
        ? ` Unlocks at level ${ab.unlockLevel}.` : '';
      const lv = def.class === 'god' ? Math.max(1, ...activeUnits.map((u) => u.lv || 1)) : 1;
      // Àṣẹ shortens the cooldowns of a blessed pantheon's gods and titans.
      const cooldownTime = def.class === 'god' || def.class === 'titan' ? ab.cooldown * (1 - modsOf(vs, vs.myIndex).perks.cooldown) : ab.cooldown;
      // Autocast mark when every own unit of the group has it on (view key mc: manual bits).
      const bit = 1 << def.abilities.indexOf(ab);
      const mine = activeUnits.filter((u) => u.k === 'u' && u.o === vs.myIndex);
      const autocast = mine.length > 0 && mine.every((u) => !((u.mc || 0) & bit));
      const levelText = lv > 1 ? abilityLevelText(ab, lv) : '';
      card[slot] = button(slot, {
        id: `ability:${ab.id}`,
        key: ab.key,
        icon: ab.icon,
        title: ab.name,
        description: `${ab.description}${lockText}${levelText ? ` ${levelText}` : ''}`,
        state,
        reason,
        cooldown: left > 0 ? Math.min(1, left / cooldownTime) : 0,
        cooldownLeft: left,
        cost: { cooldown: Math.round(cooldownTime * 10) / 10, range: ab.target === 'none' ? 0 : ab.range, target: TARGET_TEXT[ab.target] || '' },
        autocast,
        toggle: mine.length ? { kind: 'autocast', ability: ab.id, unitType: group.type, on: !autocast } : null,
        level: ab.unlockLevel || 1,
        action: { kind: ab.target === 'none' ? 'cast' : 'target', order: 'cast', ability: ab.id, target: ab.target, unitType: group.type },
      });
    }
    const passives = def.passives || [];
    const freeMid = [4, 5, 6, 7].filter((s) => !card[s]);
    passives.slice(0, freeMid.length).forEach((p, i) => {
      const slot = freeMid[i];
      card[slot] = button(slot, {
        id: `passive:${i}`,
        icon: PASSIVE_ICONS[p.type] || '✦',
        title: p.name || PASSIVE_TITLES[p.type] || 'Passive',
        description: p.description || describePassive(p),
        state: 'passive',
        passive: true,
      });
    });
  }
  return card;
}

function trainButton(slot, key, vs, unitId, buildings, verb) {
  const def = UNITS[unitId];
  const chk = trainCheck(vs, unitId, buildings);
  let queued = 0;
  for (const b of buildings) for (const q of b.q || []) if (q.u === unitId) queued++;
  const revive = chk.revive !== null;
  const title = revive ? `Revive ${def.name} (level ${chk.revive})` : `${verb} ${def.name}`;
  let description = describeUnit(def);
  if (def.class === 'god' && !revive) description += ` Gods: ${godCount(vs)}/${MAX_GODS} (${GOD_SLOT_TEXT}).`;
  if (revive) description = `${def.name} fell in battle. Revive for ${costShare(reviveMult(modsOf(vs, vs.myIndex)))} the cost and time, keeping level ${chk.revive}. ${description}`;
  return button(slot, {
    id: `train:${unitId}`,
    key,
    icon: def.icon,
    title,
    description,
    state: chk.state,
    reason: chk.reason,
    cost: chk.cost,
    queued,
    action: { kind: 'train', unit: unitId },
  });
}

/** An upgrade's text, plus a note when it also reaches the player's elite soldier (it counts as a Warrior or an Archer). */
function researchText(vs, up) {
  const elite = eliteFor(pantheonOf(vs, vs.myIndex));
  if (!elite || !up.effects.some((e) => e.type === 'unit' && e.units && e.units.includes(elite.kin))) return up.description;
  return `${up.description} Your ${elite.plural || `${elite.name}s`} count too.`;
}

/** "20 gold and 10 wood" for a cost. */
function costText(c) {
  return ['gold', 'wood', 'faith'].filter((k) => c && c[k] > 0).map((k) => `${c[k]} ${k}`).join(' and ');
}

/**
 * Wall segments (DESIGN 4.3): upgrade wood to stone, take down finished segments, cancel unfinished
 * segments and upgrades in progress. Every button acts on the segments of the active subgroup,
 * which may be dozens.
 */
function wallCard(card, vs, group, buildings) {
  const def = BUILDINGS[group.type];
  const me = vs.me;
  const done = buildings.filter(isComplete);
  const idle = done.filter((b) => !(b.q || []).length);
  const upgrading = done.length - idle.length;
  const unfinished = buildings.length - done.length;
  const up = def.wallUpgrade;
  if (up && done.length) {
    const to = BUILDINGS[up.to];
    const n = idle.length;
    // The sim pays segment by segment until the purse runs short.
    let afford = n;
    for (const k of ['gold', 'wood', 'faith']) if (up.cost[k] > 0) afford = Math.min(afford, Math.floor(((me && me[k]) || 0) / up.cost[k]));
    let state = 'ready';
    let reason = null;
    if (!n) {
      state = 'disabled';
      reason = 'Already being upgraded.';
    } else if (afford < 1) {
      state = 'unaffordable';
      reason = affordReason(me, up.cost);
    }
    let description = `Rebuild in stone while it stands: ${to.hp} health and ${to.armor} armor instead of ${def.hp} and ${def.armor}. ${costText(up.cost)} and ${up.time} seconds for each segment.`;
    if (afford > 0 && afford < n) description += ` You can pay for ${afford} of the ${n} right now.`;
    card[0] = button(0, {
      id: 'wall-upgrade',
      key: 'U',
      icon: to.icon,
      title: n > 1 ? `Upgrade ${n} Segments to ${to.name}` : `Upgrade to ${to.name}`,
      description,
      state,
      reason,
      cost: { gold: (up.cost.gold || 0) * n, wood: (up.cost.wood || 0) * n, faith: (up.cost.faith || 0) * n, pop: 0, time: up.time },
      queued: upgrading,
      action: { kind: 'upgradeWall' },
    });
  }
  if (done.length) {
    card[1] = button(1, {
      id: 'wall-dismantle',
      key: 'D',
      icon: '⛏️',
      title: done.length > 1 ? `Dismantle ${done.length} Segments` : 'Dismantle',
      description: `Take the finished segments down and get back ${Math.round(WALL_REMOVE_REFUND * 100)}% of their cost. Opens a gap in your own wall.`,
      action: { kind: 'dismantleWall' },
    });
  }
  if (unfinished || upgrading) {
    const what = unfinished && upgrading ? 'Construction and Upgrades' : unfinished ? 'Construction' : 'Upgrade';
    const parts = [];
    if (unfinished) parts.push(`Tear down the unfinished segments and get back ${Math.round(CANCEL_BUILD_REFUND * 100)}% of their cost.`);
    if (upgrading) parts.push('Stop the upgrades and get back everything they cost.');
    card[2] = button(2, { id: 'wall-cancel', key: 'C', icon: '✖', title: `Cancel ${what}`, description: parts.join(' '), action: { kind: 'cancelWall' } });
  }
  return card;
}

/**
 * Houses (DESIGN 5.3): four that stand in a square are combined into a Manor, and a combining under way
 * can be cancelled. Both buttons act on the Houses of the active subgroup; the sim finds the squares among
 * them (data/houses.js, the same rule), so the button knows what an order would do before it is given.
 */
function mergeButtons(card, vs, buildings) {
  const me = vs.me;
  const rule = mergeRule();
  const manor = BUILDINGS[MANOR];
  const house = BUILDINGS[rule.building];
  const spot = (b) => ({ id: b.id, tx: b.tx, ty: b.ty });
  const done = buildings.filter(isComplete);
  const plan = planMerges(done.map((b) => ({ ...spot(b), busy: (b.q || []).length > 0 })));
  const merging = done.filter(isMergingEntity).length;
  const squares = Math.ceil(merging / rule.count); // of the selected Houses (a part of a square counts as the square)
  const n = plan.blocks.length;
  let afford = n;
  let state = 'ready';
  let reason = null;
  if (!done.length) state = 'disabled';
  else if (((me && me.tier) || 1) < manor.tier) {
    state = 'locked';
    reason = tierReason(manor.tier);
  } else if (!n) {
    state = 'disabled';
    reason = done.every(isMergingEntity) ? 'Already being combined.' : MERGE_TEXT[plan.reason];
  } else {
    // The sim pays square by square until the purse runs short.
    for (const k of ['gold', 'wood', 'faith']) if (rule.cost[k] > 0) afford = Math.min(afford, Math.floor(((me && me[k]) || 0) / rule.cost[k]));
    if (afford < 1) {
      state = 'unaffordable';
      reason = affordReason(me, rule.cost);
    }
  }
  const count = Math.max(1, n);
  let description = `A square of ${rule.count} ${house.name}s becomes a ${manor.name}: ${manor.popProvided} population instead of the ${rule.count * house.popProvided} they shelter apart, ${manor.hp} health instead of ${rule.count * house.hp}, and every ${house.name} upgrade counts for it too. The ${house.name}s keep sheltering while they are combined. ${costText(rule.cost)} and ${rule.time} seconds for each square.`;
  if (afford > 0 && afford < n) description += ` You can pay for ${afford} of the ${n} squares right now.`;
  card[0] = button(0, {
    id: 'house-merge',
    key: 'U',
    icon: manor.icon,
    title: n > 1 ? `Combine into ${n} ${manor.name}s` : `Combine into a ${manor.name}`,
    description,
    state,
    reason,
    cost: { gold: (rule.cost.gold || 0) * count, wood: (rule.cost.wood || 0) * count, faith: (rule.cost.faith || 0) * count, pop: 0, time: rule.time },
    queued: squares,
    action: { kind: 'upgradeHouses' },
  });
  if (merging) {
    card[1] = button(1, {
      id: 'house-merge-cancel', key: 'C', icon: '✖', title: 'Cancel Combining',
      description: `Stop combining the ${house.name}s and get back everything it cost. They stand as before.`,
      action: { kind: 'cancelMerge' },
    });
  }
}

function buildingCard(card, vs, group) {
  const buildings = group.ids.map((id) => vs.entities.get(id)).filter((e) => e && e.k === 'b');
  if (!buildings.length) return card;
  const def = BUILDINGS[group.type];
  const first = buildings[0];
  if (def && def.wall) return wallCard(card, vs, group, buildings);
  if (!buildings.some(isComplete)) {
    card[11] = button(11, {
      id: 'cancel-build', key: 'Escape', icon: '✖', title: 'Cancel Construction',
      description: `Tear down this unfinished building and get back ${Math.round(CANCEL_BUILD_REFUND * 100)}% of its cost.`,
      action: { kind: 'cancelBuild' },
    });
    return card;
  }
  const pantheon = vs.me ? vs.me.pantheon : null;
  const units = producibleAt(group.type, pantheon);
  switch (group.type) {
    case 'town_center': {
      card[0] = trainButton(0, 'W', vs, 'worshipper', buildings, 'Train');
      const tc = buildings.find(isComplete) || first;
      const chk = tierUpCheck(vs, tc);
      if (chk) {
        const next = chk.up.toTier;
        card[1] = button(1, {
          id: 'tier', key: 'U', icon: chk.up.icon || '⬆️', title: chk.up.name,
          description: `Your ${tierName(next - 1)} grows into a ${tierName(next)}, unlocking ${tierUnlocks(next, pantheon)}.${(chk.up.requires || []).length ? ' ' + chk.up.requires.map(requiresText).join(' ') : ''}`,
          state: chk.state, reason: chk.reason, cost: chk.cost, action: { kind: 'tier' },
        });
      }
      break;
    }
    case 'barracks':
      units.forEach((u, i) => {
        if (i < 5) card[i] = trainButton(i, BARRACKS_KEYS[u] || (UNITS[u].kin ? ELITE_KEY : GOD_KEYS[i]), vs, u, buildings, 'Train');
      });
      break;
    case 'shrine':
      units.forEach((u, i) => {
        if (i < 3) card[i] = trainButton(i, CREATURE_KEYS[i], vs, u, buildings, 'Summon');
      });
      break;
    case 'temple':
      units.forEach((u, i) => {
        if (i < 4) card[i] = trainButton(i, GOD_KEYS[i], vs, u, buildings, 'Summon');
      });
      break;
    case 'titan_gate':
      if (units[0]) card[0] = trainButton(0, 'T', vs, units[0], buildings, 'Summon');
      break;
    case 'house':
      mergeButtons(card, vs, buildings);
      break;
    default:
      break;
  }
  // Building upgrades fill the free slots of the middle and bottom rows; an upgrade line
  // (Worshipper work speed, health) takes one slot and shows its next level.
  const free = [4, 5, 6, 7, 8, 9, 10].filter((i) => !card[i]);
  offeredUpgrades(group.type, upgradesOf(vs, vs.myIndex)).slice(0, free.length).forEach((up, i) => {
    const chk = researchCheck(vs, up, buildings);
    const done = chk.state === 'passive';
    const levels = lineOf(up);
    card[free[i]] = button(free[i], {
      id: `research:${up.id}`,
      key: done ? null : up.hotkey,
      icon: up.icon,
      title: done ? `${up.name} (researched)` : `Research ${up.name}`,
      description: levels.length ? `${researchText(vs, up)} Level ${levels.indexOf(up) + 1} of ${levels.length}.` : researchText(vs, up),
      state: chk.state,
      reason: chk.reason,
      cost: done ? null : chk.cost,
      queued: chk.queued,
      action: { kind: 'research', upgrade: up.id },
    });
  });
  if (units.length && def) {
    card[11] = button(11, {
      id: 'rally', key: 'Y', icon: '🚩', title: 'Set Rally Point',
      description: 'New units walk here. Rally on a gold mine or a forest to send new Worshippers to work.',
      action: { kind: 'target', order: 'rally', target: 'point' },
    });
  }
  return card;
}

/**
 * The 12 command card buttons for a selection.
 * @param {{ ids: number[], activeType?: string }|number[]} selection
 * @param {object} vs ViewState
 * @param {string|{kind: string}} [mode] 'root' | 'build' | 'target' | 'place'
 * @returns {Array<object|null>}
 */
export function getCommandCard(selection, vs, mode = 'root') {
  const card = emptyCard();
  const m = typeof mode === 'string' ? mode : (mode && mode.kind) || 'root';
  if (!vs || !vs.entities) return card;
  const ids = selectionIds(selection).filter((id) => vs.entities.has(id));
  if (!ids.length) return card;
  if (m === 'target' || m === 'place') {
    card[11] = cancelButton(m === 'place' ? 'Cancel' : 'Cancel', m === 'place' ? 'Stop placing the building.' : 'Cancel targeting.');
    return card;
  }
  const groups = subgroups(ids, vs);
  const wanted = selection && !Array.isArray(selection) ? selection.activeType : null;
  const group = groups.find((g) => g.type === wanted) || groups[0];
  if (!group) return card;
  const sample = vs.entities.get(group.ids[0]);
  if (!sample || sample.o !== vs.myIndex) return card; // enemy, ally, neutral or mine: info only
  if (group.kind === 'u') {
    const ownIds = ids.filter((id) => {
      const e = vs.entities.get(id);
      return e && e.k === 'u' && e.o === vs.myIndex;
    });
    return unitCard(card, vs, group, ownIds, m);
  }
  if (group.kind === 'b') return buildingCard(card, vs, group);
  return card;
}

/** Find the button bound to a key (case-insensitive letter or 'Escape'). */
export function buttonForKey(card, key) {
  if (!key) return null;
  const k = key.length === 1 ? key.toUpperCase() : key;
  for (const b of card) if (b && b.key === k && !b.passive) return b;
  return null;
}
