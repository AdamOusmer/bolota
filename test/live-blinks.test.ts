// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { _layout } from "../src/bolota";
import { CHOREO, ENTRANCE_BLINK, type StateId } from "../src/live/choreo";
import { faceEyes } from "../src/live/rig";
import { Timeline } from "../src/live/timeline";
import { CLOSINGS, IDLE } from "./fixtures/blink-closings";

const FRAME = 1 / 60;
const STEP = 1 / 180;
const START = 0.5;
const IDS = Object.keys(CHOREO) as StateId[];

/** Times each eye starts to close: its height over width falls under half of what it was over the last 0.3 s. */
function closings(open: (number | null)[][], times: number[]): number[][] {
  return [0, 1].map((i) => {
    const out: number[] = [];
    let shut = false;
    for (let k = 0; k < times.length; k++) {
      const h = open[k]![i];
      if (h == null) {
        shut = false;
        continue;
      }
      let peak = 0;
      for (let j = k; j >= 0 && times[k]! - times[j]! <= 0.3; j--) peak = Math.max(peak, open[j]![i] ?? 0);
      const closed = h < 0.5 * peak;
      if (closed && !shut) out.push(times[k]!);
      shut = closed;
    }
    return out;
  });
}

/** The old engine's closings, every kind: its fixed idle blinks, the entrance blink and the state's own, frozen. */
const oldClosings = (seed: string, id: StateId): number[][] => CLOSINGS[`${seed}|${id}`]!.map((l) => [...l]);

function newClosings(seed: string, id: StateId, end: number): number[][] {
  const l = _layout(seed);
  const tl = new Timeline("idle");
  tl.play(id, START, { loop: !!CHOREO[id].period });
  const times: number[] = [];
  const open: (number | null)[][] = [];
  for (let t = 0; t <= end; t += STEP) {
    const e = tl.eyes(t);
    times.push(t);
    open.push(e.alpha > 0.01 ? faceEyes(l, e).map((x) => x.ry / x.rx) : [null, null]);
  }
  return closings(open, times);
}

const near = (list: number[], t: number) => list.some((g) => Math.abs(g - t) <= FRAME);

/** The old engine's fixed idle blinks for a seed, which the seeded CSS blink replaces. */
const idleBlinks = (seed: string) => [...IDLE[seed]!];

describe("scripted eye events match bloub", () => {
  for (const id of IDS) {
    test(`${id}: the entrance blink is cued when bloub blinks, and every one-eye closing is the state's own`, () => {
      const end = START + Math.max(CHOREO[id].duration, 9);
      const tl = new Timeline("idle");
      tl.play(id, START, { loop: !!CHOREO[id].period });
      const cue = tl.blinkCue(START - FRAME, START);
      for (const seed of ["alain", "seed-7"]) {
        const [left, right] = oldClosings(seed, id) as [number[], number[]];
        const idle = idleBlinks(seed);
        const entrance = left.some((t) => near(right, t) && t >= START && t <= START + ENTRANCE_BLINK);
        const both = [...idle, ...left.filter((t) => near(right, t))];
        expect(cue !== null, `${seed}: bloub ${entrance ? "blinks" : "does not blink"} on entering ${id}`).toBe(entrance);
        if (cue !== null) expect(Math.abs(cue - START)).toBeLessThanOrEqual(FRAME);
        const [nl, nr] = newClosings(seed, id, end) as [number[], number[]];
        const own = [left.filter((t) => !near(both, t)), right.filter((t) => !near(both, t))];
        if (seed === "alain")
          console.log(`${id.padEnd(8)} entrance ${cue ?? "-"}  one-eye old ${own.map((e) => e.map((t) => t.toFixed(3)).join(" ") || "-").join(" | ")}  new ${[nl, nr].map((e) => e!.map((t) => t.toFixed(3)).join(" ") || "-").join(" | ")}`);
        for (const [old, now] of [[own[0]!, nl], [own[1]!, nr]] as const)
          for (const t of old)
            expect(near(now!, t), `${seed}: ${id} closes one eye at ${t.toFixed(3)}; new closes at ${now!.map((g) => g.toFixed(3)).join(", ")}`).toBe(true);
      }
    });
  }

  test("the engine computes no idle blink: a resting face holds its lids", () => {
    const tl = new Timeline("idle");
    for (let t = 0; t < 30; t += 0.01) expect(tl.eyes(t).pose.esy).toBe(1);
  });

  test("a looped restart is not an entrance", () => {
    const tl = new Timeline("idle");
    tl.play("swirl", 0.5, { loop: true });
    expect(tl.blinkCue(0.4, 0.5)).toBe(0.5);
    const restart = 0.5 + CHOREO.swirl.duration + CHOREO.swirl.morph;
    expect(tl.blinkCue(restart - 0.01, restart + 0.01)).toBeNull();
  });
});
