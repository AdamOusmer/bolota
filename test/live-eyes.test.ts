// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { _layout } from "../src/bolota";
import { happy, mad } from "../src/expression";
import { actTransform, type Act } from "../src/live/act";
import { CHOREO, ENTRANCE_BLINK, type StateId } from "../src/live/choreo";
import { Timeline } from "../src/live/timeline";
import { uprightTransform } from "../src/live/upright";
import { ballEdge, ballRadius } from "../src/live/outline";
import { faceEyes } from "../src/live/rig";
import { IDENT } from "../src/morph";

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

  test("notify looks away and orbit's head jostles round a full turn", () => {
    expect(CHOREO.notify.eyes(1).head.yaw).toBeLessThan(-20);
    const hs = times("orbit").map((t) => CHOREO.orbit.eyes(t).head);
    expect(Math.min(...hs.map((h) => h.yaw))).toBeLessThan(-12);
    expect(Math.max(...hs.map((h) => h.yaw))).toBeGreaterThan(12);
    expect(Math.max(...hs.map((h) => Math.abs(h.roll)))).toBeGreaterThan(4);
  });

  test("a head roll lifts one eye over the other, a turn narrows the far eye", () => {
    const l = _layout("seed-7");
    const level = (id: StateId) => {
      const [a, b] = faceEyes(l, CHOREO[id].eyes(1));
      return { drop: b!.cy - a!.cy, width: b!.rx / a!.rx, slide: (a!.cx + b!.cx) / 2 - l.face.cx };
    };
    expect(level("wide").drop).toBeGreaterThan(2);
    expect(level("notify").drop).toBeLessThan(-2);
    expect(level("notify").width).toBeGreaterThan(1.1);
    expect(level("notify").slide).toBeLessThan(-5);
    expect(level("play").width).toBeLessThan(0.95);
  });

  test("a state's own face is bloub's eye on the seed's head, the resting face the seed's", () => {
    for (const seed of ["seed-7", "seed-2525", "alain", "seed-31"]) {
      const l = _layout(seed);
      const R = l.body.sides ? ballRadius(l) : l.body.rx;
      const [a, b] = faceEyes(l, { ...CHOREO.wide.eyes(1), head: { roll: 0, yaw: 0, spread: 0 } });
      const tilt = Math.cos((15.46 * Math.PI) / 180);
      expect(a!.rx * 2).toBeCloseTo(0.356 * R * tilt, 6);
      expect(a!.ry * 2).toBeCloseTo(0.875 * R, 6);
      const half = Math.sin((15.46 * Math.PI) / 180) * R;
      expect(b!.cx - l.body.cx).toBeCloseTo(half * (ballEdge(l, 0) / R), 6);
      expect(faceEyes(l, CHOREO.idle.eyes(1))).toEqual(l.eyes.map(({ cx, cy, rx, ry, rot }) => ({ cx, cy, rx, ry, rot })));
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

  test("a blinkIn entrance cues the blink, and the eyes carry no lid of their own", () => {
    const tl = new Timeline("idle");
    tl.play("wide", 1);
    expect(tl.blinkCue(0.99, 1)).toBe(1);
    expect(tl.blinkCue(1, 1 + ENTRANCE_BLINK)).toBeNull();
    expect(tl.eyes(1 + 1).pose).toEqual(CHOREO.wide.eyes(1).pose);
    tl.play("alert", 3);
    expect(tl.blinkCue(2.99, 3)).toBeNull();
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
    expect(tl.eyes(11).pose).toEqual(IDENT);
  });
});

type Matrix = [number, number, number, number, number, number];
const mul = ([a, b, c, d, e, f]: Matrix, [A, B, C, D, E, F]: Matrix): Matrix => [
  a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f,
];

/** An SVG transform list of `translate`, `scale` and `rotate` as one matrix. */
function matrix(list: string): Matrix {
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  for (const [, op, args] of list.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const [x, y] = args!.trim().split(/[\s,]+/).map(Number) as [number, number];
    const r = (x * Math.PI) / 180;
    const step: Matrix =
      op === "translate" ? [1, 0, 0, 1, x, y]
      : op === "scale" ? [x, 0, 0, y, 0, 0]
      : [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
    m = mul(m, step);
  }
  return m;
}

describe("upright face", () => {
  const R = 33, CX = 50, CY = 50;

  test("only orbit lifts its face off the spin, and only while it plays", () => {
    for (const id of IDS)
      for (const t of times(id)) expect(CHOREO[id].act(t).upright, `${id} @${t}`).toBe(id === "orbit" ? 1 : 0);
    expect(CHOREO.orbit.baseFace || CHOREO.orbit.acceptsExpression).toBeFalsy();
  });

  test("orbit's and play's eyes keep level axes and a uniform scale", () => {
    for (const id of ["orbit", "play"] as const)
      for (let i = 0; i <= 96; i++) {
        const act = CHOREO[id].act((i / 96) * span(id));
        const [a, b, c, d] = mul(matrix(actTransform(act, R, CX, CY)), matrix(uprightTransform(act, CX, CY)));
        expect(Math.abs(b) + Math.abs(c), `${id} #${i}`).toBeLessThan(2e-3);
        expect(a, `${id} #${i}`).toBeCloseTo(act.s, 2);
        expect(d, `${id} #${i}`).toBeCloseTo(act.s, 2);
      }
    expect(uprightTransform(CHOREO.play.act(1), CX, CY)).toBe("");
  });

  test("the face turns with the body only by what the blend has not yet unwound", () => {
    const tl = new Timeline("idle");
    tl.play("orbit", 1);
    tl.play("idle", 3);
    for (let now = 0.5; now < 5; now += 0.01) {
      const act: Act = tl.sample(now);
      const [a, b] = mul(matrix(actTransform(act, R, CX, CY)), matrix(uprightTransform(act, CX, CY)));
      const turn = (Math.atan2(b, a) * 180) / Math.PI;
      const want = (((act.rot * (1 - act.upright)) % 360) + 540) % 360 - 180;
      expect(Math.abs(turn - want), `@${now}`).toBeLessThan(0.05);
    }
    expect(tl.sample(5).upright).toBe(0);
  });

  test("orbit never squashes, so a level face sees the outline only turned", () => {
    for (let i = 0; i <= 96; i++) {
      const act = CHOREO.orbit.act((i / 96) * span("orbit"));
      expect([act.sx, act.sy]).toEqual([1, 1]);
    }
  });
});
