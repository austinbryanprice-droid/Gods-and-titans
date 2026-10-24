// The heads of the rich birds: the crow's or the falcon's from the humanoid's head kit (rich-heads.js), built in a nominal
// frame and placed on a bird's neck by `kit.placed`, scaled to the bird, and a crest of long feathers for the phoenixes.
// (The Anzu's lion head comes from the mammal tables, rich-mammal-heads.js.)
import * as THREE from 'three';
import { richDims } from './rich-body.js';
import { addBeastHead } from './rich-heads.js';
import { feather } from './rich-feathers.js';
import { frameMatrix } from './rich-creature-kit.js';

/**
 * A crest of `n` long feathers rising from the crown and curving back, in the head's nominal frame. o: { n, len, color,
 * alt (every other feather), tip }.
 */
function crest(kit, D, bind, o) {
  const hs = D.hs;
  const X = (x) => D.headX + x * hs;
  const Y = (y) => D.headCY + y * hs;
  const n = o.n ?? 5;
  for (let i = 0; i < n; i++) {
    const side = n > 1 ? (i / (n - 1) - 0.5) * 2 : 0;
    const len = (0.5 - 0.12 * Math.abs(side)) * hs * (o.len ?? 1);
    feather(kit, [X(-0.002 - 0.014 * Math.abs(side)), Y(0.1), side * 0.036 * hs], [-0.5, 0.9, side * 0.34], [0, 0, 1], len, 0.034 * hs, {
      color: i % 2 ? o.alt : o.color, tip: o.tip, bend: [-0.3 * hs, -0.22 * hs, side * 0.05 * hs], bind: bind.head, thick: 0.004 * hs, rows: 5, shape: 0.5, cup: 0.15,
    });
  }
}

/**
 * Build a bird's head into `kit`. The head's middle is `at`, it faces +X (pitched `pitch`), `scale` times the head of a
 * humanoid. o: { ctx, pal, at, pitch, scale, kind ('bird': the crow's, 'falcon'), bind: { head }, crest: { n, len, color, alt, tip } | null }.
 */
export function birdHead(kit, o) {
  const { ctx, pal } = o;
  const D = richDims(ctx, 'humanoid');
  const to = new THREE.Matrix4().makeTranslation(-D.headX, -D.headCY, 0);
  const M = frameMatrix(o.at, o.pitch ?? 0, 0, o.scale).multiply(to);
  const c2 = { ...ctx, v: { ...ctx.v, head: o.kind === 'falcon' ? 'falcon' : 'bird' } };
  kit.placed(M, () => {
    addBeastHead(kit, D, pal, c2, { head: o.bind.head });
    if (o.crest) crest(kit, D, o.bind, o.crest);
  });
  return D;
}
