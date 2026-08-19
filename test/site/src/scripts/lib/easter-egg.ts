/**
 * Undocumented on purpose (that's the point of an easter egg), this comment
 * is the only place it's written down. Two triggers, either one works:
 *
 *   1. Type "b", "a", "g", "e", "l" anywhere on the page (not inside a
 *      focused input/textarea).
 *   2. Click the nav logo (`[data-brand-mark]`) five times within 1.5s.
 *
 * Either spawns a 🥯 rain + a sesame-seed cursor trail. Ported from
 * itsbagelbot.com's `easter-egg.js` (same mechanics, same CSS classes in
 * global.css), it's the bagel site's own signature gag, carried over as an
 * in-joke rather than reinvented.
 */
const TARGET = "bagel";
let typed = "";
let active = false;
let lastSeedAt = 0;

function cleanup() {
  active = false;
  document.body.classList.remove("bagel-cursor");
  document.removeEventListener("mousemove", spawnSeed);
  document.querySelectorAll(".sesame-seed, .bagel-drop").forEach((el) => el.remove());
}

function rain() {
  const count = 30;
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const bagel = document.createElement("div");
      bagel.className = "bagel-drop";
      bagel.textContent = "🥯";
      bagel.style.left = `${Math.random() * 100}vw`;
      const duration = 2 + Math.random() * 2;
      bagel.style.animationDuration = `${duration}s`;
      bagel.style.fontSize = `${1.4 + Math.random() * 2}rem`;
      document.body.appendChild(bagel);
      setTimeout(() => bagel.remove(), duration * 1000);
    }, i * 100);
  }
}

function spawnSeed(e: MouseEvent) {
  if (!active) return;
  const now = Date.now();
  if (now - lastSeedAt < 50) return;
  lastSeedAt = now;

  const seed = document.createElement("div");
  seed.className = "sesame-seed";
  seed.style.left = `${e.clientX}px`;
  seed.style.top = `${e.clientY}px`;
  seed.style.setProperty("--rot", `${Math.random() * 360}deg`);
  document.body.appendChild(seed);
  setTimeout(() => seed.remove(), 1000);
}

function trigger() {
  if (active) return;
  active = true;
  document.body.classList.add("bagel-cursor");
  rain();
  document.addEventListener("mousemove", spawnSeed);
}

export function setupEasterEgg() {
  document.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && /^(input|textarea)$/i.test(target.tagName)) return;
    if (e.key.length !== 1) return;
    typed = (typed + e.key.toLowerCase()).slice(-TARGET.length);
    if (typed === TARGET) trigger();
  });

  let clicks = 0;
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  document.querySelectorAll("[data-brand-mark]").forEach((mark) => {
    mark.addEventListener("click", () => {
      clicks++;
      if (clickTimer) clearTimeout(clickTimer);
      clickTimer = setTimeout(() => (clicks = 0), 1500);
      if (clicks >= 5) {
        clicks = 0;
        trigger();
      }
    });
  });

  document.addEventListener("astro:before-preparation", cleanup);
}
