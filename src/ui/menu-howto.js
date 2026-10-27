// How to Play: the rules (DESIGN 5) and controls (DESIGN 9) in friendly words.
import { h } from './menu-dom.js';
import { BUILDINGS } from '../data/index.js';
import { RANK_NAMES } from '../data/ranks.js';
import { DELETE_CONFIRM_ABOVE } from './delete-key.js';
import {
  MAX_GODS, POP_MAX, START_RESOURCES, START_WORKERS, CARRY_AMOUNT, MINE_SLOTS, MINE_TIME, DROPOFF_MINE_GAP,
  GOD_SLOT_TIER, REVIVE_COST_MULT, GOD_MAX_LEVEL, SPELL_VS_BUILDING, RANK_HP, RANK_DAMAGE, RANK_ARMOR, PEACE_LENGTHS, PEACE_NAME, PEACE_BUILD_GAP,
  MAX_WALL_LINE, WALL_PLACE_RANGE, MAX_QUEUE,
} from '../config.js';

// kbd('Ctrl', '1–9') = a key combination; keys('Q', 'W') = alternatives.
const kbd = (...k) => k.map((x, i) => [i ? h('span.mw-plus', '+') : null, h('kbd', x)]);
const keys = (...k) => k.map((x, i) => [i ? h('span.mw-keysep') : null, h('kbd', x)]);

function faithRate(id) {
  const b = BUILDINGS[id];
  return b && b.faithRate ? `${b.faithRate}` : '?';
}

const HOTKEYS = [
  ['Units', [
    [kbd('Right-click'), 'Smart command: move, attack, gather, pray, help build, repair'],
    [kbd('A'), 'Attack-move (then click the ground)'],
    [kbd('M'), 'Move'],
    [kbd('S'), 'Stop'],
    [kbd('H'), 'Hold position'],
    [kbd('Delete'), `Destroy the selected units and free their population (press twice for more than ${DELETE_CONFIRM_ABOVE} units, a god or a Titan; on a Mac keyboard that is fn + delete)`],
    [keys('Q', 'W', 'E', 'R'), 'God and creature abilities (they also cast themselves by default)'],
    [kbd('Right-click'), 'On an ability button: autocast on or off (manual) for that ability'],
    [kbd('`'), 'Every ability of the selected units to manual, or back to autocast'],
    [kbd('Hotkey'), 'While aiming or placing, another command hotkey replaces the pending order'],
  ]],
  ['Worshippers', [
    [kbd('G'), 'Gather gold or wood'],
    [kbd('B'), 'Build menu: H House · B Barracks · S Shrine · O Storehouse · T Tower · E Temple · G Titan Gate · C Town Center · W Wooden Wall'],
    [kbd('Drag'), 'While placing a Wooden Wall: press on a tile and drag to lay a whole line of wall'],
    [kbd('P'), 'Pray at a Shrine or Temple'],
    [kbd('C'), 'Return carried gold or wood'],
    [kbd('R'), 'Repair a damaged building (costs a share of its price)'],
    [kbd('T'), 'Auto-Repair on or off: idle worshippers mend nearby buildings'],
    [kbd('Shift'), 'Hold Shift while placing buildings to keep placing more; let go to finish'],
  ]],
  ['Buildings', [
    [kbd('W'), 'Town Center: Worshipper · Barracks: Warrior'],
    [kbd('Shift', 'W'), 'Shift with any train hotkey or button queues up to 5 at once'],
    [kbd('Shift', 'Click'), `A queued unit under a building's name: take back its whole run (the big button: the whole queue). A building queues up to ${MAX_QUEUE}`],
    [kbd('U'), 'Town Center: grow to Town, then City'],
    [keys('U', 'D'), 'Wall segments: upgrade to stone (U) or dismantle (D), the whole selection at once'],
    [keys('K', 'H'), 'Town Center: Worshippers work faster (K) · have more health (H), three levels each'],
    [keys('A', 'P', 'R', 'E'), 'Barracks: Archer · Priest · Battering Ram · your pantheon\'s own soldier (Hoplite, Berserker ...)'],
    [keys('Q', 'W', 'E'), 'Shrine: creatures · Temple: gods (R for the fourth)'],
    [kbd('Hotkey'), 'Every building has its own upgrades in the middle rows of its command card'],
    [kbd('T'), 'Titan Gate: summon the Titan'],
    [kbd('Y'), 'Set rally point'],
    [kbd('Esc'), 'Cancel construction / targeting; with a producer selected, take back its last queued unit'],
  ]],
  ['Camera & groups', [
    [kbd('Ctrl', '1–9'), 'Assign a control group'],
    [kbd('1–9'), 'Select a group (tap twice to jump to it)'],
    [kbd('F1–F3'), 'Select your gods'],
    [kbd('Space'), 'Center on selection or the last alert'],
    [kbd('Tab'), 'Next unit type in a mixed selection'],
    [kbd('.'), 'Next idle worshipper (Shift or Ctrl: select all of them)'],
    [kbd('Backspace'), 'Jump to your Town Center'],
    [kbd('Alt'), 'Show every health bar'],
    [kbd('Enter'), 'Chat'],
    [kbd('F10'), 'Game menu (pauses a game against the AI)'],
    [['Arrows · screen edge · middle-drag · minimap'], 'Move the camera'],
    [kbd('Mouse wheel'), 'Zoom in and out (smoothly on a trackpad)'],
  ]],
];

// "your Village Hall, then a Town Hall and a City Palace": what the Town Center is called on screen at each tier.
const TOWN_CENTER_NAMES = (() => {
  const [village, town, city] = BUILDINGS.town_center.tierNames;
  return `your ${village}, which becomes a ${town} and then a ${city}`;
})();

// "30, 45 or 60 minutes": the lengths the lobby offers for the Decade of Peace.
const PEACE_MINUTES_TEXT = `${PEACE_LENGTHS.slice(0, -1).join(', ')} or ${PEACE_LENGTHS[PEACE_LENGTHS.length - 1]} minutes`;

// "1000 health and 6 armor instead of 350 and 1": what upgrading a wooden wall to stone brings.
const WALL_UPGRADE_TEXT = (() => {
  const wood = BUILDINGS.wooden_wall;
  const stone = BUILDINGS.stone_wall;
  return `${stone.hp} health and ${stone.armor} armor instead of ${wood.hp} and ${wood.armor}`;
})();

const TIER_WORDS = ['the Village', 'a Town', 'a City'];
const NTH = ['first', 'second', 'third', 'fourth'];

/** "Veteran, Elite and Champion" from the rank table. */
function rankLadder() {
  const [, ...ranks] = RANK_NAMES;
  return `${ranks.slice(0, -1).join(', ')} and ${ranks[ranks.length - 1]}`;
}

/** "the first in the Village, the second once you are a Town, …" from GOD_SLOT_TIER. */
function godSlots() {
  return GOD_SLOT_TIER.slice(0, MAX_GODS).map((t, i) => (t <= 1 ? `the ${NTH[i]} in the Village` : `the ${NTH[i]} once you are ${TIER_WORDS[t - 1]}`)).join(', ');
}

function step(num, icon, title, ...body) {
  return h('section.mw-howto-step',
    h('div.mw-howto-num', { 'aria-hidden': 'true' }, icon),
    h('div',
      h('h3.mw-h3', h('span.mw-howto-idx', `${num}.`), ` ${title}`),
      ...body.map((p) => (typeof p === 'string' ? h('p', p) : p)),
    ),
  );
}

/** The How to Play content (rules column + controls column). */
export function renderHowToContent() {
  const rules = h('div.mw-howto-rules',
    h('p.mw-lead', 'Lead a people devoted to their gods. Your worshippers gather, build and pray; your prayers call down creatures, gods and a colossal titan. Destroy every building of the enemy to win.'),
    step(1, '⛏️', 'Gather gold and wood',
      `You start with a Town Center (${TOWN_CENTER_NAMES}), ${START_WORKERS} Worshippers, ${START_RESOURCES.gold} gold and ${START_RESOURCES.wood} wood. Select worshippers (drag a box around them) and right-click a gold mine or the forest. They carry ${CARRY_AMOUNT} at a time back to the Town Center or a Storehouse.`,
      `Only ${MINE_SLOTS} worshippers can dig in a gold mine at once (${MINE_TIME} seconds per trip); the others wait their turn, so 5–6 on one mine is plenty. Send the rest to the forest or to pray. Town Centers and Storehouses must be built at least ${DROPOFF_MINE_GAP} tiles away from a gold mine.`),
    step(2, '🙏', 'Pray for Faith',
      `Build a Shrine, then right-click it with worshippers (or press P). Every kneeling worshipper earns Faith each second (Shrine ${faithRate('shrine')}/s, Temple ${faithRate('temple')}/s) until you give them another order. Faith is what summons the divine.`),
    step(3, '🏛️', 'Grow from Village to Town to City',
      `Houses raise your population limit (up to ${POP_MAX}). Barracks train Warriors, Archers, Priests and Battering Rams, and from the Town on one elite soldier that only your pantheon fields. Grow your Town Center (U) to unlock stronger creatures, more gods and finally the Titan Gate.`),
    step(4, '✨', 'Summon creatures, gods and a Titan',
      'Shrines summon your pantheon\'s mythical creatures: one per tier, Village, Town and City. Temples summon gods: heroes who level up and cast spells.',
      `You may lead ${MAX_GODS} gods at once: ${godSlots()}. In the City, raise a Titan Gate and summon one colossal Titan.`),
    step(5, '⚡', 'Level up your gods',
      `Gods gain experience when enemies fall nearby and rise to level ${GOD_MAX_LEVEL}. Their first ability (Q) is ready at once, the second (W) at level 2 and the ultimate (R) at level 4. A fallen god can be revived at the Temple for ${REVIVE_COST_MULT === 0.5 ? 'half' : `${Math.round(REVIVE_COST_MULT * 100)}% of`} the price and time, keeping its level.`),
    step(6, '⚔️', 'Wage war',
      `Armor softens blows; arrows and spells never miss. Spells ignore armor but deal only ${Math.round(SPELL_VS_BUILDING * 100)}% to buildings. Only units that can hit air can strike flyers. Neutral creatures guard camps across the map and pay a gold bounty. A player with no buildings left is defeated, and the last team standing wins.`,
      `Soldiers from the Barracks earn experience for the enemies and buildings they destroy (Priests for the wounds they mend) and rise from ${RANK_NAMES[0]} to ${rankLadder()}. Each rank adds ${Math.round(RANK_DAMAGE * 100)}% damage, ${Math.round(RANK_HP * 100)}% health and ${RANK_ARMOR} armor, and small bronze, silver and gold diamonds over a soldier show its rank.`,
      `Worshippers can lay walls too: choose Wooden Wall in the build menu (W), then press on a tile and drag to lay a line of up to ${MAX_WALL_LINE} segments, which your Worshippers build one by one; a line goes up only within ${WALL_PLACE_RANGE} tiles of the Worshippers you order. Walls block every ground unit, yours too, so enemy armies have to break through them; ranged units can shoot over a wall at anything within range. Select a wall and press U to upgrade it to stone (${WALL_UPGRADE_TEXT}). A Tower raised on a wall, or in line with one, becomes part of the wall, and you can dismantle a segment (D) to open a gap of your own.`,
      `The host can pick the ${PEACE_NAME} game mode in the lobby: for ${PEACE_MINUTES_TEXT} no player can harm another with weapons or spells and nobody can build within ${PEACE_BUILD_GAP} tiles of an enemy Town Center (that ground turns red when you place a building), so everyone has time to build up and mass armies for one great battle. A countdown beside the game clock shows what is left, creatures still fight, and a horn sounds when the peace ends.`),
    step(7, '🔱', 'Know your pantheon',
      'Every pantheon plays its own way. Each has two blessings that work from the first second, an elite soldier trained at the Barracks, its own look, and its own creatures, gods and Titan. Hover the pantheon chip at the top left of the battlefield, or open Pantheons on the menu, to read yours.'),
    h('p.mw-tip', h('strong', 'Tip: '), 'Keep a few worshippers praying from the very start. Faith accumulates slowly, and the side that summons its first god earlier usually wins the early fights.'),
  );
  const controls = h('div.mw-howto-controls',
    h('h3.mw-h3', 'Mouse'),
    h('table.mw-keys',
      h('tbody',
        h('tr', h('td', kbd('Left-click')), h('td', 'Select a unit or building')),
        h('tr', h('td', kbd('Drag')), h('td', 'Box-select units')),
        h('tr', h('td', kbd('Shift', 'Click')), h('td', 'Add to or remove from the selection')),
        h('tr', h('td', kbd('Double-click')), h('td', 'Select every unit of that type on screen')),
        h('tr', h('td', kbd('Ctrl', 'Click')), h('td', 'The same, with a single click')),
        h('tr', h('td', kbd('Shift', 'Right-click')), h('td', 'Queue orders')),
      ),
    ),
    HOTKEYS.map(([title, rows]) => [
      h('h3.mw-h3', title),
      h('table.mw-keys', h('tbody', rows.map(([keys, text]) => h('tr', h('td', keys), h('td', text))))),
    ]),
  );
  return h('div.mw-howto', rules, controls);
}
