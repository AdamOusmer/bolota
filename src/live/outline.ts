// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { superellipse } from "../shape";
import type { Layout } from "../styles/compose";

/**
 * A seed's body outline as a query, flattened from the same path strings the
 * static renderer draws (`draw`, plus the `extra` outlines), so the live fit
 * answers to exactly what is on screen. Petals are exact circles. Built on
 * first use per layout and held in a `WeakMap`, so a dropped layout takes its
 * table with it.
 */

export type OutlineLayout = Pick<Layout, "shape" | "body" | "draw" | "extra" | "petals">;

/** Rays per turn in the exit table. */
const RAYS = 1440;
/** Points per curve segment when tracing a path. */
const STEPS = 32;

type Trace = number[];

/** An `M`/`L`/`H`/`V`/`C`/`Q`/`Z` path as the flat polyline it draws, closed by the caller. */
function trace(d: string): Trace {
  const out: Trace = [];
  let x = 0;
  let y = 0;
  for (const seg of d.match(/[MLHVCQ][^A-Z]*/g)!) {
    const a = seg.slice(1).match(/-?[\d.]+/g)!.map(Number);
    const c = seg[0];
    if (c === "C" || c === "Q") {
      const p = [x, y, ...a];
      for (let i = 1; i <= STEPS; i++) {
        const s = i / STEPS;
        const m = 1 - s;
        const w = c === "C" ? [m * m * m, 3 * m * m * s, 3 * m * s * s, s * s * s] : [m * m, 2 * m * s, s * s];
        out.push(w.reduce((q, b, j) => q + b * p[2 * j]!, 0), w.reduce((q, b, j) => q + b * p[2 * j + 1]!, 0));
      }
    } else {
      if (c !== "V") x = a[0]!;
      if (c !== "H") y = a[c === "V" ? 0 : 1]!;
      out.push(x, y);
      continue;
    }
    x = a[a.length - 2]!;
    y = a[a.length - 1]!;
  }
  return out;
}

const core = (l: OutlineLayout): Trace => trace(l.draw ? l.draw(l.body) : superellipse(l.body));

/** Distances along the ray where it crosses the closed trace, ascending. */
function crossings(tr: Trace, ox: number, oy: number, dx: number, dy: number, hits: number[]) {
  hits.length = 0;
  const n = tr.length;
  for (let i = 0; i < n; i += 2) {
    const x1 = tr[i]!;
    const y1 = tr[i + 1]!;
    const x2 = tr[(i + 2) % n]!;
    const y2 = tr[(i + 3) % n]!;
    const ex = x2 - x1;
    const ey = y2 - y1;
    const det = ex * dy - ey * dx;
    if (Math.abs(det) < 1e-12) continue;
    const t = (ex * (y1 - oy) - ey * (x1 - ox)) / det;
    const u = (dx * (y1 - oy) - dy * (x1 - ox)) / det;
    if (t > 0 && u >= 0 && u < 1) hits.push(t);
  }
  hits.sort((a, b) => a - b);
}

/** How far the ray from the body centre at `theta` stays inside the union before it first leaves it. */
function exitAlong(l: OutlineLayout, traces: Trace[], theta: number, hits: number[], petals = l.petals): number {
  const { cx, cy } = l.body;
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  const spans: [number, number][] = [];
  for (const tr of traces) {
    crossings(tr, cx, cy, dx, dy, hits);
    let i = 0;
    if (hits.length % 2) spans.push([0, hits[i++]!]);
    for (; i + 1 < hits.length; i += 2) spans.push([hits[i]!, hits[i + 1]!]);
  }
  for (const p of petals) {
    const fx = cx - p.cx;
    const fy = cy - p.cy;
    const b = fx * dx + fy * dy;
    const disc = b * b - (fx * fx + fy * fy - p.r * p.r);
    if (disc <= 0) continue;
    const s = Math.sqrt(disc);
    if (-b + s > 0) spans.push([Math.max(0, -b - s), -b + s]);
  }
  let end = 0;
  for (let grew = true; grew; ) {
    grew = false;
    for (const [a, b] of spans)
      if (a <= end + 1e-9 && b > end) {
        end = b;
        grew = true;
      }
  }
  return end;
}

const tables = new WeakMap<object, Float64Array>();

function table(l: OutlineLayout): Float64Array {
  let t = tables.get(l);
  if (t) return t;
  const traces = [core(l), ...l.extra.map(trace)];
  const hits: number[] = [];
  t = new Float64Array(RAYS);
  for (let i = 0; i < RAYS; i++) t[i] = exitAlong(l, traces, (i / RAYS) * Math.PI * 2, hits);
  tables.set(l, t);
  return t;
}

const balls = new WeakMap<object, { table: Float64Array; mean: number }>();

/**
 * The head without its ornaments: the ball bloub's face sits on. Its radii,
 * and their mean, are what bloub's own engine read off a seed's profile to
 * size and place its eyes. A capsule's caps are the head itself and stay; a
 * sun's rays, a cloud's lobes, a nub's bumps and a droplet's taper stand off
 * it and are left out.
 */
function ball(l: OutlineLayout) {
  let b = balls.get(l);
  if (b) return b;
  const traces = [core(l)];
  const petals = l.shape === "capsule" ? l.petals : [];
  const hits: number[] = [];
  const t = new Float64Array(RAYS);
  let sum = 0;
  for (let i = 0; i < RAYS; i++) sum += t[i] = exitAlong(l, traces, (i / RAYS) * Math.PI * 2, hits, petals);
  balls.set(l, (b = { table: t, mean: sum / RAYS }));
  return b;
}

/** The core body's mean radius about the body centre: the ball of the same size. */
export function ballRadius(l: OutlineLayout): number {
  return ball(l).mean;
}

/** The core body's radius in direction `theta`, between the two nearest rays. */
export function ballEdge(l: OutlineLayout, theta: number): number {
  const t = ball(l).table;
  let u = (theta / (Math.PI * 2)) % 1;
  if (u < 0) u += 1;
  const f = u * RAYS;
  const i = Math.floor(f) % RAYS;
  const w = f - Math.floor(f);
  return t[i]! * (1 - w) + t[(i + 1) % RAYS]! * w;
}

/**
 * How far from the body centre the outline lies in direction `theta`
 * (radians, screen axes). The nearer of the two rays either side, so a petal
 * seam or a gap between ray samples never reads as more room than there is.
 */
export function edge(l: OutlineLayout, theta: number): number {
  const t = table(l);
  let u = (theta / (Math.PI * 2)) % 1;
  if (u < 0) u += 1;
  const i = Math.floor(u * RAYS) % RAYS;
  const a = t[i]!;
  const b = t[(i + 1) % RAYS]!;
  return a < b ? a : b;
}

/** How far inside the outline `(x, y)` sits along its ray from the body centre; negative outside. */
export function depth(l: OutlineLayout, x: number, y: number): number {
  const dx = x - l.body.cx;
  const dy = y - l.body.cy;
  return edge(l, Math.atan2(dy, dx)) - Math.hypot(dx, dy);
}

/** Whether the outline holds `(x, y)`. */
export function inside(l: OutlineLayout, x: number, y: number): boolean {
  return depth(l, x, y) > 0;
}
