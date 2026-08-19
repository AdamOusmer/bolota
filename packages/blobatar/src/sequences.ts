/**
 * Named decorative sequences and the tiny timer-driven runner that plays
 * them, in the spirit of bloub's `src/ui/intro.ts` (a montage of named,
 * timed blocks applied to one element) — MIT License, Copyright (c) 2026
 * Jérémy Perret (https://github.com/jeremyPerret/bloub). Not a port of that
 * file's code: `intro.ts` sequences bloub's gaze/pose state machine, which
 * this package has no equivalent of. What is carried over is the shape —
 * ordered, timed steps applied to one element — and, for `burst`/`orbit`/
 * `comet`, the step durations, which mirror bloub's measured state
 * durations (`states.ts`) even though the pose math behind them is not.
 */

/** One step: apply `cls` (replacing the previous step's) and hold for `ms`. */
export type FrameSeq = { cls: string; ms: number }[];

/**
 * A brief orbit-style spin-in that settles to no class, echoing bloub's
 * intro (the ball turns once before taking its place) without its gaze-tour
 * timing, which this package does not carry.
 */
export const entrance: FrameSeq = [
  { cls: "bb-orbit-spin", ms: 900 },
  { cls: "", ms: 0 },
];

/** Single step: `frames.css`'s `.bb-burst`, held for its own duration. */
export const burst: FrameSeq = [{ cls: "bb-burst", ms: 1400 }];

/** Single step: `.bb-orbit-spin`, held for bloub's measured orbit duration. */
export const orbit: FrameSeq = [{ cls: "bb-orbit-spin", ms: 3400 }];

/** Single step: `.bb-comet-drift`, held for bloub's measured comet duration. */
export const comet: FrameSeq = [{ cls: "bb-comet-drift", ms: 2400 }];

/**
 * Applies a `FrameSeq`'s classes to `el` on a timer, one step replacing the
 * last. Returns a cancel function that stops any remaining timers and, if a
 * step already applied its class, removes it — so an interrupted sequence
 * never leaves the element stuck mid-animation.
 *
 * No-ops (returns an inert cancel) when `reducedMotion` is set or the
 * sequence is empty, so a consumer wires `matchMedia` once here rather than
 * every class in `frames.css` re-deriving it independently — those classes
 * still carry their own `@media (prefers-reduced-motion: reduce)` guard as a
 * second line of defense for anyone applying them outside this runner.
 */
export function runSequence(
  el: Element,
  seq: FrameSeq,
  opts: { reducedMotion?: boolean } = {},
): () => void {
  if (opts.reducedMotion || seq.length === 0) return () => {};

  let current = "";
  const apply = (cls: string) => {
    if (current) el.classList.remove(...current.split(" ").filter(Boolean));
    if (cls) el.classList.add(...cls.split(" ").filter(Boolean));
    current = cls;
  };

  const timers: ReturnType<typeof setTimeout>[] = [];
  let at = 0;
  for (const step of seq) {
    timers.push(setTimeout(() => apply(step.cls), at));
    at += step.ms;
  }

  return () => {
    for (const t of timers) clearTimeout(t);
    if (current) el.classList.remove(...current.split(" ").filter(Boolean));
  };
}
