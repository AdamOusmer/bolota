// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { _layout } from "../src/bolota";
import { radiusAtAngle } from "../src/bloub/shape";
import { _seededSilhouette } from "../src/engine";
import * as roster from "../src/expression";
import { happy, mad } from "../src/expression";
import { actTransform, type Act } from "../src/live/act";
import { CHOREO, ENTRANCE_BLINK, type StateId } from "../src/live/choreo";
import { Timeline } from "../src/live/timeline";
import { uprightFit, uprightTransform } from "../src/live/upright";
import { IDENT, bakePose, type Pose } from "../src/morph";

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
  const ROSTER = Object.values(roster).flatMap((e) => (typeof e === "object" && "p" in e ? [e.p] : []));
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
        const k = id === "orbit" ? 0.8 : 1;
        const [a, b, c, d] = mul(matrix(actTransform(act, R, CX, CY)), matrix(uprightTransform(act, k, CX, CY)));
        expect(Math.abs(b) + Math.abs(c), `${id} #${i}`).toBeLessThan(2e-3);
        expect(a, `${id} #${i}`).toBeCloseTo(act.s * k, 2);
        expect(d, `${id} #${i}`).toBeCloseTo(act.s * k, 2);
      }
    expect(uprightTransform(CHOREO.play.act(1), 0.8, CX, CY)).toBe("");
  });

  test("the face turns with the body only by what the blend has not yet unwound", () => {
    const tl = new Timeline("idle");
    tl.play("orbit", 1);
    tl.play("idle", 3);
    for (let now = 0.5; now < 5; now += 0.01) {
      const act: Act = tl.sample(now);
      const [a, b] = mul(matrix(actTransform(act, R, CX, CY)), matrix(uprightTransform(act, 1, CX, CY)));
      const turn = (Math.atan2(b, a) * 180) / Math.PI;
      const want = (((act.rot * (1 - act.upright)) % 360) + 540) % 360 - 180;
      expect(Math.abs(turn - want), `@${now}`).toBeLessThan(0.05);
    }
    expect(tl.sample(5).upright).toBe(0);
  });

  test("a level face stays inside the spinning outline and never fuses", () => {
    const MARGIN = 0.03;
    const frames: { pose: Pose; act: Act }[] = [];
    for (let i = 0; i < 96; i++) {
      const t = (i / 96) * span("orbit");
      frames.push({ pose: CHOREO.orbit.eyes(t).pose, act: CHOREO.orbit.act(t) });
    }
    for (const pose of [CHOREO.play.eyes(0).pose, ...ROSTER])
      for (let i = 0; i < 8; i++) frames.push({ pose, act: CHOREO.play.act((i / 8) * span("play")) });
    let worst = Infinity;
    for (let s = 0; s < 1000; s++) {
      const l = _layout(`seed-${s}`);
      const { body } = l;
      const sil = _seededSilhouette(body, l.draw, l.petals, l.extra);
      const fit = uprightFit(l);
      expect(fit).toBeGreaterThan(0.5);
      expect(fit).toBeLessThanOrEqual(1);
      for (const { pose, act } of frames) {
        const { rot } = act;
        const k = act.upright ? fit : 1;
        const eyes = bakePose(l, pose).l.eyes;
        const r = (-rot * Math.PI) / 180;
        const cos = Math.cos(r), sin = Math.sin(r);
        for (const e of eyes) {
          const t = (e.rot * Math.PI) / 180;
          for (const [u, v] of [[e.rx, e.ry], [e.rx, -e.ry], [-e.rx, e.ry], [-e.rx, -e.ry]] as const) {
            const px = k * (e.cx + u * Math.cos(t) - v * Math.sin(t) - body.cx);
            const py = k * (e.cy + u * Math.sin(t) + v * Math.cos(t) - body.cy);
            const qx = px * cos - py * sin, qy = px * sin + py * cos;
            const slack = (radiusAtAngle(sil, Math.atan2(qy, qx)) * body.rx - Math.hypot(qx, qy)) / body.rx;
            if (slack < worst) worst = slack;
            expect(slack, `seed-${s} rot ${rot}`).toBeGreaterThan(MARGIN);
          }
        }
        const [a, b] = eyes as { cx: number; rx: number; ry: number; rot: number }[];
        const reach = (e: { rx: number; ry: number; rot: number }) => {
          const t = (e.rot * Math.PI) / 180;
          return Math.abs(e.rx * Math.cos(t)) + Math.abs(e.ry * Math.sin(t));
        };
        expect(k * (Math.abs(b!.cx - a!.cx) - reach(a!) - reach(b!)), `seed-${s}`).toBeGreaterThan(0);
      }
    }
    console.log(`upright worst slack ${worst.toFixed(4)} R`);
  }, 120_000);
});
