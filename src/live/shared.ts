// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

/**
 * The helpers the lazy `decor.js` chunk takes from `engine.js` instead of
 * bundling again. `engine.ts` re-exports them under underscore names, and
 * `scripts/decor-shared.ts` swaps this module, in the decor build only, for
 * imports of those names from `engine.js`. Private: not public API, not semver.
 */

export { contrast, ensureContrast, fromHex, mixHex, toHex } from "../color";
export { r3 } from "../morph";
export { CHOREO, clamp } from "./choreo";
export { edge } from "./outline";
export { putter } from "./put";
