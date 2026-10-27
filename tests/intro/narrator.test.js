// The intro film's voice (src/intro/narrator.js): it reads each caption of the script aloud as the film's
// clock reaches it, goes quiet the moment it is told to, and falls back to nothing where the browser
// cannot speak. The browser's speech synthesis is a stand-in here; the real one is checked in
// tools/shot-intro.mjs --narration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Narrator, createNarrator, browserSpeech } from '../../src/intro/narrator.js';
import { CAPTIONS, FILM_LENGTH } from '../../src/intro/script.js';

class FakeUtterance {
  constructor(text) {
    this.text = text;
  }
}

/** A speech synthesis that logs what it is asked, and refuses to speak (as a browser does before the page has had a click) while `allowed` is false. */
function fakeSpeech({ allowed = true } = {}) {
  const log = [];
  const synth = {
    allowed,
    speaking: false,
    pending: false,
    speak(u) {
      log.push(['speak', u.text]);
      synth.spoken.push(u);
      if (!synth.allowed) {
        if (u.onerror) u.onerror({ error: 'not-allowed' });
        return;
      }
      synth.speaking = true;
      if (u.onstart) u.onstart({});
    },
    cancel() {
      log.push(['cancel']);
      synth.speaking = false;
      synth.pending = false;
    },
    spoken: [],
    log,
  };
  return { synth, Utterance: FakeUtterance };
}

/** A narrator on a fake speech synthesis, with the calls to its onBlocked and the film second each line was started at kept. */
function make(o = {}) {
  const speech = o.speech || fakeSpeech(o);
  const blocked = [];
  const voice = new Narrator({ speech, onBlocked: (b) => blocked.push(b), ...(o.narrator || {}) });
  const starts = [];
  const speak = speech.synth.speak;
  speech.synth.speak = (u) => {
    starts.push([u.text, voice.t]);
    speak(u);
  };
  return { voice, speech, synth: speech.synth, blocked, starts, texts: () => speech.synth.spoken.map((u) => u.text) };
}

/** The film's frames: 20 a second, from nothing to the end. */
function play(voice, { until = FILM_LENGTH, from = 0 } = {}) {
  for (let t = from; t <= until + 1e-9; t += 0.05) voice.update(t);
}

test('each caption is spoken once, in order, as its time comes, word for word', () => {
  const { voice, starts } = make();
  play(voice);
  assert.deepEqual(starts.map((s) => s[0]), CAPTIONS.map((c) => c.text), 'the captions\' own words, each once');
  starts.forEach(([text, at], i) => {
    const c = CAPTIONS[i];
    assert.ok(at >= c.from && at < c.from + 0.06, `"${text}" starts with its caption (${at} for ${c.from})`);
  });
});

test('the voice speaks English at a film\'s pace, at the volume it was given', () => {
  const { voice, synth } = make({ narrator: { volume: 0.4 } });
  play(voice, { until: 3 });
  const u = synth.spoken[0];
  assert.equal(u.text, CAPTIONS[0].text);
  assert.equal(u.lang, 'en-US');
  assert.equal(u.volume, 0.4);
  assert.ok(u.rate >= 0.7 && u.rate <= 1, `rate ${u.rate}: a little slower than talk, not a drawl`);
  assert.ok(u.pitch >= 0.7 && u.pitch <= 1.1, `pitch ${u.pitch}`);
  assert.equal(new Narrator({ speech: fakeSpeech(), volume: 7 }).volume, 1, 'a volume is held to 0..1');
  assert.equal(new Narrator({ speech: fakeSpeech(), volume: -3 }).volume, 0);
  assert.equal(new Narrator({ speech: fakeSpeech(), volume: 'loud' }).volume, 0);
});

test('a volume of nothing is silence: the browser is never asked to speak', () => {
  const { voice, synth } = make({ narrator: { volume: 0 } });
  play(voice);
  assert.deepEqual(synth.log, []);
});

test('every caption fits its time on screen with room to spare, at the pace of a slow voice', () => {
  // a slow voice at this narrator's rate says about eleven characters a second; the speech must be over well before the line is
  const SECONDS_PER_CHAR = 0.09;
  for (const c of CAPTIONS) {
    const said = c.text.length * SECONDS_PER_CHAR;
    assert.ok(said <= (c.to - c.from) * 0.6, `"${c.text}": about ${said.toFixed(1)} s of speech in a ${(c.to - c.from).toFixed(1)} s caption`);
  }
});

test('a caption that came and went between two frames is not read late', () => {
  const { voice, texts } = make();
  voice.update(0);
  voice.update(33); // the page was away: the first three captions are over, the fourth (31 to 35.4) is up
  assert.deepEqual(texts(), [CAPTIONS[3].text]);
  voice.update(33.05);
  voice.update(38.7);
  assert.deepEqual(texts(), [CAPTIONS[3].text, CAPTIONS[4].text]);
});

test('stop silences the voice at once and for good', () => {
  const { voice, synth, texts } = make();
  play(voice, { until: 3 });
  assert.equal(synth.speaking, true);
  const spoken = synth.spoken[0];
  voice.stop();
  assert.equal(synth.speaking, false, 'the sentence is cut off');
  assert.equal(synth.log.filter((l) => l[0] === 'cancel').length, 1);
  play(voice, { from: 3, until: FILM_LENGTH });
  assert.deepEqual(texts(), [CAPTIONS[0].text], 'nothing more is said');
  voice.retry();
  assert.deepEqual(texts(), [CAPTIONS[0].text], 'not even after a click');
  spoken.onerror({ error: 'canceled' }); // the browser reports the cut-off sentence late: no matter
  voice.stop();
  assert.equal(synth.log.filter((l) => l[0] === 'cancel').length, 1, 'stopped once');
});

test('a stop before anything was said is harmless, and so is a stop on a browser that cannot cancel', () => {
  const a = make();
  a.voice.stop();
  a.voice.update(5);
  assert.deepEqual(a.texts(), []);
  const speech = fakeSpeech();
  speech.synth.cancel = () => {
    throw new Error('no speech engine');
  };
  const b = new Narrator({ speech });
  b.update(2);
  b.stop();
});

test('a new line is queued behind one still being said, not cut into it', () => {
  const { voice, synth } = make();
  voice.update(1.5);
  assert.deepEqual(synth.log, [['speak', CAPTIONS[0].text]]);
  synth.speaking = true; // the first line is still being said when the second is due
  voice.update(9.7);
  assert.deepEqual(synth.log.slice(1), [['speak', CAPTIONS[1].text]], 'the browser lines it up; nothing is cancelled');
});

test('where the browser has no speech synthesis the film is simply quiet', () => {
  for (const voice of [new Narrator({ speech: null }), createNarrator({ speech: null })]) {
    assert.equal(voice.supported, false);
    play(voice);
    voice.retry();
    voice.stop();
  }
  assert.equal(make().voice.supported, true);
});

test('a speech engine that throws does not stop the film, nor the lines after it', () => {
  const speech = fakeSpeech();
  const attempts = [];
  const speak = speech.synth.speak;
  speech.synth.speak = (u) => {
    attempts.push(u.text);
    if (attempts.length === 1) throw new Error('synthesis-failed');
    speak(u);
  };
  const voice = new Narrator({ speech });
  play(voice);
  assert.deepEqual(attempts, CAPTIONS.map((c) => c.text), 'every line was tried');
  assert.equal(speech.synth.spoken.length, CAPTIONS.length - 1, 'and the rest were said');
  voice.stop();
});

test('a browser that will not speak before a click is reported, and a click starts the voice at the line on screen', () => {
  const { voice, synth, blocked, texts } = make({ allowed: false });
  play(voice, { until: 3 });
  assert.deepEqual(blocked, [true], 'the first refusal is reported');
  assert.equal(voice.blocked, true);
  assert.deepEqual(texts(), [CAPTIONS[0].text], 'it was tried');
  play(voice, { from: 3.05, until: 12 }); // the second caption (9.6 to 14.2) is refused too
  assert.deepEqual(blocked, [true], 'but not reported again');
  assert.equal(texts().length, 2);
  // a click at 12 s: the second line (to 14.2) is still up with 2.2 s left
  synth.allowed = true;
  voice.retry();
  assert.deepEqual(blocked, [true, false], 'the hint can go at once');
  assert.deepEqual(texts(), [CAPTIONS[0].text, CAPTIONS[1].text, CAPTIONS[1].text], 'the line on screen is said');
  assert.equal(synth.speaking, true);
  // the browser keeps its word from here on
  play(voice, { from: 12.05, until: 21 });
  assert.equal(texts().at(-1), CAPTIONS[2].text);
  assert.deepEqual(blocked, [true, false]);
  voice.retry();
  assert.equal(texts().length, 4, 'a click on a working voice does nothing');
});

test('a click that comes too late for the line on screen, or between lines, says nothing; the next line is spoken as usual', () => {
  const { voice, synth, blocked, texts } = make({ allowed: false });
  play(voice, { until: 7.2 }); // refused at 1.4; the caption (to 7.6) has 0.4 s left
  synth.allowed = true;
  voice.retry();
  assert.deepEqual(texts(), [CAPTIONS[0].text], 'not said late');
  assert.deepEqual(blocked, [true, false]);
  voice.update(7.8); // between lines
  voice.update(9.7);
  assert.deepEqual(texts(), [CAPTIONS[0].text, CAPTIONS[1].text], 'the next line is');
  assert.equal(voice.blocked, false);
});

test('a refusal after a click is reported again', () => {
  const { voice, synth, blocked } = make({ allowed: false });
  play(voice, { until: 3 });
  synth.allowed = true;
  voice.retry();
  synth.allowed = false; // the browser changes its mind
  voice.update(9.7);
  assert.deepEqual(blocked, [true, false, true]);
});

test('only a refusal for want of a click counts: other errors say nothing', () => {
  const { voice, synth, blocked } = make();
  voice.update(1.5);
  synth.spoken[0].onerror({ error: 'synthesis-failed' });
  synth.spoken[0].onerror({ error: 'interrupted' });
  synth.spoken[0].onerror(undefined);
  assert.deepEqual(blocked, []);
  assert.equal(voice.blocked, false);
});

test('browserSpeech: the browser\'s own speech synthesis and utterance, or null where either is missing', () => {
  const had = { synth: Object.getOwnPropertyDescriptor(globalThis, 'speechSynthesis'), utt: Object.getOwnPropertyDescriptor(globalThis, 'SpeechSynthesisUtterance') };
  try {
    delete globalThis.speechSynthesis;
    delete globalThis.SpeechSynthesisUtterance;
    assert.equal(browserSpeech(), null, 'Node has none');
    assert.equal(new Narrator().supported, false);
    const synth = { speak() {}, cancel() {} };
    globalThis.speechSynthesis = synth;
    assert.equal(browserSpeech(), null, 'a synthesis without its utterance class cannot speak');
    globalThis.SpeechSynthesisUtterance = FakeUtterance;
    assert.deepEqual(browserSpeech(), { synth, Utterance: FakeUtterance });
    assert.equal(new Narrator().supported, true, 'the default is the browser\'s');
    globalThis.speechSynthesis = {};
    assert.equal(browserSpeech(), null, 'a synthesis that cannot speak is none');
    Object.defineProperty(globalThis, 'speechSynthesis', { configurable: true, get() { throw new Error('blocked'); } });
    assert.equal(browserSpeech(), null, 'a lookup that throws is none');
  } finally {
    for (const [name, d] of [['speechSynthesis', had.synth], ['SpeechSynthesisUtterance', had.utt]]) {
      delete globalThis[name];
      if (d) Object.defineProperty(globalThis, name, d);
    }
  }
});
