/**
 * The living light background, Luzir's signature: "luz" is Portuguese for
 * light, so the whole page sits on a drifting field of it instead of a flat
 * color. Three cheap layers, all GPU/canvas-friendly, no dependency:
 *
 *  1. `.lightfield__rays` (src/styles/global.css), two large blurred radial
 *     gradients (warm + cool) that drift via a single CSS `transform`
 *     keyframe.
 *  2. A canvas of small drifting motes (this file), warm/cool mixed, that
 *     gently brighten and lean toward the pointer within a small radius:
 *     "light responds to you" without any per-frame DOM writes.
 *  3. `.lightfield__torch`, a radial-gradient spotlight pinned to the
 *     pointer via two CSS custom properties, same spotlight technique the
 *     tile/card hover glow uses, just page-wide and much dimmer.
 *
 * Restored verbatim (visually) to this first-iteration version per an
 * explicit later user decision: a simplified single-hue, particle-free pass
 * was tried and rejected in favor of this one. The mote hues are still
 * tokens, not literals, `--mote-warm-rgb`/`--glow-cool-rgb` in
 * src/styles/tokens.css, read once via `getComputedStyle` below since a
 * `<canvas>` 2D context has no way to resolve `var()` itself the way CSS
 * `fillStyle` strings elsewhere on the page do.
 */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

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

  const pointer = { x: -9999, y: -9999, active: false };
  const RADIUS = 160;

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
