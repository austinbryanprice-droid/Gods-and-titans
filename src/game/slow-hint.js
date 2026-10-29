// The slow-frame hint (DESIGN 11): when a match keeps running slowly (the median frame interval over a
// 10 s stretch above 33 ms, under 30 fps) at a Graphics quality above Low, the HUD says once, on this
// device, that the F10 menu can lower it. Nothing is changed for the player. Pure: the Game feeds it the
// requestAnimationFrame times.
import { QUALITY_OPTIONS } from '../ui/speed-options.js';

export const SLOW_HINT_KEY = 'mythicwar-slow-hint';
export const SLOW_FRAME_MS = 33; // a median frame interval above this is under 30 frames a second
export const SLOW_WINDOW_MS = 10000; // the stretch the median is taken over
const GAP_MS = 250; // a longer interval is a hidden tab, a pause or a stall: the stretch starts over

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // storage blocked
  }
}

/** The hint's words for a quality id ('medium' → "… (now: Medium)."). */
export function slowHintText(quality) {
  const o = QUALITY_OPTIONS.find((x) => x[0] === quality);
  return `The game is running slowly. Lower Graphics quality in the [[F10]] menu (now: ${o ? o[1] : quality}).`;
}

export class SlowFrameWatch {
  constructor({ store = storage() } = {}) {
    this.store = store;
    let shown = false;
    try {
      shown = !!(store && store.getItem(SLOW_HINT_KEY));
    } catch {
      shown = false;
    }
    this.done = shown;
    this.reset();
  }

  reset() {
    this.last = 0;
    this.spans = [];
    this.elapsed = 0;
    this.quality = null;
  }

  /**
   * One frame at time `t` (ms) drawn at `quality`. Returns the hint's text the one time it is due, else null.
   */
  frame(t, quality) {
    if (this.done) return null;
    if (quality === 'low' || quality !== this.quality) {
      this.reset();
      this.quality = quality;
      if (quality === 'low') return null;
    }
    const last = this.last;
    this.last = t;
    if (!last) return null;
    const ms = t - last;
    if (!(ms > 0) || ms > GAP_MS) {
      this.spans = [];
      this.elapsed = 0;
      return null;
    }
    this.spans.push(ms);
    this.elapsed += ms;
    if (this.elapsed < SLOW_WINDOW_MS) return null;
    const sorted = this.spans.sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    this.spans = [];
    this.elapsed = 0;
    if (median <= SLOW_FRAME_MS) return null;
    this.done = true;
    try {
      if (this.store) this.store.setItem(SLOW_HINT_KEY, '1');
    } catch {
      // storage full or blocked: the hint may come again on another visit
    }
    return slowHintText(quality);
  }
}
