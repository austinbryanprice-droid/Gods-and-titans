// Team pings and markers on the wire (DESIGN 7, 9): the `mark` message is rebuilt from a whitelist,
// rate limited, and relayed by the host to the sender's teammates only. Loopback sessions with the
// fake world; the sender is always the connection's own player index.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession, ClientSession, CLIENT_LIMITS } from '../../src/net/session.js';
import { createLoopbackPair } from '../../src/net/transport.js';
import { fakeWorldFactory, makeFakeMap } from '../../src/net/fake-world.js';
import { MSG } from '../../src/net/protocol.js';
import { sanitizeMark } from '../../src/net/sanitize.js';
import { wireFingerprint } from '../../src/net/wire-version.js';
import { MARKS, MARK_KINDS, MARK_RATE, MARK_SEND_RATE } from '../../src/data/marks.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 3000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(1);
  }
}
const fakeMap = () => makeFakeMap(48, 48);

/** Host (player 0) plus clients 1..n over loopback; `teams` gives each player's team. */
function makeGame(teams) {
  const names = ['Host', 'Ann', 'Ben', 'Cy'];
  const players = teams.map((team, index) => ({ index, name: names[index], team, pantheon: 'greek', color: '#d63a3a', kind: 'human', difficulty: null }));
  const setup = { version: '0.1.0', seed: 99, mapSize: 'small', players };
  const conns = new Map();
  const clients = [];
  for (let i = 1; i < teams.length; i++) {
    const [hostSide, clientSide] = createLoopbackPair();
    conns.set(i, hostSide);
    clients.push(new ClientSession({ setup, myIndex: i, conn: clientSide, generateMap: fakeMap, pingIntervalMs: 20 }));
  }
  const host = new HostSession({ setup, myIndex: 0, conns, createWorld: fakeWorldFactory({ units: 20, buildings: 2, churn: 0 }), createAI: () => ({ tick() {} }), autoTick: false });
  return { setup, host, clients, conns };
}

async function startAll({ host, clients }) {
  host.start();
  for (const c of clients) c.start();
  await Promise.all(clients.map((c) => c.ready));
}

function collect(session) {
  const got = [];
  session.onMark((m) => got.push(m));
  return got;
}

const stopAll = ({ host, clients }) => {
  for (const c of clients) c.stop();
  host.stop();
};

// ---------------------------------------------------------------- the table and the sanitizer

test('every mark kind has words, an icon, a colour and a lifetime; the ids match the table', () => {
  assert.deepEqual(MARK_KINDS, Object.keys(MARKS));
  assert.ok(MARK_KINDS.includes('ping'));
  for (const [id, def] of Object.entries(MARKS)) {
    assert.equal(def.id, id);
    assert.ok(def.name && def.text && def.icon, id);
    assert.match(def.color, /^#[0-9a-f]{6}$/i);
    assert.ok(def.life > 0 && def.life <= 30, `${id} fades within half a minute`);
  }
  assert.ok(MARK_SEND_RATE[0] < MARK_RATE[0] && MARK_SEND_RATE[1] < MARK_RATE[1], 'a player sends a little slower than the host accepts');
});

test('sanitizeMark: a known kind and a spot clamped to the map, rounded; anything else is nothing', () => {
  const b = { width: 48, height: 40 };
  assert.deepEqual(sanitizeMark({ kind: 'attack', x: 10.123456, y: 20.5 }, b), { kind: 'attack', x: 10.12, y: 20.5 });
  assert.deepEqual(sanitizeMark({ kind: 'ping', x: -5, y: 999 }, b), { kind: 'ping', x: 0, y: 40 });
  const clean = sanitizeMark({ kind: 'help', x: 1, y: 2, from: 3, player: 2, name: 'x', extra: { a: 1 } }, b);
  assert.deepEqual(Object.keys(clean).sort(), ['kind', 'x', 'y'], 'only the whitelisted fields survive');
  for (const bad of [
    null, undefined, 5, 'ping', [], { x: 1, y: 1 }, { kind: 'nuke', x: 1, y: 1 }, { kind: '__proto__', x: 1, y: 1 }, { kind: 'toString', x: 1, y: 1 },
    { kind: 'constructor', x: 1, y: 1 }, { kind: ['ping'], x: 1, y: 1 }, { kind: 'ping', x: NaN, y: 1 }, { kind: 'ping', x: 1, y: Infinity },
    { kind: 'ping', x: '3', y: 1 }, { kind: 'ping', x: 1 }, { kind: 'ping', y: 1 },
  ]) assert.equal(sanitizeMark(bad, b), null, JSON.stringify(bad));
  assert.ok(sanitizeMark({ kind: 'ping', x: 1, y: 1 }, null), 'without bounds the largest map is assumed');
});

test('the mark kinds are part of the protocol fingerprint, so a build with other kinds is refused at join', () => {
  const base = wireFingerprint();
  MARK_KINDS.push('extra');
  const changed = wireFingerprint();
  MARK_KINDS.pop();
  assert.notEqual(changed, base);
  assert.equal(wireFingerprint(), base);
  assert.equal(MSG.MARK, 'mark');
});

// ---------------------------------------------------------------- relay

test('a client mark reaches the teammate on the same team and nobody on another team', async () => {
  // Host alone on team 1; Ann, Ben and Cy on team 2 … except Cy, who plays for team 3.
  const g = makeGame([1, 2, 2, 3]);
  await startAll(g);
  const [ann, ben, cy] = g.clients;
  const seen = { host: collect(g.host), ann: collect(ann), ben: collect(ben), cy: collect(cy) };
  const reachedCy = [];
  g.conns.get(3).send = ((send) => (msg) => { reachedCy.push(msg.t); return send.call(g.conns.get(3), msg); })(g.conns.get(3).send);
  ann.sendMark({ kind: 'attack', x: 12.5, y: 20 });
  await waitFor(() => seen.ben.length === 1, 3000, 'the teammate to see the mark');
  await sleep(30);
  assert.deepEqual(seen.ben[0], { from: 1, name: 'Ann', kind: 'attack', x: 12.5, y: 20 });
  assert.deepEqual(seen.ann, [{ from: 1, name: 'Ann', kind: 'attack', x: 12.5, y: 20 }], 'the sender sees its own, once');
  assert.deepEqual(seen.host, [], 'the host is on another team and does not see it');
  assert.deepEqual(seen.cy, [], 'neither does a third team');
  assert.ok(!reachedCy.includes(MSG.MARK), 'the message was never even sent to the other team’s connection');
  stopAll(g);
});

test('the host’s own mark goes to its teammates only, and a teammate’s mark shows on the host', async () => {
  const g = makeGame([1, 1, 2]);
  await startAll(g);
  const [ann, ben] = g.clients;
  const seen = { host: collect(g.host), ann: collect(ann), ben: collect(ben) };
  const sent = g.host.sendMark({ kind: 'defend', x: 5, y: 6 });
  assert.deepEqual(sent, { kind: 'defend', x: 5, y: 6 });
  assert.deepEqual(seen.host, [{ from: 0, name: 'Host', kind: 'defend', x: 5, y: 6 }], 'the host sees its own at once');
  await waitFor(() => seen.ann.length === 1);
  await sleep(30);
  assert.equal(seen.ann[0].from, 0);
  assert.equal(seen.ann[0].name, 'Host');
  assert.deepEqual(seen.ben, [], 'the other team heard nothing');
  ann.sendMark({ kind: 'help', x: 30, y: 31 });
  await waitFor(() => seen.host.length === 2);
  assert.deepEqual(seen.host[1], { from: 1, name: 'Ann', kind: 'help', x: 30, y: 31 });
  await sleep(30);
  assert.deepEqual(seen.ben, []);
  assert.equal(seen.ann.length, 2, 'Ann has her own mark and the host’s');
  stopAll(g);
});

test('a player on a team of one hears only the echo of their own mark', async () => {
  const g = makeGame([1, 2, 3]);
  await startAll(g);
  const [ann, ben] = g.clients;
  const seen = { host: collect(g.host), ann: collect(ann), ben: collect(ben) };
  ann.sendMark({ kind: 'ping', x: 2, y: 3 });
  g.host.sendMark({ kind: 'ping', x: 4, y: 5 });
  await sleep(60);
  assert.equal(seen.ann.length, 1);
  assert.equal(seen.host.length, 1);
  assert.deepEqual(seen.ben, []);
  stopAll(g);
});

test('the sender is the connection’s player: a forged "from" is ignored, and the mark cannot be spoofed as a teammate’s', async () => {
  const g = makeGame([1, 1, 2]);
  await startAll(g);
  const [ann, ben] = g.clients;
  const seen = { host: collect(g.host), ann: collect(ann), ben: collect(ben) };
  // Ben (team 2) forges a mark "from" the host (team 1) to put it on Ann's screen.
  ben.conn.send({ t: MSG.MARK, from: 0, player: 0, kind: 'attack', x: 7, y: 7 });
  await sleep(60);
  assert.deepEqual(seen.host, [], 'the host never saw a mark from the other team');
  assert.deepEqual(seen.ann, []);
  // Ann forges the sender and the team: it still comes from her.
  ann.conn.send({ t: MSG.MARK, from: 2, team: 2, kind: 'help', x: 8, y: 9 });
  await waitFor(() => seen.host.length === 1);
  assert.equal(seen.host[0].from, 1);
  assert.equal(seen.host[0].name, 'Ann');
  assert.deepEqual(seen.ben, []);
  stopAll(g);
});

test('a client drops a "mark" from a host that names a player of another team, itself, or a stranger', async () => {
  const g = makeGame([1, 1, 2]);
  await startAll(g);
  const [ann] = g.clients;
  const seen = collect(ann);
  const hostSide = g.conns.get(1);
  hostSide.send({ t: MSG.MARK, from: 2, kind: 'attack', x: 5, y: 5 }); // Ben is on the other team
  hostSide.send({ t: MSG.MARK, from: 1, kind: 'attack', x: 5, y: 5 }); // Ann herself
  hostSide.send({ t: MSG.MARK, from: 9, kind: 'attack', x: 5, y: 5 }); // nobody
  hostSide.send({ t: MSG.MARK, from: '0', kind: 'attack', x: 5, y: 5 }); // not an index
  hostSide.send({ t: MSG.MARK, from: 0, kind: 'nuke', x: 5, y: 5 }); // not a kind
  hostSide.send({ t: MSG.MARK, from: 0, kind: 'attack', x: 'a', y: 5 }); // not a spot
  hostSide.send({ t: MSG.MARK, from: 0, kind: 'attack', x: 500, y: -5 }); // clamped, then shown
  await sleep(80);
  assert.deepEqual(seen, [{ from: 0, name: 'Host', kind: 'attack', x: 48, y: 0 }]);
  stopAll(g);
});

test('the host drops marks sent too fast, and malformed ones, and counts them', async () => {
  const g = makeGame([1, 1]);
  await startAll(g);
  const [ann] = g.clients;
  const seen = collect(g.host);
  const burst = MARK_RATE[1];
  for (let i = 0; i < burst + 6; i++) ann.conn.send({ t: MSG.MARK, kind: 'ping', x: i, y: 1 });
  ann.conn.send({ t: MSG.MARK, kind: 'nuke', x: 1, y: 1 });
  await waitFor(() => g.host.clients.get(1).dropped.mark >= 6, 3000, 'the host to drop the excess');
  assert.equal(seen.length, burst, 'only the burst got through');
  assert.equal(CLIENT_LIMITS.mark, MARK_RATE);
  await sleep(1100);
  ann.conn.send({ t: MSG.MARK, kind: 'nuke', x: 1, y: 1 });
  await waitFor(() => g.host.clients.get(1).dropped.invalid >= 1);
  assert.equal(seen.length, burst, 'a mark of an unknown kind shows nothing');
  stopAll(g);
});

test('after the session stopped, a mark is not sent and shows nothing', async () => {
  const g = makeGame([1, 1]);
  await startAll(g);
  const [ann] = g.clients;
  const seen = collect(g.host);
  assert.equal(g.host.sendMark({ kind: 'nuke', x: 1, y: 1 }), null, 'an unknown kind is not sent');
  assert.equal(ann.sendMark({ kind: 'ping', x: 'a', y: 1 }), null, 'neither is a spot that is not a number');
  stopAll(g);
  assert.equal(g.host.sendMark({ kind: 'ping', x: 1, y: 1 }), null, 'a stopped host sends nothing');
  assert.equal(ann.sendMark({ kind: 'ping', x: 1, y: 1 }), null, 'neither does a stopped client');
  assert.deepEqual(seen, []);
});

// ---------------------------------------------------------------- the sim hears Attack / Defend / Help (DESIGN 10)

test('an Attack, Defend or Help marker is also a sim command from its sender, on the host; a ping or Gather is not', async () => {
  const g = makeGame([1, 1, 2]);
  await startAll(g);
  const [ann, ben] = g.clients;
  g.host.sendMark({ kind: 'attack', x: 5, y: 6 });
  g.host.sendMark({ kind: 'ping', x: 7, y: 8 });
  ann.sendMark({ kind: 'help', x: 30, y: 31 });
  ann.sendMark({ kind: 'gather', x: 1, y: 2 });
  ben.sendMark({ kind: 'defend', x: 9, y: 9, from: 0 }); // its own order (a forged sender is ignored), for its own team
  const orders = () => g.host.world.commands.filter((c) => c.cmd.type === 'teamMark').map((c) => [c.player, c.cmd.kind, c.cmd.x, c.cmd.y]);
  await waitFor(() => {
    g.host.step(1);
    return orders().length >= 3;
  });
  await sleep(30);
  g.host.step(1);
  assert.deepEqual(orders().sort(), [[0, 'attack', 5, 6], [1, 'help', 30, 31], [2, 'defend', 9, 9]].sort());
  stopAll(g);
});

test('a computer ally\'s answer to a marker goes to its team only', async () => {
  const g = makeGame([1, 1, 2]);
  await startAll(g);
  const [ann, ben] = g.clients;
  g.host.ais.set(1, { tick() {} }); // (Ann's seat played by the computer for this test)
  g.host.voices = { step: () => [{ from: 1, text: 'Our spears go where you point.', team: true }] };
  const heard = { host: [], ann: [], ben: [] };
  g.host.onChat((l) => heard.host.push(l));
  ann.onChat((l) => heard.ann.push(l));
  ben.onChat((l) => heard.ben.push(l));
  g.host.speak([]);
  await waitFor(() => heard.ann.length === 1);
  await sleep(30);
  assert.equal(heard.host.length, 1);
  assert.equal(heard.host[0].team, true);
  assert.equal(heard.host[0].voice, true);
  assert.equal(heard.ann[0].team, true);
  assert.deepEqual(heard.ben, [], 'the enemy hears nothing');
  stopAll(g);
});

test('a computer ally\'s own callout: a marker and a line for its team only, never a team order', async () => {
  const g = makeGame([1, 1, 2, 1]);
  await startAll(g);
  const [ann, ben, cy] = g.clients;
  g.host.ais.set(3, { tick() {} }); // (Cy's seat played by the computer for this test)
  g.host.voices = { step: () => [{ from: 3, team: true, mark: { kind: 'attack', x: 20, y: 21 }, text: 'The spears go forth. Strike with us here!' }, { from: 3, team: true, mark: { kind: 'nope', x: 1, y: 1 } }, { from: 2, team: true, mark: { kind: 'help', x: 4, y: 4 } }] };
  const marks = { host: collect(g.host), ann: collect(ann), ben: collect(ben), cy: collect(cy) };
  const heard = { ann: [], ben: [] };
  ann.onChat((l) => heard.ann.push(l));
  ben.onChat((l) => heard.ben.push(l));
  g.host.speak([]);
  await waitFor(() => marks.ann.length === 1 && heard.ann.length === 1);
  await sleep(30);
  assert.deepEqual(marks.host, [{ from: 3, name: 'Cy', kind: 'attack', x: 20, y: 21 }]);
  assert.deepEqual(marks.ann, [{ from: 3, name: 'Cy', kind: 'attack', x: 20, y: 21 }], 'a bad kind and a human\'s seat are refused');
  assert.equal(heard.ann[0].team, true);
  assert.deepEqual(marks.ben, [], 'the enemy sees no marker');
  assert.deepEqual(heard.ben, [], 'and hears nothing');
  assert.deepEqual(marks.cy, [], 'the sender is not sent its own');
  g.host.step(1);
  assert.ok(!g.host.world.commands.some((c) => c.cmd.type === 'teamMark'), 'the World is untouched: other computer allies do not answer it');
  stopAll(g);
});
