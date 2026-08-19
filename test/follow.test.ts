// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import {
  FOLLOW_MAX_PITCH,
  FOLLOW_PITCH_DOWN,
  FOLLOW_PITCH_UP,
  FOLLOW_MAX_YAW,
  FOLLOW_MORPH,
  followEase,
  followLook,
  mountEngine,
} from "../src/engine";
import { MAX_PITCH_DRIFT, MAX_YAW_DRIFT } from "../src/bloub/face";
import { PITCH } from "../src/bloub/gaze";
import { BotEngine } from "../src/bloub/engine";
import { _layout } from "../src/bolota";
import { _safeGaze, _seededSilhouette } from "../src/engine";
import { radiusAtAngle } from "../src/bloub/shape";
import { superellipseProfile } from "../src/bloub/shape";

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
 * `parts()` reads (defs, back, bodyPath, eyes, front). */
function eyes(svg: FakeElement) {
  return svg.children[0]!.children[3]!.children;
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
    // (pinned separately by `test/gaze.test.ts`'s "follows the cursor in the
    // right sense" against `lookTarget` itself) — what this test owns is that
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
    // pointer-tracking duration) drives `followEase` (CSS `ease`,
    // `cubic-bezier(0.25, 0.1, 0.25, 1)`), not `BotEngine`'s own
    // `easeInOutCubic` — see `aimGaze`'s own doc comment for why the curve
    // is driven here instead of through `BotEngine.setLook`'s built-in
    // morph. Sampling partway through the 80ms window (48ms) should be
    // clearly short of the final target. Sampling right at the jump would
    // not show this: that first tick is the same one `aimGaze` retargets
    // `from`/`to`/`retargetAt` on, and `easedNow` at that exact instant
    // reads `k = 0` (no time has passed *since* the retarget yet) — the
    // curve only starts becoming visible on the frames after.
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

  test("responds fast (CSS ease's own high initial slope, unlike easeInOutCubic's near-zero one)", () => {
    const { doc, svg, handle } = mount();
    const view = doc.defaultView;
    handle.follow("window");

    move(doc, view, view.innerWidth / 2, view.innerHeight / 2);
    run(doc, 500);
    const start = eyeX(svg as unknown as FakeElement)!;

    // The tick `move()` lands in is the one `aimGaze` registers the
    // retarget on — `easedNow` there reads `k = 0` (no time has passed
    // *since* `retargetAt` within that same tick), so the curve's own
    // response only becomes visible starting the tick after.
    move(doc, view, view.innerWidth, view.innerHeight / 2);
    run(doc, 32); // one tick to register the retarget, one more to move
    const oneFrameIn = eyeX(svg as unknown as FakeElement)!;
    run(doc, 300);
    const settled = eyeX(svg as unknown as FakeElement)!;

    const totalSweep = Math.abs(settled - start);
    const progressed = Math.abs(oneFrameIn - start);
    // `easeInOutCubic` at the same k (~0.2, one 16ms tick into an 80ms
    // morph) would be under 3% of the way there (4 * 0.2^3); CSS `ease` is
    // already ~30% (see `followEase(0.2)`, pinned below) — this is the gap
    // that made the pre-switch curve read as slow to start.
    expect(progressed).toBeGreaterThan(totalSweep * 0.15);
  });
});

describe("followEase — CSS ease, cubic-bezier(0.25, 0.1, 0.25, 1)", () => {
  test("endpoints and a handful of pinned reference values", () => {
    expect(followEase(0)).toBe(0);
    expect(followEase(1)).toBe(1);
    // Values from evaluating this exact cubic-bezier solve independently;
    // 0.5 -> ~0.802 is the commonly-cited midpoint value for CSS `ease`.
    expect(followEase(0.1)).toBeCloseTo(0.0948, 3);
    expect(followEase(0.2)).toBeCloseTo(0.2952, 3);
    expect(followEase(0.5)).toBeCloseTo(0.8024, 3);
    expect(followEase(0.9)).toBeCloseTo(0.9943, 3);
  });

  test("high initial slope, low final slope (fast start, gentle settle — not symmetric like ease-in-out)", () => {
    const earlyStep = followEase(0.1) - followEase(0);
    const lateStep = followEase(1) - followEase(0.9);
    expect(earlyStep).toBeGreaterThan(lateStep);
    // Comfortably more than half the curve is covered by the halfway point.
    expect(followEase(0.5)).toBeGreaterThan(0.7);
  });
});

describe("handle.follow — composes with idle life", () => {
  test("blink/breathe keep animating while tracking is on", () => {
    const { doc, svg, handle } = mount();
    handle.play("idle", { loop: true });
    handle.follow("window");
    move(doc, doc.defaultView, 700, 300);

    const bodyPath = () => svg.children[0]!.children[2]!.getAttribute("d");
    run(doc, 500);
    const a = bodyPath();
    run(doc, 1000);
    const b = bodyPath();

    // Idle's own breathing/drift (`liveliness()`, keyed off wall-clock
    // `now`) is a continuous function of time independent of `follow` — if
    // tracking silently froze it, two one-second-apart samples would match.
    expect(a).not.toBe(b);
  });

  test("a parked pointer holds the gaze locked, indefinitely — no stillness handback", () => {
    // Arbitration rule: while `following` is true and a pointer position is
    // known, follow owns the eyes completely (`wander: 0`) for as long as
    // the pointer stays put. There used to be a few-seconds stillness
    // timeout that released back to idle on its own; a parked cursor fought
    // idle wander under that rule (the eyes visibly tugged off target
    // between glances) and it's gone — the only way back to idle now is an
    // actual pointerleave, `follow(false)`, or `destroy()`.
    const { doc, svg, handle } = mount();
    handle.play("idle", { loop: true });
    handle.follow("window");
    move(doc, doc.defaultView, 700, 300);
    run(doc, 200); // settled onto the tracked target (well past FOLLOW_MORPH)
    const tracked = eyeXY(svg as unknown as FakeElement)!;

    // Hold the pointer perfectly still (no further `move()` calls) for far
    // longer than the old 3s handback — 10s, with no leave event anywhere.
    run(doc, 10000);
    const stillTracked = eyeXY(svg as unknown as FakeElement)!;

    // Idle wander's own measured travel is ~106.6 viewBox units of x per 10s
    // (`bloub/face.ts`'s wander-amplitude tuning) — if wander had resumed, this
    // gap would be on that order. What's actually still live here is only
    // breathing sway (`liveliness()`'s `driftX`/`driftY`, independent of
    // `wander` and far smaller: amplitude 0.006-0.007 of the body radius),
    // so the bound below is generous for that and nowhere close to wander.
    const drift = Math.hypot(stillTracked.x - tracked.x, stillTracked.y - tracked.y);
    expect(drift).toBeLessThan(3);
  });

  test("pointerleave still releases back to idle wander immediately", () => {
    const { doc, svg, handle } = mount();
    handle.play("idle", { loop: true });
    handle.follow("window");
    move(doc, doc.defaultView, 700, 300);
    run(doc, 200);
    const tracked = eyeXY(svg as unknown as FakeElement)!;

    doc.fire("pointerleave", {});
    run(doc, 500); // past BotEngine's own default release morph (LOOK_MORPH, 0.24s)
    const released = eyeXY(svg as unknown as FakeElement)!;

    expect(released).not.toEqual(tracked);
  });

  test("play('idle') mid-tracking does not clobber the gaze target", () => {
    // `play()` only calls `engine.setState`, never `engine.setLook` — the
    // Look/gaze subsystem and the state/pose subsystem are independent in
    // `BotEngine` (see `bloub/engine.ts`: `setState` touches `cur`/`prev`/
    // `tCur`/`frozenStart` only). Re-playing the *same already-looping*
    // state mid-track should therefore leave the tracked target untouched.
    const { doc, svg, handle } = mount();
    handle.play("idle", { loop: true });
    handle.follow("window");
    move(doc, doc.defaultView, 700, 300);
    run(doc, 200); // settled
    const before = eyeXY(svg as unknown as FakeElement)!;

    handle.play("idle", { loop: true }); // same tick, no time elapsed
    const after = eyeXY(svg as unknown as FakeElement)!;

    expect(after).toEqual(before);

    // And tracking still responds to further pointer movement afterward.
    move(doc, doc.defaultView, 200, 300);
    run(doc, 200);
    const moved = eyeXY(svg as unknown as FakeElement)!;
    expect(moved).not.toEqual(after);
  });

  test("a state with its own gaze choreography (baseFace: false) is not overridden by follow", () => {
    // Matches bloub's own `aim()` gate (`BloubBot.vue`): only a `baseFace`
    // state (`idle`/`swirl` in this port's `states.ts`) wears the tracked
    // Look. Every other state — `wink` here — has its own `pose.gaze` (it
    // visibly winks over its 1.6s duration, so its eye position is NOT
    // static — the comparison below is against an identical un-tracked
    // mount, not against a "should stay still" assumption).
    const withFollow = mount();
    withFollow.handle.play("wink", { loop: true });
    withFollow.handle.follow("window");
    // Far corner: if the gate were missing, this is where the eyes would
    // wrongly be dragged toward instead of wink's own pose.
    move(withFollow.doc, withFollow.doc.defaultView, withFollow.doc.defaultView.innerWidth, 0);

    const reference = mount(); // no follow() call at all
    reference.handle.play("wink", { loop: true });

    run(withFollow.doc, 500); // well past both FOLLOW_MORPH and BotEngine's LOOK_MORPH
    run(reference.doc, 500);

    // If the gate were missing, `withFollow` would be dragged toward the far
    // corner instead of matching wink's own untouched choreography.
    expect(eyeXY(withFollow.svg as unknown as FakeElement)).toEqual(
      eyeXY(reference.svg as unknown as FakeElement),
    );

    // Switching to a baseFace state re-engages tracking at the pointer's
    // current (already-known) position — now it SHOULD diverge from the
    // untracked reference.
    withFollow.handle.play("idle", { loop: true });
    reference.handle.play("idle", { loop: true });
    run(withFollow.doc, 500);
    run(reference.doc, 500);
    expect(eyeXY(withFollow.svg as unknown as FakeElement)).not.toEqual(
      eyeXY(reference.svg as unknown as FakeElement),
    );
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
    // The tracked gaze no longer rides the ambient drift bound: that bound was
    // cut to 0.63 of its old amplitude for being too busy at rest, which is a
    // different question from how far a pointer should be able to pull the
    // eyes. Both axes now ask for more than it, and `_safeGaze` solves what
    // each body can actually wear (see engine.ts).
    expect(FOLLOW_MAX_YAW).toBeGreaterThan(MAX_YAW_DRIFT);
    expect(FOLLOW_MAX_PITCH).toBe(MAX_PITCH_DRIFT);

    const corner = followLook(1, 1);
    expect(Math.abs(corner.yaw)).toBeGreaterThanOrEqual(0.8 * FOLLOW_MAX_YAW);
    // The *deflection* from the rest bias is what must clear 80%, not the raw
    // pitch value. Downward now deflects further than upward, since it travels
    // from the bias all the way to its mirror (see FOLLOW_PITCH_DOWN).
    expect(Math.abs(corner.pitch - PITCH)).toBeGreaterThanOrEqual(0.8 * MAX_PITCH_DRIFT);

    const oppositeCorner = followLook(-1, -1);
    expect(Math.abs(oppositeCorner.yaw)).toBeGreaterThanOrEqual(0.8 * FOLLOW_MAX_YAW);
    expect(Math.abs(oppositeCorner.pitch - PITCH)).toBeGreaterThanOrEqual(0.8 * MAX_PITCH_DRIFT);

    // And a centered pointer should be nowhere near that bound.
    expect(Math.abs(followLook(0, 0).yaw)).toBe(0);
  });

  test("full deflection is reachable, not accidentally clamped short of the bound", () => {
    const corner = followLook(1, 1);
    expect(Math.abs(corner.yaw)).toBe(FOLLOW_MAX_YAW);
    expect(corner.pitch).toBe(FOLLOW_PITCH_DOWN);
    expect(followLook(-1, -1).pitch).toBe(FOLLOW_PITCH_UP);
  });

  /**
   * The bug this pins: the rest bias used to be the CENTRE of one symmetric
   * deflection, so the top of the viewport drove the gaze to `PITCH +
   * MAX_PITCH_DRIFT` while the bottom only reached `PITCH - MAX_PITCH_DRIFT`,
   * a hair under the equator. Reported as "the eyes have difficulty going
   * down". The two extremes are mirror images now, and the eyes actually
   * render that far down: the rendered check is the one that matters, since a
   * pitch number the containment solve then claws back would pass a
   * pitch-only assertion and still look broken.
   */
  test("the gaze reaches far enough down to read as looking down", () => {
    // History, in two corrections. The rest bias used to be the CENTRE of one
    // symmetric deflection, so the bottom of the viewport reached -0.1 degrees:
    // the eyes barely left their resting height. Mirroring it fixed the
    // symmetry but not the distance, because pitch maps to travel
    // non-linearly, and -20 puts the eyes a third of the way down the body
    // ("it stops at half the bolota"). The ask is now deeper than the drift
    // bound, and `_safeGaze` clamps it per seed at mount, so this pins the
    // ceiling rather than what any one body ends up wearing.
    expect(FOLLOW_PITCH_DOWN).toBeLessThan(-FOLLOW_PITCH_UP);
    expect(FOLLOW_PITCH_UP).toBeGreaterThan(PITCH);

    const shape = superellipseProfile(1, 1, 4);
    const eyeY = (look: ReturnType<typeof followLook>) => {
      const engine = new BotEngine(100, "idle", shape);
      engine.setLook(look, 0, 0);
      const eyes = engine.sample(6).eyes;
      return (
        eyes.reduce((sum, { matrix }) => sum + Number(matrix.slice(7, -1).split(",")[5]), 0) /
        eyes.length
      );
    };

    const top = eyeY(followLook(0, -1));
    const bottom = eyeY(followLook(0, 1));
    // screen y grows downward: bottom of the viewport puts the eyes low
    expect(top).toBeLessThan(0);
    // Two thirds of the way to the edge of a round body, where -20 managed a
    // third and the original mapping managed a tenth of a pixel.
    expect(bottom).toBeGreaterThan(60);
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

describe("handle.follow — eye-pair coherence (both eyes move as one head, not independently)", () => {
  /**
   * "Eyes feel disjoint" report: `eyePoses` (`bloub/face.ts`) derives BOTH
   * eyes from one `HeadGaze`, so they cannot diverge on the gaze axis alone
   * -- but each eye is then independently rescaled by `bodyRadius(e.x, e.y)`
   * (`bloub/engine.ts`), the LOCAL body radius in that eye's own direction.
   * For an irregular seed that term can vary eye to eye, which is a real,
   * inherent property of "eyes painted on a body silhouette that isn't a
   * perfect sphere" (bloub's own built-in profiles have it too) rather than
   * a bug on its own -- what a regression WOULD look like is the pair
   * coming apart much further than that fit term alone explains, or ceasing
   * to move together at all. These lock in "together enough": inter-eye
   * distance stays within a bounded band of its at-rest value across a full
   * pointer sweep, for both a round seed and the most irregular one this
   * repo's own trait ranges produce.
   */
  function eyeXY1(svg: FakeElement) {
    const m = eyes(svg)[1]?.getAttribute("transform");
    if (!m) return null;
    const nums = /matrix\(([^,]+),([^,]+),([^,]+),([^,]+),(-?[\d.]+),(-?[\d.]+)\)/.exec(m);
    return nums ? { x: +nums[5]!, y: +nums[6]! } : null;
  }
  function pairDistance(svg: FakeElement) {
    const a = eyeXY(svg);
    const b = eyeXY1(svg);
    if (!a || !b) return null;
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  // "0" is this repo's own most irregular seed by petal count (measured
  // against the trait catalog, see `test/eyefit.test.ts`'s own seed
  // choices for the same reasoning) -- the seed most likely to expose the
  // per-eye `bodyRadius` fit term's own variation, deliberately alongside a
  // plain round one.
  for (const seed of ["follow-seed", "0"]) {
    test(`"${seed}": inter-eye distance stays within a bounded band of rest across a full pointer sweep`, () => {
      const { doc, svg, handle } = mount(seed);
      handle.follow("window");

      move(doc, doc.defaultView, 100, 100); // dead center
      run(doc, 500);
      const rest = pairDistance(svg as unknown as FakeElement)!;
      expect(rest).not.toBeNull();

      const sweep: [number, number][] = [
        [10, 10], [100, 10], [190, 10],
        [10, 100], [190, 100],
        [10, 190], [100, 190], [190, 190],
      ];
      const distances: number[] = [];
      for (const [x, y] of sweep) {
        move(doc, doc.defaultView, x, y);
        run(doc, 300); // let the look-retarget morph settle
        const d = pairDistance(svg as unknown as FakeElement);
        expect(d, `${seed} at (${x},${y})`).not.toBeNull();
        distances.push(d!);
      }

      for (const d of distances) {
        // A genuinely disjoint pair (independent per-eye motion, not a
        // shared-fit wobble) swings far outside this -- bloub's own eyes,
        // on a body that IS a perfect sphere, would hold near 1.0 exactly.
        expect(d, `${seed}: pair distance vs rest (${rest.toFixed(2)})`).toBeGreaterThan(rest * 0.5);
        expect(d, `${seed}: pair distance vs rest (${rest.toFixed(2)})`).toBeLessThan(rest * 1.8);
      }
    });
  }
});

describe("_safeGaze — the silhouette decides how far the eyes may travel", () => {
  // The bug this exists for: the deflection was a constant, and a constant is
  // wrong per seed. A pill-shaped body drove its eyes out of its own bottom
  // while a round one had room to spare. Reported from a screen recording,
  // missed by every numeric test because they all checked where an eye's
  // CENTRE landed, and an eye is about 15 units tall on a 100-unit body.
  const SEEDS = {
    capsule: "seed-6",
    round: "seed-3",
    triangle: "seed-31",
    droplet: "seed-7",
    boxy: "seed-1",
    hexagon: "seed-12",
    sun: "seed-70",
    cloud: "seed-0",
    nub: "seed-5",
    organic: "seed-2",
  } as const;

  /** Every corner of both eyes, in body units, at a given gaze. */
  function eyeCorners(seed: string, yaw: number, pitch: number, t: number) {
    const l = _layout(seed) as never as {
      body: { rx: number };
      draw?: (b: never) => string;
      petals: { cx: number; cy: number; r: number }[];
      extra: string[];
    };
    const shape = _seededSilhouette(l.body as never, l.draw as never, l.petals, l.extra);
    const engine = new BotEngine(l.body.rx, "idle", shape);
    engine.setLook({ yaw, pitch, mix: 1, spin: 0, wander: 0 }, 0, 0);
    const out: { x: number; y: number; edge: number }[] = [];
    for (const { d, matrix } of engine.sample(t).eyes) {
      const [a, b, c, dd, e, f] = matrix.slice(7, -1).split(",").map(Number) as number[];
      const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = a! * nums[i]! + c! * nums[i + 1]! + e!;
        const y = b! * nums[i]! + dd! * nums[i + 1]! + f!;
        out.push({ x, y, edge: radiusAtAngle(shape, Math.atan2(y, x)) * l.body.rx });
      }
    }
    return out;
  }

  function limitsFor(seed: string) {
    const l = _layout(seed) as never as {
      body: { rx: number };
      draw?: (b: never) => string;
      petals: { cx: number; cy: number; r: number }[];
      extra: string[];
    };
    return _safeGaze(l.body.rx, _seededSilhouette(l.body as never, l.draw as never, l.petals, l.extra));
  }

  for (const [shape, seed] of Object.entries(SEEDS)) {
    test(`"${shape}" keeps the whole eye inside itself at every solved extreme`, () => {
      const limit = limitsFor(seed);
      const corners: [number, number][] = [
        [0, limit.down],
        [0, limit.up],
        [limit.yaw, PITCH],
        [-limit.yaw, PITCH],
        // and the real corner, where the ellipse is what saves it
        [limit.yaw * 0.7, limit.down * 0.7],
        [-limit.yaw * 0.7, limit.up * 0.7],
      ];
      for (const [yaw, pitch] of corners) {
        for (const t of [0.4, 2.6, 7.9, 21.3]) {
          for (const { x, y, edge } of eyeCorners(seed, yaw, pitch, t)) {
            expect(Math.hypot(x, y) / edge, `${shape} yaw=${yaw} pitch=${pitch} t=${t}`).toBeLessThan(1);
          }
        }
      }
    });
  }

  test("a flat body is given less than a round one, and every body gets something", () => {
    const capsule = limitsFor(SEEDS.capsule);
    const round = limitsFor(SEEDS.round);
    // The capsule is nearly two to one, so it runs out of room downward first.
    expect(Math.abs(capsule.down)).toBeLessThan(Math.abs(round.down));
    for (const seed of Object.values(SEEDS)) {
      const l = limitsFor(seed);
      expect(l.yaw).toBeGreaterThan(5);
      expect(Math.abs(l.down)).toBeGreaterThan(5);
      expect(l.up).toBeGreaterThan(5);
    }
  });
});
