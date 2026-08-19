/**
 * The trait keys shared by Bolota 2's silhouette families.
 *
 * Now spread across `styles/compose.ts` (the body and eye ranges every
 * style shares) and `styles/shapes.ts` (the per-silhouette families like
 * `nub.a0` and `cloud.r0`), which is exactly why this stays a hand-written
 * list: the keys a style reads are a property of its band table, and no
 * single module has them all any more.
 *
 * Kept as a list rather than derived, because the point of the tests that use
 * it is to sweep the configuration surface as a *caller* sees it — a list
 * scraped from the implementation would agree with the implementation by
 * construction, including where the implementation is wrong.
 */
const BASE_KEYS = [
  "shape",
  "hue",
  "tone",
  "body.r",
  "body.ratio",
  "body.x",
  "body.y",
  "body.n",
  "body.rot",
  "body.pts",
  ...Array.from({ length: 8 }, (_, i) => `body.r${i}`),
  "gaze.x",
  "gaze.y",
  "eye.rx",
  "eye.ratio",
  "eye.scale",
  "eye.stretch",
  "eye.gap",
  "eye.n",
  "eye.lean",
  "eye.lean2",
  "eye.dy",
  "sun.n",
  "sun.dist",
  "sun.r",
  "sun.rot",
  "cloud.n",
  ...Array.from({ length: 6 }, (_, i) => `cloud.r${i}`),
  "nub.n",
  "nub.a0",
  "nub.a1",
  "nub.r0",
  "nub.r1",
];

/**
 * Every trait key Bolota 2 reads, including shape-specific families.
 */
export const BLOB_KEYS = [
  ...BASE_KEYS,
  "poly.round",
  "capsule.squat",
  "droplet.tip",
];
