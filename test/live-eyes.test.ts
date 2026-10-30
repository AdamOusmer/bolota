// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { _layout } from "../src/bolota";
import { happy, mad } from "../src/expression";
import { CHOREO, ENTRANCE_BLINK, type StateId } from "../src/live/choreo";
import { Timeline } from "../src/live/timeline";
import { IDENT, bakePose } from "../src/morph";

const IDS = Object.keys(CHOREO) as StateId[];
const span = (id: StateId) => CHOREO[id].period ?? CHOREO[id].duration;
const times = (id: StateId) => Array.from({ length: 25 }, (_, i) => (i / 24) * span(id));

describe("per-state eyes", () => {
  test("every state's eyes cover every pose channel and stay finite", () => {
    const keys = Object.keys(IDENT).sort();
    for (const id of IDS)
      for (const t of times(id)) {
        const e = CHOREO[id].eyes(t);
        expect(Object.keys(e.pose).sort(), id).toEqual(keys);
        for (const v of [...Object.values(e.pose), e.track.x, e.track.y, e.alpha])
          expect(Number.isFinite(v), id).toBe(true);
      }
  });

  test("the eye opacity is the act's, so the two can never disagree", () => {
    for (const id of IDS)
      for (const t of times(id)) expect(CHOREO[id].eyes(t).alpha, `${id} @${t}`).toBeCloseTo(CHOREO[id].act(t).eyeAlpha, 12);
  });

  test("eyeless states are eyeless, and the resting face is the identity", () => {
    expect(CHOREO.thinking.eyes(1).alpha).toBe(0);
    expect(CHOREO.snooze.eyes(1).alpha).toBe(0);
    expect(CHOREO.idle.eyes(1).pose).toEqual(IDENT);
    expect(CHOREO.swirl.eyes(0.5).track).toEqual({ x: 0, y: 0 });
  });

  test("wink closes one eye only, and opens it again", () => {
    const open = CHOREO.wink.eyes(0).pose;
    const shut = CHOREO.wink.eyes(0.2).pose;
    expect(open.esy2).toBeCloseTo(0, 12);
    expect(open.esy + shut.esy2).toBeLessThan(0.3);
    expect(shut.esy).toBe(open.esy);
    expect(CHOREO.wink.eyes(0.6).pose.esy2).toBeCloseTo(0, 12);
  });

  test("notify looks away and orbit's gaze jostles round a full turn", () => {
    expect(CHOREO.notify.eyes(1).track.x).toBeLessThan(-0.4);
    const xs = times("orbit").map((t) => CHOREO.orbit.eyes(t).track.x);
    expect(Math.min(...xs)).toBeLessThan(-0.3);
    expect(Math.max(...xs)).toBeGreaterThan(0.3);
  });

  test("no state fuses the seeded eyes or pushes them off the body", () => {
    const reach = (e: { rx: number; ry: number; rot: number }) => {
      const t = (e.rot * Math.PI) / 180;
      return Math.abs(e.rx * Math.cos(t)) + Math.abs(e.ry * Math.sin(t));
    };
    const layouts = Array.from({ length: 600 }, (_, i) => _layout(`seed-${i}`));
    for (const id of IDS)
      for (const t of times(id).filter((_, i) => i % 4 === 0)) {
        const p = CHOREO[id].eyes(t).pose;
        for (const l of layouts) {
          const [a, b] = bakePose(l, p).l.eyes as { cx: number; cy: number; rx: number; ry: number; rot: number }[];
          expect(Math.abs(b!.cx - a!.cx) - reach(a!) - reach(b!), id).toBeGreaterThan(0);
          for (const e of [a!, b!])
            expect(Math.abs(e.cx - l.body.cx) + reach(e), id).toBeLessThan(l.body.rx * 1.12);
        }
      }
  });
});

describe("timeline eyes", () => {
  test("an expression shows through the resting face, after its glide", () => {
    const tl = new Timeline("idle");
    tl.express(happy.p, 1);
    expect(tl.eyes(1).pose).toEqual(IDENT);
    expect(tl.eyes(1.3).pose.esy).toBeLessThan(1);
    expect(tl.eyes(2).pose).toEqual(happy.p);
    expect(tl.sample(2)).toEqual(tl.sample(0.5));
  });

  test("a state with its own face ignores the expression; one that accepts it shows it", () => {
    const tl = new Timeline("idle");
    tl.express(mad.p, 0);
    tl.play("notify", 1);
    expect(tl.eyes(2).pose).toEqual(CHOREO.notify.eyes(1).pose);
    tl.play("play", 3);
    expect(tl.eyes(4).pose).toEqual(mad.p);
    expect(tl.eyes(4).track).toEqual({ x: 0, y: 0 });
  });

  test("a blinkIn entrance is masked by a blink, then the state's own eyes", () => {
    const tl = new Timeline("idle");
    tl.play("wide", 1);
    expect(tl.eyes(1 + ENTRANCE_BLINK / 2).pose.esy).toBeLessThan(0.1);
    expect(tl.eyes(1 + 1).pose).toEqual(CHOREO.wide.eyes(1).pose);
  });

  test("an interrupted fade starts the next from what was on screen", () => {
    const tl = new Timeline("idle");
    tl.play("notify", 1);
    const mid = tl.eyes(1.25);
    tl.play("idle", 1.25);
    expect(tl.eyes(1.25)).toEqual(mid);
  });

  test("a one-shot hands the eyes back to the rest state", () => {
    const tl = new Timeline("idle");
    tl.play("wink", 0);
    expect(tl.eyes(10).pose).toEqual(IDENT);
  });
});
