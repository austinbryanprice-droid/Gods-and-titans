// Tiny DOM helpers for the HUD (no framework): element creation and cheap
// "set only when changed" updates so per-frame HUD refreshes stay light.

/**
 * Create an element. `cls` is a space-separated class list; children may be
 * strings, nodes, arrays or null.
 */
export function el(tag, cls, ...children) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  append(n, children);
  return n;
}

function append(n, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(n, c);
    else if (typeof c === 'string' || typeof c === 'number') n.appendChild(document.createTextNode(String(c)));
    else n.appendChild(c);
  }
}

/** Set textContent only when it changed. */
export function setText(n, text) {
  const s = String(text);
  if (n._t !== s) {
    n._t = s;
    n.textContent = s;
  }
}

/** Set a style property only when it changed. */
export function setStyle(n, prop, value) {
  const key = `_s_${prop}`;
  if (n[key] !== value) {
    n[key] = value;
    if (prop.startsWith('--')) n.style.setProperty(prop, value);
    else n.style[prop] = value;
  }
}

/** Toggle a class only when needed. */
export function setClass(n, cls, on) {
  if (n.classList.contains(cls) !== !!on) n.classList.toggle(cls, !!on);
}

/** Show / hide via the hidden attribute. */
export function setHidden(n, hidden) {
  if (n.hidden !== !!hidden) n.hidden = !!hidden;
}

/** Format a resource amount: 12345 → "12,345". */
export function fmt(n) {
  return Math.floor(n || 0).toLocaleString('en-US');
}

/** Percent string for widths. */
export function pct(v) {
  return `${Math.max(0, Math.min(100, v * 100)).toFixed(1)}%`;
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * A CSS colour that is safe to put into a style (player colours come from the
 * host's snapshots): only #rgb / #rrggbb, anything else gives the fallback, so
 * a hostile value can never smuggle url(…) or other CSS into the page.
 */
export function safeColor(c, fallback = '#888888') {
  return typeof c === 'string' && HEX_COLOR.test(c) ? c : fallback;
}

/** Colour for an hp fraction: green → yellow → red. */
export function hpColor(f) {
  if (f > 0.6) return '#4fd65a';
  if (f > 0.3) return '#e8c43a';
  return '#e8483a';
}
