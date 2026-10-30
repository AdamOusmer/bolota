// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { _layout } from "../src/bolota";
import * as roster from "../src/expression";
import { CHOREO, expressed } from "../src/live/choreo";
import { CLEARANCE, MARGIN, fitEyes, type EyeBox } from "../src/live/fit";
import { edge } from "../src/live/outline";
import { faceEyes } from "../src/live/rig";
import type { Pose } from "../src/morph";
import { superellipse } from "../src/shape";

type Layout = ReturnType<typeof _layout>;

/** The static path strings, flattened: the oracle the analytic outline answers to. Test-only. */
function flatten(d: string, steps = 24): number[][] {
  const polys: number[][] = [];
  let poly: number[] = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  for (const raw of d.match(/[MLHVCQZ][^MLHVCQZ]*/g) ?? []) {
    const a = (raw.slice(1).match(/-?\d+\.?\d*/g) ?? []).map(Number);
    switch (raw[0]) {
      case "M":
        if (poly.length > 2) polys.push(poly);
        x = sx = a[0]!; y = sy = a[1]!; poly = [x, y];
        break;
      case "L": x = a[0]!; y = a[1]!; poly.push(x, y); break;
      case "H": x = a[0]!; poly.push(x, y); break;
      case "V": y = a[0]!; poly.push(x, y); break;
      case "C":
        for (let i = 1; i <= steps; i++) {
          const s = i / steps, m = 1 - s;
          poly.push(m ** 3 * x + 3 * m * m * s * a[0]! + 3 * m * s * s * a[2]! + s ** 3 * a[4]!, m ** 3 * y + 3 * m * m * s * a[1]! + 3 * m * s * s * a[3]! + s ** 3 * a[5]!);
        }
        x = a[4]!; y = a[5]!;
        break;
      case "Q":
        for (let i = 1; i <= steps; i++) {
          const s = i / steps, m = 1 - s;
          poly.push(m * m * x + 2 * m * s * a[0]! + s * s * a[2]!, m * m * y + 2 * m * s * a[1]! + s * s * a[3]!);
        }
        x = a[2]!; y = a[3]!;
        break;
      case "Z": x = sx; y = sy; poly.push(sx, sy); break;
    }
  }
  if (poly.length > 2) polys.push(poly);
  return polys;
}

/** First exit from the body centre along `theta`, through the union of every drawn shape. */
function exactExit(l: Layout, polys: number[][], theta: number): number {
  const { cx, cy } = l.body;
  const dx = Math.cos(theta), dy = Math.sin(theta);
  const spans: number[][] = [];
  for (const p of polys) {
    const hits: number[] = [];
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ex = p[i + 2]! - p[i]!, ey = p[i + 3]! - p[i + 1]!;
      const det = ex * dy - ey * dx;
      if (Math.abs(det) < 1e-12) continue;
      const t = (ex * (p[i + 1]! - cy) - ey * (p[i]! - cx)) / det;
      const u = (dx * (p[i + 1]! - cy) - dy * (p[i]! - cx)) / det;
      if (t > 0 && u >= 0 && u < 1) hits.push(t);
    }
    hits.sort((a, b) => a - b);
    let i = 0;
    if (hits.length % 2) spans.push([0, hits[i++]!]);
    for (; i + 1 < hits.length; i += 2) spans.push([hits[i]!, hits[i + 1]!]);
  }
  for (const c of l.petals) {
    const fx = cx - c.cx, fy = cy - c.cy, b = fx * dx + fy * dy;
    const disc = b * b - (fx * fx + fy * fy - c.r * c.r);
    if (disc > 0 && -b + Math.sqrt(disc) > 0) spans.push([Math.max(0, -b - Math.sqrt(disc)), -b + Math.sqrt(disc)]);
  }
  let end = 0;
  for (let grew = true; grew; ) {
    grew = false;
    for (const [a, b] of spans) if (a! <= end + 1e-9 && b! > end) { end = b!; grew = true; }
  }
  return end;
}

const bodyPolys = (l: Layout, extra: boolean) => [
  ...flatten(l.draw ? l.draw(l.body) : superellipse(l.body)),
  ...(extra ? l.extra.flatMap((d) => flatten(d)) : []),
];

describe("analytic outline", () => {
  test("matches the drawn outline on 4000 seeds, and never claims room the drawing lacks", () => {
    let over = 0, under = 0, where = "";
    for (let s = 0; s < 4000; s++) {
      const l = _layout(`seed-${s}`);
      const polys = bodyPolys(l, true);
      for (let i = 0; i < 5; i++) {
        const th = ((i + ((s * 0.618) % 1)) / 5) * Math.PI * 2;
        const d = edge(l, th) - exactExit(l, polys, th);
        if (d > over) { over = d; where = `seed-${s} ${l.shape} ${((th * 180) / Math.PI).toFixed(1)}°`; }
        if (l.shape !== "sun" && -d > under) under = -d;
      }
    }
    console.log(`outline: max overstatement ${over.toFixed(4)} (${where}); max understatement off petal seams ${under.toFixed(4)}`);
    expect(over).toBeLessThan(0.05);
    expect(under).toBeLessThan(0.25);
  }, 60_000);
});

const ROSTER: Pose[] = Object.values(roster).flatMap((e) => (typeof e === "object" && "p" in e ? [e.p] : []));
/** Gaze extremes, for the states that follow; a followed face takes the gaze in place of its own turn. */
const GAZE = [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]] as const;
const RAYS = 2048;
/**
 * The sweep's seeds: the ones a 1000-seed sweep found corrected most often,
 * then the first three of every shape family, so each family is covered.
 */
const WORST = ["seed-632", "seed-737", "seed-127", "seed-905", "seed-101", "seed-109", "seed-269", "seed-336", "seed-814", "seed-923", "seed-956", "seed-171"];
const SWEEP = (() => {
  const out = [...WORST];
  const per = new Map<string, number>();
  for (let s = 0; per.size < 10 || [...per.values()].some((n) => n < 3); s++) {
    const shape = _layout(`seed-${s}`).shape;
    if ((per.get(shape) ?? 0) >= 3) continue;
    per.set(shape, (per.get(shape) ?? 0) + 1);
    out.push(`seed-${s}`);
  }
  return out;
})();

/** Every point the rig draws for this eye, on a fine grid of its outline. */
function rimPoints(e: EyeBox, out: number[]) {
  out.length = 0;
  const r = Math.min(e.rx, e.ry), hx = e.rx - r, hy = e.ry - r;
  const t = (e.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const lx = Math.sign(Math.cos(a)) * hx + r * Math.cos(a);
    const ly = Math.sign(Math.sin(a)) * hy + r * Math.sin(a);
    out.push(e.cx + lx * c - ly * s, e.cy + lx * s + ly * c);
  }
  for (let j = -4; j <= 4; j++)
    for (const side of [-1, 1]) {
      const lx = hx >= hy ? (j / 4) * hx : side * r;
      const ly = hx >= hy ? side * r : (j / 4) * hy;
      out.push(e.cx + lx * c - ly * s, e.cy + lx * s + ly * c);
    }
}

describe("eye constraint", () => {
  test("every state, expression, frame and gaze extreme stays inside the drawn outline and apart", () => {
    const corrected = { frames: 0, pulled: 0, shrunk: 0, pulls: [] as number[], shrinks: [] as number[] };
    const out = { pull: 0, shrink: 1 };
    const pts: number[] = [];
    let worstDepth = Infinity, worstGap = Infinity;
    const shapes = new Set<string>();
    for (const seed of SWEEP) {
      const l = _layout(seed);
      shapes.add(l.shape);
      const polys = bodyPolys(l, false);
      const exit = new Float64Array(RAYS);
      for (let i = 0; i < RAYS; i++) exit[i] = exactExit(l, polys, (i / RAYS) * Math.PI * 2);
      const exact = (x: number, y: number) => {
        const dx = x - l.body.cx, dy = y - l.body.cy;
        let u = Math.atan2(dy, dx) / (Math.PI * 2);
        if (u < 0) u += 1;
        const i = Math.floor(u * RAYS) % RAYS;
        return Math.min(exit[i]!, exit[(i + 1) % RAYS]!) - Math.hypot(dx, dy);
      };
      for (const c of Object.values(CHOREO)) {
        const span = c.period ?? c.duration;
        for (let k = 0; k < 4; k++) {
          const t = ((k + 0.5) / 4) * span;
          const own = c.eyes(t);
          if (own.alpha <= 0.01) continue;
          const act = c.act(t);
          const turn = act.rot * act.upright;
          const tr = (-turn * Math.PI) / 180, tc = Math.cos(tr), ts = Math.sin(tr);
          const faces = c.baseFace || c.acceptsExpression ? [own, ...ROSTER.map((p) => expressed(c, own, p))] : [own];
          for (const f of faces)
            for (const [gx, gy] of c.baseFace ? GAZE : GAZE.slice(0, 1)) {
              const followed = gx || gy ? { ...f, head: { ...f.head, yaw: 0 } } : f;
              const eyes = faceEyes(l, followed, turn).map((e) => ({ ...e, cx: e.cx + gx, cy: e.cy + gy }));
              fitEyes(l, eyes, turn, out);
              corrected.frames++;
              if (out.pull > 0) { corrected.pulled++; corrected.pulls.push(out.pull); }
              if (out.shrink < 1) { corrected.shrunk++; corrected.shrinks.push(out.shrink); }
              const rims = eyes.map((e) => {
                rimPoints(e, pts);
                for (let i = 0; i < pts.length; i += 2) {
                  const px = pts[i]! - l.body.cx, py = pts[i + 1]! - l.body.cy;
                  const d = exact(l.body.cx + px * tc - py * ts, l.body.cy + px * ts + py * tc);
                  if (d < worstDepth) worstDepth = d;
                }
                return [...pts];
              });
              let gap = Infinity;
              for (let i = 0; i < rims[0]!.length; i += 4)
                for (let j = 0; j < rims[1]!.length; j += 4)
                  gap = Math.min(gap, Math.hypot(rims[0]![i]! - rims[1]![j]!, rims[0]![i + 1]! - rims[1]![j + 1]!));
              if (gap < worstGap) worstGap = gap;
            }
        }
      }
    }
    expect([...shapes].sort()).toEqual(["boxy", "capsule", "cloud", "droplet", "hexagon", "nub", "organic", "round", "sun", "triangle"]);
    const q = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))]! : NaN);
    console.log(
      `fit: ${corrected.frames} frames; pulled ${((100 * corrected.pulled) / corrected.frames).toFixed(2)}% ` +
        `(median ${q(corrected.pulls, 0.5).toFixed(3)}, max ${q(corrected.pulls, 1).toFixed(3)}); ` +
        `shrunk ${((100 * corrected.shrunk) / corrected.frames).toFixed(2)}% (median ${q(corrected.shrinks, 0.5).toFixed(3)}, min ${q(corrected.shrinks, 0).toFixed(3)}); ` +
        `worst depth ${worstDepth.toFixed(3)}, worst gap ${worstGap.toFixed(3)}`,
    );
    expect(worstDepth).toBeGreaterThan(MARGIN - 0.1);
    expect(worstGap).toBeGreaterThan(CLEARANCE - 0.05);
  }, 60_000);
});
