// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Ported from blobatar's test/gaze.test.ts (c) 2026 Alain, MIT. See LICENSE.

import { describe, expect, test } from "bun:test";
import {
  DEADZONE,
  HOLD_EPS,
  LIMB,
  SETTLE,
  SNAP,
  project,
  pursuit,
  smoothstep,
  step,
  threshold,
} from "../src/gaze";

const EYE = { x: (63.3 - 48.84) / 33.57, y: (48.05 - 51.21) / 33.57 };

describe("pursuit", () => {
  test("covers ~63% of the way in one time constant", () => {
    expect(pursuit(SETTLE)).toBeCloseTo(1 - Math.exp(-1), 6);
  });

  test("is frame-rate independent: two 8ms steps land where one 16ms step does", () => {
    const half = pursuit(8);
    expect(1 - (1 - half) * (1 - half)).toBeCloseTo(pursuit(16), 12);
  });

  test("a zero settle is a snap rather than a division by zero", () => {
    expect(pursuit(16, 0)).toBe(1);
  });
});

describe("threshold", () => {
  test("a wider bolota at the same excursion needs a finer threshold", () => {
    expect(threshold(400, 3)).toBeLessThan(threshold(100, 3));
  });

  test("clamped at both ends", () => {
    expect(threshold(24, 0.1)).toBeLessThanOrEqual(0.06);
    expect(threshold(4000, 40)).toBeGreaterThanOrEqual(0.002);
  });

  test("no excursion is the coarsest threshold, not an infinite one", () => {
    expect(threshold(200, 0)).toBe(0.06);
  });
});

describe("step", () => {
  const base = { x: 0, y: 0, radius: 100, k: 1 };

  test("aims at the target, normalised", () => {
    const s = step({ ...base, dx: 300, dy: 0 });
    expect(s.tx).toBeCloseTo(1, 6);
    expect(s.ty).toBeCloseTo(0, 6);
  });

  test("the near field eases the amplitude to zero, not the direction", () => {
    const on = step({ ...base, dx: 0.001, dy: 0 });
    expect(Math.hypot(on.tx, on.ty)).toBeLessThan(0.001);
  });

  test("pointing straight at a face makes it look straight back", () => {
    const s = step({ ...base, dx: 0, dy: 0 });
    expect(s.tx).toBe(0);
    expect(s.ty).toBe(0);
  });

  test("the near field is a fraction of the bolota's own radius", () => {
    const d = 100 * DEADZONE * 0.5;
    const small = step({ ...base, radius: 100, dx: d, dy: 0 });
    const large = step({ ...base, radius: 400, dx: d, dy: 0 });
    expect(large.tx).toBeLessThan(small.tx);
  });

  test("a target that moves at pursuit speed is pursued", () => {
    expect(step({ ...base, x: 0.9, y: 0, dx: 300, dy: 0, k: 0.2 }).f).toBe(0.2);
  });

  test("a target that is replaced rather than moved is jumped to", () => {
    const s = step({ ...base, x: -1, y: 0, dx: 300, dy: 0, k: 0.2 });
    expect(Math.hypot(s.tx + 1, s.ty)).toBeGreaterThan(SNAP);
    expect(s.f).toBe(1);
  });

  test("gain scales the excursion without touching the aim", () => {
    const full = step({ ...base, dx: 300, dy: 0 });
    const half = step({ ...base, dx: 300, dy: 0, gain: 0.5 });
    expect(half.tx).toBeCloseTo(full.tx * 0.5, 6);
  });

  test("it converges, and without overshooting", () => {
    let s = { x: 0, y: 0 };
    let prev = -Infinity;
    for (let i = 0; i < 60; i++) {
      s = step({ ...base, x: s.x, y: s.y, dx: 300, dy: 0, k: 0.2 });
      expect(s.x).toBeGreaterThanOrEqual(prev);
      expect(s.x).toBeLessThanOrEqual(1);
      prev = s.x;
    }
    expect(s.x).toBeCloseTo(1, 3);
  });

  test("a zero radius is a bolota not yet laid out, not a NaN", () => {
    const s = step({ ...base, radius: 0, dx: 10, dy: 0 });
    expect(Number.isFinite(s.x)).toBe(true);
    expect(s.tx).toBeCloseTo(1, 6);
  });
});

describe("project: the eyes as marks on a sphere", () => {
  test("no turn is the identity on every mark", () => {
    for (const m of [EYE, { x: 0, y: 0 }, { x: -0.6, y: 0.4 }]) {
      const p = project(m, 0, 0);
      expect(p.dx).toBeCloseTo(0, 12);
      expect(p.dy).toBeCloseTo(0, 12);
      expect(p.sx).toBeCloseTo(1, 12);
      expect(p.sy).toBeCloseTo(1, 12);
      expect(p.t).toBeCloseTo(0, 12);
    }
  });

  test("it moves the way the aim points, on both axes, with SVG's y down", () => {
    const m = { x: 0, y: 0 };
    expect(project(m, 0.3, 0).dx).toBeGreaterThan(0);
    expect(project(m, -0.3, 0).dx).toBeLessThan(0);
    expect(project(m, 0, 0.3).dy).toBeGreaterThan(0);
    expect(project(m, 0, -0.3).dy).toBeLessThan(0);
    for (const e of [EYE, { x: -EYE.x, y: EYE.y }, { x: 0.5, y: 0.5 }, { x: -0.5, y: -0.5 }]) {
      expect(project(e, 0.2, 0).dx).toBeGreaterThan(0);
      expect(project(e, 0, 0.2).dy).toBeGreaterThan(0);
    }
  });

  test("a mark at the centre moves exactly the excursion; an eye off it, its depth less", () => {
    const turn = 3 / 33.57;
    expect(Math.abs(project({ x: 0, y: 0 }, turn, 0).dx - turn) / turn).toBeLessThan(0.002);
    const tiny = 1e-5;
    const depth = Math.sqrt(1 - EYE.x * EYE.x - EYE.y * EYE.y);
    expect(project(EYE, tiny, 0).dx / tiny).toBeCloseTo(depth, 4);
  });

  test("a mark is parked at the limb rather than carried round the back", () => {
    for (const turn of [Math.PI / 2, Math.PI, 4, 40]) {
      for (const [a, b] of [[turn, 0], [0, turn], [turn, turn], [-turn, turn]]) {
        const p = project(EYE, a!, b!);
        expect(Math.hypot(EYE.x + p.dx, EYE.y + p.dy)).toBeLessThanOrEqual(LIMB + 1e-9);
        expect(p.sx).toBeGreaterThan(0.05);
        expect(p.sy).toBeGreaterThan(0.05);
      }
    }
  });

  test("and slides along it continuously", () => {
    let prev = project(EYE, 0, 0);
    for (let a = 0; a < 3; a += 0.01) {
      const p = project(EYE, a, a * 0.6);
      expect(Math.hypot(p.dx - prev.dx, p.dy - prev.dy)).toBeLessThan(0.03);
      expect(Math.abs(p.sx - prev.sx)).toBeLessThan(0.03);
      prev = p;
    }
  });

  test("no aim, on any diagonal, can take a mark off the disc", () => {
    for (const m of [EYE, { x: -EYE.x, y: EYE.y }, { x: 0.6, y: 0.6 }, { x: 0, y: 0 }])
      for (let a = 0; a < 360; a += 5) {
        const r = (a * Math.PI) / 180;
        for (const turn of [0.09, 0.7, 3, 40]) {
          const p = project(m, Math.cos(r) * turn, Math.sin(r) * turn);
          expect(Math.hypot(m.x + p.dx, m.y + p.dy)).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
  });

  test("foreshortening never grows a mark", () => {
    for (let x = -1; x <= 1; x += 0.05)
      for (let y = -1; y <= 1; y += 0.05) {
        const p = project(EYE, x * 0.5, y * 0.5);
        expect(p.sx).toBeLessThanOrEqual(1 + 1e-9);
        expect(p.sy).toBeLessThanOrEqual(1 + 1e-9);
        expect(p.sx).toBeGreaterThanOrEqual(0);
      }
  });

  test("the leading eye compresses harder than the trailing one", () => {
    const right = { x: EYE.x, y: EYE.y };
    const left = { x: -EYE.x, y: EYE.y };
    const turn = 4 / 33.57;
    expect(project(right, turn, 0).sx).toBeLessThan(project(left, turn, 0).sx);
    expect(project(left, -turn, 0).sx).toBeLessThan(project(right, -turn, 0).sx);
  });

  test("the tilt is a convergence, opposite per eye, and well under the seeded 12° lean", () => {
    const right = { x: EYE.x, y: EYE.y };
    const left = { x: -EYE.x, y: EYE.y };
    expect(project(right, 0.35, 0.35).t * project(left, 0.35, 0.35).t).toBeLessThan(0);
    expect(project({ x: EYE.x, y: 0 }, 0.5, 0).t).toBeCloseTo(0, 12);
    let peak = 0;
    for (let x = -1; x <= 1; x += 0.05)
      for (let y = -1; y <= 1; y += 0.05)
        for (const turn of [4 / 33.57, 0.5, 1000])
          peak = Math.max(peak, Math.abs(project(EYE, x * turn, y * turn).t));
    expect(peak).toBeLessThan(12);
    expect(peak).toBeCloseTo(1.6, 1);
  });

  test("it is finite everywhere, including at a mark already on the limb", () => {
    for (const m of [{ x: 1, y: 0 }, { x: -1, y: 1 }, { x: 0, y: 0 }])
      for (const turn of [0, 1, 1e6]) {
        const p = project(m, turn, -turn);
        for (const v of [p.dx, p.dy, p.sx, p.sy, p.t]) expect(Number.isFinite(v)).toBe(true);
      }
  });
});

describe("the constants the layer is tuned against", () => {
  test("the near field is inside the bolota, and the snap is under a full reversal", () => {
    expect(DEADZONE).toBeGreaterThan(0);
    expect(DEADZONE).toBeLessThan(1);
    expect(SNAP).toBeLessThan(2);
    expect(HOLD_EPS).toBeGreaterThan(0.002);
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
  });
});

describe("gaze.css against motion.css", () => {
  const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = (css: string) => {
    const out: { sel: string; props: Set<string> }[] = [];
    for (const m of strip(css).matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      const sel = m[1]!.trim().replace(/\s+/g, " ");
      if (!sel || sel.startsWith("@") || sel.includes("%")) continue;
      out.push({ sel, props: new Set([...m[2]!.matchAll(/(^|;)\s*([a-z-]+)\s*:/g)].map((d) => d[2]!)) });
    }
    return out;
  };
  const rank = (sel: string) => (sel.match(/\./g) ?? []).length;
  const read = (f: string) => Bun.file(`${import.meta.dir}/../src/${f}`).text();

  test("every selector it shares with motion.css is more specific", async () => {
    const motion = rules(await read("motion.css"));
    const gaze = rules(await read("gaze.css"));
    for (const g of gaze)
      for (const m of motion) {
        const clash = [...g.props].filter((p) => m.props.has(p));
        if (!clash.length || (m.sel !== g.sel && !g.sel.endsWith(` ${m.sel}`))) continue;
        expect({ clash: `${g.sel} restates ${clash} from ${m.sel}`, more: rank(g.sel) > rank(m.sel) }).toEqual({
          clash: `${g.sel} restates ${clash} from ${m.sel}`,
          more: true,
        });
      }
  });

  test("and it restates the three eye transform properties", async () => {
    const eye = rules(await read("gaze.css")).find((r) => r.sel.endsWith(".mo-eye"))!;
    for (const p of ["translate", "rotate", "transform"]) expect(eye.props.has(p)).toBe(true);
    expect(rank(eye.sel)).toBeGreaterThan(1);
  });
});
