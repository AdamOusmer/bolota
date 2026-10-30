// Copyright (c) 2026 Adam Ousmer. MIT licensed. See LICENSE.

/**
 * The fourth roster's static markup, pinned outside `gen2.txt`: that fixture is
 * written whole by `scripts/golden.ts`, and recording these there would rewrite
 * a file whose bytes are the gen2 contract. A failure here is a moved avatar,
 * not a hash to update.
 */

import { expect, test } from "bun:test";
import { bolota } from "../src/bolota";
import { attentive, curious, excited, laughing, proud } from "../src/expression";
import { SEEDS } from "./golden/corpus";
import { hash } from "./golden/format";

const PINNED = {
  attentive: "648804f9ee5d524c",
  excited: "3ab0c69ef8156df1",
  laughing: "a233ea7afcb97111",
  curious: "d2ce2a77203eda05",
  proud: "5f9677372a6824dd",
};

const POSES = { attentive, excited, laughing, curious, proud };

test("the fourth roster renders the recorded markup", () => {
  const now = Object.fromEntries(
    Object.entries(POSES).map(([name, e]) => [
      name,
      hash(SEEDS.slice(0, 12).map((s) => bolota(s, { expression: e })).join("\n")),
    ]),
  );
  expect(now).toEqual(PINNED);
});
