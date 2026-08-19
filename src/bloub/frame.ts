/**
 * Ported verbatim from bloub (https://github.com/jeremyPerret/bloub),
 * MIT License, Copyright (c) 2026 Jérémy Perret.
 *
 * Viewbox/scale constants the engine's output is defined in. Not adapted — see ../engine.ts for the bolota-specific bridge
 * (seed-to-silhouette conversion, DOM mounting, rAF loop). This file's
 * own logic and structure are untouched beyond TS-strict fixes, import
 * paths, and translating the original French comments/identifiers to
 * English (see ../engine.ts's header for the provenance note). Renamed
 * from the original `repere.ts` ("reference frame") to `frame.ts`.
 */
/**
 * The reference frame everything the engine renders is defined in.
 *
 * `engine.sample()` outputs coordinates in viewBox units, and these two numbers are
 * their definition: without them, an engine output means nothing. They used to live
 * inside `BloubBot.vue`, so out of reach — a `<script setup>` exports nothing — and
 * `export.ts` restated one by hand with a comment that named the problem.
 *
 * They live here because `src/bot/` is what gets read and consumed from the outside: the
 * Vue component is A client of the engine, not its definition.
 */

/**
 * Resting radius of the ball, in viewBox units. This is the `scale` the component
 * passes to `BotEngine`.
 *
 * Chosen, not measured: it's the working unit. Everything else in this directory is
 * expressed as a fraction of this radius, which makes measurements taken off the video
 * independent of the display size.
 */
export const RADIUS = 100

/**
 * Half-side of the displayed viewBox. The margin beyond the radius makes room for the rings.
 *
 * This isn't a free value: the orbit's rings and the comet's swoosh climb to
 * 1.4 times the radius, i.e. 140. Nothing bounds them at runtime — it's the hand-tuning
 * of the `RINGS` and `SWOOSH` tables (`decor.ts`) that keeps them under 158, and a test
 * locks it in.
 */
export const HALF_VIEWBOX = 158
