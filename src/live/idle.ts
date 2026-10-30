// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

import { blinkScale, breath, float, lid, wander, type Gaze } from "./head";

/**
 * The idle life of a mounted bolota, as bloub's engine lived it
 * (`liveliness` in `bloub/face.ts`): the head wanders on slow incommensurate
 * sines, the body floats a hair about its place, the height breathes and the
 * lids blink on bloub's schedule. Pure functions of time, for a driver that
 * owns a frame clock. A state that owns its liveliness gets no wander and no
 * float; nothing stops the breath or the blink.
 */

export interface IdleFrame {
  /** Body height factor. */
  breathe: number;
  /** Eye height factor: 1 open, 0.06 shut. */
  blink: number;
  /** The head's wander, in degrees. */
  gaze: Gaze;
  /** The body's float, in body radii. */
  x: number;
  y: number;
  shakeX: number;
  shakeY: number;
}

export const idleFrame = (): IdleFrame => ({
  breathe: 1,
  blink: 1,
  gaze: { yaw: 0, pitch: 0, roll: 0 },
  x: 0,
  y: 0,
  shakeX: 0,
  shakeY: 0,
});

/**
 * The breath at `bodyMs` and the blink at `eyeMs`, at amplitude `amp`. These
 * two are what the stylesheet carries when the engine is at rest.
 */
export function idleLoops(bodyMs: number, eyeMs: number, amp: number, f: IdleFrame): void {
  f.breathe = breath(bodyMs, amp);
  f.blink = 1 - (1 - blinkScale(lid(eyeMs))) * amp;
}

/**
 * The wander at strength `look` and the float at strength `drift`, at `ms`.
 * Each is 0 on a state that owns its liveliness; `look` also fades while a
 * pointer holds the gaze.
 */
export function idleDrift(ms: number, look: number, drift: number, f: IdleFrame): void {
  const t = ms / 1000;
  wander(t, look, f.gaze);
  float(t, drift, f);
}

const SHAKE_MS = 112;

/** `@keyframes mo-shake`: position, x, y in px at unit shake. */
const SHAKE = [0, 0.62, -0.34, 0.25, -0.7, 0.22, 0.5, 0.38, 0.66, 0.75, -0.44, -0.6, 1, 0.62, -0.34];

/** The tremor at amplitude `shake`, linear between the keyframe's stops. */
export function idleShake(t: number, shake: number, f: IdleFrame): void {
  const u = (t % SHAKE_MS) / SHAKE_MS;
  for (let i = SHAKE.length - 6; i >= 0; i -= 3) {
    if (u < SHAKE[i]!) continue;
    const k = (u - SHAKE[i]!) / (SHAKE[i + 3]! - SHAKE[i]!);
    f.shakeX = (SHAKE[i + 1]! + (SHAKE[i + 4]! - SHAKE[i + 1]!) * k) * shake;
    f.shakeY = (SHAKE[i + 2]! + (SHAKE[i + 5]! - SHAKE[i + 2]!) * k) * shake;
    return;
  }
}
