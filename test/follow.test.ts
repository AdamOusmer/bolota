// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { drain, eyeAttrs, eyeCentre, frame, mounted, rectsOf, type FakeDocument } from "./engine-dom";

const move = (doc: FakeDocument, clientX: number, clientY: number, pointerType = "mouse") =>
  doc.defaultView.fire("pointermove", { clientX, clientY, pointerType });

const eyeX = (svg: ReturnType<typeof mounted>["svg"]) => eyeCentre(rectsOf(svg)[0]!)[0];
const eyeY = (svg: ReturnType<typeof mounted>["svg"]) => eyeCentre(rectsOf(svg)[0]!)[1];
const listeners = (doc: FakeDocument) => doc.defaultView.count() + doc.count();

/** Mounts, follows the window, points at `(x, y)` and settles. */
function pointed(x: number, y: number) {
  const m = mounted();
  m.handle.follow();
  frame(m.doc, 16);
  move(m.doc, x, y);
  drain(m.doc, 16, 5);
  return m;
}

describe("follow attach and detach", () => {
  test("off by default: mounting adds only the document's visibilitychange listener", () => {
    const { doc } = mounted();
    expect(listeners(doc)).toBe(1);
  });

  test("follow() listens, follow(false) removes every listener", () => {
    const { doc, handle } = mounted();
    handle.follow();
    expect(listeners(doc)).toBeGreaterThan(0);
    handle.follow(false);
    expect(listeners(doc)).toBe(1);
  });

  test("destroy detaches too", () => {
    const { doc, handle } = mounted();
    handle.follow();
    handle.destroy();
    expect(listeners(doc)).toBe(0);
  });

  test("an element target is listened to directly, and re-following swaps rather than stacks", () => {
    const { doc, svg, handle } = mounted();
    handle.follow(svg as unknown as Element);
    expect(svg.count()).toBeGreaterThan(0);
    const once = listeners(doc) + svg.count();
    handle.follow(svg as unknown as Element);
    expect(listeners(doc) + svg.count()).toBe(once);
    handle.follow(false);
    expect(svg.count()).toBe(0);
  });

  test("after follow(false) the eyes ignore the pointer", () => {
    const { doc, svg, handle } = mounted();
    handle.follow();
    handle.follow(false);
    const rest = eyeAttrs(svg);
    move(doc, 900, 50);
    drain(doc, 16, 2);
    expect(eyeAttrs(svg)).toEqual(rest);
  });
});

describe("follow moves the eyes", () => {
  test("left, centre and right are ordered", () => {
    const left = eyeX(pointed(-800, 50).svg);
    const centre = eyeX(pointed(50, 50).svg);
    const right = eyeX(pointed(900, 50).svg);
    expect(left).toBeLessThan(centre);
    expect(centre).toBeLessThan(right);
  });

  test("above, centre and below are ordered", () => {
    const up = eyeY(pointed(50, -800).svg);
    const centre = eyeY(pointed(50, 50).svg);
    const down = eyeY(pointed(50, 900).svg);
    expect(up).toBeLessThan(centre);
    expect(centre).toBeLessThan(down);
  });

  test("a touch pointer is ignored", () => {
    const { doc, handle } = mounted();
    handle.follow();
    drain(doc, 0, 5);
    move(doc, 900, 50, "touch");
    expect(doc.defaultView.queue.length).toBe(0);
  });

  test("leaving releases the gaze back to the resting face", () => {
    const { doc, svg } = pointed(900, 50);
    const looked = eyeAttrs(svg);
    doc.fire("pointerleave");
    drain(doc, 10_000, 5);
    expect(eyeAttrs(svg)).not.toEqual(looked);
  });

  test("a parked pointer holds the gaze indefinitely and the clock parks", () => {
    const { doc, svg } = pointed(900, 50);
    expect(doc.defaultView.queue.length).toBe(0);
    const held = eyeAttrs(svg);
    frame(doc, 60_000);
    expect(eyeAttrs(svg)).toEqual(held);
  });

  test("a state that owns its gaze is not overridden by the pointer", () => {
    const { doc, svg, handle } = mounted();
    handle.loop("wide");
    handle.follow();
    frame(doc, 16);
    drain(doc, 16, 2);
    const own = eyeAttrs(svg);
    move(doc, 900, 50);
    frame(doc, 5000);
    drain(doc, 5000, 1);
    expect(eyeAttrs(svg)).toEqual(own);
  });
});

describe("follow layout reads", () => {
  test("pointer moves read no rect; scroll and resize read once per frame", () => {
    const { doc, handle } = mounted();
    handle.follow();
    frame(doc, 16);
    const base = doc.rects;
    for (let i = 0; i < 60; i++) {
      move(doc, 200 + i * 5, 40);
      frame(doc, 32 + i * 16);
    }
    expect(doc.rects).toBe(base);

    doc.defaultView.fire("scroll");
    doc.defaultView.fire("scroll");
    doc.defaultView.fire("resize");
    frame(doc, 2000);
    expect(doc.rects).toBe(base + 1);
    handle.destroy();
  });
});
