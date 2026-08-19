import { bolota, parts, normalizeSeed, type BolotaOptions } from "bolota";
import {
  idle,
  happy,
  sad,
  mad,
  surprised,
  wink,
  sleepy,
  smug,
  unsure,
  scared,
  love,
  shy,
  sick,
  type Expression,
} from "bolota/expression";
import "bolota/motion.css";
// NOTE(e875087): "bolota/frames.css" and "bolota/decor" were removed --
// the bb-* CSS keyframe approximations are gone, replaced entirely by the
// bloub JS engine below. Importing either now fails module resolution.
import { mountEngine, engineStates, type EngineHandle } from "bolota/engine";
import { runSequence } from "bolota/sequences";
// NOTE(e875087): "bolota/sequences" API changed shape completely. It used
// to be `runSequence(el: Element, seq: FrameSeq, opts?) => cancel fn`, with
// `entrance`/`burst`/`orbit`/`comet` exported as FrameSeq constants. Now it's
// `runSequence(handle: EngineHandle, name: "entrance"|"burst"|"orbit"|"comet") => void`,
// a one-line lookup table onto `handle.play(state)` -- no cancel fn exists
// anymore because `mountEngine`'s `play()` already returns to "idle" on its
// own once a non-looping state's duration elapses (see engine.ts's `tick()`).
// The old `import { runSequence, burst } from "bolota/sequences"` from the
// previous phase no longer resolves: `burst` (the FrameSeq const) is gone.

const findings: string[] = [];
function log(msg: string) {
  findings.push(msg);
  console.log("[testbed]", msg);
}

const grid = document.getElementById("grid")!;
const SVG_NS = "http://www.w3.org/2000/svg";

function card(title: string, wide = false): HTMLDivElement {
  const c = document.createElement("div");
  c.className = wide ? "card wide" : "card";
  const h = document.createElement("h2");
  h.textContent = title;
  c.appendChild(h);
  grid.appendChild(c);
  return c;
}

/**
 * The animated adapter pattern the fork's docs prescribe: outer <span>
 * carries `vars` as CSS custom props, inner <svg> holds an optional
 * backdrop path and a <g> owning `cls` + the stable `inner` markup.
 *
 * `parts().bg` is NOT a pre-serialized string -- it's `{d, fill} | undefined`,
 * the adapter has to build the `<path>` itself.
 */
function makeAvatar(name: string, opts: BolotaOptions) {
  const p = parts(name, opts);
  const span = document.createElement("span");
  span.className = "avatar-wrap";
  span.style.display = "inline-block";
  if (p.vars) for (const [k, v] of Object.entries(p.vars)) span.style.setProperty(k, v);
  const dim = opts.size ? ` width="${opts.size}" height="${opts.size}"` : "";
  const bgMarkup = p.bg ? `<path d="${p.bg.d}" fill="${p.bg.fill}"/>` : "";
  span.innerHTML =
    `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100"${dim}>` + bgMarkup + `<g class="${p.cls ?? ""}">${p.inner}</g>` + `</svg>`;
  const g = span.querySelector("g")!;
  return {
    el: span,
    g,
    /** Morph in place: recompute parts, patch cls + vars only, never innerHTML. */
    setExpression(expr: Expression) {
      const next = parts(name, { ...opts, expression: expr });
      g.setAttribute("class", next.cls ?? "");
      if (next.vars) for (const [k, v] of Object.entries(next.vars)) span.style.setProperty(k, v);
      if (next.inner !== p.inner) {
        log(`BUG: parts().inner changed on expression swap for "${name}" -- docs claim this never happens`);
      }
    },
  };
}

/** Same adapter, but static (no animate) -- used by the determinism card's
 * third slot to prove the parts() path agrees with the bolota() string path. */
function partsSvg(name: string, opts: BolotaOptions = {}): string {
  const p = parts(name, opts);
  const dim = opts.size ? ` width="${opts.size}" height="${opts.size}"` : "";
  const bgMarkup = p.bg ? `<path d="${p.bg.d}" fill="${p.bg.fill}"/>` : "";
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100"${dim}>` + bgMarkup + `<g class="${p.cls ?? ""}">${p.inner}</g>` + `</svg>`;
}

/**
 * bloub engine adapter: `mountEngine` owns and draws the whole `<svg>`
 * subtree itself (body path, eyes, decor) -- unlike
 * `parts()`, there is no markup for the caller to assemble, only an empty
 * `<svg viewBox="0 0 100 100">` to hand it.
 *
 * FINDING: `mountEngine(svgRoot, name, opts?)`'s `opts` is `BolotaOptions`
 * but only ever reaches `resolve()` (hue/tone/palette/traits/size) via
 * `_layout` -- `opts.expression` is silently ignored. An engine-mounted
 * avatar cannot wear `bolota/expression`'s `happy`/`wink`/etc; those poses
 * only exist on the `parts()`/`bolota()` core path. See "MIX: celebrate"
 * below, which composes two avatars for exactly this reason.
 */
function mountEngineSvg(container: HTMLElement, name: string, size: number, opts: BolotaOptions = {}) {
  const svg = document.createElementNS(SVG_NS, "svg") as unknown as SVGSVGElement;
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  container.appendChild(svg);
  const handle = mountEngine(svg, name, opts);
  return { svg, handle };
}

// ---- Determinism -- live test (top, prominent) ----
{
  const c = card("Determinism -- live test");
  c.classList.add("wide");

  const input = document.createElement("input");
  input.type = "text";
  input.value = "Mavey";
  input.placeholder = "type a seed...";
  input.className = "det-input";
  c.appendChild(input);

  const slots = document.createElement("div");
  slots.className = "row det-slots";
  const slot1 = document.createElement("span");
  const slot2 = document.createElement("span");
  const slot3 = document.createElement("span");
  for (const [label, slot] of [
    ["bolota() #1", slot1],
    ["bolota() #2", slot2],
    ["parts() adapter", slot3],
  ] as const) {
    const wrap = document.createElement("div");
    wrap.className = "det-slot";
    const lab = document.createElement("div");
    lab.className = "status";
    lab.textContent = label;
    wrap.appendChild(slot);
    wrap.appendChild(lab);
    slots.appendChild(wrap);
  }
  c.appendChild(slots);

  const status = document.createElement("div");
  status.className = "det-status";
  c.appendChild(status);

  const staticNote = document.createElement("div");
  staticNote.className = "status";
  staticNote.textContent = "renders above are static for byte-comparison";
  c.appendChild(staticNote);

  const hintRow = document.createElement("div");
  hintRow.className = "row";
  const hintRaw = document.createElement("span");
  const hintNorm = document.createElement("span");
  hintRow.appendChild(hintRaw);
  hintRow.appendChild(hintNorm);
  c.appendChild(hintRow);
  const hintLabel = document.createElement("div");
  hintLabel.className = "status";
  c.appendChild(hintLabel);

  function update(raw: string) {
    const seed = raw || "bolota-testbed";
    const s1 = bolota(seed, { size: 64 });
    const s2 = bolota(seed, { size: 64 });
    slot1.innerHTML = s1;
    slot2.innerHTML = s2;
    slot3.innerHTML = partsSvg(seed, { size: 64 });

    const equal = s1 === s2;
    status.textContent = equal ? "deterministic ✓" : `MISMATCH -- diff length ${Math.abs(s1.length - s2.length)}`;
    status.classList.toggle("ok", equal);
    status.classList.toggle("bad", !equal);
    if (!equal) log(`FINDING: bolota("${seed}") not byte-equal across two calls`);

    const norm = normalizeSeed(seed);
    const rawFace = bolota(seed, { size: 40 });
    const normFace = bolota(norm, { size: 40 });
    hintRaw.innerHTML = rawFace;
    hintNorm.innerHTML = normFace;
    const seedEqual = rawFace === normFace;
    hintLabel.textContent =
      `"${seed}" -> normalizeSeed() -> "${norm}" | faces byte-equal: ${seedEqual}` +
      (seedEqual ? "" : " -- NFC/trim/lowercase normalization not idempotent with render, check hash.ts");
  }

  input.addEventListener("input", () => update(input.value));
  update(input.value);
}

// ---- All expressions (animated grid, same seed) ----
{
  const c = card("All expressions (same seed, animated -- idle loop per tile)");
  c.classList.add("wide");
  const row = document.createElement("div");
  row.className = "row";
  row.style.flexWrap = "wrap";
  const seed = "expression-gallery";
  const roster: [string, Expression][] = [
    ["idle", idle],
    ["happy", happy],
    ["sad", sad],
    ["mad", mad],
    ["surprised", surprised],
    ["wink", wink],
    ["sleepy", sleepy],
    ["smug", smug],
    ["unsure", unsure],
    ["scared", scared],
    ["love", love],
    ["shy", shy],
    ["sick", sick],
  ];
  for (const [name, expr] of roster) {
    const cell = document.createElement("div");
    cell.className = "det-slot";
    const av = makeAvatar(seed, { animate: "always", expression: expr, size: 56 });
    const lab = document.createElement("div");
    lab.className = "status";
    lab.textContent = name;
    cell.appendChild(av.el);
    cell.appendChild(lab);
    row.appendChild(cell);
  }
  c.appendChild(row);
}

// ---- Static string API, 3 sizes ----
{
  const c = card("static string API (3 sizes)");
  const row = document.createElement("div");
  row.className = "row";
  for (const size of [32, 56, 96]) {
    const wrap = document.createElement("span");
    wrap.innerHTML = bolota("static-seed-" + size, { size });
    row.appendChild(wrap);
  }
  c.appendChild(row);
}

// ---- Animated: always ----
{
  const c = card("animated: always");
  const av = makeAvatar("always-blob", { animate: "always", size: 72 });
  c.appendChild(av.el);
  requestAnimationFrame(() => {
    const cs = getComputedStyle(av.g);
    if (cs.animationName === "none" || cs.animationName === "") {
      log(`FINDING: animate:always -- .mo-root <g> has no computed animation-name (got "${cs.animationName}")`);
    } else {
      log(`OK: animate:always -- computed animation-name="${cs.animationName}"`);
    }
  });
}

// ---- Animated: hover ----
{
  const c = card("animated: hover");
  const av = makeAvatar("hover-blob", { animate: "hover", size: 72 });
  c.appendChild(av.el);
  const status = document.createElement("div");
  status.className = "status";
  status.textContent = "hover the blob";
  c.appendChild(status);
}

// ---- Positive-expression morph cycle ----
{
  const c = card("expression morph (idle->happy->wink->surprised->smug->love)");
  const av = makeAvatar("morph-blob", { animate: "always", size: 72, expression: idle });
  c.appendChild(av.el);
  const status = document.createElement("div");
  status.className = "status";
  c.appendChild(status);
  const cycle: [string, Expression][] = [
    ["idle", idle],
    ["happy", happy],
    ["wink", wink],
    ["surprised", surprised],
    ["smug", smug],
    ["love", love],
  ];
  let i = 0;
  setInterval(() => {
    i = (i + 1) % cycle.length;
    const [labelName, expr] = cycle[i];
    av.setExpression(expr);
    status.textContent = labelName;
  }, 1500);
}

// ---- burst (bloub engine, button + auto-repeat) ----
{
  const c = card("burst (engine)");
  const { handle } = mountEngineSvg(c, "burst-blob", 72);
  const btn = document.createElement("button");
  btn.textContent = "trigger burst";
  btn.addEventListener("click", () => handle.play("burst"));
  c.appendChild(btn);
  setInterval(() => handle.play("burst"), 4000);
}

// ---- orbit (bloub engine, looping + replay button) ----
{
  const c = card("orbit (engine, looping)");
  const { handle } = mountEngineSvg(c, "orbit-blob", 72);
  handle.play("orbit", { loop: true });
  const btn = document.createElement("button");
  btn.textContent = "replay orbit";
  btn.addEventListener("click", () => handle.play("orbit", { loop: true }));
  c.appendChild(btn);
}

// ---- comet (bloub engine, looping + replay button) ----
{
  const c = card("comet (engine, looping)");
  const { handle } = mountEngineSvg(c, "comet-blob", 72);
  handle.play("comet", { loop: true });
  const btn = document.createElement("button");
  btn.textContent = "replay comet";
  btn.addEventListener("click", () => handle.play("comet", { loop: true }));
  c.appendChild(btn);
}

// ---- entrance (bonus: closes the leftover stub from the previous phase --
// now trivial, `runSequence` is a one-line lookup onto `handle.play("swirl")`) ----
{
  const c = card("entrance (engine, via runSequence)");
  const { handle } = mountEngineSvg(c, "entrance-blob", 72);
  const btn = document.createElement("button");
  btn.textContent = "replay entrance";
  const play = () => runSequence(handle, "entrance");
  play();
  btn.addEventListener("click", play);
  c.appendChild(btn);
}

// ---- Cursor follow (engine, handle.follow) ----
{
  const c = card("Cursor follow (engine)");
  const { handle } = mountEngineSvg(c, "cursor-follow-blob", 200);
  // Idle life (blink/breathe) keeps running underneath — `follow` only ever
  // overrides the gaze direction (`Look.mix`/`yaw`/`pitch`), never the body.
  handle.play("idle", { loop: true });

  const status = document.createElement("div");
  status.className = "status";
  c.appendChild(status);

  const btn = document.createElement("button");
  let following = true;
  const sync = () => {
    btn.textContent = following ? "stop following" : "follow the pointer";
    status.textContent = following ? "following: window" : "following: off";
  };
  handle.follow("window");
  sync();
  btn.addEventListener("click", () => {
    following = !following;
    handle.follow(following ? "window" : false);
    sync();
  });
  c.appendChild(btn);
}

// ---- All 15 bloub engine states ----
{
  const c = card("All 15 bloub engine states (one engine per tile)", true);
  const row = document.createElement("div");
  row.className = "row";
  row.style.flexWrap = "wrap";
  const states = engineStates();
  for (const s of states) {
    const cell = document.createElement("div");
    cell.className = "det-slot";
    const { handle } = mountEngineSvg(cell, `state-gallery-${s}`, 56);
    handle.play(s, { loop: true });
    const lab = document.createElement("div");
    lab.className = "status";
    lab.textContent = s;
    cell.appendChild(lab);
    row.appendChild(cell);
  }
  c.appendChild(row);
  log(
    `INFO: mounted ${states.length} live engines for the states grid (within engine.ts's documented ~20-engine/60fps ` +
      `budget) -- chose one-engine-per-tile over a single-engine-plus-buttons layout for a simultaneous, no-interaction demo.`,
  );
}

// ---- All 16 bloub expressions ----
{
  const c = card("All 16 bloub expressions (one engine, eased eye transition)", true);
  const { handle } = mountEngineSvg(c, "expression-gallery", 96);
  handle.play("idle", { loop: true });

  // bloub's expression ids are plain English now (`bloub/expressions.ts`'s
  // `EXPRESSIONS` array), so the display label is just the id
  // capitalized -- no separate English/French label list to keep in sync.
  const label = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

  const status = document.createElement("div");
  status.className = "status";
  status.textContent = `expression: ${label(handle.expressions[0]!)} (${handle.expressions[0]})`;
  c.appendChild(status);

  const row = document.createElement("div");
  row.className = "row";
  row.style.flexWrap = "wrap";
  handle.expressions.forEach((id: string) => {
    const btn = document.createElement("button");
    btn.textContent = label(id);
    btn.addEventListener("click", () => {
      handle.setExpression(id);
      status.textContent = `expression: ${label(id)} (${id})`;
    });
    row.appendChild(btn);
  });
  c.appendChild(row);

  log(
    `INFO: mounted 1 engine driving all ${handle.expressions.length} bloub face expressions via setExpression() -- ` +
      `eased transition reuses BotEngine's own exprAtTime/blendExpression path, no new easing.`,
  );
}

// ---- Morph slideshow (engine, auto-advancing idle -> state timeline) ----
{
  const c = card("Morph slideshow -- idle -> state", true);
  const { handle } = mountEngineSvg(c, "slideshow-blob", 96);

  const status = document.createElement("div");
  status.className = "status";
  c.appendChild(status);

  const controls = document.createElement("div");
  controls.className = "row";
  const prevBtn = document.createElement("button");
  prevBtn.textContent = "prev";
  const playBtn = document.createElement("button");
  playBtn.textContent = "pause";
  const nextBtn = document.createElement("button");
  nextBtn.textContent = "next";
  controls.appendChild(prevBtn);
  controls.appendChild(playBtn);
  controls.appendChild(nextBtn);
  c.appendChild(controls);

  // Each non-"idle" beat returns to "idle" on its own once its duration
  // elapses (see engine.ts's tick()), but we still drive the timeline with
  // our own timer so the status label and manual prev/next stay in sync
  // with what's on screen, including the resting "idle" beats.
  const timeline: string[] = [
    "idle", "thinking", "idle", "alert", "idle", "snooze",
    "idle", "exclaim", "idle", "burst", "idle", "comet", "idle",
  ];
  const STEP_MS = 3000;
  let step = 0;
  let playing = true;
  let timer: ReturnType<typeof setInterval> | null = null;

  function render() {
    const s = timeline[step];
    handle.play(s, { loop: s === "idle" });
    status.textContent = `${step + 1}/${timeline.length}: ${s}`;
  }

  function advance(delta: number) {
    step = (step + delta + timeline.length) % timeline.length;
    render();
  }

  function startTimer() {
    timer = setInterval(() => advance(1), STEP_MS);
  }

  function stopTimer() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  playBtn.addEventListener("click", () => {
    playing = !playing;
    playBtn.textContent = playing ? "pause" : "play";
    if (playing) startTimer();
    else stopTimer();
  });
  prevBtn.addEventListener("click", () => {
    stopTimer();
    playing = false;
    playBtn.textContent = "play";
    advance(-1);
  });
  nextBtn.addEventListener("click", () => {
    stopTimer();
    playing = false;
    playBtn.textContent = "play";
    advance(1);
  });

  render();
  startTimer();
}

// ---- MIX 1: onboarding scene (roam + morph + engine burst finale) ----
{
  const c = card("MIX: onboarding scene (roam + morph + engine burst finale)", true);
  const stage = document.createElement("div");
  stage.className = "roam-stage";
  c.appendChild(stage);

  const av = makeAvatar("onboarding-blob", { animate: "always", size: 64 });
  av.el.style.left = "0px";
  av.el.style.top = "0px";
  stage.appendChild(av.el);

  // The finale swaps to an engine-mounted avatar for the burst -- engine
  // states and core `expression` poses are separate rendering systems (see
  // `mountEngineSvg`'s doc comment), so the roam+morph half stays on the
  // `parts()` adapter and only the last beat hands off to `mountEngine`.
  const engineWrap = document.createElement("span");
  engineWrap.className = "avatar-wrap";
  engineWrap.style.display = "none";
  engineWrap.style.left = "0px";
  engineWrap.style.top = "0px";
  stage.appendChild(engineWrap);
  const { handle: engineHandle } = mountEngineSvg(engineWrap, "onboarding-blob", 64);

  const stops: { x: number; y: number; expr: Expression }[] = [
    { x: 0, y: 0, expr: idle },
    { x: 220, y: 20, expr: happy },
    { x: 440, y: 60, expr: wink },
    { x: 660, y: 10, expr: smug },
  ];
  let stopIdx = 0;
  function nextStop() {
    const s = stops[stopIdx];
    av.el.style.left = s.x + "px";
    av.el.style.top = s.y + "px";
    av.setExpression(s.expr);
    if (stopIdx === stops.length - 1) {
      setTimeout(() => {
        engineWrap.style.left = s.x + "px";
        engineWrap.style.top = s.y + "px";
        av.el.style.display = "none";
        engineWrap.style.display = "inline-block";
        engineHandle.play("burst");
      }, 800);
    } else {
      stopIdx++;
      setTimeout(nextStop, 1600);
    }
  }
  nextStop();
  const btn = document.createElement("button");
  btn.textContent = "replay scene";
  btn.style.position = "absolute";
  btn.style.right = "1rem";
  btn.style.top = "1rem";
  btn.addEventListener("click", () => {
    stopIdx = 0;
    av.el.style.display = "inline-block";
    engineWrap.style.display = "none";
    engineHandle.stop();
    nextStop();
  });
  c.appendChild(btn);
}

// ---- MIX 2: celebrate (engine burst + orbit flash + happy) ----
{
  const c = card("MIX: celebrate (engine burst + orbit flash + happy)", true);
  const row = document.createElement("div");
  row.className = "row";
  const { handle }: { handle: EngineHandle } = mountEngineSvg(row, "celebrate-blob", 80);
  const badge = makeAvatar("celebrate-blob", { animate: "always", size: 40 });
  row.appendChild(badge.el);
  c.appendChild(row);

  const label = document.createElement("div");
  label.className = "status";
  label.textContent = "engine avatar (burst/orbit) + core badge (expression: idle)";
  c.appendChild(label);

  const btn = document.createElement("button");
  btn.textContent = "Complete checkout";
  btn.addEventListener("click", () => {
    handle.play("burst");
    badge.setExpression(happy);
    label.textContent = "engine avatar (burst/orbit) + core badge (expression: happy)";
    setTimeout(() => handle.play("orbit"), 2650); // orbit "flash" once burst's 2.6s settles
  });
  c.appendChild(btn);

  log(
    "INFO: MIX celebrate composes two avatars -- mountEngine's BolotaOptions never reaches expression handling " +
      "(only resolve()'s hue/tone/palette/traits/size), so the engine avatar cannot itself wear `happy`; the core " +
      "parts()-adapter badge carries that half.",
  );
}

const footer = document.getElementById("findings")!;
setTimeout(() => {
  footer.textContent = "console findings:\n" + findings.join("\n");
}, 500);
