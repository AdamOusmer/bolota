/**
 * Shared visibility gate for every live engine on the page. There is no
 * manual play/pause UI anywhere (by design, every demo is alive on its
 * own); this is what keeps the total number of running rAF loops within
 * `mountEngine`'s documented "~20 engines at 60fps" budget when the states
 * grid (15 tiles) and the sequences grid are both mounted on one page:
 * whichever section is off-screen gets its engines stopped, not destroyed,
 * so re-entering the viewport resumes instantly.
 */
export function onVisible(
  el: Element,
  onEnter: () => void,
  onExit: () => void,
  opts: IntersectionObserverInit = {},
): () => void {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) onEnter();
        else onExit();
      }
    },
    { rootMargin: "60px", threshold: 0.01, ...opts },
  );
  io.observe(el);
  return () => io.disconnect();
}
