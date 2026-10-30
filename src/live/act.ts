// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

import { r3 } from "../morph";

/**
 * Everything a state does to the body in one frame, as one rigid-plus-squash
 * move of the seed's own outline.
 *
 * On a seeded bolota every bloub state draws the seed's profile, either as-is
 * (`baseBody`) or scaled by the pose's mean radius (`BotEngine.posed()`), so
 * the silhouette a state carries never reaches the screen, only its pose does.
 * That pose is this record. Ambient life (breath, bob, blink, saccade) is not
 * in it: `motion.css` keeps that.
 *
 * Units are body units, R = 1 = the resting radius (`body.rx`).
 */
export interface Act {
  /** Centre offset, positive = right, in R. `sil.cx + offX`. */
  x: number;
  /** Centre offset, positive = down, in R. `sil.cy + offY`. */
  y: number;
  /** Rotation in degrees, positive = clockwise on screen. */
  rot: number;
  /** Uniform scale, the pose's mean radius. 1 on `baseBody` states. */
  s: number;
  /** Squash, applied on screen axes after the rotation. */
  sx: number;
  sy: number;
  /** Face opacity, 0–1. */
  eyeAlpha: number;
  /**
   * How far the face is exempt from `rot` and the squash, 0–1. At 1 the eyes
   * keep only the offset and `s`, as bloub's level face on `orbit`'s spinning
   * body (`uprightTransform` in `./upright`). A channel rather
   * than a state flag so a hand-back unwinds it on the same curve as `rot`.
   */
  upright: number;
}

export const IDLE_ACT: Act = { x: 0, y: 0, rot: 0, s: 1, sx: 1, sy: 1, eyeAlpha: 1, upright: 0 };

/**
 * `a` part-way to `b`, matching `blendPose` channel for channel.
 *
 * Linear on every field except `rot`, which takes the short way round as
 * `shape.ts`'s `blend` does: an orbit handing back at -1300° must unwind the
 * last fraction of a turn, not three and a half turns.
 */
export function blendAct(a: Act, b: Act, t: number, out: Act = { ...IDLE_ACT }): Act {
  let dRot = b.rot - a.rot;
  while (dRot > 180) dRot -= 360;
  while (dRot < -180) dRot += 360;
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.rot = a.rot + dRot * t;
  out.s = a.s + (b.s - a.s) * t;
  out.sx = a.sx + (b.sx - a.sx) * t;
  out.sy = a.sy + (b.sy - a.sy) * t;
  out.eyeAlpha = a.eyeAlpha + (b.eyeAlpha - a.eyeAlpha) * t;
  out.upright = a.upright + (b.upright - a.upright) * t;
  return out;
}

/** Copies `from` into `out`. */
export function setAct(out: Act, from: Act): Act {
  out.x = from.x;
  out.y = from.y;
  out.rot = from.rot;
  out.s = from.s;
  out.sx = from.sx;
  out.sy = from.sy;
  out.eyeAlpha = from.eyeAlpha;
  out.upright = from.upright;
  return out;
}

/** `out` at rest: the identity act. */
export const restAct = (out: Act): Act => setAct(out, IDLE_ACT);

/**
 * The act as one SVG `transform` for a group around the static markup, whose
 * body is centred on (`cx`, `cy`) with radius `R`.
 *
 *   translate(cx + x·R, cy + y·R) scale(s·sx, s·sy) rotate(rot) translate(−cx, −cy)
 *
 * This is `toPoints`'s order read right to left: a point is taken relative to
 * the centre, rotated, squashed on screen axes, then moved by the offset. The
 * uniform `s` is folded into the squash because it commutes with the rotation;
 * the squash itself does not, which is why it sits outside `rotate`.
 */
export function actTransform(act: Act, R: number, cx: number, cy: number): string {
  return (
    `translate(${r3(cx + act.x * R)} ${r3(cy + act.y * R)})` +
    ` scale(${r3(act.s * act.sx)} ${r3(act.s * act.sy)})` +
    ` rotate(${r3(act.rot)})` +
    ` translate(${r3(-cx)} ${r3(-cy)})`
  );
}
