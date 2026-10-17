// The host must accept only connections that use the game's PeerJS serialization
// (the pass-through 'raw' / None serializer). PeerJS instantiates whichever
// serializer the *connecting* side declares, and its binary / json serializers
// decode each incoming message (BinaryPack unpack(), JSON.parse) BEFORE emitting
// 'data' — i.e. before FramedConn / FrameDecoder ever see the bytes, so none of
// the host's size, shape or flood limits apply to them. The vendored BinaryPack
// unpacker does no bounds checks, so a ~3–5 byte header can make the host
// allocate / loop on an attacker-controlled count and freeze or OOM the tab.
// The fix refuses every incoming connection whose serialization is not 'raw',
// at the 'connection' event, before its data channel opens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  hostRoom, FramedConn, PEER_SERIALIZATION, MAX_HOST_CONNECTIONS, MAX_PENDING_HANDSHAKES,
} from '../../src/net/transport.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- fake PeerJS

/** Minimal event emitter matching the eventemitter3 surface transport.js uses. */
class Emitter {
  constructor() { this._h = new Map(); }
  on(ev, cb) { (this._h.get(ev) || this._h.set(ev, []).get(ev)).push(cb); return this; }
  off(ev, cb) {
    const a = this._h.get(ev);
    if (a) { const i = a.indexOf(cb); if (i >= 0) a.splice(i, 1); }
    return this;
  }
  emit(ev, ...args) {
    for (const cb of (this._h.get(ev) || []).slice()) cb(...args);
    return this;
  }
}

/** Stand-in for a PeerJS DataConnection as the host sees it on 'connection'. */
class FakeDataConnection extends Emitter {
  constructor(serialization, peer = 'client') {
    super();
    this.serialization = serialization; // set by the serializer class, as in real PeerJS
    this.peer = peer;
    this.closed = false;
    this.sent = [];
  }
  send(f) { this.sent.push(f); }
  close() { if (!this.closed) { this.closed = true; this.emit('close'); } }
  /** Pretend the WebRTC data channel finished opening. */
  openChannel() { this.emit('open'); }
}

/** Stand-in for a PeerJS Peer: opens at once, lets a test drive 'connection'. */
class FakePeer extends Emitter {
  constructor(id) {
    super();
    this.id = id || 'mythicwar-ABCDE';
    this.destroyed = false;
    this.calls = [];
    setTimeout(() => this.emit('open', this.id), 0);
  }
  destroy() { this.destroyed = true; }
  reconnect() {}
}

async function hostPeerEndpoint() {
  const prev = globalThis.Peer;
  globalThis.Peer = FakePeer;
  try {
    const ep = await hostRoom({ transport: 'peer', roomCode: 'ABCDE', params: { peerHost: '127.0.0.1', peerPort: 9000, peerPath: '/x', peerSecure: false } });
    return { ep, peer: ep.peer, restore: () => { globalThis.Peer = prev; } };
  } catch (err) {
    globalThis.Peer = prev;
    throw err;
  }
}

// ---------------------------------------------------------------- the guard

test('host refuses an incoming connection whose serialization is not the game\'s, before it opens', async () => {
  const { ep, peer, restore } = await hostPeerEndpoint();
  try {
    const accepted = [];
    ep.onConnection((c) => accepted.push(c));
    // PeerJS reports "binary" for its default / binary serializer and "json" for json.
    for (const ser of ['binary', 'json', 'binary-utf8', undefined, '', 'raw-ish']) {
      const dc = new FakeDataConnection(ser);
      peer.emit('connection', dc);
      assert.equal(dc.closed, true, `serialization ${JSON.stringify(ser)} must be closed`);
      // Opening it afterwards must not sneak it through.
      dc.openChannel();
    }
    await sleep(5);
    assert.equal(accepted.length, 0, 'no hostile-serialization connection was accepted');
    assert.equal(ep.pendingOpen, 0, 'refused connections hold no pending slot');
  } finally {
    ep.close();
    restore();
  }
});

test('host accepts a raw connection once its channel opens (the serialization the joiner pins)', async () => {
  assert.equal(PEER_SERIALIZATION, 'raw');
  const { ep, peer, restore } = await hostPeerEndpoint();
  try {
    const accepted = [];
    ep.onConnection((c) => accepted.push(c));
    const dc = new FakeDataConnection('raw', 'client-1');
    peer.emit('connection', dc);
    assert.equal(dc.closed, false, 'a raw connection is not refused');
    assert.equal(ep.pendingOpen, 1, 'held as a pending handshake until it opens');
    dc.openChannel();
    await sleep(5);
    assert.equal(accepted.length, 1, 'the raw connection was handed to onConnection');
    assert.equal(ep.pendingOpen, 0, 'no longer pending once open');
    assert.ok(accepted[0] instanceof FramedConn);
  } finally {
    ep.close();
    restore();
  }
});

// ---------------------------------------------------------------- ceilings

test('host caps pending handshakes and total connections against a connection flood', async () => {
  const { ep, peer, restore } = await hostPeerEndpoint();
  try {
    // Open far more raw connections than a room can ever need, without opening
    // their channels: beyond MAX_PENDING_HANDSHAKES they are closed at once.
    const pending = [];
    for (let i = 0; i < MAX_PENDING_HANDSHAKES + 6; i++) {
      const dc = new FakeDataConnection('raw', `p${i}`);
      peer.emit('connection', dc);
      pending.push(dc);
    }
    const held = pending.filter((d) => !d.closed).length;
    const refused = pending.filter((d) => d.closed).length;
    assert.equal(held, MAX_PENDING_HANDSHAKES, 'only MAX_PENDING_HANDSHAKES handshakes are held');
    assert.equal(refused, 6, 'the rest are refused immediately');
    assert.equal(ep.pendingOpen, MAX_PENDING_HANDSHAKES);

    // Open the held ones; they become live connections.
    for (const d of pending) if (!d.closed) d.openChannel();
    await sleep(5);
    assert.equal(ep.pendingOpen, 0);
    assert.equal(ep.conns.size, MAX_PENDING_HANDSHAKES);

    // Keep opening fresh connections (each opens its channel right away) up to
    // and past the total ceiling.
    let opened = ep.conns.size;
    let lastRefused = false;
    for (let i = 0; i < MAX_HOST_CONNECTIONS; i++) {
      const dc = new FakeDataConnection('raw', `o${i}`);
      peer.emit('connection', dc);
      if (!dc.closed) dc.openChannel();
      await sleep(1);
      if (dc.closed) { lastRefused = true; break; }
      opened++;
    }
    assert.ok(ep.conns.size <= MAX_HOST_CONNECTIONS, `conns never exceed the ceiling (${ep.conns.size})`);
    assert.ok(lastRefused, 'connections past the total ceiling are refused');
  } finally {
    ep.close();
    restore();
  }
});

// ------------------------------------------- the vendored decoder vs the raw path

test('the vendored BinaryPack decoder allocates an attacker-sized structure from a tiny message; the raw path does not', () => {
  // Extract the exact Unpacker class shipped in vendor/peerjs.min.js — the code
  // the binary serializer runs on an incoming message before emitting 'data'.
  const src = readFileSync(path.join(ROOT, 'vendor/peerjs.min.js'), 'utf8');
  const start = src.indexOf('class o{unpack(){');
  const end = src.indexOf('class a{getBuffer()', start);
  assert.ok(start >= 0 && end > start, 'found the vendored BinaryPack Unpacker');
  const Unpacker = new Function(`${src.slice(start, end)}; return o;`)();
  const unpack = (bytes) => new Unpacker(new Uint8Array(bytes).buffer).unpack();

  // A 3-byte array16 header with count 0xffff: unpack() returns (no throw — OOB
  // reads come back as 0/undefined) a 65535-element Array. The count is wholly
  // attacker-controlled and unbounded (array32 → up to ~4.29e9), with no size
  // or shape check — exactly what the host's FrameDecoder exists to impose.
  const arr = unpack([0xdc, 0xff, 0xff]);
  assert.ok(Array.isArray(arr) && arr.length === 0xffff,
    `3 hostile bytes produced a ${arr.length}-entry array with no bounds check`);

  // The same bytes on the raw path the host now forces: PeerJS hands them
  // through untouched, FramedConn stringifies them, and FrameDecoder rejects the
  // result as one malformed frame in O(1) — nothing is decoded or allocated.
  const bytesAsString = String(new Uint8Array([0xdc, 0xff, 0xff]).buffer); // '[object ArrayBuffer]'
  const conn = new FramedConn({ id: 'raw', rawSend: () => {}, heartbeatMs: 0, autoPulse: false });
  const got = [];
  conn.onMessage((m) => got.push(m));
  const before = conn.stats.badFrames;
  conn._receive(bytesAsString);
  assert.equal(got.length, 0, 'the hostile bytes yielded no message');
  assert.equal(conn.stats.badFrames, before + 1, 'they were counted as one malformed frame');
  assert.equal(conn.open, true, 'one bad frame does not close the link');
});
