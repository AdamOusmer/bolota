// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

/**
 * A seed's body outline as a query, rebuilt from the layout's numbers rather
 * than from the path strings the static renderer emits.
 *
 * The core is traced from the same parameters, with the same curves, as the
 * drawing functions in `shape.ts` (`superellipse`, `blobPath`, `polygon`,
 * `box`, and the droplet's `taper` from the `tip` its layout records); petals
 * are exact circles. Built on first use per layout and held in a `WeakMap`,
 * so a dropped layout takes its table with it.
 */

export interface OutlineLayout {
  shape: string;
  body: {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    n: number;
    rot: number;
    radii: number[];
    sides?: number;
    round?: number;
    tip?: number;
  };
  petals: { cx: number; cy: number; r: number }[];
}

/** Rays per turn in the exit table. */
const RAYS = 1440;
/** Points per curve segment when tracing the core. */
const STEPS = 32;

type Trace = number[];

function cubic(out: Trace, x0: number, y0: number, a: number, b: number, c: number, d: number, x3: number, y3: number) {
  for (let i = 1; i <= STEPS; i++) {
    const s = i / STEPS;
    const m = 1 - s;
    out.push(
      m * m * m * x0 + 3 * m * m * s * a + 3 * m * s * s * c + s * s * s * x3,
      m * m * m * y0 + 3 * m * m * s * b + 3 * m * s * s * d + s * s * s * y3,
    );
  }
}

function quad(out: Trace, x0: number, y0: number, a: number, b: number, x2: number, y2: number) {
  for (let i = 1; i <= STEPS; i++) {
    const s = i / STEPS;
    const m = 1 - s;
    out.push(m * m * x0 + 2 * m * s * a + s * s * x2, m * m * y0 + 2 * m * s * b + s * s * y2);
  }
}

function superellipse({ cx, cy, rx, ry, n, rot }: OutlineLayout["body"]): Trace {
  const k = Math.min(1, (8 * Math.pow(2, -1 / n) - 4) / 3);
  const ak = rx * k;
  const bk = ry * k;
  const pts = [
    [rx, 0], [rx, bk], [ak, ry], [0, ry], [-ak, ry], [-rx, bk], [-rx, 0],
    [-rx, -bk], [-ak, -ry], [0, -ry], [ak, -ry], [rx, -bk], [rx, 0],
  ];
  const t = (rot * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const w = pts.map(([x, y]) => [cx + x! * cos - y! * sin, cy + x! * sin + y! * cos] as const);
  const out: Trace = [w[0]![0], w[0]![1]];
  for (let i = 1; i < 13; i += 3)
    cubic(out, w[i - 1]![0], w[i - 1]![1], w[i]![0], w[i]![1], w[i + 1]![0], w[i + 1]![1], w[i + 2]![0], w[i + 2]![1]);
  return out;
}

function spline({ cx, cy, rx, ry, radii, rot }: OutlineLayout["body"]): Trace {
  const n = radii.length;
  const t0 = (rot * Math.PI) / 180;
  const p = radii.map((m, i) => {
    const a = t0 + (2 * Math.PI * i) / n;
    return [cx + rx * m * Math.cos(a), cy + ry * m * Math.sin(a)] as const;
  });
  const at = (i: number) => p[((i % n) + n) % n]!;
  const out: Trace = [at(0)[0], at(0)[1]];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = at(i - 1);
    const [x1, y1] = at(i);
    const [x2, y2] = at(i + 1);
    const [x3, y3] = at(i + 2);
    cubic(out, x1, y1, x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6, x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6, x2, y2);
  }
  return out;
}

function polygon({ cx, cy, rx, ry, sides = 3, round = 0.3, rot }: OutlineLayout["body"]): Trace {
  const k = round > 0 ? (round < 1 ? round / 2 : 0.5) : 0;
  const t0 = (rot * Math.PI) / 180 - Math.PI / 2;
  const v = Array.from({ length: sides }, (_, i) => {
    const a = t0 + (2 * Math.PI * i) / sides;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as const;
  });
  const at = (i: number) => v[((i % sides) + sides) % sides]!;
  const cut = (i: number, j: number) => {
    const [x0, y0] = at(i);
    const [x1, y1] = at(j);
    return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k] as const;
  };
  const start = cut(0, -1);
  const out: Trace = [start[0], start[1]];
  let [x, y] = start;
  for (let i = 0; i < sides; i++) {
    const [vx, vy] = at(i);
    const [ex, ey] = cut(i, i + 1);
    quad(out, x, y, vx, vy, ex, ey);
    [x, y] = [ex, ey];
    if (k < 0.5) {
      const [lx, ly] = cut(i + 1, i);
      out.push(lx, ly);
      [x, y] = [lx, ly];
    }
  }
  return out;
}

function box({ cx, cy, rx, ry }: OutlineLayout["body"]): Trace {
  const hx = rx - ry;
  return [cx - hx, cy - ry, cx + hx, cy - ry, cx + hx, cy + ry, cx - hx, cy + ry, cx - hx, cy - ry];
}

/** The droplet's taper, as `shape.ts`'s `taper` draws it from the same `tip`. */
function taper({ cx, cy, rx, ry, tip = 1.05 }: OutlineLayout["body"]): Trace {
  const t = Math.max(1.05, tip);
  const tx = rx * Math.sqrt(1 - 1 / (t * t));
  const ty = cy - ry / t;
  const apex = cy - t * ry;
  const px = tx * 0.14;
  const py = ty + 0.86 * (apex - ty);
  const out: Trace = [cx - tx, ty, cx - px, py];
  quad(out, cx - px, py, cx, apex, cx + px, py);
  out.push(cx + tx, ty, cx - tx, ty);
  return out;
}

function core(l: OutlineLayout): Trace {
  switch (l.shape) {
    case "organic":
    case "cloud":
      return spline(l.body);
    case "hexagon":
    case "triangle":
      return polygon(l.body);
    case "capsule":
      return box(l.body);
    default:
      return superellipse(l.body);
  }
}

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
  const traces = l.body.tip ? [core(l), taper(l.body)] : [core(l)];
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
