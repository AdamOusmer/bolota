// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { FakeDocument, FakeElement, actOf, frame, mounted, mountOn, nodes } from "./engine-dom";

const ALWAYS = { animate: "always" } as const;

function countActWrites(svg: FakeElement): { n: number } {
  const act = svg.querySelector(".mo-act")!;
  const set = act.setAttribute.bind(act);
  const writes = { n: 0 };
  act.setAttribute = (k: string, v: unknown) => {
    if (k === "transform") writes.n++;
    set(k, v);
  };
  return writes;
}

describe("mountEngine frame loop", () => {
  test("bolotas on one window share a single animation frame", () => {
    const doc = new FakeDocument();
    const bots = ["a-seed", "b-seed", "c-seed"].map((name) => mountOn(doc, name));
    bots.forEach(({ handle }) => handle.loop("done"));
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
    still.handle.loop("done");
    live.handle.loop("done");
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
    handle.loop("done");
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
    a.handle.loop("done");
    b.handle.loop("done");
    a.handle.stop();
    b.handle.stop();
    expect(doc.defaultView.queue.length).toBe(0);
    a.handle.play("done", { loop: true });
    expect(doc.defaultView.queue.length).toBe(1);
  });
});

describe("mountEngine drift-only frames", () => {
  test("a held wander is drawn on about every third frame", () => {
    const { doc, svg, handle } = mounted("facade-seed", ALWAYS);
    handle.loop("wander");
    let ms = 0;
    for (let i = 0; i < 60; i++) frame(doc, (ms += 16));
    const writes = countActWrites(svg);
    const frames = 125;
    for (let i = 0; i < frames; i++) frame(doc, (ms += 16));
    expect(writes.n).toBeGreaterThan(frames * 0.15);
    expect(writes.n).toBeLessThan(frames * 0.55);
  });

  test("a play or a pointer move draws on the very next frame", () => {
    const pokes: [string, (h: ReturnType<typeof mounted>) => void][] = [
      ["play", ({ handle }) => handle.play("thinking")],
      ["pointer", ({ doc }) => doc.defaultView.fire("pointermove", { clientX: 900, clientY: 50, pointerType: "mouse" })],
    ];
    for (const [name, poke] of pokes) {
      const bot = mounted("facade-seed", ALWAYS);
      const { doc, handle } = bot;
      handle.loop("wander");
      handle.follow();
      doc.log = { events: [] };
      let ms = 0;
      for (let i = 0; i < 90; i++) frame(doc, (ms += 16));
      const counts: number[] = [];
      let checked = false;
      for (let i = 0; i < 400 && !checked; i++) {
        doc.log.events.length = 0;
        frame(doc, (ms += 16));
        counts.push(doc.log.events.length);
        if (counts.length >= 2 && counts.at(-2)! > 0 && counts.at(-1) === 0) {
          poke(bot);
          doc.log.events.length = 0;
          frame(doc, (ms += 16));
          expect(doc.log.events.length, name).toBeGreaterThan(0);
          checked = true;
        }
      }
      expect(checked, name).toBe(true);
    }
  });
});
