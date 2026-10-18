import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, PEER_ID_PREFIX } from '../../src/config.js';
import {
  makeRoomCode, normalizeRoomCode, isValidRoomCode, peerIdFor, readNetParams, peerOptions, iceServers,
  sanitizeName, sanitizeChat, encodeFrames, FrameDecoder, CHUNK_SIZE, versionMismatchReason,
  MAX_CHAT_LENGTH, MAX_NAME_LENGTH,
} from '../../src/net/protocol.js';
import { RNG } from '../../src/sim/rng.js';

test('room codes use the alphabet and length from config', () => {
  const rng = new RNG(3);
  for (let i = 0; i < 200; i++) {
    const c = makeRoomCode(() => rng.next());
    assert.equal(c.length, ROOM_CODE_LENGTH);
    for (const ch of c) assert.ok(ROOM_CODE_ALPHABET.includes(ch), ch);
    assert.ok(isValidRoomCode(c));
  }
  assert.equal(makeRoomCode(() => 0.999999), ROOM_CODE_ALPHABET.at(-1).repeat(ROOM_CODE_LENGTH));
  assert.equal(peerIdFor('ABCDE'), `${PEER_ID_PREFIX}ABCDE`);
});

test('normalizeRoomCode accepts typed codes, invite links and peer ids', () => {
  assert.equal(normalizeRoomCode(' ab cd e '), 'ABCDE');
  assert.equal(normalizeRoomCode('https://example.com/game/?join=xk7pq'), 'XK7PQ');
  assert.equal(normalizeRoomCode('https://example.com/#join=XK7PQ&x=1'), 'XK7PQ');
  assert.equal(normalizeRoomCode(`${PEER_ID_PREFIX}HJK23`), 'HJK23');
  assert.equal(normalizeRoomCode('abcdefgh'), 'ABCDE');
  assert.equal(normalizeRoomCode('0O1I'), ''); // ambiguous characters are not in the alphabet
  assert.equal(normalizeRoomCode(null), '');
  // A malformed %-escape in a pasted link must not throw: the text is used as it is.
  assert.equal(normalizeRoomCode('?join=%E0%A4%A'), 'EA4A');
  assert.equal(normalizeRoomCode('https://example.com/?join=XK%37PQ'), 'XK7PQ');
  assert.ok(!isValidRoomCode('ABCD'));
  assert.ok(!isValidRoomCode('ABCD0'));
});

test('readNetParams / peerOptions honour URL overrides and TURN', () => {
  const p = readNetParams('?peerHost=localhost&peerPort=9104&peerPath=/myapp&peerSecure=0&turn=turn:t.example.com:3478&turnUser=u&turnPass=p');
  assert.equal(p.peerHost, 'localhost');
  assert.equal(p.peerPort, 9104);
  assert.equal(p.peerPath, '/myapp');
  assert.equal(p.peerSecure, false);
  const o = peerOptions(p);
  assert.equal(o.host, 'localhost');
  assert.equal(o.port, 9104);
  assert.equal(o.path, '/myapp');
  assert.equal(o.secure, false);
  const ice = o.config.iceServers;
  assert.ok(ice.some((s) => [].concat(s.urls).some((u) => u.includes('stun.l.google.com'))));
  assert.ok(ice.some((s) => [].concat(s.urls).some((u) => u.includes('stun.cloudflare.com'))));
  const turn = ice.find((s) => [].concat(s.urls).some((u) => u.startsWith('turn:')));
  assert.deepEqual(turn, { urls: ['turn:t.example.com:3478'], username: 'u', credential: 'p' });

  // No URL params: the public PeerJS cloud broker, spelled out, plus its TURN relays.
  const def = peerOptions(readNetParams(''));
  assert.equal(def.host, '0.peerjs.com');
  assert.equal(def.port, 443);
  assert.equal(def.path, '/');
  assert.equal(def.secure, true);
  assert.equal(def.config.iceTransportPolicy, undefined);
  const defIce = def.config.iceServers;
  assert.ok(defIce.some((s) => [].concat(s.urls).includes('stun:stun.l.google.com:19302')));
  assert.ok(defIce.some((s) => [].concat(s.urls).includes('stun:stun.cloudflare.com:3478')));
  const cloudTurn = defIce.find((s) => [].concat(s.urls).some((u) => u.startsWith('turn:')));
  assert.ok(cloudTurn && cloudTurn.username && cloudTurn.credential && cloudTurn.urls.every((u) => u.includes('turn.peerjs.com')));
  assert.equal(iceServers({}).length, 3);
  assert.equal(iceServers({ peerHost: 'localhost' }).length, 2, 'a self-hosted broker does not get the PeerJS cloud TURN');
  // A TURN server from the link is added to the cloud defaults; ?relay=1 forces relaying.
  const withTurn = peerOptions(readNetParams('?turn=turn:a.example:3478,turns:a.example:5349&turnUser=u&turnPass=p&relay=1'));
  assert.equal(withTurn.host, '0.peerjs.com');
  assert.equal(withTurn.config.iceTransportPolicy, 'relay');
  assert.deepEqual(withTurn.config.iceServers.at(-1), { urls: ['turn:a.example:3478', 'turns:a.example:5349'], username: 'u', credential: 'p' });
  assert.equal(readNetParams('?peerSecure=1').peerSecure, true);
  assert.equal(readNetParams('?net=local').transport, 'local');
  assert.equal(readNetParams('?transport=local').transport, 'local');
  assert.equal(readNetParams('?net=evil').transport, null);
  assert.equal(peerOptions(readNetParams('?peerHost=peer.example.com')).secure, true);
});

test('sanitizing names and chat', () => {
  assert.equal(sanitizeName('  Zeus\n\tFan  '), 'Zeus Fan');
  assert.equal(sanitizeName(''), 'Player');
  assert.equal(sanitizeName('x'.repeat(50)).length, MAX_NAME_LENGTH);
  assert.equal(sanitizeChat('  hello\nworld  '), 'hello world');
  assert.equal(sanitizeChat('a'.repeat(500)).length, MAX_CHAT_LENGTH);
  assert.equal(sanitizeChat('   '), '');
  assert.match(versionMismatchReason('0.1.0', '0.0.9'), /0\.1\.0.*0\.0\.9.*[Rr]eload/);
});

test('framing: small messages are one frame, large ones are chunked and reassembled', () => {
  const small = { t: 'cmd', cmd: { type: 'move', units: [1, 2], x: 3, y: 4 } };
  const f1 = encodeFrames(small, 1);
  assert.equal(f1.length, 1);
  assert.equal(f1[0][0], '{');
  const dec = new FrameDecoder();
  assert.deepEqual(dec.push(f1[0]), small);

  const big = { t: 'full', snap: { entities: Array.from({ length: 3000 }, (_, i) => ({ id: i, name: `ünït ${i} ⚡`, x: i * 0.25 })) } };
  const frames = encodeFrames(big, 7);
  assert.ok(JSON.stringify(big).length > 64 * 1024);
  assert.ok(frames.length > 4);
  for (const f of frames) {
    assert.equal(f[0], '~');
    assert.ok(f.length <= CHUNK_SIZE + 32);
  }
  for (let i = 0; i < frames.length - 1; i++) assert.equal(dec.push(frames[i]), null);
  assert.deepEqual(dec.push(frames.at(-1)), big);
  assert.equal(dec.errors, 0);

  // Custom chunk size, interleaved with small messages after completion.
  const tiny = encodeFrames({ t: 'chat', text: 'x'.repeat(100) }, 8, 30);
  assert.ok(tiny.length >= 4);
  for (const f of tiny.slice(0, -1)) assert.equal(dec.push(f), null);
  assert.equal(dec.push(tiny.at(-1)).text.length, 100);
  assert.deepEqual(dec.push(JSON.stringify({ t: 'ping', ts: 1 })), { t: 'ping', ts: 1 });

  // Garbage is counted and ignored.
  assert.equal(dec.push('{not json'), null);
  assert.equal(dec.push('[1,2]'), null);
  assert.equal(dec.push('~bad|x'), null);
  assert.equal(dec.errors, 3);
});
