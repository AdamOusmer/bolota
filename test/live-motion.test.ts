// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { _layout } from "../src/bolota";
import { mountLive } from "../src/live/mount";
import { FakeDocument, FakeElement, frame, makeSvg } from "./live-dom";

/**
 * The motion bloub's engine had, held on the live engine: eyes that glide and
 * never jump, a pointer followed across the whole face, and large eyes that
 * keep their movement.
 */

const SEEDS = ["ada", "zed", "luna", "bob", "seed-632", "seed-905", "seed-127", "seed-7"];
const asSvg = (el: FakeElement) => el as unknown as SVGSVGElement;
const rectsOf = (svg: FakeElement) => svg.querySelectorAll(".mo-eye").map((e) => e.children[0]!.children[0]!);

function centres(svg: FakeElement): [number, number][] {
  return rectsOf(svg).map((r) => {
    const v = /matrix\(([^)]+)\)/.exec(r.getAttribute("transform")!)![1]!.split(" ").map(Number);
    return [v[4]!, v[5]!];
  });
}

function mount(seed: string) {
  const doc = new FakeDocument();
  const svg = makeSvg(doc);
  const handle = mountLive(asSvg(svg), seed);
  return { doc, svg, handle };
}

/** Steps 60 Hz frames for `seconds`, recording both eyes' centres each frame. */
function record(doc: FakeDocument, svg: FakeElement, from: number, seconds: number, each?: (ms: number) => void) {
  const out: [number, number][][] = [];
  let ms = from;
  for (let i = 0; i < seconds * 60; i++) {
    each?.(ms);
    frame(doc, (ms += 16));
    out.push(centres(svg));
  }
  return { out, ms };
}

/** The largest step between frames, and how often an eye turns back on itself vertically between two real moves. */
function smoothness(track: [number, number][][], floor = 0.15) {
  let step = 0;
  let flips = 0;
  for (let i = 1; i < track.length; i++)
    for (let e = 0; e < 2; e++) {
      const [x0, y0] = track[i - 1]![e]!;
      const [x1, y1] = track[i]![e]!;
      step = Math.max(step, Math.hypot(x1 - x0, y1 - y0));
      if (i < 2) continue;
      const v0 = y0 - track[i - 2]![e]![1];
      const v1 = y1 - y0;
      if (Math.abs(v0) > floor && Math.abs(v1) > floor && Math.sign(v0) !== Math.sign(v1)) flips++;
    }
  return { step, flips };
}

describe("the eyes glide", () => {
  test("at rest they hold still between blinks", () => {
    for (const seed of SEEDS) {
      const { doc, svg } = mount(seed);
      const { out } = record(doc, svg, 0, 3);
      for (const f of out) expect(f).toEqual(out[0]!);
    }
  });

  test("an expression change eases in and out, with no jump and no flick", () => {
    for (const seed of SEEDS) {
      const { doc, svg, handle } = mount(seed);
      let ms = record(doc, svg, 0, 0.5).ms;
      for (const name of ["surprised", "scared", "sleepy", "mad", "happy", "love", null]) {
        handle.setExpression(name);
        const r = record(doc, svg, ms, 0.8);
        ms = r.ms;
        const { step, flips } = smoothness(r.out);
        expect(step, `${seed} ${name}`).toBeLessThan(1.2);
        expect(flips, `${seed} ${name}`).toBe(0);
      }
    }
  });

  test("states hand the eyes over without a flick", () => {
    for (const seed of SEEDS) {
      for (const id of ["wander", "wink", "wide", "notify", "play", "swirl", "orbit"]) {
        const { doc, svg, handle } = mount(seed);
        handle.play(id);
        const { step, flips } = smoothness(record(doc, svg, 0, 4).out, 0.6);
        expect(step, `${seed} ${id}`).toBeLessThan(5);
        expect(flips, `${seed} ${id}`).toBe(0);
      }
    }
  });

  test("wander drifts the head slowly, a fraction of a unit a frame", () => {
    for (const seed of SEEDS) {
      const { doc, svg, handle } = mount(seed);
      handle.loop("wander");
      const ms = record(doc, svg, 0, 1).ms;
      const { out } = record(doc, svg, ms, 6);
      const { step, flips } = smoothness(out);
      expect(step, seed).toBeLessThan(0.6);
      expect(flips, seed).toBe(0);
      const xs = out.map((f) => f[0]![0]);
      expect(Math.max(...xs) - Math.min(...xs), seed).toBeGreaterThan(1);
    }
  });
});

describe("the eyes follow", () => {
  /** Where the left eye sits with the pointer held at `(x, y)`, after it has arrived. */
  function looking(seed: string, expression: string | null, x: number, y: number) {
    const { doc, svg, handle } = mount(seed);
    if (expression) handle.setExpression(expression);
    handle.follow();
    frame(doc, 16);
    doc.defaultView.fire("pointermove", { clientX: x, clientY: y, pointerType: "mouse" });
    record(doc, svg, 16, 1.5);
    return centres(svg)[0]!;
  }

  test("across the face, sideways and down, on every seed, large eyes included", () => {
    for (const seed of SEEDS) {
      const R = _layout(seed).body.rx;
      for (const expression of [null, "surprised", "scared", "love"]) {
        const left = looking(seed, expression, -2000, 50);
        const right = looking(seed, expression, 2000, 50);
        const up = looking(seed, expression, 50, -2000);
        const down = looking(seed, expression, 50, 2000);
        expect(right[0] - left[0], `${seed} ${expression}`).toBeGreaterThan(0.35 * R);
        expect(down[1] - up[1], `${seed} ${expression}`).toBeGreaterThan(0.25 * R);
      }
    }
  });

  test("a sweeping pointer is trailed smoothly", () => {
    for (const seed of SEEDS) {
      const { doc, svg, handle } = mount(seed);
      handle.follow();
      frame(doc, 16);
      const { out } = record(doc, svg, 16, 3, (ms) => {
        const a = ms / 600;
        doc.defaultView.fire("pointermove", { clientX: 50 + 300 * Math.cos(a), clientY: 50 + 300 * Math.sin(0.7 * a), pointerType: "mouse" });
      });
      const { step, flips } = smoothness(out.slice(10), 0.4);
      expect(step, seed).toBeLessThan(2);
      expect(flips, seed).toBe(0);
    }
  });
});
