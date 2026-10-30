// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { _layout } from "../src/bolota";
import { BotEngine } from "../src/bloub/engine";
import { _seededSilhouette } from "../src/engine";
import { CHOREO, type StateId } from "../src/live/choreo";
import { faceEyes } from "../src/live/rig";
import { Timeline } from "../src/live/timeline";

const FRAME = 1 / 60;
const STEP = 1 / 240;
const START = 0.5;
const IDS = Object.keys(CHOREO) as StateId[];

/** Times each eye starts to close: its height falls under half of what it was over the last 0.3 s. */
function closings(heights: (number | null)[][], times: number[]): number[][] {
  return [0, 1].map((i) => {
    const out: number[] = [];
    let shut = false;
    for (let k = 0; k < times.length; k++) {
      const h = heights[k]![i];
      if (h == null) {
        shut = false;
        continue;
      }
      let peak = 0;
      for (let j = k; j >= 0 && times[k]! - times[j]! <= 0.3; j--) peak = Math.max(peak, heights[j]![i] ?? 0);
      const closed = h < 0.5 * peak;
      if (closed && !shut) out.push(times[k]!);
      shut = closed;
    }
    return out;
  });
}

/** Width and height of bloub's centred capsule path (M/L/A commands), from its end points. */
function pathSize(d: string): [number, number] {
  let w = 0;
  let h = 0;
  for (const seg of d.match(/[MLA][^MLAZ]*/g) ?? []) {
    const v = (seg.match(/-?\d+\.?\d*/g) ?? []).map(Number);
    w = Math.max(w, Math.abs(v[v.length - 2]!));
    h = Math.max(h, Math.abs(v[v.length - 1]!));
  }
  return [2 * w, 2 * h];
}

function oldClosings(seed: string, id: StateId, end: number): number[][] {
  const l = _layout(seed);
  const sil = _seededSilhouette(l.body, l.draw, l.petals, l.extra);
  const eng = new BotEngine(l.body.rx, "idle", sil, null);
  eng.setState(id, START, !!CHOREO[id].period);
  const times: number[] = [];
  const heights: (number | null)[][] = [];
  for (let t = 0; t <= end; t += STEP) {
    const f = eng.sample(t);
    times.push(t);
    const row: (number | null)[] = [null, null];
    if (f.eyes.length === 2)
      f.eyes.forEach((e: { d: string; matrix: string; alpha: number }, i: number) => {
        const [a, b, , d] = (e.matrix.match(/-?\d+\.?\d*/g) ?? []).map(Number);
        const [w, h] = pathSize(e.d);
        row[i] = e.alpha > 0.01 ? (Math.abs(d!) * h) / (Math.hypot(a!, b!) * w) : null;
      });
    heights.push(row);
  }
  return closings(heights, times);
}

function newClosings(seed: string, id: StateId, end: number): number[][] {
  const l = _layout(seed);
  const tl = new Timeline("idle");
  tl.play(id, START, { loop: !!CHOREO[id].period });
  const times: number[] = [];
  const heights: (number | null)[][] = [];
  for (let t = 0; t <= end; t += STEP) {
    const e = tl.eyes(t);
    times.push(t);
    heights.push(e.alpha > 0.01 ? faceEyes(l, e).map((x) => x.ry / x.rx) : [null, null]);
  }
  return closings(heights, times);
}

describe("scripted eye events match bloub", () => {
  for (const id of IDS) {
    test(`${id}: every closing in the old engine closes in the new within a frame`, () => {
      const end = START + Math.max(CHOREO[id].duration, 9);
      for (const seed of ["alain", "seed-7"]) {
        const want = oldClosings(seed, id, end);
        const got = newClosings(seed, id, end);
        if (seed === "alain") {
          const fmt = (a: number[][]) => a.map((e) => e.map((t) => t.toFixed(3)).join(" ") || "-").join(" | ");
          console.log(`${id.padEnd(8)} old ${fmt(want)}  new ${fmt(got)}`);
        }
        if (CHOREO[id].eyes(1).alpha > 0) expect(want[0]!.length + want[1]!.length, `${id} has no closing to compare`).toBeGreaterThan(0);
        for (const i of [0, 1])
          for (const t of want[i]!) {
            const near = got[i]!.some((g) => Math.abs(g - t) <= FRAME);
            expect(near, `${seed} eye ${i} closes at ${t.toFixed(3)}; new closes at ${got[i]!.map((g) => g.toFixed(3)).join(", ")}`).toBe(true);
          }
      }
    });
  }
});
