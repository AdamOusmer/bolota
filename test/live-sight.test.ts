// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { beforeAll, describe, expect, test } from "bun:test";
import { mountLive } from "../src/live/mount";
import { FakeDocument, FakeElement, frame, makeSvg } from "./live-dom";

const asSvg = (el: FakeElement) => el as unknown as SVGSVGElement;
const settle = () => new Promise((r) => setTimeout(r, 20));
const KEY = Symbol.for("@luzir/bolota/frames");
const copy = (tag: string): Promise<typeof import("../src/live/frames")> => import(`../src/live/frames.ts?${tag}`);

class FakeIO {
  static made: FakeIO[] = [];
  targets = new Set<unknown>();
  disconnected = false;
  constructor(
    public cb: (entries: { target: unknown; isIntersecting: boolean }[]) => void,
    public opts: { rootMargin?: string },
  ) {
    FakeIO.made.push(this);
  }
  observe(el: unknown) {
    this.targets.add(el);
  }
  unobserve(el: unknown) {
    this.targets.delete(el);
  }
  disconnect() {
    this.disconnected = true;
    this.targets.clear();
  }
  set(el: unknown, isIntersecting: boolean) {
    this.cb([{ target: el, isIntersecting }]);
  }
}

function world() {
  FakeIO.made = [];
  const doc = new FakeDocument();
  (doc.defaultView as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;
  return doc;
}

function avatar(doc: FakeDocument, name: string) {
  const svg = makeSvg(doc);
  const handle = mountLive(asSvg(svg), name);
  return { svg, handle };
}

const queued = (doc: FakeDocument) => doc.defaultView.queue.length;

function drawn(svg: FakeElement): string {
  const figure = svg.querySelector(".mo-bob")!.children[0]!;
  return figure.outerHTML.replace(/[0-9a-z]+-g(\d+)/g, "G$1");
}

function steps(doc: FakeDocument, from: number, n: number): number {
  let ms = from;
  for (let i = 0; i < n; i++) frame(doc, (ms += 16));
  return ms;
}

beforeAll(async () => {
  const doc = new FakeDocument();
  avatar(doc, "sight-warm").handle.loop("orbit");
  await settle();
});

describe("sight: leaving and rejoining the loop", () => {
  test("an off-screen instance holds no frame and does no work", () => {
    const doc = world();
    const { svg, handle } = avatar(doc, "sight-a");
    handle.loop("orbit");
    steps(doc, 0, 10);
    FakeIO.made[0]!.set(svg, false);
    expect(queued(doc)).toBe(0);
    const before = drawn(svg);
    handle.play("burst");
    handle.setExpression("happy");
    doc.defaultView.fire("pointermove", { clientX: 5, clientY: 5, pointerType: "mouse" });
    expect(queued(doc)).toBe(0);
    expect(drawn(svg)).toBe(before);
  });

  test("the margin is the early-wake distance", () => {
    const doc = world();
    avatar(doc, "sight-m");
    expect(FakeIO.made[0]!.opts.rootMargin).toBe("200px");
  });

  const scenarios: [string, (h: ReturnType<typeof avatar>["handle"]) => void, number][] = [
    ["mid-orbit", (h) => h.loop("orbit"), 40],
    ["mid-burst", (h) => h.play("burst"), 20],
    ["mid-expression-morph", (h) => h.setExpression("angry"), 3],
  ];

  for (const [label, setup, n] of scenarios) {
    test(`${label}: the first frame after waking is the frozen frame, the next is one step on`, () => {
      const twin = world();
      const a = avatar(twin, "sight-c");
      const sleeper = world();
      const b = avatar(sleeper, "sight-c");
      const io = FakeIO.made[0]!;
      setup(a.handle);
      setup(b.handle);
      const ms = steps(twin, 0, n);
      steps(sleeper, 0, n);
      const frozen = drawn(a.svg);
      expect(drawn(b.svg)).toBe(frozen);

      io.set(b.svg, false);
      expect(queued(sleeper)).toBe(0);
      io.set(b.svg, true);
      expect(queued(sleeper)).toBe(1);

      frame(sleeper, ms + 987_654);
      expect(drawn(b.svg)).toBe(frozen);
      frame(sleeper, ms + 987_654 + 16);
      frame(twin, ms + 16);
      expect(drawn(b.svg)).toBe(drawn(a.svg));
    });
  }

  test("commands issued asleep play out on return, as if issued at the frozen time", () => {
    const twin = world();
    const a = avatar(twin, "sight-d");
    const sleeper = world();
    const b = avatar(sleeper, "sight-d");
    const io = FakeIO.made[0]!;
    a.handle.loop("orbit");
    b.handle.loop("orbit");
    steps(twin, 0, 30);
    steps(sleeper, 0, 30);
    io.set(b.svg, false);
    for (const h of [a.handle, b.handle]) {
      h.play("burst");
      h.setExpression("happy");
    }
    io.set(b.svg, true);
    let ta = 480;
    let tb = 480 + 5_000;
    frame(sleeper, (tb += 16));
    for (let i = 0; i < 60; i++) {
      frame(twin, (ta += 16));
      frame(sleeper, (tb += 16));
      expect(drawn(b.svg), `frame ${i}`).toBe(drawn(a.svg));
    }
  });
});

describe("sight: the document and the registry", () => {
  test("a hidden document pauses every instance and showing it resumes them", () => {
    const doc = world();
    const all = [1, 2, 3].map((i) => avatar(doc, `sight-h${i}`));
    all.forEach((x) => x.handle.loop("orbit"));
    steps(doc, 0, 3);
    expect(queued(doc)).toBe(1);
    doc.hidden = true;
    doc.fire("visibilitychange");
    expect(queued(doc)).toBe(0);
    doc.hidden = false;
    doc.fire("visibilitychange");
    expect(queued(doc)).toBe(1);
  });

  test("an instance mounted into a hidden document never starts", () => {
    const doc = world();
    doc.hidden = true;
    const { handle } = avatar(doc, "sight-i");
    handle.loop("orbit");
    expect(queued(doc)).toBe(0);
    doc.hidden = false;
    doc.fire("visibilitychange");
    expect(queued(doc)).toBe(1);
  });

  test("one observer per window, released with the last instance", () => {
    const doc = world();
    const all = [1, 2, 3, 4].map((i) => avatar(doc, `sight-o${i}`));
    expect(FakeIO.made.length).toBe(1);
    expect(FakeIO.made[0]!.targets.size).toBe(4);
    all.slice(0, 3).forEach((x) => x.handle.destroy());
    expect(FakeIO.made[0]!.disconnected).toBe(false);
    all[3]!.handle.destroy();
    expect(FakeIO.made[0]!.disconnected).toBe(true);
    expect(doc.count()).toBe(0);
  });

  test("two copies of frames.ts share one frame and one observer", async () => {
    const one = await copy("copy-a");
    const two = await copy("copy-b");
    expect(one.startFrames).not.toBe(two.startFrames);
    const doc = world();
    const view = doc.defaultView as unknown as Window;
    const seen: string[] = [];
    one.startFrames(view, () => seen.push("a"));
    two.startFrames(view, () => seen.push("b"));
    expect(queued(doc)).toBe(1);
    frame(doc, 16);
    expect(seen).toEqual(["a", "b"]);
    const stop1 = one.watchSight(view, makeSvg(doc) as unknown as Element, () => {});
    const stop2 = two.watchSight(view, makeSvg(doc) as unknown as Element, () => {});
    expect(FakeIO.made.length).toBe(1);
    stop1();
    stop2();
    expect(FakeIO.made[0]!.disconnected).toBe(true);
  });

  test("a registry of another version is left alone; this copy keeps a private one", async () => {
    const frames = await copy("copy-v");
    const doc = world();
    const view = doc.defaultView as unknown as Window;
    const foreign = { v: 99 };
    (view as unknown as Record<symbol, unknown>)[KEY] = foreign;
    let ticks = 0;
    frames.startFrames(view, () => ticks++);
    expect(queued(doc)).toBe(1);
    frame(doc, 16);
    expect(ticks).toBe(1);
    expect((view as unknown as Record<symbol, unknown>)[KEY]).toBe(foreign);
    expect(foreign).toEqual({ v: 99 });
  });
});
