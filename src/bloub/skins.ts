/**
 * Ported verbatim from bloub (https://github.com/jeremyPerret/bloub),
 * MIT License, Copyright (c) 2026 Jérémy Perret.
 *
 * Analytic personalizer shape profiles (round, pebble, egg, ...). Not adapted — see ../engine.ts for the bolota-specific bridge
 * (seed-to-silhouette conversion, DOM mounting, rAF loop). This file's
 * own logic and structure are untouched beyond TS-strict fixes, import
 * paths, and translating the original French comments/identifiers to
 * English (see ../engine.ts's header for the provenance note) — including
 * the `ShapeId`/`ColorId` picker names, now English rather than the French
 * originals (`cercle`, `galet`, `hexagone`, `nuage`, `goutte` for shapes;
 * `encre`, `creme`, `brun`, `rouge`, `ambre`, `vert`, `bleu`, `rose`,
 * `gris` for colors).
 */
import { PROFILE_SAMPLES } from './profiles'
import {
  hullOfCircles,
  profileFromPolygon,
  regularPolygonProfile,
  superellipseProfile,
  unionOfCirclesProfile
} from './shape'

/**
 * Shapes and colors offered by the bot's personalizer.
 *
 * Unlike the animation silhouettes (`profiles.ts`), these are NOT measured
 * off the video: they're built analytically from the original
 * personalizer's grid. Two distinct sources, deliberately — the animated
 * states have to stay faithful to the video, the base shapes are a user
 * choice.
 */

/**
 * The ids are enumerated rather than derived from the array: that's what
 * lets the i18n layer check AT COMPILE TIME that every shape has its
 * translation in all three languages (`t(\`shapes.${id}\`)` only compiles if
 * the key exists). An `as const` on the array would have the same effect
 * but would make `radii` read-only, while the engine passes it through
 * as-is.
 */
export type ShapeId =
  | 'circle'
  | 'pebble'
  | 'squircle'
  | 'capsule'
  | 'triangle'
  | 'hexagon'
  | 'cloud'
  | 'drop'

export interface BotShape {
  id: ShapeId
  radii: number[]
}

/** Brings the max radius down to `max` so every shape reads the same weight to the eye. */
function normalize(radii: number[], max = 1): number[] {
  const peak = Math.max(...radii)
  if (peak <= 0) return radii
  const k = max / peak
  return radii.map((r) => r * k)
}

const ANGLES = Array.from({ length: PROFILE_SAMPLES }, (_, i) => (i / PROFILE_SAMPLES) * Math.PI * 2)

/** Pebble: a circle deformed by two low harmonics, so irregular but smooth. */
const pebble = normalize(
  ANGLES.map((a) => 1 + 0.075 * Math.cos(2 * a + 0.5) + 0.035 * Math.cos(3 * a + 2.1)),
  1.02
)

/** Cloud: union of bumps, wide at the bottom, two lobes on top. */
const cloud = normalize(
  unionOfCirclesProfile([
    { x: -0.44, y: 0.2, r: 0.54 },
    { x: 0.46, y: 0.2, r: 0.5 },
    { x: 0.02, y: 0.3, r: 0.6 },
    { x: -0.24, y: -0.3, r: 0.48 },
    { x: 0.3, y: -0.24, r: 0.44 }
  ]),
  1.02
)

/** Drop: large disk at the bottom, tapered point at the top. */
const droplet = normalize(
  profileFromPolygon(hullOfCircles(0, 0.28, 0.66, 0, -0.96, 0.05), 0, 0),
  1.04
)

/** Capsule lying down: envelope of two side-by-side disks. */
const capsule = profileFromPolygon(hullOfCircles(-0.42, 0, 0.62, 0.42, 0, 0.62), 0, 0)

export const SHAPES: BotShape[] = [
  { id: 'circle', radii: new Array(PROFILE_SAMPLES).fill(1) },
  { id: 'pebble', radii: pebble },
  // 1.15 and not 1.02: on a superellipse the max radius is the diagonal,
  // so normalizing against it gives a shape that reads smaller than the circle.
  { id: 'squircle', radii: normalize(superellipseProfile(4.2), 1.15) },
  { id: 'capsule', radii: capsule },
  // -90deg: a vertex points to the top of the screen (y points down)
  { id: 'triangle', radii: regularPolygonProfile(3, 1.12, 0.34, -90) },
  // 0deg: vertices left and right, so flat top and bottom edges
  { id: 'hexagon', radii: regularPolygonProfile(6, 1.04, 0.26, 0) },
  { id: 'cloud', radii: cloud },
  { id: 'drop', radii: droplet }
]

// Map indexed by `string` rather than `ShapeId`: callers query with a
// value read back from localStorage or a prop, so it's unvalidated.
export const SHAPE_BY_ID = new Map<string, BotShape>(SHAPES.map((s) => [s.id, s]))
export const DEFAULT_SHAPE = 'circle'

export type ColorId =
  | 'ink'
  | 'cream'
  | 'brown'
  | 'red'
  | 'orange'
  | 'amber'
  | 'green'
  | 'turquoise'
  | 'blue'
  | 'violet'
  | 'pink'
  | 'gray'

export interface BotColor {
  id: ColorId
  hex: string
}

/** The original personalizer's palette. */
export const COLORS: BotColor[] = [
  { id: 'ink', hex: '#0a0a0c' },
  { id: 'brown', hex: '#8b5e3c' },
  { id: 'red', hex: '#e8483f' },
  { id: 'orange', hex: '#f08a24' },
  { id: 'amber', hex: '#f0b429' },
  { id: 'green', hex: '#3ecf8e' },
  { id: 'turquoise', hex: '#2fbfa0' },
  { id: 'blue', hex: '#3b93f0' },
  { id: 'violet', hex: '#8b5cf6' },
  { id: 'pink', hex: '#e152b0' },
  { id: 'gray', hex: '#a3a3a3' },
  { id: 'cream', hex: '#f1efe9' }
]

export const COLOR_BY_ID = new Map<string, BotColor>(COLORS.map((c) => [c.id, c]))
export const DEFAULT_COLOR = 'ink'

/** Mixes two hex colors. Used for the particles' depth haze. */
export function mixHex(from: string, to: string, t: number): string {
  const parse = (h: string) => {
    const v = parseInt(h.slice(1), 16)
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
  }
  const a = parse(from)
  const b = parse(to)
  const c = a.map((x, i) => Math.round(x + (b[i]! - x) * t))
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`
}
