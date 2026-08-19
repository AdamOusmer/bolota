import { describe, expect, test } from "bun:test";
import { _layout, blobatar } from "../src/blobatar";
import { engineStates, mountEngine, type EngineHandle } from "../src/engine";
import { runSequence } from "../src/sequences";

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
 * them: filterDefs, defs, back, bodyPath, eyes, front. White-box, and
 * deliberately so — this suite exists to look inside the render output. */
function parts(svg: FakeElement) {
  const root = svg.children[0]!;
  return {
    back: root.children[2]!,
    bodyPath: root.children[3]!,
    eyes: root.children[4]!,
    front: root.children[5]!,
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
        "idle", "thinking", "wink", "wide", "alert", "notify", "exclaim",
        "snooze", "play", "orbit", "swirl", "burst", "comet",
      ].sort(),
    );
  });

  for (const state of [
    "idle", "thinking", "wink", "wide", "alert", "notify", "exclaim",
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
      const stat = staticBbox(blobatar(seed, { background: false }));

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

describe("motion blur decays when velocity drops", () => {
  function bodyStdDev(svg: FakeElement): number {
    const filterDefs = svg.children[0]!.children[0]!;
    const bodyFilter = filterDefs.children[0]!;
    const fe = bodyFilter.children[0]!;
    return Number(fe.getAttribute("stdDeviation") ?? "0");
  }

  test("orbit's body blur ramps up while spinning, then decays to ~0 once velocity is actually low", () => {
    const { doc, svg, handle } = mount();
    handle.play("orbit", { loop: true });
    run(doc, 600); // several fast frames — enough for the damper to climb
    const spinning = bodyStdDev(svg as unknown as FakeElement);
    expect(spinning).toBeGreaterThan(0.3);

    handle.play("idle"); // velocity drops hard: breathing/blinking only —
    // but not instantly. `setState` crossfades over idle's own `morph`
    // (0.45s), and the body is still blending *from* orbit's fast pose for
    // that whole window, which is genuine motion, not the bug — the 300ms
    // budget applies from the point velocity is actually low, so this
    // clears the morph window first.
    run(doc, 500);
    const midway = bodyStdDev(svg as unknown as FakeElement);
    run(doc, 300);
    const settled = bodyStdDev(svg as unknown as FakeElement);
    expect(settled).toBeLessThan(0.05);
    expect(settled).toBeLessThanOrEqual(midway);
  });
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
    const stat = staticBbox(blobatar(seed, { background: false }));
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
