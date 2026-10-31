// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { motionSeeds } from "../src/animate";
import { BLINK_CYCLE, BLINKS, lid, nextBlink } from "../src/live/head";
import { mountLive } from "../src/live/mount";
import { resolve } from "../src/render";
import { FakeDocument, FakeElement, frame, makeSvg } from "./live-dom";

const CYCLE_MS = BLINK_CYCLE * 1000;

describe("nextBlink agrees with lid", () => {
  test("lid is open until the start, shut after it, and open again at the end, over three cycles", () => {
    let seed = 7;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 2000; i++) {
      const ms = random() * 3 * CYCLE_MS;
      const { start, end } = nextBlink(ms);
      expect(end).toBeGreaterThan(start);
      expect(end).toBeGreaterThan(ms);
      for (let t = ms; t < start; t += 4) expect(lid(t), `open at ${t} before ${start}`).toBe(1);
      expect(lid(start + 1)).toBeLessThan(1);
      expect(lid(end - 1)).toBeLessThan(1);
      expect(lid(end)).toBe(1);
    }
  });

  test("a time inside a blink returns that blink, and the schedule wraps at the cycle", () => {
    const mid = (BLINKS[2] + 0.05) * 1000;
    expect(nextBlink(mid).start).toBeCloseTo(BLINKS[2] * 1000, 6);
    expect(nextBlink(CYCLE_MS - 1).start).toBeCloseTo(CYCLE_MS + BLINKS[0] * 1000, 6);
  });
});

describe("a parked engine blinks on a timer", () => {
  const proto = FakeElement.prototype as unknown as { getAnimations?: () => never[] };

  test("no frame between blinks, the eye rects dip on the schedule, few ticks over 20 s", () => {
    proto.getAnimations = () => [];
    try {
      const name = "blink-seed";
      const s = motionSeeds(resolve(name, {}).t);
      const blinkAt = (s.blinkPhase / s.blink) * CYCLE_MS;
      const doc = new FakeDocument();
      const svg = makeSvg(doc);
      const handle = mountLive(svg as unknown as SVGSVGElement, name);
      handle.loop("idle");
      const view = doc.defaultView;
      const rects = svg.querySelectorAll(".mo-eye").map((e) => e.children[0]!.children[0]!);
      const m3 = () => Number(/matrix\(\S+ \S+ \S+ (\S+)/.exec(rects[0]!.getAttribute("transform")!)![1]);

      const STEP = 16;
      const LAG = STEP;
      const eyeAt = (ms: number) => blinkAt + ms - LAG;
      const seen: number[] = [];
      let ticks = 0;
      let rested = 0;
      for (let ms = STEP; ms <= 20000; ms += STEP) {
        if (view.queue.length) ticks++;
        frame(doc, ms);
        seen.push(m3());
        const e = eyeAt(ms);
        if (ms > 2000 && nextBlink(e - 100).start > e + 100) {
          rested++;
          expect(view.queue.length, `frame queued at ${ms} ms between blinks`).toBe(0);
        }
      }
      expect(rested).toBeGreaterThan(500);
      expect(ticks).toBeLessThan(0.25 * 60 * 20);

      const open = Math.max(...seen);
      const at = (ms: number) => seen[Math.round(ms / STEP) - 1]!;
      let checked = 0;
      for (let k = Math.floor((blinkAt + 3000) / CYCLE_MS); k < 3; k++) {
        for (const b of BLINKS) {
          const start = k * CYCLE_MS + b * 1000;
          const ms = start - blinkAt + LAG;
          if (ms < 3000 || ms > 19000) continue;
          const dipped = [0, 1, 2, 3].some((i) => at(ms + i * STEP) < open);
          expect(dipped, `blink at eye time ${start} (frame ${ms})`).toBe(true);
          expect(at(ms + 0.18 * 1000 + 3 * STEP)).toBe(open);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(3);
      handle.destroy();
      expect(view.timers.length).toBe(0);
    } finally {
      delete proto.getAnimations;
    }
  });
});
