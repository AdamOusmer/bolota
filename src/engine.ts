/**
 * The bridge between bolota's seeded body and bloub's animation engine.
 *
 * `src/bloub/` is a verbatim port of bloub (https://github.com/jeremyPerret/bloub,
 * MIT License, Copyright (c) 2026 Jérémy Perret) — its 13-state catalog, decor
 * geometry and the DOM-free `BotEngine.sample(t)` render loop, none of it
 * adapted. This file is the only place new logic lives: it turns a bolota
 * seed into the radial silhouette `BotEngine` expects, mounts its output as
 * real SVG elements inside a caller-owned `<svg>`, and drives it with the
 * same delta-clamped `requestAnimationFrame` loop bloub's own player uses
 * (`BloubBot.vue`'s `tick()` — read for reference, not ported: it is Vue
 * component code, out of scope per the porting instructions).
 *
 * This file deliberately does NOT re-smooth `BotEngine.sample(t)`'s own pose
 * numbers (eye matrices, the body path, decor params), to keep the port
 * verbatim rather than merely inspired-by: `sample` is already a continuous,
 * eased function of time — `easeOutQuint` throughout, no snapping, a
 * "clockless engine" by its own doc comment — and reaching into a 64-point
 * path string or an eye's serialized `matrix()` to filter its numbers a
 * second time would mean parsing bloub's own output back apart, then
 * re-adding lag on top of curves already tuned against the reference video.
 * Rendering here is otherwise a direct, unfiltered pass-through of whatever
 * `sample` returns — no motion blur or other post-processing (a prior
 * version had a velocity-driven `feGaussianBlur` on the body/rings/
 * particles/eyes; user call was to drop it and render sharp always, so it's
 * gone rather than dormant).
 *
 * `<defs>` ids are namespaced per instance (`uid` below) — the static core
 * (`bolota()`, `parts()`) guarantees no element ids at all, a guarantee
 * this file does not extend and does not need to: its ids never leave the
 * `<g>` this call to `mountEngine` owns.
 *
 * Provenance note (referenced from every `src/bloub/*.ts` header): the
 * original bloub source is French throughout — identifiers, comments, doc
 * prose. `src/bloub/` translates all of it to English (this bridge file
 * included) so the library reads as a single-language codebase; nothing
 * about the geometry, timing, or logic changed in the process, only names
 * and prose. The untranslated original is preserved verbatim, unrenamed, at
 * https://github.com/AdamOusmer/bloub — that repository is the source of
 * truth for what the French originals said before this translation pass.
 */
import type { BolotaOptions } from "./bolota";
import { _layout } from "./bolota";
import { BotEngine, type BotFrame, type Look } from "./bloub/engine";
import { EXPRESSIONS, EXPRESSION_BY_ID } from "./bloub/expressions";
import { MAX_PITCH_DRIFT, MAX_YAW_DRIFT } from "./bloub/face";
import { PITCH } from "./bloub/gaze";
import { clamp, lerp } from "./bloub/math";
import { PROFILE_SAMPLES } from "./bloub/profiles";
import { POSES, STATE_BY_ID, type StateId } from "./bloub/states";
import { superellipse } from "./shape";
import type { Body } from "./styles/shapes";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Flattens an SVG path `d` into one polyline per subpath. Covers exactly
 * the command vocabulary every body-drawing function in `styles/shapes.ts`
 * emits — `superellipse`/`spline` (M/C), `box` (M/H/V/Z), `polygon` (M/Q) —
 * nothing here needs `A` (arcs): that command only ever appeared in eye
 * paths, and those are drawn separately (`capsulePath` in `shape.ts`).
 * Curves are subdivided into `steps` straight segments so the result can be
 * ray-cast against directly.
 */
function flattenPath(d: string, steps = 12): [number, number][][] {
  const cmds = d.match(/[MLHVCQZ][^MLHVCQZ]*/gi) ?? [];
  const nums = (s: string) => (s.match(/-?\d+\.?\d*/g) ?? []).map(Number);
  const polys: [number, number][][] = [];
  let poly: [number, number][] = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  for (const raw of cmds) {
    const args = nums(raw.slice(1));
    switch (raw[0]!.toUpperCase()) {
      case "M":
        if (poly.length > 1) polys.push(poly);
        x = args[0]!; y = args[1]!; sx = x; sy = y;
        poly = [[x, y]];
        break;
      case "L":
        x = args[0]!; y = args[1]!;
        poly.push([x, y]);
        break;
      case "H":
        x = args[0]!;
        poly.push([x, y]);
        break;
      case "V":
        y = args[0]!;
        poly.push([x, y]);
        break;
      case "C": {
        const [x1, y1, x2, y2, x3, y3] = args as [number, number, number, number, number, number];
        for (let i = 1; i <= steps; i++) {
          const s = i / steps, m = 1 - s;
          poly.push([
            m ** 3 * x + 3 * m ** 2 * s * x1 + 3 * m * s ** 2 * x2 + s ** 3 * x3,
            m ** 3 * y + 3 * m ** 2 * s * y1 + 3 * m * s ** 2 * y2 + s ** 3 * y3,
          ]);
        }
        x = x3; y = y3;
        break;
      }
      case "Q": {
        const [x1, y1, x2, y2] = args as [number, number, number, number];
        for (let i = 1; i <= steps; i++) {
          const s = i / steps, m = 1 - s;
          poly.push([m ** 2 * x + 2 * m * s * x1 + s ** 2 * x2, m ** 2 * y + 2 * m * s * y1 + s ** 2 * y2]);
        }
        x = x2; y = y2;
        break;
      }
      case "Z":
        x = sx; y = sy;
        poly.push([sx, sy]);
        break;
    }
  }
  if (poly.length > 1) polys.push(poly);
  return polys;
}

function circlePolygon(cx: number, cy: number, r: number, steps = 32): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/**
 * Farthest distance from `(ox, oy)` to any edge of any polygon in `polys`
 * along the ray at angle `theta` — the union envelope of every shape in the
 * set, which is exactly what overlapping filled circles/paths compose to
 * visually. 0 if the ray hits nothing (the caller falls back to `body.rx`
 * for that angle).
 */
function rayFarthest(ox: number, oy: number, theta: number, polys: [number, number][][]): number {
  const dx = Math.cos(theta), dy = Math.sin(theta);
  let best = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length - 1; i++) {
      const [x1, y1] = poly[i]!;
      const [x2, y2] = poly[i + 1]!;
      const ex = x2 - x1, ey = y2 - y1;
      const det = ex * dy - ey * dx;
      if (Math.abs(det) < 1e-9) continue;
      const t = (ex * (y1 - oy) - ey * (x1 - ox)) / det;
      const u = (dx * (y1 - oy) - dy * (x1 - ox)) / det;
      if (t > best && u >= 0 && u <= 1) best = t;
    }
  }
  return best;
}

/**
 * Samples the seed's *actual rendered body* — core outline plus petals plus
 * any extra unioned shapes, exactly what `styles/compose.ts`'s `render()`
 * draws — at bloub's `PROFILE_SAMPLES` (64) fixed angles, and normalizes by
 * `body.rx` so the result lands in bloub's "1.0 = resting ball radius" unit
 * convention, the same one `bloub/profiles.ts`'s hand-measured arrays use.
 *
 * This used to be the *analytic* superellipse formula alone — exact for
 * "round" and "boxy" (no `path` override), wrong for the other eight
 * styles, most visibly capsule: its body is a rectangle-plus-two-circles
 * stadium (`styles/shapes.ts`'s `capsule.path`), and approximating that
 * with a smooth superellipse curve is indistinguishable from a squashed
 * ellipse — which is exactly the bug report this replaced. Geometric
 * ray-casting against the real outline is exact for every style instead.
 *
 * This becomes the `shape` argument to `BotEngine`, which only substitutes
 * it in on states flagged `baseBody` (idle, wink, wide, notify, swirl) —
 * every other state keeps bloub's own profile, by design (`bloub/states.ts`).
 */
function seededSilhouette(
  body: Body,
  draw: ((b: Body) => string) | undefined,
  petals: { cx: number; cy: number; r: number }[],
  extra: string[],
): number[] {
  const polys = flattenPath(draw ? draw(body) : superellipse(body));
  for (const p of petals) polys.push(circlePolygon(p.cx, p.cy, p.r));
  for (const e of extra) polys.push(...flattenPath(e));

  const radii = new Array<number>(PROFILE_SAMPLES);
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    const theta = (i / PROFILE_SAMPLES) * Math.PI * 2;
    const r = rayFarthest(body.cx, body.cy, theta, polys);
    radii[i] = (r > 0 ? r : body.rx) / body.rx;
  }
  return radii;
}

// --- cursor-follow gaze (bloub port, src/bloub/gaze.ts) --------------------
//
// bloub's own `lookTarget` (BloubBot.vue's `aim()`) bakes in two things that
// are specific to bloub's own settings-panel chrome, not to "eyes track the
// pointer" as a portable library feature: a constant `-TURN` yaw bias (the
// bot looks left, toward its own settings panel, even with the pointer
// centered) and a `tour` ramp tied to bloub's view-entry swirl animation,
// which bolota has no equivalent of. Both are dropped; `followLook` below
// is this bridge's own replacement, not a call into `gaze.ts`'s `lookTarget`.
//
// Deflection range is `MAX_YAW_DRIFT`/`MAX_PITCH_DRIFT` (16deg/16deg,
// `bloub/face.ts`) rather than `gaze.ts`'s own `YAW_MAX`/`PITCH_MAX`
// (16deg/13deg): those were bloub's numbers for bloub's own, much smaller
// idle wander (+-7.1/+-5.5deg pre-port); this branch's own eye-anchoring
// work already widened bolota's idle wander to exactly
// MAX_YAW_DRIFT/MAX_PITCH_DRIFT and proved (`test/eyefit.test.ts`, long
// sweeps) that `eyefit.ts`'s containment solve stays safe at that bound —
// reusing it here means a tracked cursor near the viewport edge drives the
// gaze to the *same* proven-safe max the idle drift already reaches, which
// reads as a bigger, more deliberate sweep than idle wander's own (idle
// rarely sits at its own peak; a tracked pointer can hold there). `PITCH`
// (the rest-height bias, cursor centered) is still `gaze.ts`'s own 10deg —
// untouched, unrelated to the amplitude question above.
export const FOLLOW_MAX_YAW = MAX_YAW_DRIFT;
export const FOLLOW_MAX_PITCH = MAX_PITCH_DRIFT;

/**
 * Pure pointer-position -> gaze-target math, no DOM: `nx`/`ny` are already
 * normalized to [-1, 1] (see `aimGaze`, below, for how a raw pointer
 * position becomes these). Exported for direct testing of the deflection
 * range independent of the DOM bridge (`test/follow.test.ts`) — the same
 * "test the pure rule on its own" split `gaze.ts`'s own `lookTarget` uses.
 */
export function followLook(nx: number, ny: number): Look {
  return {
    yaw: nx * FOLLOW_MAX_YAW,
    // positive pitch = looking up, while screen y goes down
    pitch: PITCH - ny * FOLLOW_MAX_PITCH,
    mix: 1,
    spin: 0,
    wander: 0,
  };
}

/**
 * CSS's `ease` keyword, `cubic-bezier(0.25, 0.1, 0.25, 1)` — fast initial
 * response, gentle deceleration into the target. User-requested swap-in for
 * the follow retarget specifically (idle wander and expression morphs keep
 * `BotEngine`'s own curves, untouched below). Not `bloub/math.ts`'s
 * `easings` — that file is a verbatim port and this curve has no bloub
 * equivalent, so it lives here instead, beside the rest of this bridge's
 * own math (`followLook` above).
 *
 * Standard cubic-bezier solve: `x(t)`/`y(t)` are the same third-degree
 * Bernstein form `easings.easeOutCubic` etc. expand from by hand, but a
 * *generic* two-point bezier (unlike those) has no closed form from
 * `x` back to `t` — Newton-Raphson on `x(t) - x = 0` converges in a
 * handful of iterations for control points this mild (both x-coordinates
 * strictly increasing, no sharp corner), same technique browsers use for
 * CSS's own `cubic-bezier()` easing functions.
 */
function cubicBezierEase(p1x: number, p1y: number, p2x: number, p2y: number): (x: number) => number {
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleXDeriv = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = sampleXDeriv(t);
      if (Math.abs(d) < 1e-6) break;
      t -= (sampleX(t) - x) / d;
    }
    return sampleY(t);
  };
}
export const followEase = cubicBezierEase(0.25, 0.1, 0.25, 1);

// `BotEngine.LOOK_MORPH` (0.24s) is bloub's own constant for its settings-
// panel arrival — an occasional, discrete retarget, not a continuously-
// updating pointer stream. Driving `setLook` off a live `pointermove`
// stream at that duration reads as laggy: each move resets the morph's own
// clock (see `BotEngine.setLook`'s own doc comment — no stale-target
// guard, by design, so a *moving* target never fully lands), and at 0.24s
// the per-frame progress from a near-continuous stream of resets is small
// enough that a fast sweep visibly trails the cursor by most of a second.
// A short, dedicated pointer-tracking constant fixes this: simulated
// against a 1s linear sweep across the full deflection range, 0.24s trails
// by 15.3 of 16deg at t=1s; 0.08s trails by 7.1deg; 0.05s by 2.1deg. 0.08s
// is the pick — fast enough that a *held* pointer (the common case, since
// `aimGaze` only calls `setLook` when the target actually moves) completes
// its single clean arrival in well under the 100ms "starts moving" bar,
// while staying long enough (~5 frames) to still read as an eased arrival
// rather than a binary snap for quick, repeated micro-movements.
//
// This is now `followEase`'s own duration, not a morph handed to
// `BotEngine.setLook` — `aimGaze` drives the curve itself every tick and
// feeds `setLook` the already-eased yaw/pitch (see `PASSTHROUGH_MORPH`
// below), so `BotEngine`'s own `easeInOutCubic` retarget curve never runs
// on the follow path at all.
export const FOLLOW_MORPH = 0.08;

// A near-zero morph handed to `engine.setLook` once `aimGaze` has already
// computed this tick's eased yaw/pitch itself — `BotEngine.setLook` can't
// take `0` (its own `lookAtTime` would divide by it), so this is the same
// "just enough to not be zero" duration bloub's own `BloubBot.vue` uses for
// its scripted (already-eased) gazes (`SCRIPT_MORPH = 1 / 60`).
//
// Passing `now` itself here does NOT work, even with this tiny a morph:
// `setLook(look, now, morph)` sets `this.lookAt = now`, and the *same*
// tick's `engine.sample(now)` right after reads `k = (now - this.lookAt) /
// morph = 0` — `BotEngine`'s own fast path only returns the freshly-set
// `this.look` once `k >= 1`, so at `k = 0` it renders `lookPrev` (the
// value from BEFORE this call) instead, no matter how small `morph` is.
// Called every tick with a new pre-eased value, that made the display
// permanently a full tick behind whatever `aimGaze` had just computed —
// measured live, the eyes never converged, which is what the "still really
// slow" report was actually catching (not `FOLLOW_MORPH` itself).
//
// Fix: backdate the timestamp handed to `setLook` by `PASSTHROUGH_MORPH`,
// i.e. tell `BotEngine` this target was set `PASSTHROUGH_MORPH` seconds
// ago. `k` at the *current* real `now` is then `PASSTHROUGH_MORPH /
// PASSTHROUGH_MORPH = 1` exactly — the fast path fires immediately, so
// this tick's `sample()` shows precisely the eased value just computed,
// not a lagged one. `PASSTHROUGH_MORPH` is kept far below any real frame
// interval (down to ~240Hz refresh) so the *next* call's own `lookPrev`
// capture also lands past `k = 1` against the previous (also backdated)
// call — both directions exact, no residual blend either way.
const PASSTHROUGH_MORPH = 0.001;

function el<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Bloub's own catalog, plus `swirl` (an interface-only transition in
 * bloub, kept here because it costs nothing to expose) and `wander`
 * (bolota's own addition — the wandering-gaze choreography `idle` used to
 * be, split out under its own id; see `StateId`'s doc comment in
 * `bloub/states.ts`), 14 ids total (`STATES.length`/`STATE_BY_ID.size`,
 * not restated here as a number that could drift). */
export function engineStates(): StateId[] {
  return [...STATE_BY_ID.keys()];
}

/** All 16 named eye expressions bloub's face customizer exposes — a separate
 * axis from `states` above (see `bloub/expressions.ts`): a state is a
 * time-bounded animation, an expression is a held pose that only shows on a
 * state that accepts one — `baseFace` (`idle`, `wander`, `swirl`: the
 * "resting face" states) or the bolota-added `acceptsExpression` (`play`,
 * `burst`, `comet`: states that keep driving their own body/decor/timing —
 * and, for `burst`/`comet`, their own collapse/regrow eye alpha — but hand
 * the eyes' POSE to the expression when one is set — `bloub/states.ts`,
 * each flag's own doc comment). Every other state choreographs its own
 * gaze/eyes as part of the gesture and ignores `setExpression` entirely. */
export function engineExpressions(): string[] {
  return EXPRESSIONS.map((e) => e.id);
}

export interface EngineHandle {
  /** Plays a state by id (see `states`). Throws on an unknown id. */
  play(state: string, opts?: { loop?: boolean }): void;
  /** Sugar for `play(state, { loop: true })`. */
  loop(state: string): void;
  /** Freezes the current frame; breathing/blinking/morph all pause. */
  stop(): void;
  /**
   * Enables or disables cursor-follow: the eyes track the pointer while it
   * moves over `target` (an element, or `"window"` for the whole page), and
   * fall back to idle drift the instant it leaves. `false` disables tracking
   * and releases the gaze back to whatever state is playing. Off by default;
   * omitting `target` on an enabling call is shorthand for `"window"`.
   */
  follow(target?: Element | "window" | false): void;
  /** Stops and removes every node this call to `mountEngine` created. */
  destroy(): void;
  /** Every playable state id, `bun test`-stable order (`bloub/states.ts`). */
  states: string[];
  /**
   * Sets (or, given `null`, clears) the held eye expression by id (see
   * `expressions`). Throws on an unknown id. Only visible on a state that
   * accepts one (`idle`/`wander`/`swirl` via `baseFace`, `play`/`burst`/
   * `comet` via `acceptsExpression` — see `engineExpressions`'s own doc
   * comment); ignored on every other state, which keeps full ownership of
   * its own eyes. The transition eases over `BotEngine.SHAPE_MORPH` via
   * bloub's own `exprAtTime`/`blendExpression` path — the same eased
   * in-out interpolation `setShape` already rides, not a new easing
   * system.
   */
  setExpression(name: string | null): void;
  /** Every expression id, `bun test`-stable order (`bloub/expressions.ts`). */
  expressions: string[];
}

/**
 * Mounts a bloub-driven bolota inside `svgRoot` and starts it on `"idle"`.
 *
 * Draws bolota's own two-color convention (a `head`-filled body path, an
 * `eye`-filled path per eye on top) rather than bloub's mask-cut-hole
 * technique (`BloubBot.vue`'s `<mask>`) — the coordinates and geometry come
 * from bloub verbatim, only the paint does not. Decor (rings, particles,
 * the comet's ribbons) keeps bloub's own rainbow gradient, computed in
 * `bloub/decor.ts` and independent of the bolota palette.
 *
 * Respects `prefers-reduced-motion`: renders one static frame — at bloub's
 * own `POSES[state]`, the instant its own thumbnails use — and never starts
 * the render loop.
 */
export function mountEngine(
  svgRoot: SVGSVGElement,
  name: string,
  opts?: BolotaOptions,
): EngineHandle {
  const doc = svgRoot.ownerDocument;
  const { palette, body, draw, petals, extra } = _layout(name, opts);
  const head = palette.head ?? "#000";
  const eye = palette.eye ?? "#fff";

  const engine = new BotEngine(body.rx, "idle", seededSilhouette(body, draw, petals, extra), null);
  const uid = Math.random().toString(36).slice(2, 8);

  const root = el(doc, "g", { transform: `translate(${body.cx} ${body.cy})` });
  const defs = el(doc, "defs");
  const back = el(doc, "g", { fill: "none", "stroke-linecap": "round" });
  const bodyPath = el(doc, "path", { fill: head });
  const eyes = el(doc, "g");
  const front = el(doc, "g", { fill: "none", "stroke-linecap": "round" });
  root.append(defs, back, bodyPath, eyes, front);
  svgRoot.appendChild(root);

  const arcGroup = (frame: BotFrame, half: "back" | "front", group: SVGGElement) => {
    group.replaceChildren(
      ...frame.arcs.map((a) =>
        el(doc, "path", {
          d: a[half],
          stroke: `url(#${uid}-${a.id})`,
          "stroke-width": a.width,
          opacity: a.opacity,
        }),
      ),
    );
  };

  const dotGroup = (frame: BotFrame, group: SVGGElement) => {
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

  // --- cursor-follow gaze (bloub port, src/bloub/gaze.ts) ------------------
  // Math (`followLook`) and the pointer-tracking constants below it are
  // module-level, not per-instance — see their own doc comments above.
  let following = false;
  let pointer: { x: number; y: number } | null = null;
  let followCleanup: (() => void) | null = null;
  // Last target actually handed to `engine.setLook`, so `aimGaze` can tell
  // a genuinely new position apart from a merely-still-known one and skip
  // redundant retargets.
  let lastNx: number | null = null;
  let lastNy: number | null = null;

  // Arbitration: while `following` is true AND a pointer position is
  // known, follow owns the eyes completely (`wander: 0`, held there for as
  // long as the pointer stays put — a parked cursor means eyes locked on
  // it calmly, not a cue to hand back to idle). The ONLY way back to idle
  // wander is `pointer` going `null` — an actual pointerleave, or
  // `follow(false)`/`destroy()` (both call `detachFollow`, which clears
  // `pointer`). An earlier version also released after a few seconds of
  // pointer *stillness*; that fought a genuinely parked cursor (wander
  // tugging the eyes off target between glances) and is gone — stillness
  // is no longer a signal for anything here.
  //
  // `followEase`'s own from/to/start — driven here, not through
  // `BotEngine.setLook`'s built-in morph (hardcoded to `easeInOutCubic`
  // engine-wide), because the ask is CSS `ease` on the follow retarget
  // specifically while idle wander and expression morphs keep their
  // existing curves untouched. `easedNow` is a plain time-based eased
  // interpolation with a fixed `FOLLOW_MORPH` duration — deliberately NOT
  // an exponential/`damp()`-style smoother: a damper's own time constant
  // would sit *in front of* this curve and stack additional latency on
  // top of it, which is exactly what made retargeting feel slow to start
  // in the first place (see `FOLLOW_MORPH`'s doc comment above).
  let fromYaw = 0;
  let fromPitch = 0;
  let toYaw = 0;
  let toPitch = 0;
  let retargetAt = 0;
  /** True while `followEase`'s curve hasn't reached its target yet — once
   * it has, `aimGaze` stops pushing a `setLook` every tick until the next
   * genuine pointer change. */
  let transitioning = false;

  function easedNow(now: number): { yaw: number; pitch: number } {
    const k = clamp((now - retargetAt) / FOLLOW_MORPH);
    const e = followEase(k);
    return { yaw: lerp(fromYaw, toYaw, e), pitch: lerp(fromPitch, toPitch, e) };
  }

  function detachFollow() {
    followCleanup?.();
    followCleanup = null;
    following = false;
    pointer = null;
  }

  function attachFollow(target: Element | "window") {
    detachFollow();
    const view = doc.defaultView;
    if (!view) return;
    const moveTarget: EventTarget = target === "window" ? view : target;
    // pointerleave never fires on `window` itself; bloub listens on
    // `document` for the same "pointer left the page" signal.
    const leaveTarget: EventTarget = target === "window" ? doc : target;
    const onMove = (event: Event) => {
      const e = event as PointerEvent;
      // Touch has no cursor that lingers: a lifted finger would leave the
      // gaze stuck on the last touched point, which reads as a bug.
      if (e.pointerType === "touch") return;
      pointer = { x: e.clientX, y: e.clientY };
    };
    const onLeave = () => {
      pointer = null;
    };
    moveTarget.addEventListener("pointermove", onMove);
    leaveTarget.addEventListener("pointerleave", onLeave);
    followCleanup = () => {
      moveTarget.removeEventListener("pointermove", onMove);
      leaveTarget.removeEventListener("pointerleave", onLeave);
    };
    following = true;
    lastNx = null;
    lastNy = null;
    transitioning = false;
    ensureRunning();
  }

  /**
   * Re-evaluated every tick — the avatar's own box can move under a fixed
   * pointer (scroll, layout, resize), and bloub re-reads it every frame for
   * the same reason ("the rectangle is re-read every frame") — but only
   * *retargets* (captures a new `from`/`to`/`retargetAt`) when the result
   * actually differs from the last one applied (see the note above
   * `lastNx`). While `followEase`'s curve is still catching up to its
   * target (`transitioning`), this pushes the freshly-eased yaw/pitch into
   * `engine.setLook` every tick — `PASSTHROUGH_MORPH`'s own doc comment
   * covers why that doesn't re-introduce `BotEngine`'s own morph on top of
   * it. Once settled, a parked pointer holds the last target indefinitely:
   * `BotEngine` keeps whatever `Look` it was last given, so there is
   * nothing further to push until the pointer actually moves or leaves.
   *
   * Only engages on a `baseFace` state (bloub's own gate: `BloubBot.vue`'s
   * `aim()` bails the same way — "`baseFace` makes it carry the resting
   * face, so cursor-follow applies from this entrance onward [...] a
   * state with its own gaze pose [...] would hand off to the next state
   * mid-motion, and the eyes would jump all at once",
   * `bloub/states.ts`'s own doc comment on `swirl`). Only `idle`/`swirl`
   * are `baseFace: true` in this port's `states.ts` — every other state
   * (`orbit`, `burst`, `wink`, ...) choreographs its own `pose.gaze`, which
   * `mix: 1` would otherwise silently override outright.
   */
  function aimGaze(now: number) {
    if (!following) return;
    const box = svgRoot.getBoundingClientRect();
    // A zero-area box means nothing to aim at, and normalizing below would
    // divide by zero into a `NaN` that `engine.setLook` would then hold
    // onto forever (it keeps the last *finite* target on purpose).
    if (!box || box.width === 0 || box.height === 0) return;
    const stateOwnsGaze = !STATE_BY_ID.get(current)?.baseFace;
    if (!pointer || stateOwnsGaze) {
      if (lastNx !== null || lastNy !== null) {
        lastNx = null;
        lastNy = null;
        transitioning = false;
        engine.setLook(null, now);
      }
      return;
    }
    const view = doc.defaultView!;
    const halfW = Math.max(1, view.innerWidth / 2);
    const halfH = Math.max(1, view.innerHeight / 2);
    const nx = clamp((pointer.x - (box.left + box.width / 2)) / halfW, -1, 1);
    const ny = clamp((pointer.y - (box.top + box.height / 2)) / halfH, -1, 1);
    if (nx !== lastNx || ny !== lastNy) {
      // Retarget from wherever the curve currently sits — mid-flight or
      // already settled, `easedNow` covers both (a settled `k` clamps to 1
      // and returns `to` exactly) — toward the newly computed target.
      const cur = easedNow(now);
      fromYaw = cur.yaw;
      fromPitch = cur.pitch;
      const target = followLook(nx, ny);
      toYaw = target.yaw;
      toPitch = target.pitch;
      retargetAt = now;
      lastNx = nx;
      lastNy = ny;
      transitioning = true;
    }
    if (transitioning) {
      const eased = easedNow(now);
      // Backdated on purpose — see `PASSTHROUGH_MORPH`'s own doc comment:
      // this makes `BotEngine` treat the target as already `PASSTHROUGH_MORPH`
      // seconds old, so its own `k >= 1` fast path fires immediately and
      // `sample()` shows exactly `eased`, this same tick, unblended.
      engine.setLook(
        { yaw: eased.yaw, pitch: eased.pitch, mix: 1, spin: 0, wander: 0 },
        now - PASSTHROUGH_MORPH,
        PASSTHROUGH_MORPH,
      );
      if (now - retargetAt >= FOLLOW_MORPH) transitioning = false;
    }
  }

  render(engine.sample(0));

  function tick(ms: number) {
    raf = doc.defaultView!.requestAnimationFrame(tick);
    // Tighter than bloub's own 64ms: a hitch slows time down instead of
    // jumping the pose forward, which reads as a stutter rather than a snap.
    // Still bounded, for the same reason bloub bounds it: a backgrounded tab
    // resumes without a multi-second leap when rAF comes back.
    const dt = last ? Math.min((ms - last) / 1000, 0.034) : 0;
    last = ms;
    clock += dt;

    const def = STATE_BY_ID.get(current)!;
    // `def.period` (`bloub/states.ts`) means this state's own `pose()` is a
    // single, phase-wrapped timeline — `BotEngine` folds elapsed time into
    // `[0, period)` itself (see its `wrapped()`), every channel included, so
    // there is nothing for this file to periodically re-`reset()`. That used
    // to be a hardcoded `current === "orbit"` special case (orbit was the
    // only state whose own math never plateaus, so periodic reset would
    // have snapped its spin back to 0); it is now the general rule any
    // state opts into by declaring a `period`, not a name check.
    //
    // Every state WITHOUT one still plateaus (every one of its own terms is
    // wrapped in `clamp(...)`, not periodic), so it needs the periodic
    // restart below to keep animating at all once it settles.
    const structuralLoop = !!def.period;
    if (loop && !structuralLoop) {
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
      // looping, and thinking/alert/snooze/exclaim/notify/swirl reading as
      // static tiles: all of it was one missing assignment.
      current = "idle";
      stateStart = clock;
      engine.setState("idle", clock);
    }

    aimGaze(clock);
    const frame = engine.sample(clock);
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
      engine.setState(id, clock, loop);
      ensureRunning();
    },
    loop(state) {
      this.play(state, { loop: true });
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
    follow(target = "window") {
      if (target === false) {
        detachFollow();
        engine.setLook(null, clock);
        return;
      }
      // Matches the rest of this file: reduced motion means one static
      // frame and no render loop, so there is nothing for a tracked pointer
      // to ever animate — skip attaching listeners for it entirely.
      if (reducedMotion) return;
      attachFollow(target);
    },
    destroy() {
      detachFollow();
      if (raf) doc.defaultView!.cancelAnimationFrame(raf);
      raf = 0;
      root.remove();
    },
  };
}
