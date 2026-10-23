// The heads of the gods and creatures that are not human: a skull with a snout or a beak, eyes and
// ears, on the humanoid's head bone. addHeadAndNeck (rich-body.js) builds one of these in place of
// the human face; the neck, the hands and the outfit's headgear are the same for every head.
// Everything is modeled facing +X; X(x) and Y(y) place a point relative to the head's middle, in
// units of the head scale.
import { shadeC, mixC, withMat } from './unit-geo.js';
import { vs, ps } from './rich-kit.js';
import { clamp, lerp, mul } from './rich-paint.js';

/** The head kinds built here (richSupported lets a unit with one of them through). */
export const BEAST_HEADS = new Set(['jackal', 'falcon', 'monkey']);

const INK = withMat('#16120f', 'gloss');
const AMBER = withMat('#e6b24a', 'gloss');
const EMBER = withMat('#e2542a', 'gloss');

/** The half width of a skull (its stations, from vs) at a point (x, y): where a feature on the side of the head rests. */
function skullZ(st, x, y) {
  let i = 0;
  while (i < st.length - 2 && y > st[i + 1].c[1]) i++;
  const a = st[i];
  const b = st[i + 1];
  const t = clamp((y - a.c[1]) / (b.c[1] - a.c[1] || 1e-9));
  const rx = lerp(a.rx, b.rx, t);
  return lerp(a.rz, b.rz, t) * Math.sqrt(Math.max(0, 1 - ((x - lerp(a.c[0], b.c[0], t)) / rx) ** 2));
}

/**
 * Both eyes of a side-eyed head, resting on the skull's surface: a lens of `color` with a dark pupil
 * in a dark ring, at forward position x and height y (head scales), standing a little proud of the skull.
 */
function sideEyes(kit, D, bind, skull, X, Y, x, y, { color, pupil = INK, w = 0.02, h = 0.012, glow = 0, ring = 1.4 }) {
  const hs = D.hs;
  const z = skullZ(skull, X(x), Y(y)) / hs - 0.001;
  for (const side of [1, -1]) {
    // the ring round the eye, a little under the lens
    kit.loft([ps(X(x), Y(y), side * (z - 0.014) * hs, h * ring * hs, w * ring * hs), ps(X(x), Y(y), side * (z + 0.0008) * hs, h * ring * hs, w * ring * hs)],
      { ref: [0, 1, 0], sides: 12, start: null, end: 'round', capDepth: 0.003 * hs, color: INK, mat: 'gloss', bind: bind.head });
    kit.loft([ps(X(x), Y(y), side * (z - 0.014) * hs, h * hs, w * hs), ps(X(x + 0.001), Y(y), side * z * hs, h * hs, w * hs), ps(X(x + 0.002), Y(y), side * (z + 0.0045) * hs, h * 0.72 * hs, w * 0.74 * hs)],
      { ref: [0, 1, 0], sides: 10, start: null, end: 'round', capDepth: 0.005 * hs, color, mat: 'gloss', glow, bind: bind.head });
    kit.loft([ps(X(x + 0.003), Y(y), side * (z + 0.002) * hs, h * 0.5 * hs, w * 0.42 * hs), ps(X(x + 0.0035), Y(y), side * (z + 0.0065) * hs, h * 0.44 * hs, w * 0.38 * hs)],
      { ref: [0, 1, 0], sides: 8, start: 'round', end: 'round', capDepth: 0.002 * hs, color: pupil, mat: 'gloss', bind: bind.head });
  }
}

/** The jackal: a long fine muzzle, a black nose, tall pointed ears (Set's snout is curved and its ears squared). */
function jackal(kit, D, pal, bind, skinPaint, set) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const X = (x) => hx + x * hs;
  const Y = (y) => hy + y * hs;
  const fur = pal.skin;
  const pale = set ? shadeC(fur, 0.8) : mixC(fur, '#4a4036', 0.4);
  // the skull and cheeks
  const skull = [
    vs(Y(-0.1), 0.042 * hs, 0.036 * hs, X(0.03)),
    vs(Y(-0.075), 0.066 * hs, 0.056 * hs, X(0.02)),
    vs(Y(-0.04), 0.085 * hs, 0.07 * hs, X(0.005)),
    vs(Y(0.0), 0.09 * hs, 0.076 * hs, X(-0.002)),
    vs(Y(0.04), 0.086 * hs, 0.074 * hs, X(-0.006)),
    vs(Y(0.075), 0.07 * hs, 0.062 * hs, X(-0.01)),
    vs(Y(0.1), 0.045 * hs, 0.04 * hs, X(-0.012)),
    vs(Y(0.11), 0.02 * hs, 0.02 * hs, X(-0.012)),
  ];
  kit.loft(skull, { rings: 11, capDepth: [0.012 * hs, 0.012 * hs], color: fur, bind: bind.head, paint: skinPaint });
  // the muzzle: broad at the brow, narrowing to the nose (a gently curved snout for Set)
  const my = set ? [-0.01, -0.016, -0.03, -0.054] : [-0.012, -0.02, -0.03, -0.04];
  const mx = set ? [0.055, 0.115, 0.185, 0.245] : [0.055, 0.115, 0.18, 0.235];
  kit.loft([
    ps(X(mx[0]), Y(my[0]), 0, 0.046 * hs, 0.05 * hs),
    ps(X(mx[1]), Y(my[1]), 0, 0.036 * hs, 0.04 * hs),
    ps(X(mx[2]), Y(my[2]), 0, 0.028 * hs, 0.03 * hs),
    ps(X(mx[3]), Y(my[3]), 0, 0.021 * hs, 0.022 * hs),
  ], {
    ref: [0, 1, 0], rings: 6, sides: 12, start: null, end: 'round', capDepth: 0.012 * hs, color: fur, bind: bind.head,
    // the lip line along the underside, the top lighter
    paint: (o, x, y, z, u, a) => { const k = Math.max(0, 1 - Math.abs(a - 0.5) * 9); mul(o, 1 - 0.5 * k); },
  });
  // the lower jaw, a shade lighter, closed under it
  kit.loft([
    ps(X(0.04), Y(-0.062), 0, 0.022 * hs, 0.036 * hs),
    ps(X(0.105), Y(my[1] - 0.04), 0, 0.016 * hs, 0.028 * hs),
    ps(X(0.165), Y(my[2] - 0.03), 0, 0.011 * hs, 0.02 * hs),
    ps(X(0.215), Y(my[3] - 0.012), 0, 0.007 * hs, 0.012 * hs),
  ], { ref: [0, 1, 0], rings: 5, sides: 10, start: null, end: 'round', capDepth: 0.008 * hs, color: pale, bind: bind.head });
  // the nose
  kit.loft([ps(X(mx[3] - 0.012), Y(my[3] + 0.001), 0, 0.018 * hs, 0.022 * hs), ps(X(mx[3] + 0.014), Y(my[3] - 0.004), 0, 0.016 * hs, 0.02 * hs)],
    { ref: [0, 1, 0], sides: 10, start: null, end: 'round', capDepth: 0.008 * hs, color: INK, mat: 'gloss', bind: bind.head });
  // the ears: tall, set well apart so a crown can stand between them, the inner ear in the accent color
  for (const side of [1, -1]) {
    const z = side * (set ? 0.06 : 0.054) * hs;
    const top = set ? 0.235 : 0.245;
    const ear = [
      vs(Y(0.06), 0.026 * hs, 0.03 * hs, X(-0.02), z),
      vs(Y(0.115), 0.02 * hs, 0.028 * hs, X(-0.032), z * 1.1),
      vs(Y(0.17), 0.013 * hs, set ? 0.027 * hs : 0.019 * hs, X(-0.044), z * 1.2),
      vs(Y(top), set ? 0.009 * hs : 0.004 * hs, set ? 0.026 * hs : 0.006 * hs, X(-0.056), z * 1.26),
    ];
    kit.loft(ear, { rings: 7, sides: 8, start: null, end: set ? 'flat' : 'round', capDepth: 0.006 * hs, color: fur, bind: bind.head });
    const inner = ear.map((s, i) => ({ ...s, c: [s.c[0] + (0.01 + 0.003 * i) * hs, s.c[1], s.c[2]], rx: s.rx * 0.55, rz: s.rz * 0.62 }));
    kit.loft(inner.slice(0, 3), { rings: 5, sides: 8, start: null, end: null, color: set ? INK : pal.accent, bind: bind.head });
  }
  sideEyes(kit, D, bind, skull, X, Y, 0.064, 0.022, { color: set ? EMBER : AMBER, w: 0.02, h: 0.0115, glow: set ? 0.35 : 0 });
  // eye paint: a dark line sweeping back from each eye over the temple
  for (const side of [1, -1]) {
    const zAt = (x) => skullZ(skull, X(x), Y(0.028)) + 0.0018 * hs;
    kit.loft([0.074, 0.04, 0.008, -0.03].map((x) => ps(X(x), Y(0.026 + (0.074 - x) * 0.04), side * zAt(x), 0.0032 * hs, 0.004 * hs)),
      { ref: [0, 1, 0], sides: 6, start: 'round', end: 'round', capDepth: 0.004 * hs, color: INK, mat: 'gloss', bind: bind.head });
  }
}

/** The falcon: a round head, a hooked beak on a yellow cere, big round eyes ringed in black, a dark cap and a pale throat. */
function falcon(kit, D, pal, bind, skinPaint, glowEyes) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const X = (x) => hx + x * hs;
  const Y = (y) => hy + y * hs;
  const plume = pal.skin;
  const beakColor = shadeC(pal.beak, 0.8);
  const cere = withMat('#e6c040', 'bone');
  // the head, dark over the crown, pale at the throat
  const skull = [
    vs(Y(-0.1), 0.044 * hs, 0.04 * hs, X(0.03)),
    vs(Y(-0.078), 0.07 * hs, 0.062 * hs, X(0.018)),
    vs(Y(-0.04), 0.09 * hs, 0.08 * hs, X(0.004)),
    vs(Y(0.0), 0.098 * hs, 0.086 * hs, X(-0.002)),
    vs(Y(0.04), 0.096 * hs, 0.085 * hs, X(-0.005)),
    vs(Y(0.078), 0.082 * hs, 0.074 * hs, X(-0.008)),
    vs(Y(0.104), 0.054 * hs, 0.05 * hs, X(-0.012)),
    vs(Y(0.114), 0.024 * hs, 0.024 * hs, X(-0.014)),
  ];
  kit.loft(skull, {
    rings: 12, capDepth: [0.012 * hs, 0.012 * hs], color: plume, bind: bind.head,
    paint: skinPaint || ((o, x, y, z, u, a) => {
      // a darker cap over the crown and nape, a paler throat
      const cap = Math.max(0, Math.min(1, (y - Y(0.012)) / (0.05 * hs)));
      const front = Math.max(0, Math.cos(a * Math.PI * 2));
      const throat = (1 - u) * 0.9 * front;
      mul(o, 1 - 0.5 * cap + 0.35 * throat);
    }),
  });
  // the beak: the upper mandible curving down to a hooked tip, the lower one tucked under it
  kit.loft([
    ps(X(0.05), Y(0.0), 0, 0.045 * hs, 0.04 * hs),
    ps(X(0.105), Y(-0.008), 0, 0.04 * hs, 0.034 * hs),
    ps(X(0.155), Y(-0.026), 0, 0.03 * hs, 0.024 * hs),
    ps(X(0.19), Y(-0.058), 0, 0.017 * hs, 0.013 * hs),
    ps(X(0.196), Y(-0.095), 0, 0.006 * hs, 0.005 * hs),
  ], {
    ref: [0, 1, 0], rings: 9, sides: 10, start: null, end: 'round', capDepth: 0.004 * hs, color: beakColor, mat: 'bone', bind: bind.head,
    // the cere at the root, the hook darker
    paint: (o, x, y, z, u) => {
      if (u < 0.22) { o.r = cere.r; o.g = cere.g; o.b = cere.b; } else mul(o, 1 - 0.3 * clamp((u - 0.6) / 0.4));
    },
  });
  kit.loft([
    ps(X(0.06), Y(-0.056), 0, 0.016 * hs, 0.028 * hs),
    ps(X(0.12), Y(-0.062), 0, 0.012 * hs, 0.02 * hs),
    ps(X(0.165), Y(-0.07), 0, 0.007 * hs, 0.012 * hs),
  ], { ref: [0, 1, 0], rings: 4, sides: 8, start: null, end: 'round', capDepth: 0.006 * hs, color: shadeC(beakColor, 0.85), mat: 'bone', bind: bind.head });
  const eyeColor = glowEyes ? pal.eyeGlow : AMBER;
  sideEyes(kit, D, bind, skull, X, Y, 0.04, 0.03, { color: eyeColor, w: 0.021, h: 0.021, glow: glowEyes ? 1 : 0, ring: 1.32 });
  // the markings: a dark stripe falling from each eye to the beak, a heavy brow over it
  for (const side of [1, -1]) {
    const zAt = (x, y) => skullZ(skull, X(x), Y(y)) + 0.002 * hs;
    kit.loft([[0.044, 0.006], [0.056, -0.026], [0.066, -0.06]].map(([x, y]) => ps(X(x), Y(y), side * zAt(x, y), 0.0045 * hs, 0.0055 * hs)),
      { ref: [1, 0, 0], sides: 6, start: 'round', end: 'round', capDepth: 0.004 * hs, color: INK, mat: 'gloss', bind: bind.head });
    kit.loft([[0.07, 0.056], [0.04, 0.062], [0.005, 0.058]].map(([x, y]) => ps(X(x), Y(y), side * zAt(x, y), 0.005 * hs, 0.006 * hs)),
      { ref: [0, 1, 0], sides: 6, start: 'round', end: 'round', capDepth: 0.004 * hs, color: shadeC(plume, 0.62), bind: bind.head });
  }
}

/**
 * The monkey (Hanuman's): a round fur skull, a pale bare face with a short broad muzzle and forward
 * eyes under a heavy brow, round ears at the sides, tufts of fur at the cheeks and over the crown.
 */
function monkey(kit, D, pal, bind, skinPaint, glowEyes) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const X = (x) => hx + x * hs;
  const Y = (y) => hy + y * hs;
  const fur = pal.skin;
  const face = mixC(fur, '#f2cfa8', 0.6);
  const lip = mixC(face, '#b0584c', 0.45);
  const brow = shadeC(fur, 0.62);
  const skull = [
    vs(Y(-0.1), 0.05 * hs, 0.045 * hs, X(0.025)),
    vs(Y(-0.078), 0.075 * hs, 0.067 * hs, X(0.014)),
    vs(Y(-0.04), 0.094 * hs, 0.083 * hs, X(0.003)),
    vs(Y(0.0), 0.102 * hs, 0.091 * hs, X(-0.002)),
    vs(Y(0.04), 0.103 * hs, 0.091 * hs, X(-0.004)),
    vs(Y(0.076), 0.091 * hs, 0.082 * hs, X(-0.006)),
    vs(Y(0.104), 0.062 * hs, 0.058 * hs, X(-0.008)),
    vs(Y(0.115), 0.028 * hs, 0.028 * hs, X(-0.009)),
  ];
  kit.loft(skull, {
    rings: 12, capDepth: [0.012 * hs, 0.012 * hs], color: fur, bind: bind.head,
    // fur streaks, darker over the crown
    paint: skinPaint || ((o, x, y, z) => mul(o, 0.9 + 0.2 * Math.abs(Math.sin(z * 90 + y * 17)) - 0.16 * clamp((y - Y(0.05)) / (0.07 * hs)))),
  });
  // the bare face: a flat oval mask just proud of the front of the skull
  kit.loft([
    ps(X(0.04), Y(-0.012), 0, 0.076 * hs, 0.068 * hs),
    ps(X(0.08), Y(-0.014), 0, 0.072 * hs, 0.064 * hs),
    ps(X(0.098), Y(-0.016), 0, 0.054 * hs, 0.05 * hs),
  ], { ref: [0, 1, 0], rings: 4, sides: 14, start: null, end: 'round', capRings: 2, capDepth: 0.006 * hs, color: face, bind: bind.head });
  // the muzzle, short and broad, the lips a shade darker
  kit.loft([
    ps(X(0.07), Y(-0.036), 0, 0.037 * hs, 0.048 * hs),
    ps(X(0.108), Y(-0.04), 0, 0.034 * hs, 0.043 * hs),
    ps(X(0.136), Y(-0.044), 0, 0.027 * hs, 0.036 * hs),
  ], { ref: [0, 1, 0], rings: 3, sides: 12, start: null, end: 'round', capRings: 2, capDepth: 0.012 * hs, color: face, bind: bind.head });
  kit.loft([
    ps(X(0.083), Y(-0.062), 0, 0.016 * hs, 0.036 * hs),
    ps(X(0.113), Y(-0.062), 0, 0.014 * hs, 0.032 * hs),
    ps(X(0.13), Y(-0.06), 0, 0.011 * hs, 0.026 * hs),
  ], { ref: [0, 1, 0], rings: 3, sides: 10, start: null, end: 'round', capRings: 2, capDepth: 0.008 * hs, color: lip, bind: bind.head });
  // a dark line for the mouth, two nostrils
  kit.loft([-0.03, -0.012, 0.012, 0.03].map((z) => ps(X(0.127 - Math.abs(z) * 0.2), Y(-0.052), z * hs, 0.0026 * hs, 0.003 * hs)),
    { ref: [1, 0, 0], rings: 4, sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.003 * hs, color: INK, mat: 'gloss', bind: bind.head });
  for (const side of [1, -1]) {
    kit.loft([ps(X(0.136), Y(-0.034), side * 0.011 * hs, 0.0065 * hs, 0.005 * hs), ps(X(0.143), Y(-0.034), side * 0.011 * hs, 0.0055 * hs, 0.0045 * hs)],
      { ref: [0, 1, 0], sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.004 * hs, color: INK, mat: 'gloss', bind: bind.head });
  }
  // the brow ridge, a heavy bar of dark fur over the eyes, and the eyes under it
  kit.loft([-0.074, -0.037, 0, 0.037, 0.074].map((z) => ps(X(0.094 - 0.075 * Math.abs(z / 0.074) ** 2 * 1.1), Y(0.04 + 0.004 * Math.cos(z * 18)), z * hs, 0.0105 * hs, 0.0125 * hs)),
    { ref: [1, 0, 0], rings: 6, sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: 0.008 * hs, color: brow, bind: bind.head });
  const eye = glowEyes ? pal.eyeGlow : withMat('#3a2418', 'gloss');
  for (const side of [1, -1]) {
    const z = side * 0.034 * hs;
    // the lens, a ring of amber round the dark pupil
    kit.loft([ps(X(0.088), Y(0.014), z, 0.0135 * hs, 0.0155 * hs), ps(X(0.103), Y(0.014), z, 0.0125 * hs, 0.0145 * hs)],
      { ref: [0, 1, 0], sides: 8, start: null, end: 'round', capRings: 2, capDepth: 0.005 * hs, color: AMBER, mat: 'gloss', glow: glowEyes ? 1 : 0, bind: bind.head });
    kit.loft([ps(X(0.102), Y(0.014), z, 0.0075 * hs, 0.0085 * hs), ps(X(0.1085), Y(0.014), z, 0.0068 * hs, 0.0078 * hs)],
      { ref: [0, 1, 0], sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: 0.003 * hs, color: eye, mat: 'gloss', bind: bind.head });
  }
  // the ears: round, standing out at the sides, the inner ear bare
  for (const side of [1, -1]) {
    kit.loft([ps(X(-0.004), Y(0.014), side * 0.088 * hs, 0.036 * hs, 0.032 * hs), ps(X(-0.004), Y(0.014), side * 0.101 * hs, 0.034 * hs, 0.03 * hs), ps(X(-0.004), Y(0.014), side * 0.108 * hs, 0.026 * hs, 0.022 * hs)],
      { ref: [0, 1, 0], rings: 4, sides: 10, start: null, end: 'round', capRings: 2, capDepth: 0.006 * hs, color: fur, bind: bind.head });
    kit.loft([ps(X(0.0), Y(0.014), side * 0.099 * hs, 0.026 * hs, 0.022 * hs), ps(X(0.0), Y(0.014), side * 0.107 * hs, 0.02 * hs, 0.017 * hs)],
      { ref: [0, 1, 0], sides: 8, start: null, end: 'round', capRings: 1, capDepth: 0.004 * hs, color: face, bind: bind.head });
  }
  // a ruff of pale fur framing the face, from ear to ear under the chin
  const ruff = [];
  for (let i = 0; i <= 7; i++) {
    const t = i / 7 * 2 - 1;
    const k = 1 - Math.abs(t) ** 1.6;
    ruff.push(ps(X(-0.012 + 0.07 * k), Y(-0.012 - 0.066 * k), t * 0.093 * hs, (0.02 + 0.006 * k) * hs, (0.02 + 0.006 * k) * hs));
  }
  kit.loft(ruff, { ref: [0, 1, 0], rings: 8, sides: 6, start: 'round', end: 'round', capRings: 2, capDepth: 0.014 * hs, color: mixC(fur, '#f6e2bc', 0.5), bind: bind.head,
    paint: (o, x, y, z) => mul(o, 0.9 + 0.2 * Math.abs(Math.sin(z * 120 + y * 23))) });
}

/**
 * The head and face of a unit whose head is not human (BEAST_HEADS). The unit's palette skin is the
 * fur or plumage; Set (an id ending in _set) gets his own jackal.
 */
export function addBeastHead(kit, D, pal, ctx, bind, skinPaint = null) {
  const kind = ctx.v.head;
  if (kind === 'falcon') falcon(kit, D, pal, bind, skinPaint, ctx.ex.has('eye_glow') && !!pal.eyeGlow);
  else if (kind === 'monkey') monkey(kit, D, pal, bind, skinPaint, ctx.ex.has('eye_glow') && !!pal.eyeGlow);
  else jackal(kit, D, pal, bind, skinPaint, /(^|_)set$/.test(ctx.unit.id));
}
