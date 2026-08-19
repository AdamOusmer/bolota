// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Ported from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

/**
 * Ported verbatim from bloub (https://github.com/jeremyPerret/bloub),
 * MIT License, Copyright (c) 2026 Jérémy Perret.
 *
 * Per-state, per-shape eye-offset correction table. Not adapted — see ../engine.ts for the bolota-specific bridge
 * (seed-to-silhouette conversion, DOM mounting, rAF loop). This file's
 * own logic and structure are untouched beyond TS-strict fixes, import
 * paths, and translating the original French comments/identifiers to
 * English (see ../engine.ts's header for the provenance note).
 */
/**
 * Where to place the face on a personalizer shape.
 *
 * The eyes live on a sphere, and `radiusAtAngle` glues their CENTER to the
 * real outline, pro-rated by the local radius. That pro-rating places the
 * center correctly, but the eye has a size: the margin left in front of the
 * edge is multiplied by the same factor, so a silhouette narrow in that
 * direction pushes it against the edge until the mask opens outward. The
 * capsule showed up as a notch cut into the body on `capsule`, `triangle`,
 * `cloud` and `drop`.
 *
 * This module solves the problem ONCE, at load time, and renders an
 * offset table. That choice is the heart of the fix, far more than the
 * geometry that follows:
 *
 * Solved inside the render loop, the correction reacts to everything moving
 * at sixty frames a second — gaze drift, the pointer, the expression
 * mid-morph, the nearest edge changing, the most constrained eye changing.
 * Seven variants were written that way and every one produced a visible
 * motion artifact: constant jitter, a 26-unit direction jump when the
 * reference edge flipped, a sudden zoom when size entered the calculation.
 * The flaw wasn't in any of their geometries, it was in solving per frame.
 *
 * The rest of the engine doesn't work that way: poses are DECLARED and it
 * only interpolates them along known curves. A tabulated offset fits that
 * mold. It doesn't move when the gaze drifts or the pointer moves, and on a
 * shape or expression change it only moves from one table entry to another,
 * along that morph's curve. Jitter becomes impossible by construction,
 * instead of merely pushed back: interpolating between two constants is
 * monotone, while re-solving the problem on a gaze mid-interpolation is not.
 *
 * Pleasant corollary: the solver no longer has any continuity constraint,
 * since it doesn't run during the animation. So it can probe a whole fan of
 * directions and cover the worst case of the gaze drift, which a per-frame
 * version couldn't afford.
 *
 * The table is a module-level constant, built at import time from pure
 * data: same nature as `face.ts`'s blink schedule, deterministic and
 * stateless, so it has no effect on the purity of `engine.sample(t)`.
 */

import { EXPRESSIONS, type BotExpression } from './expressions'
import { eyePoses, MAX_PITCH_DRIFT, MAX_YAW_DRIFT } from './face'
import { radiusAtAngle, toPoints, type Point } from './shape'
import { SHAPES } from './skins'
import { STATE_BY_ID, STATES, type Pose, type StateDef, type StateId } from './states'

/** Solver's reference radius. The rendered offset is in units of this radius. */
const R = 100

/**
 * Maximum amplitudes of idle life, read off `liveliness`: `loopNoise` is
 * bounded to 1 in absolute value, so these sums are exact bounds, not
 * estimates.
 *
 * They must be covered, otherwise the correction is only right on the
 * nominal pose and goes wrong a second later: 7 degrees of yaw move the eye
 * about a dozen units on a ball of radius 100. That's precisely what made
 * `capsule` + `scared` overflow while a single-instant measurement declared
 * it fine.
 *
 * bolota divergence: imported from `face.ts` instead of restated as local literals.
 * The idle wander amplitude was raised there (bug report: gaze drift read as barely
 * moving) and a hand-copied constant here would silently stop bounding the real
 * amplitude the moment the two drift — which is exactly the failure mode this comment
 * warns about, just self-inflicted instead of a bloub upstream change.
 */
const DERIVE_YAW = MAX_YAW_DRIFT
const DERIVE_PITCH = MAX_PITCH_DRIFT
/** Center wobble, in units of ball radius. */
const DERIVE_X = 0.006
const DERIVE_Y = 0.007

/** A pose's face: what the solver needs to place its capsules. */
interface Face {
  gaze: Pose['gaze']
  split: number
  eyes: Pose['eyes']
}

/**
 * A capsule ready to be measured: its axis segment, and what's needed to
 * compute the radius to clear IN A GIVEN DIRECTION.
 *
 * A capsule is exactly a segment thickened by a disk of radius `r`. Its
 * image under the tangent matrix is therefore a segment thickened by an
 * ELLIPSE, and the radius to clear depends on direction: it's that
 * ellipse's support function, `r * |A^T u|`.
 *
 * Taking its largest singular value instead would be conservative but wrong
 * in the one direction that matters, and it costs dearly: the reference
 * margin on the circle came out NEGATIVE, so the requirement lost its teeth
 * and 34 combinations kept overflowing.
 */
interface Footprint {
  /** center, in viewBox units */
  x: number
  y: number
  /** axis half-vector */
  ax: number
  ay: number
  /** local disk radius, before transform */
  r: number
  /** tangent matrix columns, for the support function */
  m: [number, number, number, number]
}

/**
 * Footprints of a face's two eyes, laid onto a profile.
 *
 * A capsule is exactly a segment thickened by a disk of radius `r`. Its
 * image under the tangent matrix is therefore a segment thickened by an
 * ELLIPSE, and a disk of its major-axis radius covers it: hence the largest
 * singular value. The measurement stays strictly conservative that way, a
 * positive margin guaranteeing the capsule is inside.
 *
 * The blink isn't accounted for: a closed eye doesn't need room made for it.
 */
function footprints(face: Face, sil: Pose['sil'], radii: number[]): Footprint[] {
  const out: Footprint[] = []
  const poses = eyePoses(face.gaze, R, face.split)
  for (let i = 0; i < 2; i++) {
    const e = poses[i]!
    if (e.depth <= 0.02) continue
    const cfg = face.eyes[i]!
    const phi = ((cfg.tilt ?? 0) * Math.PI) / 180
    const cp = Math.cos(phi)
    const sp = Math.sin(phi)
    const ax = e.a * cp + e.c * sp
    const ay = e.b * cp + e.d * sp
    const cx = -e.a * sp + e.c * cp
    const cy = -e.b * sp + e.d * cp

    const hw = Math.max(cfg.w * R, 0.01) / 2
    const hh = Math.max(cfg.h * R, 0.01) / 2
    const r = Math.min(hw, hh)
    // the axis is that of the larger dimension
    const isLong = hh > hw
    const half = isLong ? hh - r : hw - r
    // the local radius pro-rating, exactly as the engine does it
    const fit = radiusAtAngle(radii, Math.atan2(e.y, e.x) - sil.rot)
    out.push({
      x: e.x * fit,
      y: e.y * fit,
      ax: (isLong ? cx : ax) * half,
      ay: (isLong ? cy : ay) * half,
      r,
      m: [ax, ay, cx, cy]
    })
  }
  return out
}

/**
 * Shortest approach between an outline and a segment: the distance, and the
 * vector pointing from the outline toward the segment — the clearing
 * direction.
 *
 * Both come out of the SAME pass. Computing them separately doubled this
 * module's one real cost, which is this sweep.
 */
function approach(pts: Point[], x0: number, y0: number, x1: number, y1: number) {
  const sx = x1 - x0
  const sy = y1 - y0
  const len2 = sx * sx + sy * sy
  let best = Infinity
  let vx = 0
  let vy = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    let t = len2 > 0 ? ((p.x - x0) * sx + (p.y - y0) * sy) / len2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const ex = x0 + t * sx - p.x
    const ey = y0 + t * sy - p.y
    const d2 = ex * ex + ey * ey
    if (d2 < best) {
      best = d2
      vx = ex
      vy = ey
    }
  }
  const d = Math.sqrt(best)
  return { d, ux: d > 1e-9 ? vx / d : 0, uy: d > 1e-9 ? vy / d : 0 }
}

/** A trial: capsules to fit inside an outline, and the reference outline. */
interface Trial {
  footprints: Footprint[]
  reference: Footprint[]
  contour: Point[]
  calContour: Point[]
}

/**
 * Center wobble at rest, in viewBox units. It's added to the capsule's
 * radius: less than a unit, so absorbing it this way costs less than
 * multiplying the trials by its four corners.
 */
const WANDER = Math.hypot(DERIVE_X, DERIVE_Y) * R

/** Tightest capsule margin, and the direction that clears it. */
function worst(pts: Point[], fps: Footprint[], tx: number, ty: number) {
  let margin = Infinity
  let ux = 0
  let uy = 0
  for (const e of fps) {
    const x = e.x + tx
    const y = e.y + ty
    const a = approach(pts, x - e.ax, y - e.ay, x + e.ax, y + e.ay)
    // the ellipse's support function in the approach direction
    const [m0, m1, m2, m3] = e.m
    const radius =
      e.r * Math.hypot(m0 * a.ux + m1 * a.uy, m2 * a.ux + m3 * a.uy) + WANDER
    if (a.d - radius < margin) {
      margin = a.d - radius
      ux = a.ux
      uy = a.uy
    }
  }
  return { margin, ux, uy }
}

/**
 * Directions probed and the bisection step count. Their product is the
 * table's build cost, the one number worth watching here.
 */
const DIRECTIONS = 12
const BISECTION = 8

/**
 * The offset to apply to both eyes for this shape, this state and this
 * expression.
 *
 * A TRANSLATION shared by both eyes, so an isometry: eye separation, sizes
 * and tilts are preserved to the pixel. The face is simply set a little
 * lower on a body that has no room up top, which is the move you'd make by
 * hand. Variants that bounded each eye separately pulled the pair apart,
 * and ones that scaled the face down shrank the eyes — visibly.
 *
 * The targeted margin is that of the ORIGINAL profile, not a strict
 * clearance: on the circle the outer eye already grazes the edge, 17.3
 * units for a ball of radius 100, and that's intentional, it's what gives
 * it volume. It's capped by what the shape offers at its center, otherwise
 * the requirement is untenable on a flat body.
 *
 * DIRECTIONAL SEARCH, not descent. We look for the smallest-norm
 * translation that holds, so we probe a ring of directions and bisect the
 * distance along each. A gradient descent was written first and it doesn't
 * converge: clearing the pair from one edge pulls it toward another, so it
 * hunts back and forth and only ever keeps its best attempt — cutting its
 * iterations from 40 to 18 was enough to bring back 34 overflows. Here the
 * result doesn't depend on convergence: each direction is solved exactly,
 * to within the bisection step.
 */
function solve(trials: Trial[]): { x: number; y: number } {
  if (!trials.length) return { x: 0, y: 0 }

  /** Tightest margin across all trials, for a given translation. */
  const margin = (tx: number, ty: number) => {
    let m = Infinity
    for (const tr of trials) m = Math.min(m, worst(tr.contour, tr.footprints, tx, ty).margin)
    return m
  }

  // Required margin: the tightest the original profile tolerates, across
  // all trials. Then capped by the most room the shape can offer the pair,
  // at its center.
  let required = Infinity
  for (const tr of trials) {
    required = Math.min(required, worst(tr.calContour, tr.reference, 0, 0).margin)
  }
  /*
   * The search must be able to reach the body's center: `wide` has capsules
   * 87 units long, and on a triangle they only fit toward the middle, some
   * fifty units from their nominal spot. A fixed search radius left them
   * outside.
   */
  let mx = 0
  let my = 0
  const fps = trials[0]!.footprints
  for (const e of fps) {
    mx -= e.x / fps.length
    my -= e.y / fps.length
  }
  const reach = Math.max(0.35 * R, Math.hypot(mx, my) * 1.25)

  // Cap on the requirement: what the shape offers at its center, always reachable.
  required = Math.min(required, margin(mx, my))

  /*
   * Already fine: the circle case, and any shape wide enough. The capsule
   * must FIT, in addition to being no tighter than on the original profile
   * — without that second condition, a shape where nothing fits satisfies
   * the first degenerately and we'd give up. `wide` has capsules 87 units
   * long, `notify` 50 units across: on a triangle or a drop they overflow
   * no matter what, and then the goal is the least-bad outcome, not giving up.
   */
  const start = margin(0, 0)
  if (start >= required && start >= 0) return { x: 0, y: 0 }
  const target = Math.max(required, 0)

  let bestX = 0
  let bestY = 0
  let bestNorm = Infinity
  // fallback when nothing fits: the translation that clears the most, probed along the way
  let fallbackX = 0
  let fallbackY = 0
  let fallback = start

  for (let d = 0; d < DIRECTIONS; d++) {
    const a = (d / DIRECTIONS) * Math.PI * 2
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    if (margin(ux * reach, uy * reach) < target) {
      // this direction leads nowhere; still keep the best clearance found
      // no solution this way, but maybe a better clearance
      for (const k of [0.3, 0.6, 1]) {
        const m = margin(ux * reach * k, uy * reach * k)
        if (m > fallback) {
          fallback = m
          fallbackX = ux * reach * k
          fallbackY = uy * reach * k
        }
      }
      continue
    }
    // shortest distance that holds, along this direction
    let lo = 0
    let hi = reach
    for (let i = 0; i < BISECTION; i++) {
      const mid = (lo + hi) / 2
      if (margin(ux * mid, uy * mid) >= target) hi = mid
      else lo = mid
    }
    if (hi < bestNorm) {
      bestNorm = hi
      bestX = ux * hi
      bestY = uy * hi
    }
  }

  const x = bestNorm === Infinity ? fallbackX : bestX
  const y = bestNorm === Infinity ? fallbackY : bestY
  // rendered in units of BALL RADIUS: the engine rescales it
  return { x: +(x / R).toFixed(6), y: +(y / R).toFixed(6) }
}

/**
 * The face to cover: the expression's if the state accepts it, its own
 * otherwise.
 *
 * ONE table entry per expression, not a single worst case shared by all.
 * A shared worst case looked safer — a constant offset can't move when the
 * expression changes — but it's untenable: on a capsule, `neutral` has the
 * eyes high and needs to move down while `scared` has them low and needs to
 * move up. No single translation satisfies both, and the measurement
 * confirms it (4 overflows of 4.8 units).
 *
 * An entry per expression is no less smooth for it: the engine interpolates
 * between TWO CONSTANTS, which is monotone by construction. What jittered
 * was re-solving the problem on a gaze mid-interpolation.
 */
function faceFrom(def: StateDef, pose: Pose, expr: BotExpression | null): Face {
  if (def.baseFace && expr) return { gaze: expr.gaze, split: expr.split, eyes: expr.eyes }
  return { gaze: pose.gaze, split: pose.split, eyes: pose.eyes }
}

/** Dates to sample within a state: a single one if its pose doesn't move. */
function sampleTimes(def: StateDef): number[] {
  /** Everything the solver uses: if nothing moves, one date is enough. */
  const signature = (p: Pose) =>
    JSON.stringify([p.gaze, p.split, p.eyes, p.sil.rot, p.sil.cx, p.sil.cy, p.sil.sx, p.sil.sy])
  if (signature(def.pose(0)) === signature(def.pose(def.duration))) return [0]
  const n = 3
  return Array.from({ length: n }, (_, i) => (i / (n - 1)) * def.duration)
}

/** A shape's offset for a state and an expression, drift included. */
function offsetFor(
  def: StateDef,
  radii: number[],
  expr: BotExpression | null
): { x: number; y: number } {
  const trials: Trial[] = []
  for (const t of sampleTimes(def)) {
    const pose = def.pose(t)
    const contour = toPoints({ ...pose.sil, radii }, R)
    const calContour = toPoints(pose.sil, R)
    const v = faceFrom(def, pose, expr)
    // The drift's four corners bound the nominal pose, which is their
    // center: testing it too wouldn't change any margin and costs one
    // trial in five.
    const corners: Face[] = []
    for (const dy of [-DERIVE_YAW, DERIVE_YAW]) {
      for (const dp of [-DERIVE_PITCH, DERIVE_PITCH]) {
        corners.push({
          ...v,
          gaze: { yaw: v.gaze.yaw + dy, pitch: v.gaze.pitch + dp, roll: v.gaze.roll }
        })
      }
    }
    for (const c of corners) {
      trials.push({
        footprints: footprints(c, pose.sil, radii),
        reference: footprints(c, pose.sil, pose.sil.radii),
        contour,
        calContour
      })
    }
  }
  return solve(trials)
}

/** Zero, the shared value for anything with nothing to correct. */
const NONE = { x: 0, y: 0 } as const

/** An entry's key: the state, and the expression when the state accepts it. */
const key = (state: StateId, expr: string | null) => `${state}|${expr ?? ''}`

/**
 * Offset table, built at import: one entry per (shape, base-body state,
 * expression). Only `idle` and `swirl` carry the resting face, so only they
 * get broken out by expression — the other three base-body states have a
 * face lifted straight off the video and a single entry.
 *
 * Keyed by REFERENCE on the radii array, which is already the engine's own
 * convention: its `radii === this.shape` and `expression === this.expr`
 * guards rest on that same stability. An unknown profile, or `null`,
 * corrects nothing — the API accepts any array and the engine shouldn't
 * have to depend on its callers' caution.
 */
function build(): Map<number[], Map<string, { x: number; y: number }>> {
  return new Map(
  SHAPES.map((shape) => {
    const byKey = new Map<string, { x: number; y: number }>()
    for (const def of STATES) {
      if (!def.baseBody) continue
      const expressions = def.baseFace ? [null, ...EXPRESSIONS] : [null]
      for (const expr of expressions) {
        byKey.set(key(def.id, expr?.id ?? null), offsetFor(def, shape.radii, expr))
      }
    }
    return [shape.radii, byKey]
  })
  )
}

const OFFSETS = build()

/**
 * bolota divergence from the bloub port: `build()` above only ever walks `SHAPES`,
 * bloub's own fixed 8-entry personalizer catalog. bolota seeds an arbitrary
 * superellipse per avatar (`engine.ts`'s `seededSilhouette`) — a `number[]` that is
 * never `===` any entry `build()` built, so `OFFSETS.get(radii)` always missed for a
 * real avatar and `eyeOffset` fell through to `NONE` unconditionally. The
 * correction this whole module exists for (see file header) was therefore dead code
 * for every seeded avatar: eyes rendered at the raw, uncorrected `radiusAtAngle` fit,
 * which is exactly the "stuck at the top/side" report — the fit that `eyefit.ts` was
 * built to patch, silently never running.
 *
 * Fix: solve the SAME way, just lazily and per (radii, state, expr) key instead of
 * eagerly for the whole catalog. Cost stays "solved once, not per frame" — the
 * invariant the rest of this file is built around (see the module doc comment) — it is
 * just once per *seed* the first time each state/expression combination is actually
 * sampled, instead of once at import for a fixed 8-shape catalog. A seed's `radii`
 * array is a stable reference for the engine's lifetime (only `setShape` replaces it,
 * with a fresh array), so the cache below hits on every frame after the first.
 */
function solveForKey(radii: number[], state: StateId, expr: string | null) {
  const def = STATE_BY_ID.get(state)
  if (!def || !def.baseBody) return NONE
  const exprDef = def.baseFace ? (EXPRESSIONS.find((e) => e.id === expr) ?? null) : null
  return offsetFor(def, radii, exprDef)
}

/**
 * Offset to apply to both eyes for this shape on this state, in units of
 * ball radius — the engine rescales it.
 *
 * Zero as soon as the shape isn't in the catalog AND hasn't been solved
 * yet, which covers `null` and the circle: on the circle both profiles are
 * the same, so the margin is already the required one and the search exits
 * on its first round. The shape lifted off the video therefore doesn't
 * move, with no special case.
 */
export function eyeOffset(
  radii: number[] | null,
  state: StateId,
  expr: string | null
): { x: number; y: number } {
  if (!radii) return NONE
  let byKey = OFFSETS.get(radii)
  // a state with no resting face has only one entry, whatever the expression
  const hit = byKey?.get(key(state, expr)) ?? byKey?.get(key(state, null))
  if (hit) return hit
  // Cache miss: not a catalog shape (or a catalog key not yet in this seed's lazily
  // built map — same map, filled on demand). Solve once for exactly this key.
  const value = solveForKey(radii, state, expr)
  if (!byKey) {
    byKey = new Map()
    OFFSETS.set(radii, byKey)
  }
  byKey.set(key(state, expr), value)
  return value
}

/** For tests: enough to check the table without redoing the geometry. */
/** For tests: enough to time the table's construction. */
export const FOR_TESTS = { build }
