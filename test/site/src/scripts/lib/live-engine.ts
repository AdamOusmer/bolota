import { mountEngine, type EngineHandle } from "bolota/engine";
import { onVisible } from "./visibility";

const SVG_NS = "http://www.w3.org/2000/svg";

function makeSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg") as unknown as SVGSVGElement;
  svg.setAttribute("viewBox", "0 0 100 100");
  return svg;
}

export interface LiveTileSpec {
  /** Continuously loops this state (states grid, orbit/comet in sequences). */
  loopState?: string;
  /**
   * A one-shot state/sequence that finishes on its own, engine.ts's own
   * `tick()` returns to "idle" once its `duration` elapses. `run` fires it
   * again on `periodMs`, so it reads as "alive forever" without a replay
   * button; `staggerMs` offsets each tile's first fire so a grid of these
   * doesn't all burst in unison.
   */
  cycle?: { run: (handle: EngineHandle) => void; periodMs: number; staggerMs?: number };
}

/**
 * Mounts one bloub-driven avatar into `container`, lazily (on first scroll
 * into view) and visibility-gated thereafter via `handle.stop()`/replay on
 * `IntersectionObserver`, per this file's header. No mount happens, and no
 * timers run, until the tile is actually on screen.
 */
export function mountLiveTile(container: HTMLElement, seed: string, spec: LiveTileSpec) {
  const svg = makeSvg();
  container.appendChild(svg);

  let handle: EngineHandle | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let currentSeed = seed;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function drive() {
    if (!handle) return;
    if (spec.loopState) {
      handle.play(spec.loopState, { loop: true });
      return;
    }
    if (spec.cycle) {
      const { run, periodMs, staggerMs = 0 } = spec.cycle;
      const fire = () => {
        if (!handle) return;
        run(handle);
        timer = setTimeout(fire, periodMs);
      };
      timer = setTimeout(fire, staggerMs);
    }
  }

  function enter() {
    if (!handle) handle = mountEngine(svg, currentSeed);
    else handle.play(spec.loopState ?? "idle", { loop: !!spec.loopState });
    drive();
  }

  function exit() {
    clearTimer();
    handle?.stop();
  }

  const disconnect = onVisible(svg, enter, exit);

  return {
    /** Re-seeds this tile (global seed control), destroys and remounts. */
    setSeed(next: string) {
      if (next === currentSeed) return;
      currentSeed = next;
      clearTimer();
      handle?.destroy();
      handle = null;
      // Only remount immediately if currently on screen; onVisible's next
      // `enter()` will pick up `currentSeed` otherwise.
      if (svg.getBoundingClientRect().top < window.innerHeight) {
        handle = mountEngine(svg, currentSeed);
        drive();
      }
    },
    destroy() {
      disconnect();
      clearTimer();
      handle?.destroy();
      handle = null;
    },
  };
}
