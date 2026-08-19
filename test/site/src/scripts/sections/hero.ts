import { mountEngine, type EngineHandle } from "bolota/engine";
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

/** The spec's load choreography: the headline rises word-by-word (60ms
 * stagger), then the blob's light-pool fades up, then the rest (lead, seed
 * control, install line) follows. Kicker leads with its own quick fade.
 * Same belt-and-suspenders shape as setupReveal() in lib/motion.ts: every
 * element gets a `finalize()` that stops the running animation and pins the
 * resting inline styles, called both from `animate()`'s own completion and
 * from a backstop `setTimeout`, so a stalled rAF driver (backgrounded tab,
 * `motion` failing to load, anything else) never leaves hero content stuck
 * invisible. Under reduced motion every element jumps straight to resting. */
function playEntrance() {
  const kicker = document.querySelector<HTMLElement>(".hero__kicker");
  const words = Array.from(document.querySelectorAll<HTMLElement>(".hero__word"));
  const pool = document.querySelector<HTMLElement>("[data-hero-pool]");
  const rest = [
    document.querySelector<HTMLElement>(".hero__lead"),
    document.querySelector<HTMLElement>(".hero__controls"),
  ].filter((el): el is HTMLElement => !!el);

  const all = [kicker, ...words, pool, ...rest].filter((el): el is HTMLElement => !!el);

  const settle = (el: HTMLElement) => {
    el.style.opacity = "1";
    el.style.transform = "none";
  };

  if (reduceMotion.matches) {
    all.forEach(settle);
    return;
  }

  const smooth = cubicBezier(0.25, 1, 0.5, 1);
  const run = (el: HTMLElement, delay: number, duration = 0.6, riseBy = 16) => {
    let controls: ReturnType<typeof animate> | null = null;
    const finalize = () => {
      controls?.stop();
      settle(el);
    };
    try {
      controls = animate(el, { opacity: [0, 1], y: [riseBy, 0] }, { duration, delay, ease: smooth });
      controls.finished.then(finalize).catch(finalize);
    } catch {
      finalize();
    }
    setTimeout(finalize, (delay + duration) * 1000 + 400);
  };

  const WORD_STAGGER = 0.06;

  let t = 0.15;
  if (kicker) run(kicker, t, 0.5, 10);
  t += 0.3;

  words.forEach((w, i) => run(w, t + i * WORD_STAGGER, 0.45, 12));
  const headlineEnd = words.length ? t + (words.length - 1) * WORD_STAGGER + 0.45 : t;

  const poolDelay = headlineEnd + 0.1;
  if (pool) run(pool, poolDelay, 0.7, 20);

  const restStart = poolDelay + 0.3;
  rest.forEach((el, i) => run(el, restStart + i * 0.12, 0.6, 16));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
