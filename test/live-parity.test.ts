import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { _layout } from "../src/bolota";
import { BotEngine } from "../src/bloub/engine";
import { toPoints } from "../src/bloub/shape";
import { POSES, STATES, STATE_BY_ID, type Pose } from "../src/bloub/states";
import { STATE_HOLD, _seededSilhouette, mountEngine } from "../src/engine";
import { actTransform, type Act } from "../src/live/act";
import { CHOREO, type StateId } from "../src/live/choreo";
import { HOLD, Timeline, frameDt, type PlayOptions } from "../src/live/timeline";

/**
 * The live timeline against the engine it replaces, frame by frame.
 *
 * The reference is the real pipeline: `mountEngine` on a fake DOM, its own
 * `play`/`tick` deciding what `BotEngine` is told, and the act read off
 * `BotEngine`'s composed pose (`composedPose`, private, read through a cast;
 * it is exactly what `sample` blends before it adds idle life). Liveliness is
 * therefore out on both sides. The pose's silhouette is the seed's profile
 * scaled, so the act's `s` is recovered as the ratio to the seed and checked to
 * be uniform, not assumed.
 *
 * Frames run every `STEP`, with one extra frame placed a few 1e-13 s past each
 * automatic transition the timeline reports. The old player fires on the first
 * frame at or past a threshold, the timeline at the threshold itself; landing a
 * frame just past it makes both fire within ~1e-12 s of each other, which no
 * channel turns into 1e-9 of drift. The offset grows by 1e-13 per transition
 * because the old player's looped restarts each inherit the previous one's
 * lateness. A threshold the timeline gets wrong still fails: the player would
 * not fire on that frame, or would have fired earlier.
 *
 * `STEP` is not 16 ms because 0.4 s is a whole number of those: orbit, handed
 * back to, reaches exactly -180° 0.4 s in, where the short-way blend's turn
 * direction is decided by the last bit and the 1e-13 s offset flips it.
 */
const STEP = 0.0167;

const TOL = 1e-9;
const SEEDS = ["parity-a", "parity-b"];

class FakeElement {
  attrs = new Map<string, string>();
  children: FakeElement[] = [];
  constructor(readonly ownerDocument: FakeDocument) {}
  setAttribute(k: string, v: unknown) {
    this.attrs.set(k, String(v));
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  appendChild(c: FakeElement) {
    this.children.push(c);
    return c;
  }
  append(...cs: FakeElement[]) {
    this.children.push(...cs);
  }
  replaceChildren(...cs: FakeElement[]) {
    this.children = cs;
  }
  remove() {}
}

class FakeWindow {
  queue: Array<(ms: number) => void> = [];
  matchMedia(_q: string) {
    return { matches: false } as MediaQueryList;
  }
  requestAnimationFrame(cb: (ms: number) => void) {
    this.queue.push(cb);
    return this.queue.length;
  }
  cancelAnimationFrame(_id: number) {
    this.queue.length = 0;
  }
}

class FakeDocument {
  defaultView = new FakeWindow();
  createElementNS(_ns: string, _tag: string) {
    return new FakeElement(this);
  }
}

interface Internals {
  composedPose(now: number): Pose;
  shape: number[];
  frozenStart: Pose | null;
}

const realSample = BotEngine.prototype.sample;
let lastEngine: BotEngine | null = null;
let lastNow = 0;

beforeAll(() => {
  BotEngine.prototype.sample = function (this: BotEngine, now: number) {
    lastEngine = this;
    lastNow = now;
    return realSample.call(this, now);
  };
});

afterAll(() => {
  BotEngine.prototype.sample = realSample;
});

type Body = Omit<Act, "upright">;

function refAct(engine: BotEngine, now: number): Body {
  const inner = engine as unknown as Internals;
  const pose = inner.composedPose(now);
  const shape = inner.shape;
  const s = pose.sil.radii[0]! / shape[0]!;
  for (let i = 0; i < shape.length; i++) {
    expect(Math.abs(pose.sil.radii[i]! - s * shape[i]!)).toBeLessThan(1e-12);
  }
  expect(pose.bodyAlpha).toBe(1);
  return {
    x: pose.sil.cx + pose.offX,
    y: pose.sil.cy + pose.offY,
    rot: (pose.sil.rot * 180) / Math.PI,
    s,
    sx: pose.sil.sx,
    sy: pose.sil.sy,
    eyeAlpha: pose.eyeAlpha,
  };
}

const FIELDS: (keyof Body)[] =["x", "y", "rot", "s", "sx", "sy", "eyeAlpha"];
let worst = 0;
let frames = 0;

class Rig {
  doc = new FakeDocument();
  handle;
  engine: BotEngine;
  tl = new Timeline();
  ms = 1000;
  last = 0;
  clock = 0;
  late = 0;

  constructor(seed: string) {
    const svg = this.doc.createElementNS("", "svg");
    this.handle = mountEngine(svg as unknown as SVGSVGElement, seed);
    this.engine = lastEngine!;
  }

  play(id: StateId, o: PlayOptions = {}) {
    this.handle.play(id, o);
    this.tl.play(id, this.clock, o);
  }

  frozen() {
    return (this.engine as unknown as Internals).frozenStart !== null;
  }

  frame(ms: number) {
    const due = this.doc.defaultView.queue;
    this.doc.defaultView.queue = [];
    for (const cb of due) cb(ms);
    this.clock += frameDt(this.last, ms);
    this.last = ms;
    this.ms = ms;
    expect(lastEngine).toBe(this.engine);
    expect(lastNow).toBe(this.clock);
    this.check();
  }

  check() {
    const want = refAct(this.engine, this.clock);
    const got = this.tl.sample(this.clock);
    for (const k of FIELDS) {
      const d = Math.abs(got[k] - want[k]);
      if (d > worst) worst = d;
      if (d > TOL) {
        throw new Error(`${k} at t=${this.clock}: timeline ${got[k]}, engine ${want[k]}`);
      }
    }
    frames++;
  }

  /** Frames every `STEP` for `seconds`, plus one just past each transition. */
  run(seconds: number) {
    const end = this.clock + seconds;
    while (this.clock < end) {
      const next = this.tl.next(this.clock);
      const dt = next - this.clock < STEP ? next - this.clock + 1e-13 * ++this.late : STEP;
      this.frame(this.ms + dt * 1000);
    }
  }
}

const IDS = STATES.map((s) => s.id);

describe("live choreography", () => {
  test("covers the bloub catalog with the same timing and flags", () => {
    expect(Object.keys(CHOREO).sort()).toEqual([...IDS].sort());
    expect(HOLD).toBe(STATE_HOLD);
    for (const id of IDS) {
      const def = STATE_BY_ID.get(id)!;
      const c = CHOREO[id];
      expect([id, c.duration, c.minDuration, c.morph, c.period, c.fill, c.blinkIn]).toEqual([
        id,
        def.duration,
        def.minDuration,
        def.morph,
        def.period,
        def.fill,
        def.blinkIn,
      ]);
      expect([id, c.baseBody, c.baseFace, !!c.acceptsExpression, !!c.ownsLiveliness]).toEqual([
        id,
        def.baseBody,
        def.baseFace,
        !!def.acceptsExpression,
        !!def.ownsLiveliness,
      ]);
      expect(c.still).toBe(POSES[id]);
    }
  });

  test("actTransform puts the static body where bloub draws the posed one", () => {
    const { body, draw, petals, extra } = _layout("parity-a");
    const shape = _seededSilhouette(body, draw, petals, extra);
    for (const id of IDS) {
      for (const t of [0, 0.37, 1.1, 2.05]) {
        const act = CHOREO[id].act(t);
        const sil = { radii: shape.map((r) => r * act.s), rot: (act.rot * Math.PI) / 180, cx: act.x, cy: act.y, sx: act.sx, sy: act.sy };
        const want = toPoints(sil, body.rx);
        const m = parseTransform(actTransform(act, body.rx, body.cx, body.cy));
        for (let i = 0; i < shape.length; i++) {
          const a = (i / shape.length) * Math.PI * 2;
          const px = body.cx + body.rx * shape[i]! * Math.cos(a);
          const py = body.cy + body.rx * shape[i]! * Math.sin(a);
          const [gx, gy] = apply(m, px, py);
          // r3 rounds the scale to 1e-3, which moves a point up to ~0.03 units
          // at the rim of a 40-unit body.
          expect(Math.abs(gx - (body.cx + want[i]!.x))).toBeLessThan(0.05);
          expect(Math.abs(gy - (body.cy + want[i]!.y))).toBeLessThan(0.05);
        }
      }
    }
  });
});

describe("live timeline matches the old engine", () => {
  afterAll(() => {
    console.log(`live parity: ${frames} frames, worst field error ${worst.toExponential(2)}`);
  });

  for (const id of IDS) {
    const c = CHOREO[id];
    test(`${id}, one-shot from idle`, () => {
      const rig = new Rig(SEEDS[0]!);
      rig.play(id);
      rig.run(c.duration + HOLD + 1.2);
    });
    test(`${id}, looped`, () => {
      const rig = new Rig(SEEDS[1]!);
      rig.play(id, { loop: true });
      rig.run(c.period ? c.period * 2 + 0.5 : (c.duration + c.morph) * 2 + 0.5);
    });
  }

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
  for (const [name, id, o] of combos) {
    test(`${id}, ${name}`, () => {
      const rig = new Rig(SEEDS[0]!);
      rig.play("wander", { loop: true });
      rig.run(0.2);
      rig.play(id, o);
      rig.run(Math.max(o.for ?? 0, CHOREO[id].duration) + (o.hold ?? HOLD) + 1.5);
    });
  }

  test("transitions interrupted mid-morph chain from the frozen blend", () => {
    const rig = new Rig(SEEDS[1]!);
    rig.play("orbit", { loop: true });
    rig.run(1.3);
    rig.play("burst");
    rig.run(0.15);
    rig.play("wide");
    expect(rig.frozen()).toBe(true);
    rig.run(0.1);
    rig.play("snooze", { loop: true });
    expect(rig.frozen()).toBe(true);
    rig.run(0.05);
    rig.play("alert", { rest: "thinking" });
    rig.run(5);
  });

  test("a one-shot over a looping state hands back to it", () => {
    const rig = new Rig(SEEDS[0]!);
    rig.play("orbit", { loop: true });
    rig.run(1);
    rig.play("comet");
    rig.run(4);
    rig.play("thinking", { loop: true });
    rig.run(1.9);
    rig.play("exclaim", { hold: 0.2 });
    rig.run(6);
  });

  test("replaying the current state keeps its blend clock", () => {
    const rig = new Rig(SEEDS[1]!);
    rig.play("wink", { loop: true });
    rig.run(0.7);
    rig.play("wink", { hold: 0 });
    rig.run(3);
    rig.play("idle", { loop: true });
    rig.run(0.2);
    rig.play("idle", { for: 3 });
    rig.run(4);
  });

  test("a change commanded on the frame of a restart", () => {
    const rig = new Rig(SEEDS[0]!);
    rig.play("snooze", { loop: true });
    const at = rig.tl.next(rig.clock);
    rig.run(at - rig.clock);
    rig.play("orbit");
    rig.run(5);
  });

  test("a long frame advances the clock by the clamp, not the gap", () => {
    const rig = new Rig(SEEDS[1]!);
    rig.play("orbit", { loop: true });
    rig.run(0.5);
    rig.frame(rig.ms + 500);
    rig.frame(rig.ms + 2000);
    rig.run(0.5);
  });

  test("sample is pure: rereading the past gives the same act", () => {
    const tl = new Timeline();
    tl.play("orbit", 0, { loop: true });
    tl.play("burst", 0.3);
    tl.play("comet", 0.35);
    const ts = Array.from({ length: 200 }, (_, i) => i * 0.031);
    const first = ts.map((t) => tl.sample(t));
    const again = [...ts].reverse().map((t) => tl.sample(t)).reverse();
    expect(again).toEqual(first);
    expect(() => tl.play("idle", 0.2)).toThrow(RangeError);
  });
});

type M = [number, number, number, number, number, number];

function mul([a, b, c, d, e, f]: M, [g, h, i, j, k, l]: M): M {
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

function parseTransform(s: string): M {
  let m: M = [1, 0, 0, 1, 0, 0];
  for (const [, fn, args] of s.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const [p = 0, q] = args!.trim().split(/[\s,]+/).map(Number);
    if (fn === "translate") m = mul(m, [1, 0, 0, 1, p, q ?? 0]);
    else if (fn === "scale") m = mul(m, [p, 0, 0, q ?? p, 0, 0]);
    else if (fn === "rotate") {
      const r = (p * Math.PI) / 180;
      m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
    } else throw new Error(`unexpected ${fn}`);
  }
  return m;
}

function apply([a, b, c, d, e, f]: M, x: number, y: number): [number, number] {
  return [a * x + c * y + e, b * x + d * y + f];
}
