/**
 * Curated seeds spanning every bolota silhouette family.
 *
 * Used whenever no custom seed is set (see seed-store.ts's "curated variety"
 * mode) so the default state of the states/sequences grids shows real shape
 * variety instead of ten near-identical renders of one silhouette.
 *
 * Derived at dev time, not guessed: sampled `layout(traits(seed)).shape` for
 * seed candidates under the "luz" word family (Portuguese for "light", the
 * root of the Luzir name) until all 10 silhouettes in src/blob.ts's `Shape`
 * union turned up, then picked one on-theme word per shape from the runs
 * that hit it. Reproduce with:
 *
 *   import { traits } from "../../../src/traits";
 *   import { layout } from "../../../src/blob";
 *   for (const seed of candidates) console.log(layout(traits(seed)).shape, seed);
 *
 * If bolota's band tables in src/styles/blob.ts ever change what a seed
 * hashes to, the golden fixture test breaks first, re-run the sample above
 * and update this list by hand; it is intentionally static, not computed at
 * runtime, so the showcase never pays a hashing pass just to pick tile seeds.
 */
export interface CuratedSeed {
  seed: string;
  shape: string;
}

export const CURATED_SEEDS: CuratedSeed[] = [
  { seed: "glow", shape: "round" },
  { seed: "aurora", shape: "organic" },
  { seed: "flare", shape: "boxy" },
  { seed: "star", shape: "capsule" },
  { seed: "prism", shape: "nub" },
  { seed: "nova", shape: "cloud" },
  { seed: "solar", shape: "droplet" },
  { seed: "lunar", shape: "hexagon" },
  { seed: "shine", shape: "sun" },
  { seed: "cinder", shape: "triangle" },
];

/** The brand's own identity, used for single-avatar demos (hero, expression
 * stage, timeline) when no visitor seed is set. */
export const DEFAULT_SEED = "@luzir/bolota";

/** Cycles through the curated list, for grids with more tiles than seeds. */
export function curatedSeedAt(i: number): string {
  return CURATED_SEEDS[i % CURATED_SEEDS.length]!.seed;
}

const ADJ = [
  "luminous", "gentle", "electric", "quiet", "radiant", "amber", "violet",
  "hidden", "wandering", "golden", "distant", "restless", "soft", "bright",
];
const NOUN = [
  "comet", "lantern", "spark", "aurora", "ember", "glow", "photon", "dawn",
  "nebula", "halo", "prism", "tide", "orbit", "flare",
];

/** A fresh, fun, on-theme random seed for the "randomize" affordance. */
export function randomSeed(): string {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  const suffix = Math.floor(Math.random() * 90 + 10);
  return `${a}-${n}-${suffix}`;
}
