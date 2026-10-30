// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

import { EASE_IN_OUT } from "../ease";

/**
 * bloub's head, from `bloub/face.ts`: the eyes are painted on a sphere and a
 * head turn carries them round it, and the idle life that turns it.
 *
 * Everything here is a pure function of its arguments and writes into records
 * the caller owns, so a frame allocates nothing.
 */

/** A head turn in degrees: yaw right, pitch up, roll clockwise, all positive. */
export interface Gaze {
  yaw: number;
  pitch: number;
  roll: number;
}

/**
 * The head's frame after a turn: where its right, down and forward axes point
 * on screen (x right, y down, z toward the viewer). bloub's `eyePoses`: yaw
 * tilts forward toward right, pitch tilts it up, roll turns the face in its
 * own plane, in that order.
 */
export interface HeadFrame {
  rx: number; ry: number; rz: number;
  dx: number; dy: number; dz: number;
  fx: number; fy: number; fz: number;
}

export const headFrame = (): HeadFrame => ({ rx: 1, ry: 0, rz: 0, dx: 0, dy: 1, dz: 0, fx: 0, fy: 0, fz: 1 });

const RAD = Math.PI / 180;

/** The frame of a head turned by `yaw`, `pitch` and `roll` degrees, into `o`. */
export function turnHead(yaw: number, pitch: number, roll: number, o: HeadFrame): HeadFrame {
  const cy = Math.cos(yaw * RAD), sy = Math.sin(yaw * RAD);
  const cp = Math.cos(pitch * RAD), sp = Math.sin(pitch * RAD);
  const cr = Math.cos(roll * RAD), sr = Math.sin(roll * RAD);
  // yaw: forward toward right
  const f1x = sy, f1z = cy;
  const r1x = cy, r1z = -sy;
  // pitch: down toward forward, forward away from down
  const d2x = f1x * sp, d2y = cp, d2z = f1z * sp;
  const f2x = f1x * cp, f2y = -sp, f2z = f1z * cp;
  // roll: right toward down
  o.rx = r1x * cr + d2x * sr;
  o.ry = d2y * sr;
  o.rz = r1z * cr + d2z * sr;
  o.dx = d2x * cr - r1x * sr;
  o.dy = d2y * cr;
  o.dz = d2z * cr - r1z * sr;
  o.fx = f2x;
  o.fy = f2y;
  o.fz = f2z;
  return o;
}

/**
 * Periodic 1D noise: loops seamlessly over `period`. bloub's `loopNoise`,
 * the sum every drift below is made of.
 */
export function loopNoise(t: number, period: number, seed = 0): number {
  const p = (t / period) * Math.PI * 2;
  return 0.55 * Math.sin(p + seed) + 0.3 * Math.sin(2 * p + seed * 1.7 + 1.1) + 0.15 * Math.sin(3 * p + seed * 2.3 + 2.4);
}

/** bloub's gaze drift amplitudes, in degrees, at the size the owner settled on. */
const WANDER_YAW_SLOW = 7.81;
const WANDER_YAW_FAST = 2.27;
const WANDER_PITCH_SLOW = 7.75;
const WANDER_PITCH_FAST = 2.33;
const WANDER_ROLL = 3.28;

/** The furthest the drift turns the head, in degrees. */
export const MAX_YAW_DRIFT = WANDER_YAW_SLOW + WANDER_YAW_FAST;
export const MAX_PITCH_DRIFT = WANDER_PITCH_SLOW + WANDER_PITCH_FAST;

/**
 * The slow wander of the head, in degrees, at time `t` in seconds and strength
 * `k`. Mutually incommensurate periods, so it never visibly repeats.
 */
export function wander(t: number, k: number, o: Gaze): Gaze {
  o.yaw = (loopNoise(t, 6.0, 0.4) * WANDER_YAW_SLOW + loopNoise(t, 1.8, 2.1) * WANDER_YAW_FAST) * k;
  o.pitch = (loopNoise(t, 5.1, 1.3) * WANDER_PITCH_SLOW + loopNoise(t, 2.1, 0.7) * WANDER_PITCH_FAST) * k;
  o.roll = loopNoise(t, 7.3, 3.2) * WANDER_ROLL * k;
  return o;
}

/** The body's float about its rest place, in body radii, at time `t` in seconds and strength `k`. */
export function float(t: number, k: number, o: { x: number; y: number }): void {
  o.x = loopNoise(t, 7.9, 1.9) * 0.006 * k;
  o.y = loopNoise(t, 5.3, 0.3) * 0.007 * k;
}

/**
 * bloub's breath: the height alone, by half a percent each way, over 3.4s.
 * Eased in and out on the stylesheet's own curve rather than a sine, so the
 * compositor's copy (`mo-live-breathe` in `motion.css`) runs the same frames
 * when the engine hands it the loop at rest.
 */
export const BREATH_MS = 3400;
export const BREATH = 0.005;

export function breath(ms: number, amp: number): number {
  const u = ms / (BREATH_MS / 2);
  const n = Math.floor(u);
  const f = u - n;
  return 1 - BREATH * amp + 2 * BREATH * amp * EASE_IN_OUT(n % 2 ? 1 - f : f);
}

/**
 * bloub's blink schedule, as one cycle that repeats: when each blink starts,
 * in seconds. Gaps of 1.9 to 4.6s and one double blink, the spread bloub drew
 * at random; a fixed cycle is what lets `motion.css` (`mo-live-blink`) carry it
 * at rest.
 */
export const BLINKS = [1.4, 4.5, 4.74, 8.2, 10.4, 14.1] as const;
export const BLINK_CYCLE = 16;
/** One blink, in seconds: measured off bloub's video at 1 to 2 frames at 10 fps. */
export const BLINK_DUR = 0.18;
/** The share of a blink spent closing: fast shut, slower open. */
export const BLINK_SHUT = 0.45;

/** How open the lid is at `ms`, 0–1, on the blink cycle. */
export function lid(ms: number): number {
  let t = (ms / 1000) % BLINK_CYCLE;
  if (t < 0) t += BLINK_CYCLE;
  for (let i = BLINKS.length - 1; i >= 0; i--) {
    const k = (t - BLINKS[i]!) / BLINK_DUR;
    if (k < 0) continue;
    if (k > 1) return 1;
    return k < BLINK_SHUT ? 1 - k / BLINK_SHUT : (k - BLINK_SHUT) / (1 - BLINK_SHUT);
  }
  return 1;
}

/** The eye's height at lid `l`: a blink is a vertical squash on screen down to 6%. */
export const blinkScale = (l: number): number => 0.06 + 0.94 * (l < 0 ? 0 : l > 1 ? 1 : l);
