/**
 * The site's shared motion language: Lenis smooth scroll, `[data-magnetic]`
 * hover pull, and the sticky nav's scrolled/active-section state.
 *
 * Scroll-triggered `[data-reveal]` entrances are pure CSS now (see
 * `[data-reveal]` in src/styles/global.css), ported verbatim from the
 * Portfolio's `animation-timeline: view()` technique, so there is no reveal
 * function here anymore. Lenis setup mirrors adam-ousmer.dev's `scroll.js`
 * (Lenis + rAF loop). Magnetic pull uses the `motion` package the same way
 * the Portfolio's `ui/Magnetic.astro` does: a quick un-eased follow while
 * tracking, a spring release on leave. `prefers-reduced-motion` is the only
 * off-switch anywhere on this page: it skips Lenis and magnetic entirely.
 */
import Lenis from "lenis";
import { animate } from "motion";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export function setupLenis() {
  if (reduceMotion.matches) return;

  const lenis = new Lenis({ lerp: 0.1, smoothWheel: true, syncTouch: false });
  document.documentElement.classList.add("lenis");

  function raf(time: number) {
    lenis.raf(time);
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);

  // Anchor nav links through Lenis so the smoothing applies to in-page jumps
  // too, not just wheel scroll.
  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href");
      if (!id || id === "#") return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target as HTMLElement, { offset: -68 });
    });
  });
}

/** Same pull-then-spring-back as the Portfolio's ui/Magnetic.astro: an
 * un-eased `duration: 0.1` follow while the pointer moves over the element,
 * a `type: "spring"` release back to (0, 0) on leave. */
export function setupMagnetic() {
  if (reduceMotion.matches || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  document.querySelectorAll<HTMLElement>("[data-magnetic]").forEach((el) => {
    const pull = Number(el.dataset.magnetic) || 0.3;

    el.addEventListener("pointermove", (e) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      animate(el, { x: x * pull, y: y * pull }, { duration: 0.1, ease: "linear" });
    });

    el.addEventListener("pointerleave", () => {
      animate(el, { x: 0, y: 0 }, { type: "spring", stiffness: 300, damping: 15, mass: 1 });
    });
  });
}

/** Sticky nav: an opaque background once the page scrolls (content sliding
 * under a fixed header must never read through it), and the anchor of
 * whichever section is currently in view highlighted.
 *
 * Driven by `IntersectionObserver` against a 1px sentinel at the very top
 * of `<body>` (see Base.astro), not a `scroll` event listener: a `scroll`
 * handler depends on the page's own native scroll position firing that
 * event on every change, which Lenis's smoothing does not reliably do here
 * (measured: `window.scrollY` moves but no `scroll` event follows), leaving
 * the header permanently transparent. `IntersectionObserver` reacts to the
 * sentinel's actual on-screen position instead, independent of how the
 * scroll got there. Inline style, not just the `.is-scrolled` class,
 * removes any dependency on `.nav.is-scrolled` correctly out-specificity-ing
 * `.nav` itself. */
export function setupNav() {
  const nav = document.querySelector<HTMLElement>(".nav");
  const sentinel = document.querySelector<HTMLElement>("[data-nav-sentinel]");
  if (!nav) return;

  const setScrolled = (scrolled: boolean) => {
    nav.classList.toggle("is-scrolled", scrolled);
    nav.style.background = scrolled ? "var(--bg-color)" : "";
    nav.style.borderBottomColor = scrolled ? "var(--border-color)" : "";
  };

  if (sentinel && "IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => setScrolled(!(entry?.isIntersecting ?? true)), {
      rootMargin: "-8px 0px 0px 0px",
      threshold: 0,
    }).observe(sentinel);
  } else {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".nav__links a[href^='#']"));
  if (!links.length) return;

  const sections = links
    .map((a) => document.querySelector(a.getAttribute("href")!))
    .filter((el): el is Element => !!el);

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = `#${entry.target.id}`;
        links.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === id));
      }
    },
    { rootMargin: "-40% 0px -55% 0px", threshold: 0 },
  );
  sections.forEach((s) => io.observe(s));
}
