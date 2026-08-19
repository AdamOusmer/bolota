import type { EngineHandle } from "@luzir/bolota/engine";
import { ensureEngine } from "./live-engine";
import { onVisible } from "./visibility";
import { DEFAULT_SEED } from "./curated-seeds";

/**
 * Nav brand mark: a real live bolota, not an icon. Fixed brand seed
 * (`curated-seeds.ts`'s `DEFAULT_SEED` — the same "bolota" identity Hero's
 * default paint uses), not the visitor's own seed: the nav is the one
 * place on the page that stays "bolota" itself regardless of whatever
 * seed is typed into the hero control elsewhere.
 *
 * Same static-first + deferred-engine-chunk pattern as Hero
 * (`sections/hero.ts`): `Nav.astro` already inlines a server-rendered
 * `bolota()` SVG for the zero-JS-wait first paint; this upgrades it to
 * the live engine on `"idle"` (bolota's calm neutral post idle/wander
 * split — no wander, blink/breathe still alive) once the shared
 * `@luzir/bolota/engine` chunk resolves, then crossfades exactly like the hero
 * does (`.nav__brand-avatar.is-live`, `Nav.astro`'s own scoped style).
 *
 * Routed through `live-engine.ts`'s shared `ensureEngine()` (this file's
 * own header explains why: one deferred-chunk call site for every section
 * below the hero) rather than a local copy of hero.ts's pattern, so this
 * doesn't add a second `import()` pulling the engine chunk in on its own.
 * Visibility-gated through the same `onVisible()` every other live tile
 * uses: the nav is fixed and almost always on screen, so this rarely
 * differs from "always running," but it keeps the mark inside the
 * documented render budget as a rule rather than a silent exception to
 * it, cheap: exactly one engine.
 */
export function setupBrandMark() {
  const wrap = document.querySelector<HTMLElement>("[data-brand-avatar]");
  const svgHost = document.querySelector<SVGSVGElement>("[data-brand-avatar-live] svg");
  if (!wrap || !svgHost) return;

  let handle: EngineHandle | null = null;
  // Guards a stale mount() (superseded by exit()/a second enter() before
  // ensureEngine()'s await resolved) — same pattern as live-engine.ts's
  // mountLiveTile and hero.ts's own copy.
  let gen = 0;

  async function mount() {
    const myGen = ++gen;
    const { mountEngine } = await ensureEngine();
    if (myGen !== gen) return;
    handle = mountEngine(svgHost!, DEFAULT_SEED);
    handle.play("idle", { loop: true });
    wrap!.classList.add("is-live");
  }

  onVisible(
    svgHost,
    () => {
      if (!handle) mount();
      else handle.play("idle", { loop: true });
    },
    () => handle?.stop(),
  );
}
