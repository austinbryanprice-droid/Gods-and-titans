// Rebindable keys (DESIGN 9): the camera keys and, in the Grid layout, the twelve keys of the
// command card by position. Pure data and functions, no DOM, so settings.js can validate a saved
// map and Node tests can drive it.
//
// A key is named the way normKey() names a KeyboardEvent: one character upper-cased ('Q', '=', '-'),
// 'Space', or the browser's own key name ('ArrowUp', 'Home', 'PageDown').
// Settings keep only the changes (`keyBindings`: action id → key); bindingsOf() fills in the defaults.

/** The command card's two layouts: the classic letters of each command (M Move, A Attack…) or keys by position. */
export const CARD_LAYOUTS = ['classic', 'grid'];

// The card is 4 × 3 (command-card.js CARD_SLOTS), slots counted row by row from the top left.
const GRID_DEFAULTS = ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V'];
const ROW_NAMES = ['top', 'middle', 'bottom'];

/** Every rebindable action: { id, group: 'camera' | 'card', label, def }. */
export const KEY_ACTIONS = [
  { id: 'cam_up', group: 'camera', label: 'Move camera up', def: 'ArrowUp' },
  { id: 'cam_down', group: 'camera', label: 'Move camera down', def: 'ArrowDown' },
  { id: 'cam_left', group: 'camera', label: 'Move camera left', def: 'ArrowLeft' },
  { id: 'cam_right', group: 'camera', label: 'Move camera right', def: 'ArrowRight' },
  { id: 'cam_zoom_in', group: 'camera', label: 'Zoom in', def: '=' },
  { id: 'cam_zoom_out', group: 'camera', label: 'Zoom out', def: '-' },
  { id: 'cam_jump', group: 'camera', label: 'Center on selection or the last alert', def: 'Space' },
  { id: 'cam_home', group: 'camera', label: 'Jump to your Town Center', def: 'Home' },
  ...GRID_DEFAULTS.map((def, i) => ({ id: `card_${i}`, group: 'card', label: `Card ${ROW_NAMES[Math.floor(i / 4)]} row, button ${(i % 4) + 1}`, def })),
];
const ACTION = Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a]));

/** The camera's panning actions and the direction each moves the view. */
export const PAN_ACTIONS = { cam_left: [-1, 0], cam_right: [1, 0], cam_up: [0, -1], cam_down: [0, 1] };

// Keys that keep their fixed jobs and cannot be bound: menus, chat, selection (idle '.' and ','), groups, gods, delete,
// modifiers, and the browser's own (F5, F11, F12).
const RESERVED = new Set([
  'Escape', 'F10', 'Enter', 'Tab', 'Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'ContextMenu', 'OS',
  'Delete', 'Backspace', 'Pause', '.', ',', '`', 'Dead', 'Unidentified', 'Process',
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  ...'0123456789',
]);

/** The name of a KeyboardEvent's key (see the top of this file), or '' for none. */
export function normKey(e) {
  const k = e && typeof e.key === 'string' ? e.key : '';
  if (k === ' ' || k === 'Spacebar') return 'Space';
  return k.length === 1 ? k.toUpperCase() : k;
}

/** Whether `key` may be bound to an action. */
export function isBindableKey(key) {
  if (typeof key !== 'string' || !key || key.length > 20 || RESERVED.has(key)) return false;
  if ([...key].length === 1) return key.trim() !== '' && key === key.toUpperCase();
  return /^[A-Z][A-Za-z0-9]+$/.test(key); // a named key: 'ArrowUp', 'Space', 'PageDown', 'Insert'
}

/**
 * A saved map cleaned: known actions and bindable keys only, defaults left out, and no key doing two
 * things (a hand-edited save: every changed action on a shared key goes back to its default, which
 * are all different).
 */
export function cleanBindings(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const full = {};
  for (const a of KEY_ACTIONS) full[a.id] = isBindableKey(raw[a.id]) ? raw[a.id] : a.def;
  for (let pass = 0; pass < KEY_ACTIONS.length; pass++) {
    const count = new Map();
    for (const a of KEY_ACTIONS) count.set(full[a.id], (count.get(full[a.id]) || 0) + 1);
    const clash = KEY_ACTIONS.filter((a) => count.get(full[a.id]) > 1 && full[a.id] !== a.def);
    if (!clash.length) break;
    for (const a of clash) full[a.id] = a.def;
  }
  const out = {};
  for (const a of KEY_ACTIONS) if (full[a.id] !== a.def) out[a.id] = full[a.id];
  return out;
}

/** Every action's key: the defaults with the saved changes over them. */
export function bindingsOf(changes) {
  const out = {};
  for (const a of KEY_ACTIONS) out[a.id] = (changes && isBindableKey(changes[a.id]) && changes[a.id]) || a.def;
  return out;
}

/**
 * Bind `key` to `action`. When another action had that key, the two swap, so no action is left
 * without a key and no key does two things. Returns the new saved map (only the changes), or
 * null when the key cannot be bound.
 */
export function rebind(changes, action, key) {
  if (!ACTION[action] || !isBindableKey(key)) return null;
  const full = bindingsOf(changes);
  const had = full[action];
  for (const a of KEY_ACTIONS) if (a.id !== action && full[a.id] === key) full[a.id] = had;
  full[action] = key;
  const out = {};
  for (const a of KEY_ACTIONS) if (full[a.id] !== a.def) out[a.id] = full[a.id];
  return out;
}

/** The action of `key` among `group`'s actions ('camera' or 'card'), or null. */
export function actionOf(bindings, key, group) {
  if (!key) return null;
  for (const a of KEY_ACTIONS) if (a.group === group && bindings[a.id] === key) return a.id;
  return null;
}

/** The Grid layout's keys, slot by slot. */
export function gridKeys(bindings) {
  return GRID_DEFAULTS.map((_, i) => bindings[`card_${i}`]);
}

const LABELS = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', PageUp: 'PgUp', PageDown: 'PgDn', Insert: 'Ins' };

/** How a key is written on a button or a hint. */
export function keyLabel(key) {
  return LABELS[key] || key || '';
}

/**
 * The classic command letters a camera key takes away (the camera is checked first): a letter bound
 * to the camera in the Classic layout stops reaching the commands that use it.
 */
export function cameraLetterClashes(bindings) {
  return KEY_ACTIONS.filter((a) => a.group === 'camera' && /^[A-Z]$/.test(bindings[a.id])).map((a) => ({ action: a.id, key: bindings[a.id] }));
}

/** The Grid keys the command card shows under these settings, or null for the Classic letters. */
export function cardKeysOf(settings) {
  return settings && settings.cardKeys === 'grid' ? gridKeys(bindingsOf(settings.keyBindings)) : null;
}
