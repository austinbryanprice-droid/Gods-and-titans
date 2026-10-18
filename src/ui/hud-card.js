// Command card view: renders the 12 buttons from getCommandCard() into the
// bottom-right grid (hotkey letters, cost-driven disabled styling, cooldown
// sweeps, queue counts, autocast marks) and the WC3-style tooltip above it.
import { el, setText, setStyle, setHidden, fmt } from './hud-dom.js';

const STATE_CLASSES = ['is-ready', 'is-cooldown', 'is-unaffordable', 'is-locked', 'is-disabled', 'is-passive', 'is-active'];

/** Signature of the parts of a button that need a DOM rebuild. */
function shape(b) {
  if (!b) return '';
  return `${b.id}|${b.icon}|${b.keyLabel}|${b.state}|${b.queued}|${b.autocast ? 1 : 0}`;
}

export class CardView {
  /**
   * @param {HTMLElement} grid container for the 12 slots
   * @param {HTMLElement} tip tooltip element
   * @param {{ onActivate: (b: object, e: MouseEvent) => void }} o
   */
  constructor(grid, tip, { onActivate }) {
    this.grid = grid;
    this.tip = tip;
    this.onActivate = onActivate;
    this.card = new Array(12).fill(null);
    this.slots = [];
    this.hoverSlot = -1;
    this.tipSig = '';
    for (let i = 0; i < 12; i++) {
      const btn = el('button', 'hc-btn is-empty');
      btn.type = 'button';
      btn.tabIndex = -1;
      btn.dataset.slot = String(i);
      const icon = el('span', 'hc-icon');
      const key = el('span', 'hc-key');
      const queue = el('span', 'hc-queue');
      const cd = el('span', 'hc-cd');
      const cdText = el('span', 'hc-cd-text');
      const auto = el('span', 'hc-auto');
      const lock = el('span', 'hc-lock', '🔒');
      btn.append(icon, cd, cdText, auto, lock, queue, key);
      const slot = { btn, icon, key, queue, cd, cdText, auto, lock, sig: null };
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => {
        const b = this.card[i];
        if (b && this.onActivate) this.onActivate(b, e);
      });
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
      btn.addEventListener('mouseenter', () => {
        this.hoverSlot = i;
        this.renderTip();
      });
      btn.addEventListener('mouseleave', () => {
        if (this.hoverSlot === i) this.hoverSlot = -1;
        this.renderTip();
      });
      this.slots.push(slot);
      grid.appendChild(btn);
    }
  }

  /** Show a new card (diffed per slot). */
  render(card) {
    this.card = card;
    for (let i = 0; i < 12; i++) {
      const b = card[i];
      const s = this.slots[i];
      const sig = shape(b);
      if (sig !== s.sig) {
        s.sig = sig;
        const btn = s.btn;
        for (const c of STATE_CLASSES) btn.classList.remove(c);
        if (!b) {
          btn.classList.add('is-empty');
          setText(s.icon, '');
          setText(s.key, '');
          setHidden(s.queue, true);
          setHidden(s.auto, true);
          setHidden(s.lock, true);
          btn.removeAttribute('aria-label');
          btn.removeAttribute('data-id');
        } else {
          btn.classList.remove('is-empty');
          btn.classList.add(`is-${b.state}`);
          btn.dataset.id = b.id;
          btn.setAttribute('aria-label', b.title);
          setText(s.icon, b.icon);
          setText(s.key, b.keyLabel || '');
          setHidden(s.key, !b.keyLabel);
          setText(s.queue, b.queued > 0 ? String(b.queued) : '');
          setHidden(s.queue, !(b.queued > 0));
          setHidden(s.auto, !b.autocast);
          setHidden(s.lock, b.state !== 'locked');
        }
      }
      // Cooldown sweep (every render; cheap property writes only when changed).
      const cd = b && b.cooldown > 0 ? b.cooldown : 0;
      setStyle(s.cd, '--cd', `${(cd * 360).toFixed(1)}deg`);
      setHidden(s.cd, !(cd > 0));
      setText(s.cdText, cd > 0 ? String(Math.ceil(b.cooldownLeft)) : '');
      setHidden(s.cdText, !(cd > 0));
    }
    this.renderTip();
  }

  /** Flash a slot (hotkey feedback). */
  flash(slot) {
    const s = this.slots[slot];
    if (!s) return;
    s.btn.classList.remove('is-pressed');
    void s.btn.offsetWidth;
    s.btn.classList.add('is-pressed');
    clearTimeout(s.flashTimer);
    s.flashTimer = setTimeout(() => s.btn.classList.remove('is-pressed'), 140);
  }

  renderTip() {
    const b = this.hoverSlot >= 0 ? this.card[this.hoverSlot] : null;
    const sig = b ? `${shape(b)}|${b.title}|${b.reason}|${b.description}|${JSON.stringify(b.cost)}` : '';
    if (sig === this.tipSig) return;
    this.tipSig = sig;
    const tip = this.tip;
    if (!b) {
      setHidden(tip, true);
      return;
    }
    tip.textContent = '';
    const title = el('div', 'ht-title', b.title);
    if (b.keyLabel) title.append(' ', el('span', 'ht-key', `[${b.keyLabel}]`));
    tip.appendChild(title);
    const c = b.cost;
    if (c && (c.gold || c.wood || c.faith || c.pop)) {
      const row = el('div', 'ht-cost');
      const add = (cls, icon, v) => {
        if (v) row.appendChild(el('span', `ht-res ${cls}`, el('i', 'ht-res-i', icon), fmt(v)));
      };
      add('is-gold', '💰', c.gold);
      add('is-wood', '🌲', c.wood);
      add('is-faith', '✨', c.faith);
      add('is-pop', '👥', c.pop);
      if (c.time) row.appendChild(el('span', 'ht-res is-time', el('i', 'ht-res-i', '⏳'), `${Math.round(c.time)}s`));
      tip.appendChild(row);
    } else if (c && c.cooldown) {
      const row = el('div', 'ht-cost');
      row.appendChild(el('span', 'ht-res is-time', el('i', 'ht-res-i', '⏳'), `${c.cooldown}s cooldown`));
      if (c.range) row.appendChild(el('span', 'ht-res', el('i', 'ht-res-i', '🎯'), `range ${c.range}`));
      if (c.target) row.appendChild(el('span', 'ht-res is-dim', c.target));
      tip.appendChild(row);
    }
    if (b.description) tip.appendChild(el('div', 'ht-desc', b.description));
    if (b.autocast) tip.appendChild(el('div', 'ht-note', 'Casts automatically.'));
    if (b.passive) tip.appendChild(el('div', 'ht-note', 'Passive.'));
    if (b.reason && b.state !== 'cooldown') tip.appendChild(el('div', 'ht-reason', b.reason));
    setHidden(tip, false);
  }

  hideTip() {
    this.hoverSlot = -1;
    this.renderTip();
  }
}
