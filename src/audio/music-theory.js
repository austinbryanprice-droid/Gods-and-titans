// Music theory for the score: notes, modes, chords, voice leading and melodies.
// Pure functions over numbers (no WebAudio), so every rule the composer follows can be
// tested in Node. A "step" is one cell of a bar's rhythm grid (a sixteenth in 4/4, an eighth
// in 12/8); a scale "degree" counts the notes of a mode from its tonic (0), any integer.
import { RNG } from '../sim/rng.js';

export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

const LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'D', 'F#' or 'Bb' → pitch class 0..11. */
export function pitchClass(name) {
  const m = /^([A-G])([#b]?)$/.exec(name);
  if (!m) throw new RangeError(`bad note name: ${name}`);
  return (LETTERS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

const mod12 = (n) => ((n % 12) + 12) % 12;

/** Chord qualities as semitones above the root (the first four are the voiced tones, in order). */
export const CHORD_QUALITIES = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  5: [0, 7],
  7: [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  dim: [0, 3, 6],
};

const chordCache = new Map();

/** 'Dm', 'Bbmaj7', 'A5' → { name, root (pitch class), intervals, pcs (pitch classes, root first) }. */
export function parseChord(name) {
  let chord = chordCache.get(name);
  if (chord) return chord;
  const m = /^([A-G][#b]?)(.*)$/.exec(name);
  const intervals = m && CHORD_QUALITIES[m[2]];
  if (!intervals) throw new RangeError(`bad chord name: ${name}`);
  const root = pitchClass(m[1]);
  chord = Object.freeze({ name, root, intervals, pcs: Object.freeze(intervals.map((i) => mod12(root + i))) });
  chordCache.set(name, chord);
  return chord;
}

// ------------------------------------------------------------------ modes

/** Scale degree (any integer, 0 = the tonic) → MIDI note. */
export function degreeToMidi(scale, tonic, degree) {
  const n = scale.length;
  const octave = Math.floor(degree / n);
  return tonic + scale[((degree % n) + n) % n] + 12 * octave;
}

/** The scale degree whose note is closest to `midi` (a tie goes down). */
export function nearestDegree(scale, tonic, midi) {
  const n = scale.length;
  let best = 0;
  let bestD = Infinity;
  const base = Math.floor((midi - tonic) / 12) * n;
  for (let d = base - n; d <= base + 2 * n; d++) {
    const dist = Math.abs(degreeToMidi(scale, tonic, d) - midi);
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}

/** Does `midi` belong to the mode? */
export function inScale(scale, tonic, midi) {
  const rel = mod12(midi - tonic);
  return scale.includes(rel);
}

// ------------------------------------------------------------------ chords

/** True when `midi` is a tone of the chord (in any octave). */
export function isChordTone(chord, midi) {
  return chord.pcs.includes(mod12(midi));
}

/** A half step (or a major seventh) from a chord tone: the clash that grates when it is held. */
export function clashes(midi, chord) {
  const pc = mod12(midi);
  for (const c of chord.pcs) {
    const d = Math.abs(pc - c);
    if (Math.min(d, 12 - d) === 1) return true;
  }
  return false;
}

/**
 * The chord's tones climbing from `base` (the first at or above it), `count` of them,
 * wrapping into higher octaves: what an arpeggio pattern's digits index.
 */
export function chordNotes(chord, base, count) {
  const tones = chord.pcs.map((pc) => base + mod12(pc - base)).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < count; i++) out.push(tones[i % tones.length] + 12 * Math.floor(i / tones.length));
  return out;
}

/**
 * Voice a chord with the least movement from the previous voicing (smooth pads).
 * @param {object} chord parseChord result
 * @param {number[]|null} prev the previous voicing (ascending MIDI notes) or null
 * @param {{ lo?: number, hi?: number, voices?: number }} [opts] range and number of voices
 * @returns {number[]} ascending MIDI notes
 */
export function voiceChord(chord, prev, { lo = 48, hi = 74, voices = 4 } = {}) {
  const pcs = chord.pcs.slice(0, voices);
  // A chord with fewer tones than voices doubles one of them; try each and keep the smoothest.
  const sets = [];
  if (pcs.length >= voices) sets.push(pcs);
  else for (const dbl of pcs) sets.push([...pcs, ...Array(Math.min(voices, 4) - pcs.length).fill(dbl)].slice(0, Math.min(voices, 4)));
  const target = prev && prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : (lo + hi) / 2;
  let best = null;
  let bestCost = Infinity;
  for (const wanted of sets) {
    const options = wanted.map((pc) => {
      const list = [];
      for (let n = lo; n <= hi; n++) if (mod12(n) === pc) list.push(n);
      return list;
    });
    const pick = [];
    const rec = (i) => {
      if (i === options.length) {
        const sorted = pick.slice().sort((a, b) => a - b);
        for (let k = 1; k < sorted.length; k++) if (sorted[k] === sorted[k - 1]) return; // no unison doubling
        if (sorted[sorted.length - 1] - sorted[0] > 16) return; // keep the chord compact
        let cost;
        if (prev && prev.length) {
          cost = 0;
          for (let k = 0; k < sorted.length; k++) cost += Math.abs(sorted[k] - prev[Math.min(k, prev.length - 1)]);
        } else {
          cost = sorted.reduce((a, n) => a + Math.abs(n - target), 0);
        }
        // Prefer the root lowest when nothing else decides.
        if (mod12(sorted[0]) !== chord.root) cost += 0.5;
        if (cost < bestCost) {
          bestCost = cost;
          best = sorted;
        }
        return;
      }
      for (const n of options[i]) {
        pick[i] = n;
        rec(i + 1);
      }
    };
    rec(0);
  }
  if (best) return best;
  // Fallback (a very narrow range): the tones in the lowest octave that holds them.
  return chordNotes(chord, lo, Math.min(voices, 4));
}

// ------------------------------------------------------------------ melodies

/** Is this step the start of a beat (the places a melody rests on a chord tone)? */
export function isBeatStep(step, stepsPerBar) {
  return step % (stepsPerBar / 4) === 0;
}

/** Move `midi` to the nearest tone of the chord (ties go up). */
export function snapToChord(chord, midi) {
  let best = midi;
  let bestD = Infinity;
  for (let d = -6; d <= 6; d++) {
    const cand = midi + d;
    if (!isChordTone(chord, cand)) continue;
    const dist = Math.abs(d) - (d > 0 ? 0.01 : 0);
    if (dist < bestD) {
      bestD = dist;
      best = cand;
    }
  }
  return best;
}

/** Shift a whole phrase by octaves until it fits the range, then fold any stray note in. */
function fitRange(notes, lo, hi) {
  let min = Infinity;
  let max = -Infinity;
  for (const n of notes) {
    if (n.midi < min) min = n.midi;
    if (n.midi > max) max = n.midi;
  }
  let shift = 0;
  while (max + shift > hi && min + shift - 12 >= lo) shift -= 12;
  while (min + shift < lo && max + shift + 12 <= hi) shift += 12;
  if (shift) for (const n of notes) n.midi += shift;
  for (const n of notes) {
    while (n.midi > hi) n.midi -= 12;
    while (n.midi < lo) n.midi += 12;
  }
}

/**
 * The shapes the answer (bars three and four) can take.
 * Each maps the motif's [degree, length] cells to the answer's cells.
 */
const ANSWERS = {
  // The motif again a step or two away (a sequence).
  shift: (motif, rng) => {
    const d = rng.pick([-2, -1, 1, 2]);
    return motif.map(([deg, len]) => [deg === null ? null : deg + d, len]);
  },
  // The motif turned upside down inside its own range.
  invert: (motif) => {
    const degs = motif.filter(([deg]) => deg !== null).map(([deg]) => deg);
    const sum = Math.min(...degs) + Math.max(...degs);
    return motif.map(([deg, len]) => [deg === null ? null : sum - deg, len]);
  },
  // The motif unchanged (the cadence is set after).
  repeat: (motif) => motif.map(([deg, len]) => [deg, len]),
  // The first half of the motif, then the rest of the time held: a short answer.
  tail: (motif) => {
    const total = motif.reduce((a, [, len]) => a + len, 0);
    const out = [];
    let t = 0;
    for (const [deg, len] of motif) {
      if (t + len > total / 2) {
        out.push([deg, total / 2 - t > 0 ? total / 2 - t : len]);
        t = total / 2;
        break;
      }
      out.push([deg, len]);
      t += len;
    }
    out.push([null, total - t]);
    return out;
  },
};

/**
 * Four bars of melody from the theme's motif, fitted to the chords: bars one and two play the
 * motif, bars three and four answer it, strong beats rest on chord tones, held notes avoid
 * half-step clashes, and the last note settles on a tone of the last chord.
 * @param {object} theme see music-themes.js
 * @param {object[]} chords one parsed chord per bar
 * @param {RNG} rng
 * @returns {{ at: number, len: number, midi: number }[]} `at` in steps from the phrase start
 */
export function buildPhrase(theme, chords, rng) {
  const { scale, steps } = theme;
  const tonic = theme.leadBase;
  const motif = theme.motif;
  const forms = theme.answers || ['shift', 'invert', 'repeat', 'tail'];
  const answer = ANSWERS[rng.pick(forms)](motif, rng);
  const cells = [...motif, ...answer];
  const notes = [];
  let at = 0;
  for (const [deg, len] of cells) {
    if (deg !== null) notes.push({ at, len, midi: degreeToMidi(scale, tonic, deg), deg });
    at += len;
  }
  const total = at;
  const barOf = (step) => Math.min(chords.length - 1, Math.floor(step / steps));
  for (const n of notes) {
    const chord = chords[barOf(n.at)];
    const strong = isBeatStep(n.at % steps, steps);
    if (strong && !isChordTone(chord, n.midi)) n.midi = snapToChord(chord, n.midi);
    else if (!strong && n.len >= steps / 4 && clashes(n.midi, chord)) {
      // Step to the neighbouring scale tone that does not grate.
      const deg = nearestDegree(scale, tonic, n.midi);
      for (const dd of [1, -1, 2, -2]) {
        const cand = degreeToMidi(scale, tonic, deg + dd);
        if (!clashes(cand, chord)) {
          n.midi = cand;
          break;
        }
      }
    }
  }
  // The last note settles on the root or fifth of the last chord, near where it was.
  if (notes.length) {
    const last = notes[notes.length - 1];
    const chord = chords[chords.length - 1];
    const goals = [chord.pcs[0], chord.pcs[2] ?? chord.pcs[0]];
    let best = last.midi;
    let bestD = Infinity;
    for (let d = -7; d <= 7; d++) {
      const cand = last.midi + d;
      if (!goals.includes(mod12(cand))) continue;
      if (Math.abs(d) < bestD) {
        bestD = Math.abs(d);
        best = cand;
      }
    }
    last.midi = best;
    // Hold the closing note to the end of the phrase.
    last.len = Math.max(last.len, Math.min(total - last.at, steps / 2));
  }
  fitRange(notes, theme.leadRange ? theme.leadRange[0] : tonic - 5, theme.leadRange ? theme.leadRange[1] : tonic + 24);
  return notes.map(({ at: a, len, midi }) => ({ at: a, len, midi }));
}

/**
 * One bar of wandering: a few notes drifting near where the last one was, resting on chord
 * tones, for the stretches where the tune sits out. `density` is 0..1.
 * @returns {{ at: number, len: number, midi: number }[]}
 */
export function wanderBar(theme, chord, prevMidi, rng, density) {
  const { scale, steps } = theme;
  const tonic = theme.leadBase;
  const [lo, hi] = theme.leadRange || [tonic - 5, tonic + 24];
  const beat = steps / 4;
  const chances = [0.9, 0.3, 0.6, 0.3];
  const out = [];
  let last = prevMidi ?? degreeToMidi(scale, tonic, 2);
  for (let b = 0; b < 4; b++) {
    if (!rng.chance(density * chances[b])) continue;
    // Offbeat entrances now and then.
    const at = b * beat + (b > 0 && rng.chance(0.2) ? Math.round(beat / 2) : 0);
    const pool = [];
    const d0 = nearestDegree(scale, tonic, last);
    for (let dd = -3; dd <= 3; dd++) {
      const m = degreeToMidi(scale, tonic, d0 + dd);
      if (m < lo || m > hi) continue;
      let w = dd === 0 ? 0.6 : Math.abs(dd) === 1 ? 3 : Math.abs(dd) === 2 ? 1.6 : 0.5;
      if (isChordTone(chord, m)) w *= 2.5;
      else if (clashes(m, chord)) w *= 0.15;
      pool.push([m, w]);
    }
    if (!pool.length) continue;
    let total = pool.reduce((a, [, w]) => a + w, 0);
    let r = rng.next() * total;
    let midi = pool[0][0];
    for (const [m, w] of pool) {
      r -= w;
      if (r <= 0) {
        midi = m;
        break;
      }
    }
    const len = Math.max(2, Math.round(beat * rng.pick([1, 1.5, 2, 2, 3])));
    out.push({ at, len: Math.min(len, steps - at), midi });
    last = midi;
  }
  return out;
}

export { RNG };
