/**
 * Ported verbatim from bloub (https://github.com/jeremyPerret/bloub),
 * MIT License, Copyright (c) 2026 Jérémy Perret.
 *
 * Eye placement on the body sphere, blink and idle-life math. Not adapted — see ../engine.ts for the bolota-specific bridge
 * (seed-to-silhouette conversion, DOM mounting, rAF loop). This file's
 * own logic and structure are untouched beyond TS-strict fixes, import
 * paths, and translating the original French comments/identifiers to
 * English (see ../engine.ts's header for the provenance note).
 */
import { clamp, createRng, loopNoise } from './math'

/**
 * The eyes are painted on a sphere, not laid flat.
 *
 * Measured off the video: the eye closest to the edge is 0.69 times the
 * width of the other, and its area 0.663 times — exactly the depth factor
 * (z = 0.669) of a point on a sphere at that distance from the center. So
 * this models a real head orientation: each eye picks up the sphere's
 * tangent frame, projected orthographically. The compression and tilt fall
 * out on their own, which is what gives it volume.
 *
 * The constants below aren't hand-picked: they come from fitting the model
 * to positions and sizes measured frame by frame (residual error ~1 px on a
 * 190 px radius).
 */

type Vec3 = [number, number, number]

/** Half-separation of the eyes on the sphere, in degrees (total separation ~31deg). */
export const EYE_SPLIT = 15.46
/** Resting eye size, in units of ball radius. */
export const EYE_W = 0.186
export const EYE_H = 0.412

/** Resting head orientation, fitted on the reference frames. */
export const REST_GAZE: HeadGaze = { yaw: 28.49, pitch: 28.62, roll: -13 }

export interface EyePose {
  x: number
  y: number
  /** 2x2 tangent matrix: [a b c d] in the SVG matrix(a,b,c,d,e,f) sense */
  a: number
  b: number
  c: number
  d: number
  /** z component of the normal: > 0 = face visible */
  depth: number
}

export interface HeadGaze {
  /** yaw, degrees, positive = looking right */
  yaw: number
  /** pitch, degrees, positive = looking up */
  pitch: number
  /** roll, degrees, head tilt */
  roll: number
}

const deg = (d: number) => (d * Math.PI) / 180

/** Rotates two vectors of an orthonormal frame within their shared plane. */
function spin(u: Vec3, v: Vec3, angle: number): [Vec3, Vec3] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [
    [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s],
    [v[0] * c - u[0] * s, v[1] * c - u[1] * s, v[2] * c - u[2] * s]
  ]
}

/**
 * Frame of the head, then of the two eyes.
 * Screen frame: x to the right, y down, z toward the viewer.
 * Index 0 is the inner eye, index 1 the outer eye.
 */
export function eyePoses(gaze: HeadGaze, scale: number, split = EYE_SPLIT): [EyePose, EyePose] {
  let f: Vec3 = [0, 0, 1]
  let right: Vec3 = [1, 0, 0]
  let down: Vec3 = [0, 1, 0]

  // yaw: forward tilts toward right
  ;[f, right] = spin(f, right, deg(gaze.yaw))
  // pitch: forward tilts up (so away from down)
  ;[down, f] = spin(down, f, deg(gaze.pitch))
  // roll: the head tilts within its own plane
  ;[right, down] = spin(right, down, deg(gaze.roll))

  const build = (side: number): EyePose => {
    const [ef, er] = spin(f, right, deg(split * side))
    return {
      x: ef[0] * scale,
      y: ef[1] * scale,
      a: er[0],
      b: er[1],
      c: down[0],
      d: down[1],
      depth: ef[2]
    }
  }

  return [build(-1), build(1)]
}

/**
 * Idle life: slow gaze drift, saccades, blinks.
 *
 * A pure function of time (no internal state), so pause, resume and
 * jumping to an arbitrary date always give the same image. The values are
 * OFFSETS to add to the current state's pose.
 */
export interface Liveliness {
  dYaw: number
  dPitch: number
  dRoll: number
  /** 1 = eye open, 0 = closed (vertical squash in screen space) */
  lid: number
  driftX: number
  driftY: number
  breath: number
}

const BLINK_RNG = createRng(0x5eed)
/** Pre-drawn blink schedule: deterministic and stateless. */
const BLINKS: number[] = (() => {
  const out: number[] = []
  let t = 1.4
  while (t < 900) {
    out.push(t)
    // 1.9 to 4.6s between two blinks, plus an occasional double blink
    t += 1.9 + BLINK_RNG() * 2.7
    if (BLINK_RNG() < 0.18) {
      out.push(t)
      t += 0.24
    }
  }
  return out
})()

/** Measured: 1 to 2 frames at 10 fps. */
const BLINK_DUR = 0.18

function blinkLid(t: number): number {
  for (let i = 0; i < BLINKS.length; i++) {
    const start = BLINKS[i]!
    if (t < start) break
    const k = (t - start) / BLINK_DUR
    if (k >= 0 && k <= 1) {
      // fast closing, slightly slower reopening
      return k < 0.45 ? 1 - k / 0.45 : (k - 0.45) / 0.55
    }
  }
  return 1
}

export interface LivelinessOptions {
  wander?: number
  blink?: boolean
  float?: boolean
}

/**
 * bolota divergence from the bloub port: the four amplitude terms below (feeding
 * `dYaw`/`dPitch`/`dRoll`) were measured off bloub's own reference video at
 * 5.5+1.6deg yaw, 4.2+1.3deg pitch, 2.2deg roll — correct for THAT video, but user
 * testing on bolota avatars called the resulting idle drift "stuck... they move but
 * subtle movement, we need more."
 *
 * Round 1 raised these ~2.2x (yaw 7.1deg -> 16.1deg, pitch 5.5deg -> 12.4deg, roll
 * 2.2deg -> 4.8deg; measured 10s eye-center path 50.96 -> 112.50 viewBox units).
 * Round 2 verdict: still not enough, and x-travel (82.78) visibly led y-travel
 * (61.90, ratio 1.34) — the old 16.1/12.4 yaw/pitch split.
 *
 * What actually gates this is NOT the 10s window, it's `eyefit.ts`'s anchor solve:
 * `offsetFor` covers the worst case by testing gaze at the FOUR corners of
 * (+-MAX_YAW_DRIFT, +-MAX_PITCH_DRIFT) — a bound that (per this file's own earlier
 * comment) `loopNoise`'s two summed terms genuinely reach, given enough time
 * (incommensurate periods -> arbitrarily close recurrence, not a paranoid
 * overestimate). Long sweeps (600s-1800s, 5 baseBody states x 3 realistic seed
 * profiles spanning the real `body.n`/squash range from `styles/shapes.ts`)
 * confirmed this empirically: round 1's exact 16.1/12.4 sits right at that solver's
 * feasibility cliff for the tightest combo (`notify`'s large capsule eyes on a
 * squashed, high-exponent seed) — a further amplitude increase of as little as 2%
 * flips the solve infeasible (measured overflow ratio jumping past 1.7, not a
 * graceful degradation). Amplitude is NOT the free lever it looks like.
 *
 * Period, on the other hand, turned out to be almost entirely free: the same long
 * sweeps showed the worst-case containment ratio is amplitude-gated only — moving
 * from the original periods to noticeably shorter ones at the SAME amplitude left
 * the worst ratio unchanged (0.835 -> 0.830 over 600s) while nearly doubling 10s
 * travel on its own. So round 2 spends its budget on period, not amplitude, and
 * only redistributes amplitude (yaw down a hair, pitch up) to equalize the x/y
 * split rather than grow the total drift bound much at all:
 *
 * - yaw/pitch sums brought to near-equal (16.0 / 16.0, was 16.1 / 12.4) — small
 *   step up for pitch, imperceptible step down for yaw, tested safe with real
 *   margin (worst containment ratio 0.875 over 600s, 0.873 over 1800s — i.e. it
 *   converges, it does not keep creeping toward 1).
 * - periods roughly halved (11.3/3.7 -> 6.0/1.8 yaw, 9.1/4.3 -> 5.1/2.1 pitch,
 *   13.7/3.2 -> 7.3/3.2 roll): same smooth 3-term `loopNoise` sum, just cycling
 *   faster — more frequent glances, not jitter (`loopNoise` has no added noise
 *   term, just a shorter period on the same sinusoid sum).
 *
 * Measured 10s eye-center path at these values: 112.50 -> 252.48 (x 82.78 -> 166.90,
 * y 61.90 -> 158.13 — x/y now 1.06, was 1.34).
 *
 * `eyefit.ts`'s `DERIVE_YAW`/`DERIVE_PITCH` import `MAX_YAW_DRIFT`/`MAX_PITCH_DRIFT`
 * below rather than restating these sums, so the anchor-correction coverage always
 * matches the amplitude actually in play here — see that file's comment on why a
 * stale copy there is exactly the bug this whole module exists to prevent.
 */
const WANDER_YAW_SLOW = 12.4
const WANDER_YAW_FAST = 3.6
const WANDER_PITCH_SLOW = 12.3
const WANDER_PITCH_FAST = 3.7
const WANDER_ROLL = 5.2

/** Exported so `eyefit.ts` can bound its correction table on the real amplitude. */
export const MAX_YAW_DRIFT = WANDER_YAW_SLOW + WANDER_YAW_FAST
export const MAX_PITCH_DRIFT = WANDER_PITCH_SLOW + WANDER_PITCH_FAST

export function liveliness(t: number, opt: LivelinessOptions = {}): Liveliness {
  const { wander = 1, blink = true, float = true } = opt

  // Mutually incommensurate periods: the drift never visibly repeats.
  return {
    dYaw: (loopNoise(t, 6.0, 0.4) * WANDER_YAW_SLOW + loopNoise(t, 1.8, 2.1) * WANDER_YAW_FAST) * wander,
    dPitch:
      (loopNoise(t, 5.1, 1.3) * WANDER_PITCH_SLOW + loopNoise(t, 2.1, 0.7) * WANDER_PITCH_FAST) * wander,
    dRoll: loopNoise(t, 7.3, 3.2) * WANDER_ROLL * wander,
    lid: blink ? blinkLid(t) : 1,
    // At rest the video is nearly motionless (center stable to +-0.003, radius
    // constant): all the life comes from the gaze and the blinks. Just enough
    // is kept here to avoid a fully frozen image.
    driftX: float ? loopNoise(t, 7.9, 1.9) * 0.006 : 0,
    driftY: float ? loopNoise(t, 5.3, 0.3) * 0.007 : 0,
    // bolota divergence: breathing now tracks `blink`, not `float`. Both are
    // baseline life signs (per the user's own pairing: "blink + breathe
    // still alive") independent of ambient WANDER/drift, which a state can
    // legitimately suppress (`idle`'s new "no-state" meaning, `orbit`
    // driving its own position) without going lifeless — a still face still
    // breathes and blinks. Gated on the same thing `blink` already is
    // (`alive`, the caller's own eyeAlpha check), not a new flag.
    // The width stays constant; only the height breathes very slightly.
    breath: blink ? 1 + Math.sin((t / 3.4) * Math.PI * 2) * 0.005 : 1
  }
}

/**
 * The blink is a VERTICAL squash in screen space around the eye's center
 * (measured: the bbox width is preserved, the height drops to ~0.35), not a
 * narrowing along the capsule's own tilted axis. It's therefore composed
 * after the tangent matrix, affecting only the y outputs.
 */
export function blinkScale(lid: number): number {
  return 0.06 + 0.94 * clamp(lid)
}
