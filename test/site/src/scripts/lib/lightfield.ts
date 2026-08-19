/**
 * The living light background, Luzir's signature: "luz" is Portuguese for
 * light, so the whole page sits on a drifting field of it instead of a flat
 * color. Four cheap layers, all GPU/canvas-friendly, no dependency:
 *
 *  1. `.lightfield__shaft` x3 (src/styles/global.css + the inline custom
 *     properties in Base.astro), tall blurred diagonal gradients that
 *     breathe opacity on their own desynced CSS animations. Pure CSS, no
 *     JS drives them directly, but this file's `SHAFTS` constant mirrors
 *     their position/angle/width by hand (documented at its declaration)
 *     so the mote/ember effects below can line up with them visually.
 *  2. A canvas of small drifting motes (this file), warm/cool mixed, that
 *     gently brighten and lean toward the pointer within a small radius
 *     ("light responds to you" without any per-frame DOM writes), and also
 *     brighten slightly while passing through a shaft's band.
 *  3. Embers on that same canvas: 1-2 concurrent brighter warm sparks that
 *     rise from a shaft's base and fade out, distinct from the ambient
 *     motes' slow drift.
 *  4. `.lightfield__torch`, a radial-gradient spotlight pinned to the
 *     pointer via two CSS custom properties, same spotlight technique the
 *     tile/card hover glow uses, just page-wide and much dimmer.
 *
 * 2026-08-19 spec amendment replaced the original two orb gradients (layer
 * 1 above used to be `.lightfield__rays`, unconditionally-visible blurred
 * radial gradients) with the shafts, and added the ember/brightening
 * behavior to layer 2; grain, torch and the base mote canvas are otherwise
 * unchanged from the first-iteration version. The mote hues are still
 * tokens, not literals, `--mote-warm-rgb`/`--glow-cool-rgb` in
 * src/styles/tokens.css, read once via `getComputedStyle` below since a
 * `<canvas>` 2D context has no way to resolve `var()` itself the way CSS
 * `fillStyle` strings elsewhere on the page do.
 */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/**
 * Mirrors the three `.lightfield__shaft` elements' `--shaft-x`/
 * `--shaft-angle`/`--shaft-w` inline styles in Base.astro. Kept in sync by
 * hand (same pattern as the mote-hue tokens above): a `<canvas>` can't read
 * another element's computed custom properties, and hunting three live
 * `.lightfield__shaft` nodes down every frame just to read static geometry
 * would be needless DOM work for something that never changes at runtime.
 * `xPct` is the shaft's anchor as a percent of viewport width (its CSS
 * `left`), `angleDeg` its CSS `rotate()`, `wVw` its CSS width in vw.
 */
const SHAFTS = [
  { xPct: 20, angleDeg: 16, wVw: 26 },
  { xPct: 52, angleDeg: -10, wVw: 20 },
  { xPct: 78, angleDeg: 22, wVw: 22 },
] as const;

/** Perpendicular distance from (x, y) to a shaft's centerline, in px. The
 * shaft's anchor sits at `top: -20%` in its own CSS, same here. */
function shaftBrighten(x: number, y: number, w: number, h: number): number {
  let boost = 0;
  for (const s of SHAFTS) {
    const anchorX = (s.xPct / 100) * w;
    const anchorY = -0.2 * h;
    const rad = (s.angleDeg * Math.PI) / 180;
    const dirX = Math.sin(rad);
    const dirY = Math.cos(rad);
    const vx = x - anchorX;
    const vy = y - anchorY;
    const perp = Math.abs(vx * dirY - vy * dirX);
    const halfWidth = ((s.wVw / 100) * w) / 2;
    if (perp < halfWidth) boost = Math.max(boost, 0.22 * (1 - perp / halfWidth));
  }
  return boost;
}

/** Reads an "R G B" custom property (see tokens.css's `-rgb` tokens) off the
 * root element, for contexts that can't resolve `var()` themselves (canvas
 * `fillStyle`, in this file's case). */
function readRgbToken(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

interface Mote {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  a: number;
  warm: boolean;
}

/** A single ember: brighter and shorter-lived than an ambient mote, rises
 * from a shaft's base and fades in/out over its `maxLife` (frame count, not
 * ms, same fixed-per-frame-increment style the rest of this file uses). */
interface Ember {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  vy: number;
}

export function setupLightfield(root: HTMLElement) {
  const canvas = root.querySelector<HTMLCanvasElement>("[data-motes]");
  const torch = root.querySelector<HTMLElement>(".lightfield__torch");
  if (!canvas) return;

  if (reduceMotion.matches) {
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const moteWarmRgb = readRgbToken("--mote-warm-rgb", "255 207 114");
  const moteCoolRgb = readRgbToken("--glow-cool-rgb", "159 194 255");

  let w = 0;
  let h = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let motes: Mote[] = [];
  let embers: Ember[] = [];

  const pointer = { x: -9999, y: -9999, active: false };
  const RADIUS = 160;

  // "Occasional... 1-2 at a time": a low per-frame spawn chance capped at
  // MAX_EMBERS concurrent, checked before every spawn roll so the cap holds
  // even across a dropped-frame gap.
  const MAX_EMBERS = 2;
  const EMBER_SPAWN_CHANCE = 0.006;

  function maybeSpawnEmber() {
    if (embers.length >= MAX_EMBERS || Math.random() > EMBER_SPAWN_CHANCE) return;
    const shaft = SHAFTS[Math.floor(Math.random() * SHAFTS.length)]!;
    const anchorX = (shaft.xPct / 100) * w;
    embers.push({
      x: anchorX + (Math.random() - 0.5) * 0.03 * w,
      y: h + 10,
      life: 0,
      maxLife: 320 + Math.random() * 200,
      vy: -(0.22 + Math.random() * 0.18),
    });
  }

  /** Fades in over the first 15% of life, holds, fades out over the last
   * 30%, same shape as the reveal system's own ease-in/ease-out feel. */
  function emberAlpha(e: Ember): number {
    const t = e.life / e.maxLife;
    if (t < 0.15) return t / 0.15;
    if (t > 0.7) return Math.max(0, 1 - (t - 0.7) / 0.3);
    return 1;
  }

  function paintEmber(e: Ember) {
    const a = emberAlpha(e) * 0.85;
    ctx!.beginPath();
    ctx!.arc(e.x, e.y, 1.7, 0, Math.PI * 2);
    ctx!.fillStyle = `rgb(${moteWarmRgb} / ${a.toFixed(3)})`;
    ctx!.fill();
  }

  function build() {
    w = canvas!.clientWidth;
    h = canvas!.clientHeight;
    if (!w || !h) return;
    canvas!.width = Math.round(w * dpr);
    canvas!.height = Math.round(h * dpr);
    const count = w < 700 ? 46 : 84;
    motes = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.6 + Math.random() * 1.8,
      vx: (Math.random() - 0.5) * 0.08,
      vy: -(0.03 + Math.random() * 0.14),
      a: 0.1 + Math.random() * 0.4,
      warm: Math.random() > 0.32,
    }));
  }

  function step(m: Mote) {
    m.y += m.vy;
    m.x += m.vx;

    if (pointer.active) {
      const dx = pointer.x - m.x;
      const dy = pointer.y - m.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < RADIUS * RADIUS && distSq > 1) {
        const dist = Math.sqrt(distSq);
        const pull = (1 - dist / RADIUS) * 0.05;
        m.x += (dx / dist) * pull * RADIUS * 0.02;
        m.y += (dy / dist) * pull * RADIUS * 0.02;
      }
    }

    if (m.y < -10) {
      m.y = h + 10;
      m.x = Math.random() * w;
    }
    if (m.x < -10) m.x = w + 10;
    else if (m.x > w + 10) m.x = -10;
  }

  function paint(m: Mote) {
    let alpha = m.a;
    if (pointer.active) {
      const dx = pointer.x - m.x;
      const dy = pointer.y - m.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < RADIUS * RADIUS) alpha = Math.min(1, alpha + (1 - distSq / (RADIUS * RADIUS)) * 0.55);
    }
    // Spec: "motes brightening slightly inside a shaft's band".
    alpha = Math.min(1, alpha + shaftBrighten(m.x, m.y, w, h));
    const rgb = m.warm ? moteWarmRgb : moteCoolRgb;
    ctx!.beginPath();
    ctx!.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    ctx!.fillStyle = `rgb(${rgb} / ${alpha.toFixed(3)})`;
    ctx!.fill();
  }

  function draw() {
    if (!w || !h || !motes.length) build();
    if (!w || !h) return;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, w, h);
    ctx!.globalCompositeOperation = "lighter";
    for (const m of motes) {
      step(m);
      paint(m);
    }

    maybeSpawnEmber();
    for (const e of embers) {
      e.y += e.vy;
      e.life += 1;
    }
    embers = embers.filter((e) => e.life < e.maxLife && e.y > -20);
    for (const e of embers) paintEmber(e);

    ctx!.globalCompositeOperation = "source-over";
  }

  let raf = 0;
  function loop() {
    draw();
    raf = requestAnimationFrame(loop);
  }

  const io = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting && !raf) raf = requestAnimationFrame(loop);
      else if (!entry?.isIntersecting && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { threshold: 0 },
  );
  io.observe(canvas);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!document.hidden && !raf && canvas!.getBoundingClientRect().bottom > 0) {
      raf = requestAnimationFrame(loop);
    }
  });

  window.addEventListener(
    "resize",
    () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      build();
    },
    { passive: true },
  );

  let torchTimeout: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch") return;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;

      if (torch) {
        torch.style.setProperty("--px", `${e.clientX}px`);
        torch.style.setProperty("--py", `${e.clientY}px`);
        torch.classList.add("is-active");
        if (torchTimeout) clearTimeout(torchTimeout);
        torchTimeout = setTimeout(() => torch.classList.remove("is-active"), 1400);
      }
    },
    { passive: true },
  );
  window.addEventListener("blur", () => {
    pointer.active = false;
  });
  document.addEventListener("mouseleave", () => {
    pointer.active = false;
  });

  build();
}
