// Sounds for the alerts, milestones and tips (src/game/alerts.js, src/ui/hud-hints.js), written
// for the synth kit in sfx.js: each recipe has the same shape as the ones there,
// `(k, t, out, rv, v) → end time`, and sfx.js merges these tables into its own.
//   nudge      two soft notes: a reminder (idle Worshippers, a god you can afford)
//   drums      four war-drum beats: enemies near the base, an ally under attack
//   gong       a bronze gong: the Decade of Peace is about to end
//   research   a bright rising figure: an upgrade finished
//   tip        a soft celesta ting: a gameplay tip appeared
//   milestone  a short fanfare stab with a sparkle: a milestone was reached
//   taunt      two war-drum blows under a snarling brass fifth that bends down: a computer player taunts you

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI note → Hz

/** Per-name rate limits (see LIMITS in sfx.js). These are interface sounds: they bypass the voice cap. */
export const ALERT_LIMITS = {
  nudge: { gap: 1.5, voices: 1, ui: true },
  drums: { gap: 3, voices: 1, ui: true },
  gong: { gap: 4, voices: 1, ui: true },
  research: { gap: 0.8, voices: 1, ui: true },
  tip: { gap: 4, voices: 1, ui: true },
  milestone: { gap: 2, voices: 1, ui: true },
  taunt: { gap: 2, voices: 1, ui: true },
};

/** Overall loudness per sound (see LEVEL in sfx.js). */
export const ALERT_LEVEL = { nudge: 1.0, drums: 1.05, gong: 0.9, research: 1.0, tip: 0.9, milestone: 1.0, taunt: 0.85 };

export const ALERT_RECIPES = {
  nudge(k, t, out, rv) {
    // G and the C above it, a wooden note each: a polite "hey".
    let end = t;
    for (const [n, dt] of [[79, 0], [84, 0.13]]) {
      const s = t + dt;
      k.osc(out, s, { f: NOTE(n), a: 0.004, r: 0.32, peak: 0.2 });
      k.osc(out, s, { type: 'triangle', f: NOTE(n) * 2, a: 0.002, r: 0.12, peak: 0.05 });
      end = Math.max(end, k.osc(rv || out, s, { f: NOTE(n), a: 0.004, r: 0.5, peak: 0.05 }));
    }
    return end;
  },
  drums(k, t, out, rv) {
    // Three even beats and a heavier one after a breath: "they are coming".
    let end = t;
    for (const [dt, f, peak] of [[0, 118, 0.38], [0.17, 118, 0.42], [0.34, 118, 0.46], [0.66, 92, 0.62]]) {
      const s = t + dt;
      const heavy = dt > 0.5;
      k.boom(out, s, f, { peak, r: heavy ? 0.6 : 0.34 });
      k.noise(out, s, { type: 'bandpass', f: 1500, q: 1.2, a: 0.001, r: 0.03, peak: 0.12 }); // the skin's slap
      end = Math.max(end, s + (heavy ? 0.7 : 0.4));
    }
    if (rv) k.boom(rv, t + 0.66, 92, { peak: 0.2, r: 0.8 });
    return end;
  },
  gong(k, t, out, rv) {
    // A low bronze bell with a detuned twin (the slow beating is the shimmer), a body tone and a swell of air.
    const f = 150;
    let end = k.bell(out, t, f, { peak: 0.34, r: 3.4 });
    k.bell(out, t, f * 1.006, { peak: 0.2, r: 3.0 });
    k.osc(out, t, { f: 74, f2: 68, glide: 2, a: 0.01, r: 1.8, peak: 0.34 });
    k.noise(out, t, { type: 'bandpass', f: 2600, q: 0.7, a: 0.35, h: 0.2, r: 2.2, peak: 0.05 });
    if (rv) k.bell(rv, t, f, { peak: 0.16, r: 3.4 });
    end = Math.max(end, t + 3.5);
    return end;
  },
  research(k, t, out, rv) {
    // D, F sharp, A, D: four plucks climbing over a warm low D.
    let end = t;
    [74, 78, 81, 86].forEach((n, i) => {
      const s = t + i * 0.075;
      k.osc(out, s, { type: 'triangle', f: NOTE(n), a: 0.003, r: i === 3 ? 0.55 : 0.22, peak: 0.17 });
      k.osc(out, s, { f: NOTE(n) * 2, a: 0.002, r: 0.12, peak: 0.04 });
      end = Math.max(end, k.osc(rv || out, s, { f: NOTE(n), a: 0.004, r: 0.45, peak: 0.04 }));
    });
    k.osc(out, t, { f: NOTE(50), a: 0.05, h: 0.18, r: 0.4, peak: 0.07 });
    return Math.max(end, t + 0.9);
  },
  tip(k, t, out, rv) {
    // E and A, two octaves up, as struck bells: quiet and short.
    let end = t;
    for (const [n, dt] of [[88, 0], [93, 0.11]]) end = Math.max(end, k.bell(out, t + dt, NOTE(n), { peak: 0.1, r: 0.9 }));
    if (rv) k.bell(rv, t + 0.11, NOTE(93), { peak: 0.05, r: 1.1 });
    return end;
  },
  taunt(k, t, out, rv) {
    // A heavy "DUM-DUM" on the war drum, then low brass on A and E sliding down into the note
    // with a rasp of breath over it, and a last drum blow under its tail: a war cry, not a chime.
    k.boom(out, t, 70, { peak: 0.62, r: 0.42 });
    k.noise(out, t, { type: 'bandpass', f: 1300, q: 1.1, a: 0.001, r: 0.04, peak: 0.16 });
    k.boom(out, t + 0.14, 62, { peak: 0.74, r: 0.6 });
    k.noise(out, t + 0.14, { type: 'bandpass', f: 1100, q: 1.1, a: 0.001, r: 0.05, peak: 0.18 });
    const s = t + 0.16;
    let end = k.brass(out, s, NOTE(45), { a: 0.03, h: 0.32, r: 0.4, peak: 0.16, bright: 1900, dark: 260, bend: 0.06 });
    k.brass(out, s, NOTE(52), { a: 0.03, h: 0.32, r: 0.4, peak: 0.11, bright: 2100, dark: 280, bend: 0.06 });
    k.brass(out, s, NOTE(33), { a: 0.04, h: 0.3, r: 0.45, peak: 0.1, bright: 900, dark: 160 });
    k.noise(out, s, { type: 'bandpass', f: 700, f2: 380, glide: 0.5, q: 2.2, a: 0.02, h: 0.2, r: 0.3, peak: 0.07 }); // the growl
    k.boom(out, t + 0.62, 55, { peak: 0.5, r: 0.55 });
    if (rv) {
      k.boom(rv, t + 0.14, 62, { peak: 0.24, r: 0.9 });
      k.brass(rv, s, NOTE(45), { a: 0.03, h: 0.32, r: 0.6, peak: 0.05, bright: 1600, dark: 260 });
    }
    end = Math.max(end, t + 1.2);
    return end;
  },
  milestone(k, t, out, rv) {
    // A brass "ta-DAA" (G, then C with the G above) and a few bells glittering over the second chord.
    const bus = rv || out;
    k.brass(out, t, NOTE(67), { a: 0.02, h: 0.07, r: 0.15, peak: 0.1, bright: 2600, dark: 500 });
    let end = k.brass(out, t + 0.11, NOTE(72), { a: 0.02, h: 0.22, r: 0.45, peak: 0.12, bright: 3000, dark: 550, vib: 8 });
    k.brass(out, t + 0.11, NOTE(79), { a: 0.02, h: 0.22, r: 0.45, peak: 0.06, bright: 3000, dark: 550 });
    [96, 100, 103].forEach((n, i) => {
      end = Math.max(end, k.bell(bus, t + 0.14 + i * 0.07, NOTE(n), { peak: 0.04, r: 0.7 }));
    });
    k.noise(out, t + 0.11, { type: 'highpass', f: 6000, a: 0.02, r: 0.5, peak: 0.07 });
    return Math.max(end, t + 1.0);
  },
};
