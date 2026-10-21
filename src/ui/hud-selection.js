// Selection state for the local player: the selected entity ids (WC3 rules:
// up to 24 own units / buildings, or a single foreign entity for info), the
// active subgroup (Tab), and control groups 1–9. A selection of nothing but
// wall segments may be longer (a wall is dozens of one-tile pieces). Pure
// logic over a ViewState.
import { MAX_WALL_SELECTION } from '../config.js';
import { subgroups, subgroupRank, isWallEntity } from './hud-data.js';

export const MAX_SELECTION = 24;

/** How many of these (own) entities one selection may hold. */
export function selectionLimit(entities) {
  return entities.length && entities.every(isWallEntity) ? MAX_WALL_SELECTION : MAX_SELECTION;
}

export class Selection {
  /** @param {object} vs ViewState */
  constructor(vs) {
    this.vs = vs;
    this.ids = [];
    this.activeType = null;
    this.groups = new Map(); // digit → ids
    this.version = 0;
    this.listeners = new Set();
  }

  /** cb(selection) after every change. Returns an unsubscribe function. */
  onChange(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  changed() {
    this.version++;
    for (const cb of [...this.listeners]) {
      try {
        cb(this);
      } catch (err) {
        console.error('[hud] selection listener failed', err);
      }
    }
  }

  get size() {
    return this.ids.length;
  }

  has(id) {
    return this.ids.includes(id);
  }

  /** View entities of the selection as I know them (a fogged enemy building is its remembered copy), in order. */
  entities() {
    const out = [];
    for (const id of this.ids) {
      const e = this.vs.knownEntity(id);
      if (e) out.push(e);
    }
    return out;
  }

  /** First entity (the portrait / info target). */
  primary() {
    const g = this.activeGroup();
    const id = g ? g.ids[0] : this.ids[0];
    return id !== undefined ? this.vs.knownEntity(id) : null;
  }

  /** True if the selection holds the local player's own things. */
  isOwn() {
    const e = this.vs.entities.get(this.ids[0]);
    return !!e && e.o === this.vs.myIndex;
  }

  /** Own unit ids in the selection. */
  ownUnitIds() {
    const out = [];
    for (const id of this.ids) {
      const e = this.vs.entities.get(id);
      if (e && e.k === 'u' && e.o === this.vs.myIndex) out.push(id);
    }
    return out;
  }

  /** Own building view entities in the selection. */
  ownBuildings() {
    const out = [];
    for (const id of this.ids) {
      const e = this.vs.entities.get(id);
      if (e && e.k === 'b' && e.o === this.vs.myIndex) out.push(e);
    }
    return out;
  }

  /** Subgroups [{ type, kind, ids }] in display order. */
  subgroups() {
    return subgroups(this.ids, this.vs);
  }

  activeGroup() {
    const groups = this.subgroups();
    return groups.find((g) => g.type === this.activeType) || groups[0] || null;
  }

  /** The object getCommandCard expects. */
  forCard() {
    const g = this.activeGroup();
    return { ids: this.ids, activeType: g ? g.type : null };
  }

  sortIds(ids) {
    const vs = this.vs;
    const rank = (id) => {
      const e = vs.entities.get(id);
      if (!e) return [99, '', id];
      return [e.k === 'u' ? subgroupRank(e.t) : 30, e.t, id];
    };
    return [...ids].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra[0] - rb[0] || (ra[1] < rb[1] ? -1 : ra[1] > rb[1] ? 1 : 0) || ra[2] - rb[2];
    });
  }

  /** May this entity join a multi-selection (own unit or own building)? */
  selectableOwn(e) {
    return !!e && e.o === this.vs.myIndex && (e.k === 'u' || e.k === 'b');
  }

  /**
   * Replace the selection. Foreign entities (enemy, ally, neutral, mines) can
   * only be selected alone; own entities are capped at MAX_SELECTION.
   */
  set(ids, { activeType = null } = {}) {
    const vs = this.vs;
    const list = [];
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const e = vs.knownEntity(id);
      if (e) list.push(e);
    }
    let next;
    const own = list.filter((e) => this.selectableOwn(e));
    if (own.length) next = this.sortIds(own.map((e) => e.id)).slice(0, selectionLimit(own));
    else next = list.length ? [list[0].id] : [];
    const same = next.length === this.ids.length && next.every((id, i) => id === this.ids[i]);
    const prevActive = this.activeType;
    this.ids = next;
    const groups = this.subgroups();
    if (activeType && groups.some((g) => g.type === activeType)) this.activeType = activeType;
    else this.activeType = groups[0] ? groups[0].type : null;
    if (!same || prevActive !== this.activeType) this.changed();
  }

  clear() {
    if (!this.ids.length) return;
    this.ids = [];
    this.activeType = null;
    this.changed();
  }

  /** Add own entities (shift-click / shift-drag). */
  add(ids) {
    if (!this.isOwn() && this.ids.length) return this.set(ids);
    this.set([...this.ids, ...ids], { activeType: this.activeType });
  }

  remove(ids) {
    const drop = new Set(ids);
    const next = this.ids.filter((id) => !drop.has(id));
    if (next.length === this.ids.length) return;
    this.set(next, { activeType: this.activeType });
  }

  /** Shift-click: add if missing, remove if present. */
  toggle(id) {
    if (this.has(id)) this.remove([id]);
    else this.add([id]);
  }

  /** Tab: next subgroup. */
  cycleSubgroup(dir = 1) {
    const groups = this.subgroups();
    if (groups.length < 2) return false;
    const i = Math.max(0, groups.findIndex((g) => g.type === this.activeType));
    this.activeType = groups[(i + dir + groups.length) % groups.length].type;
    this.changed();
    return true;
  }

  setActiveType(type) {
    if (this.activeType === type) return;
    this.activeType = type;
    this.changed();
  }

  /**
   * Drop entities that died, changed owner, or (foreign ones) went into the fog.
   * Remembered enemy buildings stay selected until seen gone, even when they
   * were destroyed in the fog. Cheap enough to call every frame.
   */
  prune() {
    if (!this.ids.length) return;
    const vs = this.vs;
    let keep = null;
    for (let i = 0; i < this.ids.length; i++) {
      const ok = !!vs.knownEntity(this.ids[i]);
      if (!ok && !keep) keep = this.ids.slice(0, i);
      else if (ok && keep) keep.push(this.ids[i]);
    }
    if (keep) {
      this.ids = keep;
      const groups = this.subgroups();
      if (!groups.some((g) => g.type === this.activeType)) this.activeType = groups[0] ? groups[0].type : null;
      this.changed();
    }
  }

  // ---------------------------------------------------------------- groups

  /** Ctrl+digit: save the current own selection as group n. */
  saveGroup(n) {
    const own = this.ids.filter((id) => {
      const e = this.vs.entities.get(id);
      return e && e.o === this.vs.myIndex;
    });
    if (!own.length) return false;
    this.groups.set(n, own);
    return true;
  }

  /** Shift+digit: add the current own selection to group n. */
  addToGroup(n) {
    const prev = this.groupIds(n);
    const own = this.ids.filter((id) => {
      const e = this.vs.entities.get(id);
      return e && e.o === this.vs.myIndex;
    });
    const all = this.sortIds([...new Set([...prev, ...own])]);
    const merged = all.slice(0, selectionLimit(all.map((id) => this.vs.entities.get(id))));
    if (!merged.length) return false;
    this.groups.set(n, merged);
    return true;
  }

  /** Living ids of group n (dead members are dropped from the group). */
  groupIds(n) {
    const ids = this.groups.get(n) || [];
    const alive = ids.filter((id) => {
      const e = this.vs.entities.get(id);
      return e && e.o === this.vs.myIndex;
    });
    if (alive.length !== ids.length) {
      if (alive.length) this.groups.set(n, alive);
      else this.groups.delete(n);
    }
    return alive;
  }

  /** Digit: select group n. Returns false when the group is empty. */
  recallGroup(n) {
    const ids = this.groupIds(n);
    if (!ids.length) return false;
    this.set(ids);
    return true;
  }
}
