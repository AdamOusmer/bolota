// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.
// Derived from bloub (c) 2026 Jeremy Perret, MIT. See LICENSE.

import type { EngineHandle } from "../engine";
import { motionSeeds } from "../animate";
import { _layout, parts, type BolotaOptions } from "../bolota";
import { EASE_OUT, MORPH_IN, MORPH_OUT } from "../ease";
import type { Expression } from "../expression";
import { IDENT, r3, type Pose } from "../morph";
import { resolve } from "../render";
import { IDLE_ACT, actTransform, type Act } from "./act";
import { CHOREO, expressed, newEyes, type Eyes, type Head, type StateId } from "./choreo";
import type { Decor, DecorFrame, DecorHost, DecorPalette } from "./decor.js";
import { eyeBox, settleEyes, type Correction, type Eye, type EyeBox } from "./fit";
import { Glide, NO_LOOK, followLook, type Look } from "./follow";
import { cancelRead, readNextFrame, startFrames, stopFrames, watchSight } from "./frames";
import { BLINK_CYCLE, BREATH_MS, type Gaze } from "./head";
import { ALIASES, resolveExpression } from "./names";
import { idleDrift, idleFrame, idleLoops, idleShake } from "./idle";
import { faceEyes } from "./rig";
import { Timeline, frameDt, type PlayOptions } from "./timeline";
import { putter, type Slot } from "./put";
import { uprightTransform } from "./upright";

export type LiveOptions = Omit<BolotaOptions, "expression"> & { expression?: string };

const SVG_NS = "http://www.w3.org/2000/svg";

/** Seconds a woken engine stays registered after the last thing that moved. */
const QUIET = 1;

/** The `--mo-track-travel` a follow's reach is measured against: set larger to look further, smaller to look less. */
const TRAVEL = 3;

/** The entrance blink: one linear close to 6% and open, in seconds. */
const ENTRANCE = 0.2;

/** `.mo-root`'s `--mo-amp` transition on hover, in seconds. */
const AMP_RAMP = 0.4;

const q = (v: number, k: number) => Math.round(v * k);

const POSE_VARS = [
  "esx", "esy", "tilt", "edy", "edx", "esx2", "esy2", "tilt2", "edy2", "epx", "lock", "shake", "bdy",
].map((k) => `--mo-${k}`);

const RECT_ATTRS = ["x", "y", "width", "height", "rx", "ry", "transform", "style"];

const stamp = (sig: Float64Array, i: number, v: number): number => {
  if (sig[i] === v) return 0;
  sig[i] = v;
  return 1;
};

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const clamp1 = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

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
  const corr: Correction = { gaze: 1, shrink: 1 };

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

  /*
   * Each instance starts its idle life at its own seeded place in the breath,
   * the blink cycle and the wander, so a grid mounted at once does not breathe,
   * blink and glance in unison.
   */
  const seeds = motionSeeds(resolve(name, base).t);
  const breathAt = (seeds.phase / 2800) * BREATH_MS;
  const blinkAt = (seeds.blinkPhase / seeds.blink) * BLINK_CYCLE * 1000;
  const wanderAt = (seeds.saccadePhase / seeds.saccade) * 60000;
  const hoverMode = base.animate === "hover";
  const idle = idleFrame();
  const actNow: Act = { ...IDLE_ACT };
  const eyesNow = newEyes();
  const decorNow: DecorFrame[] = [];
  const rest: Eye[] = [
    { cx: 0, cy: 0, rx: 0, ry: 0, rot: 0 },
    { cx: 0, cy: 0, rx: 0, ry: 0, rot: 0 },
  ];
  const boxes: EyeBox[] = [eyeBox(), eyeBox()];
  const headNow: Head = { roll: 0, yaw: 0, pitch: 0, spread: 0 };
  const faceNow = { pose: IDENT, own: 0, head: headNow };
  const gazeNow: Gaze = { yaw: 0, pitch: 0, roll: 0 };
  const lookNow: Look = { ...NO_LOOK };
  const lookTo: Look = { ...NO_LOOK };
  const glide = new Glide();
  const actSig = new Float64Array(7).fill(NaN);
  const faceSig = new Float64Array(20).fill(NaN);
  const rigSig = new Float64Array(22).fill(NaN);
  let sAct!: Slot;
  let sUp!: Slot;
  let sAlpha!: Slot;
  let sHost!: Slot;
  let sBreathe!: Slot;
  let sWraps: Slot[] = [];
  let sRects: Slot[] = [];
  let wraps: Element[] = [];
  let hybrid = false;
  let jsPhase = true;
  let baseBody = breathAt;
  let baseEye = blinkAt;
  let pendingWake = false;
  let bodyMs = breathAt;
  let eyeMs = blinkAt;
  let amp = hoverMode ? 0 : 1;
  let ampFrom = 0;
  let ampTo = hoverMode ? 0 : 1;
  let ampAt = 0;
  let shakeFrom = 0;
  let shakeTo = 0;
  let shakeAt = 0;
  let shakeCurve = MORPH_OUT;
  let entranceAt = -1;
  let sigBreathe = NaN;
  let sigShakeX = NaN;
  let sigShakeY = NaN;
  const sigBlink = [NaN, NaN];
  let ticking = false;
  let awake = false;

  let clock = 0;
  let last = 0;
  let cuedTo = -1e-6;
  let liveAt = 0;
  let restId: StateId = "idle";
  let restLoop = false;
  let exprPose: Pose | null = null;
  let stillId: StateId = "idle";

  let following = false;
  let pointer: { x: number; y: number } | null = null;
  let aiming = false;
  let aimX = NaN;
  let aimY = NaN;
  let gcx = 0;
  let gcy = 0;
  let halfW = 1;
  let halfH = 1;
  let gain = 1;
  let measured = false;
  let detach: (() => void) | null = null;
  let resized: ResizeObserver | null = null;

  const mk = <K extends keyof SVGElementTagNameMap>(tag: K) => doc.createElementNS(SVG_NS, tag);

  function snapshot(el: Element, attrs: string[]): void {
    const was = attrs.map((a) => el.getAttribute(a));
    undo.push(() => attrs.forEach((a, i) => (was[i] === null ? el.removeAttribute(a) : el.setAttribute(a, was[i]!))));
  }

  /**
   * One eye's rect: its shape centred on the origin, and one `matrix()` that
   * turns it by the head's frame and its own lean and puts it in place, as
   * bloub drew a capsule under its tangent frame. Each value is rounded and
   * compared as a number first, so a rect that has not moved costs no strings
   * and no attribute write; a turn that keeps the shape writes the transform
   * alone.
   */
  function writeRig(rect: Element, i: number, b: EyeBox): boolean {
    const o = i * 11;
    const vw = q(2 * b.rx, 1000);
    const vh = q(2 * b.ry, 1000);
    const vr = q(Math.min(b.rx, b.ry), 1000);
    let changed = false;
    if (rigSig[o] !== vw || rigSig[o + 1] !== vh) {
      rigSig[o] = vw;
      rigSig[o + 1] = vh;
      rect.setAttribute("x", String(-vw / 2000));
      rect.setAttribute("y", String(-vh / 2000));
      rect.setAttribute("width", String(vw / 1000));
      rect.setAttribute("height", String(vh / 1000));
      changed = true;
    }
    if (rigSig[o + 2] !== vr) {
      rigSig[o + 2] = vr;
      const r = String(vr / 1000);
      rect.setAttribute("rx", r);
      rect.setAttribute("ry", r);
      changed = true;
    }
    const t = (b.rot * Math.PI) / 180;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    const m0 = q(b.a * ct + b.c * st, 10000);
    const m1 = q(b.b * ct + b.d * st, 10000);
    const m2 = q(-b.a * st + b.c * ct, 10000);
    const m3 = q(-b.b * st + b.d * ct, 10000);
    const e = q(b.cx, 1000);
    const f = q(b.cy, 1000);
    if (
      stamp(rigSig, o + 3, m0) |
      stamp(rigSig, o + 4, m1) |
      stamp(rigSig, o + 5, m2) |
      stamp(rigSig, o + 6, m3) |
      stamp(rigSig, o + 7, e) |
      stamp(rigSig, o + 8, f)
    ) {
      sRects[i]!.set(`matrix(${m0 / 10000} ${m1 / 10000} ${m2 / 10000} ${m3 / 10000} ${e / 1000} ${f / 1000})`);
      changed = true;
    }
    return changed;
  }

  function entrance(): number {
    const p = (clock - entranceAt) / ENTRANCE;
    return entranceAt < 0 || p >= 1 ? 1 : 1 - 0.94 * (1 - Math.abs(2 * p - 1));
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
    idleLoops(bodyMs, eyeMs, amp, idle);
  }

  /**
   * Writes what the breath, the blink and the tremor moved. The blink squashes
   * the group under `.mo-eye`, about its box's centre, so it closes the drawn
   * eye on screen's vertical, as bloub's did, whatever the head did to it.
   */
  function idleWrite(): void {
    if (!jsPhase) return;
    const b = q(idle.breathe, 10000);
    if (b !== sigBreathe) {
      sigBreathe = b;
      sBreathe.set(b === 10000 ? null : `scale(1 ${b / 10000})`);
    }
    const sh = shakeNow();
    if (sh !== 0 || sigShakeX !== 0 || sigShakeY !== 0) {
      idleShake(bodyMs, sh, idle);
      const hx = q(idle.shakeX, 1000);
      const hy = q(idle.shakeY, 1000);
      if (hx !== sigShakeX || hy !== sigShakeY) {
        sigShakeX = hx;
        sigShakeY = hy;
        sHost.set(hx || hy ? `translate(${hx / 1000} ${hy / 1000})` : null);
      }
    }
    const k = q(Math.min(idle.blink, entrance()), 1000);
    for (let i = 0; i < sWraps.length; i++) {
      if (sigBlink[i] === k) continue;
      sigBlink[i] = k;
      sWraps[i]!.set(k === 1000 ? null : `scale(1 ${k / 1000})`);
    }
  }

  function build(): void {
    if (built) return;
    built = true;
    snapshot(svg, ["style", "class", "viewBox", "overflow", "data-mo-js", "data-mo-live", "data-mo-asleep"]);
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
    // The stylesheet's own idle (saccade, bob, its blink) stands down for good
    // under the engine: what it runs at rest is the engine's breath and blink.
    if (!reduced) svg.setAttribute("data-mo-live", "");
    hybrid = !hoverMode && !reduced && typeof breathe.getAnimations === "function";
    jsPhase = !hybrid;
    if (!reduced && jsPhase) svg.setAttribute("data-mo-js", "");
    svg.style.setProperty("--mo-lag", `${-Math.round(baseBody)}ms`);
    svg.style.setProperty("--mo-elag", `${-Math.round(baseEye)}ms`);
    for (const el of [host, breathe]) snapshot(el, ["transform"]);

    eyesG = breathe.querySelector(".mo-eyes")!;
    snapshot(eyesG, ["style", "opacity", "transform"]);
    upG = mk("g");
    while (eyesG.firstChild) upG.appendChild(eyesG.firstChild);
    eyesG.appendChild(upG);
    eyeEls = Array.from(breathe.querySelectorAll(".mo-eye"));
    wraps = eyeEls.map((eye) => eye.firstElementChild!);
    sRects = [];
    rects = eyeEls.map((eye) => {
      snapshot(eye, ["style"]);
      const wrap = eye.firstElementChild!;
      snapshot(wrap, ["transform"]);
      const first = wrap.firstElementChild!;
      const mine = first.tagName === "rect";
      const rect = mine ? (first as Rect) : mk("rect");
      if (mine) snapshot(rect, RECT_ATTRS);
      else {
        wrap.replaceChild(rect, first);
        swaps.push([wrap, rect, first]);
      }
      rect.removeAttribute("transform");
      sRects.push(put.slot(rect, "transform"));
      return rect;
    });
    rects.forEach((rect, i) => writeRig(rect, i, { ...L.eyes[i]!, a: 1, b: 0, c: 0, d: 1 }));

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
    sAct = put.slot(actG, "transform");
    sUp = put.slot(upG, "transform");
    sAlpha = put.slot(eyesG, "opacity");
    sHost = put.slot(host, "transform");
    sBreathe = put.slot(breathe, "transform");
    sWraps = wraps.map((w) => put.slot(w, "transform"));
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

  /**
   * Draws the act and the eyes. Each half is skipped, number for number, when
   * what it is a function of is what it was drawn from last time.
   */
  function paint(act: Act, e: Eyes, g: Gaze): boolean {
    let changed = false;
    if (
      stamp(actSig, 0, act.x) |
      stamp(actSig, 1, act.y) |
      stamp(actSig, 2, act.rot) |
      stamp(actSig, 3, act.s) |
      stamp(actSig, 4, act.sx) |
      stamp(actSig, 5, act.sy) |
      stamp(actSig, 6, act.upright)
    ) {
      changed = sAct.set(actTransform(act, R, bx, by));
      changed = sUp.set(uprightTransform(act, bx, by) || null) || changed;
    }
    const turn = act.rot * act.upright;
    const p = e.pose;
    const f = faceSig;
    if (
      stamp(f, 0, e.alpha) |
      stamp(f, 1, p.esx) |
      stamp(f, 2, p.esy) |
      stamp(f, 3, p.tilt) |
      stamp(f, 4, p.edy) |
      stamp(f, 5, p.edx) |
      stamp(f, 6, p.esx2) |
      stamp(f, 7, p.esy2) |
      stamp(f, 8, p.tilt2) |
      stamp(f, 9, p.edy2) |
      stamp(f, 10, p.epx) |
      stamp(f, 11, p.lock) |
      stamp(f, 12, e.own) |
      stamp(f, 13, e.head.spread) |
      stamp(f, 14, g.yaw) |
      stamp(f, 15, g.pitch) |
      stamp(f, 16, g.roll) |
      stamp(f, 17, turn)
    ) {
      changed = sAlpha.set(e.alpha >= 1 ? null : r3(e.alpha)) || changed;
      headNow.spread = e.head.spread;
      faceNow.pose = p;
      faceNow.own = e.own;
      faceEyes(L, faceNow, turn, rest);
      settleEyes(L, rest, g, turn, boxes, corr);
      changed = writeRig(rects[0]!, 0, boxes[0]!) || changed;
      changed = writeRig(rects[1]!, 1, boxes[1]!) || changed;
    }
    return changed;
  }

  function still(): void {
    build();
    const c = CHOREO[stillId];
    const e = expressed(c, c.eyes(c.still), exprPose);
    gazeNow.yaw = e.head.yaw;
    gazeNow.pitch = e.head.pitch;
    gazeNow.roll = e.head.roll;
    paint(c.act(c.still), e, gazeNow);
    drawDecor([{ state: stillId, local: c.still, weight: 1 }]);
  }

  /**
   * Points the gaze glide where the pointer asks, or hands it back to the
   * state's own when there is no pointer to look at or the state owns its
   * face. Retargets only when the ask moved; whether the glide is still going.
   */
  function aim(now: number, baseFace: boolean): boolean {
    const on = following && !!pointer && measured && baseFace;
    if (!on) {
      if (aiming) {
        aiming = false;
        glide.retarget(NO_LOOK, now, true);
      }
    } else {
      const nx = clamp1((pointer!.x - gcx) / halfW);
      const ny = clamp1((pointer!.y - gcy) / halfH);
      if (!aiming || nx !== aimX || ny !== aimY) {
        aiming = true;
        aimX = nx;
        aimY = ny;
        glide.retarget(followLook(nx, ny, gain, lookTo), now, false);
      }
    }
    return !glide.settled(now);
  }

  function frame(now: number): boolean {
    const id = tl.state(now);
    const c = CHOREO[id];
    const busy = aim(now, c.baseFace);
    const look = glide.sample(now, lookNow);
    const act = tl.sample(now, actNow);
    const e = tl.eyes(now, eyesNow);
    const frames = tl.decorFrames(now, decorNow);

    // bloub's idle life: the head wanders and the body floats, unless the
    // state owns its liveliness, and a pointer holding the gaze stills the
    // wander. How much a state lives is weighed across a state change on the
    // curve the change itself takes, so handing over never cuts the drift.
    let lively = 0;
    for (const f of frames) if (!CHOREO[f.state].ownsLiveliness) lively += f.weight;
    const alive = e.alpha > 0.01;
    idleDrift(eyeMs + wanderAt, alive ? lively * look.wander * amp : 0, lively * amp, idle);
    act.x += idle.x;
    act.y += idle.y;
    const h = e.head;
    gazeNow.yaw = h.yaw + (look.yaw - h.yaw) * look.mix + idle.gaze.yaw;
    gazeNow.pitch = h.pitch + (look.pitch - h.pitch) * look.mix + idle.gaze.pitch;
    gazeNow.roll = h.roll + idle.gaze.roll;

    const changed = paint(act, e, gazeNow);

    const cue = tl.blinkCue(cuedTo, now);
    cuedTo = now;
    if (cue !== null) entranceAt = now;

    const drawn = drawDecor(frames);

    const moving = !isStatic(id) || (lively > 0 && amp > 0);
    const animating = tl.next(now) < Infinity ? moving || id !== restId : moving && restLoop;
    return changed || busy || drawn || animating;
  }

  function tick(ms: number): void {
    const dt = frameDt(last, ms);
    last = ms;
    clock += dt;
    eyeMs += dt * 1000;
    bodyMs += dt * 1000;
    idleEval();
    if (awake) {
      if (frame(clock)) liveAt = clock;
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

  /** The compositor's breath and blink hand over to the frame clock, from the phase they have reached. */
  function takeOver(): void {
    if (jsPhase) return;
    const elapsed = (el: Element) => Number(el.getAnimations()[0]?.currentTime) || 0;
    bodyMs = baseBody + elapsed(breathe);
    eyeMs = baseEye + elapsed(wraps[0]!);
    jsPhase = true;
    sigBreathe = NaN;
    sigBlink.fill(NaN);
    svg.setAttribute("data-mo-js", "");
    idleEval();
  }

  /** And back: the stylesheet restarts the breath and blink at the phase the frame clock stopped on. */
  function giveBack(): void {
    if (!jsPhase) return;
    baseBody = bodyMs;
    baseEye = eyeMs;
    svg.style.setProperty("--mo-lag", `${-Math.round(bodyMs)}ms`);
    svg.style.setProperty("--mo-elag", `${-Math.round(eyeMs)}ms`);
    for (const slot of [sHost, sBreathe, ...sWraps]) slot.set(null);
    sigBlink.fill(NaN);
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
    measured = r.width > 0 && r.height > 0;
    const radius = Math.max(1, Math.min(r.width, r.height) / 2);
    halfW = Math.max(1, (view.innerWidth || 8 * radius) / 2);
    halfH = Math.max(1, (view.innerHeight || 8 * radius) / 2);
    gain = (parseFloat(view.getComputedStyle(eyesG).getPropertyValue("--mo-track-travel")) || TRAVEL) / TRAVEL;
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
      frame(0);
    } else {
      tl.release(clock);
      tl.express(exprPose, clock);
      wake();
    }
  }

  if (!reduced) {
    build();
    idleEval();
    frame(0);
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
      const next = (o?.rest as StateId | undefined) ?? (looped ? id : restId);
      restLoop = looped ? true : next === restId && restLoop;
      restId = next;
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
