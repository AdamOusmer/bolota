import { describe, expect, test } from "bun:test";
import { FOLLOW_MAX_PITCH, FOLLOW_MAX_YAW, FOLLOW_MORPH, followLook, mountEngine } from "../src/engine";
import { MAX_PITCH_DRIFT, MAX_YAW_DRIFT } from "../src/bloub/face";
import { PITCH } from "../src/bloub/gaze";

/**
 * Fake DOM for `handle.follow()` — extends the same minimal-surface idea as
 * `engine-liveliness.test.ts`'s own fake (`createElementNS`/`setAttribute`/
 * `appendChild`/steppable rAF), adding exactly what pointer tracking touches
 * on top: `addEventListener`/`removeEventListener` (so a listener-count spy
 * can prove `follow(false)` actually detaches) and `getBoundingClientRect`
 * (so `nx`/`ny` have a box to normalize against). No real `Event`/DOM classes
 * — listeners are invoked directly with a plain object, since `attachFollow`
 * only ever reads `.pointerType`/`.clientX`/`.clientY` off it.
 */
class Listenable {
  listeners = new Map<string, Set<(e: unknown) => void>>();
  addEventListener(type: string, cb: (e: unknown) => void) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb);
  }
  removeEventListener(type: string, cb: (e: unknown) => void) {
    this.listeners.get(type)?.delete(cb);
  }
  /** Total listener count across every event type — the emptiness check `follow(false)` must satisfy. */
  count() {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
  fire(type: string, detail: unknown) {
    for (const cb of this.listeners.get(type) ?? []) cb(detail);
  }
}

class FakeElement extends Listenable {
  tagName: string;
  attrs = new Map<string, string>();
  children: FakeElement[] = [];
  ownerDocument: FakeDocument;
  rect = { left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200 };
  constructor(tag: string, doc: FakeDocument) {
    super();
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
  getBoundingClientRect() {
    return this.rect;
  }
}
class FakeWindow extends Listenable {
  queue: Array<(ms: number) => void> = [];
  innerWidth = 1000;
  innerHeight = 800;
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
class FakeDocument extends Listenable {
  defaultView = new FakeWindow();
  createElementNS(_ns: string, tag: string) {
    return new FakeElement(tag, this);
  }
}

const clocks = new Map<FakeDocument, { now: number }>();

function mount(name = "follow-seed") {
  const doc = new FakeDocument();
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  (svg as unknown as { ownerDocument: FakeDocument }).ownerDocument = doc;
  const handle = mountEngine(svg as unknown as SVGSVGElement, name);
  clocks.set(doc, { now: 0 });
  return { doc, svg, handle };
}

function step(doc: FakeDocument, deltaMs: number) {
  const clock = clocks.get(doc)!;
  clock.now += deltaMs;
  const due = doc.defaultView.queue;
  doc.defaultView.queue = [];
  for (const cb of due) cb(clock.now);
}

function run(doc: FakeDocument, totalMs: number, frameMs = 16) {
  for (let t = 0; t < totalMs; t += frameMs) step(doc, Math.min(frameMs, totalMs - t));
}

/** The eyes `<g>`'s children — same slot `engine-liveliness.test.ts`'s
 * `parts()` reads (filterDefs, defs, back, bodyPath, eyes, front). */
function eyes(svg: FakeElement) {
  return svg.children[0]!.children[4]!.children;
}

/** x/y-translate (5th/6th `matrix(...)` components) of the first rendered
 * eye — same extraction gaze.test.ts's own `oeilY` uses for the y one. */
function eyeXY(svg: FakeElement) {
  const m = eyes(svg)[0]?.getAttribute("transform");
  if (!m) return null;
  const nums = /matrix\(([^,]+),([^,]+),([^,]+),([^,]+),(-?[\d.]+),(-?[\d.]+)\)/.exec(m);
  return nums ? { x: +nums[5]!, y: +nums[6]! } : null;
}
function eyeX(svg: FakeElement) {
  return eyeXY(svg)?.x ?? null;
}
function eyeY(svg: FakeElement) {
  return eyeXY(svg)?.y ?? null;
}

function move(doc: FakeDocument, view: FakeWindow, x: number, y: number) {
  view.fire("pointermove", { pointerType: "mouse", clientX: x, clientY: y });
}

describe("handle.follow — attach/detach", () => {
  test("off by default: mounting alone adds no pointer listeners", () => {
    const { doc } = mount();
    expect(doc.defaultView.count()).toBe(0);
    expect(doc.count()).toBe(0);
  });

  test('follow("window") attaches pointermove on window and pointerleave on document', () => {
    const { doc, handle } = mount();
    handle.follow("window");
    expect(doc.defaultView.listeners.get("pointermove")?.size).toBe(1);
    expect(doc.listeners.get("pointerleave")?.size).toBe(1);
  });

  test("follow(false) removes every listener it attached", () => {
    const { doc, handle } = mount();
    handle.follow("window");
    expect(doc.defaultView.count() + doc.count()).toBeGreaterThan(0);
    handle.follow(false);
    expect(doc.defaultView.count()).toBe(0);
    expect(doc.count()).toBe(0);
  });

  test("follow(false) stops the gaze from reacting to further pointer moves", () => {
    const { doc, svg, handle } = mount();
    handle.follow("window");
    move(doc, doc.defaultView, 900, 400); // far right
    run(doc, 500); // let the look-retarget morph (0.24s) fully settle
    const trackedX = eyeX(svg as unknown as FakeElement);

    handle.follow(false);
    move(doc, doc.defaultView, 900, 400); // same spot; listener is gone, should be a no-op
    run(doc, 500);
    const afterOff = eyeX(svg as unknown as FakeElement);

    // Once released the gaze relaxes toward the idle/state pose instead of
    // holding the last tracked target — so the frozen-tracking position and
    // the released one must differ.
    expect(afterOff).not.toBe(trackedX);
  });

  test("destroy() also detaches (no leaked listeners past teardown)", () => {
    const { doc, handle } = mount();
    handle.follow("window");
    handle.destroy();
    expect(doc.defaultView.count()).toBe(0);
    expect(doc.count()).toBe(0);
  });

  test('an Element target is used directly, not "window"', () => {
    const { doc, handle } = mount();
    const panel = doc.createElementNS("http://www.w3.org/2000/svg", "g");
    handle.follow(panel as unknown as Element);
    expect(doc.defaultView.listeners.get("pointermove")).toBeUndefined();
    expect(panel.listeners.get("pointermove")?.size).toBe(1);
    handle.follow(false);
    expect(panel.count()).toBe(0);
  });

  test("re-calling follow() swaps the target instead of stacking listeners", () => {
    const { doc, handle } = mount();
    handle.follow("window");
    handle.follow("window");
    expect(doc.defaultView.listeners.get("pointermove")?.size).toBe(1);
  });
});

describe("handle.follow — pointer moves the eyes", () => {
  /**
   * Independent mounts, one per sample: idle's own breathing/drift is a
   * continuous function of wall-clock time (`liveliness()`, seeded per
   * name), so reusing one engine across several sequential moves would let
   * that drift — not the pointer — dominate the small deltas between
   * samples. A fresh mount per point, each run for the same elapsed time
   * from `t = 0`, holds the time-based component identical across samples
   * and isolates the pointer's own effect.
   */
  function eyeAt(px: number, py: number) {
    const { doc, svg, handle } = mount();
    handle.follow("window");
    move(doc, doc.defaultView, px, py);
    run(doc, 500); // past LOOK_MORPH (0.24s): settled on target
    return eyeXY(svg as unknown as FakeElement)!;
  }

  test("synthetic positions move the eyes: left vs. center vs. right are ordered", () => {
    // Box is the fake element's own default rect (200x200 at the origin,
    // center at client (100, 100)); window is 1000x800, so half-width is
    // 500 — `nx = (clientX - 100) / 500`, clamped to [-1, 1].
    const left = eyeAt(-400, 100).x; // nx = -1
    const center = eyeAt(100, 100).x; // nx = 0
    const right = eyeAt(600, 100).x; // nx = +1

    // Sign of screen-space x per yaw is an engine-internal projection detail
    // (pinned separately by `test/gaze.test.ts`'s "suit le curseur dans le
    // bon sens" against `lookTarget` itself) — what this test owns is that
    // the bridge actually wires pointer input through to a visible,
    // monotonic response, in one consistent direction across the whole
    // sweep.
    const risingRight = left < center && center < right;
    const risingLeft = left > center && center > right;
    expect(risingRight || risingLeft).toBe(true);
  });

  test("vertical positions are ordered too (top vs. center vs. bottom)", () => {
    // Same box/window as above but swept on Y; half-height is 400, so
    // `ny = (clientY - 100) / 400`.
    const top = eyeAt(100, -300).y; // ny = -1
    const center = eyeAt(100, 100).y; // ny = 0
    const bottom = eyeAt(100, 500).y; // ny = +1

    const rising = top < center && center < bottom;
    const falling = top > center && center > bottom;
    expect(rising || falling).toBe(true);
  });

  test("pointer leaving the window releases the gaze (no longer pinned to the last position)", () => {
    const { doc, svg, handle } = mount();
    const view = doc.defaultView;
    handle.follow("window");

    move(doc, view, view.innerWidth, view.innerHeight / 2);
    run(doc, 500);
    const tracked = eyeX(svg as unknown as FakeElement);

    doc.fire("pointerleave", {});
    run(doc, 500);
    const released = eyeX(svg as unknown as FakeElement);

    expect(released).not.toBe(tracked);
  });
});

describe("handle.follow — retarget is eased, not a snap", () => {
  test("a big pointer jump passes through an intermediate position before settling", () => {
    const { doc, svg, handle } = mount();
    const view = doc.defaultView;
    handle.follow("window");

    // Rest the gaze at dead center first so the jump below starts from a
    // known, settled position rather than whatever `NO_LOOK` renders.
    move(doc, view, view.innerWidth / 2, view.innerHeight / 2);
    run(doc, 500);
    const start = eyeX(svg as unknown as FakeElement)!;

    // Jump straight to the far edge — `follow`'s own retarget constant
    // (`FOLLOW_MORPH` in `src/engine.ts`, 0.08s — a short, dedicated
    // pointer-tracking duration, not bloub's own 0.24s ambient
    // `LOOK_MORPH`) means the target is fully reached by ~80ms. Sampling
    // partway through that window (48ms) should be clearly short of the
    // final target. Sampling right at the jump would not show this: that
    // first tick is the same one `aimGaze` calls `engine.setLook` on, and
    // `BotEngine.sample` at that exact instant reads `k = 0` (no time has
    // passed *since* the call yet) — the retarget only starts becoming
    // visible on the frames after.
    move(doc, view, view.innerWidth, view.innerHeight / 2);
    run(doc, 48);
    const early = eyeX(svg as unknown as FakeElement)!;
    run(doc, 300);
    const settled = eyeX(svg as unknown as FakeElement)!;

    expect(early).not.toBe(start);
    expect(early).not.toBe(settled);
    // `early` sits strictly between the start and end of the retarget,
    // whichever screen-space direction that sweep runs in — a snap would
    // instead put `early` right next to (or equal to) `settled`.
    const between =
      (start <= early && early <= settled) || (settled <= early && early <= start);
    expect(between).toBe(true);
  });
});

describe("handle.follow — composes with idle life", () => {
  test("blink/breathe keep animating while tracking is on", () => {
    const { doc, svg, handle } = mount();
    handle.play("idle", { loop: true });
    handle.follow("window");
    move(doc, doc.defaultView, 700, 300);

    const bodyPath = () => svg.children[0]!.children[3]!.getAttribute("d");
    run(doc, 500);
    const a = bodyPath();
    run(doc, 1000);
    const b = bodyPath();

    // Idle's own breathing/drift (`liveliness()`, keyed off wall-clock
    // `now`) is a continuous function of time independent of `follow` — if
    // tracking silently froze it, two one-second-apart samples would match.
    expect(a).not.toBe(b);
  });

  test("idle wander resumes on its own after the pointer holds still", () => {
    const { doc, svg, handle } = mount();
    handle.play("idle", { loop: true });
    handle.follow("window");
    move(doc, doc.defaultView, 700, 300);
    run(doc, 200); // settled onto the tracked target (well past FOLLOW_MORPH)
    const tracked = eyeXY(svg as unknown as FakeElement)!;

    // Hold the pointer perfectly still (no further `move()` calls) well
    // past `FOLLOW_IDLE_RESUME_DELAY` (3s) — `aimGaze` should release the
    // gaze back to idle on its own, without ever seeing a pointerleave.
    run(doc, 3500);
    const resumed = eyeXY(svg as unknown as FakeElement)!;

    expect(resumed).not.toEqual(tracked);
  });
});

describe("handle.follow — premium tuning: wide deflection, low latency", () => {
  /**
   * `followLook` is pure (no DOM) — tested directly here, the same split
   * `gaze.ts`'s own `lookTarget` uses, independent of the DOM-bridge tests
   * above. Coordinator ask: "pointer at viewport corner -> yaw/pitch >= 80%
   * of max" — `nx`/`ny` are already clamped to [-1, 1] by `aimGaze` before
   * reaching `followLook`, so a viewport corner is exactly `nx, ny = +-1`.
   */
  test("corner deflection reaches at least 80% of the proven-safe max drift bound", () => {
    // Deflection now rides bloub/face.ts's MAX_YAW_DRIFT/MAX_PITCH_DRIFT
    // (16/16deg, the same bound idle wander is proven safe against) rather
    // than gaze.ts's own, narrower YAW_MAX/PITCH_MAX (16/13deg) — see
    // `FOLLOW_MAX_YAW`/`FOLLOW_MAX_PITCH`'s own doc comment in engine.ts.
    expect(FOLLOW_MAX_YAW).toBe(MAX_YAW_DRIFT);
    expect(FOLLOW_MAX_PITCH).toBe(MAX_PITCH_DRIFT);

    const corner = followLook(1, 1);
    expect(Math.abs(corner.yaw)).toBeGreaterThanOrEqual(0.8 * MAX_YAW_DRIFT);
    // pitch is PITCH - ny * FOLLOW_MAX_PITCH; the *deflection* from the
    // rest bias is what must clear 80%, not the raw pitch value itself.
    expect(Math.abs(corner.pitch - PITCH)).toBeGreaterThanOrEqual(0.8 * MAX_PITCH_DRIFT);

    const oppositeCorner = followLook(-1, -1);
    expect(Math.abs(oppositeCorner.yaw)).toBeGreaterThanOrEqual(0.8 * MAX_YAW_DRIFT);
    expect(Math.abs(oppositeCorner.pitch - PITCH)).toBeGreaterThanOrEqual(0.8 * MAX_PITCH_DRIFT);

    // And a centered pointer should be nowhere near that bound.
    expect(Math.abs(followLook(0, 0).yaw)).toBe(0);
  });

  test("full deflection is reachable, not accidentally clamped short of the bound", () => {
    const corner = followLook(1, 1);
    expect(Math.abs(corner.yaw)).toBe(MAX_YAW_DRIFT);
    expect(Math.abs(corner.pitch - PITCH)).toBe(MAX_PITCH_DRIFT);
  });

  test("FOLLOW_MORPH is a short, dedicated pointer-tracking constant, not bloub's ambient LOOK_MORPH (0.24s)", () => {
    expect(FOLLOW_MORPH).toBeLessThan(0.15);
    expect(FOLLOW_MORPH).toBeGreaterThan(0);
  });

  test("gaze visibly starts moving well under 100ms after a pointer jump", () => {
    const { doc, svg, handle } = mount();
    handle.follow("window");

    move(doc, doc.defaultView, doc.defaultView.innerWidth / 2, doc.defaultView.innerHeight / 2);
    run(doc, 500); // settle at dead center first
    const start = eyeXY(svg as unknown as FakeElement)!;

    move(doc, doc.defaultView, doc.defaultView.innerWidth, doc.defaultView.innerHeight / 2);
    run(doc, 64); // well under the 100ms latency bar
    const soon = eyeXY(svg as unknown as FakeElement)!;

    expect(soon).not.toEqual(start);
  });
});
