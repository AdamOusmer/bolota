// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

/**
 * Turns an engine id into a display label without hand-maintaining a parallel
 * list that can drift out of sync with the engine's own roster, labels here
 * are always derived from `handle.states` / `engineStates()` at runtime, so
 * a rename on the engine side (e.g. a state id changing) shows up correctly
 * with zero changes on the site.
 */
export function humanizeId(id: string): string {
  return id
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * bloub's face expressions used to carry French ids, which is what this
 * used to be a lookup table for. `src/bloub/expressions.ts` translates its
 * whole catalog to English now (`neutral`, `attentive`, `unimpressed`, ...,
 * see that file's own port note), so every id `handle.expressions` can
 * actually produce today already round-trips through `humanizeId` correctly
 * and the table had gone dead: no id in the current roster hit it, every
 * lookup fell through to the `humanizeId` fallback anyway. Kept as its own
 * named export, not inlined at call sites, so a future bespoke label (or a
 * reintroduced non-English id) has somewhere to go without touching
 * script/sections/expressions.ts.
 */
export function humanizeExpression(id: string): string {
  return humanizeId(id);
}
