// AI chat voices (DESIGN 10.1): the lines for every pantheon, the moments that set them off,
// the rate limits, a whole AI game's worth of chat, and the trip from the host to a client's
// screen (the `voice` flag and the AI chatter setting).
import test from 'node:test';
import assert from 'node:assert/strict';
import { VOICE_LINES, VOICE_TRIGGERS, fillLine } from '../../src/ai/voice-lines.js';
import { AIVoices, VOICE } from '../../src/ai/voice.js';
import { createAI, createVoices } from '../../src/ai/ai.js';
import { PANTHEON_LIST, godsFor, titanFor } from '../../src/data/index.js';
import { createWorld } from '../../src/sim/world.js';
import { TICK_RATE } from '../../src/config.js';
import { HostSession, ClientSession } from '../../src/net/session.js';
import { createLoopbackPair } from '../../src/net/transport.js';
import { fakeWorldFactory, makeFakeMap } from '../../src/net/fake-world.js';
import { MAX_CHAT_LENGTH } from '../../src/net/protocol.js';
import { showChatLine } from '../../src/game/game.js';
import { saveSettings, getSettings, _resetSettingsForTests } from '../../src/settings.js';

test('every pantheon has two or more lines for every moment, short, with known blanks only', () => {
  assert.deepEqual(Object.keys(VOICE_LINES).sort(), PANTHEON_LIST.map((p) => p.id).sort());
  const longest = Math.max(...PANTHEON_LIST.flatMap((p) => [...godsFor(p.id), titanFor(p.id)].map((u) => u.name.length)));
  for (const [id, lines] of Object.entries(VOICE_LINES)) {
    assert.deepEqual(Object.keys(lines).sort(), [...VOICE_TRIGGERS].sort(), id);
    for (const [trigger, list] of Object.entries(lines)) {
      assert.ok(list.length >= 2, `${id} ${trigger}`);
      assert.equal(new Set(list).size, list.length, `${id} ${trigger} repeats a line`);
      for (const line of list) {
        for (const [, key] of line.matchAll(/\{(\w+)\}/g)) assert.ok(key === 'unit' || key === 'enemy', `${id}: ${line}`);
        const filled = fillLine(line, { unit: 'x'.repeat(longest), enemy: 'y'.repeat(20) });
        assert.ok(filled && filled.length <= 90 && filled.length <= MAX_CHAT_LENGTH, `${id}: ${line}`);
        // Only the moments about a god or a Titan name one; only those about another player name them.
        if (line.includes('{unit}')) assert.ok(['god', 'titan', 'godLost'].includes(trigger), `${id} ${trigger}: ${line}`);
        if (line.includes('{enemy}')) assert.ok(['contact', 'struck'].includes(trigger), `${id} ${trigger}: ${line}`);
      }
      // A moment about a god must always be able to name it.
      if (['god', 'titan', 'godLost'].includes(trigger)) assert.ok(list.every((l) => l.includes('{unit}')), `${id} ${trigger}`);
    }
  }
});

test('fillLine fills the blanks and refuses a line it cannot fill', () => {
  assert.equal(fillLine('{unit} has come!', { unit: 'Thor' }), 'Thor has come!');
  assert.equal(fillLine('Ha, {enemy}!', {}), null);
  assert.equal(fillLine('No blanks.', {}), 'No blanks.');
});

/** A World stand-in with just what the voices read. */
function fakeWorld(pantheons, { teams } = {}) {
  const world = {
    time: 0,
    setup: { seed: 5 },
    players: pantheons.map((p, i) => ({ index: i, name: `P${i}`, pantheon: p, team: teams ? teams[i] : i + 1, defeated: false })),
    unitList: [],
    buildingList: [],
    hash: {
      query(x, y, r, out) {
        for (const u of world.unitList) if (Math.hypot(u.x - x, u.y - y) <= r) out.push(u);
        return out;
      },
    },
    areEnemies(a, b) {
      if (a === b) return false;
      if (a < 0 || b < 0) return true;
      return world.players[a].team !== world.players[b].team;
    },
  };
  return world;
}

const building = (owner, type = 'house', tx = 0, ty = 0) => ({ owner, type, tx, ty, size: 2, dead: false, def: { wall: false } });
const unit = (owner, x, y) => ({ owner, x, y, dead: false });

/** Step the voices `seconds` of game time in snapshot-sized steps (no events). */
function run(v, world, seconds, events = []) {
  const out = [];
  const end = world.time + seconds;
  out.push(...v.step(events));
  while (world.time < end) {
    world.time += 0.5;
    out.push(...v.step([]));
  }
  return out;
}

test('a greeting, then first contact with the name of the player met', () => {
  const world = fakeWorld(['norse', 'greek']);
  world.buildingList.push(building(0, 'town_center', 10, 10));
  const v = new AIVoices(world, [0]);
  VOICE.greetChance = 1;
  try {
    const hello = run(v, world, VOICE.greetAt + 1);
    assert.equal(hello.length, 1);
    assert.ok(VOICE_LINES.norse.greet.includes(hello[0].text));
    assert.equal(hello[0].from, 0);
    // An enemy scout walks up to the Town Center; a creep (owner -1) does not count.
    world.unitList.push(unit(-1, 12, 12));
    assert.deepEqual(run(v, world, VOICE.playerGap + 5), []);
    world.unitList.push(unit(1, 14, 14));
    const met = run(v, world, VOICE.contactEvery * 2);
    assert.equal(met.length, 1);
    assert.ok(met[0].text.includes('P1'), met[0].text);
    assert.deepEqual(run(v, world, 120), [], 'first contact is said once');
  } finally {
    VOICE.greetChance = 0.7;
  }
});

test('struck by a player, not by wild creatures; the line names the attacker', () => {
  const world = fakeWorld(['egyptian', 'aztec', 'hindu']);
  const v = new AIVoices(world, [0]);
  world.time = 100;
  world.unitList.push(unit(-1, 20, 20));
  assert.deepEqual(v.step([{ type: 'underAttack', player: 0, x: 20, y: 21, id: 1 }]), []);
  world.unitList.push(unit(2, 22, 22));
  const out = v.step([{ type: 'underAttack', player: 0, x: 20, y: 21, id: 1 }]);
  assert.equal(out.length, 1);
  assert.ok(out[0].text.includes('P2'), out[0].text);
  world.time += 400;
  assert.deepEqual(v.step([{ type: 'underAttack', player: 0, x: 20, y: 21, id: 1 }]), [], 'only the first blow');
});

test('gods: announced on their first arrival only, mourned when they fall, the Titan always heard', () => {
  const world = fakeWorld(['greek', 'norse']);
  const v = new AIVoices(world, [0, 1]);
  world.time = 300;
  const zeus = v.step([{ type: 'spawn', id: 1, t: 'greek_zeus', o: 0 }]);
  assert.equal(zeus.length, 1);
  assert.match(zeus[0].text, /Zeus/);
  assert.deepEqual(v.step([{ type: 'spawn', id: 2, t: 'greek_hoplite', o: 0 }]), [], 'a soldier is no news');
  world.time += 400;
  assert.match(v.step([{ type: 'death', id: 1, t: 'greek_zeus', o: 0, k: 'u' }])[0].text, /Zeus/);
  world.time += 400;
  assert.deepEqual(v.step([{ type: 'spawn', id: 3, t: 'greek_zeus', o: 0 }]), [], 'a revived god comes back quietly');
  // A Titan goes out even right after another AI's line.
  world.time += 400;
  assert.equal(v.step([{ type: 'spawn', id: 4, t: 'norse_thor', o: 1 }]).length, 1);
  world.time += VOICE.urgentGap;
  const titan = v.step([{ type: 'titanSummoning', player: 1, t: 'norse_surtr' }]);
  assert.equal(titan.length, 1);
  assert.match(titan[0].text, /Surtr/);
});

test('rate limits: one AI waits playerGap, any two lines wait globalGap, a burst is dropped not queued', () => {
  const world = fakeWorld(['greek', 'norse', 'celtic']);
  const v = new AIVoices(world, [0, 1, 2]);
  world.time = 500;
  const burst = v.step([
    { type: 'spawn', id: 1, t: 'greek_zeus', o: 0 },
    { type: 'spawn', id: 2, t: 'greek_athena', o: 0 },
    { type: 'spawn', id: 3, t: 'norse_odin', o: 1 },
  ]);
  assert.equal(burst.length, 1, 'the first line only');
  world.time += VOICE.globalGap;
  assert.equal(v.step([{ type: 'spawn', id: 4, t: 'greek_poseidon', o: 0 }]).length, 0, 'Greek spoke too recently');
  assert.equal(v.step([{ type: 'spawn', id: 5, t: 'norse_thor', o: 1 }]).length, 1, 'Norse may speak');
  world.time += 1;
  assert.equal(v.step([{ type: 'spawn', id: 6, t: 'celtic_lugh', o: 2 }]).length, 0, 'any line waits globalGap');
  assert.deepEqual(run(v, world, 200), [], 'nothing was queued');
});

test('the Decade of Peace ending, nearly beaten, defeat and the winner\'s last word', () => {
  const world = fakeWorld(['japanese', 'chinese', 'mesopotamian'], { teams: [1, 2, 2] });
  const v = new AIVoices(world, [0, 1, 2]);
  world.time = 600;
  const peace = v.step([{ type: 'peaceEnd' }]);
  assert.equal(peace.length, 1);
  assert.ok(VOICE_LINES[world.players[peace[0].from].pantheon].peaceEnd.includes(peace[0].text));
  // Japan had eight buildings and is down to two.
  for (let i = 0; i < 8; i++) world.buildingList.push(building(0, i ? 'house' : 'town_center', i * 3, 0));
  world.time += 3;
  v.step([]);
  for (const b of world.buildingList.slice(0, 6)) b.dead = true;
  world.time += 3;
  const beaten = v.step([{ type: 'death', id: 9, t: 'house', o: 0, k: 'b' }]);
  assert.equal(beaten.length, 1);
  assert.ok(VOICE_LINES.japanese.beaten.includes(beaten[0].text));
  world.time += 10;
  assert.deepEqual(v.step([{ type: 'death', id: 10, t: 'house', o: 0, k: 'b' }]), [], 'said once');
  // Defeat and the winner's line go out together, whatever was said just before.
  world.players[0].defeated = true;
  const end = v.step([{ type: 'playerDefeated', player: 0 }, { type: 'gameOver', winningTeam: 2 }]);
  assert.equal(end.length, 2);
  assert.ok(VOICE_LINES.japanese.defeat.includes(end[0].text));
  assert.equal(end[1].from, 1, 'one voice for the winning team');
  assert.ok(VOICE_LINES.chinese.victory.includes(end[1].text));
  world.time += 100;
  assert.deepEqual(v.step([{ type: 'spawn', id: 11, t: 'chinese_sun_wukong', o: 1 }]), [], 'silent after the game');
});

test('a whole AI game: a handful of lines at the right moments, well spaced, cheap', () => {
  const world = createWorld({
    version: '0.1.0', seed: 1, mapSize: 'small',
    players: ['greek', 'norse'].map((p, i) => ({ index: i, name: `AI ${i + 1}`, team: i + 1, pantheon: p, kind: 'ai', difficulty: 'normal' })),
  });
  // No relics (DESIGN 5.15) in this game: a relic's bonus can end it before either side reaches its Titan,
  // and this test is about the lines, so it keeps the game it was written for.
  world.relics.length = 0;
  const ais = [0, 1].map((i) => createAI(world, i, 'normal'));
  const voices = createVoices(world, [0, 1]);
  const lines = [];
  let ms = 0;
  for (let t = 0; t < 40 * 60 * TICK_RATE && !world.gameOver; t++) {
    for (const a of ais) a.tick();
    world.tick();
    if (t % 2 === 1 || world.gameOver) {
      const events = world.getSnapshot().events;
      const t0 = performance.now();
      for (const l of voices.step(events)) lines.push({ ...l, at: world.time });
      ms += performance.now() - t0;
    }
  }
  assert.ok(world.gameOver, 'the game ended');
  const minutes = world.time / 60;
  assert.ok(lines.length >= 6 && lines.length <= minutes * 1.5, `${lines.length} lines in ${minutes.toFixed(1)} min`);
  const esc = (t) => t.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const said = (trigger) => lines.some((l) => VOICE_LINES[world.players[l.from].pantheon][trigger]
    .some((line) => new RegExp(`^${esc(line).replace(/\{\w+\}/g, '.+')}$`).test(l.text)));
  for (const trigger of ['greet', 'god', 'titan', 'defeat', 'victory']) assert.ok(said(trigger), `no ${trigger} line:\n${lines.map((l) => l.text).join('\n')}`);
  for (const i of [0, 1]) assert.ok(lines.filter((l) => l.from === i).length <= VOICE.maxLines);
  assert.ok(ms / (world.time / 60) < 50, `voices took ${ms.toFixed(1)} ms over ${minutes.toFixed(1)} min`);
});

// ---------------------------------------------------------------- over the wire

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, what, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(1);
  }
}

test('the host sends AI lines flagged `voice`, the client keeps the flag, the setting hides them', async () => {
  const setup = {
    version: '0.1.0', seed: 9, mapSize: 'small',
    players: [
      { index: 0, name: 'Host', team: 1, pantheon: 'greek', color: '#d63a3a', kind: 'human', difficulty: null },
      { index: 1, name: 'Ann', team: 2, pantheon: 'greek', color: '#3a6ed6', kind: 'human', difficulty: null },
      { index: 2, name: 'AI (Easy)', team: 2, pantheon: 'norse', color: '#3ad66e', kind: 'ai', difficulty: 'easy' },
    ],
  };
  const [hostSide, clientSide] = createLoopbackPair();
  const client = new ClientSession({ setup, myIndex: 1, conn: clientSide, generateMap: () => makeFakeMap(48, 48), pingIntervalMs: 20 });
  let voiced = null;
  const host = new HostSession({
    setup, myIndex: 0, conns: new Map([[1, hostSide]]), createWorld: fakeWorldFactory({ units: 10 }), autoTick: false,
    createAI: () => ({ tick() {} }),
    createVoices: (world, players) => {
      voiced = players;
      let n = 0;
      // Says one line on its second call; also tries to speak for a human, which the host refuses.
      return { step: () => (++n === 2 ? [{ from: 2, text: 'Skål!' }, { from: 1, text: 'I am not an AI' }] : []) };
    },
  });
  assert.deepEqual(voiced, [2], 'only the AI slots speak');
  const got = [];
  client.onChat((l) => got.push(l));
  const mine = [];
  host.onChat((l) => mine.push(l));
  client.start();
  for (let i = 0; i < 12; i++) host.step(1);
  await waitFor(() => got.some((l) => l.text === 'Skål!'), 'the AI line');
  host.sendChat('hello');
  await waitFor(() => got.some((l) => l.text === 'hello'), 'the host line');
  const ai = got.find((l) => l.text === 'Skål!');
  assert.deepEqual(ai, { from: 2, name: 'AI (Easy)', text: 'Skål!', system: false, voice: true });
  assert.equal(got.find((l) => l.text === 'hello').voice, undefined);
  assert.ok(!got.some((l) => l.text === 'I am not an AI'));
  assert.ok(mine.some((l) => l.voice && l.text === 'Skål!'));
  host.stop();
  client.stop();

  _resetSettingsForTests({ clearStorage: true });
  assert.equal(getSettings().aiChat, true, 'on by default');
  assert.equal(showChatLine(ai), true);
  saveSettings({ aiChat: false });
  assert.equal(showChatLine(ai), false);
  assert.equal(showChatLine({ from: 0, name: 'Host', text: 'hello', system: false }), true, 'players are always heard');
  saveSettings({ aiChat: 'nope' });
  assert.equal(getSettings().aiChat, false, 'a bad value is ignored');
  _resetSettingsForTests({ clearStorage: true });
});

test('a loaded game: no second greeting or first contact, and gods already out are not announced again', () => {
  const world = fakeWorld(['norse', 'greek']);
  world.buildingList.push(building(0, 'town_center', 10, 10));
  VOICE.greetChance = 1;
  try {
    const god = godsFor('norse')[0];
    world.time = VOICE.greetAt + 200;
    world.unitList.push({ ...unit(0, 10, 10), type: god.id }, unit(1, 14, 14));
    const v = new AIVoices(world, [0]);
    v.resume();
    assert.deepEqual(run(v, world, VOICE.contactEvery * 3), []);
    assert.deepEqual(v.step([{ type: 'spawn', o: 0, t: god.id }]), [], 'a revived god comes back quietly');
  } finally {
    VOICE.greetChance = 0.7;
  }
});
