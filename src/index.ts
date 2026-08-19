// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from blobatar (c) 2026 Alain, MIT. See LICENSE.

export {
  bolota,
  _layout,
  type Animate,
  type BolotaOptions,
  type Expression,
} from "./bolota";

/**
 * The `<svg>` contents and its motion custom properties, separately.
 *
 * The seam a framework adapter builds on: a React/Vue/Svelte/vanilla wrapper
 * owns the outer element and wires `cls`, `bg`, and `vars` onto real
 * attributes, sending only `inner` through an innerHTML-style sink. Returns
 * `{ cls, bg, inner, vars }`.
 *
 * Load-bearing invariant, pinned by `test/expression.test.ts`: nothing that
 * varies with `expression` appears in `inner` — an expression is style, not
 * markup, so changing it changes zero bytes of `inner` and a morph can run.
 */
export { parts } from "./bolota";
export {
  palette,
  ramp,
  contrast,
  FLOORS,
  type Palette,
  type Oklch,
  type ColorKey,
} from "./color";
export { traits, type Traits, type TraitOverrides } from "./traits";
export { normalizeSeed } from "./hash";

/**
 * The version this build came from. Asserted against package.json in
 * `test/bolota.test.ts`, so it cannot drift.
 *
 * It is also load-bearing, which is the part worth knowing before deleting it.
 * On Bun 1.3.14, bundling an entry whose body is *nothing but* named re-exports
 * against a package declaring `sideEffects` produces a module that re-exports
 * names it never imported — `export { a as palette }` with no `a` anywhere —
 * and Node throws `SyntaxError: Export 'a' is not defined in module` the moment
 * it links the file. One real binding in the module body is enough to stop the
 * whole graph being dropped. `scripts/smoke.mjs` links the built barrel under
 * Node on every build and is what will tell you if this stops being true.
 */
export const VERSION = "0.1.0";
