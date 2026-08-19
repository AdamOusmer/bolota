import { describe, expect, test } from "bun:test";
import { BotEngine } from "../src/bloub/engine";
import { EXPRESSIONS, EXPRESSION_BY_ID, type ExpressionId } from "../src/bloub/expressions";
import { SHAPE_BY_ID } from "../src/bloub/skins";
import { STATE_BY_ID } from "../src/bloub/states";
import {
  MOODS,
  lookTarget,
  PITCH,
  SPIN,
  TOUR_TIME,
  tourLook,
  TURN,
  YAW_MAX,
  type Aim,
} from "../src/bloub/gaze";

// Ported verbatim from bloub's src/ui/gaze.test.ts (MIT, Jérémy Perret) —
// `it` swapped for `test` to match this repo's own test convention, imports
// repointed at the bolota port. No assertion changed.

const circle = () => SHAPE_BY_ID.get("circle")!.radii;

/** Resting aim: pointer at the bot's center, half-turn complete. */
const aim = (o: Partial<Aim> = {}): Aim => ({ nx: 0, ny: 0, tour: 1, pointer: true, ...o });

describe("gaze target", () => {
  test("lets the pose command before the arrival starts", () => {
    // no pointer: nothing is driven at all, neither direction nor drift
    const target = lookTarget(aim({ tour: 0, pointer: false }));
    // zero hold: whatever direction is aimed at, the pose commands alone...
    expect(target.mix).toBe(0);
    // ...and a full turn is still left to travel, which is the same angle as zero
    expect(target.spin).toBe(SPIN);

    // what matters isn't the field values but the rendered image: at the
    // start, it must be that of a bot that isn't driven at all
    const bare = new BotEngine(100, "idle", circle(), null);
    const start = new BotEngine(100, "idle", circle(), null);
    start.setLook(target, 0);
    expect(start.sample(1).eyes[0]!.matrix).toBe(bare.sample(1).eyes[0]!.matrix);
  });

  test("turns the head left, toward the panel", () => {
    // negative yaw = the bot looks left
    expect(lookTarget(aim()).yaw).toBe(-TURN);
  });

  test("follows the cursor in the right sense on both axes", () => {
    const left = lookTarget(aim({ nx: -1 }));
    const right = lookTarget(aim({ nx: 1 }));
    expect(right.yaw).toBeGreaterThan(left.yaw);

    // positive pitch = looking up, while screen y goes down: this is the
    // sign that's easy to get backward
    expect(lookTarget(aim({ ny: -1 })).pitch).toBeGreaterThan(0);
    expect(lookTarget(aim({ ny: 1 })).pitch).toBeLessThan(0);
  });

  test("fades the turn as the arrival progresses", () => {
    expect(lookTarget(aim({ tour: 0.5 })).spin).toBe(SPIN / 2);
    expect(lookTarget(aim({ tour: 1 })).spin).toBe(0);
  });
});

describe("both eyes stay visible", () => {
  /**
   * The invariant that protects the feature: past a certain yaw, the outer
   * eye crosses the sphere's limb and the engine REMOVES it from the image
   * — the bot ends up one-eyed. So this sweeps the 16 expressions at the
   * four corners of the screen, half-turn included.
   */
  test("across the 16 expressions, at the four corners of the screen", () => {
    for (const e of EXPRESSIONS) {
      for (const nx of [-1, 0, 1]) {
        for (const ny of [-1, 0, 1]) {
          const engine = new BotEngine(100, "idle", circle(), EXPRESSION_BY_ID.get(e.id)!);
          engine.setLook(lookTarget(aim({ nx, ny })), 0);
          const frame = engine.sample(1);
          expect(frame.eyes, `${e.id} nx=${nx} ny=${ny}`).toHaveLength(2);
          // ...and not just present: still clearly opaque
          for (const eye of frame.eyes) {
            expect(eye.alpha, `${e.id} nx=${nx} ny=${ny}`).toBeGreaterThan(0.5);
          }
        }
      }
    }
  });

  test("keeps a margin: the follow doesn't go all the way to the breaking point", () => {
    // if this margin disappears, YAW_MAX or TURN has been pushed too far
    const engine = new BotEngine(100, "idle", circle(), null);
    engine.setLook({ yaw: -(TURN + YAW_MAX) - 25, pitch: 0, mix: 1, spin: 0, wander: 0 }, 0);
    expect(engine.sample(1).eyes).toHaveLength(2);
  });
});

describe("the turn on itself", () => {
  test("sends the eyes behind the ball, then brings them back to the left", () => {
    /**
     * This is intentional, and it's what makes the swirl: mid-turn the eyes
     * are on the other side of the sphere, so the engine removes them from
     * the image. This test exists so this disappearance isn't "fixed" as a
     * mistaken bug — and to check that the eyes do come back, in the right
     * place.
     */
    const frameAt = (tour: number) => {
      const engine = new BotEngine(100, "idle", circle(), null);
      engine.setLook(lookTarget(aim({ tour })), 0);
      return engine.sample(1);
    };
    expect(frameAt(0).eyes).toHaveLength(2);
    // at the halfway point, the face is opposite the viewer
    expect(frameAt(0.5).eyes).toHaveLength(0);
    expect(frameAt(1).eyes).toHaveLength(2);

    // ...and a full turn settles the eyes exactly where a plain half-turn
    // would have put them: that's what makes the landing exact with no tuning
    const full = frameAt(1).eyes[0]!.matrix;
    const noTour = new BotEngine(100, "idle", circle(), null);
    noTour.setLook({ yaw: -TURN, pitch: PITCH, mix: 1, spin: 0, wander: 0 }, 0);
    expect(full).toBe(noTour.sample(1).eyes[0]!.matrix);
  });
});

describe("arrival turn on the site", () => {
  // `id: null` means no expression forced -- `idle`'s own resting gaze
  // (dead ahead, zero roll) is what shows, which is what "neutral" used to
  // mean before that expression was collapsed into `idle` itself (see
  // `../src/bloub/expressions.ts`'s header comment).
  const bot = (id: ExpressionId | null) =>
    new BotEngine(100, "idle", circle(), id === null ? null : EXPRESSION_BY_ID.get(id)!);

  /**
   * THE rule of a gaze script, and what makes it maintenance-free: it ends
   * at `mix: 0`, where the state's own pose commands alone. So there's
   * nothing to release — and a release would show up as one last slide of
   * the eyes, right when everything should be settled.
   */
  test("hands control back to the pose by the time it finishes", () => {
    expect(tourLook(TOUR_TIME).mix).toBe(0);
    expect(tourLook(TOUR_TIME + 5).spin).toBe(0);
  });

  test("settles the eyes on the chosen expression, whatever it is", () => {
    for (const id of EXPRESSIONS.map((e) => e.id)) {
      const played = bot(id);
      played.setLook(tourLook(TOUR_TIME), 0);
      expect(played.sample(1).eyes[0]!.matrix, id).toBe(bot(id).sample(1).eyes[0]!.matrix);
    }
  });

  test("lets the bot stay alive during the turn", () => {
    // the drift isn't switched off: there's no pointer to follow, so
    // nothing justifies freezing the gaze the way `lookTarget` does
    expect(tourLook(TOUR_TIME / 2).wander).toBe(1);
  });

  test("imposes no direction, at any point", () => {
    // `mix` at zero the whole way through: only `spin` is doing work, which
    // sends the eyes behind the ball instead of sliding them across
    for (const k of [0, 0.25, 0.5, 0.75, 1]) {
      expect(tourLook(k * TOUR_TIME).mix, `turn ${k}`).toBe(0);
    }
  });

  test("the turn starts from a FULL turn, which is already the right angle", () => {
    // -360deg is the same angle as 0: the first frame is already settled
    // correctly, and that's what lands the turn with no tuning
    expect(tourLook(0).spin).toBe(SPIN);
    const start = bot(null);
    start.setLook(tourLook(0), 0);
    expect(start.sample(1).eyes[0]!.matrix).toBe(bot(null).sample(1).eyes[0]!.matrix);
  });

  test("the turn sends the eyes BEHIND the ball", () => {
    // at the halfway point they've crossed the limb, so the engine no
    // longer draws them at all: that's proof the turn is a real trip
    // AROUND THE SPHERE and not a slide across the face
    const mid = bot(null);
    mid.setLook(tourLook(TOUR_TIME / 2), 0);
    expect(mid.sample(1).eyes).toHaveLength(0);
  });

  /**
   * Why the arrival plays ONLY the resting expression, and what sliding in
   * one more state would break.
   *
   * A gaze script can send the eyes wherever it wants, except on one axis:
   * `Look` deliberately never touches ROLL — the tilted head is the bot's
   * signature and follows neither the cursor nor a script. But every state
   * has its own roll (the wink tilts +6.7deg where rest tilts -13). Those
   * degrees can't be anticipated: they jump on a state change, under a
   * 0.2s blink that doesn't cover a 0.3s cross-fade.
   */
  test("can't anticipate roll, hence an arrival with no state change", () => {
    expect(STATE_BY_ID.get("wink")!.pose(0).gaze.roll).not.toBe(
      STATE_BY_ID.get("idle")!.pose(0).gaze.roll,
    );
    expect(tourLook(0)).not.toHaveProperty("roll");
  });
});

describe("gaze stability across expressions", () => {
  /** Inner eye's y coordinate, in viewBox px (y goes down on screen). */
  const eyeY = (m: BotEngine) =>
    +/matrix\([^,]+,[^,]+,[^,]+,[^,]+,-?[\d.]+,(-?[\d.]+)/.exec(m.sample(1).eyes[0]!.matrix)![1]!;

  test("keeps the eyes at the same height, whatever mood is displayed", () => {
    /**
     * The bug this locks in: when pitch was a DELTA, eye height followed
     * the expression's own. "Neutral" looks at +28.6deg and the moods sit
     * between -9 and +9, so the eyes would drop all at once on the first
     * mood change — which reads as a flaw, not an expression.
     */
    const heights = MOODS.map((id) => {
      const m = new BotEngine(100, "idle", circle(), EXPRESSION_BY_ID.get(id)!);
      m.setLook(lookTarget(aim()), 0);
      return eyeY(m);
    });
    const spread = Math.max(...heights) - Math.min(...heights);
    // on a ball of radius 100: a few pixels, not thirty
    expect(spread, `height spread of ${spread.toFixed(1)}px`).toBeLessThan(4);
  });

  test("without follow, expressions do keep different heights", () => {
    // the control test: it's the FOLLOW that stabilizes, not the
    // expressions having lost their vertical character
    const heights = EXPRESSIONS.map((e) =>
      eyeY(new BotEngine(100, "idle", circle(), EXPRESSION_BY_ID.get(e.id)!)),
    );
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(30);
  });

  test("only keeps zero-roll moods, otherwise the head tilts", () => {
    // this is the list's own criterion, and it's not guessable: roll isn't
    // neutralized by the follow, unlike yaw and pitch
    for (const id of MOODS) {
      expect(EXPRESSION_BY_ID.get(id)!.gaze.roll, id).toBe(0);
    }
  });
});
