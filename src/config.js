// Global constants shared by every module. Pure data, no imports.

export const GAME_TITLE = 'Mythic War';
export const GAME_SUBTITLE = 'Gods, Titans & Worshippers';
export const GAME_VERSION = '0.1.0';

// ---- Simulation timing ----
export const TICK_RATE = 20; // ticks per second
export const DT = 1 / TICK_RATE; // seconds per tick

// ---- Players ----
export const MAX_PLAYERS = 4;
export const NEUTRAL = -1; // owner index for creeps and nature
export const NEUTRAL_TEAM = -1;
export const PLAYER_COLORS = [
  '#d63a3a', // red
  '#3a78d6', // blue
  '#2fb85c', // green
  '#e3b52b', // gold
  '#9b4fd6', // purple
  '#e0782a', // orange
  '#2bc2c2', // teal
  '#e05ab0', // pink
];
export const NEUTRAL_COLOR = '#8a8a8a';

// ---- Economy ----
export const START_RESOURCES = { gold: 400, wood: 200, faith: 50 };
export const START_WORKERS = 5;
export const POP_MAX = 150;
export const CARRY_AMOUNT = 10; // gold or wood per trip
export const MINE_TIME = 1.5; // seconds a worker mines per 10-gold trip
export const MINE_SLOTS = 2; // workers mining one gold mine at the same time; others wait their turn
export const DROPOFF_MINE_GAP = 3; // min Chebyshev gap (empty tiles) between a drop-off (Town Center, Storehouse) and a gold mine
export const CHOP_INTERVAL = 0.6; // seconds per 1 wood
export const TREE_WOOD = 50; // wood per forest tile
export const GOLD_MINE_AMOUNT = 12000; // start mines
export const EXPANSION_MINE_AMOUNT = 15000;
export const MAX_QUEUE = 5; // production queue length
export const BUILD_HELPER_BONUS = 0.5; // each extra builder adds +50% build speed
export const CANCEL_BUILD_REFUND = 0.75;
export const REPAIR_COST = 0.35; // repairing a building from 0 to full health costs this share of its build cost
export const REPAIR_TIME = 0.75; // ... and takes this share of its build time with one worshipper (helpers add BUILD_HELPER_BONUS each)
export const AUTO_REPAIR_RANGE = 10; // idle worshippers with Auto-Repair on look this far for a damaged building
// Team market: teammates send each other gold, wood or faith; the market keeps a cut.
export const TRADE_RESOURCES = ['gold', 'wood', 'faith'];
export const TRADE_TAX_PCT = 10; // percent of every transfer the market keeps (rounded up)
export const TRADE_MIN = 20; // smallest transfer
export const TRADE_MAX = 100000; // largest single transfer a command may carry

// ---- Gods & titans ----
export const MAX_GODS = 3; // alive + queued per player
export const MAX_TITANS = 1;
export const GOD_MAX_LEVEL = 6;
export const GOD_XP_LEVELS = [0, 120, 300, 550, 900, 1350]; // cumulative xp needed for level 1..6
export const GOD_LEVEL_HP = 0.08; // +8% max hp per level above 1
export const GOD_LEVEL_DAMAGE = 0.08; // +8% attack damage per level above 1
export const GOD_LEVEL_ARMOR = 0.5; // +0.5 armor per level above 1
export const ABILITY_LEVEL_SCALE = 0.1; // +10% ability amounts per level above 1
export const XP_RANGE = 12; // gods within this range share xp from enemy deaths
export const REVIVE_COST_MULT = 0.5; // reviving a fallen god costs 50% faith/gold and time
// Third god requires City tier; second requires Town tier.
export const GOD_SLOT_TIER = [1, 2, 3];

// ---- Soldier ranks ----
// Mortal soldiers (everything the Barracks trains) earn experience and rise in rank: Recruit,
// Veteran, Elite, Champion (names in data/ranks.js). Gods keep their levels; Worshippers do not rank.
export const RANK_XP = [0, 60, 150, 300]; // cumulative xp needed for rank 0..3
export const RANK_HP = 0.1; // +10% max hp per rank
export const RANK_DAMAGE = 0.05; // +5% attack damage per rank
export const RANK_ARMOR = 0.5; // +0.5 armor per rank
export const HEAL_XP = 0.1; // xp a priest earns for each hit point it restores
export const BUILDING_XP_HP = 50; // razing a completed building is worth its hp / 50 xp

// ---- Combat ----
export const MELEE_RANGE = 0.5; // edge-to-edge distance in tiles
export const PROJECTILE_SPEED = 12; // tiles per second
export const SPELL_VS_BUILDING = 0.5; // ability damage multiplier vs buildings
export const ARMOR_FACTOR = 0.06; // WC3 armor formula constant
export const UNDER_ATTACK_COOLDOWN = 10; // seconds between "under attack" alerts per player
export const CREEP_AGGRO_RANGE = 5;
export const CREEP_LEASH_RANGE = 10;

// ---- Map ----
export const MAP_SIZES = { small: 96, medium: 128 };
export const TERRAIN = { GRASS: 0, DIRT: 1, WATER: 2, FOREST: 3, ROCK: 4, SAND: 5 };

// ---- Network ----
export const PEER_ID_PREFIX = 'mythicwar-v1-';
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const SNAPSHOT_EVERY_TICKS = 1; // host sends a delta every N ticks
export const INTERP_DELAY_MS = 100; // client render delay behind newest snapshot

// ---- AI ----
export const AI_THINK_INTERVAL = { easy: 20, normal: 10, hard: 5 }; // ticks between decisions

// ---- Element colors (VFX, UI accents) ----
export const ELEMENT_COLORS = {
  lightning: '#9fd8ff',
  fire: '#ff7a1a',
  water: '#3aa0ff',
  holy: '#ffe066',
  sun: '#ffc23a',
  shadow: '#7a3cff',
  death: '#5c2a8a',
  nature: '#5fd35f',
  wind: '#d8f0ff',
  earth: '#a07040',
  ice: '#bfefff',
  war: '#d43030',
  moon: '#c8c8ff',
  chaos: '#c040a0',
  physical: '#dddddd',
  sand: '#e0c080',
  poison: '#8fd14f',
  arcane: '#e070ff',
};
