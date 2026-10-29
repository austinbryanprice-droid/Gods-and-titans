// The objectives of the guided first match (DESIGN 9.2): one step at a time, each ticked off by
// what the player actually does (read from the ViewState and the selection, so nothing goes over
// the wire), with a spot on the battlefield to point at and the command-card buttons to light up.
// The medal at the end goes by the game time of the victory.
//
//   TUTORIAL_STEPS                         the steps, in order (pure data + functions of a context)
//   tutorialContext(vs, selectedIds)       what the steps read
//   medalFor(seconds) / MEDALS             gold, silver or bronze (src/data/medals.js)
//   new TutorialDirector({ viewState, getSelection, onStep })   update() ~2 Hz; .index, .current, .target()
import { UNITS, BUILDINGS, PANTHEONS } from '../data/index.js';
import { canRank } from '../data/ranks.js';
import { TERRAIN } from '../config.js';
import { medalFor } from '../data/medals.js';

export { MEDALS, medalFor, medalByRank } from '../data/medals.js';

const key = (type) => (BUILDINGS[type] && BUILDINGS[type].hotkey) || '?';
const WOOD_SCAN = 2; // game seconds between looks for the forest edge nearest the Town Center

/**
 * The facts the steps read, gathered once per update.
 * @param {object} vs ViewState
 * @param {number[]} [selected] selected entity ids
 */
export function tutorialContext(vs, selected = []) {
  const me = vs.me || null;
  const my = vs.myIndex;
  const tasks = { gold: 0, wood: 0, pray: 0, build: 0 };
  const workers = [];
  const soldiers = [];
  const done = {}; // building type → completed count
  const sites = {}; // building type → under construction count
  const own = {}; // building type → first entity
  let enemyTown = null;
  for (const e of vs.entities.values()) {
    if (e.o === my) {
      if (e.k === 'u') {
        const d = UNITS[e.t];
        if (!d) continue;
        if (d.class === 'worker') {
          workers.push(e);
          if (Object.hasOwn(tasks, e.tk)) tasks[e.tk]++;
        } else if (canRank(d)) soldiers.push(e);
      } else if (e.k === 'b') {
        if (!own[e.t]) own[e.t] = e;
        if (e.bp >= 1) done[e.t] = (done[e.t] || 0) + 1;
        else sites[e.t] = (sites[e.t] || 0) + 1;
      }
    } else if (e.k === 'b' && e.t === 'town_center' && e.o >= 0 && vs.relation && vs.relation(e.o) === 'enemy') enemyTown = e;
  }
  const sel = (selected || []).map((id) => vs.entities.get(id)).filter((e) => e && e.o === my);
  const pantheon = (me && PANTHEONS[me.pantheon]) || null;
  const godIds = pantheon ? pantheon.gods.map((g) => g.id) : [];
  const gods = me && Array.isArray(me.gods) ? me.gods.length : 0;
  return {
    vs, me, tasks, workers, soldiers, done, sites, own, enemyTown, godIds, gods,
    selectedWorkers: sel.filter((e) => e.k === 'u' && UNITS[e.t] && UNITS[e.t].class === 'worker').length,
    godCost: pantheon && pantheon.gods[0] ? pantheon.gods[0].cost : { gold: 100, wood: 0, faith: 200 },
    won: !!(vs.gameOver && vs.gameOver.winningTeam === vs.myTeam && vs.myTeam !== null && vs.myTeam !== undefined),
  };
}

const centre = (e) => (e ? { x: e.x, y: e.y } : null);
const count = (have, need) => `${Math.min(have, need)}/${need}`;

/** A building step: done once one stands finished; the card's Build and building buttons light up. */
function buildStep(id, type, icon, title, why) {
  return {
    id, icon, title,
    text: () => `Select a Worshipper, press [[B]] to open the build list, then [[${key(type)}]] for a ${BUILDINGS[type].name}, and left-click a free spot near your Town Center. ${why}`,
    done: (c) => (c.done[type] || 0) > 0,
    progress: (c) => ((c.sites[type] || 0) > 0 ? 'Being built…' : ''),
    target: (c) => centre(c.own[type]),
    guide: () => ['build', `build:${type}`],
  };
}

export const TUTORIAL_STEPS = [
  {
    id: 'select', icon: '👆', title: 'Choose your Worshippers',
    text: () => 'These robed figures are your Worshippers: they gather, build and pray. Hold the left mouse button and drag a box around them to select them.',
    done: (c) => c.selectedWorkers > 0,
    target: (c) => {
      if (!c.workers.length) return null;
      let x = 0;
      let y = 0;
      for (const w of c.workers) {
        x += w.x;
        y += w.y;
      }
      return { x: x / c.workers.length, y: y / c.workers.length };
    },
  },
  {
    id: 'mine', icon: '⛏️', title: 'Mine gold',
    text: () => 'With your Worshippers selected, right-click the gold mine to send them all to work there. Gold pays for nearly everything: keep at least three on it.',
    done: (c) => c.tasks.gold >= 3,
    progress: (c) => count(c.tasks.gold, 3),
    target: (c) => c.mine,
  },
  {
    id: 'wood', icon: '🌲', title: 'Chop wood',
    text: () => 'Wood builds your city. Click one Worshipper (a miner will do), Shift+click a second, then right-click a tree at the forest edge. Get two of them chopping.',
    done: (c) => c.tasks.wood >= 2,
    progress: (c) => count(c.tasks.wood, 2),
    target: (c) => c.forest,
  },
  buildStep('house', 'house', '🏠', 'Build a House', 'Every House raises your population limit, so you can have more people.'),
  buildStep('shrine', 'shrine', BUILDINGS.shrine.icon || '🛕', 'Raise a Shrine', 'At a Shrine your Worshippers pray for Faith, the price of gods.'),
  {
    id: 'pray', icon: '🙏', title: 'Pray for Faith',
    text: () => 'Select two Worshippers and right-click the Shrine. They kneel, and Faith (top right) starts to rise.',
    done: (c) => c.tasks.pray >= 2,
    progress: (c) => count(c.tasks.pray, 2),
    target: (c) => centre(c.own.shrine),
  },
  buildStep('temple', 'temple', BUILDINGS.temple.icon || '🏛️', 'Build a Temple', 'Gods are summoned at a Temple.'),
  {
    id: 'god', icon: '⚡', title: 'Summon a god',
    text: (c) => `Click the Temple and choose one of the four gods. A god costs ${c.godCost.faith} Faith and ${c.godCost.gold} gold: keep praying until you have enough.`,
    done: (c) => c.gods > 0,
    progress: (c) => (c.me ? `Faith ${Math.floor(c.me.faith)}/${c.godCost.faith}` : ''),
    target: (c) => centre(c.own.temple),
    guide: (c) => c.godIds.map((id) => `train:${id}`),
  },
  buildStep('barracks', 'barracks', BUILDINGS.barracks.icon || '⚔️', 'Build a Barracks', 'Mortal soldiers train there.'),
  {
    id: 'army', icon: '🛡️', title: 'Train four soldiers',
    text: () => 'Click the Barracks and train four soldiers: Warriors fight up close, Archers shoot from behind them.',
    done: (c) => c.soldiers.length >= 4,
    progress: (c) => count(c.soldiers.length, 4),
    target: (c) => centre(c.own.barracks),
    guide: () => ['train:warrior', 'train:archer'],
  },
  {
    id: 'attack', icon: '🔥', title: 'Destroy the raiders',
    text: () => 'Drag a box around your soldiers, Shift+click your god to add it (or click its portrait, top left), then right-click the raiders\' Town Center where the arrow points. Destroy every building they have to win.',
    done: (c) => c.won,
    progress: (c) => (c.enemyTown && c.enemyTown.mhp ? `Their Town Center: ${Math.max(0, Math.ceil((100 * c.enemyTown.hp) / c.enemyTown.mhp))}%` : ''),
    target: (c) => c.enemyCamp,
    guide: () => ['attack'],
  },
];

/** The forest tile (as I have seen the map) nearest a point, as a spot to point at. */
function nearestForest(vs, x, y) {
  const terrain = vs.seenTerrain || (vs.map && vs.map.terrain);
  const w = vs.width;
  if (!terrain || !w) return null;
  let best = null;
  let bd = Infinity;
  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i] !== TERRAIN.FOREST) continue;
    const tx = i % w;
    const ty = (i / w) | 0;
    const d = (tx + 0.5 - x) ** 2 + (ty + 0.5 - y) ** 2;
    if (d < bd) {
      bd = d;
      best = { x: tx + 0.5, y: ty + 0.5 };
    }
  }
  return best;
}

export class TutorialDirector {
  /**
   * @param {object} o
   * @param {object} o.viewState
   * @param {() => number[]} [o.getSelection] the selected entity ids
   * @param {(step: object|null, index: number, prev: object|null) => void} [o.onStep] a step was finished (step is the next one, null at the end)
   */
  constructor({ viewState, getSelection = () => [], onStep = null }) {
    this.vs = viewState;
    this.getSelection = getSelection;
    this.onStep = onStep;
    this.index = 0;
    this.ctx = null;
    this.forestAt = -Infinity;
    this.forest = null;
    this.finishedAt = null; // game seconds of the victory
  }

  get current() {
    return TUTORIAL_STEPS[this.index] || null;
  }

  get finished() {
    return this.index >= TUTORIAL_STEPS.length;
  }

  /** The medal of a finished lesson (null until then). */
  get medal() {
    return this.finished ? medalFor(this.finishedAt) : null;
  }

  /** Fixed spots: my start mine, the raiders' camp, and the forest edge nearest home (looked for again now and then, trees fall). */
  places(c) {
    const vs = this.vs;
    const map = vs.map || {};
    const my = vs.myIndex;
    const m = map.mines && map.mines[my];
    c.mine = m ? { x: m.tx + 1.5, y: m.ty + 1.5 } : null;
    const tc = BUILDINGS.town_center.size / 2;
    const starts = map.starts || [];
    const home = starts[my] ? { x: starts[my].x + tc, y: starts[my].y + tc } : null;
    const players = (vs.setup && vs.setup.players) || [];
    const enemy = players.findIndex((p, i) => i !== my && p && p.team !== vs.myTeam);
    c.enemyCamp = c.enemyTown ? centre(c.enemyTown) : enemy >= 0 && starts[enemy] ? { x: starts[enemy].x + tc, y: starts[enemy].y + tc } : null;
    const t = vs.time || 0;
    if (home && t - this.forestAt >= WOOD_SCAN) {
      this.forestAt = t;
      this.forest = nearestForest(vs, home.x, home.y);
    }
    c.forest = this.forest;
  }

  /** Look at the match and move on past every finished step (several at once when the player ran ahead). */
  update() {
    if (this.finished || !this.vs.me) return;
    const c = tutorialContext(this.vs, this.getSelection());
    this.places(c);
    this.ctx = c;
    while (!this.finished) {
      const step = this.current;
      let ok = false;
      try {
        ok = !!step.done(c);
      } catch {
        ok = false;
      }
      if (!ok) break;
      this.index++;
      if (this.finished) this.finishedAt = this.vs.time || 0;
      if (this.onStep) this.onStep(this.current, this.index, step);
    }
  }

  /** What the panel shows for the current step: { step, text, progress, guide } (null when finished or before the first look). */
  view() {
    const step = this.current;
    const c = this.ctx;
    if (!step || !c) return null;
    const safe = (fn, fallback) => {
      try {
        return fn ? fn(c) : fallback;
      } catch {
        return fallback;
      }
    };
    return { step, text: safe(step.text, ''), progress: safe(step.progress, ''), guide: safe(step.guide, []) || [] };
  }

  /** The spot the arrow points at for the current step, or null. */
  target() {
    const step = this.current;
    if (!step || !step.target || !this.ctx) return null;
    try {
      return step.target(this.ctx) || null;
    } catch {
      return null;
    }
  }
}
