/**
 * Ported verbatim from bloub (https://github.com/jeremyPerret/bloub),
 * MIT License, Copyright (c) 2026 Jérémy Perret.
 *
 * The 13-state animation catalog (idle, thinking, orbit, burst, comet, ...). Not adapted — see ../engine.ts for the bolota-specific bridge
 * (seed-to-silhouette conversion, DOM mounting, rAF loop). This file's
 * own logic and structure are untouched beyond TS-strict fixes, import
 * paths, and translating the original French comments/identifiers to
 * English (see ../engine.ts's header for the provenance note).
 */
import {
  COMET_DOT,
  COMET_RIBBONS,
  DOT_PEAK,
  DOT_R,
  DOT_X,
  NOTIF_ANGLE,
  NOTIF_DIST,
  NOTIF_MARGIN,
  NOTIF_POP,
  NOTIF_R,
  RINGS,
  SWOOSH,
  particles,
  type ArcSpec,
  type DotRender
} from './decor'
import { EYE_H, EYE_SPLIT, EYE_W, REST_GAZE, type HeadGaze } from './face'
import { TAU, clamp, easings, lerp } from './math'
import {
  circle,
  hullOfCircles,
  polyPath,
  profileFromPolygon,
  silhouette,
  type Silhouette
} from './shape'

export interface EyeCfg {
  /** local width (capsule's short axis), in units of ball radius */
  w: number
  /** local height (long axis) */
  h: number
  /** 1 = open, 0 = closed */
  open: number
  /**
   * Capsule's own tilt, in degrees, positive = the top leans right. Applied
   * AFTER the sphere's tangent frame. Without it, both eyes are forced to
   * lean the same way (the head roll), and anger and sadness, which need
   * mirrored tilts, are out of reach.
   */
  tilt?: number
}

export interface Pose {
  /** body silhouette, in units of ball radius */
  sil: Silhouette
  /** global offset of the body AND the eyes */
  offX: number
  offY: number
  gaze: HeadGaze
  /** half-separation of the eyes on the sphere, in degrees */
  split: number
  /** [inner eye, outer eye] */
  eyes: [EyeCfg, EyeCfg]
  /** eye opacity: used by states with no face */
  eyeAlpha: number
  bodyAlpha: number
  dots: DotRender[]
  arcs: ArcSpec[]
  notif: { x: number; y: number; r: number; notch: number } | null
  /** true = the decor passes behind the body (burst particles) */
  dotsBehind: boolean
}

const pair = (w: number, h: number): [EyeCfg, EyeCfg] => [
  { w, h, open: 1 },
  { w, h, open: 1 }
]

/**
 * Dead-ahead gaze: yaw/pitch/roll all zero. `base()`'s own default gaze is
 * `REST_GAZE` instead (bloub's measured resting pose, a sideways glance —
 * see `../bloub/expressions.ts`'s header comment), which is correct for the
 * `wander` STATE right below and the `wander` EXPRESSION
 * (`../bloub/expressions.ts` — yes, same id, deliberately, see that file's
 * header comment) but NOT for `idle` — see `idle`'s own doc comment below
 * for why it overrides to this instead of taking `base()`'s default.
 */
const NEUTRAL_GAZE: HeadGaze = { yaw: 0, pitch: 0, roll: 0 }

function base(over: Partial<Pose> = {}): Pose {
  return {
    sil: circle(1),
    offX: 0,
    offY: 0,
    gaze: { ...REST_GAZE },
    split: EYE_SPLIT,
    eyes: pair(EYE_W, EYE_H),
    eyeAlpha: 1,
    bodyAlpha: 1,
    dots: [],
    arcs: [],
    notif: null,
    dotsBehind: false,
    ...over
  }
}

/* ---------------------------------------------------------- non-radial shapes */

/**
 * Vertical "!" bar: convex hull of two circles.
 * Measured: top circle (0, -0.505) r 0.132, bottom circle (0, +0.130) r
 * 0.075, straight sides. So it's conical (top/bottom ratio 1.76).
 */
const BAR_UPRIGHT_CY = -0.1875
const BAR_UPRIGHT = profileFromPolygon(
  hullOfCircles(0, -0.505, 0.132, 0, 0.13, 0.075),
  0,
  BAR_UPRIGHT_CY
)

/** Tilted "!" bar: a pure capsule (constant width 0.269, length 0.776). */
const BAR_ITALIC = profileFromPolygon(hullOfCircles(0, -0.2535, 0.1345, 0, 0.2535, 0.1345), 0, 0)

const barUpright = (pose: Partial<Silhouette> = {}): Silhouette => ({
  radii: [...BAR_UPRIGHT],
  rot: 0,
  cx: 0,
  cy: BAR_UPRIGHT_CY,
  sx: 1,
  sy: 1,
  ...pose
})

const barItalic = (pose: Partial<Silhouette> = {}): Silhouette => ({
  radii: [...BAR_ITALIC],
  rot: 0,
  cx: 0,
  cy: 0,
  sx: 1,
  sy: 1,
  ...pose
})

/**
 * The tilted "!"'s dot isn't a disk: it's a drop, round end (r 0.118) on
 * the bar's side and a tapered point on the other, length 0.300 along the
 * glyph's axis. Centered on the round end's centroid.
 */
const TEAR = polyPath(hullOfCircles(0, 0, 0.118, 0, 0.172, 0.012))

/**
 * The triangle doesn't spin on itself: its center traces a circle of
 * radius 0.213 around the origin (measured). It's this offset that makes
 * it look like it's tumbling instead of pivoting in place.
 */
const TRI_ORBIT = 0.213

/**
 * bolota addition: `orbit`'s loop phase — 4 whole revolutions at the
 * state's own measured 1.25 rev/s (`4 / 1.25`), so `rot` (and everything
 * trig-derived from it) is back at its `t = 0` value, exactly, when the
 * phase wraps. See `StateDef.period` and the `orbit` entry below for the
 * rest of the mechanism this feeds.
 */
export const ORBIT_PERIOD = 4 / 1.25

function spinningTriangle(rot: number): Silhouette {
  return silhouette('triangle', {
    rot,
    cx: -TRI_ORBIT * Math.sin(rot),
    cy: TRI_ORBIT * Math.cos(rot)
  })
}

/**
 * bolota addition: `wink`'s own gesture timing — close, hold, open, rest,
 * in seconds. `wink` used to be a HELD pose (no `t` at all, the eye shut for
 * the whole state), not a gesture; see the `wink` entry below for the
 * timeline these four numbers drive. Unlike `ORBIT_PERIOD`, nothing else in
 * this state has its own frequency to land in sync with — the eye-shape
 * interpolation IS the whole animation — so these were picked for feel, not
 * derived from a measured rate: quick shut, a short readable hold, a
 * slightly slower reopen (blinks in the reference material consistently
 * close faster than they open), then a rest long enough that a repeating
 * `loop('wink')` reads as "gesture, pause, gesture," not a twitch.
 */
const WINK_CLOSE = 0.16
const WINK_HOLD = 0.12
const WINK_OPEN = 0.18
const WINK_REST = 1.04
export const WINK_PERIOD = WINK_CLOSE + WINK_HOLD + WINK_OPEN + WINK_REST

/* ---------------------------------------------------------------------- states */

export type StateId =
  | 'idle'
  /**
   * bolota addition: the wandering-gaze choreography `idle` itself used to
   * be (idle's own doc comment covers the split). Unlike `swirl` — bloub's
   * own interface-only transition, just not one of its 13 video-documented
   * states — this id doesn't exist in bloub at all; it's this fork's own.
   */
  | 'wander'
  | 'thinking'
  | 'wink'
  | 'wide'
  | 'alert'
  | 'notify'
  | 'exclaim'
  | 'snooze'
  | 'play'
  | 'orbit'
  | 'burst'
  | 'comet'
  /** interface transition, not a catalog animation: outside `SEQUENCE` */
  | 'swirl'

export interface StateDef {
  id: StateId
  /** hold duration when the full sequence is played */
  duration: number
  /**
   * duration below which the animation is cut off before completing: the
   * "!" doesn't come back, the body stays burst. Read off the constants in
   * `pose` below, not something to choose freely. Absent = the state
   * ignores time or loops, any duration suits it (see `MIN_BLOCK`).
   */
  minDuration?: number
  /** duration of the entrance morph */
  morph: number
  /** true = the entrance is masked by a blink, as in the video */
  blinkIn: boolean
  /**
   * true = the body is the "resting" silhouette, so replaceable by the
   * shape chosen in the personalizer. States that draw their own shape
   * (the "!", the dots, the egg, the triangle...) are false: that shape IS
   * the animation.
   */
  baseBody: boolean
  /**
   * true = the state carries the "resting" face, so replaceable by the
   * chosen expression. Only `idle`: the other face-bearing states have an
   * expression lifted off the video, which is precisely what's being
   * reproduced.
   */
  baseFace: boolean
  /**
   * bolota addition (not from bloub): true = this state's own `pose.gaze`/
   * `split`/`eyes` are replaceable by a chosen expression too, same as
   * `baseFace`, WITHOUT taking on `baseFace`'s other two meanings —
   * cursor-follow eligibility (`engine.ts`'s `stateOwnsGaze`) and the
   * "resting face" identity `eyefit.ts`'s doc comments tie to it. A state
   * flagged here keeps driving its own body motion, decor and timing (and,
   * for `burst`/`comet`, its own collapse/regrow `eyeAlpha` — see each
   * one's own comment: only eye POSE changes hands, not visibility) — the
   * expression only ever wins the eyes' pose, on top of everything else
   * this state already owns. `play`/`burst`/`comet` set it; every other
   * non-`baseFace` state (the ones that actually choreograph their own
   * gaze/eyes as part of the gesture — `wander`, `wink`, `thinking`, ...)
   * leaves it unset and keeps full, uncontested ownership of its eyes.
   */
  acceptsExpression?: boolean
  /**
   * bolota addition (not from bloub — every other flag on this interface
   * is verbatim): true = idle's background liveliness (`face.ts`'s
   * wander/drift — NOT blink or breathing, see below) must contribute
   * NOTHING while this state plays. Two different reasons currently set it:
   *
   * - `orbit`: its own `pose(t)` already animates gaze/body position
   *   itself (`sil.cx/cy`), so composing idle's wander on top would be the
   *   same arbitration bug `follow` vs `idle` had (`gaze.ts`), just against
   *   a different active state instead of the cursor.
   * - `idle` (its own doc comment): deliberately wants NEITHER — its
   *   "no-state, watching straight ahead" meaning requires a fixed gaze,
   *   not merely one this flag happens to leave alone.
   *
   * Every state that doesn't set it (which is most of them, including the
   * new `wander` — the wandering-gaze choreography `idle` itself used to
   * be) has a `gaze`/`sil.cx/cy` that's a constant for its whole duration
   * and NEEDS the ambient wander, or it would read as frozen apart from
   * blinking.
   *
   * Blink and breathing are UNAFFECTED either way, regardless of this
   * flag: both are gated on `alive`/`blink` alone now (`face.ts`'s
   * `liveliness`) — a state with zero wander still blinks and breathes,
   * per the user's own explicit pairing ("blink + breathe still alive").
   */
  ownsLiveliness?: boolean
  /**
   * bolota addition (not from bloub): the phase length this state repeats
   * on when played with `loop: true`. Absent = not loop-safe as a single
   * timeline (the caller's existing periodic-`reset()` bridge mechanism
   * still handles it, unchanged); present = `BotEngine.sample()` itself
   * wraps the local clock to `[0, period)` BEFORE calling `pose()`, so this
   * function only ever sees a value in that range while looping. That is
   * the whole mechanism: EVERY channel `pose()` returns — silhouette,
   * gaze, rings, dots, whatever — is a function of that one wrapped
   * number, so nothing downstream can wrap on its own schedule and drift
   * out of phase with anything else (`orbit`'s old per-channel `t % 3.6`
   * ring-fade band-aid, replaced by this, is the bug this prevents: ONE
   * wrap point, upstream of every channel, not one per channel hoping they
   * agree).
   *
   * The value itself must make every one of `pose()`'s own periodic terms
   * land back where they started at `t = period` — `orbit`'s `ORBIT_PERIOD`
   * (its own comment) is the worked example: chosen as a whole number of
   * its rotation's own period so the wrap is exact, not approximate.
   */
  period?: number
  pose(local: number): Pose
}

/** Pulse wave that travels across the three dots left to right. */
function dotPulse(t: number, index: number): number {
  const p = ((((t - index * 0.5) / 1.5) % 1) + 1) % 1
  const k = p < 0.5 ? 0.5 - 0.5 * Math.cos(p * TAU) : 0
  return clamp(k * 2)
}

export const STATES: StateDef[] = [
  {
    id: 'idle',
    duration: 2.4,
    morph: 0.45,
    blinkIn: false,
    baseFace: true,
    baseBody: true,
    // bolota divergence, user-defined: `idle` is now the "no-state" neutral
    // — gaze fixed dead ahead, NO wander, NO position drift. This is
    // ALSO the static renderer's own default (`../bolota.ts`/`../render.ts`
    // draw the seeded eye anchors with gaze untouched): overriding to
    // `NEUTRAL_GAZE` here, rather than taking `base()`'s own `REST_GAZE`
    // default, is what makes an idle-frame sample reproduce exactly what
    // the static renderer draws for the same seed (`test/eye-static-parity
    // .test.ts` pins this). `base()`'s default stayed `REST_GAZE` — it's
    // still correct for `wander` right below and for the `wander`
    // EXPRESSION (`../bloub/expressions.ts` — same id as this STATE,
    // deliberately, see that file's header comment) — only `idle` diverges
    // from it, and only on this one field.
    //
    // Blink and breathing stay alive regardless (`face.ts`'s `liveliness`,
    // both gated on `alive`/`blink` now, not on the wander suppression
    // `ownsLiveliness` below triggers — see that flag's own doc comment and
    // `liveliness`'s breath comment). Cursor-follow composes normally on
    // top when active (`look.mix`, a separate channel `wander` never
    // touched) — follow owns gaze while it's on, this state's own
    // straight-ahead gaze is only what shows when it's off.
    //
    // The wandering-gaze choreography this state USED to be is `wander`
    // now (below) — same `REST_GAZE` base, id split so both meanings can
    // coexist.
    ownsLiveliness: true,
    pose: () => base({ gaze: { ...NEUTRAL_GAZE } })
  },

  {
    // bolota addition: `idle`'s own former self — see its doc comment for
    // the split. Same `duration`/`morph`/`blinkIn`/`baseFace`/`baseBody` as
    // `idle`, and the same `base()` this whole file's other states use
    // (still `REST_GAZE`, unlike `idle`'s own override right above) — only
    // the wander-suppression flag differs, so idle's former ambient gaze
    // drift/blink/breathe life is exactly what this state now carries
    // under its own name, REST_GAZE base included.
    id: 'wander',
    duration: 2.4,
    morph: 0.45,
    blinkIn: false,
    baseFace: true,
    baseBody: true,
    pose: () => base()
  },

  {
    id: 'thinking',
    duration: 2.6,
    morph: 0.4,
    baseFace: false,
    baseBody: false,
    blinkIn: true,
    // bolota eye-visibility audit (see `burst`/`comet` below for the cases that
    // DID change): left at `eyeAlpha: 0`, deliberately. The body does not shrink
    // toward a face here, it BECOMES one of the three dots (comment below, and
    // `sil` reuses the dot's own radius/position) — same size and shape as its two
    // un-eyed siblings. There is no face plane left to anchor a pair of capsule
    // eyes to; forcing them on would mean drawing eyes floating over a plain dot
    // indistinguishable from the decor either side of it, not "keeping the avatar's
    // identity," so this is the "truly impossible" case the fix explicitly carves
    // out. The pop this state's own entry/exit would otherwise have is still
    // covered: `BotEngine.sample`'s state-transition cross-fade (`blendPose`,
    // eased) ramps `eyeAlpha` over the transition `morph`, so going in and out of
    // `thinking` fades rather than pops even though this pose itself never turns
    // the eyes back on.
    pose: (t) => {
      const mid = dotPulse(t, 1)
      // The side dots emerge from the ball's flanks: in the video they stay
      // merged with it for 1-2 frames before detaching.
      const emerge = 0.3 + 0.7 * easings.easeOutCubic(clamp(t / 0.3))
      return base({
        // the ball BECOMES the middle dot: the morph stays continuous
        sil: circle(DOT_R * (1 + (DOT_PEAK - 1) * mid), { cx: DOT_X[1]! }),
        eyeAlpha: 0,
        dots: [0, 2].map((i) => {
          const k = dotPulse(t, i)
          return {
            x: DOT_X[i]! * emerge,
            y: 0,
            r: DOT_R * (1 + (DOT_PEAK - 1) * k),
            opacity: 0.55 + 0.45 * k
          }
        })
      })
    }
  },

  {
    id: 'wink',
    duration: 1.6,
    morph: 0.3,
    blinkIn: true,
    baseFace: false,
    baseBody: true,
    // bolota addition: see `WINK_CLOSE`'s own doc comment. `period` is
    // gesture (close+hold+open) plus a rest — `loop('wink')` therefore
    // reads as a repeating "gesture, pause, gesture," and a one-shot
    // `play('wink')` plays exactly one (the bridge's own `duration`-based
    // return-to-idle is untouched — it governs the NON-looped case, `period`
    // only the looped one). Not `ownsLiveliness`: gaze here is a constant
    // for the whole state, same as every other non-`orbit` state, and still
    // wants idle's wander on top of it.
    period: WINK_PERIOD,
    pose: (t) => {
      // The closed eye isn't the open eye squashed: it's a horizontal dash
      // WIDER than the open eye (0.447 versus 0.236) — pose itself
      // untouched, only WHEN the second eye is at each end of it changed.
      const open = { w: 0.236, h: 0.464 }
      const closed = { w: 0.447, h: 0.089 }
      // Close -> hold -> open -> rest, eased with the house curve
      // (`easeInOutCubic`, `math.ts`) for a natural accelerate-decelerate
      // gesture rather than a snap into or out of the closed pose. `k` is
      // the closed-ness fraction: 0 = fully open (both `t = 0` and the rest
      // tail land here, so the loop wrap is a hold on a constant, not a
      // jump), 1 = fully closed.
      let k: number
      if (t < WINK_CLOSE) {
        k = easings.easeInOutCubic(clamp(t / WINK_CLOSE))
      } else if (t < WINK_CLOSE + WINK_HOLD) {
        k = 1
      } else if (t < WINK_CLOSE + WINK_HOLD + WINK_OPEN) {
        k = 1 - easings.easeInOutCubic(clamp((t - WINK_CLOSE - WINK_HOLD) / WINK_OPEN))
      } else {
        k = 0
      }
      return base({
        gaze: { yaw: -5.37, pitch: 4.55, roll: 6.7 },
        split: 16.25,
        eyes: [
          // The inner eye stays open throughout — this is a WINK, one eye —
          // and is otherwise untouched by this state, so it keeps blinking
          // on its own independent, wall-clock-driven schedule
          // (`liveliness`'s `lid`, applied downstream in
          // `bloub/engine.ts`'s `sample()` regardless of what state is
          // playing).
          { w: open.w, h: open.h, open: 1 },
          { w: lerp(open.w, closed.w, k), h: lerp(open.h, closed.h, k), open: 1 }
        ]
      })
    }
  },

  {
    id: 'wide',
    duration: 1.8,
    morph: 0.55,
    blinkIn: true,
    baseFace: false,
    baseBody: true,
    pose: () =>
      base({
        gaze: { yaw: 6.92, pitch: -21.96, roll: 11.6 },
        split: 18.43,
        eyes: pair(0.356, 0.875)
      })
  },

  {
    id: 'alert',
    duration: 2.4,
    // the "!" snaps back into place at 1.6 + 0.4
    minDuration: 2,
    morph: 0.45,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    // bolota eye-visibility audit: left at `eyeAlpha: 0`. `sil` here is
    // `barItalic` — a thin italic glyph bar, not a round body — there is no face
    // plane for a pair of capsule eyes to sit on. Truly impossible, not overlooked;
    // covered by the same cross-fade as `thinking` above.
    pose: (t) => {
      // Measured travel: -0.087 -> +0.732 over 1.5s, ease-in-out, micro-overshoot.
      const p = clamp(t / 1.5)
      const travel = easings.easeInOutCubic(p) * 0.82 - 0.087
      const back = t > 1.6 ? clamp((t - 1.6) / 0.4) : 0
      const x = travel * (1 - back) + 0.1 * back
      // Secondary vibration at 2.5Hz, bar and dot in phase opposition.
      const buzz = Math.sin(t * 2.5 * TAU) * 0.005
      const tilt = (17.7 * Math.PI) / 180
      return base({
        sil: barItalic({ rot: tilt, cx: x, cy: -0.325 - buzz }),
        eyeAlpha: 0,
        dots: [
          {
            // the dot follows the glyph's axis, 0.580 from the bar's center
            x: x - Math.sin(tilt) * 0.58,
            y: -0.325 + Math.cos(tilt) * 0.58 + buzz * 2.8,
            r: 0.118,
            d: TEAR,
            rot: (tilt * 180) / Math.PI,
            opacity: 1
          }
        ]
      })
    }
  },

  {
    id: 'notify',
    duration: 2.2,
    morph: 0.5,
    blinkIn: true,
    baseFace: false,
    baseBody: true,
    pose: (t) => {
      // Blue dot pop: peaks at +14% around 0.3s then settles.
      const p = clamp(t / 0.45)
      const pop = 1 + (NOTIF_POP - 1) * Math.sin(p * Math.PI) * (1 - p * 0.35)
      const r = NOTIF_R * (p < 1 ? pop : 1)
      const a = (NOTIF_ANGLE * Math.PI) / 180
      return base({
        // the gaze looks away from the badge
        gaze: { yaw: -21.94, pitch: -5.82, roll: -12.2 },
        split: 18.89,
        eyes: pair(0.505, 0.498),
        notif: {
          x: Math.cos(a) * NOTIF_DIST,
          y: Math.sin(a) * NOTIF_DIST,
          r,
          notch: r + NOTIF_MARGIN
        }
      })
    }
  },

  {
    id: 'exclaim',
    duration: 2,
    morph: 0.45,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    // bolota eye-visibility audit: left at `eyeAlpha: 0` — same reasoning as
    // `alert`, `sil` is `barUpright()`, a bar glyph with no face plane.
    pose: () =>
      base({
        sil: barUpright(),
        eyeAlpha: 0,
        dots: [{ x: -0.012, y: 0.526, r: 0.113, opacity: 1 }]
      })
  },

  {
    // Renamed from bloub's original id `sleep` to `snooze` (user-sanctioned
    // divergence from verbatim): this package also has an eye EXPRESSION
    // named `sleepy` (unrelated, untouched), and the two names side by side
    // read as the same concept when they are not — this is a body-morph
    // STATE, not a face expression. Original bloub keeps `sleep`; see
    // github.com/AdamOusmer/bloub for the unrenamed fork this was ported
    // from.
    id: 'snooze',
    duration: 2.4,
    morph: 0.5,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    // bolota eye-visibility audit: left at `eyeAlpha: 0`, but for a different
    // reason than `thinking`/`alert`/`exclaim` above — `sil` here IS still a round
    // body (a small bouncing ball), so a face plane exists. This is the one state
    // where "no eyes" is the correct read regardless: the bot is asleep, and closed
    // eyes are what "asleep" means — showing open eyes here would read as a bug in
    // the other direction. Not changed.
    pose: (t) =>
      base({
        // Measured vertical bounce: +-0.19 around +0.11, period 0.6s.
        sil: circle(0.1585, { cy: 0.11 + Math.sin(t * (TAU / 0.6)) * 0.19 }),
        eyeAlpha: 0
      })
  },

  // `egg` and `hexagon` removed from the catalog (user decision): both were
  // shape-swap states (`silhouette('egg')`/`silhouette('hexagon')`, a
  // static named profile for their whole duration, no radius variation),
  // which is exactly what the seeded-shape enforcement in
  // `bloub/engine.ts`'s `posed()` makes meaningless — after that fix they
  // rendered as an unchanging seeded body with a fixed squint,
  // indistinguishable from idle. Deleted rather than kept unexported: no
  // remaining caller, so there was nothing a provenance comment would have
  // been guarding. Original bloub (both states intact) lives on unrenamed
  // at github.com/AdamOusmer/bloub.

  {
    id: 'play',
    duration: 2,
    morph: 0.5,
    baseFace: false,
    // Body/decor/timing (the triangle, the sweeping bouquet) stay this
    // state's own; a chosen expression is free to drive the eyes on top
    // (`acceptsExpression`'s own doc comment, `StateDef`).
    acceptsExpression: true,
    baseBody: false,
    blinkIn: true,
    pose: (t) => {
      // The triangle stays nearly still while the bouquet sweeps across it.
      const fade = clamp(t / 0.35) * clamp((2.2 - t) / 0.5)
      return base({
        sil: spinningTriangle(0),
        gaze: { yaw: 12, pitch: -8, roll: -6 },
        split: 15,
        eyes: pair(0.18, 0.34),
        // the bouquet sweeps right to left across the triangle
        arcs: SWOOSH.map((s, i) => ({
          id: `sw${i}`,
          seed: { ...s, cx: 0.45 - t * 0.42 },
          t,
          opacity: fade
        }))
      })
    }
  },

  {
    id: 'orbit',
    duration: 3.4,
    morph: 0.6,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    // bolota addition: see `StateDef.ownsLiveliness`'s own comment — this
    // state drives body center (`sil.cx/cy` via `spinningTriangle`) itself,
    // so idle's wander/drift/breath must not also compose on top of it. Gaze
    // no longer needs the same guard: see `ORBIT_PERIOD`'s comment below,
    // the eyes are calm and no longer a moving channel to protect.
    ownsLiveliness: true,
    // bolota addition: whole revolutions (1.25 rev/s below) of the
    // rotation's own rate — 4 turns at 1.25 rev/s. `rot`'s value at
    // `t = ORBIT_PERIOD` is therefore an exact multiple of a full turn,
    // i.e. identical (mod 2*PI) to its value at `t = 0`: `sil.rot` and
    // `sil.cx/cy` (both pure trig functions of `rot` now, see below) land
    // back where they started, exactly, not approximately.
    //
    // This replaced two DIFFERENT bugs a full-channel continuity sweep
    // found, not one. `t % 3.6` on the ring fade alone was the first
    // (git history) — one channel wrapping on a period nothing else
    // respected. The second was subtler and survived that first fix:
    // bloub's own verbatim choreography had the body settle from a
    // spinning TRIANGLE into a plain ball once, over its first ~2.5s (an
    // ease `back` ramp, 0 -> 1, scaling `cx/cy`'s wobble down to a dead
    // stop and blending `radii` from triangle to ball) — correct for a
    // ONE-SHOT playback, but `back(0) = 0` while `back(ORBIT_PERIOD) = 1`
    // (long saturated): looping wrapped `t` straight from "fully settled,
    // cy = 0" back to "just started settling, cy = TRI_ORBIT" every
    // cycle — measured, a same-frame `sil.cy` jump of 0.213 against a
    // mid-cycle max of 0.05, i.e. the actual "eyes keep repinning" report
    // (`sil.cx/cy` is what round 3's fix made the eyes ride). A settle
    // transient fundamentally can't wrap: it has a start and an end that
    // differ on purpose, and looping erases the distinction between "the
    // end of the story" and "the start of it" every cycle.
    //
    // Fix: no settle transient in the loop at all. The wobble is now a
    // pure function of `rot` (`spinningTriangle`'s own `cx/cy`, unscaled)
    // — periodic by construction, for the same reason `rot` itself is,
    // with nothing left to fall out of sync with it. One wrap, upstream of
    // every channel (`BotEngine.sample()`'s `wrapped()`, gated on this
    // field): every term below is simply a function of `t`, already
    // guaranteed to fall in `[0, ORBIT_PERIOD)` while looping, so nothing
    // here needs a modulo of its own.
    period: ORBIT_PERIOD,
    pose: (t) => {
      // Measured rotation: 1.25 rev/s (counter-clockwise). Constant-rate,
      // deliberately: a ramp-up here would go back to 0 every loop, briefly
      // slowing the spin down and re-accelerating it each cycle — smooth,
      // but still a recurring hitch a full sweep would flag, and everything
      // this state needs a "wraps clean" story to be free of gets one.
      const rot = -TAU * 1.25 * t
      // The triangle's center travels around the origin (measured): it's
      // this offset that makes it look like it's tumbling instead of
      // pivoting in place. `sil.radii`'s own angular shape never reaches
      // the screen either way — `BotEngine.posed()` substitutes the seed's
      // own profile, scaled to this array's mean, for every non-`baseBody`
      // state (see its own doc comment) — so `spinningTriangle` is used
      // here purely for its already-periodic `cx/cy`, not for its triangle.
      const sil = spinningTriangle(rot)
      // Rise over the same 0.8s the rings take to enter, hold, fall over the
      // last 0.9s before the loop wraps — symmetric with the entrance so the
      // wrap point (both fully faded) is where the visual seam already is.
      const fade = clamp(t / 0.8) * clamp((ORBIT_PERIOD - t) / 0.9)
      return base({
        sil,
        // Two rounds on this line. Round A tried restoring bloub's verbatim
        // sweep (+-65deg yaw, `sin(t*6.5)`, `pitch` ramping via `back`) —
        // real bloub choreography, but `back` (the spinning-triangle ->
        // settled-ball transient the sweep's amplitude/pitch rode) has no
        // loop-safe analog in a state that repeats forever (`back(0) = 0`,
        // `back(ORBIT_PERIOD) = 1`, no "settled" to actually reach), and
        // the amplitude alone was enough to swing an eye behind the head's
        // own depth cull (`engine.ts`, `e.depth <= 0.02`) on every pass —
        // real bloub behavior (verbatim, same formula, same cull) but a
        // busier read than intended for a state that also has to carry the
        // rings.
        //
        // Round B (final, user call): orbit's eyes hold `idle`'s own
        // neutral instead — originally the same `REST_GAZE` constant
        // `idle`'s `pose` returned unmodified at the time this decision was
        // made; now `NEUTRAL_GAZE` (dead-ahead), tracking `idle`'s own
        // override (its doc comment above) so this state keeps meaning
        // exactly what it says — "holds idle's neutral" — rather than
        // silently drifting to a stale copy of what idle's gaze used to be.
        // Checked and confirmed clean, not just asserted: with
        // `ownsLiveliness` (above) zeroing `life.dYaw/dPitch/dRoll` and
        // `driftX/Y` (`engine.ts`'s `wander`/`float` gates, both keyed off
        // this flag), the ONLY inputs left to `gaze` are this constant and
        // `look` (cursor-follow, gated the same way `idle`'s own doc
        // comment describes — composes on top when active, off otherwise,
        // symmetric with `idle`, not a leak) — measured max deviation
        // between orbit's rendered eye position and a from-scratch
        // reconstruction off this exact constant (no look, no wander):
        // 0.006 units, i.e. the engine's own two-decimal rounding, not a
        // residual pin (that measurement predates the `REST_GAZE` ->
        // `NEUTRAL_GAZE` swap above but the mechanism it's checking —
        // `gaze` having no other live input — is unchanged by which
        // constant this field holds). Blink and breathing are untouched by
        // any of this (`liveliness`'s `lid`/`breath`, gated on
        // `alive`/`blink` alone, never on `ownsLiveliness`) — measured
        // directly off the rendered frame too: eye height (matrix-scaled,
        // not the unscaled `d`) dips 25.16 -> 1.76 -> 25.16 across the
        // first scheduled blink, and `bodyPath`'s own bbox height still
        // varies sample to sample at t's where `rot`'s own 0.8s period
        // holds silhouette/position otherwise identical (203.42 / 204.44 /
        // 203.61 / 202.45 at t=0/0.8/1.6/2.4) — both alive, neither owned
        // by this flag.
        gaze: { ...NEUTRAL_GAZE },
        eyes: pair(0.18, 0.34),
        // the rings enter one by one over 0.8s
        arcs: RINGS.map((s, i) => ({
          id: `rg${i}`,
          seed: s,
          t,
          opacity: fade * clamp((t - i * 0.13) / 0.3)
        }))
      })
    }
  },

  {
    /**
     * Entrance into the settings view.
     *
     * The ONLY state not lifted off the video: it's CHOSEN, like the
     * `--ink` color. It borrows `orbit`'s vocabulary — the same rings, with
     * their measured parameters — but cut short: 1s instead of 3.4, half
     * the rings, and no triangle.
     *
     * The two flags set to `true` are the whole point of this state:
     *
     * - `baseBody` lets the chosen shape replace the body, so the view can
     *   impose the circle and the pebble or the drop MORPH into it instead
     *   of jumping;
     * - `baseFace` makes it carry the resting face, so cursor-follow
     *   applies from this entrance onward. A state with its own gaze pose
     *   (like `orbit`) would hand off to the next state mid-motion, and the
     *   eyes would jump all at once on resuming.
     *
     * Deliberately NOT in `SEQUENCE`: it's not a catalog animation, it's an
     * interface transition.
     */
    id: 'swirl',
    // a bit more than the gaze turn (`TURN_TIME`, 1.1s): the eyes need to
    // be settled to the left before the rings fade out
    duration: 1.3,
    minDuration: 1.3,
    morph: 0.3,
    baseFace: true,
    baseBody: true,
    // the shape morph is masked by a blink, like everywhere else
    blinkIn: true,
    pose: (t) =>
      base({
        // three of `orbit`'s six rings: half the bouquet is enough to
        // recognize it, and that's fewer arcs to rasterize per frame
        arcs: RINGS.slice(0, 3).map((s, i) => ({
          id: `sw${i}`,
          seed: s,
          t,
          // they enter one after another then fade out before the block
          // ends, so resuming at rest happens on an already-clean frame
          opacity: clamp((t - i * 0.06) / 0.14) * clamp((1.22 - t) / 0.34)
        }))
      })
  },

  {
    id: 'burst',
    duration: 2.6,
    // the body is recomposed at 1.7 + 0.7
    minDuration: 2.4,
    morph: 0.4,
    baseFace: false,
    // Body/decor/timing (the collapse, the particles) and the collapse-fade
    // `eyeAlpha` below stay this state's own; a chosen expression is free
    // to drive the eyes' POSE on top (`acceptsExpression`'s own doc
    // comment, `StateDef`) — visibility during the collapse is unaffected.
    acceptsExpression: true,
    baseBody: false,
    blinkIn: false,
    // bolota eye-visibility audit, user-reversed: an earlier pass kept the
    // eyes faintly present through the collapse (floored at `0.18 + 0.82 *
    // bodyScale`, never truly 0). User call supersedes that: the collapse
    // states hide the eyes COMPLETELY — smooth eased fade to 0 tracking the
    // SAME collapse curve driving `sil` (`easeOutQuint`, not a new one),
    // fully gone through the hold, smooth fade back in with the regrow. No
    // pop: `eyeAlpha` and `sil`'s own scale share the identical eased
    // fraction at every `t`, they just move in opposite directions during
    // collapse (`sil` shrinks, `eyeAlpha` fades) and together during regrow
    // (both rise on `regrow` itself, unmodified).
    //
    // Second bug found only by actually rendering frames (a debug page,
    // side-by-side SVG snapshots, screenshotted): the alpha fade landed but
    // eye GEOMETRY never tracked `bodyScale` — `eyes` stayed the default
    // full-size `pair(EYE_W, EYE_H)` (`base()`'s own default) regardless of
    // how small the body was. Mid-regrow (e.g. t=1.8, body at ~50% scale,
    // alpha already ~50%) the eye rendered nearly as big as the whole
    // shrunken body — a full-size capsule on a half-size ball. Fixed at the
    // shared choke point instead of here (`bloub/engine.ts`'s `posed()`
    // already computes this exact `scale` for `sil.radii`, for every
    // non-`baseBody` state — see its own comment): it now applies the same
    // factor to `pose.eyes[i].w/h`, so `orbit` and `play` (both render a
    // constant ~0.86-scale body via that same mechanism, unnoticed until
    // this bug was found) get it too, not just the two states that
    // happened to be reported.
    pose: (t) => {
      // Measured collapse: 1.0 -> 0.166 over 0.7s, ease-out, no overshoot.
      const collapseFrac = easings.easeOutQuint(clamp(t / 0.7))
      const collapse = 1 - 0.834 * collapseFrac
      const regrow = easings.easeOutQuint(clamp((t - 1.7) / 0.7))
      const bodyScale = collapse + (1 - collapse) * regrow
      return base({
        sil: circle(bodyScale),
        eyeAlpha: t < 1.7 ? 1 - collapseFrac : regrow,
        dots: particles(t, 1),
        dotsBehind: true
      })
    }
  },

  {
    id: 'comet',
    duration: 2.4,
    // the dot recomposes at 1.85 + 0.6 = 2.45, 0.05s after the video's cut:
    // this remainder finishes during the next cross-fade, as in the
    // reference. So it's never held below the measured duration.
    minDuration: 2.4,
    morph: 0.45,
    baseFace: false,
    // Same as `burst` above: body/decor/timing and the collapse-fade
    // `eyeAlpha` stay this state's own, a chosen expression only drives
    // eye POSE (`acceptsExpression`'s own doc comment, `StateDef`).
    acceptsExpression: true,
    baseBody: false,
    blinkIn: false,
    // bolota eye-visibility audit, user-reversed: same case as `burst`
    // above (see its own comment, including the eye-GEOMETRY-scaling half
    // of the fix, which lives at the shared choke point — `bloub/engine.ts`'s
    // `posed()` — not here) — floored fade replaced with a full, eased fade
    // to 0, tracking the same collapse curve, and back with the regrow.
    // User report named this one explicitly ("comet collapses to a dot");
    // the dot is now genuinely eyeless at its smallest, and proportionate
    // everywhere in between.
    pose: (t) => {
      const collapseFrac = easings.easeOutQuint(clamp(t / 0.55))
      const collapse = 1 - (1 - COMET_DOT) * collapseFrac
      const regrow = easings.easeOutQuint(clamp((t - 1.85) / 0.6))
      const bodyScale = collapse + (1 - collapse) * regrow
      const fade = clamp((t - 0.15) / 0.25) * clamp((1.95 - t) / 0.3)
      return base({
        // The dot drifts 0.035 down then back up (measured wobble).
        sil: circle(bodyScale, {
          cy: Math.sin(clamp(t / 1.7) * Math.PI) * 0.035
        }),
        eyeAlpha: t < 1.85 ? 1 - collapseFrac : regrow,
        arcs: COMET_RIBBONS.map((s, i) => ({ id: `cm${i}`, seed: s, t, opacity: fade }))
      })
    }
  }
]

export const STATE_BY_ID = new Map(STATES.map((s) => [s.id, s]))

/** Playback order of the full sequence, mirroring the reference video. */
/**
 * Date, in local time, at which each state is most legible: it's the pose
 * shown by the thumbnails and the storyboard. Deterministically rendered,
 * so comparable run to run. The type forces every new state to be covered.
 */
export const POSES: Record<StateId, number> = {
  idle: 1,
  wander: 1,
  thinking: 1.1,
  wink: 0.8,
  wide: 0.8,
  alert: 0.75,
  notify: 0.9,
  exclaim: 0.8,
  snooze: 0.45,
  play: 0.9,
  orbit: 1.2,
  swirl: 0.5,
  burst: 0.45,
  comet: 1.15
}

export const SEQUENCE: StateId[] = [
  'idle',
  'thinking',
  'wink',
  'wide',
  'alert',
  'notify',
  'exclaim',
  'snooze',
  'play',
  'orbit',
  'burst',
  'comet'
]
