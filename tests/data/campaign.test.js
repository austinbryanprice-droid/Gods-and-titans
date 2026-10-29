// The campaign's data (src/data/campaign.js): every mission names real pantheons, units and buildings, its
// objectives and events refer to each other correctly, and every line the narrator says has its clip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHAPTERS, CHAPTER_BY_ID, MISSIONS, MISSION_BY_ID, chapterOf, nextMission, clipName, campaignLines } from '../../src/data/campaign.js';
import { PANTHEONS, UNITS, BUILDINGS } from '../../src/data/index.js';
import { MAP_SIZES } from '../../src/config.js';

const KINDS = new Set(['build', 'gods', 'army', 'kill', 'destroy', 'protect', 'survive', 'hold', 'conquer']);

test('two chapters of five linked missions, each chapter for one pantheon', () => {
  assert.deepEqual(CHAPTERS.map((c) => [c.chapter, c.pantheon, c.missions.length]), [['Chapter I', 'greek', 5], ['Chapter II', 'norse', 5]]);
  assert.equal(MISSIONS.length, 10);
  assert.equal(new Set(MISSIONS.map((m) => m.id)).size, 10);
  assert.deepEqual(MISSIONS, CHAPTERS.flatMap((c) => c.missions), 'the missions in the order they open');
  for (const c of CHAPTERS) {
    assert.equal(CHAPTER_BY_ID[c.id], c);
    assert.ok(c.title && c.blurb && c.people, c.id);
    c.missions.forEach((m, i) => {
      assert.equal(m.n, i + 1);
      assert.equal(m.chapter, c.id);
      assert.equal(chapterOf(m), c);
      assert.equal(chapterOf(m.id), c);
      assert.equal(MISSION_BY_ID[m.id], m);
      assert.equal(m.players[0].pantheon, c.pantheon, `${m.id}: the hero plays the chapter's pantheon`);
    });
  }
  MISSIONS.forEach((m, i) => assert.equal(nextMission(m.id), MISSIONS[i + 1] || null));
  assert.equal(nextMission('twilight').id, 'hordaland', 'the end of Chapter I leads into Chapter II');
  assert.equal(chapterOf('nope'), null);
});

test('every mission names real pantheons, map sizes, units and buildings', () => {
  for (const m of MISSIONS) {
    assert.ok(Object.hasOwn(MAP_SIZES, m.mapSize), m.id);
    assert.ok(Number.isInteger(m.seed), m.id);
    assert.ok(m.players.length >= 2 && m.start.length === m.players.length, m.id);
    for (const p of m.players) assert.ok(Object.hasOwn(PANTHEONS, p.pantheon), `${m.id}: ${p.pantheon}`);
    for (const p of m.players.slice(1)) assert.ok(['tutorial', 'easy', 'normal', 'hard'].includes(p.difficulty), `${m.id}: ${p.difficulty}`);
    assert.ok(m.players.some((p) => p.team !== m.players[0].team), `${m.id} has an enemy`);
    for (const s of m.start) {
      for (const [type] of s.units || []) assert.ok(UNITS[type], `${m.id}: unit ${type}`);
      for (const b of s.buildings || []) assert.ok(BUILDINGS[b.type], `${m.id}: building ${b.type}`);
    }
    for (const e of m.events) for (const [type] of (e.spawn && e.spawn.units) || []) assert.ok(UNITS[type], `${m.id}: unit ${type}`);
  }
});

test('objectives and events refer to each other: tags, reveals, afters', () => {
  for (const m of MISSIONS) {
    const ids = new Set(m.objectives.map((o) => o.id));
    assert.equal(ids.size, m.objectives.length, `${m.id}: objective ids are unique`);
    const startTags = new Set(m.start.flatMap((s) => (s.buildings || []).map((b) => b.tag).filter(Boolean)).concat(['home']));
    const spawnTags = new Set(m.events.filter((e) => e.spawn).map((e) => e.spawn.tag));
    for (const o of m.objectives) {
      assert.ok(KINDS.has(o.kind), `${m.id}: ${o.kind}`);
      assert.ok(o.text && o.icon, `${m.id}/${o.id} has words and an icon`);
      if (o.kind === 'kill') assert.ok(spawnTags.has(o.tag), `${m.id}/${o.id}: an event spawns ${o.tag}`);
      if (o.kind === 'destroy' || o.kind === 'protect') assert.ok(startTags.has(o.tag), `${m.id}/${o.id}: something starts with ${o.tag}`);
      if (o.kind === 'build') assert.ok(BUILDINGS[o.type] && o.count > 0, `${m.id}/${o.id}`);
      if (o.hidden) assert.ok(m.events.some((e) => e.reveal === o.id), `${m.id}/${o.id}: an event reveals it`);
      if (o.limit !== undefined) assert.ok(Number.isFinite(o.limit) && o.limit > 0 && o.kind !== 'protect', `${m.id}/${o.id}: a limit in seconds`);
    }
    assert.ok(m.objectives.some((o) => !o.optional && o.kind !== 'protect'), `${m.id} can be won by its objectives`);
    for (const e of m.events) {
      assert.ok(Number.isFinite(e.at) !== (typeof e.after === 'string'), `${m.id}: an event has a time or an objective, not both`);
      if (e.after) assert.ok(ids.has(e.after), `${m.id}: after ${e.after}`);
      if (e.reveal) assert.ok(ids.has(e.reveal), `${m.id}: reveal ${e.reveal}`);
      if (e.spawn) {
        assert.ok(Number.isInteger(e.spawn.owner) && e.spawn.owner < m.players.length, `${m.id}: spawn owner`);
        if (e.spawn.target) assert.ok(startTags.has(e.spawn.target), `${m.id}: target ${e.spawn.target}`);
      }
    }
  }
});

test('every spoken line has its recorded clip, named by its words', () => {
  const lines = campaignLines();
  assert.equal(lines.length, MISSIONS.length * 2 + MISSIONS.reduce((n, m) => n + m.events.filter((e) => e.say).length, 0));
  assert.equal(new Set(lines.map((l) => l.file)).size, lines.length, 'no two lines share a clip');
  for (const { file } of lines) {
    const path = fileURLToPath(new URL(`../../assets/narration/campaign/${file}`, import.meta.url));
    assert.ok(existsSync(path), `missing ${file}: render it with tools/narration/render.py --lines`);
  }
  assert.notEqual(clipName('shore', 'briefing', 'a'), clipName('shore', 'briefing', 'b'), 'new words, new clip');
});

test('the computer players\' names fit the 20 characters a player name may have', () => {
  for (const m of MISSIONS) for (const p of m.players.slice(1)) assert.ok(p.name.length <= 20, p.name);
});
