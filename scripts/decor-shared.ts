// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import type { BunPlugin } from "bun";

/**
 * The decor chunk is only ever loaded by `engine.js`, so what both hold is
 * imported back from it instead of being bundled a second time. `src/live/shared.ts`
 * lists those helpers; in the decor build it is swapped for a re-export of the
 * matching underscore names from `engine.js` (see the end of `src/engine.ts`).
 * `./engine.js` is external and resolves to the file `scripts/build.ts` emits
 * next to the chunk.
 */
const SHARED = ["CHOREO", "r3"];

export const decorSharesEngine: BunPlugin = {
  name: "decor-shares-engine",
  setup(b) {
    b.onResolve({ filter: /^\.\/engine\.js$/ }, () => ({ path: "./engine.js", external: true }));
    b.onLoad({ filter: /\/src\/live\/shared\.ts$/ }, () => ({
      contents: `export { ${SHARED.map((n) => `_${n} as ${n}`).join(", ")} } from "./engine.js";`,
      loader: "js",
    }));
  },
};
