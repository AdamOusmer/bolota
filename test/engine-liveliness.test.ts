import { describe, expect, test } from "bun:test";
import { _layout, bolota } from "../src/bolota";
import { engineStates, mountEngine, type EngineHandle } from "../src/engine";
import { runSequence } from "../src/sequences";
import { BotEngine } from "../src/bloub/engine";
import { PROFILE_SAMPLES } from "../src/bloub/profiles";

/**
 * A minimal fake SVG DOM covering exactly what `mountEngine` touches
 * (`createElementNS`, `setAttribute`/`removeAttribute`, `appendChild`/
 * `append`/`replaceChildren`, `remove`, plus `defaultView.matchMedia` and a
 * manually-steppable `requestAnimationFrame`). Regression coverage for the
 * bugs below needs to control the clock frame-by-frame, which no real
 * browser API allows — this is the whole reason for hand-rolling it rather
 * than pulling in a full DOM implementation.
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

const mounted = new Map<FakeDocument, { now: number }>();

function mount(name = "engine-liveliness-seed") {
  const doc = new FakeDocument();
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  (svg as unknown as { ownerDocument: FakeDocument }).ownerDocument = doc;
  const handle = mountEngine(svg as unknown as SVGSVGElement, name);
  mounted.set(doc, { now: 0 });
  return { doc, svg, handle };
}

/** Fires every queued rAF callback once, at the doc's own running clock
 * (absolute `performance.now()`-style ms — `tick()` computes its `dt` as a
 * delta between consecutive calls, so this must never go backwards or
 * restart per call, only ever advance). */
function step(doc: FakeDocument, deltaMs: number) {
  const clock = mounted.get(doc)!;
  clock.now += deltaMs;
  const due = doc.defaultView.queue;
  doc.defaultView.queue = [];
  for (const cb of due) cb(clock.now);
}

/** Runs `step` repeatedly at `frameMs` intervals until `totalMs` more of
 * fake time has elapsed on `doc`'s own running clock (persisted across
 * calls) — mirroring a real rAF cadence rather than one giant jump, which
 * would just get clamped by the 34ms delta cap and under-run the intended
 * duration. */
function run(doc: FakeDocument, totalMs: number, frameMs = 16) {
  for (let t = 0; t < totalMs; t += frameMs) step(doc, Math.min(frameMs, totalMs - t));
}

/** The root `<g>`'s children, in the fixed order `mountEngine` appends
 * them: defs, back, bodyPath, eyes, front. White-box, and deliberately so —
 * this suite exists to look inside the render output. */
function parts(svg: FakeElement) {
  const root = svg.children[0]!;
  return {
    back: root.children[1]!,
    bodyPath: root.children[2]!,
    eyes: root.children[3]!,
    front: root.children[4]!,
  };
}

function bbox(d: string) {
  const nums = d.match(/-?\d+\.?\d*/g)?.map(Number) ?? [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i]!, y = nums[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { w: maxX - minX, h: maxY - minY };
}

describe("shared root cause: loop never re-armed stateStart", () => {
  // The bug this whole file exists to pin: `tick()`'s loop branch called
  // `engine.reset(current, clock)` once a looping state's `duration`
  // elapsed, but never advanced `stateStart` — so the guard stayed true on
  // *every* subsequent frame, `reset()` fired every frame, and `now - tCur`
  // stayed pinned near 0 forever. That single missing assignment explained
  // the whole reported grid: burst never exploding, orbit/comet never
  // looping, and thinking/alert/snooze/exclaim/notify/swirl reading as
  // static tiles — none of those states needed an individual fix.

  test("two independently mounted engines advance independently", () => {
    const a = mount("engine-a");
    const b = mount("engine-b");
    a.handle.play("thinking", { loop: true });
    b.handle.play("thinking", { loop: true });

    const p0a = parts(a.svg as unknown as FakeElement).bodyPath.getAttribute("d");
    const p0b = parts(b.svg as unknown as FakeElement).bodyPath.getAttribute("d");

    run(a.doc, 3000);
    run(b.doc, 3000);

    const p1a = parts(a.svg as unknown as FakeElement).bodyPath.getAttribute("d");
    const p1b = parts(b.svg as unknown as FakeElement).bodyPath.getAttribute("d");

    expect(p1a).not.toBe(p0a);
    expect(p1b).not.toBe(p0b);
    // Neither mount's rAF queue is the other's — advancing `a` alone must
    // not have silently moved `b` too (the "shared clock" hypothesis).
    expect(a.doc.defaultView).not.toBe(b.doc.defaultView);
  });

  for (const state of ["thinking", "alert", "snooze", "exclaim"] as const) {
    test(`"${state}" actually moves once looping (t=0.5s vs t=1.5s differ)`, () => {
      const { doc, svg, handle } = mount();
      handle.play(state, { loop: true });
      run(doc, 500);
      const mid = parts(svg as unknown as FakeElement).bodyPath.getAttribute("d");
      run(doc, 1000); // now at 1.5s
      const late = parts(svg as unknown as FakeElement).bodyPath.getAttribute("d");
      expect(late).not.toBe(mid);
    });
  }

  test('"burst" actually explodes: body shrinks then regrows across sampled t', () => {
    const { doc, svg, handle } = mount();
    handle.play("burst", { loop: true });
    run(doc, 100);
    const early = bbox(parts(svg as unknown as FakeElement).bodyPath.getAttribute("d")!);
    run(doc, 500); // ~0.6s: past burst's 0.7s collapse window's midpoint
    const collapsed = bbox(parts(svg as unknown as FakeElement).bodyPath.getAttribute("d")!);
    run(doc, 1900); // ~2.5s: regrown
    const regrown = bbox(parts(svg as unknown as FakeElement).bodyPath.getAttribute("d")!);

    expect(collapsed.w).toBeLessThan(early.w * 0.6);
    expect(regrown.w).toBeGreaterThan(collapsed.w * 1.5);
  });
});

describe("loop:true wraps seamlessly", () => {
  test('"orbit" never resets — it keeps rotating past its own duration, no freeze', () => {
    const { doc, svg, handle } = mount();
    handle.play("orbit", { loop: true });
    run(doc, 3400); // orbit's own `duration`
    const atDuration = parts(svg as unknown as FakeElement).bodyPath.getAttribute("d");
    run(doc, 300); // duration + 0.3s
    const past = parts(svg as unknown as FakeElement).bodyPath.getAttribute("d");
    run(doc, 300); // duration + 0.6s
    const further = parts(svg as unknown as FakeElement).bodyPath.getAttribute("d");

    // Still moving well past `duration` — a frozen/clamped final frame
    // would make these three identical.
    expect(past).not.toBe(atDuration);
    expect(further).not.toBe(past);
  });

  test('"comet" loops: a second cycle plays, it does not clamp at the first cycle\'s end', () => {
    const { doc, svg, handle } = mount();
    handle.play("comet", { loop: true });
    run(doc, 2400); // comet's own `duration`
    run(doc, 450); // + morph (0.45s): past this file's settle-before-reset point
    const settledOnce = parts(svg as unknown as FakeElement).bodyPath.getAttribute("d");
    run(doc, 2400); // deep into a second cycle
    const secondCycle = parts(svg as unknown as FakeElement).bodyPath.getAttribute("d");

    expect(secondCycle).not.toBe(settledOnce);
  });
});

describe("entrance handoff", () => {
  test("settles into the seed's own silhouette, not a stuck half-blend", () => {
    const { doc, svg, handle } = mount("entrance-seed");
    runSequence(handle, "entrance"); // -> plays "swirl"
    run(doc, 1300); // swirl's own duration
    run(doc, 500); // + idle's morph (0.45s): the auto-return-to-idle settles

    const settled = bbox(parts(svg as unknown as FakeElement).bodyPath.getAttribute("d")!);

    // A fresh engine on the same seed, sampled at its own very first idle
    // frame, is the reference shape: `baseBody` states substitute in the
    // *same* seeded radii array regardless of which one is active, so the
    // settled entrance and a brand-new idle mount should agree closely.
    const ref = mount("entrance-seed");
    const reference = bbox(parts(ref.svg as unknown as FakeElement).bodyPath.getAttribute("d")!);

    expect(settled.w).toBeGreaterThan(reference.w * 0.85);
    expect(settled.w).toBeLessThan(reference.w * 1.15);
    expect(settled.h).toBeGreaterThan(reference.h * 0.85);
    expect(settled.h).toBeLessThan(reference.h * 1.15);
  });

  test("idle life resumes after the sequence completes — never a frozen frame", () => {
    const { doc, svg, handle } = mount("entrance-seed-2");
    runSequence(handle, "entrance");
    run(doc, 1300 + 500); // through swirl, settled into idle

    const settled = parts(svg as unknown as FakeElement).bodyPath.getAttribute("d");
    run(doc, 1000);
    const plusOne = parts(svg as unknown as FakeElement).bodyPath.getAttribute("d");
    run(doc, 1000);
    const plusTwo = parts(svg as unknown as FakeElement).bodyPath.getAttribute("d");

    // Breathing/blinking are seeded per-name in bloub's own `liveliness()`
    // (loopNoise-driven, keyed off wall-clock `now` — never off the
    // per-state `tCur` this file's own bug used to corrupt), so an idle
    // engine a second apart must not be reading the same frame twice.
    expect(plusOne).not.toBe(settled);
    expect(plusTwo).not.toBe(plusOne);
  });
});

// The two describe blocks below are the final-gate additions on top of the
// engine-core and eyes fixes above: they extend the same fake-DOM harness to
// the remaining reported symptoms — full 15-state coverage (only 4 states
// were spot-checked above), the exact 40%/80% burst thresholds and its
// particles, and a signal that proves a loop genuinely restarts its local
// clock rather than merely holding its last frame.

describe("every state moves — full 15-state sweep", () => {
  // engine-core's own sweep above already pins thinking/alert/snooze/exclaim
  // as the root-cause regression test; this closes the rest of the catalog
  // (`engineStates()`, `bun test`-stable order per `bloub/states.ts`) so no
  // state can regress back to a static tile unnoticed.
  const alreadyCovered = new Set(["thinking", "alert", "snooze", "exclaim"]);
  for (const state of engineStates()) {
    if (alreadyCovered.has(state)) continue;
    test(`"${state}" actually moves once looping (t=0.5s vs t=1.5s differ)`, () => {
      const { doc, svg, handle } = mount();
      handle.play(state, { loop: true });
      run(doc, 500);
      const mid = parts(svg as unknown as FakeElement).bodyPath.getAttribute("d");
      run(doc, 1000); // now at 1.5s
      const late = parts(svg as unknown as FakeElement).bodyPath.getAttribute("d");
      expect(late).not.toBe(mid);
    });
  }

  test('"swirl" renders non-empty markup (body path plus its entrance rings)', () => {
    const { doc, svg, handle } = mount();
    handle.play("swirl", { loop: true });
    run(doc, 500); // inside the rings' visible window (~0.06s-1.22s)
    const { bodyPath, back, front } = parts(svg as unknown as FakeElement);
    const d = bodyPath.getAttribute("d");
    expect(d).toBeTruthy();
    expect((d as string).length).toBeGreaterThan(10);
    // Rings render as `<path>` children of `back`/`front` (arcGroup) — at
    // least one side must be non-empty while the rings are visible.
    expect(back.children.length + front.children.length).toBeGreaterThan(0);
  });
});

describe("burst: the exact reported thresholds", () => {
  test("body bbox shrinks below 40% then regrows above 80% of its initial size", () => {
    const { doc, svg, handle } = mount();
    handle.play("burst", { loop: true });
    run(doc, 50); // ~0.05s: collapse has barely started
    const initial = bbox(parts(svg as unknown as FakeElement).bodyPath.getAttribute("d")!);
    run(doc, 600); // ~0.65s: past the 0.7s collapse window's floor
    const collapsed = bbox(parts(svg as unknown as FakeElement).bodyPath.getAttribute("d")!);
    run(doc, 1750); // ~2.4s: regrow window's own end
    const regrown = bbox(parts(svg as unknown as FakeElement).bodyPath.getAttribute("d")!);

    expect(collapsed.w).toBeLessThan(initial.w * 0.4);
    expect(collapsed.h).toBeLessThan(initial.h * 0.4);
    expect(regrown.w).toBeGreaterThan(initial.w * 0.8);
    expect(regrown.h).toBeGreaterThan(initial.h * 0.8);
  });

  test("particles are present mid-collapse", () => {
    const { doc, svg, handle } = mount();
    handle.play("burst", { loop: true });
    run(doc, 500); // t=0.5s: inside two overlapping particle birth windows
    const { back } = parts(svg as unknown as FakeElement);
    // `dotsBehind` puts burst's particle group last among `back`'s children,
    // rebuilt fresh every frame (see `render()`'s `arcGroup` + `dotGroup`).
    const dotsGroup = back.children[back.children.length - 1];
    expect(dotsGroup?.children.length ?? 0).toBeGreaterThan(0);
  });
});

describe("loop:true genuinely restarts, it does not clamp on the last frame", () => {
  test('"comet" resumes shrinking after its plateau — proof of a real restart, not a permanent clamp', () => {
    // `tick()` deliberately holds a looping-but-plateaued state (every term
    // in comet's pose is `clamp(...)`, so it settles to `circle(1)` and
    // stops changing) until `duration + morph` before calling `reset()` —
    // see `engine.ts`'s own comment on why. So `t = duration + 0.3s` is
    // *expected* to equal the plateaued frame here; that only becomes a
    // "clamped forever" bug if nothing ever moves again after it. This
    // checks the frame that must differ: once the restart actually fires
    // (duration + morph = 2.4 + 0.45 = 2.85s), comet's own collapse curve
    // re-enters and the body shrinks hard again (COMET_DOT = 0.129 of
    // resting radius by 0.55s into a fresh cycle).
    const { doc, svg, handle } = mount();
    handle.play("comet", { loop: true });
    run(doc, 2700); // duration + 0.3s: inside the plateau, body ~circle(1)
    const plateaued = bbox(parts(svg as unknown as FakeElement).bodyPath.getAttribute("d")!);
    run(doc, 250); // crosses the 2.85s restart boundary, ~0.1s into cycle 2
    const afterRestart = bbox(parts(svg as unknown as FakeElement).bodyPath.getAttribute("d")!);

    expect(afterRestart.w).toBeLessThan(plateaued.w * 0.85);
  });
});

/** Body/eye/decor group `d`/`circle` numbers only — matches `bbox()` above
 * but for the *static* renderer's markup, which also emits `<circle>`
 * petals (cloud/nub/sun/capsule) that a plain `d="..."` sweep would miss. */
function staticBbox(svg: string) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const m of svg.matchAll(/<path d="([^"]+)"/g)) {
    const nums = m[1]!.match(/-?\d+\.?\d*/g)?.map(Number) ?? [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = nums[i]!, y = nums[i + 1]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  for (const m of svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/g)) {
    const cx = +m[1]!, cy = +m[2]!, r = +m[3]!;
    if (cx - r < minX) minX = cx - r;
    if (cx + r > maxX) maxX = cx + r;
    if (cy - r < minY) minY = cy - r;
    if (cy + r > maxY) maxY = cy + r;
  }
  return { w: maxX - minX, h: maxY - minY };
}

describe("states completeness: nothing bloub ships can silently drop out", () => {
  test("every catalog state is on the handle", () => {
    const { handle } = mount();
    // Locks the count and the exact ids so a future rename or a state
    // dropped from `STATE_BY_ID` fails here first, not in a screenshot.
    expect(handle.states.sort()).toEqual(
      [
        "idle", "wander", "thinking", "wink", "wide", "alert", "notify", "exclaim",
        "snooze", "play", "orbit", "swirl", "burst", "comet",
      ].sort(),
    );
  });

  for (const state of [
    "idle", "wander", "thinking", "wink", "wide", "alert", "notify", "exclaim",
    "snooze", "play", "orbit", "swirl", "burst", "comet",
  ] as const) {
    test(`"${state}" renders a non-empty body and animates under the fixed clock`, () => {
      const { doc, svg, handle } = mount();
      handle.play(state, { loop: true });
      run(doc, 200);
      const d0 = parts(svg as unknown as FakeElement).bodyPath.getAttribute("d");
      expect(d0, state).toBeTruthy();
      expect(d0!.length, state).toBeGreaterThan(10);
      run(doc, 1500);
      const d1 = parts(svg as unknown as FakeElement).bodyPath.getAttribute("d");
      expect(d1, state).not.toBe(d0);
    });
  }
});

describe("engine idle silhouette matches the static renderer, every shape family", () => {
  // Root cause (see `seededSilhouette` in `engine.ts`): the seeded profile
  // used to come from the *analytic* superellipse formula alone, which is
  // exact only for "round"/"boxy" (no custom `path`). The other eight
  // families draw something else entirely — capsule a rectangle-plus-two-
  // circles stadium, cloud/organic a jittered spline, hexagon/triangle a
  // polygon — and approximating any of those with a smooth superellipse
  // reads as a wrong, often "squashed ellipse" aspect. `seededSilhouette`
  // now ray-casts the real rendered outline (core path + petals + extra)
  // instead, so this must hold for every family, not just the one that
  // happened to be in a screenshot.
  const SEEDS: [string, string][] = [
    ["round-family-seed-1", "round"],
    ["organic-family-seed-7", "organic"],
    ["boxy-family-seed-3", "boxy"],
    ["nub-family-seed-2", "nub"],
    ["cloud-family-seed-9", "cloud"],
    ["sun-family-seed-4", "sun"],
  ];

  for (const [seed] of SEEDS) {
    test(`"${seed}": engine idle bbox matches the static render's aspect and size`, () => {
      const { shape } = _layout(seed);
      const { doc, svg } = mount(seed);
      run(doc, 50); // a couple of idle frames, well inside one breath cycle
      const engine = bbox(parts(svg as unknown as FakeElement).bodyPath.getAttribute("d")!);
      const stat = staticBbox(bolota(seed, { background: false }));

      // Tight on purpose: this is the exact bug that shipped. A tolerance
      // loose enough to hide a wrong-aspect reconstruction defeats the
      // point of the assertion — see the round-2 report for why the
      // previous version of this file's tolerance passed on a bug.
      expect(engine.w, `${seed} (${shape}) width`).toBeGreaterThan(stat.w * 0.9);
      expect(engine.w, `${seed} (${shape}) width`).toBeLessThan(stat.w * 1.1);
      expect(engine.h, `${seed} (${shape}) height`).toBeGreaterThan(stat.h * 0.9);
      expect(engine.h, `${seed} (${shape}) height`).toBeLessThan(stat.h * 1.1);
    });
  }
});

describe("body profile == seeded profile at all times (modulo scale/transform/collapse), every state", () => {
  // Structural, not per-state: BotEngine.posed() (bloub/engine.ts) now
  // discards the angular shape of every non-baseBody state's own pose --
  // bloub's built-in profiles (the spinning triangle in orbit/play, egg,
  // hexagon, every `circle(k)` collapse/regrow and decorative-dot state) --
  // and rebuilds `sil.radii` from the seed's own profile scaled by that
  // pose's mean radius. One choke point: no state's `pose()` can put its own
  // angular shape on screen anymore, so this holds for the whole catalog
  // without per-state coverage. Aspect ratio is the discriminator: a leaked
  // triangle/egg/hexagon has a very different width/height ratio than an
  // organic/round/cloud/etc. seed, so a leak shows up as a large deviation
  // here even without comparing exact point-by-point radii.
  const SEEDS = ["anna", "alain", "mavey", "engine-liveliness-seed"];
  // Not "orbit": it's the one state that actually rotates the body (`rot`
  // grows unbounded by design, see the "loop:true wraps seamlessly" suite
  // above), and an axis-aligned bbox is not rotation-invariant -- a
  // perfectly preserved seed shape at 20 degrees of spin legitimately has a
  // different aspect ratio than at rest. That is a property of measuring
  // with a bbox, not a shape leak; orbit's own shape fidelity is exercised
  // by "wraps seamlessly" instead.
  // Not "egg"/"hexagon": removed from the catalog entirely (see
  // bloub/states.ts) — they were the states this test's own invariant made
  // meaningless, static named profiles with no radius variation.
  const STATES = ["idle", "play", "swirl"] as const;

  for (const seed of SEEDS) {
    const stat = staticBbox(bolota(seed, { background: false }));
    const staticAspect = stat.w / stat.h;

    for (const state of STATES) {
      test(`"${seed}" in "${state}": aspect ratio stays the seed's own`, () => {
        const { doc, svg, handle } = mount(seed);
        handle.play(state, { loop: true });
        run(doc, 300); // past blinkIn/morph, into the state's own hold
        const b = bbox(parts(svg as unknown as FakeElement).bodyPath.getAttribute("d")!);
        const aspect = b.w / b.h;
        expect(aspect, `${seed}/${state}`).toBeGreaterThan(staticAspect * 0.75);
        expect(aspect, `${seed}/${state}`).toBeLessThan(staticAspect * 1.25);
      });
    }
  }
});

describe("orbit decor and eye-pair fidelity to bloub", () => {
  /**
   * Root cause of the "no orbiting rings, a few scattered dots" report:
   * `mountEngine` never set a viewBox on the caller's `<svg>` — every caller
   * (this repo's own test site included) reuses the static core's tight
   * `viewBox="0 0 100 100"`, sized to fit the BODY alone. Orbit's rings climb
   * to 1.4x the ball's own radius (`bloub/decor.ts`'s `RINGS`), and for any
   * seed whose body occupies more than ~1/1.4 of that box's half-width (a
   * measured, common case: `body.rx` runs 22-41 depending on traits, against
   * a fixed ~49-unit margin), the rings render mostly outside the box and get
   * clipped to a handful of stray fragments. Bloub itself never has this
   * problem: `bot/repere.ts`'s `DEMI_VIEWBOX`/`RAYON` is a permanent 1.58x
   * margin around the ball, `bloub/frame.ts`'s ported (but, until now,
   * unused outside `eyefit.ts`) `HALF_VIEWBOX`/`RADIUS`.
   *
   * These seeds span the measured rx range on both sides of the old clipping
   * threshold (~35): "a" sat comfortably inside the old 100x100 box, "u" did
   * not.
   */
  const RING_SEEDS = ["a", "b", "f", "r", "u", "engine-liveliness-seed"];

  function viewBoxOf(svg: FakeElement) {
    const vb = svg.getAttribute("viewBox")!;
    const [x, y, w, h] = vb.split(" ").map(Number) as [number, number, number, number];
    return { x, y, w, h };
  }

  for (const seed of RING_SEEDS) {
    test(`"${seed}": mounted viewBox has bloub's own margin, not the static core's tight box`, () => {
      const { svg } = mount(seed);
      const { body } = _layout(seed);
      const box = viewBoxOf(svg as unknown as FakeElement);
      // The static core's own box, `render.ts`'s `viewBox="0 0 100 100"`,
      // would fail this for every "wide" seed above -- this is the
      // regression test for the fix, not a tautology: it fails against the
      // pre-fix `mountEngine` (no `setAttribute("viewBox", ...)` at all,
      // `getAttribute` returns `null`, `.split` throws).
      const halfWidth = box.w / 2;
      expect(halfWidth, seed).toBeGreaterThanOrEqual(body.rx * 1.4);
    });

    test(`"${seed}": orbit's rings stay inside the mounted viewBox at steady state (6 rings)`, () => {
      const { doc, svg, handle } = mount(seed);
      handle.play("orbit", { loop: true });
      run(doc, 1000); // past the 0.8s entrance ramp, all 6 rings in
      const box = viewBoxOf(svg as unknown as FakeElement);
      const p = parts(svg as unknown as FakeElement);
      const ringPaths = [...p.back.children, ...p.front.children].filter(
        (c) => c.tagName === "path" && (c.getAttribute("d")?.length ?? 0) > 0,
      );
      expect(ringPaths.length, seed).toBe(12); // 6 rings x (front + back)
      for (const ring of ringPaths) {
        const b = bbox(ring.getAttribute("d")!);
        // A few viewBox units of slack for stroke width (~0.05 x R) and the
        // 64-point polyline approximation of the true ellipse.
        const slack = Math.max(2, box.w * 0.03);
        expect(b.w, seed).toBeLessThanOrEqual(box.w + slack);
        expect(b.h, seed).toBeLessThanOrEqual(box.h + slack);
      }
    });
  }

  /**
   * Eye PLACEMENT during orbit: the eyes must travel with the body through
   * its spin, not sit at a fixed screen position while the silhouette spins
   * and translates around them (the other half of the same user report,
   * "one eye in an odd place"). `spinningTriangle`'s `cx/cy` (bolota's
   * `states.ts`) trace a circle of radius `TRI_ORBIT` (0.213 x R) around the
   * origin every 0.8s (`rot`'s own period at 1.25 rev/s) -- `bloub/engine.ts`
   * adds that same `sil.cx/cy` to the eye matrix's translation (`bodyCx`/
   * `bodyCy`), so the eye-pair midpoint should trace a comparably small,
   * *non-degenerate* circle in lockstep, not stay pinned to one point.
   */
  /**
   * White-box, not DOM: a seed's own irregular profile makes `bodyRadius`'s
   * per-eye fit (`bloub/engine.ts`'s `fit = bodyRadius(e.x, e.y)`) oscillate
   * with `sil.rot` on its own, which already moves the eyes some regardless
   * of whether `sil.cx/cy` is ever added to their position -- a DOM-level
   * "the eyes move at all" assertion against a real seed cannot tell the two
   * apart, and does not (verified: it keeps passing with `bodyCx`/`bodyCy`
   * zeroed out by hand). A perfectly circular `radii` array pins that
   * confound (`bodyRadius` returns the same 1.0 at every angle, so `fit`
   * never moves), which isolates the one channel under test: with the eyes'
   * own gaze constant (orbit's is, by design -- `states.ts`), the eye-pair
   * midpoint minus the body's own bbox center should be a near-constant
   * vector (the fixed gaze offset) at every t, while the body's own center
   * itself traces `spinningTriangle`'s circle -- i.e. the eyes ride it.
   */
  function circleFrame(t: number) {
    const shape = new Array(PROFILE_SAMPLES).fill(1);
    const eng = new BotEngine(100, "orbit", shape, null);
    eng.reset("orbit", 0);
    return eng.sample(t);
  }

  function eyeMidpoint(f: ReturnType<typeof circleFrame>) {
    const pts = f.eyes.map((e) => {
      const m = /matrix\(([^,]+),([^,]+),([^,]+),([^,]+),(-?[\d.]+),(-?[\d.]+)\)/.exec(e.matrix);
      return m ? { x: +m[5]!, y: +m[6]! } : null;
    });
    if (!pts[0] || !pts[1]) throw new Error("expected both eyes visible");
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }

  test("orbit: the eye-pair midpoint rides the body's own TRI_ORBIT wobble, not pinned to world origin", () => {
    const ts = [0.2, 0.36, 0.52, 0.68, 0.84]; // spans one 0.8s wobble period (rot at 1.25 rev/s)
    const frames = ts.map(circleFrame);
    const eyeMid = frames.map(eyeMidpoint);

    // `bbox()` (this file's own helper, used elsewhere in the file) returns
    // width/height spans, not a center -- for a circle centered at
    // (sil.cx*R, sil.cy*R) with constant radius, the span alone does not
    // expose the center. Recompute the center directly from the path's own
    // min/max instead.
    function center(d: string) {
      const nums = d.match(/-?\d+\.?\d*/g)?.map(Number) ?? [];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = nums[i]!, y = nums[i + 1]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    }
    const centers = frames.map((f) => center(f.bodyPath));

    const centerSpreadX = Math.max(...centers.map((c) => c.x)) - Math.min(...centers.map((c) => c.x));
    const centerSpreadY = Math.max(...centers.map((c) => c.y)) - Math.min(...centers.map((c) => c.y));
    // The body itself genuinely moves (sanity check on the fixture, not the
    // fix): `spinningTriangle`'s cx/cy wobble is ~0.213 x R either axis.
    expect(centerSpreadX + centerSpreadY, "fixture: body wobbles").toBeGreaterThan(10);

    const rel = eyeMid.map((e, i) => ({ x: e.x - centers[i]!.x, y: e.y - centers[i]!.y }));
    const relSpreadX = Math.max(...rel.map((r) => r.x)) - Math.min(...rel.map((r) => r.x));
    const relSpreadY = Math.max(...rel.map((r) => r.y)) - Math.min(...rel.map((r) => r.y));
    // The pre-fix bug: eyes at a fixed screen position while the body
    // (bbox center above) orbits around them -- `eyeMid - bodyCenter` would
    // then swing by the SAME amount the body itself does. Post-fix, that
    // difference stays close to flat: the gaze is constant (orbit's own
    // `REST_GAZE`), so the only residual wobble is the per-eye radius-fit
    // term this fixture already pinned to 1.0, i.e. near zero.
    expect(relSpreadX, "eye-body offset stays ~constant (eyes ride the body)").toBeLessThan(
      centerSpreadX * 0.25,
    );
    expect(relSpreadY, "eye-body offset stays ~constant (eyes ride the body)").toBeLessThan(
      centerSpreadY * 0.25,
    );
  });
});
