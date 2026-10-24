// The Naga's head (rich-heads.js, the head kind 'serpent' on a humanoid body): a cobra's, the long skull and snout of the serpents
// (rich-reptile-heads.js) set on the humanoid's head bone and neck, under a broad hood that spreads behind it from the shoulders
// as the nagas' do in the temples' reliefs: the hood's face is pale and ribbed, its back is scaled and carries the cobra's
// spectacle. The unit's outfit puts its crown on top (rich-outfits-hindu.js).
import { mixC, withMat } from './unit-geo.js';
import { vs, smoothstep } from './rich-kit.js';
import { reptileHead } from './rich-reptile-heads.js';
import { nagaBelly } from './rich-naga.js';
import { hash, mul, tint } from './rich-paint.js';

const TAU = Math.PI * 2;
const SPECTACLE = withMat('#efe4b8', 'scales');

/**
 * The hood: a broad thin oval standing behind the head. Its stations, bottom to top: [height above the shoulder line, half width,
 * how far it stands back of the neck]; the face of it (toward the front) is pale, its back is scaled and marked.
 */
const HOOD = [[-0.02, 0.05, 0.05], [0.04, 0.12, 0.062], [0.11, 0.19, 0.075], [0.19, 0.218, 0.09], [0.26, 0.19, 0.1], [0.32, 0.12, 0.108], [0.355, 0.04, 0.112]];

function hood(kit, D, pal, bind, o) {
  const hs = D.hs;
  const K = D.k;
  const y0 = D.shoulderY;
  const st = HOOD.map(([h, w, back]) => vs(y0 + h * hs, 0.024 * hs, w * hs * K ** 0.5, -back * hs + 0.012));
  const skin = o.skin;
  const belly = o.belly;
  const rows = 26;
  kit.loft(st, {
    rings: 12, sides: 22, start: 'round', end: 'round', capRings: 2, capDepth: 0.02, color: skin, bind: bind.neck,
    paint: (out, x, y, z, u, a) => {
      // a = 0 on the side facing forward: pale and ribbed there, scaled behind
      const c = Math.cos(a * TAU);
      const front = smoothstep(0.1, 0.7, c);
      tint(out, belly, 0.85 * front);
      mul(out, 1 - front * 0.14 * (0.5 + 0.5 * Math.sin(u * rows * TAU)));
      const rim = smoothstep(0.55, 0.95, Math.abs(Math.sin(a * TAU)));
      tint(out, o.back, (0.55 + 0.3 * rim) * (1 - front));
      // the spectacle on the back: two rings side by side, joined below
      const back = smoothstep(-0.1, -0.7, c);
      if (back > 0) {
        const hh = (y - y0) / hs;
        let m = 0;
        for (const side of [-1, 1]) {
          const dz = z / hs - side * 0.062;
          const d = Math.hypot(dz, hh - 0.2);
          m = Math.max(m, smoothstep(0.012, 0.004, Math.abs(d - 0.05)));
        }
        const bridge = smoothstep(0.012, 0.004, Math.abs(hh - (0.115 + 1.6 * (z / hs) ** 2))) * smoothstep(0.075, 0.05, Math.abs(z / hs));
        tint(out, SPECTACLE, 0.9 * Math.max(m, bridge) * back);
      }
      mul(out, 0.92 + 0.1 * hash(Math.round(x * 80), Math.round(y * 80), Math.round(z * 80)));
    },
  });
}

/**
 * The cobra's head and hood on the head bone. The skin is the unit's, the ridge of the skull and the hood's back its second tone,
 * the belly pale (the serpents' underside); eyes glow when the unit's do.
 */
export function cobraHead(kit, D, pal, bind, skinPaint, glowEyes) {
  const hs = D.hs;
  const skin = pal.skin;
  const belly = nagaBelly(skin);
  const back = pal.back;
  hood(kit, D, pal, bind, { skin, belly, back });
  reptileHead(kit, {
    kind: 'serpent', at: [D.headX - 0.075 * hs, D.headCY - 0.025 * hs, 0], pitch: -0.12, len: 0.4 * hs, lean: true, bind: { head: bind.head },
    skin, belly, back, glowEyes: !!glowEyes, eyeColor: glowEyes ? withMat(mixC(pal.glow, pal.eyeGlow || pal.glow, 0.3), 'gem') : withMat('#f0c030', 'gloss'), tongue: false, gear: 'none',
    paint: skinPaint,
  });
}
