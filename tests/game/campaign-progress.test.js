// The campaign's progress on this device (src/game/campaign-progress.js) and its narrator (src/game/campaign-voice.js).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chapterUnlocked, getProgress, isUnlocked, nextToPlay, recordMission, resetProgress, sanitizeProgress, wonCount } from '../../src/game/campaign-progress.js';
import { CampaignVoice, missionClips } from '../../src/game/campaign-voice.js';
import { MISSIONS, clipName } from '../../src/data/campaign.js';

afterEach(() => resetProgress());

test('missions open one after another as they are won', () => {
  resetProgress();
  assert.deepEqual(MISSIONS.map((m) => isUnlocked(m.id)), [true, false, false, false, false, false, false, false, false, false]);
  assert.equal(nextToPlay(), MISSIONS[0]);
  const r = recordMission('shore', 400.6, 1000);
  assert.deepEqual(r, { first: true, best: 400, previous: 0, chapterDone: false });
  assert.deepEqual(MISSIONS.map((m) => isUnlocked(m.id)), [true, true, false, false, false, false, false, false, false, false]);
  assert.equal(nextToPlay(), MISSIONS[1]);
  assert.equal(wonCount(), 1);
});

test('a replay keeps the best time; winning the last mission finishes the chapter once', () => {
  resetProgress();
  recordMission('shore', 500);
  assert.deepEqual(recordMission('shore', 450), { first: false, best: 450, previous: 500, chapterDone: false });
  assert.equal(recordMission('shore', 600).best, 450);
  for (const m of MISSIONS.slice(1, 4)) recordMission(m.id, 900);
  assert.equal(chapterUnlocked('wolf_age'), false, 'Chapter II is shut until Chapter I is won');
  assert.equal(recordMission('twilight', 1500).chapterDone, true);
  assert.equal(recordMission('twilight', 1400).chapterDone, false);
  assert.equal(recordMission('nope', 10).first, false);
});

test('winning Chapter I opens Chapter II, whose last mission finishes it once', () => {
  resetProgress();
  for (const m of MISSIONS.slice(0, 5)) recordMission(m.id, 900);
  assert.equal(chapterUnlocked('long_winter'), true);
  assert.equal(chapterUnlocked('wolf_age'), true);
  assert.equal(nextToPlay().id, 'hordaland');
  assert.deepEqual([wonCount(undefined, 'long_winter'), wonCount(undefined, 'wolf_age'), wonCount()], [5, 0, 5]);
  assert.equal(isUnlocked('lyngvi'), false);
  for (const m of MISSIONS.slice(5, 9)) assert.equal(recordMission(m.id, 800).chapterDone, false);
  assert.equal(recordMission('vigrid', 1500).chapterDone, true);
  assert.equal(recordMission('vigrid', 1400).chapterDone, false);
  assert.equal(nextToPlay(), MISSIONS[9], 'all won: the last one stays chosen');
  assert.equal(chapterUnlocked('nope'), false);
});

test('a stored progress is cleaned: unknown missions and bad numbers go', () => {
  const p = sanitizeProgress({ won: { shore: { best: 300, at: 5 }, nope: { best: 1 }, pass: { best: -4, at: 'x' } } });
  assert.deepEqual(p, { won: { shore: { best: 300, at: 5 }, pass: { best: 0, at: 0 } } });
  assert.deepEqual(sanitizeProgress(null), { won: {} });
  assert.deepEqual(sanitizeProgress({ won: 'x' }), { won: {} });
  assert.ok(getProgress());
});

test('the narrator says a mission\'s lines with its clips, ducks the music, and stays quiet when narration is off', () => {
  const m = MISSIONS[0];
  const clips = missionClips(m, ['briefing']);
  assert.deepEqual(Object.values(clips), [`campaign/${clipName(m.id, 'briefing', m.briefing)}`]);
  assert.equal(Object.keys(missionClips(m)).length, 2 + m.events.filter((e) => e.say).length);
  const said = [];
  const ducks = [];
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  const speech = { Utterance, synth: { speak: (u) => { said.push(u.text); if (u.onstart) u.onstart(); }, cancel: () => said.push('cancel') } };
  let settings = { narration: true, volume: 0.7 };
  const v = new CampaignVoice({ mission: m, speech, settings: () => settings, music: { duck: (d, s) => ducks.push([d, s]) } });
  assert.equal(v.say(m.briefing), true);
  assert.deepEqual(said, [m.briefing]);
  assert.equal(ducks.length, 1);
  assert.ok(ducks[0][1] > 10, 'the music stays down for the whole briefing');
  settings = { narration: false, volume: 0.7 };
  assert.equal(v.say('x'), false);
  settings = { narration: true, volume: 0 };
  assert.equal(v.say('x'), false);
  v.stop();
  assert.equal(said.at(-1), 'cancel');
  assert.equal(new CampaignVoice({ mission: m, speech: null }).say('x'), false);
});
