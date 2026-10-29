import { describe, expect, test } from "bun:test";

import { mountEngine } from "../src/engine";

class FakeElement {
  tagName: string;
  attrs = new Map<string, string>();
  children: FakeElement[] = [];
  ownerDocument: FakeDocument;
  attributeWrites = 0;
  childListWrites = 0;
  constructor(tag: string, doc: FakeDocument) {
    this.tagName = tag;
    this.ownerDocument = doc;
  }
  setAttribute(k: string, v: unknown) {
    this.attributeWrites++;
    this.attrs.set(k, String(v));
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  appendChild(c: FakeElement) {
    this.children.push(c);
    return c;
  }
  append(...cs: FakeElement[]) {
    this.children.push(...cs);
  }
  replaceChildren(...cs: FakeElement[]) {
    this.childListWrites++;
    this.children = cs;
  }
  remove() {}
}

class FakeWindow {
  queue: Array<(ms: number) => void> = [];
  matchMedia(_q: string) {
    return { matches: false } as MediaQueryList;
  }
  requestAnimationFrame(cb: (ms: number) => void) {
    this.queue.push(cb);
    return this.queue.length;
  }
  cancelAnimationFrame(_id: number) {
    this.queue.length = 0;
  }
}

class FakeDocument {
  defaultView = new FakeWindow();
  createElementNS(_ns: string, tag: string) {
    return new FakeElement(tag, this);
  }
}

function mountOn(doc: FakeDocument, name: string) {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  const handle = mountEngine(svg as unknown as SVGSVGElement, name);
  return { svg, handle };
}

function step(doc: FakeDocument, now: number) {
  const due = doc.defaultView.queue;
  doc.defaultView.queue = [];
  for (const cb of due) cb(now);
}

const eyesOf = (svg: FakeElement) => svg.children[0]!.children[3]!;

describe("mountEngine frame loop", () => {
  test("bolotas on one window share a single animation frame", () => {
    const doc = new FakeDocument();
    const bots = ["a-seed", "b-seed", "c-seed"].map((name) => mountOn(doc, name));
    bots.forEach(({ handle }) => handle.loop("idle"));
    expect(doc.defaultView.queue.length).toBe(1);

    step(doc, 16);
    expect(doc.defaultView.queue.length).toBe(1);

    bots.forEach(({ handle }) => handle.stop());
    expect(doc.defaultView.queue.length).toBe(0);
  });

  test("a stopped bolota stops ticking while the others keep animating", () => {
    const doc = new FakeDocument();
    const still = mountOn(doc, "still-seed");
    const live = mountOn(doc, "live-seed");
    still.handle.loop("idle");
    live.handle.loop("idle");
    still.handle.stop();

    const bodyOf = (svg: FakeElement) => svg.children[0]!.children[2]!.getAttribute("d");
    const stillBefore = bodyOf(still.svg);
    const liveBefore = bodyOf(live.svg);
    for (let t = 16; t <= 800; t += 16) step(doc, t);

    expect(bodyOf(still.svg)).toBe(stillBefore);
    expect(bodyOf(live.svg)).not.toBe(liveBefore);
  });

  test("frames update the eyes in place instead of rebuilding them", () => {
    const doc = new FakeDocument();
    const { svg, handle } = mountOn(doc, "steady-seed");
    handle.loop("idle");
    step(doc, 16);
    const eyes = eyesOf(svg);
    const nodes = [...eyes.children];
    const rebuilds = eyes.childListWrites;

    for (let t = 32; t <= 800; t += 16) step(doc, t);

    expect(eyes.children).toEqual(nodes);
    expect(eyes.childListWrites).toBe(rebuilds);
  });
});
