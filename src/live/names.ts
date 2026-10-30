// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

import * as roster from "../expression";
import type { Expression } from "../expression";

export type RosterName =
  | "idle"
  | "happy"
  | "sad"
  | "mad"
  | "surprised"
  | "wink"
  | "sleepy"
  | "smug"
  | "unsure"
  | "scared"
  | "love"
  | "shy"
  | "sick"
  | "attentive"
  | "excited"
  | "laughing"
  | "curious"
  | "proud";

/**
 * Every bloub expression id, onto the unified roster. `null` is the resting
 * face: `wander` was bloub's measured sideways glance, which is a gaze and not
 * an eye pose, so it has no static equivalent.
 */
export const ALIASES = {
  wander: null,
  attentive: "attentive",
  surprised: "surprised",
  excited: "excited",
  happy: "happy",
  laughing: "laughing",
  angry: "mad",
  sad: "sad",
  scared: "scared",
  suspicious: "smug",
  confused: "unsure",
  curious: "curious",
  proud: "proud",
  shy: "shy",
  unimpressed: "smug",
  sleepy: "sleepy",
  love: "love",
} as const satisfies Record<string, RosterName | null>;

const POSES: Record<RosterName, Expression> = {
  idle: roster.idle,
  happy: roster.happy,
  sad: roster.sad,
  mad: roster.mad,
  surprised: roster.surprised,
  wink: roster.wink,
  sleepy: roster.sleepy,
  smug: roster.smug,
  unsure: roster.unsure,
  scared: roster.scared,
  love: roster.love,
  shy: roster.shy,
  sick: roster.sick,
  attentive: roster.attentive,
  excited: roster.excited,
  laughing: roster.laughing,
  curious: roster.curious,
  proud: roster.proud,
};

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * The pose a name means, from either vocabulary: a roster name or a bloub id.
 * `null` for the resting face and for names neither knows; never throws.
 */
export function resolveExpression(name: string): Expression | null {
  if (has(POSES, name)) return POSES[name as RosterName];
  const key = has(ALIASES, name) ? ALIASES[name as keyof typeof ALIASES] : null;
  return key ? POSES[key] : null;
}
