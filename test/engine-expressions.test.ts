import { describe, expect, test } from "bun:test";
import { mountEngine } from "../src/engine";

/**
 * Minimal fake SVG DOM, trimmed to exactly what `mountEngine` touches --
 * same shape as `engine.test.ts`'s harness (not imported from there: that
 * file's classes are module-local, and duplicating ~25 lines here is
 * cheaper than exporting a test-only surface from a non-test file).
 */
class FakeElement {
  tagName: string;
  attrs = new Map<string, string>();
  children: FakeElement[] = [];
  ownerDocument: FakeDocument;
  constructor(tag: string, doc: FakeDocument) {
    this.tagName = tag;
    this.ownerDocument = doc;
  }
  setAttribute(k: string, v: unknown) {
    this.attrs.set(k, String(v));
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
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

const clocks = new Map<FakeDocument, { now: number }>();

function mount(name = "expression-test-seed") {
  const doc = new FakeDocument();
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  (svg as unknown as { ownerDocument: FakeDocument }).ownerDocument = doc;
  const handle = mountEngine(svg as unknown as SVGSVGElement, name);
  clocks.set(doc, { now: 0 });
  return { doc, svg: svg as unknown as FakeElement, handle };
}

/** Fires every queued rAF callback once, at the doc's own running clock. */
function step(doc: FakeDocument, deltaMs: number) {
  const clock = clocks.get(doc)!;
  clock.now += deltaMs;
  const due = doc.defaultView.queue;
  doc.defaultView.queue = [];
  for (const cb of due) cb(clock.now);
}

/** Steps `totalMs` of fake time at a real rAF-ish cadence, mirroring
 * `engine.test.ts`'s own `run()` -- a single giant jump would get clamped
 * by `tick()`'s 34ms delta cap and under-run the intended duration. */
function run(doc: FakeDocument, totalMs: number, frameMs = 16) {
  for (let t = 0; t < totalMs; t += frameMs) step(doc, Math.min(frameMs, totalMs - t));
}

/** First eye `<path>`'s `d` attribute -- root's children are
 * [defs, back, bodyPath, eyes, front] (`engine.ts`'s `mountEngine`, fixed
 * append order). */
function eyeD(svg: FakeElement): string | null {
  const root = svg.children[0]!;
  const eyes = root.children[3]!;
  return eyes.children[0]!.getAttribute("d");
}

describe("expressions on the engine handle", () => {
  test("all 16 bloub expression ids are present, bloub's own array order", () => {
    const { handle } = mount();
    expect(handle.expressions).toEqual([
      "neutre", "attentif", "surpris", "excite", "heureux", "hilare",
      "colere", "triste", "effraye", "mefiant", "confus", "curieux",
      "fier", "timide", "blase", "somnolent",
    ]);
    expect(handle.expressions).toHaveLength(16);
  });

  test("setExpression throws on an unknown id", () => {
    const { handle } = mount();
    expect(() => handle.setExpression("nonexistent")).toThrow(/unknown bloub expression/);
  });

  test("setExpression eases the eye path within 500ms of fake rAF, on idle", () => {
    const { doc, svg, handle } = mount();
    handle.play("idle", { loop: true });
    run(doc, 50); // settle onto idle's own first frame past mount's t=0 sample
    const before = eyeD(svg);

    handle.setExpression("somnolent"); // sleepy: half-shut, tilted eyes -- far from neutral
    run(doc, 500); // > BotEngine.SHAPE_MORPH (0.45s): fully eased in

    const after = eyeD(svg);
    expect(after).not.toBe(before);
  });

  test("setExpression(null) clears the override, eases back toward the state's own eyes", () => {
    const { doc, svg, handle } = mount();
    handle.play("idle", { loop: true });
    run(doc, 50);

    handle.setExpression("somnolent");
    run(doc, 500);
    const held = eyeD(svg);

    handle.setExpression(null);
    run(doc, 500);
    const cleared = eyeD(svg);

    expect(cleared).not.toBe(held);
  });
});
