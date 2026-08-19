[npm-shield]: https://img.shields.io/npm/v/@luzir/bolota.svg?style=for-the-badge

[npm-url]: https://www.npmjs.com/package/@luzir/bolota

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

[![npm][npm-shield]][npm-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT][license-shield]][license-url]

<h3 align="center">bolota</h3>

  <p align="center">
    One string in, one face out. Forever the same face.
    <br />
    Deterministic avatars that blink, drift and look at your cursor.
    <br />
    <br />
    <a href="https://github.com/AdamOusmer/bolota/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/AdamOusmer/bolota/issues/new?labels=enhancement">Request Feature</a>
    <br />
    <br />
    </p>

[![Email](https://img.shields.io/badge/contact%40adam--ousmer.dev-D14836?style=for-the-badge&logo=gmail&logoColor=white)](mailto:contact@adam-ousmer.dev)
[![GitHub](https://img.shields.io/badge/AdamOusmer-%23121011.svg?style=for-the-badge&logo=github&logoColor=white)](https://github.com/AdamOusmer)

</div>

***

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about-the-project">About The Project</a>
        <ul><li><a href="#tech-stack">Tech Stack</a></li></ul>
    </li>
    <li><a href="#install">Install</a></li>
    <li><a href="#quick-start">Quick Start</a>
        <ul><li><a href="#render-to-svg">Render to SVG</a></li></ul>
        <ul><li><a href="#build-your-own-component">Build your own component</a></li></ul>
        <ul><li><a href="#hold-an-expression">Hold an expression</a></li></ul>
        <ul><li><a href="#the-live-engine">The live engine</a></li></ul>
    </li>
    <li><a href="#api">API</a></li>
    <li><a href="#determinism">Determinism</a></li>
    <li><a href="#size">Size</a></li>
    <li><a href="#testing">Testing</a></li>
    <li><a href="#releasing">Releasing</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgements">Acknowledgements</a></li>
  </ol>
</details>

***

## About The Project

Every app that lets people pick a name eventually needs a face to put next to
it. The usual answers are a gravatar lookup (a network round trip, and a
tracking vector), a coloured circle with an initial in it (fine, forgettable),
or an identicon made of squares (deterministic, and ugly).

bolota takes a string and draws a small creature. The same string always draws
the same creature, on every machine, in every runtime, forever: the seed picks
a silhouette out of ten, an OKLCh palette, an eye pair and where they sit. No
network, no dependencies, no canvas.

The part I actually built this for is that it does not have to hold still. The
same seeded creature can be mounted onto a live `<svg>` and given a state
machine: it blinks, breathes, drifts, follows the pointer, and can be told to
be surprised, to spin, or to explode into particles and reassemble.

It is a fork, twice over, and neither upstream is mine: the deterministic
renderer comes from [blobatar][blobatar], the animation engine from
[bloub][bloub]. What is mine is the merge of the two: every state now renders
on the seed's own silhouette instead of the engine's built-in shapes, which is
what makes a name's face recognisably itself while it moves.

### Tech Stack

![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white)
![SVG](https://img.shields.io/badge/SVG-%23FFB13B.svg?style=for-the-badge&logo=svg&logoColor=black)

Zero runtime dependencies. TypeScript source, bundled and typed with Bun,
shipped as ESM.

***

## Install

```sh
bun add @luzir/bolota
```

npm, pnpm and yarn understand the same name. Scoped packages need no extra
flag to install, only to publish, so a plain `npm install @luzir/bolota`
works.

Straight from git also works, and tracks whatever is ahead of the last
publish:

```sh
bun add git+https://github.com/AdamOusmer/bolota
```

***

## Quick Start

### Render to SVG

```ts
import { bolota } from "@luzir/bolota";

bolota("adam@example.com");
// '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">…</svg>'
```

`bolota()` is a pure function: string in, markup out. Nothing to mount, no
DOM required, so it works in a server render as happily as in a browser.

For `<img src>` or CSS, wrap it in a `data:` URI:

```ts
import { bolotaUri } from "@luzir/bolota/uri";

el.style.backgroundImage = `url("${bolotaUri(user.id)}")`;
```

### Build your own component

`parts()` returns the same render split into the pieces a framework wrapper
needs, so you can own the outer element yourself:

```ts
import { parts } from "@luzir/bolota";

const { cls, bg, inner, vars } = parts(user.id, { size: 64 });
```

| Field   | What it is                                                        |
| ------- | ----------------------------------------------------------------- |
| `cls`   | class list for the `<svg>` element, absent unless motion is on      |
| `bg`    | background colour, absent when the render is transparent            |
| `inner` | the `<svg>` children, as markup, for an innerHTML-style sink       |
| `vars`  | CSS custom properties for the expression and motion, absent when neither is asked for |

The load-bearing invariant: nothing that varies with the expression appears in
`inner`. An expression is style, not markup, so switching one changes zero
bytes of `inner` and the browser can morph between poses instead of swapping
elements. That is the whole reason this seam exists rather than a component
per framework.

```svelte
<script lang="ts">
  import { parts } from "@luzir/bolota";
  let { name, size = 64 } = $props();
  const { cls, bg, inner, vars } = $derived(parts(name, { size }));
</script>

<svg class={cls} style="background:{bg};{vars}" viewBox="0 0 100 100">
  {@html inner}
</svg>
```

### Hold an expression

Static renders take an expression as a value, so a bundler only pulls in the
poses you actually name:

```ts
import { bolota } from "@luzir/bolota";
import { happy } from "@luzir/bolota/expression";

bolota(user.id, { expression: happy });
```

Ships: `idle`, `happy`, `sad`, `mad`, `surprised`, `wink`, `sleepy`, `smug`,
`unsure`, `scared`, `love`, `shy`, `sick`.

The live engine has its own, larger expression roster addressed by id rather
than by import (see below). The two are separate on purpose: these thirteen
are CSS-variable poses a static render can wear with no JavaScript running,
the engine's are eye poses interpolated frame by frame.

### The live engine

```ts
import { mountEngine } from "@luzir/bolota/engine";

const bot = mountEngine(svgElement, user.id);

bot.play("wander", { loop: true }); // resting face, alive
bot.setExpression("curious");       // hold a face on top of it
bot.follow("window");               // eyes track the pointer
bot.play("burst");                  // one-shot: plays, holds, blends back

bot.stop();     // freeze on the current frame
bot.destroy();  // remove every node this call created
```

A one-shot state plays, dwells on its finished pose for a beat, then
cross-fades back into the face it interrupted, expression and all. The state
it returns to is whatever was looping before it, so the bot never drops into
a different resting face than the one it left. Both parts are adjustable:

```ts
bot.play("orbit", { hold: 1.2 });        // linger longer before handing back
bot.play("wink", { rest: "thinking" });  // settle somewhere else afterwards
bot.play("burst", { hold: 0 });          // hand back the instant it ends
bot.play("swirl", { for: 4 });           // repeat until four seconds are filled
```

`hold` freezes the finished pose for a beat; `for` replays the state until the
time asked for is filled, which is what a gesture shorter than its slot needs.
The deadline is a floor rather than a cut: the hand-back waits for the cycle
that crosses it, so the state always finishes what it started.

Every transition is a cross-fade over the outgoing state's own morph, and
most mask the shape change with a blink. There is no path through the API
that cuts, with one deliberate exception: under `prefers-reduced-motion` the
engine renders single frames and does not animate between them.

Fourteen states ship, listed at runtime as `bot.states`:

| State                          | What it does                                   |
| ------------------------------ | ---------------------------------------------- |
| `idle`                         | the still neutral base: gaze dead ahead, blink and breath only |
| `wander`                       | the same resting face, alive: gaze drifts, body floats |
| `thinking`, `wink`, `wide`     | short gestures                                 |
| `alert`, `exclaim`             | the body folds into an exclamation mark's dot, bar above it |
| `notify`                       | a badge pops in and the gaze looks away from it |
| `snooze`                       | drifts off                                     |
| `play`, `orbit`, `swirl`       | body choreography with rings and trails        |
| `burst`, `comet`               | collapse into particles, reassemble            |

Seventeen expressions ship, listed as `bot.expressions`: `wander`,
`attentive`, `surprised`, `excited`, `happy`, `laughing`, `angry`, `sad`,
`scared`, `suspicious`, `confused`, `curious`, `proud`, `shy`, `unimpressed`,
`sleepy`, `love`. An expression only shows on a state that has a face to
put it on, and it scales with the body, so a shrunken body never wears a
full-size pair of eyes.

Fast motion gets velocity-proportional blur, damped frame to frame so it eases
in and out. Each `mountEngine()` call namespaces its own filter and gradient
ids, so several engines on one page never collide. It needs no stylesheet: the
`<defs>` are built inline at mount. It honours `prefers-reduced-motion` by
rendering one static pose and never starting the loop.

***

## API

| Entry point                  | What it gives you                                              |
| ---------------------------- | -------------------------------------------------------------- |
| `@luzir/bolota`              | `bolota()`, `parts()`, palette and trait utilities, `VERSION`   |
| `@luzir/bolota/blob`         | `bolota()` and `layout()` alone, without the colour utilities   |
| `@luzir/bolota/uri`          | `bolotaUri()`, the same render as a `data:` URI                |
| `@luzir/bolota/expression`   | the thirteen static expression values                           |
| `@luzir/bolota/engine`       | `mountEngine()`, the live engine                               |
| `@luzir/bolota/sequences`    | `runSequence()`, friendly names for four engine states         |
| `@luzir/bolota/motion.css`   | the stylesheet the static renderer's `animate` mode needs       |

Every render takes the same options:

```ts
bolota(name, {
  size: 64,             // emits width/height; the viewBox is always 0 0 100 100
  background: "circle", // true | false | "square" | "circle" | "squircle"
  hue: 210,             // lock the hue in degrees, so the name drives shape only
  tone: 0.8,            // lock the tone as a 0-1 position in the swatch set
  palette: myPalette,   // or override palette entries outright
  traits: { shape: 0.95, "eye.ratio": 0.1 }, // raw 0-1 trait positions
  normalize: true,      // NFC + trim + lowercase the seed first (default true)
  contrast: true,       // enforce the contrast floors (default true)
  title: "Adam",        // <title> for screen readers
  animate: "always",    // "hover" | "always", needs motion.css
  expression: happy,
});
```

`traits` is the raw seam: every key is a 0 to 1 position into the same band
table the hash indexes, clamped rather than trusted, so a bad value renders a
face instead of throwing. `hue` and `tone` are the same two traits in
friendlier units and win over their `traits` equivalents.

`_layout()` is exported too, and is underscored for a reason: it returns the
raw geometry the tests assert against, and its shape is not covered by semver.

***

## Determinism

The promise is that a seed's face is a pure function of the seed, and that it
does not move under you:

- the same string renders byte-identical markup in Bun, Node and every browser
- no `Math.random()`, no `Date`, no locale, no platform float divergence
- a golden fixture of 1343 renders is committed, and the suite fails on a
  single changed byte
- the seed to look mapping is frozen for the life of the major version

Which is also why a new silhouette can only ship in a major: adding one takes
its share of the band table from the existing ones, and everyone's face moves.

***

## Size

Measured gzipped, per entry point, and enforced in CI:

| Entry                      | gzip     |
| -------------------------- | -------- |
| static renderer            | ~4.5 KB  |
| renderer + one expression  | ~4.8 KB  |
| `data:` URI helper         | ~4.6 KB  |
| traits only                | ~0.5 KB  |
| live engine                | ~17 KB   |
| `motion.css`               | ~1.4 KB  |

The engine is a separate entry point from the static renderer: importing one
never pulls in the other.

***

## Testing

```sh
bun test          # unit, geometry and determinism suites
bun run size      # per-entry gzip budgets
bun run build     # bundle every entry point plus its type declarations
bun run check     # all three, the gate CI runs
```

The determinism fixture is regenerated deliberately, never as a side effect:
`bun run golden` refuses to write without `--write` and says so.

The repository is the library at its root, plus one app:

```
src/   the library (renderer, parts seam, engine, expressions)
test/  unit, geometry and determinism suites
web/   the showcase site, an Astro app linking the library above
```

`web/` depends on the library through `file:..`, so it resolves the compiled
`dist/` through the exports map, never the source. Build the library first
(`bun run build`, or `bun run lib:build` from inside `web/`) and then
`bun run dev` there.

***

## Releasing

Tags follow `vX.Y.Z`, matching `version` in `package.json`.

1. Bump `version`, commit it.
2. Create a GitHub Release against that commit, tagged `vX.Y.Z`.
3. Publishing the Release triggers `.github/workflows/release.yml`, which
   typechecks, tests, checks the size budgets, builds, verifies the tarball,
   confirms the tag matches `package.json`, and publishes.

The workflow also runs on `workflow_dispatch` with a `dry-run` input, to
exercise the same gate without publishing.

Publishing uses npm's [Trusted Publishing](https://docs.npmjs.com/trusted-publishers)
(OIDC): no npm token is stored in this repo. It is configured once on the
package's Settings page on npmjs.com, against this repo, the `release.yml`
workflow, and the `npm-release` environment.

***

## Contributing

This is a personal fork heading somewhere upstream is not, so please open an
issue before sending a pull request and we can agree on scope first. Bug
reports are welcome without ceremony.

***

## License

MIT, see [LICENSE](LICENSE). Both upstreams are MIT too, and their notices
are preserved there.

***

## Contact

Adam Ousmer - [GitHub](https://github.com/AdamOusmer) - [Email](mailto:contact@adam-ousmer.dev)

***

## Acknowledgements

This project is a fork. Neither upstream author is affiliated with it or
endorses it.

- **[blobatar][blobatar]** by Alain, the deterministic blob-avatar renderer
  this is built on. MIT licensed.
- **[bloub][bloub]** by Jérémy Perret, the animation engine ported into
  `@luzir/bolota/engine`. MIT licensed; its visual design imitates x.ai's and
  is not affiliated with or endorsed by x.ai.

[blobatar]: https://github.com/Alain00/blobatar
[bloub]: https://github.com/jeremy-prt/bloub

README template inspired by [othneildrew/Best-README-Template](https://github.com/othneildrew/Best-README-Template)
