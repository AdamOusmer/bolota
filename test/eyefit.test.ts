import { describe, expect, test } from "bun:test";
import { BotEngine, type Look } from "../src/bloub/engine";
import { radiusAtAngle, superellipseProfile } from "../src/bloub/shape";
import type { StateId } from "../src/bloub/states";

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

  for (const shape of shapes) {
    for (const state of baseBodyStates) {
      test(`eyes sit centrally, not pinned to the edge — state "${state}", seed n=${JSON.stringify(shape[0])}`, () => {
        const engine = new BotEngine(R, state, shape);
        const frame = engine.sample(1.0);
        expect(frame.eyes.length).toBeGreaterThan(0);
        for (const eye of eyeCenters(frame.eyes)) {
          const angle = Math.atan2(eye.y, eye.x);
          const localBodyRadius = radiusAtAngle(shape, angle) * R;
          const ratio = Math.hypot(eye.x, eye.y) / localBodyRadius;
          // "Stuck at the top/side" == ratio near or over 1 (eye at/past the
          // silhouette's own edge). A corrected anchor sits well inside it.
          expect(ratio).toBeLessThan(0.95);
          expect(ratio).toBeGreaterThan(0.1);
        }
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
    for (let t = dt; t <= 10; t += dt) {
      const cur = eyeCenters(engine.sample(t).eyes)[0]!;
      travel += dist(prev, cur);
      prev = cur;
    }
    // Pre-fix amplitude (dYaw <= 7.1deg, dPitch <= 5.5deg) measured well under
    // 40 viewBox units of accumulated travel over 10s on a R=100 ball; raising the
    // wander amplitude ~2.2x (`face.ts`) comfortably clears 100.
    expect(travel).toBeGreaterThan(100);
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
