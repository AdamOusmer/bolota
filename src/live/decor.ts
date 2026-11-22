// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

import { contrast, fromHex, mixHex, toHex, type Oklch } from "../color";
import type { StateId } from "./choreo";
import { edge, type OutlineLayout } from "./outline";
import { putter } from "./put";
import { BODY, cageTurn, hashString, ribbonPalette, ribbonPieces, rimOf, runAt, workTurn, type Rim } from "./ribbons";
import { CHOREO, WORK_AT, alarm, clamp, r3 } from "./shared";

/**
 * What a state draws around the body rather than does to it: the ribbons
 * (open-bot-avatar's hoops, see `ribbons.ts`), burst particles, the thinking dots, the "!" bars and
 * the notification badge with its notch. Geometry and timing are bloub's
 * (`bloub/decor.ts` and the `pose` of each state in `bloub/states.ts`); the
 * paint is the seed's own, a short OKLCh ramp off `palette.head`.
 *
 * Positions are body units about the body centre (R = `body.rx`), written in
 * absolute viewBox units. The host groups, and `head` as the mask target, sit
 * outside the act transform, so decor stays where bloub drew it while the body
 * shrinks, rolls and travels.
 */

export interface DecorHost {
  back: SVGGElement;
  front: SVGGElement;
  defs: SVGDefsElement;
  head: SVGGElement;
}

export interface DecorPalette {
  head: string;
  eye: string;
  bg?: string;
}

/** One state's contribution at an instant; weights sum to 1 across a cross-fade. */
export interface DecorFrame {
  state: StateId;
  local: number;
  weight: number;
}

export interface Decor {
  /** Draws the frames; whether any decoration is on show, so a renderer knows to keep going. */
  update(frames: readonly DecorFrame[]): boolean;
  clear(): void;
  destroy(): void;
}

export interface DecorLayout {
  body: { cx: number; cy: number; rx: number };
}

interface Particle {
  birth: number;
  angle: number;
  rho: number;
}

interface Seeds {
  particles: Particle[];
  barUpright: string;
  barItalic: string;
}

const TAU = Math.PI * 2;
const SVG_NS = "http://www.w3.org/2000/svg";
const SEEN = 0.01;
const SHORT = 0.01;

const DOT_X = [-0.557, -0.013, 0.532] as const;
const DOT_R = 0.165;
const DOT_PEAK = 1.25;
const NOTIF_ANGLE = (-42 * Math.PI) / 180;
const NOTIF_DIST = 1.003;
const NOTIF_R = 0.15;
const NOTIF_POP = 1.14;
const NOTIF_MARGIN = 0.054;
const GLYPH_DOT_CY = 0.42;
const GLYPH_BAR_CY = -0.55;
const GLYPH_AXIS = GLYPH_DOT_CY - GLYPH_BAR_CY;
const ORBIT_PERIOD = 4 / 1.25;
const PLAY_SPAN = 2.2;
const SWIRL_SPAN = 1.22;
const COMET_FROM = 0.15;
const COMET_SPAN = 1.8;
const HAZE_STEPS = 8;
const ACCENT_VS_HEAD = 2;
const ACCENT_VS_BG = 1.5;
const ACCENT_CHROMA = 0.19;
const ACCENT_MIN_CHROMA = 0.12;
const ACCENT_GAP = 0.1;
const ACCENT_TURNS = [180, 150, 210, 120, 240, 90, 270];

const r2 = (v: number) => Math.round(v * 100) / 100;
const mod360 = (h: number) => ((h % 360) + 360) % 360;

const CENTS_SPAN = 20000;
const centsText: (string | undefined)[] = [];

/** `r2(v)` as text, from a table: a path is rewritten each frame from the same few thousand values. */
function cents(v: number): string {
  const i = Math.round(v * 100);
  if (i < -CENTS_SPAN || i >= CENTS_SPAN) return String(i / 100);
  return (centsText[i + CENTS_SPAN] ??= String(i / 100));
}

function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The tapered bar of the "!" as a closed path in body units: the hull of two circles on the y axis. */
function barPath(r1: number, r2v: number): string {
  const steps = 96;
  const y1 = -0.5;
  const y2 = 0.5;
  const dist = y2 - y1;
  const base = Math.PI / 2;
  const spread = Math.acos(Math.max(-1, Math.min(1, (r1 - r2v) / dist)));
  let d = "";
  for (let i = 0; i <= steps / 2; i++) {
    const a = base + spread + ((TAU - 2 * spread) * i) / (steps / 2);
    d += `${i === 0 ? "M" : "L"}${r2(Math.cos(a) * r1)} ${r2(y1 + Math.sin(a) * r1)}`;
  }
  for (let i = 0; i <= steps / 2; i++) {
    const a = base - spread + ((2 * spread) * i) / (steps / 2);
    d += `L${r2(Math.cos(a) * r2v)} ${r2(y2 + Math.sin(a) * r2v)}`;
  }
  return `${d}Z`;
}

function buildSeeds(): Seeds {
  const particleRng = createRng(0xbeef);
  const particles = Array.from({ length: 5 }, (_, i) => ({
    birth: i * 0.2,
    angle: particleRng() * TAU,
    rho: 0.58 + particleRng() * 0.18,
  }));
  return { particles, barUpright: barPath(0.145, 0.082), barItalic: barPath(0.12, 0.12) };
}

let seeds: Seeds | null = null;
const getSeeds = (): Seeds => seeds ?? (seeds = buildSeeds());

function bears(state: StateId): boolean {
  switch (state) {
    case "thinking":
    case "alert":
    case "exclaim":
    case "notify":
    case "play":
    case "orbit":
    case "swirl":
    case "burst":
    case "comet":
    case "working":
    case "blocked":
    case "done":
      return true;
    default:
      return false;
  }
}

function isOutline(l: DecorLayout): l is DecorLayout & OutlineLayout {
  return "petals" in l && "shape" in l;
}

const put = putter();

interface Colors {
  head: string;
  accent: string;
  haze: string[] | null;
}

/**
 * A saturated accent off the head's complement: the lightness nearest the
 * side of the head it can clear (lighter on a dark head, darker on a light
 * one) that still reads at `ACCENT_CHROMA` once resolved to sRGB. Chroma is
 * never given up for contrast; a hue that cannot manage both is stepped aside.
 */
function accentOf(head: Oklch, bg: Oklch | null): string {
  const lean = head.l > 0.75 ? -1 : 1;
  for (const withBg of [true, false]) {
    for (const turn of ACCENT_TURNS) {
      for (const dir of [lean, -lean]) {
        for (let i = 0; i <= 28; i++) {
          const l = clamp(head.l + dir * (ACCENT_GAP + i * 0.02), 0.2, 0.95);
          const hex = toHex({ l, c: ACCENT_CHROMA, h: mod360(head.h + turn) });
          const got = fromHex(hex);
          if (got.c < ACCENT_MIN_CHROMA || contrast(got, head) < ACCENT_VS_HEAD) continue;
          if (withBg && bg && contrast(got, bg) < ACCENT_VS_BG) continue;
          return hex;
        }
      }
    }
  }
  return toHex({ l: lean < 0 ? 0.3 : 0.85, c: ACCENT_CHROMA, h: mod360(head.h + 180) });
}

function colorsOf(palette: DecorPalette): Colors {
  const head = fromHex(palette.head);
  const bg = palette.bg ? fromHex(palette.bg) : null;
  return {
    head: palette.head,
    accent: accentOf(head, bg),
    haze: bg
      ? Array.from({ length: HAZE_STEPS }, (_, i) => mixHex(palette.bg!, palette.head, i / (HAZE_STEPS - 1)))
      : null,
  };
}

/** Nodes of one tag under one lazily created group, reused by position. */
class Lane<T extends Element> {
  private readonly nodes: T[] = [];
  private used = 0;
  private shown = 0;
  private group: Element | null = null;

  constructor(
    private readonly doc: Document,
    private readonly parent: Element,
    private readonly tag: string,
    private readonly groupAttrs: Record<string, string> | null,
    private readonly made?: (node: T, index: number) => void,
  ) {}

  begin(): void {
    this.used = 0;
  }

  next(): T {
    const i = this.used++;
    if (i < this.nodes.length) return this.nodes[i]!;
    if (!this.group && this.groupAttrs) {
      this.group = this.doc.createElementNS(SVG_NS, "g");
      for (const k in this.groupAttrs) this.group.setAttribute(k, this.groupAttrs[k]!);
      this.parent.appendChild(this.group);
    }
    const node = this.doc.createElementNS(SVG_NS, this.tag) as unknown as T;
    this.made?.(node, i);
    (this.group ?? this.parent).appendChild(node);
    this.nodes.push(node);
    return node;
  }

  end(): void {
    for (let i = this.used; i < this.shown; i++) put(this.nodes[i]!, "opacity", 0);
    this.shown = this.used;
  }

  index(): number {
    return this.used - 1;
  }

  destroy(): void {
    if (this.group) this.group.remove();
    else for (const node of this.nodes) node.remove();
    this.group = null;
    this.nodes.length = 0;
    this.used = 0;
    this.shown = 0;
  }
}

export function createDecor(
  host: DecorHost,
  layout: DecorLayout,
  palette: DecorPalette,
  uid: string,
  name: string = uid,
): Decor {
  const doc = host.back.ownerDocument;
  const { cx, cy, rx: R } = layout.body;
  const outline = isOutline(layout) ? layout : null;
  const gradId: string[] = [];
  const gradRef: string[] = [];
  const gradStops: Element[][] = [];
  const seed = hashString(name);
  let K = 0;
  let rim: Rim | undefined;
  let runs: ReturnType<typeof ribbonPalette> | null = null;
  let colors: Colors | null = null;
  let mask: SVGMaskElement | null = null;
  let maskRect: SVGRectElement | null = null;
  let maskDisc: SVGCircleElement | null = null;
  let maskWas: string | null = null;
  let notchX = 0;
  let notchY = 0;
  let notchR = 0;
  let notchW = 0;
  let dirty = false;

  const grads = new Lane<SVGLinearGradientElement>(doc, host.defs, "linearGradient", null, (node, i) => {
    gradId[i] = `${uid}-g${i}`;
    gradRef[i] = `url(#${gradId[i]})`;
    node.setAttribute("id", gradId[i]!);
    node.setAttribute("gradientUnits", "userSpaceOnUse");
    gradStops[i] = [0, 1, 2].map((s) => {
      const stop = doc.createElementNS(SVG_NS, "stop");
      stop.setAttribute("offset", String(s / 2));
      node.appendChild(stop);
      return stop;
    });
  });
  const ribBack = new Lane<SVGPathElement>(doc, host.back, "path", {});
  const ribFront = new Lane<SVGPathElement>(doc, host.front, "path", {});
  const dotBack = new Lane<SVGCircleElement>(doc, host.back, "circle", {});
  const dotFront = new Lane<SVGCircleElement>(doc, host.front, "circle", {});
  const bars = new Lane<SVGPathElement>(doc, host.front, "path", {});
  const badge = new Lane<SVGCircleElement>(doc, host.front, "circle", {});
  const lanes = [ribBack, ribFront, dotBack, dotFront, bars, badge];

  const X = (v: number) => r2(cx + v * R);
  const Y = (v: number) => r2(cy + v * R);

  const RX = (v: number) => cents(cx + v * K);
  const RY = (v: number) => cents(cy + v * K);

  /** Decor units per ribbon unit: the body's larger side spans `BODY` of them, as open-bot-avatar sizes its ribbons. */
  function scale(): number {
    if (!outline) return R / (BODY / 2);
    const wide = edge(outline, 0) + edge(outline, Math.PI);
    const tall = edge(outline, Math.PI / 2) + edge(outline, -Math.PI / 2);
    return Math.max(wide, tall) / BODY;
  }

  function reach(angle: number): number {
    const far = Math.max(edge(outline!, angle), edge(outline!, angle + Math.PI));
    return far / K;
  }

  function ribbons(turn: { presence: number; sweep: number }, cage: number, weight: number): void {
    const presence = turn.presence * weight;
    if (presence <= SEEN) return;
    K ||= scale();
    if (outline && !rim) rim = rimOf(reach);
    runs ??= ribbonPalette(palette.head, seed);
    for (const p of ribbonPieces(presence, seed, turn.sweep, cage, rim)) {
      const run = runs[p.ribbon]!;
      const [s0, s1] = p.along;
      const path = (p.front ? ribFront : ribBack).next();
      let d = "M" + RX(p.pts[0]!) + " " + RY(p.pts[1]!);
      for (let q = 2; q < p.pts.length; q += 2) d += "L" + RX(p.pts[q]!) + " " + RY(p.pts[q + 1]!);
      put(path, "d", d + "Z");
      put(path, "opacity", 1);
      if (Math.hypot(p.to[0] - p.from[0], p.to[1] - p.from[1]) <= SHORT) {
        put(path, "fill", runAt(run, (s0 + s1) / 2));
        continue;
      }
      const grad = grads.next();
      const g = grads.index();
      put(grad, "x1", RX(p.from[0]));
      put(grad, "y1", RY(p.from[1]));
      put(grad, "x2", RX(p.to[0]));
      put(grad, "y2", RY(p.to[1]));
      put(gradStops[g]![0]!, "stop-color", runAt(run, s0));
      put(gradStops[g]![1]!, "stop-color", runAt(run, (s0 + s1) / 2));
      put(gradStops[g]![2]!, "stop-color", runAt(run, s1));
      put(path, "fill", gradRef[g]!);
    }
  }

  function disc(lane: Lane<SVGCircleElement>, x: number, y: number, r: number, fill: string, opacity: number): void {
    if (opacity <= SEEN || r <= 0.0005) return;
    const c = lane.next();
    put(c, "cx", X(x));
    put(c, "cy", Y(y));
    put(c, "r", r3(r * R));
    put(c, "fill", fill);
    put(c, "opacity", r3(opacity));
  }

  function bar(d: string, x: number, y: number, rot: number, opacity: number): void {
    const p = bars.next();
    put(p, "d", d);
    put(p, "transform", `translate(${X(x)} ${Y(y)}) rotate(${r3(rot)}) scale(${r3(R)})`);
    put(p, "fill", colors!.head);
    put(p, "opacity", r3(opacity));
  }

  function particles(t: number, weight: number): void {
    for (const p of getSeeds().particles) {
      const u = t - p.birth;
      if (u < 0 || u > 0.62) continue;
      const rho = p.rho * Math.pow(0.75, u * 10);
      const a = p.angle + (u * 100 * Math.PI) / 180;
      const depth = clamp(1 - rho / 0.8);
      const opacity = clamp(u / 0.06) * clamp((0.62 - u) / 0.08);
      const r = 0.04 + 0.028 * clamp(u / 0.55);
      const haze = colors!.haze;
      if (haze) {
        disc(dotBack, Math.cos(a) * rho, Math.sin(a) * rho, r, haze[Math.round(depth * (HAZE_STEPS - 1))]!, opacity * weight);
      } else {
        disc(dotBack, Math.cos(a) * rho, Math.sin(a) * rho, r, colors!.head, opacity * weight * (0.35 + 0.65 * depth));
      }
    }
  }

  function thinking(t: number, weight: number): void {
    const emerge = 0.3 + 0.7 * (1 - (1 - clamp(t / 0.3)) ** 3);
    for (let i = 0; i < 3; i += 2) {
      const p = ((((t - i * 0.5) / 1.5) % 1) + 1) % 1;
      const k = clamp((p < 0.5 ? 0.5 - 0.5 * Math.cos(p * TAU) : 0) * 2);
      disc(dotFront, DOT_X[i]! * emerge, 0, DOT_R * (1 + (DOT_PEAK - 1) * k), colors!.head, (0.55 + 0.45 * k) * weight);
    }
  }

  function alert(t: number, weight: number): void {
    const body = CHOREO.alert.act(t);
    const buzz = Math.sin(t * 2.5 * TAU) * 0.005;
    const tilt = (17.7 * Math.PI) / 180;
    bar(
      getSeeds().barItalic,
      body.x + Math.sin(tilt) * GLYPH_AXIS,
      body.y - Math.cos(tilt) * GLYPH_AXIS - buzz,
      (tilt * 180) / Math.PI,
      weight,
    );
  }

  function notify(t: number, weight: number): void {
    const p = clamp(t / 0.45);
    const pop = 1 + (NOTIF_POP - 1) * Math.sin(p * Math.PI) * (1 - p * 0.35);
    const r = NOTIF_R * (p < 1 ? pop : 1);
    const fit = outline ? edge(outline, NOTIF_ANGLE) / R : 1;
    const x = Math.cos(NOTIF_ANGLE) * NOTIF_DIST * fit;
    const y = Math.sin(NOTIF_ANGLE) * NOTIF_DIST * fit;
    disc(badge, x, y, r, colors!.accent, weight);
    if (weight > notchW) {
      notchX = x;
      notchY = y;
      notchR = r + NOTIF_MARGIN;
      notchW = weight;
    }
  }

  function frame(f: DecorFrame): void {
    const t = f.local;
    const w = f.weight;
    const s = getSeeds();
    switch (f.state) {
      case "play":
        ribbons(workTurn(t, PLAY_SPAN), 0, w);
        break;
      case "orbit":
        ribbons(cageTurn(t, ORBIT_PERIOD), 1, w);
        break;
      case "swirl":
        ribbons(workTurn(t, SWIRL_SPAN), 0, w);
        break;
      case "comet":
        ribbons(workTurn(t - COMET_FROM, COMET_SPAN), 0, w);
        break;
      case "working":
        ribbons(workTurn(t - WORK_AT), 0, w);
        break;
      case "done":
        ribbons(cageTurn(t), 1, w);
        break;
      case "blocked": {
        const a = alarm(t);
        bar(s.barUpright, 0, GLYPH_BAR_CY - 0.09 * a.jump, (a.turn * 180) / Math.PI, w);
        break;
      }
      case "burst":
        particles(t, w);
        break;
      case "thinking":
        thinking(t, w);
        break;
      case "alert":
        alert(t, w);
        break;
      case "exclaim":
        bar(s.barUpright, 0, GLYPH_BAR_CY, 0, w);
        break;
      case "notify":
        notify(t, w);
        break;
    }
  }

  function attachMask(): void {
    if (!mask) {
      mask = doc.createElementNS(SVG_NS, "mask");
      mask.setAttribute("id", `${uid}-notch`);
      mask.setAttribute("maskUnits", "userSpaceOnUse");
      mask.setAttribute("x", String(r2(cx - 3 * R)));
      mask.setAttribute("y", String(r2(cy - 3 * R)));
      mask.setAttribute("width", String(r2(6 * R)));
      mask.setAttribute("height", String(r2(6 * R)));
      maskRect = doc.createElementNS(SVG_NS, "rect");
      maskRect.setAttribute("x", String(r2(cx - 3 * R)));
      maskRect.setAttribute("y", String(r2(cy - 3 * R)));
      maskRect.setAttribute("width", String(r2(6 * R)));
      maskRect.setAttribute("height", String(r2(6 * R)));
      maskRect.setAttribute("fill", "#fff");
      maskDisc = doc.createElementNS(SVG_NS, "circle");
      maskDisc.setAttribute("fill", "#000");
      mask.append(maskRect, maskDisc);
      host.defs.appendChild(mask);
      maskWas = host.head.getAttribute("mask");
      host.head.setAttribute("mask", `url(#${uid}-notch)`);
    }
    put(maskDisc!, "cx", X(notchX));
    put(maskDisc!, "cy", Y(notchY));
    put(maskDisc!, "r", r3(notchR * R));
    put(maskDisc!, "opacity", r3(notchW));
  }

  function detachMask(): void {
    if (!mask) return;
    mask.remove();
    if (maskWas === null) host.head.removeAttribute("mask");
    else host.head.setAttribute("mask", maskWas);
    mask = maskRect = maskDisc = null;
    maskWas = null;
  }

  function settle(): void {
    for (const lane of lanes) lane.end();
    if (notchW > SEEN) attachMask();
    else detachMask();
  }

  return {
    update(frames) {
      let drawn = false;
      for (const f of frames) if (f.weight > SEEN && bears(f.state)) drawn = true;
      if (!drawn && !dirty) return false;
      dirty = drawn;
      grads.begin();
      for (const lane of lanes) lane.begin();
      notchW = 0;
      if (drawn) {
        colors ??= colorsOf(palette);
        for (const f of frames) if (f.weight > SEEN) frame(f);
      }
      settle();
      return drawn;
    },
    clear() {
      for (const lane of lanes) {
        lane.begin();
        lane.end();
      }
      notchW = 0;
      detachMask();
      dirty = false;
    },
    destroy() {
      detachMask();
      grads.destroy();
      for (const lane of lanes) lane.destroy();
      dirty = false;
    },
  };
}
