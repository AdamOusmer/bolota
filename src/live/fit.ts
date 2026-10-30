// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { depth, type OutlineLayout } from "./outline";

/**
 * The one constraint on a live face: every point of both eyes stays `MARGIN`
 * inside the body outline, and the pair keeps `CLEARANCE` between them.
 *
 * States, expressions, the gaze and orbit's level face all compose freely and
 * this settles what they ask for, every frame, with the smallest change that
 * works: first the eyes are drawn back toward their seeded rest places, by the
 * same fraction for both, and only if they are home and still too big are they
 * shrunk about their own centres. Both are found by bisection on queries of
 * the per-seed outline table, so a frame allocates nothing.
 */

export interface EyeBox {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rot: number;
}

export interface FitLayout extends OutlineLayout {
  eyes: { cx: number; cy: number }[];
}

export interface Correction {
  /** How far toward rest the centres were drawn, 0–1. */
  pull: number;
  /** The size factor the eyes kept, 0–1. */
  shrink: number;
}

/** Viewbox units every eye point keeps inside the outline. */
export const MARGIN = 1;
/** Viewbox units the pair keeps between them, measured as `test/expression.test.ts` measures the roster. */
export const CLEARANCE = 2;

/** Viewbox units between the rim points an eye is checked at: fine enough that a petal seam cannot slip between two. */
const SPACING = 0.25;
const STEPS = 14;

function reach(rx: number, ry: number, rot: number): number {
  const t = (rot * Math.PI) / 180;
  return Math.abs(rx * Math.cos(t)) + Math.abs(ry * Math.sin(t));
}

/** Whether one eye at this centre and size clears the outline, seen from a body turned by `turn` radians. */
function holds(l: FitLayout, cx: number, cy: number, rx: number, ry: number, rot: number, turn: number): boolean {
  const t = (rot * Math.PI) / 180;
  const ec = Math.cos(t);
  const es = Math.sin(t);
  const tc = Math.cos(-turn);
  const ts = Math.sin(-turn);
  const r = rx < ry ? rx : ry;
  const hx = rx - r;
  const hy = ry - r;
  const wide = hx >= hy;
  const half = wide ? hx : hy;
  const cap = Math.max(4, Math.ceil((Math.PI * r) / SPACING));
  const flank = Math.ceil((2 * half) / SPACING);
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i <= cap; i++) {
      const a = (wide ? -Math.PI / 2 : 0) + (side < 0 ? Math.PI : 0) + (i / cap) * Math.PI;
      const lx = (wide ? side * half : 0) + r * Math.cos(a);
      const ly = (wide ? 0 : side * half) + r * Math.sin(a);
      if (!clear(l, cx + lx * ec - ly * es, cy + lx * es + ly * ec, tc, ts)) return false;
    }
    for (let j = 1; j < flank; j++) {
      const u = -half + (2 * half * j) / flank;
      const lx = wide ? u : side * r;
      const ly = wide ? side * r : u;
      if (!clear(l, cx + lx * ec - ly * es, cy + lx * es + ly * ec, tc, ts)) return false;
    }
  }
  return true;
}

/** Whether the eye point `(x, y)` clears the outline once the body's turn is taken off it. */
function clear(l: FitLayout, x: number, y: number, tc: number, ts: number): boolean {
  const px = x - l.body.cx;
  const py = y - l.body.cy;
  return depth(l, l.body.cx + px * tc - py * ts, l.body.cy + px * ts + py * tc) >= MARGIN;
}

function fits(l: FitLayout, e: EyeBox[], pull: number, shrink: number, turn: number): boolean {
  const a = e[0]!;
  const b = e[1]!;
  const ra = l.eyes[0]!;
  const rb = l.eyes[1]!;
  const ax = a.cx + (ra.cx - a.cx) * pull;
  const ay = a.cy + (ra.cy - a.cy) * pull;
  const bx = b.cx + (rb.cx - b.cx) * pull;
  const by = b.cy + (rb.cy - b.cy) * pull;
  if (Math.abs(bx - ax) - reach(a.rx * shrink, a.ry * shrink, a.rot) - reach(b.rx * shrink, b.ry * shrink, b.rot) <= CLEARANCE)
    return false;
  return (
    holds(l, ax, ay, a.rx * shrink, a.ry * shrink, a.rot, turn) &&
    holds(l, bx, by, b.rx * shrink, b.ry * shrink, b.rot, turn)
  );
}

/**
 * Settles the posed pair `eyes` (left, right; body frame, gaze already added)
 * in place. `turn` is how far the body is turned under a level face, in
 * degrees: `act.rot · act.upright`. Writes the correction it made into `out`.
 */
export function fitEyes(l: FitLayout, eyes: EyeBox[], turn = 0, out: Correction = { pull: 0, shrink: 1 }): Correction {
  const tr = (turn * Math.PI) / 180;
  let pull = 0;
  let shrink = 1;
  if (!fits(l, eyes, 0, 1, tr)) {
    if (fits(l, eyes, 1, 1, tr)) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < STEPS; i++) {
        const m = (lo + hi) / 2;
        if (fits(l, eyes, m, 1, tr)) hi = m;
        else lo = m;
      }
      pull = hi;
    } else {
      pull = 1;
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < STEPS; i++) {
        const m = (lo + hi) / 2;
        if (fits(l, eyes, 1, m, tr)) lo = m;
        else hi = m;
      }
      shrink = lo;
    }
    for (let i = 0; i < 2; i++) {
      const e = eyes[i]!;
      const r = l.eyes[i]!;
      e.cx += (r.cx - e.cx) * pull;
      e.cy += (r.cy - e.cy) * pull;
      e.rx *= shrink;
      e.ry *= shrink;
    }
  }
  out.pull = pull;
  out.shrink = shrink;
  return out;
}
