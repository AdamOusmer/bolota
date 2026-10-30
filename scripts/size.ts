// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

/**
 * Bundle size gate.
 *
 * Measured through synthetic consumers rather than by building the barrel
 * directly — a library entry with no importer tree-shakes to nothing, which
 * reports a flattering number that no real app ever sees.
 *
 * Budgets are per entry point. The core budget is the one that matters: it is
 * what stops a convenience import from quietly pulling in an optional feature,
 * or a palette tweak from doubling the color code.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { BunPlugin } from "bun";
import { decorSharesEngine } from "./decor-shared";

const DIR = "scripts/.fixtures";

const ENTRIES: {
  name: string;
  budget: number;
  external: string[];
  source: string;
  /** Entry file extension. Defaults to a TSX consumer. */
  ext?: string;
  plugins?: BunPlugin[];
}[] = [
  {
    // Expressions are passed in as values from `bolota/expression`, so a
    // consumer who never imports one carries no pose code at all — see the
    // "blob + happy" entry below for what one costs. Held tight deliberately:
    // this is the number that catches the option creeping back into the core.
    //
    // Raised again by 30 B — 19 of them spent — when each animated eye started
    // emitting its own `transform-origin`. That is not a feature, it is the
    // price of a Gecko bug: a `<g>`'s `fill-box` follows its children, so a
    // blink moved the eye wrapper's origin and a posed eye travelled ~30 viewBox
    // units every time it blinked. Pinning the origin in the markup is the only
    // place the fix can live, since the value is per eye. Every entry below
    // carries the same 19 B for the same reason. See `.mo-eye` in `motion.css`.
    //
    // Raised from 3700 by 33 B when expressions gained a colour channel. That is
    // the whole of what the core pays for it: one call through `tint` on the
    // expression value, on the static path, next to the `bake` call that was
    // already there. Everything that computes a colour — `hot`, `mixHex`,
    // `fromHex` — is reached only from an expression that tints, and this row
    // proves it is shaken out, because a consumer who imports none still lands
    // here rather than 200 B higher.
    //
    // Raised from 3780 by 20 B for trait overrides, and the number is the whole
    // argument for that design: making *every* axis of the bolota configurable
    // cost one lookup and an inline clamp on the trait reader, because the
    // layout already addressed its values by key. A prop per knob would have
    // put ~25 named options and their plumbing in this row instead. Measured at
    // 1 B over before the budget bump — the branch gzips against the reader
    // that was already there.
    // Lowered from 3800 when the `character` variant was removed in 0.1.0. The
    // variant itself was never in this row — what came out was the plumbing that
    // existed only to keep two of them apart: the palette's variant-keyed ramp
    // and floor tables, the `expressive` flag, and the `variant` argument
    // threaded through `resolve`.
    // Bolota 2 binds its ten-shape style directly. The private composer keeps
    // silhouette implementations local without retaining a runtime generation
    // branch or any historical mapping in this graph (ADR-0008).
    // Measured against published v0.2.0's six-shape renderer: 3657 → 4247 B
    // gzip, +590 B (+16.1%). The abandoned runtime-generation version measured
    // 4286 B, so making the package major the seam recovers 39 B as well as the
    // public API complexity.
    // Raised from 4300 by 110 B when the capsule and droplet stopped being
    // approximated. Both drew a union whose parts crossed rather than met — a
    // rounded box behind two cap circles, a soft diamond stabbed into a ball —
    // and both showed the crease. `box` and `taper` in `shape.ts` are what the
    // exactness costs: a stadium needs a run at full height for its caps to meet
    // along their diameters, and a taper has to be the tangents from its apex to
    // the body ellipse. Measured against the arc-drawn single-outline version of
    // the same two shapes, which is a further 108 B for an identical render.
    //
    // Raised from 4410 by ~90 B when the eyes switched from `superellipse` to
    // `capsulePath` (bloub's own eye shape, ported into `shape.ts`). Four
    // cubic-Bézier corners plus straight runs cost more per eye than
    // `superellipse`'s four-segment quadrant approximation; unavoidable once
    // every silhouette draws the same eye outline (see `color.ts`/`RAMP` and
    // `styles/compose.ts`'s `eye` for the rest of that change).
    name: "blob only",
    budget: 4550,
    external: [] as string[],
    source: `import { bolota } from "../../src/blob";
             globalThis.x = bolota(String(globalThis.seed));`,
  },
  {
    // The barrel. Costs more than `blob only` above because it also carries the
    // colour and trait utilities, which a consumer who only renders never touches.
    // Raised from 4400 alongside "blob only" above — same capsule-eye cost.
    name: "barrel",
    budget: 4540,
    external: [],
    source: `import { bolota } from "../../src/index";
             globalThis.x = bolota(String(globalThis.seed));`,
  },
  {
    // Raised from 4490 alongside "blob only" above — same capsule-eye cost.
    name: "uri",
    budget: 4630,
    external: [],
    source: `import { bolotaUri } from "../../src/uri";
             globalThis.x = bolotaUri(String(globalThis.seed));`,
  },
  {
    // The point of `bolota/expression` being its own entry: importing one
    // expression must not drag the other three in. Measured against "blob only"
    // above — the delta is what a single pose actually costs.
    // Measured: +343 B for the first expression (the shared serializer and bake,
    // paid once) and +36 B for each one after it. Importing all three is 4098.
    // Raised from 4740 alongside "blob only" above — same capsule-eye cost.
    name: "blob + happy",
    budget: 4870,
    external: [],
    source: `import { bolota } from "../../src/blob";
             import { happy } from "../../src/expression";
             globalThis.x = bolota(String(globalThis.seed), { expression: happy });`,
  },
  {
    // What one pose of the fourth roster costs on top of another already
    // imported: its data and nothing else. This row measured 4751 B against
    // `blob + happy`'s 4705, so +46 B. Measured the same way as plain `.ts`
    // consumers (base 4705): `attentive` +46, `excited` +46, `laughing` +50,
    // `curious` +52, `proud` +45. Budget is `blob + happy`'s plus the 80 B a
    // pose is allowed. `curious` is the row because it is the heaviest.
    name: "blob + happy + curious",
    budget: 4950,
    external: [],
    source: `import { bolota } from "../../src/blob";
             import { curious, happy } from "../../src/expression";
             globalThis.x = bolota(String(globalThis.seed), { expression: globalThis.s ? happy : curious });`,
  },
  {
    name: "traits only",
    budget: 600,
    external: [],
    source: `import { traits } from "../../src/traits";
             globalThis.x = traits(String(globalThis.seed))("hue");`,
  },
  {
    // Bundled rather than gzipped straight off disk, so a syntax error here
    // fails the gate instead of shipping. Paid once per app, not per bolota,
    // which is the whole reason the keyframes are not inlined into each SVG.
    name: "motion css",
    // Raised again from 950 for the expression layer: nine `@property`
    // registrations, the pose terms folded into the existing keyframes, and the
    // reduced-motion block restating the pose statically (an expression must
    // survive reduced motion — only the morph is removed). The registrations
    // look like the expensive part and are not; nine near-identical blocks
    // gzip to almost nothing, which is the same effect the wrap chains rely on.
    //
    // Previously raised from 800 for the wrap layer (§4.7), which no smaller form fits:
    // foreshortening alone measured 854, and the two obvious factorings both
    // came out *larger* than writing the chains out (see `@keyframes mo-wrap`).
    // Worth it here and nowhere else — this file is paid once per app, so 180
    // bytes buys the same 3D read that per-bolota markup could not afford.
    // Raised from 1200 for two corrections rather than features: the shared
    // `transform-box`/`transform-origin` rule that puts the body layers'
    // pivot back at the middle of the frame instead of SVG's default corner,
    // and the lean brackets around every eye scale, which stop a leaned capsule
    // squashing along screen axes. Both are what `scripts/probe-compose.ts`
    // measures; neither is optional.
    //
    // Raised from 1250 for the exaggeration pass, which is a net add of ~130 B
    // after the body-scale and lean channels came out. Three things bought it,
    // and all three are things markup would otherwise have to carry per bolota:
    //
    //  - Per-eye asymmetry. Three registrations and four derived values on
    //    `.mo-eye`, replacing the only other option — per-eye inline styles,
    //    which are forbidden because nothing in `parts.inner` may vary with the
    //    expression.
    //  - The tremor: one registration and a four-stop keyframe.
    //  - The two `fill` rules, which is how a hot pose reaches a colour that
    //    lives in a presentation attribute CSS cannot read.
    //
    // The transition lists got *shorter* despite three more channels, because
    // the duration and easing lists are now stated once in `--mo-md`/`--mo-me`
    // instead of being restated in full by the `:hover` rule.
    // Raised from 1400 for one rule, and it is the cheapest 7 bytes in the
    // file: pausing the idle loops on touch devices, where the hover rule two
    // lines above it has already pinned `--mo-amp` at zero and the loops can
    // therefore only resolve to the identity pose. Measured on a page with
    // sixty bolotas, it took style and layout in a Lighthouse trace from
    // 6.7s to 1.9s — the loops are ~8 per bolota and most of them drive
    // registered custom properties, which recalculate on the main thread
    // rather than compositing. A grid that reads as a crowd is the case this
    // library invites, so that is the case worth being cheap in.
    //
    // Raised from 1450 to 1500 for the live engine's entrance blink, measured
    // at 1486 (+58 B over 1428). The engine computes no lids, so the one blink
    // a state change fires has to live here: a 200 ms keyframe on the live
    // eye's rect, stated twice so each flip of `data-mo-blink` restarts it in
    // the same frame (one name measured 1466 but needs a frame's delay to
    // restart), plus the rect in the reduced-motion reset. The pose-channel
    // additions that came first (edy2, epx) cost 21 B and fit the old budget.
    // Raised from 1500 to 1560 for `[data-mo-asleep] *`, measured 1505 (+7 B):
    // the engine pauses every CSS loop of an off-screen or hidden instance.
    // Measured in headless Chromium, 23 resting bolotas off screen cost the main
    // thread a style recalc and layout per frame each without it.
    // Raised from 1560 to 1620 for naming the idle elements the engine's
    // `data-mo-js` stands down instead of matching `.mo-root *`, which made
    // every decor path a style-recalc target (UpdateLayoutTree 71 -> 46 ms/s in
    // orbit at 23). Measured 1567 B; budget is that plus ~3%.
    // Raised from 1620 to 1770 for the live engine's own rest loops: bloub's
    // breath and its blink schedule as `mo-live-breathe`/`mo-live-blink`, and
    // the `data-mo-live` rule that stands the saccade and bob down under the
    // engine, which is what lets a resting engine leave the frame loop while
    // keeping bloub's idle life. The dead `.mo-eye rect` lean rule came out.
    // Measured 1713 B; budget is that plus ~3%.
    budget: 1770,
    external: [],
    ext: "css",
    source: `@import "../../src/motion.css";`,
  },
  {
    // The native live engine (`src/live/`): timeline and choreography for 14
    // states, the exact outline and eye-containment solve, the decor layer,
    // the gaze pursuit and the in-place renderer behind `mountEngine`.
    // Heavier by design: an opt-in animation engine, not part of the
    // static-render path `blob only`/`barrel` above measure, but still gated so
    // it cannot grow silently.
    // Replaced the bloub-port row (budget 18800, last measured 18220 on CI's
    // linux runner) when `mountEngine` became a facade over `mountLive`
    // (0.2.0). Measured 20138 B on macOS/arm64 against the engine at the start
    // of that change, 20179 with the follow-up timeline/decor fixes, so +1.9 KB
    // over the old engine: the exact outline, the per-state fit solve and the
    // roster of 18 poses are what the old DOM renderer did not carry. Budget is
    // 20179 plus ~5%, which also absorbs the ~100 B by which `Bun.gzipSync` on
    // CI's linux/x64 runners lands above macOS/arm64 for identical input bytes.
    //
    // Decor became a lazy chunk (`import("./decor.js")` in `live/mount.ts`), so
    // this row is the first-load cost: 19693 B with decor inline, 16494 B with
    // it split out, under the old engine's 16770. The dynamic import is
    // external here, as it is in `dist`.
    // Raised to 16747 (+253 B) for the automatic pool: the per-window registry
    // under a global symbol (shared rAF across copies, version guard) and the
    // shared IntersectionObserver + visibilitychange watcher that park an
    // off-screen or hidden instance. Paid back inside the budget of the old
    // engine by dropping `Timeline.loop` (unused here), the decor warm-up and
    // palette plumbing and the duplicated unknown-state throw. Budget is 16747
    // plus ~5%.
    //
    // Re-measured as a consumer ships it: `mountEngine` plus the two private
    // underscore exports (`_CHOREO`, `_r3`) that `decor.js` imports, which a
    // bundler therefore cannot drop. 16766 B (16765 for `mountEngine` alone).
    // Both are helpers the engine already holds for itself, so sharing them
    // costs it +1 B and takes them out of the decor chunk. Adding `putter`
    // measured 16770, `edge` and the colour helpers more (16999 with all ten),
    // so those stay in the decor chunk. The budget is held under the old
    // engine's 16770 on purpose: first-load size is the priority, so there is
    // no 5% room here. Engine plus decor: 24132 -> 23176 B.
    //
    // Raised from 16769 to 19490 for the 0.2.0 engine with the JS/CSS hybrid
    // idle (`live/idle.ts`, `motionSeeds`), the compositor hand-off and hover
    // amplitude. Measured 18919 B (+2150 over the 16766 B before those
    // commits); budget is that plus ~3%. Size accepted over 0.1.7's 16770 B in
    // exchange for ~0.7 ms/s idle and animation near the old engine's cost.
    //
    // Raised from 19490 to 21690 for the allocation-free frame: reused act,
    // eye and box records with `out` parameters through the timeline, choreo,
    // rig and gaze, the number-first rig writer and draw memo in `mount.ts`,
    // the outline's shortest radius for `fit.ts`, and `putter`'s slots. Measured
    // 21052 B (+1562 over the previous budget); budget is that plus ~3%. Size
    // accepted for the script time of a frame, which falls several-fold.
    name: "engine",
    budget: 21690,
    external: ["*/decor.js"],
    source: `import { mountEngine, _CHOREO, _r3 } from "../../src/engine";
             globalThis.x = [mountEngine, _CHOREO, _r3];`,
  },
  {
    // The chunk the engine loads on idle or on the first decor-bearing state.
    // Measured 7367 B while it carried its own copies of `r3`, the attribute
    // writer and the choreo table the engine also holds. It now imports
    // `CHOREO` and `r3` from `engine.js` (`scripts/decor-shared.ts`), which is
    // always loaded first, and measures 6410 B. The colour, outline and
    // attribute-writer helpers stay here: sharing them would grow first load.
    // Budget is that plus ~5%. Raised from 6730 to 7100 for the per-frame
    // arc table (rotation recurrence plus coordinate text table): it trades
    // bytes for no trig and no number formatting per frame, measuring 6724 B
    // on bun 1.4.2 and 6842 B on CI's bun 1.3.10.
    name: "decor (lazy chunk)",
    budget: 7100,
    external: [],
    plugins: [decorSharesEngine],
    source: `import { createDecor } from "../../src/live/decor";
             globalThis.x = createDecor;`,
  },
  {
    // `runSequence`'s only import from `./engine` is the `EngineHandle`
    // *type*, erased under `verbatimModuleSyntax` — this must stay near-free
    // and must NOT pull in the engine runtime for a consumer who only wants
    // the four friendly names.
    name: "sequences",
    budget: 260,
    external: [],
    source: `import { runSequence, SEQUENCES } from "../../src/sequences";
             globalThis.x = runSequence;
             globalThis.y = SEQUENCES;`,
  },
];

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

let failed = false;

for (const entry of ENTRIES) {
  const file = `${DIR}/${entry.name.replace(/\W+/g, "-")}.${entry.ext ?? "tsx"}`;
  writeFileSync(file, entry.source);

  const build = await Bun.build({
    entrypoints: [file],
    target: "browser",
    minify: true,
    external: entry.external,
    plugins: entry.plugins,
  });

  if (!build.success) {
    console.error(`✗ ${entry.name} failed to build`);
    for (const log of build.logs) console.error(log);
    failed = true;
    continue;
  }

  const raw = await build.outputs[0]!.arrayBuffer();
  const gz = Bun.gzipSync(new Uint8Array(raw)).byteLength;
  const ok = gz <= entry.budget;
  failed ||= !ok;

  console.log(
    `${ok ? "✓" : "✗"} ${entry.name.padEnd(13)} ${String(gz).padStart(5)} B gz` +
      ` / ${String(entry.budget).padStart(5)} B  (${Math.round((gz / entry.budget) * 100)}%)`,
  );
}

rmSync(DIR, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
