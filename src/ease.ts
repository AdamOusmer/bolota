// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from blobatar (c) 2026 Alain, MIT. See LICENSE.

/**
 * CSS timing functions, for code that drives motion from a frame clock instead
 * of a stylesheet. Every curve below is transcribed from `motion.css`, and the
 * two files have to be changed together.
 */

/**
 * A CSS `cubic-bezier(x1, y1, x2, y2)`, as a function of elapsed fraction.
 *
 * Newton's method from `x` as the starting guess, which is exact for `linear`
 * and close for every control point inside the unit square. Both fallbacks
 * return the current estimate: a stalled derivative means the curve is flat
 * there, where the estimate is as good as any answer.
 */
export function bezier(
  [x1, y1, x2, y2]: readonly [number, number, number, number],
): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  return (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = ((ax * t + bx) * t + cx) * t - x;
      if (Math.abs(err) < 1e-5) break;
      const d = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return ((ay * t + by) * t + cy) * t;
  };
}

/**
 * The CSS keywords `motion.css` uses, as the curves the specification says they
 * stand for. Each is `/* @__PURE__ *\/` because it is a call, and a bundler will
 * not drop a call it cannot prove side-effect-free; `scripts/size.ts` is where
 * that would show.
 */
export const EASE = /* @__PURE__ */ bezier([0.25, 0.1, 0.25, 1]);
export const EASE_IN_OUT = /* @__PURE__ */ bezier([0.42, 0, 0.58, 1]);
export const EASE_IN = /* @__PURE__ */ bezier([0.42, 0, 1, 1]);
export const EASE_OUT = /* @__PURE__ */ bezier([0, 0, 0.58, 1]);

/** The morph's two curves, from `.mo-root.mo-expr` (in) and `.mo-root` (out). */
export const MORPH_IN = { ms: 300, ease: /* @__PURE__ */ bezier([0.45, 0.05, 0.5, 1]) };
export const MORPH_OUT = { ms: 400, ease: EASE_IN_OUT };
