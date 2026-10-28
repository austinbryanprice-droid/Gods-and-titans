// The Career screen's replays (DESIGN 9.4): the matches kept on this device, newest first, each with
// Watch, Save (a file to keep or send, for a friend or a bug report) and Delete, and a button to open
// a replay file. The list fills in once storage answers (IndexedDB is asynchronous).
import { h, setChildren } from './menu-dom.js';
import { pantheonEmblem } from './menu-pantheons.js';
import { listReplays, deleteReplay, replayBytes, unpackReplay } from '../game/replay-store.js';
import { resultLabel, sidesLabel, fromOtherBuild } from '../game/replay.js';
import { TICK_RATE } from '../config.js';

const RESULT_ICONS = { victory: '🏆', defeat: '💀', draw: '⚖️', survival: '🐉' };
const MAX_FILE_BYTES = 40 * 1024 * 1024;

/** "28 Oct, 15:42" in the player's own locale. */
export function replayDate(ms) {
  try {
    return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** m:ss (h:mm:ss past an hour) of a replay's length. */
export function replayLength(ticks) {
  const s = Math.floor((ticks || 0) / TICK_RATE);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

/** A file name for a saved replay: gods-and-titans-2026-10-28-1542-greek-vs-norse.mwreplay */
export function replayFileName(meta) {
  const d = new Date(meta.date || 0);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}` : 'replay';
  const sides = (meta.players || []).map((p) => p.pantheon).join('-vs-').replace(/[^a-z_-]/gi, '').slice(0, 80);
  return `gods-and-titans-${stamp}${sides ? `-${sides}` : ''}.mwreplay`;
}

function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * The replays section: a list that fills itself, and the open-file button.
 * @param {object} o
 * @param {(what: string|object) => void} o.onWatch watch a kept replay (its id) or one read from a file (its record)
 * @param {(text: string) => void} [o.toast]
 */
export function renderReplays({ onWatch, toast = () => {} }) {
  const list = h('ol.mw-rp-list', h('li.mw-hint', 'Looking for replays…'));
  const fileInput = h('input', { type: 'file', accept: '.mwreplay,.json,application/octet-stream,application/json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      toast('That file is too big to be a replay.');
      return;
    }
    const rec = await unpackReplay(new Uint8Array(await f.arrayBuffer()));
    if (!rec) toast('That file is not a replay this game can read.');
    else onWatch(rec);
  });
  const openBtn = h('button.mw-btn.mw-btn--small.mw-btn--ghost', { type: 'button', onclick: () => fileInput.click() }, 'Open a replay file…');

  const row = (m) => {
    const icon = RESULT_ICONS[m.result] || '🚪';
    const old = fromOtherBuild(m);
    const watch = h('button.mw-btn.mw-btn--small.mw-btn--primary', { type: 'button', onclick: () => onWatch(m.id) }, 'Watch');
    const save = h('button.mw-btn.mw-btn--small.mw-btn--ghost', {
      type: 'button',
      title: 'Save this replay as a file (to keep it, or to send it)',
      onclick: async () => {
        const bytes = await replayBytes(m.id);
        if (bytes) download(bytes, replayFileName(m));
        else toast('That replay is gone.');
      },
    }, 'Save');
    const del = h('button.mw-btn.mw-btn--small.mw-btn--ghost.is-danger', {
      type: 'button',
      title: 'Delete this replay',
      onclick: async () => {
        await deleteReplay(m.id);
        refresh();
      },
    }, 'Delete');
    const who = (m.players || []).map((p) => `${pantheonEmblem(p.pantheon)} ${p.name}`).join(' · ');
    return h('li.mw-rp', { class: `is-${m.result || 'left'}` },
      h('span.mw-rp-icon', { 'aria-hidden': 'true' }, icon),
      h('span.mw-rp-main',
        h('span.mw-rp-title', `${sidesLabel(m)}`, h('span.mw-rp-result', ` · ${resultLabel(m)}`)),
        h('span.mw-rp-sub', `${replayDate(m.date)} · ${m.mode} · ${replayLength(m.ticks)}${old ? ' · an earlier version of the game' : ''}`),
        h('span.mw-rp-who', who)),
      h('span.mw-rp-btns', watch, save, del));
  };

  async function refresh() {
    const rows = await listReplays();
    if (!rows.length) setChildren(list, h('li.mw-hint', 'No replays yet. Every game you host or play against the computer is kept here once it has run for half a minute, the newest 12 of them.'));
    else setChildren(list, ...rows.map(row));
  }
  refresh();

  return h('div.mw-rp-section', list, h('div.mw-rp-foot', openBtn, fileInput,
    h('span.mw-hint', 'Replays are kept in this browser on this device.')));
}
