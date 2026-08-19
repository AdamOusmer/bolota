/**
 * The site's shared motion language: Lenis smooth scroll, `[data-magnetic]`
 * hover pull, the sticky nav's scrolled/active-section state, and the
 * scroll-triggered `[data-reveal]` content entrance.
 *
 * Lenis setup mirrors adam-ousmer.dev's `scroll.js` (Lenis + rAF loop).
 * Magnetic pull uses the `motion` package the same way the Portfolio's
 * `ui/Magnetic.astro` does: a quick un-eased follow while tracking, a
 * spring release on leave. `prefers-reduced-motion` is the only off-switch
 * anywhere on this page: it skips Lenis, magnetic and reveal entirely,
 * jumping every `[data-reveal]` element straight to its resting state.
 */
import Lenis from "lenis";
import { animate, cubicBezier } from "motion";

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

/**
 * Scroll-triggered content entrance for every `[data-reveal]` element:
 * opacity 0 -> 1 + translateY(10px) -> 0, 650ms, cubic-bezier(0.25, 0.1,
 * 0.25, 1), per the redesign spec, with a 60ms stagger read off each
 * element's own `--reveal-i` custom property (already the convention
 * several sections use for `data-reveal style="--reveal-i:N"` groups).
 *
 * IntersectionObserver-driven rather than v1's `animation-timeline: view()`
 * CSS: that technique ties duration to scroll distance, not a fixed 650ms,
 * so it cannot hit the spec's exact timing/easing. Base (opacity: 0,
 * translateY(10px)) state lives in global.css's `[data-reveal]` rule.
 *
 * Reduced motion, no IntersectionObserver support, and any animate()
 * failure all resolve straight to the resting state, never a permanently
 * invisible section, same belt-and-suspenders shape as hero.ts's own
 * entrance. See also the `<noscript>` rule in Base.astro for when JS never
 * runs at all.
 */
export function setupReveal() {
  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
  if (!els.length) return;

  const settle = (el: HTMLElement) => {
    el.style.opacity = "1";
    el.style.transform = "none";
  };

  if (reduceMotion.matches || !("IntersectionObserver" in window)) {
    els.forEach(settle);
    return;
  }

  const ease = cubicBezier(0.25, 0.1, 0.25, 1);
  const io = new IntersectionObserver(
    (entries, obs) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        obs.unobserve(el);

        const i = Number(getComputedStyle(el).getPropertyValue("--reveal-i")) || 0;
        const delay = i * 0.06;
        const finalize = () => settle(el);
        try {
          animate(el, { opacity: [0, 1], y: [10, 0] }, { duration: 0.65, delay, ease })
            .finished.then(finalize)
            .catch(finalize);
        } catch {
          finalize();
        }
        // Belt and suspenders: a stalled rAF driver must not leave content
        // permanently invisible (see hero.ts's playEntrance for the same
        // pattern and rationale).
        setTimeout(finalize, delay * 1000 + 900);
      }
    },
    { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
  );
  els.forEach((el) => io.observe(el));
}
