// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

import { IDENT, lerpPose, type Pose } from "../morph";
import { IDLE_ACT, type Act } from "./act";

/**
 * The bloub state catalog reduced to what it does to the body and the eyes:
 * one `Act` and one `Eyes` per instant, plus the timing the timeline plays
 * them by.
 *
 * Every body number here is transcribed from `bloub/states.ts`, and the two
 * have to change together until that file is retired;
 * `test/live-parity.test.ts` holds them equal. What is left behind is
 * everything a state draws rather than moves: its silhouette profile, which
 * `BotEngine.posed()` replaces with the seed's own on a bolota anyway, and its
 * decor.
 *
 * Only the profile's mean radius survives, as `s`, because that is the scale
 * `posed()` applies to the seed's outline on every state that is not
 * `baseBody`. A `baseBody` state keeps the seed at its own size, so its `s` is
 * 1 whatever its profile says.
 *
 * The eyes are re-expressed rather than transcribed: bloub places its own eyes
 * on a sphere, a bolota keeps its seeded ones, so each state's eye shape, head
 * roll and gaze land on the `Pose` channels and a `Track` that mean the same
 * thing on screen. Eyes ride inside the act's transform, so a state that
 * shrinks the body takes the face with it. `orbit` spins the body and keeps the
 * face level through `Act.upright`, as bloub does; `play` holds its triangle
 * unturned, so its face is level without it.
 */

const TAU = Math.PI * 2;

export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
export const easeOutQuint = (t: number) => 1 - (1 - t) ** 5;

/** `thinking`'s middle dot, which the body becomes. From `bloub/decor.ts`. */
const DOT_X1 = -0.013;
const DOT_R = 0.165;
const DOT_PEAK = 1.25;
/** `comet`'s collapsed radius. From `bloub/decor.ts`. */
const COMET_DOT = 0.129;
/** `alert`/`exclaim`: the body is the glyph's dot. */
const GLYPH_DOT_R = 0.34;
const GLYPH_DOT_CY = 0.42;
/** `play`/`orbit`: the triangle's centre circles the origin at this radius. */
const TRI_ORBIT = 0.213;
/**
 * Mean radius of bloub's measured triangle profile, summed in index order as
 * `posed()` sums it. That mean is the whole of what the triangle still does on
 * a bolota: `play` and `orbit` draw the seed at 86% size.
 */
const TRI_MEAN = 0.8605015624999998;
const ORBIT_PERIOD = 4 / 1.25;
const WINK_CLOSE = 0.16;
const WINK_HOLD = 0.12;
const WINK_OPEN = 0.18;
const WINK_PERIOD = WINK_CLOSE + WINK_HOLD + WINK_OPEN + 1.04;

/** A gaze direction in `--mo-track-x/y` units: -1..1, positive = right and down. */
export interface Track {
  x: number;
  y: number;
}

export interface Eyes {
  pose: Pose;
  track: Track;
  /** Face opacity, 0–1. The same curve as `Act.eyeAlpha`; a renderer reads one of them. */
  alpha: number;
}

/**
 * The head turn, in degrees, a track of 1 stands for. A renderer that turns
 * the face sphere by `track × TRACK_TURN` reproduces bloub's glance. 35° is
 * bloub's own follow limit.
 */
export const TRACK_TURN = 35;

export const CENTRE: Track = { x: 0, y: 0 };

/** bloub's head `yaw`/`pitch` in degrees as a track. bloub's pitch is up-positive. */
const look = (yaw: number, pitch: number): Track => ({
  x: yaw / TRACK_TURN,
  y: -pitch / TRACK_TURN,
});

/**
 * bloub's head roll, clockwise-positive degrees: both eyes lean the same way.
 * Locked, because bloub draws every eye at the roll alone; the seeded lean
 * stacked on top doubles it on half the seeds and cancels it on the rest.
 */
const roll = (deg: number) => ({ tilt: -deg, tilt2: 2 * deg, lock: 1 });

const pose = (p: Partial<Pose>): Pose => ({ ...IDENT, ...p });

const REST: Eyes = { pose: IDENT, track: CENTRE, alpha: 1 };
const EYELESS: Eyes = { pose: IDENT, track: CENTRE, alpha: 0 };
const rest = (): Eyes => REST;
const eyeless = (): Eyes => EYELESS;

/** bloub's `REST_GAZE`: the sideways, upward glance `wander` holds. */
const WANDER_EYES: Eyes = { pose: pose(roll(-13)), track: look(28.49, 28.62), alpha: 1 };

/**
 * bloub's open 0.236 × 0.464 eye and its 0.447 × 0.089 slit, as factors on the
 * seeded capsule, which is already taller than bloub's.
 */
const WINK_OPEN_POSE = pose({ esx: 1.15, esy: 1.05, edx: 0.4, ...roll(6.7) });
const WINK_SHUT_POSE: Pose = { ...WINK_OPEN_POSE, esx2: 0.7, esy2: -0.85 };
const WINK_LOOK = look(-5.37, 4.55);

function winkShut(t: number): number {
  if (t < WINK_CLOSE) return easeInOutCubic(clamp(t / WINK_CLOSE));
  if (t < WINK_CLOSE + WINK_HOLD) return 1;
  return 1 - easeInOutCubic(clamp((t - WINK_CLOSE - WINK_HOLD) / WINK_OPEN));
}

/**
 * bloub's 0.356 × 0.875 stare, held to what a seeded face contains. Its pitch
 * of −22° is not carried over: bloub's eye anchor re-centres a stare that
 * large, and on screen the eyes sit level, so a faithful track reads as
 * downcast instead of startled.
 */
const WIDE_EYES: Eyes = {
  pose: pose({ esx: 1.6, esy: 1.4, edx: 1.5, ...roll(11.6) }),
  track: look(6.92, 0),
  alpha: 1,
};

/** Big round eyes, turned away from the badge. */
const NOTIFY_EYES: Eyes = {
  pose: pose({ esx: 1.9, esy: 0.8, edx: 1.5, ...roll(-12.2) }),
  track: look(-21.94, -5.82),
  alpha: 1,
};

/** bloub's 0.18 × 0.34 eyes for `play` and `orbit`, a little under rest. */
const SMALL = { esx: 0.97, esy: 0.83 };
const PLAY_EYES: Eyes = { pose: pose({ ...SMALL, ...roll(-6) }), track: look(12, -8), alpha: 1 };
const ORBIT_JOSTLE_YAW = 16;
const ORBIT_JOSTLE_PITCH = 10;
const ORBIT_JOSTLE_ROLL = 6;

export interface Choreo {
  /** Seconds a one-shot runs before handing back (plus the timeline's hold). */
  duration: number;
  /** Below this the gesture is cut off before it completes. */
  minDuration?: number;
  /** Seconds of the entrance cross-fade from whatever was showing. */
  morph: number;
  /** Phase length a looped play wraps on; absent = restarted every `duration + morph`. */
  period?: number;
  /** How a `for` window longer than `duration` is filled when there is no `period`. */
  fill?: "stretch" | "hold";
  /** The entrance is masked by a blink. */
  blinkIn: boolean;
  /** The body is the resting silhouette: the seed at full size. */
  baseBody: boolean;
  /** The face is the resting face: replaceable by an expression, followable. */
  baseFace: boolean;
  /** Eye pose may be replaced by an expression, body and timing stay the state's. */
  acceptsExpression?: boolean;
  /** Ambient wander and drift must not compose on top. */
  ownsLiveliness?: boolean;
  /** Local time at which the state reads best, for a single still frame. */
  still: number;
  act(local: number): Act;
  /** What the state does to the seeded eyes, before any expression. */
  eyes(local: number): Eyes;
}

const still = (): Act => IDLE_ACT;

function dotPulse(t: number, index: number): number {
  const p = ((((t - index * 0.5) / 1.5) % 1) + 1) % 1;
  const k = p < 0.5 ? 0.5 - 0.5 * Math.cos(p * TAU) : 0;
  return clamp(k * 2);
}

/** `burst` and `comet`: collapse, sit, regrow, with the face fading on the same curve. */
function collapse(t: number, down: number, depth: number, at: number, up: number) {
  const frac = easeOutQuint(clamp(t / down));
  const shrunk = 1 - depth * frac;
  const regrow = easeOutQuint(clamp((t - at) / up));
  return { s: shrunk + (1 - shrunk) * regrow, eyeAlpha: t < at ? 1 - frac : regrow };
}

const burstCollapse = (t: number) => collapse(t, 0.7, 0.834, 1.7, 0.7);
const cometCollapse = (t: number) => collapse(t, 0.55, 1 - COMET_DOT, 1.85, 0.6);
const fading = (alpha: number): Eyes => ({ pose: IDENT, track: CENTRE, alpha });

export type StateId =
  | "idle"
  | "wander"
  | "thinking"
  | "wink"
  | "wide"
  | "alert"
  | "notify"
  | "exclaim"
  | "snooze"
  | "play"
  | "orbit"
  | "swirl"
  | "burst"
  | "comet";

export const CHOREO: Record<StateId, Choreo> = {
  idle: {
    duration: 2.4,
    morph: 0.45,
    blinkIn: false,
    baseBody: true,
    baseFace: true,
    ownsLiveliness: true,
    still: 1,
    act: still,
    eyes: rest,
  },
  wander: {
    duration: 2.4,
    morph: 0.45,
    blinkIn: false,
    baseBody: true,
    baseFace: true,
    still: 1,
    act: still,
    eyes: () => WANDER_EYES,
  },
  thinking: {
    duration: 2.6,
    morph: 0.4,
    blinkIn: true,
    baseBody: false,
    baseFace: false,
    still: 1.1,
    act: (t) => ({
      ...IDLE_ACT,
      x: DOT_X1,
      s: DOT_R * (1 + (DOT_PEAK - 1) * dotPulse(t, 1)),
      eyeAlpha: 0,
    }),
    eyes: eyeless,
  },
  wink: {
    duration: 1.6,
    morph: 0.3,
    period: WINK_PERIOD,
    blinkIn: true,
    baseBody: true,
    baseFace: false,
    still: 0.8,
    act: still,
    eyes: (t) => ({
      pose: lerpPose(WINK_OPEN_POSE, WINK_SHUT_POSE, winkShut(t)),
      track: WINK_LOOK,
      alpha: 1,
    }),
  },
  wide: {
    duration: 1.8,
    morph: 0.55,
    blinkIn: true,
    baseBody: true,
    baseFace: false,
    still: 0.8,
    act: still,
    eyes: () => WIDE_EYES,
  },
  alert: {
    duration: 2.4,
    minDuration: 2,
    morph: 0.45,
    blinkIn: false,
    baseBody: false,
    baseFace: false,
    still: 0.75,
    act: (t) => {
      const travel = easeInOutCubic(clamp(t / 1.5)) * 0.82 - 0.087;
      const back = t > 1.6 ? clamp((t - 1.6) / 0.4) : 0;
      const buzz = Math.sin(t * 2.5 * TAU) * 0.005;
      return {
        ...IDLE_ACT,
        x: travel * (1 - back) + 0.1 * back,
        y: GLYPH_DOT_CY + buzz * 2.8,
        s: GLYPH_DOT_R,
      };
    },
    eyes: rest,
  },
  notify: {
    duration: 2.2,
    morph: 0.5,
    blinkIn: true,
    baseBody: true,
    baseFace: false,
    still: 0.9,
    act: still,
    eyes: () => NOTIFY_EYES,
  },
  exclaim: {
    duration: 2,
    morph: 0.45,
    blinkIn: false,
    baseBody: false,
    baseFace: false,
    still: 0.8,
    act: () => ({ ...IDLE_ACT, y: GLYPH_DOT_CY, s: GLYPH_DOT_R }),
    eyes: rest,
  },
  snooze: {
    duration: 2.4,
    morph: 0.5,
    blinkIn: false,
    baseBody: false,
    baseFace: false,
    still: 0.45,
    act: (t) => ({
      ...IDLE_ACT,
      y: 0.11 + Math.sin(t * (TAU / 0.6)) * 0.19,
      s: 0.1585,
      eyeAlpha: 0,
    }),
    eyes: eyeless,
  },
  play: {
    duration: 2,
    morph: 0.5,
    blinkIn: true,
    baseBody: false,
    baseFace: false,
    acceptsExpression: true,
    still: 0.9,
    act: () => ({ ...IDLE_ACT, y: TRI_ORBIT, s: TRI_MEAN }),
    eyes: () => PLAY_EYES,
  },
  orbit: {
    duration: 3.4,
    morph: 0.6,
    period: ORBIT_PERIOD,
    blinkIn: false,
    baseBody: false,
    baseFace: false,
    ownsLiveliness: true,
    still: 1.2,
    act: (t) => {
      const rot = -TAU * 1.25 * t;
      return {
        ...IDLE_ACT,
        x: -TRI_ORBIT * Math.sin(rot),
        y: TRI_ORBIT * Math.cos(rot),
        rot: (rot * 180) / Math.PI,
        s: TRI_MEAN,
        upright: 1,
      };
    },
    eyes: (t) => {
      const rot = -TAU * 1.25 * t;
      return {
        pose: pose({ ...SMALL, ...roll(Math.sin(rot * 2) * ORBIT_JOSTLE_ROLL) }),
        track: look(Math.sin(rot) * ORBIT_JOSTLE_YAW, Math.cos(rot) * ORBIT_JOSTLE_PITCH),
        alpha: 1,
      };
    },
  },
  swirl: {
    duration: 1.3,
    minDuration: 1.3,
    morph: 0.3,
    blinkIn: true,
    baseBody: true,
    baseFace: true,
    still: 0.5,
    act: still,
    eyes: rest,
  },
  burst: {
    duration: 2.6,
    minDuration: 2.4,
    morph: 0.4,
    fill: "hold",
    blinkIn: false,
    baseBody: false,
    baseFace: false,
    acceptsExpression: true,
    still: 0.45,
    act: (t) => ({ ...IDLE_ACT, ...burstCollapse(t) }),
    eyes: (t) => fading(burstCollapse(t).eyeAlpha),
  },
  comet: {
    duration: 2.4,
    minDuration: 2.4,
    morph: 0.45,
    fill: "hold",
    blinkIn: false,
    baseBody: false,
    baseFace: false,
    acceptsExpression: true,
    still: 1.15,
    act: (t) => ({
      ...IDLE_ACT,
      ...cometCollapse(t),
      y: Math.sin(clamp(t / 1.7) * Math.PI) * 0.035,
    }),
    eyes: (t) => fading(cometCollapse(t).eyeAlpha),
  },
};

/** bloub's `BotEngine.EXPRESSION_MORPH`: how long a change of expression glides. */
export const EXPRESSION_MORPH = 0.55;

/**
 * The state's eyes with an expression shown through, where the state lets one:
 * a resting face (`baseFace`) or a state that hands its eye pose over
 * (`acceptsExpression`). The expression takes the pose and the gaze, as bloub's
 * replaces gaze, split and eye shape; the state keeps the opacity. `null` is no
 * expression, so the state's own eyes.
 */
export function expressed(c: Choreo, own: Eyes, expression: Pose | null): Eyes {
  if (!expression || !(c.baseFace || c.acceptsExpression)) return own;
  return { pose: expression, track: CENTRE, alpha: own.alpha };
}

export function blendEyes(a: Eyes, b: Eyes, t: number): Eyes {
  return {
    pose: lerpPose(a.pose, b.pose, t),
    track: { x: a.track.x + (b.track.x - a.track.x) * t, y: a.track.y + (b.track.y - a.track.y) * t },
    alpha: a.alpha + (b.alpha - a.alpha) * t,
  };
}

/** bloub's `blinkScale`: a closed lid still shows 6% of the eye. */
export const blinkScale = (lid: number) => 0.06 + 0.94 * clamp(lid);

/** The blink masking a `blinkIn` entrance: shut at 0.1 s, open again at 0.2 s. */
export const ENTRANCE_BLINK = 0.2;

/** `e` with the entrance blink `since` seconds into it applied, as a vertical squash. */
export function blinked(e: Eyes, since: number): Eyes {
  if (since >= ENTRANCE_BLINK || since < 0) return e;
  const k = blinkScale(Math.abs((since / ENTRANCE_BLINK) * 2 - 1));
  return { ...e, pose: { ...e.pose, esy: e.pose.esy * k, esy2: e.pose.esy2 * k } };
}
