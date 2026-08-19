// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import type { EngineHandle } from "@luzir/bolota/engine";
import { ensureEngine } from "../lib/live-engine";
import { onSeedChange, getSeed } from "../lib/seed-store";
import { DEFAULT_SEED } from "../lib/curated-seeds";
import { humanizeExpression } from "../lib/humanize";
import { onVisible } from "../lib/visibility";
import { observeReveals } from "../lib/motion";

const SVG_NS = "http://www.w3.org/2000/svg";
const AUTO_CYCLE_MS = 3200;
const IDLE_BEFORE_AUTO_MS = 5000;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/** The expression picker: one live engine (the stage avatar), a grid of
 * circular buttons below it. Click one to hold that expression; leave it
 * alone and it gently auto-cycles through the roster on its own, nothing
 * on this page needs a play button to be alive.
 *
 * Stage state is `"wander"`, not `"idle"`: `"idle"` is bolota's still
 * neutral base (dead-ahead gaze, no ambient drift, no float — see the
 * engine's own comment on that state), which made this whole section read
 * as a frozen portrait once the idle/wander split landed. `"wander"` is
 * the living version of the same resting face, and the held expression
 * still owns the eyes on top of it: the engine replaces gaze/split/eyes
 * for any `baseFace` state carrying an expression, and both `"idle"` and
 * `"wander"` are `baseFace`. So the selected pose is exactly what the
 * picker chose while the body underneath keeps breathing and drifting. */
export function setupExpressions() {
  const section = document.querySelector<HTMLElement>("[data-expressions]");
  const stageHost = document.querySelector<HTMLElement>("[data-expr-stage]");
  const picker = document.querySelector<HTMLElement>("[data-expr-picker]");
  const label = document.querySelector<HTMLElement>("[data-expr-label]");
  if (!section || !stageHost || !picker || !label) return;

  const svg = document.createElementNS(SVG_NS, "svg") as unknown as SVGSVGElement;
  svg.setAttribute("viewBox", "0 0 100 100");
  stageHost.appendChild(svg);

  let handle: EngineHandle | null = null;
  let seed = getSeed() ?? DEFAULT_SEED;
  let items: HTMLButtonElement[] = [];
  let autoTimer: ReturnType<typeof setInterval> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let index = 0;
  // See hero.ts/live-engine.ts's own copies of this pattern: guards a
  // stale mount() (superseded by a newer seed change before its
  // ensureEngine() await resolved) from clobbering a newer one.
  let gen = 0;

  function select(i: number, id: string, byUser: boolean) {
    index = i;
    handle?.setExpression(id);
    label!.textContent = humanizeExpression(id);
    items.forEach((btn, bi) => btn.classList.toggle("is-active", bi === i));
    if (byUser) {
      stopAuto();
      scheduleAuto();
    }
  }

  function stopAuto() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  function scheduleAuto() {
    if (reduceMotion.matches) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (autoTimer || !items.length) return;
      autoTimer = setInterval(() => {
        const next = (index + 1) % items.length;
        select(next, items[next]!.dataset.exprId!, false);
      }, AUTO_CYCLE_MS);
    }, IDLE_BEFORE_AUTO_MS);
  }

  function buildPicker() {
    picker!.innerHTML = "";
    items = handle!.expressions.map((id, i) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "picker__item";
      item.dataset.exprId = id;
      item.innerHTML = `<span class="picker__circle"><span>${i + 1}</span></span><span class="picker__label">${humanizeExpression(id)}</span>`;
      item.addEventListener("click", () => select(i, id, true));
      picker!.appendChild(item);
      return item;
    });
    // The picker itself is `[data-reveal]` in the Astro markup so it's
    // already tracked, but its contents mount async here; re-running this
    // is a cheap no-op for an already-observed node (see motion.ts's
    // observeReveals doc comment) and a real fix if a future picker layout
    // moves `data-reveal` onto these items instead of the container.
    observeReveals(picker!);
  }

  async function mount(nextSeed: string) {
    const myGen = ++gen;
    seed = nextSeed;
    const { mountEngine } = await ensureEngine();
    if (myGen !== gen) return; // a newer mount() call already won the race
    handle?.destroy();
    handle = mountEngine(svg, seed);
    // `wander`, not `idle`: idle is the still neutral base now (dead-ahead
    // gaze, no drift, no float — see the engine's own comment on that
    // state), so a held expression on top of it renders as a frozen
    // portrait. `wander` is the living version of the same resting face,
    // and a held expression still owns the eyes on top of it (the engine
    // replaces gaze/split/eyes for any `baseFace` state carrying one), so
    // the pose stays exactly what the picker selected while the body keeps
    // breathing, blinking and drifting under it.
    handle.play("wander", { loop: true });
    buildPicker();
    select(0, handle.expressions[0]!, false);
  }

  mount(seed);
  onSeedChange((s) => mount(s ?? DEFAULT_SEED));

  onVisible(
    svg,
    () => {
      handle?.play("wander", { loop: true }); // see mount() for why not idle
      scheduleAuto();
    },
    () => {
      handle?.stop();
      stopAuto();
      if (idleTimer) clearTimeout(idleTimer);
    },
  );
}
