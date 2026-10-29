// Full-screen HUD overlays: "Waiting for the host…", the in-game menu (F10:
// resume, save, load, options, surrender, quit), the confirm dialog, the defeat / victory
// screen with the after-game chronicle (src/ui/hud-chronicle.js), the achievements the match
// unlocked and a line on the player's career, and "the host has left".
import { getSettings, saveSettings } from '../settings.js';
import { sfx } from '../audio/sfx.js';
import { sanitizeReason } from '../net/protocol.js';
import { el } from './hud-dom.js';
import { chronicleView } from './hud-chronicle.js';
import { formatClock } from './hud-data.js';
import { TIME_OF_DAY_OPTIONS } from './time-of-day-options.js';
import { GAME_SPEED_OPTIONS, UI_SCALE_OPTIONS } from './speed-options.js';
import { ALERT_OPTIONS, TAB_ALERT_OPTIONS, tabAlertNote } from './alert-options.js';
import { chooseTabAlerts, notificationState } from './tab-attention.js';
import { getCareer, careerSummary } from '../game/career.js';
import { MEDALS } from '../data/medals.js';
import { chapterOf } from '../data/campaign.js';
import { SLOTS, saveInfo, savedAgo, listSaves, saveTitle, saveLine } from '../game/save-store.js';

const END_TEXT = {
  'host-left': 'The connection to the host was lost.',
  'host-quit': 'The host has closed the game.',
  'game-over': 'The host has closed the game.',
};

/** The line under a finished Trial of the Titans. */
/** The daily challenge's result (DESIGN 9.3): the score against today's best, and the streak of days. */
function dailyLine(d) {
  if (!d) return null;
  const n = (v) => v.toLocaleString('en-US');
  const score = d.first ? `Daily challenge: ${n(d.score)} points, today's first try.`
    : d.isNew ? `Daily challenge: ${n(d.score)} points, a new best today (it was ${n(d.previous)}).`
      : `Daily challenge: ${n(d.score)} points · today's best ${n(d.best)}.`;
  const streak = d.streak > 1 ? ` 🔥 ${d.streak} days in a row.` : '';
  return el('div', `hud-go-best hud-go-daily${d.isNew ? ' is-new' : ''}`, score + streak);
}

function survivalLine(wave) {
  if (wave <= 0) return 'The Trial of the Titans is over before the first wave even came.';
  if (wave === 1) return 'The Trial of the Titans is over: the first wave broke your city.';
  return `The Trial of the Titans is over: your people held out to wave ${wave}.`;
}

/** The chapter a won mission's Next Mission opens, when it is the first of a new one (else null). */
function nextChapter(mission) {
  const a = mission && mission.m ? chapterOf(mission.m) : null;
  const b = mission && mission.next ? chapterOf(mission.next) : null;
  return a && b && a !== b ? b : null;
}

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
    // Game speed only in a match against the computer: an online game runs at one pace for everyone.
    const speed = game.solo ? choiceRow('Game speed', GAME_SPEED_OPTIONS, s.gameSpeed, (v) => saveSettings({ gameSpeed: v })) : null;
    const uiScale = choiceRow('Interface size', UI_SCALE_OPTIONS, s.uiScale, (v) => saveSettings({ uiScale: v }));
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
    // A solo match against the computer can be saved and carried on later (DESIGN 9.4).
    const savable = typeof game.canSave === 'function' && game.canSave();
    if (savable) buttons.push(btn('Save Game', '', () => this.openSaves()));
    // ... and a saved game loaded in its place, like the title screen's Load Game.
    if (savable && typeof game.canLoad === 'function' && game.canLoad()) buttons.push(btn('Load Game', '', () => this.openLoads()));
    const replay = !!game.replay;
    if (!over && !defeated && !replay) {
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
    if (replay) quitHint = 'Leave the replay.';
    else if (!over) {
      if (this.hostingOthers()) quitHint = 'The game ends for every player.';
      else if (game.session && !game.session.isHost) quitHint = 'An AI will take over your army.';
      else quitHint = savable ? 'The battle will be lost. Save & Quit keeps it for Continue on the title screen.' : 'The battle will be lost.';
    }
    if (savable) {
      buttons.push(btn('Save & Quit', 'mw-btn--ghost', (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = 'Saving…';
        game.saveAndQuit().catch((err) => {
          b.disabled = false;
          b.textContent = 'Save & Quit';
          if (game.hud) game.hud.message(`Could not save: ${err && err.message ? err.message : err}`, 'error');
        });
      }));
    }
    buttons.push(btn(replay ? 'Leave Replay' : 'Quit to Menu', 'mw-btn--ghost', () => {
      if (over || replay) return game.quitToMenu();
      this.confirm('Quit to Menu?', quitHint, 'Quit', () => game.quitToMenu(), () => this.openMenu());
    }));

    const node = this.panel(replay ? 'Replay Menu' : 'Game Menu', paused ? (replay ? 'The replay is paused.' : 'The game is paused.') : `Game time ${formatClock(vs.time)}`,
      el('div', 'hud-obtns is-col', ...buttons),
      el('div', 'hud-options',
        el('div', 'mw-label', 'Options'),
        speed && speed.row,
        sky.row,
        uiScale.row,
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

  /**
   * The Save Game panel: the three slots with what each holds; a click saves there (over what was in it).
   * Back (or Esc) returns to the game menu; the game stays paused throughout.
   */
  openSaves() {
    const game = this.game;
    const status = el('div', 'hud-ohint hud-save-status', 'Pick a slot. Saved games stay in this browser on this device.');
    status.setAttribute('role', 'status');
    const slotText = (slot) => {
      const info = saveInfo(slot);
      if (!info) return [el('b', null, `Slot ${slot}`), el('small', null, 'Empty')];
      return [el('b', null, `Slot ${slot} · ${formatClock(info.time || 0)}`), el('small', null, `${info.label || 'Saved game'} · ${savedAgo(info.savedAt)}`)];
    };
    const rows = SLOTS.map((slot) => {
      const b = el('button', 'mw-btn hud-obtn hud-save-slot', ...slotText(slot));
      b.type = 'button';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        sfx.play('click');
        rows.forEach((r) => (r.disabled = true));
        status.textContent = 'Saving…';
        game.saveGame(slot).then(() => {
          b.replaceChildren(...slotText(slot));
          status.textContent = `Saved to slot ${slot}.`;
          sfx.play('select');
        }, (err) => {
          status.textContent = `Could not save: ${err && err.message ? err.message : err}`;
          sfx.play('error');
        }).finally(() => rows.forEach((r) => (r.disabled = false)));
      });
      return b;
    });
    const back = btn('Back', 'mw-btn--ghost', () => this.openMenu());
    const node = this.panel('Save Game', null, el('div', 'hud-obtns is-col hud-save-slots', ...rows), status, el('div', 'hud-obtns', back));
    if (this.current) {
      // Swap panels without running the menu's onHide (keeps the pause).
      this.current.el.remove();
      this.current = null;
    }
    this.show('saves', node, () => this.openMenu());
    setTimeout(() => rows[0].focus({ preventScroll: true }), 0);
  }

  /**
   * The Load Game panel: the saved games as the title screen lists them (the autosave and the three slots,
   * newest first). Loading leaves this match after a confirm: it counts as a quit, unless the save is of
   * this very match. Back (or Esc) returns to the game menu; the game stays paused throughout.
   */
  openLoads() {
    const game = this.game;
    const saves = listSaves();
    const status = el('div', 'hud-ohint hud-save-status', saves.length ? 'Saved games are kept in this browser on this device.' : 'No saved games yet. Save Game keeps this battle in a slot.');
    status.setAttribute('role', 'status');
    const rows = saves.map((info) => {
      const own = typeof game.isOwnSave === 'function' && game.isOwnSave(info);
      const b = el('button', 'mw-btn hud-obtn hud-save-slot', el('b', null, `${saveTitle(info)}${own ? ' · this battle' : ''}`), el('small', null, saveLine(info)));
      b.type = 'button';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        sfx.play('click');
        this.confirmLoad(info, own);
      });
      return b;
    });
    const back = btn('Back', 'mw-btn--ghost', () => this.openMenu());
    const node = this.panel('Load Game', null, rows.length ? el('div', 'hud-obtns is-col hud-save-slots', ...rows) : null, status, el('div', 'hud-obtns', back));
    this.swap('loads', node, () => this.openMenu());
    setTimeout(() => (rows[0] || back).focus({ preventScroll: true }), 0);
  }

  /** Ask before leaving this match for a saved one; Cancel goes back to the list. */
  confirmLoad(info, own) {
    const game = this.game;
    const time = (game.viewState && game.viewState.time) || 0;
    const text = own
      ? 'Go back to this save of the battle you are playing. What happened since it was saved is lost.'
      : time >= 60 ? 'You leave the battle you are playing: it counts as a loss in your career, like Quit to Menu.'
        : 'You leave the battle you are playing.';
    this.confirm(`Load ${saveTitle(info)}?`, text, 'Load', () => {
      const node = this.panel('Load Game', null, el('div', 'hud-wait', el('span', 'hud-spinner'), el('span', null, 'Loading the saved game…')));
      this.swap('loads', node, null);
      game.loadSave(info.slot).catch((err) => {
        if (game.disposed) return;
        this.openLoads();
        sfx.play('error');
        if (game.hud) game.hud.message(`Could not load: ${err && err.message ? err.message : err}`, 'error');
      });
    }, () => this.openLoads());
  }

  /** Show a panel in place of the current one without running its onHide (keeps the pause). */
  swap(name, node, onEscape) {
    if (this.current) {
      this.current.el.remove();
      this.current = null;
    }
    return this.show(name, node, onEscape);
  }

  /** True on a host with other players connected: the game runs here, so leaving ends it for them. */
  hostingOthers() {
    const s = this.game.session;
    return !!(s && s.isHost && s.clients && s.clients.size);
  }

  closeMenu() {
    if (this.name === 'menu' || this.name === 'confirm' || this.name === 'saves' || this.name === 'loads') {
      this.hide();
      this.game.setPaused(false);
    }
  }

  toggleMenu() {
    if (this.name === 'menu' || this.name === 'confirm' || this.name === 'saves' || this.name === 'loads') this.closeMenu();
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

  /** "Career: 12 wins in 20 games (60%) · 9 of 40 achievements" (null for a spectator). */
  careerLine() {
    if ((this.game.viewState.myIndex ?? -1) < 0) return null;
    const c = getCareer();
    if (!c.games) return null;
    const s = careerSummary(c);
    const games = `${c.games} game${c.games === 1 ? '' : 's'}`;
    return el('div', 'hud-go-career', `Career: ${c.wins} win${c.wins === 1 ? '' : 's'} in ${games} (${Math.round(s.winRate * 100)}%) · ${s.unlocked} of ${s.total} achievements`);
  }

  /** Victory / defeat / draw screen (or the Trial of the Titans' wave) with the chronicle and what the match unlocked (and the lesson's medal). */
  showGameOver({ result, winningTeam, unlocked = null, how, medal = null, tutorial = false, wave = 0, record = null, daily = null, mission = null }) {
    this.gameOverShown = true;
    const vs = this.game.viewState;
    const survival = result === 'survival';
    const title = survival ? `Wave ${wave}`
      : mission && result !== 'draw' ? (result === 'victory' ? 'Mission Complete' : 'Mission Failed')
        : result === 'victory' ? (tutorial ? 'Lesson Complete' : 'Victory') : result === 'defeat' ? 'Defeat' : 'Draw';
    // how: 'sacred' when a side held every sacred site long enough (DESIGN 5.11).
    const sub = survival ? survivalLine(wave)
      : mission && result !== 'draw' ? (result === 'victory' ? mission.m.victory : mission.m.defeat)
      : how === 'sacred'
        ? (result === 'victory' ? 'Sacred Victory! Your people held every sacred site, and the heavens answered.' : 'Sacred Victory to your rivals: they held every sacred site, and the heavens turned from you.')
        : result === 'victory' ? (tutorial ? 'You know the ways of gods and mortals now. Face a real rival next: Play vs AI on the title screen.' : 'The gods smile upon your people. Your pantheon reigns supreme.')
          : result === 'defeat' ? 'Your city has fallen, and your gods have gone silent.' : 'No pantheon remains standing.';
    const best = survival && record ? el('div', `hud-go-best${record.isNew ? ' is-new' : ''}`, record.isNew
      ? (record.previous > 0 ? `A new best! Your old best was wave ${record.previous}.` : 'Your first trial: the bar is set.')
      : `Your best: wave ${record.best}.`) : null;
    const node = el('div', `mw-panel hud-opanel hud-gameover is-${survival ? 'defeat is-survival' : result}`,
      el('div', 'hud-go-crest', survival ? '🐉' : result === 'victory' ? '🏆' : result === 'defeat' ? '💀' : '⚖️'),
      el('h2', 'mw-h2 hud-go-title', title),
      el('div', 'hud-osub', sub),
      best,
      dailyLine(daily),
      el('div', 'hud-go-time', `Game time ${formatClock(vs.time)}`),
      this.medalCard(medal),
      this.missionLine(mission),
      chronicleView(vs, winningTeam, this.game.chronicle || null),
      this.unlockCards(unlocked),
      this.careerLine(),
      el('div', 'hud-obtns', ...this.gameOverButtons(mission)));
    this.show('gameover', node, () => this.hide());
  }

  /** Play Again (or a mission's Next Mission and Retry), Watch Replay, Return to Menu and Keep Watching. */
  gameOverButtons(mission) {
    const watch = btn('Keep Watching', 'mw-btn--ghost', () => this.hide());
    const replay = this.canWatchReplay() ? btn('Watch Replay', 'mw-btn--ghost', () => this.game.watchReplay()) : null;
    if (mission) {
      const next = mission.next && typeof this.game.nextMission === 'function' && typeof this.game.onNextMission === 'function';
      return [
        next ? btn(nextChapter(mission) ? `Begin ${nextChapter(mission).chapter}` : 'Next Mission', 'mw-btn--primary', () => this.game.nextMission()) : null,
        this.canRematch() ? btn(mission.record ? 'Play It Again' : 'Retry Mission', next ? 'mw-btn--ghost' : 'mw-btn--primary', () => this.game.rematch()) : null,
        replay,
        btn('Campaign', 'mw-btn--ghost', () => this.game.quitToMenu()),
        watch,
      ];
    }
    return [
      this.canRematch() ? btn('Play Again', 'mw-btn--primary', () => this.game.rematch()) : null,
      replay,
      btn('Return to Menu', this.canRematch() ? 'mw-btn--ghost' : 'mw-btn--primary', () => this.game.quitToMenu()),
      watch,
    ];
  }

  /** A won mission: a first win opens the next one, a replay may beat the best time; the last one ends the chapter. */
  missionLine(mission) {
    if (!mission || !mission.record) return null;
    const r = mission.record;
    const c = chapterOf(mission.m);
    const opened = nextChapter(mission);
    const text = r.chapterDone ? `${c.chapter} complete! ${c.title} is told.${opened ? ` ${opened.chapter} is open: ${opened.title}.` : ''}`
      : r.first ? (mission.next ? `The next mission is open: ${mission.next.title}.` : `Mission won in ${formatClock(r.best)}.`)
        : r.best < r.previous ? `A new best time! ${formatClock(r.best)} (was ${formatClock(r.previous)}).` : `Your best time: ${formatClock(r.best)}.`;
    return el('div', `hud-go-best${r.first || r.best < r.previous ? ' is-new' : ''}`, text);
  }

  /** Watch Replay: the host kept this match (Game.canWatchReplay). */
  canWatchReplay() {
    return typeof this.game.canWatchReplay === 'function' && this.game.canWatchReplay();
  }

  /** Play Again is offered for a game against the computer only (Game.canRematch). */
  canRematch() {
    return typeof this.game.canRematch === 'function' && this.game.canRematch();
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
    // A lost link (DESIGN 7): the host's AI holds my seat, and this browser can take it back.
    const g = this.game;
    const canRejoin = reason === 'host-left' && !(vs && vs.gameOver) && typeof g.onRejoin === 'function' && typeof g.rejoinTicket === 'function' && !!g.rejoinTicket();
    const node = this.panel('Game Ended', canRejoin ? `${text} An AI plays for you meanwhile: rejoin to take your seat back.` : text,
      vs && vs.players && vs.players.length ? chronicleView(vs, vs.gameOver ? vs.gameOver.winningTeam : null, g.chronicle || null) : null,
      el('div', 'hud-obtns',
        canRejoin ? btn('Rejoin Game', 'mw-btn--primary', () => g.rejoin()) : null,
        btn('Return to Menu', canRejoin ? '' : 'mw-btn--primary', () => g.quitToMenu())));
    this.show('ended', node, null);
  }
}
