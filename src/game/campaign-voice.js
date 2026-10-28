// The campaign's narrator (DESIGN 5.16): the briefings, the lines said during a mission and its victory, in the
// intro film's recorded voice (src/intro/voiceover.js, the clips in assets/narration/campaign), with the browser's
// voice for a line whose clip cannot be had. It follows the Narration setting and the volume, and the music steps
// back while it speaks.
//
//   const voice = new CampaignVoice({ mission });   // downloads that mission's clips
//   voice.say(text);                                // queued after a line still being said
//   voice.stop();                                   // at once (leaving the screen or the match)
import { clipName } from '../data/campaign.js';
import { recordedSpeech } from '../intro/voiceover.js';
import { music } from '../audio/music.js';
import { getSettings } from '../settings.js';

const WORDS_PER_SECOND = 2.4; // the narrator's pace at the render's speed, for how long the music stays down
const DUCK = 0.45;

/** Caption text → clip file (under assets/narration) for a mission's lines; `parts` picks some ('briefing', 'victory', 'events'). */
export function missionClips(m, parts = ['briefing', 'victory', 'events']) {
  const out = {};
  if (parts.includes('briefing')) out[m.briefing] = `campaign/${clipName(m.id, 'briefing', m.briefing)}`;
  if (parts.includes('victory')) out[m.victory] = `campaign/${clipName(m.id, 'victory', m.victory)}`;
  if (parts.includes('events')) {
    m.events.forEach((e, i) => {
      if (e.say) out[e.say] = `campaign/${clipName(m.id, `e${i}`, e.say)}`;
    });
  }
  return out;
}

export class CampaignVoice {
  /**
   * @param {object} o
   * @param {object} o.mission a mission of src/data/campaign.js
   * @param {string[]} [o.parts] which of its lines to download
   * @param {object|null} [o.speech] { synth, Utterance } (tests); recorded clips by default
   * @param {() => object} [o.settings] getSettings
   * @param {{ duck: Function }|null} [o.music]
   */
  constructor({ mission, parts, speech, settings = getSettings, music: m = music } = {}) {
    this.settings = settings;
    this.music = m;
    this.speech = speech !== undefined ? speech : safeSpeech(missionClips(mission, parts));
  }

  get enabled() {
    const s = this.settings();
    return !!(this.speech && s.narration && s.volume > 0);
  }

  /** Say a line (nothing when the narration is off, or nothing can speak). */
  say(text) {
    if (!text || !this.enabled) return false;
    try {
      const u = new this.speech.Utterance(text);
      u.volume = this.settings().volume; // (the browser's voice, for a line with no clip; a clip follows the master volume)
      u.onstart = () => {
        if (this.music && typeof this.music.duck === 'function') this.music.duck(DUCK, text.split(/\s+/).length / WORDS_PER_SECOND);
      };
      this.speech.synth.speak(u);
      return true;
    } catch (err) {
      console.warn('[campaign] the narrator could not speak', err);
      return false;
    }
  }

  stop() {
    try {
      if (this.speech) this.speech.synth.cancel();
    } catch {
      // nothing being said
    }
  }
}

function safeSpeech(clips) {
  try {
    return recordedSpeech({ clips });
  } catch {
    return null;
  }
}
