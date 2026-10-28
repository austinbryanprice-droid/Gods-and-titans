// The match's chronicle (DESIGN 9, "After-game chronicle"): every SAMPLE_EVERY seconds of game
// time it writes down each player's score, army, resources and kills from the snapshot, so the
// game-over screen can draw them as lines over time, and it hands out the awards. Client-side
// only: the numbers already ride in each snapshot's player records (stats, tier, up), so nothing
// new is sent over the wire and a client charts the same match the host does.
//
//   const chronicle = new Chronicle({ viewState }).attach();
//   chronicle.samples          // [{ t, p: [{ score, army, res, kills }, …] }, …]
//   chronicle.peakArmy[i]      // the largest army player i fielded
//   awardsFor(players, chronicle.peakArmy)
//   chronicle.dispose();
import { scoreOf } from '../data/score.js';

/** Seconds of game time between two samples. */
export const SAMPLE_EVERY = 30;

/** The lines the timeline can draw: key, label, and how to read it from a player record. */
export const METRICS = [
  { key: 'score', label: 'Score', read: (p) => scoreOf(p).total },
  { key: 'army', label: 'Army', read: (p) => (p.stats && p.stats.army) || 0 },
  { key: 'res', label: 'Resources', read: (p) => { const st = p.stats || {}; return (st.gathered || 0) + (st.faith || 0); } },
  { key: 'kills', label: 'Kills', read: (p) => (p.stats && p.stats.kills) || 0 },
];

export class Chronicle {
  constructor({ viewState } = {}) {
    this.viewState = viewState || null;
    this.off = null;
    this.reset();
  }

  attach() {
    if (this.viewState && !this.off) this.off = this.viewState.on('snapshot', () => this.observe(this.viewState));
    return this;
  }

  dispose() {
    if (this.off) this.off();
    this.off = null;
  }

  reset() {
    this.samples = [];
    this.peakArmy = [];
    this.next = 0; // game time of the next sample
    this.closed = false; // the game is over and its last sample is written
  }

  /** Read one view (ViewState or anything with time, players and gameOver). */
  observe(vs) {
    const players = (vs && vs.players) || [];
    if (!players.length || this.closed) return;
    const t = Number.isFinite(vs.time) ? vs.time : 0;
    players.forEach((p, i) => {
      const army = (p && p.stats && p.stats.army) || 0;
      if (!(this.peakArmy[i] >= army)) this.peakArmy[i] = army;
    });
    const over = !!vs.gameOver;
    if (t >= this.next || over) {
      const last = this.samples[this.samples.length - 1];
      const sample = { t, p: players.map((p) => Object.fromEntries(METRICS.map((m) => [m.key, m.read(p || {})]))) };
      if (last && last.t === t) this.samples[this.samples.length - 1] = sample;
      else this.samples.push(sample);
      this.next = (Math.floor(t / SAMPLE_EVERY) + 1) * SAMPLE_EVERY;
    }
    if (over) this.closed = true;
  }

  /** One player's line for a metric: [[t, value], …]. */
  series(metric, index) {
    return this.samples.map((s) => [s.t, (s.p[index] && s.p[index][metric]) || 0]);
  }
}

/**
 * The awards, Age of Empires style: each goes to the player (or the players, on a tie) with the
 * most of something, and only when there is something to show for it.
 */
export const AWARDS = [
  { id: 'warlord', icon: '⚔️', title: 'Warlord', what: 'most enemies slain', read: (p) => (p.stats && p.stats.kills) || 0 },
  { id: 'conqueror', icon: '🔥', title: 'Conqueror', what: 'most enemy buildings razed', read: (p) => (p.stats && p.stats.razed) || 0 },
  { id: 'tactician', icon: '🎯', title: 'Tactician', what: 'best trade: worth destroyed less worth lost', read: (p) => { const st = p.stats || {}; return (st.killValue || 0) - (st.lostValue || 0); } },
  { id: 'marshal', icon: '🛡️', title: 'Marshal', what: 'largest army fielded', read: (p, peak) => peak || 0 },
  { id: 'treasurer', icon: '💰', title: 'Treasurer', what: 'most gold and wood gathered', read: (p) => (p.stats && p.stats.gathered) || 0 },
  { id: 'prophet', icon: '🙏', title: 'Prophet', what: 'most faith earned', read: (p) => (p.stats && p.stats.faith) || 0 },
  { id: 'architect', icon: '🏛️', title: 'Architect', what: 'most buildings raised', read: (p) => (p.stats && p.stats.buildings) || 0 },
];

/** [{ id, icon, title, what, value, winners: [player index…] }] for the awards someone earned. */
export function awardsFor(players, peakArmy = []) {
  const list = (players || []).map((p, i) => ({ p: p || {}, i: Number.isInteger(p && p.i) ? p.i : i }));
  if (list.length < 2) return [];
  const out = [];
  for (const a of AWARDS) {
    let best = 0;
    let winners = [];
    for (const { p, i } of list) {
      const v = a.read(p, peakArmy[i]);
      if (v > best) {
        best = v;
        winners = [i];
      } else if (v === best && v > 0) winners.push(i);
    }
    if (best > 0 && winners.length < list.length) out.push({ id: a.id, icon: a.icon, title: a.title, what: a.what, value: best, winners });
  }
  return out;
}
