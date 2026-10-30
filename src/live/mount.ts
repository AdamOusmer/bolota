// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

import type { EngineHandle } from "../engine";
import { HOLD_EPS, pursuit, project, step, threshold, type Mark } from "../gaze";
import { _layout, parts, type BolotaOptions } from "../bolota";
import type { Expression } from "../expression";
import { r3, type Pose } from "../morph";
import { actTransform, type Act } from "./act";
import { CHOREO, TRACK_TURN, expressed, type Eyes, type StateId } from "./choreo";
import { createDecor, type DecorFrame } from "./decor-stub";
import { fitEyes, type Correction } from "./fit";
import { cancelRead, readNextFrame, startFrames, stopFrames } from "./frames";
import { ALIASES, resolveExpression } from "./names";
import { cueBlink, eyeRig, faceEyes, type EyeRig } from "./rig";
import { Timeline, frameDt, type PlayOptions } from "./timeline";
import { uprightTransform } from "./upright";

export type LiveOptions = Omit<BolotaOptions, "expression"> & { expression?: string };

const SVG_NS = "http://www.w3.org/2000/svg";

/** Seconds a woken engine stays registered after the last thing that moved. */
const QUIET = 1;

/** The gaze excursion, in viewBox units, when the host sets no `--mo-track-travel`. */
const TRAVEL = 3;

const POSE_VARS = [
  "esx", "esy", "tilt", "edy", "edx", "esx2", "esy2", "tilt2", "edy2", "epx", "lock", "shake", "bdy",
].map((k) => `--mo-${k}`);

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const turnRad = (TRACK_TURN * Math.PI) / 180;

const statics: Partial<Record<StateId, boolean>> = {};

/** Whether a state's act and eyes are the same at every instant of its span. */
function isStatic(id: StateId): boolean {
  let known = statics[id];
  if (known === undefined) {
    const c = CHOREO[id];
    const span = c.period ?? c.duration + c.morph;
    const at = (i: number) => JSON.stringify([c.act((i / 8) * span), c.eyes((i / 8) * span)]);
    const first = at(0);
    known = true;
    for (let i = 1; i <= 8 && known; i++) known = at(i) === first;
    statics[id] = known;
  }
  return known;
}

type Rect = SVGRectElement;
type Fallback = Timeline & { decorFrames?: (now: number) => DecorFrame[] };

export function mountLive(svg: SVGSVGElement, name: string, opts: LiveOptions = {}): EngineHandle {
  const doc = svg.ownerDocument;
  const view = doc.defaultView as Window & typeof globalThis;
  const { expression: initial, ...base } = opts;
  const L = _layout(name, base);
  const palette = L.palette;
  const { cx: bx, cy: by, rx: R } = L.body;
  const reduced = !!view.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const tl: Fallback = new Timeline();
  const out: Correction = { pull: 0, shrink: 1 };
  const marks: Mark[] = L.eyes.map((e) => ({ x: (e.cx - L.face.cx) / L.face.rx, y: (e.cy - L.face.cy) / L.face.ry }));

  const undo: (() => void)[] = [];
  const added: Element[] = [];
  const written = new WeakMap<Element, Record<string, string | null>>();
  let swaps: [Element, Element, Element][] = [];
  let built = false;
  let dead = false;
  let paused = false;
  let host!: SVGElement;
  let breathe!: Element;
  let bob!: Element;
  let figure!: SVGGElement;
  let bodyG!: Element;
  let kids: Element[] = [];
  let actG!: SVGGElement;
  let eyesG!: Element;
  let eyeEls: Element[] = [];
  let rects: Rect[] = [];
  let decor!: ReturnType<typeof createDecor>;
  let decorOn = false;

  let clock = 0;
  let last = 0;
  let cuedTo = -1e-6;
  let liveAt = 0;
  let running = false;
  let rest: StateId = "idle";
  let restLoop = false;
  let exprPose: Pose | null = null;
  let stillId: StateId = "idle";
  let enteredState: StateId = "idle";
  let enteredAt = 0;

  let following = false;
  let pointer: { x: number; y: number } | null = null;
  let ax = 0;
  let ay = 0;
  let hold = 0;
  let gcx = 0;
  let gcy = 0;
  let gradius = 1;
  let gwidth = 1;
  let travel = TRAVEL;
  let measured = false;
  let detach: (() => void) | null = null;
  let resized: ResizeObserver | null = null;

  const mk = <K extends keyof SVGElementTagNameMap>(tag: K) => doc.createElementNS(SVG_NS, tag);

  function snapshot(el: Element, attrs: string[]): void {
    const was = attrs.map((a) => el.getAttribute(a));
    undo.push(() => attrs.forEach((a, i) => (was[i] === null ? el.removeAttribute(a) : el.setAttribute(a, was[i]!))));
  }

  function put(el: Element, key: string, value: string | null): boolean {
    let seen = written.get(el);
    if (!seen) written.set(el, (seen = Object.create(null) as Record<string, string | null>));
    if (key in seen && seen[key] === value) return false;
    seen[key] = value;
    if (key.startsWith("--")) {
      const style = (el as SVGElement).style;
      if (value === null) style.removeProperty(key);
      else style.setProperty(key, value);
    } else if (value === null) el.removeAttribute(key);
    else el.setAttribute(key, value);
    return true;
  }

  function setRig(rect: Element, a: EyeRig): void {
    for (const k of ["x", "y", "width", "height", "rx", "ry", "transform"] as const) put(rect, k, a[k]);
  }

  function build(): void {
    if (built) return;
    built = true;
    snapshot(svg, ["style", "class", "viewBox", "overflow", "data-mo-still", "data-mo-blink"]);
    let found = svg.querySelector(".mo-breathe");
    if (!found) {
      const p = parts(name, { ...base, animate: base.animate ?? "always" });
      if (p.bg) {
        const plate = mk("path");
        plate.setAttribute("d", p.bg.d);
        plate.setAttribute("fill", p.bg.fill);
        svg.insertBefore(plate, svg.firstChild);
        added.push(plate);
      }
      const root = mk("g");
      root.setAttribute("class", p.cls ?? "");
      root.innerHTML = p.inner;
      svg.appendChild(root);
      added.push(root);
      for (const k in p.vars) svg.style.setProperty(k, p.vars[k]!);
      found = root.querySelector(".mo-breathe")!;
    }
    breathe = found;
    host = breathe.parentNode as SVGElement;
    snapshot(host, ["style", "class"]);

    for (const el of [svg, host]) {
      for (const k of POSE_VARS) el.style.removeProperty(k);
      const cls = el.getAttribute("class");
      if (cls && /\bmo-expr\b/.test(cls)) el.setAttribute("class", cls.replace(/\s*\bmo-expr\b/, ""));
    }
    svg.style.setProperty("--mo-head", palette.head!);
    svg.style.setProperty("--mo-eye", palette.eye!);
    if (!svg.hasAttribute("viewBox")) svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("overflow", "visible");

    eyesG = breathe.querySelector(".mo-eyes")!;
    snapshot(eyesG, ["style", "transform", "opacity"]);
    eyeEls = Array.from(breathe.querySelectorAll(".mo-eye"));
    rects = eyeEls.map((eye, i) => {
      snapshot(eye, ["style"]);
      const first = eye.firstElementChild!;
      const mine = first.firstElementChild?.tagName === "rect";
      const rect = mine ? (first.firstElementChild as Rect) : mk("rect");
      if (!mine) {
        const g = mk("g");
        g.appendChild(rect);
        eye.replaceChild(g, first);
        swaps.push([eye, g, first]);
      }
      setRig(rect, eyeRig(L.eyes[i]!));
      return rect;
    });

    bob = breathe.firstElementChild!;
    kids = Array.from(bob.children);
    bodyG = kids[0]!;
    snapshot(bodyG, ["fill"]);
    snapshot(eyesG, ["fill"]);
    figure = mk("g");
    figure.setAttribute("data-mo-figure", "");
    actG = mk("g");
    actG.setAttribute("class", "mo-act");
    const back = mk("g");
    const front = mk("g");
    const defs = mk("defs");
    const headG = mk("g");
    headG.setAttribute("data-mo-head", "");
    headG.appendChild(actG);
    figure.append(defs, back, headG, front);
    kids.forEach((k) => actG.appendChild(k));
    bob.appendChild(figure);
    decor = createDecor({ back, front, defs, head: headG }, L, { head: palette.head!, eye: palette.eye!, bg: palette.bg }, Math.random().toString(36).slice(2, 8));
  }

  function paint(act: Act, e: Eyes, tx: number, ty: number, weight: number): boolean {
    const turn = act.rot * act.upright;
    let changed = put(actG, "transform", actTransform(act, R, bx, by));
    changed = put(eyesG, "transform", uprightTransform(act, bx, by) || null) || changed;
    changed = put(eyesG, "opacity", e.alpha >= 1 ? null : r3(e.alpha)) || changed;
    const head = weight > 0 ? { ...e.head, yaw: e.head.yaw * (1 - weight) } : e.head;
    const boxes = faceEyes(L, { pose: e.pose, own: e.own, head }, turn);
    const kx = e.track.x + tx;
    const ky = e.track.y + ty;
    if (kx || ky) {
      const yaw = e.track.x * turnRad + (tx * travel) / L.face.rx;
      const pitch = e.track.y * turnRad + (ty * travel) / L.face.ry;
      boxes.forEach((b, i) => {
        const p = project(marks[i]!, yaw, pitch);
        b.cx += p.dx * L.face.rx;
        b.cy += p.dy * L.face.ry;
        b.rx *= p.sx;
        b.ry *= p.sy;
        b.rot += p.t;
      });
    }
    fitEyes(L, boxes, turn, out);
    boxes.forEach((b, i) => {
      const a = eyeRig(b);
      for (const k of ["x", "y", "width", "height", "rx", "ry", "transform"] as const) changed = put(rects[i]!, k, a[k]) || changed;
      changed = put(eyeEls[i]!, "--mo-lean", String(Math.round(b.rot * 100) / 100)) || changed;
    });
    changed = put(eyesG, "--mo-track-x", kx ? kx.toFixed(3) : null) || changed;
    changed = put(eyesG, "--mo-track-y", ky ? ky.toFixed(3) : null) || changed;
    return changed;
  }

  function still(): void {
    build();
    const c = CHOREO[stillId];
    paint(c.act(c.still), expressed(c, c.eyes(c.still), exprPose), 0, 0, 0);
    put(svg, "data-mo-still", c.ownsLiveliness && !c.baseFace ? "" : null);
    decor.update([{ state: stillId, local: c.still, weight: 1 }]);
  }

  function decorFrames(now: number, id: StateId): DecorFrame[] {
    if (tl.decorFrames) return tl.decorFrames(now);
    // TEMPORARY until Timeline.decorFrames lands: the state's own clock, while it runs.
    if (id !== enteredState) {
      enteredState = id;
      enteredAt = now;
    }
    const local = now - enteredAt;
    const c = CHOREO[id];
    return id === "idle" || local >= c.duration + c.morph ? [] : [{ state: id, local, weight: 1 }];
  }

  function frame(now: number, dt: number): boolean {
    const id = tl.state(now);
    const c = CHOREO[id];
    const k = pursuit(dt * 1000);
    const on = following && !!pointer && measured && c.baseFace;
    const s = step({
      x: ax,
      y: ay,
      dx: on ? pointer!.x - gcx : 0,
      dy: on ? pointer!.y - gcy : 0,
      radius: gradius,
      k,
    });
    const eps = threshold(gwidth, travel);
    let busy = false;
    if (Math.abs(s.tx - s.x) <= eps && Math.abs(s.ty - s.y) <= eps) {
      ax = s.tx;
      ay = s.ty;
    } else {
      ax = s.x;
      ay = s.y;
      busy = true;
    }
    hold += ((on ? 1 : 0) - hold) * k;
    if (Math.abs((on ? 1 : 0) - hold) <= HOLD_EPS) hold = on ? 1 : 0;
    else busy = true;

    const act = tl.sample(now);
    let changed = paint(act, tl.eyes(now), ax, ay, hold);
    changed = put(svg, "--mo-track-hold", hold ? hold.toFixed(3) : null) || changed;
    changed = put(svg, "data-mo-still", c.ownsLiveliness && !c.baseFace ? "" : null) || changed;

    const cue = tl.blinkCue(cuedTo, now);
    cuedTo = now;
    if (cue !== null) cueBlink(svg);

    const frames = decorFrames(now, id);
    if (frames.length || decorOn) decor.update(frames);
    decorOn = frames.length > 0;

    const animating = !isStatic(id) && (tl.next(now) < Infinity || restLoop);
    return changed || busy || decorOn || animating;
  }

  function tick(ms: number): void {
    const dt = frameDt(last, ms);
    last = ms;
    clock += dt;
    if (frame(clock, dt)) liveAt = clock;
    else if (clock - liveAt > QUIET) park();
  }

  function park(): void {
    if (!running) return;
    running = false;
    last = 0;
    stopFrames(view, tick);
  }

  function wake(): void {
    if (dead || paused || reduced) return;
    liveAt = clock;
    if (running) return;
    running = true;
    last = 0;
    startFrames(view, tick);
  }

  function measure(): void {
    const r = svg.getBoundingClientRect();
    gcx = r.left + r.width / 2;
    gcy = r.top + r.height / 2;
    gwidth = Math.max(1, r.width);
    gradius = Math.max(1, Math.min(r.width, r.height) / 2);
    measured = r.width > 0 && r.height > 0;
    travel = parseFloat(view.getComputedStyle(eyesG).getPropertyValue("--mo-track-travel")) || TRAVEL;
  }

  const onGeom = () => {
    readNextFrame(view, measure);
    wake();
  };

  function release(): void {
    detach?.();
    detach = null;
    cancelRead(view, measure);
    following = false;
    pointer = null;
    measured = false;
  }

  function attach(target: Element | "window"): void {
    release();
    const moves: EventTarget = target === "window" ? view : target;
    const leaves: EventTarget = target === "window" ? doc : target;
    const onMove = (ev: Event) => {
      const p = ev as PointerEvent;
      if (p.pointerType === "touch") return;
      pointer = { x: p.clientX, y: p.clientY };
      wake();
    };
    const onLeave = () => {
      pointer = null;
      wake();
    };
    const geom = { passive: true, capture: true } as const;
    moves.addEventListener("pointermove", onMove, { passive: true });
    leaves.addEventListener("pointerleave", onLeave, { passive: true });
    view.addEventListener("scroll", onGeom, geom);
    view.addEventListener("resize", onGeom, { passive: true });
    resized = view.ResizeObserver ? new view.ResizeObserver(onGeom) : null;
    resized?.observe(svg);
    detach = () => {
      moves.removeEventListener("pointermove", onMove);
      leaves.removeEventListener("pointerleave", onLeave);
      view.removeEventListener("scroll", onGeom, geom);
      view.removeEventListener("resize", onGeom);
      resized?.disconnect();
      resized = null;
    };
    following = true;
    onGeom();
  }

  function express(next: string | null, instant = false): void {
    if (next !== null && !has(ALIASES, next) && !resolveExpression(next)) return;
    const e: Expression | null = next === null ? null : resolveExpression(next);
    exprPose = e?.p ?? null;
    const tint = (e?.tint && e.tint(palette, e.p)) || palette;
    build();
    put(svg, "--mo-bdy", e && e.p.bdy ? String(e.p.bdy) : null);
    put(svg, "--mo-shake", e && e.p.shake ? String(e.p.shake) : null);
    put(svg, "--mo-head", tint.head!);
    put(svg, "--mo-eye", tint.eye!);
    put(bodyG, "fill", tint.head!);
    put(eyesG, "fill", tint.eye!);
    if (reduced) still();
    else if (instant) {
      tl.express(exprPose, -1);
      frame(0, 0);
    } else {
      tl.express(exprPose, clock);
      wake();
    }
  }

  if (!reduced) {
    build();
    frame(0, 0);
  }
  if (initial) express(initial, true);

  const handle: EngineHandle = {
    states: Object.keys(CHOREO),
    expressions: Object.keys(ALIASES),
    play(state, o) {
      if (!has(CHOREO, state)) throw new Error(`mountLive: unknown state "${state}"`);
      if (o?.rest !== undefined && !has(CHOREO, o.rest)) throw new Error(`mountLive: unknown state "${o.rest}"`);
      if (dead) return;
      const id = state as StateId;
      if (reduced) {
        stillId = id;
        still();
        return;
      }
      paused = false;
      const looped = !!o?.loop;
      const next = (o?.rest as StateId | undefined) ?? (looped ? id : rest);
      restLoop = looped ? true : next === rest && restLoop;
      rest = next;
      cuedTo = clock - 1e-6;
      tl.play(id, clock, o as PlayOptions);
      wake();
    },
    loop(state) {
      handle.play(state, { loop: true });
    },
    setExpression(next) {
      if (dead) return;
      paused = false;
      express(next);
    },
    stop() {
      paused = true;
      park();
    },
    follow(target = "window") {
      if (dead) return;
      if (target === false) {
        release();
        wake();
      } else if (!reduced) {
        paused = false;
        attach(target);
      }
    },
    destroy() {
      if (dead) return;
      dead = true;
      park();
      release();
      if (!built) return;
      decor.destroy();
      for (const [eye, g, path] of swaps) eye.replaceChild(path, g);
      swaps = [];
      kids.forEach((k) => bob.appendChild(k));
      figure.remove();
      for (const el of added) el.remove();
      for (const fn of undo.reverse()) fn();
    },
  };
  return handle;
}
