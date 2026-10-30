// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from blobatar (c) 2026 Alain, MIT. See LICENSE.

/**
 * The pose composition: how a `Pose` becomes geometry, in the two forms a
 * renderer can use it.
 *
 * Split out of `expression.ts` so the machinery, which the static bake and the
 * live engine both need and which is all function declarations, is importable
 * without the roster, which is data and belongs only to a consumer who names
 * one of its poses. `expression.ts` imports from this file; nothing imports the
 * other way.
 *
 * `bakePose` and `poseTransforms` stay in one file because they are two
 * renderings of one composition and have to agree exactly.
 * `test/morph.test.ts` asserts they do at every pose.
 */

/**
 * The channels a pose may touch, and nothing else.
 *
 * Petals are excluded on purpose: a sun's nine petals are silhouette, and moving
 * them independently reads as wind or as the creature coming apart. Path data is
 * excluded because interpolating it puts geometry on the main thread every frame.
 *
 * **The body deforms for nothing, so it no longer deforms.** `bsx`, `bsy` and
 * `skew` used to scale and lean the whole creature and have been removed. Three
 * things settled it. They rank fourth of five for legibility in the first place;
 * they are the only channels with no headroom, since frame containment binds at
 * roughly `bsx: 1.08` and a 3° lean puts a body outside the viewBox — so they
 * break the frame before they get loud enough to read; and in this variant the
 * silhouette *is* the identity. Six shapes, a seeded lopsidedness and a seeded
 * lean are what make a grid read as a crowd, and squashing that per-expression
 * is the one move that makes a bolota stop looking like itself.
 *
 * `bdy` survives because it is a rigid translate. It moves the creature without
 * distorting it, which is what `happy`'s lift and `sad`'s sink actually needed.
 *
 * Units: scales are factors, `tilt` is degrees, offsets are viewBox units, and
 * `heat` and `shake` are 0–1 amounts. `tilt` and `edx` are mirrored per side.
 *
 * The `*2` channels are the **second eye's differential**, not its value: they
 * add to the shared channel on the right eye only, so an identity of 0 is a
 * symmetric face and every existing pose keeps emitting exactly what it did.
 * Expressed as deltas rather than as a second endpoint for precisely that
 * reason — a pair of endpoints would force every symmetric pose to state both.
 */
export interface Pose {
  /** Eye width, about each eye's own center. */
  esx: number;
  /** Eye height, about each eye's own center. */
  esy: number;
  /**
   * Eye tilt, mirrored per side: the left eye rotates by `-tilt`, the right by
   * `+tilt`.
   *
   * **What that reads as depends on the eye's orientation, and the sign flips
   * when it changes.** On a *portrait* capsule — the natural shape here, median
   * aspect 2.55:1 — a positive tilt leans both tops outward and brings the inner
   * edges down, which is the angry direction. Flatten the capsule past square
   * with `esy` and the same rotation raises the inner ends instead: on a
   * *landscape* bar, **negative** tilt is the angry `\ /` and positive is the
   * sad `/ \`.
   *
   * This is not a quirk of the implementation, it is what rotating a bar does,
   * and it is invisible to every test in the suite — clearance, containment and
   * the composition gate are all sign-blind. It cost a full roster of poses
   * wearing each other's brows to notice. **Look at the render.**
   */
  tilt: number;
  /** Eye pair offset, positive = down. */
  edy: number;
  /** Eye convergence, positive = apart. */
  edx: number;
  /** Extra width on the right eye only. */
  esx2: number;
  /** Extra height on the right eye only. */
  esy2: number;
  /** Extra tilt on the right eye only, before the per-side mirroring. */
  tilt2: number;
  /**
   * How much of the **seeded** eye lean the pose overrides, 0–1. At 0 the pose's
   * `tilt` adds to whatever lean the seed drew; at 1 the seeded lean is cancelled
   * and the eyes sit at exactly the angle the pose names.
   *
   * It exists because `tilt` is a *brow*, and a brow is an absolute direction.
   * `styles/blob.ts` leans each eye by up to 12° in a single seeded direction —
   * identity, and good identity, on an idle face. Added to a pose it is not
   * identity, it is noise on the one channel that carries the meaning: `mad`'s
   * `\ /` at −33° meets a +12° seed and comes out `\ \`, a pair of parallel bars
   * that read as bored rather than angry, while the seed 12° the other way gets
   * an unusually furious `mad`. The reference renders are unambiguous about which
   * of those is wanted.
   *
   * So the loud poses take their tilt absolute and the seeded lean returns intact
   * the moment the expression clears — the identity is in the idle face, not in a
   * per-seed discount on the expression. This is the same rule `esx`/`esy` already
   * follow by being factors on a shape the pose flattens nearly out of existence:
   * every bolota wears the same strength of a given expression.
   *
   * Interpolates like every other channel, so the lean eases out over the morph
   * rather than snapping.
   */
  lock: number;
  /** How far the palette shifts toward its hot pair, 0–1. */
  heat: number;
  /** Tremor amplitude, 0–1. Held, not fired — see `@keyframes mo-shake`. */
  shake: number;
  /** Whole-creature offset, positive = down. */
  bdy: number;
}

/**
 * The identity pose, and the key list — every channel's custom property is its
 * own name prefixed, so no lookup table is needed. Iterating this is what lets
 * `poseVars` skip channels a pose leaves alone, which is why `idle` emits
 * nothing at all.
 */
export const IDENT: Pose = {
  esx: 1,
  esy: 1,
  tilt: 0,
  edy: 0,
  edx: 0,
  esx2: 0,
  esy2: 0,
  tilt2: 0,
  lock: 0,
  heat: 0,
  shake: 0,
  bdy: 0,
};

/** What `bakePose` needs of a layout. Structural, so this module imports no variant. */
export interface Posable {
  eyes: { cx: number; cy: number; rx: number; ry: number; rot: number }[];
}

export const r3 = (v: number) => String(Math.round(v * 1000) / 1000);

/**
 * The static path: eye channels baked into geometry, body channels handed back
 * as one `transform` attribute for the caller to wrap.
 *
 * Baking is exact rather than approximate, because the CSS composes in the same
 * order the geometry does. `superellipse` scales by `rx`/`ry` and *then* rotates,
 * and `.mo-eye` applies the pose scale innermost (in `@keyframes mo-blink`) and
 * the tilt outside it (in `mo-wrap`'s `rotate`). The offsets commute with both,
 * since the rotation and scale are about each eye's own center —
 * `transform-box: fill-box` on the animated side, the eye's own `cx`/`cy` here.
 *
 * The body half of that attribute used to be a three-transform chain derived
 * from the CSS — a scale about (50, 50), an offset, and a lean — and needed a
 * `translate(50 50) … translate(-50 -50)` sandwich to put the origin in the
 * right place. With the deforming channels gone it is one rigid translate, which
 * commutes with everything and needs no origin at all. The whole apparatus that
 * kept it honest, including the divergence the composition gate measured, was in
 * service of the two channels that are no longer here.
 *
 * The eye channels stay out of that attribute: baking them costs nothing, where
 * a per-eye transform would need its own origin round-trip and ~85 B per eye.
 */
export function bakePose<L extends Posable>(
  l: L,
  p: Pose,
): { l: L; wrap: string } {
  return {
    l: {
      ...l,
      eyes: l.eyes.map((e, i) => ({
        ...e,
        // `--mo-wrap`'s sign, spelled out: -1 on the left eye, +1 on the right,
        // so a positive tilt leans both tops outward and brings the inner edges
        // down. That asymmetry is the entire brow vocabulary available here.
        cx: e.cx + p.edx * (i ? 1 : -1),
        cy: e.cy + p.edy,
        // The `*2` differential lands on the right eye only, which is
        // `--mo-sel`'s job on the animated side. It is added *before* the
        // mirroring on `tilt`, matching `calc(var(--mo-t) * var(--mo-wrap))` —
        // adding it after would flip its sign on the left eye and turn a
        // one-sided brow into a symmetric one.
        rx: e.rx * (p.esx + (i ? p.esx2 : 0)),
        ry: e.ry * (p.esy + (i ? p.esy2 : 0)),
        // `lock` fades the seeded lean out rather than switching it off, which
        // is what lets it interpolate on the animated side. At 0 this is the
        // plain sum it always was.
        //
        // The animated path cannot bake it away — the lean is already in the
        // path's coordinates — so it subtracts the same amount on `.mo-eye`'s
        // `rotate` instead. Both resolve to R(tilt·wrap) · scale about the eye's
        // own centre; `probe-compose.ts` check A measures that they agree.
        rot: e.rot * (1 - p.lock) + (p.tilt + (i ? p.tilt2 : 0)) * (i ? 1 : -1),
      })),
    },
    wrap: p.bdy !== 0 ? `translate(0 ${r3(p.bdy)})` : "",
  };
}

/**
 * The morphing path: the same composition as `bakePose`, as one SVG transform
 * per eye instead of as geometry, so a frame of a JS-driven morph moves the
 * already-drawn eye paths instead of regenerating them.
 *
 *   translate(posed centre) rotate(tilt·wrap + lean·(1 − lock))
 *     scale(x y) rotate(−lean) translate(−drawn centre)
 *
 * The `rotate(−lean)` … `scale` bracket is what `.mo-eye` does in CSS: the drawn
 * capsule arrives already leaned, so a bare scale would shear it. The two
 * rotations collapse to exactly the `rot` `bakePose` emits.
 *
 * `wrap` is emitted unconditionally because `bdy` passes through nonzero during
 * a morph even when both endpoints are zero. `shake` and `heat` reach no
 * transform here, as in `bakePose`.
 */
export function poseTransforms<L extends Posable>(
  l: L,
  p: Pose,
): { eyes: string[]; wrap: string } {
  return {
    eyes: l.eyes.map((e, i) => {
      const wrap = i ? 1 : -1;
      const sel = i ? 1 : 0;
      const lean = e.rot;
      return (
        `translate(${r3(e.cx + p.edx * wrap)} ${r3(e.cy + p.edy)})` +
        ` rotate(${r3((p.tilt + sel * p.tilt2) * wrap + lean * (1 - p.lock))})` +
        ` scale(${r3(p.esx + sel * p.esx2)} ${r3(p.esy + sel * p.esy2)})` +
        ` rotate(${r3(-lean)})` +
        ` translate(${r3(-e.cx)} ${r3(-e.cy)})`
      );
    }),
    wrap: `translate(0 ${r3(p.bdy)})`,
  };
}

/**
 * A pose part-way between two others, which is the whole of what a morph is.
 *
 * **`undefined` is `idle`** on either end, so clearing an expression is a morph
 * toward the identity rather than a special case.
 *
 * Written `from·(1 − t) + to·t` so `t = 1` returns the target's numbers exactly:
 * a settled morph must be the static pose, not merely resemble it.
 */
export function lerpPose(a: Pose | undefined, b: Pose | undefined, t: number): Pose {
  const from = a ?? IDENT;
  const to = b ?? IDENT;
  const out = {} as Pose;
  for (const k in IDENT) {
    const c = k as keyof Pose;
    out[c] = from[c] * (1 - t) + to[c] * t;
  }
  return out;
}
