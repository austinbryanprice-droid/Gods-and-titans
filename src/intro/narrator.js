// The intro film's voice (DESIGN 11.1): the browser's own speech synthesis reads each caption aloud as
// it comes up, so the film says what its text says. No recorded audio, nothing to download. Where the
// browser has no speech synthesis, or will not speak until the page has had a click (the rule that
// keeps the film's sound effects quiet on a first visit), the film plays on with its captions alone.
//
//   const voice = createNarrator({ volume: settings.volume, onBlocked: (blocked) => showHint(blocked), onSpeaking: (on) => score.speaking(on) });
//   voice.update(t);   // once a frame, with the film's second: each caption is spoken as its time comes
//   voice.retry();     // after a click, if the browser had refused: says the caption that is up now
//   voice.stop();      // at once and for good: a skip, the end of the film, a failure
//
// `onSpeaking(true)` is called as a line is handed to the browser, a moment before the voice is heard, and
// `onSpeaking(false)` when no line is left (the browser's `end` or `error` events, or the line's caption running
// out, whichever comes first, for a browser that never reports an end); the score under the film steps back
// for it and swells again.
import { CAPTIONS } from './script.js';

const LANG = 'en-US'; // the captions are English; the browser picks its own best voice for it
const RATE = 0.9; // a little slower than talk, for a film
const PITCH = 0.9;
const LATE = 1.2; // seconds a caption must still have left for a click to start it late

/** The browser's speech synthesis and its utterance class, or null where it has none. */
export function browserSpeech() {
  try {
    const synth = globalThis.speechSynthesis;
    const Utterance = globalThis.SpeechSynthesisUtterance;
    return synth && typeof synth.speak === 'function' && typeof Utterance === 'function' ? { synth, Utterance } : null;
  } catch {
    return null; // some sandboxed pages throw even on the lookup
  }
}

export class Narrator {
  /**
   * @param {object} [o]
   * @param {{ synth: object, Utterance: Function }|null} [o.speech] the browser's by default; tests pass a stand-in (or null for none)
   * @param {number} [o.volume] the game's volume setting, 0..1; the voice follows it, and 0 is silence
   * @param {readonly { from: number, to: number, text: string }[]} [o.captions] the film's caption table
   * @param {(blocked: boolean) => void} [o.onBlocked] true when the browser starts refusing to speak, false when it speaks again
   * @param {(speaking: boolean) => void} [o.onSpeaking] true when a line is handed to the browser, false when none is left to be said
   */
  constructor({ speech = browserSpeech(), volume = 1, captions = CAPTIONS, onBlocked = () => {}, onSpeaking = () => {} } = {}) {
    this.speech = speech;
    this.volume = Math.min(1, Math.max(0, Number(volume) || 0));
    this.captions = captions;
    this.onBlocked = onBlocked;
    this.onSpeaking = onSpeaking;
    this.t = 0; // the film's second at the last update
    this.next = 0; // the first caption not yet spoken
    this.blocked = false;
    this.stopped = false;
    this.speaking = false; // a line is with the browser (said or about to be)
    this.lines = new Set(); // the lines handed over and not yet over
    this.until = -Infinity; // the film second by which the last of them is over, whatever the browser reports
    this.utterance = null; // the one being said: held, because a browser may drop an utterance nobody references mid-sentence
  }

  /** Whether this browser has speech synthesis at all. */
  get supported() {
    return !!this.speech;
  }

  /** The film is at second t: speak each caption whose time has come (one that came and went between two frames is not read late). */
  update(t) {
    if (this.stopped) return;
    this.t = t;
    while (this.next < this.captions.length && this.captions[this.next].from <= t) {
      const c = this.captions[this.next++];
      if (t <= c.to) this.say(c.text, c.to);
    }
    // A browser that never says a line is over (some do not) must not hold the music down: the line ends with its caption.
    if (this.lines.size && t > this.until) this.settle();
  }

  /** After a click: if the browser had refused to speak, say the caption that is up now (if it has time left to be worth it). */
  retry() {
    if (this.stopped || !this.blocked) return;
    this.setBlocked(false); // the click is what the browser was waiting for; a refusal now would say so again
    const t = this.t;
    const c = this.captions.find((x) => x.from <= t && t <= x.to - LATE);
    if (c) this.say(c.text, c.to);
  }

  /** Silence, at once and for good. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.utterance = null; // late events from the cut-off sentence mean nothing
    this.settle();
    if (!this.speech) return;
    try {
      this.speech.synth.cancel();
    } catch {
      // nothing is being said that could be cut off
    }
  }

  /** Hand a line to the browser; `until` is the film second its caption ends at. */
  say(text, until = this.t + 6) {
    if (!this.speech || !(this.volume > 0)) return;
    const { synth, Utterance } = this.speech;
    const line = {};
    try {
      const u = new Utterance(text); // the browser queues it behind a line still being said, so two lines never overlap
      u.lang = LANG;
      u.rate = RATE;
      u.pitch = PITCH;
      u.volume = this.volume;
      u.onstart = () => {
        if (this.utterance === u) this.setBlocked(false);
      };
      u.onend = () => this.landed(line);
      u.onerror = (e) => {
        this.landed(line);
        if (this.utterance === u && e && e.error === 'not-allowed') this.setBlocked(true);
      };
      this.utterance = u;
      this.lines.add(line);
      this.until = Math.max(this.until, until);
      this.refresh(); // the score steps back now, before the voice is heard
      synth.speak(u);
    } catch {
      // a voice that cannot speak must not stop the film
      this.landed(line);
    }
  }

  /** A line is over (the browser said so). Events of a line already settled or cut off are ignored. */
  landed(line) {
    if (!this.lines.delete(line)) return;
    this.refresh();
  }

  /** Every line is over at once (stop, or the caption of the last one has run out). */
  settle() {
    if (!this.lines.size) return;
    this.lines.clear();
    this.refresh();
  }

  /** Tell the listener when "a line is with the browser" changes. */
  refresh() {
    const speaking = this.lines.size > 0 && !this.stopped;
    if (speaking === this.speaking) return;
    this.speaking = speaking;
    try {
      this.onSpeaking(speaking);
    } catch (err) {
      console.warn('[narrator] a listener failed', err);
    }
  }

  setBlocked(blocked) {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    this.onBlocked(blocked);
  }
}

/** A narrator for the film: see Narrator. */
export function createNarrator(options) {
  return new Narrator(options);
}
