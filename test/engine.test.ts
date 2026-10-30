// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import * as engine from "../src/engine";
import { SEQUENCES, runSequence } from "../src/sequences";
import { frame, mounted } from "./engine-dom";

describe("engine entry", () => {
  test("importing it touches no document or window at module scope", async () => {
    await import("../src/engine");
    await import("../src/sequences");
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });

  test("the public surface is mountEngine, engineStates and engineExpressions", () => {
    expect(
      Object.keys(engine)
        .filter((k) => !k.startsWith("_"))
        .sort(),
    ).toEqual(["engineExpressions", "engineStates", "mountEngine"]);
  });

  test("a handle carries the documented API and the same rosters as the helpers", () => {
    const { handle } = mounted();
    for (const k of ["play", "loop", "stop", "follow", "destroy", "setExpression"] as const) {
      expect(typeof handle[k]).toBe("function");
    }
    expect(handle.states).toEqual(engine.engineStates());
    expect(handle.expressions).toEqual(engine.engineExpressions());
    expect(handle.states).toContain("idle");
    handle.destroy();
  });

  test("every sequence name plays a state the handle lists", () => {
    const { doc, handle } = mounted();
    for (const [name, state] of Object.entries(SEQUENCES)) {
      expect(handle.states).toContain(state);
      expect(() => runSequence(handle, name as keyof typeof SEQUENCES)).not.toThrow();
    }
    frame(doc, 16);
    handle.destroy();
  });
});
