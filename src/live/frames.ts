// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

export type FrameTick = (ms: number) => void;
export type FrameRead = () => void;
export type SightChange = (visible: boolean) => void;

interface Watch {
  el: Element;
  change: SightChange;
  inView: boolean;
  shown: boolean;
}

interface Registry {
  v: number;
  ticks: Set<FrameTick>;
  reads: Set<FrameRead>;
  id: number;
  sight: Set<Watch>;
  io: IntersectionObserver | null;
  hide: () => void;
}

/** Shape version of the registry stored on the window; bump it when the fields change. */
const VERSION = 1;

/**
 * The registry lives on the window under a global symbol, so two bundled
 * copies of bolota on one page find the same one and share one
 * requestAnimationFrame, one read/write phase and one IntersectionObserver.
 * A registry with another version belongs to a copy that reads it differently:
 * this copy keeps a private one rather than corrupt it.
 */
const KEY = Symbol.for("@luzir/bolota/frames");
const privates = new WeakMap<Window, Registry>();

/** How far beyond the viewport an instance counts as on screen, so it wakes before it is seen. */
const MARGIN = "200px";

function frameLoop(view: Window): Registry {
  const slots = view as unknown as Record<symbol, Registry | undefined>;
  const slot = slots[KEY];
  const known = slot?.v === VERSION ? slot : privates.get(view);
  if (known) return known;
  const mine: Registry = {
    v: VERSION,
    ticks: new Set(),
    reads: new Set(),
    id: 0,
    sight: new Set(),
    io: null,
    hide: () => mine.sight.forEach((w) => refresh(mine, w)),
  };
  if (slot) privates.set(view, mine);
  else slots[KEY] = mine;
  return mine;
}

function guarded(run: () => void) {
  try {
    run();
  } catch (error) {
    queueMicrotask(() => {
      throw error;
    });
  }
}

function runFrame(view: Window, ms: number): void {
  const loop = frameLoop(view);
  loop.id = 0;
  if (loop.reads.size) {
    const reads = [...loop.reads];
    loop.reads.clear();
    for (const read of reads) guarded(read);
  }
  if (loop.ticks.size === 0) return;
  loop.id = view.requestAnimationFrame((next) => runFrame(view, next));
  for (const tick of [...loop.ticks]) guarded(() => tick(ms));
}

function schedule(view: Window, loop: { id: number }) {
  if (!loop.id) loop.id = view.requestAnimationFrame((ms) => runFrame(view, ms));
}

export function startFrames(view: Window, tick: FrameTick): void {
  const loop = frameLoop(view);
  loop.ticks.add(tick);
  schedule(view, loop);
}

export function stopFrames(view: Window, tick: FrameTick): void {
  const loop = frameLoop(view);
  loop.ticks.delete(tick);
  if (loop.ticks.size > 0 || loop.reads.size > 0 || !loop.id) return;
  view.cancelAnimationFrame(loop.id);
  loop.id = 0;
}

/**
 * Runs `read` once at the start of the next frame, before any tick writes.
 * Asking again before then is free, so a burst of scroll events costs one
 * measurement per frame.
 */
export function readNextFrame(view: Window, read: FrameRead): void {
  const loop = frameLoop(view);
  loop.reads.add(read);
  schedule(view, loop);
}

/** Drops a read queued by `readNextFrame` that has not run yet. */
export function cancelRead(view: Window, read: FrameRead): void {
  frameLoop(view).reads.delete(read);
}

function refresh(loop: Registry, w: Watch): void {
  const visible = w.inView && !w.el.ownerDocument.hidden;
  if (visible === w.shown) return;
  w.shown = visible;
  w.change(visible);
}

/**
 * Tells `change` whenever `el` becomes visible or not: in view (with a margin)
 * and the document not hidden. One IntersectionObserver and one
 * `visibilitychange` listener serve every watched element of a window, and both
 * are released with the last one. A window without IntersectionObserver counts
 * everything as in view. `change(false)` is called at once if the document is
 * already hidden. Returns the function that stops watching.
 */
export function watchSight(view: Window, el: Element, change: SightChange): () => void {
  const loop = frameLoop(view);
  const w: Watch = { el, change, inView: true, shown: true };
  const win = view as Window & typeof globalThis;
  loop.sight.add(w);
  el.ownerDocument.addEventListener("visibilitychange", loop.hide);
  if (!loop.io && win.IntersectionObserver) {
    loop.io = new win.IntersectionObserver(
      (entries) =>
        entries.forEach((e) =>
          loop.sight.forEach((x) => {
            if (x.el !== e.target) return;
            x.inView = e.isIntersecting;
            refresh(loop, x);
          }),
        ),
      { rootMargin: MARGIN },
    );
  }
  loop.io?.observe(el);
  refresh(loop, w);
  return () => {
    loop.sight.delete(w);
    loop.io?.unobserve(el);
    if (loop.sight.size) return;
    el.ownerDocument.removeEventListener("visibilitychange", loop.hide);
    loop.io?.disconnect();
    loop.io = null;
  };
}
