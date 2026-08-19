import { describe, expect, test } from "bun:test";
import { bolota } from "../src/bolota";
import { blobPath, polygon, superellipse } from "../src/shape";
import { style } from "../src/styles/blob";
import type { Layout } from "../src/styles/compose";
import { traits } from "../src/traits";
import { BLOB_KEYS } from "./keys";

/**
 * Geometric invariants that replace eyeballing the tuning grid one cell at a
 * time. Taste is judged in aggregate; these checks reject broken geometry.
 */

const SEEDS = Array.from({ length: 6000 }, (_, i) => `seed-${i}`);

const inside = (
  px: number,
  py: number,
  s: { cx: number; cy: number; rx: number; ry: number; n: number },
) => Math.pow(Math.abs((px - s.cx) / s.rx), s.n) + Math.pow(Math.abs((py - s.cy) / s.ry), s.n);

function corners(e: { cx: number; cy: number; rx: number; ry: number; rot: number }) {
  const t = (e.rot * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy]) => [
    e.cx + sx! * e.rx * c - sy! * e.ry * s,
    e.cy + sx! * e.rx * s + sy! * e.ry * c,
  ]);
}

describe("the frame", () => {
  test("all geometry stays inside the viewBox", () => {
    for (const s of SEEDS) {
      const svg = bolota(s, { background: false });
      for (const m of svg.matchAll(/ d="([^"]+)"/g)) {
        for (const n of m[1]!.match(/-?\d+\.?\d*/g)!.map(Number)) {
          expect(n).toBeGreaterThanOrEqual(0);
          expect(n).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});

describe("path emission", () => {
  test("superellipse coordinates stay finite for the whole n range", () => {
    for (let n = 1.6; n <= 8; n += 0.1) {
      const d = superellipse({ cx: 50, cy: 50, rx: 30, ry: 30, n });
      expect(d).not.toContain("NaN");
      for (const v of d.match(/-?\d+(\.\d+)?/g)!) expect(Number.isFinite(+v)).toBe(true);
    }
  });

  test("the 45-degree control constant matches the circle case exactly", () => {
    // n=2 must reproduce the standard 0.5523 kappa, or the derivation is wrong.
    expect(superellipse({ cx: 0, cy: 0, rx: 100, ry: 100, n: 2 })).toContain("55.23");
  });

  test("control points never overshoot the bounding box", () => {
    for (let n = 1.6; n <= 8; n += 0.1) {
      for (const v of superellipse({ cx: 50, cy: 50, rx: 40, ry: 40, n }).match(/-?\d+(\.\d+)?/g)!) {
        expect(+v).toBeGreaterThanOrEqual(9.9);
        expect(+v).toBeLessThanOrEqual(90.1);
      }
    }
  });

  test("blobPath interpolates its vertices exactly", () => {
    // Catmull-Rom passes through its points, which is what makes the radii
    // mean what they say and containment predictable.
    const d = blobPath(50, 50, 20, 20, [1, 1, 1, 1], 0);
    expect(d).toStartWith("M70 50");
    expect(d).toContain("50 70");
    expect(d).toContain("30 50");
  });

  test("blobPath closes and stays within its radii", () => {
    const radii = [1.1, 0.9, 1.05, 0.95, 1.12, 0.88];
    const d = blobPath(50, 50, 20, 20, radii, 0);
    expect(d).toEndWith("Z");
    for (const v of d.match(/-?\d+(\.\d+)?/g)!) {
      expect(+v).toBeGreaterThan(50 - 20 * 1.5);
      expect(+v).toBeLessThan(50 + 20 * 1.5);
    }
  });
});

/**
 * Bolota 2's containment, which is a different proof from the previous generation's.
 *
 * gen1 could measure the eye cluster against the body radius because all six of
 * its silhouettes were roughly round and roughly centred. Half of Bolota 2's are
 * not — a triangle's usable interior is a fraction of its circumradius, a
 * capsule's is squat, a droplet's is not centred on the frame — so the layout
 * states a `face` and everything below checks that the face is honest: that it
 * really is inside the silhouette it claims to be inscribed in, shape by shape,
 * with the actual geometry rather than with a shared approximation.
 */
describe("blob", () => {
  const layouts = SEEDS.map(s => style.layout(traits(s)) as Layout);

  /** The rounded polygon's cut points, which the drawn outline strictly contains. */
  function cutHull(b: Layout["body"] & { sides: number; round: number }): [number, number][] {
    const k = b.round > 0 ? (b.round < 1 ? b.round / 2 : 0.5) : 0;
    const t0 = (b.rot * Math.PI) / 180 - Math.PI / 2;
    const v = Array.from({ length: b.sides }, (_, i) => {
      const a = t0 + (2 * Math.PI * i) / b.sides;
      return [b.cx + b.rx * Math.cos(a), b.cy + b.ry * Math.sin(a)] as [number, number];
    });
    const at = (i: number) => v[((i % b.sides) + b.sides) % b.sides]!;
    const out: [number, number][] = [];
    for (let i = 0; i < b.sides; i++) {
      for (const j of [i - 1, i + 1]) {
        const [x0, y0] = at(i);
        const [x1, y1] = at(j);
        out.push([x0 + (x1 - x0) * k, y0 + (y1 - y0) * k]);
      }
    }
    // Angular sort, so the cut points come back as a traversable convex polygon
    // rather than in vertex-pair order.
    return out.sort(
      (a, c) => Math.atan2(a[1] - b.cy, a[0] - b.cx) - Math.atan2(c[1] - b.cy, c[0] - b.cx),
    );
  }

  const inConvex = (px: number, py: number, poly: [number, number][]) => {
    let neg = false;
    let pos = false;
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i]!;
      const [x1, y1] = poly[(i + 1) % poly.length]!;
      const cross = (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0);
      if (cross > 1e-9) pos = true;
      if (cross < -1e-9) neg = true;
    }
    return !(pos && neg);
  };

  /** Distance from a point to the segment joining a capsule's two cap centres. */
  const toSpine = (px: number, py: number, l: Layout) => {
    const half = l.body.rx - l.body.ry;
    const dx = Math.max(0, Math.abs(px - l.body.cx) - half);
    return Math.hypot(dx, py - l.body.cy);
  };

  /**
   * Whether a point is inside the drawn silhouette. Conservative everywhere: the
   * shapes that union extra parts are tested against the core alone, and the
   * spline shapes against their smallest sampled radius.
   */
  function inBody(px: number, py: number, l: Layout) {
    const b = l.body;
    // The `shape` guard is what makes `sides` and `round` present — they are
    // optional on `Body` because only the polygon shapes set them, and only the
    // polygon shapes reach this branch.
    if (l.shape === "triangle" || l.shape === "hexagon")
      return inConvex(px, py, cutHull(b as typeof b & { sides: number; round: number }));
    if (l.shape === "capsule") return toSpine(px, py, l) <= b.ry;
    const shrink =
      l.shape === "organic" || l.shape === "cloud" ? Math.min(...b.radii) * 0.95 : 1;
    // Understate squareness: a boxy body is roomier than the ellipse we test.
    return inside(px, py, { cx: b.cx, cy: b.cy, rx: b.rx * shrink, ry: b.ry * shrink, n: 2 }) < 1;
  }

  const checkEyes = (ls: Layout[]) => {
    for (const l of ls) {
      for (const e of l.eyes) {
        for (const [x, y] of corners(e)) {
          // First against the face, which is what the layout's `fit` promises…
          expect(inside(x!, y!, { ...l.face, n: 2 })).toBeLessThan(1);
          // …and then against the silhouette itself, which is what the face is
          // only a claim about. This is the assertion that catches a face table
          // retuned past what the shape can actually hold.
          expect(inBody(x!, y!, l)).toBe(true);
        }
      }
    }
  };

  test("eyes sit inside the face, and the face inside the body", () => {
    checkEyes(layouts);
  });

  test("eyes never fuse into each other", () => {
    for (const l of layouts) {
      const [a, b] = l.eyes as [(typeof l.eyes)[0], (typeof l.eyes)[0]];
      const reach = (e: typeof a) => {
        const t = (e.rot * Math.PI) / 180;
        return Math.abs(e.rx * Math.cos(t)) + Math.abs(e.ry * Math.sin(t));
      };
      expect(Math.abs(b.cx - a.cx)).toBeGreaterThan(reach(a) + reach(b));
    }
  });

  test("decoration stays attached to the body", () => {
    for (const l of layouts) {
      for (const p of l.petals) {
        const d = Math.hypot(p.cx - l.body.cx, p.cy - l.body.cy);
        expect(d).toBeLessThan(l.body.rx * 0.95 + p.r);
      }
      // The droplet's taper is the one part meant to leave the core, so it is
      // checked the other way round: it starts at a tangent point, which has to
      // sit *on* the body ellipse. Off it either way and the union comes apart
      // — a gap below, or the crease that a cone stuck onto a ball shows.
      for (const d of l.extra) {
        const [x, y] = d.slice(1, d.indexOf("L")).split(" ").map(Number) as [number, number];
        expect(inside(x, y, { ...l.body, n: 2 })).toBeCloseTo(1, 2);
        // …and the curve it is tangent to has to be the one actually drawn, so
        // the body it hangs off stays a true ellipse rather than a squarer one.
        expect(l.body.n).toBe(2);
      }
    }
  });

  test("every shape in the vocabulary is reachable", () => {
    expect(new Set(layouts.map(l => l.shape))).toEqual(
      new Set([
        "round", "organic", "boxy", "nub", "cloud", "sun",
        "capsule", "triangle", "hexagon", "droplet",
      ]),
    );
  });

  test("the everyday shapes stay everyday and the loud ones stay rare", () => {
    const share = (s: string) => layouts.filter(l => l.shape === s).length / layouts.length;
    // Four more silhouettes than the previous generation and still not a uniform ten-way split:
    // rounds and pebbles carry a wall of these, and a triangle is a find.
    expect(share("round") + share("organic")).toBeGreaterThan(0.4);
    expect(share("triangle")).toBeLessThan(0.04);
    expect(share("sun") + share("hexagon") + share("droplet")).toBeLessThan(0.16);
  });

  test("all geometry stays inside the viewBox", () => {
    for (const s of SEEDS) {
      const svg = bolota(s, { background: false });
      for (const m of svg.matchAll(/ d="([^"]+)"|<circle ([^>]+)>/g)) {
        const src = m[1] ?? m[2]!;
        for (const n of src.match(/-?\d+\.?\d*/g)!.map(Number)) {
          expect(n).toBeGreaterThanOrEqual(-0.01);
          expect(n).toBeLessThanOrEqual(100.01);
        }
      }
    }
  });

  /**
   * The same invariants under configuration rather than under seeds — the
   * corners a hashed sweep barely samples and an editor's sliders reach in one
   * drag. Same construction as the previous generation's block above, over Bolota 2's key list.
   */
  describe("under trait overrides", () => {
    const MAPS: Record<string, number>[] = [];
    for (const v of [0, 0.5, 0.999999]) {
      const all: Record<string, number> = {};
      for (const k of BLOB_KEYS) all[k] = v;
      MAPS.push(all);
      for (const k of BLOB_KEYS) MAPS.push({ ...all, [k]: 0 }, { ...all, [k]: 0.999999 });
    }
    // Every shape band crossed with those extremes, since one `shape` value per
    // map would otherwise leave eight of the ten silhouettes untested here.
    for (const at of [0.1, 0.35, 0.55, 0.65, 0.75, 0.82, 0.89, 0.93, 0.96, 0.99]) {
      for (const v of [0, 0.5, 0.999999]) {
        const all: Record<string, number> = {};
        for (const k of BLOB_KEYS) all[k] = v;
        MAPS.push({ ...all, shape: at });
      }
    }
    let s = 1;
    for (let i = 0; i < 400; i++) {
      const m: Record<string, number> = {};
      for (const k of BLOB_KEYS) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        m[k] = s / 4294967296;
      }
      MAPS.push(m);
    }

    const cfg = MAPS.map(m => style.layout(traits("cfg", true, m)) as Layout);

    test("eyes sit inside the face, and the face inside the body", () => {
      checkEyes(cfg);
    });

    test("all geometry stays inside the viewBox", () => {
      for (const m of MAPS) {
        const svg = bolota("cfg", { traits: m, background: false });
        expect(svg).not.toContain("NaN");
        for (const g of svg.matchAll(/ d="([^"]+)"|<circle ([^>]+)>/g)) {
          for (const n of (g[1] ?? g[2]!).match(/-?\d+\.?\d*/g)!.map(Number)) {
            expect(n).toBeGreaterThanOrEqual(-0.01);
            expect(n).toBeLessThanOrEqual(100.01);
          }
        }
      }
    });
  });
});

describe("polygon", () => {
  test("sharp corners land exactly on the vertices", () => {
    // round: 0 means no cut, so the path walks the vertices themselves — the
    // property that makes `rx`/`ry` mean circumradius rather than something near it.
    const d = polygon({ cx: 50, cy: 50, rx: 20, ry: 20, sides: 4, round: 0 });
    expect(d).toContain("50 30");
    expect(d).toContain("70 50");
    expect(d).toContain("50 70");
    expect(d).toContain("30 50");
  });

  test("a vertex sits at the top, so a triangle rests on its base", () => {
    const d = polygon({ cx: 50, cy: 50, rx: 20, ry: 20, sides: 3, round: 0 });
    expect(d).toContain("50 30");
    // …and the other two are level, at cy + ry·sin(30°).
    expect(d).toContain("60");
    expect(d).not.toContain("50 70");
  });

  test("the outline never leaves the bounding box", () => {
    // Quadratics through the vertices stay in the convex hull of their control
    // points, which is what makes this true by construction rather than by luck.
    for (const sides of [3, 4, 5, 6, 8]) {
      for (let round = 0; round <= 1.0001; round += 0.1) {
        for (const rot of [0, 17, 90, -33]) {
          const d = polygon({ cx: 50, cy: 50, rx: 30, ry: 20, sides, round, rot });
          expect(d).not.toContain("NaN");
          expect(d).toEndWith("Z");
          for (const [i, v] of d.match(/-?\d+\.?\d*/g)!.map(Number).entries()) {
            const [lo, hi] = i % 2 === 0 ? [19.9, 80.1] : [29.9, 70.1];
            expect(v).toBeGreaterThanOrEqual(lo);
            expect(v).toBeLessThanOrEqual(hi);
          }
        }
      }
    }
  });

  test("full rounding drops the straight runs instead of emitting empty ones", () => {
    // At round: 1 the two cuts on an edge meet at its midpoint, so every `L`
    // would be zero-length. One per side, on a shape drawn once per bolota.
    expect(polygon({ cx: 50, cy: 50, rx: 20, ry: 20, sides: 6, round: 1 })).not.toContain("L");
    expect(polygon({ cx: 50, cy: 50, rx: 20, ry: 20, sides: 6, round: 0.9 })).toContain("L");
  });
});
