// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

import { EASE } from "../ease";
import { easeInOutCubic } from "./choreo";

/**
 * Where the eyes look when something outside drives them: bloub's `Look`, and
 * the pointer rule bolota's 0.1 engine tuned on top of it.
 *
 * `yaw` and `pitch` are absolute directions in degrees that replace the
 * state's own as `mix` rises; `wander` is how much idle drift is left. The two
 * never combine: while a pointer holds the gaze the drift dies down, or the
 * eyes would seem to hunt for it without ever holding it.
 */
export interface Look {
  yaw: number;
  pitch: number;
  mix: number;
  wander: number;
}

export const NO_LOOK: Readonly<Look> = { yaw: 0, pitch: 0, mix: 0, wander: 1 };

/**
 * How far a tracked pointer turns the head left and right, in degrees: about
 * half way to the side of the body. The engine settles each frame inside the
 * body, so a seed with less room gets what fits.
 */
export const FOLLOW_MAX_YAW = 35;
/** The height the gaze holds at with the pointer level with the bolota: just above the equator, attentive rather than vacant. */
export const FOLLOW_PITCH = 10;
/** How far up it reaches with the pointer at the top of the viewport. */
export const FOLLOW_PITCH_UP = 26;
/**
 * How far down it reaches at the bottom. Further than up: pitch maps to travel
 * non-linearly, and a page is mostly below its avatar.
 */
export const FOLLOW_PITCH_DOWN = -45;

/**
 * Seconds a retarget takes on the CSS `ease` curve. Every pointer move
 * retargets from wherever the curve is, so a moving pointer is trailed by
 * about this much and a parked one is reached in a single clean arrival.
 */
export const FOLLOW_MORPH = 0.08;
/** Seconds the gaze takes to hand back to the state's own when the pointer leaves. */
export const LOOK_MORPH = 0.24;

/**
 * The look a pointer at `nx`, `ny` asks for, each -1..1 across the viewport
 * from the bolota's centre, right and down positive. Each half of the
 * vertical sweep is its own lerp out of the rest height, so looking down is as
 * live as looking up.
 */
export function followLook(nx: number, ny: number, gain: number, o: Look): Look {
  const extreme = ny <= 0 ? FOLLOW_PITCH_UP : FOLLOW_PITCH_DOWN;
  o.yaw = nx * FOLLOW_MAX_YAW * gain;
  o.pitch = (FOLLOW_PITCH + Math.abs(ny) * (extreme - FOLLOW_PITCH)) * gain;
  o.mix = 1;
  o.wander = 0;
  return o;
}

/**
 * One gaze glide: from a look to a look over `dur` seconds on `ease`. A new
 * target starts from wherever the glide is, never from the last target, so a
 * stream of pointer moves glides instead of juddering.
 */
export class Glide {
  private from: Look = { ...NO_LOOK };
  private to: Look = { ...NO_LOOK };
  private at = 0;
  private dur = LOOK_MORPH;
  private ease: (t: number) => number = easeInOutCubic;

  /** The look at `now`, into `o`. */
  sample(now: number, o: Look): Look {
    const k = this.dur > 0 ? (now - this.at) / this.dur : 1;
    if (k >= 1) {
      o.yaw = this.to.yaw;
      o.pitch = this.to.pitch;
      o.mix = this.to.mix;
      o.wander = this.to.wander;
      return o;
    }
    const e = this.ease(k < 0 ? 0 : k);
    o.yaw = this.from.yaw + (this.to.yaw - this.from.yaw) * e;
    o.pitch = this.from.pitch + (this.to.pitch - this.from.pitch) * e;
    o.mix = this.from.mix + (this.to.mix - this.from.mix) * e;
    o.wander = this.from.wander + (this.to.wander - this.from.wander) * e;
    return o;
  }

  /** Whether the glide has arrived by `now`. */
  settled(now: number): boolean {
    return now - this.at >= this.dur;
  }

  /** The target, to read only. */
  get target(): Readonly<Look> {
    return this.to;
  }

  /** Glides to `look` from where it is at `now`: a pointer's on `ease`, a release on bloub's in-out curve. */
  retarget(look: Readonly<Look>, now: number, release: boolean): void {
    this.sample(now, this.from);
    this.to.yaw = look.yaw;
    this.to.pitch = look.pitch;
    this.to.mix = look.mix;
    this.to.wander = look.wander;
    this.at = now;
    this.dur = release ? LOOK_MORPH : FOLLOW_MORPH;
    this.ease = release ? easeInOutCubic : EASE;
  }
}
