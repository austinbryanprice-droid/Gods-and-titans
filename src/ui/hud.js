// In-game HUD (DESIGN 9): a Warcraft III–style HTML overlay in #hud-root.
//   top bar      gold, wood, faith (+rate), population, tier, clock, peace countdown, sacred sites, ping, menu, market
//   market       team trade panel under the top bar (only with a living teammate)
//   top-left     god portraits (F1–F3), and beside them the player list (hud-roster.js)
//   bottom-left  idle worshipper button and the worshipper task counts
//   bottom       god power buttons + minimap + team marker buttons | selection panel | 4×3 command card (+ tooltip)
//   groups       the control groups' chips over the selection panel (hud-groups.js)
//   team marks   pins over the battlefield (and arrows at its edge) for the pings and markers of my team
//   messages     errors (centre), alerts / info / chat (left), banners (top)
//   tips         the getting-started checklist and now-and-then gameplay tips (top-right); in the guided
//                first match its objective panel instead, a pin at the objective and lit card buttons
//   overlays     waiting, in-game menu (F10), game over, host left
// Only the panels take pointer events; everything else falls through to the canvas.
import { UNITS, PANTHEONS } from '../data/index.js';
import { PANTHEON_EMBLEMS } from './menu-model.js';
import { getCommandCard, withCardKeys } from './command-card.js';
import { cardKeysOf } from './key-bindings.js';
import { sanitizeName, sanitizeChat } from '../net/protocol.js';
import { el, setText, setStyle, setClass, setHidden, fmt, pct, hpColor, safeColor } from './hud-dom.js';
import { formatClock, tierName, nameOf, leadText, stallText, pauseText, workerTasks, WORKER_TASKS, PEACE_WARNINGS, peaceStartText, peaceWarning, messageIcon, messageDwell, tauntDwell, relicChip, chatTarget, hasAllies, pushHistory, evictIndex } from './hud-data.js';
import { peaceClock } from '../sim/peace.js';
import { SITE_ICON, siteChip, siteChipTitle, sacredStartText } from './hud-sites.js';
import { CardView } from './hud-card.js';
import { InfoView } from './hud-info.js';
import { Overlays } from './hud-overlays.js';
import { Minimap } from './minimap.js';
import { TipsView } from './hud-tips.js';
import { TutorialView, GuidePointer, lightCard } from './hud-tutorial.js';
import { CampaignView, missionPointer } from './hud-campaign.js';
import { HintsView, HintScheduler } from './hud-hints.js';
import { hintParts } from './hint-data.js';
import { MarketView, marketPartners } from './hud-market.js';
import { MarksLayer, MarkPalette, teammateCount, aiAllyCount } from './hud-marks.js';
import { PowerBar } from './hud-powers.js';
import { RosterView } from './hud-roster.js';
import { GroupBar } from './hud-groups.js';
import { TeamMarks } from '../game/team-marks.js';
import { getSettings, saveSettings, onSettingsChange } from '../settings.js';
import { sfx } from '../audio/sfx.js';
import { POP_MAX, PEACE_NAME, SURVIVAL_NAME, SURVIVAL_BOSS_EVERY } from '../config.js';
import { displayColor, relationColor, onTeamPaletteChange } from '../team-colors.js';

const CARD_REFRESH_MS = 120;
const IDLE_REFRESH_MS = 250;
const GODS_REFRESH_MS = 100;
const CHAT_MS = 14000;
const MESSAGE_FADE_MS = 600; // a card's fade-out (the CSS transition) before it leaves the page
const ERROR_MS = 2600;
const BANNER_MS = 4200;
const MAX_MESSAGES = 6;
const MAX_MESSAGE_CHARS = 240;
const SURVIVAL_ICON = '🐉'; // the Trial of the Titans' wave chip and messages
const WAVE_WARNING = 10; // seconds before a wave when the HUD says it is coming
const PEACE_ICON = '🕊️'; // the Decade of Peace's card emblem, as on its clock chip
const MARKS_HINT = 'Team ping: Alt+click or middle-click the map or minimap. The buttons beside the minimap mark where to attack, defend, gather or get help.';

export class Hud {
  /**
   * @param {object} o
   * @param {HTMLElement} o.root #hud-root
   * @param {object} o.game the Game (viewState, selection, input, renderer, session, …)
   */
  constructor({ root, game }) {
    this.root = root;
    this.game = game;
    this.vs = game.viewState;
    this.cardSig = '';
    this.lastCard = -Infinity;
    this.lastIdle = -Infinity;
    this.lastGods = -Infinity;
    this.idleIds = [];
    this.godSig = '';
    this.godEls = [];
    this.chatOpen = false;
    this.chatHistory = []; // the last chat and system lines, shown above the chat box while it is open (pushHistory)
    this.card =new Array(12).fill(null);
    this.offs = [];
    this.build();
  }

  // ---------------------------------------------------------------- DOM

  build() {
    const root = this.root;
    root.textContent = '';
    root.classList.add('hud');
    const game = this.game;
    // A replay (DESIGN 9.5) is watched: no command card, marker or power buttons, tips or hints.
    root.classList.toggle('is-replay', !!game.replay);

    // Team pings and markers: pins over the battlefield, under every panel (so added first).
    this.teamMarks = game.marks || new TeamMarks();
    this.marksLayer = new MarksLayer({
      root,
      marks: this.teamMarks,
      viewState: this.vs,
      getRenderer: () => game.renderer || null,
      getInsets: () => ({ top: this.top.offsetHeight || 0, bottom: this.bottom.offsetHeight || 0 }),
    });
    // The guided first match (hud-tutorial.js): a pin over the current objective, under the panels too.
    // A campaign mission (hud-campaign.js) points at its current objective the same way.
    const pointerOpts = {
      root,
      viewState: this.vs,
      getRenderer: () => game.renderer || null,
      getInsets: () => ({ top: this.top.offsetHeight || 0, bottom: this.bottom.offsetHeight || 0 }),
    };
    this.guidePointer = game.tutorial ? new GuidePointer({ ...pointerOpts, director: game.tutorial })
      : game.mission ? missionPointer(pointerOpts) : null;

    // Top bar.
    this.menuBtn = el('button', 'hud-menu-btn', el('span', 'hud-menu-ico', '☰'), el('span', null, 'Menu'), el('kbd', null, 'F10'));
    this.menuBtn.type = 'button';
    this.menuBtn.tabIndex = -1;
    this.menuBtn.addEventListener('click', () => this.overlays.toggleMenu());
    this.marketBtn = el('button', 'hud-menu-btn hud-market-btn', el('span', 'hud-menu-ico', '⚖️'), el('span', null, 'Market'));
    this.marketBtn.type = 'button';
    this.marketBtn.tabIndex = -1;
    this.marketBtn.title = 'Market — send gold, wood or faith to a teammate';
    this.marketBtn.hidden = true;
    this.marketBtn.addEventListener('click', () => this.toggleMarket());
    this.clock = el('span', 'hud-clock');
    // Decade of Peace: counts down to the first moment players may attack each other; gone once it is over.
    this.peaceClock = el('span', 'hud-clock');
    this.peaceChip = el('div', 'hud-time hud-peace', el('i', 'hud-res-i', PEACE_ICON), this.peaceClock);
    this.peaceChip.title = `${PEACE_NAME}: no player can harm another, or build near an enemy Town Center, until this clock runs out. Neutral creatures still fight.`;
    this.peaceChip.hidden = true;
    this.peaceMarks = null; // how many PEACE_WARNINGS the clock had passed when last looked at
    // Trial of the Titans: the wave reached, the monsters still alive and the clock to the next wave.
    this.waveText = el('span', 'hud-clock');
    this.waveChip = el('div', 'hud-time hud-wave', el('i', 'hud-res-i', SURVIVAL_ICON), this.waveText);
    this.waveChip.title = `${SURVIVAL_NAME}: monsters come out of the map's edges on this clock, more and stronger every wave, and a Titan leads every ${SURVIVAL_BOSS_EVERY}th one. Beating a wave pays gold. Hold out as long as you can.`;
    this.waveChip.hidden = true;
    this.waveWarned = null; // the last wave whose "coming in 10 s" message is behind us
    // Sacred sites held by my side (and the Sacred Victory countdown when a side holds them all).
    this.siteText = el('span', 'hud-clock');
    this.siteChip = el('div', 'hud-time hud-sites', el('i', 'hud-res-i', SITE_ICON), this.siteText);
    this.siteChip.hidden = true;
    // The daily challenge's twist (DESIGN 9.3), for the whole match: its icon and name, the rule in the tooltip.
    this.twistIcon = el('i', 'hud-res-i', '📅');
    this.twistText = el('span', 'hud-clock');
    this.twistChip = el('div', 'hud-time hud-twist', this.twistIcon, this.twistText);
    this.twistChip.hidden = true;
    this.ping = el('span', 'hud-ping');
    const res = (cls, icon, title) => {
      const v = el('b', 'hud-res-v');
      const n = el('div', `hud-res ${cls}`, el('i', 'hud-res-i', icon), v);
      n.title = title;
      return { n, v };
    };
    this.rGold = res('is-gold', '💰', 'Gold');
    this.rWood = res('is-wood', '🌲', 'Wood');
    this.rFaith = res('is-faith', '✨', 'Faith — earned by worshippers praying at Shrines and Temples');
    this.rFaithRate = el('small', 'hud-res-rate');
    this.rFaith.n.appendChild(this.rFaithRate);
    this.rPop = res('is-pop', '👥', `Population — build Houses to raise the limit (up to ${POP_MAX})`);
    this.rTier = res('is-tier', '🏛️', 'Settlement tier');
    // Your pantheon: hover for its blessings and elite soldier (filled in by showPantheon).
    this.rPantheon = res('is-pantheon', '✦', 'Your pantheon');
    this.rPantheon.n.hidden = true;
    // Relics (DESIGN 5.15): how many of the map's relics rest in my Temples; hover for their bonuses.
    this.rRelics = res('is-relic', '💎', 'Relics');
    this.rRelics.n.hidden = true;
    this.relicSig = '';
    this.top = el('div', 'hud-top hud-panel',
      el('div', 'hud-top-left', this.menuBtn, this.marketBtn, el('div', 'hud-time', el('i', 'hud-res-i', '⏳'), this.clock), this.peaceChip, this.siteChip, this.waveChip, this.twistChip, this.ping, this.rPantheon.n, this.rRelics.n),
      this.topRight = el('div', 'hud-top-right', this.rGold.n, this.rWood.n, this.rFaith.n, this.rPop.n, this.rTier.n));

    // God portraits and idle workers.
    this.gods = el('div', 'hud-gods');
    this.idleBtn = el('button', 'hud-idle hud-panel', el('span', 'hud-idle-icon', '🙏'), el('b', 'hud-idle-n'), el('kbd', 'hud-idle-key', '.'));
    this.idleBtn.type = 'button';
    this.idleBtn.tabIndex = -1;
    this.idleBtn.title = 'Idle Worshippers — click or press . to select the next one';
    this.idleBtn.addEventListener('click', (e) => game.input && game.input.cycleIdleWorker(e.shiftKey || e.ctrlKey));
    this.idleN = this.idleBtn.querySelector('.hud-idle-n');
    this.idleBtn.hidden = true;
    // How many worshippers are on each task; click a count to select them.
    this.taskEls = {};
    this.tasks = el('div', 'hud-tasks hud-panel');
    for (const t of WORKER_TASKS) {
      const n = el('b', 'hud-task-n', '0');
      const b = el('button', `hud-task is-${t.id}`, el('span', 'hud-task-i', t.icon), n);
      b.type = 'button';
      b.tabIndex = -1;
      b.dataset.task = t.id;
      b.addEventListener('click', (e) => this.selectTask(t.id, e.shiftKey));
      this.taskEls[t.id] = { b, n, label: t.label };
      this.tasks.appendChild(b);
    }
    this.taskIds = workerTasks(this.vs).ids;
    this.workers = el('div', 'hud-workers', this.idleBtn, this.tasks);

    // Messages: the feed of cards at the bottom left (a log for screen readers).
    this.msgs = el('div', 'hud-msgs');
    this.msgs.setAttribute('role', 'log');
    this.msgs.setAttribute('aria-live', 'polite');
    this.errorEl = el('div', 'hud-error');
    this.banner = el('div', 'hud-banner');
    this.banner.hidden = true;
    // A computer player's taunt (DESIGN 10.1): one big quote at the top centre, under the banners.
    this.taunt = el('div', 'hud-taunt');
    this.taunt.hidden = true;
    this.taunt.setAttribute('role', 'status');
    this.taunt.setAttribute('aria-live', 'polite');
    this.chatInput = el('input', 'hud-chat-input');
    this.chatInput.type = 'text';
    this.chatInput.maxLength = 200;
    // Who the line goes to (DESIGN 7, "Team chat"): everyone, or the allies only. The switch is a button
    // (Tab flips it too) that only shows when I have a teammate; "/t " or "/team " sends one line to the allies.
    this.chatAllies = false;
    this.chatTo = el('button', 'hud-chat-to', 'To all:');
    this.chatTo.type = 'button';
    this.chatTo.addEventListener('click', () => this.setChatAllies(!this.chatAllies));
    this.chatBox = el('div', 'hud-chat hud-panel', this.chatTo, this.chatInput);
    this.chatBox.hidden = true;
    // The chat history (DESIGN 9, "The message feed"): the last lines, newest at the bottom, above the box
    // while it is open, so a line the alerts pushed out of the feed can still be read.
    this.chatLog = el('div', 'hud-chatlog hud-panel');
    this.chatLog.setAttribute('role', 'log');
    this.chatLog.setAttribute('aria-label', 'Chat history');
    this.chatLog.hidden = true;
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.sendChatLine(game, { allies: e.shiftKey || this.chatAllies });
        this.closeChat();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeChat();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.setChatAllies(!this.chatAllies);
      }
    });
    this.chatInput.addEventListener('input', () => this.showChatTarget());
    // Key-ups are left to reach the input controller: a key held when chat opened (an
    // arrow, Alt, Shift) would otherwise stay "down" there after it was released.
    this.chatInput.addEventListener('blur', () => {
      if (this.chatOpen) setTimeout(() => this.chatOpen && this.closeChat(), 0);
    });
    this.mismatch = el('div', 'hud-mismatch', '⚠ Map mismatch: please reload the page (Ctrl+Shift+R) so both players run the same version.');
    this.mismatch.hidden = true;
    // Shown while the host has gone quiet (clients only; see stallText).
    this.stall = el('div', 'hud-stall');
    this.stall.hidden = true;
    // An online game paused for everyone (DESIGN 7): who paused it, when it goes on, and Resume for any player.
    this.pauseText = el('span', 'hud-pause-text');
    this.pauseBtn = el('button', 'mw-btn mw-btn--primary hud-pause-btn', 'Resume');
    this.pauseBtn.type = 'button';
    this.pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.play('click');
      if (game.session && game.session.pause) game.togglePause();
    });
    this.pauseBar = el('div', 'hud-pausebar hud-panel', el('span', 'hud-pause-ico', '⏸'), this.pauseText, this.pauseBtn);
    this.pauseBar.hidden = true;
    this.pause = null;

    // Bottom console: minimap | selection | command card.
    this.miniCanvas = el('canvas', 'hud-minimap-canvas');
    const mini = el('div', 'hud-minimap', this.miniCanvas);
    this.infoRoot = el('div', 'hud-info');
    this.cardGrid = el('div', 'hud-card');
    this.tip = el('div', 'hud-tip hud-panel');
    this.tip.hidden = true;
    // The marker buttons stand beside the minimap: pick one, then click the map or the minimap.
    this.markpad = new MarkPalette({ onPick: (kind) => game.input && game.input.armMark(kind) });
    // The god powers stand on its other side: pick a ready one, then click where it should fall.
    this.powerbar = new PowerBar({ onPick: (id) => game.input && game.input.armPower(id) });
    this.bottom = el('div', 'hud-bottom hud-panel',
      el('div', 'hud-bottom-mini', this.powerbar.root, mini, this.markpad.root),
      el('div', 'hud-bottom-info', this.infoRoot),
      el('div', 'hud-bottom-card', this.cardGrid));

    // Control groups: a chip per saved group, over the selection panel (lined up with it in update).
    this.groupBar = new GroupBar({
      selection: game.selection,
      viewState: this.vs,
      onPick: (n) => game.input && !game.replay && game.input.recallGroup(n),
    });
    this.bottom.appendChild(this.groupBar.root);
    this.bottomInfo = this.infoRoot.parentNode;
    // Every player of the match with their pantheon, tier and score; folds to its header. Not in the
    // guided first match, which keeps the screen to its objectives.
    this.roster = game.tutorial ? null : new RosterView({
      viewState: this.vs,
      open: getSettings().rosterOpen,
      onToggle: (open) => saveSettings({ rosterOpen: open }),
    });

    this.market = new MarketView({ viewState: this.vs, onSend: (cmd) => game.command(cmd) });

    this.overlayRoot = el('div', 'hud-overlays');
    root.append(this.top, this.gods, ...(this.roster ? [this.roster.root] : []), this.market.root, this.mismatch, this.stall, this.pauseBar, this.banner, this.taunt, this.msgs, this.errorEl, this.chatLog, this.chatBox, this.workers, this.bottom, this.tip, this.overlayRoot);

    // Keep the canvas from seeing clicks on panels.
    for (const p of [this.top, this.bottom, this.gods, ...(this.roster ? [this.roster.root] : []), this.idleBtn, this.tasks, this.chatLog, this.chatBox, this.tip, this.market.root, this.pauseBar]) {
      p.addEventListener('mousedown', (e) => {
        if (e.target !== this.chatInput) e.preventDefault();
      });
      p.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    this.cardView = new CardView(this.cardGrid, this.tip, {
      onActivate: (b, e) => game.input && game.input.activate(b, { shift: e.shiftKey, fromClick: true }),
      onToggle: (b) => game.input && game.input.toggleAutocast(b),
    });
    const sel = game.selection;
    this.infoView = new InfoView(this.infoRoot, {
      selection: sel,
      viewState: this.vs,
      onSelectOnly: (id) => sel.set([id]),
      onRemove: (id) => sel.remove([id]),
      onSelectType: (type) => sel.set(sel.ids.filter((id) => {
        const e = this.vs.entities.get(id);
        return e && e.t === type;
      })),
      onCancelQueue: (building, index, count = 1) => game.command(count > 1 ? { type: 'cancelTrain', building, index, count } : { type: 'cancelTrain', building, index }),
      onPortrait: () => game.input && game.input.centerOnSelection(),
    });
    this.overlays = new Overlays(this.overlayRoot, game);
    this.minimap = new Minimap({
      canvas: this.miniCanvas,
      viewState: this.vs,
      getCamera: () => (game.renderer ? game.renderer.camera : null),
      onPointer: (info) => game.input && game.input.onMinimap(info),
      marks: this.teamMarks,
    });

    // The guided first match shows its objectives where the checklist would be (and no gameplay tips).
    this.tutorial = game.tutorial ? new TutorialView(root, { director: game.tutorial }) : null;
    // A campaign mission shows its objectives there too (and no checklist or gameplay tips).
    this.missionView = !game.tutorial && game.mission ? new CampaignView(root, { viewState: this.vs }) : null;
    const guided = () => !!(this.tutorial || this.missionView);
    // New players get the "getting started" checklist until they close or finish it.
    this.tips = null;
    if (!getSettings().tipsDismissed && !guided()) this.showTips();
    // Team chat's "[Allies]" tag and allies chat box take the allies colour of the selection rings,
    // so they follow the colour-blind palette (DESIGN 9).
    const allyColor = () => {
      root.style.setProperty('--hud-ally', relationColor('ally'));
      if (this.roster) this.roster.invalidate(); // its colour swatches too
    };
    allyColor();
    this.offs.push(onTeamPaletteChange(allyColor));
    this.offs.push(onSettingsChange((st, changed) => {
      if (changed.includes('cardKeys') || changed.includes('keyBindings')) this.refreshCard(); // the keys on the card
      if (!changed.includes('tipsDismissed') || guided()) return;
      if (st.tipsDismissed) this.hideTips();
      else this.showTips();
    }));

    // Every couple of minutes one gameplay tip (hud-hints.js), under the checklist while that is up.
    this.hints = new HintsView(root, {
      anchor: () => (this.tips ? this.tips.el : null),
      onTurnOff: () => saveSettings({ hints: false }),
    });
    this.hintTimer = new HintScheduler({
      viewState: this.vs,
      show: (hint) => {
        this.hints.show(hint);
        if (getSettings().alerts === 'all') sfx.play('tip', { volume: 0.6 });
      },
      hide: () => this.hints.hide(),
    }).attach();
  }

  /** Something urgent is going on: no gameplay tip for a while, and the one on screen goes. */
  holdHints(seconds) {
    if (this.hintTimer) this.hintTimer.hold(seconds);
  }

  showTips() {
    if (this.tips) return;
    this.tips = new TipsView(this.root, {
      viewState: this.vs,
      onDismiss: () => {
        this.tips = null;
        if (!getSettings().tipsDismissed) saveSettings({ tipsDismissed: true });
      },
    });
  }

  hideTips() {
    if (!this.tips) return;
    const t = this.tips;
    this.tips = null;
    t.dispose();
  }

  // ---------------------------------------------------------------- per frame

  /** Refresh the HUD; cheap when nothing changed. */
  update(now = performance.now()) {
    const vs = this.vs;
    const me = vs.me;
    const game = this.game;
    this.syncPanelChat();
    if (me) {
      if (me.pantheon !== this.pantheonId) this.showPantheon(me.pantheon);
      setText(this.rGold.v, fmt(me.gold));
      setText(this.rWood.v, fmt(me.wood));
      setText(this.rFaith.v, fmt(me.faith));
      setText(this.rFaithRate, me.faithRate > 0 ? `+${(Math.round(me.faithRate * 10) / 10).toFixed(1)}/s` : '');
      setText(this.rPop.v, `${me.pop}/${me.popCap}`);
      setClass(this.rPop.n, 'is-capped', me.pop >= me.popCap);
      setText(this.rTier.v, tierName(me.tier));
    } else if (this.pantheonId) this.showPantheon(null);
    // No player of mine (a replay seen by everyone): no resources to show, so no empty boxes either.
    setHidden(this.topRight, !me);
    setText(this.clock, formatClock(vs.time));
    if (!this.taunt.hidden && this.endScreenUp()) this.hideTaunt();
    this.updatePeace();
    this.updateRelics();
    this.updateWaves();
    this.updateSites();
    const s = game.session;
    const stall = stallText(s);
    if (s && !s.isHost) {
      const ms = s.pingMs;
      setText(this.ping, ms === null || ms === undefined ? '📶 …' : `📶 ${ms} ms`);
      setClass(this.ping, 'is-bad', ms > 250 || !!stall);
      setHidden(this.ping, false);
    } else setHidden(this.ping, true);
    setText(this.stall, stall);
    setHidden(this.stall, !stall);
    if (this.pause) setText(this.pauseText, pauseText(this.pause, (i) => (s ? s.playerName(i) : `Player ${i + 1}`)));
    if (!this.leadShown) {
      // The lobby's Random is drawn at Start: name the pantheon once, as the game opens.
      this.leadShown = true;
      const lead = leadText(vs);
      if (lead) this.message(lead, 'good', { icon: PANTHEON_EMBLEMS[this.pantheonId] });
      if (vs.peaceActive()) this.message(peaceStartText(vs.peaceLeft()), 'good', { icon: PEACE_ICON });
      const sv = vs.survival();
      if (sv && sv.wave === 0) this.message(`${SURVIVAL_NAME}: build your defences. The first wave of monsters comes in ${peaceClock(sv.next)}.`, 'good', { icon: SURVIVAL_ICON });
      if (vs.sacredVictoryOn() && vs.time < 60) this.message(sacredStartText(), 'good', { icon: SITE_ICON });
      // Only a match with a teammate has anyone to ping.
      if (teammateCount(vs) > 0) this.message(MARKS_HINT, 'info', { icon: '📍' });
    }

    if (now - this.lastGods >= GODS_REFRESH_MS) {
      this.lastGods = now;
      this.updateGods();
    }
    if (now - this.lastIdle >= IDLE_REFRESH_MS) {
      this.lastIdle = now;
      this.updateIdle();
      this.updateMarket();
    }

    this.infoView.update();
    if (this.roster) this.roster.update(now);
    this.groupBar.update(now);
    if (!this.groupBar.root.hidden) setStyle(this.groupBar.root, 'left', `${this.groupBarLeft()}px`);
    const input = game.input;
    const mode = input ? input.cardMode() : 'root';
    const sig = `${game.selection.version}|${mode}`;
    if (sig !== this.cardSig || now - this.lastCard >= CARD_REFRESH_MS) {
      this.cardSig = sig;
      this.lastCard = now;
      this.card = withCardKeys(getCommandCard(game.selection.forCard(), vs, mode), cardKeysOf(getSettings()));
      this.cardView.render(this.card);
    }
    if (this.tutorial) {
      this.tutorial.update(now);
      lightCard(this.cardView, this.tutorial.guide());
    }
    if (this.missionView) this.missionView.update(now);
    this.minimap.update(now);
    this.marksLayer.update(now);
    if (this.guidePointer) this.guidePointer.update(now);
    const m = input && input.mode;
    this.markpad.setArmed(m && m.kind === 'target' && m.order === 'mark' ? m.mark : null);
    this.powerbar.update(vs, m && m.kind === 'target' && m.order === 'power' ? m.power : null);
    this.markpad.setTeammates(teammateCount(vs), game.replay ? 0 : aiAllyCount(vs));
    if (this.tips) this.tips.update(now);
    if (!this.tutorial && !this.missionView && !game.replay) this.hintTimer.update();
    this.hints.update();
  }

  /** Where the group bar starts: over the selection panel, or just past the task counts on the same row. */
  groupBarLeft() {
    const w = this.workers;
    const left = this.bottomInfo.offsetLeft || 0;
    return w.offsetWidth ? Math.max(left, w.offsetLeft + w.offsetWidth + 8) : left;
  }

  /** The top-bar pantheon chip: emblem and name, with the blessings and elite soldier in its tooltip. */
  showPantheon(id) {
    this.pantheonId = id;
    const p = Object.hasOwn(PANTHEONS, id) ? PANTHEONS[id] : null;
    setHidden(this.rPantheon.n, !p);
    if (!p) return;
    setText(this.rPantheon.n.querySelector('.hud-res-i'), PANTHEON_EMBLEMS[id] || '✦');
    setText(this.rPantheon.v, p.name);
    const idn = p.identity;
    const lines = [idn ? `${p.name}: ${idn.tagline}` : p.name];
    if (idn) lines.push(idn.playstyle, '', ...idn.blessings.map((b) => `${b.icon} ${b.name}: ${b.description}`));
    if (p.elite) lines.push('', `${p.elite.icon} ${p.elite.name}, a Barracks soldier from Town: ${p.elite.description.replace(/ Requires Town\.$/, '')}`);
    this.rPantheon.n.title = lines.join('\n');
  }

  /** The relic chip: "2/5" with the bonuses in its tooltip; hidden on a map without relics. */
  updateRelics() {
    const c = relicChip(this.vs);
    setHidden(this.rRelics.n, !c);
    if (!c) return;
    const sig = `${c.count}/${c.total}|${c.title}`;
    if (sig === this.relicSig) return;
    this.relicSig = sig;
    setText(this.rRelics.v, `${c.count}/${c.total}`);
    this.rRelics.n.title = c.title;
  }

  /** The Decade of Peace chip: the countdown, one reminder at each PEACE_WARNINGS mark, gone when the peace is over. */
  updatePeace() {
    const left = this.vs.peaceLeft();
    setHidden(this.peaceChip, !(left > 0));
    if (!(left > 0)) return;
    setText(this.peaceClock, peaceClock(left));
    setClass(this.peaceChip, 'is-ending', left <= PEACE_WARNINGS[1]);
    // A game seen first part-way through stays quiet about the marks already passed.
    const passed = PEACE_WARNINGS.filter((s) => left <= s).length;
    if (this.peaceMarks !== null && passed > this.peaceMarks) this.message(peaceWarning(PEACE_WARNINGS[passed - 1]), 'alert', { icon: PEACE_ICON });
    this.peaceMarks = passed;
  }

  /** The Trial of the Titans chip: the wave reached and the clock to the next one, and a word 10 s before it comes. */
  updateWaves() {
    const sv = this.vs.survival();
    setHidden(this.waveChip, !sv);
    if (!sv) return;
    const clock = peaceClock(sv.next);
    setText(this.waveText, sv.wave === 0 ? `Wave 1 in ${clock}` : `Wave ${sv.wave} · ${sv.alive} left · next ${clock}`);
    setClass(this.waveChip, 'is-boss', sv.nextBoss);
    setClass(this.waveChip, 'is-ending', sv.next <= WAVE_WARNING);
    const coming = sv.wave + 1;
    const close = sv.next <= WAVE_WARNING;
    // A game first seen inside the last seconds before a wave stays quiet about that one.
    if (this.waveWarned === null) this.waveWarned = close ? coming : coming - 1;
    if (close && this.waveWarned < coming && !this.vs.gameOver) {
      this.waveWarned = coming;
      const secs = Math.ceil(sv.next);
      this.message(sv.nextBoss ? `Wave ${coming} comes in ${secs} s, and a Titan leads it!` : `Wave ${coming} comes in ${secs} s.`, 'alert', { icon: SURVIVAL_ICON });
    }
  }

  /** The daily challenge's twist chip ({ name, icon, desc } from src/data/twists.js); null takes it away. */
  showTwist(twist) {
    setHidden(this.twistChip, !twist);
    if (!twist) return;
    setText(this.twistIcon, twist.icon || '📅');
    setText(this.twistText, twist.name);
    this.twistChip.title = `Daily challenge: ${twist.name}. ${twist.desc}`;
  }

  /** The Sacred Sites chip: sites my side holds, and the Sacred Victory countdown while one side holds them all. */
  updateSites() {
    const c = siteChip(this.vs);
    setHidden(this.siteChip, c.hidden);
    if (c.hidden) return;
    setText(this.siteText, c.text);
    setClass(this.siteChip, 'is-ours', c.cls === 'is-ours');
    setClass(this.siteChip, 'is-theirs', c.cls === 'is-theirs');
    if (!this.siteChip.title) this.siteChip.title = siteChipTitle(this.vs);
  }

  /** Show (pause: session.pause) or hide (null) the bar of an online game paused for everyone. */
  setPause(pause) {
    this.pause = pause || null;
    setHidden(this.pauseBar, !this.pause);
    if (!this.pause) return;
    // Resume is for the players still in the game: the host ignores a fallen player's (Game.togglePause).
    const me = this.vs && this.vs.me;
    setHidden(this.pauseBtn, !!(me && me.defeated));
    const s = this.game.session;
    setText(this.pauseText, pauseText(this.pause, (i) => (s ? s.playerName(i) : `Player ${i + 1}`)));
  }

  /** Current command card (input.js reads it for hotkeys). */
  currentCard() {
    const input = this.game.input;
    const mode = input ? input.cardMode() : 'root';
    const sig = `${this.game.selection.version}|${mode}`;
    if (sig !== this.cardSig) {
      this.cardSig = sig;
      this.lastCard = performance.now();
      this.card = withCardKeys(getCommandCard(this.game.selection.forCard(), this.vs, mode), cardKeysOf(getSettings()));
      this.cardView.render(this.card);
    }
    return this.card;
  }

  /** Re-render the card now (after a mode change). */
  refreshCard() {
    this.cardSig = '';
    this.currentCard();
  }

  flashSlot(slot) {
    this.cardView.flash(slot);
  }

  /** Own living gods, oldest first. */
  ownGods() {
    const vs = this.vs;
    const out = [];
    for (const e of vs.entities.values()) {
      if (e.k !== 'u' || e.o !== vs.myIndex) continue;
      const d = UNITS[e.t];
      if (d && d.class === 'god') out.push(e);
    }
    out.sort((a, b) => a.id - b.id);
    return out.slice(0, 3);
  }

  updateGods() {
    const gods = this.ownGods();
    const sig = gods.map((g) => g.id).join(',');
    if (sig !== this.godSig) {
      this.godSig = sig;
      this.gods.textContent = '';
      this.godEls = gods.map((g, i) => {
        const b = el('button', 'hud-god hud-panel');
        b.type = 'button';
        b.tabIndex = -1;
        b.title = `${UNITS[g.t].name} — click to select, double-click to center (F${i + 1})`;
        const lv = el('span', 'hud-god-lv');
        const bar = el('div', 'hud-god-bar', el('i', 'hi-bar-fill'));
        b.append(el('span', 'hud-god-key', `F${i + 1}`), el('span', 'hud-god-icon', UNITS[g.t].icon || '⭐'), lv, bar);
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', (e) => this.game.input && this.game.input.selectGod(i, e.detail >= 2, e.shiftKey));
        this.gods.appendChild(b);
        return { id: g.id, b, lv, fill: bar.firstChild };
      });
    }
    const sel = this.game.selection;
    for (const ge of this.godEls) {
      const g = this.vs.entities.get(ge.id);
      if (!g) continue;
      const f = g.mhp > 0 ? g.hp / g.mhp : 0;
      setStyle(ge.fill, 'width', pct(f));
      setStyle(ge.fill, 'background', hpColor(f));
      setText(ge.lv, String(g.lv || 1));
      setClass(ge.b, 'is-selected', sel.has(ge.id));
      setClass(ge.b, 'is-hurt', f < 0.35);
    }
  }

  /** Own idle worshippers. */
  idleWorkers() {
    const vs = this.vs;
    const out = [];
    for (const e of vs.entities.values()) {
      if (e.k !== 'u' || e.o !== vs.myIndex || e.st !== 'idle' || e.bo) continue;
      const d = UNITS[e.t];
      if (d && d.class === 'worker') out.push(e.id);
    }
    out.sort((a, b) => a - b);
    return out;
  }

  updateIdle() {
    this.idleIds = this.idleWorkers();
    const n = this.idleIds.length;
    setHidden(this.idleBtn, n === 0);
    setText(this.idleN, String(n));
    const tasks = workerTasks(this.vs);
    this.taskIds = tasks.ids;
    for (const t of WORKER_TASKS) {
      const te = this.taskEls[t.id];
      const c = tasks.counts[t.id];
      setText(te.n, String(c));
      setClass(te.b, 'is-zero', c === 0);
      const title = `${te.label}: ${c} Worshipper${c === 1 ? '' : 's'}${c ? ' (click to select, Shift+click to add)' : ''}`;
      if (te.b.title !== title) te.b.title = title;
    }
    setHidden(this.tasks, tasks.total === 0);
  }

  /** The Market button shows only while there is a living teammate to trade with. */
  updateMarket() {
    const me = this.vs.me;
    const canTrade = !!me && !me.defeated && marketPartners(this.vs).length > 0;
    setHidden(this.marketBtn, !canTrade);
    if (!canTrade && this.market.isOpen) this.market.close();
    setClass(this.marketBtn, 'is-on', this.market.isOpen);
    this.market.update();
  }

  toggleMarket() {
    this.market.toggle();
    this.updateMarket();
  }

  /** Select the own worshippers on a task (add to the selection with shift). */
  selectTask(task, add) {
    const ids = (this.taskIds && this.taskIds[task]) || [];
    if (!ids.length) return;
    const sel = this.game.selection;
    if (add) sel.add(ids);
    else sel.set(ids);
    if (this.game.input) this.game.input.afterSelect();
  }

  // ---------------------------------------------------------------- messages

  /**
   * Show a message. kind: 'error' (centre, short), 'info', 'alert', 'good', 'system'. The others become a
   * card in the feed at the bottom left: an emblem chip (`opts.icon`, else the kind's), the words (with a
   * key cap for each [[Key]]) and a colour by kind. The same line again while its card is still up does not
   * stack another: the card takes a count (×2), slides in again at the bottom and stays a full dwell more.
   * @param {string} text
   * @param {string} [kind]
   * @param {{ icon?: string }} [opts]
   * @returns {HTMLElement|null}
   */
  message(text, kind = 'info', opts = null) {
    if (text === null || text === undefined || text === '') return null;
    // Error texts arrive in snapshots from the host: keep them short, plain text.
    text = String(text);
    if (text.length > MAX_MESSAGE_CHARS) text = `${text.slice(0, MAX_MESSAGE_CHARS - 1)}…`;
    if (kind === 'error') {
      this.errorEl.textContent = text;
      this.errorEl.classList.remove('is-on');
      void this.errorEl.offsetWidth;
      this.errorEl.classList.add('is-on');
      clearTimeout(this.errorTimer);
      this.errorTimer = setTimeout(() => this.errorEl.classList.remove('is-on'), ERROR_MS);
      return this.errorEl;
    }
    const ms = messageDwell(text, kind);
    const same = `${kind}|${text}`;
    for (const again of this.msgs.children) {
      if (again._same !== same || again.classList.contains('is-fading')) continue;
      again.dataset.count = String((Number(again.dataset.count) || 1) + 1);
      this.msgs.appendChild(again); // moved to the bottom: the card slides in again
      this.arm(again, ms);
      return again;
    }
    const line = this.feedCard(kind, opts && opts.icon, hintParts(text).map((part) => (typeof part === 'string' ? part : el('kbd', null, part.key))));
    line._same = same;
    this.pushLine(line, ms);
    return line;
  }

  /** One card of the feed: the words (text nodes only) and, from its data-icon, the emblem the stylesheet draws. */
  feedCard(kind, icon, content) {
    const line = el('div', `hud-msg is-${kind}`, el('span', 'hud-msg-text', content));
    line.dataset.icon = messageIcon(kind, icon);
    return line;
  }

  /** Add a card to the feed; a full feed drops its oldest card that is not a player's chat line (evictIndex). */
  pushLine(line, ms) {
    this.msgs.appendChild(line);
    while (this.msgs.children.length > MAX_MESSAGES) {
      const cards = this.msgs.children;
      const old = cards[evictIndex(cards, line)];
      clearTimeout(old._timer);
      old.remove();
    }
    this.arm(line, ms);
  }

  /** (Re)start a card's stay: it fades after `ms` and leaves a moment later. */
  arm(line, ms) {
    clearTimeout(line._timer);
    line._timer = setTimeout(() => {
      line.classList.add('is-fading');
      line._timer = setTimeout(() => line.remove(), MESSAGE_FADE_MS);
    }, ms);
  }

  /** A chat line { from, name, text, system, team? }. */
  chat(line) {
    if (!line || typeof line !== 'object') return;
    // Lines come from the network: clean them again before they reach the page
    // (text nodes only, single line, no control / bidi characters, bounded).
    const text = sanitizeChat(line.text);
    if (!text) return;
    this.syncPanelChat(); // a line that comes while the end panel is up shows over it
    const time = this.vs.time || 0;
    if (line.system) {
      this.remember({ kind: 'system', name: '', color: null, team: false, text, time });
      this.pushLine(this.feedCard('system', null, text), CHAT_MS);
      return;
    }
    const from = Number.isInteger(line.from) && line.from >= 0 ? line.from : -1;
    const p = from >= 0 ? this.vs.players[from] || (this.vs.setup && this.vs.setup.players[from]) : null;
    const name = sanitizeName(line.name || (p && p.name), 'Player');
    this.remember({ kind: 'chat', name, color: p ? displayColor(safeColor(p.color, '#f1e8d4')) : null, team: !!line.team, text, time });
    const who = el('b', 'hud-chat-from', `${name}:`);
    // A line to the allies only (DESIGN 7, "Team chat") says so before the name, in the allies' green.
    const parts = line.team ? [el('b', 'hud-chat-team', '[Allies]'), ' ', who] : [who];
    const card = this.feedCard('chat', null, [...parts, ' ', el('span', null, text)]);
    if (line.team) card.classList.add('is-team');
    card._chat = true; // a full feed drops alerts before a player's words (pushLine)
    if (p) {
      const color = displayColor(safeColor(p.color, '#f1e8d4'));
      who.style.color = color;
      card.style.setProperty('--msg-accent', color); // the card's edge and emblem take the player's colour
    }
    this.pushLine(card, CHAT_MS);
  }

  /** Keep a chat or system line in the history, and show it there at once when the chat box is open. */
  remember(entry) {
    pushHistory(this.chatHistory, entry);
    if (!this.chatOpen) return;
    // a reader scrolled up to an older line keeps their place; at the bottom, the new line comes into view
    const log = this.chatLog;
    const atBottom = !(log.scrollHeight > 0) || log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    const top = log.scrollTop;
    this.renderChatLog();
    if (!atBottom) log.scrollTop = top;
  }

  /** One row of the chat history: the game time, "[Allies]" for a team line, the sender in their colour, the words. */
  chatLogRow(h) {
    const parts = [el('span', 'hud-chatlog-time', formatClock(h.time))];
    if (h.kind === 'chat') {
      if (h.team) parts.push(' ', el('b', 'hud-chat-team', '[Allies]'));
      const who = el('b', 'hud-chat-from', `${h.name}:`);
      if (h.color) who.style.color = h.color;
      parts.push(' ', who);
    }
    parts.push(' ', el('span', 'hud-chatlog-text', h.text));
    const row = el('div', `hud-chatlog-line is-${h.kind}`, parts);
    if (h.team) row.classList.add('is-team');
    return row;
  }

  /** Draw the whole history into its panel, newest at the bottom, scrolled to the newest line. */
  renderChatLog() {
    const log = this.chatLog;
    if (this.chatHistory.length) log.replaceChildren(...this.chatHistory.map((h) => this.chatLogRow(h)));
    else log.replaceChildren(el('div', 'hud-chatlog-empty', 'No messages yet.'));
    log.scrollTop = log.scrollHeight;
  }

  /**
   * A computer player's line (DESIGN 10.1) as a taunt at the top centre: their pantheon's emblem,
   * their name in their colour and the words, larger than the feed. A new taunt replaces the one up.
   */
  showTaunt(line) {
    if (!line || typeof line !== 'object' || this.endScreenUp()) return false;
    const text = sanitizeChat(line.text);
    if (!text) return false;
    const from = Number.isInteger(line.from) && line.from >= 0 ? line.from : -1;
    const p = from >= 0 ? this.vs.players[from] || (this.vs.setup && this.vs.setup.players[from]) : null;
    const who = el('span', 'hud-taunt-from', sanitizeName(line.name || (p && p.name), 'Player'));
    const quote = el('span', 'hud-taunt-text', `“${text}”`);
    const t = this.taunt;
    t.replaceChildren(who, quote);
    t.dataset.icon = (p && PANTHEON_EMBLEMS[p.pantheon]) || '⚔️';
    t.style.setProperty('--taunt-accent', displayColor(safeColor(p && p.color, '#ff7a4a')));
    t.hidden = false;
    t.classList.remove('is-on');
    void t.offsetWidth; // restart the slam-in for a taunt that replaces another
    t.classList.add('is-on');
    clearTimeout(this.tauntTimer);
    this.tauntTimer = setTimeout(() => {
      t.classList.remove('is-on');
      this.tauntTimer = setTimeout(() => (t.hidden = true), 500);
    }, tauntDwell(text));
    return true;
  }

  /** The taunt goes at once (an end screen came up over it). */
  hideTaunt() {
    clearTimeout(this.tauntTimer);
    this.taunt.classList.remove('is-on');
    this.taunt.hidden = true;
  }

  /** The end-of-match screens (game over, defeated, ended) stand at the top centre: no taunt behind them. */
  endScreenUp() {
    const n = this.overlays && this.overlays.name;
    return n === 'gameover' || n === 'defeated' || n === 'ended';
  }

  /**
   * An online game's end panel (game over, or "defeated" while the others fight on; DESIGN 7, "Chat over the
   * end panel"): the players still chat over it, to say gg and agree on a rematch, while the session is up.
   */
  canChatOverPanel() {
    const n = this.overlays && this.overlays.name;
    const g = this.game;
    return (n === 'gameover' || n === 'defeated') && !!(g && g.online && !g.ended);
  }

  /** The feed and the chat box stand over the overlay layer while the end panel can chat (`is-panel-chat`). */
  syncPanelChat() {
    const on = this.canChatOverPanel();
    if (on !== !!this.panelChat) {
      this.panelChat = on;
      this.root.classList.toggle('is-panel-chat', on);
      // the session ended (or the panel went) with the box open over a panel: it would be hidden and send nothing
      if (!on && this.chatOpen && this.overlays && this.overlays.open) this.closeChat();
    }
    return on;
  }

  /** Big centred announcement under the top bar. */
  showBanner(text, kind = 'info') {
    this.banner.textContent = text;
    this.banner.className = `hud-banner is-${kind}`;
    this.banner.hidden = false;
    void this.banner.offsetWidth;
    this.banner.classList.add('is-on');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => {
      this.banner.classList.remove('is-on');
      this.bannerTimer = setTimeout(() => (this.banner.hidden = true), 500);
    }, BANNER_MS);
  }

  // ---------------------------------------------------------------- chat

  /** Whether the local player has a teammate to talk to (else every line goes to everyone). */
  canChatAllies() {
    return hasAllies(this.vs.setup, this.vs.myIndex);
  }

  /** Open the chat box, to everyone or ({ allies: true }) to the allies when I have any. */
  openChat({ allies = false } = {}) {
    if (this.chatOpen) return;
    this.syncPanelChat();
    this.chatOpen = true;
    this.chatBox.hidden = false;
    this.chatLog.hidden = false;
    this.renderChatLog();
    this.msgs.classList.add('is-chatting');
    this.chatInput.value = '';
    this.setChatAllies(allies);
    this.chatInput.focus({ preventScroll: true });
  }

  /** Point the chat box's switch at the allies (true) or everyone; without teammates it stays on everyone. */
  setChatAllies(on) {
    const can = this.canChatAllies();
    this.chatAllies = !!on && can;
    this.chatTo.disabled = !can;
    this.chatTo.title = can ? 'Who reads it: click or Tab to switch (Shift+Enter sends to allies, "/t " too)' : 'You have no allies in this game';
    this.showChatTarget();
  }

  /** The switch's words and the box's colour follow where the line would go, a typed "/t " included. */
  showChatTarget() {
    const { team } = chatTarget(this.chatInput.value, { allies: this.chatAllies, canAllies: this.canChatAllies() });
    this.chatTo.textContent = team ? 'To allies:' : 'To all:';
    this.chatBox.classList.toggle('is-team', team);
    this.chatInput.placeholder = team
      ? 'Message your allies — Enter to send, Esc to cancel'
      : 'Message all players — Enter to send, Esc to cancel';
  }

  /** Send what the box holds, to the allies or everyone (chatTarget: a "/t " or "/all " prefix wins). */
  sendChatLine(game, { allies = this.chatAllies } = {}) {
    const { text, team, refused } = chatTarget(this.chatInput.value, { allies, canAllies: this.canChatAllies() });
    if (refused) return this.message('You have no allies in this game: the line was not sent.', 'system');
    if (!text) return;
    if (team) game.sendChat(text, { team: true });
    else game.sendChat(text);
  }

  closeChat() {
    if (!this.chatOpen) return;
    this.chatOpen = false;
    this.chatBox.hidden = true;
    this.chatLog.hidden = true;
    this.msgs.classList.remove('is-chatting');
    this.chatInput.blur();
  }

  setMapMismatch(on) {
    this.mismatch.hidden = !on;
  }

  /** Name of an entity for messages. */
  nameOf(e) {
    return nameOf(e);
  }

  dispose() {
    clearTimeout(this.errorTimer);
    clearTimeout(this.bannerTimer);
    clearTimeout(this.tauntTimer);
    for (const line of this.msgs.children) clearTimeout(line._timer);
    this.minimap.dispose();
    this.marksLayer.dispose();
    if (this.guidePointer) this.guidePointer.dispose();
    if (this.tutorial) this.tutorial.dispose();
    if (this.missionView) this.missionView.dispose();
    this.hideTips();
    this.hintTimer.dispose();
    this.hints.dispose();
    this.overlays.hide();
    for (const off of this.offs.splice(0)) off();
    this.root.textContent = '';
    this.root.classList.remove('hud');
    this.root.classList.remove('is-panel-chat');
  }
}
