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

/**
 * Plays a named sequence on an engine mounted by `mountEngine`.
 *
 * Takes `play`'s own options, so a sequence can fill a slot (`for`), linger on
 * its finished pose (`hold`), or settle somewhere specific (`rest`) without a
 * caller having to know which state the name maps to.
 */
export function runSequence(
  handle: EngineHandle,
  name: SequenceName,
  opts?: Parameters<EngineHandle["play"]>[1],
): void {
  handle.play(SEQUENCES[name], opts);
}
