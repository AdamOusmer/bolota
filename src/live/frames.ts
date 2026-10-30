// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

export type FrameTick = (ms: number) => void;
export type FrameRead = () => void;

/**
 * One requestAnimationFrame per window, however many bolotas or drivers it
 * hosts. A frame runs every queued read before any tick, so a page of bolotas
 * measures its layout once and then writes, rather than forcing a layout per
 * bolota by interleaving the two.
 */
const frameLoops = new WeakMap<Window, { ticks: Set<FrameTick>; reads: Set<FrameRead>; id: number }>();

function frameLoop(view: Window) {
  let loop = frameLoops.get(view);
  if (!loop) frameLoops.set(view, (loop = { ticks: new Set(), reads: new Set(), id: 0 }));
  return loop;
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
