// The in-match player list (DESIGN 9, "Player list"): a small panel under the top bar, beside the
// god portraits, with every player of the match by team: colour, name, pantheon, settlement tier,
// live score, and whether they are still in it (fallen, surrendered, or played by a stand-in AI
// while they are away). My team comes first and my own row is marked. The header folds the list
// away to one line; that choice is kept in the settings (rosterOpen). A match of one player (the
// Trial of the Titans alone) has nobody to list, so the panel stays hidden.
//
// Everything here is already in each snapshot's player records (name, team, pantheon, colour,
// tier, stats, up, defeated, sur, away), so nothing new rides over the wire, and the score is the
// game-over screen's own (data/score.js).
import { PANTHEONS } from '../data/index.js';
import { scoreOf } from '../data/score.js';
import { PANTHEON_EMBLEMS } from './menu-model.js';
import { tierName } from './hud-data.js';
import { el, setText, setStyle, setClass, setHidden, fmt, safeColor } from './hud-dom.js';
import { sanitizeName } from '../net/protocol.js';
import { displayColor } from '../team-colors.js';

/** Milliseconds between two looks at the players (the score moves slowly). */
export const ROSTER_REFRESH_MS = 500;

/** A player's standing in the match: 'in', 'fallen' or 'surrendered'. */
export function standingOf(p) {
  if (!p || !p.defeated) return 'in';
  return p.sur ? 'surrendered' : 'fallen';
}

/**
 * The list's rows, grouped by team: [{ team, label, mine, rows }] with my team first. A free-for-all
 * (every team of one player) is one group without a label. Each row is
 * { i, name, color, pantheon, emblem, pantheonName, tier, tierName, score, standing, away, me }.
 * @param {object} vs ViewState (players, setup, myIndex, myTeam)
 */
export function rosterGroups(vs) {
  const players = (vs && vs.players) || [];
  const setup = (vs && vs.setup && vs.setup.players) || [];
  const myIndex = vs && Number.isInteger(vs.myIndex) ? vs.myIndex : -1;
  const myTeam = vs ? vs.myTeam : null;
  const byTeam = new Map();
  players.forEach((p, i) => {
    if (!p) return;
    const sp = setup[i] || {};
    const team = Number.isInteger(p.team) ? p.team : Number.isInteger(sp.team) ? sp.team : i + 1;
    const pantheon = Object.hasOwn(PANTHEONS, p.pantheon) ? p.pantheon : null;
    const row = {
      i,
      name: sanitizeName(p.name || sp.name || '', `Player ${i + 1}`),
      color: safeColor(p.color || sp.color),
      pantheon,
      emblem: (pantheon && PANTHEON_EMBLEMS[pantheon]) || '✦',
      pantheonName: pantheon ? PANTHEONS[pantheon].name : '',
      tier: p.tier || 1,
      tierName: tierName(p.tier || 1),
      score: scoreOf(p).total,
      standing: standingOf(p),
      away: !!p.away && !p.defeated,
      ai: (p.kind || sp.kind) === 'ai',
      me: i === myIndex,
    };
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push(row);
  });
  const ffa = [...byTeam.values()].every((rows) => rows.length === 1);
  if (ffa) {
    const rows = [...byTeam.values()].flat().sort((a, b) => (b.me - a.me) || a.i - b.i);
    return rows.length ? [{ team: null, label: '', mine: false, rows }] : [];
  }
  return [...byTeam.entries()]
    .map(([team, rows]) => ({ team, label: team === myTeam ? 'Your team' : `Team ${team}`, mine: team === myTeam, rows }))
    .sort((a, b) => (b.mine - a.mine) || a.team - b.team);
}

/** The words after a row's name for a player who is out or away ('' while they play). */
export function standingText(row) {
  if (row.standing === 'surrendered') return 'Surrendered';
  if (row.standing === 'fallen') return 'Defeated';
  return row.away ? 'Away (AI plays)' : '';
}

/** The tooltip of one row. */
export function rowTitle(row) {
  const who = row.me ? `${row.name} (you)` : row.ai ? `${row.name} (computer)` : row.name;
  const lines = [who];
  if (row.pantheonName) lines.push(`${row.emblem} ${row.pantheonName} pantheon`);
  lines.push(`${row.tierName} · score ${fmt(row.score)}`);
  const st = standingText(row);
  if (st) lines.push(st);
  return lines.join('\n');
}

export class RosterView {
  /**
   * @param {object} o
   * @param {object} o.viewState
   * @param {boolean} [o.open] start unfolded
   * @param {(open: boolean) => void} [o.onToggle] the header was clicked (save the choice)
   */
  constructor({ viewState, open = true, onToggle = null }) {
    this.vs = viewState;
    this.onToggle = onToggle;
    this.sig = '';
    this.last = -Infinity;
    this.count = el('span', 'hud-roster-count');
    this.chev = el('span', 'hud-roster-chev', '▾');
    this.head = el('button', 'hud-roster-head', el('span', 'hud-roster-title', 'Players'), this.count, this.chev);
    this.head.type = 'button';
    this.head.tabIndex = -1;
    this.head.addEventListener('click', () => {
      this.setOpen(!this.open);
      if (this.onToggle) this.onToggle(this.open);
    });
    this.list = el('div', 'hud-roster-list');
    this.root = el('div', 'hud-roster hud-panel', this.head, this.list);
    this.root.hidden = true;
    this.setOpen(open);
  }

  setOpen(open) {
    this.open = !!open;
    setClass(this.root, 'is-open', this.open);
    setHidden(this.list, !this.open);
    setText(this.chev, this.open ? '▾' : '▸');
    this.head.title = this.open ? 'Hide the player list' : 'Show the player list: every player, their pantheon, tier and score';
    this.head.setAttribute('aria-expanded', String(this.open));
  }

  /** Draw the rows again at the next update (the colour-blind palette changed). */
  invalidate() {
    this.sig = '';
    this.last = -Infinity;
  }

  /** Refresh; looks at the players every ROSTER_REFRESH_MS unless forced. */
  update(now = performance.now(), force = false) {
    if (!force && now - this.last < ROSTER_REFRESH_MS) return;
    this.last = now;
    const groups = rosterGroups(this.vs);
    const total = groups.reduce((n, g) => n + g.rows.length, 0);
    setHidden(this.root, total < 2);
    if (total < 2) return;
    const inGame = groups.reduce((n, g) => n + g.rows.filter((r) => r.standing === 'in').length, 0);
    setText(this.count, inGame === total ? String(total) : `${inGame}/${total}`);
    this.count.title = inGame === total ? `${total} players` : `${inGame} of ${total} players still in the match`;
    const sig = JSON.stringify(groups.map((g) => [g.label, g.rows.map((r) => [r.i, r.name, r.color, r.pantheon, r.tier, r.score, r.standing, r.away, r.me])]));
    if (sig === this.sig) return;
    this.sig = sig;
    this.render(groups);
  }

  render(groups) {
    this.list.textContent = '';
    for (const g of groups) {
      if (g.label) this.list.appendChild(el('div', `hud-roster-team${g.mine ? ' is-mine' : ''}`, g.label));
      for (const r of g.rows) {
        const st = standingText(r);
        const swatch = el('i', 'hud-roster-swatch');
        setStyle(swatch, 'background', safeColor(displayColor(r.color)));
        const name = el('span', 'hud-roster-name', r.name);
        const row = el('div', 'hud-roster-row',
          swatch,
          el('span', 'hud-roster-emblem', r.emblem),
          el('span', 'hud-roster-who', name, r.me ? el('small', 'hud-roster-you', 'you') : null),
          // a player who is out (or away) says so where the tier would be
          st ? el('span', 'hud-roster-tier hud-roster-state', r.standing === 'in' ? 'Away' : st) : el('span', 'hud-roster-tier', r.tierName),
          el('b', 'hud-roster-score', fmt(r.score)));
        setClass(row, 'is-me', r.me);
        setClass(row, 'is-out', r.standing !== 'in');
        setClass(row, 'is-away', r.away);
        row.title = rowTitle(r);
        row.dataset.player = String(r.i);
        this.list.appendChild(row);
      }
    }
  }
}
