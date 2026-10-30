// Phones and tablets (no touch controls): the title and Join screens say the game needs a mouse and
// keyboard (src/ui/menu-model.js isTouchOnly, TOUCH_NOTICE; main.js passes it to menu.setNotice).
// Fake DOM, set up as in menu-tutorial.test.js.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDom } from './fake-dom.js';
import { isTouchOnly, TOUCH_NOTICE } from '../../src/ui/menu-model.js';

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

const media = (q) => (query) => ({ matches: !!q[query] });

test('isTouchOnly: a coarse pointer and no fine one anywhere; a mouse or trackpad attached is enough', () => {
  assert.equal(isTouchOnly(media({ '(pointer: coarse)': true })), true, 'a phone');
  assert.equal(isTouchOnly(media({ '(pointer: coarse)': true, '(any-pointer: fine)': true })), false, 'a tablet with a trackpad');
  assert.equal(isTouchOnly(media({ '(pointer: fine)': true, '(any-pointer: fine)': true })), false, 'a computer');
  assert.equal(isTouchOnly(media({ '(pointer: fine)': true, '(any-pointer: fine)': true, '(any-pointer: coarse)': true })), false, 'a touch-screen laptop');
  assert.equal(isTouchOnly(undefined), false, 'no matchMedia: assume a computer');
  assert.equal(isTouchOnly(() => { throw new Error('nope'); }), false);
  assert.match(TOUCH_NOTICE, /mouse and keyboard/);
});

test('the notice shows on the title screen and on the Join screen an invite link opens', () => {
  const root = document.createElement('div');
  const m = menu.createMenu({ root, onStart() {} });
  m.go('title');
  m.setNotice(TOUCH_NOTICE);
  assert.match(root.textContent, /needs a mouse and keyboard/, 'title');
  m.go('join', { code: 'ABCDE' });
  assert.match(root.textContent, /needs a mouse and keyboard/, 'join');
  m.setNotice(null);
  assert.doesNotMatch(root.textContent, /needs a mouse and keyboard/, 'cleared, and the Join screen drawn again');
  assert.ok(root.all('input').some((i) => (i.value ?? i.getAttribute('value')) === 'ABCDE'), 'the Join screen drawn again keeps the invite code');
});
