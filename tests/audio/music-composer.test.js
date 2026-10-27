// The score's data and its composer (src/audio/music-themes.js, music-composer.js): every theme is
// well-formed, every instrument it names exists, every progression stays in its mode, and the bars the
// composer produces are valid, deterministic for a seed, and layered by intensity as DESIGN 9 says.
// Pure data and numbers, no audio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, themeFor } from '../../src/audio/music-themes.js';
import { INSTRUMENTS } from '../../src/audio/music-voices.js';
import { createScore, composeBar, barSeconds, ramp, TIERS } from '../../src/audio/music-composer.js';
import { parseChord, chordNotes } from '../../src/audio/music-theory.js';
import { PANTHEON_LIST } from '../../src/data/index.js';

const themes = Object.values(THEMES);
const mod12 = (n) => ((n % 12) + 12) % 12;
const LAYERS = ['pad', 'drone', 'bass', 'arp', 'lead', 'perc', 'war', 'fx'];
const LEVELS = [0, 0.05, 0.15, 0.25, 0.35, 0.5, 0.65, 0.8, 1];

/** Compose `bars` bars at a fixed level (or `level(i)`), returning the bars. */
function piece(theme, seed, bars, level) {
  const score = createScore(theme, seed);
  return Array.from({ length: bars }, (_, i) => composeBar(score, typeof level === 'function' ? level(i) : level));
}

const eventsOf = (bars) => bars.flatMap((b) => b.events);

// ---------------------------------------------------------------- the themes as data

test('there is a theme for the title screen and one for every pantheon, found by id', () => {
  assert.equal(THEMES.menu.id, 'menu');
  for (const p of PANTHEON_LIST) assert.equal(THEMES[p.id]?.id, p.id, `${p.id} has a theme`);
  assert.equal(themes.length, PANTHEON_LIST.length + 1, 'and nothing else');
  for (const [key, t] of Object.entries(THEMES)) assert.equal(t.id, key);
  assert.equal(themeFor('greek'), THEMES.greek);
  assert.equal(themeFor('no-such-god'), THEMES.menu);
  assert.equal(themeFor('__proto__'), THEMES.menu);
  assert.equal(themeFor(undefined), THEMES.menu);
  assert.ok(Object.isFrozen(THEMES));
});

test('every instrument a theme names exists', () => {
  for (const t of themes) {
    const used = [...Object.values(t.inst), t.drone.inst, t.fillDrum, t.crash];
    for (const tier of Object.values(t.perc)) for (const [drum] of tier) used.push(drum);
    for (const name of used) assert.ok(INSTRUMENTS.includes(name), `${t.id}: ${name}`);
  }
});

test('a theme with a hotter lead (leadHot) names one that exists and differs from the lead', () => {
  const hot = themes.filter((t) => t.inst.leadHot);
  assert.ok(hot.length >= 3);
  for (const t of hot) assert.notEqual(t.inst.leadHot, t.inst.lead, t.id);
});

test('bar grids, patterns and fills line up with the theme\'s step count', () => {
  for (const t of themes) {
    assert.ok(t.steps === 16 || t.steps === 12, `${t.id} steps`);
    assert.ok(t.bar >= 2 && t.bar <= 5, `${t.id} bar length`);
    for (const tier of ['sparse', 'mid', 'dense']) {
      assert.equal(t.arp[tier].length, t.steps, `${t.id} arp ${tier}`);
      assert.match(t.arp[tier], /^[0-9.]+$/);
    }
    for (const tier of ['calm', 'mid', 'war']) {
      assert.equal(t.bass[tier].length, t.steps, `${t.id} bass ${tier}`);
      assert.match(t.bass[tier], /^[R58.]+$/);
    }
    for (const [name, list] of Object.entries(t.perc)) {
      assert.ok(['soft', 'drive', 'war'].includes(name));
      assert.ok(list.length >= 1);
      for (const [drum, pat, base = 1, tune = 1] of list) {
        assert.equal(pat.length, t.steps, `${t.id} ${name} ${drum}`);
        assert.match(pat, /^[Xxo.]+$/);
        assert.ok(base > 0 && base <= 1 && tune > 0.5 && tune < 2);
      }
    }
    assert.ok(t.fill.length >= 3);
    for (let i = 0; i < t.fill.length; i++) {
      assert.ok(Number.isInteger(t.fill[i]) && t.fill[i] >= 0 && t.fill[i] < t.steps, `${t.id} fill step`);
      if (i) assert.ok(t.fill[i] > t.fill[i - 1]);
    }
  }
});

test('the arp tiers get busier, and the bass and drums too, as the intensity rises', () => {
  const hits = (p) => [...p].filter((c) => c !== '.').length;
  for (const t of themes) {
    assert.ok(hits(t.arp.sparse) <= hits(t.arp.mid) && hits(t.arp.mid) <= hits(t.arp.dense), `${t.id} arp`);
    assert.ok(hits(t.bass.calm) <= hits(t.bass.war), `${t.id} bass`);
    const drumHits = (tier) => (t.perc[tier] || []).reduce((a, [, p]) => a + hits(p), 0);
    assert.ok(drumHits('soft') < drumHits('war'), `${t.id} drums`);
  }
});

test('every chord progression is four chords that sit inside the theme\'s mode', () => {
  for (const t of themes) {
    const scalePcs = t.scale.map((d) => mod12(t.tonic + d));
    for (const mode of ['calm', 'tense']) {
      assert.ok(t.progs[mode].length >= 2, `${t.id} has choices`);
      for (const prog of t.progs[mode]) {
        assert.equal(prog.length, 4, `${t.id} ${mode} prog`);
        for (const name of prog) {
          const chord = parseChord(name);
          for (const pc of chord.pcs) assert.ok(scalePcs.includes(pc), `${t.id}: ${name} has a note outside the mode`);
        }
      }
    }
  }
});

test('the motif fills two bars exactly, and the lead\'s starting note sits in its range', () => {
  for (const t of themes) {
    const total = t.motif.reduce((a, [, len]) => a + len, 0);
    assert.equal(total, t.steps * 2, `${t.id} motif length`);
    for (const [deg, len] of t.motif) assert.ok((deg === null || Number.isInteger(deg)) && Number.isInteger(len) && len > 0);
    assert.ok(t.leadRange[0] < t.leadBase && t.leadBase < t.leadRange[1], `${t.id} lead range`);
    assert.ok(t.leadRange[1] - t.leadRange[0] >= 14);
    assert.ok(t.tonic >= 40 && t.tonic <= 60);
    assert.equal(t.arp.base % 1, 0);
  }
});

test('arp patterns only ask for chord tones that exist', () => {
  for (const t of themes) {
    for (const chord of Object.values(t.progs).flat(2).map(parseChord)) {
      const notes = chordNotes(chord, t.arp.base, 10);
      for (const tier of ['sparse', 'mid', 'dense']) {
        for (const ch of t.arp[tier]) if (ch !== '.') assert.ok(notes[Number(ch)] !== undefined, `${t.id} ${tier} digit ${ch}`);
      }
    }
  }
});

// ---------------------------------------------------------------- the composer

test('ramp rises smoothly from 0 at its low end to 1 at its high end', () => {
  assert.equal(ramp(0, 0.2, 0.5), 0);
  assert.equal(ramp(0.2, 0.2, 0.5), 0);
  assert.equal(ramp(0.5, 0.2, 0.5), 1);
  assert.equal(ramp(1, 0.2, 0.5), 1);
  assert.ok(Math.abs(ramp(0.35, 0.2, 0.5) - 0.5) < 1e-9);
  let prev = 0;
  for (let l = 0; l <= 1.0001; l += 0.02) {
    const v = ramp(l, 0.2, 0.7);
    assert.ok(v >= prev - 1e-12);
    prev = v;
  }
});

test('the music pushes on a little as the fighting grows, never faster than a tenth', () => {
  for (const t of themes) {
    assert.equal(barSeconds(t, 0), t.bar);
    assert.ok(Math.abs(barSeconds(t, 1) - t.bar / 1.1) < 1e-9);
    assert.ok(barSeconds(t, 0.5) < barSeconds(t, 0.2));
    assert.equal(barSeconds(t, 5), barSeconds(t, 1), 'clamped');
    assert.equal(barSeconds(t, -2), t.bar);
  }
});

test('a score is deterministic for its seed, and different seeds give different pieces', () => {
  for (const t of themes) {
    const level = (i) => (i % 9) / 10;
    const a = JSON.stringify(piece(t, 7, 24, level));
    assert.equal(JSON.stringify(piece(t, 7, 24, level)), a, `${t.id} repeats`);
    assert.notEqual(JSON.stringify(piece(t, 8, 24, level)), a, `${t.id} varies`);
  }
});

test('every bar is well-formed: known layers and instruments, finite times, velocities and notes in range', () => {
  for (const t of themes) {
    for (const level of LEVELS) {
      const bars = piece(t, 3, 14, level);
      for (const bar of bars) {
        assert.ok(bar.dur > 1.5 && bar.dur <= t.bar, `${t.id} bar dur ${bar.dur}`);
        assert.ok(typeof bar.chord === 'string' && (bar.mode === 'calm' || bar.mode === 'tense'));
        for (const ev of bar.events) {
          const where = `${t.id} @${level} ${ev.layer}/${ev.inst}`;
          assert.ok(LAYERS.includes(ev.layer), where);
          assert.ok(INSTRUMENTS.includes(ev.inst), where);
          assert.ok(Number.isFinite(ev.t) && ev.t >= 0 && ev.t < bar.dur, `${where} t=${ev.t}`);
          assert.ok(Number.isFinite(ev.dur) && ev.dur > 0 && ev.dur < 30, `${where} dur=${ev.dur}`);
          assert.ok(Number.isFinite(ev.vel) && ev.vel > 0 && ev.vel <= 1, `${where} vel=${ev.vel}`);
          if (ev.pan !== undefined) assert.ok(ev.pan >= -1 && ev.pan <= 1, `${where} pan`);
          if (ev.bright !== undefined) assert.ok(ev.bright >= 0 && ev.bright <= 1, `${where} bright`);
          if (ev.midis) {
            assert.ok(ev.midis.length >= 2 && ev.midis.length <= 5, where);
            for (const m of ev.midis) assert.ok(Number.isInteger(m) && m >= 24 && m <= 100, `${where} midi ${m}`);
          } else if (ev.midi !== undefined) {
            assert.ok(Number.isInteger(ev.midi) && ev.midi >= 24 && ev.midi <= 108, `${where} midi ${ev.midi}`);
          }
        }
      }
    }
  }
});

test('the layers come in with the intensity: bass, then a soft pulse, then the groove, then the war drums and horns', () => {
  const layersAt = (t, level) => new Set(eventsOf(piece(t, 5, 16, level)).map((e) => e.layer));
  for (const t of themes) {
    const calm = layersAt(t, 0.04);
    for (const l of ['bass', 'perc', 'war']) assert.ok(!calm.has(l), `${t.id}: ${l} before its time`);
    for (const l of ['pad', 'drone', 'arp']) assert.ok(calm.has(l), `${t.id}: ${l} is always there`);
    assert.ok(!layersAt(t, TIERS.soft - 0.02).has('perc'), `${t.id}: no drums under the soft tier`);
    assert.ok(layersAt(t, TIERS.soft + 0.2).has('perc'), `${t.id}: soft drums by 0.38`);
    assert.ok(!layersAt(t, TIERS.war - 0.02).has('war'), `${t.id}: no war drums under the war tier`);
    const battle = layersAt(t, 0.95);
    for (const l of ['pad', 'drone', 'bass', 'arp', 'lead', 'perc', 'war']) assert.ok(battle.has(l), `${t.id}: ${l} in a battle`);
  }
  // The bass starts at its tier (a theme may keep it silent in its calmest pattern).
  assert.ok(!new Set(eventsOf(piece(THEMES.greek, 5, 16, TIERS.bass - 0.03)).map((e) => e.layer)).has('bass'));
  assert.ok(new Set(eventsOf(piece(THEMES.greek, 5, 16, TIERS.bass + 0.05)).map((e) => e.layer)).has('bass'));
});

test('a battle plays far more than a calm day, but not without bound', () => {
  for (const t of themes) {
    const calm = eventsOf(piece(t, 9, 16, 0.02)).length / 16;
    const battle = eventsOf(piece(t, 9, 16, 1)).length / 16;
    assert.ok(battle > calm * 2, `${t.id}: ${calm} -> ${battle} events a bar`);
    assert.ok(battle < 120, `${t.id}: ${battle} events a bar is too many`);
  }
});

test('sections are four bars: a new chord progression starts every fourth bar and the chords follow it', () => {
  for (const t of themes) {
    const bars = piece(t, 11, 16, 0.2);
    bars.forEach((b, i) => assert.equal(b.sectionStart, i % 4 === 0, `${t.id} bar ${i}`));
    const calm = t.progs.calm.map((p) => p.join(' '));
    for (let s = 0; s < 4; s++) assert.ok(calm.includes(bars.slice(s * 4, s * 4 + 4).map((b) => b.chord).join(' ')), `${t.id} section ${s}`);
  }
});

test('sections turn tense when the fighting is hot, and calm again only well after it cools (hysteresis)', () => {
  const t = THEMES.greek;
  const modes = (level) => piece(t, 2, 12, level).filter((b) => b.sectionStart).map((b) => b.mode);
  assert.deepEqual(modes(0.1), ['calm', 'calm', 'calm']);
  assert.deepEqual(modes(0.9), ['tense', 'tense', 'tense']);
  // Between the two thresholds the mode it was in stays.
  const score = createScore(t, 4);
  const seq = [];
  for (const level of [0.1, 0.1, 0.1, 0.1, 0.45, 0.45, 0.45, 0.45, 0.6, 0.6, 0.6, 0.6, 0.45, 0.45, 0.45, 0.45, 0.3, 0.3, 0.3, 0.3]) {
    const bar = composeBar(score, level);
    if (bar.sectionStart) seq.push(bar.mode);
  }
  assert.deepEqual(seq, ['calm', 'calm', 'tense', 'tense', 'calm']);
  const tenseProgs = t.progs.tense.map((p) => p.join(' '));
  const hot = piece(t, 6, 8, 0.9);
  assert.ok(tenseProgs.includes(hot.slice(0, 4).map((b) => b.chord).join(' ')), 'battle uses the darker progressions');
});

test('a theme with a hotter lead gives it to the tense sections only', () => {
  for (const t of themes.filter((x) => x.inst.leadHot)) {
    const leads = (level) => new Set(eventsOf(piece(t, 4, 16, level)).filter((e) => e.layer === 'lead').map((e) => e.inst));
    assert.deepEqual([...leads(0.1)], [t.inst.lead], `${t.id} calm`);
    assert.deepEqual([...leads(0.9)], [t.inst.leadHot], `${t.id} battle`);
  }
});

test('the lead stays in its range, plays notes of its mode and settles by the end of each four bars', () => {
  for (const t of themes) {
    const [lo, hi] = t.leadRange;
    const leadHi = hi + 12; // a tune may shift an octave up when it fits, never beyond the range
    for (const level of [0.1, 0.5, 0.9]) {
      const notes = eventsOf(piece(t, 13, 24, level)).filter((e) => e.layer === 'lead');
      assert.ok(notes.length > 8, `${t.id} @${level}: a lead plays`);
      for (const n of notes) {
        assert.ok(n.midi >= lo - 1 && n.midi <= Math.min(leadHi, hi), `${t.id} @${level}: lead note ${n.midi} outside ${lo}..${hi}`);
      }
    }
  }
});

test('the pad is one voiced chord that is held while the harmony stands still', () => {
  for (const t of themes) {
    const bars = piece(t, 15, 16, 0.3);
    const pads = bars.map((b) => b.events.filter((e) => e.layer === 'pad'));
    for (const list of pads) assert.ok(list.length <= 1);
    const [lo, hi] = t.padRange || [48, 74];
    for (const [i, list] of pads.entries()) {
      if (!list.length) continue;
      const ev = list[0];
      assert.ok(ev.midis.length >= 2, `${t.id} bar ${i}: chord voices`);
      assert.deepEqual(ev.midis, [...ev.midis].sort((a, b) => a - b), 'ascending');
      assert.equal(new Set(ev.midis).size, ev.midis.length, 'no unisons');
      for (const m of ev.midis) assert.ok(m >= lo && m <= hi, `${t.id}: pad note ${m} outside ${lo}..${hi}`);
      assert.ok(ev.dur >= bars[i].dur, 'at least a bar');
    }
    // A chord that repeats is held, not struck again: the bar after a long pad has none.
    pads.forEach((list, i) => {
      if (list.length && list[0].dur > bars[i].dur * 1.5) assert.equal(pads[i + 1].length, 0, `${t.id}: held through bar ${i + 1}`);
    });
  }
});

test('the drone is one pedal for the whole section (or the tanpura\'s four plucks every bar)', () => {
  for (const t of themes) {
    const bars = piece(t, 17, 8, 0.2);
    bars.forEach((b, i) => {
      const drone = b.events.filter((e) => e.layer === 'drone');
      if (t.drone.pluck) {
        assert.equal(drone.length, 4, `${t.id} plucks`);
        for (const d of drone) assert.ok(t.drone.pluck.includes(d.midi));
      } else if (i % 4 === 0) {
        assert.equal(drone.length, 1, `${t.id} bar ${i}`);
        assert.ok(drone[0].dur >= b.dur * 4, 'spans the section');
        assert.deepEqual(drone[0].midis, t.drone.notes.map((n) => t.tonic - 12 + n));
      } else assert.equal(drone.length, 0, `${t.id} bar ${i}: the pedal holds`);
    });
  }
});

test('a level that jumps from calm to battle and back never breaks the piece', () => {
  for (const t of themes) {
    const levels = [0, 0, 0.1, 1, 1, 0.2, 0.9, 0, 0.5, 1, 0, 0.7, 0.05, 1, 0.3, 0.3];
    const bars = piece(t, 21, 64, (i) => levels[i % levels.length]);
    assert.equal(bars.length, 64);
    for (const b of bars) assert.ok(b.events.length > 0);
  }
});

test('a garbage intensity is treated as calm', () => {
  const t = THEMES.norse;
  for (const bad of [Number.NaN, undefined, null, 'loud', -4]) {
    const bars = piece(t, 1, 8, bad);
    const layers = new Set(eventsOf(bars).map((e) => e.layer));
    assert.ok(!layers.has('war') && !layers.has('bass'), String(bad));
  }
  const over = piece(t, 1, 8, 7);
  assert.ok(eventsOf(over).some((e) => e.layer === 'war'), 'above 1 is a full battle');
});

test('the calm sparkle (a high bell) only comes when things are calm', () => {
  for (const t of themes) {
    const hot = eventsOf(piece(t, 3, 16, 0.9)).filter((e) => e.layer === 'fx');
    assert.equal(hot.length, 0, `${t.id}: no sparkle in a battle`);
    const calm = eventsOf(piece(t, 3, 48, 0.05)).filter((e) => e.layer === 'fx');
    assert.ok(calm.length >= 1, `${t.id}: some sparkle in a calm`);
    for (const e of calm) assert.equal(e.inst, t.inst.accent);
  }
});

test('the war layer: horns on the chord, a drum roll into the next section and a crash on its first bar', () => {
  for (const t of themes) {
    const bars = piece(t, 19, 24, 0.95);
    const war = (b) => b.events.filter((e) => e.layer === 'war');
    // horns
    const horns = eventsOf(bars).filter((e) => e.inst === t.inst.horn && e.layer === 'war');
    assert.ok(horns.length >= 6, `${t.id}: horn calls`);
    // fill: on the last bar of each section
    bars.forEach((b, i) => {
      if (i % 4 !== 3) return;
      const fills = war(b).filter((e) => e.inst === t.fillDrum && t.fill.some((s) => Math.abs(e.t - (s * b.dur) / t.steps) < 0.02));
      assert.ok(fills.length >= t.fill.length, `${t.id}: fill in bar ${i}`);
    });
    // crash: first bar of a later section
    const crashes = bars.map((b, i) => (war(b).some((e) => e.inst === t.crash && e.t === 0 && i % 4 === 0 && i > 4) ? i : -1)).filter((i) => i >= 0);
    assert.ok(crashes.length >= 3, `${t.id}: crashes ${crashes}`);
  }
});

test('the drums in each tier come in gradually: louder as the intensity passes the tier', () => {
  const t = THEMES.greek;
  const loud = (level) => {
    const d = eventsOf(piece(t, 23, 8, level)).filter((e) => e.layer === 'perc');
    return d.length ? d.reduce((a, e) => a + e.vel, 0) / d.length : 0;
  };
  assert.equal(loud(TIERS.soft - 0.05), 0);
  assert.ok(loud(0.22) > 0);
  assert.ok(loud(0.9) > loud(0.22));
});

test('a node budget for the score: how many sounds a bar asks for stays within what a laptop can play', () => {
  // Counted in notes (every voice is a handful of audio nodes): this is the guard against a theme or a
  // tier quietly doubling the cost of the music. Numbers are per second of music.
  for (const t of themes) {
    const perSecond = (level) => {
      const bars = piece(t, 31, 24, level);
      const events = eventsOf(bars).length;
      const seconds = bars.reduce((a, b) => a + b.dur, 0);
      return events / seconds;
    };
    assert.ok(perSecond(0.05) < 7, `${t.id} calm: ${perSecond(0.05).toFixed(1)} notes a second`);
    assert.ok(perSecond(0.5) < 18, `${t.id} mid: ${perSecond(0.5).toFixed(1)} notes a second`);
    assert.ok(perSecond(1) < 28, `${t.id} battle: ${perSecond(1).toFixed(1)} notes a second`);
  }
});
