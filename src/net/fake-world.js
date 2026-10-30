// A stand-in World for network tests and the tools/net-test.html harness:
// implements issueCommand / tick / getSnapshot with seeded, randomized but
// plausible ViewSnapshots (entities moving, spawning and dying, optional fields
// appearing and disappearing, events, felled trees, fields, reveals, game over).
// Not used by the real game.
import { TERRAIN, TREE_WOOD, DT } from '../config.js';
import { RNG } from '../sim/rng.js';

const UNIT_TYPES = ['worshipper', 'warrior', 'archer', 'priest', 'battering_ram'];
const BUILDING_TYPES = [['town_center', 4], ['house', 2], ['barracks', 3], ['shrine', 2], ['temple', 3], ['tower', 2]];
const STATES = ['idle', 'move', 'attack', 'gather', 'return', 'build', 'pray', 'cast'];
const STATUS = ['stun', 'slow', 'shield', 'invuln', 'buff', 'debuff', 'dot'];
const ELEMENTS = ['fire', 'lightning', 'holy', 'shadow', 'water'];
const r2 = (v) => Math.round(v * 100) / 100 + 0; // + 0 turns -0 into 0
const r1 = (v) => Math.round(v * 10) / 10 + 0;

/** Synthetic MapData: grass with forest bands along the top and bottom edges. */
export function makeFakeMap(width = 48, height = 48, seed = 1) {
  const terrain = new Uint8Array(width * height).fill(TERRAIN.GRASS);
  const wood = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (y < 3 || y >= height - 3 || (x > width / 2 - 3 && x < width / 2 + 3 && y > height / 3 && y < (2 * height) / 3)) {
        terrain[y * width + x] = TERRAIN.FOREST;
        wood[y * width + x] = TREE_WOOD;
      }
    }
  }
  return {
    width,
    height,
    seed,
    terrain,
    heights: new Float32Array((width + 1) * (height + 1)),
    wood,
    starts: [{ x: 4, y: 6 }, { x: width - 8, y: height - 10 }],
    mines: [],
    camps: [],
    decor: [],
  };
}

export class FakeWorld {
  /**
   * @param {object} setup GameSetup
   * @param {object} [opts]
   * @param {number} [opts.units] initial unit count (spread over the players)
   * @param {number} [opts.buildings] initial buildings per player
   * @param {number} [opts.width] map size in tiles
   * @param {number} [opts.gameOverTick] tick at which the game ends (team of player 0 wins)
   * @param {number} [opts.churn] probability scale for spawning / dying / field changes
   */
  constructor(setup, opts = {}) {
    this.setup = setup;
    this.opts = opts;
    const w = opts.width || 48;
    this.mapData = makeFakeMap(w, opts.height || w, setup.seed);
    this.width = this.mapData.width;
    this.height = this.mapData.height;
    this.rng = new RNG(`${setup.seed}:fake`);
    this.tickCount = 0;
    this.time = 0;
    this.nextId = 1;
    this.entities = new Map();
    this.events = [];
    this.felled = [];
    this.fields = [];
    this.reveals = [];
    this.gameOver = null;
    this.commands = []; // { tick, player, cmd } as issued
    this.queue = [];
    this.churn = opts.churn ?? 1;
    this.players = setup.players.map((p, i) => ({
      i, name: p.name, team: p.team, pantheon: p.pantheon, color: p.color, kind: p.kind,
      gold: 400, wood: 200, faith: 50, faithRate: 0, pop: 5, popCap: 12, tier: 1, defeated: false,
      gods: [], fallen: {}, titan: false,
      stats: { gathered: 0, unitsTrained: 0, kills: 0, losses: 0, buildings: 1 },
    }));
    this.addMine(10, 20, 12000);
    this.addMine(w - 14, w - 24, 12000);
    for (let i = 0; i < this.players.length; i++) {
      for (let b = 0; b < (opts.buildings ?? 2); b++) this.addBuilding(i);
    }
    const n = opts.units ?? 20;
    for (let u = 0; u < n; u++) this.addUnit(u % Math.max(1, this.players.length));
  }

  emit(ev) {
    this.events.push(ev);
  }

  addMine(tx, ty, amount) {
    const id = this.nextId++;
    this.entities.set(id, { id, k: 'm', t: 'gold_mine', o: -1, x: tx + 1.5, y: ty + 1.5, f: 0, hp: 999999, mhp: 999999, sh: 0, st: 'idle', tg: 0, tx, ty, amt: amount });
  }

  addBuilding(owner) {
    const rng = this.rng;
    const [t, size] = rng.pick(BUILDING_TYPES);
    const tx = rng.int(4, this.width - 4 - size);
    const ty = rng.int(4, this.height - 4 - size);
    const id = this.nextId++;
    const e = {
      id, k: 'b', t, o: owner, x: tx + size / 2, y: ty + size / 2, f: 0, hp: 500, mhp: 500, sh: 0,
      st: 'idle', tg: 0, tx, ty, bp: rng.chance(0.3) ? r2(rng.next() * 0.9) : 1, q: [], rp: null,
    };
    if (t === 'town_center') e.tr = 1;
    if (t === 'shrine' || t === 'temple') e.pr = 0;
    this.entities.set(id, e);
    this.emit({ type: 'construction', id, t, o: owner });
    return e;
  }

  addUnit(owner, x, y) {
    const rng = this.rng;
    const god = rng.chance(0.1);
    const t = god ? 'greek_zeus' : rng.pick(UNIT_TYPES);
    const id = this.nextId++;
    const e = {
      id, k: 'u', t, o: owner,
      x: r2(x ?? rng.range(4, this.width - 4)), y: r2(y ?? rng.range(4, this.height - 4)), f: r2(rng.range(-3.1, 3.1)),
      hp: 300, mhp: 300, sh: 0, st: 'idle', tg: 0, c: 0, cd: {}, fx: [],
    };
    if (god) {
      e.lv = 1;
      e.xp = 0;
    }
    if (rng.chance(0.05)) e.ex = r1(rng.range(5, 30));
    this.entities.set(id, e);
    this.emit({ type: 'spawn', id, t, o: owner });
    return e;
  }

  /** Commands are recorded and applied at the start of the next tick (move / stop are honoured). */
  issueCommand(player, cmd) {
    this.queue.push({ player, cmd });
  }

  tick() {
    const rng = this.rng;
    for (const q of this.queue) {
      this.commands.push({ tick: this.tickCount, player: q.player, cmd: q.cmd });
      if ((q.cmd.type === 'move' || q.cmd.type === 'attackMove' || q.cmd.type === 'patrol') && Array.isArray(q.cmd.units)) {
        for (const id of q.cmd.units) {
          const e = this.entities.get(id);
          if (e && e.k === 'u' && e.o === q.player) e.goal = { x: q.cmd.x, y: q.cmd.y };
        }
      } else if (q.cmd.type === 'surrender') {
        this.players[q.player].defeated = true;
        this.emit({ type: 'playerDefeated', player: q.player });
      }
    }
    this.queue.length = 0;

    for (const e of [...this.entities.values()]) {
      if (e.k === 'u') this.tickUnit(e);
      else if (e.k === 'b') this.tickBuilding(e);
      else if (e.k === 'm' && rng.chance(0.05)) e.amt = Math.max(0, e.amt - 10);
    }
    const c = this.churn;
    if (rng.chance(0.05 * c)) this.addUnit(rng.int(0, this.players.length - 1));
    if (rng.chance(0.04 * c)) {
      const units = [...this.entities.values()].filter((e) => e.k === 'u');
      if (units.length > 3) {
        const u = rng.pick(units);
        this.entities.delete(u.id);
        this.emit({ type: 'death', id: u.id, t: u.t, o: u.o, x: u.x, y: u.y, k: 'u' });
      }
    }
    if (rng.chance(0.01 * c)) this.addBuilding(rng.int(0, this.players.length - 1));
    if (rng.chance(0.005 * c)) {
      const bs = [...this.entities.values()].filter((e) => e.k === 'b');
      if (bs.length > this.players.length) {
        const b = rng.pick(bs);
        this.entities.delete(b.id);
        this.emit({ type: 'death', id: b.id, t: b.t, o: b.o, x: b.x, y: b.y, k: 'b' });
      }
    }
    if (rng.chance(0.08 * c)) {
      const tx = rng.int(0, this.width - 1);
      const ty = rng.chance(0.5) ? rng.int(0, 2) : rng.int(this.height - 3, this.height - 1);
      const i = ty * this.width + tx;
      if (this.mapData.terrain[i] === TERRAIN.FOREST && !this.isFelled(tx, ty)) {
        this.felledSet.add(i);
        this.felled.push([tx, ty]);
        this.emit({ type: 'treeFelled', tx, ty });
      }
    }
    if (rng.chance(0.3)) this.emit({ type: 'hit', dst: rng.int(1, this.nextId), amount: rng.int(1, 60), src: rng.int(1, this.nextId) });
    if (rng.chance(0.1)) this.emit({ type: 'effect', el: rng.pick(ELEMENTS), shape: 'nova', x: r2(rng.range(0, this.width)), y: r2(rng.range(0, this.height)), r: 2, duration: 0.6 });
    if (rng.chance(0.02)) this.emit({ type: 'error', player: rng.int(0, this.players.length - 1), message: 'Not enough gold.' });

    if (rng.chance(0.02 * c)) this.fields.push({ id: this.nextId++, x: r2(rng.range(5, 40)), y: r2(rng.range(5, 40)), r: 2.5, el: rng.pick(ELEMENTS), rem: 4 });
    for (const f of this.fields) f.rem = r1(f.rem - DT);
    this.fields = this.fields.filter((f) => f.rem > 0);
    if (rng.chance(0.01 * c)) this.reveals.push({ x: r2(rng.range(5, 40)), y: r2(rng.range(5, 40)), r: 6, tm: rng.int(1, 2), rem: 3 });
    for (const v of this.reveals) v.rem = r1(v.rem - DT);
    this.reveals = this.reveals.filter((v) => v.rem > 0);

    for (const p of this.players) {
      if (rng.chance(0.3)) p.gold += rng.int(0, 10);
      if (rng.chance(0.2)) p.wood += rng.int(0, 10);
      if (rng.chance(0.1)) p.faith += 1;
      if (rng.chance(0.02)) p.stats.kills++;
      p.faithRate = r2(rng.chance(0.5) ? 0.5 : 1.2);
    }

    this.tickCount++;
    this.time = r2(this.tickCount * DT);
    if (this.opts.gameOverTick && this.tickCount === this.opts.gameOverTick) {
      this.gameOver = { winningTeam: this.players[0] ? this.players[0].team : 1 };
      this.emit({ type: 'gameOver', winningTeam: this.gameOver.winningTeam });
    }
  }

  get felledSet() {
    if (!this._felledSet) this._felledSet = new Set();
    return this._felledSet;
  }

  isFelled(tx, ty) {
    return this.felledSet.has(ty * this.width + tx);
  }

  tickUnit(e) {
    const rng = this.rng;
    if (e.goal) {
      const dx = e.goal.x - e.x;
      const dy = e.goal.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.2) {
        e.goal = null;
        e.st = 'idle';
      } else {
        const s = Math.min(d, 0.15);
        e.x = r2(e.x + (dx / d) * s);
        e.y = r2(e.y + (dy / d) * s);
        e.f = r2(Math.atan2(dy, dx));
        e.st = 'move';
      }
    } else if (rng.chance(0.6)) {
      const a = rng.range(-Math.PI, Math.PI);
      e.x = r2(Math.min(this.width - 1, Math.max(1, e.x + Math.cos(a) * 0.12)));
      e.y = r2(Math.min(this.height - 1, Math.max(1, e.y + Math.sin(a) * 0.12)));
      e.f = r2(a);
    }
    if (rng.chance(0.08)) e.hp = Math.max(1, e.hp - rng.int(1, 30));
    if (rng.chance(0.05)) e.st = rng.pick(STATES);
    if (rng.chance(0.05)) e.tg = rng.chance(0.5) ? 0 : rng.int(1, this.nextId);
    if (rng.chance(0.03)) e.c = rng.pick([0, 'g', 'w']);
    if (rng.chance(0.04)) {
      const cd = { ...e.cd };
      const k = `ab${rng.int(1, 3)}`;
      if (cd[k]) delete cd[k];
      else cd[k] = r1(rng.range(1, 12));
      e.cd = cd;
    }
    if (rng.chance(0.03)) e.fx = rng.chance(0.4) ? [] : [rng.pick(STATUS)];
    if (rng.chance(0.03)) e.sh = rng.chance(0.5) ? 0 : rng.int(10, 120);
    if (e.t === 'worshipper' && rng.chance(0.03)) {
      if (e.bo) delete e.bo;
      else e.bo = { b: 'house', tx: rng.int(2, 40), ty: rng.int(2, 40) };
    }
    if (e.lv !== undefined && rng.chance(0.02)) {
      e.xp += 15;
      if (rng.chance(0.2) && e.lv < 6) {
        e.lv++;
        this.emit({ type: 'levelUp', id: e.id, level: e.lv });
      }
    }
    if (e.ex !== undefined) {
      e.ex = r1(e.ex - DT);
      if (e.ex <= 0) delete e.ex; // becomes permanent: exercises a disappearing optional field
    }
  }

  tickBuilding(e) {
    const rng = this.rng;
    if (e.bp < 1 && rng.chance(0.2)) {
      e.bp = Math.min(1, r2(e.bp + 0.02));
      e.st = e.bp < 1 ? 'build' : 'idle';
      if (e.bp === 1) this.emit({ type: 'buildingComplete', id: e.id, t: e.t, o: e.o });
    }
    if (rng.chance(0.02) && e.q.length < 5) e.q = [...e.q, { u: 'worshipper', p: 0 }];
    if (e.q.length && rng.chance(0.3)) {
      const q = e.q.map((x) => ({ ...x }));
      q[0].p = r2(q[0].p + 0.05);
      if (q[0].p >= 1) q.shift();
      e.q = q;
    }
    if (rng.chance(0.01)) e.rp = rng.chance(0.3) ? null : [r2(rng.range(2, 40)), r2(rng.range(2, 40))];
    if (e.pr !== undefined && rng.chance(0.03)) e.pr = rng.int(0, 5);
    if (rng.chance(0.01)) e.hp = Math.max(1, e.hp - rng.int(5, 50));
  }

  getSnapshot() {
    const entities = [];
    for (const e of this.entities.values()) {
      const v = { ...e };
      delete v.goal;
      if (v.cd) v.cd = { ...v.cd };
      if (v.fx) v.fx = [...v.fx];
      if (v.q) v.q = v.q.map((x) => ({ ...x }));
      if (v.rp) v.rp = [...v.rp];
      if (v.bo) v.bo = { ...v.bo };
      entities.push(v);
    }
    const snap = {
      tick: this.tickCount,
      time: this.time,
      players: this.players.map((p) => ({ ...p, gods: [...p.gods], fallen: { ...p.fallen }, stats: { ...p.stats } })),
      entities,
      fields: this.fields.map((f) => ({ ...f })),
      reveals: this.reveals.map((v) => ({ ...v })),
      events: this.events,
      felled: this.felled,
      gameOver: this.gameOver ? { ...this.gameOver } : null,
    };
    this.events = [];
    this.felled = [];
    return snap;
  }
}

/** createWorld-compatible factory: (setup) => FakeWorld. */
export function fakeWorldFactory(opts = {}) {
  return (setup) => new FakeWorld(setup, opts);
}
