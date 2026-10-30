import { describe, expect, test } from "bun:test";

import { CHOREO, type StateId } from "../src/live/choreo";
import { resolveExpression } from "../src/live/names";
import { Timeline } from "../src/live/timeline";

const STATES = Object.keys(CHOREO) as StateId[];
const POSES = ["happy", "sad", "scared", "love", null].map((n) => (n ? resolveExpression(n)!.p : null));

const logOf = (tl: Timeline) => (tl as unknown as { log: unknown[] }).log;

describe("timeline history", () => {
  test("alternating play and express commands keep the log bounded and samples exact", () => {
    const kept = new Timeline();
    const reference = new Timeline();
    let now = 0;
    let worst = 0;
    for (let i = 0; i < 10_000; i++) {
      now += 3.4;
      kept.release(now);
      reference.release(-Infinity);
      if (i % 2) {
        const pose = POSES[(i >> 1) % POSES.length]!;
        kept.express(pose, now);
        reference.express(pose, now);
      } else {
        const id = STATES[(i >> 1) % STATES.length]!;
        const o = i % 6 === 0 ? { loop: true } : { hold: 0.2 };
        kept.play(id, now, o);
        reference.play(id, now, o);
      }
      worst = Math.max(worst, logOf(kept).length);
      if (i % 97 === 0) {
        for (const dt of [0, 0.1, 0.9, 2.5]) {
          const t = now + dt;
          expect(kept.state(t)).toBe(reference.state(t));
          expect(kept.sample(t)).toEqual(reference.sample(t));
          expect(kept.eyes(t)).toEqual(reference.eyes(t));
          expect(kept.decorFrames(t)).toEqual(reference.decorFrames(t));
          expect(kept.next(t)).toBe(reference.next(t));
          expect(kept.blinkCue(now - 1e-6, t)).toBe(reference.blinkCue(now - 1e-6, t));
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(2);
    expect(logOf(reference).length).toBe(10_001);
  });
});
