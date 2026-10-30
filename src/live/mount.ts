// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

import type { EngineHandle } from "../engine";
import { HOLD_EPS, pursuit, project, step, threshold, type Mark } from "../gaze";
import { motionSeeds } from "../animate";
import { _layout, parts, type BolotaOptions } from "../bolota";
import { EASE_OUT, MORPH_IN, MORPH_OUT } from "../ease";
import type { Expression } from "../expression";
import { r3, type Pose } from "../morph";
import { resolve } from "../render";
import { actTransform, type Act } from "./act";
import { CHOREO, TRACK_TURN, expressed, type Eyes, type StateId } from "./choreo";
import type { Decor, DecorFrame, DecorHost, DecorPalette } from "./decor.js";
import { fitEyes, type Correction } from "./fit";
import { cancelRead, readNextFrame, startFrames, stopFrames, watchSight } from "./frames";
import { ALIASES, resolveExpression } from "./names";
import { idleBody, idleEyes, idleFrame, idleShake } from "./idle";
import { eyeRig, faceEyes, type EyeRig } from "./rig";
import { Timeline, frameDt, type PlayOptions } from "./timeline";
import { putter } from "./put";
import { uprightTransform } from "./upright";

export type LiveOptions = Omit<BolotaOptions, "expression"> & { expression?: string };

const SVG_NS = "http://www.w3.org/2000/svg";

/** Seconds a woken engine stays registered after the last thing that moved. */
const QUIET = 1;

/** The gaze excursion, in viewBox units, when the host sets no `--mo-track-travel`. */
const TRAVEL = 3;

/** The entrance blink: one linear close to 6% and open, in seconds. */
const ENTRANCE = 0.2;

/** `.mo-root`'s `--mo-amp` transition on hover, in seconds. */
const AMP_RAMP = 0.4;

const q = (v: number, k: number) => Math.round(v * k);

const POSE_VARS = [
  "esx", "esy", "tilt", "edy", "edx", "esx2", "esy2", "tilt2", "edy2", "epx", "lock", "shake", "bdy",
].map((k) => `--mo-${k}`);

const RIG_KEYS = ["x", "y", "width", "height", "rx", "ry"] as const;

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const turnRad = (TRACK_TURN * Math.PI) / 180;

type DecorModule = typeof import("./decor.js");

let decorModule: DecorModule | null = null;
let decorLoad: Promise<unknown> | null = null;

/** One import shared by every instance; a failed load clears itself so the next ask retries. */
function loadDecor(): Promise<unknown> {
  return (decorLoad ??= import("./decor.js").then(
    (m) => (decorModule = m),
    () => {
      decorLoad = null;
    },
  ));
}

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

export function mountLive(svg: SVGSVGElement, name: string, opts: LiveOptions = {}): EngineHandle {
  const doc = svg.ownerDocument;
  const view = doc.defaultView as Window & typeof globalThis;
  const { expression: initial, ...base } = opts;
  const L = _layout(name, base);
  const palette = L.palette;
  const { cx: bx, cy: by, rx: R } = L.body;
  const reduced = !!view.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const tl = new Timeline();
  const out: Correction = { pull: 0, shrink: 1 };
  const marks: Mark[] = L.eyes.map((e) => ({ x: (e.cx - L.face.cx) / L.face.rx, y: (e.cy - L.face.cy) / L.face.ry }));

  const undo: (() => void)[] = [];
  const added: Element[] = [];
  const put = putter();
  let swaps: [Element, Element, Element][] = [];
  let built = false;
  let dead = false;
  let paused = false;
  let sight = true;
  let unwatch: (() => void) | null = null;
  let host!: SVGElement;
  let breathe!: Element;
  let bob!: Element;
  let figure!: SVGGElement;
  let bodyG!: Element;
  let kids: Element[] = [];
  let actG!: SVGGElement;
  let eyesG!: Element;
  let upG!: SVGGElement;
  let eyeEls: Element[] = [];
  let rects: Rect[] = [];
  let decor: Decor | null = null;
  let decorHost!: DecorHost;

  const seeds = motionSeeds(resolve(name, base).t);
  const hoverMode = base.animate === "hover";
  const idle = idleFrame();
  const eyeSig = new Float64Array(8).fill(NaN);
  const eyeKey = new Float64Array(4);
  let wraps: Element[] = [];
  let hybrid = false;
  let jsPhase = true;
  let baseBody = 0;
  let baseEye = 0;
  let pendingWake = false;
  let bodyMs = 0;
  let eyeMs = 0;
  let amp = hoverMode ? 0 : 1;
  let ampFrom = 0;
  let ampTo = hoverMode ? 0 : 1;
  let ampAt = 0;
  let shakeFrom = 0;
  let shakeTo = 0;
  let shakeAt = 0;
  let shakeCurve = MORPH_OUT;
  let entranceAt = -1;
  let held = false;
  let sigBreathe = NaN;
  let sigBreatheY = NaN;
  let sigBob = NaN;
  let sigSacX = NaN;
  let sigSacY = NaN;
  let sigShakeX = NaN;
  let sigShakeY = NaN;
  let ticking = false;
  let awake = false;

  let clock = 0;
  let last = 0;
  let cuedTo = -1e-6;
  let liveAt = 0;
  let rest: StateId = "idle";
  let restLoop = false;
  let exprPose: Pose | null = null;
  let stillId: StateId = "idle";

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

  function setRig(rect: Element, a: EyeRig): boolean {
    let changed = false;
    for (const k of RIG_KEYS) changed = put(rect, k, a[k]) || changed;
    return put(rect, "--mo-rot", a.rot) || changed;
  }

  function entrance(): number {
    const p = (clock - entranceAt) / ENTRANCE;
    return entranceAt < 0 || p >= 1 ? 1 : 1 - 0.94 * (1 - Math.abs(2 * p - 1));
  }

  /**
   * One eye's idle layers. The wrap goes on the group under `.mo-eye`, about the
   * eye's centre by `motion.css`'s `fill-box` origin; the blink (with the
   * entrance) goes on the rect, whose `rotate` is the eye's turn, so it closes
   * the eye across its own axis. Both stand down to `none` at identity.
   */
  function writeEye(i: number): boolean {
    if (!jsPhase) return false;
    const side = i ? 1 : -1;
    const wr = idle.wrapRot * side;
    const sx = 1 + idle.wrapMx + idle.wrapSide * side;
    const sy = 1 + idle.wrapSy;
    const shut = idle.blink * entrance();
    const k = eyeKey;
    k[0] = q(wr, 1000);
    k[1] = q(sx, 10000);
    k[2] = q(sy, 10000);
    k[3] = q(shut, 1000);
    const o = i * 4;
    let changed = false;
    for (let j = 0; j < 4; j++) {
      if (eyeSig[o + j] === k[j]) continue;
      eyeSig[o + j] = k[j]!;
      changed = true;
    }
    if (!changed) return false;
    const wrap = k[0] || k[1] !== 10000 || k[2] !== 10000 ? `rotate(${r3(wr)}) scale(${r3(sx)} ${r3(sy)})` : null;
    put(wraps[i]!, "transform", wrap);
    put(rects[i]!, "transform", k[3] === 1000 ? null : `scale(1 ${r3(shut)})`);
    return true;
  }

  function ampNow(): number {
    const p = (clock - ampAt) / AMP_RAMP;
    return p >= 1 ? ampTo : ampFrom + (ampTo - ampFrom) * EASE_OUT(p < 0 ? 0 : p);
  }

  function shakeNow(): number {
    const p = (clock - shakeAt) / (shakeCurve.ms / 1000);
    return p >= 1 ? shakeTo : shakeFrom + (shakeTo - shakeFrom) * shakeCurve.ease(p < 0 ? 0 : p);
  }

  function idleEval(): void {
    if (hoverMode) amp = ampNow();
    idleBody(seeds, bodyMs, amp, hold, idle);
    idleEyes(seeds, eyeMs, amp, hold, idle);
  }

  /** Writes what the evaluated idle layers moved. */
  function idleWrite(): void {
    if (!jsPhase) return;
    const bx = q(idle.breatheX, 10000);
    const by = q(idle.breatheY, 10000);
    if (bx !== sigBreathe || by !== sigBreatheY) {
      sigBreathe = bx;
      sigBreatheY = by;
      put(breathe, "transform", `scale(${bx / 10000} ${by / 10000})`);
    }
    const bb = q(idle.bob, 1000);
    if (bb !== sigBob) {
      sigBob = bb;
      put(bob, "transform", `translate(0 ${bb / 1000})`);
    }
    const sx = q(idle.sacX, 1000);
    const sy = q(idle.sacY, 1000);
    if (sx !== sigSacX || sy !== sigSacY) {
      sigSacX = sx;
      sigSacY = sy;
      put(eyesG, "transform", `translate(${sx / 1000} ${sy / 1000})`);
    }
    const sh = shakeNow();
    if (sh !== 0 || sigShakeX !== 0 || sigShakeY !== 0) {
      idleShake(bodyMs, sh, idle);
      const hx = q(idle.shakeX, 1000);
      const hy = q(idle.shakeY, 1000);
      if (hx !== sigShakeX || hy !== sigShakeY) {
        sigShakeX = hx;
        sigShakeY = hy;
        put(host, "transform", hx || hy ? `translate(${hx / 1000} ${hy / 1000})` : null);
      }
    }
    writeEye(0);
    writeEye(1);
  }

  function build(): void {
    if (built) return;
    built = true;
    snapshot(svg, ["style", "class", "viewBox", "overflow", "data-mo-still", "data-mo-js", "data-mo-asleep"]);
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
    hybrid = !hoverMode && !reduced && typeof breathe.getAnimations === "function";
    jsPhase = !hybrid;
    if (!reduced && jsPhase) svg.setAttribute("data-mo-js", "");
    for (const el of [host, breathe]) snapshot(el, ["transform"]);

    eyesG = breathe.querySelector(".mo-eyes")!;
    snapshot(eyesG, ["style", "opacity", "transform"]);
    upG = mk("g");
    while (eyesG.firstChild) upG.appendChild(eyesG.firstChild);
    eyesG.appendChild(upG);
    eyeEls = Array.from(breathe.querySelectorAll(".mo-eye"));
    wraps = eyeEls.map((eye) => eye.firstElementChild!);
    rects = eyeEls.map((eye, i) => {
      snapshot(eye, ["style"]);
      const wrap = eye.firstElementChild!;
      snapshot(wrap, ["transform"]);
      const first = wrap.firstElementChild!;
      const mine = first.tagName === "rect";
      const rect = mine ? (first as Rect) : mk("rect");
      if (!mine) {
        wrap.replaceChild(rect, first);
        swaps.push([wrap, rect, first]);
      }
      setRig(rect, eyeRig(L.eyes[i]!));
      return rect;
    });

    bob = breathe.firstElementChild!;
    snapshot(bob, ["transform"]);
    if (hoverMode && !reduced) {
      const aim = (to: number) => (ev: Event) => {
        if ((ev as PointerEvent).pointerType === "touch") return;
        ampFrom = ampNow();
        ampTo = to;
        ampAt = clock;
        wake();
      };
      const enter = aim(1);
      const leave = aim(0);
      host.addEventListener("pointerenter", enter, { passive: true });
      host.addEventListener("pointerleave", leave, { passive: true });
      undo.push(() => {
        host.removeEventListener("pointerenter", enter);
        host.removeEventListener("pointerleave", leave);
      });
    }
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
    decorHost = { back, front, defs, head: headG };
  }

  function drawDecor(frames: DecorFrame[]): boolean {
    if (!decor) {
      if (!decorModule) return false;
      decor = decorModule.createDecor(decorHost, L, palette as DecorPalette, Math.random().toString(36).slice(2));
    }
    return decor.update(frames);
  }

  function fetchDecor(): void {
    void loadDecor().then(() => {
      if (dead || !decorModule) return;
      if (reduced) still();
      else wake();
    });
  }

  function paint(act: Act, e: Eyes, tx: number, ty: number, weight: number): boolean {
    const turn = act.rot * act.upright;
    let changed = put(actG, "transform", actTransform(act, R, bx, by));
    changed = put(upG, "transform", uprightTransform(act, bx, by) || null) || changed;
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
      changed = setRig(rects[i]!, eyeRig(b)) || changed;
      writeEye(i);
    });
    return changed;
  }

  function still(): void {
    build();
    const c = CHOREO[stillId];
    paint(c.act(c.still), expressed(c, c.eyes(c.still), exprPose), 0, 0, 0);
    put(svg, "data-mo-still", c.ownsLiveliness && !c.baseFace ? "" : null);
    drawDecor([{ state: stillId, local: c.still, weight: 1 }]);
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
    held = !!c.ownsLiveliness && !c.baseFace;
    changed = put(svg, "data-mo-still", held ? "" : null) || changed;

    const cue = tl.blinkCue(cuedTo, now);
    cuedTo = now;
    if (cue !== null) entranceAt = now;

    const drawn = drawDecor(tl.decorFrames(now));

    const moving = !isStatic(id);
    const animating = tl.next(now) < Infinity ? moving || id !== rest : moving && restLoop;
    return changed || busy || drawn || animating;
  }

  function tick(ms: number): void {
    const dt = frameDt(last, ms);
    last = ms;
    clock += dt;
    eyeMs += dt * 1000;
    if (!held) bodyMs += dt * 1000;
    idleEval();
    if (awake) {
      if (frame(clock, dt)) liveAt = clock;
      else if (clock - liveAt > QUIET) awake = false;
    }
    if (!awake && hybrid && shakeTo === 0 && entrance() === 1) {
      giveBack();
      halt();
      return;
    }
    idleWrite();
    if (!awake && hoverMode && ampTo === 0 && clock >= ampAt + AMP_RAMP && shakeTo === 0 && clock >= shakeAt + shakeCurve.ms / 1000 && entrance() === 1) halt();
  }

  function halt(): void {
    awake = false;
    if (!ticking) return;
    ticking = false;
    last = 0;
    stopFrames(view, tick);
  }

  function start(): void {
    if (dead || paused || reduced || !sight || ticking) return;
    ticking = true;
    last = 0;
    startFrames(view, tick);
  }

  /** The compositor's loops hand over to the frame clock, from the phase they have reached. */
  function takeOver(): void {
    if (jsPhase) return;
    const elapsed = (el: Element) => Number(el.getAnimations()[0]?.currentTime) || 0;
    bodyMs = baseBody + elapsed(breathe);
    eyeMs = baseEye + elapsed(wraps[0]!);
    jsPhase = true;
    sigBreathe = sigBob = sigSacX = NaN;
    eyeSig.fill(NaN);
    svg.setAttribute("data-mo-js", "");
    idleEval();
  }

  /** And back: the stylesheet restarts the loops at the phase the frame clock stopped on. */
  function giveBack(): void {
    if (!jsPhase) return;
    baseBody = bodyMs;
    baseEye = eyeMs;
    svg.style.setProperty("--mo-lag", `${-Math.round(bodyMs)}ms`);
    svg.style.setProperty("--mo-elag", `${-Math.round(eyeMs)}ms`);
    for (const el of [host, breathe, bob, eyesG, ...wraps, ...rects]) put(el, "transform", null);
    eyeSig.fill(NaN);
    sigShakeX = sigShakeY = NaN;
    svg.removeAttribute("data-mo-js");
    jsPhase = false;
  }

  function wake(): void {
    if (dead || paused || reduced) return;
    if (!sight) {
      pendingWake = true;
      return;
    }
    if (hybrid) takeOver();
    liveAt = clock;
    awake = true;
    start();
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
    if (!sight) return;
    readNextFrame(view, measure);
    wake();
  };

  /**
   * Off screen, or in a hidden tab, the instance leaves the frame loop and its
   * clock stops with it: the timeline resumes from the frame it froze on, with
   * a first tick of zero seconds, so nothing restarts and nothing jumps. The
   * DOM keeps that last frame. Commands issued meanwhile are stamped with the
   * frozen time and play out on return with their normal morphs.
   */
  function sightChange(visible: boolean): void {
    sight = visible;
    put(svg, "data-mo-asleep", visible ? null : "");
    if (!visible) return halt();
    if (following) readNextFrame(view, measure);
    if (!hybrid || jsPhase || following || pendingWake) {
      pendingWake = false;
      wake();
    }
  }

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
    shakeFrom = instant ? (e?.p.shake ?? 0) : shakeNow();
    shakeTo = e?.p.shake ?? 0;
    shakeAt = clock;
    shakeCurve = e ? MORPH_IN : MORPH_OUT;
    put(svg, "--mo-head", tint.head!);
    put(svg, "--mo-eye", tint.eye!);
    put(bodyG, "fill", tint.head!);
    put(eyesG, "fill", tint.eye!);
    if (reduced) still();
    else if (instant) {
      tl.express(exprPose, -1);
      frame(0, 0);
    } else {
      tl.release(clock);
      tl.express(exprPose, clock);
      wake();
    }
  }

  if (!reduced) {
    build();
    idleEval();
    frame(0, 0);
    idleWrite();
  }
  if (initial) express(initial, true);
  if (!decorModule) {
    if (view.requestIdleCallback) view.requestIdleCallback(fetchDecor, { timeout: 2000 });
    else setTimeout(fetchDecor, 200);
  }
  if (!reduced) {
    unwatch = watchSight(view, svg, sightChange);
    if (!hoverMode && !hybrid) start();
  }

  const handle: EngineHandle = {
    states: Object.keys(CHOREO),
    expressions: Object.keys(ALIASES),
    play(state, o) {
      for (const id of [state, o?.rest ?? state]) if (!has(CHOREO, id)) throw new Error(`mountLive: unknown state "${id}"`);
      if (dead) return;
      const id = state as StateId;
      if (!decorModule) fetchDecor();
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
      tl.release(clock);
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
      halt();
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
      unwatch?.();
      halt();
      release();
      if (!built) return;
      decor?.destroy();
      for (const [eye, g, path] of swaps) eye.replaceChild(path, g);
      swaps = [];
      while (upG.firstChild) eyesG.appendChild(upG.firstChild);
      upG.remove();
      kids.forEach((k) => bob.appendChild(k));
      figure.remove();
      for (const el of added) el.remove();
      for (const fn of undo.reverse()) fn();
    },
  };
  return handle;
}
