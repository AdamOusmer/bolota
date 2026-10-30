// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

import { bakePose, r3, type Posable, type Pose } from "../morph";
import type { Act } from "./act";
import { CHOREO } from "./choreo";

/**
 * A level face on a spinning body.
 *
 * bloub's `orbit` turns the body and leaves the eyes upright: an eye
 * moves with the body's centre and its mean-radius scale, never with its
 * rotation or squash (`bloub/engine.ts` `sample`). Inside `mo-act` the eyes
 * would turn with the body, so `.mo-eyes` takes `uprightTransform`, which undoes
 * `rot` and the squash about the body centre in proportion to `Act.upright`.
 */

interface Ring {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface UprightLayout extends Posable {
  body: Ring & { sides?: number };
  face: Ring;
}

/**
 * The share of a safe disc the fit fills, the same 0.9 `faceFit` packs the
 * static eyes into. The round superellipse (`n` down to 1.9) dips to 0.982 of
 * its face ellipse at 45°, so 0.9 leaves at least 8% of the radius as margin
 * for the gaze and saccade travel the fit does not model.
 */
const BUDGET = 0.9;

/**
 * The radius of a disc about the body centre that lies inside the body.
 *
 * The face ellipse is each silhouette's declared safe region, and a disc about
 * the body centre fits in it by its short semi-axis less the distance between
 * the two centres. A polygon declares a face far inside its outline, so its
 * inradius is taken too: `polygon` is an affine image of a regular one with
 * circumradii `rx`/`ry`, its rounding stays outside the incircle, and the
 * incircle maps to an ellipse holding `cos(π/sides)·min(rx, ry)`.
 */
function room({ body, face }: UprightLayout): number {
  const fromFace = Math.min(face.rx, face.ry) - Math.hypot(face.cx - body.cx, face.cy - body.cy);
  const fromPolygon = body.sides ? Math.cos(Math.PI / body.sides) * Math.min(body.rx, body.ry) : 0;
  return BUDGET * Math.max(fromFace, fromPolygon);
}
const SAMPLES = 64;

let posesMemo: Pose[] | null = null;

/**
 * Every eye pose an upright state shows over a full cycle. None of them takes
 * an expression; one that did would need the roster here too.
 */
function uprightPoses(): Pose[] {
  if (posesMemo) return posesMemo;
  const out: Pose[] = [];
  for (const c of Object.values(CHOREO)) {
    const span = c.period ?? c.duration;
    for (let i = 0; i < SAMPLES; i++) {
      const t = (i / SAMPLES) * span;
      if (c.act(t).upright > 0) out.push(c.eyes(t).pose);
    }
  }
  return (posesMemo = out);
}

/** The farthest corner of either eye's bounding box from the body centre. */
function reach(l: UprightLayout, p: Pose): number {
  let far = 0;
  for (const e of bakePose(l, p).l.eyes) {
    const t = (e.rot * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    for (const [u, v] of [[e.rx, e.ry], [e.rx, -e.ry], [-e.rx, e.ry], [-e.rx, -e.ry]] as const) {
      const d = Math.hypot(e.cx + u * c - v * s - l.body.cx, e.cy + u * s + v * c - l.body.cy);
      if (d > far) far = d;
    }
  }
  return far;
}

const fits = new WeakMap<object, number>();

/**
 * The scale about the body centre that keeps a level face inside a body
 * turned to any angle, in (0, 1]; 1 for a seed whose eyes already clear.
 *
 * A capsule lies inside its bounding box, so it stays inside the body at every
 * angle once the box's farthest corner from the body centre is within a disc
 * about that centre that is itself inside the body (`room`). Scaling about the
 * centre narrows the gap between the eyes by the same factor as their size,
 * so it cannot fuse them.
 *
 * Solved once per layout, against every pose an upright state shows, so the
 * factor is a constant of the seed and never moves on screen.
 */
export function uprightFit(l: UprightLayout): number {
  const hit = fits.get(l);
  if (hit !== undefined) return hit;
  const safe = room(l);
  let far = 0;
  for (const p of uprightPoses()) far = Math.max(far, reach(l, p));
  const k = far > safe ? safe / far : 1;
  fits.set(l, k);
  return k;
}

/**
 * The `.mo-eyes` transform inside `actTransform`'s group, or `""` when the act
 * keeps no face level.
 *
 *   translate(cx, cy) rotate(−rot·u) scale(m/sx^u, m/sy^u) translate(−cx, −cy)
 *
 * with `u = act.upright` and `m = 1 + (fit − 1)·u`. At `u = 1` it composes with
 * the act to translate(offset) scale(s·fit) about the centre: bloub's eye, with
 * no rotation and no squash. Partway through a hand-back the eyes turn by
 * `rot·(1 − u)`, which is 0 at both ends of the blend.
 */
export function uprightTransform(act: Act, fit: number, cx: number, cy: number): string {
  const u = act.upright;
  if (u <= 0) return "";
  const m = 1 + (fit - 1) * u;
  return (
    `translate(${r3(cx)} ${r3(cy)})` +
    ` rotate(${r3(-act.rot * u)})` +
    ` scale(${r3(m / act.sx ** u)} ${r3(m / act.sy ** u)})` +
    ` translate(${r3(-cx)} ${r3(-cy)})`
  );
}
