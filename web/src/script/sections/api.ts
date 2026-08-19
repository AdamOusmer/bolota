// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

/**
 * Reference section (spec §6): clicking a symbol in the left mini-list
 * scrolls its code block into view. Plain `Element.scrollIntoView`, not a
 * `#hash` anchor — the seed store owns `location.hash` (`#seed=...`,
 * seed-store.ts) and a real anchor click would blow that away and reset
 * every seeded demo on the page. An `IntersectionObserver` over the code
 * blocks keeps the mini-list's active item in sync on manual scroll too.
 */
export function setupApi() {
  const nav = document.querySelectorAll<HTMLButtonElement>("[data-ref-target]");
  if (!nav.length) return;

  const items = new Map<string, HTMLButtonElement>();
  nav.forEach((btn) => {
    const slug = btn.dataset.refTarget;
    if (slug) items.set(slug, btn);
    btn.addEventListener("click", () => {
      const slug2 = btn.dataset.refTarget;
      if (!slug2) return;
      document.getElementById(slug2)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  const blocks = Array.from(items.keys())
    .map((slug) => document.getElementById(slug))
    .filter((el): el is HTMLElement => !!el);
  if (!blocks.length) return;

  const setActive = (slug: string) => {
    items.forEach((btn, s) => btn.classList.toggle("is-active", s === slug));
  };

  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting);
      if (!visible.length) return;
      const top = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
      if (top.target.id) setActive(top.target.id);
    },
    { rootMargin: "-20% 0px -60% 0px", threshold: 0.01 },
  );
  blocks.forEach((el) => io.observe(el));
}
