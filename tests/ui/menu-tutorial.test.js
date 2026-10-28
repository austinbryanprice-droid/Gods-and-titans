// The title screen's Learn to Play (src/ui/menu.js): it starts the guided first match at once (no
// lobby), points a newcomer at it, and names the best medal once there is one; the career screen
// lists that medal too. Fake DOM, set up as in alert-settings.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDom } from './fake-dom.js';
import { resetCareer, sanitizeCareer } from '../../src/game/career.js';
import { saveSettings } from '../../src/settings.js';

let menu;
before(async () => {
  installFakeDom();
  globalThis.Node = class {
    static [Symbol.hasInstance](x) {
      return !!x && (x.nodeType === 1 || x.nodeType === 3);
    }
  };
  const anything = () => new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : anything()), apply: () => anything() });
  FakeElement.prototype.getContext = function getContext() {
    this.ctxAny = this.ctxAny || anything();
    return this.ctxAny;
  };
  FakeElement.prototype.querySelectorAll = () => [];
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  menu = await import('../../src/ui/menu.js');
});
after(() => resetCareer({}));

function titleWith(career) {
  resetCareer(career);
  const root = document.createElement('div');
  const launches = [];
  menu.createMenu({ root, onStart: (l) => launches.push(l) });
  menu.showMenu('title');
  const learn = root.all('button').find((b) => b.textContent.includes('Learn to Play'));
  return { root, learn, launches };
}

test('Learn to Play starts the guided first match at once, as the host of a solo game', () => {
  saveSettings({ name: 'Ada' });
  const { learn, launches } = titleWith({});
  assert.ok(learn, 'the button is on the title screen');
  learn.click();
  assert.equal(launches.length, 1);
  const l = launches[0];
  assert.equal(l.role, 'host');
  assert.equal(l.myIndex, 0);
  assert.equal(l.setup.tutorial, true);
  assert.equal(l.setup.players[0].name, 'Ada');
  assert.equal(l.conns.size, 0);
});

test('a newcomer is pointed at the lesson; a player with a medal sees their best instead', () => {
  assert.match(titleWith({}).learn.textContent, /New\? Start here/);
  const played = titleWith({ games: 3, wins: 1, losses: 2 });
  assert.doesNotMatch(played.learn.textContent, /Start here/);
  const medal = titleWith({ best: { medal: 2 } });
  assert.doesNotMatch(medal.learn.textContent, /Start here/);
  assert.match(medal.learn.textContent, /your best: 🥈 Silver medal/);
});

test('the career screen lists the best medal of the guided first match', async () => {
  const { renderCareerContent } = await import('../../src/ui/menu-career.js');
  const root = document.createElement('div');
  for (const n of renderCareerContent(sanitizeCareer({ best: { medal: 3 } }), new Set())) root.appendChild(n);
  assert.match(root.textContent, /Guided first match/);
  assert.match(root.textContent, /🥇 Gold medal/);
  const none = document.createElement('div');
  for (const n of renderCareerContent(sanitizeCareer({}), new Set())) none.appendChild(n);
  assert.doesNotMatch(none.textContent, /Guided first match/);
});
