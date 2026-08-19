import { mountEngine, type EngineHandle } from "@luzir/bolota/engine";
import { runSequence, type SequenceName } from "@luzir/bolota/sequences";
import { onSeedChange, getSeed } from "../lib/seed-store";
import { curatedSeedAt, DEFAULT_SEED } from "../lib/curated-seeds";
import { humanizeId } from "../lib/humanize";
import { mountLiveTile } from "../lib/live-engine";
import { onVisible } from "../lib/visibility";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/**
 * `runSequence` always plays a one-shot pass (see src/sequences.ts, even
 * `orbit`, which can loop, is run with `loop: false` here), so every
 * signature sequence auto-returns to idle on its own once its `duration`
 * elapses (engine.ts's `tick()`). `periodMs` below is that duration plus a
 * settle window, and each tile's `staggerMs` desyncs its first fire so four
 * tiles don't burst in unison, the whole grid just looks alive.
 */
const SIGNATURES: { id: SequenceName; periodMs: number }[] = [
  { id: "entrance", periodMs: 1300 + 2400 },
  { id: "burst", periodMs: 2600 + 2600 },
  { id: "orbit", periodMs: 3400 + 2200 },
  { id: "comet", periodMs: 2400 + 2400 },
];

export function setupSequences() {
  setupSignatureGrid();
  setupTimeline();
}

function setupSignatureGrid() {
  const grid = document.querySelector<HTMLElement>("[data-sequences-grid]");
  if (!grid) return;

  const tiles = SIGNATURES.map(({ id, periodMs }, i) => {
    const cell = document.createElement("div");
    cell.className = "tile";
    cell.innerHTML = `<span class="tile__spotlight" aria-hidden="true"></span><div class="tile__avatar" style="--avatar-size:64px"></div><div class="tile__label">${humanizeId(id)}</div>`;
    grid.appendChild(cell);
    const host = cell.querySelector<HTMLElement>(".tile__avatar")!;
    const seed = getSeed() ?? curatedSeedAt(i + 4);
    return mountLiveTile(host, seed, {
      cycle: { run: (handle) => runSequence(handle, id), periodMs, staggerMs: i * 650 },
    });
  });

  onSeedChange((seed) => {
    tiles.forEach((tile, i) => tile.setSeed(seed ?? curatedSeedAt(i + 4)));
  });
}

/** The composed narrative demo: one avatar, an auto-advancing beat list
 * built from whatever states `mountEngine` actually exposes, no hardcoded
 * "sleep" vs "snooze" id, so a rename on the engine side just shows up. */
function setupTimeline() {
  const host = document.querySelector<HTMLElement>("[data-timeline-avatar]");
  const label = document.querySelector<HTMLElement>("[data-timeline-label]");
  const track = document.querySelector<HTMLElement>("[data-timeline-track]");
  if (!host || !label) return;

  const SVG_NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(SVG_NS, "svg") as unknown as SVGSVGElement;
  svg.setAttribute("viewBox", "0 0 100 100");
  host.appendChild(svg);

  let handle: EngineHandle | null = null;
  let seed = getSeed() ?? DEFAULT_SEED;
  const STEP_MS = 3000;
  let step = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let beats: string[] = [];

  function buildBeats() {
    const preferred = ["thinking", "alert", "sleep", "snooze", "exclaim", "burst", "comet"];
    const present = preferred.filter((id) => handle!.states.includes(id));
    beats = present.flatMap((id) => ["idle", id]).concat("idle");
  }

  function render() {
    const id = beats[step]!;
    handle!.play(id, { loop: id === "idle" });
    label!.textContent = humanizeId(id);
    if (track) track.style.setProperty("--progress", `${((step + 1) / beats.length) * 100}%`);
  }

  function advance() {
    step = (step + 1) % beats.length;
    render();
  }

  function mount(nextSeed: string) {
    seed = nextSeed;
    handle?.destroy();
    handle = mountEngine(svg, seed);
    buildBeats();
    step = 0;
    render();
  }

  mount(seed);
  onSeedChange((s) => mount(s ?? DEFAULT_SEED));

  onVisible(
    svg,
    () => {
      if (reduceMotion.matches) return;
      if (!timer) timer = setInterval(advance, STEP_MS);
    },
    () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      handle?.stop();
    },
  );
}
