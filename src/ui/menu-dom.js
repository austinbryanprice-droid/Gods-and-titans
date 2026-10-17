// Tiny DOM helpers for the menu screens. Text always goes in as text nodes;
// h() never sets HTML, inline event-handler attributes or unsafe URLs, so a
// player name or a host's message can never become markup or script.
import { safeUrl } from './menu-model.js';

// Properties / attributes that would parse HTML or run code from a string.
const BLOCKED_KEYS = new Set(['innerHTML', 'outerHTML', 'srcdoc', 'insertAdjacentHTML']);
const URL_KEYS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'data', 'background', 'ping']);

/**
 * Create an element: h('div.card.big', { onclick, title, dataset: {...}, style: {...} }, ...children).
 * Class names may be given after the tag with dots. Children: nodes, strings, arrays, null/false (skipped).
 * @returns {HTMLElement}
 */
export function h(spec, attrs, ...children) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (BLOCKED_KEYS.has(k)) continue;
      if (k.startsWith('on')) {
        // Only real listeners; a string would become an inline script attribute.
        if (typeof v === 'function') el.addEventListener(k.slice(2), v);
        continue;
      }
      if (URL_KEYS.has(k.toLowerCase())) {
        const url = safeUrl(v);
        if (url) el.setAttribute(k, url);
        continue;
      }
      if (k === 'class') el.className = el.className ? `${el.className} ${v}` : v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [p, pv] of Object.entries(v)) {
          if (p.startsWith('--')) el.style.setProperty(p, pv);
          else el.style[p] = pv;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'text') el.textContent = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Replace all children of el. */
export function setChildren(el, ...children) {
  el.textContent = '';
  append(el, children);
  return el;
}

/** Copy text to the clipboard; resolves true on success. */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall back below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
