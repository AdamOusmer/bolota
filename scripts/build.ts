// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

/**
 * The publish build.
 *
 * package.json's `exports` map points at `dist`, and `files` ships `dist` +
 * `README.md` + `LICENSE` only — no `src`. A consumer installing the package
 * (npm/bun registry, a git dependency, `bun pm pack`'s own tarball) gets
 * compiled JS + `.d.ts` for every subpath below, nothing else. `prepack` and
 * `prepare` both call this script, so a git-dependency install (`prepare`,
 * no publish step) and a registry publish (`prepack`) build the same output.
 *
 * Each entry is bundled standalone. Code splitting is the obvious way to stop
 * `blob` and the barrel carrying private copies of the same renderer, and it
 * is unusable here: on Bun 1.3.14 a pure re-export barrel like `src/index.ts`
 * compiles to `import "./chunk.js"; export { palette, ... }` — names re-exported
 * out of a module that never imported them, which is a SyntaxError the moment
 * Node links it. `VERSION` in `src/index.ts` is the workaround; see its comment.
 *
 * The cost of standalone entries is paid only by a consumer importing two of
 * them, who gets the shared core twice. That is the rarer case, and a wrong
 * package is not a tradeoff.
 */

import { rmSync } from "node:fs";
import { $ } from "bun";

// One per package.json `exports` subpath that resolves to `dist` (i.e. every
// subpath except `./motion.css`, built separately below as CSS, and
// `./package.json`, which is the manifest itself, not a source file).
const ENTRIES = [
  "src/index.ts",
  "src/blob.ts",
  "src/uri.ts",
  "src/expression.ts",
  "src/engine.ts",
  "src/sequences.ts",
];

rmSync("dist", { recursive: true, force: true });

const build = await Bun.build({
  entrypoints: ENTRIES,
  outdir: "dist",
  target: "browser",
  format: "esm",
  minify: true,
  sourcemap: "linked",
});

if (!build.success) {
  for (const log of build.logs) console.error(log);
  process.exit(1);
}

// The stylesheet ships minified. `src/motion.css` is ~44 KB, nearly all of it
// the commentary explaining why each channel exists — worth reading in the
// repo, not worth shipping to a consumer who drops it in a <link> and gets no
// bundler pass over it.
const css = await Bun.build({
  entrypoints: ["src/motion.css"],
  outdir: "dist",
  minify: true,
});

if (!css.success) {
  for (const log of css.logs) console.error(log);
  process.exit(1);
}

// Types come from tsc, not from the bundler — Bun does not emit declarations.
// Covers every file under `src`, so every `exports` subpath gets a matching
// `dist/*.d.ts` even though only six of them are bundled as JS above.
await $`bunx tsc -p tsconfig.build.json`;

// Sourcemaps keep their `sourcesContent` inlined, unlike an earlier version of
// this script: `files` in package.json ships `dist` only, no `src`, so a map
// whose `sources` pointed at `../src/*.ts` with the content stripped would
// dangle in a consumer's install — nothing at that path to resolve against.
// Self-contained maps cost more per package (the six JS entries duplicate
// their own source), but that is the only way `dist` can be both source-free
// and debuggable at once.

for (const out of build.outputs) {
  if (out.kind !== "entry-point") continue;
  console.log(`✓ ${out.path.replace(process.cwd() + "/", "")}`);
}
