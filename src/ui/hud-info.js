// Selection panel (bottom centre): a portrait and full stats for a single
// selection, or a grid of icons with health bars for a group. Building queues
// (click an item to cancel it), construction progress, prayer counts, god
// level / xp, soldier rank / xp, status effects, carried resources, the worshippers working at a
// building, and stats with the owner's researched upgrades.
import {
  GOD_XP_LEVELS, GOD_MAX_LEVEL, GOD_LEVEL_DAMAGE, GOD_LEVEL_ARMOR, MAX_QUEUE, MINE_SLOTS,
  RANK_XP, RANK_HP, RANK_DAMAGE, RANK_ARMOR,
} from '../config.js';
import { UNITS, BUILDINGS, GOLD_MINE, UPGRADES } from '../data/index.js';
import { buildingMods, unitMods, upgradesFor } from '../data/upgrades.js';
import { MANOR, mergeRule } from '../data/houses.js';
import { canRank, rankBonus, rankName, nextRankXp, RANK_NUMERALS, RANK_COLORS } from '../data/ranks.js';
import { sanitizeName } from '../net/protocol.js';
import { el, setText, setStyle, setHidden, setClass, fmt, pct, hpColor, safeColor } from './hud-dom.js';
import {
  defOf, nameOf, iconOf, typeIcon, typeName, isComplete, isWallEntity, tierName, workersAt, workerTasks, modsOf, upgradesOf, WORKER_TASKS,
  workText, mineTripText, relicIcon, relicLine, relicCarryText, templeRelicsText,
} from './hud-data.js';
import { MAX_SELECTION } from './hud-selection.js';
import { displayColor, teamPalette } from '../team-colors.js';

const STATUS = {
  stun: ['💫', 'Stunned'],
  slow: ['🐌', 'Slowed'],
  shield: ['🔰', 'Shielded'],
  invuln: ['✨', 'Invulnerable'],
  buff: ['⬆️', 'Empowered'],
  debuff: ['⬇️', 'Weakened'],
  dot: ['☠️', 'Taking damage over time'],
};

const STATE_TEXT = {
  idle: 'Idle', move: 'Moving', attack: 'Attacking', gather: 'Gathering', return: 'Returning resources',
  build: 'Building', pray: 'Praying', cast: 'Casting',
};

const CLASS_TEXT = {
  worker: 'Worker', infantry: 'Infantry', ranged: 'Ranged', support: 'Support', siege: 'Siege',
  creature: 'Mythical Creature', god: 'God', titan: 'Titan', minion: 'Summoned',
};

function playerOf(vs, owner) {
  if (!Number.isInteger(owner) || owner < 0) return null;
  return vs.players[owner] || (vs.setup && vs.setup.players[owner]) || null;
}

function teamColor(vs, owner) {
  if (owner < 0) return '#8a7a5a';
  const p = playerOf(vs, owner);
  return displayColor(safeColor(p && p.color, '#888888'));
}

function ownerName(vs, owner) {
  if (owner < 0) return 'Neutral';
  const p = playerOf(vs, owner);
  return sanitizeName(p && p.name, `Player ${owner + 1}`);
}

/** Text for the attack range stat: melee attacks have no projectile (the sim's rule). */
export function rangeText(attack) {
  if (!attack) return '';
  return attack.projectile ? String(attack.range) : 'Melee';
}

/** What each rank adds, for the experience bar's tooltip: "+5% damage, +10% health, +0.5 armor per rank". */
export function rankBonusText() {
  return `Each rank: +${Math.round(RANK_DAMAGE * 100)}% damage, +${Math.round(RANK_HP * 100)}% health, +${RANK_ARMOR} armor.`;
}

/** The experience line of a soldier: "Veteran · XP 75 / 150", or "Champion · Max rank". */
export function rankProgressText(rank, xp) {
  const next = nextRankXp(rank);
  return next === null ? `${rankName(rank)} · Max rank` : `${rankName(rank)} · XP ${fmt(xp)} / ${fmt(next)}`;
}

/** Own workers gathering at a gold mine (walking to it, waiting their turn or mining). */
function ownMinersAt(vs, mineId) {
  let n = 0;
  for (const e of vs.entities.values()) {
    if (e.k === 'u' && e.o === vs.myIndex && e.st === 'gather' && e.tg === mineId) n++;
  }
  return n;
}

/** "Miners 1/2": workers mining the mine right now (the snapshot's `mn`) out of MINE_SLOTS. */
export function minersText(mine) {
  const n = mine && Number.isFinite(mine.mn) ? Math.max(0, Math.min(MINE_SLOTS, mine.mn)) : 0;
  return `${n}/${MINE_SLOTS}`;
}

/** The selected unit's state line ("Gathering gold · Carrying gold"); only expiry for others' units. */
export function unitStateText(e, def, myIndex) {
  if (e.o !== myIndex) return e.ex ? `Vanishes in ${Math.ceil(e.ex)}s` : '';
  let st = STATE_TEXT[e.st] || '';
  // `mw` (requested from the sim, see notes/interface-requests.md): waiting for one of the mining spots.
  if (e.st === 'gather' && def && def.class === 'worker') st = e.tg ? (e.mw ? 'Waiting its turn at the gold mine' : 'Gathering gold') : 'Chopping wood';
  if (e.tk === 'repair') st = e.st === 'build' ? 'Repairing' : 'On the way to repair';
  if (e.pa && e.st === 'move') st = 'Patrolling';
  if (e.ho && e.st === 'idle') st = 'Holding position';
  if (e.c) st += `${st ? ' · ' : ''}Carrying ${e.c === 'g' ? 'gold' : 'wood'}`;
  if (e.bo && BUILDINGS[e.bo.b]) st = `On the way to build a ${BUILDINGS[e.bo.b].name}`;
  if (e.ex) st += `${st ? ' · ' : ''}Vanishes in ${Math.ceil(e.ex)}s`;
  return st;
}

/** "🔨 2 building · 🔧 1 repairing" for the worshippers at a building ('' when none). */
export function buildingWorkersText(n) {
  const parts = [];
  if (n.build) parts.push(`🔨 ${n.build} building`);
  if (n.repair) parts.push(`🔧 ${n.repair} repairing`);
  if (n.pray) parts.push(`🙏 ${n.pray} praying`);
  return parts.join(' · ');
}

/** "⛏️ 3 · 🌲 2 · 💤 1": the tasks of a group of worshippers (only tasks with someone on them). */
export function taskSummaryText(counts) {
  return WORKER_TASKS.filter((t) => counts[t.id] > 0).map((t) => `${t.icon} ${counts[t.id]}`).join(' · ');
}

/**
 * Researched upgrades of a building type for a player: "🧱 Stone Walls, 👪 Large Families" ('' when none).
 * Of an upgrade line only the highest level shows; the lower levels are part of it.
 */
export function researchedText(up, typeId) {
  const owned = upgradesFor(typeId).filter((u) => up.includes(u.id));
  return owned
    .filter((u) => !u.line || !owned.some((o) => o.line === u.line && o.after === u.id))
    .map((u) => `${u.icon} ${u.name}`)
    .join(', ');
}

/** Queue buttons the selection panel draws after the one in progress; any more runs fold into a "+N" button. */
export const QUEUE_CHIPS = 12;

/**
 * The queue from item `from` on as runs of the same item: [{ u, at, n }] is item `u` at index `at`,
 * `n` times in a row. A queue of 50 Worshippers is one run, so the panel draws "🧑 49" and not 49 buttons.
 */
export function queueRuns(q, from = 1) {
  const runs = [];
  for (let i = from; i < q.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.u === q[i].u) last.n++;
    else runs.push({ u: q[i].u, at: i, n: 1 });
  }
  return runs;
}

/** Shape of an entity that needs a panel rebuild when it changes. */
function shapeOf(e, vs) {
  if (!e) return '-';
  const q = e.q ? e.q.map((it) => it.u).join(',') : '';
  return `${e.id}|${e.t}|${e.o}|${e.k === 'b' ? (isComplete(e) ? 1 : 0) : ''}|${q}|${e.lv || ''}|${e.tr || ''}|${vs.relation(e.o)}|${teamPalette()}`;
}

/** "wooden_wall×20,stone_wall×10": how many of each type are selected. It changes when walls are upgraded in place. */
function typeMix(ents) {
  const n = new Map();
  for (const e of ents) n.set(e.t, (n.get(e.t) || 0) + 1);
  let out = '';
  for (const [t, c] of n) out += `${out ? ',' : ''}${t}×${c}`;
  return out;
}

export class InfoView {
  /**
   * @param {HTMLElement} root container
   * @param {{ selection: object, viewState: object, onSelectOnly(id), onRemove(id), onSelectType(type), onCancelQueue(buildingId, index, count), onPortrait() }} o
   */
  constructor(root, o) {
    this.root = root;
    this.o = o;
    this.sig = null;
    this.single = null;
    this.multi = null;
  }

  update() {
    const { selection, viewState: vs } = this.o;
    const ents = selection.entities();
    const active = selection.activeGroup();
    let sig;
    if (ents.length === 0) sig = 'empty';
    else if (ents.length === 1) sig = `1:${shapeOf(ents[0], vs)}`;
    else sig = `n:${ents.map((e) => e.id).join(',')}:${active ? active.type : ''}:${typeMix(ents)}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.root.textContent = '';
      this.single = null;
      this.multi = null;
      if (ents.length === 1) this.buildSingle(ents[0]);
      else if (ents.length > 1) this.buildMulti(ents, active);
      else this.root.appendChild(el('div', 'hi-empty', el('div', 'hi-empty-crest', '⚜'), el('div', 'hi-empty-text', 'Select a unit or building')));
    }
    if (this.single) this.updateSingle();
    if (this.multi) this.updateMulti();
  }

  // ---------------------------------------------------------------- single

  buildSingle(e) {
    const vs = this.o.viewState;
    const def = defOf(e);
    const portrait = el('button', 'hi-portrait');
    portrait.type = 'button';
    portrait.tabIndex = -1;
    portrait.title = 'Center the camera (Space)';
    portrait.addEventListener('click', () => this.o.onPortrait && this.o.onPortrait());
    setStyle(portrait, '--team', teamColor(vs, e.o));
    const picon = el('span', 'hi-portrait-icon', iconOf(e, vs));
    const lvl = el('span', 'hi-level');
    portrait.append(picon, lvl);
    const hpBar = el('div', 'hi-bar is-hp', el('i', 'hi-bar-fill'), el('i', 'hi-bar-shield'));
    const hpText = el('div', 'hi-hp-text');
    const left = el('div', 'hi-left', portrait, hpBar, hpText);

    const name = el('div', 'hi-name', nameOf(e));
    const sub = el('div', 'hi-sub');
    const stats = el('div', 'hi-stats');
    const extra = el('div', 'hi-extra');
    const right = el('div', 'hi-right', name, sub, stats, extra);
    const wrap = el('div', 'hi-single', left, right);
    this.root.appendChild(wrap);

    const s = { e, def, nameEl: name, portrait, lvl, hpBar, hpFill: hpBar.children[0], shFill: hpBar.children[1], hpText, sub, stats, extra, parts: {} };
    this.single = s;

    // Subtitle.
    const rel = vs.relation(e.o);
    if (e.k === 'u' && def) {
      const bits = [];
      if (def.title) bits.push(el('span', 'hi-title', def.title));
      else bits.push(el('span', 'hi-class', CLASS_TEXT[def.class] || ''));
      sub.append(...bits);
    } else if (e.k === 'b' && def) {
      sub.appendChild(el('span', 'hi-class', e.t === 'town_center' ? `${tierName(e.tr)} · Drop-off point` : def.dropOff ? 'Drop-off point' : def.wall ? 'Wall' : 'Building'));
    } else if (e.k === 'm') {
      sub.appendChild(el('span', 'hi-class', 'Resource'));
    }
    if (rel !== 'own') {
      const owner = el('span', 'hi-owner', rel === 'neutral' ? (e.k === 'm' ? '' : 'Neutral creature') : ownerName(vs, e.o));
      setStyle(owner, 'color', teamColor(vs, e.o));
      if (owner.textContent) sub.append(' ', owner, rel === 'ally' ? el('span', 'hi-rel is-ally', ' (ally)') : rel === 'enemy' ? el('span', 'hi-rel is-enemy', ' (enemy)') : null);
    }

    // Stats.
    const stat = (icon, label, cls = '') => {
      const v = el('b', 'hi-stat-v');
      const n = el('span', `hi-stat ${cls}`, el('i', 'hi-stat-i', icon), el('span', 'hi-stat-l', label), v);
      stats.appendChild(n);
      return v;
    };
    if (e.k === 'u' && def) {
      if (def.attack) {
        s.parts.dmg = stat('⚔️', 'Damage');
        s.parts.range = stat('🎯', 'Range');
      }
      s.parts.armor = stat('🛡️', 'Armor');
      s.parts.speed = stat('👣', 'Speed');
      if (def.class === 'worker') s.parts.work = stat('🔨', 'Work');
    } else if (e.k === 'b' && def) {
      s.parts.armor = stat('🛡️', 'Armor');
      if (def.attack) {
        s.parts.dmg = stat('⚔️', 'Damage');
        s.parts.range = stat('🎯', 'Range');
      }
      if (def.popProvided && e.o === vs.myIndex) s.parts.popp = stat('🏠', 'Housing');
    } else if (e.k === 'm') {
      s.parts.gold = stat('💰', 'Gold left', 'is-wide');
      s.parts.miners = stat('⛏️', 'Miners', 'is-wide');
      s.parts.mineNote = el('div', 'hi-note');
      s.parts.mineRule = el('div', 'hi-note is-dim');
      extra.append(s.parts.mineNote, s.parts.mineRule);
    }

    // Extra block by kind.
    if (e.k === 'u') this.buildUnitExtra(s);
    else if (e.k === 'b') this.buildBuildingExtra(s);
  }

  buildUnitExtra(s) {
    const { e, def, extra } = s;
    const soldier = canRank(def);
    if (def && (def.class === 'god' || soldier)) {
      const xpBar = el('div', soldier ? 'hi-bar is-xp is-rank' : 'hi-bar is-xp', el('i', 'hi-bar-fill'));
      const xpText = el('div', 'hi-xp-text');
      const xp = el('div', 'hi-xp', xpBar, xpText);
      if (soldier) xp.title = rankBonusText();
      extra.appendChild(xp);
      s.parts.xpFill = xpBar.children[0];
      s.parts.xpText = xpText;
    }
    s.parts.state = el('div', 'hi-state');
    s.parts.status = el('div', 'hi-status');
    extra.append(s.parts.state, s.parts.status);
    s.parts.statusSig = null;
  }

  buildBuildingExtra(s) {
    const { e, def, extra } = s;
    const vs = this.o.viewState;
    if (!isComplete(e)) {
      const bar = el('div', 'hi-bar is-build', el('i', 'hi-bar-fill'));
      const txt = el('div', 'hi-progress-text');
      extra.appendChild(el('div', 'hi-progress', el('div', 'hi-progress-label', 'Under construction'), bar, txt));
      s.parts.buildFill = bar.children[0];
      s.parts.buildText = txt;
      if (e.o === vs.myIndex) {
        s.parts.workers = el('div', 'hi-note');
        extra.appendChild(s.parts.workers);
      }
      return;
    }
    const queueing = e.o === vs.myIndex && e.q && e.q.length;
    if (queueing) {
      const q = e.q;
      const first = q[0];
      // A click takes back the item `one`; Shift-click takes back `n` from `at` on.
      const take = (ev, one, at, n) => (ev && ev.shiftKey ? this.o.onCancelQueue(e.id, at, n) : this.o.onCancelQueue(e.id, one, 1));
      const big = el('button', 'hi-q-main');
      big.type = 'button';
      big.tabIndex = -1;
      big.title = q.length > 1 ? 'Click to cancel. Shift-click to cancel the whole queue.' : 'Click to cancel';
      big.addEventListener('click', (ev) => take(ev, 0, 0, q.length));
      const bar = el('div', 'hi-bar is-train', el('i', 'hi-bar-fill'));
      const cls = UNITS[first.u] ? UNITS[first.u].class : '';
      const verb = BUILDINGS[first.u] ? 'Upgrading to' : UPGRADES[first.u] ? 'Researching' : cls === 'god' || cls === 'titan' || cls === 'creature' ? 'Summoning' : 'Training';
      const label = first.u === 'tier_up' ? `Growing into a ${tierName((e.tr || 1) + 1)}` : `${verb} ${typeName(first.u)}`;
      big.append(el('span', 'hi-q-icon', typeIcon(first.u)));
      const head = el('div', 'hi-q-head', el('div', 'hi-q-label', label), q.length > 1 ? el('div', 'hi-q-count', `${q.length} / ${MAX_QUEUE}`) : null);
      const info = el('div', 'hi-q-info', head, bar);
      // The rest of the queue as runs of the same unit with a count: a click takes one back, Shift-click the whole run.
      const small = el('div', 'hi-q-rest');
      const runs = queueRuns(q);
      const shown = runs.length > QUEUE_CHIPS ? runs.slice(0, QUEUE_CHIPS - 1) : runs;
      for (const r of shown) {
        const b = el('button', 'hi-q-item', typeIcon(r.u), r.n > 1 ? el('span', 'hi-q-n', r.n) : null);
        b.type = 'button';
        b.tabIndex = -1;
        b.title = r.n > 1 ? `${typeName(r.u)} ×${r.n} — click to cancel one, Shift-click to cancel all ${r.n}` : `${typeName(r.u)} — click to cancel`;
        b.addEventListener('click', (ev) => take(ev, r.at + r.n - 1, r.at, r.n));
        small.appendChild(b);
      }
      if (shown.length < runs.length) {
        // Too many different runs for the row: the rest as one "+N" button (click takes the last one back).
        const at = runs[shown.length].at;
        const more = q.length - at;
        const b = el('button', 'hi-q-item is-more', `+${more}`);
        b.type = 'button';
        b.tabIndex = -1;
        b.title = `${more} more queued — click to cancel the last, Shift-click to cancel all ${more}`;
        b.addEventListener('click', (ev) => take(ev, q.length - 1, at, more));
        small.appendChild(b);
      }
      extra.appendChild(el('div', 'hi-queue', big, el('div', 'hi-q-side', info, small)));
      s.parts.trainFill = bar.children[0];
    }
    // The prayer line stays while a god or creature is being summoned: that is when the Faith matters.
    if (def && def.prayerSlots > 0) {
      s.parts.pray = el('div', 'hi-note');
      extra.appendChild(s.parts.pray);
    }
    if (e.o === vs.myIndex) {
      s.parts.workers = el('div', 'hi-note');
      extra.appendChild(s.parts.workers);
    }
    s.parts.researched = el('div', 'hi-note is-dim');
    extra.appendChild(s.parts.researched);
    if (e.t === 'temple') {
      s.parts.relics = el('div', 'hi-note is-relics');
      extra.appendChild(s.parts.relics);
    }
    if (queueing) return;
    if (e.t === 'town_center' && e.o === vs.myIndex) {
      extra.appendChild(el('div', 'hi-note is-dim', 'Trains Worshippers. Gold and wood are delivered here.'));
    } else if (e.t === 'storehouse' && e.o === vs.myIndex) {
      extra.appendChild(el('div', 'hi-note is-dim', 'Gold and wood can be delivered here.'));
    } else if (e.t === 'house' && e.o === vs.myIndex) {
      extra.appendChild(el('div', 'hi-note is-dim', `Provides housing for ${def.popProvided} population. Select four Houses that stand in a square to combine them into a Manor.`));
    } else if (e.t === MANOR && e.o === vs.myIndex) {
      extra.appendChild(el('div', 'hi-note is-dim', `Provides housing for ${def.popProvided} population: ${def.popProvided - mergeRule().count * BUILDINGS.house.popProvided} more than the Houses it replaced.`));
    } else if (def && def.wall && e.o === vs.myIndex) {
      extra.appendChild(el('div', 'hi-note is-dim', def.wallUpgrade ? 'Blocks the way. Upgrade it to stone for more health and armor.' : 'Blocks the way until enemies break through. A Tower built on it joins the wall.'));
    }
  }

  updateSingle() {
    const s = this.single;
    const vs = this.o.viewState;
    // Never the live entity of a fogged enemy building: its remembered copy.
    const e = vs.knownEntity(s.e.id) || s.e;
    const def = s.def;
    // hp
    if (e.k !== 'm') {
      const f = e.mhp > 0 ? e.hp / e.mhp : 0;
      setStyle(s.hpFill, 'width', pct(f));
      setStyle(s.hpFill, 'background', hpColor(f));
      const sh = e.sh > 0 && e.mhp > 0 ? Math.min(1, e.sh / e.mhp) : 0;
      setStyle(s.shFill, 'width', pct(sh));
      setText(s.hpText, `${fmt(e.hp)} / ${fmt(e.mhp)}${e.sh > 0 ? ` +${fmt(e.sh)}` : ''}`);
    } else {
      setHidden(s.hpBar, true);
      setText(s.hpText, '');
    }
    const lv = e.lv || 1;
    const rk = e.rk || 0;
    // portrait badge: a god's level, or a ranked soldier's numeral in its rank colour
    const god = !!def && def.class === 'god';
    const badge = god ? String(lv) : RANK_NUMERALS[rk] || '';
    setText(s.lvl, badge);
    setHidden(s.lvl, !badge);
    setClass(s.lvl, 'is-rank', !god && rk > 0);
    setStyle(s.lvl, '--rank', !god && rk > 0 ? RANK_COLORS[rk] : '');
    const p = s.parts;
    if (e.k === 'u' && def) {
      const isGod = def.class === 'god';
      const um = unitMods(modsOf(vs, e.o), def);
      const rb = rankBonus(rk);
      if (p.dmg) {
        const dmg = def.attack.damage * (isGod ? 1 + GOD_LEVEL_DAMAGE * (lv - 1) : 1) * (1 + um.damage) * (1 + rb.damage) * (e.wd > 0 ? e.wd : 1); // wd: a Trial of the Titans monster's damage boost
        setText(p.dmg, `${Math.round(dmg)}${def.attack.splash ? ' (splash)' : ''}`);
        setText(p.range, rangeText(def.attack));
      }
      const armor = def.armor + (isGod ? GOD_LEVEL_ARMOR * (lv - 1) : 0) + um.armor + rb.armor;
      setText(p.armor, String(Math.round(armor * 10) / 10));
      setText(p.speed, String(Math.round(def.speed * (1 + um.speed) * 100) / 100));
      if (p.work) setText(p.work, workText(modsOf(vs, e.o)));
      if (p.xpFill && isGod) {
        const lo = GOD_XP_LEVELS[lv - 1] || 0;
        const hi = GOD_XP_LEVELS[lv];
        if (lv >= GOD_MAX_LEVEL || hi === undefined) {
          setStyle(p.xpFill, 'width', '100%');
          setText(p.xpText, `Level ${lv} · Max level`);
        } else {
          setStyle(p.xpFill, 'width', pct(((e.xp || 0) - lo) / (hi - lo)));
          setText(p.xpText, `Level ${lv} · XP ${fmt(e.xp || 0)} / ${fmt(hi)}`);
        }
      } else if (p.xpFill) {
        const next = nextRankXp(rk);
        setStyle(p.xpFill, 'width', next === null ? '100%' : pct(((e.xp || 0) - RANK_XP[rk]) / (next - RANK_XP[rk])));
        setText(p.xpText, rankProgressText(rk, e.xp || 0));
      }
      setText(p.state, unitStateText(e, def, vs.myIndex));
      const fx = e.fx || [];
      const relic = vs.relicCarriedBy(e.id);
      const sig = fx.join(',') + (e.c || '') + (relic ? relic.t : '');
      if (sig !== p.statusSig) {
        p.statusSig = sig;
        p.status.textContent = '';
        if (e.c) p.status.appendChild(el('span', 'hi-chip is-carry', e.c === 'g' ? '💰' : '🌲'));
        if (relic) {
          const chip = el('span', 'hi-chip is-relic', relicIcon(relic.t));
          chip.title = relicCarryText(relic.t);
          p.status.appendChild(chip);
        }
        for (const code of fx) {
          const [icon, label] = STATUS[code] || ['❔', code];
          const chip = el('span', `hi-chip is-${code}`, icon);
          chip.title = label;
          p.status.appendChild(chip);
        }
      }
    } else if (e.k === 'b' && def) {
      const bm = buildingMods(modsOf(vs, e.o), e.t);
      setText(p.armor, String(def.armor + bm.armor));
      if (p.dmg) {
        setText(p.dmg, String(Math.round(def.attack.damage * (1 + bm.damage))));
        setText(p.range, String(def.attack.range + bm.range));
      }
      if (p.popp) setText(p.popp, `+${def.popProvided + bm.pop}`);
      if (p.workers) {
        const n = workersAt(vs, e.id);
        setText(p.workers, buildingWorkersText({ build: n.build, repair: n.repair }) || (isComplete(e) ? '' : 'No Worshippers are building it.'));
      }
      if (p.researched) {
        const t = researchedText(upgradesOf(vs, e.o), e.t);
        setText(p.researched, t ? `Upgrades: ${t}` : '');
      }
      if (p.buildFill) {
        setStyle(p.buildFill, 'width', pct(e.bp || 0));
        setText(p.buildText, `${Math.floor((e.bp || 0) * 100)}%`);
      }
      if (p.trainFill && e.q && e.q[0]) setStyle(p.trainFill, 'width', pct(e.q[0].p || 0));
      if (p.relics) {
        const list = vs.relicsIn(e.id);
        setText(p.relics, templeRelicsText(list.map((r) => r.t)));
        p.relics.title = list.map((r) => relicLine(r.t)).join('\n');
      }
      if (p.pray) {
        const n = e.pr || 0;
        const rate = def.faithRate * (1 + buildingMods(modsOf(vs, e.o), e.t).faith);
        setText(p.pray, `🙏 Praying: ${n} / ${def.prayerSlots}${n ? ` · +${(n * rate).toFixed(1)} faith/s` : ''}`);
      }
    } else if (e.k === 'm') {
      // Out of sight: the gold left when last seen, and nobody knows who mines there.
      const inSight = vs.mineInSight(e);
      setText(p.gold, fmt(vs.mineGold(e)));
      setText(p.miners, inSight ? minersText(e) : '?');
      setText(p.mineRule, `Up to ${MINE_SLOTS} Worshippers mine at once, ${mineTripText(modsOf(vs, vs.myIndex))}; the others wait their turn.`);
      const mine = ownMinersAt(vs, e.id);
      setText(p.mineNote, mine ? `${mine} of your Worshippers ${mine === 1 ? 'works' : 'work'} here.` : inSight ? '' : 'Not in sight: gold left as last seen.');
    }
    // Name can change (town center tier).
    setText(s.nameEl, nameOf(e));
  }

  // ---------------------------------------------------------------- multi

  buildMulti(ents, active) {
    if (ents.length > MAX_SELECTION) return this.buildCrowd(ents, active);
    const vs = this.o.viewState;
    const grid = el('div', 'hi-grid');
    const cells = [];
    for (const e of ents) {
      const c = el('button', 'hi-cell');
      c.type = 'button';
      c.tabIndex = -1;
      c.title = `${nameOf(e)} — click: select · Shift: remove · Ctrl: select all of this type`;
      setStyle(c, '--team', teamColor(vs, e.o));
      const bar = el('div', 'hi-cell-bar', el('i', 'hi-bar-fill'));
      c.append(el('span', 'hi-cell-icon', iconOf(e, vs)), bar);
      // a soldier's rank numeral (filled in by updateMulti, which follows promotions)
      const rankBadge = !e.lv && e.k === 'u' && canRank(UNITS[e.t]) ? el('span', 'hi-cell-lv is-rank') : null;
      if (e.lv) c.appendChild(el('span', 'hi-cell-lv', String(e.lv)));
      else if (rankBadge) c.appendChild(rankBadge);
      if (active && e.t === active.type) c.classList.add('is-active');
      c.addEventListener('click', (ev) => {
        if (ev.shiftKey) this.o.onRemove(e.id);
        else if (ev.ctrlKey || ev.metaKey) this.o.onSelectType(e.t);
        else this.o.onSelectOnly(e.id);
      });
      grid.appendChild(c);
      cells.push({ id: e.id, fill: bar.children[0], rankBadge });
    }
    const label = el('div', 'hi-grid-label');
    let tasks = null;
    if (active) {
      const def = UNITS[active.type] || BUILDINGS[active.type] || GOLD_MINE;
      label.append(el('b', null, def.name), ` × ${active.ids.length}`, el('span', 'hi-grid-hint', ents.length > active.ids.length ? '  ·  Tab: next group' : ''));
    }
    if (ents.some((e) => e.k === 'u' && e.o === vs.myIndex && UNITS[e.t] && UNITS[e.t].class === 'worker')) {
      tasks = el('span', 'hi-grid-tasks');
      tasks.title = WORKER_TASKS.map((t) => `${t.icon} ${t.label}`).join('\n');
      label.appendChild(tasks);
    }
    this.root.appendChild(el('div', 'hi-multi', label, grid));
    this.multi = { cells, tasks, ids: ents.map((e) => e.id) };
  }

  /**
   * More than MAX_SELECTION selected (only wall segments can be): one cell per type with its count
   * and combined health, and a line for the whole group, instead of a button for every segment.
   */
  buildCrowd(ents, active) {
    const vs = this.o.viewState;
    const byType = new Map();
    for (const e of ents) {
      if (!byType.has(e.t)) byType.set(e.t, []);
      byType.get(e.t).push(e.id);
    }
    const grid = el('div', 'hi-grid');
    const stacks = [];
    for (const [type, ids] of byType) {
      const def = BUILDINGS[type];
      const c = el('button', 'hi-cell hi-cell-stack');
      c.type = 'button';
      c.tabIndex = -1;
      c.title = `${def.name} × ${ids.length} — click: select only these`;
      setStyle(c, '--team', teamColor(vs, vs.myIndex));
      const bar = el('div', 'hi-cell-bar', el('i', 'hi-bar-fill'));
      c.append(el('span', 'hi-cell-icon', def.icon), bar, el('span', 'hi-cell-count', String(ids.length)));
      if (active && type === active.type) c.classList.add('is-active');
      c.addEventListener('click', () => this.o.onSelectType(type));
      grid.appendChild(c);
      stacks.push({ ids, fill: bar.children[0] });
    }
    const label = el('div', 'hi-grid-label');
    label.append(el('b', null, byType.size === 1 ? BUILDINGS[[...byType.keys()][0]].name : 'Walls'), ` × ${ents.length}`);
    const note = el('div', 'hi-note');
    this.root.appendChild(el('div', 'hi-multi', label, grid, note));
    this.multi = { crowd: true, stacks, note, ids: ents.map((e) => e.id) };
  }

  updateCrowd() {
    const vs = this.o.viewState;
    let hp = 0;
    let max = 0;
    let building = 0;
    let upgrading = 0;
    let hurt = 0;
    for (const s of this.multi.stacks) {
      let sh = 0;
      let sm = 0;
      for (const id of s.ids) {
        const e = vs.entities.get(id);
        if (!e || !isWallEntity(e)) continue;
        sh += e.hp;
        sm += e.mhp;
        if (!isComplete(e)) building++;
        else if (e.q && e.q.length) upgrading++;
        if (e.hp < e.mhp) hurt++;
      }
      hp += sh;
      max += sm;
      const f = sm > 0 ? sh / sm : 0;
      setStyle(s.fill, 'width', pct(f));
      setStyle(s.fill, 'background', hpColor(f));
    }
    const parts = [`Health ${fmt(hp)} / ${fmt(max)}`];
    if (hurt) parts.push(`${hurt} damaged`);
    if (building) parts.push(`${building} being built`);
    if (upgrading) parts.push(`${upgrading} upgrading`);
    setText(this.multi.note, parts.join(' · '));
  }

  updateMulti() {
    const vs = this.o.viewState;
    if (this.multi.crowd) return this.updateCrowd();
    if (this.multi.tasks) setText(this.multi.tasks, taskSummaryText(workerTasks(vs, this.multi.ids).counts));
    for (const c of this.multi.cells) {
      const e = vs.entities.get(c.id);
      if (!e) continue;
      const f = e.mhp > 0 ? e.hp / e.mhp : 0;
      setStyle(c.fill, 'width', pct(f));
      setStyle(c.fill, 'background', hpColor(f));
      if (c.rankBadge) {
        const rk = e.rk || 0;
        setText(c.rankBadge, RANK_NUMERALS[rk] || '');
        setHidden(c.rankBadge, rk === 0);
        setStyle(c.rankBadge, '--rank', RANK_COLORS[rk]);
      }
    }
  }
}
