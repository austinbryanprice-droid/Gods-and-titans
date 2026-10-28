// Landscapes (DESIGN 6.7): Highlands, Rivers, Islands and Great Forest keep every guarantee of the
// classic generator (valid, fair, symmetric), look like what their names promise, and travel from the
// lobby through the GameSetup to every browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, mapHash, validateMap, mapOptions } from '../../src/sim/mapgen.js';
import { LANDSCAPES, LANDSCAPE_IDS, LANDSCAPE_CHOICES, resolveLandscape, landscapeInfo } from '../../src/data/landscapes.js';
import { buildSetup, sanitizeLobbyState, LobbyHost } from '../../src/net/lobby.js';
import { validateSetup } from '../../src/net/sanitize.js';
import { TERRAIN, TREE_WOOD } from '../../src/config.js';

const { FOREST, ROCK, WATER, SAND } = TERRAIN;
const NEW = LANDSCAPE_IDS.filter((l) => l !== 'classic');
const CASES = [
  ['small', 2, null], ['small', 4, null], ['small', 3, null], ['medium', 2, null], ['medium', 4, null],
  ['small', 4, [1, 1, 2, 2]], ['medium', 4, [1, 1, 2, 2]],
];
const SEEDS = [1, 42, 'mythic'];

const cache = new Map();
function map(landscape, seed, size, pc, teams) {
  const key = `${landscape}|${seed}|${size}|${pc}|${teams}`;
  if (!cache.has(key)) cache.set(key, generateMap({ seed, mapSize: size, playerCount: pc, teams, landscape }));
  return cache.get(key);
}
function* all(landscapes = NEW) {
  for (const l of landscapes) for (const [size, pc, teams] of CASES) for (const seed of SEEDS) yield { l, size, pc, teams, seed, m: map(l, seed, size, pc, teams), where: `${l} ${size} p${pc}${teams ? ' teams' : ''} seed ${seed}` };
}
const share = (m, ...codes) => m.terrain.reduce((a, t) => a + (codes.includes(t) ? 1 : 0), 0) / m.terrain.length;
const mean = (l, f) => {
  const v = [...all([l])].map(({ m }) => f(m));
  return v.reduce((a, b) => a + b, 0) / v.length;
};

test('landscape data: five landscapes plus Random, every lobby choice has a name and a blurb', () => {
  assert.deepEqual(LANDSCAPE_IDS, ['classic', 'highlands', 'rivers', 'islands', 'forest']);
  assert.deepEqual(LANDSCAPE_CHOICES, [...LANDSCAPE_IDS, 'random']);
  for (const id of LANDSCAPE_CHOICES) {
    const info = landscapeInfo(id);
    assert.equal(info.id, id);
    assert.ok(info.name && info.blurb && info.icon, id);
  }
  assert.equal(landscapeInfo('bogus').id, 'classic');
  assert.equal(LANDSCAPES.length, 5);
});

test('every landscape builds valid maps for every size, player count and team layout', () => {
  for (const { m, where, pc, l } of all()) {
    assert.deepEqual(validateMap(m), [], where);
    assert.equal(m.starts.length, pc, where);
    assert.equal(m.meta.landscape, l, where);
  }
});

test('landscapes stay fair: symmetric terrain, the same wood and the same nearest expansion at every start', () => {
  for (const { m, where, pc, teams } of all()) {
    const n = m.width;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const t = m.terrain[y * n + x];
        assert.equal(m.terrain[(n - 1 - y) * n + (n - 1 - x)], t, where);
        if (pc >= 3 && !teams) assert.equal(m.terrain[x * n + (n - 1 - y)], t, where);
      }
    }
    const wood = m.starts.map((s) => {
      let w = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (Math.hypot(x + 0.5 - s.x - 2, y + 0.5 - s.y - 2) <= 12) w += m.wood[y * n + x];
      return w;
    });
    assert.ok(wood[0] >= 30 * TREE_WOOD, `${where}: wood ${wood[0]}`);
    // Corner maps rotate one base onto every other; a team map rotates each base onto its rival across the map.
    if (teams) {
      const sorted = [...wood].sort((x, y) => x - y);
      assert.equal(sorted[0], sorted[1], `${where}: wood ${wood}`);
      assert.equal(sorted[2], sorted[3], `${where}: wood ${wood}`);
      assert.equal(wood[0] + wood[1], wood[2] + wood[3], `${where}: team wood ${wood}`);
    } else for (const w of wood) assert.equal(w, wood[0], `${where}: equal wood`);
    const exp = m.starts.map((s) => {
      let best = Infinity;
      for (let i = m.starts.length; i < m.mines.length; i++) best = Math.min(best, Math.hypot(m.mines[i].tx + 1.5 - s.x - 2, m.mines[i].ty + 1.5 - s.y - 2));
      return best;
    });
    const rival = (p) => (teams ? (p + 2) % 4 : 0); // the start each one is compared with
    exp.forEach((d, p) => assert.ok(Math.abs(d - exp[rival(p)]) < 1e-9, `${where}: nearest expansion ${exp}`));
  }
});

test('each landscape looks like its name next to the classic Wildlands', () => {
  const rock = (m) => share(m, ROCK);
  const water = (m) => share(m, WATER);
  const forest = (m) => share(m, FOREST);
  const ford = (m) => share(m, SAND);
  assert.ok(mean('highlands', rock) > 3 * mean('classic', rock) && mean('highlands', rock) > 0.04, 'Highlands: rock ridges');
  assert.ok(mean('rivers', water) > 0.035 && mean('rivers', water) > 3 * mean('classic', water), 'Rivers: water');
  assert.ok(mean('rivers', ford) > mean('classic', ford), 'Rivers: sandy banks and fords');
  assert.ok(mean('islands', water) > 0.18, `Islands: sea ${mean('islands', water)}`);
  assert.ok(mean('forest', forest) > mean('classic', forest) + 0.06, 'Great Forest: deep woods');
  assert.ok(mean('highlands', forest) < mean('classic', forest), 'Highlands: open moors');
});

test('classic is the default: no landscape, "classic" and an unknown id give the same map; others differ', () => {
  const base = mapHash(generateMap({ seed: 9, mapSize: 'small', playerCount: 2 }));
  assert.equal(mapHash(generateMap({ seed: 9, mapSize: 'small', playerCount: 2, landscape: 'classic' })), base);
  assert.equal(mapHash(generateMap({ seed: 9, mapSize: 'small', playerCount: 2, landscape: 'volcano' })), base);
  const hashes = new Set(LANDSCAPE_IDS.map((landscape) => mapHash(generateMap({ seed: 9, mapSize: 'small', playerCount: 2, landscape }))));
  assert.equal(hashes.size, LANDSCAPE_IDS.length);
  // Deterministic like the classic map.
  for (const landscape of NEW) {
    const a = generateMap({ seed: 'x', mapSize: 'medium', playerCount: 3, landscape });
    const b = generateMap({ seed: 'x', mapSize: 'medium', playerCount: 3, landscape });
    assert.equal(mapHash(a), mapHash(b), landscape);
    assert.deepEqual(a.sacred, b.sacred, landscape);
  }
});

test('Random is drawn from the seed: the same in every browser, and every landscape comes up', () => {
  assert.equal(resolveLandscape('rivers', 5), 'rivers');
  assert.equal(resolveLandscape(undefined, 5), 'classic');
  assert.equal(resolveLandscape('nope', 5), 'classic');
  const seen = new Set();
  for (let s = 1; s < 80; s++) {
    const r = resolveLandscape('random', s);
    assert.equal(resolveLandscape('random', s), r);
    seen.add(r);
  }
  assert.deepEqual([...seen].sort(), [...LANDSCAPE_IDS].sort());
});

const STATE = {
  mapSize: 'small',
  slots: [
    { kind: 'host', name: 'A', pantheon: 'greek', team: 1, color: 0, difficulty: 'normal' },
    { kind: 'ai', name: '', pantheon: 'norse', team: 2, color: 1, difficulty: 'normal' },
    { kind: 'closed', name: '', pantheon: 'random', team: 3, color: 2, difficulty: 'normal' },
    { kind: 'closed', name: '', pantheon: 'random', team: 4, color: 3, difficulty: 'normal' },
  ],
};

test('the lobby carries the landscape into the GameSetup, the map hash and a client\'s check', () => {
  assert.equal('landscape' in buildSetup(STATE, 7).setup, false, 'the Wildlands keep the setup as it was');
  assert.equal('landscape' in buildSetup({ ...STATE, landscape: 'classic' }, 7).setup, false);
  const { setup } = buildSetup({ ...STATE, landscape: 'islands' }, 7);
  assert.equal(setup.landscape, 'islands');
  assert.deepEqual(mapOptions(setup).landscape, 'islands');
  assert.equal(setup.mapHash, mapHash(generateMap({ ...mapOptions(setup) })));
  assert.equal(setup.mapHash, mapHash(generateMap({ seed: 7, mapSize: 'small', playerCount: 2, teams: [1, 2], landscape: 'islands' })));
  // Random resolves to a concrete landscape before the setup leaves the host.
  for (let seed = 1; seed < 12; seed++) {
    const s = buildSetup({ ...STATE, landscape: 'random' }, seed).setup;
    assert.equal(s.landscape || 'classic', resolveLandscape('random', seed));
  }
  // A client keeps a real landscape and drops anything else.
  const json = (o) => JSON.parse(JSON.stringify(o));
  assert.equal(validateSetup(json(setup), 1).setup.landscape, 'islands');
  assert.equal('landscape' in validateSetup({ ...json(setup), landscape: 'lava' }, 1).setup, false);
  assert.equal('landscape' in validateSetup({ ...json(setup), landscape: 'random' }, 1).setup, false);
  // The lobby state a client gets is cleaned the same way.
  assert.equal(sanitizeLobbyState({ ...STATE, landscape: 'forest' }).landscape, 'forest');
  assert.equal(sanitizeLobbyState({ ...STATE, landscape: 'random' }).landscape, 'random');
  assert.equal(sanitizeLobbyState({ ...STATE, landscape: 'moon' }).landscape, 'classic');
});

test('LobbyHost.setLandscape: the host picks a landscape or Random; bad ids are refused', async () => {
  const host = await LobbyHost.create({ transport: 'none', name: 'Host' });
  assert.equal(host.state.landscape, 'classic');
  assert.equal(host.setLandscape('highlands'), true);
  assert.equal(host.state.landscape, 'highlands');
  assert.equal(host.setLandscape('highlands'), false, 'no change');
  assert.equal(host.setLandscape('swamp'), false);
  assert.equal(host.setLandscape('random'), true);
  host.applyPreset('2v2');
  assert.equal(host.state.landscape, 'random', 'presets keep the landscape');
  host.close?.();
});

test('a landscape map generates fast enough for the lobby (medium, 4 players)', () => {
  for (const landscape of NEW) {
    generateMap({ seed: 5, mapSize: 'small', playerCount: 2, landscape });
    let best = Infinity;
    for (let i = 0; i < 2; i++) {
      const t0 = performance.now();
      generateMap({ seed: 2000 + i, mapSize: 'medium', playerCount: 4, landscape });
      best = Math.min(best, performance.now() - t0);
    }
    assert.ok(best < 400, `${landscape}: medium map took ${best.toFixed(1)} ms`);
  }
});
