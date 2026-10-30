// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeDocument, FakeElement, frame, makeSvg, run } from "./live-dom";

type Mount = typeof import("../src/live/mount").mountLive;

let n = 0;
const fresh = async (): Promise<Mount> => (await import(`../src/live/mount.ts?lazy${n++}`)).mountLive;
const settle = () => new Promise((r) => setTimeout(r, 5));
const asSvg = (el: FakeElement) => el as unknown as SVGSVGElement;

function decorNodes(svg: FakeElement): number {
  const figure = svg.querySelector(".mo-bob")!.children[0]!;
  const [defs, back, , front] = figure.children;
  const count = (el: FakeElement): number => el.children.reduce((s, c) => s + 1 + count(c), 0);
  return count(defs!) + count(back!) + count(front!);
}

const realSetTimeout = globalThis.setTimeout;
let timers: number;

beforeEach(() => {
  timers = 0;
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    timers++;
    return realSetTimeout(fn, ms);
  }) as typeof setTimeout;
});

afterEach(() => {
  globalThis.setTimeout = realSetTimeout;
});

describe("lazy decor", () => {
  test("decor is drawn only once the import has resolved, by the next frame", async () => {
    const mountLive = await fresh();
    const doc = new FakeDocument();
    const svg = makeSvg(doc);
    const handle = mountLive(asSvg(svg), "lazy-a");
    handle.loop("orbit");
    run(doc, 0, 0.5);
    expect(decorNodes(svg)).toBe(0);
    await settle();
    expect(doc.defaultView.queue.length).toBeGreaterThan(0);
    run(doc, 600, 0.5);
    expect(decorNodes(svg)).toBeGreaterThan(0);
  });

  test("a state that finished before the import resolved still gets its decor", async () => {
    const mountLive = await fresh();
    const doc = new FakeDocument();
    const svg = makeSvg(doc);
    const handle = mountLive(asSvg(svg), "lazy-b");
    handle.play("burst", { loop: true });
    await settle();
    run(doc, 0, 0.6);
    expect(decorNodes(svg)).toBeGreaterThan(0);
  });

  test("destroy before the import resolves creates nothing", async () => {
    const mountLive = await fresh();
    const doc = new FakeDocument();
    const svg = makeSvg(doc);
    const handle = mountLive(asSvg(svg), "lazy-c");
    handle.loop("orbit");
    handle.destroy();
    await settle();
    expect(doc.defaultView.queue.length).toBe(0);
    expect(svg.querySelectorAll("path").length).toBe(0);
    expect(svg.querySelectorAll("circle").length).toBe(0);
    expect(svg.querySelector(".mo-bob")).toBeNull();
  });

  test("reduced motion draws the still frame's decor once the import resolves", async () => {
    const mountLive = await fresh();
    const doc = new FakeDocument();
    doc.defaultView.reduced = true;
    const svg = makeSvg(doc);
    const handle = mountLive(asSvg(svg), "lazy-d");
    handle.play("orbit");
    expect(decorNodes(svg)).toBe(0);
    await settle();
    expect(decorNodes(svg)).toBeGreaterThan(0);
    expect(doc.defaultView.queue.length).toBe(0);
  });

  test("idle warmup shares one import, so a later instance draws decor with no wait", async () => {
    const mountLive = await fresh();
    for (let i = 0; i < 5; i++) {
      const doc = new FakeDocument();
      mountLive(asSvg(makeSvg(doc)), `lazy-w${i}`);
    }
    expect(timers).toBe(5);
    await new Promise((r) => realSetTimeout(r, 300));
    const doc = new FakeDocument();
    const svg = makeSvg(doc);
    mountLive(asSvg(svg), "lazy-w9").loop("orbit");
    run(doc, 0, 0.5);
    expect(decorNodes(svg)).toBeGreaterThan(0);
  });
});
