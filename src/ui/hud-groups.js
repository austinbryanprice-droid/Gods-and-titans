// The control-group bar (DESIGN 9, "Control groups"): one chip per saved group (Ctrl+1 to 9) in a
// row over the selection panel, as in StarCraft II: the group's digit, the icon of its leading
// unit type (gods first, as in the selection's subgroups), and how many are left in it. A chip
// turns red while the group fights (a member attacks or casts, or has lost health in the last
// FIGHT_MS), and lights up while the group is what is selected. Clicking a chip selects the group,
// as its digit does; a second click soon after brings the camera there, as a double tap does.
// Dead members drop out of a group (Selection.groupIds), and an emptied group's chip goes away.
import { subgroups, iconOf, typeName } from './hud-data.js';
import { el, setText, setClass, setHidden } from './hud-dom.js';

export const GROUPS_REFRESH_MS = 200;
export const FIGHT_MS = 3000; // a group stays "fighting" this long after a member was hurt

/**
 * The chips to draw: [{ n, count, type, icon, name, fighting, active }] for each non-empty group.
 * `hurt` maps a member id to the time it was last seen losing health (kept up to date here).
 * @param {object} sel Selection (groups, groupIds, ids)
 * @param {object} vs ViewState
 * @param {Map<number, {hp: number, t: number}>} seen last health of each member, and when it last fell
 * @param {number} now ms
 */
export function groupChips(sel, vs, seen, now) {
  const out = [];
  const live = new Set();
  const selected = new Set(sel.ids);
  for (let n = 1; n <= 9; n++) {
    if (!sel.groups.has(n)) continue;
    const ids = sel.groupIds(n);
    if (!ids.length) continue;
    const lead = subgroups(ids, vs)[0];
    const e = lead ? vs.entities.get(lead.ids[0]) : null;
    let fighting = false;
    for (const id of ids) {
      const m = vs.entities.get(id);
      if (!m) continue;
      live.add(id);
      const was = seen.get(id);
      let t = was ? was.t : -Infinity;
      if (was && m.hp < was.hp) t = now;
      seen.set(id, { hp: m.hp, t });
      if (m.st === 'attack' || m.st === 'cast' || now - t < FIGHT_MS) fighting = true;
    }
    out.push({
      n,
      count: ids.length,
      type: lead ? lead.type : null,
      icon: e ? iconOf(e, vs) : '❔',
      name: lead ? typeName(lead.type) : '',
      fighting,
      active: ids.length === selected.size && ids.every((id) => selected.has(id)),
    });
  }
  for (const id of seen.keys()) if (!live.has(id)) seen.delete(id);
  return out;
}

/** The tooltip of a chip. */
export function chipTitle(c) {
  const what = c.count === 1 ? c.name : `${c.count} units, led by ${c.name}`;
  return `Group ${c.n}: ${what}${c.fighting ? ' (fighting)' : ''}\nClick or press ${c.n} to select it; twice to jump there.`;
}

export class GroupBar {
  /**
   * @param {object} o
   * @param {object} o.selection
   * @param {object} o.viewState
   * @param {(n: number) => void} o.onPick a chip was clicked
   */
  constructor({ selection, viewState, onPick }) {
    this.sel = selection;
    this.vs = viewState;
    this.onPick = onPick;
    this.seen = new Map();
    this.chips = new Map(); // n → { b, icon, count }
    this.last = -Infinity;
    this.root = el('div', 'hud-groups');
    this.root.hidden = true;
  }

  update(now = performance.now(), force = false) {
    if (!force && now - this.last < GROUPS_REFRESH_MS) return;
    this.last = now;
    const chips = groupChips(this.sel, this.vs, this.seen, now);
    setHidden(this.root, !chips.length);
    const keep = new Set(chips.map((c) => c.n));
    for (const [n, c] of this.chips) {
      if (keep.has(n)) continue;
      c.b.remove();
      this.chips.delete(n);
    }
    let added = false;
    for (const c of chips) {
      let v = this.chips.get(c.n);
      if (!v) {
        v = this.chip(c.n);
        this.chips.set(c.n, v);
        added = true;
      }
      setText(v.icon, c.icon);
      setText(v.count, String(c.count));
      setClass(v.b, 'is-fighting', c.fighting);
      setClass(v.b, 'is-active', c.active);
      const title = chipTitle(c);
      if (v.b.title !== title) v.b.title = title;
    }
    // A new group's chip takes its place in digit order (chips come in that order).
    if (added) for (const c of chips) this.root.appendChild(this.chips.get(c.n).b);
  }

  chip(n) {
    const icon = el('span', 'hud-group-icon');
    const count = el('b', 'hud-group-n');
    const b = el('button', 'hud-group', el('kbd', 'hud-group-key', String(n)), icon, count);
    b.type = 'button';
    b.tabIndex = -1;
    b.dataset.group = String(n);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      if (this.onPick) this.onPick(n);
      this.update(performance.now(), true);
    });
    return { b, icon, count };
  }
}
