import { describe, expect, test } from "bun:test";
import { BotEngine, type Look } from "../src/bloub/engine";
import { eyePoses, REST_GAZE } from "../src/bloub/face";
import { r2 } from "../src/bloub/math";
import { radiusAtAngle, superellipseProfile, toPoints } from "../src/bloub/shape";
import { ORBIT_PERIOD, STATE_BY_ID, WINK_PERIOD, type StateId } from "../src/bloub/states";

// `BotEngine.sample(t)` is pure and DOM-free ("clockless engine" — see its own
// doc comment), so every check here drives it with an explicit clock instead of a
// real or faked `requestAnimationFrame`: sampling at chosen `t` values IS the fake
// clock, and it is exact rather than timer-jitter-prone.

/** `matrix(a,b,c,d,e,f)` — e,f is the eye's rendered center, in viewBox units. */
function eyeCenters(matrixList: { matrix: string }[]): { x: number; y: number }[] {
  return matrixList.map(({ matrix }) => {
    const nums = matrix.slice(7, -1).split(",").map(Number);
    return { x: nums[4]!, y: nums[5]! };
  });
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

const R = 100;

describe("bug 1 — eye anchoring on arbitrary seeded silhouettes", () => {
  // Three synthetic seeds standing in for bolota bodies: superellipse profiles
  // with exponents/scales that do not match any of bloub's 8 catalog `SHAPES`
  // (`skins.ts`) — the array reference `eyeOffset` used to key its
  // correction table on, and which no real bolota seed ever equals. Before the
  // fix, `OFFSETS.get(radii)` missed for all three and every correction fell
  // through to `{x:0,y:0}`.
  const shapes = [
    superellipseProfile(2.5, 1, 0.55), // flat/wide, capsule-like
    superellipseProfile(3, 0.6, 1), // tall/narrow
    superellipseProfile(6, 1, 0.82) // rounded-square-ish
  ];

  const baseBodyStates: StateId[] = ["idle", "wink", "wide", "notify", "swirl"];

  // A single `t` sample is not enough to trust: `eyefit.ts`'s correction is a
  // single constant per (shape, state, expr), sized to cover the worst case the
  // idle wander's `loopNoise` sum can reach — and because that sum's terms use
  // incommensurate periods, the actual worst moment recurs only occasionally and
  // was observed (round 2 tuning) to land as late as t~300s for the tightest
  // combo (`notify` on the squashed, high-exponent seed below). A `t=1.0` check
  // alone would have passed for amplitude values later proven, by a 600s+ sweep,
  // to blow past the silhouette edge. Sweeping to 350s at a coarse step is the
  // cheapest check that still crosses that recurrence.
  for (const shape of shapes) {
    for (const state of baseBodyStates) {
      test(`eyes stay inside the body over a long idle window — state "${state}", seed n=${JSON.stringify(shape[0])}`, () => {
        const engine = new BotEngine(R, state, shape);
        let sampled = false;
        for (let t = 0; t <= 350; t += 0.5) {
          const frame = engine.sample(t);
          for (const eye of eyeCenters(frame.eyes)) {
            sampled = true;
            const angle = Math.atan2(eye.y, eye.x);
            const localBodyRadius = radiusAtAngle(shape, angle) * R;
            const ratio = Math.hypot(eye.x, eye.y) / localBodyRadius;
            // "Stuck at the top/side" == ratio near or over 1 (eye at/past the
            // silhouette's own edge). A corrected anchor sits well inside it,
            // with margin: round 2 tuning measured a real worst of ~0.875 for
            // this exact grid, so 0.97 catches a regression without being a
            // hair-trigger on sampling-resolution noise.
            expect(ratio).toBeLessThan(0.97);
          }
        }
        expect(sampled).toBe(true);
      });
    }
  }
});

describe("bug 2 — wander gaze travel", () => {
  // bolota split (later request): `idle` and `wander` used to be the same
  // state. `idle` is now the "no-state" neutral (fixed gaze, tested in its
  // own describe block below) and `wander` carries the choreography this
  // whole describe block was originally tuned against — same engine
  // construction, just naming the state explicitly instead of relying on
  // `BotEngine`'s default (which is `idle` and would now measure 0).
  test("eye-center path length over 10s of wander exceeds a meaningful threshold", () => {
    const engine = new BotEngine(R, "wander");
    const dt = 1 / 30;
    let prev = eyeCenters(engine.sample(0).eyes)[0]!;
    let travel = 0;
    let tx = 0;
    let ty = 0;
    for (let t = dt; t <= 10; t += dt) {
      const cur = eyeCenters(engine.sample(t).eyes)[0]!;
      travel += dist(prev, cur);
      tx += Math.abs(cur.x - prev.x);
      ty += Math.abs(cur.y - prev.y);
      prev = cur;
    }
    // Round 1: original amplitude (7.1/5.5deg) -> 50.96 units; raised ~2.2x
    // (`face.ts`) -> 112.50, x (82.78) leading y (61.90) by 1.34x. Round 2: still
    // not enough, so period was shortened instead of amplitude (the free lever —
    // see `face.ts`'s comment), landing at 252.48 (x 166.90 / y 158.13, ratio 1.06).
    // Round 3 (later request): 252.48 read as too busy. Amplitude alone was scaled
    // down 0.63x (periods untouched, so this is purely a smaller excursion, not a
    // slower one), landing at 160.41 (x 106.59 / y 100.13, ratio unchanged at
    // 1.06). Bounded on both sides now (not just a floor) so the test catches
    // either a regression back toward stuck/subtle OR a re-inflation back toward
    // "too busy" — target band is ~150-170.
    expect(travel).toBeGreaterThan(150);
    expect(travel).toBeLessThan(170);
    // x-y balance: neither axis should dominate the way x did pre-round-2.
    expect(tx / ty).toBeGreaterThan(0.7);
    expect(tx / ty).toBeLessThan(1.4);
  });
});

describe("idle — the no-state neutral: fixed gaze, no wander/drift, still alive", () => {
  test("eye-center travel over 10s is exactly zero (no wander, no drift)", () => {
    const engine = new BotEngine(R, "idle");
    const dt = 1 / 30;
    let prev = eyeCenters(engine.sample(0).eyes)[0]!;
    let travel = 0;
    for (let t = dt; t <= 10; t += dt) {
      const cur = eyeCenters(engine.sample(t).eyes)[0]!;
      travel += dist(prev, cur);
      prev = cur;
    }
    expect(travel).toBe(0);
  });

  test("gaze matches idle's own pose exactly at every sampled t — dead ahead, not just low-amplitude", () => {
    const engine = new BotEngine(R, "idle");
    const idleDef = STATE_BY_ID.get("idle")!;
    for (let t = 0; t <= 8; t += 0.5) {
      const raw = idleDef.pose(t);
      const bodyRadiusAt = (x: number, y: number) => radiusAtAngle(raw.sil.radii, Math.atan2(y, x) - raw.sil.rot);
      const expected = eyePoses(raw.gaze, R, raw.split)
        .filter((e) => e.depth > 0.02)
        .map((e) => ({ x: e.x * bodyRadiusAt(e.x, e.y), y: e.y * bodyRadiusAt(e.x, e.y) }));
      const actual = eyeCenters(engine.sample(t).eyes);
      actual.forEach((a, i) => {
        expect(a.x).toBeCloseTo(expected[i]!.x, 2);
        expect(a.y).toBeCloseTo(expected[i]!.y, 2);
      });
    }
  });

  test("blink and breathing stay alive despite zero wander", () => {
    // Breathing: `sil.sy` should still oscillate over time (`face.ts`'s
    // `breath`, now gated on `blink`/`alive` alone, not on the same flag
    // that kills wander/drift — see `ownsLiveliness`'s own doc comment).
    // Read it off the rendered body path's own bounding box height, since
    // `BotFrame` doesn't expose `sil` directly.
    const engine = new BotEngine(R, "idle");
    const heights = new Set<number>();
    for (let t = 0; t <= 4; t += 0.2) {
      const d = engine.sample(t).bodyPath;
      const ys = [...d.matchAll(/-?\d+\.?\d*/g)].map(Number).filter((_, i) => i % 2 === 1);
      heights.add(Math.round((Math.max(...ys) - Math.min(...ys)) * 100) / 100);
    }
    expect(heights.size).toBeGreaterThan(1);
  });
});

describe("swirl — rests on NEUTRAL_GAZE like the rest of the roster", () => {
  // Three-step history on this state's gaze: swept to `NEUTRAL_GAZE`
  // alongside `burst`/`comet`, reverted to `base()`'s own `REST_GAZE`
  // for bloub fidelity (bloub's `arrival` never touches `gaze`), then
  // swept back on the owner's call — the showcase grid shows all 14
  // states side by side, and one tile resting off-axis reads as broken
  // next to thirteen neutral ones. `states.ts`'s own comment on the
  // `swirl` entry carries the full history.
  const swirlDef = STATE_BY_ID.get("swirl")!;

  test("pose(t).gaze is neutral at every sampled t, not base()'s REST_GAZE", () => {
    for (let t = 0; t <= swirlDef.duration; t += swirlDef.duration / 10) {
      const gaze = swirlDef.pose(t).gaze;
      expect(gaze.yaw).toBe(0);
      expect(gaze.pitch).toBe(0);
      expect(gaze.roll).toBe(0);
      // spelled out so a future fidelity revert fails here rather than
      // only showing up on the showcase grid
      expect(gaze.yaw).not.toBe(REST_GAZE.yaw);
    }
  });
});

describe("alert / exclaim — the blob is the glyph's dot, the bar is decor", () => {
  // Owner's redesign: these two states used to morph the BODY into the "!"'s
  // bar (`barItalic` / `barUpright`) and draw the dot as a small decor blob,
  // which read as the blob folding into the tail. Inverted: the body is the
  // dot — round, so it keeps the seed's own silhouette AND its face — and the
  // bar is a `dots[]` entry standing above it. These pin the inversion, since
  // nothing else in the suite would notice the roles swapping back.
  for (const id of ["alert", "exclaim"] as const) {
    const def = STATE_BY_ID.get(id)!;

    test(`"${id}" keeps a face: eyeAlpha is not zeroed`, () => {
      for (let t = 0; t <= def.duration; t += def.duration / 8) {
        expect(def.pose(t).eyeAlpha).toBeGreaterThan(0.9);
      }
    });

    test(`"${id}" body is the round dot, not a bar profile`, () => {
      for (let t = 0; t <= def.duration; t += def.duration / 8) {
        const radii = def.pose(t).sil.radii;
        // a bar profile swings from its half-width to its half-length; a dot
        // is one constant radius at every angle
        expect(Math.max(...radii) - Math.min(...radii)).toBeCloseTo(0, 6);
        expect(radii[0]!).toBeCloseTo(0.34, 6);
      }
    });

    test(`"${id}" draws exactly one bar above the body, clear of it`, () => {
      for (let t = 0; t <= def.duration; t += def.duration / 8) {
        const pose = def.pose(t);
        expect(pose.dots).toHaveLength(1);
        const bar = pose.dots[0]!;
        // a path, not a disk: `r` alone would render the bar as a circle
        expect(bar.d).toBeTruthy();
        // above the body (SVG y grows downward), and clear of it: the bar's
        // own half-length is 0.5 + its cap, the body's radius 0.34
        const gap = pose.sil.cy - bar.y;
        expect(gap).toBeGreaterThan(0.34 + 0.5);
      }
    });
  }
});

describe("bug 3 — eased retarget, no snap", () => {
  test("a look retarget starts slow (easeInOutCubic), not at full speed (easeOutQuint)", () => {
    const engine = new BotEngine(R);
    engine.sample(0); // settle initial state
    const look: Look = { yaw: 45, pitch: -25, mix: 1, spin: 0, wander: 1 };
    const morph = 0.24;
    engine.setLook(look, 0, morph);

    const c0 = eyeCenters(engine.sample(0).eyes)[0]!;
    const c10pct = eyeCenters(engine.sample(morph * 0.1).eyes)[0]!;
    const c100pct = eyeCenters(engine.sample(morph).eyes)[0]!;

    const total = dist(c0, c100pct);
    const early = dist(c0, c10pct);
    // easeOutQuint(0.1) ~= 0.41 of the travel already covered — a visible snap
    // into motion. easeInOutCubic(0.1) ~= 0.004. Generous bound at 15% to absorb
    // the gaze's own idle wander riding on top of the look target.
    expect(early / total).toBeLessThan(0.15);
  });

  test("no single-frame eye-center jump without intermediates, across a retarget", () => {
    const engine = new BotEngine(R);
    engine.sample(0);
    engine.setLook({ yaw: -50, pitch: 30, mix: 1, spin: 0, wander: 1 }, 0, 0.24);

    const fineDt = 1 / 240;
    const coarseDt = 1 / 20;
    let prev = eyeCenters(engine.sample(0).eyes)[0]!;
    let maxFineStep = 0;
    for (let t = fineDt; t <= 0.4; t += fineDt) {
      const cur = eyeCenters(engine.sample(t).eyes)[0]!;
      maxFineStep = Math.max(maxFineStep, dist(prev, cur));
      prev = cur;
    }
    let prevCoarse = eyeCenters(engine.sample(0).eyes)[0]!;
    let maxCoarseStep = 0;
    for (let t = coarseDt; t <= 0.4; t += coarseDt) {
      const cur = eyeCenters(engine.sample(t).eyes)[0]!;
      maxCoarseStep = Math.max(maxCoarseStep, dist(prevCoarse, cur));
      prevCoarse = cur;
    }
    // A true snap would make one fine-grained step (1/240s) roughly as large as
    // a whole coarse step (1/20s, 12x the timespan) — continuity means the fine
    // step stays a small fraction of it.
    expect(maxFineStep).toBeLessThan(maxCoarseStep * 0.5);
  });
});

describe("bug 4 — collapse states hide the eyes completely, then fade back", () => {
  // User-reversed decision (later than the original "keep a floor" fix this
  // describe block used to pin): the collapse states now hide the eyes
  // COMPLETELY, not just dim them — see states.ts's own comment on `burst`/
  // `comet` for the exact mechanism (an eased fraction, `1 - collapseFrac`
  // during collapse and `regrow` itself during regrow, sharing the SAME
  // `easeOutQuint` curve `sil`'s own scale uses, so there is nothing to pop:
  // alpha and size are both continuous functions of the identical eased t).

  test('"comet" eyes are fully gone (alpha 0, filtered out) through the deep collapse', () => {
    const engine = new BotEngine(R, "comet");
    // Collapse completes at t=0.55, regrow starts at t=1.85 — anywhere in
    // between is "deep collapse."
    for (const t of [0.55, 0.8, 1.0, 1.5, 1.84]) {
      const frame = engine.sample(t);
      expect(frame.eyes.length).toBe(0);
    }
    // Start (t=0) and fully-regrown (t=1.85+0.6=2.45): fully visible.
    for (const t of [0, 2.45]) {
      const frame = engine.sample(t);
      for (const eye of frame.eyes) expect(eye.alpha).toBeCloseTo(1, 1);
    }
  });

  test('"burst" eyes are fully gone (alpha 0, filtered out) through the deep collapse', () => {
    const engine = new BotEngine(R, "burst");
    // Collapse completes at t=0.7, regrow starts at t=1.7.
    for (const t of [0.7, 1.0, 1.4, 1.69]) {
      const frame = engine.sample(t);
      expect(frame.eyes.length).toBe(0);
    }
    // Start (t=0) and fully-regrown (t=1.7+0.7=2.4): fully visible.
    for (const t of [0, 2.4]) {
      const frame = engine.sample(t);
      for (const eye of frame.eyes) expect(eye.alpha).toBeCloseTo(1, 1);
    }
  });

  test('"comet" fade is smooth, not a pop — monotonic across collapse and regrow', () => {
    const engine = new BotEngine(R, "comet");
    // eyeAlpha isn't on BotFrame once an eye is filtered out (alpha<=0.01
    // drops it from `frame.eyes` entirely) — read it via presence/count
    // instead of a raw number for the collapsed samples, and the raw alpha
    // where an eye is still rendered.
    const alphaAt = (t: number) => engine.sample(t).eyes[0]?.alpha ?? 0;
    const collapseCurve = [0, 0.1, 0.2, 0.3, 0.4, 0.55].map(alphaAt);
    for (let i = 1; i < collapseCurve.length; i++) {
      expect(collapseCurve[i]!).toBeLessThanOrEqual(collapseCurve[i - 1]! + 1e-9);
    }
    const regrowCurve = [1.85, 2.0, 2.1, 2.2, 2.3, 2.45].map(alphaAt);
    for (let i = 1; i < regrowCurve.length; i++) {
      expect(regrowCurve[i]!).toBeGreaterThanOrEqual(regrowCurve[i - 1]! - 1e-9);
    }
  });

  test('"burst" fade is smooth, not a pop — monotonic across collapse and regrow', () => {
    const engine = new BotEngine(R, "burst");
    const alphaAt = (t: number) => engine.sample(t).eyes[0]?.alpha ?? 0;
    const collapseCurve = [0, 0.15, 0.3, 0.45, 0.6, 0.7].map(alphaAt);
    for (let i = 1; i < collapseCurve.length; i++) {
      expect(collapseCurve[i]!).toBeLessThanOrEqual(collapseCurve[i - 1]! + 1e-9);
    }
    const regrowCurve = [1.7, 1.85, 2.0, 2.15, 2.3, 2.4].map(alphaAt);
    for (let i = 1; i < regrowCurve.length; i++) {
      expect(regrowCurve[i]!).toBeGreaterThanOrEqual(regrowCurve[i - 1]! - 1e-9);
    }
  });

  test('"thinking" — genuinely impossible case: body IS a dot, eyeAlpha stays 0 by design', () => {
    const engine = new BotEngine(R, "thinking");
    const frame = engine.sample(1.3);
    expect(frame.eyes.length).toBe(0);
  });

  test('"thinking" entry fades rather than pops (cross-state blend still eases eyeAlpha)', () => {
    const engine = new BotEngine(R, "idle");
    engine.sample(0);
    engine.setState("thinking", 0);
    const morph = 0.4; // thinking's own `morph`
    const mid = engine.sample(morph * 0.5);
    // Mid cross-fade: alpha should be a fraction, neither the idle 1 nor thinking's
    // resting 0 — proof the transition ramps instead of switching instantly.
    if (mid.eyes.length > 0) {
      for (const eye of mid.eyes) {
        expect(eye.alpha).toBeGreaterThan(0);
        expect(eye.alpha).toBeLessThan(1);
      }
    }
  });
});

describe("orbit — eyes ride the body's own wobbling center", () => {
  // `orbit` is the one state with a nonzero, ANIMATED `sil.cx/cy` (its
  // silhouette recenters every frame — `spinningTriangle`'s `TRI_ORBIT`-scaled
  // offset, up to +-0.213 of ball radius, itself spinning with `rot`). The
  // body path was drawn at `sil.cx + offX` all along; the eye matrix, before
  // this fix, added only `offX` — so the body visibly orbited its own center
  // and the eyes stayed pinned to world origin, drifting off the face.
  //
  // "Inside the body's bbox" per the report's own framing: for each sampled
  // instant, rebuild the exact silhouette `sample()` rendered (bloub's own
  // `orbit.pose(t)` triangle-to-ball blend, mean-radius-scaled onto the
  // seed — the same construction `bloub/engine.ts`'s `posed()` does) and
  // check both eye centers fall within its axis-aligned bounding box, with a
  // small margin since a capsule eye has its own extent beyond its center
  // point (the matrix's e,f is the eye's origin corner in bloub's own SVG
  // path convention, not its visual centroid).
  const orbitDef = STATE_BY_ID.get("orbit")!;
  const seeds = [
    superellipseProfile(2.5, 1, 0.55), // flat/wide
    superellipseProfile(3, 0.6, 1), // tall/narrow
    superellipseProfile(6, 1, 0.82), // rounded-square-ish
    new Array(64).fill(1) // perfect circle, sanity baseline
  ];

  for (const [i, seed] of seeds.entries()) {
    test(`eye centers stay within the rotating body's bbox — seed ${i}, full cycle`, () => {
      const engine = new BotEngine(R, "orbit", seed);
      let sampled = 0;
      // 4s covers orbit's 3.4s duration plus a bit of the next loop's start.
      for (let t = 0; t <= 4; t += 0.04) {
        const rawPose = orbitDef.pose(t);
        const scale = rawPose.sil.radii.reduce((a, b) => a + b, 0) / rawPose.sil.radii.length;
        const sil = { ...rawPose.sil, radii: seed.map((r) => r * scale) };
        const contour = toPoints(sil, R);
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const p of contour) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
        // Measured directly (pre-fix vs post-fix, same seeds/states/t-grid):
        // the missing `sil.cx/cy` term put eye centers 17.7-20.2 units outside
        // this exact bbox at the worst sampled instant; with the term added,
        // the worst distance outside is 0.00 across all four seeds. A tight
        // margin here is a real regression guard, not slack for an expected
        // fudge factor.
        const margin = 5;
        const frame = engine.sample(t);
        for (const eye of eyeCenters(frame.eyes)) {
          sampled++;
          expect(eye.x).toBeGreaterThan(minX - margin);
          expect(eye.x).toBeLessThan(maxX + margin);
          expect(eye.y).toBeGreaterThan(minY - margin);
          expect(eye.y).toBeLessThan(maxY + margin);
        }
      }
      expect(sampled).toBeGreaterThan(0);
    });
  }

  test("every orbit channel is phase-continuous across 3 full loop cycles", () => {
    // Structural loop test: `def.period` (`ORBIT_PERIOD`, `states.ts`) means
    // `BotEngine` itself wraps elapsed time into `[0, ORBIT_PERIOD)` before
    // `pose()` ever sees it (`wrapped()`, `bloub/engine.ts`) — every channel
    // `pose()` returns is therefore a function of that ONE wrapped number,
    // so there is no per-channel wrap to get out of sync. This is the direct
    // regression guard for the "eyes keep repinning" report: `reset(...,
    // true)` actually engages looping (a plain `new BotEngine(...)` does
    // not — `looping` defaults false), then sample continuously across 3
    // period boundaries at 60Hz and check every channel's frame-to-frame
    // delta stays within the same bound the state maintains mid-cycle,
    // i.e. the boundary is not distinguishable from any other instant.
    const seed = superellipseProfile(3, 0.6, 1);
    const engine = new BotEngine(R, "idle", seed);
    engine.reset("orbit", 0, true);

    const dt = 1 / 60;
    const cycles = 3;
    const totalT = ORBIT_PERIOD * cycles;

    type Sample = {
      cx: number;
      cy: number;
      e0x: number;
      e0y: number;
      e1x: number;
      e1y: number;
      e0a: number;
      e0b: number;
      ring0: number;
      yaw: number;
    };
    const series: Sample[] = [];
    for (let t = 0; t <= totalT; t += dt) {
      const frame = engine.sample(t);
      const centers = eyeCenters(frame.eyes);
      const raw = orbitDef.pose(t % ORBIT_PERIOD);
      const eye0 = frame.eyes[0]!;
      const nums = eye0.matrix.slice(7, -1).split(",").map(Number);
      series.push({
        cx: raw.sil.cx,
        cy: raw.sil.cy,
        e0x: centers[0]?.x ?? NaN,
        e0y: centers[0]?.y ?? NaN,
        e1x: centers[1]?.x ?? NaN,
        e1y: centers[1]?.y ?? NaN,
        e0a: nums[0]!,
        e0b: nums[1]!,
        // `frame.arcs` is the RENDERED (post `opacity > 0.01` filter,
        // `bloub/engine.ts`) list — it drops the ring entirely for a few
        // frames right where the entrance/exit envelope troughs near 0,
        // which shifts every later ring's array INDEX and reads as a huge
        // "opacity" swing that is actually two different rings. Read the
        // pre-filter value straight from `pose().arcs` instead, matching
        // `sil`/`gaze` above.
        ring0: raw.arcs[0]?.opacity ?? NaN,
        yaw: raw.gaze.yaw
      });
    }

    const keys: (keyof Sample)[] = ["cx", "cy", "e0x", "e0y", "e1x", "e1y", "e0a", "e0b", "ring0", "yaw"];
    // Per-channel bound: the largest delta ANYWHERE mid-cycle (excluding the
    // few samples nearest each period boundary, where the real bound is
    // established below) times a small safety factor — if the boundary
    // delta exceeds what the channel does elsewhere in the cycle, that IS a
    // snap. Mid-cycle deltas are tiny for constant/near-constant channels
    // (gaze, ring0 once settled) and bounded by ordinary motion for cx/cy
    // and the eye centers, so this is a real per-channel bound, not one
    // fixed number papering over very different channels.
    for (const key of keys) {
      let midMax = 0;
      let boundaryMax = 0;
      const boundaryIdx = new Set<number>();
      for (let c = 1; c < cycles; c++) boundaryIdx.add(Math.round((ORBIT_PERIOD * c) / dt));
      for (let i = 1; i < series.length; i++) {
        const d = Math.abs(series[i]![key] - series[i - 1]![key]);
        const nearBoundary = [...boundaryIdx].some((b) => Math.abs(i - b) <= 1);
        if (nearBoundary) boundaryMax = Math.max(boundaryMax, d);
        else midMax = Math.max(midMax, d);
      }
      expect(boundaryMax).toBeLessThanOrEqual(midMax * 1.5 + 0.05);
    }
  });

  test("orbit's own pose drives the eyes exclusively — idle wander contributes zero", () => {
    // Reconstruct the eye center independently from orbit's OWN raw `pose(t)`
    // gaze, with NO liveliness term added at all — the same construction
    // `bloub/engine.ts`'s `sample()` uses, minus `life`. If `ownsLiveliness`
    // is actually gating idle's wander/drift/breath to zero for this state,
    // `engine.sample(t)`'s real output should match this reconstruction
    // exactly (up to the engine's own `r2` two-decimal rounding); if wander
    // were leaking through, the two would disagree by its amplitude (this
    // round's own tuning: up to ~16deg yaw/pitch, an eye-center miss of
    // several units at R=100 — not a rounding-sized gap).
    const seed = superellipseProfile(3, 0.6, 1);
    const engine = new BotEngine(R, "orbit", seed);
    for (const t of [0.1, 0.6, 1.2, 1.9, 2.5, 3.1]) {
      const raw = orbitDef.pose(t);
      const scale = raw.sil.radii.reduce((a, b) => a + b, 0) / raw.sil.radii.length;
      const sil = { ...raw.sil, radii: seed.map((r) => r * scale) };
      const bodyRadiusAt = (x: number, y: number) => radiusAtAngle(sil.radii, Math.atan2(y, x) - sil.rot);
      const expected = eyePoses(raw.gaze, R, raw.split)
        .filter((e) => e.depth > 0.02) // same culling `sample()` applies
        .map((e) => ({
          x: r2(e.x * bodyRadiusAt(e.x, e.y) + sil.cx * R),
          y: r2(e.y * bodyRadiusAt(e.x, e.y) + sil.cy * R)
        }));
      const actual = eyeCenters(engine.sample(t).eyes);
      expect(actual.length).toBe(expected.length);
      actual.forEach((a, i) => {
        expect(a.x).toBeCloseTo(expected[i]!.x, 1);
        expect(a.y).toBeCloseTo(expected[i]!.y, 1);
      });
    }
  });

  test("gaze jostles around idle's own neutral — real travel, zero-mean, no bloub-sweep-sized swing", () => {
    // Regression guard for round C of this state's `gaze` line (`states.ts`'s
    // own comment on it has the full history): round A was bloub's verbatim
    // sweep (+-65deg yaw, `sin(t*6.5)` unsynced with `rot`'s own period, ridden
    // on the settle transient `back` — not loop-safe); round B over-corrected
    // to a flat constant (no motion at all, reported as its own bug — "the
    // eyes sit still while the body visibly tumbles"); round C (current) is a
    // jostle tied to `rot` — the SAME already-periodic signal driving
    // `sil.cx/cy` — small enough it never approaches round A's swing, but
    // large enough to be real, readable motion, and centered on
    // `NEUTRAL_GAZE` rather than replacing it.
    //
    // "Real travel": total absolute frame-to-frame change in each gaze
    // channel over one whole `ORBIT_PERIOD`, at a fine enough step (480
    // samples) that discretization error is negligible against the floor.
    // Measured at the current amplitude (`ORBIT_JOSTLE_YAW/PITCH/ROLL`,
    // `states.ts`): ~255/160/191 degrees of total travel — floors below are
    // set well under that, so this catches a reintroduced flat gaze (travel
    // -> 0) without being a re-tune tripwire on every amplitude nudge.
    const dt = ORBIT_PERIOD / 480
    let prev = orbitDef.pose(0).gaze
    let travelYaw = 0
    let travelPitch = 0
    let travelRoll = 0
    let sumYaw = 0
    let sumPitch = 0
    let sumRoll = 0
    let samples = 0
    for (let t = dt; t <= ORBIT_PERIOD; t += dt) {
      const gaze = orbitDef.pose(t).gaze
      travelYaw += Math.abs(gaze.yaw - prev.yaw)
      travelPitch += Math.abs(gaze.pitch - prev.pitch)
      travelRoll += Math.abs(gaze.roll - prev.roll)
      sumYaw += gaze.yaw
      sumPitch += gaze.pitch
      sumRoll += gaze.roll
      samples++
      prev = gaze
    }
    expect(travelYaw).toBeGreaterThan(150)
    expect(travelPitch).toBeGreaterThan(90)
    expect(travelRoll).toBeGreaterThan(100)

    // "Zero-mean, composes with neutral direction": the jostle is a pure
    // sin/cos of `rot`, and `rot` completes exactly 4 whole turns over
    // `ORBIT_PERIOD` (`states.ts`'s own `period` comment) — so the average
    // gaze across the whole loop should land back on `NEUTRAL_GAZE`, not
    // some other resting direction the eyes drift toward.
    const idleGaze = STATE_BY_ID.get("idle")!.pose(0).gaze
    expect(sumYaw / samples).toBeCloseTo(idleGaze.yaw, 1)
    expect(sumPitch / samples).toBeCloseTo(idleGaze.pitch, 1)
    expect(sumRoll / samples).toBeCloseTo(idleGaze.roll, 1)

    // "No bloub-sweep-sized swing": every sampled instant stays well inside
    // round A's own +-65deg yaw envelope — the jostle reads as shaken, not
    // as the eyes swinging out toward profile.
    for (let t = 0; t <= ORBIT_PERIOD; t += ORBIT_PERIOD / 40) {
      const gaze = orbitDef.pose(t).gaze
      expect(Math.abs(gaze.yaw)).toBeLessThan(30)
      expect(Math.abs(gaze.pitch)).toBeLessThan(30)
      expect(Math.abs(gaze.roll)).toBeLessThan(30)
    }

    // Loop-safe: `gaze` at the wrap point matches `t = 0` (both endpoints of
    // a pure, whole-turns function of `rot`), same continuity story the
    // phase-continuity test below already holds every other channel to.
    const atStart = orbitDef.pose(0).gaze
    const atWrap = orbitDef.pose(ORBIT_PERIOD).gaze
    expect(atWrap.yaw).toBeCloseTo(atStart.yaw, 6)
    expect(atWrap.pitch).toBeCloseTo(atStart.pitch, 6)
    expect(atWrap.roll).toBeCloseTo(atStart.roll, 6)
  });

  test("blink and breathing stay alive during orbit despite the pinned gaze", () => {
    // Same pairing `idle`'s own test group checks ("blink + breathe still
    // alive" — `ownsLiveliness` only gates ambient wander/drift, never
    // `liveliness`'s `lid`/`breath`, both keyed on `alive`/`blink` alone).
    // Orbit needs its own version because its body never holds still —
    // `bodyPath`'s bbox height mixing in `rot`'s own rotation/offset would
    // swamp any breath-driven change and give a false pass either way.
    // `rot`'s period is exactly 0.8s (`spinningTriangle`, `-TAU*1.25*t`),
    // so sampling at multiples of it holds silhouette rotation, offset AND
    // scale bit-for-bit identical across samples — any height difference
    // left is breath, and nothing else.
    const seed = superellipseProfile(3, 0.6, 1);
    const engine = new BotEngine(R, "orbit", seed);
    const bboxHeight = (d: string) => {
      const ys = [...d.matchAll(/-?\d+\.?\d*/g)].map(Number).filter((_, i) => i % 2 === 1);
      return Math.max(...ys) - Math.min(...ys);
    };
    const heights = new Set<number>();
    for (const t of [0, 0.8, 1.6, 2.4]) {
      heights.add(Math.round(bboxHeight(engine.sample(t).bodyPath) * 100) / 100);
    }
    expect(heights.size).toBeGreaterThan(1);

    // Blink lands on the eye's rendered (matrix-scaled) height, not the
    // unscaled capsule `d` — `engine.ts` applies `blinkScale(lid)` to the
    // matrix's y-basis, not the path. First scheduled blink is at t=1.4
    // (`BLINKS`, `face.ts`, deterministic), well inside `ORBIT_PERIOD`.
    const screenH = (d: string, matrix: string) => {
      const [a, b, c, dd, e, f] = matrix.slice(7, -1).split(",").map(Number);
      const ys = [...d.matchAll(/(-?\d+\.?\d*)[ ,](-?\d+\.?\d*)/g)].map(
        (m) => b! * Number(m[1]) + dd! * Number(m[2]) + f!
      );
      return Math.max(...ys) - Math.min(...ys);
    };
    const eyeAt = (t: number) => engine.sample(t).eyes[0]!;
    const openEye = eyeAt(1.3);
    const closedEye = eyeAt(1.48);
    const open = screenH(openEye.d, openEye.matrix);
    const closed = screenH(closedEye.d, closedEye.matrix);
    expect(closed).toBeLessThan(open * 0.3);
  });

  test("wander resumes once a non-owning state (wander) takes over", () => {
    // bolota split (later request): this used to target `idle` itself,
    // back when idle carried this exact choreography by default. `idle` is
    // now the deliberately-still "no-state" neutral (`ownsLiveliness: true`
    // — see its own test group above, travel is exactly 0 there) and
    // `wander` is what inherited the wandering-gaze behavior this test
    // actually proves. `wander` does NOT set `ownsLiveliness` — its own
    // `pose()`'s gaze is a constant `REST_GAZE` for its whole duration, so
    // any deviation from the pure constant-gaze reconstruction (same method
    // as the parity test above) is wander/drift actually contributing,
    // proving the gate is state-scoped, not a global kill switch that broke
    // every state's liveliness as a side effect.
    const engine = new BotEngine(R, "wander");
    let anyDeviation = false;
    for (let t = 0.5; t <= 8; t += 0.5) {
      const raw = STATE_BY_ID.get("wander")!.pose(t);
      const bodyRadiusAt = (x: number, y: number) => radiusAtAngle(raw.sil.radii, Math.atan2(y, x) - raw.sil.rot);
      const expected = eyePoses(raw.gaze, R, raw.split).map((e) => ({
        x: e.x * bodyRadiusAt(e.x, e.y),
        y: e.y * bodyRadiusAt(e.x, e.y)
      }));
      const actual = eyeCenters(engine.sample(t).eyes);
      if (Math.abs(actual[0]!.x - expected[0]!.x) > 0.1 || Math.abs(actual[0]!.y - expected[0]!.y) > 0.1) {
        anyDeviation = true;
        break;
      }
    }
    expect(anyDeviation).toBe(true);
  });
});

describe("wink — a real gesture, not a held pose", () => {
  const winkDef = STATE_BY_ID.get("wink")!;
  const OPEN_H = 0.464;
  const CLOSED_H = 0.089;

  test("t=0 and t=period-epsilon show both eyes open", () => {
    for (const t of [0, WINK_PERIOD - 0.001]) {
      const eyes = winkDef.pose(t).eyes;
      expect(eyes[0]!.h).toBeCloseTo(OPEN_H, 3);
      expect(eyes[1]!.h).toBeCloseTo(OPEN_H, 3);
    }
  });

  test("mid-hold shows the winking eye fully closed", () => {
    // Anywhere strictly inside the hold beat (see `WINK_CLOSE`'s doc
    // comment for the phase boundaries) — sampling the midpoint of it.
    const eyes = winkDef.pose(0.22).eyes;
    expect(eyes[1]!.h).toBeCloseTo(CLOSED_H, 3);
    expect(eyes[1]!.w).toBeCloseTo(0.447, 3);
  });

  test("the inner eye never moves — pose leaves it alone for its own blink schedule", () => {
    for (let t = 0; t < WINK_PERIOD; t += 0.05) {
      const eyes = winkDef.pose(t).eyes;
      expect(eyes[0]!.h).toBeCloseTo(OPEN_H, 6);
      expect(eyes[0]!.w).toBeCloseTo(0.236, 6);
    }
  });

  test("close and reopen are eased, not snapped", () => {
    // Same technique as the look-retarget easing proof above: a house-curve
    // (easeInOutCubic) ease has near-zero SLOPE at k=0, so only a small
    // fraction of the full open->closed swing should land in the first 10%
    // of the close phase — a linear or ease-out ramp would front-load much
    // more of it.
    const closeDur = 0.16; // WINK_CLOSE, not exported — mirrors states.ts
    const h0 = winkDef.pose(0).eyes[1]!.h;
    const h10pct = winkDef.pose(closeDur * 0.1).eyes[1]!.h;
    const hFull = winkDef.pose(closeDur).eyes[1]!.h;
    const total = Math.abs(hFull - h0);
    const early = Math.abs(h10pct - h0);
    expect(early / total).toBeLessThan(0.15);
  });

  test("every wink channel is phase-continuous across 3 full loop cycles", () => {
    const engine = new BotEngine(R, "idle");
    engine.reset("wink", 0, true);
    const dt = 1 / 60;
    const cycles = 3;
    const totalT = WINK_PERIOD * cycles;

    type Sample = { e0h: number; e1h: number; e1w: number; e0x: number; e0y: number; e1x: number; e1y: number };
    const series: Sample[] = [];
    for (let t = 0; t <= totalT; t += dt) {
      const frame = engine.sample(t);
      const raw = winkDef.pose(t % WINK_PERIOD);
      const centers = eyeCenters(frame.eyes);
      series.push({
        e0h: raw.eyes[0]!.h,
        e1h: raw.eyes[1]!.h,
        e1w: raw.eyes[1]!.w,
        e0x: centers[0]?.x ?? NaN,
        e0y: centers[0]?.y ?? NaN,
        e1x: centers[1]?.x ?? NaN,
        e1y: centers[1]?.y ?? NaN
      });
    }

    const keys: (keyof Sample)[] = ["e0h", "e1h", "e1w", "e0x", "e0y", "e1x", "e1y"];
    const boundaryIdx = new Set<number>();
    for (let c = 1; c < cycles; c++) boundaryIdx.add(Math.round((WINK_PERIOD * c) / dt));
    for (const key of keys) {
      let midMax = 0;
      let boundaryMax = 0;
      for (let i = 1; i < series.length; i++) {
        const d = Math.abs(series[i]![key] - series[i - 1]![key]);
        const nearBoundary = [...boundaryIdx].some((b) => Math.abs(i - b) <= 1);
        if (nearBoundary) boundaryMax = Math.max(boundaryMax, d);
        else midMax = Math.max(midMax, d);
      }
      expect(boundaryMax).toBeLessThanOrEqual(midMax * 1.5 + 0.05);
    }
  });

  test("one-shot play (unlooped) still ends the gesture and holds open, no repeat", () => {
    // Mirrors how the bridge plays a state without `loop: true`: `t` grows
    // unbounded (`BotEngine.wrapped()` only wraps when `looping` is true, so
    // an unlooped `pose(t)` call never sees a wrapped value either — this
    // exercises exactly that raw, unwrapped `t`). Past `WINK_PERIOD` the
    // phase math's own `else` branch (rest) holds — it does not wrap on its
    // own, so a single play never re-closes the eye.
    for (const t of [WINK_PERIOD + 0.1, WINK_PERIOD * 2, WINK_PERIOD * 3]) {
      const eyes = winkDef.pose(t).eyes;
      expect(eyes[1]!.h).toBeCloseTo(OPEN_H, 3);
    }
  });
});

/**
 * Eye GEOMETRY (size, not just center/alpha) tracking the body's own scale.
 * Found only by actually rendering frames (a throwaway debug page, static
 * SVG snapshots, screenshotted): every prior invariant in this file checked
 * eye CENTER position (anchoring, containment-by-a-point) or alpha — none
 * of them look at how big the eye capsule itself is, so a full-size eye on
 * a shrunken body (`burst`/`comet` mid-collapse; `orbit`/`play`'s constant
 * ~0.86 scale, both render bloub's own triangle profile) passed every
 * existing check while reading as a giant dark mass in a screenshot. These
 * two checks operate on the RENDERED capsule bbox (parsed from `eye.d` +
 * `eye.matrix`, not reconstructed from the pose formula — reconstructing
 * would just check the fix agrees with itself) against the RENDERED body
 * bbox (parsed from `bodyPath`), so they'd have caught the regression bbox
 * containment / alpha-only checks missed.
 */
describe("eye geometry scales with the body (bbox containment + area ratio)", () => {
  /** Endpoints only (M/L points, A commands' arc ENDPOINT, not their r/r/rot/flags). */
  function pathPoints(d: string): { x: number; y: number }[] {
    const tokens = d.match(/[MLAZ][^MLAZ]*/g) ?? [];
    const pts: { x: number; y: number }[] = [];
    for (const tok of tokens) {
      const nums = tok
        .slice(1)
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      if (nums.length < 2) continue;
      if (tok[0] === "M" || tok[0] === "L") pts.push({ x: nums[0]!, y: nums[1]! });
      else if (tok[0] === "A") pts.push({ x: nums[nums.length - 2]!, y: nums[nums.length - 1]! });
    }
    return pts;
  }

  function bbox(pts: { x: number; y: number }[]) {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }

  /** Local `eye.d` bbox, transformed by `eye.matrix` into world space. */
  function eyeWorldBbox(eye: { d: string; matrix: string }) {
    const [a, b, c, d, e, f] = eye.matrix.slice(7, -1).split(",").map(Number) as number[];
    const local = pathPoints(eye.d);
    const world = local.map((p) => ({ x: a! * p.x + c! * p.y + e!, y: b! * p.x + d! * p.y + f! }));
    return bbox(world);
  }

  /**
   * `bodyPath` is `closedPath`'s Catmull-Rom cubic beziers (`M`/`C`
   * commands, `bloub/shape.ts`) — a different grammar than the eye
   * capsule's `M`/`L`/`A`, so `pathPoints` above (which doesn't know about
   * `C`) doesn't apply. Every number in the string, control points
   * included, gives a bbox that's a close over-estimate of the true curve
   * (control points sit near a Catmull-Rom curve, not the curve itself) —
   * fine for a containment MARGIN check, and simpler than a second
   * command-aware parser for one more curve type.
   */
  function bodyWorldBbox(bodyPath: string) {
    const nums = [...bodyPath.matchAll(/-?\d+\.?\d*/g)].map((m) => Number(m[0]));
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i]!, y: nums[i + 1]! });
    return bbox(pts);
  }

  const area = (b: { minX: number; maxX: number; minY: number; maxY: number }) =>
    Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);

  test('"burst"/"comet": eye bbox stays inside the body bbox at every sampled t, collapse through regrow', () => {
    for (const state of ["burst", "comet"] as const) {
      // A seed is required here: the eye/body scaling fix lives in
      // `bloub/engine.ts`'s `posed()`, gated on `shape` being truthy — a
      // `BotEngine` built with no seed (`shape=null`) skips that branch
      // entirely and would silently measure the UNFIXED behavior.
      const engine = new BotEngine(R, state, superellipseProfile(3, 0.6, 1));
      for (let t = 0; t <= 2.5; t += 0.05) {
        const frame = engine.sample(t);
        if (frame.eyes.length === 0) continue; // faded out — nothing to check
        const body = bodyWorldBbox(frame.bodyPath);
        // Small margin: body outline is a Catmull-Rom curve through 64
        // sampled points, not the true smooth silhouette — its own control
        // points can sit fractionally inside the visual curve.
        const margin = 2;
        for (const eye of frame.eyes) {
          const eb = eyeWorldBbox(eye);
          expect(eb.minX, `${state} t=${t} eye minX`).toBeGreaterThanOrEqual(body.minX - margin);
          expect(eb.maxX, `${state} t=${t} eye maxX`).toBeLessThanOrEqual(body.maxX + margin);
          expect(eb.minY, `${state} t=${t} eye minY`).toBeGreaterThanOrEqual(body.minY - margin);
          expect(eb.maxY, `${state} t=${t} eye maxY`).toBeLessThanOrEqual(body.maxY + margin);
        }
      }
    }
  });

  test('"burst"/"comet": eye bbox area / body bbox area ratio stays bounded through collapse', () => {
    for (const state of ["burst", "comet"] as const) {
      // A seed is required here: the eye/body scaling fix lives in
      // `bloub/engine.ts`'s `posed()`, gated on `shape` being truthy — a
      // `BotEngine` built with no seed (`shape=null`) skips that branch
      // entirely and would silently measure the UNFIXED behavior.
      const engine = new BotEngine(R, state, superellipseProfile(3, 0.6, 1));
      let worst = 0;
      let worstAt = 0;
      for (let t = 0; t <= 2.5; t += 0.02) {
        const frame = engine.sample(t);
        if (frame.eyes.length === 0) continue;
        const bodyArea = area(bodyWorldBbox(frame.bodyPath));
        for (const eye of frame.eyes) {
          const ratio = area(eyeWorldBbox(eye)) / bodyArea;
          if (ratio > worst) {
            worst = ratio;
            worstAt = t;
          }
        }
      }
      // Regression measured: uncorrected eye size hit ~0.55-0.7 (an eye bbox
      // more than half the body's own bbox area) mid-regrow. A resting,
      // full-scale idle eye against its own full-scale body sits under 0.1
      // (small capsules on a round ball) — 0.2 gives real margin above that
      // baseline while still catching a giant-eye regression by a wide
      // factor, not a hair-trigger on the exact resting ratio.
      expect(worst, `${state} worst ratio at t=${worstAt}`).toBeLessThan(0.2);
    }
  });

  test('"orbit"/"play": eye bbox stays inside the constant-scale body bbox', () => {
    for (const state of ["orbit", "play"] as const) {
      const engine = new BotEngine(R, state, superellipseProfile(3, 0.6, 1));
      const margin = 2;
      for (let t = 0; t <= 3.2; t += 0.05) {
        const frame = engine.sample(t);
        if (frame.eyes.length === 0) continue;
        const body = bodyWorldBbox(frame.bodyPath);
        for (const eye of frame.eyes) {
          const eb = eyeWorldBbox(eye);
          expect(eb.minX, `${state} t=${t}`).toBeGreaterThanOrEqual(body.minX - margin);
          expect(eb.maxX, `${state} t=${t}`).toBeLessThanOrEqual(body.maxX + margin);
          expect(eb.minY, `${state} t=${t}`).toBeGreaterThanOrEqual(body.minY - margin);
          expect(eb.maxY, `${state} t=${t}`).toBeLessThanOrEqual(body.maxY + margin);
        }
      }
    }
  });
});
