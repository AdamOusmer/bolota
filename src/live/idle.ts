// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from blobatar (c) 2026 Alain, MIT. See LICENSE.

import type { MotionSeeds } from "../animate";
import { EASE_IN, EASE_IN_OUT, EASE_OUT } from "../ease";

/**
 * The idle loops of `motion.css` as pure functions of time, for a driver that
 * already owns a frame clock. Every table and constant is transcribed from the
 * stylesheet (`test/live-idle.test.ts` samples the real keyframes against it),
 * with the seed's timing from `motionSeeds`.
 */

export interface IdleFrame {
  breatheX: number;
  breatheY: number;
  bob: number;
  sacX: number;
  sacY: number;
  blink: number;
  wrapMx: number;
  wrapSide: number;
  wrapSy: number;
  wrapRot: number;
  shakeX: number;
  shakeY: number;
}

export const idleFrame = (): IdleFrame => ({
  breatheX: 1,
  breatheY: 1,
  bob: 0,
  sacX: 0,
  sacY: 0,
  blink: 1,
  wrapMx: 0,
  wrapSide: 0,
  wrapSy: 0,
  wrapRot: 0,
  shakeX: 0,
  shakeY: 0,
});

const BREATHE_MS = 2800;
const BOB_MS = 3400;
const SHAKE_MS = 112;

const cycle = (t: number, phase: number, period: number) => {
  const u = (t + phase) / period;
  return u - Math.floor(u);
};

const alternate = (t: number, phase: number, period: number) => {
  const u = (t + phase) / period;
  const n = Math.floor(u);
  const f = u - n;
  return n % 2 ? 1 - f : f;
};

/** Rows of `[position, ...values]`, flat; linear between rows. */
function stops(u: number, table: readonly number[], stride: number, col: number): number {
  for (let i = table.length - stride; i >= 0; i -= stride) {
    if (u < table[i]!) continue;
    const j = i + stride;
    if (j >= table.length) return table[i + col]!;
    const span = table[j]! - table[i]!;
    return span <= 0 ? table[i + col]! : table[i + col]! + (table[j + col]! - table[i + col]!) * ((u - table[i]!) / span);
  }
  return table[col]!;
}

/** `@keyframes mo-saccade`: position, x, y in px at unit look. */
const SACCADE = [
  0, 0, 0,
  0.15, 0, 0,
  0.165, -1.3, -1.45,
  0.31, -1.3, -1.45,
  0.325, 1.6, 0.15,
  0.47, 1.6, 0.15,
  0.485, -0.25, 1.35,
  0.63, -0.25, 1.35,
  0.645, 1.2, -1.3,
  0.79, 1.2, -1.3,
  0.805, -1.6, -0.25,
  0.985, -1.6, -0.25,
  1, 0, 0,
];

/** `@keyframes mo-wrap`: position, magnitude x, signed x, y, rotation in degrees. */
const WRAP = [
  0, 0, 0, 0, 0,
  0.15, 0, 0, 0, 0,
  0.165, -0.0176, 0.008, -0.027, 0.648,
  0.31, -0.0176, 0.008, -0.027, 0.648,
  0.325, -0.022, -0.01, -0.003, 0.09,
  0.47, -0.022, -0.01, -0.003, 0.09,
  0.485, -0.0033, 0.0015, -0.0255, -0.115,
  0.63, -0.0033, 0.0015, -0.0255, -0.115,
  0.645, -0.0165, -0.0075, -0.024, -0.54,
  0.79, -0.0165, -0.0075, -0.024, -0.54,
  0.805, -0.022, 0.01, -0.0045, 0.135,
  0.985, -0.022, 0.01, -0.0045, 0.135,
  1, 0, 0, 0, 0,
];

/** `@keyframes mo-shake`: position, x, y in px at unit shake. */
const SHAKE = [0, 0.62, -0.34, 0.25, -0.7, 0.22, 0.5, 0.38, 0.66, 0.75, -0.44, -0.6, 1, 0.62, -0.34];

/**
 * Breathe, bob and the saccade, the loops `data-mo-still` pauses. `hold` is the
 * gaze driver's grip, which fades the seeded look the way `gaze.css` does.
 */
export function idleBody(s: MotionSeeds, t: number, amp: number, hold: number, f: IdleFrame): void {
  const breathe = EASE_IN_OUT(alternate(t, s.phase, BREATHE_MS));
  f.breatheX = 1 + 0.032 * amp * breathe;
  f.breatheY = 1 - 0.026 * amp * breathe;
  f.bob = -1.6 * amp * EASE_IN_OUT(alternate(t, s.bobPhase, BOB_MS));
  const sac = cycle(t, s.saccadePhase, s.saccade);
  const k = amp * (1 - hold);
  f.sacX = stops(sac, SACCADE, 3, 1) * s.lookX * k;
  f.sacY = stops(sac, SACCADE, 3, 2) * s.lookY * k;
}

/** Blink and wrap, which keep running when the body is held still. */
export function idleEyes(s: MotionSeeds, t: number, amp: number, hold: number, f: IdleFrame): void {
  const b = cycle(t, s.blinkPhase, s.blink);
  f.blink =
    b < 0.972
      ? 1
      : b < 0.986
        ? 1 - 0.92 * amp * EASE_IN((b - 0.972) / 0.014)
        : 1 - 0.92 * amp * (1 - EASE_OUT((b - 0.986) / 0.014));
  const sac = cycle(t, s.saccadePhase, s.saccade);
  const k = amp * (1 - hold);
  f.wrapMx = stops(sac, WRAP, 5, 1) * s.lookMX * k;
  f.wrapSide = stops(sac, WRAP, 5, 2) * s.lookX * k;
  f.wrapSy = stops(sac, WRAP, 5, 3) * s.lookMY * k;
  f.wrapRot = stops(sac, WRAP, 5, 4) * s.lookX * s.lookY * k * (1 - hold);
}

/** The tremor at amplitude `shake`. */
export function idleShake(t: number, shake: number, f: IdleFrame): void {
  const u = cycle(t, 0, SHAKE_MS);
  f.shakeX = stops(u, SHAKE, 3, 1) * shake;
  f.shakeY = stops(u, SHAKE, 3, 2) * shake;
}
