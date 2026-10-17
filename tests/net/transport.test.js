import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoopbackPair, hostRoom, joinRoom, FramedConn } from '../../src/net/transport.js';
import { encodeFrames } from '../../src/net/protocol.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 2000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(2);
  }
}

test('loopback pair delivers messages in order, asynchronously, as JSON copies', async () => {
  const [a, b] = createLoopbackPair();
  const got = [];
  b.onMessage((m) => got.push(m));
  const obj = { t: 'cmd', cmd: { type: 'move', units: [1], x: 1, y: 2 } };
  for (let i = 0; i < 50; i++) a.send({ t: 'n', i });
  a.send(obj);
  assert.equal(got.length, 0, 'not synchronous');
  await waitFor(() => got.length === 51);
  assert.deepEqual(got.slice(0, 50).map((m) => m.i), [...Array(50).keys()]);
  assert.deepEqual(got[50], obj);
  assert.notEqual(got[50], obj);
  a.close();
  b.close();
});

test('large messages (> 64 KB) are chunked on the wire and reassembled', async () => {
  const [a, b] = createLoopbackPair();
  const raw = [];
  const send = a.rawSend;
  a.rawSend = (f) => {
    raw.push(f);
    send(f);
  };
  const big = { t: 'full', snap: { entities: Array.from({ length: 2500 }, (_, i) => ({ id: i, t: 'warrior', x: i / 7, name: 'Nüwa ⚡' })) } };
  const got = [];
  b.onMessage((m) => got.push(m));
  a.send({ t: 'before' });
  a.send(big);
  a.send({ t: 'after' });
  await waitFor(() => got.length === 3);
  assert.ok(JSON.stringify(big).length > 64 * 1024);
  assert.ok(raw.filter((f) => f[0] === '~').length >= 5, 'chunk frames were used');
  assert.ok(raw.every((f) => f.length <= 16100));
  assert.deepEqual(got.map((m) => m.t), ['before', 'full', 'after']);
  assert.deepEqual(got[1], big);
  a.close();
});

test('messages wait for a listener and go to the next one in order (lobby → session hand-off)', async () => {
  const [a, b] = createLoopbackPair();
  const first = [];
  const off = b.onMessage((m) => {
    first.push(m.i);
    if (m.i === 2) off(); // stop listening mid-stream, like the lobby on 'start'
  });
  for (let i = 0; i < 6; i++) a.send({ t: 'n', i });
  await sleep(10);
  assert.deepEqual(first, [0, 1, 2]);
  const second = [];
  b.onMessage((m) => second.push(m.i));
  a.send({ t: 'n', i: 6 });
  await waitFor(() => second.length === 4);
  assert.deepEqual(second, [3, 4, 5, 6]);
  a.close();
});

test('close propagates to both sides with reasons; sends after close fail', async () => {
  const [a, b] = createLoopbackPair();
  const reasons = [];
  a.onClose((r) => reasons.push(['a', r]));
  b.onClose((r) => reasons.push(['b', r]));
  a.close();
  assert.equal(a.open, false);
  assert.equal(a.send({ t: 'x' }), false);
  await waitFor(() => reasons.length === 2);
  assert.deepEqual(reasons, [['a', 'closed'], ['b', 'remote-closed']]);
  // onClose after the fact still fires.
  let late = null;
  b.onClose((r) => (late = r));
  await waitFor(() => late !== null);
  assert.equal(late, 'remote-closed');
});

test('a silent peer times out (heartbeats keep a quiet link alive)', async () => {
  const [a, b, link] = createLoopbackPair({ heartbeatMs: 50, timeoutMs: 600 });
  let closedA = null;
  a.onClose((r) => (closedA = r));
  await sleep(1000);
  assert.equal(closedA, null, 'heartbeats kept the idle link open');
  link.drop = true; // the network dies silently
  await waitFor(() => closedA !== null, 3000, 'timeout close');
  assert.equal(closedA, 'timeout');
  b.close();
});

test('FramedConn survives a throwing listener and a failing raw send', async () => {
  let fail = false;
  const sent = [];
  const c = new FramedConn({ id: 'x', heartbeatMs: 0, rawSend: (f) => {
    if (fail) throw new Error('boom');
    sent.push(f);
  } });
  const got = [];
  const orig = console.error;
  console.error = () => {};
  c.onMessage(() => {
    throw new Error('listener bug');
  });
  c.onMessage((m) => got.push(m.t));
  for (const f of encodeFrames({ t: 'one' }, 1)) c._receive(f);
  console.error = orig;
  assert.deepEqual(got, ['one']);
  assert.ok(c.send({ t: 'ok' }));
  fail = true;
  const warn = console.warn;
  console.warn = () => {};
  assert.equal(c.send({ t: 'nope' }), false);
  console.warn = warn;
  assert.equal(c.open, false);
  assert.equal(c.closeReason, 'error');
});

test('loopback rooms: host endpoint accepts joins by room code; unknown codes are rejected', async () => {
  const ep = await hostRoom({ transport: 'loopback' });
  assert.match(ep.roomCode, /^[A-Z2-9]{5}$/);
  const accepted = [];
  ep.onConnection((c) => {
    accepted.push(c);
    c.onMessage((m) => c.send({ t: 'echo', v: m.v }));
  });
  const c1 = await joinRoom({ transport: 'loopback', roomCode: ep.roomCode.toLowerCase() });
  const got = [];
  c1.onMessage((m) => got.push(m));
  c1.send({ t: 'x', v: 5 });
  await waitFor(() => got.length === 1);
  assert.deepEqual(got[0], { t: 'echo', v: 5 });
  assert.equal(accepted.length, 1);
  await assert.rejects(joinRoom({ transport: 'loopback', roomCode: 'ZZZZZ' }), /not found/);
  let closed = null;
  c1.onClose((r) => (closed = r));
  ep.close();
  await waitFor(() => closed !== null);
  assert.equal(closed, 'remote-closed');
  await assert.rejects(joinRoom({ transport: 'loopback', roomCode: ep.roomCode }), /not found/);
});

test('local transport (BroadcastChannel) works between endpoints in one process', async () => {
  const ep = await hostRoom({ transport: 'local' });
  const server = [];
  ep.onConnection((c) => {
    server.push(c);
    c.onMessage((m) => c.send({ t: 'echo', n: m.n, big: m.big }));
  });
  const c1 = await joinRoom({ transport: 'local', roomCode: ep.roomCode });
  const c2 = await joinRoom({ transport: 'local', roomCode: ep.roomCode });
  const g1 = [];
  const g2 = [];
  c1.onMessage((m) => g1.push(m));
  c2.onMessage((m) => g2.push(m));
  const big = 'z'.repeat(70000);
  c1.send({ t: 'x', n: 1, big });
  c2.send({ t: 'x', n: 2 });
  await waitFor(() => g1.length === 1 && g2.length === 1);
  assert.equal(g1[0].n, 1);
  assert.equal(g1[0].big.length, 70000);
  assert.equal(g2[0].n, 2);
  assert.equal(server.length, 2);
  // A second host cannot take the same code.
  await assert.rejects(hostRoom({ transport: 'local', roomCode: ep.roomCode }), /already hosted/);
  await assert.rejects(joinRoom({ transport: 'local', roomCode: 'QQQQQ', timeoutMs: 200 }), /not found/);
  let closed = 0;
  c1.onClose(() => closed++);
  c2.onClose(() => closed++);
  ep.close();
  await waitFor(() => closed === 2);
});

test("'none' transport hosts without a room code; joining needs a code", async () => {
  const ep = await hostRoom({ transport: 'none' });
  assert.equal(ep.roomCode, null);
  ep.close();
  await assert.rejects(joinRoom({ transport: 'loopback', roomCode: '' }), /room code/);
  await assert.rejects(joinRoom({ transport: 'none', roomCode: 'ABCDE' }), /Cannot join/);
});
