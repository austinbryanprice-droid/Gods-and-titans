// Calling the player back from another tab or window. When the game needs them (an attack on the
// base, the Decade of Peace ending, a god ready) and the page is hidden or not focused, the tab's
// title flashes the news until the player comes back, and with the `tabAlerts` setting on 'notify'
// a desktop notification says it too (the browser asks for permission once, when the player
// picks that option). A page the player is looking at is left alone, so nothing here ever
// competes with the game's own messages and sounds.
//
//   const tab = new TabAttention();           // remembers the page title
//   tab.attention('Your base is under attack!')   // → true when the tab was flashed
//   chooseTabAlerts('notify')                 // settings UI: asks permission, resolves to the mode in effect
import { getSettings, saveSettings } from '../settings.js';
import { GAME_TITLE } from '../config.js';

const FLASH_MS = 1000; // title alternates this often (background tabs run timers at 1 s at best)
const NOTIFY_GAP_MS = 15000; // between two desktop notifications
const NOTIFY_CLOSE_MS = 8000;
const MAX_TEXT = 90;

/** 'unsupported' | 'default' | 'granted' | 'denied': what the browser says about desktop notifications. */
export function notificationState(Notif = globalThis.Notification) {
  if (typeof Notif !== 'function') return 'unsupported';
  const p = Notif.permission;
  return p === 'granted' || p === 'denied' || p === 'default' ? p : 'unsupported';
}

/** Ask the browser for permission to raise notifications (call from a click). Never throws; resolves to notificationState(). */
export async function requestNotifications(Notif = globalThis.Notification) {
  if (notificationState(Notif) === 'unsupported') return 'unsupported';
  try {
    const r = Notif.requestPermission();
    if (r && typeof r.then === 'function') await r;
  } catch {
    // some browsers refuse outside a click; the state below says what we have
  }
  return notificationState(Notif);
}

/**
 * The settings UI picked `mode` for tabAlerts: 'notify' only sticks when the browser grants the
 * permission (else the title flash is kept). Resolves to the mode now in effect.
 */
export async function chooseTabAlerts(mode, { Notif = globalThis.Notification, save = saveSettings } = {}) {
  if (mode === 'notify' && (await requestNotifications(Notif)) !== 'granted') mode = 'title';
  save({ tabAlerts: mode });
  return mode;
}

export class TabAttention {
  /**
   * @param {object} [o] every part can be replaced (tests)
   * @param {Document} [o.doc]
   * @param {Window} [o.win]
   * @param {Function} [o.Notif] the Notification class
   * @param {() => object} [o.settings] default getSettings
   * @param {() => number} [o.now] ms clock
   */
  constructor({ doc = globalThis.document, win = globalThis.window, Notif = globalThis.Notification, settings = getSettings, now = () => Date.now() } = {}) {
    this.doc = doc || null;
    this.win = win || null;
    this.Notif = Notif;
    this.settings = settings;
    this.now = now;
    this.base = this.doc ? this.doc.title : '';
    this.timer = null;
    this.flashOn = false;
    this.count = 0;
    this.text = '';
    this.lastNotify = -Infinity;
    this.disposed = false;
    this.onBack = () => {
      if (!this.away()) this.stop();
    };
    if (this.doc && this.doc.addEventListener) this.doc.addEventListener('visibilitychange', this.onBack);
    if (this.win && this.win.addEventListener) this.win.addEventListener('focus', this.onBack);
  }

  mode() {
    const m = this.settings().tabAlerts;
    return m === 'off' || m === 'notify' ? m : 'title';
  }

  /** Is the player somewhere else: the tab hidden, or the window not focused? */
  away() {
    const d = this.doc;
    if (!d) return false;
    if (d.hidden) return true;
    return typeof d.hasFocus === 'function' ? !d.hasFocus() : false;
  }

  /**
   * The game needs the player. Flashes the title (and maybe notifies) when they are away.
   * @param {string} text a short line
   * @returns {boolean} whether anything was done
   */
  attention(text) {
    if (this.disposed || !this.doc || !text || this.mode() === 'off' || !this.away()) return false;
    this.text = String(text).slice(0, MAX_TEXT);
    this.count++;
    this.flash();
    if (this.mode() === 'notify') this.notify(this.text);
    return true;
  }

  title() {
    return `${this.count > 1 ? `(${this.count}) ` : ''}⚠ ${this.text}`;
  }

  flash() {
    const d = this.doc;
    if (!this.timer) {
      this.base = d.title;
      this.flashOn = true;
      this.timer = setInterval(() => {
        this.flashOn = !this.flashOn;
        d.title = this.flashOn ? this.title() : this.base;
      }, FLASH_MS);
      if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
    }
    d.title = this.title();
    this.flashOn = true;
  }

  notify(text) {
    if (notificationState(this.Notif) !== 'granted') return;
    const t = this.now();
    if (t - this.lastNotify < NOTIFY_GAP_MS) return;
    this.lastNotify = t;
    try {
      const n = new this.Notif(GAME_TITLE, { body: text, tag: 'mythicwar-alert', silent: true });
      n.onclick = () => {
        try {
          if (this.win && this.win.focus) this.win.focus();
          n.close();
        } catch {
          // already gone
        }
      };
      const close = setTimeout(() => {
        try {
          n.close();
        } catch {
          // already gone
        }
      }, NOTIFY_CLOSE_MS);
      if (close && typeof close.unref === 'function') close.unref();
    } catch {
      // browsers that cannot raise one from a page (some phones): the title flash is enough
    }
  }

  /** The player is back: stop flashing and restore the title. */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      if (this.doc) this.doc.title = this.base;
    }
    this.count = 0;
    this.text = '';
  }

  dispose() {
    this.stop();
    this.disposed = true;
    if (this.doc && this.doc.removeEventListener) this.doc.removeEventListener('visibilitychange', this.onBack);
    if (this.win && this.win.removeEventListener) this.win.removeEventListener('focus', this.onBack);
  }
}
