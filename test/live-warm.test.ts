// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mountLive } from "../src/live/mount";
import { FakeDocument, type FakeElement, frame, makeSvg, run } from "./live-dom";

type Idle = (d: { timeRemaining(): number; didTimeout: boolean }) => void;

/** A window with idle callbacks the test flushes by hand, one slice at a time. */
function idleDoc() {
  const doc = new FakeDocument();
  const idle: Idle[] = [];
  const view = doc.defaultView as FakeDocument["defaultView"] & { requestIdleCallback?: (cb: Idle) => number };
  view.requestIdleCallback = (cb) => idle.push(cb);
  const flush = (ms = 50) => {
    const due = idle.splice(0);
    for (const cb of due) cb({ timeRemaining: () => ms, didTimeout: false });
    return due.length;
  };
  return { doc, idle, flush };
}

const TRIG = ["cos", "sin", "atan2", "hypot", "sqrt"] as const;
const real = Object.fromEntries(TRIG.map((k) => [k, Math[k]])) as Record<(typeof TRIG)[number], (...a: number[]) => number>;
let calls = 0;

beforeEach(() => {
  calls = 0;
  for (const k of TRIG) (Math as unknown as Record<string, unknown>)[k] = (...a: number[]) => (calls++, real[k](...a));
});

afterEach(() => {
  for (const k of TRIG) (Math as unknown as Record<string, unknown>)[k] = real[k];
});

const rigs = (svg: FakeElement) => svg.querySelectorAll(".mo-eye").map((e) => [...e.children[0]!.children[0]!.attrs.entries()].join(";"));

describe("outline tables are warmed off the mount path", () => {
  // Two tables of 1440 rays cost a cos and a sin per ray; the ray loop itself is trig-free.
  const TABLES = 2 * 1440 * 2;

  test("a mount at rest does no ray work; the idle slice does it; a turn after that reads tables", () => {
    const { doc, flush } = idleDoc();
    const svg = makeSvg(doc);
    const handle = mountLive(svg as unknown as SVGSVGElement, "warm-seed");
    handle.loop("idle");
    run(doc, 0, 2);
    const atMount = calls;
    expect(atMount).toBeLessThan(TABLES / 2);
    expect(flush()).toBe(1);
    const warmed = calls - atMount;
    expect(warmed).toBeGreaterThanOrEqual(TABLES);
    const before = rigs(svg);
    handle.play("wide");
    run(doc, 2000, 0.3);
    const turnWarm = calls - atMount - warmed;
    const turned = rigs(svg);
    expect(turned).not.toEqual(before);
    handle.destroy();

    const cold = idleDoc();
    const other = makeSvg(cold.doc);
    const hc = mountLive(other as unknown as SVGSVGElement, "warm-seed");
    hc.loop("idle");
    run(cold.doc, 0, 2);
    const coldMount = calls;
    hc.play("wide");
    run(cold.doc, 2000, 0.3);
    expect(calls - coldMount - turnWarm).toBeGreaterThanOrEqual(TABLES);
    expect(rigs(other)).toEqual(turned);
    hc.destroy();
  });

  test("a crowd shares one queue and each idle slice builds as many as its budget allows", () => {
    const { doc, idle, flush } = idleDoc();
    const handles = Array.from({ length: 6 }, (_, i) => mountLive(makeSvg(doc) as unknown as SVGSVGElement, `crowd-${i}`));
    expect(idle.length).toBe(1);
    expect(flush(0)).toBe(1);
    const one = calls;
    expect(idle.length).toBe(1);
    expect(flush(50)).toBe(1);
    expect(calls).toBeGreaterThan(one * 4);
    expect(idle.length).toBe(0);
    handles.forEach((h) => h.destroy());
  });

  test("a turn before the tables exist takes the exact path and lands where a warmed instance does", () => {
    const warm = idleDoc();
    const cold = idleDoc();
    const a = makeSvg(warm.doc);
    const b = makeSvg(cold.doc);
    const ha = mountLive(a as unknown as SVGSVGElement, "exact-seed");
    const hb = mountLive(b as unknown as SVGSVGElement, "exact-seed");
    warm.flush();
    for (const [doc, h] of [
      [warm.doc, ha],
      [cold.doc, hb],
    ] as const) {
      h.play("wide");
      frame(doc, 16);
      frame(doc, 400);
    }
    expect(rigs(b)).toEqual(rigs(a));
    cold.flush();
    expect(rigs(b)).toEqual(rigs(a));
    ha.destroy();
    hb.destroy();
  });

  test("destroy before the slice drops the job", () => {
    const { doc, flush } = idleDoc();
    const handle = mountLive(makeSvg(doc) as unknown as SVGSVGElement, "gone-seed");
    handle.destroy();
    const before = calls;
    flush();
    expect(calls - before).toBeLessThan(10);
  });

  test("the rest frame a cold mount writes is the seeded one, and warming rewrites nothing", () => {
    const { doc, flush } = idleDoc();
    const svg = makeSvg(doc);
    const handle = mountLive(svg as unknown as SVGSVGElement, "seated-seed");
    const seated = rigs(svg);
    flush();
    expect(rigs(svg)).toEqual(seated);
    handle.destroy();
  });
});
