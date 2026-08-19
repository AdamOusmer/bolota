// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Ported from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

/**
 * Ported verbatim from bloub (https://github.com/jeremyPerret/bloub),
 * MIT License, Copyright (c) 2026 Jérémy Perret.
 *
 * Deterministic easing/PRNG/vector helpers. Not adapted — see ../engine.ts for the bolota-specific bridge
 * (seed-to-silhouette conversion, DOM mounting, rAF loop). This file's
 * own logic and structure are untouched beyond TS-strict fixes, import
 * paths, and translating the original French comments/identifiers to
 * English (see ../engine.ts's header for the provenance note).
 */
export const TAU = Math.PI * 2

export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export type Easing = (t: number) => number

/**
 * Measured off the reference video: transitions are exponential ease-outs,
 * with no overshoot on the body. The only spring-like effects are local
 * (the notification badge's pop, the eyes opening) and are written directly
 * into the state concerned.
 */
export const easings = {
  easeOutCubic: (t: number) => 1 - (1 - t) ** 3,
  easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  easeOutQuint: (t: number) => 1 - (1 - t) ** 5
} satisfies Record<string, Easing>

/** Periodic 1D noise: loops seamlessly over `period`, useful for gaze drift. */
export function loopNoise(t: number, period: number, seed = 0): number {
  const p = (t / period) * TAU
  return (
    0.55 * Math.sin(p + seed) +
    0.3 * Math.sin(2 * p + seed * 1.7 + 1.1) +
    0.15 * Math.sin(3 * p + seed * 2.3 + 2.4)
  )
}

/** Deterministic PRNG (mulberry32): same sequence on every read. */
export function createRng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Short rounding: roughly halves the weight of path strings generated at 60 fps. */
export const r2 = (v: number) => Math.round(v * 100) / 100
