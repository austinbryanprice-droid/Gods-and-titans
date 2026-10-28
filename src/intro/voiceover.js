// The intro film's recorded voice (DESIGN 11.1): each caption is a short clip, rendered offline with a neural voice
// (tools/narration/render.py, Kokoro's "George", a deep British narrator) and played through the game's own sound
// chain, so the voice follows the volume slider and the mute, and gets a breath of the same hall reverb as the sounds.
// It stands in for the browser's speech synthesis behind the narrator (src/intro/narrator.js), with the same shape:
// `synth.speak(utterance)` and `synth.cancel()`, and `onstart`, `onend` and `onerror` on the utterance. A line whose
// clip could not be had (no Web Audio, a failed download, a file that would not decode) goes to the browser's voice
// instead, so the film is never silent where it used to speak.
//
//   const speech = recordedSpeech();               // starts downloading the clips at once
//   new Narrator({ speech, ... });                 // or createNarrator(), which does this itself
import { sfx } from '../audio/sfx.js';
import { browserSpeech } from './narrator.js';

/** Caption text → its clip, next to the page (assets/narration). Must match CAPTIONS in script.js word for word (a test checks). */
export const VOICE_CLIPS = Object.freeze({
  'Raise a city of the faithful': 'raise-a-city.mp3',
  'Pray. Summon the gods.': 'summon-the-gods.mp3',
  'Lead them to war': 'lead-them-to-war.mp3',
  'Unleash the titans': 'unleash-the-titans.mp3',
  'Ten mythologies. One war.': 'one-war.mp3',
});

const GAIN = 1; // the clips are at -20 LUFS; through the master at the default volume that is the -25 the score was mixed for
const REVERB = 0.12; // send to the sound effects' hall
const LEAD = 0.15; // seconds between the hand-over (the score starts stepping back) and the first word
const GAP = 0.25; // seconds between two lines if one is handed over while the last is still being said
const WAIT = 1.5; // seconds a line waits for its clip to arrive before the browser's voice says it instead
const ALLOW = 0.4; // seconds a line waits for a suspended context to run before it counts as refused

/** Where the clips are served from: assets/narration beside index.html. */
export function clipUrl(file) {
  return new URL(`../../assets/narration/${file}`, import.meta.url).href;
}

class ClipUtterance {
  constructor(text) {
    this.text = text;
    this.lang = '';
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
  }
}

function fire(fn, e) {
  try {
    if (fn) fn(e);
  } catch (err) {
    console.warn('[voiceover] a listener failed', err);
  }
}

/** Decode on any context: the promise form, or the callback form of older Safari. */
function decode(ctx, data) {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

export class RecordedSpeech {
  /**
   * @param {object} [o]
   * @param {{ shared: object|null, ready: boolean, onReady?: Function }} [o.audio] the sound engine (its context, master and reverb)
   * @param {Record<string, string>} [o.clips] caption text → file
   * @param {(file: string) => Promise<ArrayBuffer>} [o.fetchClip] downloads one clip
   * @param {{ synth: object, Utterance: Function }|null} [o.fallback] the browser's voice, for a line with no clip
   * @param {(fn: Function, ms: number) => unknown} [o.later] setTimeout (tests pass their own)
   */
  constructor({ audio = sfx, clips = VOICE_CLIPS, fetchClip = defaultFetch, fallback = browserSpeech(), later = (fn, ms) => setTimeout(fn, ms) } = {}) {
    this.audio = audio;
    this.fallback = fallback;
    this.later = later;
    this.buffers = new Map(); // text → AudioBuffer, or null when it failed
    this.loads = new Map(); // text → promise of the buffer (or null)
    this.playing = new Set(); // sources started or scheduled
    this.endsAt = 0; // context time the last scheduled line ends
    this.epoch = 0; // bumped by cancel(): a line still waiting for its clip or the context is dropped
    const sh = audio && audio.shared;
    for (const [text, file] of Object.entries(clips)) {
      const load = sh
        ? fetchClip(file)
          .then((data) => decode(sh.ctx, data))
          .catch((err) => {
            console.warn('[voiceover] clip unavailable, the browser voice will say it', file, err);
            return null;
          })
        : Promise.resolve(null);
      this.loads.set(text, load.then((b) => {
        this.buffers.set(text, b);
        return b;
      }));
    }
    const self = this;
    this.Utterance = ClipUtterance;
    this.synth = {
      speak: (u) => self.speak(u),
      cancel: () => self.cancel(),
    };
  }

  /** Every clip has arrived (or failed); for tools and tests. */
  get loaded() {
    return Promise.all(this.loads.values());
  }

  speak(u) {
    const epoch = this.epoch;
    if (this.buffers.has(u.text)) return this.play(u, epoch);
    const load = this.loads.get(u.text);
    if (!load) return this.handOff(u);
    // Not here yet (the film can begin before a slow connection brings them): wait a little, then let the browser say it.
    let done = false;
    const go = (late) => {
      if (done || epoch !== this.epoch) return;
      done = true;
      if (late) this.handOff(u);
      else this.play(u, epoch);
    };
    load.then(() => go(false));
    this.later(() => go(true), WAIT * 1000);
  }

  /** Play a line's clip, once the context runs; a context that stays suspended is a refusal, as the browser's voice would report it. */
  play(u, epoch) {
    const buffer = this.buffers.get(u.text);
    if (!buffer) return this.handOff(u);
    const audio = this.audio;
    if (audio.ready) return this.start(u, buffer);
    let done = false;
    let unwatch = () => {};
    const go = (allowed) => {
      if (done) return;
      done = true;
      unwatch();
      if (epoch !== this.epoch) return;
      if (allowed) this.start(u, buffer);
      else fire(u.onerror, { error: 'not-allowed' });
    };
    if (audio.onReady) unwatch = audio.onReady(() => go(true)) || unwatch;
    this.later(() => go(audio.ready), ALLOW * 1000);
  }

  start(u, buffer) {
    const sh = this.audio.shared;
    if (!sh) return this.handOff(u);
    try {
      const ctx = sh.ctx;
      const at = Math.max(ctx.currentTime + LEAD, this.endsAt > ctx.currentTime ? this.endsAt + GAP : 0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      g.gain.value = GAIN;
      src.connect(g);
      g.connect(sh.master);
      if (sh.reverb && REVERB > 0) {
        const send = ctx.createGain();
        send.gain.value = REVERB;
        src.connect(send);
        send.connect(sh.reverb);
      }
      this.playing.add(src);
      src.onended = () => {
        if (!this.playing.delete(src)) return;
        fire(u.onend, {});
      };
      src.start(at);
      this.endsAt = at + buffer.duration;
      fire(u.onstart, {});
    } catch (err) {
      console.warn('[voiceover] could not play a line', err);
      fire(u.onerror, { error: 'audio-busy' });
    }
  }

  /** The browser's voice says this line instead (same settings, same listeners), or it is reported as failed. */
  handOff(u) {
    const fb = this.fallback;
    if (!fb) return fire(u.onerror, { error: 'synthesis-unavailable' });
    try {
      const v = new fb.Utterance(u.text);
      v.lang = u.lang;
      v.rate = u.rate;
      v.pitch = u.pitch;
      v.volume = u.volume;
      v.onstart = (e) => fire(u.onstart, e);
      v.onend = (e) => fire(u.onend, e);
      v.onerror = (e) => fire(u.onerror, e);
      fb.synth.speak(v);
    } catch {
      fire(u.onerror, { error: 'synthesis-failed' });
    }
  }

  cancel() {
    this.epoch++;
    for (const src of this.playing) {
      try {
        src.stop();
      } catch {
        // already over
      }
    }
    this.playing.clear();
    this.endsAt = 0;
    if (this.fallback) {
      try {
        this.fallback.synth.cancel();
      } catch {
        // nothing being said
      }
    }
  }
}

function defaultFetch(file) {
  return fetch(clipUrl(file)).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.arrayBuffer();
  });
}

/** The film's voice: the recorded clips where the page has Web Audio and can download, else the browser's speech (or null). */
export function recordedSpeech(options) {
  const audio = (options && options.audio) || sfx;
  if (!audio || !audio.shared || typeof fetch !== 'function') return (options && 'fallback' in options) ? options.fallback : browserSpeech();
  return new RecordedSpeech(options);
}
