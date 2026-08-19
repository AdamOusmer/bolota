import { describe, expect, test } from "bun:test";
import { BotEngine } from "../src/bloub/engine";
import { EXPRESSION_BY_ID } from "../src/bloub/expressions";
import { eyePoses } from "../src/bloub/face";
import { STATE_BY_ID } from "../src/bloub/states";
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
  test("all 16 bloub expression ids are present, bloub's own array order with `neutre` split to `aside`", () => {
    const { handle } = mount();
    expect(handle.expressions).toEqual([
      "aside", "attentive", "surprised", "excited", "happy", "laughing",
      "angry", "sad", "scared", "suspicious", "confused", "curious",
      "proud", "shy", "unimpressed", "sleepy",
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

    handle.setExpression("sleepy"); // sleepy: half-shut, tilted eyes -- far from neutral
    run(doc, 500); // > BotEngine.SHAPE_MORPH (0.45s): fully eased in

    const after = eyeD(svg);
    expect(after).not.toBe(before);
  });

  test("setExpression(null) clears the override, eases back toward the state's own eyes", () => {
    const { doc, svg, handle } = mount();
    handle.play("idle", { loop: true });
    run(doc, 50);

    handle.setExpression("sleepy");
    run(doc, 500);
    const held = eyeD(svg);

    handle.setExpression(null);
    run(doc, 500);
    const cleared = eyeD(svg);

    expect(cleared).not.toBe(held);
  });
});

describe("expressions compose with play/burst/comet — state keeps body/decor/alpha, expression wins eye pose", () => {
  const R = 100;
  const seed = Array.from({ length: 64 }, (_, i) => 1 + 0.2 * Math.sin(i));
  const scared = EXPRESSION_BY_ID.get("scared")!;

  for (const stateId of ["play", "burst", "comet"] as const) {
    test(`${stateId}: a chosen expression changes eye pose but not bodyPath or eye alpha`, () => {
      // `t` values spanning each state's own choreography, always short of
      // its `duration` so both engines are still on the same iteration.
      for (const t of [0.05, 0.9, 1.5]) {
        const plain = new BotEngine(R, stateId, seed);
        const expressed = new BotEngine(R, stateId, seed);
        expressed.setExpression(scared, 0);

        const plainFrame = plain.sample(t);
        const expressedFrame = expressed.sample(t);

        // Body/decor/timing: this state's own, untouched by the expression.
        expect(expressedFrame.bodyPath).toBe(plainFrame.bodyPath);
        expect(expressedFrame.arcs).toEqual(plainFrame.arcs);
        expect(expressedFrame.dots).toEqual(plainFrame.dots);

        // Eyes: same count and alpha (collapse-fade ownership stays with
        // the state, per `burst`/`comet`'s own `acceptsExpression` comment)
        // — but a different pose whenever an eye is actually visible on
        // both sides to compare (deep mid-collapse can cull it on both,
        // which is not a pose disagreement to fail on).
        expect(expressedFrame.eyes.length).toBe(plainFrame.eyes.length);
        expressedFrame.eyes.forEach((e, i) => {
          expect(e.alpha).toBeCloseTo(plainFrame.eyes[i]!.alpha, 6);
        });
        if (plainFrame.eyes.length > 0) {
          expect(expressedFrame.eyes[0]!.matrix).not.toBe(plainFrame.eyes[0]!.matrix);
        }
      }
    });
  }

  test("burst/comet: expression cannot force the eyes visible through full collapse", () => {
    for (const stateId of ["burst", "comet"] as const) {
      const def = STATE_BY_ID.get(stateId)!;
      // Deepest collapse per each state's own measured curve (`states.ts`):
      // burst's `collapseFrac` saturates by t=0.7, comet's by t=0.55.
      const deepT = stateId === "burst" ? 0.7 : 0.55;
      expect(def.pose(deepT).eyeAlpha).toBeLessThan(0.02);

      const engine = new BotEngine(R, stateId, seed);
      engine.setExpression(scared, 0);
      expect(engine.sample(deepT).eyes).toHaveLength(0);
    }
  });

  test("states that own their eyes ignore setExpression entirely (wink, thinking, orbit)", () => {
    for (const stateId of ["wink", "thinking", "orbit"] as const) {
      const def = STATE_BY_ID.get(stateId)!;
      expect(def.baseFace).toBe(false);
      expect(def.acceptsExpression).toBeUndefined();

      const plain = new BotEngine(R, stateId, seed);
      const expressed = new BotEngine(R, stateId, seed);
      expressed.setExpression(scared, 0);
      for (const t of [0.1, 0.5, 1.0]) {
        expect(expressed.sample(t).eyes).toEqual(plain.sample(t).eyes);
      }
    }
  });
});

describe("`idle` (no expression set) is the true straight-ahead resting face", () => {
  // There is no `neutral` expression any more: the base/default face is
  // reachable exactly one way, the `idle` STATE with no expression held
  // (`../src/bloub/expressions.ts`'s header comment). These checks used to
  // read a removed `neutral` expression's `gaze`/`split`; `idle.pose()`'s
  // own `gaze` is the same values now.
  test("gaze has no yaw/pitch/roll offset", () => {
    const idle = STATE_BY_ID.get("idle")!;
    const gaze = idle.pose(0).gaze;
    expect(gaze.yaw).toBe(0);
    expect(gaze.pitch).toBe(0);
    expect(gaze.roll).toBe(0);
  });

  test("both eye centers are equidistant from the body's vertical axis (x=0), mirrored", () => {
    const idle = STATE_BY_ID.get("idle")!;
    const pose = idle.pose(0);
    const [inner, outer] = eyePoses(pose.gaze, 1, pose.split);
    // mirrored around x=0: same |x|, opposite sign
    expect(inner!.x).toBeCloseTo(-outer!.x, 10);
    // and dead level: no vertical (up/down) gaze offset either
    expect(inner!.y).toBeCloseTo(0, 10);
    expect(outer!.y).toBeCloseTo(0, 10);
  });

  test("`aside` (bloub's original off-center `neutre` pose) is NOT mirrored around x=0 -- that's the bug `idle`'s own gaze fixes", () => {
    const aside = EXPRESSION_BY_ID.get("aside")!;
    const [inner, outer] = eyePoses(aside.gaze, 1, aside.split);
    // both eyes land on the same side of the axis, proving the drift
    expect(Math.sign(inner!.x)).toBe(Math.sign(outer!.x));
    expect(inner!.x).not.toBeCloseTo(-outer!.x, 1);
  });
});
