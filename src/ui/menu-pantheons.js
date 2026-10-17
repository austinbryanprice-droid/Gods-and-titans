// Pantheon picker: a modal grid of the ten pantheons plus Random. Each card
// shows the culture, description, the four gods, the titan and the creatures,
// all read from the data registry.
import { h } from './menu-dom.js';
import { PANTHEON_LIST } from '../data/index.js';
import { pantheonSummary, PANTHEON_EMBLEMS } from './menu-model.js';
import { sfx } from '../audio/sfx.js';

let summaries = null;
function allSummaries() {
  if (!summaries) summaries = PANTHEON_LIST.map(pantheonSummary);
  return summaries;
}

/** Summary of one pantheon id (or null). */
export function summaryFor(id) {
  return allSummaries().find((s) => s.id === id) || null;
}

/** Display name for a pantheon id, including 'random'. */
export function pantheonLabel(id) {
  if (id === 'random') return 'Random';
  return summaryFor(id)?.name || id;
}

/** Emblem for a pantheon id, including 'random'. */
export function pantheonEmblem(id) {
  return PANTHEON_EMBLEMS[id] || summaryFor(id)?.emblem || '✦';
}

const tierLabel = (t) => ['', 'Village', 'Town', 'City'][t] || '';

/** One god / titan row: icon, name · title, and (for gods) a one-line description. */
export function unitRow(u, kind) {
  return h('li.mw-unit', { title: `${u.name}${u.title ? ` — ${u.title}` : ''}\n${u.description}` },
    h('span.mw-unit-icon', { 'aria-hidden': 'true' }, u.icon),
    h('span.mw-unit-text',
      h('span.mw-unit-name', u.name, u.title ? h('span.mw-unit-title', ` · ${u.title}`) : null),
      kind === 'god' ? h('span.mw-unit-line', u.line) : null,
    ),
  );
}

function card(s, selected, onPick) {
  const c = s.colors;
  const el = h('button.mw-pcard', {
    type: 'button',
    class: selected ? 'is-selected' : '',
    dataset: { pantheon: s.id },
    style: { '--p-accent': c.accent || '#d4af37', '--p-head-a': s.head[0], '--p-head-b': s.head[1] },
    onclick: () => onPick(s.id),
    'aria-pressed': selected ? 'true' : 'false',
  },
  h('div.mw-pcard-head',
    h('span.mw-pcard-emblem', { 'aria-hidden': 'true' }, s.emblem),
    h('span.mw-pcard-titles',
      h('span.mw-pcard-name', s.name),
      h('span.mw-pcard-culture', s.culture),
    ),
    selected ? h('span.mw-pcard-check', '✓ Chosen') : null,
  ),
  h('p.mw-pcard-desc', s.description),
  h('div.mw-pcard-label', 'Gods'),
  h('ul.mw-pcard-gods', s.gods.map((g) => unitRow(g, 'god'))),
  h('div.mw-pcard-label', 'Titan'),
  h('ul.mw-pcard-gods', s.titan ? unitRow(s.titan, 'god') : null),
  h('div.mw-pcard-label', 'Creatures'),
  h('ul.mw-pcard-creatures', s.creatures.map((u) => h('li.mw-chip', { title: `${u.name} (tier ${u.tier}, ${tierLabel(u.tier)}${u.air ? ', flying' : ''})\n${u.description}` },
    h('span', { 'aria-hidden': 'true' }, u.icon), ` ${u.name}`, u.air ? h('span.mw-air', { title: 'Flying' }, '✈') : null))),
  );
  return el;
}

function randomCard(selected, onPick) {
  const icons = allSummaries().map((s) => s.emblem).join(' ');
  return h('button.mw-pcard.mw-pcard--random', {
    type: 'button',
    class: selected ? 'is-selected' : '',
    dataset: { pantheon: 'random' },
    onclick: () => onPick('random'),
    'aria-pressed': selected ? 'true' : 'false',
  },
  h('div.mw-pcard-head',
    h('span.mw-pcard-emblem', { 'aria-hidden': 'true' }, PANTHEON_EMBLEMS.random),
    h('span.mw-pcard-titles',
      h('span.mw-pcard-name', 'Random'),
      h('span.mw-pcard-culture', 'Let the Fates decide'),
    ),
    selected ? h('span.mw-pcard-check', '✓ Chosen') : null,
  ),
  h('p.mw-pcard-desc', 'A pantheon is drawn by lot when the battle begins. Nobody, not even you, knows which gods will answer your prayers until the first shrine is raised.'),
  h('div.mw-random-icons', { 'aria-hidden': 'true' }, icons),
  );
}

/**
 * Open the picker over `host`.
 * @param {{ host: HTMLElement, current: string, title?: string, onChoose: (id: string) => void }} opts
 * @returns {{ close(): void, el: HTMLElement }}
 */
export function openPantheonPicker({ host, current, title = 'Choose your pantheon', onChoose }) {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    overlay.classList.add('is-leaving');
    setTimeout(() => overlay.remove(), 160);
  };
  const pick = (id) => {
    sfx.play('select');
    onChoose(id);
    close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  };
  const grid = h('div.mw-pgrid',
    allSummaries().map((s) => card(s, s.id === current, pick)),
    randomCard(current === 'random', pick),
  );
  const dialog = h('div.mw-modal.mw-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.mw-modal-head',
      h('h2.mw-h2', title),
      h('p.mw-modal-sub', 'Ten mythologies, each with four gods, a titan and three mythical creatures. Hover a god for its full story.'),
      h('button.mw-icon-btn.mw-modal-close', { type: 'button', title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => {
        sfx.play('click');
        close();
      } }, '✕'),
    ),
    h('div.mw-modal-body', grid),
  );
  const overlay = h('div.mw-overlay', { onclick: (e) => {
    if (e.target === overlay) close();
  } }, dialog);
  host.appendChild(overlay);
  document.addEventListener('keydown', onKey, true);
  const sel = grid.querySelector('.is-selected');
  requestAnimationFrame(() => {
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
    (sel || grid.firstElementChild)?.focus({ preventScroll: true });
  });
  return { close, el: overlay };
}
