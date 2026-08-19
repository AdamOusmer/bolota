/**
 * Static SVG markup for the `frames.css` decorative classes.
 *
 * Ported from bloub (https://github.com/jeremyPerret/bloub), MIT License,
 * Copyright (c) 2026 Jérémy Perret — specifically the burst particle count,
 * timing and ring measurements in `src/bot/decor.ts`. Unlike bloub, nothing
 * here runs a PRNG or a per-frame renderer at runtime: every value below is
 * a hardcoded result of evaluating bloub's seeded generators once (see
 * `frames.css` for the particle numbers, computed from `particles()` seeded
 * `0xbeef`; ring tilt/speed from `RINGS` seeded `0xa11ce`). This file only
 * emits the fragments those pre-baked CSS animations expect to find.
 *
 * All markup is sized to a 100x100 viewBox with the body centered at
 * (50, 50), matching this package's renderer (`render.ts`).
 */

const PARTICLE_COUNT = 5;

/** Five small circles, born at the body's center, that `frames.css`'s
 * `bb-particle-1..5` keyframes throw outward and spiral back in. */
function burstParticles(): string {
  let out = "";
  for (let i = 1; i <= PARTICLE_COUNT; i++) {
    out += `<circle class="bb-particle-${i}" cx="50" cy="50" r="2" fill="currentColor"/>`;
  }
  return out;
}

/**
 * One ring: an ellipse standing in for bloub's tilted 3D orbit arc, wrapped
 * in a `<g>` carrying the static tilt as an SVG `rotate(angle, cx, cy)`
 * attribute — left to the SVG engine rather than CSS, so it composes
 * unconditionally with the CSS-animated spin `frames.css` applies to the
 * ellipse itself (see `.bb-ring-N` there).
 */
function ring(n: 1 | 2 | 3, tiltDeg: number, front: boolean): string {
  const cls = `bb-ring-${n}${front ? " bb-ring-front" : ""}`;
  return (
    `<g transform="rotate(${tiltDeg} 50 50)">` +
    `<ellipse class="${cls}" cx="50" cy="50" rx="42" ry="13" ` +
    `stroke="currentColor" stroke-width="1.2" stroke-dasharray="56 134"/>` +
    `</g>`
  );
}

/**
 * Three rings standing in for bloub's six (`RINGS` in its `decor.ts`), each
 * rendered twice — once behind the body, once in front — so the body occludes
 * the "back" halves the way bloub's real depth-sorted arcs do. Tilt and spin
 * duration per ring are bloub's measured values (RINGS[0], RINGS[2],
 * RINGS[4]); see `frames.css` for the per-class durations.
 */
function orbitRings(front: boolean): string {
  return ring(1, 6, front) + ring(2, 63, front) + ring(3, 146, front);
}

export interface DecorMarkup {
  /** Rendered before the body group — occluded by it. */
  back: string;
  /** Rendered after the body group — sits on top. */
  front: string;
}

/**
 * Decorative SVG fragments for a `frames.css` animation kind, split into
 * what an adapter should place behind vs. in front of the blobatar's body
 * group. Both come back empty for a kind that needs no extra elements —
 * `"comet"` only animates the root `<g>` itself (`.bb-comet-drift`), nothing
 * additional to draw.
 */
export function decorMarkup(kind: "burst" | "orbit" | "comet"): DecorMarkup {
  switch (kind) {
    case "burst":
      // bloub draws its particles behind the body (`dotsBehind: true`,
      // states.ts's burst state) so the collapse reads as swallowing them.
      return { back: burstParticles(), front: "" };
    case "orbit":
      return { back: orbitRings(false), front: orbitRings(true) };
    case "comet":
      return { back: "", front: "" };
  }
}
