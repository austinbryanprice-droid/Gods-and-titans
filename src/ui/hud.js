// In-game HUD (DESIGN 9): a Warcraft III–style HTML overlay in #hud-root.
//   top bar      gold, wood, faith (+rate), population, tier, clock, ping, menu, market
//   market       team trade panel under the top bar (only with a living teammate)
//   top-left     god portraits (F1–F3)
//   bottom-left  idle worshipper button and the worshipper task counts
//   bottom       minimap | selection panel | 4×3 command card (+ tooltip)
//   messages     errors (centre), alerts / info / chat (left), banners (top)
//   overlays     waiting, in-game menu (F10), game over, host left
// Only the panels take pointer events; everything else falls through to the canvas.
import { UNITS } from '../data/index.js';
import { getCommandCard } from './command-card.js';
import { sanitizeName, sanitizeChat } from '../net/protocol.js';
import { el, setText, setStyle, setClass, setHidden, fmt, pct, hpColor, safeColor } from './hud-dom.js';
import { formatClock, tierName, nameOf, leadText, stallText, workerTasks, WORKER_TASKS } from './hud-data.js';
import { CardView } from './hud-card.js';
import { InfoView } from './hud-info.js';
import { Overlays } from './hud-overlays.js';
import { Minimap } from './minimap.js';
import { TipsView } from './hud-tips.js';
import { MarketView, marketPartners } from './hud-market.js';
import { getSettings, saveSettings, onSettingsChange } from '../settings.js';

const CARD_REFRESH_MS = 120;
const IDLE_REFRESH_MS = 250;
const GODS_REFRESH_MS = 100;
const MESSAGE_MS = 8000;
const CHAT_MS = 14000;
const ERROR_MS = 2600;
const BANNER_MS = 4200;
const MAX_MESSAGES = 7;
const MAX_MESSAGE_CHARS = 240;

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
    this.card = new Array(12).fill(null);
    this.offs = [];
    this.build();
  }

  // ---------------------------------------------------------------- DOM

  build() {
    const root = this.root;
    root.textContent = '';
    root.classList.add('hud');
    const game = this.game;

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
    this.rPop = res('is-pop', '👥', 'Population — build Houses to raise the limit');
    this.rTier = res('is-tier', '🏛️', 'Settlement tier');
    this.top = el('div', 'hud-top hud-panel',
      el('div', 'hud-top-left', this.menuBtn, this.marketBtn, el('div', 'hud-time', el('i', 'hud-res-i', '⏳'), this.clock), this.ping),
      el('div', 'hud-top-right', this.rGold.n, this.rWood.n, this.rFaith.n, this.rPop.n, this.rTier.n));

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

    // Messages.
    this.msgs = el('div', 'hud-msgs');
    this.errorEl = el('div', 'hud-error');
    this.banner = el('div', 'hud-banner');
    this.banner.hidden = true;
    this.chatInput = el('input', 'hud-chat-input');
    this.chatInput.type = 'text';
    this.chatInput.maxLength = 200;
    this.chatInput.placeholder = 'Message all players — Enter to send, Esc to cancel';
    this.chatBox = el('div', 'hud-chat hud-panel', el('span', 'hud-chat-to', 'To all:'), this.chatInput);
    this.chatBox.hidden = true;
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = this.chatInput.value.trim();
        if (text) game.sendChat(text);
        this.closeChat();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeChat();
      }
    });
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

    // Bottom console: minimap | selection | command card.
    this.miniCanvas = el('canvas', 'hud-minimap-canvas');
    const mini = el('div', 'hud-minimap', this.miniCanvas);
    this.infoRoot = el('div', 'hud-info');
    this.cardGrid = el('div', 'hud-card');
    this.tip = el('div', 'hud-tip hud-panel');
    this.tip.hidden = true;
    this.bottom = el('div', 'hud-bottom hud-panel',
      el('div', 'hud-bottom-mini', mini),
      el('div', 'hud-bottom-info', this.infoRoot),
      el('div', 'hud-bottom-card', this.cardGrid));

    this.market = new MarketView({ viewState: this.vs, onSend: (cmd) => game.command(cmd) });

    this.overlayRoot = el('div', 'hud-overlays');
    root.append(this.top, this.gods, this.market.root, this.mismatch, this.stall, this.banner, this.msgs, this.errorEl, this.chatBox, this.workers, this.bottom, this.tip, this.overlayRoot);

    // Keep the canvas from seeing clicks on panels.
    for (const p of [this.top, this.bottom, this.gods, this.idleBtn, this.tasks, this.chatBox, this.tip, this.market.root]) {
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
      onCancelQueue: (building, index) => game.command({ type: 'cancelTrain', building, index }),
      onPortrait: () => game.input && game.input.centerOnSelection(),
    });
    this.overlays = new Overlays(this.overlayRoot, game);
    this.minimap = new Minimap({
      canvas: this.miniCanvas,
      viewState: this.vs,
      getCamera: () => (game.renderer ? game.renderer.camera : null),
      onPointer: (info) => game.input && game.input.onMinimap(info),
    });

    // New players get the "getting started" checklist until they close or finish it.
    this.tips = null;
    if (!getSettings().tipsDismissed) this.showTips();
    this.offs.push(onSettingsChange((st, changed) => {
      if (!changed.includes('tipsDismissed')) return;
      if (st.tipsDismissed) this.hideTips();
      else this.showTips();
    }));
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
    if (me) {
      setText(this.rGold.v, fmt(me.gold));
      setText(this.rWood.v, fmt(me.wood));
      setText(this.rFaith.v, fmt(me.faith));
      setText(this.rFaithRate, me.faithRate > 0 ? `+${(Math.round(me.faithRate * 10) / 10).toFixed(1)}/s` : '');
      setText(this.rPop.v, `${me.pop}/${me.popCap}`);
      setClass(this.rPop.n, 'is-capped', me.pop >= me.popCap);
      setText(this.rTier.v, tierName(me.tier));
    }
    setText(this.clock, formatClock(vs.time));
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
    if (!this.leadShown) {
      // The lobby's Random is drawn at Start: name the pantheon once, as the game opens.
      this.leadShown = true;
      const lead = leadText(vs);
      if (lead) this.message(lead, 'good');
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
    const input = game.input;
    const mode = input ? input.cardMode() : 'root';
    const sig = `${game.selection.version}|${mode}`;
    if (sig !== this.cardSig || now - this.lastCard >= CARD_REFRESH_MS) {
      this.cardSig = sig;
      this.lastCard = now;
      this.card = getCommandCard(game.selection.forCard(), vs, mode);
      this.cardView.render(this.card);
    }
    this.minimap.update(now);
    if (this.tips) this.tips.update(now);
  }

  /** Current command card (input.js reads it for hotkeys). */
  currentCard() {
    const input = this.game.input;
    const mode = input ? input.cardMode() : 'root';
    const sig = `${this.game.selection.version}|${mode}`;
    if (sig !== this.cardSig) {
      this.cardSig = sig;
      this.lastCard = performance.now();
      this.card = getCommandCard(this.game.selection.forCard(), this.vs, mode);
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
   * Show a message. kind: 'error' (centre, short), 'info', 'alert', 'good', 'system'.
   * @returns {HTMLElement|null}
   */
  message(text, kind = 'info') {
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
    const line = el('div', `hud-msg is-${kind}`, text);
    this.pushLine(line, MESSAGE_MS);
    return line;
  }

  pushLine(line, ms) {
    this.msgs.appendChild(line);
    while (this.msgs.children.length > MAX_MESSAGES) this.msgs.firstChild.remove();
    line._timer = setTimeout(() => {
      line.classList.add('is-fading');
      line._timer = setTimeout(() => line.remove(), 600);
    }, ms);
  }

  /** A chat line { from, name, text, system }. */
  chat(line) {
    if (!line || typeof line !== 'object') return;
    // Lines come from the network: clean them again before they reach the page
    // (text nodes only, single line, no control / bidi characters, bounded).
    const text = sanitizeChat(line.text);
    if (!text) return;
    if (line.system) {
      this.pushLine(el('div', 'hud-msg is-system', text), CHAT_MS);
      return;
    }
    const from = Number.isInteger(line.from) && line.from >= 0 ? line.from : -1;
    const p = from >= 0 ? this.vs.players[from] || (this.vs.setup && this.vs.setup.players[from]) : null;
    const who = el('b', 'hud-chat-from', `${sanitizeName(line.name || (p && p.name), 'Player')}:`);
    if (p) who.style.color = safeColor(p.color, '#f1e8d4');
    this.pushLine(el('div', 'hud-msg is-chat', who, ' ', el('span', null, text)), CHAT_MS);
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

  openChat() {
    if (this.chatOpen) return;
    this.chatOpen = true;
    this.chatBox.hidden = false;
    this.msgs.classList.add('is-chatting');
    this.chatInput.value = '';
    this.chatInput.focus({ preventScroll: true });
  }

  closeChat() {
    if (!this.chatOpen) return;
    this.chatOpen = false;
    this.chatBox.hidden = true;
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
    for (const line of this.msgs.children) clearTimeout(line._timer);
    this.minimap.dispose();
    this.hideTips();
    this.overlays.hide();
    for (const off of this.offs.splice(0)) off();
    this.root.textContent = '';
    this.root.classList.remove('hud');
  }
}
