// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

/**
 * Friendly names for four of the engine's states: a one-line lookup, not a
 * runtime. `play()` already hands back to the resting state once a one-shot
 * ends, so there is nothing for a sequence runner to schedule.
 */
import type { EngineHandle } from "./engine";

/** `entrance` is `"swirl"`, the state that exists as an interface transition. */
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
