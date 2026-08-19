// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { _layout } from "../src/bolota";
import { mountEngine } from "../src/engine";

/**
 * The eye-position twin of `engine-liveliness.test.ts`'s "engine idle
 * silhouette matches the static renderer" suite, which pins the BODY bbox
 * against `bolota()`'s own render for the same seed. That suite exists
 * because a wrong-aspect body shipped once with nothing catching it; this
 * one exists for the same reason on the other axis, EYES: `idle`'s gaze
 * used to default to `base()`'s own `REST_GAZE` (bloub's measured resting
 * pose, a sideways glance — see `../src/bloub/expressions.ts`'s header
 * comment) instead of the dead-ahead gaze the static renderer always draws
 * for a seed's own eye anchors (`../src/styles/compose.ts`'s `faceFit`).
 * The visible symptom was the IDLE and WANDER showcase tiles reading as
 * identical, both with eyes pushed toward the same corner — and nothing in
 * this repo compared an engine frame's eye centers to the static render's
 * before now, for any state.
 *
 * `idle` (`../src/bloub/states.ts`) is the only state this applies to: it's
 * the one state whose whole documented meaning is "reproduce the seed's own
 * resting face," `sil.cx/cy` and `offX/offY` both zero, no wander, no
 * cursor-follow by default -- so its rendered eye centers have no live
 * input left besides the seed's own geometry, exactly like the static path.
 */

class FakeElement {
  tagName: string;
  attrs = new Map<string, string>();
  children: FakeElement[] = [];
  ownerDocument: FakeDocument;
  constructor(tag: string, doc: FakeDocument) {
    this.tagName = tag;
    this.ownerDocument = doc;
  }
  setAttribute(k: string, v: unknown) {
    this.attrs.set(k, String(v));
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
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
  createElementNS(_ns: string, tag: string) {
    return new FakeElement(tag, this);
  }
}

const clocks = new Map<FakeDocument, { now: number }>();

function mount(name: string) {
  const doc = new FakeDocument();
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  (svg as unknown as { ownerDocument: FakeDocument }).ownerDocument = doc;
  const handle = mountEngine(svg as unknown as SVGSVGElement, name);
  clocks.set(doc, { now: 0 });
  return { doc, svg: svg as unknown as FakeElement, handle };
}

function step(doc: FakeDocument, deltaMs: number) {
  const clock = clocks.get(doc)!;
  clock.now += deltaMs;
  const due = doc.defaultView.queue;
  doc.defaultView.queue = [];
  for (const cb of due) cb(clock.now);
}

function run(doc: FakeDocument, totalMs: number, frameMs = 16) {
  for (let t = 0; t < totalMs; t += frameMs) step(doc, Math.min(frameMs, totalMs - t));
}

/** Root `<g>`'s eyes group -- `mountEngine`'s fixed append order (defs,
 * back, bodyPath, eyes, front), same as `engine-liveliness.test.ts`'s own
 * `parts()`. */
function engineEyeCenters(svg: FakeElement, bodyCx: number, bodyCy: number) {
  const root = svg.children[0]!;
  const eyes = root.children[3]!;
  return eyes.children.map((e) => {
    // `matrix(a,b,c,d,e,f)` -- e,f is the eye's own translation, in units
    // relative to the body center `mountEngine`'s root `<g>` already
    // translates by (`../src/engine.ts`'s `mountEngine`), so the absolute,
    // static-comparable position adds it back.
    const m = e.getAttribute("transform")!;
    const nums = m.slice(7, -1).split(",").map(Number);
    return { x: nums[4]! + bodyCx, y: nums[5]! + bodyCy };
  });
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("engine idle-frame eye centers match the static renderer's, per seed", () => {
  // Same shape-family seeds `engine-liveliness.test.ts` already uses for the
  // body-bbox parity suite, so a shape family failing here and there lines
  // up with the same failure in that file rather than needing its own seed
  // set to interpret.
  const SEEDS = [
    "anna",
    "alain",
    "mavey",
    "round-family-seed-1",
    "organic-family-seed-7",
    "boxy-family-seed-3",
    "nub-family-seed-2",
    "cloud-family-seed-9",
    "sun-family-seed-4"
  ];

  for (const seed of SEEDS) {
    test(`"${seed}"`, () => {
      const { body, eyes: staticEyes } = _layout(seed);
      const { doc, svg, handle } = mount(seed);
      handle.play("idle", { loop: true });
      run(doc, 50); // a couple of idle frames, well inside one breath cycle

      const engineEyes = engineEyeCenters(svg, body.cx, body.cy);
      expect(engineEyes).toHaveLength(staticEyes.length);

      // 30% of the body's own radius: comfortably above the residual the
      // eye-fit correction table (`../src/bloub/eyefit.ts`) leaves on a
      // seed outside bloub's own canonical shapes (measured up to ~0.225
      // here), and comfortably below what a wrong resting gaze produces --
      // reproducing the shipped bug (`idle` defaulting to `REST_GAZE`
      // instead of dead-ahead) on this same seed set pushes every ratio
      // above 0.3, most well above it. Tight against the bug class this
      // guards, not against eyefit's own known approximation.
      const tolerance = body.rx * 0.3;

      staticEyes.forEach((stat, i) => {
        const d = dist(engineEyes[i]!, { x: stat.cx, y: stat.cy });
        expect(d, `${seed} eye ${i}: engine=(${engineEyes[i]!.x.toFixed(2)},${engineEyes[i]!.y.toFixed(2)}) static=(${stat.cx.toFixed(2)},${stat.cy.toFixed(2)})`).toBeLessThan(tolerance);
      });
    });
  }
});
