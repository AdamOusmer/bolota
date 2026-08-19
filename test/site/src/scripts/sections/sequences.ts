import type { EngineHandle } from "bolota/engine";
import { runSequence, type SequenceName } from "bolota/sequences";
import { ensureEngine } from "../lib/live-engine";
import { onSeedChange, getSeed } from "../lib/seed-store";
import { DEFAULT_SEED } from "../lib/curated-seeds";
import { humanizeId } from "../lib/humanize";
import { onVisible } from "../lib/visibility";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/**
 * The theatrical stage's beat sheet (spec §5): every signature move,
 * separated by an idle beat, forever. Each move's `ms` is its own
 * `duration` in `bloub/states.ts` (entrance -> `swirl` 1.3s, burst 2.6s,
 * orbit 3.4s, comet 2.4s) since `engine.ts`'s `tick()` already auto-returns
 * to idle once that elapses, nothing here needs to poll the engine for
 * "done"; `BEAT_MS` is the idle pause the spec asks for between moves.
 */
const BEAT_MS = 900;
const MOVE_MS: Record<SequenceName, number> = {
  entrance: 1300,
  burst: 2600,
  orbit: 3400,
  comet: 2400,
};
const ORDER: SequenceName[] = ["entrance", "burst", "orbit", "comet"];

type Beat = { label: string; ms: number; run: (handle: EngineHandle) => void };

function buildBeats(): Beat[] {
  const beats: Beat[] = [];
  for (const name of ORDER) {
    beats.push({
      label: humanizeId(name),
      ms: MOVE_MS[name],
      run: (handle) => runSequence(handle, name),
    });
    beats.push({
      label: "Idle",
      ms: BEAT_MS,
      run: (handle) => handle.play("idle", { loop: true }),
    });
  }
  return beats;
}

export function setupSequences() {
  const host = document.querySelector<HTMLElement>("[data-seq-avatar]");
  const label = document.querySelector<HTMLElement>("[data-seq-label]");
  if (!host || !label) return;

  const SVG_NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(SVG_NS, "svg") as unknown as SVGSVGElement;
  svg.setAttribute("viewBox", "0 0 100 100");
  host.appendChild(svg);

  const beats = buildBeats();
  let handle: EngineHandle | null = null;
  let seed = getSeed() ?? DEFAULT_SEED;
  let step = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // See hero.ts/live-engine.ts's own copies of this pattern.
  let gen = 0;
  // Whether the stage is currently on-screen, tracked separately from
  // `timer` because `advance()` can no-op (handle still null, engine chunk
  // not resolved yet) even while the tile is visible; `mount()` uses this
  // to know it should kick `advance()` off itself once the engine lands.
  let visible = false;

  function setLabel(text: string) {
    if (label!.textContent === text) return;
    label!.classList.add("is-fading");
    setTimeout(() => {
      label!.textContent = text;
      label!.classList.remove("is-fading");
    }, 220);
  }

  function advance() {
    if (!handle) return;
    const beat = beats[step]!;
    beat.run(handle);
    setLabel(beat.label);
    step = (step + 1) % beats.length;
    timer = setTimeout(advance, beat.ms);
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function mount(nextSeed: string) {
    const myGen = ++gen;
    seed = nextSeed;
    clearTimer();
    const { mountEngine } = await ensureEngine();
    if (myGen !== gen) return; // a newer mount() call already won the race
    handle?.destroy();
    handle = mountEngine(svg, seed);
    step = 0;
    setLabel("Idle");
    if (visible && !reduceMotion.matches && !timer) advance();
  }

  mount(seed);
  onSeedChange((s) => mount(s ?? DEFAULT_SEED));

  onVisible(
    svg,
    () => {
      visible = true;
      if (reduceMotion.matches) return;
      if (!timer) advance();
    },
    () => {
      visible = false;
      clearTimer();
      handle?.stop();
    },
  );
}
