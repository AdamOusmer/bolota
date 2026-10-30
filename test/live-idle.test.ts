// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { motionSeeds, motionVars } from "../src/animate";
import { EASE_IN, EASE_IN_OUT, EASE_OUT } from "../src/ease";
import { idleBody, idleEyes, idleFrame, idleShake } from "../src/live/idle";
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

describe("idle matches motion.css", () => {
  const saccade = stopsOf("mo-saccade", ["translate"]);
  const wrap = stopsOf("mo-wrap", ["rotate", "scale"]);
  const shake = stopsOf("mo-shake", ["translate"]);
  const f = idleFrame();

  test("saccade", () => {
    for (const s of SEEDS) {
      const seeds = motionSeeds(traits(s, true));
      const v: Vars = { "mo-look-x": seeds.lookX, "mo-look-y": seeds.lookY, "mo-amp": 1 };
      for (let t = 0; t < 2 * seeds.saccade; t += 37) {
        idleBody(seeds, t, 1, 0, f);
        const u = (((t + seeds.saccadePhase) / seeds.saccade) % 1 + 1) % 1;
        const [x, y] = sample(saccade, u, v);
        expect(f.sacX).toBeCloseTo(x!, 9);
        expect(f.sacY).toBeCloseTo(y!, 9);
      }
    }
  });

  test("wrap, for both eyes", () => {
    for (const s of SEEDS) {
      const seeds = motionSeeds(traits(s, true));
      for (const side of [-1, 1]) {
        const v: Vars = {
          "mo-look-x": seeds.lookX,
          "mo-look-y": seeds.lookY,
          "mo-look-mx": seeds.lookMX,
          "mo-look-my": seeds.lookMY,
          "mo-amp": 1,
          "mo-wrap": side,
        };
        for (let t = 0; t < 2 * seeds.saccade; t += 53) {
          idleEyes(seeds, t, 1, 0, f);
          const u = (((t + seeds.saccadePhase) / seeds.saccade) % 1 + 1) % 1;
          const [rot, sx, sy] = sample(wrap, u, v);
          expect(f.wrapRot * side).toBeCloseTo(rot!, 9);
          expect(1 + f.wrapMx + f.wrapSide * side).toBeCloseTo(sx!, 9);
          expect(1 + f.wrapSy).toBeCloseTo(sy!, 9);
        }
      }
    }
  });

  test("a held gaze fades the look the way gaze.css does", () => {
    const seeds = motionSeeds(traits("user-7", true));
    const t = 0.2 * seeds.saccade - seeds.saccadePhase;
    idleBody(seeds, t, 1, 0, f);
    const full = f.sacX;
    idleBody(seeds, t, 1, 0.75, f);
    expect(f.sacX).toBeCloseTo(full * 0.25, 9);
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

  test("blink: stops, depth and curves", () => {
    const stops = [...block("mo-blink").matchAll(/([\d.%,\s]+)\{([^}]*)\}/g)].map((m) => ({
      at: m[1]!.split(",").map((p) => parseFloat(p) / 100),
      depth: /scaleY\(calc\(1 - ([\d.]+)/.exec(m[2]!)?.[1],
      ease: /animation-timing-function: ([\w-]+)/.exec(m[2]!)?.[1],
    }));
    expect(stops.map((s) => s.at)).toEqual([[0, 0.972], [0.986], [1]]);
    expect(stops.map((s) => s.ease)).toEqual(["ease-in", "ease-out", undefined]);
    const depth = Number(stops[1]!.depth);
    for (const s of SEEDS) {
      const seeds = motionSeeds(traits(s, true));
      for (let t = 0; t < 2 * seeds.blink; t += 7) {
        idleEyes(seeds, t, 1, 0, f);
        const b = (((t + seeds.blinkPhase) / seeds.blink) % 1 + 1) % 1;
        const want =
          b < 0.972 ? 1 : b < 0.986 ? 1 - depth * EASE_IN((b - 0.972) / 0.014) : 1 - depth * (1 - EASE_OUT((b - 0.986) / 0.014));
        expect(f.blink).toBeCloseTo(want, 9);
      }
    }
    idleEyes(motionSeeds(traits("a", true)), 0, 0, 0, f);
    expect(f.blink).toBe(1);
  });

  test("breathe and bob: periods, travel, ease-in-out, alternate", () => {
    const breathe = /@keyframes mo-breathe[^]*?scaleX\(calc\(1 \+ ([\d.]+)[^]*?scaleY\(calc\(1 - ([\d.]+)/.exec(css)!;
    const bobTravel = /@keyframes mo-bob[^]*?translateY\(calc\(-([\d.]+)px/.exec(css)!;
    expect(/animation-duration: calc\(2800ms/.test(css)).toBe(true);
    expect(/animation-duration: calc\(3400ms/.test(css)).toBe(true);
    for (const s of SEEDS) {
      const seeds = motionSeeds(traits(s, true));
      for (let t = 0; t < 7000; t += 41) {
        idleBody(seeds, t, 1, 0, f);
        const alt = (ph: number, p: number) => {
          const u = (t + ph) / p;
          const k = Math.floor(u);
          return k % 2 ? 1 - (u - k) : u - k;
        };
        expect(f.breatheX).toBeCloseTo(1 + Number(breathe[1]) * EASE_IN_OUT(alt(seeds.phase, 2800)), 9);
        expect(f.breatheY).toBeCloseTo(1 - Number(breathe[2]) * EASE_IN_OUT(alt(seeds.phase, 2800)), 9);
        expect(f.bob).toBeCloseTo(-Number(bobTravel[1]) * EASE_IN_OUT(alt(seeds.bobPhase, 3400)), 9);
      }
    }
  });
});

describe("the engine hands the loops between the compositor and the frame clock", () => {
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
      expect(svg.querySelector(".mo-breathe")!.getAttribute("transform")).toMatch(/^scale\(/);

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
