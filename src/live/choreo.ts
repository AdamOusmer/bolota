// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

import { IDLE_ACT, type Act } from "./act";

/**
 * The bloub state catalog reduced to what it does to the body: one `Act` per
 * instant, plus the timing the timeline plays it by.
 *
 * Every number here is transcribed from `bloub/states.ts`, and the two have to
 * change together until that file is retired; `test/live-parity.test.ts`
 * holds them equal. What is left behind is everything a state draws rather
 * than moves: its silhouette profile, which `BotEngine.posed()` replaces with
 * the seed's own on a bolota anyway, and its eyes, gaze and decor.
 *
 * Only the profile's mean radius survives, as `s`, because that is the scale
 * `posed()` applies to the seed's outline on every state that is not
 * `baseBody`. A `baseBody` state keeps the seed at its own size, so its `s` is
 * 1 whatever its profile says.
 */

const TAU = Math.PI * 2;

export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
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
const WINK_PERIOD = 0.16 + 0.12 + 0.18 + 1.04;

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
  },
  wander: {
    duration: 2.4,
    morph: 0.45,
    blinkIn: false,
    baseBody: true,
    baseFace: true,
    still: 1,
    act: still,
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
  },
  wide: {
    duration: 1.8,
    morph: 0.55,
    blinkIn: true,
    baseBody: true,
    baseFace: false,
    still: 0.8,
    act: still,
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
  },
  notify: {
    duration: 2.2,
    morph: 0.5,
    blinkIn: true,
    baseBody: true,
    baseFace: false,
    still: 0.9,
    act: still,
  },
  exclaim: {
    duration: 2,
    morph: 0.45,
    blinkIn: false,
    baseBody: false,
    baseFace: false,
    still: 0.8,
    act: () => ({ ...IDLE_ACT, y: GLYPH_DOT_CY, s: GLYPH_DOT_R }),
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
    act: (t) => ({ ...IDLE_ACT, ...collapse(t, 0.7, 0.834, 1.7, 0.7) }),
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
      ...collapse(t, 0.55, 1 - COMET_DOT, 1.85, 0.6),
      y: Math.sin(clamp(t / 1.7) * Math.PI) * 0.035,
    }),
  },
};
