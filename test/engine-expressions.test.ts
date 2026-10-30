// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { FakeDocument, drain, eyeAttrs, mountOn, mounted } from "./engine-dom";

const ROSTER = [
  "happy", "sad", "mad", "surprised", "wink", "sleepy", "smug", "unimpressed", "unsure", "scared", "love", "shy", "sick",
  "attentive", "excited", "laughing", "curious", "proud",
];

const BLOUB = ["attentive", "surprised", "excited", "happy", "laughing", "angry", "sad", "scared", "suspicious", "confused", "curious", "proud", "shy", "unimpressed", "sleepy", "love"];

function settled(name: string | null, seed = "expr-seed") {
  const { doc, svg, handle } = mounted(seed);
  const rest = eyeAttrs(svg);
  handle.setExpression(name);
  drain(doc, 0, 5);
  return { rest, now: eyeAttrs(svg), svg, handle, doc };
}

describe("engine expressions", () => {
  test("the handle lists the bloub ids", () => {
    const { handle } = mounted();
    for (const id of BLOUB) expect(handle.expressions).toContain(id);
  });

  test("every roster name poses the eyes", () => {
    for (const name of ROSTER) {
      const { rest, now } = settled(name);
      expect(now, name).not.toEqual(rest);
    }
  });

  test("every bloub id is accepted and poses the eyes", () => {
    for (const name of BLOUB) {
      const { rest, now } = settled(name);
      expect(now, name).not.toEqual(rest);
    }
  });

  test("a bloub id and its roster name pose the same eyes", () => {
    expect(settled("angry").now).toEqual(settled("mad").now);
    expect(settled("confused").now).toEqual(settled("unsure").now);
    expect(settled("suspicious").now).toEqual(settled("smug").now);
  });

  test("idle, wander and null leave the resting face", () => {
    for (const name of ["idle", "wander", null]) {
      const { rest, now } = settled(name);
      expect(now).toEqual(rest);
    }
  });

  test("null clears a held expression", () => {
    const { rest, now, handle, svg, doc } = settled("happy");
    expect(now).not.toEqual(rest);
    handle.setExpression(null);
    drain(doc, 10_000, 5);
    expect(eyeAttrs(svg)).toEqual(rest);
  });

  test("unknown names are ignored without throwing", () => {
    const { doc, svg, handle } = mounted();
    const before = svg.outerHTML;
    for (const name of ["nope", "toString", "__proto__", ""]) expect(() => handle.setExpression(name)).not.toThrow();
    expect(doc.defaultView.queue.length).toBe(0);
    expect(svg.outerHTML).toBe(before);
  });

  test("the initial option applies at once, before any frame", () => {
    const doc = new FakeDocument();
    const plain = mountOn(doc, "expr-seed");
    const posed = mountOn(new FakeDocument(), "expr-seed", { expression: "sad" });
    expect(eyeAttrs(posed.svg)).not.toEqual(eyeAttrs(plain.svg));
  });

  test("the pose lands on a state that accepts one and is ignored by one that owns its eyes", () => {
    const burst = mounted();
    burst.handle.play("burst");
    burst.handle.setExpression("happy");
    drain(burst.doc, 0, 0.2);
    const wide = mounted();
    wide.handle.loop("wide");
    drain(wide.doc, 0, 0.5);
    const before = eyeAttrs(wide.svg);
    wide.handle.setExpression("happy");
    drain(wide.doc, 0, 0.5);
    expect(eyeAttrs(wide.svg)).toEqual(before);
  });
});
