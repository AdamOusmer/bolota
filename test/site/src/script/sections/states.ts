// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { onSeedChange, getSeed } from "../lib/seed-store";
import { curatedSeedAt } from "../lib/curated-seeds";
import { ensureEngine, mountLiveTile } from "../lib/live-engine";
import { observeReveals } from "../lib/motion";

/** Every state the engine can play, one live looping specimen each.
 *
 * The tile shells (avatar slot + label) are real markup now, rendered at
 * build time by `components/ui/StateTile.astro`, one per id off the same
 * `engineStates()` roster this file calls at runtime — see States.astro's
 * own header for why (owner's fix for an inconsistent row-divider bug:
 * ad hoc per-tile `innerHTML` strings replaced with one real Astro
 * component instance per tile, structurally identical for all 14). This
 * file's job shrank to exactly what needs a browser: mounting the live
 * engine into each shell's `[data-specimen-avatar]` slot. Labels are no
 * longer built here at all — `humanizeId` moved to StateTile.astro,
 * called at build time, since the label needs no engine and no client JS
 * to be correct.
 *
 * Seeded: every specimen shares the visitor's identity. Unseeded: they
 * cycle across the curated shape-family list instead, so the grid itself
 * demonstrates bolota's silhouette variety.
 *
 * `engineStates()` itself is cheap (it's just a static roster, not the
 * engine's runtime), but it lives in the same `@luzir/bolota/engine` module as
 * everything else, so it rides the same deferred `ensureEngine()` chunk as
 * `mountLiveTile`'s own engine use rather than pulling that module back
 * into the eager initial bundle on its own.
 */
export async function setupStates() {
  const grid = document.querySelector<HTMLElement>("[data-states-grid]");
  if (!grid) return;

  const { engineStates } = await ensureEngine();
  const states = engineStates();
  const cells = [...grid.querySelectorAll<HTMLElement>("[data-state-tile]")];

  if (cells.length !== states.length) {
    // Shouldn't happen — States.astro's engineStates() (build time) and
    // this one (runtime) are the same function in the same installed
    // package, so the roster can't disagree between them. Guard anyway
    // rather than silently mounting engines into the wrong tiles (or
    // running off the end of `cells`) if that assumption ever breaks.
    console.error(
      `states.ts: ${cells.length} rendered tile(s) but engineStates() returned ${states.length} id(s) — mismatched roster, skipping mount.`,
    );
    return;
  }

  const tiles = states.map((id, i) => {
    const host = cells[i]!.querySelector<HTMLElement>("[data-specimen-avatar]")!;
    const seed = getSeed() ?? curatedSeedAt(i);
    return mountLiveTile(host, seed, { loopState: id });
  });
  // Same rationale as expressions.ts: the grid container is already
  // `[data-reveal]`-tracked, this is a cheap no-op re-observe, not a
  // required fix for the current markup, just defense-in-depth.
  observeReveals(grid);

  onSeedChange((seed) => {
    tiles.forEach((tile, i) => tile.setSeed(seed ?? curatedSeedAt(i)));
  });
}
