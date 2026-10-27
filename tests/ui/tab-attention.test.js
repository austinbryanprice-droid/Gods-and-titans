// Calling a player back from another tab (src/ui/tab-attention.js): the flashing title, the
// desktop notification and the settings choice that asks the browser for permission.
// A fake document, window and Notification class stand in for the browser; timers are mocked.
import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TabAttention, chooseTabAlerts, notificationState, requestNotifications } from '../../src/ui/tab-attention.js';

class FakeDoc {
  constructor() {
    this.title = 'Mythic War';
    this.hidden = false;
    this.focused = true;
    this.listeners = new Map();
  }
  hasFocus() {
    return this.focused;
  }
  addEventListener(type, fn) {
    this.listeners.set(type, fn);
  }
  removeEventListener(type, fn) {
    if (this.listeners.get(type) === fn) this.listeners.delete(type);
  }
  /** The player comes back to this tab. */
  comeBack() {
    this.hidden = false;
    this.focused = true;
    const fn = this.listeners.get('visibilitychange');
    if (fn) fn();
  }
}

class FakeWin {
  constructor() {
    this.listeners = new Map();
    this.focusCalls = 0;
  }
  addEventListener(type, fn) {
    this.listeners.set(type, fn);
  }
  removeEventListener(type, fn) {
    if (this.listeners.get(type) === fn) this.listeners.delete(type);
  }
  focus() {
    this.focusCalls++;
  }
}

/** A Notification class with a settable permission. */
function fakeNotification(permission, { onRequest } = {}) {
  return class FakeNotification {
    static permission = permission;
    static made = [];
    static requested = 0;
    static requestPermission() {
      FakeNotification.requested++;
      if (onRequest) return onRequest(FakeNotification);
      return Promise.resolve(FakeNotification.permission);
    }
    constructor(title, opts) {
      this.title = title;
      this.opts = opts;
      this.closed = 0;
      FakeNotification.made.push(this);
    }
    close() {
      this.closed++;
    }
  };
}

const tabs = [];
function make({ mode = 'title', Notif = fakeNotification('default'), now = () => 0 } = {}) {
  const doc = new FakeDoc();
  const win = new FakeWin();
  const state = { mode };
  const tab = new TabAttention({ doc, win, Notif, settings: () => ({ tabAlerts: state.mode }), now });
  tabs.push(tab);
  return { tab, doc, win, state, Notif };
}

afterEach(() => {
  mock.timers.reset();
  for (const t of tabs.splice(0)) t.dispose();
});

test('notificationState: unsupported without the API, otherwise what the browser says', () => {
  assert.equal(notificationState(undefined), 'unsupported');
  assert.equal(notificationState({}), 'unsupported');
  assert.equal(notificationState(fakeNotification('granted')), 'granted');
  assert.equal(notificationState(fakeNotification('denied')), 'denied');
  assert.equal(notificationState(fakeNotification('default')), 'default');
  assert.equal(notificationState(fakeNotification('banana')), 'unsupported');
});

test('requestNotifications asks once, survives a refusal to ask, and reports the state', async () => {
  assert.equal(await requestNotifications(undefined), 'unsupported');
  const Granting = fakeNotification('default', { onRequest: (N) => { N.permission = 'granted'; return Promise.resolve('granted'); } });
  assert.equal(await requestNotifications(Granting), 'granted');
  assert.equal(Granting.requested, 1);
  const Throwing = fakeNotification('default', { onRequest: () => { throw new Error('needs a click'); } });
  assert.equal(await requestNotifications(Throwing), 'default');
  const Old = fakeNotification('default', { onRequest: (N) => { N.permission = 'denied'; return undefined; } }); // the callback-style API
  assert.equal(await requestNotifications(Old), 'denied');
});

test('chooseTabAlerts: notify sticks only when the browser grants it; title and off never ask', async () => {
  const saved = [];
  const save = (patch) => saved.push(patch);
  const Granting = fakeNotification('default', { onRequest: (N) => { N.permission = 'granted'; return Promise.resolve('granted'); } });
  assert.equal(await chooseTabAlerts('notify', { Notif: Granting, save }), 'notify');
  assert.equal(await chooseTabAlerts('notify', { Notif: fakeNotification('denied'), save }), 'title', 'blocked: the flash is kept');
  assert.equal(await chooseTabAlerts('notify', { Notif: undefined, save }), 'title', 'no API at all');
  const Asked = fakeNotification('default', { onRequest: () => Promise.resolve('default') });
  assert.equal(await chooseTabAlerts('notify', { Notif: Asked, save }), 'title', 'the prompt was dismissed');
  const Never = fakeNotification('default');
  assert.equal(await chooseTabAlerts('title', { Notif: Never, save }), 'title');
  assert.equal(await chooseTabAlerts('off', { Notif: Never, save }), 'off');
  assert.equal(Never.requested, 0);
  assert.deepEqual(saved, [{ tabAlerts: 'notify' }, { tabAlerts: 'title' }, { tabAlerts: 'title' }, { tabAlerts: 'title' }, { tabAlerts: 'title' }, { tabAlerts: 'off' }]);
});

test('chooseTabAlerts: a prompt answered after a newer pick does not undo it', async () => {
  const saved = [];
  const save = (patch) => saved.push(patch);
  let answer;
  const Slow = fakeNotification('default', { onRequest: (N) => new Promise((resolve) => {
    answer = () => {
      N.permission = 'granted';
      resolve('granted');
    };
  }) });
  const first = chooseTabAlerts('notify', { Notif: Slow, save }); // the browser's prompt is open
  assert.equal(await chooseTabAlerts('off', { Notif: Slow, save }), 'off', 'the player changed their mind: that applies at once');
  answer();
  assert.equal(await first, null, 'the late answer is dropped');
  assert.deepEqual(saved, [{ tabAlerts: 'off' }]);
  assert.equal(await chooseTabAlerts('title', { Notif: Slow, save }), 'title', 'later picks work as before');
  assert.deepEqual(saved, [{ tabAlerts: 'off' }, { tabAlerts: 'title' }]);
});

test('a tab the player is looking at is left alone', () => {
  const { tab, doc } = make();
  assert.equal(tab.attention('Your base is under attack!'), false);
  assert.equal(doc.title, 'Mythic War');
});

test('a hidden tab flashes the news, counts further news, and stops when the player is back', () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const { tab, doc } = make();
  doc.hidden = true;
  assert.equal(tab.attention('Your base is under attack!'), true);
  assert.equal(doc.title, '⚠ Your base is under attack!');
  mock.timers.tick(1000);
  assert.equal(doc.title, 'Mythic War', 'the title alternates with the page\'s own');
  mock.timers.tick(1000);
  assert.equal(doc.title, '⚠ Your base is under attack!');
  assert.equal(tab.attention('The Decade of Peace is over: war begins!'), true);
  assert.equal(doc.title, '(2) ⚠ The Decade of Peace is over: war begins!');
  tab.attention('Zeus is ready!');
  assert.equal(doc.title, '(3) ⚠ Zeus is ready!');
  doc.comeBack();
  assert.equal(doc.title, 'Mythic War');
  mock.timers.tick(5000);
  assert.equal(doc.title, 'Mythic War', 'no more flashing');
  tab.attention('Another');
  assert.equal(doc.title, 'Mythic War', 'the player is here again');
});

test('a window that lost focus counts as away, and focusing it again ends the flashing', () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const { tab, doc, win } = make();
  doc.focused = false;
  assert.equal(tab.away(), true);
  tab.attention('An enemy is near your base!');
  assert.equal(doc.title, '⚠ An enemy is near your base!');
  doc.focused = true;
  win.listeners.get('focus')();
  assert.equal(doc.title, 'Mythic War');
});

test('mode off does nothing; text is cut to a short line', () => {
  const { tab, doc, state } = make({ mode: 'off' });
  doc.hidden = true;
  assert.equal(tab.attention('Anything'), false);
  assert.equal(doc.title, 'Mythic War');
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  state.mode = 'title';
  tab.attention('x'.repeat(300));
  assert.equal(doc.title.length, '⚠ '.length + 90);
  assert.equal(tab.attention(''), false);
});

test('mode notify: a desktop notification as well, at most one per 15 s, only with permission', () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let clock = 1000;
  const Notif = fakeNotification('granted');
  const { tab, doc, win } = make({ mode: 'notify', Notif, now: () => clock });
  doc.hidden = true;
  tab.attention('Your base is under attack!');
  assert.equal(Notif.made.length, 1);
  const n = Notif.made[0];
  assert.equal(n.title, 'Mythic War');
  assert.equal(n.opts.body, 'Your base is under attack!');
  assert.equal(n.opts.silent, true, 'the game has its own sounds');
  assert.equal(n.opts.tag, 'mythicwar-alert', 'one notification replaces the last');
  clock += 5000;
  tab.attention('Another alert');
  assert.equal(Notif.made.length, 1, 'too soon after the last');
  assert.equal(doc.title, '(2) ⚠ Another alert', 'but the title still tells');
  clock += 15000;
  tab.attention('A third');
  assert.equal(Notif.made.length, 2);
  n.onclick();
  assert.equal(win.focusCalls, 1);
  assert.equal(n.closed, 1);
  mock.timers.tick(8000);
  assert.equal(Notif.made[1].closed, 1, 'closes itself after a few seconds');

  const denied = fakeNotification('denied');
  const d = make({ mode: 'notify', Notif: denied });
  d.doc.hidden = true;
  assert.equal(d.tab.attention('Blocked'), true);
  assert.equal(denied.made.length, 0, 'no permission, no notification');
  assert.equal(d.doc.title, '⚠ Blocked');

  const fails = fakeNotification('granted');
  const Constructor = class extends fails {
    constructor() {
      throw new TypeError('Illegal constructor');
    }
  };
  const f = make({ mode: 'notify', Notif: Constructor });
  f.doc.hidden = true;
  assert.doesNotThrow(() => f.tab.attention('Some phones cannot raise one'));
  assert.equal(f.doc.title, '⚠ Some phones cannot raise one');
});

test('dispose restores the title and stops listening', () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const { tab, doc, win } = make();
  doc.hidden = true;
  tab.attention('Alert');
  tab.dispose();
  assert.equal(doc.title, 'Mythic War');
  assert.equal(doc.listeners.size, 0);
  assert.equal(win.listeners.size, 0);
  assert.equal(tab.attention('After'), false);
});

test('without a document (Node) everything is a quiet no-op', () => {
  const tab = new TabAttention({ doc: null, win: null, Notif: undefined });
  assert.equal(tab.attention('Nobody home'), false);
  assert.equal(tab.away(), false);
  assert.doesNotThrow(() => tab.dispose());
});
