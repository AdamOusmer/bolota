// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Ported from open-bot-avatar (c) 2026 Dominik Scholz, MIT. See LICENSE.

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

/** One ribbon piece, closed, in ribbon units; `from`..`to` spans `along` of its ribbon's colour run. Pooled: valid until the next call. */
export interface RibbonPiece {
  pts: number[];
  front: boolean;
  ribbon: number;
  along: [number, number];
  from: [number, number];
  to: [number, number];
}

const MAX_SAMPLES = SAMPLES + 16;
const SS = new Float64Array(MAX_SAMPLES);
const MX = new Float64Array(MAX_SAMPLES);
const MY = new Float64Array(MAX_SAMPLES);
const NX = new Float64Array(MAX_SAMPLES);
const NY = new Float64Array(MAX_SAMPLES);
const HALF = new Float64Array(MAX_SAMPLES);
const NEAR = new Uint8Array(MAX_SAMPLES);
const ROLLS = [0, 0, 0];
const pool: RibbonPiece[] = [];
const out: RibbonPiece[] = [];

function piece(): RibbonPiece {
  const p = pool[out.length] ?? (pool[out.length] = { pts: [], front: false, ribbon: 0, along: [0, 0], from: [0, 0], to: [0, 0] });
  p.pts.length = 0;
  out.push(p);
  return p;
}

/** Inserts `u` into the sorted first `n` samples; the new count. */
function insert(n: number, u: number): number {
  let i = n;
  while (i > 0 && SS[i - 1]! > u) {
    SS[i] = SS[i - 1]!;
    i--;
  }
  SS[i] = u;
  return n + 1;
}

function cap(pts: number[], j: number, ahead: boolean): void {
  const o = ahead ? j - 1 : j + 1;
  let tx = ahead ? MX[j]! - MX[o]! : MX[o]! - MX[j]!;
  let ty = ahead ? MY[j]! - MY[o]! : MY[o]! - MY[j]!;
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl;
  ty /= tl;
  const h = HALF[j]!;
  for (let c = 1; c < CAP; c++) {
    const t = (Math.PI * c) / CAP;
    const e = ahead ? Math.cos(t) : -Math.cos(t);
    const g = ahead ? Math.sin(t) : -Math.sin(t);
    pts.push(MX[j]! + (NX[j]! * e + tx * g) * h, MY[j]! + (NY[j]! * e + ty * g) * h);
  }
}

/** Cuts samples `0..last` of one ribbon into pieces, one per run on one side of the body, at most `STRETCH` long. */
function cut(last: number, ribbon: number): void {
  let from = 0;
  for (let j = 1; j <= last; j++) {
    const turns = j < last && NEAR[j] !== NEAR[from];
    if (j < last && !turns && j - from < STRETCH) continue;
    const behind = !NEAR[from];
    const end = j < last && (!turns || behind) ? j + 1 : j;
    const start = from > 0 && behind && NEAR[from - 1] ? from - 1 : from;
    const p = piece();
    const pts = p.pts;
    for (let q = start; q <= end; q++) pts.push(MX[q]! + NX[q]! * HALF[q]!, MY[q]! + NY[q]! * HALF[q]!);
    if (end === last) cap(pts, last, true);
    for (let q = end; q >= start; q--) pts.push(MX[q]! - NX[q]! * HALF[q]!, MY[q]! - NY[q]! * HALF[q]!);
    if (start === 0) cap(pts, 0, false);
    p.front = !!NEAR[from];
    p.ribbon = ribbon;
    p.along[0] = SS[from]!;
    p.along[1] = SS[j]!;
    p.from[0] = MX[from]!;
    p.from[1] = MY[from]!;
    p.to[0] = MX[j]!;
    p.to[1] = MY[j]!;
    from = j;
  }
}

/**
 * The ribbons at one moment. `presence` draws them out and back in, `sweep` is how far the turn has
 * carried them (radians, signed), `cage` picks one working hoop (< 0.5) or a celebration's three.
 * The pieces are pooled and reused by the next call.
 */
export function ribbonPieces(presence: number, seed: number, sweep: number, cage: number, rim?: Rim): readonly RibbonPiece[] {
  out.length = 0;
  const k = clamp(presence, 0, 1);
  const more = cage >= 0.5 ? 1 : 0;
  if (k <= 0.01) return out;
  for (let i = 0; i < HOOPS; i++) ROLLS[i] = HOOP_ROLL + (i * Math.PI) / HOOPS + (noise(seed, 450 + i) - 0.5) * HOOP_JITTER;
  const cageRing = rim ? Math.max(0, rim.at(ROLLS[0]!), rim.at(ROLLS[1]!), rim.at(ROLLS[2]!)) + RIM_MARGIN : RING;
  const dir = sweep < 0 ? -1 : 1;
  const since = Math.abs(sweep) / mix(SWEEP_RATE, more);
  const ret = 1 - clamp(k * 1.25, 0, 1);
  for (let i = 0; i < (more ? HOOPS : 1); i++) {
    const roll = ROLLS[i]!;
    const tilt = HOOP_TILT + (noise(seed, 460 + i) - 0.5) * HOOP_TILT_JITTER;
    const ring = more ? cageRing : rim ? rim.at(roll) + RIM_MARGIN : RING;
    const lanes = i || more > 0 ? LANES : Math.round(mix(WORK_LANES, noise(seed, 47)));
    const flat = Math.sin(tilt);
    const depth = Math.cos(tilt);
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    for (let l = 0; l < lanes; l++) {
      const base = 500 + (i * LANES + l) * 11;
      const at = (more > 0 ? l * HOOPS + i : l) * mix(STAGGER, noise(seed, base + 7));
      const life = since - at;
      if (life <= 0) continue;
      const before = since > 0 ? Math.abs(sweep) * (at / since) : 0;
      const r = ring + (l * LADDER * UNIT) / (lanes - 1) + mix([0, WIDEN], noise(seed, base + 2)) * UNIT * life;
      const travel = (Math.abs(sweep) - before) * mix(FOLLOW, noise(seed, base + 3)) + mix(DRIFT, noise(seed, base + 4)) * life;
      const head = dir * (before + travel - START * noise(seed, base + 5));
      const length = Math.min(mix(ARC, noise(seed, base + 6)), travel) * (1 - ret * ret * (3 - 2 * ret));
      if (length <= 0.02) continue;
      const size = mix(sizeFor(lanes), noise(seed, base + 8)) * (1 - more) + mix(SIZE_MANY, noise(seed, base + 8)) * more;
      const nearHead = clamp(Math.cos(head) * depth, 0, 1);
      let full = size * BRUSH * UNIT * (FAR + (1 - FAR) * nearHead) * smooth(life / GROW_S) * (1 - 0.72 * ret * ret);
      const span = dir * length;
      let n = 0;
      for (let j = 0; j <= SAMPLES; j++) SS[n++] = j / SAMPLES;
      const sliver = SLIVER / length;
      const lo = Math.min(head, head - span);
      const hi = Math.max(head, head - span);
      for (let side = Math.ceil((lo - Math.PI / 2) / Math.PI); Math.PI / 2 + side * Math.PI < hi; side++) {
        const u = 1 - (head - (Math.PI / 2 + side * Math.PI)) / span;
        for (const d of [-sliver, 0, sliver]) if (u + d > 0 && u + d < 1 && n < MAX_SAMPLES) n = insert(n, u + d);
      }
      const last = n - 1;
      let onScreen = 0;
      for (let j = 0; j <= last; j++) {
        const u = SS[j]!;
        const lam = head - span * (1 - u);
        NEAR[j] = Math.cos(lam + dir * 1e-6) > 0 ? 1 : 0;
        const s = Math.sin(lam);
        const c = Math.cos(lam);
        const y = -c * flat;
        MX[j] = r * (s * cr - y * sr);
        MY[j] = r * (s * sr + y * cr);
        const ex = s * flat;
        const el = Math.hypot(ex, c) || 1;
        NX[j] = (ex / el) * cr + (c / el) * sr;
        NY[j] = (ex / el) * sr - (c / el) * cr;
        if (j) onScreen += Math.hypot(MX[j]! - MX[j - 1]!, MY[j]! - MY[j - 1]!);
      }
      full = Math.min(full, 0.34 * onScreen);
      for (let j = 0; j <= last; j++) {
        const u = SS[j]!;
        const lam = head - span * (1 - u);
        const s = Math.sin(lam);
        const c = Math.cos(lam);
        HALF[j] = Math.min((0.5 + 0.5 * u) * (full / 2), (0.9 * (r * (c * c + flat * flat * s * s) ** 1.5)) / flat);
      }
      cut(last, i * LANES + l);
    }
  }
  return out;
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

type Rgb = [number, number, number];

const rgbOf = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const hexOf = ([r, g, b]: Rgb): string =>
  "#" + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");

/** A colour run, tail to head, through `stops`. */
export const runOf = (stops: string[]): Rgb[] => stops.map(rgbOf);

/** The colour `t` (0..1) of the way along a run. */
export function runAt(run: Rgb[], t: number): string {
  const x = clamp(t, 0, 1) * (run.length - 1);
  const n = Math.min(Math.floor(x), run.length - 2);
  const a = run[n]!;
  const b = run[n + 1]!;
  const u = x - n;
  return hexOf([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]);
}
