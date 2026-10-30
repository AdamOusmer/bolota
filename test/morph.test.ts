// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from blobatar (c) 2026 Alain, MIT. See LICENSE.

/**
 * The morph agrees with the bake, at every pose: at any frozen pose, the eyes an
 * animated bolota draws through `poseTransforms` land where the static one bakes
 * them.
 *
 * Compared as each eye's extent along its own axes, not point by point. bolota's
 * eye is a capsule, and a capsule stretched by a scale (what the transform and
 * `.mo-eye` both do) gets slightly elliptical caps where a re-baked capsule keeps
 * circular ones. Centre, angle, width and height are what the two must share.
 */

import { describe, expect, test } from "bun:test";
import { EASE_IN_OUT, MORPH_IN, bezier } from "../src/ease";
import {
  happy,
  idle,
  love,
  mad,
  sad,
  scared,
  shy,
  sick,
  sleepy,
  smug,
  surprised,
  unsure,
  wink,
  type Expression,
} from "../src/expression";
import { bakePose, lerpPose, poseTransforms } from "../src/morph";
import { capsulePath } from "../src/shape";
import { style } from "../src/styles/blob";
import { traits } from "../src/traits";

const NAMED: [string, Expression][] = [
  ["idle", idle],
  ["happy", happy],
  ["sad", sad],
  ["mad", mad],
  ["surprised", surprised],
  ["wink", wink],
  ["sleepy", sleepy],
  ["smug", smug],
  ["unsure", unsure],
  ["scared", scared],
  ["love", love],
  ["shy", shy],
  ["sick", sick],
];

const SEEDS = Array.from({ length: 400 }, (_, i) => `morph-${i}`);

type M = [number, number, number, number, number, number];

const times = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

function parse(list: string): M {
  let m: M = [1, 0, 0, 1, 0, 0];
  for (const [, fn, args] of list.matchAll(/([a-zA-Z]+)\(([^)]*)\)/g)) {
    const n = args!.trim().split(/[\s,]+/).map(Number);
    if (fn === "translate") m = times(m, [1, 0, 0, 1, n[0]!, n[1] ?? 0]);
    else if (fn === "scale") m = times(m, [n[0]!, 0, 0, n[1] ?? n[0]!, 0, 0]);
    else if (fn === "rotate") {
      const t = (n[0]! * Math.PI) / 180;
      m = times(m, [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0]);
    } else throw new Error(`unhandled transform function: ${fn}`);
  }
  return m;
}

const points = (d: string): [number, number][] => {
  const n = d.match(/-?\d+\.?\d*/g)!.map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i < n.length; i += 2) out.push([n[i]!, n[i + 1]!]);
  return out;
};

const apply = (m: M, [x, y]: [number, number]): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

const eyePath = (e: { cx: number; cy: number; rx: number; ry: number; rot: number }) =>
  capsulePath(e.cx, e.cy, e.rx * 2, e.ry * 2, e.rot);

test("the transform parser refuses what it does not understand", () => {
  expect(() => parse("skewX(4)")).toThrow();
  expect(() => parse("matrix(1 0 0 1 0 0)")).toThrow();
  expect(parse("translate(2 3)")).toEqual([1, 0, 0, 1, 2, 3]);
});

describe("the animated path draws what the static one bakes", () => {
  for (const [label, e] of NAMED) {
    test(`${label}: every eye lands where bakePose puts it`, () => {
      for (const seed of SEEDS) {
        const l = style.layout(traits(seed, true));
        const moved = poseTransforms(l, e.p);
        const baked = bakePose(l, e.p);
        for (let i = 0; i < l.eyes.length; i++) {
          const m = parse(moved.eyes[i]!);
          const want = baked.l.eyes[i]!;
          const t = (-want.rot * Math.PI) / 180;
          const local = points(eyePath(l.eyes[i]!))
            .map(p => apply(m, p))
            .map(([x, y]) => {
              const dx = x - want.cx;
              const dy = y - want.cy;
              return [dx * Math.cos(t) - dy * Math.sin(t), dx * Math.sin(t) + dy * Math.cos(t)];
            });
          const xs = local.map(p => p[0]!);
          const ys = local.map(p => p[1]!);
          // Path coordinates are rounded to 0.01 before the pose scale, so the
          // tolerance grows with the loudest scale in the roster (under 11).
          const tol = 0.01 * Math.max(want.rx / l.eyes[i]!.rx, want.ry / l.eyes[i]!.ry, 1) + 0.02;
          expect(Math.abs(Math.max(...xs) - want.rx)).toBeLessThan(tol);
          expect(Math.abs(Math.min(...xs) + want.rx)).toBeLessThan(tol);
          expect(Math.abs(Math.max(...ys) - want.ry)).toBeLessThan(tol);
          expect(Math.abs(Math.min(...ys) + want.ry)).toBeLessThan(tol);
        }
      }
    });
  }

  test("the body wrap is the same translate, spelled unconditionally", () => {
    for (const [label, e] of NAMED) {
      const l = style.layout(traits("wrap", true));
      const moved = poseTransforms(l, e.p).wrap;
      const baked = bakePose(l, e.p).wrap;
      expect(parse(moved), label).toEqual(parse(baked || "translate(0 0)"));
    }
  });
});

describe("lerpPose", () => {
  test("the ends are the ends", () => {
    for (const [label, e] of NAMED) {
      expect(lerpPose(idle.p, e.p, 0), label).toEqual(idle.p);
      expect(lerpPose(idle.p, e.p, 1), label).toEqual(e.p);
    }
  });

  test("undefined is idle, on either end", () => {
    expect(lerpPose(undefined, mad.p, 1)).toEqual(mad.p);
    expect(lerpPose(mad.p, undefined, 1)).toEqual(idle.p);
    expect(lerpPose(undefined, undefined, 0.5)).toEqual(idle.p);
  });

  test("every channel moves, and none of them jumps", () => {
    const half = lerpPose(idle.p, mad.p, 0.5) as unknown as Record<string, number>;
    const a = idle.p as unknown as Record<string, number>;
    const b = mad.p as unknown as Record<string, number>;
    for (const k of Object.keys(a)) expect(half[k], k).toBeCloseTo((a[k]! + b[k]!) / 2, 10);
    expect(Object.keys(half).sort()).toEqual(Object.keys(a).sort());
  });
});

describe("ease", () => {
  test("the curves pin their ends", () => {
    for (const f of [EASE_IN_OUT, MORPH_IN.ease, bezier([0.2, 0.8, 0.2, 1])]) {
      expect(f(0)).toBeCloseTo(0, 6);
      expect(f(1)).toBeCloseTo(1, 6);
    }
  });

  test("ease-in-out is symmetric about its middle", () => {
    for (let i = 0; i <= 10; i++) expect(EASE_IN_OUT(i / 10) + EASE_IN_OUT(1 - i / 10)).toBeCloseTo(1, 4);
  });
});
