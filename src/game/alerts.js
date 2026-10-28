// Alerts that keep a player in the match (DESIGN 9, "Alerts, tips and sounds"): the things worth
// a nudge when the player is busy with something else or has looked away. It watches the
// ViewState (its events and, twice a second of game time, a survey of what the player can see)
// and hands every alert to `notify`, which the Game turns into a HUD line, a sound, a minimap
// ping and a flash of the browser tab. Pure and DOM-free; time is game time, so a paused or
// stalled match neither nags nor forgets.
//
//   warnings ('important'): enemies sighted near the base, an ally under attack, the Decade of
//     Peace about to end (the gong; the HUD writes the line), a sacred site lost or taken by a
//     rival, a side holding every sacred site (Sacred Victory), plus the tab flash for the alerts
//     the Game already voices (under attack, an enemy Titan, the war starting, a god or Titan
//     ready, a defeat)
//   reminders ('all'): Worshippers left idle, the population cap, a god or the Titan you can
//     afford, an army standing about, finished research, milestones
//
// The `alerts` setting picks 'all', 'important' or 'off' for the lines, sounds and pings; the
// `tabAlerts` setting alone decides about the tab. Nothing here is sent over the wire.
import { UNITS, UPGRADES, godsFor, titanFor } from '../data/index.js';
import { POP_MAX } from '../config.js';
import { sanitizeName } from '../net/protocol.js';
import { getSettings } from '../settings.js';
import { trainCheck } from '../ui/command-card.js';
import { PEACE_WARNINGS, peaceWarning } from '../ui/hud-data.js';
import { safeColor } from '../ui/hud-dom.js';
import { SITE_ICON, SACRED_WARNINGS, sacredWhen } from '../ui/hud-sites.js';
import { peaceClock } from '../sim/peace.js';
import { SITE_FAITH, SACRED_NAME } from '../config.js';

const SCAN_EVERY = 0.5; // seconds of game time between two surveys
const SOUND_GAP = 2; // seconds between two alert sounds, unless the new one matters more

const NEAR_BASE = 18; // tiles: a hostile unit this close to one of my buildings is "near the base"
const NEAR_REPEAT = 45; // seconds before the next "enemies near" alert
const NEAR_CLEAR = 10; // seconds without hostiles near before the next sighting counts as new
const COVERED_BY_ATTACK = 8; // seconds an under-attack alert already covers the enemies it showed
const ALLY_REPEAT = 20; // seconds between two "ally under attack" alerts about one ally

const IDLE_WORKER_AFTER = 20; // seconds a Worshipper stands idle before it is worth a word
const IDLE_WORKER_REPEAT = 60;
const POP_CAP_AFTER = 10;
const POP_CAP_REPEAT = 120;
const GOD_READY_AFTER = 8;
const GOD_READY_REPEAT = 180;
const TITAN_READY_REPEAT = 240;
const ARMY_MIN = 6; // soldiers, gods and creatures
const ARMY_IDLE_SHARE = 0.8;
const ARMY_IDLE_AFTER = 120;
const ARMY_IDLE_REPEAT = 300;
const ARMY_MIN_TIME = 360; // not before the sixth minute: before that an idle army is just a young one
const MILESTONE_GAP = 20;

const ARMY_CLASSES = new Set(['infantry', 'ranged', 'support', 'siege', 'creature', 'god', 'titan']);
const THREAT_CLASSES = new Set(['infantry', 'ranged', 'support', 'siege', 'creature', 'god', 'titan']);

const LEVEL_RANK = { off: 0, important: 1, all: 2 };

/** Who matters more when two sounds want the same moment. */
const PRIORITY = { enemies_near: 90, sacred: 85, ally_attacked: 80, peace_mark: 70, site_lost: 60, site_taken: 50, god_ready: 40, titan_ready: 40, idle_workers: 30, pop_capped: 25, army_idle: 22, research: 20, milestone: 10 };

/** Milestones: the player's counts, the steps worth a cheer and the emblem of the card. */
const MILESTONES = [
  { key: 'kills', icon: '⚔️', steps: [1, 10, 25, 50, 100, 250, 500, 1000], read: (me) => (me.stats && me.stats.kills) || 0, text: (n) => (n === 1 ? 'First blood! Your first enemy has fallen.' : `${n} enemies have fallen before your armies!`) },
  { key: 'pop', icon: '👥', steps: [25, 50, 100, 150, POP_MAX], read: (me) => me.pop || 0, text: (n) => `Your people number ${n}!` },
  { key: 'gathered', icon: '💰', steps: [1000, 5000, 10000, 25000, 50000, 100000], read: (me) => (me.stats && me.stats.gathered) || 0, text: (n) => `${n.toLocaleString('en-US')} gold and wood gathered.` },
  { key: 'trained', icon: '🪖', steps: [25, 50, 100, 200, 400], read: (me) => (me.stats && me.stats.unitsTrained) || 0, text: (n) => `${n} units trained.` },
];

/** The highest step in `steps` that `value` has reached (0 = none). */
export function milestoneStep(steps, value) {
  let best = 0;
  for (const s of steps) if (value >= s) best = s;
  return best;
}

/** A condition that must hold for `after` seconds before it speaks, then at most once every `repeat` seconds. */
class Nag {
  constructor(after, repeat) {
    this.after = after;
    this.repeat = repeat;
    this.since = null;
    this.last = -Infinity;
  }

  /** Is it time to speak? `on` is whether the condition holds at game time `t`. */
  tick(on, t) {
    if (!on) {
      this.since = null;
      return false;
    }
    if (this.since === null) this.since = t;
    if (t - this.since < this.after || t - this.last < this.repeat) return false;
    this.last = t;
    return true;
  }
}

/**
 * @typedef {object} Alert what `notify` receives
 * @property {string} id which alert it is ('enemies_near', 'idle_workers', …)
 * @property {'alert'|'good'|'info'} kind the HUD line's style
 * @property {string|null} text the HUD line (null: none); [[Key]] markers are drawn as key caps
 * @property {string|null} icon the emblem on the HUD card (a unit's or building's emoji; null: the kind's own)
 * @property {string|null} sound a name for sfx.play (null: none)
 * @property {number} volume
 * @property {{ x: number, y: number, color: string }|null} ping a minimap ping
 * @property {{ x: number, y: number }|null} jump where Space takes the camera
 * @property {string|null} attention a short text for the tab title / desktop notification
 */

export class AlertEngine {
  /**
   * @param {object} o
   * @param {object} o.viewState
   * @param {(alert: Alert) => void} o.notify
   * @param {() => object} [o.settings] the settings (alerts, tabAlerts); default getSettings
   */
  constructor({ viewState, notify, settings = getSettings }) {
    this.vs = viewState;
    this.notify = notify;
    this.settings = settings;
    this.offs = [];
    this.lastScan = null;
    this.baselined = false;
    this.lastDanger = -Infinity; // game time of the last "my things are under attack"
    this.lastNear = -Infinity;
    this.incursion = false;
    this.clearSince = null;
    this.allyAlert = new Map(); // ally index → game time of the last alert
    this.peaceMarks = null; // how many PEACE_WARNINGS the clock had passed when last looked at
    this.sacredMarks = null; // how many SACRED_WARNINGS the running Sacred Victory clock had passed
    this.lastSound = { t: -Infinity, priority: 0 };
    this.idleWorkers = new Nag(0, IDLE_WORKER_REPEAT);
    this.idleSince = new Map(); // Worshipper id → game time it was first seen idle
    this.popCap = new Nag(POP_CAP_AFTER, POP_CAP_REPEAT);
    this.godReady = new Nag(GOD_READY_AFTER, GOD_READY_REPEAT);
    this.titanReady = new Nag(GOD_READY_AFTER, TITAN_READY_REPEAT);
    this.armyIdle = new Nag(ARMY_IDLE_AFTER, ARMY_IDLE_REPEAT);
    this.milestones = new Map(); // key → highest step announced (or already passed when first looked at)
    this.lastMilestone = -Infinity;
  }

  /** Start listening to the view state. */
  attach() {
    this.offs.push(this.vs.on('*', (ev) => this.onEvent(ev)));
    this.offs.push(this.vs.on('snapshot', () => this.onSnapshot()));
    return this;
  }

  dispose() {
    for (const off of this.offs.splice(0)) off();
  }

  // ---------------------------------------------------------------- helpers

  /** Does the player still have a match to be alerted about? */
  playing() {
    const vs = this.vs;
    return !!(vs.me && vs.myIndex >= 0 && !vs.me.defeated && !vs.gameOver);
  }

  level() {
    const a = this.settings().alerts;
    return Object.hasOwn(LEVEL_RANK, a) ? a : 'all';
  }

  playerName(i) {
    const vs = this.vs;
    const p = (vs.players && vs.players[i]) || (vs.setup && vs.setup.players && vs.setup.players[i]);
    return sanitizeName(p && p.name, `Player ${Number.isInteger(i) ? i + 1 : '?'}`);
  }

  /**
   * Hand an alert on, as far as the settings let it through.
   * @param {object} a { id, level: 'important'|'all', kind, text, icon, sound, volume, ping, jump, attention }
   */
  emit(a) {
    const vs = this.vs;
    const s = this.settings();
    const speaks = LEVEL_RANK[this.level()] >= (a.level === 'important' ? 1 : 2);
    const out = {
      id: a.id,
      kind: a.kind || 'info',
      text: speaks ? a.text || null : null,
      icon: a.icon || null,
      sound: null,
      volume: a.volume === undefined ? 1 : a.volume,
      ping: speaks ? a.ping || null : null,
      jump: speaks ? a.jump || null : null,
      attention: s.tabAlerts === 'off' ? null : a.attention || null,
    };
    if (speaks && a.sound) {
      const priority = PRIORITY[a.id] || 0;
      const last = this.lastSound;
      if (vs.time - last.t >= SOUND_GAP || priority > last.priority) {
        out.sound = a.sound;
        this.lastSound = { t: vs.time, priority };
      }
    }
    if (!out.text && !out.sound && !out.ping && !out.jump && !out.attention) return false;
    this.notify(out);
    return true;
  }

  // ---------------------------------------------------------------- events

  onEvent(ev) {
    const vs = this.vs;
    if (ev.type === 'gameOver') {
      if (vs.myIndex < 0) return;
      const wt = ev.winningTeam;
      const won = wt !== null && wt !== undefined && wt === vs.myTeam;
      this.emit({ id: 'game_over', level: 'important', attention: wt === null || wt === undefined ? 'The battle is over: a draw.' : won ? 'Victory! The battle is won.' : 'Defeat. The battle is lost.' });
      return;
    }
    if (ev.type === 'playerDefeated') {
      // (The snapshot that carries it already marks the player as defeated, so this precedes the playing() check.)
      if (ev.player === vs.myIndex && vs.myIndex >= 0) this.emit({ id: 'defeated', level: 'important', attention: 'Defeat. Your last building has fallen.' });
      return;
    }
    if (!this.playing()) return;
    const me = vs.myIndex;
    switch (ev.type) {
      case 'underAttack': {
        if (ev.player === me) {
          // The Game writes the line and blows the horn; this adds the tab and keeps the enemies-near alert quiet.
          this.lastDanger = vs.time;
          const e = vs.entities.get(ev.id);
          this.emit({ id: 'under_attack', level: 'important', attention: e && e.k === 'b' ? 'Your base is under attack!' : 'Your forces are under attack!' });
        } else if (vs.isAlly(ev.player)) this.allyAttacked(ev);
        break;
      }
      case 'titanSummoning':
        if (ev.player !== me && !vs.isAlly(ev.player)) {
          const t = UNITS[ev.t];
          this.emit({ id: 'titan_enemy', level: 'important', attention: `${t ? t.name : 'A Titan'} is being summoned by ${this.playerName(ev.player)}!` });
        }
        break;
      case 'peaceEnd':
        this.emit({ id: 'peace_end', level: 'important', attention: 'The Decade of Peace is over: war begins!' });
        break;
      case 'spawn': {
        if (ev.o !== me) break;
        const t = UNITS[ev.t];
        if (t && (t.class === 'god' || t.class === 'titan')) this.emit({ id: 'spawn_big', level: 'important', attention: `${t.name} is ready!` });
        break;
      }
      case 'tierUp':
        if (ev.player === me) this.emit({ id: 'tier_up', level: 'important', attention: 'Your settlement has grown!' });
        break;
      case 'siteCaptured':
      case 'siteLost':
        this.site(ev);
        break;
      case 'sacredHold':
      case 'sacredBroken':
        this.sacredChange(ev);
        break;
      case 'researched':
        if (ev.player === me) {
          const up = Object.hasOwn(UPGRADES, ev.up) ? UPGRADES[ev.up] : null;
          this.emit({ id: 'research', level: 'all', kind: 'good', icon: up ? up.icon : '📜', text: `${up ? up.name : 'An upgrade'} is researched.`, sound: 'research' });
        }
        break;
      default:
        break;
    }
  }

  /** Names of the players of a team, for "X holds every sacred site". */
  teamName(team) {
    const vs = this.vs;
    const names = (vs.players || []).filter((p) => p.team === team).map((p) => this.playerName(p.i));
    return names.length ? names.join(' and ') : 'The enemy';
  }

  /** A sacred site changed hands: ev.player took it (siteCaptured) or lost it (siteLost). */
  site(ev) {
    const vs = this.vs;
    const site = vs.sites[ev.site];
    const where = site ? { x: site.x, y: site.y } : null;
    const p = vs.players[ev.player];
    const color = safeColor(p && p.color, '#ffe9b0');
    const name = this.playerName(ev.player);
    const mine = ev.player === vs.myIndex;
    const friend = mine || vs.isAlly(ev.player);
    if (ev.type === 'siteCaptured') {
      if (mine) this.emit({ id: 'site_taken', level: 'all', kind: 'good', icon: SITE_ICON, text: `You hold a sacred site: +${SITE_FAITH} faith each second.`, sound: 'milestone', volume: 0.7, ping: where && { ...where, color } });
      else if (friend) this.emit({ id: 'site_taken', level: 'all', kind: 'good', icon: SITE_ICON, text: `${name} holds a sacred site.`, ping: where && { ...where, color } });
      else this.emit({ id: 'site_taken', level: 'important', kind: 'alert', icon: SITE_ICON, text: `${name} has taken a sacred site.  [[Space]]`, sound: 'nudge', ping: where && { ...where, color }, jump: where });
      return;
    }
    if (friend) {
      this.emit({
        id: 'site_lost', level: 'important', kind: 'alert', icon: SITE_ICON,
        text: mine ? 'You have lost a sacred site!  [[Space]]' : `${name} has lost a sacred site.  [[Space]]`,
        sound: mine ? 'drums' : 'nudge', ping: where && { ...where, color: '#ffae2e' }, jump: where,
        attention: mine ? 'You have lost a sacred site!' : null,
      });
    } else this.emit({ id: 'site_lost', level: 'all', kind: 'good', icon: SITE_ICON, text: `${name} has lost a sacred site.`, ping: where && { ...where, color: '#ffe9b0' } });
  }

  /** Sacred Victory: a side now holds every site (the clock starts) or has lost one (it stops). */
  sacredChange(ev) {
    const vs = this.vs;
    const ours = ev.team === vs.myTeam;
    this.sacredMarks = null;
    if (ev.type === 'sacredHold') {
      const left = Number.isFinite(ev.end) ? Math.max(0, ev.end - vs.time) : 0;
      const text = ours
        ? `Your side holds every sacred site! Keep them for ${peaceClock(left)} to win.`
        : `${this.teamName(ev.team)} ${vs.players.filter((p) => p.team === ev.team).length > 1 ? 'hold' : 'holds'} every sacred site! Take one back within ${peaceClock(left)} or lose.`;
      this.emit({ id: 'sacred', level: 'important', kind: ours ? 'good' : 'alert', icon: SITE_ICON, text, sound: 'gong', attention: ours ? `${SACRED_NAME} is near!` : 'The enemy holds every sacred site!' });
      return;
    }
    this.emit({
      id: 'sacred', level: 'important', kind: ours ? 'alert' : 'good', icon: SITE_ICON,
      text: ours ? `Your hold on the sacred sites is broken: the ${SACRED_NAME} clock has stopped.` : `The enemy's hold on the sacred sites is broken!`,
      sound: ours ? 'drums' : 'milestone', volume: 0.8,
    });
  }

  /** The Sacred Victory clock: one line and a gong at each SACRED_WARNINGS mark. */
  sacredClock() {
    const vs = this.vs;
    if (!vs.sacred) {
      this.sacredMarks = null;
      return;
    }
    const left = vs.sacredLeft();
    const passed = SACRED_WARNINGS.filter((sec) => left <= sec).length;
    if (this.sacredMarks !== null && passed > this.sacredMarks) {
      const when = sacredWhen(SACRED_WARNINGS[passed - 1]);
      const ours = vs.sacred.tm === vs.myTeam;
      const text = ours ? `${SACRED_NAME} in ${when}. Hold the sacred sites!` : `The enemy wins by ${SACRED_NAME} in ${when}! Retake a sacred site.`;
      this.emit({ id: 'sacred', level: 'important', kind: ours ? 'good' : 'alert', icon: SITE_ICON, text, sound: 'gong', volume: 0.7 + 0.15 * passed, attention: text });
    }
    this.sacredMarks = passed;
  }

  /** An ally's things were hit: a softer drum, a ping in the ally's colour, and Space unless an alert of my own is fresher. */
  allyAttacked(ev) {
    const vs = this.vs;
    const t = vs.time;
    if (t - (this.allyAlert.get(ev.player) ?? -Infinity) < ALLY_REPEAT) return;
    this.allyAlert.set(ev.player, t);
    const p = vs.players[ev.player];
    const name = this.playerName(ev.player);
    const where = Number.isFinite(ev.x) && Number.isFinite(ev.y) ? { x: ev.x, y: ev.y } : null;
    this.emit({
      id: 'ally_attacked',
      level: 'important',
      kind: 'alert',
      icon: '🛡️',
      text: `${name} is under attack!`,
      sound: 'drums',
      volume: 0.6,
      ping: where && { ...where, color: safeColor(p && p.color, '#7fd0ff') },
      jump: where && t - this.lastDanger > 15 ? where : null,
      attention: `${name} is under attack!`,
    });
  }

  // ---------------------------------------------------------------- the survey

  onSnapshot() {
    const vs = this.vs;
    const t = vs.time;
    if (this.lastScan !== null && t >= this.lastScan && t - this.lastScan < SCAN_EVERY) return;
    this.lastScan = t;
    if (!this.playing()) return;
    this.scan(t);
  }

  /** What the player's side holds and sees right now, in one pass over the entities. */
  survey() {
    const vs = this.vs;
    const me = vs.myIndex;
    const s = { idle: [], army: 0, armyIdle: 0, buildings: [], hostiles: [], houseSite: false, temples: [], gates: [], busy: false };
    for (const e of vs.entities.values()) {
      if (e.k === 'u') {
        const def = UNITS[e.t];
        if (!def) continue;
        if (e.o === me) {
          if (def.class === 'worker') {
            if (e.st === 'idle' && !e.bo) s.idle.push(e);
          } else if (ARMY_CLASSES.has(def.class)) {
            s.army++;
            if (e.st === 'idle') s.armyIdle++;
          }
        } else if (e.o >= 0 && THREAT_CLASSES.has(def.class) && vs.canHarm(e.o) && vs.isVisibleAt(e.x, e.y)) s.hostiles.push(e);
      } else if (e.k === 'b' && e.o === me) {
        s.buildings.push(e);
        const done = e.bp === undefined || e.bp >= 1;
        if (e.t === 'house' && !done) s.houseSite = true;
        if (done && e.t === 'temple') s.temples.push(e);
        if (done && e.t === 'titan_gate') s.gates.push(e);
      }
    }
    return s;
  }

  scan(t) {
    const vs = this.vs;
    const me = vs.me;
    const s = this.survey();
    if (!this.baselined) {
      // The first look (a match just opened, or joined part-way): count from here, announce nothing already behind us.
      this.baselined = true;
      for (const m of MILESTONES) this.milestones.set(m.key, milestoneStep(m.steps, m.read(me)));
      this.peaceMarks = this.passedMarks();
      this.lastMilestone = t;
      this.nearBase(t, s, true);
      return;
    }
    this.nearBase(t, s, false);
    this.peace(t);
    this.sacredClock();
    this.idle(t, s);
    this.population(t, me, s);
    this.summonable(t, s);
    this.army(t, s);
    this.milestone(t, me);
  }

  /** Hostile units in sight within NEAR_BASE tiles of one of my buildings. */
  nearBase(t, s, quiet) {
    const near = [];
    const r2 = NEAR_BASE * NEAR_BASE;
    let best = null;
    let bestD = Infinity;
    for (const h of s.hostiles) {
      let d = Infinity;
      for (const b of s.buildings) {
        const dd = (h.x - b.x) ** 2 + (h.y - b.y) ** 2;
        if (dd < d) d = dd;
      }
      if (d > r2) continue;
      near.push(h);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    if (!near.length) {
      if (this.clearSince === null) this.clearSince = t;
      else if (t - this.clearSince >= NEAR_CLEAR) this.incursion = false;
      return;
    }
    this.clearSince = null;
    if (this.incursion) return;
    this.incursion = true;
    if (quiet || t - this.lastDanger < COVERED_BY_ATTACK || t - this.lastNear < NEAR_REPEAT) return;
    this.lastNear = t;
    const n = near.length;
    this.emit({
      id: 'enemies_near',
      level: 'important',
      kind: 'alert',
      icon: '🚨',
      text: `${n === 1 ? 'An enemy unit has' : `${n} enemy units have`} been sighted near your base!  [[Space]]`,
      sound: 'drums',
      ping: { x: best.x, y: best.y, color: '#ffae2e' },
      jump: { x: best.x, y: best.y },
      attention: n === 1 ? 'An enemy is near your base!' : 'Enemies are near your base!',
    });
  }

  passedMarks() {
    const left = this.vs.peaceLeft();
    return left > 0 ? PEACE_WARNINGS.filter((sec) => left <= sec).length : null;
  }

  /** The Decade of Peace: a gong at each mark the HUD speaks up at (the HUD writes the line), the tab for the last two. */
  peace() {
    const passed = this.passedMarks();
    if (passed === null) return;
    if (this.peaceMarks !== null && passed > this.peaceMarks) {
      const sec = PEACE_WARNINGS[passed - 1];
      this.emit({
        id: 'peace_mark',
        level: 'important',
        sound: 'gong',
        volume: [0.6, 0.85, 1][Math.min(2, passed - 1)],
        attention: passed >= 2 ? peaceWarning(sec) : null,
      });
    }
    this.peaceMarks = passed;
  }

  /** Worshippers that have stood idle for a while. */
  idle(t, s) {
    const seen = new Set();
    let long = 0;
    for (const w of s.idle) {
      seen.add(w.id);
      if (!this.idleSince.has(w.id)) this.idleSince.set(w.id, t);
      if (t - this.idleSince.get(w.id) >= IDLE_WORKER_AFTER) long++;
    }
    for (const id of this.idleSince.keys()) if (!seen.has(id)) this.idleSince.delete(id);
    if (!this.idleWorkers.tick(long > 0, t)) return;
    this.emit({
      id: 'idle_workers',
      level: 'all',
      kind: 'info',
      icon: '🙏',
      text: `${long} Worshipper${long === 1 ? ' is' : 's are'} idle.  [[.]]`,
      sound: 'nudge',
    });
  }

  /** The population cap, with the means to raise it and no House on the way. */
  population(t, me, s) {
    const capped = me.popCap > 0 && me.pop >= me.popCap && me.popCap < POP_MAX && !s.houseSite;
    if (!this.popCap.tick(capped, t)) return;
    this.emit({ id: 'pop_capped', level: 'all', kind: 'info', icon: '🏠', text: 'Your population limit is reached. Build Houses to grow ([[B]], then [[H]]).', sound: 'nudge' });
  }

  /** A god (or a fallen one to revive) or the Titan the player can pay for now, with the Temple (Titan Gate) idle. */
  summonable(t, s) {
    const vs = this.vs;
    const me = vs.me;
    let god = null;
    if (s.temples.length && !s.temples.some((b) => (b.q || []).length)) {
      const fallen = me.fallen || {};
      const gods = [...godsFor(me.pantheon)].sort((a, b) => Number(Object.hasOwn(fallen, b.id)) - Number(Object.hasOwn(fallen, a.id)));
      for (const g of gods) {
        const c = trainCheck(vs, g.id, s.temples);
        if (c.state === 'ready') {
          god = { name: g.name, icon: g.icon, revive: c.revive !== null };
          break;
        }
      }
    }
    if (this.godReady.tick(!!god, t)) {
      this.emit({
        id: 'god_ready',
        level: 'all',
        kind: 'good',
        icon: god.icon,
        text: god.revive ? `You can revive ${god.name} at your Temple.` : `You can summon ${god.name} at your Temple.`,
        sound: 'nudge',
      });
    }
    const titan = titanFor(me.pantheon);
    const titanOk = !!(titan && s.gates.length && !s.gates.some((b) => (b.q || []).length) && trainCheck(vs, titan.id, s.gates).state === 'ready');
    if (this.titanReady.tick(titanOk, t)) {
      this.emit({ id: 'titan_ready', level: 'all', kind: 'good', icon: titan.icon, text: `You can summon ${titan.name} at your Titan Gate ([[T]]).`, sound: 'nudge' });
    }
  }

  /** An army that has stood about for minutes with no peace to keep. */
  army(t, s) {
    const vs = this.vs;
    const on = t >= ARMY_MIN_TIME && !vs.peaceActive() && s.army >= ARMY_MIN && s.armyIdle >= s.army * ARMY_IDLE_SHARE && !this.incursion;
    if (!this.armyIdle.tick(on, t)) return;
    this.emit({ id: 'army_idle', level: 'all', kind: 'info', icon: '💤', text: 'Your army has been standing idle for a while. Attack ([[A]]), or send scouts.', sound: 'nudge' });
  }

  /** One cheer at a time: the first count to pass a new step, once the last cheer is a while behind. */
  milestone(t, me) {
    if (t - this.lastMilestone < MILESTONE_GAP) return;
    for (const m of MILESTONES) {
      const step = milestoneStep(m.steps, m.read(me));
      const done = this.milestones.get(m.key) || 0;
      if (step <= done) continue;
      this.milestones.set(m.key, step);
      this.lastMilestone = t;
      this.emit({ id: 'milestone', level: 'all', kind: 'good', icon: m.icon, text: m.text(step), sound: 'milestone', volume: 0.8 });
      return;
    }
  }
}
