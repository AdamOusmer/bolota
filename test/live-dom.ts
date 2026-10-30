// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

/**
 * The smallest DOM `mountLive` touches: elements with ordered attributes, a
 * `style` that reads and writes the `style` attribute, class selectors, an
 * `innerHTML` that parses the library's own markup, and a window with a
 * steppable frame queue, listeners and a spy on layout reads.
 */

export interface Log {
  events: string[];
}

type Listener = (e: unknown) => void;

class Listenable {
  listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string, e: unknown = {}) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
  }
  count() {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}

class Style {
  constructor(private el: FakeElement) {}
  private read(): [string, string][] {
    const raw = this.el.getAttribute("style");
    if (!raw) return [];
    return raw.split(";").filter(Boolean).map((p) => {
      const i = p.indexOf(":");
      return [p.slice(0, i), p.slice(i + 1)];
    });
  }
  private write(pairs: [string, string][]) {
    this.el.attrs.set("style", pairs.map(([k, v]) => `${k}:${v}`).join(";"));
  }
  getPropertyValue(k: string) {
    return this.read().find(([n]) => n === k)?.[1] ?? "";
  }
  setProperty(k: string, v: string) {
    this.el.log?.events.push(`write ${k}`);
    const pairs = this.read();
    const hit = pairs.find(([n]) => n === k);
    if (hit) hit[1] = v;
    else pairs.push([k, v]);
    this.write(pairs);
  }
  removeProperty(k: string) {
    const pairs = this.read();
    if (!pairs.some(([n]) => n === k)) return;
    this.write(pairs.filter(([n]) => n !== k));
  }
}

export class FakeElement extends Listenable {
  attrs = new Map<string, string>();
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  style = new Style(this);
  rectReads = 0;
  box = { left: 0, top: 0, width: 100, height: 100 };
  constructor(public tagName: string, public ownerDocument: FakeDocument) {
    super();
  }
  get log() {
    return this.ownerDocument.log;
  }
  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
  setAttribute(k: string, v: unknown) {
    this.log?.events.push(`write ${k}`);
    this.attrs.set(k, String(v));
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  hasAttribute(k: string) {
    return this.attrs.has(k);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  private detach(c: FakeElement) {
    c.parentNode?.children.splice(c.parentNode.children.indexOf(c), 1);
    c.parentNode = null;
  }
  appendChild(c: FakeElement) {
    this.detach(c);
    this.children.push(c);
    c.parentNode = this;
    return c;
  }
  append(...cs: FakeElement[]) {
    cs.forEach((c) => this.appendChild(c));
  }
  insertBefore(c: FakeElement, ref: FakeElement | null) {
    this.detach(c);
    const i = ref ? this.children.indexOf(ref) : this.children.length;
    this.children.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }
  replaceChild(next: FakeElement, old: FakeElement) {
    this.detach(next);
    this.children.splice(this.children.indexOf(old), 1, next);
    next.parentNode = this;
    old.parentNode = null;
    return old;
  }
  replaceWith(next: FakeElement) {
    this.parentNode?.replaceChild(next, this);
  }
  remove() {
    this.detach(this);
  }
  get isConnected() {
    return true;
  }
  walk(visit: (e: FakeElement) => void) {
    for (const c of this.children) {
      visit(c);
      c.walk(visit);
    }
  }
  querySelectorAll(sel: string) {
    const cls = sel.slice(1);
    const out: FakeElement[] = [];
    this.walk((e) => {
      if ((e.getAttribute("class") ?? "").split(/\s+/).includes(cls)) out.push(e);
    });
    return out;
  }
  querySelector(sel: string) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  set innerHTML(html: string) {
    this.children.forEach((c) => (c.parentNode = null));
    this.children = [];
    const stack: FakeElement[] = [this];
    for (const m of html.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
      const [, close, tag, attrs, self] = m;
      if (close) {
        stack.pop();
        continue;
      }
      const el = new FakeElement(tag!, this.ownerDocument);
      for (const a of attrs!.matchAll(/([\w:-]+)="([^"]*)"/g)) el.attrs.set(a[1]!, a[2]!);
      stack[stack.length - 1]!.appendChild(el);
      if (!self) stack.push(el);
    }
  }
  get outerHTML(): string {
    const a = [...this.attrs].map(([k, v]) => ` ${k}="${v}"`).join("");
    return this.children.length
      ? `<${this.tagName}${a}>${this.innerMarkup}</${this.tagName}>`
      : `<${this.tagName}${a}/>`;
  }
  get innerMarkup(): string {
    return this.children.map((c) => c.outerHTML).join("");
  }
  getBoundingClientRect() {
    this.ownerDocument.log?.events.push("read rect");
    this.ownerDocument.rects++;
    const b = this.box;
    return { ...b, right: b.left + b.width, bottom: b.top + b.height };
  }
}

export class FakeWindow extends Listenable {
  queue: Array<(ms: number) => void> = [];
  reduced = false;
  ResizeObserver = class {
    constructor(public cb: () => void) {}
    observe() {}
    disconnect() {}
  };
  matchMedia(q: string) {
    return { matches: this.reduced && q.includes("reduced-motion") } as MediaQueryList;
  }
  requestAnimationFrame(cb: (ms: number) => void) {
    this.queue.push(cb);
    return this.queue.length;
  }
  cancelAnimationFrame() {
    this.queue.length = 0;
  }
  getComputedStyle() {
    return { getPropertyValue: () => "" };
  }
}

export class FakeDocument extends Listenable {
  defaultView = new FakeWindow();
  hidden = false;
  rects = 0;
  log: Log | null = null;
  createElementNS(_ns: string, tag: string) {
    return new FakeElement(tag, this);
  }
}

export function makeSvg(doc: FakeDocument, html = "") {
  const svg = doc.createElementNS("", "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  if (html) svg.innerHTML = html;
  return svg;
}

/** Runs one frame at `ms`; reads, then ticks, as the shared loop does. */
export function frame(doc: FakeDocument, ms: number) {
  const due = doc.defaultView.queue;
  doc.defaultView.queue = [];
  for (const cb of due) cb(ms);
}

/** Frames at 60 Hz from `from` ms for `seconds`, stopping early if the queue empties. */
export function run(doc: FakeDocument, from: number, seconds: number) {
  let ms = from;
  const end = from + seconds * 1000;
  while (ms < end && doc.defaultView.queue.length) frame(doc, (ms += 16));
  return ms;
}
