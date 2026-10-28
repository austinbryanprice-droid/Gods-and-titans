// How to Play: the rules (DESIGN 5) and controls (DESIGN 9) in friendly words.
import { h } from './menu-dom.js';
import { BUILDINGS } from '../data/index.js';
import { RANK_NAMES } from '../data/ranks.js';
import { MANOR, mergeRule } from '../data/houses.js';
import { RELIC_LIST } from '../data/relics.js';
import { DELETE_CONFIRM_ABOVE } from './delete-key.js';
import { SITE_ICON } from './hud-sites.js';
import {
  MAX_GODS, POP_MAX, START_RESOURCES, START_WORKERS, CARRY_AMOUNT, MINE_SLOTS, MINE_TIME, DROPOFF_MINE_GAP,
  GOD_SLOT_TIER, REVIVE_COST_MULT, GOD_MAX_LEVEL, SPELL_VS_BUILDING, RANK_HP, RANK_DAMAGE, RANK_ARMOR, PEACE_LENGTHS, PEACE_NAME, PEACE_BUILD_GAP,
  SITE_CAPTURE_TIME, SITE_NEUTRALIZE_TIME, SITE_FAITH, SACRED_HOLD, SACRED_NAME,
  MAX_WALL_LINE, WALL_PLACE_RANGE, MAX_QUEUE, SURVIVAL_NAME, SURVIVAL_FIRST_WAVE, SURVIVAL_INTERVAL, SURVIVAL_BOSS_EVERY,
} from '../config.js';

// kbd('Ctrl', '1–9') = a key combination; keys('Q', 'W') = alternatives.
const kbd = (...k) => k.map((x, i) => [i ? h('span.mw-plus', '+') : null, h('kbd', x)]);
const keys = (...k) => k.map((x, i) => [i ? h('span.mw-keysep') : null, h('kbd', x)]);

const MANOR_TEXT = `In a Town, select four Houses that stand together in a square and press U to combine them into a Manor: ${BUILDINGS[MANOR].popProvided} population instead of the ${mergeRule().count * BUILDINGS.house.popProvided} they shelter apart (${mergeRule().time} seconds, and the Houses keep sheltering meanwhile).`;

function faithRate(id) {
  const b = BUILDINGS[id];
  return b && b.faithRate ? `${b.faithRate}` : '?';
}

const RELIC_NAMES = `${RELIC_LIST.slice(0, 3).map((r) => `the ${r.name}`).join(', ')} and ${RELIC_LIST.length - 3} more`;

const HOTKEYS = [
  ['Units', [
    [kbd('Right-click'), 'Smart command: move, attack, gather, pray, help build, repair'],
    [kbd('A'), 'Attack-move (then click the ground)'],
    [kbd('M'), 'Move'],
    [kbd('S'), 'Stop'],
    [kbd('H'), 'Hold position'],
    [keys('Delete', 'Backspace'), `Destroy the selected units and free their population (press twice for more than ${DELETE_CONFIRM_ABOVE} units, a god or a Titan; a Mac's delete key is Backspace)`],
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
    [keys('U', 'C'), 'Houses: combine four in a square into a Manor (U), or cancel it (C)'],
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
    [kbd('Home'), 'Jump to your Town Center (on a Mac laptop: fn + the left arrow)'],
    [kbd('Alt'), 'Show every health bar'],
    [kbd('Enter'), 'Chat'],
    [kbd('F10'), 'Game menu (pauses a game against the AI)'],
    [['Arrows · screen edge · middle-drag · minimap'], 'Move the camera'],
    [kbd('Mouse wheel'), 'Zoom in and out (smoothly on a trackpad)'],
  ]],
  ['Team signals', [
    [kbd('Alt', 'Click'), 'Ping your team at that spot on the map or the minimap (not while aiming an order or placing a building)'],
    [kbd('Middle-click'), 'The same with the middle button; hold it and drag to move the camera instead'],
    [['Marker buttons'], 'Beside the minimap: Ping, Attack, Defend, Help and Gather. Press one, then click the map or the minimap'],
    [['Who sees them'], 'Only your teammates. A mark fades after a few seconds; click the arrow at the edge of the screen to jump to one out of view'],
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
      `Houses raise your population limit (up to ${POP_MAX}). ${MANOR_TEXT} Barracks train Warriors, Archers, Priests and Battering Rams, and from the Town on one elite soldier that only your pantheon fields. Grow your Town Center (U) to unlock stronger creatures, more gods and finally the Titan Gate.`),
    step(4, '✨', 'Summon creatures, gods and a Titan',
      'Shrines summon your pantheon\'s mythical creatures: one per tier, Village, Town and City. Temples summon gods: heroes who level up and cast spells.',
      `You may lead ${MAX_GODS} gods at once: ${godSlots()}. In the City, raise a Titan Gate and summon one colossal Titan.`),
    step(5, '⚡', 'Level up your gods',
      `Gods gain experience when enemies fall nearby and rise to level ${GOD_MAX_LEVEL}. Their first ability (Q) is ready at once, the second (W) at level 2 and the ultimate (R) at level 4. A fallen god can be revived at the Temple for ${REVIVE_COST_MULT === 0.5 ? 'half' : `${Math.round(REVIVE_COST_MULT * 100)}% of`} the price and time, keeping its level.`),
    step(6, '🌩️', 'Call on your god powers',
      'Each pantheon has three god powers, each usable once per game: a blessing in the Village (a richer harvest, a festival of prayer, a healing rain or a caravan of gifts), a strike from the Town (a storm of thunderbolts, a hammer from the sky, a plague of locusts…) and a cataclysm in the City (an earthquake, a great flood, an endless winter…).',
      'Press a glowing button on the left of the minimap, then click the map or the minimap where the power should fall: a ring shows its area. Strikes and cataclysms need a spot you can see and wait out a Decade of Peace. The computer players use theirs too, so keep your army from bunching up.'),
    step(7, '⚔️', 'Wage war',
      `Armor softens blows; arrows and spells never miss. Spells ignore armor but deal only ${Math.round(SPELL_VS_BUILDING * 100)}% to buildings. Only units that can hit air can strike flyers. Neutral creatures guard camps across the map and pay a gold bounty. A player with no buildings left is defeated, and the last team standing wins.`,
      `The bigger camps, marked by a beam of light, guard a relic from world myth (${RELIC_NAMES}). When the camp's last creature falls the relic drops: right-click it with a Worshipper or a god, who carries it to your Temple. While it rests there it gives you a lasting bonus, such as more health for your soldiers or faster research. A carrier that dies drops it, and a Temple that falls frees what rested in it.`,
      `Soldiers from the Barracks earn experience for the enemies and buildings they destroy (Priests for the wounds they mend) and rise from ${RANK_NAMES[0]} to ${rankLadder()}. Each rank adds ${Math.round(RANK_DAMAGE * 100)}% damage, ${Math.round(RANK_HP * 100)}% health and ${RANK_ARMOR} armor, and small bronze, silver and gold diamonds over a soldier show its rank.`,
      `Worshippers can lay walls too: choose Wooden Wall in the build menu (W), then press on a tile and drag to lay a line of up to ${MAX_WALL_LINE} segments, which your Worshippers build one by one; a line goes up only within ${WALL_PLACE_RANGE} tiles of the Worshippers you order. Walls block every ground unit, yours too, so enemy armies have to break through them; ranged units can shoot over a wall at anything within range. Select a wall and press U to upgrade it to stone (${WALL_UPGRADE_TEXT}). A Tower raised on a wall, or in line with one, becomes part of the wall, and you can dismantle a segment (D) to open a gap of your own.`,
      `The host can pick the ${PEACE_NAME} game mode in the lobby: for ${PEACE_MINUTES_TEXT} no player can harm another with weapons or spells and nobody can build within ${PEACE_BUILD_GAP} tiles of an enemy Town Center (that ground turns red when you place a building), so everyone has time to build up and mass armies for one great battle. A countdown beside the game clock shows what is left, creatures still fight, and a horn sounds when the peace ends.`,
      `Or the ${SURVIVAL_NAME}: every player and AI in the lobby plays on one team against waves of mythical monsters that come out of the map's edges, the first after ${SURVIVAL_FIRST_WAVE / 60} minutes and then one every ${SURVIVAL_INTERVAL} seconds, more and stronger each time, with a hostile Titan leading every ${SURVIVAL_BOSS_EVERY}th wave. Beating a wave pays every survivor gold. The trial ends when the last of you has no buildings left, and your score is the wave you reached; the chip beside the game clock counts down to the next one, and the lobby remembers your best.`,
      `Sacred sites ${SITE_ICON}, rings of standing stones around a glowing altar, lie between the bases. A Worshipper or Priest standing at one with no enemy near captures it in ${SITE_CAPTURE_TIME} seconds (a rival's site takes ${SITE_NEUTRALIZE_TIME} more to tear down first), and each site you hold gives ${SITE_FAITH} faith a second. Soldiers cannot capture, but any enemy at a site stops a capture. The chip beside the clock counts the sites your side holds. When the host turns on ${SACRED_NAME} in the lobby, a side that holds every site for ${SACRED_HOLD / 60} minutes in a row also wins.`),
    step(8, '🔱', 'Know your pantheon',
      'Every pantheon plays its own way. Each has two blessings that work from the first second, an elite soldier trained at the Barracks, its own look, and its own creatures, gods and Titan. Hover the pantheon chip at the top left of the battlefield, or open Pantheons on the menu, to read yours.'),
    h('p.mw-tip', h('strong', 'New here? '), 'Learn to Play on the title screen walks you through a whole first match, one objective at a time, against a sleeping camp of raiders, and gives a medal for the time you win in.'),
    h('p.mw-tip', h('strong', 'A story to play: '), 'the Campaign on the title screen is five linked missions for the Greeks, each with its own objectives and a narrated briefing. Win one to open the next.'),
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
