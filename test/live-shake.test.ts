// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { excited } from "../src/expression";
import { mountLive } from "../src/live/mount";
import { FakeDocument, FakeElement, frame, makeSvg } from "./live-dom";

const proto = FakeElement.prototype as unknown as { getAnimations?: () => never[] };

function hybrid() {
  const doc = new FakeDocument();
  const svg = makeSvg(doc);
  const handle = mountLive(svg as unknown as SVGSVGElement, "shake-seed");
  handle.loop("idle");
  const root = svg.querySelectorAll(".mo-root")[0]!;
  return { doc, svg, handle, root };
}

/** Frames at 16 ms from `from`; returns the end time and the first time the queue was empty. */
function step(doc: FakeDocument, from: number, seconds: number, seen?: (ms: number) => void) {
  let parkedAt = -1;
  let ms = from;
  for (const end = from + seconds * 1000; ms < end; ) {
    if (parkedAt < 0 && !doc.defaultView.queue.length) parkedAt = ms;
    frame(doc, (ms += 16));
    seen?.(ms);
  }
  return { ms, parkedAt };
}

describe("a held tremor is the stylesheet's", () => {
  test("excited parks, wears data-mo-shake and --mo-shake, and hands back on null", () => {
    proto.getAnimations = () => [];
    try {
      const { doc, svg, handle, root } = hybrid();
      const amplitude = excited.p.shake;
      expect(amplitude).toBeGreaterThan(0);

      handle.setExpression("excited");
      let wrote = false;
      const a = step(doc, 0, 3, () => {
        if (root.getAttribute("transform") !== null) wrote = true;
      });
      expect(wrote).toBe(true);
      expect(a.parkedAt).toBeGreaterThanOrEqual(0);
      expect(a.parkedAt).toBeLessThan(1500);
      expect(doc.defaultView.queue.length).toBe(0);
      expect(svg.hasAttribute("data-mo-shake")).toBe(true);
      expect(svg.style.getPropertyValue("--mo-shake")).toBe(String(amplitude));
      expect(root.getAttribute("transform")).toBeNull();

      handle.setExpression(null);
      expect(svg.hasAttribute("data-mo-shake")).toBe(false);
      expect(svg.style.getPropertyValue("--mo-shake")).toBe("");
      let moved = false;
      const b = step(doc, a.ms, 1, () => {
        if (root.getAttribute("transform") !== null) moved = true;
      });
      expect(moved).toBe(true);
      expect(root.getAttribute("transform")).toBeNull();
      expect(svg.hasAttribute("data-mo-shake")).toBe(false);
      expect(doc.defaultView.queue.length).toBe(0);
      expect(b.ms).toBeGreaterThan(a.ms);
    } finally {
      delete proto.getAnimations;
    }
  });

  test("a pose without a tremor never sets it", () => {
    proto.getAnimations = () => [];
    try {
      const { doc, svg, handle } = hybrid();
      handle.setExpression("happy");
      step(doc, 0, 3, () => expect(svg.hasAttribute("data-mo-shake")).toBe(false));
      expect(svg.style.getPropertyValue("--mo-shake")).toBe("");
    } finally {
      delete proto.getAnimations;
    }
  });
});
