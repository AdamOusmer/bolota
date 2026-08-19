/**
 * Regenerates public/favicon.svg from the real library — the same fixed
 * brand seed the nav mark uses (lib/curated-seeds.ts's DEFAULT_SEED,
 * "bolota"), via the actual packed `@luzir/bolota` dependency (not a
 * hand-drawn approximation), so the tab icon can never drift from what the
 * library itself renders.
 *
 * Not wired into `dev`/`build`: this seed's markup is contractually stable
 * within a major version (bolota.ts's own doc comment — "the same name
 * always produces the same output"), and public/ already holds other
 * assets (fonts) that are committed, not regenerated per build. Re-run
 * this by hand (`bun scripts/gen-favicon.ts`, after `bun run lib:pack` so
 * the packed dependency is current) if a library update ever changes
 * "bolota"'s own silhouette or palette.
 *
 * viewBox: `bolota()`'s default 100x100 stage leaves this seed's own shape
 * (a horizontal two-circle-plus-bar capsule body, this seed's traits pick)
 * with ~11%/26% (x/y) empty margin — fine at full size, illegible at a
 * 16px tab icon. Tightened to this shape's own bounding box (computed
 * once from the real render below: circles r24 at x 34.91/64.23 cy 49.43,
 * connecting rect y 25.44-73.43) plus a small pad, pinned as a constant
 * rather than solved generically from path geometry on every run — same
 * reasoning Layout.astro's old FAVICON_BG/FAVICON_ACCENT constants used to
 * document (one place to hand-update if it ever needs re-tuning). Height
 * stays the constraining margin: this seed's own body is a wide, short
 * pill, and squaring a wide shape without distortion always leaves some
 * vertical breathing room — the fix here is filling the width edge to
 * edge, not eliminating an aspect ratio the shape itself has.
 */
import { bolota } from "@luzir/bolota";
import { writeFileSync } from "node:fs";

const BRAND_SEED = "bolota"; // lib/curated-seeds.ts's DEFAULT_SEED

const TIGHT_VIEWBOX = "6.91 6.77 85.32 85.32";

const raw = bolota(BRAND_SEED, { background: false });
const tight = raw.replace('viewBox="0 0 100 100"', `viewBox="${TIGHT_VIEWBOX}"`);

if (tight === raw) {
  throw new Error(
    'gen-favicon: viewBox="0 0 100 100" not found in bolota()\'s output — ' +
      "the library's stage viewBox or this seed's shape changed; re-check " +
      "the crop above before re-running.",
  );
}

writeFileSync(new URL("../public/favicon.svg", import.meta.url), tight + "\n");
console.log("wrote public/favicon.svg");
