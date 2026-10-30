// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

/**
 * bloub's ambient blink: a fixed schedule of 0.18 s blinks every 1.9 to 4.6 s,
 * with an occasional double, the same for every bolota and keyed to the
 * engine clock, as `bloub/face.ts` draws it. Drawn on first use, up to the
 * same 900 s horizon.
 */

const SEED = 0x5eed;
const FIRST = 1.4;
const HORIZON = 900;
const DURATION = 0.18;

let schedule: number[] | null = null;

/** mulberry32, as `bloub/math.ts`'s `createRng`. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blinks(): number[] {
  if (schedule) return schedule;
  const next = rng(SEED);
  const out: number[] = [];
  for (let t = FIRST; t < HORIZON; ) {
    out.push(t);
    t += 1.9 + next() * 2.7;
    if (next() < 0.18) {
      out.push(t);
      t += 0.24;
    }
  }
  return (schedule = out);
}

/** How open the lids are at engine time `t`, 0–1: closing fast, reopening a little slower. */
export function ambientLid(t: number): number {
  const s = blinks();
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (s[m]! <= t) lo = m + 1;
    else hi = m;
  }
  if (lo === 0) return 1;
  const k = (t - s[lo - 1]!) / DURATION;
  if (k > 1) return 1;
  return k < 0.45 ? 1 - k / 0.45 : (k - 0.45) / 0.55;
}
