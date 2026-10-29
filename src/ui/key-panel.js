// The key rebinding panel (DESIGN 9), shown in the title screen's Settings and from the F10 menu:
// the camera's keys, the command card's twelve Grid keys laid out as the card is, and a reset.
// Click a key, press the new one; Esc takes the click back. A key another action had moves to that
// action in exchange (key-bindings.js rebind), so nothing is ever left without a key.
import { el } from './hud-dom.js';
import { getSettings, saveSettings, onSettingsChange } from '../settings.js';
import { KEY_ACTIONS, bindingsOf, rebind, normKey, isBindableKey, keyLabel, cameraLetterClashes } from './key-bindings.js';

const CAMERA = KEY_ACTIONS.filter((a) => a.group === 'camera');
const CARD = KEY_ACTIONS.filter((a) => a.group === 'card');

/** What a refused key is for, said when someone tries to bind it. */
function refusedText(key) {
  if (key === 'Escape') return 'Esc cancels; it keeps that job.';
  if (/^[0-9]$/.test(key)) return 'The number keys select control groups.';
  if (/^F[0-9]+$/.test(key)) return `${key} keeps its job (gods, the menu, or the browser's own).`;
  if (key === 'Delete' || key === 'Backspace') return 'Delete and Backspace destroy the selected units.';
  if (key === 'Enter') return 'Enter opens the chat (Shift+Enter: to your allies).';
  if (key === 'Tab') return 'Tab cycles through the selected unit types.';
  if (key === 'Pause') return 'Pause pauses the game.';
  if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(key)) return 'Shift, Ctrl and Alt work with other keys.';
  return `${keyLabel(key) || 'That key'} cannot be used here.`;
}

/**
 * Build the panel. `win` is where key presses are listened for while waiting for a key (window, or a
 * test's stand-in). Returns { el, dispose }.
 */
export function buildKeyPanel({ win = typeof window !== 'undefined' ? window : null } = {}) {
  let waiting = null; // the action waiting for its new key
  let note = '';
  const root = el('div', 'mw-keys');
  const buttons = new Map(); // action id → button

  const keyButton = (a) => {
    const b = el('button', 'mw-key-btn');
    b.type = 'button';
    b.dataset.action = a.id;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      waiting = waiting === a.id ? null : a.id;
      note = waiting ? `Press the new key for “${a.label}”. Esc to keep the old one.` : '';
      render();
    });
    buttons.set(a.id, b);
    return b;
  };

  const camRows = CAMERA.map((a) => el('div', 'mw-key-row', el('span', 'mw-key-name', a.label), keyButton(a)));
  const grid = el('div', 'mw-key-grid', ...CARD.map((a) => {
    const b = keyButton(a);
    b.title = a.label;
    b.setAttribute('aria-label', a.label);
    return b;
  }));
  const noteEl = el('p', 'mw-field-note mw-key-note');
  noteEl.setAttribute('aria-live', 'polite');
  const reset = el('button', 'mw-btn mw-btn--small mw-btn--ghost mw-key-reset', 'Reset keys to defaults');
  reset.type = 'button';
  reset.addEventListener('click', (e) => {
    e.stopPropagation();
    waiting = null;
    saveSettings({ keyBindings: {} });
    note = 'All keys are back to their defaults.';
    render();
  });
  const gridNote = el('p', 'mw-field-note');

  root.append(
    el('div', 'mw-key-head', 'Camera'),
    ...camRows,
    el('div', 'mw-key-head', 'Command card (Grid layout)'),
    gridNote,
    grid,
    noteEl,
    reset,
  );

  function render() {
    const s = getSettings();
    const binds = bindingsOf(s.keyBindings);
    for (const [id, b] of buttons) {
      const isWaiting = waiting === id;
      b.textContent = isWaiting ? '…' : keyLabel(binds[id]);
      b.classList.toggle('is-waiting', isWaiting);
      b.setAttribute('aria-pressed', isWaiting ? 'true' : 'false');
    }
    gridNote.textContent = s.cardKeys === 'grid'
      ? 'Each key presses the button in that place on the card, whatever the selection.'
      : 'Used when Command keys is set to Grid. The Classic layout keeps each command\'s own letter (M Move, A Attack…).';
    let text = note;
    if (!text && s.cardKeys !== 'grid') {
      const clash = cameraLetterClashes(binds);
      if (clash.length) text = `${clash.map((c) => keyLabel(c.key)).join(', ')} now move${clash.length === 1 ? 's' : ''} the camera, so ${clash.length === 1 ? 'that command letter no longer works' : 'those command letters no longer work'} on the card. The Grid layout avoids this.`;
    }
    noteEl.textContent = text;
    reset.disabled = Object.keys(s.keyBindings || {}).length === 0;
  }

  const onKey = (e) => {
    if (!waiting) return;
    // this panel has the key: neither the game's keys nor the menu's Esc see it
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    if (e.repeat) return;
    const key = normKey(e);
    if (key === 'Escape') {
      waiting = null;
      note = '';
    } else if (!isBindableKey(key)) {
      note = refusedText(key);
    } else {
      const action = waiting;
      const before = bindingsOf(getSettings().keyBindings);
      const next = rebind(getSettings().keyBindings, action, key);
      waiting = null;
      if (next) {
        const swapped = KEY_ACTIONS.find((a) => a.id !== action && before[a.id] === key);
        saveSettings({ keyBindings: next });
        const label = KEY_ACTIONS.find((a) => a.id === action).label;
        note = swapped
          ? `${keyLabel(key)}: ${label}. “${swapped.label}” takes ${keyLabel(before[action])} in exchange.`
          : `${keyLabel(key)}: ${label}.`;
      }
    }
    render();
  };
  if (win) win.addEventListener('keydown', onKey, true);
  const off = onSettingsChange((s, changed) => {
    if (changed.includes('keyBindings') || changed.includes('cardKeys')) render();
  });
  render();

  return {
    el: root,
    /** Whether a key button is waiting for its key (the menu's Esc must not close the panel then). */
    get waiting() {
      return waiting;
    },
    dispose() {
      if (win) win.removeEventListener('keydown', onKey, true);
      off();
    },
  };
}
