// The page's audio in one place. The sound effects (sfx.js) and the music (music.js) share one
// AudioContext and one master limiter, so the browser's "start audio on a click" unlock happens
// once for both, and the player's settings reach both from here.
//
//   initAudio(settings)             once at boot: start both engines from the saved settings
//   syncAudio(settings, changed)    apply a settings change (the arguments of onSettingsChange)
//   playTitleMusic()                the title screen's score (the menu calls it on every screen of the menu)
//   previewMusic(themeId, mood)     audition any theme at a calm, tense or battle moment (Settings)
import { sfx } from './sfx.js';
import { music } from './music.js';

export { sfx, music };

/** The title screen's score: the grand theme with its bass and a soft drum, short of a battle. */
export const TITLE_INTENSITY = 0.25;

/** The moments the Settings screen can audition: [label, intensity]. */
export const PREVIEW_MOODS = [['Calm', 0.08], ['Tense', 0.45], ['Battle', 0.9]];

export function initAudio(settings) {
  sfx.init({ volume: settings.volume });
  sfx.setVolume(settings.volume);
  music.init({ volume: settings.musicVolume, muted: settings.musicMuted });
}

export function syncAudio(settings, changed) {
  if (changed.includes('volume')) sfx.setVolume(settings.volume);
  if (changed.includes('musicVolume')) music.setVolume(settings.musicVolume);
  if (changed.includes('musicMuted')) music.mute(settings.musicMuted);
}

export function playTitleMusic() {
  music.setIntensity(TITLE_INTENSITY);
  music.play('menu');
}

export function previewMusic(themeId, intensity) {
  sfx.unlock(); // a click is the browser's cue to allow sound
  music.setIntensity(intensity);
  music.play(themeId);
}
