// Entry point: boots settings and audio, shows the menu, and hands a started
// lobby to the game (DESIGN 11). Provisional: the integration engineer
// replaces the placeholder in startGame() with HostSession / ClientSession + Game.
import { getSettings, onSettingsChange } from './settings.js';
import { sfx } from './audio/sfx.js';
import { createMenu, showMenu, hideMenu } from './ui/menu.js';

export { showMenu, hideMenu };

let placeholder = null;

/**
 * Called by the menu when a lobby starts.
 * @param {{ role: 'host'|'client', setup: object, myIndex: number, conns?: Map<number, object>, conn?: object, lobby: object }} launch
 */
export function startGame(launch) {
  globalThis.__mythicwarLaunch = launch; // debug / test hook
  hideMenu();
  if (!placeholder) {
    placeholder = document.createElement('div');
    placeholder.className = 'mw-root mw-placeholder';
    document.getElementById('app').appendChild(placeholder);
  }
  const players = launch.setup.players.map((p) => `${p.name} (${p.pantheon}, team ${p.team})`).join(' · ');
  placeholder.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'mw-panel mw-placeholder-box';
  const title = document.createElement('h2');
  title.className = 'mw-h2';
  title.textContent = 'Game starting…';
  const note = document.createElement('p');
  note.textContent = '(game view not wired yet)';
  const info = document.createElement('p');
  info.className = 'mw-hint';
  info.textContent = `${launch.role === 'host' ? 'Hosting' : 'Joined'} · seed ${launch.setup.seed} · ${launch.setup.mapSize} map · ${players}`;
  const back = document.createElement('button');
  back.className = 'mw-btn';
  back.type = 'button';
  back.textContent = 'Back to Menu';
  back.addEventListener('click', () => {
    placeholder.hidden = true;
    showMenu('title');
  });
  box.append(title, note, info, back);
  placeholder.appendChild(box);
  placeholder.hidden = false;
}

function boot() {
  const settings = getSettings();
  sfx.init({ volume: settings.volume });
  sfx.setVolume(settings.volume);
  onSettingsChange((s, changed) => {
    if (changed.includes('volume')) sfx.setVolume(s.volume);
  });
  createMenu({ root: document.getElementById('menu-root'), onStart: startGame });
  const msg = document.getElementById('boot-message');
  if (msg) msg.remove();
}

try {
  boot();
} catch (err) {
  console.error('[main] boot failed', err);
  const msg = document.getElementById('boot-message');
  if (msg) msg.textContent = `Failed to start: ${err && err.message ? err.message : err}`;
}
