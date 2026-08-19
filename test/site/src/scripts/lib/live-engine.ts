import type { EngineHandle } from "@luzir/bolota/engine";
import { onVisible } from "./visibility";

const SVG_NS = "http://www.w3.org/2000/svg";

let enginePromise: Promise<typeof import("@luzir/bolota/engine")> | null = null;

/**
 * The one shared `bolota/engine` loader for every section below the hero:
 * this file's own `mountLiveTile` (states.ts), and expressions.ts/
 * sequences.ts, all `await ensureEngine()` instead of statically importing
 * `bolota/engine`. hero.ts keeps its own local copy of this exact pattern
 * rather than importing this one: it predates this extraction, already
 * has its own generation counter, and pulling in a cross-file dependency
 * there wasn't worth it for four identical lines. Everywhere else, this is
 * the single call site, so `bun run build`'s chunk graph shows one deferred
 * engine chunk shared by every section instead of the engine riding back
 * into the eager initial bundle the moment any one of them imported it
 * statically (Vite/Rollup put a specifier in the eager chunk if *any*
 * importer is static, so all four call sites had to move together).
 *
 * Caching the in-flight promise (not just relying on the browser's own
 * per-URL module cache, which already dedupes the network fetch) means
 * every caller `await`s the exact same promise object: States mounts 13
 * tiles that can all enter the viewport in the same tick, and they all
 * resolve off one `import()`, not 13 independent ones racing to the same
 * cached response.
 */
export function ensureEngine() {
  if (!enginePromise) enginePromise = import("@luzir/bolota/engine");
  return enginePromise;
}

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
  // Bumped by exit()/setSeed()/destroy() so an in-flight enter()'s
  // ensureEngine() await can tell it's been superseded (tile scrolled back
  // out, re-seeded, or torn down before the chunk resolved) and bail
  // without mounting a handle nobody wants anymore.
  let gen = 0;

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

  async function enter() {
    if (!handle) {
      const myGen = ++gen;
      const { mountEngine } = await ensureEngine();
      if (myGen !== gen) return; // scrolled out / re-seeded / destroyed meanwhile
      handle = mountEngine(svg, currentSeed);
    } else {
      handle.play(spec.loopState ?? "idle", { loop: !!spec.loopState });
    }
    drive();
  }

  function exit() {
    gen++;
    clearTimer();
    handle?.stop();
  }

  const disconnect = onVisible(svg, enter, exit);

  return {
    /** Re-seeds this tile (global seed control), destroys and remounts. */
    setSeed(next: string) {
      if (next === currentSeed) return;
      currentSeed = next;
      gen++;
      clearTimer();
      handle?.destroy();
      handle = null;
      // Only remount immediately if currently on screen; onVisible's next
      // `enter()` will pick up `currentSeed` otherwise.
      if (svg.getBoundingClientRect().top < window.innerHeight) {
        const myGen = ++gen;
        ensureEngine().then(({ mountEngine }) => {
          if (myGen !== gen) return;
          handle = mountEngine(svg, currentSeed);
          drive();
        });
      }
    },
    destroy() {
      gen++;
      disconnect();
      clearTimer();
      handle?.destroy();
      handle = null;
    },
  };
}
