// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import * as roster from "../src/expression";
import { ALIASES, resolveExpression } from "../src/live/names";
import { EXPRESSION_IDS } from "./fixtures/expression-ids";

describe("bloub expression names", () => {
  test("every bloub id has an alias, and nothing else does", () => {
    expect(Object.keys(ALIASES).sort()).toEqual([...EXPRESSION_IDS].sort());
  });

  test("every alias resolves to the roster pose it names", () => {
    for (const [id, to] of Object.entries(ALIASES)) {
      expect(resolveExpression(id), id).toBe(to === null ? null : roster[to]);
    }
  });

  test("the merged ids land where the roster says", () => {
    expect(resolveExpression("angry")).toBe(roster.mad);
    expect(resolveExpression("confused")).toBe(roster.unsure);
    expect(resolveExpression("suspicious")).toBe(roster.smug);
    expect(resolveExpression("unimpressed")).toBe(roster.smug);
    expect(resolveExpression("wander")).toBeNull();
  });

  test("roster names resolve to themselves", () => {
    for (const name of ["idle", "mad", "wink", "sick", "proud"] as const) {
      expect(resolveExpression(name)).toBe(roster[name]);
    }
  });

  test("unknown and prototype names are null, not a throw or a function", () => {
    for (const name of ["", "nope", "toString", "constructor", "poseVars", "__proto__"]) {
      expect(resolveExpression(name), name).toBeNull();
    }
  });
});
