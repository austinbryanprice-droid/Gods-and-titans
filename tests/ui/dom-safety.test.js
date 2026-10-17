// Untrusted strings (player names, chat, lobby state from the host, room codes,
// kick / end reasons, URL params) must reach the page only as text: no HTML
// parsing sinks in the UI code, no inline handlers, no unsafe URLs, no CSS
// injection through player colours. A tiny fake DOM stands in for the browser.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------- fake DOM

class FakeNode {}
class FakeText extends FakeNode {
  constructor(data) {
    super();
    this.nodeType = 3;
    this.data = String(data);
  }
}
class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.className = '';
    this.childNodes = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.htmlWrites = [];
    const styleProps = new Map();
    this.style = new Proxy({ setProperty: (k, v) => styleProps.set(k, String(v)), getPropertyValue: (k) => styleProps.get(k) || '' }, {
      set: (o, k, v) => { styleProps.set(k, String(v)); return true; },
      get: (o, k) => (k in o ? o[k] : styleProps.get(k) || ''),
    });
    // a few real properties so h()'s `k in el` branch behaves like in a browser
    this.type = '';
    this.value = '';
    this.disabled = false;
    this.checked = false;
    this.title = '';
  }
  set innerHTML(v) { this.htmlWrites.push(String(v)); }
  get innerHTML() { return ''; }
  set outerHTML(v) { this.htmlWrites.push(String(v)); }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  hasAttribute(k) { return this.attributes.has(k); }
  removeAttribute(k) { this.attributes.delete(k); }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  appendChild(n) { this.childNodes.push(n); return n; }
  append(...ns) { for (const n of ns) this.appendChild(typeof n === 'string' ? new FakeText(n) : n); }
  get firstChild() { return this.childNodes[0] || null; }
  set textContent(v) { this.childNodes = v === '' ? [] : [new FakeText(v)]; }
  get textContent() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join(''); }
}

before(() => {
  globalThis.Node = FakeNode;
  globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (t) => new FakeText(t),
  };
});

const EVIL = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

// ---------------------------------------------------------------- static scan

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(js|mjs|html)$/.test(name)) out.push(p);
  }
  return out;
}

test('no HTML-parsing or code-evaluating sinks in the UI, game controller, settings or audio code', () => {
  const list = [...files(join(ROOT, 'src', 'ui')), join(ROOT, 'src', 'game', 'game.js'), join(ROOT, 'src', 'main.js'), join(ROOT, 'src', 'settings.js'), join(ROOT, 'src', 'audio', 'sfx.js'), join(ROOT, 'index.html')];
  const SINKS = [/\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML\s*\(/, /document\.write(ln)?\s*\(/, /\beval\s*\(/, /new\s+Function\s*\(/, /javascript:/i, /\.srcdoc\s*=/, /createContextualFragment/, /DOMParser/];
  const hits = [];
  for (const f of list) {
    const src = readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '') // comments may mention the words
      .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
    for (const re of SINKS) if (re.test(src)) hits.push(`${f.slice(ROOT.length + 1)}: ${re}`);
  }
  assert.deepEqual(hits, []);
});

// ---------------------------------------------------------------- DOM helpers

test('hud el(): strings always become text nodes', async () => {
  const { el } = await import('../../src/ui/hud-dom.js');
  const n = el('div', 'x', EVIL, 5, null, ['a', EVIL]);
  assert.equal(n.htmlWrites.length, 0);
  assert.ok(n.childNodes.every((c) => c instanceof FakeText));
  assert.equal(n.textContent, `${EVIL}5a${EVIL}`);
});

test('menu h(): text children, no inline handlers, no unsafe URLs, no HTML properties', async () => {
  const { h, setChildren } = await import('../../src/ui/menu-dom.js');
  const n = h('div.a.b', { title: EVIL, 'aria-label': EVIL }, EVIL);
  assert.equal(n.className, 'a b');
  assert.equal(n.getAttribute('title'), EVIL); // attribute values are inert text
  assert.ok(n.childNodes[0] instanceof FakeText);

  const handler = () => {};
  const b = h('button', { onclick: 'alert(1)', onmouseover: EVIL, onfocus: handler });
  assert.equal(b.hasAttribute('onclick'), false);
  assert.equal(b.hasAttribute('onmouseover'), false);
  assert.equal(b.listeners.get('focus'), handler);
  assert.equal(b.listeners.has('click'), false);

  for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', '\u0001javascript:x', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'jav\nascript:1']) {
    const a = h('a', { href: bad, src: bad });
    assert.equal(a.hasAttribute('href'), false, bad);
    assert.equal(a.hasAttribute('src'), false, bad);
  }
  assert.equal(h('a', { href: 'https://example.com/?join=ABCDE' }).getAttribute('href'), 'https://example.com/?join=ABCDE');
  assert.equal(h('a', { href: './index.html?x=1' }).getAttribute('href'), './index.html?x=1');

  const x = h('div', { innerHTML: EVIL, outerHTML: EVIL, srcdoc: EVIL });
  const y = h('div', { innerHTML: { toString: () => EVIL } });
  assert.equal(x.htmlWrites.length + y.htmlWrites.length, 0);
  assert.equal(x.hasAttribute('srcdoc'), false);

  const z = setChildren(h('ul'), EVIL, h('li', EVIL));
  assert.ok(z.childNodes[0] instanceof FakeText);
  assert.equal(z.htmlWrites.length, 0);
});

test('safeColor only lets #rgb / #rrggbb through', async () => {
  const { safeColor } = await import('../../src/ui/hud-dom.js');
  assert.equal(safeColor('#d63a3a'), '#d63a3a');
  assert.equal(safeColor('#ABC'), '#ABC');
  for (const bad of ['red', 'url(https://evil.test/x.png)', '#12345', '#1234567', 'expression(alert(1))', '#d63a3a; background:url(x)', '', null, undefined, 5, {}, 'var(--x)']) {
    assert.equal(safeColor(bad), '#888888', String(bad));
    assert.equal(safeColor(bad, '#123456'), '#123456');
  }
});

// ---------------------------------------------------------------- menu model (pure)

test('room codes from typing, pasted links, the URL or the host are reduced to the code alphabet', async () => {
  const M = await import('../../src/ui/menu-model.js');
  const ok = (c) => c.length <= ROOM_CODE_LENGTH && [...c].every((ch) => ROOM_CODE_ALPHABET.includes(ch));
  for (const raw of [EVIL, '"><svg onload=alert(1)>', 'javascript:alert(1)', 'abcde', '?join=%3Cscript%3E', 'https://x.test/?join=k7m2p&peerHost=evil', '‮EDCBA', null, 42, { toString: () => EVIL }]) {
    const c = M.cleanRoomCode(raw);
    assert.ok(ok(c), `${String(raw)} → ${c}`);
  }
  assert.equal(M.cleanRoomCode('https://x.test/?join=k7m2p&peerHost=evil'), 'K7M2P');
});

test('invite links: only http(s), the cleaned code and the network params survive', async () => {
  const M = await import('../../src/ui/menu-model.js');
  const link = M.inviteLink('https://mw.test/play/?mockLobby=1&peerHost=broker.test&relay=1&net=local&evil=%3Cx%3E#frag', '"><b>K7M2P');
  const u = new URL(link);
  assert.equal(u.origin + u.pathname, 'https://mw.test/play/');
  assert.equal(u.hash, '');
  assert.deepEqual([...u.searchParams.keys()].sort(), ['join', 'net', 'peerHost', 'relay']);
  assert.ok([...u.searchParams.get('join')].every((ch) => ROOM_CODE_ALPHABET.includes(ch)));
  assert.equal(M.inviteLink('javascript:alert(1)//', 'ABCDE'), '');
  assert.equal(M.inviteLink('data:text/html,hi', 'ABCDE'), '');
});

test('safeUrl accepts relative, http(s) and mailto only', async () => {
  const { safeUrl } = await import('../../src/ui/menu-model.js');
  assert.equal(safeUrl('https://a.test/x'), 'https://a.test/x');
  assert.equal(safeUrl('http://a.test'), 'http://a.test');
  assert.equal(safeUrl('/x?y=1'), '/x?y=1');
  assert.equal(safeUrl('x.html'), 'x.html');
  assert.equal(safeUrl('mailto:a@b.test'), 'mailto:a@b.test');
  for (const bad of ['javascript:1', 'JAVASCRIPT:1', ' java script:1', 'java\u0000script:1', 'data:,x', 'blob:https://a/x', 'file:///etc/passwd', '', null, 7]) assert.equal(safeUrl(bad), '', String(bad));
});

test('join errors and kick reasons are shown as short single-line text', async () => {
  const M = await import('../../src/ui/menu-model.js');
  const long = `${'x'.repeat(5000)}\n‮${EVIL}`;
  const msg = M.friendlyJoinError(new Error(long), '<b>');
  assert.ok(msg.length <= 300);
  assert.doesNotMatch(msg, /[\u0000-\u001f‮]/);
  assert.equal(M.cleanMessage('\u0000Kicked\nby‮ host  ', 'fallback'), 'Kicked by host');
  assert.equal(M.cleanMessage({ reason: 1 }, 'You left the lobby.'), '[object Object]');
  assert.equal(M.cleanMessage(null, 'You left the lobby.'), 'You left the lobby.');
  // the network layer's texts still pass through unchanged
  const net = "Couldn't connect to the host. You may be behind a strict firewall; try another network.";
  assert.equal(M.friendlyJoinError(new Error(net), 'ABCDE'), net);
  assert.match(M.friendlyJoinError(new Error('Room K7M2P was not found'), '<k7m2p>'), /code K7M2P\./);
  const { PEER_MESSAGES, brokerMessage } = await import('../../src/net/transport.js');
  for (const text of [...Object.values(PEER_MESSAGES).filter((t) => /^Couldn't/.test(t)), brokerMessage({ peerHost: 'full-version-timeout.not-found.test' })]) {
    assert.equal(M.friendlyJoinError(new Error(text), 'ABCDE'), text);
  }
});

test('lobby chat lines: names and text cleaned, bounded, never markup', async () => {
  const M = await import('../../src/ui/menu-model.js');
  const m = M.normalizeChat({ from: 1, name: `Ev‮il${'n'.repeat(50)}`, text: `hi\nthere\u0000 ${'y'.repeat(500)}` });
  assert.equal(m.system, false);
  assert.ok(m.from.length <= 20);
  assert.doesNotMatch(m.from, /‮/);
  assert.ok(m.text.startsWith('hi there'));
  assert.ok([...m.text].length <= 200);
  assert.equal(M.normalizeChat({ from: -1, text: EVIL, system: true }).text, EVIL.replace(/\s+/g, ' ')); // text node later
  assert.equal(M.normalizeChat('Zeus', 'hello').from, 'Zeus');
});

test('custom network setups get a plain note telling the host to send the link', async () => {
  const M = await import('../../src/ui/menu-model.js');
  assert.equal(M.customServerNote('https://mw.test/'), null);
  assert.match(M.customServerNote('https://mw.test/?transport=local'), /Local test mode/);
  assert.match(M.customServerNote('https://mw.test/?peerHost=broker.test'), /broker\.test.*invite link/);
  assert.match(M.customServerNote('https://mw.test/?relay=1'), /invite link/);
  const n = M.customServerNote(`https://mw.test/?peerHost=${encodeURIComponent(`${EVIL}${'z'.repeat(200)}`)}`);
  assert.ok(n.length < 200);
  assert.equal(M.customServerNote('not a url'), null);
});
