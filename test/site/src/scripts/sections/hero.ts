import { mountEngine, type EngineHandle } from "@luzir/bolota/engine";
import { animate, cubicBezier } from "motion";
import { getSeed, onSeedChange, setSeed } from "../lib/seed-store";
import { DEFAULT_SEED, randomSeed } from "../lib/curated-seeds";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/**
 * The hero avatar and the global seed control. This is the seed control:
 * there is only one on the page, and it drives every other demo (see
 * seed-store.ts). The determinism section below just displays what this
 * input already set.
 *
 * The hero only ever plays "idle": one of the states `mountEngine` keeps
 * structurally locked to the seed's own silhouette, so the hero always
 * shows the seeded bolota shape, never a bloub-specific pose.
 *
 * `handle.follow("window")` is real on this branch (src/engine.ts:
 * `follow(target?: Element | "window" | false): void`, eyes track the
 * pointer while it moves anywhere over `target`, fall back to idle drift
 * once it leaves). Deliberately page-wide, not scoped to the hero's own
 * stage element: scoping it to hover-over-the-avatar reads as broken (the
 * eyes only wake up once the cursor happens to already be on top of them);
 * page-wide, the avatar is looking at you from the moment the page loads.
 */
export function setupHero() {
  const wrap = document.querySelector<HTMLElement>("[data-hero-avatar]");
  const svgHost = wrap?.querySelector("svg") as SVGSVGElement | null;
  const input = document.querySelector<HTMLInputElement>("[data-seed-input]");
  const dice = document.querySelector<HTMLButtonElement>("[data-seed-random]");
  const hint = document.querySelector<HTMLElement>("[data-seed-hint]");

  if (!wrap || !svgHost) return;

  let handle: EngineHandle | null = null;

  function mount(seed: string) {
    handle?.destroy();
    handle = mountEngine(svgHost!, seed);
    handle.play("idle", { loop: true });
    if (typeof handle.follow === "function") handle.follow("window");
  }

  mount(getSeed() ?? DEFAULT_SEED);

  onSeedChange((seed) => {
    mount(seed ?? DEFAULT_SEED);
    if (hint) {
      hint.innerHTML = seed
        ? `Every demo below now renders <strong>"${escapeHtml(seed)}"</strong>. Clear the field to go back to curated variety.`
        : `Empty seed shows a <strong>curated set</strong> of shapes below. Type one to see it everywhere on this page.`;
    }
    if (input && input.value !== (seed ?? "")) input.value = seed ?? "";
  });

  if (input) {
    input.value = getSeed() ?? "";
    input.addEventListener("input", () => setSeed(input.value));
  }

  dice?.addEventListener("click", () => {
    const next = randomSeed();
    if (input) input.value = next;
    setSeed(next);
  });

  playEntrance();
}

/** Staggered fade-up for `[data-hero-stagger]`, matching the Portfolio's
 * ui/PageEntrance.astro `.page-stagger` timing (duration 0.7, delay
 * 0.3 + i * 0.15, the same "smooth" cubic-bezier). Under reduced motion the
 * elements are set straight to their resting state instead of animated. */
function playEntrance() {
  const els = document.querySelectorAll<HTMLElement>("[data-hero-stagger]");
  if (reduceMotion.matches) {
    els.forEach((el) => {
      el.style.opacity = "1";
      el.style.transform = "none";
    });
    return;
  }
  const smooth = cubicBezier(0.25, 1, 0.5, 1);
  els.forEach((el, i) => {
    const delayMs = (0.3 + i * 0.15) * 1000;
    let controls: ReturnType<typeof animate> | null = null;
    // `stop()` before writing the resting inline styles: a still-running
    // animation controls its target's `opacity`/`transform` on every frame
    // and otherwise clobbers a plain style assignment straight back to
    // whatever frame it is currently on, which is exactly the class of bug
    // that left this stuck invisible in a background/unfocused tab whose
    // rAF driver never reached the animation's own last frame.
    const finalize = () => {
      controls?.stop();
      el.style.opacity = "1";
      el.style.transform = "none";
    };
    try {
      controls = animate(el, { opacity: [0, 1], y: [25, 0] }, { duration: 0.7, delay: delayMs / 1000, ease: smooth });
      controls.finished.then(finalize).catch(finalize);
    } catch {
      finalize();
    }
    // Belt and suspenders: a stalled rAF driver (a backgrounded/unfocused
    // tab, or any other reason the animation's own completion never fires)
    // must not leave hero content permanently invisible.
    setTimeout(finalize, delayMs + 900);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
