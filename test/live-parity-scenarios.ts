// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { CHOREO, type StateId } from "../src/live/choreo";
import { HOLD, Timeline, frameDt, type PlayOptions } from "../src/live/timeline";

/**
 * The frame-by-frame scenarios behind `test/fixtures/parity-acts.ts`.
 *
 * Frames run every `STEP`, with one extra frame placed a few 1e-13 s past each
 * automatic transition the timeline reports. The old player fired on the first
 * frame at or past a threshold, the timeline fires at the threshold itself;
 * landing a frame just past it makes both fire within ~1e-12 s of each other,
 * which no channel turns into 1e-9 of drift. The offset grows by 1e-13 per
 * transition because the old player's looped restarts each inherited the
 * previous one's lateness.
 *
 * `STEP` is not 16 ms because 0.4 s is a whole number of those: orbit, handed
 * back to, reaches exactly -180 degrees 0.4 s in, where the short-way blend's
 * turn direction is decided by the last bit and the 1e-13 s offset flips it.
 */
export const STEP = 0.0167;

export const KEEP_EVERY = 6;

export interface Host {
  play(id: StateId, o: PlayOptions): void;
  frame(ms: number): void;
  check(clock: number): void;
}

/**
 * Every frame advances the clock, but `check` runs on one in `KEEP_EVERY`
 * and on every frame at or right after a command or a transition, where the
 * old engine's answer is most likely to differ from the timeline's.
 */
export class Rig {
  tl = new Timeline();
  ms = 1000;
  last = 0;
  clock = 0;
  late = 0;
  private frames = 0;
  private hot = 0;

  constructor(private readonly host: Host) {}

  play(id: StateId, o: PlayOptions = {}) {
    this.host.play(id, o);
    this.tl.play(id, this.clock, o);
    this.hot = 1;
  }

  frame(ms: number, hot = true) {
    this.host.frame(ms);
    this.clock += frameDt(this.last, ms);
    this.last = ms;
    this.ms = ms;
    if (hot) this.hot = Math.max(this.hot, 1);
    if (this.hot > 0 || this.frames % KEEP_EVERY === 0) this.host.check(this.clock);
    if (this.hot > 0) this.hot--;
    this.frames++;
  }

  /** Frames every `STEP` for `seconds`, plus one just past each transition. */
  run(seconds: number) {
    const end = this.clock + seconds;
    while (this.clock < end) {
      const next = this.tl.next(this.clock);
      const edge = next - this.clock < STEP;
      const dt = edge ? next - this.clock + 1e-13 * ++this.late : STEP;
      if (edge) this.hot = 2;
      this.frame(this.ms + dt * 1000, false);
    }
  }
}

export interface Scenario {
  name: string;
  seed: string;
  run(rig: Rig): void;
}

const SEEDS = ["parity-a", "parity-b"] as const;
export const IDS = Object.keys(CHOREO) as StateId[];

const combos: [string, StateId, PlayOptions][] = [
  ["hold 0", "wide", { hold: 0 }],
  ["hold 1.2", "alert", { hold: 1.2 }],
  ["negative hold clamps to 0", "notify", { hold: -1 }],
  ["rest wander", "wink", { rest: "wander" }],
  ["for, stretched", "swirl", { for: 4.1 }],
  ["for, stretched with decor", "play", { for: 5 }],
  ["for, held", "burst", { for: 5 }],
  ["for, held comet", "comet", { for: 3.3 }],
  ["for, periodic", "orbit", { for: 5 }],
  ["for, periodic wink", "wink", { for: 3.1 }],
  ["for shorter than the state", "thinking", { for: 1 }],
  ["for with hold", "snooze", { for: 3.5, hold: 0.8 }],
  ["for ignored while looping", "exclaim", { for: 6, loop: true }],
];

export const SCENARIOS: Scenario[] = [
  ...IDS.flatMap((id): Scenario[] => {
    const c = CHOREO[id];
    return [
      {
        name: `${id}, one-shot from idle`,
        seed: SEEDS[0],
        run(rig) {
          rig.play(id);
          rig.run(c.duration + HOLD + 1.2);
        },
      },
      {
        name: `${id}, looped`,
        seed: SEEDS[1],
        run(rig) {
          rig.play(id, { loop: true });
          rig.run(c.period ? c.period * 2 + 0.5 : (c.duration + c.morph) * 2 + 0.5);
        },
      },
    ];
  }),
  ...combos.map(
    ([name, id, o]): Scenario => ({
      name: `${id}, ${name}`,
      seed: SEEDS[0],
      run(rig) {
        rig.play("wander", { loop: true });
        rig.run(0.2);
        rig.play(id, o);
        rig.run(Math.max(o.for ?? 0, CHOREO[id].duration) + (o.hold ?? HOLD) + 1.5);
      },
    }),
  ),
  {
    name: "transitions interrupted mid-morph chain from the frozen blend",
    seed: SEEDS[1],
    run(rig) {
      rig.play("orbit", { loop: true });
      rig.run(1.3);
      rig.play("burst");
      rig.run(0.15);
      rig.play("wide");
      rig.run(0.1);
      rig.play("snooze", { loop: true });
      rig.run(0.05);
      rig.play("alert", { rest: "thinking" });
      rig.run(5);
    },
  },
  {
    name: "a one-shot over a looping state hands back to it",
    seed: SEEDS[0],
    run(rig) {
      rig.play("orbit", { loop: true });
      rig.run(1);
      rig.play("comet");
      rig.run(4);
      rig.play("thinking", { loop: true });
      rig.run(1.9);
      rig.play("exclaim", { hold: 0.2 });
      rig.run(6);
    },
  },
  {
    name: "replaying the current state, where the body pose cannot tell the restart",
    seed: SEEDS[1],
    run(rig) {
      rig.play("wink", { loop: true });
      rig.run(0.7);
      rig.play("wink", { hold: 0 });
      rig.run(3);
      rig.play("idle", { loop: true });
      rig.run(0.2);
      rig.play("idle", { for: 3 });
      rig.run(4);
    },
  },
  {
    name: "a change commanded on the frame of a restart",
    seed: SEEDS[0],
    run(rig) {
      rig.play("snooze", { loop: true });
      const at = rig.tl.next(rig.clock);
      rig.run(at - rig.clock);
      rig.play("orbit");
      rig.run(5);
    },
  },
  {
    name: "a long frame advances the clock by the clamp, not the gap",
    seed: SEEDS[1],
    run(rig) {
      rig.play("orbit", { loop: true });
      rig.run(0.5);
      rig.frame(rig.ms + 500);
      rig.frame(rig.ms + 2000);
      rig.run(0.5);
    },
  },
];
