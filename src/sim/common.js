// Small geometry helpers shared by the simulation modules.

/** Fast 2D length (Math.hypot is slow in V8 hot loops). */
export function hyp(x, y) {
  return Math.sqrt(x * x + y * y);
}

/** Distance from a point to an axis-aligned rectangle [x0, x1] × [y0, y1] (0 inside). */
export function distPointRect(px, py, x0, y0, x1, y1) {
  const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
  const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Closest point of a rectangle to (px, py). */
export function closestOnRect(px, py, x0, y0, x1, y1) {
  return { x: Math.max(x0, Math.min(x1, px)), y: Math.max(y0, Math.min(y1, py)) };
}

/** True for buildings and gold mines (entities with a tile footprint). */
export function hasFootprint(e) {
  return e.kind !== 'unit';
}

/** Distance from a point to an entity's body (unit circle edge or footprint). */
export function distToEntity(px, py, e) {
  if (e.kind === 'unit') return hyp(e.x - px, e.y - py) - e.radius;
  return distPointRect(px, py, e.tx, e.ty, e.tx + e.size, e.ty + e.size);
}

/** Edge-to-edge distance between two entities (DESIGN 3). */
export function edgeDist(a, b) {
  if (a.kind === 'unit' && b.kind === 'unit') return hyp(a.x - b.x, a.y - b.y) - a.radius - b.radius;
  if (a.kind === 'unit') return distPointRect(a.x, a.y, b.tx, b.ty, b.tx + b.size, b.ty + b.size) - a.radius;
  if (b.kind === 'unit') return distPointRect(b.x, b.y, a.tx, a.ty, a.tx + a.size, a.ty + a.size) - b.radius;
  return hyp(a.x - b.x, a.y - b.y);
}

export function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

/** Rotate `from` toward `to` by at most maxStep radians. */
export function turnToward(from, to, maxStep) {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  if (d > maxStep) d = maxStep;
  else if (d < -maxStep) d = -maxStep;
  let r = from + d;
  if (r > Math.PI) r -= 2 * Math.PI;
  else if (r < -Math.PI) r += 2 * Math.PI;
  return r;
}

export const round2 = (v) => Math.round(v * 100) / 100;
