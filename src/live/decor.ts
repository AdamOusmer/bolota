// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

import { contrast, ensureContrast, fromHex, mixHex, toHex, type Oklch } from "../color";
import { CHOREO, clamp, type StateId } from "./choreo";
import { edge, type OutlineLayout } from "./outline";

/**
 * What a state draws around the body rather than does to it: rings, the
 * swoosh, comet ribbons, burst particles, the thinking dots, the "!" bars and
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

interface ArcSeed {
  a: number;
  k: number;
  tilt: number;
  speed: number;
  phase: number;
  sweep: number;
  hue: number;
  hueSpan: number;
  width: number;
  cx: number;
  cy: number;
}

interface Particle {
  birth: number;
  angle: number;
  rho: number;
}

interface Seeds {
  rings: ArcSeed[];
  swoosh: ArcSeed[];
  ribbons: ArcSeed[];
  particles: Particle[];
  barUpright: string;
  barItalic: string;
}

const TAU = Math.PI * 2;
const SVG_NS = "http://www.w3.org/2000/svg";
const SEEN = 0.01;
const ARC_STEPS = 64;

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
const HAZE_STEPS = 8;
const RING_FAN = 110;
const RING_SPAN = 0.4;
const RING_VS_HEAD = 1.6;
const RING_VS_BG = 1.3;
const ACCENT_VS_HEAD = 2;
const ACCENT_VS_BG = 1.5;
const ACCENT_CHROMA = 0.19;
const ACCENT_MIN_CHROMA = 0.12;
const ACCENT_GAP = 0.1;
const ACCENT_TURNS = [180, 150, 210, 120, 240, 90, 270];

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const mod360 = (h: number) => ((h % 360) + 360) % 360;

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
  const ringRng = createRng(0xa11ce);
  const rings = Array.from({ length: 6 }, (_, i) => ({
    a: 1.3 + ringRng() * 0.1,
    k: 0.05 + ringRng() * 0.4,
    tilt: (i / 6) * Math.PI + ringRng() * 0.5,
    speed: 3 + ringRng() * 0.7,
    phase: ringRng() * TAU,
    sweep: 0.6 + ringRng() * 0.25,
    hue: (i * 360) / 6 + ringRng() * 30,
    hueSpan: 60 + ringRng() * 60,
    width: 0.05 + ringRng() * 0.012,
    cx: 0,
    cy: 0.1,
  }));
  const swoosh = Array.from({ length: 4 }, (_, i) => ({
    a: 0.78 + i * 0.2,
    k: 0.05 + i * 0.02,
    tilt: -0.62 + i * 0.05,
    speed: 0.3,
    phase: 0.06 * i,
    sweep: 0.4,
    hue: 95 + i * 62,
    hueSpan: 100,
    width: 0.05,
    cx: 0,
    cy: -0.12,
  }));
  const cometRng = createRng(0xc0e7);
  const ribbons = Array.from({ length: 4 }, (_, i) => {
    const d = i - 1.5;
    return {
      a: 0.85 * (1 + d * 0.03),
      k: (0.15 / 0.85) * (1 + d * 0.16),
      tilt: (34 * Math.PI) / 180 + d * 0.035,
      speed: 210 / 360,
      phase: -i * 0.045 + cometRng() * 0.012,
      sweep: 0.34,
      hue: i * 85 + cometRng() * 20,
      hueSpan: 80,
      width: 0.095,
      cx: 0,
      cy: 0,
    };
  });
  const particleRng = createRng(0xbeef);
  const particles = Array.from({ length: 5 }, (_, i) => ({
    birth: i * 0.2,
    angle: particleRng() * TAU,
    rho: 0.58 + particleRng() * 0.18,
  }));
  return { rings, swoosh, ribbons, particles, barUpright: barPath(0.145, 0.082), barItalic: barPath(0.12, 0.12) };
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
      return true;
    default:
      return false;
  }
}

function isOutline(l: DecorLayout): l is DecorLayout & OutlineLayout {
  return "petals" in l && "shape" in l;
}

const cells = new WeakMap<Element, Record<string, string | number>>();

function put(node: Element, key: string, value: string | number): void {
  let cache = cells.get(node);
  if (!cache) cells.set(node, (cache = {}));
  if (cache[key] === value) return;
  cache[key] = value;
  node.setAttribute(key, String(value));
}

interface Colors {
  head: string;
  accent: string;
  haze: string[] | null;
  stops(seed: ArcSeed): string[];
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
  const away = (c: Oklch, vsHead: number, vsBg: number): string => {
    const onHead = ensureContrast(c, head, vsHead);
    return toHex(bg ? ensureContrast(onHead, bg, vsBg) : onHead);
  };
  const tone = clamp(head.l + (head.l > 0.6 ? -0.2 : 0.2), 0.3, 0.8);
  const chroma = clamp(head.c * 1.15, 0.09, 0.17);
  const found = new WeakMap<ArcSeed, string[]>();
  return {
    head: palette.head,
    accent: accentOf(head, bg),
    haze: bg
      ? Array.from({ length: HAZE_STEPS }, (_, i) => mixHex(palette.bg!, palette.head, i / (HAZE_STEPS - 1)))
      : null,
    stops(seed) {
      let s = found.get(seed);
      if (!s) {
        const from = head.h + (mod360(seed.hue) / 360 - 0.5) * RING_FAN;
        s = [0, 0.5, 1].map((k) =>
          away({ l: tone, c: chroma, h: mod360(from + seed.hueSpan * RING_SPAN * k) }, RING_VS_HEAD, RING_VS_BG),
        );
        found.set(seed, s);
      }
      return s;
    },
  };
}

/** Nodes of one tag under one lazily created group, reused by position. */
class Lane<T extends Element> {
  private readonly nodes: T[] = [];
  private used = 0;
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
    for (let i = this.used; i < this.nodes.length; i++) put(this.nodes[i]!, "opacity", 0);
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
  }
}

export function createDecor(
  host: DecorHost,
  layout: DecorLayout,
  palette: DecorPalette,
  uid: string,
): Decor {
  const doc = host.back.ownerDocument;
  const { cx, cy, rx: R } = layout.body;
  const outline = isOutline(layout) ? layout : null;
  const gradId: string[] = [];
  const gradRef: string[] = [];
  const gradStops: Element[][] = [];
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
  const stroked = (node: SVGPathElement) => {
    node.setAttribute("fill", "none");
    node.setAttribute("stroke-linecap", "round");
  };
  const arcBack = new Lane<SVGPathElement>(doc, host.back, "path", {}, stroked);
  const arcFront = new Lane<SVGPathElement>(doc, host.front, "path", {}, stroked);
  const dotBack = new Lane<SVGCircleElement>(doc, host.back, "circle", {});
  const dotFront = new Lane<SVGCircleElement>(doc, host.front, "circle", {});
  const bars = new Lane<SVGPathElement>(doc, host.front, "path", {});
  const badge = new Lane<SVGCircleElement>(doc, host.front, "circle", {});
  const lanes = [arcBack, arcFront, dotBack, dotFront, bars, badge];

  const X = (v: number) => r2(cx + v * R);
  const Y = (v: number) => r2(cy + v * R);

  let pathFront = "";
  let pathBack = "";

  function trace(seed: ArcSeed, ox: number, t: number): void {
    const spin = seed.phase + t * seed.speed * TAU;
    const cu = Math.cos(seed.tilt);
    const su = Math.sin(seed.tilt);
    const kz = Math.sqrt(Math.max(0, 1 - seed.k * seed.k));
    const span = seed.sweep * TAU;
    let front = "";
    let back = "";
    let prev: boolean | null = null;
    for (let i = 0; i <= ARC_STEPS; i++) {
      const th = spin + (i / ARC_STEPS) * span;
      const ct = Math.cos(th);
      const st = Math.sin(th);
      const x = seed.a * (ct * cu - st * su * seed.k) + ox;
      const y = seed.a * (ct * su + st * cu * seed.k) + seed.cy;
      const behind = seed.a * st * kz < 0;
      const cmd = behind !== prev ? "M" : "L";
      if (behind) back += `${cmd}${X(x)} ${Y(y)}`;
      else front += `${cmd}${X(x)} ${Y(y)}`;
      prev = behind;
    }
    pathFront = front;
    pathBack = back;
  }

  function arc(seed: ArcSeed, ox: number, t: number, opacity: number): void {
    if (opacity <= SEEN) return;
    colors ??= colorsOf(palette);
    trace(seed, ox, t);
    const grad = grads.next();
    const g = grads.index();
    const gx = Math.cos(seed.tilt) * seed.a * R;
    const gy = Math.sin(seed.tilt) * seed.a * R;
    put(grad, "x1", r2(cx + ox * R - gx));
    put(grad, "y1", r2(cy + seed.cy * R - gy));
    put(grad, "x2", r2(cx + ox * R + gx));
    put(grad, "y2", r2(cy + seed.cy * R + gy));
    const stops = colors.stops(seed);
    for (let s = 0; s < 3; s++) put(gradStops[g]![s]!, "stop-color", stops[s]!);
    const width = r3(seed.width * R);
    const op = r3(opacity);
    const half = (lane: Lane<SVGPathElement>, d: string) => {
      const path = lane.next();
      if (d === "") {
        put(path, "opacity", 0);
        return;
      }
      put(path, "d", d);
      put(path, "stroke", gradRef[g]!);
      put(path, "stroke-width", width);
      put(path, "opacity", op);
    };
    half(arcBack, pathBack);
    half(arcFront, pathFront);
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
      case "play": {
        const fade = clamp(t / 0.35) * clamp((2.2 - t) / 0.5);
        for (const seed of s.swoosh) arc(seed, 0.45 - t * 0.42, t, fade * w);
        break;
      }
      case "orbit": {
        const fade = clamp(t / 0.8) * clamp((ORBIT_PERIOD - t) / 0.9);
        s.rings.forEach((seed, i) => arc(seed, 0, t, fade * clamp((t - i * 0.13) / 0.3) * w));
        break;
      }
      case "swirl":
        for (let i = 0; i < 3; i++) {
          arc(s.rings[i]!, 0, t, clamp((t - i * 0.06) / 0.14) * clamp((1.22 - t) / 0.34) * w);
        }
        break;
      case "comet": {
        const fade = clamp((t - 0.15) / 0.25) * clamp((1.95 - t) / 0.3);
        for (const seed of s.ribbons) arc(seed, 0, t, fade * w);
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
