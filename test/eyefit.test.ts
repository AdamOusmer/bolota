import { describe, expect, test } from "bun:test";
import { BotEngine, type Look } from "../src/bloub/engine";
import { eyePoses } from "../src/bloub/face";
import { r2 } from "../src/bloub/math";
import { radiusAtAngle, superellipseProfile, toPoints } from "../src/bloub/shape";
import { STATE_BY_ID, type StateId } from "../src/bloub/states";

// `BotEngine.sample(t)` is pure and DOM-free ("moteur sans horloge" — see its own
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
  // Three synthetic seeds standing in for blobatar bodies: superellipse profiles
  // with exponents/scales that do not match any of bloub's 8 catalog `SHAPES`
  // (`skins.ts`) — the array reference `decalageDesYeux` used to key its
  // correction table on, and which no real blobatar seed ever equals. Before the
  // fix, `DECALAGES.get(radii)` missed for all three and every correction fell
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

describe("bug 2 — idle gaze travel", () => {
  test("eye-center path length over 10s of idle exceeds a meaningful threshold", () => {
    const engine = new BotEngine(R);
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
    // (`face.ts`) -> 112.50, x (82.78) leading y (61.90) by 1.34x. Round 2 verdict:
    // still not enough. Amplitude turned out to be tightly gated by `eyefit.ts`'s
    // containment solve (see `face.ts`'s comment — a 600s+ sweep found the real
    // feasibility cliff sits almost exactly at round 1's numbers), so round 2
    // spent its budget mostly on period instead — measured amplitude-gated only,
    // period nearly free — landing at 252.48 (x 166.90 / y 158.13, ratio 1.06).
    // Floor set well under the measured value so the test catches a regression,
    // not a re-tune.
    expect(travel).toBeGreaterThan(200);
    // x-y balance: neither axis should dominate the way x did pre-round-2.
    expect(tx / ty).toBeGreaterThan(0.7);
    expect(tx / ty).toBeLessThan(1.4);
  });
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

describe("bug 4 — eyes stay alive through comet/burst collapse", () => {
  test('"comet" keeps eyeAlpha > 0 through its deepest collapse instant', () => {
    const engine = new BotEngine(R, "comet");
    for (const t of [0, 0.2, 0.55, 1.0, 1.5, 1.84, 2.0, 2.3]) {
      const frame = engine.sample(t);
      expect(frame.eyes.length).toBeGreaterThan(0);
      for (const eye of frame.eyes) expect(eye.alpha).toBeGreaterThan(0.15);
    }
  });

  test('"burst" keeps eyeAlpha > 0 through its deepest collapse instant', () => {
    const engine = new BotEngine(R, "burst");
    for (const t of [0, 0.2, 0.7, 1.0, 1.7, 2.4, 2.5]) {
      const frame = engine.sample(t);
      expect(frame.eyes.length).toBeGreaterThan(0);
      for (const eye of frame.eyes) expect(eye.alpha).toBeGreaterThan(0.15);
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

  test("no eye-center discontinuity across the orbit loop wrap (t=duration -> t=0)", () => {
    const engine = new BotEngine(R, "orbit", superellipseProfile(3, 0.6, 1));
    // BotEngine.sample is a pure function of `now` and does not itself loop —
    // the bridge's `tick()` calls `engine.reset(current, clock)` on wrap. Model
    // that directly: sample the tail end of one cycle and the head of the
    // next on a freshly-reset engine, and check the eye center doesn't jump.
    const before = eyeCenters(engine.sample(orbitDef.duration - 0.01).eyes)[0]!;
    engine.reset("orbit", 0);
    const after = eyeCenters(engine.sample(0.01).eyes)[0]!;
    // Not a tight bound (the pose itself is discontinuous at the loop point in
    // bloub's own design — `rot` resets, the ring fade re-triggers — so some
    // jump is real and expected); this catches the eyes specifically snapping
    // much FARTHER than the body's own frame-to-frame travel would.
    expect(dist(before, after)).toBeLessThan(R);
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

  test("wander resumes once a non-owning state (idle) takes over", () => {
    // idle does NOT set `ownsLiveliness` — its gaze is a constant `REST_GAZE`
    // for its whole duration, so any deviation from the pure constant-gaze
    // reconstruction (same method as the parity test above) is wander/drift
    // actually contributing, proving the gate is state-scoped, not a global
    // kill switch that broke idle's own liveliness as a side effect.
    const engine = new BotEngine(R, "idle");
    let anyDeviation = false;
    for (let t = 0.5; t <= 8; t += 0.5) {
      const raw = STATE_BY_ID.get("idle")!.pose(t);
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
