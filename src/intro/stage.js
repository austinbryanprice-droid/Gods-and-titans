// The intro film's set (DESIGN 11.1): a seeded little world, a Greek village in a meadow and a
// Norse host at its edge, played by the real simulation with no AI and no player. The film's
// script (script.js) frames it; this file builds it and runs its cues: the village at work, a
// god summoned at the temple, the two armies meeting, a titan stepping out of the Titan Gate.
//
//   const stage = new IntroStage({ density: 1 });
//   stage.advance(dt);            // simulate dt film seconds (20 ticks a second, the view state fed as in a match)
//   stage.vs                      // the ViewState a GameRenderer draws (a spectator's: nothing is hidden)
//   stage.anchors / stage.actor(name) / stage.crowd()   where the script points the camera
//
// Pure simulation and data: no DOM, no three.js, so it runs in Node (the tests play the whole film).
import { generateMap, mapOptions } from '../sim/mapgen.js';
import { World } from '../sim/world.js';
import { ViewState } from '../game/view-state.js';
import { DT, PLAYER_COLORS, TERRAIN } from '../config.js';
import { PANTHEONS, PANTHEON_LIST } from '../data/index.js';

/** The seed of the film's map: a small meadow with a lake in the middle, the Greek start in the north-west corner. */
export const STAGE_SEED = 12345;
/** Film seconds at which the stage's cues fire (the script's shots are timed round them). */
export const CUE_TIMES = Object.freeze({ summon: 11.5, muster: 17.5, war: 19, titans: 29.5, lineup: 36.7 });

const MAX_TICKS_PER_ADVANCE = 12; // a stalled frame must not make the sim catch up for seconds
const GOD_LEVEL = 5; // every ability unlocked
const SOLDIER_HP = [3, 2]; // each side's soldiers' toughness (Greek, Norse): the clash lasts the film's seconds instead of the first thunderclap
const FILM_QUIET = new Set(['levelUp', 'rankUp', 'bounty', 'error']); // game events the film does not want on screen (floating level and rank texts)
const ULT_COOLDOWN = 60; // an ability on a cooldown this long is a god's ultimate: the film lets it off at a chosen moment
const LINEUP_GAP = 3.1; // tiles between the ten gods of the finale
const GLADE = { x0: 40, y0: 17, x1: 70, y1: 31 }; // forest cut away south of the finale's meadow, so the camera stands in the open
const LINEUP_RIPPLE = 0.3; // seconds between one god's summoning and the next's

const greek = 0;
const norse = 1;

/** Turn the forest inside a rectangle of tiles to meadow (before the world and the renderer are built from the map). */
function clearForest(map, { x0, y0, x1, y1 }) {
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const i = ty * map.width + tx;
      if (map.terrain[i] !== TERRAIN.FOREST) continue;
      map.terrain[i] = TERRAIN.GRASS;
      if (map.wood) map.wood[i] = 0;
    }
  }
}

function stageSetup() {
  return {
    version: '0.1.0',
    seed: STAGE_SEED,
    mapSize: 'small',
    players: [
      { index: 0, name: 'Athens', team: 1, pantheon: 'greek', color: PLAYER_COLORS[0], kind: 'human', difficulty: null },
      { index: 1, name: 'Midgard', team: 2, pantheon: 'norse', color: PLAYER_COLORS[1], kind: 'human', difficulty: null },
    ],
  };
}

export class IntroStage {
  /**
   * @param {object} [o]
   * @param {number} [o.density] 1 is the whole cast; less (low quality) thins the armies and the crowd
   */
  constructor({ density = 1 } = {}) {
    this.density = Math.max(0.3, Math.min(1, density));
    this.setup = stageSetup();
    const mapData = generateMap(mapOptions(this.setup));
    mapData.camps = []; // no neutral creatures: the cast is the film's own
    clearForest(mapData, GLADE);
    this.world = new World(this.setup, mapData);
    this.vs = new ViewState({ setup: this.setup, mapData: this.world.mapData, myIndex: -1, interpDelayMs: 50 });
    this.time = 0; // film seconds simulated
    this.vnow = 1000; // the view state's clock (ms)
    this.acc = 0;
    this.ultAt = 25; // film seconds from which the gods may cast their ultimates
    this.actors = new Map(); // name → entity id
    this.finale = new Set(); // the ten gods of the last shot: they stand, whatever is near
    this.seen = new Map(); // name → where that actor last stood (the camera keeps looking there once it has fallen)
    this.anchors = {};
    this.cues = [];
    this.build();
    this.vs.pushSnapshot(this.world.getSnapshot(), this.vnow);
  }

  // ------------------------------------------------------------------ running

  /** Simulate `dt` film seconds, and bring the view state up to them. Returns the ticks run. */
  advance(dt) {
    if (!(dt > 0)) return 0;
    this.acc += Math.min(dt, MAX_TICKS_PER_ADVANCE * DT);
    let ticks = 0;
    while (this.acc >= DT - 1e-9 && ticks < MAX_TICKS_PER_ADVANCE) {
      this.acc -= DT;
      this.tick();
      ticks++;
    }
    this.vnow += dt * 1000;
    this.vs.update(this.vnow);
    return ticks;
  }

  tick() {
    const w = this.world;
    while (this.cues.length && this.cues[0].at <= w.time + 1e-9) this.cues.shift().run(this);
    this.castSpells();
    w.tick();
    this.time = w.time;
    for (const name of this.actors.keys()) {
      const u = this.actor(name);
      if (u) this.seen.set(name, { x: u.x, y: u.y });
    }
    const snap = w.getSnapshot();
    snap.events = snap.events.filter((e) => !FILM_QUIET.has(e.type));
    this.vs.pushSnapshot(snap, this.vnow);
  }

  // ------------------------------------------------------------------ lookups

  /** The live unit a cue named (a god, the titan), or null. */
  actor(name) {
    const e = this.world.getEntity(this.actors.get(name));
    return e && !e.dead ? e : null;
  }

  /** Where the fighting is: the middle of the soldiers, gods and beasts still standing on both sides (the field's centre before it starts). */
  crowd(out = { x: 0, y: 0, n: 0 }) {
    let x = 0;
    let y = 0;
    let n = 0;
    for (const u of this.world.unitList) {
      if (u.dead || u.def.class === 'worker') continue;
      const wgt = u.def.class === 'god' || u.def.class === 'titan' ? 3 : 1;
      x += u.x * wgt;
      y += u.y * wgt;
      n += wgt;
    }
    if (!n) {
      out.x = this.anchors.field.x;
      out.y = this.anchors.field.y;
    } else {
      out.x = x / n;
      out.y = y / n;
    }
    out.n = n;
    return out;
  }

  // ------------------------------------------------------------------ building the set

  build() {
    const w = this.world;
    const tc = w.buildingsOf(greek).find((b) => b.type === 'town_center');
    // the Greek village is a city: the town centre at its grandest, so the temple, the Titan Gate and the whole roster are open
    tc.tier = 3;
    w.players[greek].tier = 3;
    w.players[norse].tier = 3;
    const mine = w.mineList[greek];
    const C = { x: tc.x, y: tc.y };
    this.anchors.village = C;
    this.anchors.mine = { x: mine.x, y: mine.y };

    const placed = {};
    const put = (type, dx, dy, progress = 1) => {
      const spot = w.findPlacement(greek, type, C.x + dx, C.y + dy, 8);
      if (!spot) return null;
      const b = w.createBuilding(greek, type, spot.tx, spot.ty, progress >= 1, true);
      if (progress < 1) {
        b.buildProgress = progress;
        b.hp = b.maxHp * (0.1 + 0.9 * progress);
      }
      (placed[type] = placed[type] || []).push(b);
      return b;
    };
    put('storehouse', -5, -4.5);
    put('house', 6, -4);
    put('house', 6, -0.5);
    put('house', 9.5, -2.5);
    const site = put('house', 6, 3, 0.35);
    const site2 = put('house', 9.5, 1, 0.12);
    put('barracks', 10, 6);
    put('shrine', -3, 7);
    const temple = put('temple', 3.5, 8.5);
    put('tower', 13, -6);
    put('tower', 14, 11);
    const gate = put('titan_gate', 9, 13);
    this.anchors.temple = temple ? { x: temple.x, y: temple.y } : { x: C.x + 3.5, y: C.y + 8.5 };
    this.anchors.gate = gate ? { x: gate.x, y: gate.y, tx: gate.tx, ty: gate.ty } : { x: C.x + 9, y: C.y + 13, tx: C.x + 8, ty: C.y + 12 };
    this.anchors.barracks = placed.barracks && placed.barracks[0] ? { x: placed.barracks[0].x, y: placed.barracks[0].y } : { x: C.x + 10, y: C.y + 6 };
    this.anchors.field = { x: C.x + 21, y: C.y + 9 };
    this.anchors.lineup = { x: this.anchors.field.x + 16, y: this.anchors.field.y - 12 };

    this.populateVillage(tc, mine, placed, [site, site2].filter(Boolean));
    this.populateArmies();
    this.scheduleCues();
  }

  populateVillage(tc, mine, placed, sites) {
    const w = this.world;
    const d = this.density;
    const cmd = (c) => w.issueCommand(greek, c);
    const spawn = (type, x, y, opts) => w.spawnUnit(greek, type, x, y, { silent: true, ...opts });
    const crew = w.unitsOf(greek).filter((u) => u.def.class === 'worker');
    const extra = Math.round(9 * d);
    for (let i = 0; i < extra; i++) {
      const a = (i / Math.max(1, extra)) * Math.PI * 2;
      const u = spawn('worshipper', tc.x + Math.cos(a) * 3.4, tc.y + Math.sin(a) * 3.4);
      if (u) crew.push(u);
    }
    // the work: miners on the gold, woodcutters at the forest's edge, builders on the half-raised houses, the faithful at the shrine
    const ids = (list) => list.map((u) => u.id);
    const miners = crew.splice(0, Math.ceil(crew.length * 0.34));
    cmd({ type: 'gather', units: ids(miners), target: mine.id });
    const tree = w.map.nearestForest(tc.x - 4, tc.y + 2, 24, true);
    const cutters = crew.splice(0, Math.ceil(crew.length * 0.3));
    if (tree) cmd({ type: 'gather', units: ids(cutters), tx: tree.tx, ty: tree.ty });
    sites.forEach((b, i) => {
      const crewSize = Math.max(1, Math.round((i === 0 ? 3 : 2) * d));
      const builders = crew.splice(0, crewSize);
      if (builders.length) cmd({ type: 'repair', units: ids(builders), target: b.id });
    });
    const shrine = placed.shrine && placed.shrine[0];
    if (shrine && crew.length) cmd({ type: 'pray', units: ids(crew.splice(0, 4)), target: shrine.id });
    const rest = crew.splice(0);
    if (rest.length) cmd({ type: 'gather', units: ids(rest), target: mine.id });
  }

  populateArmies() {
    const w = this.world;
    const d = this.density;
    const n = (k) => Math.max(1, Math.round(k * d));
    const rows = (owner, list, x0, y0, facing, gap = 1.25, cols = 6) => {
      const out = [];
      list.forEach((type, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const u = w.spawnUnit(owner, type, x0 + (facing > 0 ? -row : row) * gap * 1.1, y0 + (col - cols / 2) * gap, { silent: true, facing: facing > 0 ? 0 : Math.PI, level: GOD_LEVEL });
        if (!u) return;
        if (u.def.class !== 'god') {
          u.maxHp = Math.round(u.maxHp * SOLDIER_HP[owner]);
          u.hp = u.maxHp;
        }
        out.push(u);
      });
      return out;
    };
    const times = (type, k) => Array.from({ length: n(k) }, () => type);
    const field = this.anchors.field;

    // the Greeks hold the meadow in front of the barracks
    const gp = PANTHEONS.greek;
    const defenders = rows(greek, [
      ...times('warrior', 10), ...times('archer', 6), 'priest',
      gp.creatures[0].id, gp.creatures[0].id, gp.creatures[2].id, gp.creatures[1].id, gp.creatures[1].id,
      gp.gods[1].id,
    ], field.x - 3, field.y - 1, 1, 1.3, 6);
    this.defenders = defenders.map((u) => u.id);
    w.issueCommand(greek, { type: 'hold', units: this.defenders });

    // the Norse host waits across the field
    const np = PANTHEONS.norse;
    const invaders = rows(norse, [
      ...times('warrior', 10), ...times('archer', 6),
      np.creatures[0].id, np.creatures[0].id, np.creatures[0].id, np.creatures[2].id, np.creatures[1].id, np.creatures[1].id,
      np.gods[1].id, np.gods[0].id,
    ], field.x + 7, field.y - 1, -1, 1.3, 6);
    this.invaders = invaders.map((u) => u.id);
    w.issueCommand(norse, { type: 'hold', units: this.invaders });
    this.actors.set('thor', this.invaders[this.invaders.length - 2]);
  }

  scheduleCues() {
    const w = this.world;
    const T = CUE_TIMES;
    const gp = PANTHEONS.greek;
    const np = PANTHEONS.norse;
    const cue = (at, run) => this.cues.push({ at, run });

    // a god answers the worshippers' prayers at the temple
    cue(T.summon, (s) => {
      const t = s.anchors.temple;
      const zeus = w.spawnUnit(greek, gp.gods[0].id, t.x - 1.2, t.y + 3.4, { level: GOD_LEVEL, facing: Math.PI / 2 });
      if (zeus) s.actors.set('zeus', zeus.id);
    });
    // the garrison and the god march out to meet the host
    cue(T.war - 1.5, (s) => {
      const field = s.anchors.field;
      const zeus = s.actor('zeus');
      const ids = [...s.defenders.filter((id) => s.world.getEntity(id) && !s.world.getEntity(id).dead), ...(zeus ? [zeus.id] : [])];
      w.issueCommand(greek, { type: 'attackMove', units: ids, x: field.x + 4, y: field.y });
    });
    // the host comes in
    cue(T.war, (s) => {
      const v = s.anchors.village;
      w.issueCommand(norse, { type: 'attackMove', units: s.invaders, x: v.x + 10, y: v.y + 9 });
    });
    // the titans
    cue(T.titans, (s) => {
      const g = s.anchors.gate;
      const kronos = w.spawnUnit(greek, gp.titan.id, g.x - 2.5, g.y + 3.2, { facing: 0 });
      if (kronos) {
        s.actors.set('kronos', kronos.id);
        w.issueCommand(greek, { type: 'attackMove', units: [kronos.id], x: s.anchors.field.x + 6, y: s.anchors.field.y });
      }
      const surtr = w.spawnUnit(norse, np.titan.id, s.anchors.field.x + 14, s.anchors.field.y + 3, { facing: Math.PI });
      if (surtr) {
        s.actors.set('surtr', surtr.id);
        w.issueCommand(norse, { type: 'attackMove', units: [surtr.id], x: s.anchors.field.x - 4, y: s.anchors.field.y });
      }
    });
    // the finale: a god of each of the ten mythologies, summoned in a ripple along a line of open ground, two ranks deep
    const L = this.anchors.lineup;
    PANTHEON_LIST.forEach((p, i) => {
      const col = Math.floor(i / 2) - 2; // five columns, a god of two pantheons in each
      const front = i % 2 === 0;
      const x = L.x + (col + (front ? 0 : 0.5)) * LINEUP_GAP;
      const y = L.y + (front ? 1.4 : -1.4);
      cue(T.lineup + i * LINEUP_RIPPLE, (s) => {
        // the war is over by the time the gods stand in line: nobody is left to draw them into it
        if (i === 0) for (const u of w.unitList) if (!u.dead && u.owner === norse) w.killEntity(u, null, true);
        const god = w.spawnUnit(greek, p.gods[0].id, x, y, { level: GOD_LEVEL, facing: Math.PI / 2 });
        if (god) {
          w.issueCommand(greek, { type: 'hold', units: [god.id] });
          s.finale.add(god.id);
          s.actors.set(`lineup${i}`, god.id);
        }
      });
    });
  }

  // ------------------------------------------------------------------ the gods' spells

  /** Once a second every god and titan lets fly a ready ability at the nearest enemy in reach (the film has no player to cast them). */
  castSpells() {
    const w = this.world;
    if (w.tickCount % 20 !== 3) return;
    for (const g of w.unitList) {
      if (g.dead || this.finale.has(g.id) || (g.def.class !== 'god' && g.def.class !== 'titan')) continue;
      const enemies = w.queryRadius(g.x, g.y, 9, (e) => e.kind === 'unit' && !e.dead && w.areEnemies(g.owner, e.owner));
      if (!enemies.length) continue;
      let t = enemies[0];
      let best = Infinity;
      for (const e of enemies) {
        const dd = (e.x - g.x) ** 2 + (e.y - g.y) ** 2;
        if (dd < best) {
          best = dd;
          t = e;
        }
      }
      const ready = g.def.abilities.filter((a) => !g.cooldowns[a.id] && g.level >= (a.unlockLevel || 1) && !a.autocast && (a.cooldown < ULT_COOLDOWN || w.time >= this.ultAt));
      if (!ready.length) continue;
      const ab = ready[Math.floor(w.tickCount / 20 + g.id) % ready.length];
      const c = { type: 'cast', unit: g.id, ability: ab.id };
      if (ab.target === 'point') {
        c.x = t.x;
        c.y = t.y;
      } else if (ab.target === 'enemy' || ab.target === 'unit') c.target = t.id;
      else if (ab.target === 'ally') c.target = g.id;
      w.issueCommand(g.owner, c);
    }
  }
}
