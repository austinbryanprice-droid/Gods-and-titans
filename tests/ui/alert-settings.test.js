// The Alerts settings in both places they can be changed, the main menu's Settings screen and the
// F10 menu in a match: how much the game speaks up, whether gameplay tips appear, and what a tab in
// the background does (asking the browser for permission when "Notification" is picked, and falling
// back to the title flash, with the reason, when it is refused). Fake DOM; a fake Notification class
// stands in for the browser's.
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDom } from './fake-dom.js';
import { getSettings, saveSettings, ALERT_LEVEL_IDS, TAB_ALERT_MODES } from '../../src/settings.js';
import { ALERT_OPTIONS, TAB_ALERT_OPTIONS, alertNote, tabAlertNote } from '../../src/ui/alert-options.js';
import { Overlays } from '../../src/ui/hud-overlays.js';

let menuRoot;
let showMenu;
before(async () => {
  installFakeDom();
  // menu-dom's h() asks `instanceof Node`; the fake nodes carry a nodeType instead.
  globalThis.Node = class {
    static [Symbol.hasInstance](x) {
      return !!x && (x.nodeType === 1 || x.nodeType === 3);
    }
  };
  // The menu's night-sky backdrop draws on canvases and animates: any drawing call will do, and no frames come.
  const anything = () => new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : anything()), apply: () => anything() });
  FakeElement.prototype.getContext = function getContext() {
    this.ctxAny = this.ctxAny || anything();
    return this.ctxAny;
  };
  FakeElement.prototype.querySelectorAll = () => [];
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  const menu = await import('../../src/ui/menu.js');
  menuRoot = document.createElement('div');
  menu.createMenu({ root: menuRoot, onStart() {} });
  showMenu = menu.showMenu;
});

beforeEach(() => saveSettings({ alerts: 'all', hints: true, tabAlerts: 'title' }));
afterEach(() => {
  delete globalThis.Notification;
});

/** A Notification class whose permission prompt ends in `answer` ('granted', 'denied', or 'default' for a dismissed prompt). */
function fakeNotification(permission, answer = permission) {
  return class FakeNotification {
    static permission = permission;
    static asked = 0;
    static requestPermission() {
      FakeNotification.asked++;
      FakeNotification.permission = answer;
      return Promise.resolve(answer);
    }
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const button = (group, text) => group.buttons.find((b) => b.textContent === text);
// The fake DOM keeps a class name and the class list apart: a button starts out with the former,
// and a click lights buttons through the latter (for all of the group at once).
const active = (group) => {
  const on = group.buttons.find((b) => b.classList.contains('is-active')) || group.buttons.find((b) => b.className.split(' ').includes('is-active'));
  return on.textContent;
};

// ---------------------------------------------------------------- the choices themselves

test('the Alerts options line up with the settings values, and each explains itself', () => {
  assert.deepEqual(ALERT_OPTIONS.map((o) => o[0]), Array.from(ALERT_LEVEL_IDS));
  assert.deepEqual(TAB_ALERT_OPTIONS.map((o) => o[0]), Array.from(TAB_ALERT_MODES));
  for (const [id, label, note] of [...ALERT_OPTIONS, ...TAB_ALERT_OPTIONS]) assert.ok(label.length > 1 && note.length > 20, id);
  assert.equal(alertNote('important'), ALERT_OPTIONS[1][2]);
  assert.equal(alertNote('nope'), '');
  assert.equal(tabAlertNote('title'), TAB_ALERT_OPTIONS[1][2]);
  assert.equal(tabAlertNote('nope'), '');
});

test('the Notification note says why only the title flashes when the browser cannot do more', () => {
  const note = (state, fellBack) => tabAlertNote('notify', state, fellBack);
  assert.match(note('unsupported'), /cannot show notifications/);
  assert.match(note('denied'), /blocked for this site/);
  assert.match(note('default', true), /were not allowed/);
  assert.equal(note('granted'), TAB_ALERT_OPTIONS[2][2]);
  assert.equal(note('default'), TAB_ALERT_OPTIONS[2][2], 'not asked yet: it will ask when picked');
  assert.equal(tabAlertNote('title', 'denied', true), TAB_ALERT_OPTIONS[1][2], 'only "notify" has these notes');
});

// ---------------------------------------------------------------- the two screens

/** The main menu's Settings screen, as groups of segmented buttons. */
function settingsScreen() {
  showMenu('settings');
  const field = (label) => menuRoot.findAll('mw-field').find((f) => f.find('mw-label') && f.find('mw-label').textContent === label);
  const group = (label) => {
    const f = field(label);
    return { buttons: f.findAll('mw-seg'), note: () => f.find('mw-field-note').textContent };
  };
  const tips = menuRoot.findAll('mw-toggle').find((t) => t.textContent.startsWith('Gameplay tips'));
  return { hints: tips.all('input')[0], alerts: group('Alerts'), tab: group('When this tab is in the background'), root: menuRoot };
}

function f10Game() {
  return { session: null, viewState: { myIndex: 0, time: 125, me: { defeated: false } }, setPaused: () => false, quitToMenu() {}, surrender() {} };
}

/** The F10 menu of a match. */
function f10Menu() {
  const root = document.createElement('div');
  new Overlays(root, f10Game()).openMenu();
  const group = (label) => {
    const row = root.findAll('hud-choice').find((c) => c.find('hud-choice-label').textContent === label);
    return { buttons: row.findAll('mw-seg'), note: () => row.find('hud-choice-note').textContent };
  };
  const tips = root.findAll('hud-toggle').find((t) => t.find('hud-toggle-text').textContent.startsWith('Gameplay tips'));
  return { hints: tips.find('hud-toggle-input'), alerts: group('Alerts'), tab: group('When this tab is in the background'), root };
}

for (const [name, open] of [['Settings screen', settingsScreen], ['F10 menu', f10Menu]]) {
  test(`${name}: gameplay tips can be turned off and on`, () => {
    const s = open();
    s.hints.checked = false;
    s.hints.fire('change');
    assert.equal(getSettings().hints, false);
    s.hints.checked = true;
    s.hints.fire('change');
    assert.equal(getSettings().hints, true);
  });

  test(`${name}: the Alerts choices save, light up and explain themselves`, () => {
    const s = open();
    assert.deepEqual(s.alerts.buttons.map((b) => b.textContent), ['All', 'Warnings only', 'Off']);
    assert.equal(active(s.alerts), 'All');
    assert.equal(s.alerts.note(), alertNote('all'));
    button(s.alerts, 'Warnings only').click();
    assert.equal(getSettings().alerts, 'important');
    assert.equal(active(s.alerts), 'Warnings only');
    assert.equal(s.alerts.note(), alertNote('important'));
    button(s.alerts, 'Off').click();
    assert.equal(getSettings().alerts, 'off');
    assert.equal(active(s.alerts), 'Off');
    assert.equal(s.alerts.note(), alertNote('off'));
    button(s.alerts, 'All').click();
    assert.equal(getSettings().alerts, 'all');
  });

  test(`${name}: the background-tab choices; Notification asks the browser, a refusal keeps the title flash and says why`, async () => {
    // Off and Flash the tab never ask for anything.
    const never = (globalThis.Notification = fakeNotification('default'));
    let s = open();
    assert.deepEqual(s.tab.buttons.map((b) => b.textContent), ['Off', 'Flash the tab', 'Notification']);
    assert.equal(active(s.tab), 'Flash the tab');
    button(s.tab, 'Off').click();
    await settle();
    assert.equal(getSettings().tabAlerts, 'off');
    assert.equal(active(s.tab), 'Off');
    button(s.tab, 'Flash the tab').click();
    await settle();
    assert.equal(getSettings().tabAlerts, 'title');
    assert.equal(never.asked, 0);

    // Allowed: it sticks.
    globalThis.Notification = fakeNotification('default', 'granted');
    button(s.tab, 'Notification').click();
    await settle();
    assert.equal(getSettings().tabAlerts, 'notify');
    assert.equal(active(s.tab), 'Notification');
    assert.equal(s.tab.note(), tabAlertNote('notify', 'granted'));

    // Blocked in the browser: back to the title flash, with the reason.
    saveSettings({ tabAlerts: 'title' });
    globalThis.Notification = fakeNotification('denied');
    s = open();
    button(s.tab, 'Notification').click();
    await settle();
    assert.equal(getSettings().tabAlerts, 'title');
    assert.equal(active(s.tab), 'Flash the tab');
    assert.match(s.tab.note(), /blocked for this site/);

    // The prompt was dismissed.
    globalThis.Notification = fakeNotification('default', 'default');
    s = open();
    button(s.tab, 'Notification').click();
    await settle();
    assert.equal(getSettings().tabAlerts, 'title');
    assert.equal(active(s.tab), 'Flash the tab');
    assert.match(s.tab.note(), /were not allowed/);

    // A browser without notifications.
    delete globalThis.Notification;
    s = open();
    button(s.tab, 'Notification').click();
    await settle();
    assert.equal(getSettings().tabAlerts, 'title');
    assert.equal(active(s.tab), 'Flash the tab');
    assert.match(s.tab.note(), /cannot show notifications/);
  });

  test(`${name}: picking again while the browser's prompt is open keeps the newer pick`, async () => {
    let answer;
    globalThis.Notification = class SlowNotification {
      static permission = 'default';
      static requestPermission() {
        return new Promise((resolve) => {
          answer = () => {
            SlowNotification.permission = 'granted';
            resolve('granted');
          };
        });
      }
    };
    const s = open();
    button(s.tab, 'Notification').click(); // the prompt is open...
    button(s.tab, 'Off').click(); // ...and the player picks Off
    await settle();
    assert.equal(getSettings().tabAlerts, 'off');
    assert.equal(active(s.tab), 'Off');
    answer(); // the prompt is answered late
    await settle();
    assert.equal(getSettings().tabAlerts, 'off', 'the late answer does not overwrite it');
    assert.equal(active(s.tab), 'Off');
    assert.equal(s.tab.note(), tabAlertNote('off'));
  });
}

test('F10 menu: the new rows sit with the other options, before the sound and music, and show the saved choices', () => {
  saveSettings({ alerts: 'important', hints: false, tabAlerts: 'off' });
  const s = f10Menu();
  const text = s.root.find('hud-options').textContent;
  const order = ['Getting-started tips', 'Gameplay tips', 'Alerts', 'When this tab is in the background', 'Sound effects', 'Music'].map((label) => text.indexOf(label));
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), order.join(' < '));
  assert.equal(active(s.alerts), 'Warnings only');
  assert.equal(s.alerts.note(), alertNote('important'));
  assert.equal(active(s.tab), 'Off');
  assert.equal(s.hints.checked, false);
});

test('Settings screen: the new rows show the saved choices', () => {
  saveSettings({ alerts: 'off', tabAlerts: 'notify' });
  globalThis.Notification = fakeNotification('granted');
  const s = settingsScreen();
  assert.equal(active(s.alerts), 'Off');
  assert.equal(s.alerts.note(), alertNote('off'));
  assert.equal(active(s.tab), 'Notification');
  assert.equal(s.tab.note(), tabAlertNote('notify', 'granted'));
  delete globalThis.Notification;
  saveSettings({ tabAlerts: 'notify' });
  assert.match(settingsScreen().tab.note(), /cannot show notifications/, 'a saved choice the browser cannot honor says so');
});
