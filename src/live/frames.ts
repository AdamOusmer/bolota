// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

export type FrameTick = (ms: number) => void;

/** One requestAnimationFrame per window, however many bolotas or drivers it hosts. */
const frameLoops = new WeakMap<Window, { ticks: Set<FrameTick>; id: number }>();

function frameLoop(view: Window) {
  let loop = frameLoops.get(view);
  if (!loop) frameLoops.set(view, (loop = { ticks: new Set(), id: 0 }));
  return loop;
}

function runFrame(view: Window, ms: number): void {
  const loop = frameLoop(view);
  loop.id = 0;
  if (loop.ticks.size === 0) return;
  loop.id = view.requestAnimationFrame((next) => runFrame(view, next));
  for (const tick of [...loop.ticks]) {
    try {
      tick(ms);
    } catch (error) {
      queueMicrotask(() => {
        throw error;
      });
    }
  }
}

export function startFrames(view: Window, tick: FrameTick): void {
  const loop = frameLoop(view);
  loop.ticks.add(tick);
  if (!loop.id) loop.id = view.requestAnimationFrame((ms) => runFrame(view, ms));
}

export function stopFrames(view: Window, tick: FrameTick): void {
  const loop = frameLoop(view);
  loop.ticks.delete(tick);
  if (loop.ticks.size > 0 || !loop.id) return;
  view.cancelAnimationFrame(loop.id);
  loop.id = 0;
}
