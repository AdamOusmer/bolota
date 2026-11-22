// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

import { describe, expect, test } from "bun:test";
import { _layout } from "../src/bolota";
import { ballEdge, ballRadius, edge, floor, prepare } from "../src/live/outline";

const SEEDS = Array.from({ length: 120 }, (_, i) => `seed-${i * 7}`);
const ANGLES = [-3.3, -1.1, 0, 0.0007, 0.9, Math.PI / 2, 2.4, Math.PI, 4.71, 6.2831, 9.5];

describe("lazy outline table", () => {
  test("edge, floor and ball radii are identical read lazily or after prepare", () => {
    for (const seed of SEEDS) {
      const base = _layout(seed);
      const lazy = { ...base };
      const full = { ...base };
      prepare(full);
      for (const face of [false, true])
        for (const th of ANGLES) expect(edge(lazy, th, face)).toBe(edge(full, th, face));
      for (const th of ANGLES) expect(ballEdge(lazy, th)).toBe(ballEdge(full, th));
      expect(ballRadius(lazy)).toBe(ballRadius(full));
      expect(floor(lazy)).toBe(floor(full));
    }
  });

  test("the ball reuses the face table where no petals set it apart", () => {
    for (const seed of SEEDS) {
      const l = { ..._layout(seed) };
      if (l.shape === "capsule") continue;
      const bare = { ...l, petals: [] };
      for (const th of ANGLES) expect(ballEdge(l, th)).toBe(ballEdge(bare, th));
      expect(ballRadius(l)).toBe(ballRadius(bare));
    }
  });
});
