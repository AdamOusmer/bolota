// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { _layout } from "../src/bolota";
import * as roster from "../src/expression";
import { CHOREO, type StateId } from "../src/live/choreo";
import { eyeRig, eyeRigs, rigMarkup } from "../src/live/rig";
import { IDENT, bakePose, type Pose } from "../src/morph";
import { capsulePath } from "../src/shape";

type Pt = [number, number];

/** `capsulePath`'s M/L/C outline as a polyline. */
function flatten(d: string, steps = 12): Pt[] {
  const out: Pt[] = [];
  for (const seg of d.match(/[MLC][^MLCZ]*/g) ?? []) {
    const v = (seg.match(/-?\d+\.?\d*/g) ?? []).map(Number);
    if (seg[0] !== "C") {
      out.push([v[0]!, v[1]!]);
      continue;
    }
    const [x0, y0] = out[out.length - 1]!;
    for (let i = 1; i <= steps; i++) {
      const s = i / steps, m = 1 - s;
      out.push([
        m ** 3 * x0 + 3 * m * m * s * v[0]! + 3 * m * s * s * v[2]! + s ** 3 * v[4]!,
        m ** 3 * y0 + 3 * m * m * s * v[1]! + 3 * m * s * s * v[3]! + s ** 3 * v[5]!,
      ]);
    }
  }
  return out;
}

/** The rig's outline as drawn: a rect with half-short-side corners, turned about its centre. */
function stadium(a: ReturnType<typeof eyeRig>) {
  const [w, h, r] = [a.width, a.height, a.rx].map(Number) as number[];
  const rot = Number(a.rot);
  const cx = Number(a.x) + w! / 2;
  const cy = Number(a.y) + h! / 2;
  const t = (rot! * Math.PI) / 180;
  const hx = w! / 2 - r!, hy = h! / 2 - r!;
  const local = (px: number, py: number): Pt => {
    const dx = px - cx!, dy = py - cy!;
    return [dx * Math.cos(t) + dy * Math.sin(t), -dx * Math.sin(t) + dy * Math.cos(t)];
  };
  const world = (lx: number, ly: number): Pt => [cx! + lx * Math.cos(t) - ly * Math.sin(t), cy! + lx * Math.sin(t) + ly * Math.cos(t)];
  const edge = (px: number, py: number) => {
    const [lx, ly] = local(px, py);
    const qx = Math.max(Math.abs(lx) - hx, 0), qy = Math.max(Math.abs(ly) - hy, 0);
    return Math.abs(Math.hypot(qx, qy) - r!);
  };
  const samples: Pt[] = [];
  for (let i = 0; i < 32; i++) {
    const u = ((i + 0.5) / 32) * Math.PI * 2;
    const sx = Math.sign(Math.cos(u)) * hx, sy = Math.sign(Math.sin(u)) * hy;
    samples.push(world(sx + r! * Math.cos(u), sy + r! * Math.sin(u)));
  }
  return { edge, samples };
}

function distToPolyline(p: Pt, poly: Pt[]) {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const [x1, y1] = poly[i]!, [x2, y2] = poly[i + 1]!;
    const ex = x2 - x1, ey = y2 - y1, l2 = ex * ex + ey * ey;
    const s = l2 ? Math.max(0, Math.min(1, ((p[0] - x1) * ex + (p[1] - y1) * ey) / l2)) : 0;
    best = Math.min(best, Math.hypot(x1 + s * ex - p[0], y1 + s * ey - p[1]));
  }
  return best;
}

const ROSTER = Object.values(roster).flatMap((e) => (typeof e === "object" && "p" in e ? [e.p] : []));
const STATES = Object.keys(CHOREO) as StateId[];
const statePoses = STATES.flatMap((id) => {
  const span = CHOREO[id].period ?? CHOREO[id].duration;
  return Array.from({ length: 13 }, (_, i) => CHOREO[id].eyes((i / 12) * span).pose);
});

describe("eye rig", () => {
  test("covers the static baked capsule for every roster pose and state frame", () => {
    expect(ROSTER.length).toBe(18);
    const poses: Pose[] = [...ROSTER, ...statePoses];
    let worst = 0;
    for (let s = 0; s < 200; s++) {
      const l = _layout(`seed-${s}`);
      for (const p of poses) {
        const baked = bakePose(l, p).l.eyes;
        const rigs = eyeRigs(l, p);
        baked.forEach((e, i) => {
          const path = flatten(capsulePath(e.cx, e.cy, e.rx * 2, e.ry * 2, e.rot));
          const { edge, samples } = stadium(rigs[i]!);
          for (const q of path) worst = Math.max(worst, edge(q[0], q[1]));
          for (const q of samples) worst = Math.max(worst, distToPolyline(q, path));
        });
      }
    }
    console.log(`rig vs capsulePath: max outline deviation ${worst.toFixed(4)} viewBox units`);
    expect(worst).toBeLessThan(0.05);
  }, 60_000);

  test("an eye as wide as it is tall is a circle", () => {
    const a = eyeRig({ cx: 40, cy: 50, rx: 4.5, ry: 4.5, rot: 17 });
    expect([a.width, a.height, a.rx, a.ry]).toEqual(["9", "9", "4.5", "4.5"]);
  });

  test("the live markup gives each ambient transform its own element under .mo-eye", () => {
    const html = rigMarkup(_layout("seed-7"), IDENT);
    expect(html.match(/<g class="mo-eye" style="--mo-wrap:-?1;--mo-lean:[\d.-]+;transform-origin:[\d.]+px [\d.]+px"><g><g><rect [^>]*style="--mo-rot:-?[\d.]+"\/><\/g><\/g><\/g>/g)?.length).toBe(2);
    expect(html).not.toContain("<path");
  });
});
