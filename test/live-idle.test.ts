// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { motionSeeds, motionVars } from "../src/animate";
import { EASE_IN_OUT } from "../src/ease";
import { BLINKS, BLINK_CYCLE, BLINK_DUR, BLINK_SHUT, BREATH, BREATH_MS, MAX_PITCH_DRIFT, MAX_YAW_DRIFT, headFrame, loopNoise, turnHead, wander } from "../src/live/head";
import { idleDrift, idleFrame, idleLoops, idleShake } from "../src/live/idle";
import { mountLive } from "../src/live/mount";
import { traits } from "../src/traits";
import { FakeDocument, FakeElement, makeSvg, run } from "./live-dom";

const css = readFileSync(new URL("../src/motion.css", import.meta.url), "utf8");

function block(name: string): string {
  const at = css.indexOf(`@keyframes ${name} {`);
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(css.indexOf("{", at) + 1, i);
  }
  throw new Error(name);
}

/** Top-level arguments of the call that opens at `s[from]`'s `(`. */
function args(s: string, from: number): { list: string[]; end: number } {
  const list: string[] = [];
  let depth = 0;
  let start = from + 1;
  for (let i = from; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) {
      list.push(s.slice(start, i).trim());
      return { list, end: i };
    } else if (s[i] === "," && depth === 1) {
      list.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  throw new Error(s);
}

const call = (decl: string, fn: string) => {
  const at = decl.indexOf(`${fn}(`);
  return at < 0 ? null : args(decl, at + fn.length).list;
};

type Vars = Record<string, number>;

function calc(expr: string, v: Vars): number {
  const flat = expr
    .replace(/var\(--([\w-]+),\s*([\d.]+)\)/g, (_, n, d) => String(v[n] ?? d))
    .replace(/var\(--([\w-]+)\)/g, (_, n) => String(v[n]))
    .replace(/calc/g, "")
    .replace(/(px|deg)\b/g, "");
  return Function(`return (${flat})`)() as number;
}

interface Stop {
  at: number[];
  values: (v: Vars) => number[];
}

/** `@keyframes name` as stops: every percentage of every selector list, with its declared function args. */
function stopsOf(name: string, fns: string[]): Stop[] {
  const out: Stop[] = [];
  for (const m of block(name).matchAll(/([\d.%,\s]+)\{([^}]*)\}/g)) {
    const decl = m[2]!.replace(/^\s*transform:/, "");
    const lists = fns.map((fn) => call(decl, fn)!);
    const at = m[1]!.split(",").map((p) => parseFloat(p) / 100);
    out.push({ at, values: (v) => lists.flat().map((a) => calc(a, v)) });
  }
  return out;
}

/** Linear sampling of CSS stops: held across a pair of positions, then moving to the next stop. */
function sample(stops: Stop[], u: number, v: Vars): number[] {
  const pts = stops.flatMap((s) => s.at.map((p) => [p, s.values(v)] as const)).sort((a, b) => a[0] - b[0]);
  for (let i = pts.length - 1; i >= 0; i--) {
    const [p, a] = pts[i]!;
    if (u < p) continue;
    const next = pts[i + 1];
    if (!next) return a;
    return a.map((x, k) => x + (next[1][k]! - x) * ((u - p) / (next[0] - p || 1)));
  }
  return pts[0]![1];
}

const SEEDS = ["a", "alain", "user-7", "user-8191", "seed-x", "zeta-41", "q", "user-123456"];
const num = (s: string) => parseFloat(s);

describe("seeds", () => {
  test("motionSeeds is what motionVars emits", () => {
    for (const s of SEEDS) {
      const t = traits(s, true);
      const v = motionVars(t);
      const n = motionSeeds(t);
      expect(-num(v["--mo-phase"]!)).toBe(n.phase);
      expect(-num(v["--mo-bob-phase"]!)).toBe(n.bobPhase);
      expect(num(v["--mo-blink"]!)).toBe(n.blink);
      expect(-num(v["--mo-blink-phase"]!)).toBe(n.blinkPhase);
      expect(num(v["--mo-saccade"]!)).toBe(n.saccade);
      expect(-num(v["--mo-saccade-phase"]!)).toBe(n.saccadePhase);
      expect(num(v["--mo-look-x"]!)).toBe(n.lookX);
      expect(num(v["--mo-look-y"]!)).toBe(n.lookY);
      expect(num(v["--mo-look-mx"]!)).toBe(n.lookMX);
      expect(num(v["--mo-look-my"]!)).toBe(n.lookMY);
    }
  });
});

describe("the engine's rest loops match motion.css", () => {
  const f = idleFrame();
  const shake = stopsOf("mo-shake", ["translate"]);

  test("breath: bloub's height, half a percent each way over 3.4s, eased as the stylesheet eases it", () => {
    const kf = block("mo-live-breathe");
    expect(/from\s*\{\s*transform: scale\(1, calc\(1 - 0\.005 \* var\(--mo-amp\)\)\)/.test(kf)).toBe(true);
    expect(/to\s*\{\s*transform: scale\(1, calc\(1 \+ 0\.005 \* var\(--mo-amp\)\)\)/.test(kf)).toBe(true);
    expect(/svg\[data-mo-live\] \.mo-breathe \{[^}]*animation-duration: calc\(1700ms[^}]*alternate[^}]*ease-in-out/.test(css)).toBe(true);
    expect(BREATH_MS).toBe(3400);
    expect(BREATH).toBe(0.005);
    for (let t = 0; t < 8000; t += 37) {
      idleLoops(t, 0, 1, f);
      const u = t / 1700;
      const k = Math.floor(u);
      const e = EASE_IN_OUT(k % 2 ? 1 - (u - k) : u - k);
      expect(f.breathe).toBeCloseTo(0.995 + 0.01 * e, 9);
    }
    idleLoops(1234, 0, 0, f);
    expect(f.breathe).toBe(1);
  });

  test("blink: bloub's schedule, one cycle the stylesheet repeats, closing to 6%", () => {
    const stops = stopsOf("mo-live-blink", ["scale"]);
    expect(/svg\[data-mo-live\] \.mo-eye > \* \{[^}]*animation-duration: calc\(16000ms[^}]*linear/.test(css)).toBe(true);
    expect(BLINK_CYCLE).toBe(16);
    for (let t = 0; t < 2 * BLINK_CYCLE * 1000; t += 3) {
      idleLoops(0, t, 1, f);
      const [, y] = sample(stops, ((t / 1000) % BLINK_CYCLE) / BLINK_CYCLE, { "mo-amp": 1 });
      expect(f.blink).toBeCloseTo(y!, 3);
    }
    const shut = BLINKS.map((b) => {
      idleLoops(0, (b + BLINK_DUR * BLINK_SHUT) * 1000, 1, f);
      return f.blink;
    });
    for (const v of shut) expect(v).toBeCloseTo(0.06, 6);
    for (let i = 1; i < BLINKS.length; i++) {
      const gap = BLINKS[i]! - BLINKS[i - 1]!;
      expect(Math.abs(gap - 0.24) < 1e-9 || (gap >= 1.9 && gap <= 4.6)).toBe(true);
    }
    idleLoops(0, (BLINKS[0]! + 0.08) * 1000, 0, f);
    expect(f.blink).toBe(1);
  });

  test("shake", () => {
    const v: Vars = { "mo-shake": 1.7 };
    for (let t = 0; t < 400; t += 3) {
      idleShake(t, 1.7, f);
      const [x, y] = sample(shake, (t % 112) / 112, v);
      expect(f.shakeX).toBeCloseTo(x!, 9);
      expect(f.shakeY).toBeCloseTo(y!, 9);
    }
  });

  test("the stylesheet's own idle stands down under the engine", () => {
    const rule = /svg\[data-mo-live\] \.mo-bob,[^{]*\{\s*animation: none;\s*\}/.exec(css)![0];
    for (const sel of [".mo-bob", ".mo-eyes", ".mo-eye > * > *"]) expect(rule).toContain(sel);
  });
});

describe("bloub's head", () => {
  /** `eyePoses` from bloub's `face.ts`, as it was written, for one eye at `side`. */
  function eyePose(yaw: number, pitch: number, roll: number, split: number, side: number) {
    type V = [number, number, number];
    const rad = (d: number) => (d * Math.PI) / 180;
    const spin = (u: V, v: V, a: number): [V, V] => {
      const c = Math.cos(a), s = Math.sin(a);
      return [
        [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s],
        [v[0] * c - u[0] * s, v[1] * c - u[1] * s, v[2] * c - u[2] * s],
      ];
    };
    let f: V = [0, 0, 1], right: V = [1, 0, 0], down: V = [0, 1, 0];
    [f, right] = spin(f, right, rad(yaw));
    [down, f] = spin(down, f, rad(pitch));
    [right, down] = spin(right, down, rad(roll));
    const [ef, er] = spin(f, right, rad(split * side));
    return { ef, er, down };
  }

  test("the head frame turns an eye exactly as bloub's eyePoses does", () => {
    const h = headFrame();
    for (const [yaw, pitch, roll] of [[0, 0, 0], [28.49, 28.62, -13], [-35, -45, 6], [12, -8, -6], [-21.94, -5.82, -12.2]] as const) {
      turnHead(yaw, pitch, roll, h);
      for (const side of [-1, 1]) {
        const a = (15.46 * side * Math.PI) / 180;
        const { ef, er, down } = eyePose(yaw, pitch, roll, 15.46, side);
        const x0 = Math.sin(a), z0 = Math.cos(a);
        expect(x0 * h.rx + z0 * h.fx).toBeCloseTo(ef[0], 12);
        expect(x0 * h.ry + z0 * h.fy).toBeCloseTo(ef[1], 12);
        expect(x0 * h.rz + z0 * h.fz).toBeCloseTo(ef[2], 12);
        expect(z0 * h.rx - x0 * h.fx).toBeCloseTo(er[0], 12);
        expect(z0 * h.ry - x0 * h.fy).toBeCloseTo(er[1], 12);
        expect(h.dx).toBeCloseTo(down[0], 12);
        expect(h.dy).toBeCloseTo(down[1], 12);
      }
    }
  });

  test("the wander is bloub's: smooth, bounded by its amplitude, and silent at strength 0", () => {
    const g = { yaw: 0, pitch: 0, roll: 0 };
    let prev = wander(0, 1, { yaw: 0, pitch: 0, roll: 0 });
    let maxStep = 0;
    for (let t = 1 / 60; t < 120; t += 1 / 60) {
      wander(t, 1, g);
      expect(Math.abs(g.yaw)).toBeLessThanOrEqual(MAX_YAW_DRIFT);
      expect(Math.abs(g.pitch)).toBeLessThanOrEqual(MAX_PITCH_DRIFT);
      maxStep = Math.max(maxStep, Math.abs(g.yaw - prev.yaw), Math.abs(g.pitch - prev.pitch));
      prev = { ...g };
    }
    // Under half a degree a frame at 60 Hz: a glide, never a saccade.
    expect(maxStep).toBeLessThan(0.5);
    wander(17.3, 0, g);
    expect([g.yaw, g.pitch, g.roll].every((v) => Math.abs(v) === 0)).toBe(true);
    expect(loopNoise(2.5, 6, 0.4)).toBeCloseTo(loopNoise(8.5, 6, 0.4), 12);
  });

  test("the float is a hair: under 1% of the body radius", () => {
    const o = idleFrame();
    for (let t = 0; t < 60; t += 0.1) {
      idleDrift(t * 1000, 0, 1, o);
      expect(Math.hypot(o.x, o.y)).toBeLessThan(0.01);
      expect(Math.abs(o.gaze.yaw)).toBe(0);
    }
  });
});

describe("the engine hands the breath and blink between the compositor and the frame clock", () => {
  const proto = FakeElement.prototype as unknown as { getAnimations?: () => { currentTime: number }[] };

  test("CSS at rest, frame clock while animating, and back at the same phase", () => {
    proto.getAnimations = () => [{ currentTime: 1234 }];
    try {
      const doc = new FakeDocument();
      const svg = makeSvg(doc);
      const handle = mountLive(svg as unknown as SVGSVGElement, "idle-seed");
      expect(doc.defaultView.queue.length).toBe(0);
      expect(svg.hasAttribute("data-mo-js")).toBe(false);

      handle.play("wide");
      expect(svg.hasAttribute("data-mo-js")).toBe(true);
      run(doc, 0, 0.5);
      expect(svg.hasAttribute("data-mo-live")).toBe(true);
      expect(svg.querySelector(".mo-breathe")!.getAttribute("transform")).toMatch(/^scale\(1 /);

      run(doc, 500, 12);
      expect(doc.defaultView.queue.length).toBe(0);
      expect(svg.hasAttribute("data-mo-js")).toBe(false);
      expect(svg.querySelector(".mo-breathe")!.getAttribute("transform")).toBeNull();
      expect(svg.querySelectorAll(".mo-eye").every((e) => e.children[0]!.getAttribute("transform") === null)).toBe(true);
      const lag = -parseFloat(svg.style.getPropertyValue("--mo-lag"));
      expect(lag).toBeGreaterThan(1234 + 1000);
      handle.destroy();
      expect(svg.getAttribute("style")).toBeNull();
    } finally {
      delete proto.getAnimations;
    }
  });
});
