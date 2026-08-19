/**
 * Ported verbatim from bloub (https://github.com/jeremyPerret/bloub),
 * MIT License, Copyright (c) 2026 Jérémy Perret.
 *
 * Cursor-follow gaze rule — where the bot looks when it tracks the pointer.
 * Not adapted — see ../engine.ts for the bolota-specific bridge (seed-to-
 * silhouette conversion, DOM mounting, rAF loop, the `follow()` API). This
 * file's own logic and structure are untouched beyond TS-strict fixes,
 * import paths, and translating the original French comments/identifiers to
 * English (see ../engine.ts's header for the provenance note) — including
 * `HUMEURS`, now `MOODS`.
 */
import type { Look } from './engine'
import type { ExpressionId } from './expressions'
import { clamp, easings } from './math'

/**
 * Where the bot looks when it tracks the pointer. Pure, like
 * `src/ui/timeline.ts`: the pointer position comes in already-normalized
 * coordinates, so the rule tests without a DOM — and it needs to, because two
 * signs are easy to get backward here.
 */

/**
 * Head-orientation angles, in degrees. CHOSEN, not measured: the reference
 * video shows no cursor-follow at all. Wide enough to read as distinct from
 * the idle drift (+-7deg yaw, +-5.5 pitch), restrained enough that no eye
 * slips behind the sphere's limb.
 */
export const YAW_MAX = 16
export const PITCH_MAX = 13

/**
 * Height the gaze holds at, cursor centered. CHOSEN: slightly above the
 * equator, which reads as an attentive bot rather than a vacant one.
 *
 * This is an ABSOLUTE value, and that's the whole point: as a relative one,
 * eye height used to follow each expression's own, and since "aside" looks
 * at +28.6deg while the moods sit between -9 and +9, the eyes would jump the
 * instant a mood changed.
 */
export const PITCH = 10

/**
 * Direction the head settles into in the settings view: the bot stops
 * looking to its resting upper right and looks LEFT, toward the panel.
 *
 * This isn't a mirror of the image: the eyes genuinely travel around the
 * sphere, so they keep their `\\` tilt and their depth compression. Flipping
 * the image would have laid them down as `//`.
 */
export const TURN = 26

/**
 * Full turn traveled EN ROUTE: the eyes don't slide across the face, they go
 * around the ball before arriving.
 *
 * It's free because the eyes live on a sphere: past 90deg of yaw they cross
 * the limb, the engine drops them from the image, then they reappear on the
 * other side. So the swirl isn't an effect laid on top, it's the same
 * orthographic projection pushed a full turn.
 *
 * And crucially: it lands EXACTLY by construction, `-360deg` being the same
 * angle as `0`. That's what sets it apart from a gaze pose written into a
 * state, which leaves the eyes wherever its curve happens to end.
 */
export const SPIN = 360

/**
 * Turn duration. A bit shorter than the entrance block (`swirl`): the eyes
 * need to be settled to the left before the rings fade out.
 */
export const TURN_TIME = 1.1

/**
 * Moods the bot cycles through while tracking the cursor.
 *
 * All of them have ZERO roll, and that's the selection criterion. Yaw and
 * pitch are neutralized by the follow (they're absolute), but not roll — it
 * tilts the head, so it moves the eyes vertically, and a mood at -15deg
 * followed by one at +8 would make them jump. What's left to tell the moods
 * apart is eye SHAPE: round, squinted, wide, flat. That's plenty, and it's
 * what actually reads.
 *
 * So this isn't a list of favorites: adding "curious" (roll -15deg) would
 * bring the jump back.
 */
export const MOODS: readonly ExpressionId[] = [
  'surprised',
  'happy',
  'laughing',
  'excited',
  'proud',
  'unimpressed'
]

/* ------------------------------------------------- arrival gaze scripts */

/**
 * A SCRIPTED gaze: evaluated every frame against the time elapsed since the
 * arrival started, in seconds. The script therefore carries its own clock and
 * can chain several movements — the component only evaluates it and never
 * needs to know a duration.
 *
 * RULE, and it's what makes a script maintenance-free: it must END at
 * `mix: 0`, where the state's own pose takes over alone. There's then never
 * anything to release, and that release — which would show up as one last
 * slide of the eyes, right when everything should be settled — never happens.
 *
 * The type stays general even though there's only one script today: four
 * were written and compared side by side before keeping one, and it's this
 * shape that made trying them out possible without touching the engine.
 */
export type GazeScript = (t: number) => Look

/**
 * "The turn": the ball looks like it's spinning on itself.
 *
 * `mix` stays at ZERO from start to end: no direction is imposed, only
 * `spin` fades, which sends the eyes BEHIND the ball before bringing them
 * back exactly where the chosen expression puts them.
 *
 * Ease-in-out, not the exponential ease-out used everywhere else in the
 * project: this isn't a value settling, it's an object spinning. On ease-out,
 * two thirds of the turn were eaten up in 0.3s — a jerk, not a rotation.
 *
 * It's FAST crossing the limb — 20px between two frames on a 100-radius ball
 * — and that's not a tuning flaw: near the edge, a small angle becomes a
 * large on-screen displacement, and the eye vanishes then reappears on the
 * other side. Slowing it down changes nothing, it's the trajectory that
 * causes it, and that's exactly what sells the effect. Don't try to soften it.
 *
 * Necessary corollary: this turn only plays out on a CIRCLE. The eyes are
 * glued to the real outline (`radiusAtAngle`), so on a non-circular shape
 * they'd follow the profile while turning and stutter. See `shape` in
 * `App.vue`.
 */
export const TOUR_TIME = 1.5

export const tourLook: GazeScript = (t) => ({
  yaw: 0,
  pitch: 0,
  mix: 0,
  spin: SPIN * (1 - easings.easeInOutCubic(clamp(t / TOUR_TIME))),
  wander: 1
})

export interface Aim {
  /** horizontal offset of the pointer from the bot's center, -1 to 1 (right positive) */
  nx: number
  /** vertical offset, -1 to 1, in screen sense (down positive) */
  ny: number
  /** arrival progress, 0 to 1 */
  tour: number
  /** false = no known pointer: the head stays turned, but it comes back to life */
  pointer: boolean
}

/**
 * Gaze target.
 *
 * `tour` drives everything: it raises the hold on the pose (`mix`) and fades
 * the turn traveled (`spin`) at the same time. At 0 the state's own pose
 * commands alone; at 1 the head is settled to the left and follows the
 * cursor.
 *
 * Nothing here compensates for the displayed expression: that's the engine's
 * job to blend, since only it knows the pose at instant t. Doing it here
 * would require reading the expression's ARRIVAL yaw while the engine is
 * still mid-morph — and the eyes would jump on every mood change.
 */
export function lookTarget({ nx, ny, tour, pointer }: Aim): Look {
  return {
    yaw: -TURN + nx * YAW_MAX,
    // positive pitch = looking up, while screen y goes down
    pitch: PITCH - ny * PITCH_MAX,
    mix: tour,
    spin: SPIN * (1 - tour),
    // Without a pointer the head stays turned toward the panel, but its
    // drift is given back: otherwise the bot stares at a dead point, and
    // arriving by keyboard or touch left the avatar completely still.
    wander: pointer ? 0 : 1
  }
}
