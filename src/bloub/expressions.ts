/**
 * Ported verbatim from bloub (https://github.com/jeremyPerret/bloub),
 * MIT License, Copyright (c) 2026 Jérémy Perret.
 *
 * Named face expressions (gaze, eye shape) and their blending. Not adapted — see ../engine.ts for the bolota-specific bridge
 * (seed-to-silhouette conversion, DOM mounting, rAF loop). This file's
 * own logic and structure are untouched beyond TS-strict fixes, import
 * paths, and translating the original French comments/identifiers to
 * English (see ../engine.ts's header for the provenance note) — including
 * the `ExpressionId` picker names, now the English names below rather than
 * the French originals (`neutre`, `attentif`, `surpris`, `excite`,
 * `heureux`, `hilare`, `colere`, `triste`, `effraye`, `mefiant`, `confus`,
 * `curieux`, `fier`, `timide`, `blase`, `somnolent`).
 *
 * `wander` (the EXPRESSION below) is a bolota-specific divergence from that
 * verbatim port (same split as `idle`/`wander` in ../bloub/states.ts, the
 * STATE): bloub's own `neutre` carries `REST_GAZE` (yaw +28.49, pitch
 * +28.62) as its gaze, which is the pose fitted off the reference video's
 * resting frame — both eyes land on the SAME side of the face's vertical
 * axis (`eyePoses(REST_GAZE, 1)` gives x = +0.19 and +0.62, not a mirrored
 * pair around 0), a sideways glance, not a forward gaze. Upstream this is
 * what `neutre` means, so it kept its eye/split shape under its own id.
 *
 * That id is `wander` (owner's later request, superseding the id this used
 * to ship under, `aside`) — yes, the same string as the STATE `wander` in
 * ../bloub/states.ts (the drift choreography). This is a DELIBERATE
 * collision, not an oversight: the two are separate namespaces with
 * separate lookups (`handle.states`/`play()` for the state,
 * `handle.expressions`/`setExpression()` for the expression), so nothing
 * needs disambiguating at the call site — `play('wander')` and
 * `setExpression('wander')` each resolve unambiguously in their own map and
 * do not touch each other's state (`EXPRESSION_BY_ID` here vs `STATE_BY_ID`
 * in ../bloub/states.ts). Setting the expression never changes which state
 * is playing, and playing the state never changes the held expression. See
 * `../../test/engine-expressions.test.ts`'s "wander id collision" group for
 * the test pinning that isolation.
 *
 * There is deliberately no `neutral` entry in the roster below. A short-
 * lived version of this file had one (a true zero `HeadGaze`, meant to read
 * as "gaze straight ahead"), but that duplicated the `idle` STATE
 * (../bloub/states.ts) instead of composing with it: the base/default face
 * was reachable two ways that could drift apart. Collapsed into one: `idle`
 * (no expression set) IS the straight-ahead resting face now — see its own
 * doc comment in ../bloub/states.ts — and `setExpression(null)` is what
 * returns to it from any other held expression. No `DEFAULT_EXPRESSION`
 * either, for the same reason: "no expression" already means idle's face,
 * so a default id would just be a second name for the same thing.
 */
import { EYE_H, EYE_SPLIT, EYE_W, REST_GAZE, type HeadGaze } from './face'
import { lerp } from './math'
import type { EyeCfg } from './states'

/**
 * The bot's resting expression.
 *
 * The face is only two capsules, so everything rides on four levers: head
 * orientation, eye separation, their proportions, and each eye's own tilt.
 * It's this last one that makes anger and sadness possible: they need
 * MIRRORED tilts (the tops converging or diverging), which is impossible
 * with head roll alone, since that tilts both eyes the same way.
 *
 * Only the resting state carries this expression. The video's expressive
 * states (wink, wide eyes, notification) keep their own: that's the one
 * we came to reproduce.
 *
 * The amplitudes lean on bible-strong-avatar-lab, which exposes the same
 * model (head X/Y/Z, width and height per eye, separation, angle per eye):
 * there, width ranges 0.8 to 2.7 times neutral, height 0.3 to 1.5, and
 * angles up to ±80°. This stays within that envelope.
 */
/** Enumerated so the i18n layer checks their translations at compile time. */
export type ExpressionId =
  | 'wander'
  | 'attentive'
  | 'surprised'
  | 'excited'
  | 'happy'
  | 'laughing'
  | 'angry'
  | 'sad'
  | 'scared'
  | 'suspicious'
  | 'confused'
  | 'curious'
  | 'proud'
  | 'shy'
  | 'unimpressed'
  | 'sleepy'
  | 'love'

export interface BotExpression {
  id: ExpressionId
  gaze: HeadGaze
  split: number
  eyes: [EyeCfg, EyeCfg]
}

/** `tilt` in degrees, positive = the top of the capsule leans right. */
const eye = (w: number, h: number, tilt = 0, open = 1): EyeCfg => ({ w, h, tilt, open })

/** Both eyes identical, mirrored tilts if `tilt` is given. */
const pair = (w: number, h: number, tilt = 0, open = 1): [EyeCfg, EyeCfg] => [
  eye(w, h, tilt, open),
  eye(w, h, -tilt, open)
]

export const EXPRESSIONS: BotExpression[] = [
  {
    // bloub's own `neutre`: the pose measured frame by frame off the
    // reference video — a sideways glance (`REST_GAZE`), not a forward
    // gaze. Kept under its own id rather than dropped: it's still the
    // exact upstream-measured pose and may read as "looking away" /
    // wandering off intentionally. Deliberately shares its id with the
    // `wander` STATE (../bloub/states.ts) — see this file's header comment.
    id: 'wander',
    gaze: { ...REST_GAZE },
    split: EYE_SPLIT,
    eyes: [eye(EYE_W, EYE_H), eye(EYE_W, EYE_H)]
  },
  {
    id: 'attentive',
    gaze: { yaw: 4, pitch: 5, roll: -4 },
    split: 16,
    eyes: pair(0.21, 0.44)
  },
  {
    id: 'surprised',
    gaze: { yaw: 3, pitch: -3, roll: 0 },
    split: 19,
    eyes: pair(0.45, 0.47)
  },
  {
    id: 'excited',
    gaze: { yaw: 6, pitch: -14, roll: 0 },
    split: 19.5,
    eyes: pair(0.4, 0.56, -10)
  },
  {
    // eyes squinted into an arc: the tops converge slightly
    id: 'happy',
    gaze: { yaw: 5, pitch: 9, roll: 0 },
    split: 17,
    eyes: pair(0.27, 0.17, 14)
  },
  {
    id: 'laughing',
    gaze: { yaw: 4, pitch: 14, roll: 0 },
    split: 18,
    eyes: pair(0.34, 0.13, 20)
  },
  {
    // eye tops converge sharply toward center + eyes narrowed
    id: 'angry',
    gaze: { yaw: 3, pitch: 7, roll: 0 },
    split: 17,
    eyes: pair(0.34, 0.15, 30)
  },
  {
    // the opposite: the tops diverge, and the gaze drops
    id: 'sad',
    gaze: { yaw: 3, pitch: -13, roll: 0 },
    split: 16,
    eyes: pair(0.22, 0.4, -28)
  },
  {
    id: 'scared',
    gaze: { yaw: 2, pitch: -20, roll: 0 },
    split: 20.5,
    eyes: pair(0.4, 0.6)
  },
  {
    // one eye noticeably more closed than the other
    id: 'suspicious',
    gaze: { yaw: 12, pitch: 6, roll: -6 },
    split: 16,
    eyes: [eye(0.21, 0.4), eye(0.22, 0.15)]
  },
  {
    // asymmetric on both axes: sizes AND tilts mismatched.
    // The squinted eye is deliberately flat (ratio 1.6): at a ratio close
    // to 1 it would read round, and its tilt wouldn't show.
    id: 'confused',
    gaze: { yaw: -14, pitch: 3, roll: 8 },
    split: 16.5,
    eyes: [eye(0.2, 0.44, -18), eye(0.28, 0.17, 14)]
  },
  {
    // the head tilts: it's the roll that carries the curiosity
    id: 'curious',
    gaze: { yaw: 16, pitch: -9, roll: -15 },
    split: 16.5,
    eyes: [eye(0.24, 0.46, -8), eye(0.2, 0.38, -8)]
  },
  {
    id: 'proud',
    gaze: { yaw: 5, pitch: 17, roll: 0 },
    split: 17,
    eyes: pair(0.3, 0.15, 18)
  },
  {
    id: 'shy',
    gaze: { yaw: -19, pitch: -14, roll: -7 },
    split: 14,
    eyes: pair(0.17, 0.3)
  },
  {
    // horizontal slits and a gaze that drifts to the side
    id: 'unimpressed',
    gaze: { yaw: -22, pitch: 2, roll: 0 },
    split: 16,
    eyes: pair(0.3, 0.12)
  },
  {
    // half-lowered eyelids: routed through `open`, so the same vertical
    // on-screen squash mechanism as blinking
    id: 'sleepy',
    gaze: { yaw: 6, pitch: -9, roll: -3 },
    split: 16,
    eyes: pair(0.2, 0.42, 0, 0.42)
  },
  {
    // Recovered, not invented: this fork's pre-bloub ancestor (the
    // `blobatar` package, before the bloub engine port) had its own
    // roster-2 `love` pose. It never made it into THIS roster (the bloub
    // port never carried the old expression system's poses over at all —
    // this file's 16 are bloub's own, translated, not blobatar's), but the
    // original definition is not lost: it is still live, byte-identical,
    // at `../expression.ts:678` — a separate, still-shipped, non-bloub
    // expression system this package also exports (`Expression`/`Pose`,
    // not this file's `BotExpression`), untouched by the bloub port.
    // Sourced from there and cross-checked against git history at
    // `packages/blobatar/src/expression.ts`, commit 02da3bc ("feat: adding
    // 9 new expressions") — the two agree exactly. That file's own doc
    // comment on `love` reads:
    // "Tall narrow eyes, drawn together, lifted, and rose." — the upstream
    // pose there is `{ esx: 0.86, esy: 1.28, tilt: -14, edy: -0.5,
    // edx: -0.35, ... }` plus `tint: (pal, p) => tintWith(pal, p, ROSE)`,
    // on a differently-shaped model (capsule scale/offset deltas relative
    // to an identity pose, not this file's absolute `w`/`h`/`gaze`/`split`).
    // Ported here by channel MEANING, not by number:
    //  - esx/esy (width/height scale off identity) -> w/h scaled off this
    //    file's own identity eye size (`EYE_W` 0.186, `EYE_H` 0.412):
    //    0.186*0.86 ≈ 0.16, 0.412*1.28 ≈ 0.53 — narrower AND taller than
    //    every other entry in this roster (nothing else pairs a sub-0.2
    //    width with a 0.5+ height), which is the same "the shape itself
    //    reads as love, not just the tint" property the upstream doc
    //    comment argues for against `surprised`.
    //  - edx (negative = drawn together) -> a `split` below this roster's
    //    ~16-17 norm, short of `shy`'s most-converged 14 (upstream's own
    //    edx magnitude, -0.35, sits under `surprised`'s +0.5 spread).
    //  - edy (negative = lifted) -> a positive `gaze.pitch` (this file's
    //    convention: `sad` at pitch -13 "drops", so positive lifts),
    //    modest like upstream's own -0.5 amplitude (smaller than `happy`'s
    //    lift).
    //  - tilt -> a modest converging (positive, mirrored) tilt, distinct
    //    from `happy`'s 14 and `angry`'s 30: love's convergence is carried
    //    mainly by shape/split above, tilt is the smallest contributor.
    // TINT GAP: upstream's `love` is also `ROSE`-tinted (`tintWith`), and
    // this file's `BotExpression` has no tint/color channel to carry that
    // — `gaze`/`split`/`eyes` are the whole pose shape here (see
    // `BotExpression` above). Geometry only; the color half of upstream's
    // pose has nowhere to land until this engine grows one.
    id: 'love',
    gaze: { yaw: 4, pitch: 7, roll: 0 },
    split: 15,
    eyes: pair(0.16, 0.53, 10)
  }
]

export const EXPRESSION_BY_ID = new Map<string, BotExpression>(EXPRESSIONS.map((e) => [e.id, e]))

const lerpEyeCfg = (a: EyeCfg, b: EyeCfg, t: number): EyeCfg => ({
  w: lerp(a.w, b.w, t),
  h: lerp(a.h, b.h, t),
  tilt: lerp(a.tilt ?? 0, b.tilt ?? 0, t),
  open: lerp(a.open, b.open, t)
})

/** Interpolates two expressions: the change happens as a glide. */
export function blendExpression(a: BotExpression, b: BotExpression, t: number): BotExpression {
  return {
    id: b.id,
    gaze: {
      yaw: lerp(a.gaze.yaw, b.gaze.yaw, t),
      pitch: lerp(a.gaze.pitch, b.gaze.pitch, t),
      roll: lerp(a.gaze.roll, b.gaze.roll, t)
    },
    split: lerp(a.split, b.split, t),
    eyes: [lerpEyeCfg(a.eyes[0], b.eyes[0], t), lerpEyeCfg(a.eyes[1], b.eyes[1], t)]
  }
}
