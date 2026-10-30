// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

import { r3 } from "../morph";
import type { Act } from "./act";

/**
 * The `.mo-eyes` transform inside `actTransform`'s group that keeps the face
 * level on a turning body, or `""` when the act keeps no face level.
 *
 * bloub's `orbit` turns the body and leaves the eyes upright: an eye moves
 * with the body's centre and its mean-radius scale, never with its rotation
 * or squash (`bloub/engine.ts` `sample`).
 *
 *   translate(cx, cy) rotate(−rot·u) scale(1/sx^u, 1/sy^u) translate(−cx, −cy)
 *
 * with `u = act.upright`. At `u = 1` it composes with the act to
 * translate(offset) scale(s) about the centre. Partway through a hand-back the
 * eyes turn by `rot·(1 − u)`, which is 0 at both ends of the blend. Keeping a
 * level face inside the turned body is `fitEyes`'s job, given
 * `turn = rot·u`.
 */
export function uprightTransform(act: Act, cx: number, cy: number): string {
  const u = act.upright;
  if (u <= 0) return "";
  return (
    `translate(${r3(cx)} ${r3(cy)})` +
    ` rotate(${r3(-act.rot * u)})` +
    ` scale(${r3(1 / act.sx ** u)} ${r3(1 / act.sy ** u)})` +
    ` translate(${r3(-cx)} ${r3(-cy)})`
  );
}
