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
 * byte for byte, on whatever it currently holds. */
export function setupDeterminism() {
  const slot1 = document.querySelector<HTMLElement>("[data-det-slot='1']");
  const slot2 = document.querySelector<HTMLElement>("[data-det-slot='2']");
  const slot3 = document.querySelector<HTMLElement>("[data-det-slot='3']");
  const status = document.querySelector<HTMLElement>("[data-det-status]");
  const normStatus = document.querySelector<HTMLElement>("[data-det-norm]");
  if (!slot1 || !slot2 || !slot3 || !status) return;

  function render(rawSeed: string | null) {
    const seed = rawSeed ?? DEFAULT_SEED;
    const s1 = bolota(seed, { size: 72 });
    const s2 = bolota(seed, { size: 72 });
    slot1!.innerHTML = s1;
    slot2!.innerHTML = s2;
    slot3!.innerHTML = partsSvg(seed, 72);

    const equal = s1 === s2;
    status!.textContent = equal ? "deterministic: bytes match" : "mismatch detected";
    status!.classList.toggle("is-ok", equal);
    status!.classList.toggle("is-bad", !equal);

    if (normStatus) {
      const norm = normalizeSeed(seed);
      const face = bolota(seed, { size: 24 });
      const normFace = bolota(norm, { size: 24 });
      const idempotent = face === normFace;
      normStatus!.textContent = `normalizeSeed("${seed}") -> "${norm}": ${idempotent ? "idempotent" : "mismatch"}`;
      normStatus!.classList.toggle("is-ok", idempotent);
      normStatus!.classList.toggle("is-bad", !idempotent);
    }
  }

  render(getSeed());
  onSeedChange(render);
}
