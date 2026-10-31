// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { prepare, type OutlineLayout } from "./outline";

/**
 * Outline tables, built off the mount path. One queue per window drains in
 * idle callbacks, one layout per timeout where the window has none (iOS
 * Safari), so a crowd of mounts spends idle time instead of one long task.
 */

type Deadline = { timeRemaining(): number; didTimeout: boolean };
type IdleWindow = Window & { requestIdleCallback?: (cb: (d: Deadline) => void, o?: { timeout: number }) => number };

interface Job {
  l: OutlineLayout;
  done: () => void;
}

interface Queue {
  jobs: Job[];
  armed: boolean;
}

const queues = new WeakMap<object, Queue>();

/** An idle slice with less than this left hands the next table to the following slice. */
const SLICE_MS = 3;
/** A queued layout waits at most this long for an idle slice. */
const TIMEOUT_MS = 1000;
/** Spacing between tables where idle callbacks do not exist. */
const STEP_MS = 32;

function queueOf(view: Window): Queue {
  let q = queues.get(view);
  if (!q) queues.set(view, (q = { jobs: [], armed: false }));
  return q;
}

function arm(view: IdleWindow, q: Queue): void {
  if (q.armed || !q.jobs.length) return;
  q.armed = true;
  const step = (d?: Deadline) => {
    q.armed = false;
    do {
      const job = q.jobs.shift();
      if (!job) return;
      prepare(job.l);
      job.done();
    } while (q.jobs.length && d && d.timeRemaining() > SLICE_MS);
    arm(view, q);
  };
  if (view.requestIdleCallback) view.requestIdleCallback(step, { timeout: TIMEOUT_MS });
  else setTimeout(step, STEP_MS);
}

/** Queues `l`; `done` runs once its tables exist. Returns the function that drops a job not yet run. */
export function warm(view: Window, l: OutlineLayout, done: () => void): () => void {
  const q = queueOf(view);
  const job: Job = { l, done };
  q.jobs.push(job);
  arm(view as IdleWindow, q);
  return () => {
    const i = q.jobs.indexOf(job);
    if (i >= 0) q.jobs.splice(i, 1);
  };
}
