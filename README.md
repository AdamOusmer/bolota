<!-- Fork of https://github.com/Alain00/blobatar — MIT, see Acknowledgements -->
[forks-shield]: https://img.shields.io/github/forks/AdamOusmer/bolota.svg?style=for-the-badge
[forks-url]: https://github.com/AdamOusmer/bolota/network/members
[stars-shield]: https://img.shields.io/github/stars/AdamOusmer/bolota.svg?style=for-the-badge
[stars-url]: https://github.com/AdamOusmer/bolota/stargazers
[issues-shield]: https://img.shields.io/github/issues/AdamOusmer/bolota.svg?style=for-the-badge
[issues-url]: https://github.com/AdamOusmer/bolota/issues
[license-shield]: https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge
[license-url]: LICENSE

<!-- PROJECT HEADER -->
<div align="center">

[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![License: MIT][license-shield]][license-url]

<h3 align="center">bolota</h3>

  <p align="center">
    Deterministic, dependency-free SVG blob avatars from any string.
    <br />
    Same name in, same face out — every time, on every machine.
    <br />
    <br />
    <a href="#quick-start"><strong>Explore the docs »</strong></a>
    <br />
    <a href="https://github.com/AdamOusmer/bolota/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/AdamOusmer/bolota/issues/new?labels=enhancement">Request Feature</a>
    <br />
    <br />
  </p>

[![GitHub](https://img.shields.io/badge/AdamOusmer-%23121011.svg?style=for-the-badge&logo=github&logoColor=white)](https://github.com/AdamOusmer)

</div>

***

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about-the-project">About The Project</a></li>
    <li><a href="#install">Install</a></li>
    <li><a href="#quick-start">Quick Start</a>
        <ul>
            <li><a href="#render-to-svg">Render to SVG</a></li>
            <li><a href="#the-parts-seam">The parts seam</a></li>
            <li><a href="#expressions">Expressions</a></li>
            <li><a href="#eyes">Eyes</a></li>
            <li><a href="#animation-engine">Animation Engine</a></li>
        </ul>
    </li>
    <li><a href="#determinism-guarantees">Determinism Guarantees</a></li>
    <li><a href="#testing--verification">Testing &amp; Verification</a></li>
    <li><a href="#project-layout">Project Layout</a></li>
    <li><a href="#v2-breaking-changes">v2 Breaking Changes</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgements">Acknowledgements</a></li>
  </ol>
</details>

***

## About The Project

bolota turns any string — a username, an email, a user id — into a small
geometric creature: a shape, a hue, a pair of eyes, an expression. No
dependencies, no network calls, no server-side rendering pipeline. The same
input string always produces the exact same SVG, on any machine, forever.

This fork tracks upstream [Alain00/blobatar](https://github.com/Alain00/blobatar)
and carries it in a different direction for **v2**:

- The React adapter is gone. Instead of shipping a component wrapper, the
  library exposes the `parts` renderer seam directly, so any framework (or no
  framework) can build its own adapter on top of the same deterministic data.
- A ported animation engine (from [bloub](https://github.com/jeremy-prt/bloub))
  is being layered in alongside the static renderer — the same bolota, now
  idling, orbiting, and reacting instead of sitting still.

If you only need a static avatar, nothing here changes your integration. If
you want motion, the engine is opt-in and additive.

***

## Install

The package is not published to a registry — install it straight from this
repo as a git dependency:

```sh
bun add git+https://github.com/AdamOusmer/bolota
```

npm, pnpm and yarn all understand the same `git+https://...` dependency
syntax if you're not on Bun.

***

## Quick Start

### Render to SVG

```ts
import { bolota } from "bolota";

bolota("alain@example.com");
// '<svg xmlns="..." viewBox="0 0 100 100">…</svg>'
```

`bolota()` is a pure function: string in, SVG markup out. Pair it with a
`data:` URI helper for `<img src>` or CSS `background-image`:

```ts
import { bolotaUri } from "bolota/uri";

el.style.backgroundImage = `url("${bolotaUri(user.id)}")`;
```

### The `parts` seam

v2 drops the React component and publishes the seam it was built on instead.
`parts` returns the same shape, palette and eye/mouth geometry that
`bolota()` renders to a string — as structured data, so you can hand it to
your own renderer (React, Vue, Svelte, canvas, whatever) instead of taking the
library's SVG string as-is:

```ts
import { parts } from "bolota/blob";

const face = parts("alain@example.com");
// { shape, hue, tone, eyes, mouth, background, ... }

// Your own adapter owns the markup from here:
function Avatar({ name }: { name: string }) {
  const { shape, hue, eyes } = parts(name);
  return <MyOwnSvgRenderer shape={shape} hue={hue} eyes={eyes} />;
}
```

This is the intentional replacement for the removed `bolota/react` export:
one seam, framework-agnostic, instead of a component per framework.

### Expressions

```ts
import { bolota } from "bolota";
import { happy } from "bolota/expression";

bolota(user.email, { expression: happy });
```

Expressions are imported as values, so a build only pulls in the poses it
actually references.

### Eyes

Eyes are always the fixed bloub-style black capsule pair — no more light/dark
polarity flip against the body color. This is a **deliberate v2 breaking
change**: the darkest body tone (nicknamed "ink" in the source) no longer
clears the old 4.5:1 eye-contrast guarantee against a fixed-black eye, and
that guarantee is no longer enforced for `eye`/`head` at all. It ships
exactly as authored rather than walked back to satisfy contrast — see
`test/color.test.ts`'s "eye is always the fixed dark tone" for the tones that
fall short.

### Animation Engine

Ported from [bloub](https://github.com/jeremy-prt/bloub), the engine mounts a
bolota directly onto an `<svg>` element and drives it through a state
machine instead of rendering one static frame:

```ts
import { mountEngine } from "bolota/engine";

const avatar = mountEngine(svgRoot, user.id, { hue: 210 });

avatar.play("orbit");
// later
avatar.play("burst");

avatar.stop();     // freeze on the current frame
avatar.destroy();  // remove every node this call created
```

15 states ship: `idle`, `thinking`, `wink`, `wide`, `alert`, `notify`,
`exclaim`, `sleep`, `egg`, `hexagon`, `play`, `orbit`, `swirl`, `burst`,
`comet` (`avatar.states` lists them at runtime). `bolota/sequences` groups
related states into ready-made playlists if you'd rather drive a sequence
than call `play()` state by state.

Fast motion (spins, orbits, the comet's trail) gets a velocity-proportional
motion blur, damped frame to frame so it eases in and out instead of
snapping. Each `mountEngine()` call namespaces its own filter/gradient ids,
so multiple engine instances on one page never collide — the static
`bolota()` output stays completely id/filter-free either way.

No separate CSS file is required; the engine builds its own `<defs>` inline.
The engine is a separate entry point (`bolota/engine`) from the static
renderer — importing one never pulls in the other. It respects
`prefers-reduced-motion`: it renders one static pose and never starts the
render loop.

***

## Determinism Guarantees

The core promise:

- **Same string, same bolota — always.** The name is hashed once; every
  trait (shape, hue, tone, eyes, expression default) is derived from that one
  hash. No randomness, no `Date.now()`, no environment-dependent input.
- **Options narrow, they don't override the hash.** `traits` pins individual
  axes (e.g. `{ shape: 0.95 }`); anything left unset still comes from the
  name's hash, so partially-branded avatars still vary per user instead of
  collapsing to one fixed image.
- **Pure functions, no I/O.** `bolota()` and `parts()` take a string and
  options and return a value — no fetch, no filesystem, no shared mutable
  state between calls.

***

## Testing & Verification

The library ships with a `test/` directory covering the renderer, the `parts`
seam and the engine's state transitions. Determinism itself is checked by
regenerating known inputs and diffing the output against committed fixtures —
any change to the hash-to-trait mapping fails loudly instead of silently
drifting.

```sh
bun test
```

There is also a small test website, `test/site/`: feed it a name and it
renders that bolota live — static and animated, every expression, every
engine state — so "same string, same output" can be checked by hand against
the real renderer, not only against the test suite.

```sh
cd test/site
bun install
bun run dev
```

***

## Project Layout

The library lives at the repository root — no monorepo indirection to
install or build against:

```
src/     — library source (renderer, parts seam, engine, expressions)
test/    — unit tests + determinism fixtures
```

Exposed entry points:

| Export             | What it is                                   |
| ------------------- | --------------------------------------------- |
| `bolota`          | `bolota()` — render straight to an SVG string, plus palette/trait utilities |
| `bolota/blob`      | `parts()` — the structured renderer seam, on its own (saves ~1 KB if that's all you use) |
| `bolota/uri`       | `bolotaUri()` — wraps output in a `data:` URI |
| `bolota/expression`| Named expression values (`happy`, `sad`, …)   |
| `bolota/motion.css`| Required CSS for the static renderer's `animate` mode |
| `bolota/engine`    | `mountEngine()` — the bloub-ported animation engine |
| `bolota/sequences` | Ready-made playlists across engine states     |
| `bolota/package.json`| The package manifest itself, resolvable as a subpath (tooling convenience) |

The engine needs no separate stylesheet — its motion is built from inline
SVG `<defs>` at mount time, not CSS keyframes.

***

## v2 Breaking Changes

- **React adapter removed.** `bolota/react` is gone; the `parts` seam
  (`bolota/blob`) is the public replacement for building your own adapter.
- **Eyes reworked.** Always the fixed bloub-style black capsule — see
  [Eyes](#eyes) for the contrast-guarantee tradeoff this brings.
- **Animation engine added.** `bolota/engine`, ported from bloub, alongside
  (not replacing) the existing static renderer and its `animate` mode.
- **Goldens regenerated.** The eye rework and engine port changed reference
  output; `test/golden` was regenerated against the new renderer.
- **Monorepo flattened.** The library now lives at the repository root
  (`src/`, `test/`) instead of under `packages/bolota`; there is no
  `apps/*` workspace in this fork.

***

## Contributing

This is a personal fork tracking upstream in a different direction — issues
and ideas are welcome, but please open an issue before sending a pull request
so scope can be agreed on first.

***

## Releasing

Tags follow `vX.Y.Z` (e.g. `v2.0.1`), matching the `version` field in
`package.json`.

1. Bump `version` in `package.json` first, commit it.
2. Create a GitHub Release against that commit, tagged `vX.Y.Z`.
3. Publishing the Release triggers `.github/workflows/release.yml`, which
   typechecks, tests, checks size budgets, builds, verifies the tarball
   (`bun pm pack`), confirms the tag matches `package.json`'s version, and
   runs `npm publish --access public`.

The workflow also runs on `workflow_dispatch` with a `dry-run` input, for
exercising the same gate and tarball verification without publishing.

Publishing uses npm's [Trusted Publishing](https://docs.npmjs.com/trusted-publishers)
(OIDC) — no npm token is stored in this repo. Before the first release, configure
it once on npmjs.com, on the `bolota` package's Settings page, under "Trusted
Publisher":

- Organization or user: `AdamOusmer`
- Repository: `bolota`
- Workflow filename: `release.yml` (filename only, not the full path)
- Environment name: `npm-release` (matches the `environment:` in
  `release.yml`; optional on npm's side, but set it if the GitHub environment
  below is configured, so npm rejects publishes from anywhere else)
- Allowed actions: `npm publish`

Optionally, create a matching `npm-release` environment under this repo's
Settings > Environments to add protection rules (e.g. required reviewers)
around who can trigger an actual publish. Not required for OIDC to work —
just extra scoping.

***

## License

Distributed under the MIT License — see [LICENSE](LICENSE) for details.

***

## Contact

Adam Ousmer - [GitHub](https://github.com/AdamOusmer)

***

## Acknowledgements

This project is a fork. Neither upstream author is affiliated with this fork
or endorses it.

- **[blobatar](https://github.com/Alain00/blobatar)** by Alain — the original
  deterministic blob-avatar library this fork is built on. MIT licensed.
- **[bloub](https://github.com/jeremy-prt/bloub)** by Jérémy Perret — source
  of the animation engine ported into this fork's `bolota/engine`. The code
  is MIT licensed; its visual design imitates x.ai's, and is not affiliated
  with or endorsed by x.ai.

README structure inspired by [othneildrew/Best-README-Template](https://github.com/othneildrew/Best-README-Template).
