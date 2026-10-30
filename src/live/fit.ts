// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

import { headFrame, turnHead, type Gaze, type HeadFrame } from "./head";
import { ballEdge, depth, floor, type OutlineLayout } from "./outline";

/**
 * Where a live frame draws its eyes: the posed pair turned on the face's
 * sphere by the head, as bloub's engine places them, then held inside the
 * body.
 *
 * The turn is bloub's (`eyePoses` in `bloub/face.ts`): each eye is a point on
 * a sphere the size of the head, carried round it by the head's yaw, pitch and
 * roll and drawn back onto the outline in its new direction, with the tangent
 * frame there foreshortening it. Relative to the frame it rested in, so a
 * level head draws the posed eyes exactly.
 *
 * The constraint: every point of both eyes stays `MARGIN` inside the body
 * outline, ornaments left out, and the pair keeps `CLEARANCE` between them. What it gives up, when
 * the turn asks for more room than the body has, moves smoothly with what was
 * asked: first the turn eases toward level, then the eyes shrink a little so a
 * large face keeps some of its movement, then the rest of the turn goes, and
 * only then do they shrink further. One parameter walks that path and a
 * bisection finds the least of it that fits, so a frame allocates nothing and
 * the answer never jumps between frames whose inputs did not.
 */

/** A posed eye at rest: centre, half sizes and turn in degrees. */
export interface Eye {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rot: number;
}

/**
 * A drawn eye: the posed eye under the head's frame. `a b c d` is the 2×2
 * screen matrix the turn applies about the centre, before the eye's own `rot`
 * (identity on a level head).
 */
export interface EyeBox extends Eye {
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface Correction {
  /** The share of the head turn the eyes kept, 0–1. */
  gaze: number;
  /** The size factor the eyes kept, 0–1. */
  shrink: number;
}

/** Viewbox units every eye point keeps inside the outline. */
export const MARGIN = 1;
/** Viewbox units the pair keeps between them: the true gap between the two capsules. */
export const CLEARANCE = 2;

/** The share of the turn a large face keeps by shrinking before it gives up the rest. */
const KEEP = 0.5;
/** How far a face shrinks to keep that share. */
const GIVE = 0.85;
/** Bisection steps over the correction path; its ends are 4 apart. */
const STEPS = 14;
/** Viewbox units between the rim points an eye is checked at: fine enough that a petal seam cannot slip between two. */
const SPACING = 0.25;
/** The nearest a turned eye's rest frame lets its width go, so an eye at the limb cannot blow up. */
const FLAT = 0.3;
/** The deepest a rest eye sits on the sphere, as a share of the radius. */
const LIMB = 0.97;

export const eyeBox = (): EyeBox => ({ cx: 0, cy: 0, rx: 0, ry: 0, rot: 0, a: 1, b: 0, c: 0, d: 1 });

/** Scratch for the candidates a bisection tries and the frame it turns them by. */
const CA = eyeBox();
const CB = eyeBox();
const HEAD = headFrame();

/**
 * `e` turned by head frame `h` and scaled by `s` about its own centre, into
 * `o`. The rest point is lifted onto the unit sphere by its distance over the
 * outline's radius in its direction, and the turned point is drawn back by the
 * radius in its new one, so the eyes ride the real head and not a circle.
 * `tr` is how far the body is turned under the face, in radians.
 */
function turnEye(l: OutlineLayout, e: Eye, h: HeadFrame, s: number, tr: number, o: EyeBox): void {
  const bx = l.body.cx;
  const by = l.body.cy;
  const px = e.cx - bx;
  const py = e.cy - by;
  const d = Math.hypot(px, py);
  const r0 = d > 0 ? Math.min(LIMB, d / ballEdge(l, Math.atan2(py, px) - tr)) : 0;
  const x0 = d > 0 ? (px / d) * r0 : 0;
  const y0 = d > 0 ? (py / d) * r0 : 0;
  const z0 = Math.sqrt(1 - r0 * r0);
  const vx = x0 * h.rx + y0 * h.dx + z0 * h.fx;
  const vy = x0 * h.ry + y0 * h.dy + z0 * h.fy;
  const v = Math.hypot(vx, vy);
  const reach = v > 0 ? ballEdge(l, Math.atan2(vy, vx) - tr) : 0;
  o.cx = bx + vx * reach;
  o.cy = by + vy * reach;
  const n = Math.hypot(z0, x0) || 1;
  const w = Math.max(FLAT, z0 / n);
  o.a = (z0 * h.rx - x0 * h.fx) / n / w;
  o.b = (z0 * h.ry - x0 * h.fy) / n / w;
  o.c = h.dx;
  o.d = h.dy;
  o.rx = e.rx * s;
  o.ry = e.ry * s;
  o.rot = e.rot;
}

/** The turn and size a point `u` on the correction path keeps. */
function along(u: number, c: Correction): Correction {
  if (u <= 1) {
    c.gaze = 1 - (1 - KEEP) * u;
    c.shrink = 1;
  } else if (u <= 2) {
    c.gaze = KEEP;
    c.shrink = 1 - (1 - GIVE) * (u - 1);
  } else if (u <= 3) {
    c.gaze = KEEP * (3 - u);
    c.shrink = GIVE;
  } else {
    c.gaze = 0;
    c.shrink = GIVE * Math.max(0, 4 - u);
  }
  return c;
}

/** The drawn linear map of an eye: its frame times its own turn. */
function linear(e: EyeBox, m: Float64Array): void {
  const t = (e.rot * Math.PI) / 180;
  const ct = Math.cos(t);
  const st = Math.sin(t);
  m[0] = e.a * ct + e.c * st;
  m[1] = e.b * ct + e.d * st;
  m[2] = -e.a * st + e.c * ct;
  m[3] = -e.b * st + e.d * ct;
}

/** The longest a unit vector gets under the eye's frame, its largest singular value: how much it can grow a radius. */
function stretch(e: EyeBox): number {
  const s = e.a * e.a + e.b * e.b + e.c * e.c + e.d * e.d;
  const det = e.a * e.d - e.b * e.c;
  return Math.sqrt((s + Math.sqrt(Math.max(0, s * s - 4 * det * det))) / 2);
}

const MA = new Float64Array(4);
const MB = new Float64Array(4);

/** Squared distance from `(px, py)` to the segment `(x0, y0)`–`(x1, y1)`. */
function toSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const sx = x1 - x0;
  const sy = y1 - y0;
  const len = sx * sx + sy * sy;
  let t = len > 0 ? ((px - x0) * sx + (py - y0) * sy) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = x0 + t * sx - px;
  const dy = y0 + t * sy - py;
  return dx * dx + dy * dy;
}

/**
 * The gap between two drawn capsules: the distance between their axis
 * segments less both cap radii, each radius taken at the frame's longest
 * stretch so a foreshortened pair is never charged less than it covers.
 */
export function capsuleGap(a: EyeBox, b: EyeBox): number {
  linear(a, MA);
  linear(b, MB);
  const ra = Math.min(a.rx, a.ry);
  const rb = Math.min(b.rx, b.ry);
  const ha = Math.max(a.rx, a.ry) - ra;
  const hb = Math.max(b.rx, b.ry) - rb;
  const ax = a.rx >= a.ry ? MA[0]! * ha : MA[2]! * ha;
  const ay = a.rx >= a.ry ? MA[1]! * ha : MA[3]! * ha;
  const bx = b.rx >= b.ry ? MB[0]! * hb : MB[2]! * hb;
  const by = b.rx >= b.ry ? MB[1]! * hb : MB[3]! * hb;
  const a0x = a.cx - ax, a0y = a.cy - ay, a1x = a.cx + ax, a1y = a.cy + ay;
  const b0x = b.cx - bx, b0y = b.cy - by, b1x = b.cx + bx, b1y = b.cy + by;
  const d2 = Math.min(
    toSegment(a0x, a0y, b0x, b0y, b1x, b1y),
    toSegment(a1x, a1y, b0x, b0y, b1x, b1y),
    toSegment(b0x, b0y, a0x, a0y, a1x, a1y),
    toSegment(b1x, b1y, a0x, a0y, a1x, a1y),
  );
  return Math.sqrt(d2) - ra * stretch(a) - rb * stretch(b);
}

/** Whether the eye point `(x, y)` clears the outline once the body's turn is taken off it. */
function clear(l: OutlineLayout, x: number, y: number, tc: number, ts: number): boolean {
  const px = x - l.body.cx;
  const py = y - l.body.cy;
  return depth(l, l.body.cx + px * tc - py * ts, l.body.cy + px * ts + py * tc, true) >= MARGIN;
}

/** Whether one drawn eye clears the outline, seen from a body turned by `turn` radians. */
function holds(l: OutlineLayout, e: EyeBox, turn: number, m: Float64Array): boolean {
  const dx = e.cx - l.body.cx;
  const dy = e.cy - l.body.cy;
  const far = Math.max(e.rx, e.ry) * stretch(e);
  if (Math.sqrt(dx * dx + dy * dy) + far + MARGIN + 1e-6 <= floor(l)) return true;
  linear(e, m);
  const tc = Math.cos(-turn);
  const ts = Math.sin(-turn);
  const r = e.rx < e.ry ? e.rx : e.ry;
  const hx = e.rx - r;
  const hy = e.ry - r;
  const wide = hx >= hy;
  const half = wide ? hx : hy;
  const cap = Math.max(4, Math.ceil((Math.PI * r * stretch(e)) / SPACING));
  const flank = Math.ceil((2 * half * stretch(e)) / SPACING);
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i <= cap; i++) {
      const a = (wide ? -Math.PI / 2 : 0) + (side < 0 ? Math.PI : 0) + (i / cap) * Math.PI;
      const lx = (wide ? side * half : 0) + r * Math.cos(a);
      const ly = (wide ? 0 : side * half) + r * Math.sin(a);
      if (!clear(l, e.cx + lx * m[0]! + ly * m[2]!, e.cy + lx * m[1]! + ly * m[3]!, tc, ts)) return false;
    }
    for (let j = 1; j < flank; j++) {
      const u = -half + (2 * half * j) / flank;
      const lx = wide ? u : side * r;
      const ly = wide ? side * r : u;
      if (!clear(l, e.cx + lx * m[0]! + ly * m[2]!, e.cy + lx * m[1]! + ly * m[3]!, tc, ts)) return false;
    }
  }
  return true;
}

/** The posed pair turned by `gaze` at share `g` and scaled by `s`, into `a` and `b`. */
function place(l: OutlineLayout, rest: Eye[], gaze: Gaze, g: number, s: number, tr: number, a: EyeBox, b: EyeBox): void {
  turnHead(gaze.yaw * g, gaze.pitch * g, gaze.roll * g, HEAD);
  turnEye(l, rest[0]!, HEAD, s, tr, a);
  turnEye(l, rest[1]!, HEAD, s, tr, b);
}

const TRY: Correction = { gaze: 1, shrink: 1 };

function fits(l: OutlineLayout, rest: Eye[], gaze: Gaze, u: number, turn: number): boolean {
  const c = along(u, TRY);
  place(l, rest, gaze, c.gaze, c.shrink, turn, CA, CB);
  return capsuleGap(CA, CB) > CLEARANCE && holds(l, CA, turn, MA) && holds(l, CB, turn, MB);
}

/**
 * Turns the posed pair `rest` (left, right; body frame) by `gaze` and settles
 * it inside the body, into `out`. `turn` is how far the body is turned under a
 * level face, in degrees: `act.rot · act.upright`. Writes what it kept into
 * `corr`.
 */
export function settleEyes(
  l: OutlineLayout,
  rest: Eye[],
  gaze: Gaze,
  turn: number,
  out: EyeBox[],
  corr: Correction = { gaze: 1, shrink: 1 },
): Correction {
  const tr = (turn * Math.PI) / 180;
  let u = 0;
  if (!fits(l, rest, gaze, 0, tr)) {
    let lo = 0;
    let hi = 4;
    for (let i = 0; i < STEPS; i++) {
      const m = (lo + hi) / 2;
      if (fits(l, rest, gaze, m, tr)) hi = m;
      else lo = m;
    }
    u = hi;
  }
  along(u, corr);
  place(l, rest, gaze, corr.gaze, corr.shrink, tr, out[0]!, out[1]!);
  return corr;
}
