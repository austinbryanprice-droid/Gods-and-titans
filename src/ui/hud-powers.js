// The god power bar (DESIGN 9): three buttons on the left of the minimap, one per power of my
// pantheon (Village blessing, Town strike, City cataclysm). A button is locked until my settlement
// reaches its tier, ready (glowing) once it has, and dark once the power is spent; a blessing that
// is still running counts its seconds down on its button. Pressing a ready one arms it: the next
// click on the map or minimap casts it there (input.js armPower).
import { powersFor, isHarmfulPower, powerRadius, BOON_TEXT } from '../data/powers.js';
import { peaceClock } from '../sim/peace.js';
import { el, setClass, setText } from './hud-dom.js';

const TIER_NAMES = ['Village', 'Town', 'City'];

/**
 * Where a power of mine stands: 'ready', 'locked' (tier not reached), 'used' or 'peace'
 * (a strike while the Decade of Peace holds), with the reason for any but 'ready'.
 * @param {object} vs ViewState
 * @param {object} pw power
 * @param {number} slot its index (0..2)
 */
export function powerState(vs, pw, slot) {
  const me = vs.me;
  if (!me) return { state: 'locked', reason: 'Not in this match.' };
  if ((me.gp || 0) & (1 << slot)) return { state: 'used', reason: `${pw.name} has already been used.` };
  if ((me.tier || 1) < pw.tier) return { state: 'locked', reason: `Requires ${TIER_NAMES[pw.tier - 1]}.` };
  if (isHarmfulPower(pw) && vs.peaceActive && vs.peaceActive()) {
    return { state: 'peace', reason: `The Decade of Peace holds for another ${peaceClock(vs.peaceLeft())}: no god powers against other players yet.` };
  }
  return { state: 'ready', reason: null };
}

/** Seconds left of my boons from this power (0 when none runs). */
export function boonLeft(me, pw) {
  if (!me || !Array.isArray(me.gb)) return 0;
  const stats = pw.effects.filter((e) => e.type === 'boon').map((e) => e.stat);
  let left = 0;
  for (const b of me.gb) if (Array.isArray(b) && stats.includes(b[0]) && b[2] > left) left = b[2];
  return left;
}

/** The tooltip of a power button. */
export function powerTitle(pw, st) {
  const how = pw.target === 'none' ? 'Click it, then click anywhere on the map, to call on it.' : 'Click it, then click the map or minimap where it should fall.';
  const area = pw.target === 'point' ? ` Area: ${Math.round(powerRadius(pw))} tiles around the spot.` : '';
  const head = `${pw.name} (${TIER_NAMES[pw.tier - 1]} god power, once per game)`;
  return `${head}\n${pw.description}${area}\n${st.reason || how}`;
}

export class PowerBar {
  /**
   * @param {object} o
   * @param {(powerId: string) => void} o.onPick
   */
  constructor({ onPick }) {
    this.root = el('div', 'hud-powerpad');
    this.onPick = onPick;
    this.pantheon = null;
    this.buttons = [];
    this.sig = '';
  }

  /** Build the three buttons for a pantheon. */
  setPantheon(pantheonId) {
    if (pantheonId === this.pantheon) return;
    this.pantheon = pantheonId;
    this.root.textContent = '';
    this.buttons = powersFor(pantheonId).map((pw) => {
      const time = el('b', 'hud-powerbtn-time');
      const b = el('button', `hud-powerbtn is-tier${pw.tier}`, el('span', 'hud-powerbtn-ico', pw.icon), time);
      b.type = 'button';
      b.tabIndex = -1;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => this.onPick(pw.id));
      this.root.appendChild(b);
      return { pw, b, time };
    });
    this.sig = '';
  }

  /** Refresh the buttons from the view (cheap when nothing changed). */
  update(vs, armedId) {
    const me = vs.me;
    if (!me) return;
    this.setPantheon(me.pantheon);
    const states = this.buttons.map(({ pw }, i) => powerState(vs, pw, i));
    const lefts = this.buttons.map(({ pw }) => boonLeft(me, pw));
    const sig = `${armedId}|${states.map((s) => s.reason).join('|')}|${lefts.join(',')}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.buttons.forEach(({ pw, b, time }, i) => {
      const st = states[i];
      for (const k of ['ready', 'locked', 'used', 'peace']) setClass(b, `is-${k}`, st.state === k);
      setClass(b, 'is-armed', armedId === pw.id);
      const left = lefts[i];
      setText(time, left > 0 ? `${left}s` : '');
      const running = left > 0 ? `\n${pw.effects.filter((e) => e.type === 'boon').map((e) => BOON_TEXT[e.stat]).join(', ')} blessing: ${left} s left.` : '';
      b.title = powerTitle(pw, st) + running;
    });
  }
}
