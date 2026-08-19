import { mountEngine, type EngineHandle } from "@luzir/bolota/engine";
import { runSequence, type SequenceName } from "@luzir/bolota/sequences";
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

  function mount(nextSeed: string) {
    seed = nextSeed;
    clearTimer();
    handle?.destroy();
    handle = mountEngine(svg, seed);
    step = 0;
    setLabel("Idle");
  }

  mount(seed);
  onSeedChange((s) => mount(s ?? DEFAULT_SEED));

  onVisible(
    svg,
    () => {
      if (reduceMotion.matches) return;
      if (!timer) advance();
    },
    () => {
      clearTimer();
      handle?.stop();
    },
  );
}
