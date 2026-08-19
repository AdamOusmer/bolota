/**
 * What Bolota 2's golden fixture covers.
 *
 * Shared by the writer and the test so they cannot drift into recording one
 * corpus and checking another. The contract is seed→markup: bands, geometry
 * ranges, tone edges, expression geometry, and every rendering option below.
 */

import { bolota } from "../../src/bolota";
import { layout } from "../../src/blob";
import {
  happy, idle, love, mad, sad, scared, shy, sick, sleepy, smug, surprised, unsure, wink,
} from "../../src/expression";
import type { BolotaOptions } from "../../src/render";
import { traits } from "../../src/traits";

const TEMPLATES: ((i: number) => string)[] = [
  i => `user-${i}`,
  i => `alain${i}@example.com`,
  i => (i * 2654435761 >>> 0).toString(16).padStart(8, "0").repeat(4),
  i => `Team Rocket ${i}`,
  i => `café-${i}`,
  i => `Ünïcødé ${i}`,
  i => `🦊${i}🌱`,
  i => `${i}`,
  i => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  i => `  Mixed Case ${i}  `,
];

export const SEEDS = Array.from(
  { length: 1000 },
  (_, i) => TEMPLATES[i % TEMPLATES.length]!(i),
);

const SWEEP_SEEDS = SEEDS.slice(0, 12);

const OPTION_CASES: [string, BolotaOptions][] = [
  ["bg:none", { background: false }],
  ["bg:square", { background: "square" }],
  ["bg:circle", { background: "circle" }],
  ["bg:squircle", { background: "squircle" }],
  ["hue:0", { hue: 0 }],
  ["hue:210", { hue: 210 }],
  ["hue:359", { hue: 359 }],
  ["tone:0", { tone: 0 }],
  ["tone:0.5", { tone: 0.5 }],
  ["tone:0.999", { tone: 0.999 }],
  ["size:8", { size: 8 }],
  ["size:1024", { size: 1024 }],
  ["normalize:false", { normalize: false }],
  ...Object.entries({
    idle, happy, sad, mad, surprised, wink, sleepy, smug, unsure, scared, love, shy, sick,
  }).map(([name, e]) => [`expression:${name}`, { expression: e }] as [string, BolotaOptions]),
];

/** Midpoints of gen2's bands, duplicated deliberately to catch moved bands. */
const SHAPES: [string, number][] = [
  ["round", 0.11],
  ["organic", 0.35],
  ["boxy", 0.54],
  ["capsule", 0.65],
  ["nub", 0.745],
  ["cloud", 0.825],
  ["droplet", 0.888],
  ["hexagon", 0.933],
  ["sun", 0.965],
  ["triangle", 0.99],
];

export function markup(): [string, string][] {
  const out = SHAPES.map(([shape, v]) => [
    `shape:${shape}`,
    bolota("alain", { traits: { shape: v } }),
  ] as [string, string]);
  out.push(
    ["plain", bolota("alain")],
    ["backdrop", bolota("alain", { background: "squircle" })],
    ["posed", bolota("alain", { expression: happy })],
    ["tinted", bolota("alain", { expression: mad })],
    ["titled", bolota("alain", { title: "Alain" })],
    ["sized", bolota("alain", { size: 64 })],
    ["configured", bolota("alain", { traits: { shape: 0.96, "eye.ratio": 0, hue: 0.5 } })],
    ["astral", bolota("🦊")],
  );
  return out;
}

export function* cases(): Generator<[string, string]> {
  for (const seed of SEEDS) yield [seed, bolota(seed)];
  for (const seed of SWEEP_SEEDS) {
    for (const [label, opts] of OPTION_CASES) {
      yield [`${seed}\0${label}`, bolota(seed, opts)];
    }
  }
}

export const HISTOGRAM_SEEDS = 20_000;

export function histogram(): [string, number][] {
  const counts = new Map<string, number>();
  for (let i = 0; i < HISTOGRAM_SEEDS; i++) {
    const shape = layout(traits(`histogram-${i}`)).shape;
    counts.set(shape, (counts.get(shape) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b));
}
