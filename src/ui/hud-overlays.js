// Full-screen HUD overlays: "Waiting for the host…", the in-game menu (F10:
// resume, options, surrender, quit), the confirm dialog, the defeat / victory
// screen with the per-player statistics table, the achievements the match unlocked and a
// line on the player's career, and "the host has left".
import { getSettings, saveSettings } from '../settings.js';
import { sfx } from '../audio/sfx.js';
import { PANTHEONS } from '../data/index.js';
import { sanitizeName, sanitizeReason } from '../net/protocol.js';
import { el, fmt, safeColor } from './hud-dom.js';
import { formatClock } from './hud-data.js';
import { TIME_OF_DAY_OPTIONS } from './time-of-day-options.js';
import { ALERT_OPTIONS, TAB_ALERT_OPTIONS, tabAlertNote } from './alert-options.js';
import { chooseTabAlerts, notificationState } from './tab-attention.js';
import { getCareer, careerSummary } from '../game/career.js';
import { MEDALS } from '../data/medals.js';

const END_TEXT = {
  'host-left': 'The connection to the host was lost.',
  'host-quit': 'The host has closed the game.',
  'game-over': 'The host has closed the game.',
};

function btn(text, cls, onClick) {
  const b = el('button', `mw-btn hud-obtn ${cls || ''}`, text);
  b.type = 'button';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    sfx.play('click');
    onClick(e);
  });
  return b;
}

function toggleRow(label, hint, value, onChange) {
  const input = el('input', 'hud-toggle-input');
  input.type = 'checkbox';
  input.checked = !!value;
  input.addEventListener('change', () => onChange(input.checked));
  const row = el('label', 'hud-toggle', input, el('span', 'hud-toggle-track', el('i', 'hud-toggle-knob')), el('span', 'hud-toggle-text', el('b', null, label), el('small', null, hint)));
  return { row, input };
}

/** A row of exclusive choices (the settings' segmented control): options are [id, label, note]. */
function choiceRow(label, options, value, onChange) {
  const noteOf = (id) => (options.find((o) => o[0] === id) || [])[2] || '';
  const note = el('small', 'hud-choice-note', noteOf(value));
  const buttons = options.map(([id, text]) => {
    const b = el('button', `mw-seg${id === value ? ' is-active' : ''}`, text);
    b.type = 'button';
    b.dataset.id = id;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.play('click');
      buttons.forEach((x) => x.classList.toggle('is-active', x === b));
      note.textContent = noteOf(id);
      onChange(id);
    });
    return b;
  });
  const row = el('div', 'hud-choice', el('b', 'hud-choice-label', label), el('div', 'mw-segmented', ...buttons), note);
  return { row, buttons, note };
}

export class Overlays {
  /**
   * @param {HTMLElement} root overlay layer
   * @param {object} game the Game (quitToMenu, surrender, setPaused, viewState, session, setShowAllBars)
   */
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.current = null; // { name, el, onEscape }
    this.stack = [];
    this.gameOverShown = false;
    this.defeatShown = false;
  }

  get open() {
    return !!this.current;
  }

  get name() {
    return this.current ? this.current.name : null;
  }

  show(name, node, onEscape = null) {
    this.hide();
    const wrap = el('div', `hud-overlay is-${name}`, node);
    wrap.addEventListener('mousedown', (e) => e.stopPropagation());
    wrap.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root.appendChild(wrap);
    this.current = { name, el: wrap, onEscape };
    return wrap;
  }

  hide() {
    if (this.current) {
      this.current.el.remove();
      if (this.current.onHide) this.current.onHide();
    }
    this.current = null;
  }

  /** Escape / F10 while an overlay is open. Returns true if handled. */
  escape() {
    if (!this.current) return false;
    if (this.current.onEscape) this.current.onEscape();
    return true;
  }

  panel(title, sub, ...body) {
    return el('div', 'mw-panel hud-opanel', el('h2', 'mw-h2 hud-otitle', title), sub ? el('div', 'hud-osub', sub) : null, ...body);
  }

  // ---------------------------------------------------------------- waiting

  showWaiting(text = 'Waiting for the host…') {
    const node = this.panel('Joining Battle', null,
      el('div', 'hud-wait', el('span', 'hud-spinner'), el('span', null, text)),
      el('div', 'hud-obtns', btn('Leave', 'mw-btn--ghost', () => this.game.quitToMenu())));
    this.show('waiting', node);
  }

  hideWaiting() {
    if (this.name === 'waiting') this.hide();
  }

  // ---------------------------------------------------------------- menu

  openMenu() {
    if (this.current && this.current.name !== 'menu') {
      if (this.current.name === 'gameover' || this.current.name === 'ended' || this.current.name === 'waiting') return;
    }
    const game = this.game;
    const s = getSettings();
    const paused = game.setPaused(true);
    const vs = game.viewState;
    const over = !!vs.gameOver;
    const defeated = !!(vs.me && vs.me.defeated);

    const bars = toggleRow('Always show health bars', 'Otherwise hold Alt to see them all.', s.showAllBars, (v) => saveSettings({ showAllBars: v }));
    const edge = toggleRow('Edge scrolling', 'Move the camera when the mouse touches the screen edge.', s.edgeScroll, (v) => saveSettings({ edgeScroll: v }));
    const tips = toggleRow('Getting-started tips', 'The checklist in the top-right corner.', !s.tipsDismissed, (v) => saveSettings({ tipsDismissed: !v }));
    const sky = choiceRow('Time of day', TIME_OF_DAY_OPTIONS, s.timeOfDay, (v) => saveSettings({ timeOfDay: v }));
    const hints = toggleRow('Gameplay tips', 'A short tip now and then.', s.hints, (v) => saveSettings({ hints: v }));
    const aiChat = toggleRow('AI chatter', 'Computer players speak up in chat now and then.', s.aiChat, (v) => saveSettings({ aiChat: v }));
    const alerts = choiceRow('Alerts', ALERT_OPTIONS, s.alerts, (v) => saveSettings({ alerts: v }));
    const tabAlerts = choiceRow('When this tab is in the background', TAB_ALERT_OPTIONS, s.tabAlerts, async (v) => {
      const got = await chooseTabAlerts(v); // 'notify' asks the browser for permission first
      if (got === null || got === v) return; // (null: picked again meanwhile, that pick stands)
      tabAlerts.buttons.forEach((x) => x.classList.toggle('is-active', x.dataset.id === got));
      tabAlerts.note.textContent = tabAlertNote(v, notificationState(), true);
    });
    tabAlerts.note.textContent = tabAlertNote(s.tabAlerts);
    const vol = el('input', 'hud-range');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '100';
    vol.value = String(Math.round(s.volume * 100));
    const volText = el('b', 'hud-vol-text', `${vol.value}%`);
    vol.addEventListener('input', () => {
      volText.textContent = `${vol.value}%`;
      saveSettings({ volume: Number(vol.value) / 100 });
    });
    vol.addEventListener('change', () => sfx.play('select'));
    // The music: its own mute and volume (the sound effects keep theirs). Moving the slider lifts a mute.
    const musicOn = toggleRow('Music', 'The score for your pantheon: calm while you build, louder in a fight.', !s.musicMuted, (v) => saveSettings({ musicMuted: !v }));
    const musicVol = el('input', 'hud-range');
    musicVol.type = 'range';
    musicVol.min = '0';
    musicVol.max = '100';
    musicVol.value = String(Math.round(s.musicVolume * 100));
    musicVol.setAttribute('aria-label', 'Music volume');
    const musicText = el('b', 'hud-vol-text', `${musicVol.value}%`);
    musicVol.addEventListener('input', () => {
      const v = Number(musicVol.value) / 100;
      musicText.textContent = `${musicVol.value}%`;
      if (v > 0 && getSettings().musicMuted) {
        musicOn.input.checked = true;
        saveSettings({ musicVolume: v, musicMuted: false });
      } else saveSettings({ musicVolume: v });
    });

    const resume = btn('Resume', 'mw-btn--primary', () => this.closeMenu());
    const buttons = [resume];
    if (!over && !defeated) {
      buttons.push(btn('Surrender', 'mw-btn--ghost is-danger', () => this.confirm(
        'Surrender?', 'Your buildings will crumble and you will be defeated.', 'Surrender',
        () => {
          this.hide();
          game.setPaused(false);
          game.surrender();
        },
        () => this.openMenu(),
      )));
    }
    let quitHint = 'Return to the main menu.';
    if (!over) {
      if (this.hostingOthers()) quitHint = 'The game ends for every player.';
      else if (game.session && !game.session.isHost) quitHint = 'An AI will take over your army.';
      else quitHint = 'The battle will be lost.';
    }
    buttons.push(btn('Quit to Menu', 'mw-btn--ghost', () => {
      if (over) return game.quitToMenu();
      this.confirm('Quit to Menu?', quitHint, 'Quit', () => game.quitToMenu(), () => this.openMenu());
    }));

    const node = this.panel('Game Menu', paused ? 'The game is paused.' : `Game time ${formatClock(vs.time)}`,
      el('div', 'hud-obtns is-col', ...buttons),
      el('div', 'hud-options',
        el('div', 'mw-label', 'Options'),
        sky.row,
        bars.row,
        edge.row,
        tips.row,
        hints.row,
        aiChat.row,
        alerts.row,
        tabAlerts.row,
        el('label', 'hud-vol', el('span', null, 'Sound effects'), vol, volText),
        musicOn.row,
        el('label', 'hud-vol', el('span', null, 'Music volume'), musicVol, musicText),
      ),
      el('div', 'hud-ohint', 'Press F10 or Esc to resume.'));
    const wrap = this.show('menu', node, () => this.closeMenu());
    this.current.onHide = () => game.setPaused(false);
    setTimeout(() => resume.focus({ preventScroll: true }), 0);
    return wrap;
  }

  /** True on a host with other players connected: the game runs here, so leaving ends it for them. */
  hostingOthers() {
    const s = this.game.session;
    return !!(s && s.isHost && s.clients && s.clients.size);
  }

  closeMenu() {
    if (this.name === 'menu' || this.name === 'confirm') {
      this.hide();
      this.game.setPaused(false);
    }
  }

  toggleMenu() {
    if (this.name === 'menu' || this.name === 'confirm') this.closeMenu();
    else this.openMenu();
  }

  confirm(title, text, yesText, onYes, onNo) {
    const node = this.panel(title, null,
      el('p', 'hud-otext', text),
      el('div', 'hud-obtns', btn(yesText, 'mw-btn--primary', onYes), btn('Cancel', 'mw-btn--ghost', onNo)));
    if (this.current) {
      // Swap panels without running the menu's onHide (keeps the pause).
      this.current.el.remove();
      this.current = null;
    }
    this.show('confirm', node, onNo);
  }

  // ---------------------------------------------------------------- end screens

  statsTable(vs, winningTeam) {
    const head = el('tr', null, ...['Player', 'Pantheon', 'Gathered', 'Trained', 'Kills', 'Losses', 'Buildings'].map((h) => el('th', null, h)));
    const rows = (vs.players || []).map((p) => {
      const st = p.stats || {};
      const name = el('td', 'hud-st-name', el('i', 'hud-st-dot'), sanitizeName(p.name, `Player ${(p.i ?? 0) + 1}`));
      name.firstChild.style.background = safeColor(p.color);
      if (winningTeam !== null && winningTeam !== undefined && p.team === winningTeam) name.appendChild(el('span', 'hud-st-crown', ' 👑'));
      if (p.i === vs.myIndex) name.appendChild(el('span', 'hud-st-you', ' (you)'));
      const pan = PANTHEONS[p.pantheon];
      return el('tr', p.defeated ? 'is-defeated' : null, name,
        el('td', null, pan ? pan.name : p.pantheon || ''),
        el('td', null, fmt(st.gathered)), el('td', null, fmt(st.unitsTrained)), el('td', null, fmt(st.kills)),
        el('td', null, fmt(st.losses)), el('td', null, fmt(st.buildings)));
    });
    return el('table', 'hud-stats', el('thead', null, head), el('tbody', null, ...rows));
  }

  /** The achievements this match unlocked, as cards (null when there are none). */
  unlockCards(list) {
    if (!Array.isArray(list) || !list.length) return null;
    const cards = list.map((a) => el('div', 'hud-ach-card',
      el('span', 'hud-ach-icon', a.icon || '✦'),
      el('span', 'hud-ach-text', el('b', null, a.name), el('small', null, a.desc || ''))));
    return el('div', 'hud-ach',
      el('div', 'mw-label hud-ach-head', list.length === 1 ? 'Achievement unlocked' : `${list.length} achievements unlocked`),
      el('div', 'hud-ach-cards', ...cards));
  }

  /** The guided first match's medal, with the time the next better one needs (null without a medal). */
  medalCard(medal) {
    if (!medal) return null;
    const better = MEDALS.filter((m) => m.rank > medal.rank).pop();
    const hint = better ? `Win within ${formatClock(better.within)} for ${better.name.toLowerCase()}.` : 'The best there is.';
    return el('div', `hud-medal is-${medal.id}`,
      el('span', 'hud-medal-icon', medal.icon),
      el('span', 'hud-medal-text', el('b', null, `${medal.name} medal`), el('small', null, hint)));
  }

  /** "Career: 12 wins in 20 games (60%) · 9 of 35 achievements" (null for a spectator). */
  careerLine() {
    if ((this.game.viewState.myIndex ?? -1) < 0) return null;
    const c = getCareer();
    if (!c.games) return null;
    const s = careerSummary(c);
    const games = `${c.games} game${c.games === 1 ? '' : 's'}`;
    return el('div', 'hud-go-career', `Career: ${c.wins} win${c.wins === 1 ? '' : 's'} in ${games} (${Math.round(s.winRate * 100)}%) · ${s.unlocked} of ${s.total} achievements`);
  }

  /** Victory / defeat / draw screen with the statistics table and what the match unlocked. */
  showGameOver({ result, winningTeam, unlocked = null, how, medal = null, tutorial = false }) {
    this.gameOverShown = true;
    const vs = this.game.viewState;
    const title = result === 'victory' ? (tutorial ? 'Lesson Complete' : 'Victory') : result === 'defeat' ? 'Defeat' : 'Draw';
    // how: 'sacred' when a side held every sacred site long enough (DESIGN 5.11).
    const sub = how === 'sacred'
      ? (result === 'victory' ? 'Sacred Victory! Your people held every sacred site, and the heavens answered.' : 'Sacred Victory to your rivals: they held every sacred site, and the heavens turned from you.')
      : result === 'victory' ? (tutorial ? 'You know the ways of gods and mortals now. Face a real rival next: Play vs AI on the title screen.' : 'The gods smile upon your people. Your pantheon reigns supreme.')
        : result === 'defeat' ? 'Your city has fallen, and your gods have gone silent.' : 'No pantheon remains standing.';
    const node = el('div', `mw-panel hud-opanel hud-gameover is-${result}`,
      el('div', 'hud-go-crest', result === 'victory' ? '🏆' : result === 'defeat' ? '💀' : '⚖️'),
      el('h2', 'mw-h2 hud-go-title', title),
      el('div', 'hud-osub', sub),
      el('div', 'hud-go-time', `Game time ${formatClock(vs.time)}`),
      this.medalCard(medal),
      this.statsTable(vs, winningTeam),
      this.unlockCards(unlocked),
      this.careerLine(),
      el('div', 'hud-obtns',
        btn('Return to Menu', 'mw-btn--primary', () => this.game.quitToMenu()),
        btn('Keep Watching', 'mw-btn--ghost', () => this.hide())));
    this.show('gameover', node, () => this.hide());
  }

  /** The local player lost but the game goes on (allies or other players still fighting). */
  showDefeated() {
    this.defeatShown = true;
    const vs = this.game.viewState;
    const allies = (vs.players || []).some((p) => p.i !== vs.myIndex && !p.defeated && p.team === vs.myTeam);
    // On a host the game itself runs on this page: leaving it ends the game for everyone else.
    const hosting = this.hostingOthers();
    const leave = () => {
      if (!this.hostingOthers()) return this.game.quitToMenu();
      this.confirm('Quit to Menu?', 'The game ends for every player.', 'Quit', () => this.game.quitToMenu(), () => this.showDefeated());
    };
    const node = el('div', 'mw-panel hud-opanel hud-gameover is-defeat',
      el('div', 'hud-go-crest', '💀'),
      el('h2', 'mw-h2 hud-go-title', 'Defeat'),
      el('div', 'hud-osub', allies ? 'You have been defeated. Your allies fight on.' : 'You have been defeated. The battle goes on without you.'),
      hosting ? el('p', 'hud-otext', 'You are the host: leaving ends the game for every player.') : null,
      el('div', 'hud-obtns',
        btn('Keep Watching', 'mw-btn--primary', () => this.hide()),
        btn('Return to Menu', 'mw-btn--ghost', leave)));
    this.show('defeated', node, () => this.hide());
  }

  /** The session ended from outside (host left / quit / kicked). */
  showEnded(reason) {
    const text = (typeof reason === 'string' && Object.hasOwn(END_TEXT, reason) && END_TEXT[reason]) || sanitizeReason(reason, 'The game has ended.');
    const vs = this.game.viewState;
    const node = this.panel('Game Ended', text,
      vs && vs.players && vs.players.length ? this.statsTable(vs, vs.gameOver ? vs.gameOver.winningTeam : null) : null,
      el('div', 'hud-obtns', btn('Return to Menu', 'mw-btn--primary', () => this.game.quitToMenu())));
    this.show('ended', node, null);
  }
}
