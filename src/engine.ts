// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

import type { BolotaOptions } from "./bolota";
import { CHOREO } from "./live/choreo";
import { mountLive } from "./live/mount";
import { ALIASES } from "./live/names";

export type EngineOptions = Omit<BolotaOptions, "expression"> & {
  /** Initial held expression: a roster name or a bloub id. */
  expression?: string;
};

export interface EngineHandle {
  /** Plays a state by id (see `states`). Throws on an unknown id. */
  play(
    state: string,
    opts?: {
      loop?: boolean;
      /** Seconds to dwell on the finished pose before handing back (default 0.45). Ignored while looping. */
      hold?: number;
      /** State to settle into afterwards. Defaults to whatever was resting before this call. */
      rest?: string;
      /**
       * Seconds the state should own. States with a period keep running, the
       * rest stretch one pass to fill it, burst and comet hold their settled
       * pose. A window shorter than the state is ignored. Ignored while looping.
       */
      for?: number;
    },
  ): void;
  /** Sugar for `play(state, { loop: true })`. */
  loop(state: string): void;
  /** Freezes the current frame and releases the frame clock. */
  stop(): void;
  /**
   * Enables cursor-follow while the pointer moves over `target` (an element, or
   * `"window"`, the default), or disables it with `false`. Off by default.
   */
  follow(target?: Element | "window" | false): void;
  /** Stops and restores every node this call to `mountEngine` touched. */
  destroy(): void;
  /** Every playable state id. */
  states: string[];
  /**
   * Sets, or with `null` clears, the held eye expression. Accepts a roster name
   * or a bloub id; unknown names are ignored. Visible on states that rest on the
   * base face (`idle`, `wander`, `swirl`) and on `play`, `burst`, `comet`.
   */
  setExpression(name: string | null): void;
  /** The bloub expression ids; every roster name from `bolota/expression` is accepted as well. */
  expressions: string[];
}

/** Every playable state id. */
export function engineStates(): string[] {
  return Object.keys(CHOREO);
}

/** The bloub expression ids that `EngineHandle.expressions` lists. */
export function engineExpressions(): string[] {
  return Object.keys(ALIASES);
}

/**
 * Mounts the live engine on `svg` and starts it on `"idle"`. Markup already
 * rendered by `parts()` is upgraded in place; an empty `<svg>` is filled.
 * Pair with `@luzir/bolota/motion.css`. Honours `prefers-reduced-motion` with
 * one static frame and no clock.
 */
export function mountEngine(svg: SVGSVGElement, name: string, opts?: EngineOptions): EngineHandle {
  return mountLive(svg, name, opts);
}

export {
  CHOREO as _CHOREO,
  clamp as _clamp,
  contrast as _contrast,
  edge as _edge,
  ensureContrast as _ensureContrast,
  fromHex as _fromHex,
  mixHex as _mixHex,
  putter as _putter,
  r3 as _r3,
  toHex as _toHex,
} from "./live/shared";
