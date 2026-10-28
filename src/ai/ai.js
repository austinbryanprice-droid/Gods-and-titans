// Computer opponent (DESIGN 10). createAI(world, playerIndex, difficulty)
// returns { tick() }, called every sim tick on the host; the AI thinks every
// AI_THINK_INTERVAL[difficulty] ticks, reads the World and acts only through
// world.issueCommand. It works for every pantheon from data, plays fair (no
// resource cheats) and never throws: a failing think is logged once and the
// AI carries on.
import { RNG, hashSeed } from '../sim/rng.js';
import { profileFor } from './profiles.js';
import { scanWorld } from './scan.js';
import { refreshEconomy, manageWorkers, minersFor } from './economy.js';
import { planBuildings, resumeSites } from './build.js';
import { planProduction, planResearch } from './production.js';
import { runMilitary, newMilitary } from './military.js';
import { runMicro } from './micro.js';
import { pantheonRoster } from './unit-info.js';
import { runAid } from './team.js';
import { runRelics } from './relics.js';

const DIFFICULTIES = new Set(['easy', 'normal', 'hard']);

/**
 * One computer player. Debug hooks (all off by default): `sections = {}`
 * collects per-step think time in ms, `debug = []` holds the last think's
 * spending decisions (`label:priority:status`), `log = []` records military
 * mode changes; `stats` counts thinks, think time and casts.
 */
export class AIPlayer {
  /**
   * @param {object} world authoritative World
   * @param {number} me player index
   * @param {'easy'|'normal'|'hard'} difficulty
   */
  constructor(world, me, difficulty = 'normal') {
    this.world = world;
    this.me = me;
    this.difficulty = DIFFICULTIES.has(difficulty) ? difficulty : 'normal';
    this.prof = profileFor(this.difficulty);
    const seed = world.setup ? world.setup.seed : 1;
    this.rng = new RNG(hashSeed(`${seed}:ai:${me}`));
    this.phase = (me * 7 + 3) % this.prof.think;
    const p = world.players[me];
    this.roster = pantheonRoster(p ? p.pantheon : 'greek');
    this.mil = newMilitary();
    this.godRetreat = new Set();
    this.militia = new Set();
    this.pairs = [];
    this.drops = [];
    this.woodSpot = null;
    this.expansion = null;
    this.towerTarget = null;
    this.threat = null;
    this.thinks = 0;
    this.errors = 0;
    this.loggedError = false;
    this.stats = { casts: 0, thinkMs: 0, thinks: 0 };
    this.lastOrder = new Map(); // unit id -> tick of its last AI order
    this.cmdMemo = new Map(); // unit id -> { type, x, y, tick } of its last move-like order
    this._focusAt = 0; // focus-fire rotation through the army
    this._tmp = []; // scratch arrays for spatial-hash queries
    this._ftmp = [];
    this.homeAnchor = null;
    this._rally = null;
    this._rallyKey = '';
    this.s = null;
  }

  /** Called every sim tick. */
  tick() {
    const world = this.world;
    if ((world.tickCount + this.phase) % this.prof.think !== 0) return;
    const p = world.players[this.me];
    if (!p || p.defeated || world.gameOver) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    try {
      this.think();
    } catch (err) {
      this.errors++;
      if (!this.loggedError) {
        this.loggedError = true;
        console.error(`[ai] player ${this.me} think failed (the AI keeps going):`, err);
      }
    }
    if (t0) {
      this.stats.thinkMs += performance.now() - t0;
      this.stats.thinks++;
    }
  }

  think() {
    const world = this.world;
    const prof = this.sections;
    let t = prof ? performance.now() : 0;
    const lap = (name) => {
      if (!prof) return;
      const n = performance.now();
      prof[name] = (prof[name] || 0) + n - t;
      t = n;
    };
    const s = scanWorld(world, this.me);
    this.s = s;
    this.thinks++;
    if (this.thinks % 64 === 0) this.pruneMemory();
    lap('scan');
    // Idle worshippers mend damaged buildings (the sim does the repairing).
    if (!s.p.autoRepair) this.issue({ type: 'autoRepair', on: true });
    this.updateHome(s);
    refreshEconomy(this, s);
    this.updateExpansion(s);
    lap('econ');
    runMilitary(this, s);
    lap('military');
    runRelics(this, s);
    manageWorkers(this, s);
    resumeSites(this, s);
    lap('workers');
    const wants = [];
    if (this.debug) this.debug = [];
    planBuildings(this, s, wants);
    planProduction(this, s, wants);
    planResearch(this, s, wants);
    const left = this.spend(s, wants);
    runAid(this, left);
    this.updateRallies(s);
    lap('plan');
    runMicro(this, s);
    lap('micro');
  }

  /** Buy wants in priority order; unaffordable high-priority wants reserve their cost. Returns what is left. */
  spend(s, wants) {
    const p = s.p;
    const budget = { gold: p.gold, wood: p.wood, faith: p.faith };
    let pop = p.popCap - p.popUsed;
    wants.sort((a, b) => b.prio - a.prio);
    for (const w of wants) {
      const c = w.cost || {};
      const g = c.gold || 0;
      const wd = c.wood || 0;
      const f = c.faith || 0;
      const needPop = w.pop || 0;
      // A reserve can push a resource negative: only resources the want costs matter.
      const affordable = (g <= 0 || budget.gold >= g) && (wd <= 0 || budget.wood >= wd) && (f <= 0 || budget.faith >= f);
      let status = 'skip';
      // Only wants that cost population wait for room: after a raid kills houses or the Town Center the
      // pop is over the cap (negative room), and the pop-free rebuilds must still go through.
      if (affordable && (needPop <= 0 || needPop <= pop)) {
        if (w.run()) {
          budget.gold -= g;
          budget.wood -= wd;
          budget.faith -= f;
          pop -= needPop;
          status = 'done';
        } else status = 'fail';
      } else if (w.reserve) {
        budget.gold -= g;
        budget.wood -= wd;
        budget.faith -= f;
        status = 'reserve';
      }
      if (this.debug) this.debug.push(`${w.label}:${w.prio}:${status}`);
    }
    return budget;
  }

  /** Send a command to the world (remembering which units were ordered when). */
  issue(cmd) {
    if (cmd.units) for (const id of cmd.units) this.lastOrder.set(id, this.world.tickCount);
    this.world.issueCommand(this.me, cmd);
  }

  /** Forget per-unit bookkeeping of units that are gone. */
  pruneMemory() {
    const ents = this.world.entities;
    for (const map of [this.lastOrder, this.cmdMemo]) {
      for (const id of map.keys()) {
        const u = ents.get(id);
        if (!u || u.dead) map.delete(id);
      }
    }
  }

  recentlyOrdered(u) {
    const t = this.lastOrder.get(u.id);
    return t !== undefined && this.world.tickCount - t < 100;
  }

  // ------------------------------------------------------------ base geometry

  updateHome(s) {
    let tc = s.tcs.find((b) => this.homeTcId === b.id) || null;
    if (!tc && s.tcs.length) {
      const anchor = this.homeAnchor;
      tc = anchor ? s.tcs.reduce((a, b) => (Math.hypot(b.x - anchor.x, b.y - anchor.y) < Math.hypot(a.x - anchor.x, a.y - anchor.y) ? b : a)) : s.tcs[0];
      this.homeTcId = tc.id;
    }
    if (tc) {
      this.homeAnchor = { x: tc.x, y: tc.y };
    } else if (!this.homeAnchor) {
      const b = s.buildings[0];
      const u = s.workers[0];
      this.homeAnchor = b ? { x: b.x, y: b.y } : u ? { x: u.x, y: u.y } : { x: this.world.map.width / 2, y: this.world.map.height / 2 };
    }
  }

  /** Center of the main base. */
  home() {
    return this.homeAnchor;
  }

  /** Unit vector from home toward the map center (the "front" of the base). */
  frontDir() {
    const h = this.home();
    const map = this.world.map;
    const dx = map.width / 2 - h.x;
    const dy = map.height / 2 - h.y;
    const l = Math.hypot(dx, dy);
    if (l < 1) return { x: 0, y: 1 };
    return { x: dx / l, y: dy / l };
  }

  /** Army gathering point in front of the base. */
  rallyPoint() {
    const h = this.home();
    const key = `${Math.round(h.x)},${Math.round(h.y)}`;
    if (this._rally && this._rallyKey === key) return this._rally;
    const f = this.frontDir();
    const map = this.world.map;
    let x = h.x + f.x * 9;
    let y = h.y + f.y * 9;
    const p = map.nearestPassable(x, y, 10, false);
    if (p) {
      x = p.tx + 0.5;
      y = p.ty + 0.5;
    }
    this._rally = { x, y };
    this._rallyKey = key;
    return this._rally;
  }

  /** Where hurt gods go: next to a Temple, else the Town Center. */
  retreatPoint() {
    const s = this.s;
    const temple = s && (s.done.get('temple') || [])[0];
    const b = temple || (s && s.tcs[0]);
    if (b) return { x: b.x, y: b.ty + b.size + 1 };
    return this.home();
  }

  /** Where praying workers are (for picking who goes to pray). */
  prayerPoint(s) {
    const b = (s.done.get('temple') || s.done.get('shrine') || [])[0];
    return b ? { x: b.x, y: b.y } : this.home();
  }

  layoutKey() {
    const ws = this.woodSpot;
    return `${this.homeTcId || 0}:${this.pairs.map((p) => p.mine.id).join(',')}:${ws ? ws.tx + ',' + ws.ty : ''}`;
  }

  /** Mine/drop-off pairs used for keeping mining lanes free. */
  minePairs() {
    return this.pairs;
  }

  /** Is a mine unsafe (enemy buildings next to it, or a living creep camp guarding it)? */
  mineThreatened(m, s) {
    for (const camp of s.camps) {
      if (Math.hypot(camp.x - m.x, camp.y - m.y) < 8) return true;
    }
    for (const e of s.enemies) {
      if (e.defeated) continue;
      for (const b of e.buildings) if (!b.dead && Math.hypot(b.x - m.x, b.y - m.y) < 10) return true;
    }
    return false;
  }

  /** Any enemy combat unit within r of a point? */
  threatNear(x, y, r) {
    const th = this.threat;
    if (!th) return false;
    for (const u of th.units) if (Math.hypot(u.x - x, u.y - y) < r) return true;
    return false;
  }

  savingForTitan(s) {
    if (!this.roster.titan || s.p.tier < 3) return false;
    if ((s.alive.get(this.roster.titan) || 0) + (s.queued.get(this.roster.titan) || 0) > 0) return false;
    return (s.have.get('titan_gate') || 0) > 0;
  }

  // -------------------------------------------------------------- expansion

  updateExpansion(s) {
    const world = this.world;
    const prof = this.prof;
    const ex = this.expansion;
    if (ex) {
      if (ex.mine.dead || ex.mine.amount <= 0) {
        this.expansion = null;
        return;
      }
      ex.ready = !ex.camp || !ex.camp.members.some((m) => !m.dead);
      ex.built = this.pairs.some((p) => p.mine === ex.mine);
      if (ex.built) {
        // Done: ask for a guard tower (normal/hard) and free the slot for the next expansion.
        if (prof.towersMax >= 2 && !this.towerTarget) this.towerTarget = { x: ex.mine.x, y: ex.mine.y, urgent: false, t: s.t };
        this.expansion = null;
        return;
      }
      if (this.expansion && s.t - ex.since > 300 && !ex.built) this.expansion = null; // give up, try another
      return;
    }
    if (!s.tcs.length || s.t < 150) return;
    // One mine caps at 13.3 gold/s (2 miners at once), so income grows by
    // taking more mines: a second one from expandAt, a third from expandAt2,
    // and a replacement whenever the owned mines run low.
    let owned = 0;
    let live = 0;
    for (const p of this.pairs) {
      owned += p.mine.amount;
      if (p.mine.amount >= 2500) live++;
    }
    let want = 1;
    if (s.t >= prof.expandAt) want = 2;
    if (s.t >= prof.expandAt2) want = 3;
    const trigger = live < want || owned < prof.expandBelow;
    if (!trigger) return;
    if (s.workers.length < 10) return;
    const home = this.home();
    let best = null;
    let bestD = Infinity;
    for (const m of world.mineList) {
      if (m.dead || m.amount < 3000) continue;
      if (this.pairs.some((p) => p.mine === m)) continue;
      let blocked = false;
      for (const b of world.buildingList) {
        if (b.dead || b.owner === this.me || b.owner < 0 || b.def.wall) continue;
        if (Math.hypot(b.x - m.x, b.y - m.y) < 12) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      const d = Math.hypot(m.x - home.x, m.y - home.y);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    if (!best) return;
    let camp = null;
    let campD = 9;
    for (const c of s.camps) {
      const d = Math.hypot(c.x - best.x, c.y - best.y);
      if (d < campD) {
        campD = d;
        camp = c;
      }
    }
    this.expansion = { mine: best, camp, ready: !camp, built: false, since: s.t };
  }

  // ---------------------------------------------------------------- rallies

  updateRallies(s) {
    if (this.thinks % 4 !== 0) return;
    const rp = this.rallyPoint();
    for (const b of s.buildings) {
      if (!b.constructed) continue;
      if (b.type === 'town_center') {
        // New worshippers go where a job is open: a mine with room (this one's first), else the wood line.
        let pr = null;
        let room = 0;
        for (const q of this.pairs) {
          const r = minersFor(this, q) - q.workers + (q.drop === b ? 0.5 : 0) - Math.hypot(q.mine.x - b.x, q.mine.y - b.y) * 0.01;
          if (r > room) {
            room = r;
            pr = q;
          }
        }
        const tw = this.woodSpot;
        if (pr) {
          if (!b.rally || b.rally.target !== pr.mine.id) this.issue({ type: 'rally', building: b.id, x: pr.mine.x, y: pr.mine.y, target: pr.mine.id });
        } else if (tw && this.world.map.isTreeAccessible(tw.tx, tw.ty)) {
          if (!b.rally || !b.rally.tree || b.rally.tree.tx !== tw.tx || b.rally.tree.ty !== tw.ty) this.issue({ type: 'rally', building: b.id, x: tw.tx + 0.5, y: tw.ty + 0.5 });
        } else {
          const home = this.pairs.find((p) => p.drop === b);
          if (home && (!b.rally || b.rally.target !== home.mine.id)) this.issue({ type: 'rally', building: b.id, x: home.mine.x, y: home.mine.y, target: home.mine.id });
        }
        continue;
      }
      if (b.type === 'barracks' || b.type === 'shrine' || b.type === 'temple' || b.type === 'titan_gate') {
        const r = b.rally;
        if (!r || Math.abs(r.x - rp.x) > 0.5 || Math.abs(r.y - rp.y) > 0.5 || r.target) this.issue({ type: 'rally', building: b.id, x: rp.x, y: rp.y });
      }
    }
  }
}

/**
 * Create an AI controller for one player.
 * @param {object} world the authoritative World
 * @param {number} playerIndex
 * @param {'easy'|'normal'|'hard'} [difficulty]
 * @returns {{ tick(): void, ai: AIPlayer }}
 */
export function createAI(world, playerIndex, difficulty = 'normal') {
  const ai = new AIPlayer(world, playerIndex, difficulty);
  return {
    ai,
    tick() {
      ai.tick();
    },
  };
}
