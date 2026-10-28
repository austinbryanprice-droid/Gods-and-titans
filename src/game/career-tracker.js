// Watches one match from the local player's seat and collects the facts the career and the
// achievements need (DESIGN 9.1): what was summoned, the best rank and god level, buildings
// lost, the city's tier, kills and resources from the snapshot's player record. Reads the
// ViewState only (events and snapshots), so it works the same on the host and on a client.
// `onUnlock(list)` hears achievements unlocked while the match runs; finish() counts the match.
import { UNITS, BUILDINGS } from '../data/index.js';
import { checkLive, recordMatch } from './career.js';

const SCAN_SECONDS = 1; // own entities are scanned (ranks, god levels, a Manor) at most once a game second

export class CareerTracker {
  /**
   * @param {object} o
   * @param {object} o.viewState
   * @param {object} [o.setup] the game setup (players with kind / difficulty / team, peaceMinutes)
   * @param {(list: object[]) => void} [o.onUnlock]
   * @param {object} [o.career] { checkLive, recordMatch } (tests)
   */
  constructor({ viewState, setup = null, onUnlock = null, career = null }) {
    this.vs = viewState;
    this.setup = setup;
    this.onUnlock = onUnlock;
    this.career = career || { checkLive, recordMatch };
    this.offs = [];
    this.recorded = false;
    this.lastScan = -Infinity;
    this.dirty = false;
    this.unlockedHere = []; // achievements unlocked during this match, for the game-over screen
    this.m = {
      result: null, pantheon: null, time: 0,
      godsSummoned: 0, maxGodsAtOnce: 0, maxGodLevel: 0, titanSummoned: false, enemyTitansFallen: 0,
      maxRank: 0, kills: 0, losses: 0, gathered: 0, buildingsLost: 0, maxTier: 1,
      manor: false, stoneWall: false,
      enemies: [], teamSize: 1, peace: !!(setup && setup.peaceMinutes > 0),
    };
  }

  /** The local player's index, or -1 for a spectator (who has no career to count). */
  get me() {
    return this.vs.myIndex ?? -1;
  }

  attach() {
    if (typeof this.vs.on !== 'function') return this;
    this.offs.push(this.vs.on('*', (ev) => this.onEvent(ev)));
    this.offs.push(this.vs.on('snapshot', () => this.observe()));
    return this;
  }

  dispose() {
    for (const off of this.offs) if (typeof off === 'function') off();
    this.offs = [];
  }

  /** Who is on which side, from the setup (or the snapshot's players while the setup is unknown). */
  readSides() {
    const me = this.me;
    const players = (this.setup && this.setup.players) || this.vs.players || [];
    const mine = players.find((p, i) => (p.index ?? p.i ?? i) === me);
    if (!mine) return;
    this.m.pantheon = mine.pantheon || this.m.pantheon;
    const others = players.filter((p, i) => (p.index ?? p.i ?? i) !== me);
    this.m.teamSize = 1 + others.filter((p) => p.team === mine.team).length;
    this.m.enemies = others.filter((p) => p.team !== mine.team).map((p) => ({ kind: p.kind === 'ai' ? 'ai' : 'human', difficulty: p.difficulty || null }));
  }

  onEvent(ev) {
    const me = this.me;
    if (me < 0 || this.recorded || !ev) return;
    const m = this.m;
    switch (ev.type) {
      case 'spawn': {
        if (ev.o !== me) break;
        const t = UNITS[ev.t];
        if (t && t.class === 'god') m.godsSummoned++;
        else if (t && t.class === 'titan') m.titanSummoned = true;
        else break;
        this.dirty = true;
        break;
      }
      case 'death': {
        if (ev.k === 'u') {
          const t = UNITS[ev.t];
          if (t && t.class === 'titan' && ev.o >= 0 && ev.o !== me && !this.isAlly(ev.o)) {
            m.enemyTitansFallen++;
            this.dirty = true;
          }
        } else if (ev.k === 'b' && ev.o === me && !(this.vs.me && this.vs.me.defeated)) {
          const b = BUILDINGS[ev.t];
          if (!b || !b.wall) m.buildingsLost++;
        }
        break;
      }
      case 'tierUp':
        if (ev.player === me && ev.tier > m.maxTier) {
          m.maxTier = ev.tier;
          this.dirty = true;
        }
        break;
      case 'levelUp':
      case 'rankUp': {
        const e = this.vs.entities && this.vs.entities.get(ev.id);
        if (!e || e.o !== me) break;
        if (ev.type === 'levelUp') m.maxGodLevel = Math.max(m.maxGodLevel, ev.level | 0);
        else m.maxRank = Math.max(m.maxRank, ev.rank | 0);
        this.dirty = true;
        break;
      }
      default:
        break;
    }
  }

  isAlly(owner) {
    return typeof this.vs.isAlly === 'function' ? this.vs.isAlly(owner) : false;
  }

  /** After each snapshot: the player record every time, own entities once a game second. */
  observe() {
    const vs = this.vs;
    const me = vs.me;
    if (this.me < 0 || this.recorded || !me) return;
    const m = this.m;
    if (!m.pantheon) this.readSides();
    m.time = Math.max(m.time, vs.time || 0);
    const st = me.stats || {};
    m.kills = st.kills | 0;
    m.losses = st.losses | 0;
    m.gathered = st.gathered | 0;
    if ((me.tier | 0) > m.maxTier) m.maxTier = me.tier | 0;
    const gods = Array.isArray(me.gods) ? me.gods.length : 0;
    if (gods > m.maxGodsAtOnce) m.maxGodsAtOnce = gods;
    if (me.titan) m.titanSummoned = true;
    if (m.time - this.lastScan >= SCAN_SECONDS && vs.entities) {
      this.lastScan = m.time;
      for (const e of vs.entities.values()) {
        if (e.o !== this.me) continue;
        if (e.k === 'u') {
          if (e.lv > m.maxGodLevel) m.maxGodLevel = e.lv;
          if (e.rk > m.maxRank) m.maxRank = e.rk;
        } else if (e.k === 'b' && e.bp >= 1) {
          if (e.t === 'manor') m.manor = true;
          else if (e.t === 'stone_wall') m.stoneWall = true;
        }
      }
      this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = false;
      this.unlock(this.career.checkLive(m));
    }
  }

  unlock(list) {
    if (!list || !list.length) return;
    this.unlockedHere.push(...list);
    if (this.onUnlock) this.onUnlock(list);
  }

  /**
   * Count the match once, with its result. Returns everything unlocked in this match (during it
   * and by the result), or null for a spectator, a match already counted or an unknown result.
   */
  finish(result, extra = null) {
    if (this.recorded || this.me < 0) return null;
    this.observe();
    if (!this.m.pantheon) this.readSides();
    this.recorded = true;
    const got = this.career.recordMatch({ ...this.m, ...(extra || {}), result }) || []; // extra: { wave } for the Trial of the Titans
    this.unlockedHere.push(...got);
    return this.unlockedHere.slice();
  }
}
