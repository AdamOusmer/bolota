// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { BLINK_CYCLE, BLINKS, lid, nextBlink } from "../src/live/head";
import { JITTER_MS, WINDOW_MS, blinkSlot } from "../src/live/frames";
import { mountLive } from "../src/live/mount";
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
      const doc = new FakeDocument();
      const svg = makeSvg(doc);
      const handle = mountLive(svg as unknown as SVGSVGElement, name);
      handle.loop("idle");
      const view = doc.defaultView;
      const rects = svg.querySelectorAll(".mo-eye").map((e) => e.children[0]!.children[0]!);
      const m3 = () => Number(/matrix\(\S+ \S+ \S+ (\S+)/.exec(rects[0]!.getAttribute("transform")!)![1]);

      const STEP = 16;
      const seen: number[] = [];
      const queued: number[] = [];
      for (let ms = STEP; ms <= 20000; ms += STEP) {
        if (view.queue.length) queued.push(ms);
        frame(doc, ms);
        seen.push(m3());
      }
      const open = Math.max(...seen);
      const dips = seen.flatMap((v, i) => (v < open ? [(i + 1) * STEP] : []));
      const near = (ms: number) => dips.some((d) => Math.abs(d - ms) <= 400);
      expect(dips.length).toBeGreaterThan(8);
      expect(queued.filter((ms) => ms > 2000 && !near(ms)).length).toBe(0);
      expect(queued.length).toBeLessThan(0.25 * 60 * 20);
      expect(seen.at(-1)).toBe(open);
      handle.destroy();
      expect(view.timers.length).toBe(0);
    } finally {
      delete proto.getAnimations;
    }
  });

  test("twelve engines on one page blink in shared windows and the loop sleeps between them", () => {
    proto.getAnimations = () => [];
    try {
      const doc = new FakeDocument();
      const view = doc.defaultView;
      const handles: { destroy(): void }[] = [];
      const reads = Array.from({ length: 12 }, (_, i) => {
        const svg = makeSvg(doc);
        const handle = mountLive(svg as unknown as SVGSVGElement, `crowd-${i}`);
        handle.loop("idle");
        handles.push(handle);
        const rect = svg.querySelectorAll(".mo-eye").map((e) => e.children[0]!.children[0]!)[0]!;
        return () => Number(/matrix\(\S+ \S+ \S+ (\S+)/.exec(rect.getAttribute("transform")!)![1]);
      });
      const FRAMES = 2400;
      const STEP = 40000 / FRAMES;
      const seen = reads.map(() => [] as number[]);
      let busy = 0;
      for (let i = 1; i <= FRAMES; i++) {
        if (view.queue.length) busy++;
        frame(doc, i * STEP);
        reads.forEach((m3, e) => seen[e]!.push(m3()));
      }
      expect(busy).toBeLessThan(0.4 * FRAMES);
      const origin = blinkSlot(view as unknown as Window, 0, 0);

      const MIN_GAP = 1900;
      let doubles = 0;
      for (const rows of seen) {
        const open = Math.max(...rows);
        const starts = rows.flatMap((v, i) => (v < open && (i === 0 || rows[i - 1]! >= open) ? [(i + 1) * STEP] : []));
        expect(starts.length).toBeGreaterThan(3);
        let lead = -Infinity;
        for (const at of starts) {
          if (at - lead < 500) {
            doubles++;
            continue;
          }
          if (at > 2500) {
            const into = (((at - origin) % WINDOW_MS) + WINDOW_MS) % WINDOW_MS;
            expect(into, `blink at ${at} is ${into} ms into a window`).toBeLessThanOrEqual(JITTER_MS + 16);
          }
          if (lead > 0) expect(at - lead).toBeGreaterThanOrEqual(MIN_GAP - 16);
          lead = at;
        }
      }
      expect(doubles).toBeGreaterThan(0);
      handles.forEach((h) => h.destroy());
      expect(view.timers.length).toBe(0);
    } finally {
      delete proto.getAnimations;
    }
  });
});
