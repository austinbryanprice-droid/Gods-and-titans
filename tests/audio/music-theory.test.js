// The score's music theory (src/audio/music-theory.js): pure functions over numbers, so every
// rule the composer relies on is checked here without any audio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RNG, midiToHz, pitchClass, parseChord, CHORD_QUALITIES, degreeToMidi, nearestDegree, inScale, isChordTone, clashes,
  chordNotes, voiceChord, snapToChord, buildPhrase, wanderBar, isBeatStep,
} from '../../src/audio/music-theory.js';
import { THEMES } from '../../src/audio/music-themes.js';

const mod12 = (n) => ((n % 12) + 12) % 12;
const themes = Object.values(THEMES);

test('midiToHz: A4 is 440 Hz and an octave doubles it', () => {
  assert.equal(midiToHz(69), 440);
  assert.ok(Math.abs(midiToHz(81) - 880) < 1e-9);
  assert.ok(Math.abs(midiToHz(57) - 220) < 1e-9);
});

test('pitchClass and parseChord read note and chord names', () => {
  assert.equal(pitchClass('C'), 0);
  assert.equal(pitchClass('F#'), 6);
  assert.equal(pitchClass('Bb'), 10);
  assert.throws(() => pitchClass('H'), RangeError);
  assert.deepEqual([...parseChord('D').pcs], [2, 6, 9]);
  assert.deepEqual([...parseChord('Bbm').pcs], [10, 1, 5]);
  assert.deepEqual([...parseChord('A5').pcs], [9, 4]);
  assert.deepEqual([...parseChord('Dsus2').pcs], [2, 4, 9]);
  assert.equal(parseChord('Gm').root, 7);
  assert.equal(parseChord('Gm'), parseChord('Gm'), 'cached');
  assert.throws(() => parseChord('Dxyz'), RangeError);
  assert.throws(() => parseChord('nope'), RangeError);
  for (const [q, iv] of Object.entries(CHORD_QUALITIES)) assert.ok(iv[0] === 0 && iv.length >= 2, `quality ${q}`);
});

test('degrees map to scale notes in any octave and back', () => {
  const dorian = [0, 2, 3, 5, 7, 9, 10];
  assert.equal(degreeToMidi(dorian, 50, 0), 50);
  assert.equal(degreeToMidi(dorian, 50, 2), 53);
  assert.equal(degreeToMidi(dorian, 50, 7), 62);
  assert.equal(degreeToMidi(dorian, 50, -1), 48);
  assert.equal(degreeToMidi(dorian, 50, -7), 38);
  assert.equal(degreeToMidi(dorian, 50, 15), 76);
  for (const scale of [dorian, [0, 2, 3, 7, 8], [0, 3, 5, 7, 10]]) {
    for (let d = -12; d <= 20; d++) assert.equal(nearestDegree(scale, 50, degreeToMidi(scale, 50, d)), d, `degree ${d}`);
  }
  assert.equal(inScale(dorian, 50, 62), true);
  assert.equal(inScale(dorian, 50, 63), false);
  assert.equal(inScale(dorian, 50, 38), true);
});

test('chord tones and clashes', () => {
  const dm = parseChord('Dm');
  assert.equal(isChordTone(dm, 62), true); // D
  assert.equal(isChordTone(dm, 65), true); // F
  assert.equal(isChordTone(dm, 45 + 24), true); // A in another octave
  assert.equal(isChordTone(dm, 64), false); // E
  assert.equal(clashes(64, dm), true, 'E against F');
  assert.equal(clashes(63, dm), true, 'Eb against D');
  assert.equal(clashes(67, dm), false, 'G is fine');
  assert.equal(clashes(62, dm), false, 'a chord tone does not clash with itself');
});

test('chordNotes climbs from the base through the tones and wraps by octaves', () => {
  const dm = parseChord('Dm');
  assert.deepEqual(chordNotes(dm, 57, 6), [57, 62, 65, 69, 74, 77]);
  assert.deepEqual(chordNotes(parseChord('A5'), 57, 5), [57, 64, 69, 76, 81]);
  for (const base of [40, 51, 62]) {
    const notes = chordNotes(parseChord('F'), base, 10);
    assert.equal(notes.length, 10);
    assert.ok(notes[0] >= base && notes[0] < base + 12, 'starts within an octave above the base');
    for (let i = 1; i < notes.length; i++) assert.ok(notes[i] > notes[i - 1], 'ascending');
    for (const n of notes) assert.equal(isChordTone(parseChord('F'), n), true);
  }
});

test('voiceChord: compact, in range, every chord tone present, no doubled unison', () => {
  const opts = [{ lo: 48, hi: 74 }, { lo: 45, hi: 69 }, { lo: 55, hi: 79, voices: 3 }, { lo: 48, hi: 74, voices: 4 }];
  for (const name of ['D', 'Dm', 'A5', 'Dsus2', 'Esus4', 'Bb', 'Gm', 'F', 'C', 'Em', 'Bm']) {
    const chord = parseChord(name);
    for (const o of opts) {
      const v = voiceChord(chord, null, o);
      const voices = o.voices || 4;
      assert.equal(v.length, Math.min(voices, 4), `${name} voice count`);
      for (let i = 0; i < v.length; i++) {
        assert.ok(v[i] >= o.lo && v[i] <= o.hi, `${name} in range`);
        assert.equal(isChordTone(chord, v[i]), true, `${name} tone ${v[i]}`);
        if (i) assert.ok(v[i] > v[i - 1], `${name} ascending and distinct`);
      }
      assert.ok(v[v.length - 1] - v[0] <= (chord.pcs.length < 3 ? 19 : 16), `${name} compact (a power chord in four voices is open: 17 or 19)`);
      for (const pc of chord.pcs.slice(0, v.length)) assert.ok(v.some((n) => mod12(n) === pc), `${name} has pitch class ${pc}`);
    }
  }
});

test('voiceChord leads smoothly: a chord to the next moves each voice only a little', () => {
  for (const theme of themes) {
    for (const prog of [...theme.progs.calm, ...theme.progs.tense]) {
      let prev = null;
      let worst = 0;
      for (let rep = 0; rep < 2; rep++) {
        for (const name of prog) {
          const v = voiceChord(parseChord(name), prev, { lo: theme.padRange ? theme.padRange[0] : 48, hi: theme.padRange ? theme.padRange[1] : 74, voices: theme.padVoices || 4 });
          if (prev) for (let i = 0; i < v.length; i++) worst = Math.max(worst, Math.abs(v[i] - prev[Math.min(i, prev.length - 1)]));
          prev = v;
        }
      }
      assert.ok(worst <= 9, `${theme.id} ${prog.join(' ')}: a voice jumped ${worst} semitones`);
    }
  }
});

test('snapToChord lands on the nearest chord tone, ties go up', () => {
  const dm = parseChord('Dm');
  for (let m = 40; m <= 90; m++) {
    const s = snapToChord(dm, m);
    assert.equal(isChordTone(dm, s), true);
    assert.ok(Math.abs(s - m) <= 3, `${m} → ${s}`);
  }
  assert.equal(snapToChord(dm, 63), 62, 'Eb is a half step above D');
  assert.equal(snapToChord(dm, 64), 65, 'E is a half step below F');
  assert.equal(snapToChord(parseChord('D'), 64), 66, 'E is two from D and two from F#: a tie goes up');
});

test('isBeatStep marks the four beats of both bar grids', () => {
  assert.deepEqual([...Array(16).keys()].filter((s) => isBeatStep(s, 16)), [0, 4, 8, 12]);
  assert.deepEqual([...Array(12).keys()].filter((s) => isBeatStep(s, 12)), [0, 3, 6, 9]);
});

test('buildPhrase: four bars of in-range melody that rests on chord tones and closes on the root or fifth', () => {
  for (const theme of themes) {
    const [lo, hi] = theme.leadRange || [theme.leadBase - 5, theme.leadBase + 24];
    const beat = theme.steps / 4;
    for (const mode of ['calm', 'tense']) {
      for (const prog of theme.progs[mode]) {
        const chords = prog.map(parseChord);
        for (let seed = 1; seed <= 12; seed++) {
          const notes = buildPhrase(theme, chords, new RNG(seed));
          assert.ok(notes.length >= 4, `${theme.id}: a phrase has notes`);
          let prevEnd = 0;
          for (const n of notes) {
            const where = `${theme.id} ${prog.join(' ')} seed ${seed} at ${n.at}`;
            assert.ok(Number.isInteger(n.at) && n.at >= prevEnd, `${where}: ordered and not overlapping`);
            assert.ok(n.len >= 1, `${where}: has length`);
            prevEnd = n.at + n.len;
            assert.ok(Number.isInteger(n.midi), `${where}: whole semitone`);
            assert.ok(n.midi >= lo && n.midi <= hi, `${where}: ${n.midi} outside ${lo}..${hi}`);
            const chord = chords[Math.min(3, Math.floor(n.at / theme.steps))];
            if (n.at % theme.steps % beat === 0 && n !== notes[notes.length - 1]) assert.equal(isChordTone(chord, n.midi), true, `${where}: a strong beat on ${n.midi} over ${chord.name}`);
          }
          assert.ok(prevEnd <= 4 * theme.steps, `${theme.id}: the phrase fits four bars`);
          const last = notes[notes.length - 1];
          const goal = chords[3];
          assert.ok([goal.pcs[0], goal.pcs[2] ?? goal.pcs[0]].includes(mod12(last.midi)), `${theme.id} ${prog.join(' ')}: closes on ${last.midi}`);
        }
      }
    }
  }
});

test('buildPhrase is deterministic for a seed and varies across seeds', () => {
  const theme = THEMES.greek;
  const chords = theme.progs.calm[0].map(parseChord);
  const a = JSON.stringify(buildPhrase(theme, chords, new RNG(7)));
  assert.equal(JSON.stringify(buildPhrase(theme, chords, new RNG(7))), a);
  const variants = new Set();
  for (let s = 1; s <= 30; s++) variants.add(JSON.stringify(buildPhrase(theme, chords, new RNG(s))));
  assert.ok(variants.size >= 4, `only ${variants.size} different phrases in 30 seeds`);
});

test('wanderBar: sparse in-range notes that stay inside the bar, silent at zero density', () => {
  for (const theme of themes) {
    const [lo, hi] = theme.leadRange || [theme.leadBase - 5, theme.leadBase + 24];
    const chord = parseChord(theme.progs.calm[0][0]);
    const rng = new RNG(3);
    let prev = null;
    let total = 0;
    for (let bar = 0; bar < 40; bar++) {
      const notes = wanderBar(theme, chord, prev, rng, 0.8);
      for (const n of notes) {
        assert.ok(n.midi >= lo && n.midi <= hi, `${theme.id}: ${n.midi} in range`);
        assert.ok(n.at >= 0 && n.len >= 1 && n.at + n.len <= theme.steps, `${theme.id}: inside the bar (${n.at}+${n.len})`);
        assert.ok(Number.isInteger(n.midi));
        if (prev !== null) assert.ok(Math.abs(n.midi - prev) <= 10, `${theme.id}: a drift, not a leap (${prev} → ${n.midi})`);
        prev = n.midi;
        total++;
      }
    }
    assert.ok(total >= 15, `${theme.id}: wandered only ${total} notes in 40 bars`);
    assert.deepEqual(wanderBar(theme, chord, null, new RNG(1), 0), []);
  }
});
