import { describe, expect, test } from "bun:test";

import { _layout } from "../src/bolota";
import { contrast, fromHex, toHex } from "../src/color";
import { CHOREO, easeOutQuint, type StateId } from "../src/live/choreo";
import { createDecor, type DecorFrame, type DecorHost } from "../src/live/decor";
import { Timeline } from "../src/live/timeline";
import { FADE, FRAMES, RING_WIDTHS } from "./fixtures/decor-frames";

class FakeElement {
  attrs = new Map<string, string>();
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  attributeWrites = 0;
  childListWrites = 0;
  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}
  setAttribute(k: string, v: unknown) {
    this.attributeWrites++;
    this.attrs.set(k, String(v));
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  removeAttribute(k: string) {
    this.attributeWrites++;
    this.attrs.delete(k);
  }
  appendChild(c: FakeElement) {
    this.childListWrites++;
    c.parent = this;
    this.children.push(c);
    return c;
  }
  append(...cs: FakeElement[]) {
    for (const c of cs) this.appendChild(c);
  }
  remove() {
    const p = this.parent;
    if (!p) return;
    p.childListWrites++;
    p.children = p.children.filter((c) => c !== this);
    this.parent = null;
  }
}

class FakeDocument {
  created = 0;
  createElementNS(_ns: string, tag: string) {
    this.created++;
    return new FakeElement(tag, this);
  }
}

function deep(el: FakeElement, out: FakeElement[] = []): FakeElement[] {
  for (const c of el.children) {
    out.push(c);
    deep(c, out);
  }
  return out;
}

const tags = (el: FakeElement, tag: string) => deep(el).filter((n) => n.tagName === tag);
const shown = (nodes: FakeElement[]) => nodes.filter((n) => n.getAttribute("opacity") !== "0");
const num = (n: FakeElement, k: string) => Number(n.getAttribute(k));

interface Rig {
  doc: FakeDocument;
  host: DecorHost;
  els: { back: FakeElement; front: FakeElement; defs: FakeElement; head: FakeElement };
  layout: ReturnType<typeof _layout>;
  decor: ReturnType<typeof createDecor>;
}

function rig(seed: string): Rig {
  const doc = new FakeDocument();
  const els = {
    back: doc.createElementNS("", "g"),
    front: doc.createElementNS("", "g"),
    defs: doc.createElementNS("", "defs"),
    head: doc.createElementNS("", "g"),
  };
  const layout = _layout(seed);
  const host = els as unknown as DecorHost;
  const decor = createDecor(host, layout, layout.palette as { head: string; eye: string; bg?: string }, "t1");
  return { doc, host, els, layout, decor };
}

const one = (state: StateId, local: number, weight = 1): DecorFrame[] => [{ state, local, weight }];

const SEEDS = ["decor-a", "decor-b", "decor-c"];
const REPRESENTATIVE: [StateId, number][] = [
  ["orbit", 1.2],
  ["swirl", 0.5],
  ["play", 0.9],
  ["comet", 1.15],
  ["burst", 0.45],
  ["thinking", 1.1],
  ["alert", 0.75],
  ["exclaim", 0.8],
  ["notify", 0.9],
];

const oldFrame = (seed: string, state: StateId, t: number) => FRAMES[`${seed}|${state}|${t}`]!;

const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

function pathMatches(d: string, old: string, cx: number, cy: number): boolean {
  const a = numbers(d);
  const b = numbers(old);
  if (a.length !== b.length) return false;
  return a.every((v, i) => Math.abs(v - b[i]! - (i % 2 ? cy : cx)) <= 0.021) && d.replace(/[-\d. ]/g, "") === old.replace(/[-\d. ]/g, "");
}

describe("live decor: what each state draws", () => {
  test("states without decor create nothing", () => {
    const r = rig("decor-a");
    const created = r.doc.created;
    for (const s of ["idle", "wander", "wink", "wide", "snooze"] as StateId[]) r.decor.update(one(s, 0.5));
    expect(r.doc.created).toBe(created);
    expect(deep(r.els.back).length + deep(r.els.front).length + deep(r.els.defs).length).toBe(0);
  });

  test("element counts per state", () => {
    const want: Record<string, { grads: number; arcs: number; circles: number; bars: number }> = {
      orbit: { grads: 6, arcs: 6, circles: 0, bars: 0 },
      swirl: { grads: 3, arcs: 3, circles: 0, bars: 0 },
      play: { grads: 4, arcs: 4, circles: 0, bars: 0 },
      comet: { grads: 4, arcs: 4, circles: 0, bars: 0 },
      burst: { grads: 0, arcs: 0, circles: 3, bars: 0 },
      thinking: { grads: 0, arcs: 0, circles: 2, bars: 0 },
      alert: { grads: 0, arcs: 0, circles: 0, bars: 1 },
      exclaim: { grads: 0, arcs: 0, circles: 0, bars: 1 },
      notify: { grads: 0, arcs: 0, circles: 1, bars: 0 },
    };
    for (const [state, t] of REPRESENTATIVE) {
      const r = rig("decor-b");
      r.decor.update(one(state, t));
      const w = want[state]!;
      const grads = tags(r.els.defs, "linearGradient");
      const refs = new Set(shown(tags(r.els.back, "path").concat(tags(r.els.front, "path"))).map((p) => p.getAttribute("stroke")));
      const circles = shown(tags(r.els.back, "circle").concat(tags(r.els.front, "circle")));
      const bars = tags(r.els.front, "path").filter((p) => p.getAttribute("transform"));
      expect({ state, grads: grads.length }).toEqual({ state, grads: w.grads });
      expect({ state, arcs: w.arcs ? refs.size : 0 }).toEqual({ state, arcs: w.arcs });
      expect({ state, circles: circles.length }).toEqual({ state, circles: w.circles });
      expect({ state, bars: bars.length }).toEqual({ state, bars: w.bars });
      for (const g of grads) expect(g.children.length).toBe(3);
      expect(g_ids(grads).every((id) => id.startsWith("t1-"))).toBe(true);
    }
  });

  test("burst particles sit behind the body, the rest in front", () => {
    const b = rig("decor-a");
    b.decor.update(one("burst", 0.45));
    expect(shown(tags(b.els.back, "circle")).length).toBe(3);
    expect(tags(b.els.front, "circle").length).toBe(0);
    const t = rig("decor-a");
    t.decor.update(one("thinking", 1.1));
    expect(tags(t.els.back, "circle").length).toBe(0);
    expect(shown(tags(t.els.front, "circle")).length).toBe(2);
  });

  test("a ring is cut into a back and a front half", () => {
    const r = rig("decor-a");
    r.decor.update(one("orbit", 1.2));
    const back = shown(tags(r.els.back, "path"));
    const front = shown(tags(r.els.front, "path"));
    expect(back.length).toBeGreaterThan(0);
    expect(front.length).toBe(6);
  });
});

function g_ids(nodes: FakeElement[]): string[] {
  return nodes.map((n) => n.getAttribute("id") ?? "");
}

describe("live decor: geometry against the old engine", () => {
  let worstPath = 0;
  let worstDot = 0;
  let worstNotif = 0;

  for (const seed of SEEDS) {
    for (const [state, t] of REPRESENTATIVE) {
      test(`${state} at ${t}s on ${seed}`, () => {
        const f = oldFrame(seed, state, t);
        const r = rig(seed);
        const { cx, cy, rx } = r.layout.body;
        r.decor.update(one(state, t));

        const arcsOld = f.arcs;
        const backs = tags(r.els.back, "path");
        const fronts = tags(r.els.front, "path").filter((p) => !p.getAttribute("transform"));
        expect(backs.length).toBe(arcsOld.length);
        arcsOld.forEach(([front, back, opacity, width], i) => {
          if (front) expect(pathMatches(fronts[i]!.getAttribute("d") ?? "", front, cx, cy)).toBe(true);
          else expect(fronts[i]!.getAttribute("opacity")).toBe("0");
          if (back) expect(pathMatches(backs[i]!.getAttribute("d") ?? "", back, cx, cy)).toBe(true);
          else expect(backs[i]!.getAttribute("opacity")).toBe("0");
          const live = front ? fronts[i]! : backs[i]!;
          const dOp = Math.abs(num(live, "opacity") - opacity);
          worstPath = Math.max(worstPath, dOp);
          expect(dOp).toBeLessThan(2e-3);
          expect(Math.abs(num(live, "stroke-width") - width)).toBeLessThan(2e-3);
        });

        const offsets: [number, number][] = [];
        const around = (nx: number, ny: number, ox: number, oy: number) => offsets.push([nx - cx - ox, ny - cy - oy]);

        const round = f.dots.filter((d) => d.length === 3);
        const circles = shown(tags(r.els.back, "circle").concat(tags(r.els.front, "circle")));
        expect(circles.length).toBe(round.length + (f.notif ? 1 : 0));
        round.forEach(([x, y, radius], i) => {
          expect(Math.abs(num(circles[i]!, "r") - radius!)).toBeLessThan(0.002);
          around(num(circles[i]!, "cx"), num(circles[i]!, "cy"), x!, y!);
        });

        const glyphs = f.dots.filter((d) => d.length === 4);
        const bars = tags(r.els.front, "path").filter((p) => p.getAttribute("transform"));
        expect(bars.length).toBe(glyphs.length);
        glyphs.forEach(([x, y, rot, count], i) => {
          const m = /translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\) scale\(([-\d.]+)\)/.exec(bars[i]!.getAttribute("transform")!)!;
          around(Number(m[1]), Number(m[2]), x!, y!);
          expect(Math.abs(Number(m[3]) - rot!)).toBeLessThan(2e-3);
          expect(Math.abs(Number(m[4]) - rx)).toBeLessThan(2e-3);
          expect(numbers(bars[i]!.getAttribute("d")!).length).toBe(count!);
        });

        if (offsets.length) {
          const [sx, sy] = offsets[0]!;
          expect(Math.hypot(sx, sy)).toBeLessThan(0.1 * rx);
          for (const [ox, oy] of offsets) {
            const d = Math.max(Math.abs(ox - sx), Math.abs(oy - sy));
            worstDot = Math.max(worstDot, d);
            expect(d).toBeLessThan(0.011);
          }
        }

        if (f.notif) {
          const [nx, ny, nr, notchR] = f.notif;
          const badge = circles[circles.length - 1]!;
          const dx = Math.abs(num(badge, "cx") - cx - nx!) / rx;
          const dy = Math.abs(num(badge, "cy") - cy - ny!) / rx;
          worstNotif = Math.max(worstNotif, dx, dy);
          expect(dx).toBeLessThan(0.13);
          expect(dy).toBeLessThan(0.13);
          expect(Math.abs(num(badge, "r") - nr!)).toBeLessThan(2e-3);
          const disc = tags(r.els.defs, "circle")[0]!;
          expect(Math.abs(num(disc, "cx") - num(badge, "cx"))).toBeLessThan(1e-9);
          expect(Math.abs(num(disc, "r") - notchR!)).toBeLessThan(2e-3);
        }
      });
    }
  }

  test("seeded rings are bloub's", () => {
    const r = rig("decor-a");
    r.decor.update(one("orbit", 1.2));
    const widths = shown(tags(r.els.front, "path")).map((p) => num(p, "stroke-width"));
    widths.forEach((w, i) => expect(Math.abs(w - RING_WIDTHS[i]! * r.layout.body.rx)).toBeLessThan(2e-3));
  });

  test("worst deviations stay small", () => {
    console.log(`decor parity worst: opacity ${worstPath.toExponential(2)}, dots ${worstDot.toFixed(4)} vu, badge ${worstNotif.toFixed(4)} R`);
    expect(worstPath).toBeLessThan(2e-3);
    expect(worstDot).toBeLessThan(0.011);
    expect(worstNotif).toBeLessThan(0.03);
  });
});

describe("live decor: the host sits outside the act", () => {
  test("decor writes no transform on back, front, the mask or its contents", () => {
    const r = rig("decor-a");
    const frames: DecorFrame[][] = [
      one("thinking", 1.1),
      one("orbit", 1.7),
      one("alert", 0.75),
      one("notify", 0.9),
      [
        { state: "orbit", local: 1.7, weight: 0.4 },
        { state: "notify", local: 0.5, weight: 0.6 },
      ],
    ];
    for (const f of frames) r.decor.update(f);
    for (const host of [r.els.back, r.els.front, r.els.head]) expect(host.getAttribute("transform")).toBeNull();
    const mask = tags(r.els.defs, "mask")[0]!;
    expect(mask.getAttribute("transform")).toBeNull();
    for (const n of deep(mask)) expect(n.getAttribute("transform")).toBeNull();
    expect(tags(r.els.back, "g").concat(tags(r.els.front, "g")).every((g) => g.getAttribute("transform") === null)).toBe(true);
  });
});

describe("live decor: cross-fade", () => {
  test("opacities carry the weights", () => {
    const r = rig("decor-a");
    r.decor.update([
      { state: "orbit", local: 1.2, weight: 0.3 },
      { state: "play", local: 0.9, weight: 0.7 },
    ]);
    const fronts = shown(tags(r.els.front, "path"));
    expect(fronts.length).toBe(10);
    FADE.orbit.forEach((opacity, i) => expect(Math.abs(num(fronts[i]!, "opacity") - opacity * 0.3)).toBeLessThan(2e-3));
    FADE.play.forEach((opacity, i) => expect(Math.abs(num(fronts[6 + i]!, "opacity") - opacity * 0.7)).toBeLessThan(2e-3));
    expect(tags(r.els.defs, "linearGradient").length).toBe(10);
  });

  test("dots and the badge fade with their state's weight", () => {
    const r = rig("decor-a");
    r.decor.update([
      { state: "burst", local: 0.45, weight: 0.25 },
      { state: "notify", local: 0.9, weight: 0.75 },
    ]);
    const dots = shown(tags(r.els.back, "circle"));
    expect(dots.length).toBe(FADE.burst.length);
    FADE.burst.forEach((opacity, i) => {
      expect(num(dots[i]!, "opacity")).toBeGreaterThan(0);
      expect(num(dots[i]!, "opacity")).toBeLessThanOrEqual(opacity * 0.25 + 1e-3);
    });
    const badge = shown(tags(r.els.front, "circle"))[0]!;
    expect(num(badge, "opacity")).toBe(0.75);
    expect(num(tags(r.els.defs, "circle")[0]!, "opacity")).toBe(0.75);
  });

  test("a faded-out frame draws nothing", () => {
    const r = rig("decor-a");
    r.decor.update([
      { state: "orbit", local: 1.2, weight: 0 },
      { state: "thinking", local: 1.1, weight: 1 },
    ]);
    expect(tags(r.els.defs, "linearGradient").length).toBe(0);
    expect(shown(tags(r.els.front, "circle")).length).toBe(2);
  });

  test("Timeline.decorFrames weights follow the act blend", () => {
    const tl = new Timeline();
    tl.play("orbit", 1);
    const mid = tl.decorFrames(1.2);
    expect(mid.map((f) => f.state)).toEqual(["idle", "orbit"]);
    const k = easeOutQuint(0.2 / CHOREO.orbit.morph);
    expect(mid[1]!.weight).toBeCloseTo(k, 12);
    expect(mid[0]!.weight + mid[1]!.weight).toBeCloseTo(1, 12);
    expect(mid[1]!.local).toBeCloseTo(0.2, 12);
    const after = tl.decorFrames(1 + CHOREO.orbit.morph + 0.5);
    expect(after).toEqual([{ state: "orbit", local: CHOREO.orbit.morph + 0.5, weight: 1 }]);
  });

  test("Timeline.decorFrames wraps a looped period on each side of a fade", () => {
    const tl = new Timeline();
    tl.play("orbit", 0, { loop: true });
    tl.play("comet", 10);
    const f = tl.decorFrames(10.2);
    expect(f[0]!.state).toBe("orbit");
    expect(f[0]!.local).toBeCloseTo(10.2 % CHOREO.orbit.period!, 9);
    expect(f[1]!.state).toBe("comet");
    expect(f[1]!.local).toBeCloseTo(0.2, 9);
  });
});

describe("live decor: hot path", () => {
  test("pools reuse nodes and rewrite no child list once warm", () => {
    const r = rig("decor-a");
    const lap = () => {
      for (let t = 0; t < 3.2; t += 0.05) r.decor.update(one("orbit", t));
    };
    lap();
    const nodes = deep(r.els.back).concat(deep(r.els.front), deep(r.els.defs));
    const created = r.doc.created;
    const writes = [r.els.back, r.els.front, r.els.defs].map((e) => deep(e).concat(e).reduce((n, c) => n + c.childListWrites, 0));
    lap();
    expect(r.doc.created).toBe(created);
    expect(deep(r.els.back).concat(deep(r.els.front), deep(r.els.defs))).toEqual(nodes);
    const after = [r.els.back, r.els.front, r.els.defs].map((e) => deep(e).concat(e).reduce((n, c) => n + c.childListWrites, 0));
    expect(after).toEqual(writes);
  });

  test("an unchanged frame writes no attribute", () => {
    const r = rig("decor-b");
    for (const [state, t] of REPRESENTATIVE) {
      r.decor.update(one(state, t));
      const all = () => [r.els.back, r.els.front, r.els.defs, r.els.head].flatMap((e) => deep(e).concat(e));
      const before = all().reduce((n, c) => n + c.attributeWrites, 0);
      r.decor.update(one(state, t));
      expect({ state, writes: all().reduce((n, c) => n + c.attributeWrites, 0) - before }).toEqual({ state, writes: 0 });
    }
  });

  test("leaving a decorated state hides its nodes and then does nothing", () => {
    const r = rig("decor-a");
    r.decor.update(one("orbit", 1.2));
    r.decor.update(one("idle", 0));
    expect(shown(tags(r.els.back, "path").concat(tags(r.els.front, "path"))).length).toBe(0);
    const writes = deep(r.els.front).reduce((n, c) => n + c.attributeWrites, 0);
    r.decor.update(one("idle", 0.4));
    expect(deep(r.els.front).reduce((n, c) => n + c.attributeWrites, 0)).toBe(writes);
  });

  test("destroy removes everything it added", () => {
    const r = rig("decor-a");
    r.decor.update(one("orbit", 1.2));
    r.decor.update(one("notify", 0.9));
    r.decor.destroy();
    expect(deep(r.els.back).length + deep(r.els.front).length + deep(r.els.defs).length).toBe(0);
    expect(r.els.head.getAttribute("mask")).toBeNull();
  });

  test("importing the module and drawing a stateless frame do no trig; first decor builds lazily", async () => {
    const cos = Math.cos;
    const sin = Math.sin;
    const doc = new FakeDocument();
    const mk = (t: string) => doc.createElementNS("", t) as unknown as never;
    const layout = _layout("decor-a");
    let calls = 0;
    Math.cos = (v: number) => (calls++, cos(v));
    Math.sin = (v: number) => (calls++, sin(v));
    try {
      const fresh = (await import(`../src/live/decor.ts?fresh=${Math.random()}`)) as typeof import("../src/live/decor");
      expect(calls).toBe(0);
      const d = fresh.createDecor(
        { back: mk("g"), front: mk("g"), defs: mk("defs"), head: mk("g") } as DecorHost,
        layout,
        layout.palette as { head: string; eye: string },
        "z",
      );
      d.update([{ state: "idle", local: 0.3, weight: 1 }]);
      expect(calls).toBe(0);
      d.update([{ state: "exclaim", local: 0.3, weight: 1 }]);
      expect(calls).toBeGreaterThan(0);
    } finally {
      Math.cos = cos;
      Math.sin = sin;
    }
  });
});

describe("live decor: notify notch", () => {
  test("the mask is on the head only while the badge shows", () => {
    const r = rig("decor-a");
    const { head, defs } = r.els;
    head.setAttribute("mask", "url(#mine)");
    expect(tags(defs, "mask").length).toBe(0);

    r.decor.update(one("notify", 0.9));
    expect(head.getAttribute("mask")).toBe("url(#t1-notch)");
    const mask = tags(defs, "mask");
    expect(mask.length).toBe(1);
    expect(mask[0]!.getAttribute("id")).toBe("t1-notch");

    r.decor.update(one("notify", 1.4));
    expect(tags(defs, "mask").length).toBe(1);

    r.decor.update(one("thinking", 1.1));
    expect(tags(defs, "mask").length).toBe(0);
    expect(head.getAttribute("mask")).toBe("url(#mine)");

    r.decor.update(one("notify", 0.9));
    r.decor.update(one("idle", 0));
    expect(head.getAttribute("mask")).toBe("url(#mine)");
    r.decor.clear();
    expect(tags(defs, "mask").length).toBe(0);
  });

  test("the notch disc is concentric with the badge and larger by the margin", () => {
    const r = rig("decor-c");
    r.decor.update(one("notify", 0.9));
    const badge = shown(tags(r.els.front, "circle"))[0]!;
    const disc = tags(r.els.defs, "circle")[0]!;
    expect(num(disc, "cx")).toBe(num(badge, "cx"));
    expect(num(disc, "cy")).toBe(num(badge, "cy"));
    expect(num(disc, "r") - num(badge, "r")).toBeCloseTo(0.054 * r.layout.body.rx, 2);
  });
});

describe("live decor: colours", () => {
  test("rings clear head and backdrop, and the badge is a distinct accent", () => {
    for (const seed of ["decor-a", "decor-b", "decor-c", "ring-1", "ring-2", "ring-3"]) {
      const withBg = { ...rig(seed).layout.palette, bg: "#f4f1ea" };
      const doc = new FakeDocument();
      const els = {
        back: doc.createElementNS("", "g"),
        front: doc.createElementNS("", "g"),
        defs: doc.createElementNS("", "defs"),
        head: doc.createElementNS("", "g"),
      };
      const layout = _layout(seed);
      const d = createDecor(els as unknown as DecorHost, layout, withBg as { head: string; eye: string; bg: string }, "c");
      d.update(one("orbit", 1.2));
      d.update(one("notify", 0.9));
      const head = fromHex(withBg.head!);
      const bg = fromHex("#f4f1ea");
      for (const stop of tags(els.defs, "stop")) {
        const c = fromHex(stop.getAttribute("stop-color")!);
        expect(contrast(c, head)).toBeGreaterThanOrEqual(1.55);
        expect(contrast(c, bg)).toBeGreaterThanOrEqual(1.25);
      }
      const accent = fromHex(shown(tags(els.front, "circle"))[0]!.getAttribute("fill")!);
      expect(contrast(accent, head)).toBeGreaterThanOrEqual(1.9);
      expect(contrast(accent, bg)).toBeGreaterThanOrEqual(1.4);
      expect(Math.abs(((accent.h - head.h + 540) % 360) - 180)).toBeGreaterThanOrEqual(60);
    }
  });

  test("the notify accent stays saturated and clear of the head on every hue and lightness", () => {
    let worstChroma = 1;
    let worstContrast = 99;
    let stepped = 0;
    for (let h = 0; h < 360; h += 10) {
      for (const l of [0.35, 0.65, 0.88]) {
        const headHex = toHex({ l, c: 0.1, h });
        const doc = new FakeDocument();
        const els = {
          back: doc.createElementNS("", "g"),
          front: doc.createElementNS("", "g"),
          defs: doc.createElementNS("", "defs"),
          head: doc.createElementNS("", "g"),
        };
        const d = createDecor(els as unknown as DecorHost, _layout("decor-a"), { head: headHex, eye: "#111" }, "a");
        d.update(one("notify", 0.9));
        const accent = fromHex(shown(tags(els.front, "circle"))[0]!.getAttribute("fill")!);
        const head = fromHex(headHex);
        worstChroma = Math.min(worstChroma, accent.c);
        worstContrast = Math.min(worstContrast, contrast(accent, head));
        if (Math.abs(Math.abs(((accent.h - head.h + 540) % 360) - 180) - 180) > 3) stepped++;
        expect({ h, l, c: accent.c >= 0.12 }).toEqual({ h, l, c: true });
        expect({ h, l, k: contrast(accent, head) >= 2 }).toEqual({ h, l, k: true });
      }
    }
    console.log(`accent worst chroma ${worstChroma.toFixed(3)}, contrast ${worstContrast.toFixed(2)}, hue stepped ${stepped}/108`);
  });

  test("ring hues stay in the head's neighbourhood", () => {
    const r = rig("decor-a");
    r.decor.update(one("orbit", 1.2));
    const head = fromHex(r.layout.palette.head!);
    for (const stop of tags(r.els.defs, "stop")) {
      const c = fromHex(stop.getAttribute("stop-color")!);
      if (c.c < 0.02) continue;
      const dh = Math.abs(((c.h - head.h + 540) % 360) - 180);
      expect(dh).toBeLessThan(110);
    }
  });
});
