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
  attentive: "c70a807b37590b92",
  excited: "be3af59ba64f6269",
  laughing: "7e1ff48510493b70",
  curious: "38b3f3231da4a846",
  proud: "eb43b5604f2c3168",
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
