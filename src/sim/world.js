// The authoritative game simulation (DESIGN sections 3, 5 and 6). Runs in
// Node and the browser; deterministic for a given setup and command stream.
import {
  DT, START_RESOURCES, START_WORKERS, POP_MAX, GOD_XP_LEVELS, GOD_MAX_LEVEL, GOD_LEVEL_HP, GOD_LEVEL_DAMAGE,
  GOD_LEVEL_ARMOR, XP_RANGE, UNDER_ATTACK_COOLDOWN, NEUTRAL, PLAYER_COLORS, MINE_SLOTS,
} from '../config.js';
import { BUILDINGS, GOLD_MINE, PANTHEONS, PANTHEON_LIST, getUnitType, xpValue } from '../data/index.js';
import { NO_MODS, computeMods, buildingMods, unitMods } from '../data/upgrades.js';
import { canRank, rankForXp, rankBonus, killXp } from '../data/ranks.js';
import { RNG, hashSeed } from './rng.js';
import { generateMap, mapOptions } from './mapgen.js';
import { MapState } from './map-state.js';
import { PathService } from './pathfinding.js';
import { SpatialHash } from './spatial.js';
import { updateMovement } from './movement.js';
import { computeDerived, tickStatuses, updateAuras } from './status.js';
import { dealDamage, updateProjectiles, updateTower } from './combat.js';
import { updateDelayed, updateFields, defaultManualMask, refreshAutocast } from './abilities.js';
import { computePrayerSpots, mineSpots, nearestMine } from './economy.js';
import { canPlace, placementError, findPlacement, updateConstruction, updateBuildingRepair } from './construction.js';
import { updateProduction } from './production.js';
import { cancelMerge } from './homes.js';
import { awardSpoils, accrueBlessedFaith } from './spoils.js';
import { spawnCreeps } from './creeps.js';
import { setOrder, discardOrder, updateUnit, onUnitAttacked } from './orders.js';
import { applyCommand, normalizeCommand, MAX_COMMANDS_PER_TICK } from './commands.js';
import { buildSnapshot } from './snapshot.js';
import { PEACE_ANCHOR, peaceBlocksFootprint, peaceSeconds } from './peace.js';
import { isTutorial, tutorialStart } from './tutorial.js';
import { createSites, updateSites, accrueSiteFaith, sacredVictoryOn, siteBlocksFootprint } from './sacred.js';
import { hyp, distPointRect } from './common.js';

const ERRORS_GOLD = 'Not enough gold.';
const ERRORS_WOOD = 'Not enough wood.';
const ERRORS_FAITH = 'Not enough faith.';

export class World {
  /**
   * @param {object} setup GameSetup (DESIGN 6.1)
   * @param {object} mapData MapData (DESIGN 6.7)
   */
  constructor(setup, mapData) {
    this.setup = setup;
    this.mapData = mapData;
    this.map = new MapState(mapData);
    this.rng = new RNG(hashSeed(`${setup.seed}:sim`));
    this.tickCount = 0;
    this.time = 0;
    this.entities = new Map();
    this.unitList = [];
    this.buildingList = [];
    this.mineList = [];
    this.auraHolders = [];
    this.camps = [];
    this.nextId = 1;
    this.nextFieldId = 1;
    this.events = [];
    this.felled = [];
    this.felledAll = [];
    this.projectiles = [];
    this.delayed = [];
    this.fields = [];
    this.reveals = [];
    this.cmdQueue = [];
    this.hash = new SpatialHash(this.map.width, this.map.height, 2);
    this.paths = new PathService(this.map);
    this.maxRadius = 0.5;
    this._tmpQuery = [];
    this._tmpTarget = [];
    this._tmpSteer = [];
    this._tmpSurround = [];
    this.gameOver = null;
    this.winningTeam = null;
    // Decade of Peace: until peaceEnd (game seconds) players cannot harm each other (see canHarm).
    this.peaceEnd = peaceSeconds(setup);
    this.peace = this.peaceEnd > 0;
    // Sacred Sites (5.11): the map's holy ground, and the Sacred Victory countdown ({ team, end } while a team holds them all).
    this.sites = createSites(mapData.sacred);
    this.sacredVictory = sacredVictoryOn(setup) && this.sites.length > 0;
    this.sacred = null;
    this.perf = { lastTickMs: 0, commandErrors: 0, lastCommandError: '' };

    const pickRng = this.rng.fork('pantheons');
    this.players = setup.players.map((sp, i) => {
      let pantheon = sp.pantheon;
      if (typeof pantheon !== 'string' || !Object.hasOwn(PANTHEONS, pantheon)) pantheon = pickRng.pick(PANTHEON_LIST).id;
      return {
        index: i,
        name: sp.name || `Player ${i + 1}`,
        team: sp.team ?? i + 1,
        pantheon,
        color: sp.color || PLAYER_COLORS[i % PLAYER_COLORS.length],
        kind: sp.kind || 'human',
        difficulty: sp.difficulty ?? null,
        gold: START_RESOURCES.gold,
        wood: START_RESOURCES.wood,
        faith: START_RESOURCES.faith,
        faithRate: 0,
        tier: 1,
        popUsed: 0,
        popCap: 0,
        defeated: false,
        fallen: {},
        upgrades: {}, // researched upgrade id -> true
        upList: [], // the same ids in the order they finished (snapshot)
        mods: computeMods([], pantheon), // their pantheon's blessings and upgrades combined (data/upgrades.js computeMods)
        autoRepair: false, // idle worshippers mend nearby damaged buildings
        lastAlert: -Infinity,
        stats: { gathered: 0, unitsTrained: 0, kills: 0, losses: 0, buildings: 0 },
      };
    });
    this.multiTeam = new Set(this.players.map((p) => p.team)).size >= 2;
    this.cmdCounts = new Array(this.players.length).fill(0); // commands queued this tick, per player

    for (const m of mapData.mines || []) this.createMine(m.tx, m.ty, m.amount);
    const starts = mapData.starts || [];
    this.players.forEach((p, i) => {
      const s = starts[i] || starts[i % Math.max(1, starts.length)] || { x: 4 + i * 8, y: 4 };
      const tc = this.createBuilding(i, 'town_center', Math.floor(s.x), Math.floor(s.y), true, true);
      const mine = this.mineList[i] || null;
      this.placeStartWorkers(i, tc, mine);
    });
    // The guided first match (5.12) has no creep camps, a head start for the learner and a guarded enemy camp.
    if (isTutorial(setup)) tutorialStart(this);
    else spawnCreeps(this, mapData.camps || []);
    this.recomputePop();
    for (let i = 0; i < this.players.length; i++) this.recomputeTier(i, true);
    this.hash.rebuild(this.unitList);
  }

  // ---------------------------------------------------------------- setup

  placeStartWorkers(player, tc, mine) {
    const map = this.map;
    const tx = mine ? mine.x : tc.x;
    const ty = mine ? mine.y : tc.y + 4;
    const spots = [];
    for (let y = tc.ty - 1; y <= tc.ty + tc.size; y++) {
      for (let x = tc.tx - 1; x <= tc.tx + tc.size; x++) {
        if (x >= tc.tx && x < tc.tx + tc.size && y >= tc.ty && y < tc.ty + tc.size) continue;
        if (map.isPassable(x, y)) spots.push({ x: x + 0.5, y: y + 0.5, d: hyp(x + 0.5 - tx, y + 0.5 - ty) });
      }
    }
    spots.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    for (let k = 0; k < START_WORKERS; k++) {
      const s = spots[k] || spots[k % Math.max(1, spots.length)] || { x: tc.x, y: tc.ty + tc.size + 0.5 };
      this.spawnUnit(player, 'worshipper', s.x, s.y, { facing: Math.atan2(ty - s.y, tx - s.x), silent: true });
    }
  }

  createMine(tx, ty, amount) {
    const id = this.nextId++;
    const m = {
      id, kind: 'mine', type: GOLD_MINE.id, owner: NEUTRAL, def: GOLD_MINE,
      tx, ty, size: GOLD_MINE.size, x: tx + GOLD_MINE.size / 2, y: ty + GOLD_MINE.size / 2, radius: GOLD_MINE.size / 2,
      hp: GOLD_MINE.hp, maxHp: GOLD_MINE.hp, armor: 0, amount, initialAmount: amount,
      state: 'idle', order: null, target: 0, facing: 0, dead: false, constructed: true, buildProgress: 1, queue: [],
      carry: 0, level: 0, xp: 0, cooldowns: {},
      // Mining: MINE_SLOTS workers mine at once, the rest wait in FIFO order at their own spot on the edge.
      miners: new Array(MINE_SLOTS).fill(0), waiting: [], spots: mineSpots(tx, ty, GOLD_MINE.size), spotHolders: null,
    };
    m.spotHolders = new Array(m.spots.length).fill(0);
    this.entities.set(id, m);
    this.mineList.push(m);
    this.map.setOccupied(tx, ty, m.size, id);
    return m;
  }

  /** Create a building entity (construction site unless constructed). */
  createBuilding(owner, typeId, tx, ty, constructed, silent = false) {
    const def = BUILDINGS[typeId];
    const id = this.nextId++;
    const p = this.players && this.players[owner];
    const m = buildingMods(p ? p.mods : NO_MODS, typeId);
    const maxHp = def.hp + m.hp;
    const b = {
      id, kind: 'building', type: typeId, owner, def,
      tx, ty, size: def.size, x: tx + def.size / 2, y: ty + def.size / 2, radius: def.size / 2,
      hp: constructed ? maxHp : maxHp * 0.1, maxHp, armor: def.armor + m.armor,
      constructed: !!constructed, buildProgress: constructed ? 1 : 0, builders: 0,
      repairers: 0, repairBlocked: false, rangeBonus: m.range,
      queue: [], rally: null, tier: typeId === 'town_center' ? 1 : 0,
      prayers: def.prayerSlots > 0 ? new Array(def.prayerSlots).fill(0) : [], praySpots: null, prayingCount: 0,
      attackCd: 0, target: 0, state: 'idle', order: null, facing: Math.PI / 2, dead: false,
      baseDamage: def.attack ? def.attack.damage : 0, dmgMult: 1 + m.damage, atkSpeedMult: 1,
      carry: 0, level: 0, xp: 0, cooldowns: {}, amount: 0, claimers: null,
    };
    this.entities.set(id, b);
    this.buildingList.push(b);
    this.map.setOccupied(tx, ty, def.size, id);
    if (!silent) this.emit({ type: 'construction', id, t: typeId, o: owner });
    if (constructed && !def.wall) {
      if (def.prayerSlots > 0) computePrayerSpots(this, b);
      this.recomputePopCap(owner);
    }
    return b;
  }

  /**
   * Spawn a unit. opts: { summoned, expire, level, xp, facing, silent }.
   * Ground units are placed on the nearest passable tile.
   */
  spawnUnit(owner, typeId, x, y, opts = {}) {
    const def = getUnitType(typeId);
    if (!def) return null;
    const map = this.map;
    x = Math.max(def.radius, Math.min(map.width - def.radius, x));
    y = Math.max(def.radius, Math.min(map.height - def.radius, y));
    if (!def.air && !map.isPassable(Math.floor(x), Math.floor(y))) {
      const p = map.nearestPassable(x, y, 20, false);
      if (p) {
        x = p.tx + 0.5;
        y = p.ty + 0.5;
      }
    }
    const id = this.nextId++;
    const passives = def.passives || [];
    let evasion = 0;
    let thorns = 0;
    let lifesteal = 0;
    let regen = def.class === 'god' ? 1 : 0;
    let hasAura = false;
    for (const p of passives) {
      if (p.type === 'evasion') evasion = Math.max(evasion, p.pct || 0);
      else if (p.type === 'thorns') thorns += p.pct || 0;
      else if (p.type === 'lifesteal') lifesteal += p.pct || 0;
      else if (p.type === 'regen') regen += p.hps || 0;
      else if (p.type === 'aura') hasAura = true;
    }
    const u = {
      id, kind: 'unit', type: typeId, owner, def,
      x, y, facing: opts.facing ?? Math.PI / 2, vx: 0, vy: 0,
      radius: def.radius, terrainR: Math.min(def.radius, 0.45), mass: Math.max(0.3, (def.radius / 0.35) ** 2),
      big: def.radius >= 0.75 && !def.air, air: !!def.air,
      level: def.class === 'god' ? Math.max(1, opts.level || 1) : 1, xp: def.class === 'god' ? opts.xp || 0 : 0,
      rank: 0, // soldiers: 0..RANK_MAX from xp (data/ranks.js)
      hp: def.hp, maxHp: def.hp, baseArmor: def.armor, baseDamage: def.attack ? def.attack.damage : 0,
      baseSpeed: def.speed, baseRegen: regen, regen0: regen, passiveLifesteal: lifesteal, evasion, thorns,
      state: 'idle', order: null, orders: [], target: 0, carry: 0, carryAmount: 0,
      cooldowns: {}, statuses: [], aura: null, attackCd: 0,
      mv: null, forced: null, moving: false, ghost: false, arrivedGroup: null,
      summoned: !!opts.summoned, expire: opts.expire || 0,
      autocast: null, manualMask: defaultManualMask(def, owner),
      dmgMult: 1, armorNow: def.armor, speedNow: def.speed, atkSpeedMult: 1, lifesteal, regen, shield: 0,
      stunned: false, invuln: false, slowPct: 0,
      dead: false, constructed: true, buildProgress: 1, queue: null, size: 0, amount: 0,
      lastGather: null, camp: null,
      // Engagement bookkeeping (combat.js / surround.js): current target id, ticks approaching it,
      // ticks blocked, last progress check, the melee attack spot, and attackers claiming spots on us.
      engId: 0, engT: 0, blockedT: 0, engD: 0, engCk: 0, atk: null, claimers: null,
    };
    refreshAutocast(u);
    this.applyUnitStats(u, true);
    computeDerived(u);
    this.entities.set(id, u);
    this.unitList.push(u);
    if (hasAura) this.auraHolders.push(u);
    if (u.radius > this.maxRadius) this.maxRadius = u.radius;
    if (!u.summoned && owner >= 0 && this.players[owner]) this.players[owner].popUsed += def.pop;
    if (!opts.silent) this.emit({ type: 'spawn', id, t: typeId, o: owner });
    return u;
  }

  /**
   * Max hp, damage, armor and regen from the unit type, god level and the
   * owner's upgrades. full: a new unit starts at full health; otherwise the
   * hp gained or lost with the max is added to the current hp.
   */
  applyUnitStats(u, full = false) {
    const def = u.def;
    const p = u.owner >= 0 ? this.players[u.owner] : null;
    const m = unitMods(p ? p.mods : NO_MODS, def);
    const lv = def.class === 'god' ? u.level - 1 : 0;
    const rk = rankBonus(u.rank);
    const hpMult = (1 + GOD_LEVEL_HP * lv) * (1 + m.hp) * (1 + rk.hp);
    const newMax = hpMult === 1 ? def.hp : Math.round(def.hp * hpMult);
    if (full) u.hp = newMax;
    else u.hp = Math.max(1, Math.min(newMax, u.hp + (newMax - u.maxHp)));
    u.maxHp = newMax;
    u.baseDamage = def.attack ? def.attack.damage * (1 + GOD_LEVEL_DAMAGE * lv) * (1 + m.damage) * (1 + rk.damage) : 0;
    u.baseArmor = def.armor + GOD_LEVEL_ARMOR * lv + m.armor + rk.armor;
    u.baseRegen = u.regen0 + m.regen;
    u.baseSpeed = def.speed * (1 + m.speed);
  }

  /** Max hp, armor, damage and range of a building from its type and the owner's upgrades. */
  applyBuildingStats(b) {
    const p = this.players[b.owner];
    const m = buildingMods(p ? p.mods : NO_MODS, b.type);
    const newMax = b.def.hp + m.hp;
    b.hp = Math.max(1, Math.min(newMax, b.hp + (newMax - b.maxHp)));
    b.maxHp = newMax;
    b.armor = b.def.armor + m.armor;
    b.dmgMult = 1 + m.damage;
    b.rangeBonus = m.range;
  }

  /** A building upgrade finished: remember it and apply it to everything the player owns. */
  completeResearch(i, upId) {
    const p = this.players[i];
    if (!p || p.upgrades[upId]) return;
    p.upgrades[upId] = true;
    p.upList.push(upId);
    p.mods = computeMods(p.upList, p.pantheon);
    for (const u of this.unitList) if (!u.dead && u.owner === i) this.applyUnitStats(u);
    for (const b of this.buildingList) if (!b.dead && b.owner === i) this.applyBuildingStats(b);
    this.recomputePopCap(i);
    this.emit({ type: 'researched', player: i, up: upId });
  }

  gainXp(u, amount) {
    if (u.dead || u.def.class !== 'god' || !(amount > 0)) return;
    u.xp += amount;
    while (u.level < GOD_MAX_LEVEL && u.xp >= GOD_XP_LEVELS[u.level]) {
      u.level++;
      this.applyUnitStats(u);
      this.emit({ type: 'levelUp', id: u.id, level: u.level });
    }
  }

  /** Experience for a mortal soldier (data/ranks.js canRank); crossing a threshold raises its rank and stats. */
  gainRankXp(u, amount) {
    if (u.dead || !(amount > 0) || !canRank(u.def)) return;
    u.xp += amount;
    const rank = rankForXp(u.xp);
    if (rank <= u.rank) return;
    u.rank = rank;
    this.applyUnitStats(u);
    this.emit({ type: 'rankUp', id: u.id, rank });
  }

  // -------------------------------------------------------------- read API

  getEntity(id) {
    return this.entities.get(id) || null;
  }

  unitsOf(i) {
    return this.unitList.filter((u) => !u.dead && u.owner === i);
  }

  buildingsOf(i) {
    return this.buildingList.filter((b) => !b.dead && b.owner === i);
  }

  teamOf(owner) {
    if (owner < 0) return -1;
    const p = this.players[owner];
    return p ? p.team : -1;
  }

  /** Owner indices hostile to each other (neutral creeps are hostile to every player). */
  areEnemies(a, b) {
    if (a === b) return false;
    if (a < 0 || b < 0) return true;
    const pa = this.players[a];
    const pb = this.players[b];
    if (!pa || !pb) return false;
    return pa.team !== pb.team;
  }

  /**
   * May owner a hurt owner b? Enemies may (neutral creatures always), except that
   * players are safe from each other while the Decade of Peace lasts.
   */
  canHarm(a, b) {
    return this.areEnemies(a, b) && !(this.peace && a >= 0 && b >= 0);
  }

  /** Is the peace what keeps enemy players a and b from hurting each other right now? */
  peaceBlocks(a, b) {
    return this.peace && a >= 0 && b >= 0 && this.areEnemies(a, b);
  }

  /** Seconds of the Decade of Peace left (0 once it is over, and in a normal game). */
  peaceLeft() {
    return this.peace ? Math.max(0, this.peaceEnd - this.time) : 0;
  }

  /**
   * Does the footprint lie in ground that an enemy Town Center of player i keeps clear right now?
   * While the Decade of Peace lasts nobody may build within PEACE_BUILD_GAP tiles of an enemy Town
   * Center (finished or a site; teammates' do not count). Always false once the peace is over.
   */
  peaceBuildBlocks(i, tx, ty, size) {
    if (!this.peace) return false;
    const centers = [];
    for (const b of this.buildingList) {
      if (!b.dead && b.type === PEACE_ANCHOR && b.owner >= 0 && this.areEnemies(i, b.owner)) centers.push(b);
    }
    return peaceBlocksFootprint(centers, tx, ty, size);
  }

  /** Is a footprint too close to a sacred site's center (5.11)? */
  siteBlocks(tx, ty, size) {
    return siteBlocksFootprint(this.sites, tx, ty, size);
  }

  /**
   * Entities touching a circle: units by edge distance, buildings and mines by footprint distance.
   * @param {function} [filter] (entity) => boolean
   */
  queryRadius(x, y, r, filter) {
    const out = [];
    const tmp = [];
    this.hash.query(x, y, r + this.maxRadius, tmp);
    for (let i = 0; i < tmp.length; i++) {
      const u = tmp[i];
      if (u.dead) continue;
      if (hyp(u.x - x, u.y - y) - u.radius > r) continue;
      if (!filter || filter(u)) out.push(u);
    }
    for (const b of this.buildingList) {
      if (b.dead) continue;
      if (distPointRect(x, y, b.tx, b.ty, b.tx + b.size, b.ty + b.size) > r) continue;
      if (!filter || filter(b)) out.push(b);
    }
    for (const m of this.mineList) {
      if (m.dead) continue;
      if (distPointRect(x, y, m.tx, m.ty, m.tx + m.size, m.ty + m.size) > r) continue;
      if (!filter || filter(m)) out.push(m);
    }
    return out;
  }

  canPlaceBuilding(i, typeId, tx, ty) {
    return canPlace(this, i, typeId, tx, ty);
  }

  /** Why player i cannot place typeId at (tx, ty): null when it can, else the error text (DESIGN 6.2). */
  placementError(i, typeId, tx, ty) {
    return placementError(this, i, typeId, tx, ty);
  }

  findPlacement(i, typeId, nearX, nearY, maxR = 20) {
    return findPlacement(this, i, typeId, nearX, nearY, maxR);
  }

  affordError(i, cost) {
    const p = this.players[i];
    if (!p || !cost) return null;
    const eps = 1e-6;
    if (p.gold + eps < (cost.gold || 0)) return ERRORS_GOLD;
    if (p.wood + eps < (cost.wood || 0)) return ERRORS_WOOD;
    if (p.faith + eps < (cost.faith || 0)) return ERRORS_FAITH;
    return null;
  }

  canAfford(i, cost) {
    return this.affordError(i, cost) === null;
  }

  pay(i, cost) {
    const p = this.players[i];
    p.gold -= cost.gold || 0;
    p.wood -= cost.wood || 0;
    p.faith -= cost.faith || 0;
    if (p.faith < 0 && p.faith > -1e-6) p.faith = 0;
  }

  hasBuilding(i, typeId, completedOnly = true) {
    for (const b of this.buildingList) {
      if (!b.dead && b.owner === i && b.type === typeId && (!completedOnly || b.constructed)) return true;
    }
    return false;
  }

  isGameOver() {
    return !!this.gameOver;
  }

  // ------------------------------------------------------------- commands

  /** Queue a command; it is applied at the start of the next tick. */
  /**
   * Queue a command for the next tick. Untrusted input: anything that is not a
   * well-formed command is dropped (never throws); see normalizeCommand.
   */
  issueCommand(playerIndex, cmd) {
    if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= this.players.length) return;
    if (this.cmdCounts[playerIndex] >= MAX_COMMANDS_PER_TICK) return;
    const clean = normalizeCommand(cmd, this.map);
    if (!clean) return;
    this.cmdCounts[playerIndex]++;
    this.cmdQueue.push([playerIndex, clean]);
  }

  setOrder(u, o, queue = false) {
    setOrder(this, u, o, queue);
  }

  emit(evt) {
    this.events.push(evt);
  }

  error(player, message) {
    if (player >= 0) this.emit({ type: 'error', player, message });
  }

  // ------------------------------------------------------------ lifecycle

  onDamaged(t, src, amount) {
    if (t.owner >= 0 && src && this.areEnemies(src.owner, t.owner)) {
      const p = this.players[t.owner];
      if (p && this.time - p.lastAlert >= UNDER_ATTACK_COOLDOWN) {
        p.lastAlert = this.time;
        this.emit({ type: 'underAttack', player: t.owner, x: Math.round(t.x * 100) / 100, y: Math.round(t.y * 100) / 100, id: t.id });
      }
    }
    if (t.kind === 'unit' && src && amount > 0) onUnitAttacked(this, t, src);
  }

  /**
   * Kill a unit or destroy a building; src is the killer (may be null).
   * expired: a summoned minion ran out of time, which is not a loss.
   */
  killEntity(e, src, expired = false) {
    if (e.dead) return;
    e.dead = true;
    e.hp = 0;
    const killer = src ? src.owner : undefined;
    const r2 = (v) => Math.round(v * 100) / 100;
    if (e.kind === 'unit') {
      this.emit({ type: 'death', id: e.id, t: e.type, o: e.owner, x: r2(e.x), y: r2(e.y), k: 'u' });
      discardOrder(this, e, e.order);
      for (const q of e.orders) discardOrder(this, e, q);
      e.order = null;
      e.orders.length = 0;
      e.mv = null;
      e.forced = null;
      const p = this.players[e.owner];
      if (p) {
        if (!expired) p.stats.losses++;
        if (!e.summoned) p.popUsed = Math.max(0, p.popUsed - e.def.pop);
        if (e.def.class === 'god' && !e.summoned) p.fallen[e.type] = { level: e.level, xp: e.xp };
      }
      if (killer !== undefined && killer >= 0 && this.areEnemies(killer, e.owner)) {
        const kp = this.players[killer];
        if (kp) kp.stats.kills++;
        this.grantXp(e, killer);
        if (src.kind === 'unit') this.gainRankXp(src, killXp(e));
        if (e.owner === NEUTRAL && kp) {
          const amount = 10 + 10 * (e.def.tier || 1);
          kp.gold += amount;
          this.emit({ type: 'bounty', player: killer, amount, x: r2(e.x), y: r2(e.y) });
        }
      }
    } else if (e.kind === 'building') {
      this.emit({ type: 'death', id: e.id, t: e.type, o: e.owner, x: r2(e.x), y: r2(e.y), k: 'b' });
      this.releaseBuilding(e);
      if (killer !== undefined && killer >= 0 && src.kind === 'unit' && this.areEnemies(killer, e.owner)) this.gainRankXp(src, killXp(e));
    }
    if (killer !== undefined && killer >= 0 && !expired && this.areEnemies(killer, e.owner)) awardSpoils(this, e, killer);
  }

  grantXp(dead, killerOwner) {
    const team = this.teamOf(killerOwner);
    const gods = [];
    for (const u of this.unitList) {
      if (u.dead || u.def.class !== 'god' || u.owner < 0) continue;
      if (this.teamOf(u.owner) !== team) continue;
      if (hyp(u.x - dead.x, u.y - dead.y) > XP_RANGE) continue;
      gods.push(u);
    }
    if (!gods.length) return;
    const total = xpValue(dead.def, dead.level || 1);
    const share = Math.max(1, Math.round(total / gods.length));
    for (const g of gods) this.gainXp(g, share);
  }

  releaseBuilding(b) {
    this.map.setOccupied(b.tx, b.ty, b.size, 0);
    const p = this.players[b.owner];
    if (p) {
      for (const q of b.queue) {
        if (q.group) cancelMerge(this, q.group); // a House of four being combined fell: the others stand, the price comes back
        if (q.revive) p.fallen[q.u] = { level: q.revive.level, xp: q.revive.xp };
        p.popUsed = Math.max(0, p.popUsed - q.pop);
      }
    }
    b.queue = [];
    if (b.prayers) b.prayers.fill(0);
    if (b.constructed && !b.def.wall) {
      this.recomputePopCap(b.owner);
      this.recomputeTier(b.owner);
    }
  }

  /** Remove a building without a death (cancelled construction). */
  removeBuilding(b) {
    if (b.dead) return;
    b.dead = true;
    this.releaseBuilding(b);
  }

  completeBuilding(b) {
    b.constructed = true;
    b.buildProgress = 1;
    b.hp = Math.min(b.maxHp, b.hp);
    if (b.def.wall) return; // wall segments come by the dozen: no stats, no message, no population
    const p = this.players[b.owner];
    if (p) p.stats.buildings++;
    if (b.def.prayerSlots > 0) computePrayerSpots(this, b);
    this.emit({ type: 'buildingComplete', id: b.id, t: b.type, o: b.owner });
    this.recomputePopCap(b.owner);
    if (b.type === 'town_center') this.recomputeTier(b.owner);
  }

  /**
   * A building becomes another type in place (a wooden wall upgraded to stone): same entity,
   * same tile, new definition. Health keeps its missing part; armor follows the new type.
   */
  changeBuildingType(b, typeId) {
    const def = BUILDINGS[typeId];
    if (!def || b.dead || def.size !== b.size) return;
    b.type = typeId;
    b.def = def;
    this.applyBuildingStats(b);
  }

  depleteMine(m) {
    if (m.dead) return;
    m.dead = true;
    m.amount = 0;
    this.map.setOccupied(m.tx, m.ty, m.size, 0);
    this.emit({ type: 'resourceDepleted', id: m.id });
    // Rally flags planted on the mine move on to the nearest one, as gatherers do.
    const next = nearestMine(this, m.x, m.y, 16);
    if (!next) return;
    for (const b of this.buildingList) {
      if (!b.dead && b.rally && b.rally.target === m.id) b.rally = { x: next.x, y: next.y, target: next.id, tree: null };
    }
  }

  onTreeFelled(tx, ty) {
    this.emit({ type: 'treeFelled', tx, ty });
    this.felled.push([tx, ty]);
    this.felledAll.push([tx, ty]);
  }

  recomputePopCap(i) {
    const p = this.players[i];
    if (!p) return;
    let cap = 0;
    for (const b of this.buildingList) {
      if (!b.dead && b.owner === i && b.constructed && b.def.popProvided) cap += b.def.popProvided + buildingMods(p.mods, b.type).pop;
    }
    p.popCap = Math.min(POP_MAX, cap);
  }

  recomputeTier(i, silent = false) {
    const p = this.players[i];
    if (!p) return;
    let tier = 1;
    for (const b of this.buildingList) {
      if (!b.dead && b.owner === i && b.type === 'town_center' && b.constructed && b.tier > tier) tier = b.tier;
    }
    const prev = p.tier;
    p.tier = tier;
    if (tier > prev && !silent) this.emit({ type: 'tierUp', player: i, tier });
  }

  recomputePop() {
    for (const p of this.players) p.popUsed = 0;
    for (const u of this.unitList) {
      if (u.dead || u.summoned || u.owner < 0) continue;
      const p = this.players[u.owner];
      if (p) p.popUsed += u.def.pop;
    }
    for (const b of this.buildingList) {
      if (b.dead || b.owner < 0) continue;
      const p = this.players[b.owner];
      if (p) for (const q of b.queue) p.popUsed += q.pop;
    }
  }

  /**
   * Defeat a player: their units die (and on surrender their buildings fall too).
   * deferVictory leaves the victory check to the caller (several players can fall on one tick).
   */
  defeatPlayer(i, surrender = false, deferVictory = false) {
    const p = this.players[i];
    if (!p || p.defeated) return;
    p.defeated = true;
    for (const u of this.unitList) if (!u.dead && u.owner === i) this.killEntity(u, null);
    // A surrendering player's buildings fall with them. Otherwise only wall segments can be left (they
    // do not keep a player in the game): they come down too, or no teammate could ever open them.
    for (const b of this.buildingList) if (!b.dead && b.owner === i && (surrender || b.def.wall)) this.killEntity(b, null);
    this.emit({ type: 'playerDefeated', player: i });
    if (!deferVictory) this.checkVictory();
  }

  /** Sacred Victory (5.11): `team` held every sacred site for SACRED_HOLD seconds. */
  winSacred(team) {
    if (this.gameOver) return;
    this.sacred = null;
    this.winningTeam = team;
    this.gameOver = { winningTeam: team, how: 'sacred' };
    this.emit({ type: 'gameOver', winningTeam: team, how: 'sacred' });
  }

  checkVictory() {
    if (this.gameOver || !this.multiTeam) return;
    const teams = new Set();
    for (const p of this.players) if (!p.defeated) teams.add(p.team);
    if (teams.size > 1) return;
    const winningTeam = teams.size === 1 ? [...teams][0] : null;
    this.winningTeam = winningTeam;
    this.gameOver = { winningTeam };
    this.emit({ type: 'gameOver', winningTeam });
  }

  // ----------------------------------------------------------------- tick

  /** Advance the simulation by one tick (DT seconds). */
  tick() {
    if (this.peace && this.time >= this.peaceEnd - 1e-9) {
      this.peace = false;
      this.emit({ type: 'peaceEnd' });
    }
    const cmds = this.cmdQueue;
    this.cmdQueue = [];
    this.cmdCounts.fill(0);
    for (const [p, cmd] of cmds) {
      try {
        applyCommand(this, p, cmd);
      } catch (err) {
        // A command must never take the game down; count it so tests notice.
        this.perf.commandErrors++;
        this.perf.lastCommandError = String((err && err.message) || err);
      }
    }

    if (this.tickCount % 10 === 0) updateAuras(this);
    const units = this.unitList;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.dead) continue;
      const cd = u.cooldowns;
      for (const k in cd) {
        const v = cd[k] - DT;
        if (v <= 1e-9) delete cd[k];
        else cd[k] = v;
      }
      if (u.attackCd > 0) u.attackCd -= DT;
      if (u.statuses.length) tickStatuses(this, u, dealDamage);
      if (u.dead) continue;
      computeDerived(u);
      if (u.regen !== 0 && u.hp < u.maxHp) u.hp = Math.max(1, Math.min(u.maxHp, u.hp + u.regen * DT));
    }

    const n = units.length;
    for (let i = 0; i < n; i++) {
      const u = units[i];
      if (!u.dead) updateUnit(this, u);
    }

    this.paths.process();
    updateMovement(this);

    const bl = this.buildingList;
    for (let i = 0; i < bl.length; i++) {
      const b = bl[i];
      if (b.dead) continue;
      if (!b.constructed) updateConstruction(this, b);
      else {
        updateBuildingRepair(this, b);
        updateProduction(this, b);
        if (b.def.attack) updateTower(this, b);
      }
    }

    updateProjectiles(this);
    updateDelayed(this);
    updateFields(this);

    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.dead || !u.summoned || !(u.expire > 0)) continue;
      u.expire -= DT;
      if (u.expire <= 1e-9) this.killEntity(u, null, true);
    }

    updateSites(this);
    this.accrueFaith();
    this.cleanup();
    this.checkDefeats();
    this.tickCount++;
    this.time = this.tickCount * DT;
  }

  accrueFaith() {
    for (const p of this.players) p.faithRate = 0;
    for (const b of this.buildingList) {
      if (b.dead || !b.constructed || !(b.def.prayerSlots > 0)) continue;
      let n = 0;
      for (const id of b.prayers) {
        if (!id) continue;
        const u = this.entities.get(id);
        if (u && !u.dead && u.order && u.order.type === 'pray' && u.order.building === b.id && u.order.kneel) n++;
      }
      b.prayingCount = n;
      const p = this.players[b.owner];
      if (p && n > 0) {
        const rate = n * b.def.faithRate * (1 + buildingMods(p.mods, b.type).faith);
        p.faithRate += rate;
        p.faith += rate * DT;
      }
    }
    accrueBlessedFaith(this);
    accrueSiteFaith(this);
  }

  cleanup() {
    let removed = false;
    for (const e of this.unitList) if (e.dead) { this.entities.delete(e.id); removed = true; }
    if (removed) {
      this.unitList = this.unitList.filter((u) => !u.dead);
      this.auraHolders = this.auraHolders.filter((u) => !u.dead);
    }
    if (this.buildingList.some((b) => b.dead)) {
      for (const b of this.buildingList) if (b.dead) this.entities.delete(b.id);
      this.buildingList = this.buildingList.filter((b) => !b.dead);
    }
    if (this.mineList.some((m) => m.dead)) {
      for (const m of this.mineList) if (m.dead) this.entities.delete(m.id);
      this.mineList = this.mineList.filter((m) => !m.dead);
    }
    if (this.tickCount % 20 === 0) this.recomputePop();
  }

  checkDefeats() {
    if (this.gameOver) return;
    const counts = new Array(this.players.length).fill(0);
    // (Wall segments do not keep a player in the game.)
    for (const b of this.buildingList) if (!b.dead && b.owner >= 0 && !b.def.wall) counts[b.owner]++;
    // Everyone left without a building falls on this tick, then the winner is
    // decided once: a mutual wipe-out is a draw, not a win for the higher index.
    let fell = false;
    for (let i = 0; i < this.players.length; i++) {
      if (!this.players[i].defeated && counts[i] === 0) {
        this.defeatPlayer(i, false, true);
        fell = true;
      }
    }
    if (fell) this.checkVictory();
    if (this.unitList.some((u) => u.dead)) {
      for (const e of this.unitList) if (e.dead) this.entities.delete(e.id);
      this.unitList = this.unitList.filter((u) => !u.dead);
    }
  }

  /** ViewSnapshot (DESIGN 6.3); includes and clears pending events and felled trees. */
  getSnapshot() {
    const snap = buildSnapshot(this);
    this.events = [];
    this.felled = [];
    return snap;
  }
}

/**
 * Generate the map for a setup and build the world.
 * @param {object} setup GameSetup
 * @returns {World}
 */
export function createWorld(setup) {
  const mapData = generateMap(mapOptions(setup));
  return new World(setup, mapData);
}
