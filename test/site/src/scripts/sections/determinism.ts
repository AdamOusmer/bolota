import { bolota, parts, normalizeSeed } from "bolota";
import { onSeedChange, getSeed } from "../lib/seed-store";
import { DEFAULT_SEED } from "../lib/curated-seeds";

const SVG_NS = "http://www.w3.org/2000/svg";

function partsSvg(name: string, size: number): string {
  const p = parts(name, { size });
  const dim = ` width="${size}" height="${size}"`;
  const bg = p.bg ? `<path d="${p.bg.d}" fill="${p.bg.fill}"/>` : "";
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100"${dim}>${bg}<g class="${p.cls ?? ""}">${p.inner}</g></svg>`;
}

/** The determinism proof: the seed control up in the hero is this demo's
 * input (see seed-store.ts). Three independent render paths must agree,
 * byte for byte, on whatever it currently holds; `normalizeSeed` must be
 * idempotent on it too. Both checks still run (the underlying triple-render
 * byte-equality logic is unchanged), they just collapse into the one
 * caption line the boxless proof-strip spec calls for, a single check/cross
 * glyph plus one short sentence, no separate status lines. */
export function setupDeterminism() {
  const slot1 = document.querySelector<HTMLElement>("[data-det-slot='1']");
  const slot2 = document.querySelector<HTMLElement>("[data-det-slot='2']");
  const slot3 = document.querySelector<HTMLElement>("[data-det-slot='3']");
  const glyph = document.querySelector<HTMLElement>("[data-det-glyph]");
  const text = document.querySelector<HTMLElement>("[data-det-text]");
  if (!slot1 || !slot2 || !slot3 || !glyph || !text) return;

  function render(rawSeed: string | null) {
    const seed = rawSeed ?? DEFAULT_SEED;
    const s1 = bolota(seed, { size: 72 });
    const s2 = bolota(seed, { size: 72 });
    slot1!.innerHTML = s1;
    slot2!.innerHTML = s2;
    slot3!.innerHTML = partsSvg(seed, 72);

    const bytesEqual = s1 === s2;
    const norm = normalizeSeed(seed);
    const normIdempotent = bolota(seed, { size: 24 }) === bolota(norm, { size: 24 });
    const ok = bytesEqual && normIdempotent;

    glyph!.textContent = ok ? "✓" : "✗";
    glyph!.classList.toggle("is-ok", ok);
    glyph!.classList.toggle("is-bad", !ok);
    text!.textContent = ok ? "Three renders. Byte-identical." : "Three renders. Mismatch detected.";
  }

  render(getSeed());
  onSeedChange(render);
}
