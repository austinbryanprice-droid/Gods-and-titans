// A tiny fake DOM for UI tests in Node: enough of document / Element for the
// HUD's el() helpers, event listeners that tests can fire, and lookups by
// class name or button text. Install with installFakeDom() in a before() hook.

export class FakeText {
  constructor(data) {
    this.nodeType = 3;
    this.data = String(data);
    this.parentNode = null;
  }
  get textContent() {
    return this.data;
  }
}

export class FakeElement {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.className = '';
    this.childNodes = [];
    this.parentNode = null;
    this.hidden = false;
    this.listeners = new Map();
    this.attrs = {};
    this.dataset = {};
    const props = new Map();
    this.style = { setProperty: (k, v) => props.set(k, String(v)), getPropertyValue: (k) => props.get(k) || '' };
    const classes = new Set();
    this.classList = { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) };
  }
  /** Canvases: a 2D context that keeps the last image put into it. */
  getContext() {
    if (!this.ctx2d) {
      const el = this;
      this.ctx2d = {
        createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        putImageData(img) {
          el.image = img;
        },
        getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        drawImage() {},
        clearRect() {},
        fillRect() {},
        fillText() {},
        beginPath() {},
        stroke() {},
        fill() {},
        arc() {},
        moveTo() {},
        lineTo() {},
        closePath() {},
        save() {},
        restore() {},
        setTransform() {},
      };
    }
    return this.ctx2d;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return k in this.attrs ? this.attrs[k] : null;
  }
  removeAttribute(k) {
    delete this.attrs[k];
  }
  /** Only `.class` selectors: the first element (this or a descendant) with that class. */
  querySelector(sel) {
    return this.find(String(sel).replace(/^\./, ''));
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 150, bottom: 150, width: 150, height: 150 };
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const l = this.listeners.get(type);
    if (l) this.listeners.set(type, l.filter((f) => f !== fn));
  }
  /** Run this element's listeners for `type` (no bubbling). */
  fire(type, ev = {}) {
    for (const fn of this.listeners.get(type) || []) fn({ stopPropagation() {}, preventDefault() {}, target: this, ...ev });
  }
  click() {
    this.fire('click');
  }
  focus() {}
  appendChild(n) {
    if (n.parentNode) n.remove();
    this.childNodes.push(n);
    n.parentNode = this;
    return n;
  }
  append(...ns) {
    for (const n of ns) if (n !== null && n !== undefined) this.appendChild(typeof n === 'string' ? new FakeText(n) : n);
  }
  remove() {
    const p = this.parentNode;
    if (p) p.childNodes = p.childNodes.filter((c) => c !== this);
    this.parentNode = null;
  }
  get children() {
    return this.childNodes.filter((c) => c.nodeType === 1);
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  set textContent(v) {
    this.childNodes = v === '' ? [] : [new FakeText(v)];
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  /** First element (this or a descendant) with class `cls`. */
  find(cls) {
    if (this.className.split(' ').includes(cls)) return this;
    for (const c of this.children) {
      const f = c.find(cls);
      if (f) return f;
    }
    return null;
  }
  /** Every element (this or a descendant) with class `cls`, in document order. */
  findAll(cls, out = []) {
    if (this.className.split(' ').includes(cls)) out.push(this);
    for (const c of this.children) c.findAll(cls, out);
    return out;
  }
  /** Every descendant element with this tag name. */
  all(tag, out = []) {
    for (const c of this.children) {
      if (c.tagName === tag.toUpperCase()) out.push(c);
      c.all(tag, out);
    }
    return out;
  }
  /** The button whose text is exactly `text`, or null. */
  button(text) {
    return this.all('button').find((b) => b.textContent === text) || null;
  }
}

export function installFakeDom() {
  globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (t) => new FakeText(t),
    addEventListener() {},
    removeEventListener() {},
    hasFocus: () => true,
  };
  globalThis.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 };
}
