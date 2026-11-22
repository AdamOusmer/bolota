// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT, and open-bot-avatar (c) 2026 Dominik Scholz, MIT. See LICENSE.

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
/** How far up it reaches with the pointer far above. */
export const FOLLOW_PITCH_UP = 26;
/**
 * How far down it reaches at the bottom. Further than up: pitch maps to travel
 * non-linearly, and a page is mostly below its avatar.
 */
export const FOLLOW_PITCH_DOWN = -45;

/** Seconds for the look to cover ~63% of the way to a moving target. */
export const FOLLOW_TAU = 0.12;
/** Seconds for attention to fade in or out, and for a released look to relax. */
export const ATTEND_TAU = 0.3;
/** Pointer distance, in avatar sizes, at which the look is at tanh(1) of full. */
export const REACH = 1;
/** Smallest reach, CSS px, so a small avatar still uses its range. */
export const MIN_REACH = 160;
/** The reach is at least this share of the viewport's diagonal, so the look keeps turning across the page. */
export const VIEW_REACH = 0.25;

const EPS_DEG = 0.05;
const EPS_MIX = 0.002;
const MAX_DT = 0.1;

export interface Point {
  x: number;
  y: number;
}

/** Where the look starts on screen (the eyes), the avatar's size and the viewport's diagonal, CSS px. */
export interface Origin extends Point {
  size: number;
  view: number;
}

/**
 * The pointer as a look direction from the eyes, -1..1 each way: radial and
 * soft, saturating gently past about one avatar away or a quarter of the
 * viewport's diagonal, whichever is further.
 */
export function pointerAim(pointer: Point, origin: Origin, out: Point): Point {
  const reach = Math.max(origin.size * REACH, MIN_REACH, origin.view * VIEW_REACH);
  const dx = (pointer.x - origin.x) / reach;
  const dy = (pointer.y - origin.y) / reach;
  const m = Math.hypot(dx, dy);
  const k = Number.isFinite(m) && m > 1e-9 ? Math.tanh(m) / m : 0;
  out.x = dx * k;
  out.y = dy * k;
  return out;
}

/**
 * The look a pointer at `nx`, `ny` asks for, each -1..1 from `pointerAim`,
 * right and down positive. Each half of the
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
 * The gaze pursuit: the look eases toward its target every frame, frame-rate
 * independent, and attention fades the pointer's hold in and out on its own
 * slower curve, so taking up or losing a target turns rather than snaps.
 */
export class Glide {
  private readonly cur: Look = { ...NO_LOOK };
  private readonly to: Look = { ...NO_LOOK };
  private attention = 0;
  private holding = false;
  private at = NaN;

  private advance(now: number): void {
    const dt = this.at === this.at ? Math.min(MAX_DT, Math.max(0, now - this.at)) : 0;
    this.at = now;
    if (dt <= 0) return;
    const k = 1 - Math.exp(-dt / (this.holding ? FOLLOW_TAU : ATTEND_TAU));
    const ka = 1 - Math.exp(-dt / ATTEND_TAU);
    this.cur.yaw += (this.to.yaw - this.cur.yaw) * k;
    this.cur.pitch += (this.to.pitch - this.cur.pitch) * k;
    this.attention += ((this.holding ? 1 : 0) - this.attention) * ka;
    if (this.arrived()) {
      this.cur.yaw = this.to.yaw;
      this.cur.pitch = this.to.pitch;
      this.attention = this.holding ? 1 : 0;
    }
  }

  private arrived(): boolean {
    return (
      Math.abs(this.to.yaw - this.cur.yaw) < EPS_DEG &&
      Math.abs(this.to.pitch - this.cur.pitch) < EPS_DEG &&
      Math.abs((this.holding ? 1 : 0) - this.attention) < EPS_MIX
    );
  }

  /** The look at `now`, into `o`. */
  sample(now: number, o: Look): Look {
    this.advance(now);
    const a = this.attention;
    const w = a * a * (3 - 2 * a);
    o.yaw = this.cur.yaw;
    o.pitch = this.cur.pitch;
    o.mix = w;
    o.wander = 1 - w;
    return o;
  }

  /** Whether the look has arrived by `now`. */
  settled(now: number): boolean {
    this.advance(now);
    return this.arrived();
  }

  /** The target, to read only. */
  get target(): Readonly<Look> {
    return this.to;
  }

  /** Pursues `look` from where the gaze is at `now`; `release` relaxes back to rest instead. */
  retarget(look: Readonly<Look>, now: number, release: boolean): void {
    this.advance(now);
    this.holding = !release;
    this.to.yaw = release ? 0 : look.yaw;
    this.to.pitch = release ? 0 : look.pitch;
    this.to.mix = release ? 0 : 1;
    this.to.wander = release ? 1 : 0;
  }
}
