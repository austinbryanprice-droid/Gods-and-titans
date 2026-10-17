// Reusable model parts for the procedural unit models: palettes, heads,
// headgear, hand-held weapons and offhand items. Every function adds pieces to
// a PartBuilder in its current frame.
//
// Head frame: origin = head center, facing +X, head radius = 1 (callers push a
// frame scaled by the real radius). Hand frame: origin = palm center; items are
// modelled along +Y and a mount rotation points them where they belong.
import {
  C, mixC, shadeC, tintC, lumaC, TEAM,
  box, cyl, cone, ico, dodeca, octa, tetra, torus, dome, slab, taper, seg, T, mirrorZ,
} from './unit-geo.js';

const PI = Math.PI;

// Art-direction hair colors for well-known figures (visual.colors.hair wins).
const HAIR = {
  greek_zeus: '#ecebe6', greek_poseidon: '#cfdde0', greek_hades: '#1c1a22', greek_kronos: '#b9b6ae',
  greek_athena: '#5a3a22', norse_odin: '#d0d0cc', norse_thor: '#c2501f', norse_freyja: '#f0c860',
  norse_loki: '#2a2a26', norse_surtr: '#ff7a1a', norse_frost_troll: '#e8f4ff', greek_cyclops: '#4a3424',
  japanese_susanoo: '#1a1a1e', japanese_raijin: '#2a2a2e', japanese_amaterasu: '#1a1414', japanese_inari: '#f4f2ea',
  chinese_guan_yu: '#121214', chinese_pangu: '#3a2a1a', chinese_nuwa: '#1a1416', chinese_chang_e: '#16141c',
  egyptian_isis: '#141018', hindu_shiva: '#2a2030', hindu_vishnu: '#16141c', hindu_durga: '#141014',
  aztec_tezcatlipoca: '#101014', japanese_oni: '#1a1210',
};

/** Color palette for a unit visual (THREE.Colors, linear). */
export function makePalette(unitType) {
  const v = unitType.visual;
  const c = v.colors || {};
  const skin = C(c.skin || '#d8b090');
  const primary = C(c.primary || '#888888');
  const secondary = C(c.secondary || '#444444');
  const accent = C(c.accent || '#ffd84a');
  const hairHex = c.hair || HAIR[unitType.id];
  const hair = hairHex ? C(hairHex) : shadeC(skin, 0.22);
  const glow = v.aura ? C(v.aura) : accent;
  const eyeGlow = v.extras.includes('eye_glow') ? (v.aura ? tintC(v.aura, 0.25) : tintC(accent, 0.2)) : null;
  // second tone for creature backs/manes: primary when it differs, else darker skin
  const dif = Math.abs(lumaC(primary) - lumaC(skin)) + Math.abs(primary.r - skin.r) + Math.abs(primary.b - skin.b);
  const back = dif > 0.06 ? primary : shadeC(skin, 0.6);
  return {
    skin, primary, secondary, accent, hair, glow, eyeGlow, back,
    skinDark: shadeC(skin, 0.7),
    skinLight: tintC(skin, 0.35),
    belly: mixC(skin, tintC(secondary, 0.3), 0.55),
    eye: C('#1b120c'),
    eyeWhite: C('#f2efe6'),
    mouth: C('#4a1a18'),
    white: C('#f4f0e6'),
    bone: C('#e6dcc0'),
    horn: mixC(accent, '#e6dcc0', 0.45),
    beak: C('#e3b240'),
    nose: C('#2a1c1a'),
    metal: C('#b8bec8'),
    darkMetal: C('#4a4c54'),
    wood: C('#7a5230'),
    woodDark: C('#4e3420'),
    leather: C('#6a4528'),
    fire: C('#ff7a1a'),
    fireHot: C('#ffd84a'),
    fur: mixC(tintC(primary, 0.35), '#d9cbb0', 0.55),
  };
}

// ---------------------------------------------------------------------------
// Heads. Each returns an anchor in head units: { top, front, brow, ears } and
// may add a 'jaw' morph (lower jaw opens) when opts.jaw is true.
// ---------------------------------------------------------------------------

function eyes(b, pal, x, y, z, s = 1, color) {
  const g = pal.eyeGlow;
  const geo = box(0.1 * s, 0.17 * s, 0.17 * s);
  T(geo, [x, y, z]);
  b.addSym(geo, g || color || pal.eye, { glow: g ? 1 : 0 });
}

function jawMorph(b, opts, pivot, angle = -0.45) {
  return opts.jaw ? { jaw: b.rotMorphLocal(pivot, [0, 0, 1], angle) } : null;
}

/** Long animal snout from x0 to x1 (upper jaw + lower jaw), returns tip x. */
function snout(b, pal, opts, { x0, x1, y = -0.15, w0, w1, h0, h1, color, under, nose = true, teeth = 0, droop = 0 }) {
  const len = x1 - x0;
  const up = taper(h0 * 0.62, len, w0, h1 / h0, w1 / w0);
  T(up, [x0, y + h0 * 0.12, 0], [0, 0, -PI / 2 - droop]);
  b.add(up, color);
  const lowGeo = taper(h0 * 0.36, len * 0.9, w0 * 0.8, (h1 * 0.6) / (h0 * 0.6), (w1 * 0.8) / (w0 * 0.8));
  T(lowGeo, [x0, y - h0 * 0.32, 0], [0, 0, -PI / 2 - droop]);
  b.add(lowGeo, under || color, { morph: jawMorph(b, opts, [x0, y - h0 * 0.2, 0]) });
  const tipY = y + Math.sin(-droop) * len;
  if (nose) {
    const n = box(0.16, 0.14, Math.max(0.16, w1 * 0.7));
    T(n, [x0 + len * Math.cos(droop) - 0.02, tipY + h1 * 0.3, 0]);
    b.add(n, pal.nose);
  }
  for (let i = 0; i < teeth; i++) {
    const t = cone(0.07, 0.18, 3);
    const tx = x0 + (len * (i + 0.6)) / (teeth + 0.4);
    T(t, [tx, y - h0 * 0.14 - Math.sin(droop) * (tx - x0), (w0 + (w1 - w0) * (i / teeth)) * 0.4], [PI, 0, 0]);
    b.addSym(t, pal.white);
  }
  return x0 + len;
}

function earsPointed(b, color, inner, { x = -0.1, y = 0.75, z = 0.5, h = 0.7, r = 0.25, tilt = 0.25 }) {
  const e = cone(r, h, 4);
  T(e, [x, y + h / 2, z], [tilt, 0, 0]);
  b.addSym(e, color);
  if (inner) {
    const i = cone(r * 0.55, h * 0.7, 3);
    T(i, [x + r * 0.45, y + h * 0.38, z], [tilt, 0, 0]);
    b.addSym(i, inner);
  }
}

/** Human / humanoid face. kind: human | demon | skull. */
function headHuman(b, pal, v, opts, kind) {
  const bone = kind === 'skull';
  const skin = bone ? pal.bone : pal.skin;
  const skull = dodeca(1);
  T(skull, [0, 0, 0], [0, 0, 0], [0.95, 1.0, 0.9]);
  b.add(skull, skin);
  if (bone) {
    const sock = box(0.12, 0.3, 0.3);
    T(sock, [0.82, 0.08, 0.34]);
    b.addSym(sock, pal.eyeGlow || pal.eye, { glow: pal.eyeGlow ? 1 : 0 });
    const jaw = box(0.55, 0.32, 0.8);
    T(jaw, [0.45, -0.72, 0]);
    b.add(jaw, shadeC(pal.bone, 0.85), { morph: jawMorph(b, opts, [0, -0.5, 0]) });
    const teeth = box(0.08, 0.1, 0.6);
    T(teeth, [0.74, -0.5, 0]);
    b.add(teeth, pal.white);
    return { top: 1.0, front: 0.95, brow: 0.35, ears: 0.9, hair: false };
  }
  const singleEye = opts.cyclops;
  if (singleEye) {
    const w = octa(0.42);
    T(w, [0.72, 0.16, 0], [0, 0, 0], [0.6, 1, 1]);
    b.add(w, pal.eyeGlow || pal.eyeWhite, { glow: pal.eyeGlow ? 1 : 0.15 });
    const pupil = box(0.1, 0.28, 0.28);
    T(pupil, [0.96, 0.16, 0]);
    b.add(pupil, pal.eyeGlow ? tintC(pal.eyeGlow, 0.6) : pal.eye, { glow: pal.eyeGlow ? 1 : 0 });
    const brow = box(0.18, 0.12, 0.95);
    T(brow, [0.86, 0.52, 0]);
    b.add(brow, pal.hair);
  } else if (opts.lod === 0 && !pal.eyeGlow) {
    const band = box(0.1, 0.16, 0.78);
    T(band, [0.84, 0.12, 0]);
    b.add(band, pal.eye);
  } else {
    eyes(b, pal, 0.86, 0.12, 0.34);
    const brow = box(0.14, 0.1, 0.32);
    T(brow, [0.87, 0.32, 0.32], [kind === 'demon' ? 0.45 : 0.15, 0, 0]);
    b.addSym(brow, kind === 'demon' ? pal.skinDark : pal.hair);
  }
  const nose = tetra(0.2);
  T(nose, [0.95, -0.08, 0], [0.6, 0.78, 0], [1.1, 1.3, 0.8]);
  b.add(nose, pal.skinDark);
  if (opts.lod !== 0 || kind === 'demon') {
    const ear = kind === 'demon' ? cone(0.18, 0.55, 3) : tetra(0.22);
    T(ear, kind === 'demon' ? [-0.05, 0.25, 0.95] : [-0.05, 0, 0.9], kind === 'demon' ? [1.1, 0, 0] : [0.6, 0, 0.3], kind === 'demon' ? 1 : [0.7, 1.3, 0.6]);
    b.addSym(ear, pal.skin);
  }
  if (kind === 'demon') {
    const mouth = box(0.1, 0.16, 0.6);
    T(mouth, [0.86, -0.45, 0]);
    b.add(mouth, pal.mouth);
    const fang = cone(0.09, 0.32, 3);
    T(fang, [0.9, -0.52, 0.2], [PI, 0, 0]);
    b.addSym(fang, pal.white);
    const tusk = cone(0.08, 0.3, 3);
    T(tusk, [0.88, -0.5, 0.32]);
    b.addSym(tusk, pal.white);
  }
  return { top: 1.0, front: 0.95, brow: 0.35, ears: 0.92, hair: true };
}

/** Hair cap for human heads (skipped when headgear covers the skull). */
export function hairCap(b, pal) {
  const h = dome(1.04, 6, 2);
  T(h, [-0.08, 0.1, 0], [0, 0, 0.2], [1.0, 0.92, 0.96]);
  b.add(h, pal.hair);
}

function headDog(b, pal, v, opts, kind) {
  const fox = kind === 'fox';
  const jackal = kind === 'jackal';
  const fur = pal.skin;
  const skull = dodeca(0.9);
  T(skull, [0, 0, 0], [0, 0, 0], [1, 0.95, jackal ? 0.85 : 1]);
  b.add(skull, fur);
  const light = fox ? tintC(pal.secondary, 0.4) : kind === 'wolf' ? mixC(fur, pal.accent, 0.55) : shadeC(fur, 0.85);
  snout(b, pal, opts, {
    x0: 0.45, x1: jackal ? 1.85 : fox ? 1.65 : 1.6, y: -0.18,
    w0: jackal ? 0.55 : fox ? 0.55 : 0.7, w1: jackal ? 0.28 : fox ? 0.18 : 0.42,
    h0: jackal ? 0.55 : 0.65, h1: jackal ? 0.3 : 0.28, color: fur, under: light, teeth: kind === 'wolf' ? 2 : 0,
  });
  if (fox || kind === 'wolf') {
    const cheek = cone(0.32, 0.55, 4);
    T(cheek, [0.1, -0.35, 0.7], [PI / 2 + 0.4, 0, 0]);
    b.addSym(cheek, fox ? tintC(pal.secondary, 0.5) : light);
  }
  eyes(b, pal, 0.62, 0.22, 0.38, 0.85);
  earsPointed(b, fur, jackal ? pal.accent : fox ? pal.eye : shadeC(fur, 0.6), {
    x: -0.15, y: 0.55, z: jackal ? 0.4 : 0.45, h: jackal ? 1.15 : fox ? 0.85 : 0.65, r: jackal ? 0.22 : fox ? 0.32 : 0.26, tilt: jackal ? 0.12 : 0.3,
  });
  return { top: 0.9, front: 1.6, brow: 0.5, ears: 0.6, hair: false };
}

function headCat(b, pal, v, opts, lion) {
  const fur = pal.skin;
  if (lion) {
    const mane = dodeca(1.5);
    T(mane, [-0.35, 0.05, 0], [0, 0, 0], [0.75, 1.05, 1.2]);
    b.add(mane, pal.back);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2;
      const tuft = cone(0.42, 0.75, 4);
      T(tuft, [-0.45, Math.sin(a) * 1.15, Math.cos(a) * 1.3], [PI / 2 - a, 0, 0]);
      b.add(tuft, shadeC(pal.back, 0.85));
    }
  }
  const skull = dodeca(0.95);
  T(skull, [0, 0, 0], [0, 0, 0], [1, 0.92, 1.02]);
  b.add(skull, fur);
  const muz = box(0.55, 0.5, 0.75);
  T(muz, [0.78, -0.3, 0]);
  b.add(muz, tintC(fur, 0.25), { morph: jawMorph(b, opts, [0.5, -0.5, 0], -0.35) });
  const nose = box(0.18, 0.18, 0.3);
  T(nose, [1.06, -0.12, 0]);
  b.add(nose, pal.nose);
  const fang = cone(0.07, 0.25, 3);
  T(fang, [1.02, -0.6, 0.2], [PI, 0, 0]);
  b.addSym(fang, pal.white);
  eyes(b, pal, 0.8, 0.22, 0.4, 0.9);
  if (!lion) earsPointed(b, fur, pal.skinDark, { x: -0.1, y: 0.6, z: 0.55, h: 0.5, r: 0.28, tilt: 0.35 });
  else {
    const ear = cone(0.22, 0.35, 4);
    T(ear, [0.05, 0.8, 0.6], [0.4, 0, 0]);
    b.addSym(ear, fur);
  }
  return { top: 0.92, front: 1.1, brow: 0.5, ears: 0.8, hair: false };
}

function headMonkey(b, pal) {
  const fur = pal.skin;
  const face = tintC(mixC(fur, '#f0c8a0', 0.55), 0.15);
  const skull = dodeca(0.98);
  T(skull, [0, 0.05, 0]);
  b.add(skull, fur);
  const mask = dodeca(0.72);
  T(mask, [0.45, -0.05, 0], [0, 0, 0], [0.75, 0.95, 1.05]);
  b.add(mask, face);
  const muz = box(0.45, 0.42, 0.65);
  T(muz, [0.92, -0.35, 0]);
  b.add(muz, face);
  const nose = box(0.12, 0.12, 0.3);
  T(nose, [1.15, -0.2, 0]);
  b.add(nose, pal.nose);
  const brow = box(0.22, 0.16, 1.0);
  T(brow, [0.92, 0.32, 0]);
  b.add(brow, shadeC(fur, 0.8));
  eyes(b, pal, 1.0, 0.12, 0.28, 0.9);
  const ear = cyl(0.36, 0.36, 0.12, 6);
  T(ear, [0, 0.05, 1.0], [PI / 2, 0, 0]);
  b.addSym(ear, face);
  return { top: 1.03, front: 1.15, brow: 0.45, ears: 1.0, hair: false };
}

function headBirdlike(b, pal, v, opts, falcon) {
  const feather = pal.skin;
  const skull = dodeca(0.92);
  T(skull, [0, 0.02, 0], [0, 0, 0], [1.05, 1, 0.92]);
  b.add(skull, feather);
  const beakColor = falcon ? shadeC(pal.beak, 0.85) : lumaC(feather) < 0.3 ? C('#3a3a42') : pal.beak;
  if (falcon) {
    const throat = dodeca(0.6);
    T(throat, [0.3, -0.45, 0]);
    b.add(throat, tintC(feather, 0.55));
    // dark crown and nape so the raptor profile reads from above
    const cap = dome(0.97, 6, 2);
    T(cap, [-0.12, 0.12, 0], [0, 0, 0.35], [1.08, 0.95, 0.98]);
    b.add(cap, shadeC(feather, 0.5));
    const beak = cone(0.36, 0.9, 4);
    T(beak, [1.2, -0.08, 0], [0, 0, -PI / 2 - 0.3]);
    b.add(beak, beakColor);
    const hook = cone(0.16, 0.36, 3);
    T(hook, [1.55, -0.38, 0], [0, 0, PI - 0.25]);
    b.add(hook, beakColor);
    const stripe = box(0.12, 0.55, 0.12);
    T(stripe, [0.66, -0.25, 0.48], [0, 0, -0.2]);
    b.addSym(stripe, pal.eye);
    eyes(b, pal, 0.75, 0.2, 0.42, 1.1, pal.eye);
    const ring = box(0.06, 0.3, 0.3);
    T(ring, [0.74, 0.2, 0.43]);
    b.addSym(ring, pal.eyeGlow || pal.beak, { glow: pal.eyeGlow ? 1 : 0 });
  } else {
    const beak = cone(0.3, 1.05, 4);
    T(beak, [1.3, -0.1, 0], [0, 0, -PI / 2 - 0.1]);
    b.add(beak, beakColor, { morph: null });
    eyes(b, pal, 0.68, 0.22, 0.45, 1, pal.eyeGlow ? null : C('#f0d040'));
  }
  return { top: 0.94, front: 1.3, brow: 0.45, ears: 0.8, hair: false };
}

function headBull(b, pal, v, opts, kind) {
  const fur = pal.skin;
  const skull = dodeca(1);
  T(skull, [0, 0, 0], [0, 0, 0], [1, 0.95, 1.08]);
  b.add(skull, fur);
  if (kind === 'boar') {
    const sn = taper(0.75, 1.0, 0.85, 0.8, 0.7);
    T(sn, [0.5, -0.25, 0], [0, 0, -PI / 2 - 0.15]);
    b.add(sn, fur, { morph: jawMorph(b, opts, [0.4, -0.6, 0], -0.3) });
    const disc = cyl(0.32, 0.32, 0.12, 6);
    T(disc, [1.5, -0.4, 0], [0, 0, PI / 2]);
    b.add(disc, mixC(fur, '#d89080', 0.5));
    const tusk = cone(0.1, 0.6, 3);
    T(tusk, [1.2, -0.35, 0.38], [0.2, 0, -0.5]);
    b.addSym(tusk, pal.white);
    for (let i = 0; i < 3; i++) {
      const br = cone(0.18, 0.5, 3);
      T(br, [-0.2 - i * 0.35, 0.85 - i * 0.12, 0], [0, 0, 0.3]);
      b.add(br, shadeC(fur, 0.55));
    }
    earsPointed(b, fur, null, { x: -0.1, y: 0.55, z: 0.6, h: 0.45, r: 0.25, tilt: 0.7 });
    eyes(b, pal, 0.8, 0.2, 0.42, 0.8);
    return { top: 0.95, front: 1.55, brow: 0.5, ears: 0.8, hair: false };
  }
  const muz = box(0.6, 0.6, 0.95);
  T(muz, [0.82, -0.32, 0]);
  b.add(muz, tintC(fur, 0.2), { morph: jawMorph(b, opts, [0.55, -0.6, 0], -0.25) });
  const nos = box(0.1, 0.14, 0.18);
  T(nos, [1.12, -0.22, 0.22]);
  b.addSym(nos, pal.nose);
  eyes(b, pal, 0.78, 0.2, 0.48, 0.9);
  const ear = box(0.18, 0.18, 0.45);
  T(ear, [-0.05, 0.25, 1.05], [0.3, 0, 0]);
  b.addSym(ear, fur);
  if (kind === 'ram') {
    // curled horns: a spiral of segments beside each ear
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const a = PI * 0.55 + i * 0.95;
      const r = 0.75 - i * 0.07;
      pts.push([-0.25 + Math.cos(a) * r, 0.15 + Math.sin(a) * r, 0.85 + i * 0.06]);
    }
    for (let i = 0; i < pts.length - 1; i++) b.addSym(seg(pts[i], pts[i + 1], 0.3 - i * 0.035, 0.27 - i * 0.035, 5), pal.horn);
  } else {
    const h1 = seg([-0.05, 0.55, 0.55], [0.05, 0.75, 1.35], 0.2, 0.15, 5);
    b.addSym(h1, pal.horn);
    const h2 = seg([0.05, 0.75, 1.35], [0.35, 1.35, 1.55], 0.15, 0.0, 5);
    b.addSym(h2, pal.horn);
  }
  return { top: 1.0, front: 1.12, brow: 0.5, ears: 1.0, hair: false };
}

function headHorse(b, pal, v, opts) {
  const fur = pal.skin;
  const skull = dodeca(0.85);
  T(skull, [0, 0.05, 0]);
  b.add(skull, fur);
  snout(b, pal, opts, { x0: 0.35, x1: 1.75, y: -0.15, w0: 0.75, w1: 0.55, h0: 0.75, h1: 0.6, color: fur, under: shadeC(fur, 0.9), droop: 0.55, nose: false });
  const nos = box(0.2, 0.18, 0.5);
  T(nos, [1.45, -0.95, 0]);
  b.add(nos, shadeC(fur, 0.75));
  eyes(b, pal, 0.45, 0.25, 0.46, 0.9);
  earsPointed(b, fur, null, { x: -0.25, y: 0.6, z: 0.35, h: 0.55, r: 0.17, tilt: 0.1 });
  return { top: 0.95, front: 1.6, brow: 0.5, ears: 0.6, hair: false };
}

function headElephant(b, pal, v, opts) {
  const skin = pal.skin;
  const skull = dodeca(1.1);
  T(skull, [0, 0.1, 0], [0, 0, 0], [1, 1.05, 1]);
  b.add(skull, skin);
  const ear = slab([[0, 0.7], [-0.9, 0.5], [-1.0, -0.6], [-0.3, -1.1], [0.1, -0.4]], 0.12);
  T(ear, [-0.1, 0.1, 1.05], [0, 0.35, 0]);
  b.addSym(ear, shadeC(skin, 0.88), { morph: opts.jaw ? { ear: b.rotMorphLocal([-0.1, 0.1, 1.0], [0, 1, 0], 0.5) } : null },
    { morph: opts.jaw ? { ear: b.rotMorphLocal([-0.1, 0.1, -1.0], [0, 1, 0], -0.5) } : null });
  // trunk: chain of tapering segments curving down then forward
  const pts = [[0.85, -0.1, 0], [1.15, -0.65, 0], [1.25, -1.25, 0], [1.2, -1.8, 0], [1.4, -2.2, 0]];
  const trunkMorph = opts.jaw ? { jaw: b.rotMorphLocal([0.85, -0.1, 0], [0, 0, 1], 0.9) } : null;
  for (let i = 0; i < pts.length - 1; i++) b.add(seg(pts[i], pts[i + 1], 0.42 - i * 0.08, 0.36 - i * 0.08, 5, i > 0), skin, { morph: trunkMorph });
  const tusk = seg([0.85, -0.55, 0.42], [1.5, -0.8, 0.55], 0.13, 0.0, 4);
  b.addSym(tusk, pal.white);
  const tusk2 = seg([1.5, -0.8, 0.55], [1.85, -0.45, 0.5], 0.07, 0.0, 4);
  b.addSym(tusk2, pal.white);
  eyes(b, pal, 0.85, 0.3, 0.55, 0.8);
  return { top: 1.25, front: 1.3, brow: 0.6, ears: 1.1, hair: false };
}

function headReptile(b, pal, v, opts, kind) {
  const skin = pal.skin;
  if (kind === 'crocodile') {
    const skull = box(0.9, 0.6, 1.0);
    T(skull, [0, 0.0, 0]);
    b.add(skull, skin);
    snout(b, pal, opts, { x0: 0.4, x1: 2.4, y: -0.1, w0: 0.9, w1: 0.55, h0: 0.55, h1: 0.4, color: skin, under: pal.belly, teeth: 4, nose: false });
    const bump = dodeca(0.2);
    T(bump, [2.2, 0.15, 0.16]);
    b.addSym(bump, shadeC(skin, 0.8));
    const eyeB = dodeca(0.26);
    T(eyeB, [0.15, 0.38, 0.32]);
    b.addSym(eyeB, shadeC(skin, 0.9));
    eyes(b, pal, 0.36, 0.42, 0.34, 0.8, C('#e8d040'));
    return { top: 0.6, front: 2.4, brow: 0.4, ears: 0.5, hair: false };
  }
  if (kind === 'dragon') {
    const skull = dodeca(0.9);
    T(skull, [0, 0.05, 0], [0, 0, 0], [1.05, 0.9, 1]);
    b.add(skull, skin);
    snout(b, pal, opts, { x0: 0.4, x1: 1.9, y: -0.15, w0: 0.8, w1: 0.55, h0: 0.6, h1: 0.42, color: skin, under: pal.belly, teeth: 3, nose: false });
    const nostril = box(0.12, 0.12, 0.14);
    T(nostril, [1.82, 0.12, 0.18]);
    b.addSym(nostril, pal.nose);
    const brow = box(0.5, 0.22, 0.3);
    T(brow, [0.55, 0.42, 0.38], [0.3, 0, -0.2]);
    b.addSym(brow, pal.back);
    eyes(b, pal, 0.75, 0.28, 0.42, 0.9, pal.eyeGlow ? null : C('#ffd040'));
    return { top: 0.85, front: 1.9, brow: 0.55, ears: 0.7, hair: false, dragon: true };
  }
  // serpent
  const skull = taper(0.6, 1.5, 1.05, 0.65, 0.55);
  T(skull, [-0.45, 0.05, 0], [0, 0, -PI / 2]);
  b.add(skull, skin);
  const jaw = taper(0.25, 1.35, 0.9, 0.6, 0.5);
  T(jaw, [-0.4, -0.32, 0], [0, 0, -PI / 2]);
  b.add(jaw, pal.belly, { morph: jawMorph(b, opts, [-0.4, -0.25, 0], -0.6) });
  const browR = box(0.5, 0.16, 0.22);
  T(browR, [0.25, 0.38, 0.35]);
  b.addSym(browR, pal.back);
  eyes(b, pal, 0.4, 0.28, 0.42, 0.9, pal.eyeGlow ? null : C('#f0d040'));
  const fang = cone(0.07, 0.3, 3);
  T(fang, [0.85, -0.3, 0.2], [PI, 0, 0]);
  b.addSym(fang, pal.white);
  const tongue = box(0.5, 0.04, 0.08);
  T(tongue, [1.25, -0.3, 0]);
  b.add(tongue, C('#c0283a'));
  return { top: 0.45, front: 1.1, brow: 0.35, ears: 0.6, hair: false };
}

/**
 * Add a head of `kind` in the current (head) frame. opts: { jaw, cyclops, hood }
 * Returns the anchor used by headgear, or null for 'none'.
 */
export function addHead(b, pal, v, kind, opts = {}) {
  switch (kind) {
    case 'none': return null;
    case 'human': return headHuman(b, pal, v, opts, 'human');
    case 'demon': return headHuman(b, pal, v, opts, 'demon');
    case 'skull': return headHuman(b, pal, v, opts, 'skull');
    case 'jackal': case 'fox': case 'wolf': return headDog(b, pal, v, opts, kind);
    case 'cat': return headCat(b, pal, v, opts, false);
    case 'lion': return headCat(b, pal, v, opts, true);
    case 'monkey': return headMonkey(b, pal, v, opts);
    case 'falcon': return headBirdlike(b, pal, v, opts, true);
    case 'bird': return headBirdlike(b, pal, v, opts, false);
    case 'bull': case 'ram': case 'boar': return headBull(b, pal, v, opts, kind);
    case 'horse': return headHorse(b, pal, v, opts);
    case 'elephant': return headElephant(b, pal, v, opts);
    case 'crocodile': case 'dragon': case 'serpent': return headReptile(b, pal, v, opts, kind);
    default: return headHuman(b, pal, v, opts, 'human');
  }
}

/** Whether a head kind is a muzzled animal head (headgear sits further back). */
export function isAnimalHead(kind) {
  return !['human', 'demon', 'skull', 'none'].includes(kind);
}

// ---------------------------------------------------------------------------
// Headgear (head units). `team` marks whether a team-colored crest/hood is used.
// ---------------------------------------------------------------------------

/** Morph that stretches pieces away from a base point (flame flicker). */
export function flickerMorph(b, base, k = 0.32) {
  const o = b.toRoot(base);
  return { fl: (p, out) => out.set((p.x - o[0]) * k * 0.4, (p.y - o[1]) * k, (p.z - o[2]) * k * 0.4) };
}

function flameTongues(b, pal, n, ring, y0, h, spreadZ = 1) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2;
    const hh = h * (0.7 + 0.3 * ((i * 7) % 3) / 2);
    const g = cone(0.28, hh, 4);
    const x = Math.cos(a) * ring;
    const z = Math.sin(a) * ring * spreadZ;
    T(g, [x, y0 + hh / 2, z], [Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25]);
    b.add(g, i % 2 ? pal.fire : pal.fireHot, { glow: 0.9, morph: flickerMorph(b, [x, y0, z], 0.3 + (i % 3) * 0.08) });
  }
  const core = cone(0.4, h * 1.2, 5);
  T(core, [-0.05, y0 + h * 0.6, 0]);
  b.add(core, pal.fireHot, { glow: 1, morph: flickerMorph(b, [-0.05, y0, 0], 0.25) });
}

/** Add headgear in the head frame given the head anchor. */
export function addHeadgear(b, pal, v, kind, anchor, opts = {}) {
  if (!anchor || kind === 'none') return;
  const top = anchor.top;
  const animal = opts.animal;
  const back = animal ? -0.1 : 0;
  const metal = pal.accent;
  switch (kind) {
    case 'crown': {
      const band = cyl(0.88, 0.82, 0.32, 8, true);
      T(band, [back, top - 0.12, 0]);
      b.add(band, metal);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * PI * 2;
        const pt = cone(0.16, 0.42, 4);
        T(pt, [back + Math.cos(a) * 0.82, top + 0.2, Math.sin(a) * 0.82]);
        b.add(pt, metal);
      }
      const gem = octa(0.17);
      T(gem, [back + 0.86, top - 0.1, 0]);
      b.add(gem, pal.secondary, { glow: 0.5 });
      break;
    }
    case 'laurel': {
      for (let i = 0; i < 12; i++) {
        const a = PI * 0.12 + (i / 11) * PI * 1.76;
        const leaf = octa(0.2);
        T(leaf, [back + Math.cos(a) * 0.9, top - 0.32 + Math.abs(Math.sin(a * 0.5)) * 0.08, Math.sin(a) * 0.9], [0, -a + PI / 2, 0.4], [1.6, 0.5, 0.8]);
        b.add(leaf, i % 2 ? metal : mixC(metal, '#5a9a3a', 0.35), { glow: 0.15 });
      }
      break;
    }
    case 'helmet':
    case 'horned_helmet':
    case 'winged_helmet': {
      const lo = opts.lod === 0;
      const d = dome(1.1, lo ? 6 : 8, lo ? 2 : 3);
      T(d, [back - 0.05, top - 0.75, 0], [0, 0, 0], [1, 0.95, 1]);
      b.add(d, metal);
      const rim = cyl(1.12, 1.14, 0.16, lo ? 6 : 8, true);
      T(rim, [back - 0.05, top - 0.72, 0]);
      b.add(rim, shadeC(metal, 0.7));
      if (lo && !animal) {
        const guard = box(0.12, 0.55, 0.14);
        T(guard, [1.02, top - 0.85, 0]);
        b.add(guard, metal);
      } else if (!animal) {
        const guard = box(0.12, 0.55, 0.14);
        T(guard, [1.02, top - 0.85, 0]);
        b.add(guard, metal);
        const cheek = box(0.4, 0.55, 0.1);
        T(cheek, [0.55, top - 1.15, 0.92]);
        b.addSym(cheek, shadeC(metal, 0.85));
      }
      if (kind === 'helmet') {
        // team-colored crest, readable from the top-down camera
        const crest = slab([[-1.2, 0], [-0.8, 0.55], [0.3, 0.75], [0.9, 0.35], [0.7, 0]], 0.26);
        T(crest, [back, top - 0.05, 0]);
        b.add(crest, opts.crest === false ? pal.secondary : TEAM(1));
      } else if (kind === 'horned_helmet') {
        const a = seg([back, top - 0.3, 0.75], [back + 0.15, top + 0.05, 1.35], 0.22, 0.16, 5);
        b.addSym(a, pal.horn);
        const c2 = seg([back + 0.15, top + 0.05, 1.35], [back + 0.4, top + 0.85, 1.5], 0.16, 0.0, 5);
        b.addSym(c2, pal.horn);
      } else {
        for (let i = 0; i < 3; i++) {
          const f = box(0.85 - i * 0.18, 0.16, 0.06);
          T(f, [back - 0.35, top - 0.15 + i * 0.22, 1.08], [0.15, 0, 0.55 + i * 0.2]);
          b.addSym(f, pal.white);
        }
      }
      break;
    }
    case 'sun_disk': {
      const disk = cyl(1.15, 1.15, 0.2, 12);
      T(disk, [back - 0.25, top + 1.05, 0], [0, 0, PI / 2]);
      b.add(disk, tintC(pal.glow, 0.15), { glow: 1 });
      const rim = torus(1.15, 0.1, 3, 12);
      T(rim, [back - 0.15, top + 1.05, 0], [0, PI / 2, 0]);
      b.add(rim, metal, { glow: 0.4 });
      const ura = seg([back + 0.6, top - 0.05, 0], [back + 0.75, top + 0.5, 0], 0.12, 0.08, 4);
      b.add(ura, metal);
      const hood = cone(0.18, 0.3, 4);
      T(hood, [back + 0.78, top + 0.62, 0]);
      b.add(hood, metal);
      break;
    }
    case 'crescent': {
      const n = 7;
      const r = 1.15;
      const cy = top + 1.0;
      for (let i = 0; i < n; i++) {
        const a0 = PI + 0.35 + (i / n) * (PI - 0.7);
        const a1 = PI + 0.35 + ((i + 1) / n) * (PI - 0.7);
        const th = 0.07 + 0.2 * Math.sin(((i + 0.5) / n) * PI);
        const p0 = [back - 0.45, cy + Math.sin(a0) * r, Math.cos(a0) * r];
        const p1 = [back - 0.45, cy + Math.sin(a1) * r, Math.cos(a1) * r];
        b.add(seg(p0, p1, th, th, 4), tintC(pal.glow, 0.3), { glow: 1 });
      }
      break;
    }
    case 'feathers': {
      const band = cyl(0.92, 0.9, 0.22, 8, true);
      T(band, [back, top - 0.3, 0]);
      b.add(band, pal.secondary);
      const cols = [pal.accent, pal.secondary, pal.primary];
      for (let i = 0; i < 5; i++) {
        const a = (i - 2) * 0.32;
        const f = slab([[0, 0], [0.22, 0.6], [0.12, 1.5], [0, 1.75], [-0.12, 1.5], [-0.22, 0.6]], 0.08);
        T(f, [back - 0.25, top - 0.2, Math.sin(a) * 0.6], [a * 0.9, PI / 2, 0]);
        b.add(f, cols[i % 3]);
      }
      break;
    }
    case 'hood': {
      const col = opts.teamHood ? TEAM(0.95) : pal.secondary;
      // pulled back off the face: the front opening sits behind the eyes
      const d = dome(1.12, 7, 3);
      T(d, [back - 0.38, top - 0.95, 0], [0, 0, 0.28], [1.0, 1.08, 1.04]);
      b.add(d, col);
      const drape = cyl(0.95, 1.12, 0.6, 7, true);
      T(drape, [back - 0.45, top - 1.55, 0], [0, 0, 0.2]);
      b.add(drape, opts.teamHood ? TEAM(0.8) : shadeC(pal.secondary, 0.85));
      const brim = box(0.18, 0.22, 1.8);
      T(brim, [back + 0.5, top - 0.3, 0], [0, 0, 0.25]);
      b.add(brim, opts.teamHood ? TEAM(0.7) : shadeC(pal.secondary, 0.7));
      break;
    }
    case 'nemes': {
      const d = dome(1.12, 8, 3);
      T(d, [back - 0.05, top - 0.85, 0], [0, 0, 0], [1, 0.9, 1.05]);
      b.add(d, pal.accent);
      const band = cyl(1.1, 1.12, 0.2, 8, true);
      T(band, [back - 0.05, top - 0.7, 0]);
      b.add(band, pal.secondary);
      for (let i = 0; i < 3; i++) {
        const lap = taper(0.35, 0.6, 0.45, 1.0, 1.0 + i * 0.12);
        T(lap, [back + 0.15, top - 1.25 - i * 0.6, 1.0 + i * 0.08]);
        b.addSym(lap, i % 2 ? pal.accent : pal.secondary);
      }
      const tail = taper(0.4, 1.3, 1.2, 0.8, 0.5);
      T(tail, [back - 0.85, top - 2.2, 0]);
      b.add(tail, pal.secondary);
      const ura = cone(0.16, 0.4, 4);
      T(ura, [back + 1.08, top - 0.45, 0]);
      b.add(ura, pal.accent, { glow: 0.3 });
      break;
    }
    case 'halo': {
      const h = torus(1.3, 0.13, 3, 12);
      T(h, [back - 0.75, top + 0.15, 0], [0, PI / 2, 0]);
      b.add(h, tintC(pal.glow, 0.25), { glow: 1 });
      break;
    }
    case 'antlers': {
      const col = mixC(pal.accent, pal.bone, 0.4);
      const A = [back - 0.1, top - 0.2, 0.42];
      const B = [back - 0.35, top + 0.9, 1.05];
      const D = [back - 0.75, top + 1.75, 1.15];
      b.addSym(seg(A, B, 0.15, 0.12, 4), col);
      b.addSym(seg(B, D, 0.12, 0.0, 4), col);
      b.addSym(seg([back - 0.25, top + 0.55, 0.8], [back + 0.35, top + 1.2, 1.0], 0.1, 0.0, 4), col);
      b.addSym(seg([back - 0.55, top + 1.3, 1.1], [back - 0.15, top + 1.9, 1.3], 0.09, 0.0, 4), col);
      break;
    }
    case 'horns': {
      const x = animal ? back - 0.1 : 0.3;
      b.addSym(seg([x, top - 0.25, 0.45], [x - 0.05, top + 0.45, 0.62], 0.22, 0.15, 5), pal.horn);
      b.addSym(seg([x - 0.05, top + 0.45, 0.62], [x - 0.45, top + 1.0, 0.5], 0.15, 0.0, 5), pal.horn);
      break;
    }
    case 'topknot': {
      const bun = dodeca(0.42);
      T(bun, [back - 0.3, top + 0.22, 0]);
      b.add(bun, pal.hair);
      const tie = cyl(0.22, 0.26, 0.18, 6);
      T(tie, [back - 0.25, top - 0.02, 0]);
      b.add(tie, pal.secondary);
      break;
    }
    case 'veil': {
      const d = dome(1.18, 7, 3);
      T(d, [back - 0.1, top - 0.9, 0], [0, 0, 0.1]);
      b.add(d, tintC(pal.secondary, 0.25));
      const panel = taper(0.3, 2.2, 1.9, 1, 0.7);
      T(panel, [back - 0.85, top - 2.85, 0]);
      b.add(panel, tintC(pal.secondary, 0.25));
      const circ = cyl(1.12, 1.12, 0.12, 8, true);
      T(circ, [back, top - 0.45, 0]);
      b.add(circ, pal.accent);
      break;
    }
    case 'tiara': {
      const band = cyl(0.94, 0.94, 0.14, 8, true);
      T(band, [back + 0.05, top - 0.42, 0], [0, 0, -0.18]);
      b.add(band, metal);
      const peak = cone(0.2, 0.5, 4);
      T(peak, [back + 0.92, top - 0.02, 0]);
      b.add(peak, metal);
      const gem = octa(0.16);
      T(gem, [back + 0.98, top - 0.3, 0]);
      b.add(gem, pal.secondary, { glow: 0.7 });
      break;
    }
    case 'flame': {
      b.frame([back - 0.1, 0, 0], [0, 0, 0], 1, () => flameTongues(b, pal, 6, 0.6, top - 0.35, 1.2));
      break;
    }
    case 'tall_crown': {
      const c1 = cyl(0.62, 0.88, 1.5, 8);
      T(c1, [back - 0.1, top + 0.45, 0], [0, 0, 0.1]);
      b.add(c1, metal);
      const knob = dodeca(0.4);
      T(knob, [back - 0.25, top + 1.35, 0]);
      b.add(knob, metal);
      const band = cyl(0.9, 0.9, 0.18, 8, true);
      T(band, [back - 0.05, top - 0.2, 0]);
      b.add(band, pal.secondary);
      const gem = octa(0.18);
      T(gem, [back + 0.85, top + 0.15, 0]);
      b.add(gem, pal.secondary, { glow: 0.6 });
      break;
    }
    case 'headdress': {
      const band = cyl(0.98, 0.94, 0.3, 8, true);
      T(band, [back, top - 0.3, 0]);
      b.add(band, pal.accent);
      const cols = [pal.accent, pal.secondary, pal.primary, pal.secondary];
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = (i / (n - 1) - 0.5) * PI * 0.95;
        const f = slab([[0, 0], [0.3, 0.9], [0.18, 2.1], [0, 2.4], [-0.18, 2.1], [-0.3, 0.9]], 0.1);
        T(f, [back - 0.45 - Math.cos(a) * 0.1, top - 0.25, Math.sin(a) * 0.75], [a * 0.95, PI / 2, -0.25]);
        b.add(f, cols[i % cols.length]);
      }
      const gem = octa(0.25);
      T(gem, [back + 0.95, top - 0.25, 0]);
      b.add(gem, pal.glow, { glow: 0.8 });
      break;
    }
    default:
      break;
  }
}

/** True when the headgear hides the hair cap. */
export function headgearCoversHair(kind) {
  return ['helmet', 'horned_helmet', 'winged_helmet', 'hood', 'nemes', 'veil', 'tall_crown', 'flame'].includes(kind);
}

// ---------------------------------------------------------------------------
// Hand-held items, modelled along +Y with the grip at the origin.
// size = 1 for a humanoid of scale 1.
// ---------------------------------------------------------------------------

/** How a weapon is held and swung. */
export const WEAPON_INFO = {
  none: { grip: 'fist', style: 'punch', elbow: 0.25 },
  sword: { grip: 'fwd', style: 'swing', elbow: 0.45 },
  spear: { grip: 'pole', style: 'thrust', elbow: 1 },
  trident: { grip: 'pole', style: 'thrust', elbow: 1 },
  hammer: { grip: 'fwd', style: 'swing', elbow: 0.45 },
  axe: { grip: 'fwd', style: 'swing', elbow: 0.45 },
  double_axe: { grip: 'fwd', style: 'swing', elbow: 0.45 },
  bow: { grip: 'bow', style: 'bow', elbow: 0.2 },
  staff: { grip: 'fwd', style: 'swing', elbow: 1 },
  scepter: { grip: 'fwd', style: 'swing', elbow: 0.85 },
  club: { grip: 'fwd', style: 'swing', elbow: 0.45 },
  scythe: { grip: 'fwd', style: 'swing', elbow: 1 },
  discus: { grip: 'fwd', style: 'throw', elbow: 1 },
  lightning_bolt: { grip: 'fwd', style: 'throw', elbow: 0.9 },
  fan: { grip: 'fwd', style: 'fan', elbow: 0.7 },
  drum: { grip: 'fwd', style: 'drum', elbow: 0.6 },
  mace: { grip: 'fwd', style: 'swing', elbow: 0.45 },
  whip: { grip: 'fwd', style: 'swing', elbow: 0.5 },
  torch: { grip: 'fwd', style: 'swing', elbow: 1 },
  ankh: { grip: 'fwd', style: 'swing', elbow: 0.9 },
  claws: { grip: 'down', style: 'claw', elbow: 0.3 },
  halberd: { grip: 'pole', style: 'swing', elbow: 1 },
  katana: { grip: 'fwd', style: 'swing', elbow: 0.5 },
  cauldron: { grip: 'hang', style: 'throw', elbow: 1 },
  harp: { grip: 'fwd', style: 'cast', elbow: 1 },
};

/** Elbow rest bend (0..1 of 90°) for an offhand item. */
export const OFFHAND_ELBOW = { none: 0.25, shield: 0.55, orb: 1, book: 1, lantern: 1, torch: 1, ankh: 0.9, drum: 1, mirror: 1, shell: 1 };

/** Euler rotation turning +Y into the grip direction in the hand frame. */
export function gripRotation(grip) {
  switch (grip) {
    case 'pole': return [0, 0, PI];        // along the forearm: forward when the elbow is at 90°
    case 'down': return [0, 0, PI];
    case 'hang': return [0, 0, PI / 2];     // hangs down when the elbow is at 90°
    case 'bow': return [0, 0, -PI / 2];
    default: return [0, 0, -PI / 2];        // forward when the arm hangs, up at 90° elbow
  }
}

function fire(b, pal, y, h, r = 0.06) {
  const fl = flickerMorph(b, [0, y, 0], 0.35);
  const f1 = cone(r, h, 4);
  T(f1, [0, y + h / 2, 0]);
  b.add(f1, pal.fire, { glow: 1, morph: fl });
  const f2 = cone(r * 0.6, h * 0.75, 4);
  T(f2, [0, y + h * 0.42, 0], [0, 0.6, 0]);
  b.add(f2, pal.fireHot, { glow: 1, morph: fl });
}

/** Add a weapon (main hand) in the grip frame. size scales the item. */
export function addWeapon(b, pal, kind, size = 1, opts = {}) {
  const s = size;
  const metal = pal.accent;
  const shaft = opts.shaftColor || pal.wood;
  switch (kind) {
    case 'sword': {
      b.add(seg([0, -0.07 * s, 0], [0, 0.07 * s, 0], 0.025 * s, 0.025 * s, 4, true), pal.leather);
      const guard = box(0.05 * s, 0.035 * s, 0.17 * s);
      T(guard, [0, 0.08 * s, 0]);
      b.add(guard, shadeC(metal, 0.8));
      const blade = taper(0.085 * s, 0.56 * s, 0.028 * s, 0.12, 0.6);
      T(blade, [0, 0.09 * s, 0]);
      b.add(blade, metal, { glow: opts.glowBlade ? 0.6 : 0 });
      if (!opts.lowDetail) {
        const pom = octa(0.035 * s);
        T(pom, [0, -0.09 * s, 0]);
        b.add(pom, shadeC(metal, 0.8));
      }
      break;
    }
    case 'katana': {
      b.add(seg([0, -0.14 * s, 0], [0, 0.06 * s, 0], 0.022 * s, 0.022 * s, 4), C('#2a2230'));
      const tsuba = cyl(0.05 * s, 0.05 * s, 0.015 * s, 6);
      T(tsuba, [0, 0.07 * s, 0]);
      b.add(tsuba, C('#c8a040'));
      const pts = [[0, 0.08], [0.012, 0.3], [0.035, 0.52], [0.07, 0.72]];
      for (let i = 0; i < 3; i++) {
        const g = taper(0.05 * s, (pts[i + 1][1] - pts[i][1]) * s * 1.02, 0.016 * s, i === 2 ? 0.4 : 0.92, 1);
        T(g, [pts[i][0] * s, pts[i][1] * s, 0], [0, 0, -0.1 - i * 0.07]);
        b.add(g, metal);
      }
      break;
    }
    case 'spear':
    case 'trident':
    case 'halberd': {
      b.add(seg([0, -0.42 * s, 0], [0, 0.78 * s, 0], 0.02 * s, 0.02 * s, 4, true), shaft);
      if (kind === 'spear') {
        const tip = cone(0.05 * s, 0.2 * s, 4);
        T(tip, [0, 0.88 * s, 0], [0, PI / 4, 0], [1.1, 1, 0.5]);
        b.add(tip, metal);
        const coll = cyl(0.03 * s, 0.03 * s, 0.05 * s, 5);
        T(coll, [0, 0.78 * s, 0]);
        b.add(coll, shadeC(metal, 0.7));
      } else if (kind === 'trident') {
        const bar = box(0.03 * s, 0.035 * s, 0.22 * s);
        T(bar, [0, 0.79 * s, 0]);
        b.add(bar, metal);
        for (const z of [-0.1, 0, 0.1]) {
          const p = seg([0, 0.79 * s, z * s], [0, (z === 0 ? 1.02 : 0.97) * s, z * s], 0.018 * s, 0.0, 4);
          b.add(p, metal);
        }
      } else {
        const blade = slab([[0, 0], [0.16, 0.06], [0.22, 0.2], [0.14, 0.34], [0.03, 0.3]], 0.025);
        T(blade, [0.01 * s, 0.6 * s, 0], [0, 0, 0], s);
        b.add(blade, metal);
        const spike = cone(0.03 * s, 0.16 * s, 4);
        T(spike, [0, 0.86 * s, 0]);
        b.add(spike, metal);
        const tassel = cone(0.04 * s, 0.12 * s, 4);
        T(tassel, [-0.02 * s, 0.56 * s, 0], [0, 0, PI]);
        b.add(tassel, C('#c02828'));
      }
      break;
    }
    case 'hammer': {
      b.add(seg([0, -0.06 * s, 0], [0, 0.34 * s, 0], 0.022 * s, 0.025 * s, 4), pal.leather);
      const head = box(0.25 * s, 0.14 * s, 0.15 * s);
      T(head, [0, 0.39 * s, 0]);
      b.add(head, metal);
      const band = box(0.05 * s, 0.15 * s, 0.16 * s);
      T(band, [0, 0.39 * s, 0]);
      b.add(band, shadeC(metal, 0.65));
      break;
    }
    case 'axe':
    case 'double_axe': {
      b.add(seg([0, -0.08 * s, 0], [0, 0.48 * s, 0], 0.02 * s, 0.02 * s, 4), shaft);
      const blade = slab([[0, -0.05], [0.18, -0.12], [0.2, 0.1], [0, 0.05]], 0.025);
      T(blade, [0.015 * s, 0.38 * s, 0], [0, 0, 0], s);
      b.add(blade, metal);
      if (kind === 'double_axe') {
        const b2 = slab([[0, -0.05], [-0.18, -0.12], [-0.2, 0.1], [0, 0.05]], 0.025);
        T(b2, [-0.015 * s, 0.38 * s, 0], [0, 0, 0], s);
        b.add(b2, metal);
      }
      break;
    }
    case 'club': {
      b.add(seg([0, -0.06 * s, 0], [0, 0.52 * s, 0], 0.03 * s, 0.08 * s, 5), opts.clubColor || pal.wood);
      for (let i = 0; i < 3; i++) {
        const k = tetra(0.035 * s);
        T(k, [Math.cos(i * 2.1) * 0.065 * s, (0.3 + i * 0.08) * s, Math.sin(i * 2.1) * 0.065 * s]);
        b.add(k, shadeC(opts.clubColor || pal.wood, 0.7));
      }
      break;
    }
    case 'mace': {
      b.add(seg([0, -0.06 * s, 0], [0, 0.36 * s, 0], 0.022 * s, 0.025 * s, 4), pal.leather);
      const head = dodeca(0.09 * s);
      T(head, [0, 0.42 * s, 0]);
      b.add(head, metal);
      for (let i = 0; i < 4; i++) {
        const fl = box(0.03 * s, 0.12 * s, 0.13 * s);
        T(fl, [0, 0.42 * s, 0], [0, (i * PI) / 4, 0]);
        b.add(fl, shadeC(metal, 0.8));
      }
      break;
    }
    case 'staff': {
      b.add(seg([0, -0.5 * s, 0], [0, 0.5 * s, 0], 0.02 * s, 0.022 * s, 4, true), shaft);
      const cradle = cone(0.06 * s, 0.1 * s, 4);
      T(cradle, [0, 0.53 * s, 0], [PI, 0, 0]);
      b.add(cradle, metal);
      const orb = ico(0.065 * s);
      T(orb, [0, 0.62 * s, 0]);
      b.add(orb, tintC(pal.glow, 0.2), { glow: 1 });
      break;
    }
    case 'scepter': {
      b.add(seg([0, -0.1 * s, 0], [0, 0.38 * s, 0], 0.018 * s, 0.022 * s, 4), metal);
      const coll = cyl(0.04 * s, 0.03 * s, 0.05 * s, 6);
      T(coll, [0, 0.38 * s, 0]);
      b.add(coll, shadeC(metal, 0.8));
      const gem = octa(0.06 * s);
      T(gem, [0, 0.46 * s, 0], [0, 0, 0], [1, 1.4, 1]);
      b.add(gem, tintC(pal.glow, 0.2), { glow: 1 });
      break;
    }
    case 'scythe': {
      b.add(seg([0, -0.45 * s, 0], [0, 0.75 * s, 0], 0.02 * s, 0.02 * s, 4), opts.shaftColor || pal.woodDark);
      const pts = [[0, 0.74], [0.16, 0.75], [0.32, 0.68], [0.44, 0.55], [0.5, 0.4]];
      for (let i = 0; i < pts.length - 1; i++) {
        const w = 0.07 * (1 - i / pts.length);
        b.add(seg([pts[i][0] * s, pts[i][1] * s, 0], [pts[i + 1][0] * s, pts[i + 1][1] * s, 0], w * s, w * 0.75 * s, 3), metal);
      }
      break;
    }
    case 'discus': {
      const disc = cyl(0.13 * s, 0.13 * s, 0.025 * s, 10);
      T(disc, [0, 0.12 * s, 0]);
      b.add(disc, tintC(pal.glow, 0.2), { glow: 1 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * PI * 2;
        const t = cone(0.03 * s, 0.07 * s, 3);
        T(t, [Math.cos(a) * 0.15 * s, 0.12 * s, Math.sin(a) * 0.15 * s], [0, -a, -PI / 2]);
        b.add(t, metal, { glow: 0.5 });
      }
      const hub = cyl(0.04 * s, 0.04 * s, 0.04 * s, 6);
      T(hub, [0, 0.12 * s, 0]);
      b.add(hub, metal);
      break;
    }
    case 'lightning_bolt': {
      const pts = [[0, -0.12], [0.07, 0.1], [-0.05, 0.2], [0.08, 0.42], [-0.02, 0.5], [0.05, 0.7]];
      const col = tintC(pal.glow, 0.35);
      for (let i = 0; i < pts.length - 1; i++) {
        const w = (0.045 - i * 0.004) * s;
        b.add(seg([pts[i][0] * s, pts[i][1] * s, 0], [pts[i + 1][0] * s, pts[i + 1][1] * s, 0], w, w * 0.9, 4), col, { glow: 1 });
      }
      const tip = cone(0.04 * s, 0.12 * s, 4);
      T(tip, [0.06 * s, 0.75 * s, 0], [0, 0, -0.2]);
      b.add(tip, col, { glow: 1 });
      break;
    }
    case 'fan': {
      b.add(seg([0, -0.04 * s, 0], [0, 0.12 * s, 0], 0.018 * s, 0.018 * s, 4), pal.woodDark);
      const pts = [[0, 0]];
      for (let i = 0; i <= 6; i++) {
        const a = -0.85 + (i / 6) * 1.7;
        pts.push([Math.sin(a) * 0.3, Math.cos(a) * 0.3]);
      }
      const f = slab(pts, 0.02);
      T(f, [0, 0.1 * s, 0], [0, 0, 0], s);
      b.add(f, pal.secondary);
      const rim = slab([[0, 0], [0.04, 0.05], [0, 0.3], [-0.04, 0.05]], 0.03);
      T(rim, [0, 0.1 * s, 0], [0, 0, 0], s);
      b.add(rim, pal.accent);
      break;
    }
    case 'drum': {
      b.add(seg([0, -0.04 * s, 0], [0, 0.3 * s, 0], 0.016 * s, 0.02 * s, 4), pal.woodDark);
      const ball = dodeca(0.045 * s);
      T(ball, [0, 0.32 * s, 0]);
      b.add(ball, pal.accent, { glow: 0.3 });
      break;
    }
    case 'whip': {
      b.add(seg([0, -0.05 * s, 0], [0, 0.14 * s, 0], 0.022 * s, 0.02 * s, 4), pal.leather);
      const pts = [[0, 0.14], [0.08, 0.3], [0.2, 0.38], [0.32, 0.34], [0.4, 0.22], [0.44, 0.08]];
      for (let i = 0; i < pts.length - 1; i++) b.add(seg([pts[i][0] * s, pts[i][1] * s, 0], [pts[i + 1][0] * s, pts[i + 1][1] * s, 0], 0.012 * s, 0.008 * s, 3), pal.leather);
      break;
    }
    case 'torch': {
      b.add(seg([0, -0.1 * s, 0], [0, 0.26 * s, 0], 0.02 * s, 0.026 * s, 4), pal.woodDark);
      const cup = cyl(0.045 * s, 0.03 * s, 0.05 * s, 5);
      T(cup, [0, 0.27 * s, 0]);
      b.add(cup, pal.darkMetal);
      fire(b, pal, 0.29 * s, 0.2 * s, 0.06 * s);
      break;
    }
    case 'ankh': {
      const col = metal;
      b.add(seg([0, -0.06 * s, 0], [0, 0.3 * s, 0], 0.022 * s, 0.022 * s, 4), col);
      const bar = box(0.035 * s, 0.035 * s, 0.2 * s);
      T(bar, [0, 0.3 * s, 0]);
      b.add(bar, col);
      const loop = torus(0.065 * s, 0.018 * s, 3, 7);
      T(loop, [0, 0.39 * s, 0], [0, 0, 0], [1, 1.3, 1]);
      b.add(loop, col, { glow: 0.35 });
      break;
    }
    case 'claws': {
      for (const z of [-0.035, 0, 0.035]) {
        const c = cone(0.018 * s, 0.16 * s, 3);
        T(c, [0.02 * s, 0.1 * s, z * s], [0, 0, -0.25]);
        b.add(c, opts.clawColor || pal.bone);
      }
      break;
    }
    case 'cauldron': {
      const pot = cyl(0.12 * s, 0.085 * s, 0.14 * s, 7);
      T(pot, [0, 0.13 * s, 0]);
      b.add(pot, metal);
      const rim = torus(0.115 * s, 0.018 * s, 3, 7);
      T(rim, [0, 0.2 * s, 0], [PI / 2, 0, 0]);
      b.add(rim, shadeC(metal, 0.7));
      const liquid = cyl(0.1 * s, 0.1 * s, 0.01 * s, 7);
      T(liquid, [0, 0.195 * s, 0]);
      b.add(liquid, tintC(pal.glow, 0.25), { glow: 1 });
      b.add(seg([0, 0, 0], [0, 0.06 * s, 0], 0.012 * s, 0.012 * s, 3), pal.darkMetal);
      break;
    }
    case 'harp': {
      const col = metal;
      b.add(seg([0, 0, 0], [0, 0.36 * s, 0], 0.02 * s, 0.018 * s, 4), col);
      b.add(seg([0, 0.36 * s, 0], [0.2 * s, 0.26 * s, 0], 0.018 * s, 0.016 * s, 4), col);
      b.add(seg([0.2 * s, 0.26 * s, 0], [0.02 * s, 0.0, 0], 0.016 * s, 0.02 * s, 4), col);
      for (let i = 1; i <= 3; i++) {
        const g = box(0.006 * s, (0.3 - i * 0.06) * s, 0.006 * s);
        T(g, [0.05 * i * s, (0.17 - i * 0.015) * s, 0]);
        b.add(g, pal.white, { glow: 0.4 });
      }
      break;
    }
    case 'bow': {
      const n = 4;
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n - 0.5;
        pts.push([0.1 * Math.cos(t * PI) * s - 0.03 * s, t * 0.8 * s]);
      }
      for (let i = 0; i < n; i++) {
        const r = (i === 1 || i === 2 ? 0.024 : 0.017) * s;
        b.add(seg([pts[i][0], pts[i][1], 0], [pts[i + 1][0], pts[i + 1][1], 0], r, r, 3, true), opts.bowColor || pal.woodDark);
      }
      const string = box(0.006 * s, 0.8 * s, 0.006 * s);
      T(string, [-0.035 * s, 0, 0]);
      b.add(string, pal.white);
      break;
    }
    default:
      break;
  }
}

/** Add an offhand item (left hand) in the grip frame ('fwd' style). */
export function addOffhand(b, pal, kind, size = 1, opts = {}) {
  const s = size;
  switch (kind) {
    case 'shield': {
      // shield sits on the outside of the forearm; caller frames it
      const face = cyl(0.19 * s, 0.19 * s, 0.035 * s, 8);
      T(face, [0, 0, 0], [PI / 2, 0, 0]);
      b.add(face, opts.teamShield === false ? pal.secondary : TEAM(1));
      const rim = cyl(0.205 * s, 0.205 * s, 0.045 * s, 8, true);
      T(rim, [0, 0, 0], [PI / 2, 0, 0]);
      b.add(rim, pal.accent);
      const boss = octa(0.055 * s);
      T(boss, [0, 0, -0.02 * s], [0, 0, 0], [1, 1, 0.6]);
      b.add(boss, pal.accent);
      break;
    }
    case 'orb': {
      const o = ico(0.075 * s, 0);
      T(o, [0, 0.13 * s, 0]);
      b.add(o, tintC(pal.glow, 0.25), { glow: 1 });
      break;
    }
    case 'book': {
      const cover = box(0.035 * s, 0.17 * s, 0.13 * s);
      T(cover, [0, 0.08 * s, 0]);
      b.add(cover, pal.secondary);
      const pages = box(0.04 * s, 0.155 * s, 0.11 * s);
      T(pages, [0.008 * s, 0.08 * s, 0]);
      b.add(pages, pal.white);
      break;
    }
    case 'lantern': {
      b.add(seg([0, 0, 0], [0, 0.08 * s, 0], 0.006 * s, 0.006 * s, 3), pal.darkMetal);
      const frame = box(0.08 * s, 0.11 * s, 0.08 * s);
      T(frame, [0, 0.15 * s, 0]);
      b.add(frame, tintC(pal.glow, 0.3), { glow: 1 });
      const cap = cone(0.07 * s, 0.05 * s, 4);
      T(cap, [0, 0.1 * s, 0], [PI, PI / 4, 0]);
      b.add(cap, pal.accent);
      const bot = box(0.09 * s, 0.02 * s, 0.09 * s);
      T(bot, [0, 0.21 * s, 0]);
      b.add(bot, pal.accent);
      break;
    }
    case 'torch':
      addWeapon(b, pal, 'torch', size, opts);
      break;
    case 'ankh':
      addWeapon(b, pal, 'ankh', size * 0.8, opts);
      break;
    case 'drum': {
      const d1 = cyl(0.07 * s, 0.025 * s, 0.07 * s, 6);
      T(d1, [0, 0.07 * s, 0.04 * s], [PI / 2, 0, 0]);
      b.add(d1, pal.secondary);
      const d2 = mirrorZ(d1.clone());
      b.add(d2, pal.secondary);
      const mid = cyl(0.03 * s, 0.03 * s, 0.03 * s, 5);
      T(mid, [0, 0.07 * s, 0], [PI / 2, 0, 0]);
      b.add(mid, pal.accent);
      break;
    }
    case 'mirror': {
      b.add(seg([0, -0.02 * s, 0], [0, 0.08 * s, 0], 0.016 * s, 0.016 * s, 4), pal.woodDark);
      const disc = cyl(0.11 * s, 0.11 * s, 0.025 * s, 10);
      T(disc, [0, 0.18 * s, 0], [0, 0, PI / 2]);
      b.add(disc, opts.dark ? C('#202028') : tintC(pal.glow, 0.45), { glow: opts.dark ? 0.2 : 1 });
      const rim = torus(0.11 * s, 0.016 * s, 3, 10);
      T(rim, [0, 0.18 * s, 0], [0, PI / 2, 0]);
      b.add(rim, pal.accent);
      break;
    }
    case 'shell': {
      const sh = cone(0.07 * s, 0.2 * s, 6);
      T(sh, [0, 0.12 * s, 0], [0, 0, -0.4]);
      b.add(sh, tintC(pal.white, 0.1));
      const sp = dodeca(0.06 * s);
      T(sp, [0.02 * s, 0.05 * s, 0]);
      b.add(sp, mixC(pal.white, '#f0b0a0', 0.4));
      break;
    }
    default:
      break;
  }
}

/** Worker tools (geometry swapped in while gathering/building). */
export function addTool(b, pal, kind, size = 1) {
  const s = size;
  b.add(seg([0, -0.08 * s, 0], [0, 0.4 * s, 0], 0.018 * s, 0.018 * s, 4), pal.wood);
  if (kind === 'axe') {
    const blade = slab([[0, -0.04], [0.13, -0.08], [0.14, 0.07], [0, 0.04]], 0.02);
    T(blade, [0.012 * s, 0.33 * s, 0], [0, 0, 0], s);
    b.add(blade, pal.metal);
  } else if (kind === 'hammer') {
    const head = box(0.15 * s, 0.08 * s, 0.08 * s);
    T(head, [0, 0.36 * s, 0]);
    b.add(head, pal.darkMetal);
  } else {
    const pick = seg([-0.13 * s, 0.32 * s, 0], [0.16 * s, 0.38 * s, 0], 0.018 * s, 0.0, 4);
    b.add(pick, pal.metal);
    const back = seg([0, 0.37 * s, 0], [-0.13 * s, 0.32 * s, 0], 0.025 * s, 0.018 * s, 4);
    b.add(back, pal.metal);
  }
}

export { flameTongues };
