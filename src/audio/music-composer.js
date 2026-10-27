// The composer: turns a theme and the current battle intensity into the notes of one bar at a
// time, forever. Pure and seeded (no WebAudio), so the same seed always plays the same piece and
// every rule below can be tested in Node.
//
// A piece is a run of four-bar sections. Each section picks a chord progression (a calm one, or a
// darker one once the intensity is high), decides whether the lead plays the theme's tune or
// wanders, and each bar then adds the layers the intensity asks for:
//   pad + drone      always       a chord that swells and fades, a low pedal under it
//   arp              always       the culture's plucked instrument, sparse to busy with the intensity
//   lead             most bars    the tune (the theme's motif and its answer) or a gentle wander
//   bass             from 0.1     roots and fifths
//   perc soft        from 0.18    a light pulse
//   perc drive       from 0.40    the main groove
//   perc war + horn  from 0.62    heavy drums, horn calls, fills and crashes
import { RNG, parseChord, voiceChord, chordNotes, buildPhrase, wanderBar, midiToHz } from './music-theory.js';

export const TIERS = { bass: 0.1, soft: 0.18, drive: 0.4, war: 0.62 };

const clamp01 = (v) => Math.max(0, Math.min(1, v));
/** 0 below lo, 1 above hi, a smooth rise between. */
export function ramp(level, lo, hi) {
  const x = clamp01((level - lo) / (hi - lo));
  return x * x * (3 - 2 * x);
}

/** Seconds per bar at an intensity: the music pushes on a little as the fighting grows. */
export function barSeconds(theme, level) {
  return theme.bar / (1 + 0.1 * clamp01(level));
}

const BASS_BASE = 33; // the lowest bass root (A1)

/** Start a piece. */
export function createScore(theme, seed = 1) {
  return {
    theme,
    rng: new RNG(seed),
    bar: 0, // bars composed so far
    inSection: 0, // bar within the current section
    section: null,
    sections: 0,
    mode: 'calm',
    lastProg: -1,
    untuned: 0, // sections in a row without the tune
    prevVoicing: null,
    padUntil: 0, // bar index up to which a held pad chord still sounds
    lastLead: null,
  };
}

const SECTION_BARS = 4;

function startSection(score, level) {
  const { theme, rng } = score;
  const hot = score.mode === 'tense' ? level >= 0.38 : level >= 0.55;
  score.mode = hot ? 'tense' : 'calm';
  const progs = theme.progs[score.mode];
  let idx = rng.int(0, progs.length - 1);
  if (progs.length > 1 && idx === score.lastProg) idx = (idx + 1) % progs.length;
  score.lastProg = idx;
  const chords = progs[idx].map(parseChord);
  const density = hot ? 1 : rng.pick([0.4, 0.75, 0.75, 1, 1]);
  const first = score.sections === 0;
  let tune = false;
  if (!first) tune = score.untuned >= 2 || rng.chance(0.4 + 0.4 * level) || score.sections === 1;
  score.untuned = tune ? 0 : score.untuned + 1;
  let notes = null;
  let shift = 0;
  if (tune) {
    notes = buildPhrase(theme, chords, rng);
    const hi = theme.leadRange ? theme.leadRange[1] : theme.leadBase + 24;
    const top = Math.max(...notes.map((n) => n.midi));
    if (level >= 0.6 && top + 12 <= hi) shift = 12;
  }
  score.section = { chords, density, tune: notes, shift, mode: score.mode, index: score.sections };
  score.sections++;
  score.inSection = 0;
}

/** The bass root nearest above BASS_BASE for a chord. */
function bassRoot(chord) {
  return BASS_BASE + ((chord.root - BASS_BASE) % 12 + 12) % 12;
}

function patternHits(pat, steps) {
  const hits = [];
  for (let i = 0; i < steps; i++) if (pat[i] !== '.') hits.push([i, pat[i]]);
  return hits;
}

const ACCENT = { X: 1, x: 0.72, o: 0.42 };

/**
 * Compose the next bar.
 * @param {object} score from createScore
 * @param {number} level battle intensity 0..1
 * @returns {{ events: object[], dur: number, chord: string, mode: string, sectionStart: boolean }}
 *   events: { layer, inst, t (s from the bar start), dur (s), vel, midi | midis, pan?, tune?, bright? }
 */
export function composeBar(score, level) {
  const { theme, rng } = score;
  level = clamp01(Number.isFinite(level) ? level : 0);
  const sectionStart = !score.section || score.inSection >= SECTION_BARS;
  if (sectionStart) startSection(score, level);
  const sec = score.section;
  const barInSection = score.inSection;
  const chord = sec.chords[barInSection];
  const steps = theme.steps;
  const dur = barSeconds(theme, level);
  const sd = dur / steps;
  const events = [];
  const push = (e) => events.push(e);

  // ---- pad: one voiced chord, held while the harmony stands still
  const padVoicing = voiceChord(chord, score.prevVoicing, { lo: theme.padRange ? theme.padRange[0] : 48, hi: theme.padRange ? theme.padRange[1] : 74, voices: theme.padVoices || 4 });
  if (score.bar >= score.padUntil) {
    let hold = 1;
    while (barInSection + hold < SECTION_BARS && sec.chords[barInSection + hold].name === chord.name) hold++;
    score.padUntil = score.bar + hold;
    score.prevVoicing = padVoicing;
    push({ layer: 'pad', inst: theme.inst.pad, midis: padVoicing, t: 0, dur: dur * hold * 1.04, vel: (0.5 + 0.3 * level) * (sec.density < 0.5 ? 0.8 : 1), bright: 0.25 + 0.6 * level });
  }

  // ---- drone: a pedal under the whole section (or the tanpura's four plucked strings)
  const droneSpec = theme.drone;
  if (droneSpec && droneSpec.pluck) {
    for (let b = 0; b < 4; b++) push({ layer: 'drone', inst: droneSpec.inst, midi: droneSpec.pluck[b % droneSpec.pluck.length], t: b * (steps / 4) * sd, dur: dur / 2, vel: 0.5, sustain: 1, pan: b % 2 ? 0.25 : -0.25 });
  } else if (barInSection === 0) {
    const base = theme.tonic - 12;
    push({ layer: 'drone', inst: droneSpec ? droneSpec.inst : 'drone', midis: (droneSpec ? droneSpec.notes : [0, 7]).map((n) => base + n), t: 0, dur: dur * SECTION_BARS * 1.03, vel: 0.55, bright: 0.2 + 0.4 * level });
  }

  // ---- bass
  const bassTier = level >= TIERS.war ? 'war' : level >= TIERS.drive ? 'mid' : 'calm';
  if (level >= TIERS.bass && theme.bass) {
    const pat = theme.bass[bassTier];
    const root = bassRoot(chord);
    const hits = patternHits(pat, steps);
    hits.forEach(([step, ch], i) => {
      const next = i + 1 < hits.length ? hits[i + 1][0] : steps;
      const midi = ch === '5' ? root + 7 : ch === '8' ? root + 12 : ch === '3' ? root + (chord.intervals[1] ?? 4) : root;
      push({ layer: 'bass', inst: theme.inst.bass, midi, t: step * sd, dur: Math.min(next - step, 8) * sd, vel: (0.55 + 0.35 * ramp(level, 0.1, 0.7)) * (step === 0 ? 1 : 0.85), sustain: 1 });
    });
  }

  // ---- arp: the culture's plucked instrument over the chord
  const arpTier = level >= TIERS.war ? 'dense' : level >= 0.3 ? 'mid' : 'sparse';
  if (theme.arp) {
    const pat = theme.arp[arpTier];
    const notes = chordNotes(chord, theme.arp.base, 10);
    const keep = (arpTier === 'sparse' ? 0.9 : 0.94) * (0.5 + 0.5 * sec.density);
    for (const [step, ch] of patternHits(pat, steps)) {
      if (!rng.chance(keep)) continue;
      const midi = notes[Number(ch)];
      if (midi === undefined) continue;
      const beat = step % (steps / 4) === 0;
      push({ layer: 'arp', inst: theme.inst.arp, midi, t: Math.max(0, step * sd + (rng.next() - 0.5) * 0.012), dur: sd * 4, vel: (0.5 + 0.2 * level) * (beat ? 1 : 0.78) * (0.9 + 0.2 * rng.next()), pan: Math.max(-0.6, Math.min(0.6, (midi - 62) / 24)) });
    }
  }

  // ---- lead: the tune, or a wander (some cultures swap to a harder-edged instrument for the battle sections)
  const leadInst = (sec.mode === 'tense' && theme.inst.leadHot) || theme.inst.lead;
  const leadVel = 0.62 + 0.25 * level;
  if (sec.tune) {
    for (const n of sec.tune) {
      const local = n.at - barInSection * steps;
      if (local < 0 || local >= steps) continue;
      const strong = local % (steps / 4) === 0;
      const midi = n.midi + sec.shift;
      score.lastLead = midi;
      push({ layer: 'lead', inst: leadInst, midi, t: Math.max(0, local * sd + (rng.next() - 0.5) * 0.014), dur: n.len * sd * 0.96, vel: leadVel * (strong ? 1 : 0.86), pan: 0.12 });
    }
  } else if (sec.density >= 0.5) {
    const notes = wanderBar(theme, chord, score.lastLead, rng, sec.density * (0.55 + 0.35 * level));
    for (const n of notes) {
      score.lastLead = n.midi;
      push({ layer: 'lead', inst: leadInst, midi: n.midi, t: Math.max(0, n.at * sd + (rng.next() - 0.5) * 0.014), dur: n.len * sd * 0.96, vel: leadVel * 0.8, pan: 0.12 });
    }
  }

  // ---- percussion in three tiers, each fading in over its own stretch of the intensity
  const tiers = [['soft', 0.18, 0.3], ['drive', 0.4, 0.52], ['war', 0.62, 0.74]];
  for (const [name, lo, hi] of tiers) {
    const g = ramp(level, lo, hi);
    if (g <= 0 || !theme.perc || !theme.perc[name]) continue;
    for (const [drum, pat, base = 1, tune = 1] of theme.perc[name]) {
      for (const [step, ch] of patternHits(pat, steps)) {
        const accent = ACCENT[ch] ?? 0.7;
        push({ layer: name === 'war' ? 'war' : 'perc', inst: drum, t: Math.max(0, step * sd + (rng.next() - 0.5) * 0.006), dur: 0.3, vel: Math.min(1, base * accent * g * (0.92 + 0.16 * rng.next())), tune, pan: (step % 2 ? 0.1 : -0.1) });
      }
    }
  }

  // ---- war calls: horns on the chord, a roll into the next section, a crash at its start
  if (level >= TIERS.war + 0.04) {
    const g = ramp(level, 0.62, 0.8);
    if (barInSection % 2 === 0 && theme.inst.horn) {
      const root = bassRoot(chord) + 12;
      push({ layer: 'war', inst: theme.inst.horn, midi: root, t: 0, dur: dur * 1.9, vel: 0.7 * g });
      push({ layer: 'war', inst: theme.inst.horn, midi: root + 7, t: 0.02, dur: dur * 1.9, vel: 0.5 * g });
    }
    if (barInSection === SECTION_BARS - 1 && theme.fill) {
      theme.fill.forEach((step, i) => push({ layer: 'war', inst: theme.fillDrum || 'tom', t: step * sd, dur: 0.3, vel: Math.min(1, (0.35 + 0.15 * i) * g * 1.3), tune: 1 + 0.02 * i, pan: i % 2 ? 0.2 : -0.2 }));
    }
    if (barInSection === 0 && score.sections > 1 && level >= 0.7 && theme.crash) {
      push({ layer: 'war', inst: theme.crash, midi: theme.tonic - 12, t: 0, dur: 3, vel: 0.6 * g });
    }
  }

  // ---- sparkle: a high bell now and then when things are calm
  if (theme.inst.accent && level < 0.5 && barInSection % 2 === 0 && rng.chance(0.4 * sec.density)) {
    const notes = chordNotes(chord, theme.tonic + 24, 6);
    push({ layer: 'fx', inst: theme.inst.accent, midi: notes[rng.int(0, 3)], t: (rng.pick([0, 2, 3]) * steps) / 4 * sd, dur: 1.6, vel: 0.45 + 0.2 * rng.next(), pan: rng.range(-0.4, 0.4) });
  }

  score.inSection++;
  score.bar++;
  return { events, dur, chord: chord.name, mode: sec.mode, sectionStart: barInSection === 0 };
}

export { midiToHz };
