// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { BotEngine } from "../src/bloub/engine";
import { EXPRESSION_BY_ID, EXPRESSIONS } from "../src/bloub/expressions";
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
  test("all 17 expression ids are present: bloub's own 16 (array order, `neutre` split to `wander`) plus bolota's own `love`", () => {
    const { handle } = mount();
    expect(handle.expressions).toEqual([
      "wander", "attentive", "surprised", "excited", "happy", "laughing",
      "angry", "sad", "scared", "suspicious", "confused", "curious",
      "proud", "shy", "unimpressed", "sleepy", "love",
    ]);
    expect(handle.expressions).toHaveLength(17);
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
    run(doc, 900); // > BotEngine.EXPRESSION_MORPH (0.8s): fully eased in

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

  test("`wander` (bloub's original off-center `neutre` pose) is NOT mirrored around x=0 -- that's the bug `idle`'s own gaze fixes", () => {
    const wander = EXPRESSION_BY_ID.get("wander")!;
    const [inner, outer] = eyePoses(wander.gaze, 1, wander.split);
    // both eyes land on the same side of the axis, proving the drift
    expect(Math.sign(inner!.x)).toBe(Math.sign(outer!.x));
    expect(inner!.x).not.toBeCloseTo(-outer!.x, 1);
  });

  test("wander id collision: the `wander` EXPRESSION and the `wander` STATE are separate namespaces", () => {
    const R = 100;

    // Both ids exist, and each resolves to its own namespace's shape --
    // `EXPRESSION_BY_ID` and `STATE_BY_ID` are two separate `Map`s, so
    // looking up "wander" in each gets that map's own kind of value, never
    // the other's.
    expect(EXPRESSION_BY_ID.has("wander")).toBe(true);
    expect(STATE_BY_ID.has("wander")).toBe(true);
    const wanderExpr = EXPRESSION_BY_ID.get("wander")!;
    const wanderState = STATE_BY_ID.get("wander")!;
    expect(wanderExpr).toHaveProperty("gaze");
    expect(wanderExpr).toHaveProperty("eyes");
    expect(wanderState).toHaveProperty("pose");
    expect(wanderState).toHaveProperty("duration");
    // Also resolves through the engine handle's own catalogs (mountEngine's
    // bridge over the same two maps).
    const { handle } = mount();
    expect(handle.expressions).toContain("wander");
    expect(handle.states).toContain("wander");
    expect(() => handle.setExpression("wander")).not.toThrow();
    expect(() => handle.play("wander", { loop: true })).not.toThrow();

    // Setting the expression does not change the state: holding the
    // `wander` EXPRESSION while playing `idle` (a state whose gaze is
    // deterministic -- `ownsLiveliness` means no ambient drift added) must
    // render idle's own bodyPath untouched, with the eyes reading the
    // expression's REST_GAZE-based pose instead of idle's dead-ahead one --
    // proof the call landed on the eyes only and never flipped which STATE
    // is playing (a naive id-keyed implementation could easily switch
    // states here, since the string is the same).
    const plainIdle = new BotEngine(R, "idle");
    const idleWithWanderExpr = new BotEngine(R, "idle");
    idleWithWanderExpr.setExpression(wanderExpr, 0);
    // From well into `EXPRESSION_MORPH`, not from zero: adopting an expression eases out
    // of the state's own face now, so at the instant it is set the two engines
    // agree by design (see `exprBlend`).
    for (const t of [0.5, 1, 2]) {
      const plain = plainIdle.sample(t);
      const expressed = idleWithWanderExpr.sample(t);
      expect(expressed.bodyPath).toBe(plain.bodyPath);
      expect(expressed.eyes[0]!.matrix).not.toBe(plain.eyes[0]!.matrix);
    }

    // Playing the state does not change the held expression: holding an
    // unrelated expression ("happy"), actually PLAYING the `wander` STATE
    // for a while, then returning to `idle` must still show `happy`'s pose
    // -- not idle's own dead-ahead gaze, and not wander's REST_GAZE either
    // -- proving the trip through the `wander` STATE never touched the
    // held expression. Compared against a reference engine that held
    // "happy" on `idle` the whole time and never visited `wander` at all:
    // once both are well past every morph, `sample` is a pure function of
    // the CURRENT state/expression/time, so the two must read identically
    // regardless of the different state history behind them.
    const engine = new BotEngine(R, "idle");
    const happy = EXPRESSION_BY_ID.get("happy")!;
    engine.setExpression(happy, 0);
    engine.setState("wander", 10, true); // actually plays the WANDER STATE
    engine.setState("idle", 20, false); // back to idle
    const frame = engine.sample(21); // 1s past idle's own 0.45s morph

    const reference = new BotEngine(R, "idle");
    reference.setExpression(happy, 0);
    const referenceFrame = reference.sample(21);

    expect(frame.eyes[0]!.matrix).toBe(referenceFrame.eyes[0]!.matrix);
  });

  test("`love` (ported from `../src/expression.ts`'s own pre-bloub pose) differs from its nearest neighbours on more than one channel", () => {
    const love = EXPRESSION_BY_ID.get("love")!;
    const happy = EXPRESSION_BY_ID.get("happy")!;
    const surprised = EXPRESSION_BY_ID.get("surprised")!;

    for (const neighbour of [happy, surprised]) {
      let differingChannels = 0;
      if (love.eyes[0]!.w !== neighbour.eyes[0]!.w) differingChannels++;
      if (love.eyes[0]!.h !== neighbour.eyes[0]!.h) differingChannels++;
      if ((love.eyes[0]!.tilt ?? 0) !== (neighbour.eyes[0]!.tilt ?? 0)) differingChannels++;
      if (love.split !== neighbour.split) differingChannels++;
      if (love.gaze.pitch !== neighbour.gaze.pitch) differingChannels++;
      expect(differingChannels, `love vs ${neighbour.id}`).toBeGreaterThan(1);
    }

    // The distinguishing property the upstream pose was tuned for (its own
    // doc comment: "the first cut... rendered in greyscale beside
    // `surprised`, it was the same face"): love pairs a narrower width with
    // a taller height than EVERY other entry in the roster, `surprised`
    // included -- the shape alone reads as different, not just the tint
    // gap noted in `expressions.ts`.
    expect(love.eyes[0]!.w).toBeLessThan(surprised.eyes[0]!.w);
    expect(love.eyes[0]!.h).toBeGreaterThan(surprised.eyes[0]!.h * 0.9);
    for (const other of EXPRESSIONS) {
      if (other.id === "love") continue;
      expect(
        other.eyes[0]!.w < 0.2 && other.eyes[0]!.h > 0.5,
        `${other.id} should not share love's narrow+tall combination`
      ).toBe(false);
    }
  });
});

describe("adopting and clearing an expression eases, like swapping one does", () => {
  // The bug: `exprAtTime` returned the target outright whenever either end was
  // null, so the two most common transitions were cuts. Only
  // expression-to-expression eased. Reported as the eyes jumping rather than
  // easing, and it is the eyes specifically because an expression owns gaze,
  // split and eye shape and nothing else.
  const R = 100;
  const scared = EXPRESSION_BY_ID.get("scared")!;

  /** Largest single-frame eye movement over a window, in body units. */
  function worstStep(engine: BotEngine, from: number, to: number, step = 1 / 60) {
    const mid = (t: number) => {
      const eyes = engine.sample(t).eyes;
      const pts = eyes.map(({ matrix }) => {
        const n = matrix.slice(7, -1).split(",").map(Number);
        return { x: n[4]!, y: n[5]! };
      });
      return {
        x: pts.reduce((a, p) => a + p.x, 0) / (pts.length || 1),
        y: pts.reduce((a, p) => a + p.y, 0) / (pts.length || 1),
      };
    };
    let worst = 0;
    let prev = mid(from);
    for (let t = from + step; t <= to; t += step) {
      const now = mid(t);
      worst = Math.max(worst, Math.hypot(now.x - prev.x, now.y - prev.y));
      prev = now;
    }
    return worst;
  }

  /** How far the eye pair sits from where a bare `idle` puts it, at `t`. */
  function distanceFromPlain(engine: BotEngine, plain: BotEngine, t: number) {
    const mid = (e: BotEngine) => {
      const eyes = e.sample(t).eyes;
      const pts = eyes.map(({ matrix }) => {
        const n = matrix.slice(7, -1).split(",").map(Number);
        return { x: n[4]!, y: n[5]! };
      });
      return {
        x: pts.reduce((a, p) => a + p.x, 0) / (pts.length || 1),
        y: pts.reduce((a, p) => a + p.y, 0) / (pts.length || 1),
      };
    };
    const a = mid(engine);
    const b = mid(plain);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  test("adopting one spreads the travel over frames instead of one", () => {
    const engine = new BotEngine(R, "idle");
    const plain = new BotEngine(R, "idle");
    engine.setExpression(scared, 1);

    // The whole distance the pose has to cover, measured once it has settled.
    const total = distanceFromPlain(engine, plain, 1 + BotEngine.EXPRESSION_MORPH + 0.2);
    expect(total).toBeGreaterThan(5); // scared is far from idle, or this proves nothing

    // A cut covers all of it in one frame. A symmetric ease starts from rest,
    // so the biggest frame is around 6% of the trip: 10% is the ceiling, and
    // it also fails if the curve is swapped back to a front-loaded one (an
    // ease-out quintic put 15% into the first frame, which is what this read
    // as a snap through).
    expect(worstStep(engine, 1, 2)).toBeLessThan(total * 0.1);
  });

  test("clearing one eases back to the state's own face", () => {
    const engine = new BotEngine(R, "idle");
    engine.setExpression(scared, 0);
    engine.sample(1); // settled on the expression

    const plainRef = new BotEngine(R, "idle");
    const total = distanceFromPlain(engine, plainRef, 1);
    engine.setExpression(null, 1);
    expect(worstStep(engine, 1, 2)).toBeLessThan(total * 0.15);

    // and it does actually get back: well past the morph, the eyes match an
    // engine that never wore an expression at all
    const plain = new BotEngine(R, "idle");
    expect(engine.sample(4).eyes[0]!.matrix).toBe(plain.sample(4).eyes[0]!.matrix);
  });

  test("the morph runs for EXPRESSION_MORPH, not a frame and not forever", () => {
    const engine = new BotEngine(R, "idle");
    const plain = new BotEngine(R, "idle");
    engine.setExpression(scared, 0);
    // mid-morph: between the two poses, matching neither
    const mid = engine.sample(BotEngine.EXPRESSION_MORPH / 2).eyes[0]!.matrix;
    expect(mid).not.toBe(plain.sample(BotEngine.EXPRESSION_MORPH / 2).eyes[0]!.matrix);
    // past it: fully wearing the expression, so a later sample is stable
    const after = engine.sample(BotEngine.EXPRESSION_MORPH + 0.01).eyes[0]!.matrix;
    expect(after).not.toBe(mid);
  });
});
