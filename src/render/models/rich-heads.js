// The heads of the gods and creatures that are not human: a skull with a snout or a beak, eyes and
// ears, on the humanoid's head bone. addHeadAndNeck (rich-body.js) builds one of these in place of
// the human face; the neck, the hands and the outfit's headgear are the same for every head.
// Everything is modeled facing +X; X(x) and Y(y) place a point relative to the head's middle, in
// units of the head scale.
import { shadeC, mixC, withMat } from './unit-geo.js';
import { vs, ps } from './rich-kit.js';
import { clamp, lerp, mul } from './rich-paint.js';

/** The head kinds built here (richSupported lets a unit with one of them through). */
export const BEAST_HEADS = new Set(['jackal', 'falcon']);

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
 * The head and face of a unit whose head is not human (BEAST_HEADS). The unit's palette skin is the
 * fur or plumage; Set (an id ending in _set) gets his own jackal.
 */
export function addBeastHead(kit, D, pal, ctx, bind, skinPaint = null) {
  const kind = ctx.v.head;
  if (kind === 'falcon') falcon(kit, D, pal, bind, skinPaint, ctx.ex.has('eye_glow') && !!pal.eyeGlow);
  else jackal(kit, D, pal, bind, skinPaint, /(^|_)set$/.test(ctx.unit.id));
}
