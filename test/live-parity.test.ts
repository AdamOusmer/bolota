import { afterAll, describe, expect, test } from "bun:test";

import { _layout } from "../src/bolota";
import { actTransform, type Act } from "../src/live/act";
import { CHOREO } from "../src/live/choreo";
import { HOLD, Timeline } from "../src/live/timeline";
import { ACTS, HOLD as FROZEN_HOLD } from "./fixtures/parity-acts";
import { CATALOG, POINTS } from "./fixtures/parity-catalog";
import { IDS, Rig, SCENARIOS } from "./live-parity-scenarios";

/**
 * The live timeline against the engine it replaced, frame by frame.
 *
 * The reference is frozen in `fixtures/parity-acts.ts`: the old engine's
 * composed pose (what its `sample` blended before it added idle life, so
 * liveliness is out on both sides) read for the scenarios in
 * `live-parity-scenarios.ts`. The pose's silhouette was the seed's profile
 * scaled, so the act's `s` was the ratio to the seed, checked to be uniform
 * when the fixture was made. The scenarios drive the timeline through the
 * same clock, and each checked frame is compared to the next fixture row.
 */
const TOL = 1e-9;

type Body = Omit<Act, "upright">;
const FIELDS: (keyof Body)[] = ["x", "y", "rot", "s", "sx", "sy", "eyeAlpha"];
let worst = 0;
let frames = 0;

function runScenario(name: string, seed: string, run: (rig: Rig) => void) {
  const want = ACTS[name];
  if (!want) throw new Error(`no frozen frames for ${name}`);
  let row = 0;
  const rig: Rig = new Rig({
    play() {},
    frame() {},
    check(clock) {
      const got = rig.tl.sample(clock);
      FIELDS.forEach((k, i) => {
        const ref = want[row * FIELDS.length + i];
        if (ref === undefined) throw new Error(`${name}: the fixture ends before t=${clock}`);
        const raw = got[k] - ref;
        const d = k === "rot" ? Math.abs(raw - 360 * Math.round(raw / 360)) : Math.abs(raw);
        if (d > worst) worst = d;
        if (d > TOL) throw new Error(`${name}, ${seed}, ${k} at t=${clock}: timeline ${got[k]}, engine ${ref}`);
      });
      row++;
      frames++;
    },
  });
  run(rig);
  expect(row * FIELDS.length).toBe(want.length);
}

const nil = (v: unknown) => v ?? null;

describe("live choreography", () => {
  test("covers the bloub catalog with the same timing and flags", () => {
    expect(Object.keys(CHOREO).sort()).toEqual(Object.keys(CATALOG).sort());
    expect(HOLD).toBe(FROZEN_HOLD);
    for (const id of IDS) {
      const c = CHOREO[id];
      const got = [
        c.duration,
        c.minDuration,
        c.morph,
        c.period,
        c.fill,
        c.blinkIn,
        c.baseBody,
        c.baseFace,
        !!c.acceptsExpression,
        !!c.ownsLiveliness,
        c.still,
      ].map(nil);
      expect([id, ...got]).toEqual([id, ...CATALOG[id]!.map(nil)]);
    }
  });

  test("actTransform puts the static body where bloub draws the posed one", () => {
    const { body } = _layout("parity-a");
    for (const id of IDS) {
      for (const t of [0, 0.37, 1.1, 2.05]) {
        const m = parseTransform(actTransform(CHOREO[id].act(t), body.rx, body.cx, body.cy));
        for (const [px, py, wx, wy] of POINTS[`${id}@${t}`]!) {
          const [gx, gy] = apply(m, px!, py!);
          // r3 rounds the scale to 1e-3, which moves a point up to ~0.03 units
          // at the rim of a 40-unit body.
          expect(Math.abs(gx - wx!)).toBeLessThan(0.05);
          expect(Math.abs(gy - wy!)).toBeLessThan(0.05);
        }
      }
    }
  });
});

describe("live timeline matches the old engine", () => {
  afterAll(() => {
    console.log(`live parity: ${frames} frames, worst field error ${worst.toExponential(2)}`);
  });

  test("every frozen scenario has a test", () => {
    expect(Object.keys(ACTS).sort()).toEqual(SCENARIOS.map((s) => s.name).sort());
  });

  for (const s of SCENARIOS) test(s.name, () => runScenario(s.name, s.seed, s.run));

  test("sample is pure: rereading the past gives the same act", () => {
    const tl = new Timeline();
    tl.play("orbit", 0, { loop: true });
    tl.play("burst", 0.3);
    tl.play("comet", 0.35);
    const ts = Array.from({ length: 200 }, (_, i) => i * 0.031);
    const first = ts.map((t) => tl.sample(t));
    const again = [...ts].reverse().map((t) => tl.sample(t)).reverse();
    expect(again).toEqual(first);
    expect(() => tl.play("idle", 0.2)).toThrow(RangeError);
  });
});

describe("corrected from the old engine", () => {
  test("an outgoing state keeps its own looping through the fade", () => {
    const tl = new Timeline();
    tl.loop("orbit", 0);
    tl.play("burst", 5);
    const period = CHOREO.orbit.period!;
    expect(tl.sample(5).rot).toBeCloseTo(CHOREO.orbit.act(5 % period).rot, 9);
    expect(tl.eyes(5).pose).toEqual(CHOREO.orbit.eyes(5 % period).pose);
  });

  test("a hand-back to a looped rest keeps it looping", () => {
    const tl = new Timeline();
    tl.loop("thinking", 0);
    tl.play("exclaim", 1, { hold: 0 });
    const back = 1 + CHOREO.exclaim.duration;
    expect(tl.state(back + 0.01)).toBe("thinking");
    const restart = CHOREO.thinking.duration + CHOREO.thinking.morph;
    expect(tl.next(back + 0.01)).toBeCloseTo(back + restart, 9);
    const later = back + restart * 3 + 0.3;
    expect(tl.state(later)).toBe("thinking");
    expect(tl.sample(later)).toEqual(CHOREO.thinking.act(0.3));
  });

  test("a one-shot rest stays a one-shot after a hand-back", () => {
    const tl = new Timeline();
    tl.play("exclaim", 1, { hold: 0 });
    expect(tl.next(1 + CHOREO.exclaim.duration + 0.01)).toBe(Infinity);
  });

  test("replaying the current state restarts it from what is on screen", () => {
    const tl = new Timeline();
    tl.play("thinking", 0);
    const shown = tl.sample(1.5);
    tl.play("thinking", 1.5);
    expect(tl.sample(1.5)).toEqual(shown);
    const after = 1.5 + CHOREO.thinking.morph + 0.2;
    expect(tl.sample(after)).toEqual(CHOREO.thinking.act(CHOREO.thinking.morph + 0.2));
  });
});

type M = [number, number, number, number, number, number];

function mul([a, b, c, d, e, f]: M, [g, h, i, j, k, l]: M): M {
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

function parseTransform(s: string): M {
  let m: M = [1, 0, 0, 1, 0, 0];
  for (const [, fn, args] of s.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const [p = 0, q] = args!.trim().split(/[\s,]+/).map(Number);
    if (fn === "translate") m = mul(m, [1, 0, 0, 1, p, q ?? 0]);
    else if (fn === "scale") m = mul(m, [p, 0, 0, q ?? p, 0, 0]);
    else if (fn === "rotate") {
      const r = (p * Math.PI) / 180;
      m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
    } else throw new Error(`unexpected ${fn}`);
  }
  return m;
}

function apply([a, b, c, d, e, f]: M, x: number, y: number): [number, number] {
  return [a * x + c * y + e, b * x + d * y + f];
}
