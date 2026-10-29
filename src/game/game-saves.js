// Saving and resuming a single-player match (DESIGN 9.4), the game controller's side: the F10
// menu's Save Game and Save & Quit, the autosave every few minutes of game time, and putting a
// loaded match back on screen (the fog you had explored, the enemy buildings you last saw, the
// camera, control groups, the chronicle's timeline and the career's tally). The sim state itself
// is packed by save-game.js, loaded on first use (it brings the AI's classes with it).
//
//   const saver = new MatchSaver(game);
//   saver.canSave()            // a solo match against the computer, still being played
//   await saver.save('1')      // or AUTO_SLOT
//   saver.tick()               // every frame: autosaves when it is due
import { PANTHEONS } from '../data/index.js';
import { packGraph, unpackGraph } from '../sim/save-graph.js';
import { isTutorial } from '../sim/tutorial.js';
import { AUTO_SLOT, writeSave, saveInfo, deleteSave } from './save-store.js';

/** Game seconds between two autosaves. */
export const AUTOSAVE_EVERY = 180;

let saveGameModule = null;
/** save-game.js, loaded once. */
export function loadSaveGame() {
  if (!saveGameModule) {
    saveGameModule = import('./save-game.js').catch((err) => {
      saveGameModule = null;
      throw err;
    });
  }
  return saveGameModule;
}

function pantheonName(id) {
  return (PANTHEONS[id] && PANTHEONS[id].name) || 'Random';
}

/** "Greek vs Norse (Hard) · small map" for the slot list. */
export function matchLabel(world, myIndex) {
  const players = world.players || [];
  const me = players[myIndex];
  if (!me) return 'Saved game';
  const foes = players.filter((p) => p.team !== me.team);
  const allies = players.filter((p) => p !== me && p.team === me.team);
  const ai = (p) => (p.kind === 'ai' && p.difficulty ? ` (${p.difficulty[0].toUpperCase()}${p.difficulty.slice(1)})` : '');
  const mine = [me, ...allies].map((p) => pantheonName(p.pantheon)).join(' & ');
  const map = world.setup && world.setup.mapSize ? ` · ${world.setup.mapSize} map` : '';
  if (world.survival) return `${mine} · Trial of the Titans${map}`;
  return `${mine} vs ${foes.map((p) => `${pantheonName(p.pantheon)}${ai(p)}`).join(' & ') || 'nobody'}${map}`;
}

// Matches already counted in the career (a quit counts as a loss): a save of one carried on later
// counts nothing again. Newest last, a few dozen kept, on this device only.
const SETTLED_KEY = 'mythicwar-settled';
const SETTLED_MAX = 40;

function settledList() {
  try {
    const raw = typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem(SETTLED_KEY) || '[]') : [];
    return Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Was this match counted already (it ended, or the player quit it)? */
export function isSettled(matchId) {
  return !!matchId && settledList().includes(matchId);
}

/** This match has been counted: a save of it carried on later must not count it again. */
export function settleMatch(matchId) {
  if (!matchId) return;
  const list = settledList().filter((id) => id !== matchId);
  list.push(matchId);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SETTLED_KEY, JSON.stringify(list.slice(-SETTLED_MAX)));
  } catch {
    // storage full or blocked: at worst the match counts twice
  }
}

function newMatchId() {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export class MatchSaver {
  /**
   * @param {object} game the Game controller
   * @param {object} [o]
   * @param {object} [o.resume] the loaded save's extra (a resumed match keeps its id and its next autosave)
   * @param {object} [o.store] { writeSave, saveInfo, deleteSave } (tests)
   */
  constructor(game, { resume = null, store = null } = {}) {
    this.game = game;
    this.store = store || { writeSave, saveInfo, deleteSave };
    this.matchId = (resume && resume.matchId) || newMatchId();
    this.nextAuto = resume && Number.isFinite(resume.nextAuto) ? resume.nextAuto : AUTOSAVE_EVERY;
    this.busy = null; // the save in progress
    this.lastError = null;
  }

  get world() {
    const s = this.game.session;
    return s && s.isHost ? s.world : null;
  }

  /** May this match be saved now? Solo against the computer, not the guided match, not over, not beaten. */
  canSave() {
    const g = this.game;
    const s = g.session;
    const vs = g.viewState;
    if (!s || !s.isHost || !this.world || s.stopped || (s.clients && s.clients.size) || g.disposed) return false;
    if (isTutorial(s.setup) || !vs || vs.gameOver || (vs.me && vs.me.defeated)) return false;
    return s.setup.players.every((p) => p.index === s.myIndex || p.kind === 'ai');
  }

  /** What rides along with the sim state: the view's memory, camera, groups, chronicle and career. */
  extras() {
    const g = this.game;
    const vs = g.viewState;
    const cam = g.renderer && g.renderer.camera;
    const sel = g.selection;
    const career = g.career;
    return {
      matchId: this.matchId,
      myIndex: g.myIndex,
      nextAuto: this.nextAuto,
      view: packGraph({ explored: vs.explored, lastSeen: vs.lastSeen, mineMemory: vs.mineMemory }),
      camera: cam && cam.target ? { x: cam.target.x, y: cam.target.y, d: cam.distance } : null,
      groups: sel && sel.groups ? [...sel.groups].map(([k, ids]) => [k, [...ids]]) : [],
      chronicle: g.chronicle ? { samples: g.chronicle.samples, peakArmy: g.chronicle.peakArmy, next: g.chronicle.next } : null,
      career: career ? { m: career.m, unlockedHere: career.unlockedHere } : null,
    };
  }

  /**
   * Save the match to a slot. Resolves with the slot's info; rejects with a message to show.
   * Packing happens at once (between two ticks), writing after.
   */
  save(slot) {
    const prev = this.busy;
    const job = (async () => {
      if (prev) await prev.catch(() => {});
      if (!this.canSave()) throw new Error('This game cannot be saved now.');
      const { packMatch } = await loadSaveGame();
      const world = this.world;
      if (!world || !this.canSave()) throw new Error('This game cannot be saved now.');
      const g = this.game;
      const save = packMatch(world, g.session.ais, this.extras());
      const info = {
        label: matchLabel(world, g.myIndex),
        time: world.time,
        matchId: this.matchId,
        pantheon: world.players[g.myIndex] ? world.players[g.myIndex].pantheon : null,
        skirmish: (g.launch && (g.launch.skirmish || (g.launch.lobby && g.launch.lobby.state))) || null, // for Play Again after a load
        version: save.version,
        daily: (g.launch && g.launch.daily) || null, // a daily challenge (DESIGN 9.3) still counts once carried on
      };
      return this.store.writeSave(slot, save, info);
    })();
    this.busy = job;
    job.then(() => {}, (err) => (this.lastError = err)).finally(() => {
      if (this.busy === job) this.busy = null;
    });
    return job;
  }

  /** Every frame: autosave once the game clock passes the next mark (never while paused or saving). */
  tick() {
    const vs = this.game.viewState;
    if (this.busy || this.game.paused || !vs || !(vs.time >= this.nextAuto)) return;
    this.nextAuto = (Math.floor(vs.time / AUTOSAVE_EVERY) + 1) * AUTOSAVE_EVERY;
    if (!this.canSave()) return;
    this.save(AUTO_SLOT).then(() => {
      if (this.game.hud && !this.game.disposed) this.game.hud.message('Game autosaved.', 'system', { icon: '💾' });
    }, (err) => console.warn('[save] autosave failed', err && err.message ? err.message : err));
  }

  /** The match is over (or the player quit it, a loss): its autosave would only bring it back to count again, so Continue forgets it. */
  onGameOver() {
    settleMatch(this.matchId);
    try {
      const auto = this.store.saveInfo(AUTO_SLOT);
      if (auto && auto.matchId === this.matchId) this.store.deleteSave(AUTO_SLOT).catch(() => {});
    } catch {
      // nothing to forget
    }
  }

  /** A loaded match: put back what the player had (call after the HUD and trackers exist, before the session starts). */
  restore(extra) {
    if (!extra) return;
    const g = this.game;
    const vs = g.viewState;
    try {
      if (extra.view) {
        const view = unpackGraph(extra.view);
        if (view.explored && view.explored.length === vs.explored.length) {
          for (let i = 0; i < view.explored.length; i++) if (view.explored[i]) vs.explored[i] = 1;
        }
        for (const [id, v] of view.lastSeen || []) if (!vs.lastSeen.has(id)) vs.lastSeen.set(id, v);
        for (const [id, v] of view.mineMemory || []) if (!vs.mineMemory.has(id)) vs.mineMemory.set(id, v);
      }
    } catch (err) {
      console.warn('[save] the fog of war could not be restored', err);
    }
    if (g.selection && Array.isArray(extra.groups)) {
      for (const [k, ids] of extra.groups) if (Array.isArray(ids)) g.selection.groups.set(k, ids.filter((id) => vs.entities.has(id)));
    }
    const ch = extra.chronicle;
    if (g.chronicle && ch && Array.isArray(ch.samples)) {
      g.chronicle.samples = ch.samples;
      g.chronicle.peakArmy = Array.isArray(ch.peakArmy) ? ch.peakArmy : [];
      g.chronicle.next = Number.isFinite(ch.next) ? ch.next : 0;
    }
    const ca = extra.career;
    if (g.career && ca && ca.m && typeof ca.m === 'object') {
      Object.assign(g.career.m, ca.m);
      if (Array.isArray(ca.unlockedHere)) g.career.unlockedHere = ca.unlockedHere;
    }
    this.camera = extra.camera || null;
  }

  /** Once the renderer is up: the camera where the player left it. Returns false when there is nothing to restore. */
  restoreCamera() {
    const c = this.camera;
    this.camera = null;
    const cam = this.game.renderer && this.game.renderer.camera;
    if (!c || !cam || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return false;
    cam.centerOn(c.x, c.y);
    if (Number.isFinite(c.d) && typeof cam.setDistance === 'function') cam.setDistance(c.d, true);
    return true;
  }
}
