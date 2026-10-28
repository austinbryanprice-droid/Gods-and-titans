// The intro film's recorded voice (src/intro/voiceover.js): every caption has its clip on disk, a line is played
// through the sound engine's master (so it follows the volume and the mute), a line whose clip is missing goes to
// the browser's voice, a context that stays suspended is reported as a refusal, and a cancel silences everything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RecordedSpeech, VOICE_CLIPS, clipUrl, recordedSpeech } from '../../src/intro/voiceover.js';
import { Narrator } from '../../src/intro/narrator.js';
import { CAPTIONS, FILM_LENGTH } from '../../src/intro/script.js';

test('every caption has a recorded clip, and the clip is on disk next to the page', () => {
  assert.deepEqual(Object.keys(VOICE_CLIPS).sort(), CAPTIONS.map((c) => c.text).sort(), 'one clip per caption, word for word (re-render with tools/narration/render.py)');
  for (const file of Object.values(VOICE_CLIPS)) {
    const path = fileURLToPath(clipUrl(file));
    assert.ok(existsSync(path), `${file} is in assets/narration`);
    const size = statSync(path).size;
    assert.ok(size > 4000 && size < 80000, `${file} is a short clip (${size} bytes)`);
  }
});

/** A stand-in Web Audio context and sound engine: records sources started and what they were connected to. */
function fakeAudio({ running = true } = {}) {
  const started = [];
  const ctx = {
    currentTime: 10,
    decodeAudioData: (data) => Promise.resolve({ duration: 2, data }),
    createBufferSource() {
      const src = {
        connections: [],
        connect(n) {
          src.connections.push(n);
        },
        start(at) {
          src.at = at;
          started.push(src);
        },
        stop() {
          src.stopped = true;
          if (src.onended) src.onended();
        },
      };
      return src;
    },
    createGain() {
      return { gain: { value: 1 }, connect(n) {
        this.to = n;
      } };
    },
  };
  const master = { name: 'master' };
  const reverb = { name: 'reverb' };
  const hooks = [];
  const audio = {
    running,
    get ready() {
      return audio.running;
    },
    shared: { ctx, master, reverb },
    onReady(cb) {
      hooks.push(cb);
      return () => hooks.splice(hooks.indexOf(cb), 1);
    },
    allow() {
      audio.running = true;
      for (const cb of hooks.splice(0)) cb();
    },
  };
  return { audio, ctx, started, master, reverb };
}

function fakeFallback() {
  const said = [];
  class U {
    constructor(text) {
      this.text = text;
    }
  }
  return { said, speech: { synth: { speak: (u) => { said.push(u.text); u.onstart && u.onstart({}); }, cancel: () => said.push('cancel') }, Utterance: U } };
}

function timers() {
  const queue = [];
  return { later: (fn, ms) => queue.push({ fn, ms }), run: () => queue.splice(0).forEach((t) => t.fn()) };
}

test('the narrator says each caption with its clip, through the master, with a little reverb, and the score steps back for each', async () => {
  const { audio, started, master, reverb } = fakeAudio();
  const fb = fakeFallback();
  const speech = new RecordedSpeech({ audio, fetchClip: async (f) => f, fallback: fb.speech, later: timers().later });
  await speech.loaded;
  const ducks = [];
  const voice = new Narrator({ speech, onSpeaking: (on) => ducks.push(on) });
  for (let t = 0; t <= FILM_LENGTH; t += 0.05) {
    voice.update(t);
    for (const s of started) if (!s.ended && t > 0) {
      s.ended = true;
      s.onended();
    }
  }
  assert.deepEqual(started.map((s) => s.buffer.data), CAPTIONS.map((c) => VOICE_CLIPS[c.text]), 'each line, in order, from its own clip');
  for (const s of started) {
    assert.ok(s.connections.some((g) => g.to === master), 'into the master (volume and mute)');
    assert.ok(s.connections.some((g) => g.to === reverb), 'and a send to the hall');
    assert.ok(s.at > 10, 'a moment after the hand-over, so the score has begun to step back');
  }
  assert.deepEqual(fb.said, [], 'the browser voice is never used');
  assert.deepEqual(ducks, CAPTIONS.flatMap(() => [true, false]), 'the score ducks for each line and comes back after');
});

test('a line whose clip failed to download is said by the browser voice instead', async () => {
  const { audio, started } = fakeAudio();
  const fb = fakeFallback();
  const speech = new RecordedSpeech({
    audio,
    fetchClip: async (f) => {
      if (f === 'lead-them-to-war.mp3') throw new Error('404');
      return f;
    },
    fallback: fb.speech,
    later: timers().later,
  });
  await speech.loaded;
  const voice = new Narrator({ speech });
  for (let t = 0; t <= FILM_LENGTH; t += 0.05) voice.update(t);
  assert.deepEqual(fb.said, ['Lead them to war']);
  assert.equal(started.length, CAPTIONS.length - 1);
});

test('a clip still downloading is waited for, and one too slow goes to the browser voice', async () => {
  const { audio, started } = fakeAudio();
  const fb = fakeFallback();
  let release;
  const slow = new Promise((r) => (release = r));
  const clock = timers();
  const speech = new RecordedSpeech({ audio, fetchClip: (f) => (f === 'raise-a-city.mp3' ? slow.then(() => f) : Promise.resolve(f)), fallback: fb.speech, later: clock.later });
  speech.speak(new speech.Utterance('Raise a city of the faithful'));
  release();
  await speech.loaded;
  assert.equal(started.length, 1, 'played once it arrived');
  clock.run();
  assert.deepEqual(fb.said, [], 'the wait running out afterwards changes nothing');

  const stuck = new RecordedSpeech({ audio, fetchClip: (f) => (f === 'one-war.mp3' ? new Promise(() => {}) : Promise.resolve(f)), fallback: fb.speech, later: clock.later });
  stuck.speak(new stuck.Utterance('Ten mythologies. One war.'));
  clock.run();
  assert.deepEqual(fb.said, ['Ten mythologies. One war.']);
});

test('a suspended context: the line plays if the browser allows sound soon, and is a refusal if it does not', async () => {
  const { audio, started } = fakeAudio({ running: false });
  const clock = timers();
  const speech = new RecordedSpeech({ audio, fetchClip: async (f) => f, fallback: null, later: clock.later });
  await speech.loaded;
  const blocked = [];
  const voice = new Narrator({ speech, onBlocked: (b) => blocked.push(b) });
  voice.update(1.5);
  clock.run();
  assert.equal(started.length, 0);
  assert.deepEqual(blocked, [true], 'the hint goes up');
  voice.retry(); // the click: it also resumes the context
  audio.allow();
  assert.equal(started.length, 1, 'the line is said once the context runs');
  assert.deepEqual(blocked, [true, false]);
});

test('cancel stops what is playing and drops a line still waiting', async () => {
  const { audio, started } = fakeAudio({ running: false });
  const clock = timers();
  const speech = new RecordedSpeech({ audio, fetchClip: async (f) => f, fallback: null, later: clock.later });
  await speech.loaded;
  speech.speak(new speech.Utterance('Pray. Summon the gods.'));
  speech.cancel();
  audio.allow();
  assert.equal(started.length, 0, 'not played after a cancel');
  speech.speak(new speech.Utterance('Lead them to war'));
  assert.equal(started.length, 1);
  speech.cancel();
  assert.ok(started[0].stopped);
});

test('with no sound engine context the page falls back to the browser voice', () => {
  const fb = fakeFallback();
  assert.equal(recordedSpeech({ audio: { shared: null }, fallback: fb.speech }), fb.speech);
});
