// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { FakeDocument, actOf, frame, mountOn, nodes } from "./engine-dom";

describe("mountEngine frame loop", () => {
  test("bolotas on one window share a single animation frame", () => {
    const doc = new FakeDocument();
    const bots = ["a-seed", "b-seed", "c-seed"].map((name) => mountOn(doc, name));
    bots.forEach(({ handle }) => handle.loop("orbit"));
    expect(doc.defaultView.queue.length).toBe(1);

    frame(doc, 16);
    expect(doc.defaultView.queue.length).toBe(1);

    bots.forEach(({ handle }) => handle.stop());
    expect(doc.defaultView.queue.length).toBe(0);
  });

  test("a stopped bolota stops ticking while the others keep animating", () => {
    const doc = new FakeDocument();
    const still = mountOn(doc, "still-seed");
    const live = mountOn(doc, "live-seed");
    still.handle.loop("orbit");
    live.handle.loop("orbit");
    frame(doc, 16);
    still.handle.stop();

    const stillBefore = actOf(still.svg);
    const liveBefore = actOf(live.svg);
    for (let t = 32; t <= 800; t += 16) frame(doc, t);

    expect(actOf(still.svg)).toBe(stillBefore);
    expect(actOf(live.svg)).not.toBe(liveBefore);
    expect(doc.defaultView.queue.length).toBe(1);
  });

  test("frames update the figure in place instead of rebuilding it", () => {
    const doc = new FakeDocument();
    const { svg, handle } = mountOn(doc, "steady-seed");
    handle.loop("orbit");
    frame(doc, 16);
    const before = nodes(svg);

    for (let t = 32; t <= 1600; t += 16) frame(doc, t);

    const after = new Set(nodes(svg));
    const lost = before.filter((n) => !after.has(n) || n.parentNode === null);
    expect(lost).toEqual([]);
  });

  test("stopping every bolota empties the queue and playing one again refills it", () => {
    const doc = new FakeDocument();
    const a = mountOn(doc, "a-seed");
    const b = mountOn(doc, "b-seed");
    a.handle.loop("orbit");
    b.handle.loop("orbit");
    a.handle.stop();
    b.handle.stop();
    expect(doc.defaultView.queue.length).toBe(0);
    a.handle.play("orbit", { loop: true });
    expect(doc.defaultView.queue.length).toBe(1);
  });
});
