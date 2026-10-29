// Team market panel (DESIGN 9 / 5.7): send gold, wood or faith to a teammate.
// Opened from the Market button in the top bar, which only shows while the
// player has a living teammate. Pick the teammate, the resource and an amount
// (quick-add buttons, Max, Clear); the summary says what arrives after the
// market's cut, and Send issues one `trade` command. The host re-checks
// everything (src/sim/trade.js); this panel only uses the same rules to keep
// the Send button honest.
import { TRADE_TAX_PCT, TRADE_MIN } from '../config.js';
import { tradeReceived, tradePartners, tradeError } from '../sim/trade.js';
import { sanitizeName } from '../net/protocol.js';
import { el, setText, setClass, setHidden, fmt, safeColor } from './hud-dom.js';
import { displayColor } from '../team-colors.js';

export const MARKET_RESOURCES = [
  { id: 'gold', icon: '💰', label: 'Gold' },
  { id: 'wood', icon: '🌲', label: 'Wood' },
  { id: 'faith', icon: '✨', label: 'Faith' },
];
export const MARKET_STEPS = [50, 100, 250, 500];

/** Living teammates of the local player (snapshot players). */
export function marketPartners(vs) {
  return vs && Array.isArray(vs.players) && Number.isInteger(vs.myIndex) ? tradePartners(vs.players, vs.myIndex) : [];
}

export class MarketView {
  /**
   * @param {object} o
   * @param {object} o.viewState the ViewState (players, myIndex)
   * @param {(cmd: object) => void} o.onSend issues the trade command
   */
  constructor({ viewState, onSend }) {
    this.vs = viewState;
    this.onSend = onSend;
    this.to = -1;
    this.res = 'gold';
    this.amount = 0;
    this.partnerSig = '';
    this.partnerEls = [];
    this.isOpen = false;

    const close = el('button', 'hud-market-close', '✕');
    close.type = 'button';
    close.tabIndex = -1;
    close.title = 'Close';
    close.addEventListener('click', () => this.close());
    this.partnersEl = el('div', 'hud-market-partners');
    this.resEls = {};
    const resRow = el('div', 'hud-market-res');
    for (const r of MARKET_RESOURCES) {
      const have = el('small', 'hud-market-have');
      const b = el('button', `hud-market-resbtn is-${r.id}`, el('i', 'hud-res-i', r.icon), el('span', null, r.label), have);
      b.type = 'button';
      b.tabIndex = -1;
      b.addEventListener('click', () => {
        this.res = r.id;
        this.amount = Math.min(this.amount, this.mine(r.id));
        this.update();
      });
      this.resEls[r.id] = { b, have };
      resRow.appendChild(b);
    }
    this.amountEl = el('b', 'hud-market-amount', '0');
    const steps = el('div', 'hud-market-steps');
    for (const s of MARKET_STEPS) steps.appendChild(this.stepButton(`+${s}`, () => this.add(s)));
    steps.appendChild(this.stepButton('Max', () => this.setAmount(this.mine(this.res))));
    steps.appendChild(this.stepButton('Clear', () => this.setAmount(0)));
    this.summary = el('div', 'hud-market-summary');
    this.sendBtn = el('button', 'hud-market-send', 'Send');
    this.sendBtn.type = 'button';
    this.sendBtn.tabIndex = -1;
    this.sendBtn.addEventListener('click', () => this.send());
    this.root = el('div', 'hud-market hud-panel',
      el('div', 'hud-market-head', el('span', 'hud-market-title', '⚖️ Market'), close),
      el('div', 'hud-market-label', 'Send to'),
      this.partnersEl,
      el('div', 'hud-market-label', 'Resource'),
      resRow,
      el('div', 'hud-market-label', 'Amount'),
      el('div', 'hud-market-amountrow', this.amountEl, steps),
      this.summary,
      this.sendBtn,
      el('div', 'hud-market-note', `The market keeps ${TRADE_TAX_PCT}% of every shipment. At least ${TRADE_MIN} per shipment.`));
    this.root.hidden = true;
  }

  stepButton(text, fn) {
    const b = el('button', 'hud-market-step', text);
    b.type = 'button';
    b.tabIndex = -1;
    b.addEventListener('click', fn);
    return b;
  }

  /** The local player's whole amount of a resource. */
  mine(res) {
    const me = this.vs.players[this.vs.myIndex];
    return me ? Math.floor(me[res] || 0) : 0;
  }

  add(n) {
    this.setAmount(this.amount + n);
  }

  setAmount(n) {
    this.amount = Math.max(0, Math.min(Math.floor(n), this.mine(this.res)));
    this.update();
  }

  open() {
    this.isOpen = true;
    this.root.hidden = false;
    this.update();
  }

  close() {
    this.isOpen = false;
    this.root.hidden = true;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** The trade command for the current choice, or null with the reason in `this.reason`. */
  command() {
    const vs = this.vs;
    this.reason = this.to < 0 ? 'Choose a teammate to send to.' : tradeError(vs.players, vs.myIndex, this.to, this.res, this.amount);
    return this.reason ? null : { type: 'trade', to: this.to, res: this.res, amount: this.amount };
  }

  send() {
    const cmd = this.command();
    if (!cmd) return;
    this.onSend(cmd);
    this.amount = 0;
    this.update();
  }

  /** Refresh the panel (partners, amounts, summary); cheap while closed. */
  update() {
    const vs = this.vs;
    const partners = marketPartners(vs);
    if (!partners.includes(this.to)) this.to = partners.length ? partners[0] : -1;
    if (!this.isOpen) return;
    const sig = partners.join(',');
    if (sig !== this.partnerSig) {
      this.partnerSig = sig;
      this.partnersEl.textContent = '';
      this.partnerEls = partners.map((i) => {
        const p = vs.players[i];
        const stock = el('small', 'hud-market-stock');
        const swatch = el('i', 'hud-market-swatch');
        swatch.style.background = displayColor(safeColor(p.color));
        const b = el('button', 'hud-market-partner',
          swatch,
          el('span', 'hud-market-name', sanitizeName(p.name, `Player ${i + 1}`)),
          stock);
        b.type = 'button';
        b.tabIndex = -1;
        b.addEventListener('click', () => {
          this.to = i;
          this.update();
        });
        this.partnersEl.appendChild(b);
        return { i, b, stock };
      });
      if (!partners.length) this.partnersEl.appendChild(el('div', 'hud-market-empty', 'No living teammates to trade with.'));
    }
    for (const pe of this.partnerEls) {
      const p = vs.players[pe.i];
      setClass(pe.b, 'is-on', pe.i === this.to);
      if (p) setText(pe.stock, `💰 ${fmt(p.gold)}  🌲 ${fmt(p.wood)}  ✨ ${fmt(p.faith)}`);
    }
    for (const r of MARKET_RESOURCES) {
      const re = this.resEls[r.id];
      setClass(re.b, 'is-on', r.id === this.res);
      setText(re.have, fmt(this.mine(r.id)));
    }
    if (this.amount > this.mine(this.res)) this.amount = this.mine(this.res);
    setText(this.amountEl, fmt(this.amount));
    const cmd = this.command();
    const label = this.res;
    if (cmd) {
      const got = tradeReceived(this.amount);
      const name = sanitizeName(vs.players[this.to].name, `Player ${this.to + 1}`);
      setText(this.summary, `${name} receives ${fmt(got)} ${label} (the market keeps ${fmt(this.amount - got)}).`);
    } else setText(this.summary, this.amount > 0 || this.to < 0 ? this.reason : `Pick an amount of ${label} to send.`);
    setClass(this.summary, 'is-bad', !cmd && (this.amount > 0 || this.to < 0));
    this.sendBtn.disabled = !cmd;
    setHidden(this.sendBtn, !partners.length);
  }
}
