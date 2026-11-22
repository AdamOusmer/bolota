// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Ported from open-bot-avatar (c) 2026 Dominik Scholz, MIT. See LICENSE.

import { fromHex, toHex } from "../color";
import { DONE_TURN, WORK_AT, WORK_TURN, celebration, noise, workAngle } from "./shared";

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (u: number) => {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
};
const mix = (range: readonly [number, number], u: number) => range[0] + (range[1] - range[0]) * u;

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Ribbon space: a typical body is `BODY` units across its larger side, centred on the origin. */
export const BODY = 80;
const UNIT = BODY / 228.541;
const RIM_MARGIN = 2;
const RING = 38.8 * (116 / 114.2705);
const RIM_STEPS = 180;
const HOOP_TILT = 0.386;
const HOOP_ROLL = 0.157;
const HOOP_JITTER = 0.24;
const HOOP_TILT_JITTER = 0.08;
const LADDER = 38;
const ARC: [number, number] = [2.2, 3.4];
const FOLLOW: [number, number] = [0.74, 0.94];
const DRIFT: [number, number] = [0.5, 1.1];
const WIDEN = 2.5;
const START = 0.18;
const SIZE_FEW: [number, number] = [8, 10.5];
const SIZE_FOUR: [number, number] = [6.6, 8.6];
const SIZE_MANY: [number, number] = [5.6, 7.4];
const WORK_LANES: [number, number] = [3, 5];
const sizeFor = (count: number) => (count <= 3 ? SIZE_FEW : count === 4 ? SIZE_FOUR : SIZE_MANY);
const BRUSH = 1.7 * 1.98;
const FAR = 0.72;
const GROW_S = 0.34;
const STAGGER: [number, number] = [0.055, 0.105];
const SWEEP_RATE: [number, number] = [6.3, 15];
const LANES = 3;
const HOOPS = 3;
const SAMPLES = 24;
const STRETCH = 6;
const SLIVER = 0.02;
const CAP = 7;

/** How far the body reaches from its centre along a line at `angle`, either way, in ribbon units. */
export interface Rim {
  at: (angle: number) => number;
  max: number;
}

export function rimOf(at: (angle: number) => number): Rim {
  let max = 0;
  for (let k = 0; k < RIM_STEPS; k++) max = Math.max(max, at((k * Math.PI) / RIM_STEPS));
  return { at, max: max * 1.02 };
}

/** One ribbon piece, closed, in ribbon units; `from`..`to` spans `along` of its ribbon's colour run. */
export interface RibbonPiece {
  pts: number[];
  front: boolean;
  ribbon: number;
  along: [number, number];
  from: [number, number];
  to: [number, number];
}

/**
 * The ribbons at one moment. `presence` draws them out and back in, `sweep` is how far the turn has
 * carried them (radians, signed), `cage` picks one working hoop (< 0.5) or a celebration's three.
 */
export function ribbonPieces(presence: number, seed: number, sweep: number, cage: number, rim?: Rim): RibbonPiece[] {
  const k = clamp(presence, 0, 1);
  const more = cage >= 0.5 ? 1 : 0;
  if (k <= 0.01) return [];
  const rolls: number[] = [];
  for (let i = 0; i < HOOPS; i++) rolls.push(HOOP_ROLL + (i * Math.PI) / HOOPS + (noise(seed, 450 + i) - 0.5) * HOOP_JITTER);
  const cageRing = rim ? Math.max(0, rim.at(rolls[0]!), rim.at(rolls[1]!), rim.at(rolls[2]!)) + RIM_MARGIN : RING;
  const dir = sweep < 0 ? -1 : 1;
  const since = Math.abs(sweep) / mix(SWEEP_RATE, more);
  const ret = 1 - clamp(k * 1.25, 0, 1);
  const pieces: RibbonPiece[] = [];
  for (let i = 0; i < (more ? HOOPS : 1); i++) {
    const roll = rolls[i]!;
    const tilt = HOOP_TILT + (noise(seed, 460 + i) - 0.5) * HOOP_TILT_JITTER;
    const ring = more ? cageRing : rim ? rim.at(roll) + RIM_MARGIN : RING;
    const lanes = i || more > 0 ? LANES : Math.round(mix(WORK_LANES, noise(seed, 47)));
    const flat = Math.sin(tilt);
    const depth = Math.cos(tilt);
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    for (let l = 0; l < lanes; l++) {
      const n = (m: number) => noise(seed, 500 + (i * LANES + l) * 11 + m);
      const order = more > 0 ? l * HOOPS + i : l;
      const at = order * mix(STAGGER, n(7));
      const life = since - at;
      if (life <= 0) continue;
      const before = since > 0 ? Math.abs(sweep) * (at / since) : 0;
      const r = ring + (l * LADDER * UNIT) / (lanes - 1) + mix([0, WIDEN], n(2)) * UNIT * life;
      const travel = (Math.abs(sweep) - before) * mix(FOLLOW, n(3)) + mix(DRIFT, n(4)) * life;
      const head = dir * (before + travel - START * n(5));
      const length = Math.min(mix(ARC, n(6)), travel) * (1 - ret * ret * (3 - 2 * ret));
      if (length <= 0.02) continue;
      const size = mix(sizeFor(lanes), n(8)) * (1 - more) + mix(SIZE_MANY, n(8)) * more;
      const nearHead = clamp(Math.cos(head) * depth, 0, 1);
      let full = size * BRUSH * UNIT * (FAR + (1 - FAR) * nearHead) * smooth(life / GROW_S) * (1 - 0.72 * ret * ret);
      const lamAt = (u: number) => head - dir * length * (1 - u);
      const along = (lam: number) => 1 - (head - lam) / (dir * length);
      const sliver = SLIVER / length;
      const ss: number[] = [];
      for (let j = 0; j <= SAMPLES; j++) ss.push(j / SAMPLES);
      const lo = Math.min(head, head - dir * length);
      const hi = Math.max(head, head - dir * length);
      for (let side = Math.ceil((lo - Math.PI / 2) / Math.PI); Math.PI / 2 + side * Math.PI < hi; side++) {
        const u = along(Math.PI / 2 + side * Math.PI);
        for (const d of [-sliver, 0, sliver]) if (u + d > 0 && u + d < 1) ss.push(u + d);
      }
      ss.sort((x, y) => x - y);
      const last = ss.length - 1;
      const near: boolean[] = [];
      const mx: number[] = [];
      const my: number[] = [];
      const nx: number[] = [];
      const ny: number[] = [];
      const halfs: number[] = [];
      const bend: number[] = [];
      for (const u of ss) {
        const lam = lamAt(u);
        near.push(Math.cos(lam + dir * 1e-6) > 0);
        const s = Math.sin(lam);
        const c = Math.cos(lam);
        const y = -c * flat;
        mx.push(r * (s * cr - y * sr));
        my.push(r * (s * sr + y * cr));
        const ex = s * flat;
        const ey = -c;
        const el = Math.hypot(ex, ey) || 1;
        nx.push((ex / el) * cr - (ey / el) * sr);
        ny.push((ex / el) * sr + (ey / el) * cr);
        halfs.push(0.5 + 0.5 * u);
        bend.push((r * (c * c + flat * flat * s * s) ** 1.5) / flat);
      }
      let onScreen = 0;
      for (let j = 1; j <= last; j++) onScreen += Math.hypot(mx[j]! - mx[j - 1]!, my[j]! - my[j - 1]!);
      full = Math.min(full, 0.34 * onScreen);
      for (let j = 0; j <= last; j++) halfs[j] = Math.min(halfs[j]! * (full / 2), 0.9 * bend[j]!);
      const cap = (pts: number[], j: number, ahead: boolean): void => {
        const o = ahead ? j - 1 : j + 1;
        let tx = ahead ? mx[j]! - mx[o]! : mx[o]! - mx[j]!;
        let ty = ahead ? my[j]! - my[o]! : my[o]! - my[j]!;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        const h = halfs[j]!;
        for (let c = 1; c < CAP; c++) {
          const t = (Math.PI * c) / CAP;
          const e = ahead ? Math.cos(t) : -Math.cos(t);
          const g = ahead ? Math.sin(t) : -Math.sin(t);
          pts.push(mx[j]! + (nx[j]! * e + tx * g) * h, my[j]! + (ny[j]! * e + ty * g) * h);
        }
      };
      let from = 0;
      for (let j = 1; j <= last; j++) {
        const turns = j < last && near[j] !== near[from];
        if (j < last && !turns && j - from < STRETCH) continue;
        const behind = !near[from];
        const end = j < last && (!turns || behind) ? j + 1 : j;
        const start = from > 0 && behind && near[from - 1] ? from - 1 : from;
        const pts: number[] = [];
        for (let q = start; q <= end; q++) pts.push(mx[q]! + nx[q]! * halfs[q]!, my[q]! + ny[q]! * halfs[q]!);
        if (end === last) cap(pts, last, true);
        for (let q = end; q >= start; q--) pts.push(mx[q]! - nx[q]! * halfs[q]!, my[q]! - ny[q]! * halfs[q]!);
        if (start === 0) cap(pts, 0, false);
        pieces.push({
          pts,
          front: near[from]!,
          ribbon: i * LANES + l,
          along: [ss[from]!, ss[j]!],
          from: [mx[from]!, my[from]!],
          to: [mx[j]!, my[j]!],
        });
        from = j;
      }
    }
  }
  return pieces;
}

const DONE_DRAW_IN = 0.5;

/** A working turn `into` seconds in, played over `span` seconds: the ribbons' presence and sweep. */
export function workTurn(into: number, span = WORK_TURN): { presence: number; sweep: number } {
  const t = (into * WORK_TURN) / span;
  if (t <= 0 || t >= WORK_TURN) return { presence: 0, sweep: 0 };
  return {
    presence: clamp(t / 0.16, 0, 1) * clamp((WORK_TURN - t) / 0.5, 0, 1),
    sweep: workAngle(WORK_AT + t),
  };
}

/** A celebration `since` seconds in, played over `span` seconds: the cage's presence and sweep. */
export function cageTurn(since: number, span = DONE_TURN): { presence: number; sweep: number } {
  const t = (since * DONE_TURN) / span;
  if (t <= 0 || t >= DONE_TURN) return { presence: 0, sweep: 0 };
  return {
    presence: clamp(t / 0.1, 0, 1) * clamp((DONE_TURN - t) / DONE_DRAW_IN, 0, 1),
    sweep: Math.max(0, celebration(t)),
  };
}

const RAMP_LIGHT = 0.09;
const RAMP_HUE = 14;
const RAMP_RANGE = [0.36, 0.9] as const;
const WARM = 100;
const GRADIENT_LIGHT = 0.13;
const GRADIENT_HUE = 25;
const GRADIENT_STOPS = 5;
const NEUTRAL = 0.04;
const NEUTRAL_TINT = 0.025;
const BAND_SHADES = [
  [0, 1, 2],
  [2, 0, 3],
  [1, 2, 0],
] as const;

type Rgb = [number, number, number];

function turnToward(h: number, to: number, by: number): number {
  const d = ((to - h + 540) % 360) - 180;
  return (h + Math.sign(d) * Math.min(Math.abs(d), by) + 360) % 360;
}

const rgbOf = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const hexOf = ([r, g, b]: Rgb): string =>
  "#" + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");

/** One colour run per ribbon (by `RibbonPiece.ribbon`), tail to head, in sRGB: steps along the body's own ramp. */
export function ribbonPalette(head: string, seed: number): Rgb[][] {
  const body = fromHex(head);
  const hue = ((body.h % 360) + 360) % 360;
  const neutral = body.c < NEUTRAL;
  const base = neutral ? (130 + noise(seed, 500) * 310) % 360 : hue;
  const c = neutral ? NEUTRAL_TINT : Math.max(body.c, 0.17);
  const from = clamp(body.l, RAMP_RANGE[0], RAMP_RANGE[1]);
  const steps: number[] = [];
  for (let k = 1; steps.length < 5 && k < 10; k++) {
    for (const step of [k, -k]) {
      const l = from + step * RAMP_LIGHT;
      if (steps.length < 5 && l >= RAMP_RANGE[0] - 1e-9 && l <= RAMP_RANGE[1] + 1e-9) steps.push(step);
    }
  }
  while (steps.length < 5) steps.push(steps[steps.length - 1] ?? 1);
  const shades = steps.map((step) => {
    const l = from + step * RAMP_LIGHT;
    const h = turnToward(base, step > 0 ? WARM : WARM + 180, RAMP_HUE * Math.abs(step));
    const away = step > 0 ? 1 : -1;
    const run: Rgb[] = [];
    for (let n = 0; n < GRADIENT_STOPS; n++) {
      const t = n / (GRADIENT_STOPS - 1);
      const towards = turnToward(h, away > 0 ? WARM : WARM + 180, GRADIENT_HUE * t);
      run.push(rgbOf(toHex({ l: clamp(l + away * GRADIENT_LIGHT * t, 0.26, 0.9), c, h: towards })));
    }
    return { step, run };
  });
  return BAND_SHADES.flatMap((pick) =>
    pick
      .map((n) => shades[n]!)
      .sort((x, y) => y.step - x.step)
      .map(({ run }) => run),
  );
}

/** The colour `t` (0..1) of the way along a run. */
export function runAt(run: Rgb[], t: number): string {
  const x = clamp(t, 0, 1) * (run.length - 1);
  const n = Math.min(Math.floor(x), run.length - 2);
  const a = run[n]!;
  const b = run[n + 1]!;
  const u = x - n;
  return hexOf([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]);
}
