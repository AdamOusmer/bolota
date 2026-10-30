// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { gaze } from "../src/gaze";

type Listener = (e: unknown) => void;

class FakeStyle {
  props = new Map<string, string>();
  writes: string[] = [];
  setProperty(k: string, v: string) {
    this.writes.push(k);
    this.props.set(k, v);
  }
  removeProperty(k: string) {
    this.props.delete(k);
  }
}

class FakeWindow {
  queue: Array<(ms: number) => void> = [];
  listeners = new Map<string, Set<Listener>>();
  rects = 0;
  observers: FakeObserver[] = [];
  ResizeObserver: unknown;
  constructor() {
    const win = this;
    this.ResizeObserver = class extends FakeObserver {
      constructor(cb: () => void) {
        super(cb);
        win.observers.push(this);
      }
    };
  }
  matchMedia(q: string) {
    return {
      matches: q.includes("pointer: fine"),
      addEventListener() {},
      removeEventListener() {},
    };
  }
  requestAnimationFrame(cb: (ms: number) => void) {
    this.queue.push(cb);
    return this.queue.length;
  }
  cancelAnimationFrame() {
    this.queue.length = 0;
  }
  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string, e: unknown = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
  getComputedStyle() {
    return { getPropertyValue: (k: string) => (k === "--mo-track-travel" ? "3px" : "") };
  }
  frame(ms: number) {
    const q = this.queue;
    this.queue = [];
    for (const cb of q) cb(ms);
  }
}

class FakeObserver {
  constructor(public cb: () => void) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}

class FakeEl {
  style = new FakeStyle();
  isConnected = true;
  constructor(
    public ownerDocument: { defaultView: FakeWindow },
    public eyes: FakeEl | null,
    public left: number,
  ) {}
  getBoundingClientRect() {
    this.ownerDocument.defaultView.rects++;
    return { left: this.left, top: 0, width: 100, height: 100 };
  }
  querySelector(sel: string) {
    return sel === ".mo-eyes" ? this.eyes : null;
  }
  querySelectorAll() {
    return [];
  }
}

function mount(n: number) {
  const win = new FakeWindow();
  const doc = { defaultView: win };
  const els = Array.from({ length: n }, (_, i) => {
    const eyes = new FakeEl(doc, null, 0);
    return { el: new FakeEl(doc, eyes, i * 120), eyes };
  });
  const drivers = els.map(({ el }) => gaze(el as unknown as SVGSVGElement, { target: "pointer" }));
  return { win, els, drivers };
}

describe("gaze driver: layout reads", () => {
  const N = 5;

  test("no client rect per frame or per pointer move, one per driver per scroll or resize", () => {
    const { win, els } = mount(N);
    let ms = 1000;
    for (let i = 0; i < 6; i++) win.frame((ms += 16));

    const before = win.rects;
    for (let i = 0; i < 40; i++) {
      win.dispatch("pointermove", { clientX: 200 + i * 7, clientY: 300 - i * 3 });
      win.frame((ms += 16));
    }
    for (let i = 0; i < 60; i++) win.frame((ms += 16));
    expect(win.rects - before).toBe(0);

    for (const type of ["scroll", "resize"]) {
      const at = win.rects;
      win.dispatch(type);
      expect(win.rects - at, type).toBe(N);
      win.frame((ms += 16));
      expect(win.rects - at, type).toBe(N);
    }

    for (const { eyes, el } of els) {
      expect(eyes.style.props.get("--mo-track-x")).toBeDefined();
      for (const k of [...eyes.style.writes, ...el.style.writes]) expect(k.startsWith("--")).toBe(true);
    }
  });

  test("one shared frame loop, which parks when the pointer is still", () => {
    const { win } = mount(N);
    let ms = 1000;
    win.dispatch("pointermove", { clientX: 900, clientY: 40 });
    expect(win.queue.length).toBe(1);
    for (let i = 0; i < 200 && win.queue.length; i++) {
      win.frame((ms += 16));
      expect(win.queue.length).toBeLessThanOrEqual(1);
    }
    expect(win.queue.length).toBe(0);

    win.dispatch("pointermove", { clientX: 10, clientY: 500 });
    expect(win.queue.length).toBe(1);
  });

  test("stop removes every listener and every property it wrote", () => {
    const { win, els, drivers } = mount(2);
    win.dispatch("pointermove", { clientX: 900, clientY: 40 });
    win.frame(1016);
    for (const d of drivers) d.stop();
    for (const [, set] of win.listeners) expect(set.size).toBe(0);
    for (const { eyes, el } of els) {
      expect(eyes.style.props.size).toBe(0);
      expect(el.style.props.size).toBe(0);
    }
    expect(win.queue.length).toBe(0);
  });
});
