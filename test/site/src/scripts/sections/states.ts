import { engineStates } from "@luzir/bolota/engine";
import { onSeedChange, getSeed } from "../lib/seed-store";
import { curatedSeedAt } from "../lib/curated-seeds";
import { humanizeId } from "../lib/humanize";
import { mountLiveTile } from "../lib/live-engine";

/** Every state the engine can play, one live looping specimen each, labels
 * come straight from `engineStates()` (not a hand-copied list), so a state
 * rename on the engine side (e.g. `sleep` → `snooze`) shows up here with no
 * site change needed. Boxless per the redesign (spec §4): just a blob and a
 * small-caps name, no tile chrome. Seeded: every specimen shares the
 * visitor's identity. Unseeded: they cycle across the curated shape-family
 * list instead, so the grid itself demonstrates bolota's silhouette variety.
 */
export function setupStates() {
  const grid = document.querySelector<HTMLElement>("[data-states-grid]");
  if (!grid) return;

  const states = engineStates();
  const tiles = states.map((id, i) => {
    const cell = document.createElement("div");
    cell.className = "specimen";
    cell.innerHTML = `<div class="specimen__avatar"></div><div class="specimen__label">${humanizeId(id)}</div>`;
    grid.appendChild(cell);
    const host = cell.querySelector<HTMLElement>(".specimen__avatar")!;
    const seed = getSeed() ?? curatedSeedAt(i);
    return mountLiveTile(host, seed, { loopState: id });
  });

  onSeedChange((seed) => {
    tiles.forEach((tile, i) => tile.setSeed(seed ?? curatedSeedAt(i)));
  });
}
