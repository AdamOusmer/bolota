# Changelog

What changed, and (where it matters) what it costs to upgrade.

The thing this file exists to state clearly is churn. A face is derived from a
name, so anything that moves the seed to look mapping changes faces that are
already in production, and no other release note in a package like this one is
as important. Releases that move it say so first.

The mapping is frozen per **generation**. bolota renders gen2, and a
generation change ships as a major, never as a patch.

## 0.1.1

### Fixed

- **The tracked gaze can look down.** `handle.follow()` treated the resting
  pitch bias (10 degrees above the equator, so the bot reads as attentive
  rather than absent) as the centre of one symmetric deflection. The top of
  the viewport therefore drove the eyes to +20 degrees while the bottom
  reached -0.1: on a 100-unit body, 23px of travel above the resting eye
  height against 0.1px below it. The two extremes are mirror images now,
  +20 and -20, so a pointer at the bottom of the page moves the eyes 57px
  down from rest instead of a tenth of a pixel.

  Not a containment problem, which is where this looked like it lived: the
  eyefit solve clears 30 degrees of downward gaze with the worst seed at 0.68
  of the local body radius. bloub has the same shape of bug and narrower
  numbers still (+23 up, -3 down), which is how the port inherited it; it
  shows less there because that bot sits beside the panel it watches, rather
  than above a page whose content is below it.

## 0.1.0

First release of this fork, published as `@luzir/bolota`. The version line
restarts here: the renderer it inherits is [blobatar][blobatar]'s gen2, but
the engine, the API surface and the package are new enough that carrying
upstream's numbering would claim a stability this has not earned yet. Faces
are identical to blobatar 2's for the same seed. Upstream's own release notes
are kept below for the seed-mapping record.

### Added

- **A live animation engine**, `@luzir/bolota/engine`, ported from
  [bloub][bloub]. `mountEngine()` drives a seeded face on a real `<svg>`
  through fourteen states and seventeen held expressions, follows the pointer,
  and honours `prefers-reduced-motion`.
- **Every engine state renders on the seed's own silhouette.** This is the
  divergence from bloub that the fork exists for: upstream swaps in its own
  built-in body shapes per state, which threw away the identity the seed is
  for. Body scale is still the state's to choose, and the eyes scale with it.
- `@luzir/bolota/sequences`, friendly names for four of the engine's states.

### Changed

- **Renamed to bolota**, published under the `@luzir` scope. The library, its
  entry points and its function names all follow (`blobatar()` is `bolota()`,
  `blobatarUri()` is `bolotaUri()`).
- **Eyes are always the fixed dark capsule pair**, bloub's, instead of
  flipping polarity against the body colour. The darkest body tone no longer
  clears the old 4.5:1 eye-contrast floor, and that floor is no longer
  enforced for `eye`/`head`: it ships as authored rather than walked back.
  `test/color.test.ts` names the tones that fall short.
- Golden fixtures regenerated for the eye rework: 1343 renders.

### Removed

- **The React adapter.** `parts()` is the published seam instead: one
  framework-agnostic split, rather than a component per framework.
- **Everything that was not the library**: the HTTP avatar endpoint, its
  server, the docs site and the monorepo around them. The library lives at the
  repository root, and `src/` plus `test/` is all there is.

***

## Upstream history (blobatar)

Kept verbatim from the fork point, because the seed-mapping churn it records
is what a face's stability depends on. The package names and version numbers
in this section are upstream's, not this package's.

### blobatar 2.0.0

**Every seed renders differently.** gen2's ten silhouettes replace gen1's six,
and a new shape is not additive — it takes its share of the band table from the
existing ones. Roughly a third of names come out byte-identical anyway, because
a round body with room for its eyes is drawn by the same arithmetic under both
vocabularies; the rest move. Stay on `blobatar@1` if that is not acceptable
yet, and upgrade when it is.

### Added

- Four silhouettes: `capsule`, `triangle`, `hexagon` and `droplet`, alongside
  `round`, `organic`, `boxy`, `nub`, `cloud` and `sun`. Weighted rather than
  uniform — round and organic stay the everyday shapes and the louder ones stay
  finds.
- Trait keys for what the new shapes read: `capsule.squat`, `poly.round`
  (triangle and hexagon) and `droplet.tip`. `body.rot` is now read on the
  polygons as well as on a boxy body.

### Changed

- `Shape` is the union of the ten silhouette names, and `layout` returns it —
  narrow enough that a typo in a bulk filter is a type error.
- Core bundle 3.7 KB → 4.4 KB gzipped, measured as `blob only` in
  `scripts/size.ts`. That is what the four silhouettes and the composition seam
  cost; the React and URI entries move by the same amount.
- **The endpoint's unversioned URLs move too.** `blobatar.dev/avatar/<name>`
  follows the current major and now serves gen2. Pin `?gen=1` before upgrading
  on any URL that must keep its old shapes — a pinned generation is never
  retired, and it is the spelling that earns the year-long immutable cache.

### Removed

- **`blobatar/generation`**, and with it the runtime `generation` option. The
  package major is the selector now: pinning a generation is choosing a major
  and letting the lockfile hold it, rather than passing a value at every call
  site. This keeps historical implementations out of the bundle entirely — a
  gen2 consumer no longer carries gen1's layout to pay for a choice it never
  makes — and it is why the endpoint, which does serve both, depends on the
  frozen majors under an alias instead.
- The `droplet.w` and `droplet.n` trait keys. The droplet's taper is drawn as
  the two tangents from its apex to the body, so how far the apex reaches is
  also how wide its base is and how sharp its point comes out: three knobs that
  could disagree became one that cannot. Only reachable through `traits`
  overrides, and only on a droplet.

### blobatar 1.0.0

- Stabilised the API at 1.0 and added `blobatar/generation`, making gen2
  available as an opt-in value while gen1 stayed the default for the whole
  major. Removed in 2.0.0, where the major became the selector instead.
- Published through npm's trusted publisher: releases are built and signed by
  the tag-driven `release.yml` workflow with provenance, and the repo holds no
  npm token.
- `blobatar.dev/avatar/<name>` went live — the same renderer as an HTTP
  endpoint, for the `<img src>` case that never wanted a dependency.

### blobatar 0.2.0

- Nine more expressions, for thirteen: `idle`, `happy`, `sad`, `mad`,
  `surprised`, `wink`, `sleepy`, `smug`, `unsure`, `scared`, `love`, `shy` and
  `sick`. Each is a value imported from `blobatar/expression`, so a consumer
  who uses none carries none.

### blobatar 0.1.0

- First release: deterministic blobatars from any string, the six-silhouette
  gen1 vocabulary, `blobatar/react`, `blobatar/uri`, animation through
  `blobatar/motion.css`, and full trait overrides.

[blobatar]: https://github.com/Alain00/blobatar
[bloub]: https://github.com/jeremy-prt/bloub
