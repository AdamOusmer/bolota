// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { _layout } from "../src/bolota";
import { eyeBox, settleEyes } from "../src/live/fit";
import { edge } from "../src/live/outline";

const ROOT = `${import.meta.dir}/..`;
const LIVE = readdirSync(`${ROOT}/src/live`).filter((f) => f.endsWith(".ts"));

describe("live caches", () => {
  test("importing every live module and the gaze driver does no table or per-seed work", () => {
    const imports = [...LIVE.map((f) => `src/live/${f}`), "src/gaze.ts"]
      .map((f) => `await import(${JSON.stringify(`${ROOT}/${f}`)});`)
      .join("");
    const code =
      `let n = 0; for (const k of ["cos", "sin", "atan2", "hypot", "sqrt"]) { const f = Math[k]; Math[k] = (...a) => (n++, f(...a)); }` +
      `const t = performance.now(); ${imports} console.log(JSON.stringify({ n, ms: performance.now() - t }));`;
    const run = Bun.spawnSync(["bun", "-e", code], { cwd: ROOT });
    const { n, ms } = JSON.parse(run.stdout.toString().trim().split("\n").pop()!);
    console.log(`live import: ${n} trig/sqrt calls, ${ms.toFixed(1)} ms`);
    expect(n).toBeLessThan(200);
  });

  test("per-seed tables live in WeakMaps only", () => {
    for (const f of [...LIVE.map((f) => `src/live/${f}`), "src/gaze.ts"]) {
      const src = readFileSync(`${ROOT}/${f}`, "utf8");
      expect(src, f).not.toMatch(/new Map\b/);
    }
  });

  test("dropped layouts are collected, outline tables and all", async () => {
    const refs: WeakRef<object>[] = [];
    const make = (i: number) => {
      const l = _layout(`cache-gc-${i}`);
      edge(l, 1);
      settleEyes(l, l.eyes.map((e) => ({ ...e })), { yaw: 30, pitch: -40, roll: 0 }, 0, [eyeBox(), eyeBox()]);
      refs.push(new WeakRef(l));
    };
    for (let i = 0; i < 64; i++) make(i);
    for (let i = 0; i < 10; i++) {
      Bun.gc(true);
      await Bun.sleep(1);
    }
    const alive = refs.filter((r) => r.deref()).length;
    console.log(`gc: ${64 - alive} of 64 dropped layouts collected`);
    expect(alive).toBeLessThan(4);
  });
});
