// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

/**
 * Friendly names for four of `mountEngine`'s bloub states, kept from the
 * (now-removed) CSS-keyframe version of this file for anyone already calling
 * `runSequence(handle, "burst")` — a one-line lookup, not a runtime of its
 * own. `mountEngine`'s `play()` already returns to `"idle"` once a
 * non-looping state's duration elapses, so there is nothing left for a
 * sequence runner to schedule; see `engine.ts`'s `tick()`.
 */
import type { EngineHandle } from "./engine";

/** `entrance` maps to bloub's `"swirl"` — the one state in `bloub/states.ts`
 * that exists purely as an interface transition, not part of its `SEQUENCE`
 * catalog, which is exactly the role an entrance plays here too. */
export const SEQUENCES = {
  entrance: "swirl",
  burst: "burst",
  orbit: "orbit",
  comet: "comet",
} as const;

export type SequenceName = keyof typeof SEQUENCES;

/** Plays a named sequence once on an engine mounted by `mountEngine`. */
export function runSequence(handle: EngineHandle, name: SequenceName): void {
  handle.play(SEQUENCES[name]);
}
