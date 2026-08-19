/**
 * The bridge between blobatar's seeded body and bloub's animation engine.
 *
 * `src/bloub/` is a verbatim port of bloub (https://github.com/jeremyPerret/bloub,
 * MIT License, Copyright (c) 2026 Jérémy Perret) — its 14-state catalog, decor
 * geometry and the DOM-free `BotEngine.sample(t)` render loop, none of it
 * adapted. This file is the only place new logic lives: it turns a blobatar
 * seed into the radial silhouette `BotEngine` expects, mounts its output as
 * real SVG elements inside a caller-owned `<svg>`, and drives it with the
 * same delta-clamped `requestAnimationFrame` loop bloub's own player uses
 * (`BloubBot.vue`'s `tick()` — read for reference, not ported: it is Vue
 * component code, out of scope per the porting instructions).
 *
 * Two things this file deliberately does NOT do, both to keep the port
 * verbatim rather than merely inspired-by:
 *
 * - It does not re-smooth `BotEngine.sample(t)`'s own pose numbers (eye
 *   matrices, the body path, decor params). `sample` is already a continuous,
 *   eased function of time — `easeOutQuint` throughout, no snapping, "moteur
 *   sans horloge" by its own doc comment — and reaching into a 64-point path
 *   string or an eye's serialized `matrix()` to filter its numbers a second
 *   time would mean parsing bloub's own output back apart, then re-adding
 *   lag on top of curves already tuned against the reference video. What
 *   *is* new and *is* damped below is this file's own addition: the blur
 *   amount (next point).
 * - Motion blur is `feGaussianBlur`, not afterimage copies. Trails need N
 *   retained historical nodes per fast element, which is exactly the
 *   per-frame allocation the "~20 engines at 60fps" budget rules out; a
 *   filter is one attribute toggle, zero extra nodes.
 *
 * `<filter>`/`<defs>` ids are namespaced per instance (`uid` below) — the
 * static core (`blobatar()`, `parts()`) guarantees no element ids at all, a
 * guarantee this file does not extend and does not need to: its ids never
 * leave the `<g>` this call to `mountEngine` owns.
 */
import type { BlobatarOptions } from "./blobatar";
import { _layout } from "./blobatar";
import { BotEngine, type BotFrame } from "./bloub/engine";
import { EXPRESSIONS, EXPRESSION_BY_ID } from "./bloub/expressions";
import { PROFILE_SAMPLES } from "./bloub/profiles";
import { POSES, STATE_BY_ID, type StateId } from "./bloub/states";
import type { Body } from "./styles/shapes";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Polar radius of a superellipse `|x/rx|^n + |y/ry|^n = 1` at angle `theta`
 * (radians, bloub's convention: 0 = +x, increasing clockwise in SVG's
 * y-down space — see `bloub/shape.ts`'s `ANGLES`). Exact for the "round"
 * silhouette; for the shapes with a custom `path` override (capsule's
 * stadium, droplet's taper, organic/cloud's spline, hexagon/triangle's
 * polygon — see `styles/shapes.ts`) it is the bounding superellipse those
 * shapes are still fit inside, not their exact rendered outline. Good
 * enough to seed bloub's morph-target profile with the right proportions;
 * not pixel-identical to `blobatar()`'s own path for those five shapes.
 */
function radiusAt(theta: number, body: Pick<Body, "rx" | "ry" | "n" | "rot">): number {
  const t = theta - (body.rot * Math.PI) / 180;
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  const n = body.n;
  return (c ** n / body.rx ** n + s ** n / body.ry ** n) ** (-1 / n);
}

/**
 * Samples `body` at bloub's `PROFILE_SAMPLES` (64) fixed angles and
 * normalizes by `body.rx` — the seed's own resting radius — so the result
 * lands in bloub's "1.0 = resting ball radius" unit convention, the same
 * one `bloub/profiles.ts`'s hand-measured arrays use. This becomes the
 * `shape` argument to `BotEngine`, which only substitutes it in on states
 * flagged `baseBody` (idle, wink, wide, notify, swirl) — every other state
 * keeps bloub's own profile, by design (see `bloub/states.ts`).
 */
function seededSilhouette(body: Body): number[] {
  const radii = new Array<number>(PROFILE_SAMPLES);
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    radii[i] = radiusAt((i / PROFILE_SAMPLES) * Math.PI * 2, body) / body.rx;
  }
  return radii;
}

/**
 * Critically-damped exponential approach: moves `from` toward `to` by the
 * fraction of the remaining gap that `dt/tau` of real time covers, frame
 * rate independent (halves the gap every `tau * ln 2` seconds regardless of
 * how `dt` is chopped up). Used below only for the blur amount — see the
 * file header for why it stops there.
 */
const damp = (from: number, to: number, dt: number, tau: number) =>
  to + (from - to) * Math.exp(-dt / tau);

/** Leading `M<x> <y>` of a path string — the cheapest stable point on a body
 * outline to track frame-to-frame, without reparsing the other 63. */
const START_POINT = /^M(-?[\d.]+) (-?[\d.]+)/;
function firstPoint(d: string, out: { x: number; y: number }): boolean {
  const m = START_POINT.exec(d);
  if (!m) return false;
  out.x = +m[1]!;
  out.y = +m[2]!;
  return true;
}

/**
 * Speed-to-blur curve, shared by every fast element: 0 at rest, saturating
 * at `MAX_BLUR` once `speed` (viewBox units/second) clears `SATURATE`.
 * `SATURATE` is pitched at roughly an orbit ring's own linear speed
 * (~1.25 rev/s around a body-radius-scale orbit), so rings and spin sit near
 * the top of the curve while idle drift and ordinary morphs stay at zero.
 */
const MAX_BLUR = 2.2;
const SATURATE = 140; // viewBox units / second
const blurFor = (speed: number) => Math.min(1, speed / SATURATE) * MAX_BLUR;

function el<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** All 14 states bloub's video documents, plus `swirl` (an interface-only
 * transition in bloub, kept here because it costs nothing to expose). */
export function engineStates(): StateId[] {
  return [...STATE_BY_ID.keys()];
}

/** All 16 named eye expressions bloub's face customizer exposes — a separate
 * axis from `states` above (see `bloub/expressions.ts`): a state is a
 * time-bounded animation, an expression is a held pose that only shows on
 * the states flagged `baseFace` (`idle`, `swirl` — `bloub/states.ts`). */
export function engineExpressions(): string[] {
  return EXPRESSIONS.map((e) => e.id);
}

export interface EngineHandle {
  /** Plays a state by id (see `states`). Throws on an unknown id. */
  play(state: string, opts?: { loop?: boolean }): void;
  /** Freezes the current frame; breathing/blinking/morph all pause. */
  stop(): void;
  /** Stops and removes every node this call to `mountEngine` created. */
  destroy(): void;
  /** Every playable state id, `bun test`-stable order (`bloub/states.ts`). */
  states: string[];
  /**
   * Sets (or, given `null`, clears) the held eye expression by id (see
   * `expressions`). Throws on an unknown id. Only visible while the current
   * state is `baseFace` (`idle`, `swirl`); the transition eases over
   * `BotEngine.SHAPE_MORPH` via bloub's own `exprAtTime`/`blendExpression`
   * path — the same eased in-out interpolation `setShape` already rides,
   * not a new easing system.
   */
  setExpression(name: string | null): void;
  /** Every expression id, `bun test`-stable order (`bloub/expressions.ts`). */
  expressions: string[];
}

/**
 * Mounts a bloub-driven blobatar inside `svgRoot` and starts it on `"idle"`.
 *
 * Draws blobatar's own two-color convention (a `head`-filled body path, an
 * `eye`-filled path per eye on top) rather than bloub's mask-cut-hole
 * technique (`BloubBot.vue`'s `<mask>`) — the coordinates and geometry come
 * from bloub verbatim, only the paint does not. Decor (rings, particles,
 * the comet's ribbons) keeps bloub's own rainbow gradient, computed in
 * `bloub/decor.ts` and independent of the blobatar palette.
 *
 * Respects `prefers-reduced-motion`: renders one static frame — at bloub's
 * own `POSES[state]`, the instant its own thumbnails use — and never starts
 * the render loop.
 */
export function mountEngine(
  svgRoot: SVGSVGElement,
  name: string,
  opts?: BlobatarOptions,
): EngineHandle {
  const doc = svgRoot.ownerDocument;
  const { palette, body } = _layout(name, opts);
  const head = palette.head ?? "#000";
  const eye = palette.eye ?? "#fff";

  const engine = new BotEngine(body.rx, "idle", seededSilhouette(body), null);
  const uid = Math.random().toString(36).slice(2, 8);

  // Three independent blur filters — body, rings, particles — each a single
  // `feGaussianBlur` whose `stdDeviation` is the only thing that ever
  // changes after mount. Built once, referenced by `url(#id)`, never
  // rebuilt: a group either carries the `filter` attribute or does not.
  const filterDefs = el(doc, "defs");
  const mkFilter = (tag: string) => {
    const fe = el(doc, "feGaussianBlur", { stdDeviation: 0 });
    const filter = el(doc, "filter", {
      id: `${uid}-${tag}`,
      x: "-60%", y: "-60%", width: "220%", height: "220%",
    });
    filter.appendChild(fe);
    filterDefs.appendChild(filter);
    return fe;
  };
  const bodyBlurEl = mkFilter("blur-body");
  const arcBlurEl = mkFilter("blur-arcs");
  const dotBlurEl = mkFilter("blur-dots");

  const root = el(doc, "g", { transform: `translate(${body.cx} ${body.cy})` });
  const defs = el(doc, "defs");
  const back = el(doc, "g", { fill: "none", "stroke-linecap": "round" });
  const bodyPath = el(doc, "path", { fill: head });
  const eyes = el(doc, "g");
  const front = el(doc, "g", { fill: "none", "stroke-linecap": "round" });
  root.append(filterDefs, defs, back, bodyPath, eyes, front);
  svgRoot.appendChild(root);

  // Velocity bookkeeping, reused every frame rather than reallocated. Only
  // one representative point per zone is tracked — the body's own leading
  // path point (`firstPoint`, above), and the *first* arc's and *first*
  // dot's own reference point — one number per zone is enough to drive one
  // shared blur filter per zone, and it is the zone's blur that moves, not
  // each element's individually.
  const bodyPt = { x: 0, y: 0 };
  let bodyPtValid = false;
  let bodyBlur = 0;
  const arcPt = { x: 0, y: 0 };
  let arcPtValid = false;
  let arcBlur = 0;
  const dotPt = { x: 0, y: 0 };
  let dotPtValid = false;
  let dotBlur = 0;

  const arcGroup = (frame: BotFrame, half: "back" | "front", group: SVGGElement) => {
    const attrs: Record<string, string | number> = {};
    if (arcBlur > 0.05) attrs.filter = `url(#${uid}-blur-arcs)`;
    group.replaceChildren(
      ...frame.arcs.map((a) =>
        el(doc, "path", {
          d: a[half],
          stroke: `url(#${uid}-${a.id})`,
          "stroke-width": a.width,
          opacity: a.opacity,
          ...attrs,
        }),
      ),
    );
  };

  const dotGroup = (frame: BotFrame, group: SVGGElement) => {
    if (dotBlur > 0.05) group.setAttribute("filter", `url(#${uid}-blur-dots)`);
    else group.removeAttribute("filter");
    group.replaceChildren(
      ...frame.dots.map((d) =>
        d.d
          ? el(doc, "path", {
              d: d.d,
              transform: `translate(${d.x} ${d.y}) rotate(${d.rot ?? 0}) scale(${body.rx})`,
              fill: d.color ?? head,
              opacity: d.opacity,
            })
          : el(doc, "circle", { cx: d.x, cy: d.y, r: d.r, fill: d.color ?? head, opacity: d.opacity }),
      ),
    );
  };

  let dotsBack: SVGGElement | null = null;
  let dotsFront: SVGGElement | null = null;

  /**
   * Updates the three damped blur amounts from this frame's motion, given
   * how much real time (`dt`, seconds) passed since the last one. Zero
   * allocation: `bodyPt`/`arcPt`/`dotPt` are overwritten in place, never
   * replaced. Only meaningful on the animated path (`tick`) — the reduced-
   * motion static render never calls this, so its filters stay at 0 and are
   * simply never attached (see `arcGroup`/`dotGroup`/body below).
   */
  const scratch = { x: 0, y: 0 };

  const updateBlur = (frame: BotFrame, dt: number) => {
    const speed = (prev: { x: number; y: number }, cur: { x: number; y: number }) =>
      dt > 0 ? Math.hypot(cur.x - prev.x, cur.y - prev.y) / dt : 0;

    if (firstPoint(frame.bodyPath, scratch)) {
      if (dt > 0 && bodyPtValid) bodyBlur = damp(bodyBlur, blurFor(speed(bodyPt, scratch)), dt, 0.08);
      bodyPt.x = scratch.x;
      bodyPt.y = scratch.y;
      bodyPtValid = true;
    }

    const a0 = frame.arcs[0];
    if (dt > 0 && arcPtValid && a0) {
      const cur = { x: a0.grad.x1, y: a0.grad.y1 };
      arcBlur = damp(arcBlur, blurFor(speed(arcPt, cur)), dt, 0.08);
      arcPt.x = cur.x;
      arcPt.y = cur.y;
    } else if (a0) {
      arcPt.x = a0.grad.x1;
      arcPt.y = a0.grad.y1;
      arcPtValid = true;
    } else {
      arcPtValid = false;
      arcBlur = damp(arcBlur, 0, Math.max(dt, 0.001), 0.08);
    }

    const d0 = frame.dots[0];
    if (dt > 0 && dotPtValid && d0) {
      const cur = { x: d0.x, y: d0.y };
      dotBlur = damp(dotBlur, blurFor(speed(dotPt, cur)), dt, 0.08);
      dotPt.x = cur.x;
      dotPt.y = cur.y;
    } else if (d0) {
      dotPt.x = d0.x;
      dotPt.y = d0.y;
      dotPtValid = true;
    } else {
      dotPtValid = false;
      dotBlur = damp(dotBlur, 0, Math.max(dt, 0.001), 0.08);
    }

    bodyBlurEl.setAttribute("stdDeviation", String(Math.round(bodyBlur * 100) / 100));
    arcBlurEl.setAttribute("stdDeviation", String(Math.round(arcBlur * 100) / 100));
    dotBlurEl.setAttribute("stdDeviation", String(Math.round(dotBlur * 100) / 100));
  };

  const render = (frame: BotFrame) => {
    defs.replaceChildren(
      ...frame.arcs.map((a) => {
        const grad = el(doc, "linearGradient", {
          id: `${uid}-${a.id}`,
          gradientUnits: "userSpaceOnUse",
          x1: a.grad.x1, y1: a.grad.y1, x2: a.grad.x2, y2: a.grad.y2,
        });
        grad.append(
          ...a.grad.stops.map((c, i) =>
            el(doc, "stop", {
              offset: a.grad.stops.length > 1 ? i / (a.grad.stops.length - 1) : 0,
              "stop-color": c,
            }),
          ),
        );
        return grad;
      }),
    );

    arcGroup(frame, "back", back);
    arcGroup(frame, "front", front);

    // Particles behind the body (bloub's burst) vs. in front: same DOM slot
    // either way, just moved between `back`/`front`'s children each frame —
    // cheaper than keeping two permanently-mounted groups toggling opacity,
    // and the dot count is tiny (<=5).
    if (dotsBack) dotsBack.remove();
    if (dotsFront) dotsFront.remove();
    const slot = frame.dotsBehind ? back : front;
    const group = el(doc, "g");
    slot.appendChild(group);
    dotGroup(frame, group);
    if (frame.dotsBehind) dotsBack = group;
    else dotsFront = group;

    bodyPath.setAttribute("d", frame.bodyPath);
    bodyPath.setAttribute("opacity", String(frame.bodyAlpha));
    if (bodyBlur > 0.05) bodyPath.setAttribute("filter", `url(#${uid}-blur-body)`);
    else bodyPath.removeAttribute("filter");

    eyes.replaceChildren(
      ...frame.eyes.map((e) =>
        el(doc, "path", { d: e.d, transform: e.matrix, opacity: e.alpha, fill: eye }),
      ),
    );

    if (frame.notif) {
      front.appendChild(
        el(doc, "circle", { cx: frame.notif.x, cy: frame.notif.y, r: frame.notif.r, fill: "#2496e8" }),
      );
    }
  };

  const reducedMotion = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  let raf = 0;
  let last = 0;
  let clock = 0;
  let loop = false;
  let stateStart = 0;
  let current: StateId = "idle";

  render(engine.sample(0));

  function tick(ms: number) {
    raf = doc.defaultView!.requestAnimationFrame(tick);
    // Tighter than bloub's own 64ms: a hitch slows time down instead of
    // jumping the pose forward, which reads as a stutter rather than a snap
    // — the same "nothing ever snaps" goal the blur/damping above serves.
    // Still bounded, for the same reason bloub bounds it: a backgrounded tab
    // resumes without a multi-second leap when rAF comes back.
    const dt = last ? Math.min((ms - last) / 1000, 0.034) : 0;
    last = ms;
    clock += dt;

    const def = STATE_BY_ID.get(current)!;
    // Orbit's own pose math never plateaus — its rotation (`states.ts`'s
    // `rot = -TAU * 1.25 * t * ramp`) has no clamp on `t`, so it keeps
    // spinning at a constant rate forever once its 0.35s ramp-in is done.
    // Forcing a periodic `reset()` on it would be the only thing that ever
    // interrupts that spin, snapping the phase back to 0 — so it is simply
    // never reset. Every other looping state's pose *does* plateau (every
    // one of its terms is wrapped in `clamp(...)`), so it needs a periodic
    // restart to keep animating at all, which is where the `duration`
    // bookkeeping below is for.
    const selfSustaining = current === "orbit";
    if (loop && !selfSustaining) {
      // Restart `duration + def.morph` in, not at `duration` itself: bloub's
      // own transient elements (particle windows, ribbon fades, eyeAlpha
      // ramps) finish inside that extra margin, so by the time `reset()`
      // fires the state has settled to its own resting silhouette — for
      // burst and comet specifically, that resting shape is `circle(1)`,
      // the *same* shape `reset()` restarts from (verified against
      // `bloub/states.ts`'s own pose formulas). The restart is then only an
      // eye-visibility pop, not a body-shape snap.
      if (clock - stateStart >= def.duration + def.morph) {
        engine.reset(current, clock);
        stateStart = clock;
      }
    } else if (!loop && current !== "idle" && clock - stateStart >= def.duration) {
      // This is the bug this whole block used to have, the other way
      // around: previously the loop branch above called `reset()` without
      // ever advancing `stateStart`, so once a looping state's `duration`
      // first elapsed, the guard stayed true on *every* subsequent frame —
      // `reset()` fired every frame, pinning `now - tCur` at ~0 forever.
      // That reads as the state frozen at its very first instant, which is
      // this file's root cause for burst never exploding, orbit/comet never
      // looping, and thinking/alert/sleep/exclaim/notify/swirl reading as
      // static tiles: all of it was one missing assignment.
      current = "idle";
      stateStart = clock;
      engine.setState("idle", clock);
    }

    const frame = engine.sample(clock);
    updateBlur(frame, dt);
    render(frame);
  }

  function ensureRunning() {
    if (!raf && !reducedMotion) {
      last = 0;
      raf = doc.defaultView!.requestAnimationFrame(tick);
    }
  }

  return {
    states: engineStates(),
    expressions: engineExpressions(),
    play(state, o) {
      if (!STATE_BY_ID.has(state as StateId)) {
        throw new Error(`mountEngine: unknown bloub state "${state}"`);
      }
      const id = state as StateId;
      if (reducedMotion) {
        engine.reset(id, 0);
        render(engine.sample(POSES[id]));
        return;
      }
      current = id;
      stateStart = clock;
      loop = !!o?.loop;
      engine.setState(id, clock);
      ensureRunning();
    },
    setExpression(name) {
      const expr = name === null ? null : EXPRESSION_BY_ID.get(name);
      if (name !== null && !expr) {
        throw new Error(`mountEngine: unknown bloub expression "${name}"`);
      }
      if (reducedMotion) {
        // Same "one static frame, no loop" contract `play()` keeps above:
        // back-date `exprAt` by the morph's own duration so `exprAtTime`
        // reads `k >= 1` on the very next sample — snaps straight to the
        // target pose instead of rendering a frozen mid-blend.
        engine.setExpression(expr ?? null, clock - BotEngine.SHAPE_MORPH);
        render(engine.sample(clock));
        return;
      }
      engine.setExpression(expr ?? null, clock);
      ensureRunning();
    },
    stop() {
      if (raf) {
        doc.defaultView!.cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    destroy() {
      if (raf) doc.defaultView!.cancelAnimationFrame(raf);
      raf = 0;
      root.remove();
    },
  };
}
