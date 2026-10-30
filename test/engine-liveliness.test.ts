// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { actOf, drain, eyeAttrs, frame, mounted } from "./engine-dom";
import { CHOREO } from "../src/live/choreo";

const opacity = (svg: Svg) => svg.querySelector(".mo-eyes")!.getAttribute("opacity");
type Svg = ReturnType<typeof mounted>["svg"];
const look = (svg: Svg) => `${actOf(svg)}|${eyeAttrs(svg).join("|")}|${opacity(svg)}`;
const turn = (d: number) => Math.min(d % 360, 360 - (d % 360));
const vector =(svg: Svg) => look(svg).match(/-?\d+\.?\d*/g)!.map(Number);

/** Steps 60 Hz frames for `seconds` from `from` ms, returning the end ms. */
function advance(doc: ReturnType<typeof mounted>["doc"], from: number, seconds: number) {
  let ms = from;
  const end = from + seconds * 1000;
  while (ms < end) frame(doc, (ms += 16));
  return ms;
}

describe("engine liveliness", () => {
  test("no clock at rest, none after a one-shot settles", () => {
    const { doc, handle } = mounted();
    expect(doc.defaultView.queue.length).toBe(0);
    handle.play("wide");
    expect(doc.defaultView.queue.length).toBe(1);
    expect(drain(doc, 0).drained).toBe(true);
  });

  test("every state moves the figure away from the resting face", () => {
    for (const state of Object.keys(CHOREO).filter((s) => s !== "idle")) {
      const { doc, svg, handle } = mounted();
      const rest = svg.outerHTML;
      handle.play(state, { loop: true });
      advance(doc, 0, 1.5);
      expect(svg.outerHTML, state).not.toBe(rest);
      handle.destroy();
    }
  });

  test("a looped periodic state re-arms past its own period and never parks", () => {
    for (const state of ["orbit", "wink"] as const) {
      const { doc, handle } = mounted();
      handle.loop(state);
      const span = CHOREO[state].period!;
      advance(doc, 0, span * 3 + 1);
      expect(doc.defaultView.queue.length, state).toBe(1);
    }
  });

  test("burst and comet collapse the eyes and grow them back", () => {
    for (const state of ["burst", "comet"] as const) {
      const { doc, svg, handle } = mounted();
      handle.play(state);
      let ms = 0;
      let lowest = 1;
      while (doc.defaultView.queue.length && ms < 20_000) {
        frame(doc, (ms += 16));
        lowest = Math.min(lowest, Number(opacity(svg) ?? 1));
      }
      expect(lowest, state).toBeLessThan(0.2);
      expect(opacity(svg), state).toBeNull();
    }
  });

  test("orbit and comet loops are seamless across their period", () => {
    for (const state of ["orbit", "comet"] as const) {
      const { doc, svg, handle } = mounted();
      handle.loop(state);
      const span = (CHOREO[state].period ?? CHOREO[state].duration) * 1000;
      const deltas: { at: number; d: number }[] = [];
      let prev = vector(svg);
      for (let ms = 16; ms <= span * 3.2; ms += 16) {
        frame(doc, ms);
        const v = vector(svg);
        deltas.push({ at: ms, d: Math.max(...v.map((n, i) => turn(Math.abs(n - (prev[i] ?? n))))) });
        prev = v;
      }
      const seam = (at: number) => Math.abs(((at + span / 2) % span) - span / 2) < 40;
      const body = Math.max(...deltas.filter((x) => x.at > span && !seam(x.at)).map((x) => x.d));
      const joins = Math.max(...deltas.filter((x) => x.at > span && seam(x.at)).map((x) => x.d));
      expect(joins, state).toBeLessThanOrEqual(body * 1.5 + 1e-6);
    }
  });

  test("a one-shot entrance hands back to the resting face without a jump", () => {
    const { doc, svg, handle } = mounted();
    const rest = look(svg);
    handle.play("wide");
    let ms = 0;
    let step = 0;
    let before = rest;
    while (doc.defaultView.queue.length && ms < 20_000) {
      frame(doc, (ms += 16));
      const now = look(svg);
      if (before !== now) step++;
      before = now;
    }
    expect(step).toBeGreaterThan(5);
    expect(look(svg)).toBe(rest);
  });

  test("hold keeps the finished pose longer before handing back", () => {
    const timed = (hold: number) => {
      const { doc, handle } = mounted();
      handle.play("wide", { hold });
      return drain(doc, 0).ms;
    };
    expect(timed(3)).toBeGreaterThan(timed(0) + 2000);
  });

  test("rest picks the state a one-shot settles into", () => {
    const { doc, handle } = mounted();
    handle.play("burst", { rest: "orbit" });
    const end = advance(doc, 0, 12);
    expect(doc.defaultView.queue.length).toBe(1);
    advance(doc, end, CHOREO.orbit.period! * 2);
    expect(doc.defaultView.queue.length).toBe(1);
  });

  test("a one-shot rests on whatever was looping before it", () => {
    const { doc, handle } = mounted();
    handle.loop("orbit");
    handle.play("burst");
    const end = advance(doc, 0, 12);
    expect(doc.defaultView.queue.length).toBe(1);
    advance(doc, end, 2);
    expect(doc.defaultView.queue.length).toBe(1);
  });

  test("for stretches a one-shot to fill the slot, and never truncates it", () => {
    const timed = (opts: { for?: number }) => {
      const { doc, handle } = mounted();
      handle.play("swirl", opts);
      return drain(doc, 0).ms;
    };
    const natural = timed({});
    expect(timed({ for: 6 })).toBeGreaterThan(natural + 2000);
    expect(timed({ for: 0.1 })).toBeLessThanOrEqual(natural + 100);
  });

  test("a periodic state keeps running to fill a longer window, then parks", () => {
    const { doc, handle } = mounted();
    handle.play("orbit", { for: 9 });
    advance(doc, 0, 8);
    expect(doc.defaultView.queue.length).toBe(1);
    expect(drain(doc, 8000).drained).toBe(true);
  });

  test("stop freezes the frame and play resumes it", () => {
    const { doc, svg, handle } = mounted();
    handle.loop("orbit");
    const end = advance(doc, 0, 1);
    handle.stop();
    const frozen = look(svg);
    advance(doc, end, 1);
    expect(look(svg)).toBe(frozen);
    expect(eyeAttrs(svg).length).toBe(2);
    handle.loop("orbit");
    advance(doc, end + 1000, 1.3);
    expect(look(svg)).not.toBe(frozen);
  });
});
