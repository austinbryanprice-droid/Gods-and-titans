// Gameplay tips: the pool the in-game tip toast (hud-hints.js) and the loading screen draw from.
// A tip is { id, text, when? }: `text` is a string (or a function of the context) in which
// [[Key]] marks a key to be drawn as a <kbd>; `when(ctx)` says whether it fits the match right
// now (no `when`: it is always true). Everything here is pure, so Node tests can drive it.
//
//   hintContext(vs)       → what the player has and knows, for the `when`s
//   pickHint({ ctx, seen }) → the next tip: unseen before seen, a fitting one before a general one
//   hintParts(text)       → ['Press ', { key: 'Space' }, ' to …'] for building the DOM
import { BUILDINGS, UNITS, eliteFor } from '../data/index.js';
import { RANK_NAMES } from '../data/ranks.js';
import { MAX_QUEUE, MINE_SLOTS, POP_MAX, REVIVE_COST_MULT, SPELL_VS_BUILDING, TRADE_TAX_PCT, PEACE_NAME, PEACE_BUILD_GAP } from '../config.js';
import { isWallEntity } from './hud-data.js';

const percent = (v) => Math.round(v * 100);
const REVIVE_TEXT = REVIVE_COST_MULT === 0.5 ? 'half the price' : `${percent(REVIVE_COST_MULT)}% of the price`;

/**
 * What the player has, for a tip's `when`. Counts only own things; `ally` is whether a teammate
 * is still in the match.
 */
export function hintContext(vs) {
  const me = vs.me || {};
  const c = {
    time: vs.time || 0,
    tier: me.tier || 1,
    pop: me.pop || 0,
    popCap: me.popCap || 0,
    faithRate: me.faithRate || 0,
    upgrades: Array.isArray(me.up) ? me.up.length : 0,
    gods: Array.isArray(me.gods) ? me.gods.length : 0,
    titan: !!me.titan,
    pantheon: me.pantheon || null,
    ally: false,
    peace: typeof vs.peaceActive === 'function' ? vs.peaceActive() : false,
    workers: 0,
    army: 0,
    damaged: false,
    walls: 0,
    has: {},
  };
  for (const p of vs.players || []) if (p.i !== vs.myIndex && !p.defeated && p.team === vs.myTeam) c.ally = true;
  for (const e of vs.entities.values()) {
    if (e.o !== vs.myIndex) continue;
    if (e.k === 'u') {
      const d = UNITS[e.t];
      if (!d) continue;
      if (d.class === 'worker') c.workers++;
      else if (d.class !== 'minion') c.army++;
    } else if (e.k === 'b') {
      if (isWallEntity(e)) c.walls++;
      else {
        c.has[e.t] = (c.has[e.t] || 0) + 1;
        if (e.mhp > 0 && e.hp < e.mhp * 0.7 && (e.bp === undefined || e.bp >= 1)) c.damaged = true;
      }
    }
  }
  return c;
}

export const HINTS = [
  // ---- controls
  { id: 'idle-key', text: 'Press [[.]] to select your next idle Worshipper. Hold [[Shift]] to select them all.' },
  { id: 'space-key', text: '[[Space]] centers the camera on your last alert, or on your selection.' },
  { id: 'groups', text: 'Save a group with [[Ctrl]] + [[1]] to [[9]]. Tap its number to select it, tap twice to jump the camera there.' },
  { id: 'double-click', text: 'Double-click a unit to select every unit of that type on the screen.' },
  { id: 'queue-orders', text: 'Hold [[Shift]] while you right-click to queue orders one after another.' },
  { id: 'attack-move', text: 'Press [[A]], then click the ground: your army marches there and fights whatever it meets on the way.' },
  { id: 'rally', text: 'Select a building and press [[Y]], then click: new units walk to that rally point. Pick a tree or a mine and new Worshippers go straight to work.', when: (c) => c.workers >= 3 },
  { id: 'train-batch', text: `[[Shift]]-click a unit button to queue up to five at once, as many as you can afford. A building lines up to ${MAX_QUEUE} units, paid for as you queue them.`, when: (c) => !!(c.has.town_center || c.has.barracks) },
  { id: 'delete-key', text: 'Press [[Delete]] to destroy the selected units for good and free their population. A big group, a god or a Titan asks for a second press first.' },
  { id: 'health-bars', text: 'Hold [[Alt]] to see every health bar on the field.' },
  { id: 'tab-cycle', text: '[[Tab]] steps through the unit types of a mixed selection, so you can order a god without losing the army.', when: (c) => c.gods >= 1 || c.army >= 6 },
  { id: 'god-keys', text: '[[F1]] [[F2]] [[F3]] select your gods. Press one twice to center the camera on it.', when: (c) => c.gods >= 1 },
  { id: 'town-key', text: '[[Backspace]] jumps the camera back to your Town Center.' },
  { id: 'zoom', text: 'Roll the mouse wheel to zoom. The arrow keys, the screen edge and a middle-drag move the camera.' },
  { id: 'minimap', text: 'Click the minimap to move the camera. Right-click it to send your selected units there.' },
  { id: 'autocast', text: 'Gods and creatures cast their abilities on their own. Right-click an ability button, or press [[`]], to cast by hand instead.', when: (c) => c.gods >= 1 || c.army >= 6 },
  { id: 'task-bar', text: 'The bar at the lower left counts what your Worshippers are doing. Click a number to select them.', when: (c) => c.workers >= 6 },

  // ---- economy
  { id: 'mine-slots', text: `Only ${MINE_SLOTS} Worshippers dig in a gold mine at once. Send the rest to the forest, or to pray.`, when: (c) => c.workers >= 5 && c.time > 120 },
  { id: 'storehouse', text: 'A Storehouse ([[B]], then [[O]]) beside a forest or a mine shortens every trip your Worshippers make.', when: (c) => c.time > 180 && !c.has.storehouse },
  { id: 'houses', text: 'Houses raise your population limit. Raise the next one before you hit the cap, not after.', when: (c) => c.popCap > 0 && c.popCap < POP_MAX && c.popCap - c.pop <= 4 },
  { id: 'manor', text: `Select four Houses that stand in a square and press [[${BUILDINGS.manor.hotkey}]] to combine them into a Manor: ${BUILDINGS.manor.popProvided} population in place of ${BUILDINGS.house.popProvided * BUILDINGS.manor.mergesFrom.count}. It needs a Town.`, when: (c) => c.tier >= 2 && (c.has.house || 0) >= BUILDINGS.manor.mergesFrom.count },
  { id: 'pray', text: 'Worshippers praying at a Shrine earn Faith, and Faith summons gods and creatures. Keep a few praying all game.', when: (c) => c.faithRate === 0 && c.time > 150 },
  { id: 'repair', text: 'Right-click a damaged building with Worshippers selected to repair it, or switch Auto-Repair on with [[T]].', when: (c) => c.damaged },
  { id: 'upgrades', text: 'Most buildings have their own upgrades, in the middle and bottom rows of the command card. Iron Picks at the Town Center bring more gold home on every trip.', when: (c) => c.upgrades === 0 && c.time > 240 },
  { id: 'grow', text: 'Grow your Town Center with [[U]] for stronger creatures, more gods and, in the City, the Titan Gate.', when: (c) => c.tier === 1 && c.time > 200 },
  { id: 'market', text: `In a team game the Market (the scales at the top) sends gold, wood or faith to a teammate. It keeps ${TRADE_TAX_PCT}% of every shipment.`, when: (c) => c.ally },

  // ---- gods, creatures and the Titan
  { id: 'temple', text: `A Temple summons your gods. They grow stronger as enemies fall nearby, and a fallen god can be revived there for ${REVIVE_TEXT}.`, when: (c) => !!c.has.temple || c.gods >= 1 },
  { id: 'shrine-creatures', text: 'A Shrine summons your pantheon\'s mythical creatures. The mightiest of them wait for a Town and a City.', when: (c) => !!c.has.shrine },
  { id: 'titan', text: 'In the City, raise a Titan Gate ([[B]], then [[G]]) and summon one colossal Titan.', when: (c) => c.tier >= 3 && !c.has.titan_gate && !c.titan },
  { id: 'elite', text: (c) => {
    const e = c.pantheon ? eliteFor(c.pantheon) : null;
    return `Your pantheon\'s own soldier${e ? `, the ${e.name},` : ''} is trained at the Barracks once you are a Town. Press [[E]] there.`;
  }, when: (c) => c.tier >= 2 && !!c.has.barracks && !!c.pantheon && !!eliteFor(c.pantheon) },
  { id: 'pantheon-chip', text: 'Hover the pantheon chip at the top left to read your pantheon\'s blessings and its elite soldier.', when: (c) => c.time < 600 },

  // ---- war
  { id: 'ranks', text: `Soldiers earn ranks for what they destroy, from ${RANK_NAMES[0]} up to ${RANK_NAMES[RANK_NAMES.length - 1]}. Bronze, silver and gold diamonds over a soldier show its rank, so keep your veterans alive.`, when: (c) => c.army >= 4 },
  { id: 'priests', text: 'Priests heal your soldiers, and the healing earns the Priest ranks too. A few behind the front line pay for themselves.', when: (c) => c.army >= 8 },
  { id: 'rams', text: 'Battering Rams ([[R]] at the Barracks) tear down buildings but cannot fight units. Escort them.', when: (c) => !!c.has.barracks && c.time > 300 },
  { id: 'air', text: 'Only archers, priests, gods and the other units that can hit air can strike a flyer. Warriors cannot.', when: (c) => c.time > 300 },
  { id: 'spells-buildings', text: `Spells ignore armor but deal only ${percent(SPELL_VS_BUILDING)}% to buildings. Break a base with soldiers and rams.`, when: (c) => c.gods >= 1 && c.time > 300 },
  { id: 'creeps', text: 'Neutral creatures guard camps across the map and pay a bounty when they fall. Clear the weaker camps early.', when: (c) => c.time < 900 },

  // ---- walls
  { id: 'walls', text: 'Choose Wooden Wall in the build menu ([[B]], then [[W]]) and drag across the ground to lay a whole line at once.', when: (c) => c.tier >= 2 && c.walls === 0 },
  { id: 'walls-gap', text: 'Walls block your own units too. Leave a gap, or dismantle a segment with [[D]], so your army can march out.', when: (c) => c.walls > 0 },
  { id: 'walls-stone', text: 'Select wall segments and press [[U]] to upgrade them to stone.', when: (c) => c.walls > 0 && c.tier >= 2 },
  { id: 'walls-tower', text: 'A Watch Tower raised on a wall, or in line with one, becomes part of the wall.', when: (c) => c.walls > 0 },

  // ---- the Decade of Peace
  { id: 'peace', text: `The ${PEACE_NAME} is on: nobody can attack yet. Expand, grow and mass your army. A horn sounds when it ends.`, when: (c) => c.peace },
  { id: 'peace-build', text: `During the ${PEACE_NAME} nobody can build within ${PEACE_BUILD_GAP} tiles of an enemy Town Center, so expand elsewhere until the horn sounds.`, when: (c) => c.peace },
  { id: 'peace-creeps', text: `Neutral creatures still fight during the ${PEACE_NAME}, so they remain fair game.`, when: (c) => c.peace },
];

/** [[Key]] markers → parts for the DOM: ['Press ', { key: 'Space' }, ' to go.']. */
export function hintParts(text) {
  const out = [];
  let at = 0;
  for (const m of String(text).matchAll(/\[\[(.+?)\]\]/g)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push({ key: m[1] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** The tip's words for a context ('' if its text function fails). */
export function hintText(hint, ctx = {}) {
  try {
    return typeof hint.text === 'function' ? hint.text(ctx) : hint.text;
  } catch {
    return '';
  }
}

function fits(hint, ctx) {
  if (!hint.when) return true;
  try {
    return !!hint.when(ctx);
  } catch {
    return false;
  }
}

/**
 * The next tip. Among the tips that fit `ctx`, the ones shown least often (`seen`: id → count)
 * come first, and of those a tip that fits something the player has or does now beats a general
 * one; `rng` picks among equals. A tip shown `maxSeen` times is not shown again.
 * @returns {{ id: string, text: string }|null}
 */
export function pickHint({ hints = HINTS, ctx, seen = {}, rng = Math.random, skip = [], maxSeen = Infinity }) {
  const count = (h) => seen[h.id] || 0;
  const ok = hints.filter((h) => count(h) < maxSeen && !skip.includes(h.id) && fits(h, ctx) && hintText(h, ctx));
  if (!ok.length) return null;
  const least = Math.min(...ok.map(count));
  const pool = ok.filter((h) => count(h) === least);
  const special = pool.filter((h) => h.when);
  const from = special.length ? special : pool;
  const h = from[Math.min(from.length - 1, Math.floor(rng() * from.length))];
  return { id: h.id, text: hintText(h, ctx) };
}

/** A tip for the loading screen: one that is true in any match. */
export function loadingHint(rng = Math.random) {
  const general = HINTS.filter((h) => !h.when);
  const h = general[Math.min(general.length - 1, Math.floor(rng() * general.length))];
  return h ? { id: h.id, text: hintText(h, {}) } : null;
}
