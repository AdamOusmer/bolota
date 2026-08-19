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
 * `aside` is a bolota-specific divergence from that verbatim port (same
 * split as `idle`/`wander` in ../bloub/states.ts): bloub's own `neutre`
 * carries `REST_GAZE` (yaw +28.49, pitch +28.62) as its gaze, which is the
 * pose fitted off the reference video's resting frame — both eyes land on
 * the SAME side of the face's vertical axis (`eyePoses(REST_GAZE, 1)` gives
 * x = +0.19 and +0.62, not a mirrored pair around 0), a sideways glance, not
 * a forward gaze. Upstream this is what `neutre` means, but bolota's
 * `neutral` id is expected to read as "gaze straight ahead" (see
 * `setExpression`'s doc comment in ../engine.ts and this repo's use of
 * `neutral` as `DEFAULT_EXPRESSION`), so the two got renamed apart instead
 * of silently disagreeing: `neutral` below is a NEW entry with a true zero
 * `HeadGaze`, and bloub's original off-center pose kept its eye/split shape
 * under the id `aside` (not `wander` — that id already names a STATE in
 * ../bloub/states.ts, and reusing it for an expression would collide).
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
  | 'neutral'
  | 'aside'
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
    // true resting face: gaze dead ahead, both eyes mirrored around the
    // vertical axis. bolota addition — see this file's header comment for
    // why this isn't bloub's own `neutre` (that's `aside`, right below)
    id: 'neutral',
    gaze: { yaw: 0, pitch: 0, roll: 0 },
    split: EYE_SPLIT,
    eyes: [eye(EYE_W, EYE_H), eye(EYE_W, EYE_H)]
  },
  {
    // bloub's own `neutre`: the pose measured frame by frame off the
    // reference video — a sideways glance (`REST_GAZE`), not a forward
    // gaze. Kept under its own id rather than dropped: it's still the
    // exact upstream-measured pose and may read as "looking away/aside"
    // intentionally. See this file's header comment for the rename.
    id: 'aside',
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
  }
]

export const EXPRESSION_BY_ID = new Map<string, BotExpression>(EXPRESSIONS.map((e) => [e.id, e]))
export const DEFAULT_EXPRESSION = 'neutral'

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
