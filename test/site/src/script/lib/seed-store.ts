// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

/**
 * The one piece of shared state on the page: the seed the visitor typed.
 *
 * Loaded once by src/script/site.ts, imported by every section module ,
 * Vite/Rollup resolve all of those imports to the same chunk, and the
 * browser's native ESM module cache dedupes by that chunk's URL, so this is
 * a true singleton across the whole client bundle, no framework required.
 *
 * Persisted in the URL hash (`#seed=...`) so a personalized page is
 * shareable: paste the link, the recipient's bolota is the same as yours.
 */

export type SeedListener = (seed: string | null) => void;

const HASH_KEY = "seed";
const listeners = new Set<SeedListener>();

function readHash(): string | null {
  if (typeof location === "undefined") return null;
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const v = params.get(HASH_KEY);
  return v && v.trim() ? v : null;
}

function writeHash(seed: string | null) {
  if (typeof location === "undefined" || typeof history === "undefined") return;
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (seed) params.set(HASH_KEY, seed);
  else params.delete(HASH_KEY);
  const next = params.toString();
  const url = next ? `${location.pathname}${location.search}#${next}` : `${location.pathname}${location.search}`;
  history.replaceState(null, "", url);
}

let current: string | null = readHash();

/** The current seed, or null when the page is in "curated variety" mode. */
export function getSeed(): string | null {
  return current;
}

/** Sets (or, given null/empty, clears) the shared seed and notifies every
 * subscriber. Also updates the URL hash so the page stays shareable. */
export function setSeed(seed: string | null) {
  const trimmed = seed && seed.trim() ? seed.trim() : null;
  if (trimmed === current) return;
  current = trimmed;
  writeHash(current);
  for (const l of listeners) l(current);
}

/** Subscribes to seed changes. Returns an unsubscribe function. */
export function onSeedChange(fn: SeedListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    const next = readHash();
    if (next !== current) {
      current = next;
      for (const l of listeners) l(current);
    }
  });
}
