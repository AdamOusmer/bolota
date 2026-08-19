import { engineStates } from "@luzir/bolota/engine";
import { onSeedChange, getSeed } from "../lib/seed-store";
import { curatedSeedAt } from "../lib/curated-seeds";
import { humanizeId } from "../lib/humanize";
import { mountLiveTile } from "../lib/live-engine";

/** Every state the engine can play, one live looping tile each, labels come
 * straight from `engineStates()` (not a hand-copied list), so a state rename
 * on the engine side (e.g. `sleep` → `snooze`) shows up here with no site
 * change needed. Seeded: all 15 tiles share the visitor's identity. Unseeded:
 * they cycle across the curated shape-family list instead, so the grid
 * itself demonstrates bolota's silhouette variety. */
export function setupStates() {
  const grid = document.querySelector<HTMLElement>("[data-states-grid]");
  if (!grid) return;

  const states = engineStates();
  const tiles = states.map((id, i) => {
    const cell = document.createElement("div");
    cell.className = "tile";
    cell.innerHTML = `<span class="tile__spotlight" aria-hidden="true"></span><div class="tile__avatar" style="--avatar-size:56px"></div><div class="tile__label">${humanizeId(id)}</div>`;
    grid.appendChild(cell);
    attachSpotlight(cell);
    const host = cell.querySelector<HTMLElement>(".tile__avatar")!;
    const seed = getSeed() ?? curatedSeedAt(i);
    return mountLiveTile(host, seed, { loopState: id });
  });

  onSeedChange((seed) => {
    tiles.forEach((tile, i) => tile.setSeed(seed ?? curatedSeedAt(i)));
  });
}

function attachSpotlight(cell: HTMLElement) {
  cell.addEventListener("pointermove", (e) => {
    const rect = cell.getBoundingClientRect();
    cell.style.setProperty("--mx", `${((e.clientX - rect.left) / rect.width) * 100}%`);
    cell.style.setProperty("--my", `${((e.clientY - rect.top) / rect.height) * 100}%`);
  });
}
