/**
 * Ported verbatim from bloub (https://github.com/jeremyPerret/bloub),
 * MIT License, Copyright (c) 2026 Jérémy Perret.
 *
 * BotEngine — the pure, DOM-free sample(t) render loop. Not adapted — see ../engine.ts for the bolota-specific bridge
 * (seed-to-silhouette conversion, DOM mounting, rAF loop). This file's
 * own logic and structure are untouched beyond TS-strict fixes, import
 * paths, and translating the original French comments/identifiers to
 * English (see ../engine.ts's header for the provenance note).
 */
import { arcRender, type ArcRender, type DotRender } from './decor'
import { blendExpression, type BotExpression } from './expressions'
import { eyeOffset } from './eyefit'
import { blinkScale, eyePoses, liveliness } from './face'
import { clamp, easings, lerp, r2 } from './math'
import {
  blend,
  capsulePath,
  closedPath,
  radiusAtAngle,
  toPoints,
  type Point,
  type Silhouette
} from './shape'
import { STATE_BY_ID, type Pose, type StateDef, type StateId } from './states'

export interface RenderedEye {
  d: string
  matrix: string
  alpha: number
}

export interface BotFrame {
  bodyPath: string
  bodyAlpha: number
  eyes: RenderedEye[]
  dots: DotRender[]
  /** true = the dots pass behind the body (burst particles) */
  dotsBehind: boolean
  arcs: ArcRender[]
  notif: { x: number; y: number; r: number } | null
  notch: { x: number; y: number; r: number } | null
}

/**
 * Where the bot looks when something external is driving it — the mouse
 * pointer, today.
 *
 * `yaw` and `pitch` are ABSOLUTE directions, which replace the pose's own as
 * `mix` rises. Two reasons, each a trap already fallen into:
 *
 * - it's the ENGINE that has to do this blend, not the caller, because only
 *   it knows the pose AT THIS INSTANT. A caller compensating for the
 *   expression's orientation would read its arrival value while the morph is
 *   still running, and the eyes would jump on every mood change;
 * - and it has to be absolute on BOTH axes. As a relative value, eye height
 *   used to follow each expression's own — "neutral" looks at +28.6deg while
 *   the others sit between -9 and +9 — so the eyes would drop all at once on
 *   the first mood change. What gives an expression its character during
 *   follow is the SHAPE of its eyes (squinted, round, asymmetric), not where
 *   it looks: that part, the cursor decides.
 *
 * `mix` says how much the external target commands DIRECTION (0 = not at all).
 *
 * `wander` says, separately, how much automatic drift is left. The two don't
 * mix: when the pointer moves, the drift has to die down — combined, the bot
 * would look like it's hunting for the cursor without ever holding it. But
 * when there's NO pointer (arriving by keyboard, by touch, or the mouse left
 * the window), the head has to stay turned AND keep living. Conflating the
 * two froze the gaze the moment the view opened.
 *
 * `spin` is a turn to travel EN ROUTE, in degrees, faded to 0 as the arrival
 * progresses. Since the eyes live on a sphere, a turn sends them behind the
 * ball and back out the other side — and since `-360deg` is the same angle
 * as `0`, it changes nothing about where they end up.
 */
export interface Look {
  yaw: number
  pitch: number
  mix: number
  spin: number
  wander: number
}

const NO_LOOK: Look = { yaw: 0, pitch: 0, mix: 0, spin: 0, wander: 1 }

const lerpLook = (a: Look, b: Look, t: number): Look => ({
  yaw: lerp(a.yaw, b.yaw, t),
  pitch: lerp(a.pitch, b.pitch, t),
  mix: lerp(a.mix, b.mix, t),
  spin: lerp(a.spin, b.spin, t),
  wander: lerp(a.wander, b.wander, t)
})

const lerpEye = (a: Pose['eyes'][number], b: Pose['eyes'][number], t: number) => ({
  w: lerp(a.w, b.w, t),
  h: lerp(a.h, b.h, t),
  open: lerp(a.open, b.open, t),
  tilt: lerp(a.tilt ?? 0, b.tilt ?? 0, t)
})

/** Interpolates two poses. The decor cross-fades in opacity, not geometry. */
function blendPose(a: Pose, b: Pose, t: number): Pose {
  const out = 1 - t
  return {
    sil: blend(a.sil, b.sil, t),
    offX: lerp(a.offX, b.offX, t),
    offY: lerp(a.offY, b.offY, t),
    gaze: {
      yaw: lerp(a.gaze.yaw, b.gaze.yaw, t),
      pitch: lerp(a.gaze.pitch, b.gaze.pitch, t),
      roll: lerp(a.gaze.roll, b.gaze.roll, t)
    },
    split: lerp(a.split, b.split, t),
    eyes: [lerpEye(a.eyes[0], b.eyes[0], t), lerpEye(a.eyes[1], b.eyes[1], t)],
    eyeAlpha: lerp(a.eyeAlpha, b.eyeAlpha, t),
    bodyAlpha: lerp(a.bodyAlpha, b.bodyAlpha, t),
    dots: [
      ...a.dots.map((d) => ({ ...d, opacity: d.opacity * out })),
      ...b.dots.map((d) => ({ ...d, opacity: d.opacity * t }))
    ],
    arcs: [
      ...a.arcs.map((r) => ({ ...r, id: `a${r.id}`, opacity: r.opacity * out })),
      ...b.arcs.map((r) => ({ ...r, id: `b${r.id}`, opacity: r.opacity * t }))
    ],
    // the badge belongs to only one of the two states, it doesn't blend
    notif: t < 0.5 ? a.notif : b.notif,
    dotsBehind: t < 0.5 ? a.dotsBehind : b.dotsBehind
  }
}

/**
 * Clockless engine: `sample(t)` is a pure function of time.
 *
 * Practical consequence: pause, resume, slow motion and jumping to an
 * arbitrary date all give exactly the same image, and the render is
 * testable without a DOM.
 */
export class BotEngine {
  /** ball radius at rest, in viewBox units */
  readonly scale: number

  private cur: StateId
  private prev: StateId | null = null
  /**
   * FROZEN starting pose, set only when a state change arrives while a
   * cross-fade is already running. See `setState`.
   */
  private frozenStart: Pose | null = null
  private tCur = 0
  private tPrev = 0
  private blinkAt = -10
  /**
   * bolota addition: true while the current state is meant to repeat
   * indefinitely (`setState`/`reset`'s own `loop` argument). Gates whether
   * `wrapped()` below folds elapsed time into `[0, def.period)` — looping is
   * therefore a property of HOW a state is being played, not of the state
   * itself; the same `orbit` plays once, unwrapped, inside a composed
   * sequence, or forever, phase-wrapped, from the demo's `loop: true`.
   */
  private looping = false
  private pts: Point[] = []
  private shape: number[] | null = null
  private shapePrev: number[] | null = null
  private shapeAt = -10
  private expr: BotExpression | null = null
  private exprPrev: BotExpression | null = null
  private exprAt = -10
  private look: Look = NO_LOOK
  private lookPrev: Look = NO_LOOK
  private lookAt = -10
  /** duration of the catch-up in progress; see `LOOK_MORPH`, its default value */
  private lookMorph = 0.24

  /** duration of the morph when the body shape changes */
  static readonly SHAPE_MORPH = 0.45

  /**
   * Catch-up duration of the gaze toward its target. Shorter than
   * `SHAPE_MORPH`: a following gaze should read as attentive, not sluggish.
   * Since the target is reset on every mouse move, it's this duration that
   * gives the follow its inertia — the gaze never quite reaches a moving
   * cursor.
   */
  static readonly LOOK_MORPH = 0.24

  constructor(
    scale = 100,
    initial: StateId = 'idle',
    shape: number[] | null = null,
    expression: BotExpression | null = null
  ) {
    this.scale = scale
    this.cur = initial
    this.shape = shape
    this.expr = expression
  }

  /**
   * Resting expression chosen in the personalizer. Like the shape, it
   * glides to the new value instead of jumping.
   */
  setExpression(expression: BotExpression | null, now = 0) {
    if (expression === this.expr) return
    this.exprPrev = this.expr
    this.expr = expression
    this.exprAt = now
  }

  /** Effective expression at instant `now`, morph in progress included. */
  private exprAtTime(now: number): BotExpression | null {
    const to = this.expr
    const from = this.exprPrev
    if (!to || !from) return to
    const k = (now - this.exprAt) / BotEngine.SHAPE_MORPH
    if (k >= 1) return to
    return blendExpression(from, to, easings.easeOutQuint(clamp(k)))
  }

  /**
   * Shape chosen in the personalizer. It only replaces the body on
   * at-rest states (`baseBody`): on the others, the silhouette IS the
   * animation and must not be overwritten.
   *
   * The change happens as a morph, not a jump: since every shape is
   * sampled at the same angles, interpolating the radii is enough.
   */
  setShape(radii: number[] | null, now = 0) {
    if (radii === this.shape) return
    this.shapePrev = this.shape
    this.shape = radii
    this.shapeAt = now
  }

  /**
   * Effective shape at instant `now`, morph in progress included.
   *
   * Does NOT reset `shapePrev` to null at the end of the morph: `sample`
   * has to stay a pure function of time, so re-reading a past date must
   * give back the same intermediate image. We just keep one more
   * reference around.
   */
  private shapeAtTime(now: number): number[] | null {
    const to = this.shape
    const from = this.shapePrev
    if (!to || !from) return to
    const k = (now - this.shapeAt) / BotEngine.SHAPE_MORPH
    if (k >= 1) return to
    const t = easings.easeOutQuint(clamp(k))
    // allocated only during the morph; outside the morph the array is returned as-is
    return to.map((r, i) => lerp(from[i] ?? r, r, t))
  }

  /**
   * New gaze target, `null` to fall back to the state's own.
   *
   * It starts from the CURRENT value, not the previous target the way
   * `setShape` does: this method fires on every pointer move, and starting
   * from the old target would set the gaze back a step before every
   * catch-up — the follow would judder instead of gliding.
   *
   * Same contract as `setShape` otherwise: external state comes in through
   * a timestamped setter, never through a variable read during `sample`,
   * or the engine stops being a pure function of time.
   */
  setLook(look: Look | null, now: number, morph = BotEngine.LOOK_MORPH) {
    /*
     * A non-finite target is rejected. The engine KEEPS the last one: a
     * `NaN` set just once would propagate to every frame after and the bot
     * would never settle again. This happened for real — a
     * `getBoundingClientRect` on a zero-size box gives `0 / 0` on the
     * caller's side. That one is fixed, but the engine shouldn't have to
     * depend on its callers' caution to stay replayable.
     */
    if (look && !Number.isFinite(look.yaw + look.pitch + look.mix + look.spin + look.wander)) {
      return
    }
    this.lookPrev = this.lookAtTime(now)
    this.look = look ?? NO_LOOK
    this.lookAt = now
    this.lookMorph = morph
  }

  /**
   * Effective gaze at instant `now`, catch-up in progress included.
   *
   * bolota divergence: `easeOutQuint` here (bloub's own choice everywhere else in
   * this file) starts a retarget at FULL velocity — its derivative at k=0 is 5, not 0
   * — so every pointer move snapped the gaze into motion instead of easing into it.
   * Harmless for the state/shape/expr morphs elsewhere in this file, which all start
   * from rest at a `setState`/`setShape`/`setExpression` call the caller controls; but
   * `setLook` fires on every pointer-move event, i.e. mid-motion far more often than
   * not, so the missing accel phase was audible as a snap on each retarget — the
   * literal user report ("eye position changes are NOT eased — they snap"). Unlike
   * `offsetAtTime` below, this morph is NOT coupled to the shape/body morph curve
   * (see `LOOK_MORPH`'s own doc comment: deliberately a different, shorter duration),
   * so it is free to use a different curve too. `easeInOutCubic` (`math.ts`) accelerates
   * in and decelerates out — no snap at either end.
   */
  private lookAtTime(now: number): Look {
    const k = (now - this.lookAt) / this.lookMorph
    if (k >= 1) return this.look
    return lerpLook(this.lookPrev, this.look, easings.easeInOutCubic(clamp(k)))
  }

  private posed(
    def: StateDef,
    t: number,
    shape: number[] | null,
    expr: BotExpression | null
  ): Pose {
    let pose = def.pose(t)
    if (def.baseBody && shape) {
      // keep the pose (rotation, offset, squash) and swap only the profile
      pose = { ...pose, sil: { ...pose.sil, radii: shape } }
    } else if (shape) {
      // DIVERGENCE FROM VERBATIM BLOUB (user-sanctioned, see src/engine.ts's
      // header): every state renders on the seed's own profile now, never
      // one of bloub's built-in body shapes (the spinning triangle in
      // orbit/play, egg's egg, hexagon's hexagon, the plain circle every
      // collapse/regrow and decorative-dot state used) -- this package's
      // identity lives in the seeded silhouette, and a state that swapped
      // it out for a different shape read as "wrong" (screenshot reports:
      // burst/comet "popping into a sphere", orbit/play/egg/hexagon not
      // looking like the seed at all).
      //
      // A state's pose still controls SIZE: `scale` is the pose's own mean
      // radius, exact for every `circle(k)` state (which is every
      // collapse/regrow and decorative-dot case -- circle(k).radii is `k`
      // repeated, so its mean is exactly `k`) and a faithful aggregate for
      // a state that blends two named profiles (e.g. orbit's triangle-to-
      // ball). Only the ANGULAR shape bloub's own profile carried is
      // discarded, replaced by the seed's. Original bloub (each state
      // drawing its own catalog of body shapes) lives on unrenamed at
      // github.com/AdamOusmer/bloub.
      const scale = pose.sil.radii.reduce((a, b) => a + b, 0) / pose.sil.radii.length
      pose = { ...pose, sil: { ...pose.sil, radii: shape.map((r) => r * scale) } }
    }
    if (def.baseFace && expr) {
      pose = { ...pose, gaze: expr.gaze, split: expr.split, eyes: expr.eyes }
    }
    return pose
  }

  /**
   * Eye offset at instant `now` for a given state, in units of ball radius.
   *
   * It's READ from a table and interpolated, never recomputed: `eyefit.ts`
   * explains why that distinction is the whole fix. Here all that's left is
   * to interpolate it along the shape axis, with exactly the same curve and
   * duration as the silhouette morph — it's the same cause, so it has to be
   * the same movement.
   *
   * The table is queried at the morph's BOUNDS (`shapePrev` and `shape`),
   * not the profile `shapeAtTime` renders: that one is a fresh array
   * allocated every frame, so it has no identity, and it exists in no table.
   */
  private offsetAtTime(now: number, state: StateId): { x: number; y: number } {
    /**
     * A morph axis: the table is read at its two BOUNDS and interpolated
     * with its curve. Never on the interpolated value — that one has no
     * identity and exists in no table, and feeding it to the table is what
     * made earlier versions jitter.
     */
    const alongAxis = (
      start: number,
      duration: number,
      a: { x: number; y: number },
      b: { x: number; y: number }
    ) => {
      if (a === b) return b
      const k = (now - start) / duration
      if (k >= 1) return b
      const t = easings.easeOutQuint(clamp(k))
      return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }
    }

    // expression axis, for each of the two shapes in play
    const byShape = (radii: number[] | null) =>
      alongAxis(
        this.exprAt,
        BotEngine.SHAPE_MORPH,
        eyeOffset(radii, state, this.exprPrev?.id ?? null),
        eyeOffset(radii, state, this.expr?.id ?? null)
      )

    // then the shape axis
    return alongAxis(
      this.shapeAt,
      BotEngine.SHAPE_MORPH,
      byShape(this.shapePrev),
      byShape(this.shape)
    )
  }

  get state(): StateId {
    return this.cur
  }

  /**
   * Restarts on `id` with NO previous state, like a fresh engine dropped
   * onto that state.
   *
   * That's what "rewind" means for this engine. `setState` alone can't do
   * it: it keeps the state it's leaving in order to cross-fade from it,
   * which is exactly its job during playback, and exactly what must NOT
   * happen when jumping back to the start of a sequence. Replaying frame 0
   * after a full pass used to blend the first state with the LAST one, and
   * the GIF export opened on a ball with no eyes — the comet has zero
   * `eyeAlpha`.
   *
   * `sample` stays a pure function of time: like `setState`, this is a
   * DATE-stamped setter, called by the sequence's driver, never during a
   * sample.
   */
  reset(id: StateId, now: number, loop = false) {
    this.cur = id
    this.prev = null
    this.frozenStart = null
    this.tCur = now
    this.tPrev = now
    this.blinkAt = -10
    this.looping = loop
  }

  /**
   * bolota addition: the ONE place elapsed time is folded into a state's
   * own loop phase. Every caller below that feeds a channel-producing
   * `posed()` routes through this first — `pose()` itself, and therefore
   * every channel it returns, only ever sees an already-wrapped number, so
   * no individual channel (a ring's fade, a rotation, anything) can wrap on
   * a schedule of its own and drift out of phase with the rest. See
   * `StateDef.period`'s own doc comment for the full mechanism.
   */
  private wrapped(def: StateDef, elapsed: number): number {
    return this.looping && def.period ? elapsed % def.period : elapsed
  }

  /**
   * Origin of the cross-fade in progress: the frozen pose if there is one,
   * otherwise the left state evaluated at its own elapsed time — so still
   * animating, which is intended.
   */
  private origin(
    now: number,
    shape: number[] | null,
    expr: BotExpression | null
  ): Pose | null {
    if (this.frozenStart) return this.frozenStart
    if (!this.prev) return null
    const prevDef = STATE_BY_ID.get(this.prev)!
    return this.posed(prevDef, this.wrapped(prevDef, Math.max(0, now - this.tPrev)), shape, expr)
  }

  /**
   * Composite pose at instant `now`, cross-fade in progress included:
   * exactly what `sample` blends, before the idle-life and gaze layer.
   * Extracted so `setState` can freeze it.
   */
  private composedPose(now: number): Pose {
    const def = STATE_BY_ID.get(this.cur)!
    const shape = this.shapeAtTime(now)
    const expr = this.exprAtTime(now)
    const pose = this.posed(def, this.wrapped(def, Math.max(0, now - this.tCur)), shape, expr)
    const since = now - this.tCur
    if (since >= def.morph) return pose
    const origin = this.origin(now, shape, expr)
    if (!origin) return pose
    return blendPose(origin, pose, easings.easeOutQuint(clamp(since / def.morph)))
  }

  /**
   * State change, timestamped.
   *
   * The engine keeps only ONE slot of history, so a change arriving during
   * a cross-fade used to replace the blend's origin with the FULL pose of
   * the state being left, instead of the partially-blended image that was
   * actually on screen. Measured on `idle -> wide -> idle` at 100ms: 35.9px
   * of jump against 8.0px of normal motion.
   *
   * So the current composite pose is frozen and the blend runs from it.
   * Continuous by construction, no matter how many changes chain together.
   *
   * And ONLY in that case. Freezing on every change would stop the outgoing
   * state's animation dead for the whole cross-fade — `alert`'s "!" would
   * freeze mid-motion — when there's nothing to fix outside a morph: the
   * outgoing state is already exactly the displayed image there. Playing a
   * sequence, whose blocks all last at least the longest cross-fade
   * (`MIN_BLOCK`), therefore never freezes anything and renders frame for
   * frame what it was already rendering.
   */
  setState(id: StateId, now: number, loop = false) {
    if (id === this.cur) {
      // bolota addition: the id is unchanged but `loop` may not be (e.g.
      // a state first played once inside a sequence, later looped from a
      // demo) — still worth taking, and cheap; nothing else about an
      // already-current state needs re-arming.
      this.looping = loop
      return
    }
    const morph = STATE_BY_ID.get(this.cur)!.morph
    const midMorph = this.prev !== null && now - this.tCur < morph
    this.frozenStart = midMorph ? this.composedPose(now) : null
    this.prev = this.cur
    this.tPrev = this.tCur
    this.cur = id
    this.tCur = now
    this.looping = loop
    // In the video, every shape change is masked by a blink.
    if (STATE_BY_ID.get(id)?.blinkIn) this.blinkAt = now
  }

  sample(now: number): BotFrame {
    const R = this.scale
    const def = STATE_BY_ID.get(this.cur)!
    const shape = this.shapeAtTime(now)
    const expr = this.exprAtTime(now)
    let pose = this.posed(def, this.wrapped(def, Math.max(0, now - this.tCur)), shape, expr)
    let offset = this.offsetAtTime(now, this.cur)

    // --- transition -------------------------------------------------------
    const since = now - this.tCur
    // The previous state is never purged: `since < def.morph` is enough to
    // ignore it once the cross-fade is past, and forgetting it would make
    // the engine non-replayable — re-reading a date before the fade ends
    // would no longer find it. This is the optimization that looks
    // innocent and breaks everything.
    const origin = since < def.morph ? this.origin(now, shape, expr) : null
    if (origin) {
      // Exponential ease-out: this is the curve measured off the video.
      // The body has no overshoot (only the badge and the eye-opening do).
      // The ratio is clamped: re-reading a date BEFORE the state change
      // would give a negative ratio, which the ease-out extrapolates — the
      // silhouette would then fly off thirty times too far.
      const ratio = easings.easeOutQuint(clamp(since / def.morph))
      pose = blendPose(origin, pose, ratio)
      // The eye offset follows the SAME curve as the silhouette that
      // motivates it. It comes from the left state, which `setState`
      // always sets at the same time as the origin — the test here is for
      // typing, not a real case.
      const left = this.prev
      if (left) {
        const before = this.offsetAtTime(now, left)
        offset = {
          x: lerp(before.x, offset.x, ratio),
          y: lerp(before.y, offset.y, ratio)
        }
      }
    }

    // --- idle life ----------------------------------------------------------
    const alive = pose.eyeAlpha > 0.01
    const look = this.lookAtTime(now)
    // bolota divergence from the bloub port: `def.ownsLiveliness` (see its
    // own doc comment, `states.ts`) — a state that already drives gaze and/or
    // body position itself (`orbit`), or that deliberately wants neither
    // (`idle`'s new "no-state" meaning), gets ZERO idle wander/drift composed
    // on top — the same arbitration bug class as follow-vs-idle (`gaze.ts`)
    // but between idle's own background life and a different active state
    // or a user-chosen stillness. Blink and breathing are NOT part of this
    // gate (`face.ts`'s `liveliness` ties both to `alive`/`blink` alone
    // now) — a still face still blinks and breathes; only the ambient
    // gaze/position wander is what a state can opt out of.
    const ownsMotion = def.ownsLiveliness ?? false
    const life = liveliness(now, {
      wander: ownsMotion ? 0 : alive ? look.wander : 0,
      blink: alive,
      float: !ownsMotion
    })

    const gaze = {
      // Both aims REPLACE the pose's own (see `Look`) instead of adding to
      // it, and the turn is subtracted along the way. The drift is added
      // AFTER the blend, otherwise the target would cancel it out along
      // with the pose — but it has to survive a head turned with no
      // pointer.
      yaw: lerp(pose.gaze.yaw, look.yaw, look.mix) + life.dYaw - look.spin,
      pitch: lerp(pose.gaze.pitch, look.pitch, look.mix) + life.dPitch,
      // roll, on the other hand, follows nothing: the bot's head is tilted
      // -13deg in the video, and rolling it with the cursor would break
      // that signature
      roll: pose.gaze.roll + life.dRoll
    }

    // blink triggered by the state change, on top of the schedule
    const forced = clamp((now - this.blinkAt) / 0.2)
    const forcedLid = forced < 1 ? Math.abs(forced * 2 - 1) : 1
    const lid = Math.min(life.lid, forcedLid)

    const offX = pose.offX + life.driftX
    const offY = pose.offY + life.driftY

    // --- body ---------------------------------------------------------------
    const sil: Silhouette = {
      ...pose.sil,
      cx: pose.sil.cx + offX,
      cy: pose.sil.cy + offY,
      sy: pose.sil.sy * life.breath
    }
    const bodyPath = closedPath(toPoints(sil, R, this.pts))

    // --- eyes -----------------------------------------------------------------
    // The eyes live on a radius-1 sphere; as soon as the silhouette isn't a
    // circle anymore, they're brought back pro-rated by the real radius in
    // their direction, otherwise they overflow and the mask clips them.
    const bodyRadius = (x: number, y: number) =>
      radiusAtAngle(pose.sil.radii, Math.atan2(y, x) - pose.sil.rot)

    /**
     * bolota divergence from the bloub port: the body path (`sil` above, a
     * few lines up) is drawn at `pose.sil.cx + offX, pose.sil.cy + offY` — but
     * this eye matrix used to add only `offX/offY`, never `pose.sil.cx/cy`.
     * Every OTHER state has `sil.cx === sil.cy === 0` (bloub's own `base()`/
     * `circle()` default), so the omission was invisible everywhere except
     * `orbit`: its silhouette recenters every frame (`spinningTriangle`'s
     * `TRI_ORBIT`-scaled `cx/cy`, up to +-0.213 of ball radius, itself spinning
     * with `rot`) while the eyes stayed pinned to world origin — the body
     * visibly orbits its own center and the eyes do not, which is the
     * "drifts off the face" report a nearest-contour-point check confirmed
     * (rendered eye center measured up to 1.45x the local body radius away
     * from the silhouette centroid, i.e. genuinely outside the body, not just
     * a readability complaint). Adding the same `sil.cx/cy` term used for the
     * body keeps the eyes riding the body's own center exactly like every
     * other silhouette-attached element already does.
     */
    const bodyCx = pose.sil.cx * R
    const bodyCy = pose.sil.cy * R

    const eyes: RenderedEye[] = []
    if (pose.eyeAlpha > 0.01) {
      const poses = eyePoses(gaze, R, pose.split)
      for (let i = 0; i < 2; i++) {
        const e = poses[i]!
        if (e.depth <= 0.02) continue
        const cfg = pose.eyes[i]!
        const fit = bodyRadius(e.x, e.y)
        // The eye's own tilt: the tangent frame is composed with a rotation
        // in the eye's own plane (Basis x Rot). That's what allows mirrored
        // tilts between the two eyes.
        const phi = ((cfg.tilt ?? 0) * Math.PI) / 180
        const cp = Math.cos(phi)
        const sp = Math.sin(phi)
        const ax = e.a * cp + e.c * sp
        const ay = e.b * cp + e.d * sp
        const cx2 = -e.a * sp + e.c * cp
        const cy2 = -e.b * sp + e.d * cp
        // The blink is applied AFTER all of that: it's a vertical squash on
        // screen, not along the capsule's own axis.
        const k = blinkScale(Math.min(lid, cfg.open))
        eyes.push({
          d: capsulePath(cfg.w * R, cfg.h * R),
          matrix: `matrix(${r2(ax)},${r2(ay * k)},${r2(cx2)},${r2(cy2 * k)},${r2(e.x * fit + bodyCx + (offX + offset.x) * R)},${r2(e.y * fit + bodyCy + (offY + offset.y) * R)})`,
          alpha: pose.eyeAlpha * clamp(e.depth / 0.12)
        })
      }
    }

    // --- decor ----------------------------------------------------------------
    const dots = pose.dots
      .filter((p) => p.opacity > 0.01 && p.r > 0.0005)
      .map((p) => ({ ...p, x: (p.x + offX) * R, y: (p.y + offY) * R, r: p.r * R }))

    // the badge sits on the outline: so it follows the shape too
    const nFit = pose.notif ? bodyRadius(pose.notif.x, pose.notif.y) : 1
    const nx = pose.notif ? (pose.notif.x * nFit + offX) * R : 0
    const ny = pose.notif ? (pose.notif.y * nFit + offY) * R : 0
    const notif = pose.notif ? { x: nx, y: ny, r: pose.notif.r * R } : null
    const notch = pose.notif ? { x: nx, y: ny, r: pose.notif.notch * R } : null

    return {
      bodyPath,
      bodyAlpha: pose.bodyAlpha,
      eyes,
      dots,
      dotsBehind: pose.dotsBehind,
      // States declare arcs in units of ball radius; the engine is the
      // only thing that knows the viewBox scale, so it's the one that
      // rasterizes them.
      arcs: pose.arcs
        .filter((a) => a.opacity > 0.01)
        .map((a) => arcRender(a.seed, a.t, R, a.id, a.opacity)),
      notif,
      notch
    }
  }
}
