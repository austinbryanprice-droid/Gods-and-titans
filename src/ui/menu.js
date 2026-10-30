// Main menu, lobby, join, how-to-play and settings screens (DESIGN 9), drawn
// as an HTML overlay in #menu-root over an animated night-sky backdrop.
//
//   const menu = createMenu({ root, onStart, onIntro, onLoad, onReplay })   // onStart(launch) when a lobby starts; onIntro() replays the intro film;
//                                                                           // onLoad(slot) carries on a saved game (DESIGN 9.4); onReplay(id | record) watches a replay (9.5)
//   showMenu(screen = 'title')  /  hideMenu()
//
// launch = { role: 'host'|'client', setup, myIndex, conns | conn, lobby }.
// Lobbies come from src/net/lobby.js (DESIGN 7), or from ./menu-mock.js when
// the URL has ?mockLobby=1. ?transport=local swaps PeerJS for BroadcastChannel.
import { GAME_TITLE, GAME_SUBTITLE, GAME_VERSION, PLAYER_COLORS, MAP_SIZES, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, PEACE_LENGTHS, PEACE_NAME, SURVIVAL_NAME, SURVIVAL_FIRST_WAVE, SURVIVAL_INTERVAL, SURVIVAL_BOSS_EVERY, SACRED_NAME } from '../config.js';
import { PANTHEON_LIST } from '../data/index.js';
import { LANDSCAPE_CHOICES, landscapeInfo } from '../data/landscapes.js';
import { getSettings, saveSettings, onSettingsChange } from '../settings.js';
import { TIME_OF_DAY_OPTIONS, timeOfDayNote } from './time-of-day-options.js';
import { GAME_SPEED_OPTIONS, UI_SCALE_OPTIONS, TEAM_COLOR_OPTIONS, CARD_KEY_OPTIONS, QUALITY_OPTIONS, INTRO_OPTIONS, optionNote } from './speed-options.js';
import { buildKeyPanel } from './key-panel.js';
import { sfx } from '../audio/sfx.js';
import { playTitleMusic, previewMusic, PREVIEW_MOODS } from '../audio/audio.js';
import { h, setChildren, copyText } from './menu-dom.js';
import { createMenuBackdrop } from './menu-fx.js';
import { openPantheonPicker, pantheonLabel, pantheonEmblem, summaryFor, unitRow, blessingRow, styleLine } from './menu-pantheons.js';
import { renderHowToContent } from './menu-howto.js';
import { renderCareerContent } from './menu-career.js';
import { renderReplays } from './menu-replays.js';
import { getCareer, markSeen, hasBeatenComputer } from '../game/career.js';
import { loadSkirmish, launchFrom, skirmishLabel } from '../game/rematch.js';
import { AUTO_SLOT, listSaves, deleteSave, saveTitle, saveLine } from '../game/save-store.js';
import { dailyStatus, dailyLabel, dailyLaunch } from '../game/daily.js';
import { tutorialSetup } from '../sim/tutorial.js';
import { campaignSetup } from '../sim/campaign.js';
import { campaignScreen as buildCampaignScreen } from './menu-campaign.js';
import { chapterOf } from '../data/campaign.js';
import { nextToPlay, wonCount } from '../game/campaign-progress.js';
import { medalLabel } from '../data/medals.js';
import { ALERT_OPTIONS, TAB_ALERT_OPTIONS, alertNote, tabAlertNote } from './alert-options.js';
import { chooseTabAlerts, notificationState } from './tab-attention.js';
import { browserSpeech } from '../intro/narrator.js';
import * as M from './menu-model.js';
import { saveTicket, readTicket, clearTicket, seekGame } from '../net/rejoin-ticket.js';
import { displayColor } from '../team-colors.js';

let instance = null;

/** Show the menu (after a match, or from anywhere). */
export function showMenu(screen = 'title', opts = {}) {
  if (instance) instance.show(screen, opts);
}

/** Hide the menu (the game is taking over the screen). */
export function hideMenu() {
  if (instance) instance.hide();
}

/** 'fifth' for 5 (the boss rhythm of the Trial of the Titans), else '5th'. */
function ordinal(n) {
  return ({ 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth', 10: 'tenth' })[n] || `${n}th`;
}

/** m:ss for whole seconds. */
function clockText(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function urlParams() {
  try {
    return new URLSearchParams(globalThis.location ? location.search : '');
  } catch {
    return new URLSearchParams('');
  }
}

/** Remove a query parameter from the address bar without reloading. */
function dropUrlParam(name) {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has(name)) return;
    url.searchParams.delete(name);
    history.replaceState(history.state, '', url.toString());
  } catch {
    // ignore
  }
}

const unsubAll = (list) => {
  for (const off of list.splice(0)) {
    try {
      if (typeof off === 'function') off();
    } catch {
      // ignore
    }
  }
};

function closeLobby(lobby) {
  if (!lobby) return;
  try {
    if (typeof lobby.close === 'function') lobby.close();
    else if (typeof lobby.leave === 'function') lobby.leave();
    else if (typeof lobby.destroy === 'function') lobby.destroy();
  } catch (err) {
    console.warn('[menu] closing the lobby failed', err);
  }
}

/**
 * Build the menu inside `root`.
 * @param {{ root: HTMLElement, onStart: (launch: object) => void, onIntro?: () => void, onLoad?: (slot: string) => Promise<void> }} opts
 */
export function createMenu({ root, onStart, onIntro = null, onLoad = null, onReplay = null }) {
  const params = urlParams();
  const useMock = params.get('mockLobby') === '1';
  const tOverride = params.get('transport');
  const onlineTransport = tOverride === 'local' || tOverride === 'peer' ? tOverride : 'peer';
  let lobbyModule = null;

  root.classList.add('mw-root');
  setChildren(root);
  const sky = h('div.mw-sky', { 'aria-hidden': 'true' });
  const screenLayer = h('div.mw-screens');
  const toasts = h('div.mw-toasts', { role: 'status', 'aria-live': 'polite' });
  root.append(sky, h('div.mw-vignette', { 'aria-hidden': 'true' }), screenLayer, toasts);
  const backdrop = createMenuBackdrop(sky);

  let current = null; // { name, cleanup, onEscape }
  let launchedLobby = null; // lobby of the running match; closed when the menu returns
  let titleNotice = null; // persistent warning shown on the title screen (menu.setNotice)

  // Button clicks get a soft click sound (delegated).
  root.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button');
    if (b && !b.disabled && !b.classList.contains('mw-silent')) sfx.play('click');
  });
  document.addEventListener('keydown', (e) => {
    if (root.hidden || e.key !== 'Escape' || e.repeat || !current || !current.onEscape) return;
    if (root.querySelector('.mw-overlay, .mw-popover')) return;
    e.preventDefault();
    // In the lobby, Esc in a text box (chat) or a dropdown only leaves that control, as in the game.
    const t = e.target;
    if (current.name === 'lobby' && t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) {
      t.blur();
      return;
    }
    current.onEscape();
  });

  function loadLobby() {
    if (!lobbyModule) {
      lobbyModule = (useMock ? import('./menu-mock.js') : import('../net/lobby.js')).catch((err) => {
        lobbyModule = null;
        console.error('[menu] lobby module failed to load', err);
        throw new Error('The multiplayer module could not be loaded. Please reload the page.');
      });
    }
    return lobbyModule;
  }

  function toast(text, kind = 'error', ms = 6000) {
    const el = h('div.mw-toast', { class: `is-${kind}` }, h('span.mw-toast-icon', kind === 'error' ? '⚠' : '✦'), h('span', text));
    toasts.appendChild(el);
    if (kind === 'error') sfx.play('error');
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 300);
    }, ms);
  }

  function busy(text, onCancel) {
    const el = h('div.mw-overlay.mw-busy',
      h('div.mw-busy-box.mw-panel',
        h('div.mw-spinner', { 'aria-hidden': 'true' }),
        h('div.mw-busy-text', text),
        onCancel ? h('button.mw-btn.mw-btn--ghost', { type: 'button', onclick: () => {
          el.remove();
          onCancel();
        } }, 'Cancel') : null,
      ));
    root.appendChild(el);
    return () => el.remove();
  }

  function go(name, opts = {}) {
    if (current && current.cleanup) {
      try {
        current.cleanup();
      } catch (err) {
        console.warn('[menu] screen cleanup failed', err);
      }
    }
    root.querySelectorAll('.mw-overlay, .mw-popover').forEach((el) => el.remove());
    const build = SCREENS[name] || SCREENS.title;
    const screen = build(opts);
    current = { name, ...screen };
    // Each screen sits in its own scroller so tall content scrolls on small windows.
    setChildren(screenLayer, h('div.mw-screen', screen.el));
    root.dataset.screen = name;
    if (name !== 'settings') playTitleMusic(); // the menu's own score (a no-op while it already plays; Settings may be auditioning another)
    // the full sky show on the title; a quieter one behind panels full of controls
    backdrop.setMode(name === 'title' ? 'full' : 'calm');
    if (screen.focus) setTimeout(() => screen.focus.focus && screen.focus.focus({ preventScroll: true }), 60);
  }

  // ------------------------------------------------------------ actions

  /**
   * Play vs AI: a lobby of one player against one computer player on a small map. `opts` may set the AI's
   * difficulty and the player's pantheon (the guided first match's Play vs AI (Easy) sets both).
   */
  async function playVsAI(opts = {}) {
    const done = busy('Preparing the battlefield…');
    try {
      const mod = await loadLobby();
      const name = getSettings().name;
      // A first game is against an Easy AI; once the career has a win against the computer, Normal (DESIGN 9).
      const difficulty = M.DIFFICULTIES.includes(opts.difficulty) ? opts.difficulty : M.defaultAiDifficulty(hasBeatenComputer());
      const lobby = await mod.LobbyHost.create({ transport: 'none', name, aiDifficulty: difficulty });
      // Co-op preset, trimmed to one human against one AI on a small map.
      const safe = (fn) => {
        try {
          fn();
        } catch (err) {
          console.warn('[menu] lobby setup step failed', err);
        }
      };
      safe(() => lobby.applyPreset('coop'));
      const slots = lobby.state?.slots || [];
      const me = Math.max(0, slots.findIndex((s) => s && s.kind === 'host'));
      let aiPlaced = false;
      slots.forEach((s, i) => {
        if (i === me) return;
        if (!aiPlaced) {
          aiPlaced = true;
          safe(() => lobby.setSlot(i, { kind: 'ai', difficulty, team: 2 }));
        } else safe(() => lobby.setSlot(i, { kind: 'closed' }));
      });
      // A first game: Greek, as in the lesson, until a win against the computer; then Random (DESIGN 9).
      const pantheon = opts.pantheon || M.defaultPantheon(hasBeatenComputer());
      if (pantheon !== 'random') safe(() => lobby.setSlot(me, { pantheon }));
      safe(() => lobby.setMapSize('small'));
      done();
      go('lobby', { lobby, role: 'host', transport: 'none' });
    } catch (err) {
      done();
      toast(err?.message || 'Could not create the game.');
    }
  }

  /** The guided first match (DESIGN 9.2): a fixed solo setup, no lobby. */
  function startTutorial() {
    try {
      sfx.play('horn');
      onStart({ role: 'host', setup: tutorialSetup({ name: getSettings().name, version: GAME_VERSION }), myIndex: 0, conns: new Map(), lobby: null });
    } catch (err) {
      toast(err?.message || 'Could not start the lesson.');
    }
  }

  /** A campaign mission (DESIGN 5.16): a fixed solo setup from its data, no lobby. */
  function startMission(id) {
    try {
      sfx.play('horn');
      onStart({ role: 'host', setup: campaignSetup(id, { name: getSettings().name, version: GAME_VERSION }), myIndex: 0, conns: new Map(), lobby: null });
    } catch (err) {
      toast(err?.message || 'Could not start the mission.');
    }
  }

  async function hostOnline() {
    let cancelled = false;
    const done = busy('Opening a room on the network…', () => (cancelled = true));
    try {
      const mod = await loadLobby();
      const lobby = await mod.LobbyHost.create({ transport: onlineTransport, name: getSettings().name });
      done();
      if (cancelled) return closeLobby(lobby);
      go('lobby', { lobby, role: 'host', transport: onlineTransport });
    } catch (err) {
      done();
      if (!cancelled) toast(err?.message || 'Could not open an online room.');
    }
  }

  // ------------------------------------------------------------ screens

  const SCREENS = {
    title: titleScreen,
    lobby: lobbyScreen,
    join: joinScreen,
    howto: howToScreen,
    career: careerScreen,
    campaign: (opts) => buildCampaignScreen({ go, onBegin: startMission, mission: opts.mission || null }),
    settings: settingsScreen,
    load: loadScreen,
    rejoin: rejoinScreen,
    rematch: rematchScreen,
    // Straight into a Play vs AI lobby (the guided first match's game-over screen): the title shows while it is made.
    skirmish: (opts) => {
      const screen = titleScreen();
      playVsAI(opts);
      return screen;
    },
  };

  /** Carry on a saved game: the slot is read and the match starts; a failure is said in a toast. */
  async function loadSlot(slot) {
    if (!onLoad) return;
    const done = busy('Loading the saved game…');
    try {
      sfx.play('horn');
      await onLoad(slot);
    } catch (err) {
      toast(err?.message || 'The saved game could not be loaded.');
    } finally {
      done();
    }
  }

  function titleScreen() {
    const counts = {
      gods: PANTHEON_LIST.reduce((n, p) => n + p.gods.length, 0),
      creatures: PANTHEON_LIST.reduce((n, p) => n + p.creatures.length, 0),
    };
    const mainBtn = (label, sub, onclick, extra = '') => h('button.mw-btn.mw-btn--menu', { type: 'button', class: extra, onclick },
      h('span.mw-orn.is-l', { 'aria-hidden': 'true' }, '◆'),
      h('span.mw-btn-label', label), h('span.mw-btn-sub', sub),
      h('span.mw-orn.is-r', { 'aria-hidden': 'true' }, '◆'));
    const playBtn = mainBtn('Play vs AI', 'Skirmish or co-op against the computer', () => playVsAI(), 'mw-btn--primary');
    // Quick Match: the last game against the computer again, in one click (src/game/rematch.js). Shown once the lobby
    // module has read it back; none on a first visit.
    const quickSub = h('span.mw-btn-sub', '');
    const quickBtn = h('button.mw-btn.mw-btn--menu.mw-quick-btn', { type: 'button', hidden: true, onclick: () => quickMatch() },
      h('span.mw-orn.is-l', { 'aria-hidden': 'true' }, '◆'),
      h('span.mw-btn-label', 'Quick Match'), quickSub,
      h('span.mw-orn.is-r', { 'aria-hidden': 'true' }, '◆'));
    // Continue: the newest saved game (the autosave or a slot), in one click. Load Game lists them all.
    const saves = onLoad ? listSaves() : [];
    const continueBtn = saves.length ? mainBtn('Continue', saveLine(saves[0]), () => loadSlot(saves[0].slot), 'mw-continue-btn') : null;
    // Rejoin: an online game this browser dropped out of (a lost link, a reloaded page) while an AI holds its seat.
    const ticket = readTicket();
    const rejoinBtn = ticket ? mainBtn('Rejoin Online Game', `Back into room ${ticket.roomCode} as ${ticket.name}`, () => go('rejoin'), 'mw-rejoin-btn') : null;
    let quick = null;
    let nav = null;
    loadLobby().then((mod) => {
      if (typeof mod.sanitizeLobbyState !== 'function') return; // the mock lobby keeps no games
      quick = loadSkirmish(mod);
      if (!quick) return;
      quickSub.textContent = `Again: ${skirmishLabel(quick)}`;
      quickBtn.hidden = false;
      nav.classList.add('has-quick'); // pairs Quick Match with the Daily Challenge (style.css)
    }).catch(() => {});
    async function quickMatch() {
      if (!quick) return;
      try {
        const launch = launchFrom(await loadLobby(), quick, getSettings().name);
        if (!launch) throw new Error('That game can no longer start. Set it up again with Play vs AI.');
        sfx.play('horn');
        onStart(launch);
      } catch (err) {
        toast(err?.message || 'Could not start the game.');
      }
    }
    // The daily challenge (src/game/daily.js, DESIGN 9.3): the same seeded game for everyone today, today's best and the streak.
    const daily = dailyStatus();
    const dailySub = [`Today: ${dailyLabel(daily.challenge)}`];
    if (daily.today) dailySub.push(`best ${daily.today.best.toLocaleString('en-US')}`);
    const dailyBtn = mainBtn('Daily Challenge', dailySub.join(' · '), playDaily, 'mw-daily-btn');
    dailyBtn.title = `${daily.challenge.twist.name}: ${daily.challenge.twist.desc}`;
    if (daily.streak > 0) {
      dailyBtn.appendChild(h('span.mw-new-badge.mw-start-badge.mw-streak-badge', {
        title: daily.playedToday ? `${daily.streak} day${daily.streak === 1 ? '' : 's'} in a row` : `Play today to keep your ${daily.streak}-day streak`,
      }, daily.playedToday ? `🔥 ${daily.streak}` : `🔥 ${daily.streak} · keep it`));
    } else if (!daily.playedToday) dailyBtn.appendChild(h('span.mw-new-badge.mw-start-badge', 'New today'));
    async function playDaily() {
      try {
        const launch = dailyLaunch(await import('../net/lobby.js'), daily.challenge.day, getSettings().name); // the real lobby: it builds the setup
        sfx.play('horn');
        onStart(launch);
      } catch (err) {
        toast(err?.message || 'Could not start the daily challenge.');
      }
    }
    const career = getCareer();
    const newCount = career.unseen.length;
    // A guided first match; a player who has never finished a game or the lesson is pointed at it.
    const learnBtn = mainBtn('Learn to Play', career.best.medal ? `A guided first match · your best: ${medalLabel(career.best.medal)}` : 'A guided first match: gather, build, pray, summon and fight', startTutorial, 'mw-learn-btn');
    if (!career.games && !career.best.medal) learnBtn.appendChild(h('span.mw-new-badge.mw-start-badge', 'New? Start here'));
    // The chapter being played: the one of the next mission to play (Chapter II once Chapter I is won).
    const chapter = chapterOf(nextToPlay());
    const won = wonCount(undefined, chapter.id);
    const total = chapter.missions.length;
    const campaignBtn = mainBtn('Campaign', `${chapter.chapter}: ${chapter.title} · ${won ? `${won} of ${total} missions won` : `${total} story missions for ${chapter.people}`}`, () => go('campaign'), 'mw-campaign-btn');
    const nameEl = h('strong', getSettings().name);
    const off = onSettingsChange((s) => (nameEl.textContent = s.name));
    const el = h('div.mw-title-screen',
      h('header.mw-hero',
        h('div.mw-crest', { 'aria-hidden': 'true' },
          PANTHEON_LIST.map((p, i) => h('span.mw-crest-emblem', { title: p.name, style: { '--i': String(i), '--n': String(PANTHEON_LIST.length) } }, pantheonEmblem(p.id))),
          h('span.mw-crest-core', '✦'),
        ),
        h('h1.mw-logo', { 'data-text': GAME_TITLE.toUpperCase() }, GAME_TITLE.toUpperCase()),
        h('div.mw-subtitle', h('span.mw-rule'), h('span', GAME_SUBTITLE), h('span.mw-rule')),
        h('p.mw-tagline', 'Raise a city of the faithful. Pray. Summon the gods. Unleash the titans.'),
      ),
      nav = h('nav.mw-main-nav', { 'aria-label': 'Main menu' },
        titleNotice ? h('p.mw-notice', { role: 'alert' }, titleNotice) : null,
        rejoinBtn,
        continueBtn,
        playBtn,
        quickBtn,
        dailyBtn,
        learnBtn,
        campaignBtn,
        mainBtn('Host Online Game', 'Invite friends with a room code', hostOnline),
        mainBtn('Join Online Game', 'Enter a friend\'s room code', () => go('join')),
        h('div.mw-nav-row',
          saves.length ? h('button.mw-btn.mw-btn--small', { type: 'button', onclick: () => go('load') }, 'Load Game') : null,
          h('button.mw-btn.mw-btn--small', { type: 'button', onclick: () => go('howto') }, 'How to Play'),
          h('button.mw-btn.mw-btn--small.mw-career-btn', { type: 'button', onclick: () => go('career') }, 'Career',
            newCount ? h('span.mw-new-badge', { title: `${newCount} new achievement${newCount === 1 ? '' : 's'}` }, String(newCount)) : null),
          h('button.mw-btn.mw-btn--small', { type: 'button', onclick: () => go('settings') }, 'Settings'),
        ),
      ),
      h('footer.mw-title-foot',
        h('span.mw-foot-item', 'Playing as ', nameEl, ' · ', h('button.mw-link', { type: 'button', onclick: () => go('settings') }, 'change')),
        h('span.mw-foot-item.mw-foot-stats', `${PANTHEON_LIST.length} pantheons · ${counts.gods} gods · ${PANTHEON_LIST.length} titans · ${counts.creatures} mythical creatures`),
        h('span.mw-foot-item', `v${GAME_VERSION}`),
      ),
    );
    return { el, focus: rejoinBtn || continueBtn || playBtn, cleanup: off };
  }

  // ---------------------------------------------------------- load game

  function loadScreen() {
    const backBtn = h('button.mw-btn.mw-btn--ghost', { type: 'button', onclick: () => go('title') }, '‹ Back');
    const list = h('div.mw-save-list');
    function render() {
      const saves = listSaves();
      if (!saves.length) {
        setChildren(list, h('p.mw-hint', 'No saved games yet. Save a game against the computer from the in-game menu (F10).'));
        return;
      }
      setChildren(list, saves.map((info) => h('div.mw-save-row',
        h('div.mw-save-text',
          h('b', saveTitle(info)),
          h('span', saveLine(info))),
        h('button.mw-btn.mw-btn--primary.mw-btn--small', { type: 'button', onclick: () => loadSlot(info.slot) }, 'Load'),
        h('button.mw-btn.mw-btn--ghost.mw-btn--small', { type: 'button', title: 'Delete this saved game', onclick: async () => {
          if (typeof confirm === 'function' && !confirm(`Delete ${info.slot === AUTO_SLOT ? 'the autosave' : `slot ${info.slot}`}?`)) return;
          await deleteSave(info.slot);
          render();
        } }, 'Delete'),
      )));
    }
    render();
    const el = h('div.mw-center-screen',
      h('section.mw-panel.mw-load-panel',
        h('header.mw-panel-head', backBtn, h('h2.mw-h2', 'Load Game'), h('span.mw-head-spacer')),
        list,
        h('p.mw-hint', 'Saved games are kept in this browser on this device. A game is autosaved every three minutes of game time; Save & Quit in the game menu keeps it for Continue.')),
    );
    return { el, focus: backBtn, onEscape: () => go('title') };
  }

  // ---------------------------------------------------------- lobby

  /** The four god icons of a pantheon, or a hint for Random. */
  function godIcons(id) {
    const sum = summaryFor(id);
    if (!sum) return h('span.mw-pbtn-hint', 'Revealed when the battle begins');
    return sum.gods.map((g) => h('span', { title: g.name }, g.icon));
  }

  function lobbyScreen({ lobby, role, transport }) {
    const isHost = role === 'host';
    const online = transport !== 'none';
    const subs = [];
    let alive = true;
    let leaving = false;
    let leaveArmed = false; // host: first Leave / Esc asks, the second one closes the room
    let leaveTimer = 0;
    const st = () => lobby.state || { slots: [], mapSize: 'small', peace: 0, survival: false };
    const myIndex = () => {
      if (!isHost) return Number.isInteger(lobby.mySlot) ? lobby.mySlot : -1;
      const i = st().slots.findIndex((s) => s && s.kind === 'host');
      return i < 0 ? 0 : i;
    };
    const patchSlot = (i, p) => {
      try {
        if (isHost) lobby.setSlot(i, p);
        else if (i === myIndex()) lobby.setMine(p);
      } catch (err) {
        toast(err?.message || 'Could not change that.');
      }
    };
    const canEditPantheon = (i, s) => (i === myIndex()) || (isHost && s.kind === 'ai');
    // Before the first win against the computer, Easy is marked as suggested in a game against the computer.
    const suggested = !online && isHost && !hasBeatenComputer() ? 'easy' : null;
    const diffNote = h('p.mw-hint.mw-diff-note', { hidden: true });
    const canEditTeam = (i, s) => M.isFilled(s) && (isHost || i === myIndex());

    // ---- slot rows ----
    const rows = [];
    const rowSig = [];
    const slotList = h('div.mw-slots', { role: 'list' });
    for (let i = 0; i < M.SLOT_COUNT; i++) {
      const row = h('div.mw-slot', { role: 'listitem' });
      rows.push(row);
      rowSig.push('');
      slotList.appendChild(row);
    }

    function openColorPicker(i, anchor) {
      root.querySelectorAll('.mw-popover').forEach((p) => p.remove());
      const s = st().slots[i];
      const taken = M.blockedColors(st(), i, isHost);
      const pop = h('div.mw-popover', { role: 'menu' },
        PLAYER_COLORS.map((c, ci) => h('button.mw-color-opt', {
          type: 'button',
          class: [ci === s.color ? 'is-current' : '', taken.has(ci) ? 'is-taken' : ''].join(' '),
          style: { '--c': displayColor(c) },
          title: taken.has(ci) ? 'Taken by another player' : 'Choose this color',
          'aria-label': taken.has(ci) ? 'Color taken' : 'Choose this color',
          disabled: taken.has(ci),
          onclick: () => {
            patchSlot(i, { color: ci });
            close();
          },
        })),
      );
      const close = () => {
        pop.remove();
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', onKey, true);
      };
      const outside = (e) => {
        if (!pop.contains(e.target) && e.target !== anchor) close();
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      };
      root.appendChild(pop);
      const r = anchor.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      pop.style.left = `${Math.max(8, r.left - rr.left)}px`;
      pop.style.top = `${r.bottom - rr.top + 6}px`;
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', onKey, true);
      subs.push(close);
    }

    function renderRow(i) {
      const state = st();
      const s = state.slots[i] || { kind: 'closed' };
      const me = myIndex();
      const sig = JSON.stringify([s, me, M.survivalMode(state)]); // the trial shows "Together" in the team column
      if (sig === rowSig[i]) return;
      rowSig[i] = sig;
      const row = rows[i];
      const filled = M.isFilled(s);
      row.className = `mw-slot is-${s.kind}${i === me ? ' is-me' : ''}`;
      row.style.setProperty('--c', M.slotColor(s));

      // color swatch
      const swatch = h('button.mw-swatch', {
        type: 'button',
        title: canEditPantheon(i, s) ? 'Change color' : 'Player color',
        'aria-label': `Player ${i + 1} color`,
        disabled: !filled || !canEditPantheon(i, s),
        onclick: (e) => openColorPicker(i, e.currentTarget),
      });

      // kind / name
      let who;
      if (isHost && i !== me && s.kind !== 'host') {
        const opts = M.slotKindOptions(s, i, { myIndex: me, online, suggested });
        const value = M.slotKindValue(s, i, me);
        who = h('select.mw-select.mw-select--who', {
          'aria-label': `Slot ${i + 1}`,
          onchange: (e) => {
            const p = M.kindPatch(e.target.value);
            if (!p) return;
            if (s.kind === 'human' && p.kind !== 'human' && typeof lobby.kick === 'function' && p.kind === 'open') {
              try {
                lobby.kick(i);
                return;
              } catch {
                // fall through to setSlot
              }
            }
            patchSlot(i, p);
          },
        }, opts.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
        who.value = value;
      } else {
        const label = i === me ? `${s.name || getSettings().name}` : M.slotName(s);
        const tag = s.kind === 'host' && i !== me ? 'Host' : i === me ? 'You' : s.kind === 'ai' ? 'AI' : null;
        who = h('div.mw-who', h('span.mw-who-name', label), tag ? h('span.mw-tag', tag) : null);
      }

      // pantheon
      let pantheon = null;
      if (filled) {
        const editable = canEditPantheon(i, s);
        pantheon = h('button.mw-pbtn', {
          type: 'button',
          disabled: !editable,
          title: editable ? 'Choose a pantheon' : pantheonLabel(s.pantheon),
          onclick: () => openPantheonPicker({
            host: root,
            current: s.pantheon,
            title: i === me ? 'Choose your pantheon' : `Pantheon for ${M.slotName(s)}`,
            onChoose: (id) => patchSlot(i, { pantheon: id }),
          }),
        },
        h('span.mw-pbtn-emblem', { 'aria-hidden': 'true' }, pantheonEmblem(s.pantheon)),
        h('span.mw-pbtn-text',
          h('span.mw-pbtn-name', pantheonLabel(s.pantheon)),
          h('span.mw-pbtn-gods', { 'aria-hidden': 'true' }, godIcons(s.pantheon))),
        editable ? h('span.mw-pbtn-caret', { 'aria-hidden': 'true' }, '▸') : null);
      } else {
        pantheon = h('div.mw-slot-empty', s.kind === 'open' ? h('span.mw-waiting', 'Waiting for a player to join…') : h('span', 'Slot closed'));
      }

      // team
      let team = null;
      if (filled && M.survivalMode(st())) {
        team = h('div.mw-team-static', { title: `In the ${SURVIVAL_NAME} every player is on one team.` }, 'Together');
      } else if (filled) {
        if (canEditTeam(i, s)) {
          team = h('select.mw-select.mw-select--team', {
            'aria-label': `Team for slot ${i + 1}`,
            onchange: (e) => patchSlot(i, { team: Number(e.target.value) }),
          }, [1, 2, 3, 4].map((t) => h('option', { value: String(t), selected: t === s.team }, `Team ${t}`)));
          team.value = String(s.team);
        } else team = h('div.mw-team-static', `Team ${s.team}`);
      } else team = h('div.mw-team-static.is-empty', '');

      const status = h('span.mw-slot-status', {
        title: s.kind === 'human' ? 'Connected' : s.kind === 'host' ? 'Host' : '',
      }, s.kind === 'human' || s.kind === 'host' ? '●' : '');

      setChildren(row, h('span.mw-slot-num', String(i + 1)), swatch, who, pantheon, team, status);
    }

    // ---- presets & map ----
    const presetBtns = [
      ['coop', 'Co-op vs AI', 'All humans together against AI opponents'],
      ['1v1', '1v1', 'One against one on a small map'],
      ['2v2', '2v2', 'Two teams of two'],
      ['ffa', 'Free-for-all', 'Every player for themselves'],
    ].map(([id, label, title]) => h('button.mw-chip-btn', { type: 'button', title, dataset: { preset: id }, onclick: () => {
      try {
        // false: the layout cannot hold the players already in the room (or the game has started)
        if (lobby.applyPreset(id) === false && !lobby.started) {
          const n = st().slots.filter(M.isHuman).length;
          toast(`${label} does not fit the ${n} players in this room. Remove a player first.`);
        }
      } catch (err) {
        toast(err?.message || 'Could not apply that preset.');
      }
    } }, label));
    const mapBtns = Object.entries(MAP_SIZES).map(([id, n]) => h('button.mw-seg', {
      type: 'button',
      dataset: { size: id },
      onclick: () => {
        try {
          lobby.setMapSize(id);
        } catch (err) {
          toast(err?.message || 'Could not change the map size.');
        }
      },
    }, h('span', id === 'small' ? 'Small' : 'Medium'), h('small', `${n}×${n}`)));
    const mapStatic = h('div.mw-map-static');
    // Landscape (DESIGN 6.7): the ground between the bases, or Random (drawn when the game starts).
    const landBtns = LANDSCAPE_CHOICES.map((id) => {
      const info = landscapeInfo(id);
      return h('button.mw-chip-btn', {
        type: 'button',
        title: info.blurb,
        dataset: { landscape: id },
        onclick: () => {
          try {
            if (typeof lobby.setLandscape === 'function') lobby.setLandscape(id);
          } catch (err) {
            toast(err?.message || 'Could not change the landscape.');
          }
        },
      }, `${info.icon} ${info.name}`);
    });
    const landNote = h('div.mw-hint.mw-landscape-note');
    const landStatic = h('div.mw-map-static');
    // Game mode: a standard game, or the Decade of Peace with the host's pick of 30 / 45 / 60 minutes.
    let lastPeace = PEACE_LENGTHS[0]; // the length the mode comes back with when it is switched on again
    const setPeace = (minutes) => {
      try {
        lobby.setPeace(minutes);
      } catch (err) {
        toast(err?.message || 'Could not change the game mode.');
      }
    };
    const setSurvival = () => {
      try {
        if (typeof lobby.setSurvival === 'function') lobby.setSurvival(true);
      } catch (err) {
        toast(err?.message || 'Could not change the game mode.');
      }
    };
    const modeBtns = [
      ['standard', 'Standard', 'Fight from the first minute.', () => setPeace(0)],
      ['peace', PEACE_NAME, `No player can harm another, or build near an enemy Town Center, for the first ${PEACE_LENGTHS.join(', ')} minutes: time to build and mass armies for one great battle.`, () => setPeace(lastPeace)],
      ['survival', SURVIVAL_NAME, `Survival: every player and AI on one team against ever larger waves of mythical monsters, with a Titan leading every ${ordinal(SURVIVAL_BOSS_EVERY)} wave. Hold out as long as you can.`, setSurvival],
    ].map(([id, label, title, pick]) => h('button.mw-seg', { type: 'button', title, dataset: { mode: id }, onclick: pick }, h('span', label)));
    const peaceBtns = PEACE_LENGTHS.map((m) => h('button.mw-seg', {
      type: 'button',
      dataset: { peace: String(m) },
      onclick: () => {
        lastPeace = m;
        setPeace(m);
      },
    }, h('span', `${m} min`)));
    const peaceRow = h('div.mw-peace-row',
      h('span.mw-peace-label', 'Peace lasts'),
      h('div.mw-segmented', peaceBtns),
      h('div.mw-hint.mw-peace-hint', 'Creatures still fight. A horn sounds when the peace ends.'),
    );
    const survivalBest = h('span.mw-survival-best');
    const survivalRow = h('div.mw-peace-row.mw-survival-row',
      h('div.mw-hint.mw-peace-hint', `Everyone plays on one team. The first wave comes at ${clockText(SURVIVAL_FIRST_WAVE)}, then one every ${SURVIVAL_INTERVAL} s, and a Titan leads every ${ordinal(SURVIVAL_BOSS_EVERY)} wave. Clearing a wave pays gold. The trial ends when your last building falls.`, ' ', survivalBest),
    );
    const modeStatic = h('div.mw-map-static');
    // Victory: destroy every enemy building, and with Sacred Victory on, holding every sacred site for 8 minutes too.
    const sacredInput = h('input', {
      type: 'checkbox',
      onchange: () => {
        try {
          lobby.setSacred(sacredInput.checked);
        } catch (err) {
          toast(err?.message || 'Could not change the victory rules.');
        }
      },
    });
    const sacredToggle = h('label.mw-toggle.mw-sacred-toggle', { title: M.SACRED_HINT }, sacredInput,
      h('span.mw-toggle-track', { 'aria-hidden': 'true' }, h('span.mw-toggle-knob')),
      h('span.mw-toggle-text', h('span', SACRED_NAME), h('small', M.SACRED_NOTE)));
    const victoryStatic = h('div.mw-map-static');
    const options = h('div.mw-lobby-options',
      isHost ? h('div.mw-opt-group',
        h('div.mw-label', 'Presets'),
        h('div.mw-chip-row', presetBtns),
      ) : null,
      h('div.mw-opt-group',
        h('div.mw-label', 'Map'),
        isHost ? h('div.mw-segmented', mapBtns) : mapStatic,
      ),
      h('div.mw-opt-group.mw-landscape-group',
        h('div.mw-label', 'Landscape'),
        isHost ? [h('div.mw-chip-row', landBtns), landNote] : landStatic,
      ),
      h('div.mw-opt-group.mw-mode-group',
        h('div.mw-label', 'Game mode'),
        isHost ? [h('div.mw-segmented', modeBtns), peaceRow, survivalRow] : [modeStatic, survivalRow],
      ),
      h('div.mw-opt-group.mw-victory-group',
        h('div.mw-label', 'Victory'),
        isHost ? [sacredToggle, victoryStatic] : victoryStatic,
      ),
    );

    // ---- side panel ----
    let side;
    let chatLog = null;
    let chatInput = null;
    let preview = null;
    let previewId = null;
    if (online) {
      // The code is shown and copied cleaned to the room-code alphabet (a client gets it from the host).
      const code = M.cleanRoomCode(lobby.roomCode || st().roomCode || '');
      const copyBtn = (label, getText, okText) => {
        const b = h('button.mw-btn.mw-btn--small', { type: 'button', onclick: async () => {
          const ok = await copyText(getText());
          b.classList.toggle('is-done', ok);
          const prev = b.textContent;
          b.textContent = ok ? okText : 'Copy failed';
          setTimeout(() => {
            b.textContent = prev;
            b.classList.remove('is-done');
          }, 1600);
        } }, label);
        return b;
      };
      chatLog = h('ul.mw-chat-log', { 'aria-live': 'polite' });
      chatInput = h('input.mw-input.mw-chat-input', {
        type: 'text',
        maxLength: 200,
        placeholder: 'Say something to the lobby…',
        'aria-label': 'Chat message',
        onkeydown: (e) => {
          if (e.key === 'Enter') sendChat();
        },
      });
      const sendChat = () => {
        const text = chatInput.value.trim();
        if (!text) return;
        try {
          lobby.sendChat(text);
          chatInput.value = '';
        } catch (err) {
          toast(err?.message || 'Could not send the message.');
        }
      };
      side = h('aside.mw-lobby-side',
        h('section.mw-panel.mw-room',
          h('div.mw-label', 'Room code'),
          h('div.mw-room-code', { 'aria-label': `Room code ${code.split('').join(' ')}` }, code.split('').map((ch) => h('span', ch))),
          h('div.mw-room-actions',
            copyBtn('Copy Code', () => code, 'Code copied ✓'),
            copyBtn('Copy Invite Link', () => M.inviteLink(location.href, code), 'Link copied ✓'),
          ),
          isHost
            ? h('ol.mw-room-steps',
              h('li', h('strong', 'Easiest: '), 'Copy Invite Link and send it to your friends. Opening it takes them straight into this room.'),
              h('li', h('strong', 'Or: '), `tell them the code ${code}. They choose Join Online Game on the title screen and type it in.`),
              h('li', 'Keep this lobby open. Joined players appear in the list; then press Start Battle.'))
            : h('p.mw-hint', 'You are in the host\'s room. To bring more friends, send them the invite link or this code (Join Online Game → enter the code).'),
          M.customServerNote(location.href) ? h('p.mw-hint.mw-room-server', M.customServerNote(location.href)) : null,
        ),
        h('section.mw-panel.mw-chat',
          h('div.mw-label', 'Chat'),
          chatLog,
          h('div.mw-chat-row', chatInput, h('button.mw-btn.mw-btn--small', { type: 'button', onclick: sendChat }, 'Send')),
        ),
      );
    } else {
      preview = h('div.mw-preview-body');
      side = h('aside.mw-lobby-side',
        h('section.mw-panel.mw-preview',
          h('div.mw-label', 'Your pantheon'),
          preview,
        ),
      );
    }

    function renderPreview() {
      if (!preview) return;
      const s = st().slots[myIndex()];
      const id = s ? s.pantheon : 'random';
      if (id === previewId) return;
      previewId = id;
      const sum = summaryFor(id);
      if (!sum) {
        setChildren(preview,
          h('div.mw-preview-head', h('span.mw-preview-emblem', pantheonEmblem('random')), h('div', h('div.mw-preview-name', 'Random'), h('div.mw-preview-culture', 'Let the Fates decide'))),
          h('p.mw-preview-desc', 'A pantheon will be drawn by lot when the battle begins. Choose one of the ten mythologies below, or click your pantheon in the player list.'),
          // each pantheon by emblem and name; a click chooses it
          h('div.mw-random-list', PANTHEON_LIST.map((p) => h('button.mw-random-pick', { type: 'button', title: `Play the ${p.name} pantheon`, onclick: () => patchSlot(myIndex(), { pantheon: p.id }) },
            h('span.mw-random-emblem', { 'aria-hidden': 'true' }, pantheonEmblem(p.id)),
            h('span.mw-random-name', p.name)))),
        );
        return;
      }
      setChildren(preview,
        h('div.mw-preview-head', { style: { '--p-accent': sum.colors.accent || '#d4af37' } },
          h('span.mw-preview-emblem', sum.emblem),
          h('div', h('div.mw-preview-name', sum.name), h('div.mw-preview-culture', sum.culture))),
        h('p.mw-preview-desc', { title: sum.description }, sum.description),
        styleLine(sum),
        sum.blessings.length ? h('div.mw-pcard-label', 'Blessings') : null,
        sum.blessings.length ? h('ul.mw-pcard-gods', sum.blessings.map(blessingRow)) : null,
        h('div.mw-pcard-label', 'Gods'),
        h('ul.mw-pcard-gods', sum.gods.map((g) => unitRow(g, 'god'))),
        h('div.mw-pcard-label', 'Titan'),
        h('ul.mw-pcard-small', sum.titan ? unitRow(sum.titan, 'god') : null),
        h('div.mw-pcard-label', 'Creatures'),
        h('div.mw-preview-chips',
          sum.creatures.map((c) => h('span.mw-chip', { title: c.description }, `${c.icon} ${c.name}`, c.air ? h('span.mw-air', { title: 'Flying' }, '✈') : null)),
        ),
        sum.elite ? h('div.mw-pcard-label', 'Elite soldier') : null,
        sum.elite ? h('ul.mw-pcard-small', unitRow(sum.elite, 'elite')) : null,
      );
    }

    // ---- footer ----
    const matchup = h('div.mw-matchup');
    const reason = h('div.mw-start-reason');
    const startBtn = isHost ? h('button.mw-btn.mw-btn--primary.mw-btn--start', { type: 'button', onclick: startGame }, 'Start Battle') : null;
    const footer = h('footer.mw-lobby-foot',
      matchup,
      h('div.mw-start-wrap',
        reason,
        startBtn || h('div.mw-wait-host', h('span.mw-dots', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), 'Waiting for the host to start the battle'),
      ),
    );

    function renderFooter() {
      const parts = M.matchupSummary(st());
      if (M.survivalMode(st()) && parts.length) {
        setChildren(matchup, h('span.mw-team',
          h('span.mw-team-label', 'Together'),
          parts.flatMap((p) => p.names.map((n, j) => h('span.mw-team-name', { style: { '--c': p.colors[j] } }, n)))),
        h('span.mw-vs', 'vs'), h('span.mw-team', h('span.mw-team-label', 'The monster waves')));
      } else setChildren(matchup, parts.length ? parts.map((p, k) => [
        k ? h('span.mw-vs', 'vs') : null,
        h('span.mw-team',
          h('span.mw-team-label', `Team ${p.team}`),
          p.names.map((n, j) => h('span.mw-team-name', { style: { '--c': p.colors[j] } }, n))),
      ]) : h('span.mw-hint', 'No players yet.'));
      if (startBtn) {
        const status = M.startStatus(lobby, { online });
        startBtn.disabled = !status.ok;
        reason.textContent = status.ok ? 'All set. May the gods favor you.' : status.reason;
        reason.classList.toggle('is-ok', status.ok);
      }
    }

    function renderOptions() {
      const size = st().mapSize;
      mapBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.size === size));
      presetBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.preset === st().preset));
      mapStatic.textContent = `${size === 'medium' ? 'Medium' : 'Small'} (${MAP_SIZES[size] || '?'}×${MAP_SIZES[size] || '?'})`;
      const land = M.landscapeChoice(st());
      landBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.landscape === land));
      landNote.textContent = landscapeInfo(land).blurb;
      landStatic.textContent = M.landscapeLabel(st());
      const peace = M.peaceMinutes(st());
      if (peace) lastPeace = peace;
      const survival = M.survivalMode(st());
      const mode = survival ? 'survival' : peace > 0 ? 'peace' : 'standard';
      modeBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.mode === mode));
      peaceBtns.forEach((b) => b.classList.toggle('is-active', Number(b.dataset.peace) === peace));
      peaceRow.hidden = peace === 0;
      survivalRow.hidden = !survival;
      const best = survival ? getCareer().best.wave : 0;
      survivalBest.textContent = best > 0 ? `Your best: wave ${best}.` : '';
      modeStatic.textContent = M.gameModeLabel(st());
      sacredInput.checked = M.sacredOn(st());
      victoryStatic.textContent = M.victoryLabel(st());
      if (isHost) {
        // A trial has no rival team to win against: the Sacred Victory toggle gives way to the trial's goal.
        sacredToggle.hidden = survival;
        victoryStatic.hidden = !survival;
      }
    }

    function renderAll() {
      if (!alive) return;
      for (let i = 0; i < M.SLOT_COUNT; i++) renderRow(i);
      const note = M.difficultyNote(st(), { online, suggested });
      diffNote.textContent = note;
      diffNote.hidden = !note;
      renderOptions();
      renderPreview();
      renderFooter();
    }

    function addChat(a, b) {
      if (!alive || !chatLog) return;
      const m = M.normalizeChat(a, b);
      if (!m.text) return;
      const line = m.system
        ? h('li.mw-chat-line.is-system', m.text)
        : h('li.mw-chat-line', h('span.mw-chat-from', `${m.from}:`), ' ', h('span.mw-chat-text', m.text));
      const nearBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 40;
      chatLog.appendChild(line);
      while (chatLog.children.length > 200) chatLog.firstChild.remove();
      if (nearBottom) chatLog.scrollTop = chatLog.scrollHeight;
    }

    async function startGame() {
      if (!startBtn || startBtn.disabled) return;
      startBtn.disabled = true;
      try {
        const res = await lobby.start();
        if (!res || !res.setup) throw new Error('The lobby did not produce a game setup.');
        alive = false;
        launchedLobby = lobby;
        sfx.play('horn');
        onStart({ role: 'host', setup: res.setup, myIndex: res.myIndex, conns: res.conns || new Map(), lobby });
      } catch (err) {
        startBtn.disabled = false;
        toast(err?.message || 'Could not start the game.');
        renderFooter();
      }
    }

    function leave() {
      if (leaving) return;
      // The host leaving closes the room for everyone who joined: ask once, for a few seconds.
      if (isHost && online && !leaveArmed && st().slots.some((s) => s && s.kind === 'human')) {
        leaveArmed = true;
        leaveBtn.textContent = 'Close room?';
        toast('Leaving closes the room for everyone. Press Leave or Esc again to confirm.', 'info', 3200);
        leaveTimer = setTimeout(() => {
          leaveArmed = false;
          leaveBtn.textContent = '‹ Leave';
        }, 3200);
        return;
      }
      clearTimeout(leaveTimer);
      leaving = true;
      alive = false;
      closeLobby(lobby);
      go('title');
    }

    // ---- wire the lobby ----
    const safeOn = (method, cb) => {
      if (typeof lobby[method] !== 'function') return;
      try {
        subs.push(lobby[method](cb));
      } catch (err) {
        console.warn(`[menu] lobby.${method} failed`, err);
      }
    };
    safeOn('onChange', () => renderAll());
    safeOn('onChat', addChat);
    if (!isHost) {
      safeOn('onStart', (info) => {
        if (!alive) return;
        alive = false;
        launchedLobby = lobby;
        sfx.play('horn');
        // The ticket back into this game if the link drops or the page reloads (src/net/rejoin-ticket.js).
        if (info.rejoin) saveTicket({ roomCode: lobby.roomCode || st().roomCode, token: info.rejoin, myIndex: info.myIndex, name: getSettings().name, transport: onlineTransport });
        onStart({ role: 'client', setup: info.setup, myIndex: info.myIndex, conn: info.conn, lobby, rejoin: info.rejoin || null, transport: onlineTransport });
      });
      safeOn('onKicked', (why) => {
        if (!alive) return;
        alive = false;
        go('join', { code: M.cleanRoomCode(lobby.roomCode || st().roomCode), error: M.cleanMessage(typeof why === 'string' ? why : why?.reason, 'You left the lobby.') });
      });
    }

    const leaveBtn = h('button.mw-btn.mw-btn--ghost.mw-btn--back', { type: 'button', onclick: leave }, '‹ Leave');
    const el = h('div.mw-lobby-wrap',
      h('div.mw-lobby',
        h('header.mw-lobby-head',
          leaveBtn,
          h('div.mw-lobby-titles',
            h('h2.mw-h2', 'Prepare for Battle'),
            h('div.mw-lobby-mode', M.lobbyModeLabel(role, transport)),
          ),
          h('div.mw-head-spacer'),
        ),
        h('main.mw-lobby-main',
          h('section.mw-panel.mw-players',
            h('div.mw-slot-head',
              h('span'), h('span'), h('span.mw-label', 'Player'), h('span.mw-label', 'Pantheon'), h('span.mw-label', 'Team'), h('span'),
            ),
            slotList,
            diffNote,
          ),
          h('section.mw-panel.mw-options-panel', options),
        ),
        side,
      ),
      h('div.mw-lobby-dock', footer),
    );
    renderAll();
    if (online && isHost && chatLog && chatLog.children.length === 0) {
      addChat(null, `Room ${M.cleanRoomCode(lobby.roomCode)} is open. Send your friends the invite link, or the code for Join Online Game.`);
    }
    return {
      el,
      onEscape: leave,
      cleanup: () => {
        alive = false;
        clearTimeout(leaveTimer);
        unsubAll(subs);
      },
    };
  }

  // ---------------------------------------------------------- join

  function joinScreen({ code = '', error = null } = {}) {
    let attempt = 0;
    let joinAbort = null; // AbortController of the attempt in flight (cancels the PeerJS peer / handshake)
    const nameInput = h('input.mw-input', {
      type: 'text',
      maxLength: 20,
      value: getSettings().name,
      autocomplete: 'nickname',
      'aria-label': 'Your name',
      onchange: () => saveSettings({ name: nameInput.value }),
    });
    const codeInput = h('input.mw-input.mw-code-input', {
      type: 'text',
      value: M.cleanRoomCode(code),
      placeholder: '•••••',
      spellcheck: 'false',
      autocomplete: 'off',
      autocapitalize: 'characters',
      'aria-label': 'Room code',
      oninput: () => {
        const raw = codeInput.value;
        const clean = M.cleanRoomCode(raw);
        if (clean !== raw) {
          // Keep the caret where the player is typing: count the code characters before it.
          const caret = codeInput.selectionStart ?? raw.length;
          const valid = (t) => [...t.toUpperCase()].filter((c) => ROOM_CODE_ALPHABET.includes(c)).join('');
          const plain = clean === valid(raw).slice(0, ROOM_CODE_LENGTH); // only unusable characters were dropped
          const at = plain ? Math.min(valid(raw.slice(0, caret)).length, clean.length) : clean.length;
          codeInput.value = clean;
          try {
            codeInput.setSelectionRange(at, at);
          } catch {
            // not all inputs allow it
          }
        }
        joinBtn.disabled = !M.isCompleteRoomCode(clean);
        setStatus(null);
      },
      onkeydown: (e) => {
        if (e.key === 'Enter') join();
      },
    });
    const status = h('div.mw-join-status', { role: 'status', 'aria-live': 'polite' });
    const joinBtn = h('button.mw-btn.mw-btn--primary', { type: 'button', onclick: () => join() }, 'Join Game');
    const backBtn = h('button.mw-btn.mw-btn--ghost', { type: 'button', onclick: () => back() }, 'Back');
    joinBtn.disabled = !M.isCompleteRoomCode(codeInput.value);

    function setStatus(kind, text, extra) {
      status.className = `mw-join-status${kind ? ` is-${kind}` : ''}`;
      if (!kind) return setChildren(status);
      if (kind === 'busy') setChildren(status, h('div.mw-spinner.mw-spinner--small', { 'aria-hidden': 'true' }), h('span', text), extra || null);
      else setChildren(status, h('span.mw-status-icon', kind === 'error' ? '⚠' : '✦'), h('span', text));
    }

    function setBusy(on) {
      nameInput.disabled = on;
      codeInput.disabled = on;
      joinBtn.disabled = on || !M.isCompleteRoomCode(codeInput.value);
      joinBtn.textContent = on ? 'Connecting…' : 'Join Game';
    }

    function abortJoin() {
      const ctrl = joinAbort;
      joinAbort = null;
      if (ctrl) ctrl.abort();
    }

    function back() {
      attempt++;
      abortJoin();
      dropUrlParam('join');
      go('title');
    }

    async function join() {
      const roomCode = M.cleanRoomCode(codeInput.value);
      if (!M.isCompleteRoomCode(roomCode)) {
        setStatus('error', 'Enter the 5-character room code from the host.');
        sfx.play('error');
        codeInput.focus();
        return;
      }
      const name = saveSettings({ name: nameInput.value }).name;
      nameInput.value = name;
      const my = ++attempt;
      abortJoin();
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      joinAbort = ctrl;
      setBusy(true);
      const cancel = h('button.mw-link', { type: 'button', onclick: () => {
        attempt++;
        abortJoin();
        setBusy(false);
        setStatus(null);
      } }, 'Cancel');
      setStatus('busy', `Connecting to room ${roomCode}…`, cancel);
      try {
        const mod = await loadLobby();
        const lobby = await mod.LobbyClient.join({ transport: onlineTransport, roomCode, name, signal: ctrl ? ctrl.signal : undefined });
        if (joinAbort === ctrl) joinAbort = null;
        if (my !== attempt) {
          closeLobby(lobby);
          return;
        }
        dropUrlParam('join');
        sfx.play('select');
        go('lobby', { lobby, role: 'client', transport: onlineTransport });
      } catch (err) {
        if (joinAbort === ctrl) joinAbort = null;
        if (my !== attempt) return;
        setBusy(false);
        if (err && err.type === 'aborted') return setStatus(null); // cancelled: not an error
        setStatus('error', M.friendlyJoinError(err, roomCode));
        sfx.play('error');
      }
    }

    if (error) setStatus('error', M.friendlyJoinError(error, M.cleanRoomCode(code)));
    const el = h('div.mw-center-screen',
      h('section.mw-panel.mw-form-panel.mw-join',
        h('h2.mw-h2', 'Join Online Game'),
        h('p.mw-panel-sub', 'Ask the host for the 5-character room code shown in their lobby. Codes use the letters A-Z (no I or O) and the digits 2-9.'),
        h('label.mw-field', h('span.mw-label', 'Your name'), nameInput),
        h('label.mw-field', h('span.mw-label', 'Room code'), codeInput),
        status,
        h('div.mw-form-actions', backBtn, joinBtn),
        h('p.mw-hint', 'Tip: opening a friend\'s invite link fills in the code for you. Pasting the whole link here works too.'),
      ),
    );
    return { el, focus: M.isCompleteRoomCode(codeInput.value) ? joinBtn : codeInput, onEscape: back, cleanup: () => { attempt++; abortJoin(); } };
  }

  // ---------------------------------------------------------- rejoin

  /** Back into an online game this browser dropped out of (DESIGN 7), with the ticket the host gave it. */
  function rejoinScreen() {
    const ticket = readTicket();
    let alive = true;
    let ctrl = null;
    const status = h('div.mw-join-status', { role: 'status', 'aria-live': 'polite' });
    const actions = h('div.mw-form-actions');
    const backBtn = h('button.mw-btn.mw-btn--ghost', { type: 'button', onclick: () => back() }, 'Back');
    const retryBtn = h('button.mw-btn.mw-btn--primary', { type: 'button', onclick: () => attempt() }, 'Try Again');

    function back() {
      alive = false;
      if (ctrl) ctrl.abort();
      go('title');
    }

    function show(kind, text, retry) {
      status.className = `mw-join-status is-${kind}`;
      if (kind === 'busy') setChildren(status, h('div.mw-spinner.mw-spinner--small', { 'aria-hidden': 'true' }), h('span', text));
      else setChildren(status, h('span.mw-status-icon', kind === 'error' ? '⚠' : '✦'), h('span', text));
      setChildren(actions, backBtn, retry ? retryBtn : null);
    }

    async function attempt() {
      if (!ticket) return show('error', 'There is no online game to rejoin from this browser.', false);
      if (ctrl) ctrl.abort();
      const my = ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      show('busy', `Rejoining room ${ticket.roomCode}…`, false);
      try {
        // Fetch the game's code before connecting: the host counts every second of silence on the new link.
        await Promise.all([import('../game/game.js'), import('../render/game-renderer.js'), import('../ai/ai.js')]).catch(() => {});
        if (!alive || ctrl !== my) return;
        const mod = await loadLobby();
        if (!mod.LobbyClient || typeof mod.LobbyClient.rejoin !== 'function') throw Object.assign(new Error('Rejoining is not available here.'), { refused: true });
        // Its room, then the heir's; while neither answers the host may be moving the game: keep looking a while.
        const found = await seekGame({
          ticket,
          rejoin: (o) => mod.LobbyClient.rejoin(o),
          signal: my ? my.signal : undefined,
          onWait: () => { if (alive && ctrl === my) show('busy', 'Looking for the game… The host may be handing it to another player.', false); },
        });
        const info = found.info;
        if (!alive || ctrl !== my) {
          info.conn.close('left');
          return;
        }
        alive = false;
        // Found at the heir's: the ticket follows the game there (a later reload goes straight to it).
        if (found.room !== ticket.roomCode) saveTicket({ ...ticket, roomCode: found.room, proof: found.proof, next: null });
        sfx.play('horn');
        onStart({ role: 'client', setup: info.setup, myIndex: info.myIndex, conn: info.conn, lobby: null, rejoin: ticket.token, transport: ticket.transport });
      } catch (err) {
        if (!alive || ctrl !== my || (err && err.type === 'aborted')) return;
        const msg = M.cleanMessage(err && err.message, 'Could not rejoin the game.');
        // The host said no (the game is over, or this browser is not in it), or the room is gone with the host: forget it.
        // (seekGame gave up on a room nobody answers at only after REJOIN_SEEK_MS: `gone`.)
        const gone = !!(err && (err.gone || (err.refused && !err.retry)));
        if (gone) clearTicket(undefined, ticket.token);
        show('error', err && err.gone ? msg : M.friendlyJoinError(err, ticket.roomCode), !gone);
        sfx.play('error');
      }
    }

    attempt();
    const el = h('div.mw-center-screen',
      h('section.mw-panel.mw-form-panel.mw-join.mw-rejoin',
        h('h2.mw-h2', 'Rejoin Online Game'),
        h('p.mw-panel-sub', ticket
          ? `While you are away, an AI plays for ${ticket.name}. Rejoining gives you your seat back, with everything your side has now.`
          : 'Nothing to rejoin.'),
        status,
        actions,
      ),
    );
    return { el, focus: backBtn, onEscape: back, cleanup: () => { alive = false; if (ctrl) ctrl.abort(); } };
  }

  // ---------------------------------------------------------- rematch

  /**
   * Into the lobby of an online game's rematch (DESIGN 7): the host has opened its room again, and my token of
   * the last game gives me my seat back there. opts.join: { roomCode, token, transport, name }.
   */
  function rematchScreen({ join = null } = {}) {
    let alive = true;
    let ctrl = null;
    const roomCode = join ? M.cleanRoomCode(join.roomCode) : '';
    const status = h('div.mw-join-status', { role: 'status', 'aria-live': 'polite' });
    const actions = h('div.mw-form-actions');
    const backBtn = h('button.mw-btn.mw-btn--ghost', { type: 'button', onclick: () => back() }, 'Back');
    const retryBtn = h('button.mw-btn.mw-btn--primary', { type: 'button', onclick: () => attempt() }, 'Try Again');

    function back() {
      alive = false;
      if (ctrl) ctrl.abort();
      go('title');
    }

    function show(kind, text, retry) {
      status.className = `mw-join-status is-${kind}`;
      if (kind === 'busy') setChildren(status, h('div.mw-spinner.mw-spinner--small', { 'aria-hidden': 'true' }), h('span', text));
      else setChildren(status, h('span.mw-status-icon', '⚠'), h('span', text));
      setChildren(actions, backBtn, retry ? retryBtn : null);
    }

    async function attempt() {
      if (!roomCode) return show('error', 'There is no rematch to join.', false);
      if (ctrl) ctrl.abort();
      const my = ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      show('busy', `Joining the rematch in room ${roomCode}…`, false);
      try {
        const mod = await loadLobby();
        const lobby = await mod.LobbyClient.join({
          transport: join.transport || onlineTransport, roomCode, name: getSettings().name || join.name, rematch: join.token,
          laterTries: 15, signal: my ? my.signal : undefined,
        });
        if (!alive || ctrl !== my) {
          closeLobby(lobby);
          return;
        }
        alive = false;
        sfx.play('select');
        go('lobby', { lobby, role: 'client', transport: join.transport || onlineTransport });
      } catch (err) {
        if (!alive || ctrl !== my || (err && err.type === 'aborted')) return;
        show('error', M.friendlyJoinError(err, roomCode), true);
        sfx.play('error');
      }
    }

    attempt();
    const el = h('div.mw-center-screen',
      h('section.mw-panel.mw-form-panel.mw-join.mw-rematch',
        h('h2.mw-h2', 'Rematch'),
        h('p.mw-panel-sub', 'Back to the lobby with the same players, sides and settings. The host starts the battle when everyone is in.'),
        status,
        actions,
      ),
    );
    return { el, focus: backBtn, onEscape: back, cleanup: () => { alive = false; if (ctrl) ctrl.abort(); } };
  }

  // ---------------------------------------------------------- how to play

  function howToScreen() {
    const backBtn = h('button.mw-btn.mw-btn--ghost', { type: 'button', onclick: () => go('title') }, '‹ Back');
    const el = h('div.mw-center-screen.mw-wide-screen',
      h('section.mw-panel.mw-howto-panel',
        h('header.mw-panel-head', backBtn, h('h2.mw-h2', 'How to Play'), h('span.mw-head-spacer')),
        h('div.mw-scroll', renderHowToContent()),
      ),
    );
    return { el, focus: backBtn, onEscape: () => go('title') };
  }

  // ---------------------------------------------------------- career

  function careerScreen() {
    const backBtn = h('button.mw-btn.mw-btn--ghost', { type: 'button', onclick: () => go('title') }, '‹ Back');
    const c = getCareer();
    const unseen = new Set(c.unseen);
    markSeen(); // the "New" badges show this time only
    const el = h('div.mw-center-screen.mw-wide-screen',
      h('section.mw-panel.mw-howto-panel.mw-career-panel',
        h('header.mw-panel-head', backBtn, h('h2.mw-h2', `Career of ${getSettings().name}`), h('span.mw-head-spacer')),
        h('div.mw-scroll', renderCareerContent(c, unseen, onReplay ? renderReplays({ onWatch: (what) => onReplay(what), toast }) : null),
          h('p.mw-hint', 'Your career is kept in this browser on this device. A game counts once it ends, or when you leave it after its first minute.')),
      ),
    );
    return { el, focus: backBtn, onEscape: () => go('title') };
  }

  // ---------------------------------------------------------- settings

  function settingsScreen() {
    const s = getSettings();
    const nameInput = h('input.mw-input', {
      type: 'text',
      maxLength: 20,
      value: s.name,
      'aria-label': 'Player name',
      onchange: () => {
        nameInput.value = saveSettings({ name: nameInput.value }).name;
      },
    });
    const volValue = h('output.mw-range-value', `${Math.round(s.volume * 100)}%`);
    const volume = h('input.mw-range', {
      type: 'range',
      min: '0',
      max: '100',
      step: '1',
      value: String(Math.round(s.volume * 100)),
      'aria-label': 'Sound effects volume',
      oninput: () => {
        saveSettings({ volume: Number(volume.value) / 100 });
        volValue.textContent = `${volume.value}%`;
        volume.style.setProperty('--fill', `${volume.value}%`);
      },
    });
    volume.style.setProperty('--fill', `${volume.value}%`);
    const testSounds = ['horn', 'heal', 'lightning', 'summon_god', 'building_complete'];
    let testIdx = 0;
    const testBtn = h('button.mw-btn.mw-btn--small.mw-silent', { type: 'button', onclick: () => {
      sfx.unlock();
      sfx.setVolume(getSettings().volume);
      const n = testSounds[testIdx++ % testSounds.length];
      if (!sfx.play(n)) setTimeout(() => sfx.play(n), 60);
    } }, '♪ Test sound');

    // The music: its own volume and mute (the sound effects keep theirs), and a way to hear each pantheon's
    // score without starting a match. Leaving Settings goes back to the title music (see go()).
    const musicOut = h('output.mw-range-value');
    const musicRange = h('input.mw-range', {
      type: 'range',
      min: '0',
      max: '100',
      step: '1',
      value: String(Math.round(s.musicVolume * 100)),
      'aria-label': 'Music volume',
      oninput: () => {
        const v = Number(musicRange.value) / 100;
        // Moving the slider is asking to hear the music: it lifts a mute too.
        saveSettings(v > 0 && getSettings().musicMuted ? { musicVolume: v, musicMuted: false } : { musicVolume: v });
        renderMusic();
      },
    });
    const muteBtn = h('button.mw-btn.mw-btn--small', { type: 'button', onclick: () => {
      saveSettings({ musicMuted: !getSettings().musicMuted });
      renderMusic();
    } });
    const renderMusic = () => {
      const m = getSettings();
      const pct = Math.round(m.musicVolume * 100);
      musicOut.textContent = `${pct}%`;
      musicRange.style.setProperty('--fill', `${pct}%`);
      musicRange.classList.toggle('is-muted', m.musicMuted);
      muteBtn.textContent = m.musicMuted ? 'Unmute' : 'Mute';
      muteBtn.setAttribute('aria-pressed', String(m.musicMuted));
    };
    renderMusic();
    const previewThemes = [['menu', 'Title screen'], ...PANTHEON_LIST.map((p) => [p.id, p.name])];
    let previewIdx = 0;
    let previewMood = -1;
    const previewName = h('span.mw-music-listen-name', previewThemes[0][1]);
    const moodBtns = PREVIEW_MOODS.map(([label], i) => h('button.mw-seg', { type: 'button', dataset: { mood: String(i) }, onclick: () => {
      previewMood = i;
      playPreview();
    } }, label));
    const playPreview = () => {
      previewName.textContent = previewThemes[previewIdx][1];
      moodBtns.forEach((b, i) => b.classList.toggle('is-active', i === previewMood));
      previewMusic(previewThemes[previewIdx][0], PREVIEW_MOODS[Math.max(0, previewMood)][1]);
    };
    const stepPreview = (d) => {
      previewIdx = (previewIdx + previewThemes.length + d) % previewThemes.length;
      playPreview();
    };
    const preview = h('div.mw-music-listen',
      h('span.mw-music-listen-label', 'Listen'),
      h('button.mw-btn.mw-btn--small', { type: 'button', 'aria-label': 'Previous theme', onclick: () => stepPreview(-1) }, '‹'),
      previewName,
      h('button.mw-btn.mw-btn--small', { type: 'button', 'aria-label': 'Next theme', onclick: () => stepPreview(1) }, '›'),
      h('div.mw-segmented', moodBtns));

    const qualities = QUALITY_OPTIONS;
    const qDesc = h('div.mw-field-note');
    const qBtns = qualities.map(([id, label]) => h('button.mw-seg', { type: 'button', dataset: { q: id }, onclick: () => {
      saveSettings({ quality: id });
      renderQ();
    } }, label));
    const renderQ = () => {
      const q = getSettings().quality;
      qBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.q === q));
      qDesc.textContent = qualities.find((x) => x[0] === q)?.[2] || '';
    };
    renderQ();

    const tDesc = h('div.mw-field-note');
    const tBtns = TIME_OF_DAY_OPTIONS.map(([id, label]) => h('button.mw-seg', { type: 'button', dataset: { t: id }, onclick: () => {
      saveSettings({ timeOfDay: id });
      renderT();
    } }, label));
    const renderT = () => {
      const t = getSettings().timeOfDay;
      tBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.t === t));
      tDesc.textContent = timeOfDayNote(t);
    };
    renderT();

    // Game speed (matches against the computer) and the size of the in-game interface.
    const segField = (key, options) => {
      const note = h('div.mw-field-note');
      const btns = options.map(([id, label]) => h('button.mw-seg', { type: 'button', dataset: { v: id }, onclick: () => {
        saveSettings({ [key]: id });
        render();
      } }, label));
      const render = () => {
        const v = getSettings()[key];
        btns.forEach((b) => b.classList.toggle('is-active', b.dataset.v === v));
        note.textContent = optionNote(options, v);
      };
      render();
      return [h('div.mw-segmented', btns), note];
    };

    // Alerts (src/game/alerts.js) and what a background tab does about them (src/ui/tab-attention.js).
    const aNote = h('div.mw-field-note');
    const aBtns = ALERT_OPTIONS.map(([id, label]) => h('button.mw-seg', { type: 'button', dataset: { a: id }, onclick: () => {
      saveSettings({ alerts: id });
      renderA();
    } }, label));
    const renderA = () => {
      const a = getSettings().alerts;
      aBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.a === a));
      aNote.textContent = alertNote(a);
    };
    renderA();

    const wNote = h('div.mw-field-note');
    const wBtns = TAB_ALERT_OPTIONS.map(([id, label]) => h('button.mw-seg', { type: 'button', dataset: { w: id }, onclick: async () => {
      const got = await chooseTabAlerts(id); // 'notify' asks the browser for permission first
      if (got !== null) renderW(got !== id ? id : null); // (null: picked again meanwhile, that pick stands)
    } }, label));
    const renderW = (refused = null) => {
      const w = getSettings().tabAlerts;
      wBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.w === w));
      wNote.textContent = refused ? tabAlertNote(refused, notificationState(), true) : tabAlertNote(w);
    };
    renderW();

    const toggle = (key, label, note, invert = false) => {
      const input = h('input', { type: 'checkbox', checked: invert ? !getSettings()[key] : !!getSettings()[key], onchange: () => saveSettings({ [key]: invert ? !input.checked : input.checked }) });
      return h('label.mw-toggle', input, h('span.mw-toggle-track', { 'aria-hidden': 'true' }, h('span.mw-toggle-knob')), h('span.mw-toggle-text', h('span', label), note ? h('small', note) : null));
    };
    const keyPanel = buildKeyPanel(); // the camera and command card keys (src/ui/key-panel.js)
    const backBtn = h('button.mw-btn.mw-btn--ghost', { type: 'button', onclick: () => go('title') }, '‹ Back');
    const el = h('div.mw-center-screen',
      h('section.mw-panel.mw-form-panel.mw-settings',
        h('header.mw-panel-head', backBtn, h('h2.mw-h2', 'Settings'), h('span.mw-head-spacer')),
        h('label.mw-field', h('span.mw-label', 'Player name'), nameInput, h('span.mw-field-note', 'Shown to other players in online lobbies.')),
        h('div.mw-field', h('span.mw-label', 'Sound effects'),
          h('div.mw-range-row', volume, volValue, testBtn)),
        h('div.mw-field', h('span.mw-label', 'Music'),
          h('div.mw-range-row', musicRange, musicOut, muteBtn),
          preview,
          h('span.mw-field-note', 'Every pantheon has its own score: calm while you build, louder in a fight. The Decade of Peace stays calm until the war horn.')),
        h('div.mw-field', h('span.mw-label', 'Graphics quality'), h('div.mw-segmented', qBtns), qDesc),
        h('div.mw-field', h('span.mw-label', 'Time of day'), h('div.mw-segmented', tBtns), tDesc),
        h('div.mw-field', h('span.mw-label', 'Game speed'), ...segField('gameSpeed', GAME_SPEED_OPTIONS)),
        h('div.mw-field', h('span.mw-label', 'Interface size'), ...segField('uiScale', UI_SCALE_OPTIONS)),
        h('div.mw-field', h('span.mw-label', 'Team colours'), ...segField('teamColors', TEAM_COLOR_OPTIONS)),
        h('div.mw-field', h('span.mw-label', 'Command keys'), ...segField('cardKeys', CARD_KEY_OPTIONS)),
        h('div.mw-field', h('span.mw-label', 'Keys'), keyPanel.el),
        h('div.mw-field', h('span.mw-label', 'Intro film'),
          ...segField('intro', INTRO_OPTIONS),
          h('span.mw-field-note', 'A short film of the game before the title screen, with a score that follows the Music setting. Browsers keep sound off until a key press or a click, so it waits for one; allow sound for this site in your browser\'s site settings and it starts by itself. Esc skips it.'),
          toggle('narration', 'Narration', browserSpeech() || sfx.supported ? 'A narrator reads the film\'s captions aloud. It follows the Volume above.' : 'This browser cannot play the narration, so the film plays with its captions only.'),
          onIntro ? h('button.mw-btn.mw-btn--small.mw-silent.mw-intro-watch', { type: 'button', onclick: () => onIntro() }, '▶ Watch it now') : null),
        h('div.mw-field', h('span.mw-label', 'Gameplay'),
          toggle('edgeScroll', 'Edge scrolling', 'Move the camera when the mouse touches the screen edge.'),
          toggle('showAllBars', 'Always show health bars', 'Otherwise hold Alt to see them all.'),
          toggle('tipsDismissed', 'Getting-started tips', 'Show the new-player checklist in your next game.', true),
          toggle('hints', 'Gameplay tips', 'A short tip now and then during a match.'),
          toggle('aiChat', 'AI chatter', 'Computer players greet you, taunt you and beg for mercy in chat, each in the voice of its pantheon.'),
        ),
        h('div.mw-field', h('span.mw-label', 'Alerts'), h('div.mw-segmented', aBtns), aNote),
        h('div.mw-field', h('span.mw-label', 'When this tab is in the background'), h('div.mw-segmented', wBtns), wNote),
        h('p.mw-hint.mw-saved-note', '✓ Settings are saved automatically in this browser.'),
      ),
    );
    return { el, focus: backBtn, onEscape: () => go('title'), cleanup: () => keyPanel.dispose() };
  }

  // ------------------------------------------------------------ public

  const menu = {
    root,
    go,
    toast,
    /** Pin a warning to the title screen (null clears it), e.g. when the browser lacks WebGL 2. */
    setNotice(text) {
      titleNotice = text || null;
      if (current && current.name === 'title') go('title');
    },
    /** Show a screen. Closes the last match's lobby unless opts.keepLobby. */
    show(screen = 'title', opts = {}) {
      if (launchedLobby && !opts.keepLobby) {
        closeLobby(launchedLobby);
        launchedLobby = null;
      }
      root.hidden = false;
      backdrop.start();
      go(screen, opts);
    },
    hide() {
      root.hidden = true;
      backdrop.stop();
      root.querySelectorAll('.mw-overlay, .mw-popover').forEach((el) => el.remove());
    },
    get screen() {
      return current ? current.name : null;
    },
  };
  instance = menu;

  const joinCode = params.get('join');
  root.hidden = false;
  backdrop.start();
  if (joinCode) go('join', { code: joinCode });
  else go('title');
  return menu;
}
