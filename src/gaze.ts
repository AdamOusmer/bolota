// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from blobatar (c) 2026 Alain, MIT. See LICENSE.

/**
 * Pointer pursuit: the eyes track a point.
 *
 * Two layers. `step` and `project` are the pursuit and the sphere as pure
 * arithmetic, so anything that renders frames out of order can solve a track
 * forwards without a DOM. `gaze` is the browser driver around them: it ticks
 * on the shared per-window frame loop, measures boxes only when geometry can
 * have changed, parks when nothing moves, and writes custom properties only.
 * A class would race the framework that owns `.mo-root`'s `className`.
 *
 * Inert until something sets `--mo-track-travel` on or above `.mo-eyes`.
 */

import { cancelRead, readNextFrame, startFrames, stopFrames } from "./live/frames";

/** Pursuit time constant in ms: ~63% of the way to a new target. */
export const SETTLE = 110;

/** A target jump larger than this, in aim units, is saccaded to rather than pursued. */
export const SNAP = 1.6;

/** The near field, as a fraction of the bolota's radius, where the aim eases to centre. */
export const DEADZONE = 0.55;

/** The smallest eye move worth writing, in CSS px. */
export const VISIBLE_PX = 0.15;

const EPS_MIN = 0.002;
const EPS_MAX = 0.06;

/** How close the idle-saccade hand-off must get before it stops being written. */
export const HOLD_EPS = 0.01;

export const smoothstep = (t: number) => t * t * (3 - 2 * t);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The share of the remaining distance a step of `dt` ms covers. Frame-rate independent. */
export const pursuit = (dt: number, settle: number = SETTLE) =>
  settle <= 0 ? 1 : 1 - Math.exp(-dt / settle);

/** The write threshold in aim units for a bolota `width` px wide with `travel` px of excursion. */
export function threshold(width: number, travel: number): number {
  const perUnit = travel * (width / 100);
  return perUnit > 0 ? clamp(VISIBLE_PX / perUnit, EPS_MIN, EPS_MAX) : EPS_MAX;
}

/** How far toward the limb a mark may be carried, as a fraction of the face radius. */
export const LIMB = 0.97;

/** Degrees of convergence tilt per unit of surface shear. */
export const TILT = 4;

/** One eye's rest position, as a fraction of the face's radius on each axis. */
export interface Mark {
  x: number;
  y: number;
}

export interface Projection {
  /** Offset from rest, in the same fractions the mark came in as. */
  dx: number;
  dy: number;
  /** Foreshortening, 0 to 1, relative to the mark's own resting width. */
  sx: number;
  sy: number;
  /** Convergence tilt, in degrees. */
  t: number;
}

const patch = (x: number, y: number, z: number) => {
  const r2 = x * x + y * y;
  if (r2 < 1e-9) return { sx: 1, sy: 1, sh: 0 };
  const d = Math.max(0, z);
  return {
    sx: (d * x * x + y * y) / r2,
    sy: (d * y * y + x * x) / r2,
    sh: ((d - 1) * x * y) / r2,
  };
};

/**
 * A mark on the face's sphere turned by `yaw` and `pitch` radians. Positive
 * pitch looks down, because SVG's y grows downward.
 */
export function project(m: Mark, yaw: number, pitch: number): Projection {
  const r2 = m.x * m.x + m.y * m.y;
  const k = r2 > 1 ? 1 / Math.sqrt(r2) : 1;
  const x0 = m.x * k;
  const y0 = m.y * k;
  const z0 = Math.sqrt(Math.max(0, 1 - x0 * x0 - y0 * y0));

  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = x0 * cy + z0 * sy;
  const z1 = z0 * cy - x0 * sy;

  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y1 = y0 * cp + z1 * sp;
  const z2 = z1 * cp - y0 * sp;

  const rho = Math.hypot(x1, y1);
  const over = z2 <= 0 || rho > LIMB;
  const back = over ? LIMB / (rho || 1) : 1;
  const px = x1 * back;
  const py = y1 * back;
  const pz = over ? Math.sqrt(1 - LIMB * LIMB) : z2;

  const rest = patch(x0, y0, z0);
  const now = patch(px, py, pz);
  return {
    dx: px - m.x,
    dy: py - m.y,
    sx: Math.min(1, now.sx / (rest.sx || 1)),
    sy: Math.min(1, now.sy / (rest.sy || 1)),
    t: TILT * (now.sh - rest.sh),
  };
}

/** One bolota's smoothed gaze direction, as the caller keeps it. */
export interface Aim {
  x: number;
  y: number;
}

export interface StepInput extends Aim {
  /** Pointer minus the bolota's centre, in px. */
  dx: number;
  dy: number;
  /** The bolota's radius in px, which sizes the near field. */
  radius: number;
  /** `pursuit(dt)` for this frame. */
  k: number;
  gain?: number;
  snap?: number;
}

export interface StepResult extends Aim {
  /** Where this frame aimed. */
  tx: number;
  ty: number;
  /** The share of the way it went. */
  f: number;
}

export function step(i: StepInput): StepResult {
  const d = Math.hypot(i.dx, i.dy);
  const near = i.radius > 0 ? smoothstep(Math.min(1, d / (i.radius * DEADZONE))) : 1;
  const amp = (i.gain ?? 1) * near;
  const tx = d > 0 ? (i.dx / d) * amp : 0;
  const ty = d > 0 ? (i.dy / d) * amp : 0;
  const f = Math.hypot(tx - i.x, ty - i.y) > (i.snap ?? SNAP) ? 1 : i.k;
  return { x: i.x + (tx - i.x) * f, y: i.y + (ty - i.y) * f, tx, ty, f };
}

/** The eyes as marks on the face, and the face's radii in viewBox units. */
export interface Face {
  marks: Mark[];
  rx: number;
  ry: number;
}

/**
 * Reads the face off bolota's animated markup: the body group beside
 * `.mo-eyes`, and each `.mo-eye`. SVG-space boxes only, never a client rect.
 */
export function survey(el: Element): Face | null {
  const head = el.querySelector<SVGGraphicsElement>(".mo-bob > g:not(.mo-eyes)");
  const eyes = Array.from(el.querySelectorAll<SVGGraphicsElement>(".mo-eye"));
  if (!head || !eyes.length) return null;
  try {
    const Point = el.ownerDocument.defaultView!.DOMPoint;
    const b = head.getBBox();
    const fill = Array.from(head.querySelectorAll<SVGGeometryElement>("path,circle"));
    const cx0 = b.x + b.width / 2;
    const cy0 = b.y + b.height / 2;
    const hit = (t: number, c: number, s: number) =>
      fill.some((f) =>
        f.isPointInFill(new Point(cx0 + ((t * b.width) / 2) * c, cy0 + ((t * b.height) / 2) * s)),
      );
    let fit = 1;
    for (let a = 0; a < 16; a++) {
      const r = (a / 16) * Math.PI * 2;
      const c = Math.cos(r);
      const s = Math.sin(r);
      if (hit(1, c, s)) continue;
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (hit(mid, c, s)) lo = mid;
        else hi = mid;
      }
      fit = Math.min(fit, lo);
    }
    let ix = 0;
    let iy = 0;
    const centres = eyes.map((e) => {
      const g = e.getBBox();
      ix = Math.max(ix, g.width / 2);
      iy = Math.max(iy, g.height / 2);
      return { x: g.x + g.width / 2 - cx0, y: g.y + g.height / 2 - cy0 };
    });
    let rx = Math.max(1, (b.width / 2) * fit - ix);
    let ry = Math.max(1, (b.height / 2) * fit - iy);
    let need = 0;
    for (const c of centres) need = Math.max(need, Math.hypot(c.x / rx, c.y / ry));
    if (need > 0.85) {
      rx *= need / 0.85;
      ry *= need / 0.85;
    }
    return { marks: centres.map((c) => ({ x: c.x / rx, y: c.y / ry })), rx, ry };
  } catch {
    return null;
  }
}

/**
 * What the eyes follow: a viewport point, an element's centre, the pointer,
 * the centre (`"rest"`, held), or nothing (`null`, released to idle life).
 */
export type GazeTarget = { x: number; y: number } | Element | "pointer" | "rest" | null;

export interface GazeOptions {
  settle?: number;
  snap?: number;
  target?: GazeTarget;
}

export interface Gaze {
  lookAt: (t: GazeTarget) => void;
  /** Re-reads the box, for a layout change no observer reports. */
  remeasure: () => void;
  stop: () => void;
}

type View = Window & typeof globalThis;

const GZ = ["dx", "dy", "sx", "sy", "t"];

export function gaze(el: SVGSVGElement, opts: GazeOptions = {}): Gaze {
  const view = el.ownerDocument.defaultView as View;
  const fine = view.matchMedia("(hover: hover) and (pointer: fine)");
  const still = view.matchMedia("(prefers-reduced-motion: reduce)");
  const settle = opts.settle ?? SETTLE;
  const snap = opts.snap ?? SNAP;

  let cx = 0;
  let cy = 0;
  let radius = 1;
  let width = 1;
  let travelPx = 0;
  let px = -1e6;
  let py = -1e6;
  let x = 0;
  let y = 0;
  let wx = 0;
  let wy = 0;
  let h = 0;
  let wh = 0;
  let last = 0;
  let ticking = false;
  let dirty = false;
  let on = false;
  let at: { x: number; y: number } | null = null;
  let watched: Element | null = null;
  let resting = false;
  let hold = 1;

  let target: SVGElement = el;
  let eyes: SVGGraphicsElement[] = [];
  let marks: Mark[] = [];
  let frx = 50;
  let fry = 50;
  let yaw = 0;
  let pitch = 0;

  const face = () => {
    const f = survey(el);
    if (!f) return;
    marks = f.marks;
    frx = f.rx;
    fry = f.ry;
  };

  const resolve = () => {
    target = el.querySelector<SVGElement>(".mo-eyes") ?? el;
    eyes = Array.from(el.querySelectorAll<SVGGraphicsElement>(".mo-eye"));
    face();
  };

  const follow = () => {
    if (!watched) return;
    const r = watched.getBoundingClientRect();
    at = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  const measure = () => {
    follow();
    const r = el.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    radius = Math.max(1, Math.min(r.width, r.height) / 2);
    width = Math.max(1, r.width);
    travelPx =
      parseFloat(view.getComputedStyle(target).getPropertyValue("--mo-track-travel")) || 0;
    if (!marks.length) face();
    yaw = travelPx / frx;
    pitch = travelPx / fry;
  };

  const park = () => {
    last = 0;
    if (!ticking) return;
    ticking = false;
    stopFrames(view, frame);
  };

  function frame(t: number) {
    const dt = last ? Math.min(t - last, 64) : 16;
    last = t;
    if (!target.isConnected) {
      resolve();
      measure();
      wx = wy = Infinity;
    }
    const k = pursuit(dt, settle);
    const s = step({
      x,
      y,
      dx: resting ? 0 : (at ? at.x : px) - cx,
      dy: resting ? 0 : (at ? at.y : py) - cy,
      radius,
      k,
      snap,
    });
    x = s.x;
    y = s.y;
    const eps = threshold(width, travelPx);
    let moved = false;
    if (Math.abs(s.tx - x) <= eps && Math.abs(s.ty - y) <= eps) {
      x = s.tx;
      y = s.ty;
    } else {
      moved = true;
    }
    h += (hold - h) * k;
    if (Math.abs(hold - h) <= HOLD_EPS) h = hold;
    else moved = true;
    if (Math.abs(h - wh) > HOLD_EPS) {
      wh = h;
      el.style.setProperty("--mo-track-hold", h.toFixed(3));
      moved = true;
    }
    if (Math.abs(x - wx) > eps || Math.abs(y - wy) > eps) {
      wx = x;
      wy = y;
      target.style.setProperty("--mo-track-x", x.toFixed(3));
      target.style.setProperty("--mo-track-y", y.toFixed(3));
      for (let i = 0; i < marks.length && i < eyes.length; i++) {
        const p = project(marks[i]!, x * yaw, y * pitch);
        const n = i + 1;
        target.style.setProperty(`--mo-gz-dx${n}`, (p.dx * frx).toFixed(3));
        target.style.setProperty(`--mo-gz-dy${n}`, (p.dy * fry).toFixed(3));
        target.style.setProperty(`--mo-gz-sx${n}`, p.sx.toFixed(4));
        target.style.setProperty(`--mo-gz-sy${n}`, p.sy.toFixed(4));
        target.style.setProperty(`--mo-gz-t${n}`, p.t.toFixed(3));
      }
      moved = true;
    }
    if (moved || dirty) dirty = false;
    else park();
  }

  const wake = () => {
    if (!on) return;
    dirty = true;
    if (ticking) return;
    ticking = true;
    startFrames(view, frame);
  };

  const onMove = (e: PointerEvent) => {
    px = e.clientX;
    py = e.clientY;
    wake();
  };
  const onLeave = () => {
    px = -1e6;
    py = -1e6;
    wake();
  };
  const onGeom = () => {
    if (!on) return;
    readNextFrame(view, measure);
    wake();
  };

  const resized = new view.ResizeObserver(onGeom);

  const start = () => {
    if (on) return;
    on = true;
    resolve();
    measure();
    resized.observe(el);
    if (watched) resized.observe(watched);
    view.addEventListener("pointermove", onMove, { passive: true });
    view.addEventListener("pointerleave", onLeave, { passive: true });
    view.addEventListener("scroll", onGeom, { passive: true, capture: true });
    view.addEventListener("resize", onGeom, { passive: true });
    wake();
  };

  const halt = () => {
    if (!on) return;
    on = false;
    resized.disconnect();
    view.removeEventListener("pointermove", onMove);
    view.removeEventListener("pointerleave", onLeave);
    view.removeEventListener("scroll", onGeom, { capture: true });
    view.removeEventListener("resize", onGeom);
    cancelRead(view, measure);
    park();
    x = y = wx = wy = h = wh = 0;
    target.style.removeProperty("--mo-track-x");
    target.style.removeProperty("--mo-track-y");
    for (let i = 1; i <= eyes.length; i++)
      for (const k of GZ) target.style.removeProperty(`--mo-gz-${k}${i}`);
    el.style.removeProperty("--mo-track-hold");
  };

  const sync = () => (fine.matches && !still.matches ? start() : halt());
  fine.addEventListener("change", sync);
  still.addEventListener("change", sync);
  sync();

  const aim = (t: GazeTarget) => {
    if (watched && on) resized.unobserve(watched);
    watched = at = null;
    resting = t === null || t === "rest";
    hold = t === null ? 0 : 1;
    if (typeof t !== "object" || !t) return;
    if ("getBoundingClientRect" in t) {
      watched = t;
      if (on) resized.observe(t);
      follow();
      return;
    }
    at = { x: t.x, y: t.y };
  };
  aim(opts.target ?? null);

  return {
    lookAt: (t) => {
      aim(t);
      wake();
    },
    remeasure: onGeom,
    stop: () => {
      halt();
      fine.removeEventListener("change", sync);
      still.removeEventListener("change", sync);
    },
  };
}
