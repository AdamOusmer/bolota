/**
 * The single client entry point for the whole page. Everything interactive
 * (the seed control, every live-engine demo, Lenis, the light field, the
 * easter egg) is wired from here. One entry point, rather than a script per
 * Astro component, is deliberate: the seed store in lib/seed-store.ts needs
 * to be a true singleton across every section, which native ESM module
 * caching only guarantees for modules reached through one shared import
 * graph. Scroll-triggered reveals are `setupReveal()` in lib/motion.ts,
 * called once here same as the rest of the shared motion language: it
 * discovers every `[data-reveal]` element on the page itself, so sections
 * never need their own reveal wiring, just the attribute in their markup.
 */
import { setupLenis, setupMagnetic, setupNav, setupReveal } from "./lib/motion";
import { setupLightfield } from "./lib/lightfield";
import { setupEasterEgg } from "./lib/easter-egg";
import { setupCopyButtons } from "./lib/copy";
import { setupHero } from "./sections/hero";
import { setupDeterminism } from "./sections/determinism";
import { setupExpressions } from "./sections/expressions";
import { setupStates } from "./sections/states";
import { setupSequences } from "./sections/sequences";
import { setupApi } from "./sections/api";

const field = document.querySelector<HTMLElement>("[data-lightfield]");
if (field) setupLightfield(field);

setupNav();
setupLenis();
setupMagnetic();
setupReveal();
setupCopyButtons();
setupEasterEgg();

setupHero();
setupDeterminism();
setupExpressions();
setupStates();
setupSequences();
setupApi();
