import { describe, expect, test } from "bun:test";
import { BotEngine } from "../src/bloub/engine";

describe("engine.ts SSR safety", () => {
  test("importing the bridge module touches no document/window at module scope", async () => {
    // bun test's own runtime has neither global (see bunfig.toml — no DOM
    // preload), so this is a real check, not a simulated one: a top-level
    // `document.createElementNS(...)` or `window.matchMedia(...)` in
    // `src/engine.ts` would throw a ReferenceError the instant this import
    // resolves, before any test body ever runs.
    await import("../src/engine");
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });
});

describe("BotEngine.sample(t) determinism", () => {
  // `BotEngine` is bloub's own class (src/bloub/engine.ts), ported verbatim —
  // "moteur sans horloge : sample(t) est une fonction pure du temps" per its
  // own doc comment. Asserted here on two states rather than trusted from
  // that comment: this is the property `engine.ts`'s render loop leans on to
  // never desync from wall-clock time.
  test('"thinking" — same instance, same t, twice', () => {
    const engine = new BotEngine(100, "thinking");
    expect(engine.sample(1.2)).toEqual(engine.sample(1.2));
  });

  test('"thinking" — two fresh instances agree at the same t', () => {
    const a = new BotEngine(100, "thinking");
    const b = new BotEngine(100, "thinking");
    expect(a.sample(1.2)).toEqual(b.sample(1.2));
  });

  test('"orbit" — same instance, same t, twice', () => {
    const engine = new BotEngine(100, "orbit");
    expect(engine.sample(2.0)).toEqual(engine.sample(2.0));
  });

  test('"orbit" — two fresh instances agree at the same t', () => {
    const a = new BotEngine(100, "orbit");
    const b = new BotEngine(100, "orbit");
    expect(a.sample(2.0)).toEqual(b.sample(2.0));
  });
});
